import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  CapturingProcessRunner,
  ProcessCaptureOptions,
  ProcessCaptureResult,
  ProcessRunOptions,
} from '@repo-toolkit/publish-package';

import { runReleaseTag, type DeterminedTag, type ReleaseBranchResult } from '../src/index';

const FAKE_CWD = '/fake/workdir';
const TOKEN_CANARY = 'run-canary-token-9f3b1c-do-not-leak';
const ENV_TOKEN = 'run-env-token-5c4a8f-do-not-leak';

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
      throw new Error('unexpected runShell call');
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

interface RecordedFetch {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function makeResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: async () => text,
  } as Response;
}

function normalizeHeaders(input: unknown): Record<string, string> {
  if (input instanceof Headers) {
    const out: Record<string, string> = {};
    input.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (typeof input === 'object' && input !== null) {
    return { ...(input as Record<string, string>) };
  }
  return {};
}

function createRecordingFetch(handler: (call: RecordedFetch, index: number) => Response | Promise<Response>) {
  const calls: RecordedFetch[] = [];
  const fetchFn = (async (
    url: unknown,
    init?: {
      method?: string;
      headers?: unknown;
      body?: unknown;
      signal?: unknown;
    },
  ) => {
    const recorded: RecordedFetch = {
      url: String(url),
      method: init?.method ?? 'GET',
      headers: normalizeHeaders(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    const index = calls.length;
    calls.push(recorded);
    return handler(recorded, index);
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return headers[key];
    }
  }
  return undefined;
}

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void>;
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void;
function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>): void | Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    const value = vars[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  const restore = () => {
    for (const key of Object.keys(vars)) {
      const value = saved[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.finally(restore);
    }
    restore();
  } catch (error) {
    restore();
    throw error;
  }
  return undefined;
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'release-tag-run-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
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

function releaseCaptures(tagMessage: string): ReadonlyArray<ProcessCaptureResult> {
  return [ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok(tagMessage)];
}

function determinedFixture(): DeterminedTag {
  return { version: '1.2.3', tagVersion: 'v1.2.3', bump: null, lastTag: null, manual: true };
}

function releaseFixture(): ReleaseBranchResult {
  return {
    baseBranch: 'main',
    releaseBranch: 'changelog/1.2.3',
    releaseRan: true,
    skippedReason: null,
    tagMessage: 'notes',
    prTitle: 'chore(release): release candidate v1.2.3',
  };
}

describe('runReleaseTag end to end', () => {
  it('runs manual tag through release and pr with merge and delete', async () => {
    await withTempDir(async (dir) => {
      const releasePath = join(dir, 'fake-release-it');
      await writeFile(releasePath, '#!/usr/bin/env node\n', 'utf8');
      await chmod(releasePath, 0o755);
      await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined }, async () => {
        const runner = createFakeRunner(queueHandler(releaseCaptures('Release 1.2.3 notes\n')));
        const { calls, fetchFn } = createRecordingFetch((call, index) => {
          if (index === 0) {
            return makeResponse(201, { number: 42, html_url: 'https://github.com/octo/hello/pull/42' });
          }
          if (index === 1) {
            return makeResponse(200, {});
          }
          if (index === 2) {
            return makeResponse(200, { merged: true });
          }
          return makeResponse(204, '');
        });
        const result = await runReleaseTag({
          cwd: dir,
          tag: '1.2.3',
          baseBranch: 'main',
          releaseCommand: './fake-release-it',
          githubToken: TOKEN_CANARY,
          githubRepository: 'octo/hello',
          autoMergePr: true,
          deleteMergedBranch: true,
          runner,
          fetchFn,
        });
        expect(result.determined).toEqual({
          version: '1.2.3',
          tagVersion: 'v1.2.3',
          bump: null,
          lastTag: null,
          manual: true,
        });
        expect(result.release?.releaseBranch).toBe('changelog/1.2.3');
        expect(result.release?.baseBranch).toBe('main');
        expect(result.release?.releaseRan).toBe(true);
        expect(result.release?.skippedReason).toBeNull();
        expect(result.release?.prTitle).toBe('chore(release): release candidate v1.2.3');
        expect(result.release?.tagMessage).toBe('Release 1.2.3 notes');
        expect(runner.runs).toHaveLength(1);
        expect(runner.runs[0]?.executable).toBe('./fake-release-it');
        expect(runner.runs[0]?.args).toEqual(['1.2.3', '--ci']);
        expect(result.pullRequest?.skipped).toBe(false);
        expect(result.pullRequest?.number).toBe(42);
        expect(result.pullRequest?.url).toBe('https://github.com/octo/hello/pull/42');
        expect(result.pullRequest?.merged).toBe(true);
        expect(result.pullRequest?.branchDeleted).toBe(true);
        expect(calls).toHaveLength(4);
        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.url).toBe('https://api.github.com/repos/octo/hello/pulls');
        const createBody = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
        expect(createBody.head).toBe('changelog/1.2.3');
        expect(createBody.base).toBe('main');
        expect(createBody.title).toBe('chore(release): release candidate v1.2.3');
        expect(typeof createBody.body).toBe('string');
        expect(String(createBody.body)).toContain('Release 1.2.3 notes');
        const labelsBody = JSON.parse(calls[1]?.body ?? '{}') as Record<string, unknown>;
        expect(labelsBody.labels).toEqual(['changelog', 'release-candidate', 'v1.2.3']);
        expect(headerValue(calls[0]?.headers ?? {}, 'authorization')).toBe(`Bearer ${TOKEN_CANARY}`);
        expect(JSON.stringify(result)).not.toContain(TOKEN_CANARY);
        expect(JSON.stringify(result.plan)).not.toContain(TOKEN_CANARY);
      });
    });
  });

  it('runs stages in determine release pr order', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined }, async () => {
      const order: string[] = [];
      const runner = createFakeRunner((executable, args) => {
        order.push(`capture:${executable}:${args.join(' ')}`);
        if (args[0] === 'describe') {
          return ok('v1.2.2\n');
        }
        if (args[0] === 'log') {
          return ok('feat: new thing\n');
        }
        if (args[0] === 'tag') {
          return ok('');
        }
        return ok('');
      });
      const { fetchFn } = createRecordingFetch(() => {
        order.push('fetch:pr');
        return makeResponse(201, { number: 1, html_url: 'https://github.com/octo/hello/pull/1' });
      });
      const result = await runReleaseTag({
        cwd: FAKE_CWD,
        baseBranch: 'main',
        skipRelease: true,
        skipPr: true,
        githubRepository: 'octo/hello',
        runner,
        fetchFn,
      });
      expect(result.determined?.version).toBe('1.3.0');
      const describeIndex = order.findIndex((entry) => entry.includes('describe'));
      const configIndex = order.findIndex((entry) => entry.includes('config'));
      expect(describeIndex).toBeGreaterThanOrEqual(0);
      expect(configIndex).toBeGreaterThan(describeIndex);
      expect(result.pullRequest?.skipped).toBe(true);
    });
  });
});

describe('runReleaseTag only filtering', () => {
  it('runs only determine when only selects determine', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined }, async () => {
      const runner = createFakeRunner(() => {
        throw new Error('manual determine must not invoke git');
      });
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const result = await runReleaseTag({
        cwd: FAKE_CWD,
        tag: 'v2.0.0',
        baseBranch: 'main',
        only: ['determine'],
        githubRepository: 'octo/hello',
        runner,
        fetchFn,
      });
      expect(result.determined).toEqual({
        version: '2.0.0',
        tagVersion: 'v2.0.0',
        bump: null,
        lastTag: null,
        manual: true,
      });
      expect(result.release).toBeNull();
      expect(result.pullRequest).toBeNull();
      expect(runner.captures).toHaveLength(0);
      expect(runner.runs).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });
  });

  it('yields null for unselected stages', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined }, async () => {
      const runner = createFakeRunner(queueHandler(releaseCaptures('')));
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const result = await runReleaseTag({
        cwd: FAKE_CWD,
        tag: '1.2.3',
        baseBranch: 'main',
        only: ['determine', 'release'],
        skipRelease: true,
        githubRepository: 'octo/hello',
        runner,
        fetchFn,
      });
      expect(result.determined).not.toBeNull();
      expect(result.release).not.toBeNull();
      expect(result.pullRequest).toBeNull();
      expect(calls).toHaveLength(0);
    });
  });

  it('returns all nulls when only is empty', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined }, async () => {
      const runner = createFakeRunner(() => {
        throw new Error('no stages must not invoke git');
      });
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const result = await runReleaseTag({
        cwd: FAKE_CWD,
        tag: '1.2.3',
        only: [],
        runner,
        fetchFn,
      });
      expect(result.determined).toBeNull();
      expect(result.release).toBeNull();
      expect(result.pullRequest).toBeNull();
      expect(runner.captures).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });
  });

  it('rejects release without determine', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined }, async () => {
      const runner = createFakeRunner(() => {
        throw new Error('must not invoke git');
      });
      const { fetchFn } = createRecordingFetch(() => makeResponse(200, {}));
      const message = await errorMessage(
        runReleaseTag({ cwd: FAKE_CWD, tag: '1.2.3', only: ['release'], runner, fetchFn }),
      );
      expect(message).toContain("Stage 'release' requires stage 'determine'");
      expect(runner.captures).toHaveLength(0);
    });
  });

  it('rejects pr without determine and release', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined }, async () => {
      const runner = createFakeRunner(() => {
        throw new Error('must not invoke git');
      });
      const { calls, fetchFn } = createRecordingFetch(() => makeResponse(200, {}));
      const prOnly = await errorMessage(runReleaseTag({ cwd: FAKE_CWD, tag: '1.2.3', only: ['pr'], runner, fetchFn }));
      expect(prOnly).toContain("Stage 'pr' requires stages 'determine' and 'release'");
      const determinePr = await errorMessage(
        runReleaseTag({ cwd: FAKE_CWD, tag: '1.2.3', only: ['determine', 'pr'], runner, fetchFn }),
      );
      expect(determinePr).toContain("Stage 'pr' requires stages 'determine' and 'release'");
      expect(calls).toHaveLength(0);
    });
  });
});

describe('runReleaseTag skip versus not selected', () => {
  it('invokes release when skipRelease is true and returns a skipped result', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined }, async () => {
      const runner = createFakeRunner(queueHandler(releaseCaptures('')));
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const result = await runReleaseTag({
        cwd: FAKE_CWD,
        tag: '1.2.3',
        baseBranch: 'main',
        skipRelease: true,
        only: ['determine', 'release'],
        githubRepository: 'octo/hello',
        runner,
        fetchFn,
      });
      expect(result.release).not.toBeNull();
      expect(result.release?.releaseRan).toBe(false);
      expect(result.release?.skippedReason).toBe('skipped via skipRelease');
      expect(result.release?.releaseBranch).toBe('changelog/1.2.3');
      expect(runner.captures.length).toBeGreaterThan(0);
      expect(runner.runs).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });
  });

  it('invokes pr when skipPr is true and returns a skipped result', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined }, async () => {
      const runner = createFakeRunner(queueHandler(releaseCaptures('msg')));
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const result = await runReleaseTag({
        cwd: FAKE_CWD,
        tag: '1.2.3',
        baseBranch: 'main',
        skipRelease: true,
        skipPr: true,
        githubRepository: 'octo/hello',
        runner,
        fetchFn,
      });
      expect(result.pullRequest).not.toBeNull();
      expect(result.pullRequest?.skipped).toBe(true);
      expect(result.pullRequest?.skippedReason).toBe('skipped via skipPr');
      expect(calls).toHaveLength(0);
    });
  });

  it('distinguishes not selected null from selected but skipped', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined }, async () => {
      const unselectedRunner = createFakeRunner(() => {
        throw new Error('manual determine must not invoke git');
      });
      const { fetchFn: unselectedFetch } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const unselected = await runReleaseTag({
        cwd: FAKE_CWD,
        tag: '1.2.3',
        baseBranch: 'main',
        only: ['determine'],
        runner: unselectedRunner,
        fetchFn: unselectedFetch,
      });
      expect(unselected.release).toBeNull();
      expect(unselected.pullRequest).toBeNull();
      const skippedRunner = createFakeRunner(queueHandler(releaseCaptures('')));
      const { fetchFn: skippedFetch } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const skipped = await runReleaseTag({
        cwd: FAKE_CWD,
        tag: '1.2.3',
        baseBranch: 'main',
        skipRelease: true,
        skipPr: true,
        githubRepository: 'octo/hello',
        runner: skippedRunner,
        fetchFn: skippedFetch,
      });
      expect(skipped.release).not.toBeNull();
      expect(skipped.pullRequest).not.toBeNull();
    });
  });
});

describe('runReleaseTag dry run', () => {
  it('returns nulls without runner or fetch invocations', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined }, async () => {
      const runner = createFakeRunner(
        () => {
          throw new Error('dry-run must not invoke git');
        },
        () => {
          throw new Error('dry-run must not run release');
        },
      );
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('dry-run must not fetch');
      });
      const result = await runReleaseTag({
        cwd: FAKE_CWD,
        tag: '1.2.3',
        baseBranch: 'main',
        dryRun: true,
        githubRepository: 'octo/hello',
        runner,
        fetchFn,
      });
      expect(result.plan.dryRun).toBe(true);
      expect(result.determined).toBeNull();
      expect(result.release).toBeNull();
      expect(result.pullRequest).toBeNull();
      expect(runner.captures).toHaveLength(0);
      expect(runner.runs).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });
  });

  it('returns nulls in dry-run even without a manual tag', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined }, async () => {
      const runner = createFakeRunner(() => {
        throw new Error('dry-run must not invoke git');
      });
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('dry-run must not fetch');
      });
      const result = await runReleaseTag({ cwd: FAKE_CWD, dryRun: true, runner, fetchFn });
      expect(result.determined).toBeNull();
      expect(result.release).toBeNull();
      expect(result.pullRequest).toBeNull();
      expect(runner.captures).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });
  });
});

describe('runReleaseTag errors and redaction', () => {
  it('stops subsequent stages when determine fails', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined }, async () => {
      const runner = createFakeRunner(queueHandler([failed(128, '', 'fatal: no tags')]));
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const message = await errorMessage(runReleaseTag({ cwd: FAKE_CWD, baseBranch: 'main', runner, fetchFn }));
      expect(message).toContain('No previous tag found');
      expect(runner.captures).toHaveLength(1);
      expect(runner.runs).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });
  });

  it('stops pr when release fails', async () => {
    await withTempDir(async (dir) => {
      const releasePath = join(dir, 'fake-release-it');
      await writeFile(releasePath, '#!/usr/bin/env node\n', 'utf8');
      await chmod(releasePath, 0o755);
      await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined }, async () => {
        const runner = createFakeRunner(queueHandler(releaseCaptures('')), () => {
          throw new Error('controlled release failure');
        });
        const { calls, fetchFn } = createRecordingFetch(() => {
          throw new Error('fetch must not be called');
        });
        const message = await errorMessage(
          runReleaseTag({
            cwd: dir,
            tag: '1.2.3',
            baseBranch: 'main',
            releaseCommand: './fake-release-it',
            githubRepository: 'octo/hello',
            runner,
            fetchFn,
          }),
        );
        expect(message).toContain('controlled release failure');
        expect(runner.runs).toHaveLength(1);
        expect(calls).toHaveLength(0);
      });
    });
  });

  it('redacts explicit and env tokens from propagated errors', async () => {
    await withEnv({ GITHUB_TOKEN: ENV_TOKEN, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined }, async () => {
      const runner = createFakeRunner(queueHandler(releaseCaptures('notes')));
      const { fetchFn } = createRecordingFetch(() => makeResponse(401, `bad credentials ${TOKEN_CANARY} ${ENV_TOKEN}`));
      const message = await errorMessage(
        runReleaseTag({
          cwd: FAKE_CWD,
          tag: '1.2.3',
          baseBranch: 'main',
          skipRelease: true,
          githubToken: TOKEN_CANARY,
          githubRepository: 'octo/hello',
          runner,
          fetchFn,
        }),
      );
      expect(message).toContain('401');
      expect(message).not.toContain(TOKEN_CANARY);
      expect(message).not.toContain(ENV_TOKEN);
    });
  });

  it('never includes token bytes in the result', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined }, async () => {
      const runner = createFakeRunner(queueHandler(releaseCaptures('')));
      const { fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const result = await runReleaseTag({
        cwd: FAKE_CWD,
        tag: '1.2.3',
        baseBranch: 'main',
        skipRelease: true,
        skipPr: true,
        githubToken: TOKEN_CANARY,
        githubRepository: 'octo/hello',
        runner,
        fetchFn,
      });
      expect(result.plan.tokenAvailable).toBe(true);
      expect(JSON.stringify(result)).not.toContain(TOKEN_CANARY);
      expect('githubToken' in result.plan).toBe(false);
    });
  });

  it('rejects non-object options', async () => {
    await expect(runReleaseTag('x' as unknown as Parameters<typeof runReleaseTag>[0])).rejects.toThrow(/options/);
  });

  it('exposes determined and release fixtures without drift', () => {
    expect(determinedFixture().tagVersion).toBe('v1.2.3');
    expect(releaseFixture().prTitle).toBe('chore(release): release candidate v1.2.3');
  });
});
