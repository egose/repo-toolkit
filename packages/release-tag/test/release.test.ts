import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapturingProcessRunner, ProcessCaptureResult } from '@repo-toolkit/publish-package';

import { resolveReleaseTagPlan, runReleaseBranch, type DeterminedTag, type ReleaseTagOptions } from '../src/index';
import { createReleaseRunner, failed, ok, RELEASED_HEAD, SOURCE_COMMIT } from './release-fixture';

vi.mock('node:fs/promises', { spy: true });

const FAKE_CWD = '/fake/workdir';
const FAKE_TIMEOUT_MS = 1234;
const BRANCH_GUARD = 'This workflow must be run on a branch, not a tag.';
const RELEASE_REF = 'refs/heads/changelog/1.2.3';

function makePlan(overrides: ReleaseTagOptions = {}) {
  return resolveReleaseTagPlan({
    cwd: FAKE_CWD,
    timeoutMs: FAKE_TIMEOUT_MS,
    releaseCommand: 'release-it',
    ...overrides,
  });
}

function testDetermined(overrides: Partial<DeterminedTag> = {}): DeterminedTag {
  return {
    version: '1.2.3',
    tagVersion: 'v1.2.3',
    bump: 'patch',
    lastTag: 'v1.2.2',
    manual: false,
    noChanges: false,
    ...overrides,
  };
}

function spawnError(code: string): ProcessCaptureResult {
  return { stdout: '', stderr: '', code: null, error: Object.assign(new Error('private transport detail'), { code }) };
}

function captureOptions(cwd = FAKE_CWD, timeoutMs = FAKE_TIMEOUT_MS) {
  return { cwd, timeoutMs, maxOutputBytes: 1048576, stdio: 'pipe', env: { GIT_TERMINAL_PROMPT: '0' } };
}

function expectNoMutations(runner: ReturnType<typeof createReleaseRunner>): void {
  expect(runner.runs).toEqual([]);
  expect(runner.captures.filter((call) => ['config', 'checkout', 'push', 'branch'].includes(call.args[0]))).toEqual([]);
}

async function withTempDir(fn: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await fs.mkdtemp(join(tmpdir(), 'release-tag-unit-'));
  try {
    await fn(cwd);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ['GITHUB_REF_NAME', 'GITHUB_REF_TYPE', 'GITHUB_REF', 'GITHUB_REPOSITORY']) {
    vi.stubEnv(key, undefined);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('runReleaseBranch base branch resolution', () => {
  it('prefers explicit baseBranch over env and inference while verifying the checkout', async () => {
    vi.stubEnv('GITHUB_REF_NAME', 'env-branch');
    const runner = createReleaseRunner({ tagMessage: 'msg\n' });
    const plan = makePlan({ baseBranch: 'main', skipRelease: true });
    const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
    expect(result.baseBranch).toBe('main');
    expect(result.releaseBranch).toBe('changelog/1.2.3');
    expect(result.prTitle).toBe('chore(release): release candidate v1.2.3');
    expect(runner.captures.map((call) => call.args)).not.toContainEqual(['symbolic-ref', '--short', 'HEAD']);
    expect(runner.captures.map((call) => call.args)).toContainEqual(['symbolic-ref', '--quiet', 'HEAD']);
  });

  it('falls back to GITHUB_REF_NAME when explicit is missing', async () => {
    vi.stubEnv('GITHUB_REF_NAME', 'develop');
    const runner = createReleaseRunner({ baseBranch: 'develop' });
    const result = await runReleaseBranch({
      plan: makePlan({ skipRelease: true }),
      determined: testDetermined(),
      runner,
    });
    expect(result.baseBranch).toBe('develop');
    expect(runner.captures.map((call) => call.args)).not.toContainEqual(['symbolic-ref', '--short', 'HEAD']);
  });

  it.each(['  feature/trim  ', '   ', 'main\n'])(
    'rejects whitespace in GITHUB_REF_NAME %j without silently changing the ref',
    async (value) => {
      vi.stubEnv('GITHUB_REF_NAME', value);
      const runner = createReleaseRunner();
      await expect(
        runReleaseBranch({ plan: makePlan({ skipRelease: true }), determined: testDetermined(), runner }),
      ).rejects.toThrow(/GITHUB_REF_NAME/);
      expect(runner.captures).toEqual([]);
    },
  );

  it('ignores empty GITHUB_REF_NAME and reads git symbolic-ref', async () => {
    vi.stubEnv('GITHUB_REF_NAME', '');
    const runner = createReleaseRunner({ baseBranch: 'git-branch' });
    const result = await runReleaseBranch({
      plan: makePlan({ skipRelease: true }),
      determined: testDetermined(),
      runner,
    });
    expect(result.baseBranch).toBe('git-branch');
    expect(runner.captures[0]).toEqual({
      executable: 'git',
      args: ['symbolic-ref', '--short', 'HEAD'],
      options: captureOptions(),
    });
  });

  it.each(['  feature/first\n', 'feature/first \n', 'feature/first\nsecond\n', 'main\n\n'])(
    'rejects padded and multiline symbolic-ref output %j before mutations',
    async (stdout) => {
      const runner = createReleaseRunner({ capture: () => ok(stdout) });
      await expect(
        runReleaseBranch({ plan: makePlan({ skipRelease: true }), determined: testDetermined(), runner }),
      ).rejects.toThrow(/baseBranch/);
      expect(runner.captures).toHaveLength(1);
      expectNoMutations(runner);
    },
  );

  it('rejects detached HEAD with the branch guard and stderr tail', async () => {
    const runner = createReleaseRunner({ capture: () => failed('fatal: ref HEAD is not a symbolic ref\n', 128) });
    const operation = runReleaseBranch({ plan: makePlan({ skipRelease: true }), determined: testDetermined(), runner });
    await expect(operation).rejects.toThrow(
      `${BRANCH_GUARD} Check out the intended base branch and provide --base-branch.`,
    );
    await expect(operation).rejects.toThrow('exit code 128');
    await expect(operation).rejects.toThrow('stderr: fatal: ref HEAD is not a symbolic ref');
    expectNoMutations(runner);
  });

  it('rejects detached HEAD spawn errors with the branch guard', async () => {
    const runner = createReleaseRunner({ capture: () => spawnError('ENOENT') });
    const operation = runReleaseBranch({ plan: makePlan({ skipRelease: true }), determined: testDetermined(), runner });
    await expect(operation).rejects.toThrow(BRANCH_GUARD);
    await expect(operation).rejects.toThrow('process transport failed (ENOENT)');
    expectNoMutations(runner);
  });

  it('truncates long detached-HEAD stderr tails', async () => {
    const runner = createReleaseRunner({ capture: () => failed(`${'x'.repeat(5000)}TAIL`, 128) });
    const operation = runReleaseBranch({ plan: makePlan({ skipRelease: true }), determined: testDetermined(), runner });
    await expect(operation).rejects.toThrow(BRANCH_GUARD);
    await expect(operation).rejects.toThrow('...[truncated]');
    await expect(operation).rejects.toThrow('TAIL');
    await expect(operation).rejects.not.toThrow('x'.repeat(5000));
  });

  it.each(['v1.2.3', 'refs/tags/v1.2.3', 'HEAD', 'refs/tags/release'])(
    'rejects tag-shaped explicit base %j',
    async (baseBranch) => {
      const runner = createReleaseRunner();
      const plan = { ...makePlan({ skipRelease: true }), baseBranch };
      await expect(runReleaseBranch({ plan, determined: testDetermined(), runner })).rejects.toThrow(BRANCH_GUARD);
      expect(runner.captures).toEqual([]);
    },
  );

  it.each(['v2.0.0', 'refs/tags/v2.0.0', 'HEAD'])('rejects tag-shaped env base %j', async (refName) => {
    vi.stubEnv('GITHUB_REF_NAME', refName);
    const runner = createReleaseRunner();
    await expect(
      runReleaseBranch({ plan: makePlan({ skipRelease: true }), determined: testDetermined(), runner }),
    ).rejects.toThrow(BRANCH_GUARD);
    expect(runner.captures).toEqual([]);
  });

  it.each(['v1.2.3\n', 'refs/tags/v1.2.3\n', 'HEAD\n', '\n'])(
    'rejects tag-shaped git symbolic-ref output %j',
    async (stdout) => {
      const runner = createReleaseRunner({ capture: () => ok(stdout) });
      await expect(
        runReleaseBranch({ plan: makePlan({ skipRelease: true }), determined: testDetermined(), runner }),
      ).rejects.toThrow(BRANCH_GUARD);
      expect(runner.captures).toHaveLength(1);
    },
  );

  it('accepts branch names that start with v but are not tags', async () => {
    const runner = createReleaseRunner({ baseBranch: 'version-next' });
    const plan = makePlan({ baseBranch: 'version-next', skipRelease: true });
    expect((await runReleaseBranch({ plan, determined: testDetermined(), runner })).baseBranch).toBe('version-next');
  });
});

describe('runReleaseBranch author config', () => {
  it('configures the author with explicit args after read validations using cwd and timeout', async () => {
    const runner = createReleaseRunner();
    const plan = makePlan({
      baseBranch: 'main',
      skipRelease: true,
      gitUserName: 'Release Bot',
      gitUserEmail: 'release@example.com',
    });
    await runReleaseBranch({ plan, determined: testDetermined(), runner });
    const configs = runner.captures.filter((call) => call.args[0] === 'config');
    expect(configs.map((call) => call.args)).toEqual([
      ['config', 'user.name', 'Release Bot'],
      ['config', 'user.email', 'release@example.com'],
    ]);
    for (const call of runner.captures) {
      expect(call.executable).toBe('git');
      expect(call.options).toEqual(captureOptions());
    }
    const configIndex = runner.captures.indexOf(configs[0]);
    expect(runner.captures.slice(0, configIndex).map((call) => call.args[0])).toContain('ls-remote');
    expect(runner.captures.slice(0, configIndex).map((call) => call.args[1])).toContain('status');
  });

  it('omits commit.gpgsign when signCommit is false', async () => {
    const runner = createReleaseRunner();
    await runReleaseBranch({
      plan: makePlan({ baseBranch: 'main', skipRelease: true }),
      determined: testDetermined(),
      runner,
    });
    expect(runner.captures.map((call) => call.args)).not.toContainEqual(['config', 'commit.gpgsign', 'true']);
  });

  it('sets commit.gpgsign when signCommit is true without signingkey or gnupg writes', async () => {
    await withTempDir(async (homeDir) => {
      vi.stubEnv('HOME', homeDir);
      const runner = createReleaseRunner();
      await runReleaseBranch({
        plan: makePlan({ baseBranch: 'main', skipRelease: true, signCommit: true }),
        determined: testDetermined(),
        runner,
      });
      expect(runner.captures.map((call) => call.args)).toContainEqual(['config', 'commit.gpgsign', 'true']);
      expect(runner.captures.some((call) => call.args.includes('user.signingkey'))).toBe(false);
      expect(await fs.readdir(homeDir)).toEqual([]);
    });
  });

  it.each(['user.name', 'user.email', 'commit.gpgsign'])('stops before checkout when %s config fails', async (key) => {
    const runner = createReleaseRunner({
      capture: (_exe, args) => (args[0] === 'config' && args[1] === key ? failed('fatal: config locked') : undefined),
    });
    const plan = makePlan({ baseBranch: 'main', skipRelease: true, signCommit: true });
    await expect(runReleaseBranch({ plan, determined: testDetermined(), runner })).rejects.toThrow(
      `git config ${key} failed`,
    );
    expect(runner.captures.some((call) => ['checkout', 'push'].includes(call.args[0]))).toBe(false);
    expect(runner.runs).toEqual([]);
  });
});

describe('runReleaseBranch safe branch preparation', () => {
  it('creates explicitly from the verified source and pushes only the release ref with an absence lease', async () => {
    const runner = createReleaseRunner({ tagMessage: 'tag body\n' });
    const plan = makePlan({ baseBranch: 'main', skipRelease: true });
    const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
    expect(result).toEqual({
      baseBranch: 'main',
      releaseBranch: 'changelog/1.2.3',
      releaseRan: false,
      skippedReason: 'skipped via skipRelease',
      tagMessage: 'tag body',
      prTitle: 'chore(release): release candidate v1.2.3',
    });
    const args = runner.captures.map((call) => call.args);
    expect(args).toContainEqual(['checkout', '-b', 'changelog/1.2.3', SOURCE_COMMIT]);
    expect(args.filter((call) => call[0] === 'push')).toEqual([
      [
        'push',
        '--no-follow-tags',
        `--force-with-lease=${RELEASE_REF}:`,
        '--set-upstream',
        'origin',
        `${RELEASE_REF}:${RELEASE_REF}`,
      ],
    ]);
    expect(args.some((call) => call.includes('--delete') || call.includes('-D') || call.includes('--force'))).toBe(
      false,
    );
    expect(result.releasedHead).toBeUndefined();
  });

  it.each(['local', 'remote'])(
    'refuses %s collisions before configuration unless resetReleaseBranch is explicitly true',
    async (location) => {
      const runner = createReleaseRunner({
        capture: (_exe, args) => {
          if (location === 'local' && args[0] === 'for-each-ref' && args[2] === RELEASE_REF) {
            return ok(`${RELEASE_REF}\t${RELEASED_HEAD}\t\n`);
          }
          if (location === 'remote' && args[0] === 'ls-remote' && args.includes(RELEASE_REF)) {
            return ok(`${RELEASED_HEAD}\t${RELEASE_REF}\n`);
          }
          return undefined;
        },
      });
      const plan = makePlan({ baseBranch: 'main', skipRelease: true });
      await expect(runReleaseBranch({ plan, determined: testDetermined(), runner })).rejects.toThrow(
        /already exists.*resetReleaseBranch: true/,
      );
      expectNoMutations(runner);
    },
  );

  it.each(['symbolic-ref', 'for-each-ref', 'ls-remote', 'rev-parse', '--no-optional-locks'])(
    'propagates unexpected %s failures before any mutation',
    async (command) => {
      const runner = createReleaseRunner({
        capture: (_exe, args) => (args[0] === command ? spawnError('EACCES') : undefined),
      });
      const plan = makePlan({ baseBranch: 'main', skipRelease: true });
      await expect(runReleaseBranch({ plan, determined: testDetermined(), runner })).rejects.toThrow(
        'process transport failed (EACCES)',
      );
      expectNoMutations(runner);
    },
  );

  it.each(['checkout', 'push'])('stops rather than ignoring a %s failure', async (command) => {
    const runner = createReleaseRunner({
      capture: (_exe, args) => (args[0] === command ? failed('controlled mutation failure') : undefined),
    });
    const plan = makePlan({ baseBranch: 'main' });
    await expect(runReleaseBranch({ plan, determined: testDetermined(), runner })).rejects.toThrow(
      'controlled mutation failure',
    );
    expect(runner.runs).toEqual([]);
    expect(runner.captures[runner.captures.length - 1].args[0]).toBe(command);
  });

  it.each(['abc123', `${SOURCE_COMMIT}\n\n`, '0'.repeat(40), 'A'.repeat(40)])(
    'refuses invalid commit output %j before configuration',
    async (stdout) => {
      const runner = createReleaseRunner({
        capture: (_exe, args) => (args[0] === 'rev-parse' ? ok(stdout) : undefined),
      });
      await expect(
        runReleaseBranch({
          plan: makePlan({ baseBranch: 'main', skipRelease: true }),
          determined: testDetermined(),
          runner,
        }),
      ).rejects.toThrow(/Git object ID/);
      expectNoMutations(runner);
    },
  );

  it.each([
    'unexpected\n',
    `${SOURCE_COMMIT}\trefs/heads/other\n`,
    `${SOURCE_COMMIT}\t${RELEASE_REF}\n${SOURCE_COMMIT}\t${RELEASE_REF}\n`,
  ])('refuses malformed or ambiguous remote observations %j', async (stdout) => {
    const runner = createReleaseRunner({
      capture: (_exe, args) => (args[0] === 'ls-remote' ? ok(stdout) : undefined),
    });
    await expect(
      runReleaseBranch({
        plan: makePlan({ baseBranch: 'main', skipRelease: true }),
        determined: testDetermined(),
        runner,
      }),
    ).rejects.toThrow(/git ls-remote.*(unexpected|multiple)/);
    expectNoMutations(runner);
  });
});

describe('runReleaseBranch release availability', () => {
  it.each(['missing', 'not executable', 'directory'])(
    'fails when a path release command is %s before Git mutations',
    async (kind) => {
      await withTempDir(async (cwd) => {
        if (kind === 'not executable') {
          await fs.writeFile(join(cwd, 'release-it'), '#!/usr/bin/env node\n', { mode: 0o600 });
        }
        const runner = createReleaseRunner();
        const plan = makePlan({
          cwd,
          baseBranch: 'main',
          releaseCommand: kind === 'directory' ? './' : './release-it',
        });
        await expect(runReleaseBranch({ plan, determined: testDetermined(), runner })).rejects.toThrow(
          /not available.*Install.*skipRelease/,
        );
        expect(runner.captures).toEqual([]);
        expectNoMutations(runner);
      });
    },
  );

  it.each(['./release-it', './node_modules/.bin/release-it'])(
    'resolves executable path %s against cwd',
    async (releaseCommand) => {
      await withTempDir(async (cwd) => {
        await fs.mkdir(join(cwd, 'node_modules', '.bin'), { recursive: true });
        await fs.writeFile(join(cwd, releaseCommand), '#!/usr/bin/env node\n', { mode: 0o700 });
        const runner = createReleaseRunner({ tagMessage: 'made\n' });
        const result = await runReleaseBranch({
          plan: makePlan({ cwd, baseBranch: 'main', releaseCommand }),
          determined: testDetermined(),
          runner,
        });
        expect(result.releaseRan).toBe(true);
        expect(result.releasedHead).toBe(RELEASED_HEAD);
        expect(result.tagMessage).toBe('made');
        expect(runner.runs).toEqual([
          { executable: releaseCommand, args: ['1.2.3', '--ci'], options: captureOptions(cwd) },
        ]);
      });
    },
  );

  it.each([failed('command failed'), spawnError('ENOENT'), spawnError('EACCES')])(
    'fails a bare-name availability probe %j before config or checkout',
    async (result) => {
      const runner = createReleaseRunner({ capture: (_exe, args) => (args[0] === '--version' ? result : undefined) });
      await expect(
        runReleaseBranch({ plan: makePlan({ baseBranch: 'main' }), determined: testDetermined(), runner }),
      ).rejects.toThrow(/not available.*--version probe failed/);
      expect(runner.captures.map((call) => call.args)).toEqual([['--version']]);
      expectNoMutations(runner);
    },
  );

  it.each([
    [60000, 10000],
    [500, 500],
  ])('caps a %i ms bare-name probe timeout at %i ms', async (timeoutMs, expected) => {
    const runner = createReleaseRunner();
    await runReleaseBranch({ plan: makePlan({ baseBranch: 'main', timeoutMs }), determined: testDetermined(), runner });
    expect(runner.captures[0]).toEqual({
      executable: 'release-it',
      args: ['--version'],
      options: captureOptions(FAKE_CWD, expected),
    });
  });

  it('does not probe any release command or tag existence for deliberate skipRelease', async () => {
    const runner = createReleaseRunner();
    await runReleaseBranch({
      plan: makePlan({ baseBranch: 'main', skipRelease: true }),
      determined: testDetermined(),
      runner,
    });
    expect(runner.runs).toEqual([]);
    expect(runner.captures.every((call) => call.executable === 'git')).toBe(true);
    expect(runner.captures.some((call) => call.args.includes('refs/tags/v1.2.3'))).toBe(false);
  });
});

describe('runReleaseBranch release execution', () => {
  it('runs version plus ci plus releaseArgs without gpg-sign', async () => {
    const runner = createReleaseRunner();
    const plan = makePlan({
      baseBranch: 'main',
      releaseArgs: ['--no-npm', '--dry-run', '--config=a,b'],
      signCommit: false,
    });
    const determined = testDetermined({ version: '2.0.0', tagVersion: 'v2.0.0' });
    const result = await runReleaseBranch({ plan, determined, runner });
    expect(result.releaseRan).toBe(true);
    expect(result.releasedHead).toBe(RELEASED_HEAD);
    expect(runner.runs[0].args).toEqual(['2.0.0', '--ci', '--no-npm', '--dry-run', '--config=a,b']);
  });

  it('appends gpg-sign last when signCommit is true and verifies the resulting head', async () => {
    const runner = createReleaseRunner();
    const plan = makePlan({ baseBranch: 'main', releaseArgs: ['--no-npm'], signCommit: true });
    const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
    expect(runner.runs[0].args).toEqual(['1.2.3', '--ci', '--no-npm', '--git.commitArgs=--gpg-sign']);
    expect(runner.captures.map((call) => call.args)).toContainEqual(['config', 'commit.gpgsign', 'true']);
    expect(result.releasedHead).toBe(RELEASED_HEAD);
  });

  it('throws with command label and duration when the release command fails and stops the final push', async () => {
    const runner = createReleaseRunner({
      release: () => failed('release-it exploded'),
    });
    await expect(
      runReleaseBranch({ plan: makePlan({ baseBranch: 'main' }), determined: testDetermined(), runner }),
    ).rejects.toThrow(
      /release command "release-it" failed \(exit code 1; duration \d+ms; stderr: release-it exploded\)/,
    );
    expect(runner.runs).toHaveLength(1);
    expect(runner.captures.filter((call) => call.args[0] === 'push')).toHaveLength(1);
    expect(runner.captures.some((call) => call.args[0] === 'tag')).toBe(false);
  });

  it('requires a capturing runner', async () => {
    const runner = { run() {}, runShell() {} } as unknown as CapturingProcessRunner;
    await expect(
      runReleaseBranch({
        plan: makePlan({ baseBranch: 'main', skipRelease: true }),
        determined: testDetermined(),
        runner,
      }),
    ).rejects.toThrow(/CapturingProcessRunner/);
  });

  it('prefers the explicit runner over the plan runner', async () => {
    const planRunner = createReleaseRunner({
      capture: () => {
        throw new Error('plan runner must not be used');
      },
    });
    const runner = createReleaseRunner();
    const plan = makePlan({ baseBranch: 'main', skipRelease: true, runner: planRunner });
    expect((await runReleaseBranch({ plan, determined: testDetermined(), runner })).baseBranch).toBe('main');
    expect(planRunner.captures).toEqual([]);
  });

  it('rejects non-object inputs', async () => {
    await expect(runReleaseBranch(undefined as never)).rejects.toThrow(/input must be an object/);
    await expect(runReleaseBranch({ plan: null, determined: testDetermined() } as never)).rejects.toThrow(
      /plan must be an object/,
    );
    await expect(runReleaseBranch({ plan: makePlan(), determined: null } as never)).rejects.toThrow(
      /determined must be an object/,
    );
  });
});

describe('runReleaseBranch push and tag read', () => {
  it('pushes the verified released head with an explicit lease after reading the tag message', async () => {
    const runner = createReleaseRunner({ tagMessage: 'Release 1.2.3\n\nBody\r\n\n' });
    const result = await runReleaseBranch({
      plan: makePlan({ baseBranch: 'main' }),
      determined: testDetermined(),
      runner,
    });
    expect(result.tagMessage).toBe('Release 1.2.3\n\nBody');
    expect(result.releasedHead).toBe(RELEASED_HEAD);
    const last = runner.captures[runner.captures.length - 1];
    expect(last.args).toEqual([
      'push',
      '--no-follow-tags',
      `--force-with-lease=${RELEASE_REF}:${SOURCE_COMMIT}`,
      'origin',
      `${RELEASED_HEAD}:${RELEASE_REF}`,
    ]);
    expect(runner.captures[runner.captures.length - 2].args).toEqual(['tag', '-l', '--format=%(contents)', 'v1.2.3']);
  });

  it.each(['', '\n', '\r\n'])('tolerates an empty tag message %j', async (tagMessage) => {
    const runner = createReleaseRunner({ tagMessage });
    const result = await runReleaseBranch({
      plan: makePlan({ baseBranch: 'main', skipRelease: true }),
      determined: testDetermined(),
      runner,
    });
    expect(result.tagMessage).toBe('');
    expect(result.prTitle).toBe('chore(release): release candidate v1.2.3');
  });

  it('propagates final push failures with lease guidance', async () => {
    const runner = createReleaseRunner({
      capture: (_exe, args) =>
        args[0] === 'push' && !args.includes('--set-upstream') ? failed('push rejected by remote') : undefined,
    });
    const operation = runReleaseBranch({
      plan: makePlan({ baseBranch: 'main' }),
      determined: testDetermined(),
      runner,
    });
    await expect(operation).rejects.toThrow(/git push origin changelog\/1.2.3 with an explicit lease/);
    await expect(operation).rejects.toThrow('push rejected by remote');
  });

  it('propagates tag-read spawn failures before the final push', async () => {
    const runner = createReleaseRunner({
      capture: (_exe, args) => (args[0] === 'tag' ? spawnError('ENOENT') : undefined),
    });
    await expect(
      runReleaseBranch({ plan: makePlan({ baseBranch: 'main' }), determined: testDetermined(), runner }),
    ).rejects.toThrow('git tag -l --format=%(contents) v1.2.3 failed');
    expect(runner.captures.filter((call) => call.args[0] === 'push')).toHaveLength(1);
  });

  it.each([undefined, 'custom/rc'])(
    'uses releaseBranch %j over the derived template when supplied',
    async (releaseBranch) => {
      const runner = createReleaseRunner();
      const plan = makePlan({ baseBranch: 'main', releaseBranch, skipRelease: true });
      const determined = testDetermined({ version: '4.5.6', tagVersion: 'v4.5.6' });
      const result = await runReleaseBranch({ plan, determined, runner });
      expect(result.releaseBranch).toBe(releaseBranch ?? 'changelog/4.5.6');
      expect(runner.captures.map((call) => call.args)).toContainEqual([
        'checkout',
        '-b',
        result.releaseBranch,
        SOURCE_COMMIT,
      ]);
      expect(runner.captures.map((call) => call.args)).toContainEqual(['tag', '-l', '--format=%(contents)', 'v4.5.6']);
    },
  );
});

describe('runReleaseBranch no-I/O paths', () => {
  it.each([{ dryRun: true }, { only: ['determine', 'pr'] }, { only: [], skipRelease: true }])(
    'returns a skipped result with zero process, file, or network calls for %j',
    async (overrides) => {
      const access = vi.mocked(fs.access);
      const stat = vi.mocked(fs.stat);
      const readFile = vi.mocked(fs.readFile);
      const fetchFn = vi.fn<typeof fetch>();
      const runner = createReleaseRunner({
        capture: () => {
          throw new Error('must not capture');
        },
      });
      const plan = makePlan({
        baseBranch: 'main',
        releaseCommand: './must-not-be-read',
        githubTokenFile: 'must-not-be-read',
        fetchFn,
        ...overrides,
      });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result).toEqual({
        baseBranch: 'main',
        releaseBranch: 'changelog/1.2.3',
        releaseRan: false,
        skippedReason: plan.dryRun ? 'dry-run' : 'stage not selected',
        tagMessage: '',
        prTitle: 'chore(release): release candidate v1.2.3',
      });
      expect(runner.captures).toEqual([]);
      expect(runner.runs).toEqual([]);
      expect(access).not.toHaveBeenCalled();
      expect(stat).not.toHaveBeenCalled();
      expect(readFile).not.toHaveBeenCalled();
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it.each([{ dryRun: true }, { only: ['determine'] }])(
    'resolves the env base without Git for %j',
    async (overrides) => {
      vi.stubEnv('GITHUB_REF_NAME', 'env-base');
      const runner = createReleaseRunner();
      const result = await runReleaseBranch({ plan: makePlan(overrides), determined: testDetermined(), runner });
      expect(result.baseBranch).toBe('env-base');
      expect(runner.captures).toEqual([]);
      expect(runner.runs).toEqual([]);
    },
  );

  it.each([{ dryRun: true }, { only: ['determine'] }])(
    'requires an explicit or env base before any I/O for %j',
    async (overrides) => {
      const runner = createReleaseRunner();
      await expect(
        runReleaseBranch({ plan: makePlan(overrides), determined: testDetermined(), runner }),
      ).rejects.toThrow(/without git: provide explicit baseBranch or GITHUB_REF_NAME/);
      expect(runner.captures).toEqual([]);
      expect(runner.runs).toEqual([]);
    },
  );

  it('rejects tag bases in dry-run without invocations', async () => {
    const runner = createReleaseRunner();
    const plan = { ...makePlan({ dryRun: true }), baseBranch: 'v1.2.3' };
    await expect(runReleaseBranch({ plan, determined: testDetermined(), runner })).rejects.toThrow(BRANCH_GUARD);
    expect(runner.captures).toEqual([]);
  });
});
