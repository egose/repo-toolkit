import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  CapturingProcessRunner,
  ProcessCaptureOptions,
  ProcessCaptureResult,
} from '@repo-toolkit/publish-package';

import { resolveReleaseTagPlan, runPreflight, type ReleaseTagPlan } from '../src/index';

const FAKE_CWD = '/fake/workdir';
const TOKEN_CANARY = 'preflight-canary-token-1a2b3c-do-not-leak';
const FILE_TOKEN = 'preflight-file-token-4d5e6f-do-not-leak';
const ENV_TOKEN = 'preflight-env-token-7a8b9c-do-not-leak';
const EXPLICIT_TOKEN = 'preflight-explicit-token-0d1e2f-do-not-leak';

interface RecordedCapture {
  executable: string;
  args: ReadonlyArray<string>;
  options: ProcessCaptureOptions;
}

type CaptureHandler = (
  executable: string,
  args: ReadonlyArray<string>,
  options: ProcessCaptureOptions,
) => ProcessCaptureResult | Promise<ProcessCaptureResult>;

type FakeRunner = CapturingProcessRunner & { calls: RecordedCapture[] };

function createFakeRunner(handler: CaptureHandler): FakeRunner {
  const calls: RecordedCapture[] = [];
  return {
    calls,
    run() {
      throw new Error('unexpected run call: preflight must use capture only');
    },
    runShell() {
      throw new Error('unexpected runShell call: preflight must not invoke a shell');
    },
    async capture(executable, args, options) {
      calls.push({ executable, args: [...args], options });
      return handler(executable, args, options);
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

interface RecordedFetch {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  hasSignal: boolean;
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

function createRecordingFetch(handler: (index: number) => Response | Promise<Response>) {
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
      hasSignal: init?.signal instanceof AbortSignal,
    };
    const index = calls.length;
    calls.push(recorded);
    return handler(index);
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
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
  const dir = await mkdtemp(join(tmpdir(), 'release-tag-preflight-'));
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

function cleanEnv(): Record<string, undefined> {
  return { GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GIT_SSH_COMMAND: undefined };
}

function makePlan(overrides: Record<string, unknown> = {}): ReleaseTagPlan {
  return resolveReleaseTagPlan({ cwd: FAKE_CWD, timeoutMs: 1234, ...overrides });
}

describe('runPreflight input validation', () => {
  it('rejects non-object inputs', async () => {
    await expect(runPreflight('x' as unknown as Parameters<typeof runPreflight>[0])).rejects.toThrow(/input/);
    await expect(runPreflight({} as unknown as Parameters<typeof runPreflight>[0])).rejects.toThrow(/plan/);
    await expect(runPreflight({ plan: 'x' } as unknown as Parameters<typeof runPreflight>[0])).rejects.toThrow(/plan/);
  });

  it('rejects invalid explicit tokens', async () => {
    const plan = makePlan({ only: [] });
    await expect(runPreflight({ plan, githubToken: 42 as unknown as string })).rejects.toThrow(/githubToken/);
    await expect(runPreflight({ plan, githubToken: 'a\0b' })).rejects.toThrow(/NUL/);
  });
});

describe('runPreflight git check', () => {
  it('probes ls-remote with explicit args, cwd, timeout, and non-interactive env', async () => {
    await withEnv(cleanEnv(), async () => {
      const plan = makePlan({ githubRepository: 'octo/hello', skipPr: true });
      const runner = createFakeRunner(() => ok('f00dcafe HEAD\n'));
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const result = await runPreflight({ plan, runner, fetchFn });
      expect(result.git).toEqual({ name: 'git', skipped: false, skippedReason: null });
      expect(runner.calls).toHaveLength(1);
      expect(runner.calls[0]?.executable).toBe('git');
      expect(runner.calls[0]?.args).toEqual(['ls-remote', 'origin', 'HEAD']);
      expect(runner.calls[0]?.options.cwd).toBe(FAKE_CWD);
      expect(runner.calls[0]?.options.timeoutMs).toBe(1234);
      expect(runner.calls[0]?.options.env).toEqual({
        GIT_TERMINAL_PROMPT: '0',
        GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
      });
      expect(calls).toHaveLength(0);
    });
  });

  it('respects a preset GIT_SSH_COMMAND instead of overriding it', async () => {
    await withEnv({ ...cleanEnv(), GIT_SSH_COMMAND: 'ssh -i /keys/custom -o BatchMode=yes' }, async () => {
      const plan = makePlan({ githubRepository: 'octo/hello', skipPr: true });
      const runner = createFakeRunner(() => ok('f00dcafe HEAD\n'));
      const { fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const result = await runPreflight({ plan, runner, fetchFn });
      expect(result.git.skipped).toBe(false);
      expect(runner.calls[0]?.options.env).toEqual({ GIT_TERMINAL_PROMPT: '0' });
    });
  });

  it('treats an empty GIT_SSH_COMMAND as unset', async () => {
    await withEnv({ ...cleanEnv(), GIT_SSH_COMMAND: '' }, async () => {
      const plan = makePlan({ githubRepository: 'octo/hello', skipPr: true });
      const runner = createFakeRunner(() => ok('f00dcafe HEAD\n'));
      const { fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      await runPreflight({ plan, runner, fetchFn });
      expect(runner.calls[0]?.options.env).toEqual({
        GIT_TERMINAL_PROMPT: '0',
        GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
      });
    });
  });

  it('throws guidance on non-zero exit with a truncated stderr tail', async () => {
    await withEnv(cleanEnv(), async () => {
      const plan = makePlan({ githubRepository: 'octo/hello', skipPr: true });
      const runner = createFakeRunner(() => failed(128, '', 'git@github.com: Permission denied (publickey).'));
      const { fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const message = await errorMessage(runPreflight({ plan, runner, fetchFn }));
      expect(message).toContain('preflight failed');
      expect(message).toContain('git ls-remote origin HEAD');
      expect(message).toContain('Permission denied (publickey)');
      expect(message).toContain('ssh-agent');
      expect(message).toContain('BatchMode');
      expect(message).toContain('--skip-preflight');
      expect(message).toContain('release-tag#prerequisites');
    });
  });

  it('throws guidance on spawn errors', async () => {
    await withEnv(cleanEnv(), async () => {
      const plan = makePlan({ githubRepository: 'octo/hello', skipPr: true });
      const runner = createFakeRunner(() => spawnError('spawn git ENOENT'));
      const { fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const message = await errorMessage(runPreflight({ plan, runner, fetchFn }));
      expect(message).toContain('preflight failed');
      expect(message).toContain('spawn git ENOENT');
      expect(message).toContain('ssh-agent');
    });
  });

  it('truncates long stderr tails', async () => {
    await withEnv(cleanEnv(), async () => {
      const plan = makePlan({ githubRepository: 'octo/hello', skipPr: true });
      const runner = createFakeRunner(() => failed(128, '', `x${'y'.repeat(3000)}`));
      const { fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const message = await errorMessage(runPreflight({ plan, runner, fetchFn }));
      expect(message).toContain('...[truncated]');
      expect(message.length).toBeLessThan(4000);
    });
  });

  it('requires a capturing runner', async () => {
    await withEnv(cleanEnv(), async () => {
      const plan = makePlan({ githubRepository: 'octo/hello', skipPr: true });
      const bad = { run() {}, runShell() {}, capture: 'x' } as unknown as CapturingProcessRunner;
      const { fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      await expect(runPreflight({ plan, runner: bad, fetchFn })).rejects.toThrow(/CapturingProcessRunner/);
    });
  });

  it('prefers the explicit runner over the plan runner', async () => {
    await withEnv(cleanEnv(), async () => {
      const planRunner = createFakeRunner(() => {
        throw new Error('plan runner must not be used');
      });
      const plan = makePlan({ githubRepository: 'octo/hello', skipPr: true, runner: planRunner });
      const explicit = createFakeRunner(() => ok('f00dcafe HEAD\n'));
      const { fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const result = await runPreflight({ plan, runner: explicit, fetchFn });
      expect(result.git.skipped).toBe(false);
      expect(explicit.calls).toHaveLength(1);
      expect(planRunner.calls).toHaveLength(0);
    });
  });
});

describe('runPreflight token check', () => {
  it('passes on 200 with push permission and sends an exact GET request', async () => {
    await withEnv({ ...cleanEnv(), GITHUB_TOKEN: ENV_TOKEN }, async () => {
      const plan = makePlan({ githubRepository: 'octo/hello', only: ['determine', 'pr'] });
      const runner = createFakeRunner(() => {
        throw new Error('git must not be probed when release is unselected');
      });
      const { calls, fetchFn } = createRecordingFetch(() => makeResponse(200, { permissions: { push: true } }));
      const result = await runPreflight({ plan, runner, fetchFn });
      expect(result.token).toEqual({ name: 'token', skipped: false, skippedReason: null });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.method).toBe('GET');
      expect(calls[0]?.url).toBe('https://api.github.com/repos/octo/hello');
      expect(calls[0]?.body).toBeUndefined();
      expect(calls[0]?.hasSignal).toBe(true);
      expect(calls[0]?.headers['Accept']).toBe('application/vnd.github+json');
      expect(calls[0]?.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
      expect(calls[0]?.headers['User-Agent']).toBe('repo-toolkit-release-tag');
      expect(calls[0]?.headers['Authorization']).toBe(`Bearer ${ENV_TOKEN}`);
    });
  });

  it('resolves owner and repo from GITHUB_REPOSITORY', async () => {
    await withEnv({ ...cleanEnv(), GITHUB_TOKEN: ENV_TOKEN, GITHUB_REPOSITORY: 'env-owner/env-repo' }, async () => {
      const plan = makePlan({ only: ['determine', 'pr'] });
      const runner = createFakeRunner(() => {
        throw new Error('git must not be probed when release is unselected');
      });
      const { calls, fetchFn } = createRecordingFetch(() => makeResponse(200, { permissions: { push: true } }));
      const result = await runPreflight({ plan, runner, fetchFn });
      expect(result.token.skipped).toBe(false);
      expect(calls[0]?.url).toBe('https://api.github.com/repos/env-owner/env-repo');
    });
  });

  it('throws the stage-3 missing repository message when neither source is set', async () => {
    await withEnv({ ...cleanEnv(), GITHUB_TOKEN: ENV_TOKEN }, async () => {
      const plan = makePlan({ only: ['determine', 'pr'] });
      const runner = createFakeRunner(() => {
        throw new Error('git must not be probed when release is unselected');
      });
      const { calls, fetchFn } = createRecordingFetch(() => makeResponse(200, {}));
      const message = await errorMessage(runPreflight({ plan, runner, fetchFn }));
      expect(message).toBe('githubRepository is required (explicit --github-repository or GITHUB_REPOSITORY).');
      expect(calls).toHaveLength(0);
    });
  });

  it('throws permission guidance when push is false', async () => {
    await withEnv({ ...cleanEnv(), GITHUB_TOKEN: TOKEN_CANARY }, async () => {
      const plan = makePlan({ githubRepository: 'octo/hello', only: ['determine', 'pr'] });
      const runner = createFakeRunner(() => {
        throw new Error('git must not be probed when release is unselected');
      });
      const { fetchFn } = createRecordingFetch(() => makeResponse(200, { permissions: { push: false, pull: true } }));
      const message = await errorMessage(runPreflight({ plan, runner, fetchFn }));
      expect(message).toContain('preflight failed');
      expect(message).toContain('lacks push permission');
      expect(message).toContain('octo/hello');
      expect(message).toContain('Contents (read/write)');
      expect(message).toContain('--skip-preflight');
      expect(message).not.toContain(TOKEN_CANARY);
    });
  });

  it('throws permission guidance on auth failures with redaction', async () => {
    for (const status of [401, 403, 404]) {
      await withEnv({ ...cleanEnv(), GITHUB_TOKEN: TOKEN_CANARY }, async () => {
        const plan = makePlan({ githubRepository: 'octo/hello', only: ['determine', 'pr'] });
        const runner = createFakeRunner(() => {
          throw new Error('git must not be probed when release is unselected');
        });
        const { fetchFn } = createRecordingFetch(() => makeResponse(status, `denied ${TOKEN_CANARY}`));
        const message = await errorMessage(runPreflight({ plan, runner, fetchFn }));
        expect(message).toContain('preflight failed');
        expect(message).toContain(`status=${status}`);
        expect(message).toContain('Contents (read/write)');
        expect(message).toContain('404');
        expect(message).not.toContain(TOKEN_CANARY);
      });
    }
  });

  it('throws on invalid and non-object JSON with redaction', async () => {
    await withEnv({ ...cleanEnv(), GITHUB_TOKEN: TOKEN_CANARY }, async () => {
      const plan = makePlan({ githubRepository: 'octo/hello', only: ['determine', 'pr'] });
      const runner = createFakeRunner(() => {
        throw new Error('git must not be probed when release is unselected');
      });
      const malformed = createRecordingFetch(() => makeResponse(200, `not-json ${TOKEN_CANARY}`));
      const malformedMessage = await errorMessage(runPreflight({ plan, runner, fetchFn: malformed.fetchFn }));
      expect(malformedMessage).toContain('invalid JSON');
      expect(malformedMessage).not.toContain(TOKEN_CANARY);
      const shaped = createRecordingFetch(() => makeResponse(200, [1, 2, 3]));
      const shapedMessage = await errorMessage(runPreflight({ plan, runner, fetchFn: shaped.fetchFn }));
      expect(shapedMessage).toContain('unexpected shape');
    });
  });

  it('refuses oversized responses', async () => {
    await withEnv({ ...cleanEnv(), GITHUB_TOKEN: ENV_TOKEN }, async () => {
      const plan = makePlan({ githubRepository: 'octo/hello', only: ['determine', 'pr'], maxOutputBytes: 16 });
      const runner = createFakeRunner(() => {
        throw new Error('git must not be probed when release is unselected');
      });
      const { fetchFn } = createRecordingFetch(() => makeResponse(200, { permissions: { push: true } }));
      const message = await errorMessage(runPreflight({ plan, runner, fetchFn }));
      expect(message).toContain('exceeding');
    });
  });

  it('resolves tokens explicit over file over env', async () => {
    await withTempDir(async (dir) => {
      const tokenFile = join(dir, 'token.txt');
      await writeFile(tokenFile, `  ${FILE_TOKEN}\n`, 'utf8');
      await withEnv({ ...cleanEnv(), GITHUB_TOKEN: ENV_TOKEN }, async () => {
        const runner = () =>
          createFakeRunner(() => {
            throw new Error('git must not be probed when release is unselected');
          });
        const explicit = createRecordingFetch(() => makeResponse(200, { permissions: { push: true } }));
        await runPreflight({
          plan: makePlan({ githubRepository: 'octo/hello', only: ['determine', 'pr'] }),
          githubToken: EXPLICIT_TOKEN,
          runner: runner(),
          fetchFn: explicit.fetchFn,
        });
        expect(explicit.calls[0]?.headers['Authorization']).toBe(`Bearer ${EXPLICIT_TOKEN}`);
        const file = createRecordingFetch(() => makeResponse(200, { permissions: { push: true } }));
        await runPreflight({
          plan: makePlan({ githubRepository: 'octo/hello', only: ['determine', 'pr'], githubTokenFile: tokenFile }),
          runner: runner(),
          fetchFn: file.fetchFn,
        });
        expect(file.calls[0]?.headers['Authorization']).toBe(`Bearer ${FILE_TOKEN}`);
        const env = createRecordingFetch(() => makeResponse(200, { permissions: { push: true } }));
        await runPreflight({
          plan: makePlan({ githubRepository: 'octo/hello', only: ['determine', 'pr'] }),
          runner: runner(),
          fetchFn: env.fetchFn,
        });
        expect(env.calls[0]?.headers['Authorization']).toBe(`Bearer ${ENV_TOKEN}`);
      });
    });
  });

  it('throws on empty and unreadable token files without env fallback', async () => {
    await withTempDir(async (dir) => {
      const emptyFile = join(dir, 'empty.txt');
      await writeFile(emptyFile, '  \n', 'utf8');
      await withEnv({ ...cleanEnv(), GITHUB_TOKEN: ENV_TOKEN }, async () => {
        const runner = () =>
          createFakeRunner(() => {
            throw new Error('git must not be probed when release is unselected');
          });
        const empty = createRecordingFetch(() => makeResponse(200, {}));
        const emptyMessage = await errorMessage(
          runPreflight({
            plan: makePlan({ githubRepository: 'octo/hello', only: ['determine', 'pr'], githubTokenFile: emptyFile }),
            runner: runner(),
            fetchFn: empty.fetchFn,
          }),
        );
        expect(emptyMessage).toContain('is empty');
        expect(empty.calls).toHaveLength(0);
        const missing = createRecordingFetch(() => makeResponse(200, {}));
        const missingMessage = await errorMessage(
          runPreflight({
            plan: makePlan({
              githubRepository: 'octo/hello',
              only: ['determine', 'pr'],
              githubTokenFile: join(dir, 'absent.txt'),
            }),
            runner: runner(),
            fetchFn: missing.fetchFn,
          }),
        );
        expect(missingMessage).toContain('Failed to read githubTokenFile');
        expect(missing.calls).toHaveLength(0);
      });
    });
  });
});

describe('runPreflight skips', () => {
  it('skips both checks when skipPreflight is true with zero invocations', async () => {
    await withEnv({ ...cleanEnv(), GITHUB_TOKEN: ENV_TOKEN, GITHUB_REPOSITORY: 'octo/hello' }, async () => {
      const plan = makePlan({ skipPreflight: true });
      const runner = createFakeRunner(() => {
        throw new Error('must not invoke git');
      });
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('must not fetch');
      });
      const result = await runPreflight({ plan, githubToken: EXPLICIT_TOKEN, runner, fetchFn });
      expect(result).toEqual({
        git: { name: 'git', skipped: true, skippedReason: 'skipped via skipPreflight' },
        token: { name: 'token', skipped: true, skippedReason: 'skipped via skipPreflight' },
      });
      expect(runner.calls).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });
  });

  it('skips both checks in dry-run with zero invocations', async () => {
    await withEnv({ ...cleanEnv(), GITHUB_TOKEN: ENV_TOKEN, GITHUB_REPOSITORY: 'octo/hello' }, async () => {
      const plan = makePlan({ dryRun: true });
      const runner = createFakeRunner(() => {
        throw new Error('must not invoke git');
      });
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('must not fetch');
      });
      const result = await runPreflight({ plan, githubToken: EXPLICIT_TOKEN, runner, fetchFn });
      expect(result).toEqual({
        git: { name: 'git', skipped: true, skippedReason: 'dry-run' },
        token: { name: 'token', skipped: true, skippedReason: 'dry-run' },
      });
      expect(runner.calls).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });
  });

  it('skips git when release is unselected and token when pr is unselected', async () => {
    await withEnv({ ...cleanEnv(), GITHUB_TOKEN: ENV_TOKEN, GITHUB_REPOSITORY: 'octo/hello' }, async () => {
      const plan = makePlan({ only: ['determine'] });
      const runner = createFakeRunner(() => {
        throw new Error('must not invoke git');
      });
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('must not fetch');
      });
      const result = await runPreflight({ plan, runner, fetchFn });
      expect(result).toEqual({
        git: { name: 'git', skipped: true, skippedReason: 'stage not selected' },
        token: { name: 'token', skipped: true, skippedReason: 'stage not selected' },
      });
      expect(runner.calls).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });
  });

  it('runs git without fetch when pr is unselected', async () => {
    await withEnv({ ...cleanEnv(), GITHUB_TOKEN: ENV_TOKEN, GITHUB_REPOSITORY: 'octo/hello' }, async () => {
      const plan = makePlan({ only: ['determine', 'release'] });
      const runner = createFakeRunner(() => ok('f00dcafe HEAD\n'));
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('must not fetch');
      });
      const result = await runPreflight({ plan, runner, fetchFn });
      expect(result.git).toEqual({ name: 'git', skipped: false, skippedReason: null });
      expect(result.token).toEqual({ name: 'token', skipped: true, skippedReason: 'stage not selected' });
      expect(runner.calls).toHaveLength(1);
      expect(calls).toHaveLength(0);
    });
  });

  it('skips token when skipPr is true', async () => {
    await withEnv({ ...cleanEnv(), GITHUB_TOKEN: ENV_TOKEN, GITHUB_REPOSITORY: 'octo/hello' }, async () => {
      const plan = makePlan({ skipPr: true });
      const runner = createFakeRunner(() => ok('f00dcafe HEAD\n'));
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('must not fetch');
      });
      const result = await runPreflight({ plan, githubToken: EXPLICIT_TOKEN, runner, fetchFn });
      expect(result.git.skipped).toBe(false);
      expect(result.token).toEqual({ name: 'token', skipped: true, skippedReason: 'skipped via skipPr' });
      expect(calls).toHaveLength(0);
    });
  });

  it('skips token without fetch when no token is available', async () => {
    await withEnv(cleanEnv(), async () => {
      const plan = makePlan({ githubRepository: 'octo/hello' });
      const runner = createFakeRunner(() => ok('f00dcafe HEAD\n'));
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('must not fetch');
      });
      const result = await runPreflight({ plan, runner, fetchFn });
      expect(result.git.skipped).toBe(false);
      expect(result.token).toEqual({ name: 'token', skipped: true, skippedReason: 'github token not available' });
      expect(calls).toHaveLength(0);
    });
  });
});
