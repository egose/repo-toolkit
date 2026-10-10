import { mkdtemp, rm, writeFile, chmod, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  CapturingProcessRunner,
  ProcessCaptureOptions,
  ProcessCaptureResult,
  ProcessRunOptions,
} from '@repo-toolkit/publish-package';

import { resolveReleaseTagPlan, runReleaseBranch, type DeterminedTag, type ReleaseTagPlan } from '../src/index';

const FAKE_CWD = '/fake/workdir';
const FAKE_TIMEOUT_MS = 1234;
const BRANCH_GUARD = 'This workflow must be run on a branch, not a tag.';

interface RecordedCapture {
  executable: string;
  args: ReadonlyArray<string>;
  options: ProcessCaptureOptions;
}

interface RecordedRun {
  executable: string;
  args: ReadonlyArray<string>;
  options: ProcessRunOptions;
}

type CaptureHandler = (
  executable: string,
  args: ReadonlyArray<string>,
  options: ProcessCaptureOptions,
) => ProcessCaptureResult | Promise<ProcessCaptureResult>;

type RunHandler = (executable: string, args: ReadonlyArray<string>, options: ProcessRunOptions) => void;

type FakeRunner = CapturingProcessRunner & { captures: RecordedCapture[]; runs: RecordedRun[] };

function createFakeRunner(captureHandler: CaptureHandler, runHandler?: RunHandler): FakeRunner {
  const captures: RecordedCapture[] = [];
  const runs: RecordedRun[] = [];
  return {
    captures,
    runs,
    run(executable, args, options) {
      runs.push({ executable, args: [...args], options });
      if (runHandler) {
        runHandler(executable, args, options);
      }
    },
    runShell() {
      throw new Error('unexpected runShell call: release must use explicit args only');
    },
    async capture(executable, args, options) {
      captures.push({ executable, args: [...args], options });
      return captureHandler(executable, args, options);
    },
  };
}

function ok(stdout: string, stderr = ''): ProcessCaptureResult {
  return { stdout, stderr, code: 0 };
}

function failed(code: number, stdout: string, stderr: string): ProcessCaptureResult {
  return { stdout, stderr, code };
}

function spawnError(message: string): ProcessCaptureResult {
  const error = new Error(message) as Error & { code?: string };
  error.code = 'ENOENT';
  return { stdout: '', stderr: '', code: null, error };
}

function queueHandler(results: ReadonlyArray<ProcessCaptureResult>): CaptureHandler {
  let index = 0;
  return () => {
    const result = results[index];
    index += 1;
    if (!result) {
      throw new Error('unexpected capture call: script exhausted');
    }
    return result;
  };
}

function makePlan(overrides: Record<string, unknown> = {}): ReleaseTagPlan {
  return resolveReleaseTagPlan({ cwd: FAKE_CWD, timeoutMs: FAKE_TIMEOUT_MS, ...overrides });
}

function testDetermined(overrides: Partial<DeterminedTag> = {}): DeterminedTag {
  return {
    version: '1.2.3',
    tagVersion: 'v1.2.3',
    bump: 'patch',
    lastTag: 'v1.2.2',
    manual: false,
    ...overrides,
  };
}

async function withEnvVar(name: string, value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const saved = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  try {
    await fn();
  } finally {
    if (saved === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = saved;
    }
  }
}

async function errorMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  expect.unreachable();
}

function standardGitScript(tagMessage: string): ReadonlyArray<ProcessCaptureResult> {
  return [ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok(tagMessage)];
}

function captureArgs(captures: ReadonlyArray<RecordedCapture>): ReadonlyArray<ReadonlyArray<string>> {
  return captures.map((call) => call.args);
}

describe('runReleaseBranch base branch resolution', () => {
  it('prefers explicit baseBranch over env and git', async () => {
    await withEnvVar('GITHUB_REF_NAME', 'env-branch', async () => {
      const runner = createFakeRunner(queueHandler(standardGitScript('msg\n')));
      const plan = makePlan({ baseBranch: 'main', skipRelease: true });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result.baseBranch).toBe('main');
      expect(result.releaseBranch).toBe('changelog/1.2.3');
      expect(result.prTitle).toBe('chore(release): release candidate v1.2.3');
      for (const call of runner.captures) {
        expect(call.args).not.toEqual(['symbolic-ref', '--short', 'HEAD']);
      }
    });
  });

  it('falls back to GITHUB_REF_NAME when explicit is missing', async () => {
    await withEnvVar('GITHUB_REF_NAME', 'develop', async () => {
      const runner = createFakeRunner(queueHandler(standardGitScript('')));
      const plan = makePlan({ skipRelease: true });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result.baseBranch).toBe('develop');
      for (const call of runner.captures) {
        expect(call.args).not.toEqual(['symbolic-ref', '--short', 'HEAD']);
      }
    });
  });

  it('trims GITHUB_REF_NAME whitespace', async () => {
    await withEnvVar('GITHUB_REF_NAME', '  feature/trim  ', async () => {
      const runner = createFakeRunner(queueHandler(standardGitScript('')));
      const plan = makePlan({ skipRelease: true });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result.baseBranch).toBe('feature/trim');
    });
  });

  it('ignores empty GITHUB_REF_NAME and reads git symbolic-ref', async () => {
    await withEnvVar('GITHUB_REF_NAME', '   ', async () => {
      const runner = createFakeRunner(queueHandler([ok('git-branch\n'), ...standardGitScript('')]));
      const plan = makePlan({ skipRelease: true });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result.baseBranch).toBe('git-branch');
      expect(runner.captures[0]).toMatchObject({
        executable: 'git',
        args: ['symbolic-ref', '--short', 'HEAD'],
      });
      expect(runner.captures[0]?.options).toEqual({ cwd: FAKE_CWD, timeoutMs: FAKE_TIMEOUT_MS });
    });
  });

  it('trims symbolic-ref output to its first line', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(queueHandler([ok('  feature/first\nsecond\n'), ...standardGitScript('')]));
      const plan = makePlan({ skipRelease: true });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result.baseBranch).toBe('feature/first');
    });
  });

  it('rejects detached HEAD with the branch guard and stderr tail', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(queueHandler([failed(128, '', 'fatal: ref HEAD is not a symbolic ref\n')]));
      const plan = makePlan({ skipRelease: true });
      const message = await errorMessage(runReleaseBranch({ plan, determined: testDetermined(), runner }));
      expect(message).toContain(BRANCH_GUARD);
      expect(message).toContain('fatal: ref HEAD is not a symbolic ref');
      expect(runner.captures).toHaveLength(1);
    });
  });

  it('rejects detached HEAD spawn errors with the branch guard', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(queueHandler([spawnError('spawn git ENOENT')]));
      const plan = makePlan({ skipRelease: true });
      const message = await errorMessage(runReleaseBranch({ plan, determined: testDetermined(), runner }));
      expect(message).toContain(BRANCH_GUARD);
      expect(message).toContain('spawn git ENOENT');
    });
  });

  it('truncates long detached-HEAD stderr tails', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const stderr = `${'x'.repeat(5000)}TAIL`;
      const runner = createFakeRunner(queueHandler([failed(128, '', stderr)]));
      const plan = makePlan({ skipRelease: true });
      const message = await errorMessage(runReleaseBranch({ plan, determined: testDetermined(), runner }));
      expect(message).toContain(BRANCH_GUARD);
      expect(message).toContain('...[truncated]');
      expect(message).toContain('TAIL');
      expect(message).not.toContain('x'.repeat(5000));
    });
  });

  it('rejects tag-shaped explicit base branches', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      for (const baseBranch of ['v1.2.3', 'refs/tags/v1.2.3', 'HEAD', 'refs/tags/release']) {
        const runner = createFakeRunner(() => {
          throw new Error('tag bases must not invoke git');
        });
        const plan = makePlan({ baseBranch, skipRelease: true });
        const message = await errorMessage(runReleaseBranch({ plan, determined: testDetermined(), runner }));
        expect(message).toBe(BRANCH_GUARD);
        expect(runner.captures).toHaveLength(0);
        expect(runner.runs).toHaveLength(0);
      }
    });
  });

  it('rejects tag-shaped env base branches', async () => {
    for (const refName of ['v2.0.0', 'refs/tags/v2.0.0', 'HEAD']) {
      await withEnvVar('GITHUB_REF_NAME', refName, async () => {
        const runner = createFakeRunner(() => {
          throw new Error('tag env bases must not invoke git');
        });
        const plan = makePlan({ skipRelease: true });
        const message = await errorMessage(runReleaseBranch({ plan, determined: testDetermined(), runner }));
        expect(message).toBe(BRANCH_GUARD);
        expect(runner.captures).toHaveLength(0);
      });
    }
  });

  it('rejects tag-shaped git symbolic-ref output', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      for (const output of ['v1.2.3\n', 'refs/tags/v1.2.3\n', 'HEAD\n', '\n']) {
        const runner = createFakeRunner(queueHandler([ok(output)]));
        const plan = makePlan({ skipRelease: true });
        const message = await errorMessage(runReleaseBranch({ plan, determined: testDetermined(), runner }));
        expect(message).toBe(BRANCH_GUARD);
        expect(runner.captures).toHaveLength(1);
      }
    });
  });

  it('accepts branch names that start with v but are not tags', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(queueHandler(standardGitScript('')));
      const plan = makePlan({ baseBranch: 'version-next', skipRelease: true });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result.baseBranch).toBe('version-next');
    });
  });
});

describe('runReleaseBranch author config', () => {
  it('configures git author with explicit args, cwd, and timeout', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(queueHandler(standardGitScript('')));
      const plan = makePlan({
        baseBranch: 'main',
        skipRelease: true,
        gitUserName: 'Release Bot',
        gitUserEmail: 'release@example.com',
      });
      await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(runner.captures[0]).toMatchObject({
        executable: 'git',
        args: ['config', 'user.name', 'Release Bot'],
      });
      expect(runner.captures[0]?.options).toEqual({ cwd: FAKE_CWD, timeoutMs: FAKE_TIMEOUT_MS });
      expect(runner.captures[1]).toMatchObject({
        executable: 'git',
        args: ['config', 'user.email', 'release@example.com'],
      });
      expect(runner.captures[1]?.options).toEqual({ cwd: FAKE_CWD, timeoutMs: FAKE_TIMEOUT_MS });
    });
  });

  it('omits commit.gpgsign when signCommit is false', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(queueHandler(standardGitScript('')));
      const plan = makePlan({ baseBranch: 'main', skipRelease: true, signCommit: false });
      await runReleaseBranch({ plan, determined: testDetermined(), runner });
      const args = captureArgs(runner.captures);
      expect(args).not.toContainEqual(['config', 'commit.gpgsign', 'true']);
      expect(runner.captures).toHaveLength(8);
    });
  });

  it('sets commit.gpgsign when signCommit is true without signingkey or gnupg writes', async () => {
    const homeDir = await mkdtemp(join(tmpdir(), 'release-tag-home-'));
    try {
      await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
        await withEnvVar('HOME', homeDir, async () => {
          const runner = createFakeRunner(
            queueHandler([ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok('')]),
          );
          const plan = makePlan({ baseBranch: 'main', skipRelease: true, signCommit: true });
          await runReleaseBranch({ plan, determined: testDetermined(), runner });
          expect(runner.captures[2]).toMatchObject({
            executable: 'git',
            args: ['config', 'commit.gpgsign', 'true'],
          });
          for (const call of runner.captures) {
            expect(call.args).not.toContain('user.signingkey');
            expect(call.executable).toBe('git');
          }
          const entries = await readdir(homeDir);
          expect(entries).toEqual([]);
        });
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('fails fatal when author config fails', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(queueHandler([failed(1, '', 'fatal: not a git repo\n')]));
      const plan = makePlan({ baseBranch: 'main', skipRelease: true });
      const message = await errorMessage(runReleaseBranch({ plan, determined: testDetermined(), runner }));
      expect(message).toContain('git config user.name failed');
      expect(message).toContain('fatal: not a git repo');
      expect(runner.captures).toHaveLength(1);
    });
  });

  it('fails fatal when gpgsign config fails', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(queueHandler([ok(''), ok(''), failed(1, '', 'fatal: config locked\n')]));
      const plan = makePlan({ baseBranch: 'main', skipRelease: true, signCommit: true });
      const message = await errorMessage(runReleaseBranch({ plan, determined: testDetermined(), runner }));
      expect(message).toContain('git config commit.gpgsign failed');
      expect(runner.captures).toHaveLength(3);
    });
  });
});

describe('runReleaseBranch branch reset', () => {
  it('resets in order and ignores delete failures', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(
        queueHandler([
          ok(''),
          ok(''),
          failed(1, '', 'error: remote ref does not exist\n'),
          failed(1, '', "error: branch 'changelog/1.2.3' not found\n"),
          ok(''),
          ok(''),
          ok(''),
          ok('tag body\n'),
        ]),
      );
      const plan = makePlan({ baseBranch: 'main', skipRelease: true });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result.releaseRan).toBe(false);
      expect(result.skippedReason).toBe('skipped via skipRelease');
      expect(captureArgs(runner.captures)).toEqual([
        ['config', 'user.name', 'github-actions[bot]'],
        ['config', 'user.email', 'github-actions[bot]@users.noreply.github.com'],
        ['push', 'origin', '--delete', 'changelog/1.2.3'],
        ['branch', '-D', 'changelog/1.2.3'],
        ['checkout', '-b', 'changelog/1.2.3'],
        ['push', '--set-upstream', 'origin', 'changelog/1.2.3'],
        ['push', 'origin', 'changelog/1.2.3'],
        ['tag', '-l', '--format=%(contents)', 'v1.2.3'],
      ]);
      for (const call of runner.captures) {
        expect(call.executable).toBe('git');
        expect(call.options).toEqual({ cwd: FAKE_CWD, timeoutMs: FAKE_TIMEOUT_MS });
      }
    });
  });

  it('ignores delete spawn errors', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(
        queueHandler([
          ok(''),
          ok(''),
          spawnError('spawn git EPIPE'),
          spawnError('spawn git EPIPE'),
          ok(''),
          ok(''),
          ok(''),
          ok(''),
        ]),
      );
      const plan = makePlan({ baseBranch: 'main', skipRelease: true });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result.releaseBranch).toBe('changelog/1.2.3');
      expect(runner.captures).toHaveLength(8);
    });
  });

  it('fails fatal when checkout fails', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(
        queueHandler([ok(''), ok(''), ok(''), ok(''), failed(128, '', 'fatal: a branch named x already exists\n')]),
      );
      const plan = makePlan({ baseBranch: 'main', skipRelease: true });
      const message = await errorMessage(runReleaseBranch({ plan, determined: testDetermined(), runner }));
      expect(message).toContain('git checkout -b changelog/1.2.3 failed');
      expect(runner.captures).toHaveLength(5);
      expect(runner.runs).toHaveLength(0);
    });
  });

  it('fails fatal when upstream push fails', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(
        queueHandler([ok(''), ok(''), ok(''), ok(''), ok(''), failed(1, '', 'fatal: push rejected\n')]),
      );
      const plan = makePlan({ baseBranch: 'main', skipRelease: true });
      const message = await errorMessage(runReleaseBranch({ plan, determined: testDetermined(), runner }));
      expect(message).toContain('git push --set-upstream origin changelog/1.2.3 failed');
      expect(runner.captures).toHaveLength(6);
    });
  });
});

describe('runReleaseBranch release availability', () => {
  it('skips via skipRelease but still creates, pushes, and reads the tag', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(queueHandler(standardGitScript('pending\n')));
      const plan = makePlan({ baseBranch: 'main', skipRelease: true });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result).toEqual({
        baseBranch: 'main',
        releaseBranch: 'changelog/1.2.3',
        releaseRan: false,
        skippedReason: 'skipped via skipRelease',
        tagMessage: 'pending',
        prTitle: 'chore(release): release candidate v1.2.3',
      });
      expect(runner.runs).toHaveLength(0);
      expect(runner.captures).toHaveLength(8);
    });
  });

  it('skips when only excludes release', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(queueHandler(standardGitScript('')));
      const plan = makePlan({ baseBranch: 'main', only: ['determine', 'pr'] });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result.releaseRan).toBe(false);
      expect(result.skippedReason).toBe('stage not selected');
      expect(runner.runs).toHaveLength(0);
      expect(runner.captures).toHaveLength(8);
    });
  });

  it('skips when a path release command is missing', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'release-tag-missing-'));
    try {
      await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
        const runner = createFakeRunner(queueHandler(standardGitScript('')));
        const plan = resolveReleaseTagPlan({
          cwd,
          timeoutMs: FAKE_TIMEOUT_MS,
          baseBranch: 'main',
          releaseCommand: './does-not-exist-release-it',
        });
        const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
        expect(result.releaseRan).toBe(false);
        expect(result.skippedReason).toBe('release command not available: ./does-not-exist-release-it');
        expect(runner.runs).toHaveLength(0);
        expect(runner.captures).toHaveLength(8);
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('skips when a path release command is not executable', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'release-tag-noexec-'));
    try {
      const target = join(cwd, 'release-it');
      await writeFile(target, '#!/usr/bin/env node\n');
      await chmod(target, 0o644);
      await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
        const runner = createFakeRunner(queueHandler(standardGitScript('')));
        const plan = resolveReleaseTagPlan({
          cwd,
          timeoutMs: FAKE_TIMEOUT_MS,
          baseBranch: 'main',
          releaseCommand: './release-it',
        });
        const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
        expect(result.releaseRan).toBe(false);
        expect(result.skippedReason).toBe('release command not available: ./release-it');
        expect(runner.runs).toHaveLength(0);
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('runs when a path release command is executable', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'release-tag-exec-'));
    try {
      const target = join(cwd, 'release-it');
      await writeFile(target, '#!/usr/bin/env node\n');
      await chmod(target, 0o755);
      await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
        const runner = createFakeRunner(queueHandler(standardGitScript('made\n')));
        const plan = resolveReleaseTagPlan({
          cwd,
          timeoutMs: FAKE_TIMEOUT_MS,
          baseBranch: 'main',
          releaseCommand: './release-it',
        });
        const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
        expect(result.releaseRan).toBe(true);
        expect(result.skippedReason).toBeNull();
        expect(result.tagMessage).toBe('made');
        expect(runner.runs).toHaveLength(1);
        expect(runner.runs[0]).toMatchObject({
          executable: './release-it',
          args: ['1.2.3', '--ci'],
        });
        expect(runner.runs[0]?.options).toEqual({ cwd });
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('resolves nested path release commands against cwd', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'release-tag-nested-'));
    try {
      const nested = join(cwd, 'node_modules', '.bin');
      await writeFile(join(cwd, 'placeholder'), 'x');
      await rm(join(cwd, 'placeholder'));
      const { mkdir } = await import('node:fs/promises');
      await mkdir(nested, { recursive: true });
      const target = join(nested, 'release-it');
      await writeFile(target, '#!/usr/bin/env node\n');
      await chmod(target, 0o755);
      await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
        const runner = createFakeRunner(queueHandler(standardGitScript('')));
        const plan = resolveReleaseTagPlan({
          cwd,
          timeoutMs: FAKE_TIMEOUT_MS,
          baseBranch: 'main',
          releaseCommand: './node_modules/.bin/release-it',
        });
        const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
        expect(result.releaseRan).toBe(true);
        expect(runner.runs).toHaveLength(1);
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('probes bare-name release commands with --version before running', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(
        queueHandler([ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok('9.9.9\n'), ok(''), ok('probe-ok\n')]),
      );
      const plan = makePlan({ baseBranch: 'main', releaseCommand: 'release-it' });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result.releaseRan).toBe(true);
      expect(result.skippedReason).toBeNull();
      expect(runner.captures[6]).toMatchObject({
        executable: 'release-it',
        args: ['--version'],
      });
      expect(runner.captures[6]?.options).toEqual({
        cwd: FAKE_CWD,
        timeoutMs: Math.min(FAKE_TIMEOUT_MS, 10000),
      });
      expect(runner.runs).toHaveLength(1);
      expect(runner.runs[0]?.args).toEqual(['1.2.3', '--ci']);
    });
  });

  it('skips when a bare-name probe exits non-zero', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(
        queueHandler([
          ok(''),
          ok(''),
          ok(''),
          ok(''),
          ok(''),
          ok(''),
          failed(1, '', 'command failed\n'),
          ok(''),
          ok(''),
        ]),
      );
      const plan = makePlan({ baseBranch: 'main', releaseCommand: 'release-it' });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result.releaseRan).toBe(false);
      expect(result.skippedReason).toBe('release command not available: release-it');
      expect(runner.runs).toHaveLength(0);
      expect(runner.captures).toHaveLength(9);
    });
  });

  it('skips when a bare-name probe fails to spawn', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(
        queueHandler([
          ok(''),
          ok(''),
          ok(''),
          ok(''),
          ok(''),
          ok(''),
          spawnError('spawn release-it ENOENT'),
          ok(''),
          ok(''),
        ]),
      );
      const plan = makePlan({ baseBranch: 'main', releaseCommand: 'release-it' });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result.releaseRan).toBe(false);
      expect(result.skippedReason).toBe('release command not available: release-it');
      expect(runner.runs).toHaveLength(0);
    });
  });

  it('caps the bare-name probe timeout at ten seconds', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(
        queueHandler([ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok('1.0.0\n'), ok(''), ok('')]),
      );
      const plan = resolveReleaseTagPlan({
        cwd: FAKE_CWD,
        timeoutMs: 60000,
        baseBranch: 'main',
        releaseCommand: 'release-it',
      });
      await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(runner.captures[6]?.options).toEqual({ cwd: FAKE_CWD, timeoutMs: 10000 });
    });
  });

  it('respects a probe timeout below the cap', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(
        queueHandler([ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok('1.0.0\n'), ok(''), ok('')]),
      );
      const plan = resolveReleaseTagPlan({
        cwd: FAKE_CWD,
        timeoutMs: 500,
        baseBranch: 'main',
        releaseCommand: 'release-it',
      });
      await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(runner.captures[6]?.options).toEqual({ cwd: FAKE_CWD, timeoutMs: 500 });
    });
  });
});

describe('runReleaseBranch release execution', () => {
  it('runs version plus ci plus releaseArgs without gpg-sign', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'release-tag-args-'));
    try {
      const target = join(cwd, 'release-it');
      await writeFile(target, '#!/usr/bin/env node\n');
      await chmod(target, 0o755);
      await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
        const runner = createFakeRunner(queueHandler(standardGitScript('ok\n')));
        const plan = resolveReleaseTagPlan({
          cwd,
          timeoutMs: FAKE_TIMEOUT_MS,
          baseBranch: 'main',
          releaseCommand: './release-it',
          releaseArgs: ['--no-npm', '--dry-run'],
          signCommit: false,
        });
        const result = await runReleaseBranch({
          plan,
          determined: testDetermined({ version: '2.0.0', tagVersion: 'v2.0.0' }),
          runner,
        });
        expect(result.releaseRan).toBe(true);
        expect(runner.runs[0]?.args).toEqual(['2.0.0', '--ci', '--no-npm', '--dry-run']);
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('appends gpg-sign last when signCommit is true', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'release-tag-gpg-'));
    try {
      const target = join(cwd, 'release-it');
      await writeFile(target, '#!/usr/bin/env node\n');
      await chmod(target, 0o755);
      await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
        const runner = createFakeRunner(
          queueHandler([ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok('msg\n')]),
        );
        const plan = resolveReleaseTagPlan({
          cwd,
          timeoutMs: FAKE_TIMEOUT_MS,
          baseBranch: 'main',
          releaseCommand: './release-it',
          releaseArgs: ['--no-npm'],
          signCommit: true,
        });
        await runReleaseBranch({ plan, determined: testDetermined(), runner });
        expect(runner.runs[0]?.args).toEqual(['1.2.3', '--ci', '--no-npm', '--git.commitArgs=--gpg-sign']);
        expect(runner.captures[2]?.args).toEqual(['config', 'commit.gpgsign', 'true']);
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('throws with command label and duration when the release command fails', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'release-tag-fail-'));
    try {
      const target = join(cwd, 'release-it');
      await writeFile(target, '#!/usr/bin/env node\n');
      await chmod(target, 0o755);
      await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
        const runner = createFakeRunner(queueHandler([ok(''), ok(''), ok(''), ok(''), ok(''), ok('')]), () => {
          throw new Error('release-it exploded');
        });
        const plan = resolveReleaseTagPlan({
          cwd,
          timeoutMs: FAKE_TIMEOUT_MS,
          baseBranch: 'main',
          releaseCommand: './release-it',
        });
        const message = await errorMessage(runReleaseBranch({ plan, determined: testDetermined(), runner }));
        expect(message).toContain('release command "./release-it" failed after');
        expect(message).toContain('release-it exploded');
        expect(message).toMatch(/after \d+ms/);
        expect(runner.runs).toHaveLength(1);
        expect(runner.captures).toHaveLength(6);
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('requires a capturing runner', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const badRunner = { run() {}, runShell() {} } as unknown as CapturingProcessRunner;
      const plan = makePlan({ baseBranch: 'main', skipRelease: true });
      await expect(runReleaseBranch({ plan, determined: testDetermined(), runner: badRunner })).rejects.toThrow(
        /CapturingProcessRunner/,
      );
    });
  });

  it('prefers the explicit runner over the plan runner', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const planRunner = createFakeRunner(() => {
        throw new Error('plan runner must not be used');
      });
      const explicitRunner = createFakeRunner(queueHandler(standardGitScript('')));
      const plan = resolveReleaseTagPlan({
        cwd: FAKE_CWD,
        timeoutMs: FAKE_TIMEOUT_MS,
        baseBranch: 'main',
        skipRelease: true,
        runner: planRunner,
      });
      const result = await runReleaseBranch({
        plan,
        determined: testDetermined(),
        runner: explicitRunner,
      });
      expect(result.baseBranch).toBe('main');
      expect(explicitRunner.captures).toHaveLength(8);
      expect(planRunner.captures).toHaveLength(0);
    });
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
  it('pushes the branch and strips trailing newlines from the tag message', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(queueHandler(standardGitScript('Release 1.2.3\n\nBody\r\n\n')));
      const plan = makePlan({ baseBranch: 'main', skipRelease: true });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result.tagMessage).toBe('Release 1.2.3\n\nBody');
      expect(runner.captures[6]).toMatchObject({
        executable: 'git',
        args: ['push', 'origin', 'changelog/1.2.3'],
      });
      expect(runner.captures[7]).toMatchObject({
        executable: 'git',
        args: ['tag', '-l', '--format=%(contents)', 'v1.2.3'],
      });
    });
  });

  it('tolerates an empty tag message', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      for (const stdout of ['', '\n', '\r\n']) {
        const runner = createFakeRunner(queueHandler(standardGitScript(stdout)));
        const plan = makePlan({ baseBranch: 'main', skipRelease: true });
        const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
        expect(result.tagMessage).toBe('');
        expect(result.prTitle).toBe('chore(release): release candidate v1.2.3');
      }
    });
  });

  it('fails fatal when the final push fails', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(
        queueHandler([
          ok(''),
          ok(''),
          ok(''),
          ok(''),
          ok(''),
          ok(''),
          failed(1, '', 'fatal: push rejected by remote\n'),
        ]),
      );
      const plan = makePlan({ baseBranch: 'main', skipRelease: true });
      const message = await errorMessage(runReleaseBranch({ plan, determined: testDetermined(), runner }));
      expect(message).toContain('git push origin changelog/1.2.3 failed');
      expect(runner.captures).toHaveLength(7);
    });
  });

  it('fails fatal when the tag read fails to spawn', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(
        queueHandler([ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), spawnError('spawn git ENOENT')]),
      );
      const plan = makePlan({ baseBranch: 'main', skipRelease: true });
      const message = await errorMessage(runReleaseBranch({ plan, determined: testDetermined(), runner }));
      expect(message).toContain('git tag -l --format=%(contents) v1.2.3 failed');
      expect(message).toContain('spawn git ENOENT');
    });
  });

  it('derives releaseBranch from the determined version when the plan omits it', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(queueHandler(standardGitScript('')));
      const plan = makePlan({ baseBranch: 'main', skipRelease: true });
      expect(plan.releaseBranch).toBeUndefined();
      const result = await runReleaseBranch({
        plan,
        determined: testDetermined({ version: '4.5.6', tagVersion: 'v4.5.6' }),
        runner,
      });
      expect(result.releaseBranch).toBe('changelog/4.5.6');
      expect(runner.captures[4]?.args).toEqual(['checkout', '-b', 'changelog/4.5.6']);
    });
  });

  it('uses an explicit releaseBranch over the derived template', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(queueHandler(standardGitScript('')));
      const plan = makePlan({ baseBranch: 'main', releaseBranch: 'custom/rc', skipRelease: true });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result.releaseBranch).toBe('custom/rc');
      expect(runner.captures[4]?.args).toEqual(['checkout', '-b', 'custom/rc']);
      expect(runner.captures[7]?.args).toEqual(['tag', '-l', '--format=%(contents)', 'v1.2.3']);
    });
  });
});

describe('runReleaseBranch dry-run', () => {
  it('returns dry-run without invoking the runner', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(
        () => {
          throw new Error('dry-run must not invoke capture');
        },
        () => {
          throw new Error('dry-run must not invoke run');
        },
      );
      const plan = makePlan({ baseBranch: 'main', dryRun: true });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result).toEqual({
        baseBranch: 'main',
        releaseBranch: 'changelog/1.2.3',
        releaseRan: false,
        skippedReason: 'dry-run',
        tagMessage: '',
        prTitle: 'chore(release): release candidate v1.2.3',
      });
      expect(runner.captures).toHaveLength(0);
      expect(runner.runs).toHaveLength(0);
    });
  });

  it('resolves the env base branch in dry-run without git', async () => {
    await withEnvVar('GITHUB_REF_NAME', 'env-dry', async () => {
      const runner = createFakeRunner(() => {
        throw new Error('dry-run must not invoke capture');
      });
      const plan = makePlan({ dryRun: true });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result.baseBranch).toBe('env-dry');
      expect(result.skippedReason).toBe('dry-run');
      expect(runner.captures).toHaveLength(0);
      expect(runner.runs).toHaveLength(0);
    });
  });

  it('skips release availability probes in dry-run', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(() => {
        throw new Error('dry-run must not probe the release command');
      });
      const plan = makePlan({ baseBranch: 'main', dryRun: true, releaseCommand: 'release-it' });
      const result = await runReleaseBranch({ plan, determined: testDetermined(), runner });
      expect(result.releaseRan).toBe(false);
      expect(result.skippedReason).toBe('dry-run');
      expect(runner.captures).toHaveLength(0);
    });
  });

  it('throws without invocations when dry-run cannot resolve the base branch', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(() => {
        throw new Error('unresolvable dry-run must not invoke git');
      });
      const plan = makePlan({ dryRun: true });
      const message = await errorMessage(runReleaseBranch({ plan, determined: testDetermined(), runner }));
      expect(message).toContain('baseBranch could not be resolved in dry-run');
      expect(runner.captures).toHaveLength(0);
      expect(runner.runs).toHaveLength(0);
    });
  });

  it('rejects tag bases in dry-run without invocations', async () => {
    await withEnvVar('GITHUB_REF_NAME', undefined, async () => {
      const runner = createFakeRunner(() => {
        throw new Error('tag dry-run must not invoke git');
      });
      const plan = makePlan({ baseBranch: 'v1.2.3', dryRun: true });
      const message = await errorMessage(runReleaseBranch({ plan, determined: testDetermined(), runner }));
      expect(message).toBe(BRANCH_GUARD);
      expect(runner.captures).toHaveLength(0);
      expect(runner.runs).toHaveLength(0);
    });
  });
});
