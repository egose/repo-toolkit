import { chmod, readFile } from 'node:fs/promises';
import { basename, delimiter, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CapturingProcessRunner, ProcessCaptureResult } from '@repo-toolkit/publish-package';

import { determineNextTag, resolveReleaseTagPlan, runPreflight, runReleaseBranch } from '../src/index';
import { captureCommand, captureProcess, MAX_PROCESS_TIMEOUT_MS } from '../src/process';
import { withNodeFixture } from './process-fixture';
import { createReleaseRunner, ok } from './release-fixture';
import { snapshotGitFixture, withGitFixture } from './git-fixture';

const CANARY = 'process-private-canary-c53e2c';
const DETERMINED = {
  version: '1.2.3',
  tagVersion: 'v1.2.3',
  manual: true,
  noChanges: false,
  bump: null,
  lastTag: null,
} as const;

function fakeRunner(value: unknown): CapturingProcessRunner {
  return {
    run() {
      throw new Error('only capture is permitted');
    },
    runShell() {
      throw new Error('shell execution is not permitted');
    },
    async capture() {
      return value as ProcessCaptureResult;
    },
  };
}

async function rejection(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error('expected process failure');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('bounded process transport (real Node children)', () => {
  it('captures split multibyte streams exactly at the combined raw-byte limit without inheriting stdin or stdout', async () => {
    await withNodeFixture(async (fixture) => {
      const stdout = 'α🚀\n';
      const stderr = 'é日本\n';
      const bytes = Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
      const script = await fixture.script(`
process.stdin.on('end', () => {
  process.stdout.write(Buffer.from([0xce]));
  process.stderr.write(Buffer.from([0xc3]));
  setTimeout(() => {
    process.stdout.write(Buffer.from([0xb1, 0xf0, 0x9f]));
    process.stderr.write(Buffer.from([0xa9]));
    setTimeout(() => {
      process.stdout.write(Buffer.from([0x9a, 0x80, 0x0a]));
      process.stderr.write('日本\\n');
    }, 20);
  }, 20);
});
process.stdin.resume();
`);
      const result = await captureProcess(process.execPath, [script], {
        cwd: fixture.cwd,
        timeoutMs: 3000,
        maxOutputBytes: bytes,
        stdio: 'inherit',
      });
      expect(result).toMatchObject({
        stdout,
        stderr,
        code: 0,
        outputBytes: bytes,
        retainedBytes: bytes,
        cleanupIncomplete: false,
      });
      expect(result.error).toBeUndefined();
      expect(await fixture.waitForExit()).toEqual([]);
    });
  });

  it('counts invalid UTF-8 as raw bytes rather than the replacement text length', async () => {
    await withNodeFixture(async (fixture) => {
      const script = await fixture.script(
        "process.stdout.write(Buffer.from([0xff, 0x00])); process.stderr.write('🚀');",
      );
      const result = await captureProcess(process.execPath, [script], {
        cwd: fixture.cwd,
        timeoutMs: 3000,
        maxOutputBytes: 6,
      });
      expect(result).toMatchObject({ stdout: '\ufffd\0', stderr: '🚀', code: 0, outputBytes: 6, retainedBytes: 6 });
      expect(result.error).toBeUndefined();
      expect(await fixture.liveProcesses()).toEqual([]);
    });
  });

  it('stops multibyte overflow that exceeds the combined limit while each stream fits separately', async () => {
    await withNodeFixture(async (fixture) => {
      const script = await fixture.script(
        "process.stdout.write('🚀'.repeat(5)); process.stderr.write('界'.repeat(4)); setInterval(() => {}, 1000);",
      );
      const start = performance.now();
      const result = await captureProcess(process.execPath, [script], {
        cwd: fixture.cwd,
        timeoutMs: 3000,
        maxOutputBytes: 31,
      });
      expect(result.error).toMatchObject({ code: 'ENOBUFS' });
      expect(result).toMatchObject({ outputBytes: 32, retainedBytes: 31, cleanupIncomplete: false });
      expect(result.stdout.length).toBeGreaterThan(0);
      expect(result.stderr.length).toBeGreaterThan(0);
      expect(performance.now() - start).toBeLessThan(2000);
      expect(await fixture.waitForExit()).toEqual([]);
    });
  });

  it('retains only 65,537 bytes and terminates a paced 64 MiB producer before it produces 1 MiB', async () => {
    await withNodeFixture(async (fixture) => {
      const script = await fixture.script(`
let produced = 0;
const chunk = Buffer.from('🌍'.repeat(2048));
const timer = setInterval(() => {
  produced += chunk.length;
  fs.writeFileSync(root + '/produced', String(produced));
  const stream = produced / chunk.length % 2 === 0 ? process.stdout : process.stderr;
  stream.write(chunk);
  if (produced >= 64 * 1024 * 1024) {
    clearInterval(timer);
    fs.writeFileSync(root + '/completed', 'yes');
  }
}, 2);
process.on('SIGTERM', () => clearInterval(timer));
process.stdout.on('error', () => clearInterval(timer));
process.stderr.on('error', () => clearInterval(timer));
`);
      const start = performance.now();
      const result = await captureProcess(process.execPath, [script], {
        cwd: fixture.cwd,
        timeoutMs: 4000,
        maxOutputBytes: 65537,
      });
      const elapsed = performance.now() - start;
      const produced = Number(await readFile(join(fixture.cwd, 'produced'), 'utf8'));
      expect(result.error).toMatchObject({ code: 'ENOBUFS' });
      expect(result.retainedBytes).toBe(65537);
      const returnedBytes = Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr);
      expect(returnedBytes).toBeGreaterThanOrEqual(65537);
      expect(returnedBytes).toBeLessThanOrEqual(65539);
      expect(result.outputBytes).toBeGreaterThan(65537);
      expect(result.outputBytes).toBeLessThanOrEqual(65537 + 65536);
      expect(produced).toBeGreaterThanOrEqual(result.outputBytes);
      expect(produced).toBeLessThan(1024 * 1024);
      expect(elapsed).toBeLessThan(2500);
      expect(result.cleanupIncomplete).toBe(false);
      await expect(readFile(join(fixture.cwd, 'completed'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fixture.waitForExit()).toEqual([]);
    });
  });

  it('terminates and reaps a stalled child within a bounded wall-clock interval', async () => {
    await withNodeFixture(async (fixture) => {
      const script = await fixture.script(`
const timer = setInterval(() => {}, 1000);
process.on('SIGTERM', () => {
  fs.writeFileSync(root + '/terminated', 'SIGTERM');
  clearInterval(timer);
});
`);
      const start = performance.now();
      const result = await captureProcess(process.execPath, [script], {
        cwd: fixture.cwd,
        timeoutMs: 500,
        maxOutputBytes: 1024,
      });
      expect(result.error).toMatchObject({ code: 'ETIMEDOUT' });
      expect(result.durationMs).toBeGreaterThanOrEqual(500);
      expect(performance.now() - start).toBeLessThan(2500);
      expect(result.cleanupIncomplete).toBe(false);
      expect(await readFile(join(fixture.cwd, 'terminated'), 'utf8')).toBe('SIGTERM');
      expect(await fixture.liveProcesses()).toEqual([]);
    });
  });

  it.skipIf(process.platform === 'win32').each(['deadline', 'output overflow'])(
    'escalates %s to SIGKILL when the child handles but ignores SIGTERM',
    async (reason) => {
      await withNodeFixture(async (fixture) => {
        const script = await fixture.script(`
process.on('SIGTERM', () => fs.writeFileSync(root + '/terminated', 'ignored'));
setInterval(() => {}, 1000);
${reason === 'output overflow' ? "process.stdout.write('x'.repeat(2048));" : ''}
`);
        const start = performance.now();
        const result = await captureProcess(process.execPath, [script], {
          cwd: fixture.cwd,
          timeoutMs: 500,
          maxOutputBytes: 1024,
        });
        expect(result.error).toMatchObject({ code: reason === 'deadline' ? 'ETIMEDOUT' : 'ENOBUFS' });
        expect(result.signal).toBe('SIGKILL');
        expect(result.durationMs).toBeGreaterThanOrEqual(reason === 'deadline' ? 700 : 200);
        expect(performance.now() - start).toBeLessThan(3000);
        expect(result.cleanupIncomplete).toBe(false);
        expect(await readFile(join(fixture.cwd, 'terminated'), 'utf8')).toBe('ignored');
        expect(await fixture.liveProcesses()).toEqual([]);
      });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'terminates children and grandchildren holding pipes and lets their parents reap them',
    async () => {
      await withNodeFixture(async (fixture) => {
        const script = await fixture.script(`
process.on('SIGTERM', () => fs.writeFileSync(root + '/' + role + '-terminated', 'yes'));
if (role === 'grandchild') {
  const timer = setInterval(() => {}, 1000);
  process.on('SIGTERM', () => clearInterval(timer));
} else {
  spawn(process.execPath, [__filename, role === 'root' ? 'child' : 'grandchild'], { stdio: ['ignore', 'inherit', 'inherit'] });
  process.stdout.destroy();
  process.stderr.destroy();
}
`);
        const start = performance.now();
        const result = await captureProcess(process.execPath, [script], {
          cwd: fixture.cwd,
          timeoutMs: 700,
          maxOutputBytes: 1024,
        });
        expect(result.error).toMatchObject({ code: 'ETIMEDOUT' });
        expect(result.cleanupIncomplete).toBe(false);
        expect(result.durationMs).toBeGreaterThanOrEqual(700);
        expect(performance.now() - start).toBeLessThan(3000);
        expect((await fixture.processes()).map(({ role }) => role).sort()).toEqual(['child', 'grandchild', 'root']);
        for (const role of ['root', 'child', 'grandchild']) {
          expect(await readFile(join(fixture.cwd, `${role}-terminated`), 'utf8')).toBe('yes');
        }
        expect(await fixture.waitForExit()).toEqual([]);
      });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'keeps the deadline after the parent exits and kills resistant descendants retaining its pipes',
    async () => {
      await withNodeFixture(async (fixture) => {
        const script = await fixture.script(`
if (role === 'root') {
  spawn(process.execPath, [__filename, 'child'], { stdio: ['ignore', 'inherit', 'inherit'] }).unref();
} else {
  process.on('SIGTERM', () => fs.writeFileSync(root + '/' + role + '-terminated', 'ignored'));
  if (role === 'child') {
    spawn(process.execPath, [__filename, 'grandchild'], { stdio: ['ignore', 'inherit', 'inherit'] });
  }
  setInterval(() => {}, 1000);
}
`);
        const start = performance.now();
        const result = await captureProcess(process.execPath, [script], {
          cwd: fixture.cwd,
          timeoutMs: 700,
          maxOutputBytes: 1024,
        });
        expect(result.error).toMatchObject({ code: 'ETIMEDOUT' });
        expect(result.code).toBe(0);
        expect(result.signal).toBeNull();
        expect(result.durationMs).toBeGreaterThanOrEqual(900);
        expect(performance.now() - start).toBeLessThan(3000);
        expect(result.cleanupIncomplete).toBe(false);
        expect((await fixture.processes()).map(({ role }) => role).sort()).toEqual(['child', 'grandchild', 'root']);
        for (const role of ['child', 'grandchild']) {
          expect(await readFile(join(fixture.cwd, `${role}-terminated`), 'utf8')).toBe('ignored');
        }
        expect(await fixture.waitForExit()).toEqual([]);
      });
    },
  );

  it.each(['ENOENT', 'EACCES'])(
    'reports a safe %s spawn failure without retaining the executable path or raw cause',
    async (code) => {
      await withNodeFixture(async (fixture) => {
        const executable = code === 'ENOENT' ? join(fixture.cwd, CANARY) : await fixture.script('');
        if (code === 'EACCES') {
          await chmod(executable, 0o600);
        }
        const result = await captureProcess(executable, [], {
          cwd: fixture.cwd,
          timeoutMs: 3000,
          maxOutputBytes: 1024,
        });
        expect(result).toMatchObject({ code: null, stdout: '', stderr: '', cleanupIncomplete: false, error: { code } });
        expect(inspect(result.error, { showHidden: true })).not.toContain(CANARY);
        expect(inspect(result.error, { showHidden: true })).not.toContain(executable);
        expect(result.error).not.toHaveProperty('cause');
        expect(await fixture.processes()).toEqual([]);
      });
    },
  );

  it('returns nonzero status and useful bounded stdout/stderr diagnostics without leaking raw errors', async () => {
    await withNodeFixture(async (fixture) => {
      const script = await fixture.script(
        "process.stdout.write('o'.repeat(4096) + 'OUTPUT-END'); process.stderr.write('e'.repeat(4096) + 'ERROR-END'); process.exitCode = 23;",
      );
      const plan = resolveReleaseTagPlan({ cwd: fixture.cwd, timeoutMs: 3000, maxOutputBytes: 16384 });
      const error = await rejection(
        captureCommand(undefined, plan, process.execPath, [script], {
          label: 'release fixture',
          includeStdout: true,
        }),
      );
      expect(error.message).toMatch(/release fixture failed \(exit code 23; duration \d+ms/);
      expect(error.message).toContain('stdout: ...[truncated]');
      expect(error.message).toContain('stderr: ...[truncated]');
      expect(error.message).toContain('OUTPUT-END');
      expect(error.message).toContain('ERROR-END');
      expect(Buffer.byteLength(error.message)).toBeLessThan(2400);
      expect(error).not.toHaveProperty('cause');
      expect(await fixture.liveProcesses()).toEqual([]);
    });
  });

  it('supports the maximum timer value without wrapping into an immediate timeout', async () => {
    await withNodeFixture(async (fixture) => {
      const script = await fixture.script("setTimeout(() => process.stdout.write('finished'), 30);");
      const result = await captureProcess(process.execPath, [script], {
        cwd: fixture.cwd,
        timeoutMs: MAX_PROCESS_TIMEOUT_MS,
        maxOutputBytes: 1024,
      });
      expect(result).toMatchObject({ code: 0, stdout: 'finished' });
      expect(result.error).toBeUndefined();
      expect(await fixture.liveProcesses()).toEqual([]);
    });
  });
});

describe('custom process boundary', () => {
  it.each([
    undefined,
    null,
    'result',
    {},
    { stdout: Buffer.from('output'), stderr: '', code: 0 },
    { stdout: '', stderr: 1, code: 0 },
    { stdout: '', stderr: '', code: '0' },
    { stdout: '', stderr: '', code: 0.5 },
    { stdout: '', stderr: '', code: NaN },
    { stdout: '', stderr: '', code: 0, error: CANARY },
  ])('refuses malformed capture result %#', async (value) => {
    const plan = resolveReleaseTagPlan();
    const error = await rejection(captureCommand(fakeRunner(value), plan, 'git', [], { label: 'fixture' }));
    expect(error.message).toContain('runner.capture returned an invalid process result');
    expect(inspect(error, { showHidden: true })).not.toContain(CANARY);
    expect(error).not.toHaveProperty('cause');
  });

  it.each([0, 1])('checks combined UTF-8 bytes from a custom runner with exit code %i', async (code) => {
    const plan = resolveReleaseTagPlan({ maxOutputBytes: 31 });
    const runner = fakeRunner({ stdout: '🚀'.repeat(5), stderr: '界'.repeat(4), code });
    const error = await rejection(captureCommand(runner, plan, 'git', [], { label: 'fixture' }));
    expect(error.message).toContain('produced 32 bytes, exceeding the 31-byte output limit');
    expect(error.message).not.toContain('🚀');
  });

  it('allows the exact combined byte limit and explicit accepted status codes', async () => {
    const plan = resolveReleaseTagPlan({ maxOutputBytes: 7 });
    const result = await captureCommand(fakeRunner({ stdout: '🚀', stderr: '界', code: 1 }), plan, 'git', [], {
      label: 'fixture',
      acceptedExitCodes: [0, 1],
    });
    expect(result).toEqual({ stdout: '🚀', stderr: '界', code: 1 });
  });

  it('rejects late custom success while making the custom cancellation responsibility explicit', async () => {
    const runner = fakeRunner(ok());
    runner.capture = async () => {
      await delay(40);
      return ok();
    };
    const error = await rejection(
      captureCommand(runner, resolveReleaseTagPlan({ timeoutMs: 5 }), 'git', [], { label: 'fixture' }),
    );
    expect(error.message).toContain('exceeded the 5ms deadline');
    expect(error.message).toContain('custom runners own cancellation');
  });

  it.each([CANARY, Object.assign(new Error(CANARY), { code: CANARY, cause: new Error(CANARY) })])(
    'does not retain rejected runner messages, strings, codes, or causes',
    async (failure) => {
      const runner = fakeRunner(ok());
      runner.capture = async () => {
        throw failure;
      };
      const error = await rejection(captureCommand(runner, resolveReleaseTagPlan(), 'git', [], { label: 'fixture' }));
      expect(error.message).toContain('process transport failed (EPROCESS)');
      expect(inspect(error, { showHidden: true, depth: null })).not.toContain(CANARY);
      expect(error).not.toHaveProperty('cause');
    },
  );

  it('redacts bounded diagnostics through the supplied secret seam and configured token environment', async () => {
    vi.stubEnv('RELEASE_TAG_PROCESS_TEST_TOKEN', CANARY);
    const plan = resolveReleaseTagPlan({ githubTokenEnv: 'RELEASE_TAG_PROCESS_TEST_TOKEN' });
    const runner = fakeRunner({ stdout: CANARY, stderr: 'https://user:password@host.invalid/ other-secret', code: 9 });
    const error = await rejection(
      captureCommand(runner, plan, 'git', [], {
        label: 'fixture',
        includeStdout: true,
        secrets: ['other-secret'],
      }),
    );
    expect(error.message).toContain('exit code 9');
    expect(error.message).toContain('[redacted]');
    for (const secret of [CANARY, 'user:password', 'other-secret']) {
      expect(inspect(error, { showHidden: true })).not.toContain(secret);
    }
  });

  it.each([0, -1, 0.5, NaN, Infinity, MAX_PROCESS_TIMEOUT_MS + 1, Number.MAX_SAFE_INTEGER])(
    'rejects unsupported direct-stage timeout %s before invoking a custom runner',
    async (timeoutMs) => {
      const runner = fakeRunner(ok());
      const capture = vi.spyOn(runner, 'capture');
      const plan = { ...resolveReleaseTagPlan(), timeoutMs };
      await expect(captureCommand(runner, plan, 'git', [], { label: 'fixture' })).rejects.toThrow(
        /timeoutMs.*2147483647/,
      );
      expect(capture).not.toHaveBeenCalled();
    },
  );
});

describe('stage process-boundary plumbing', () => {
  it.each(['Git', 'availability', 'release'])(
    'actually bounds the default %s child and stops subsequent work',
    async (stage) => {
      vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
      vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
      vi.stubEnv('GITHUB_REPOSITORY', undefined);
      await withGitFixture(async (git) => {
        await withNodeFixture(async (fixture) => {
          const script = await fixture.script(`
if (process.env.GIT_TERMINAL_PROMPT !== '0') throw new Error('terminal prompts were enabled');
fs.writeFileSync(root + '/args.json', JSON.stringify(process.argv.slice(2)));
process.on('SIGTERM', () => fs.writeFileSync(root + '/terminated', 'ignored'));
setInterval(() => {}, 1000);
`);
          await chmod(script, 0o700);
          vi.stubEnv('PATH', `${fixture.cwd}${delimiter}${process.env.PATH}`);
          const before = await snapshotGitFixture(git);
          const plan = resolveReleaseTagPlan({
            cwd: git.cwd,
            baseBranch: 'main',
            timeoutMs: 700,
            gitExecutable: stage === 'Git' ? script : 'git',
            releaseCommand: stage === 'availability' ? basename(script) : script,
            only: ['determine', 'release'],
          });
          const start = performance.now();
          const operation =
            stage === 'Git' ? determineNextTag({ plan }) : runReleaseBranch({ plan, determined: DETERMINED });
          const error = await rejection(operation);
          expect(error.message).toContain('timed out after 700ms (ETIMEDOUT)');
          expect(performance.now() - start).toBeLessThan(3500);
          expect(error).not.toHaveProperty('cause');
          const args = JSON.parse(await readFile(join(fixture.cwd, 'args.json'), 'utf8'));
          expect(args).toEqual(
            stage === 'Git'
              ? ['describe', '--tags', '--abbrev=0']
              : stage === 'availability'
                ? ['--version']
                : ['1.2.3', '--ci'],
          );
          if (stage === 'release') {
            expect(git.remoteGit(['rev-parse', 'refs/heads/changelog/1.2.3']).trim()).toBe(git.sourceCommit);
            expect(git.git(['rev-parse', 'refs/heads/main']).trim()).toBe(git.sourceCommit);
            expect(git.git(['tag', '--list'])).toBe('');
          } else {
            expect(await snapshotGitFixture(git)).toEqual(before);
          }
          expect(await fixture.waitForExit()).toEqual([]);
        });
      });
    },
  );

  it.each([
    'describe',
    'log',
    'config probe',
    'auth probe',
    'base inference',
    'availability',
    'source status',
    'push',
    'release',
    'tag read',
  ])('enforces the same output bound at %s and stops the stage', async (stage) => {
    for (const key of [
      'GITHUB_REF_NAME',
      'GITHUB_REF_TYPE',
      'GITHUB_REF',
      'GITHUB_REPOSITORY',
      'GIT_SSH',
      'GIT_SSH_COMMAND',
    ]) {
      vi.stubEnv(key, undefined);
    }
    const matches = (args: ReadonlyArray<string>): boolean => {
      switch (stage) {
        case 'describe':
          return args[0] === 'describe';
        case 'log':
          return args[0] === 'log';
        case 'config probe':
          return args[0] === 'config' && args[1] === '--get';
        case 'auth probe':
          return args[0] === 'ls-remote';
        case 'base inference':
          return args[0] === 'symbolic-ref' && args[1] === '--short';
        case 'availability':
          return args[0] === '--version';
        case 'source status':
          return args[1] === 'status';
        case 'push':
          return args[0] === 'push';
        case 'release':
          return args[1] === '--ci';
        default:
          return args[0] === 'tag';
      }
    };
    const runner = createReleaseRunner({ capture: (_exe, args) => (matches(args) ? ok('x'.repeat(257)) : undefined) });
    const plan = resolveReleaseTagPlan({
      cwd: '/fake/workdir',
      baseBranch: stage === 'base inference' ? undefined : 'main',
      releaseCommand: 'release-it',
      timeoutMs: 1234,
      maxOutputBytes: 256,
      only: ['determine', 'release'],
      runner,
    });
    const operation =
      stage === 'describe' || stage === 'log'
        ? determineNextTag({ plan })
        : stage === 'config probe' || stage === 'auth probe'
          ? runPreflight({ plan })
          : runReleaseBranch({ plan, determined: DETERMINED });
    await expect(operation).rejects.toThrow('256-byte output limit');
    expect(matches(runner.captures[runner.captures.length - 1].args)).toBe(true);
    for (const call of runner.captures) {
      expect(call.options).toMatchObject({
        timeoutMs: 1234,
        maxOutputBytes: 256,
        stdio: 'pipe',
        env: { GIT_TERMINAL_PROMPT: '0' },
      });
    }
  });
});
