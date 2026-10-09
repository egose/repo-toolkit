import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createReleasePullRequest,
  formatPullRequestBody,
  resolveReleaseTagPlan,
  type DeterminedTag,
  type PullRequestResult,
  type ReleaseBranchResult,
  type ReleaseTagPlan,
} from '../src/index';

const TOKEN_CANARY = 'pr-canary-token-3f8a2c-do-not-leak';
const FILE_TOKEN = 'pr-file-token-7b1e9d-do-not-leak';
const ENV_TOKEN = 'pr-env-token-5c4a8f-do-not-leak';
const EXPLICIT_TOKEN = 'pr-explicit-token-9d2b6e-do-not-leak';

const DETERMINED: DeterminedTag = {
  version: '1.2.3',
  tagVersion: 'v1.2.3',
  bump: 'minor',
  lastTag: 'v1.2.2',
  manual: false,
};

const RELEASE: ReleaseBranchResult = {
  baseBranch: 'main',
  releaseBranch: 'changelog/1.2.3',
  releaseRan: true,
  skippedReason: null,
  tagMessage: 'Release 1.2.3 notes',
  prTitle: 'chore(release): release candidate v1.2.3',
};

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
      hasSignal: init?.signal instanceof AbortSignal,
    };
    const index = calls.length;
    calls.push(recorded);
    return handler(recorded, index);
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

function makePlan(options?: Parameters<typeof resolveReleaseTagPlan>[0]): ReleaseTagPlan {
  return resolveReleaseTagPlan({
    githubRepository: 'octo/hello',
    ...(options ?? {}),
  });
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
  const dir = await mkdtemp(join(tmpdir(), 'release-tag-pr-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return headers[key];
    }
  }
  return undefined;
}

function expectCanaryAbsent(value: string, canary: string): void {
  expect(value.includes(canary)).toBe(false);
}

describe('formatPullRequestBody', () => {
  it('renders the exact template with an empty tag message', () => {
    expect(formatPullRequestBody('')).toBe(
      '### Release Candidate Details\n\n\n\n---\n\n> This PR was automatically generated.',
    );
  });

  it('renders the exact template with a multiline tag message', () => {
    expect(formatPullRequestBody('line one\nline two')).toBe(
      '### Release Candidate Details\n\nline one\nline two\n\n---\n\n> This PR was automatically generated.',
    );
  });

  it('rejects non-string input', () => {
    expect(() => formatPullRequestBody(42 as unknown as string)).toThrowError('tagMessage must be a string');
  });
});

describe('createReleasePullRequest skips', () => {
  it('skips via skipPr with zero fetch calls', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan({ skipPr: true });
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const result = await createReleasePullRequest({
        plan,
        determined: DETERMINED,
        release: RELEASE,
        fetchFn,
      });
      expect(result).toEqual({
        skipped: true,
        skippedReason: 'skipped via skipPr',
        number: null,
        url: null,
        merged: false,
        branchDeleted: false,
      });
      expect(calls.length).toBe(0);
    });
  });

  it('skips when pr is not selected with zero fetch calls', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan({ only: ['determine', 'release'] });
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const result = await createReleasePullRequest({
        plan,
        determined: DETERMINED,
        release: RELEASE,
        fetchFn,
      });
      expect(result.skipped).toBe(true);
      expect(result.skippedReason).toBe('stage not selected');
      expect(calls.length).toBe(0);
    });
  });

  it('skips in dry-run with zero fetch calls', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan({ dryRun: true });
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const result = await createReleasePullRequest({
        plan,
        determined: DETERMINED,
        release: RELEASE,
        fetchFn,
      });
      expect(result.skipped).toBe(true);
      expect(result.skippedReason).toBe('dry-run');
      expect(calls.length).toBe(0);
    });
  });

  it('skips without a token with zero fetch calls', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan();
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error('fetch must not be called');
      });
      const result = await createReleasePullRequest({
        plan,
        determined: DETERMINED,
        release: RELEASE,
        fetchFn,
      });
      expect(result.skipped).toBe(true);
      expect(result.skippedReason).toBe('github token not available');
      expect(calls.length).toBe(0);
    });
  });
});

describe('createReleasePullRequest token resolution', () => {
  it('prefers explicit token over file and env', async () => {
    await withTempDir(async (dir) => {
      const tokenFile = join(dir, 'token.txt');
      await writeFile(tokenFile, `${FILE_TOKEN}\n`, 'utf8');
      await withEnv({ GITHUB_TOKEN: ENV_TOKEN }, async () => {
        const plan = makePlan({ cwd: dir, githubTokenFile: 'token.txt' });
        const { calls, fetchFn } = createRecordingFetch(() =>
          makeResponse(201, { number: 7, html_url: 'https://github.com/octo/hello/pull/7' }),
        );
        const result = await createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: RELEASE,
          githubToken: EXPLICIT_TOKEN,
          fetchFn,
        });
        expect(result.skipped).toBe(false);
        expect(headerValue(calls[0].headers, 'authorization')).toBe(`Bearer ${EXPLICIT_TOKEN}`);
        expectCanaryAbsent(JSON.stringify(result), EXPLICIT_TOKEN);
      });
    });
  });

  it('prefers file token over env', async () => {
    await withTempDir(async (dir) => {
      const tokenFile = join(dir, 'token.txt');
      await writeFile(tokenFile, `  ${FILE_TOKEN}  \n`, 'utf8');
      await withEnv({ GITHUB_TOKEN: ENV_TOKEN }, async () => {
        const plan = makePlan({ cwd: dir, githubTokenFile: 'token.txt' });
        const { calls, fetchFn } = createRecordingFetch(() =>
          makeResponse(201, { number: 8, html_url: 'https://github.com/octo/hello/pull/8' }),
        );
        const result = await createReleasePullRequest({ plan, determined: DETERMINED, release: RELEASE, fetchFn });
        expect(result.skipped).toBe(false);
        expect(headerValue(calls[0].headers, 'authorization')).toBe(`Bearer ${FILE_TOKEN}`);
        expectCanaryAbsent(JSON.stringify(result), FILE_TOKEN);
      });
    });
  });

  it('uses env token when no explicit or file token exists', async () => {
    await withEnv({ GITHUB_TOKEN: ENV_TOKEN }, async () => {
      const plan = makePlan();
      const { calls, fetchFn } = createRecordingFetch(() =>
        makeResponse(201, { number: 9, html_url: 'https://github.com/octo/hello/pull/9' }),
      );
      const result = await createReleasePullRequest({ plan, determined: DETERMINED, release: RELEASE, fetchFn });
      expect(result.skipped).toBe(false);
      expect(headerValue(calls[0].headers, 'authorization')).toBe(`Bearer ${ENV_TOKEN}`);
      expectCanaryAbsent(JSON.stringify(result), ENV_TOKEN);
    });
  });

  it('uses a custom token env name', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, CUSTOM_PR_TOKEN: ENV_TOKEN }, async () => {
      const plan = makePlan({ githubTokenEnv: 'CUSTOM_PR_TOKEN' });
      const { calls, fetchFn } = createRecordingFetch(() =>
        makeResponse(201, { number: 10, html_url: 'https://github.com/octo/hello/pull/10' }),
      );
      const result = await createReleasePullRequest({ plan, determined: DETERMINED, release: RELEASE, fetchFn });
      expect(result.skipped).toBe(false);
      expect(headerValue(calls[0].headers, 'authorization')).toBe(`Bearer ${ENV_TOKEN}`);
    });
  });

  it('throws on an empty token file without falling back', async () => {
    await withTempDir(async (dir) => {
      const tokenFile = join(dir, 'token.txt');
      await writeFile(tokenFile, '  \n', 'utf8');
      await withEnv({ GITHUB_TOKEN: ENV_TOKEN }, async () => {
        const plan = makePlan({ cwd: dir, githubTokenFile: 'token.txt' });
        const { calls, fetchFn } = createRecordingFetch(() => makeResponse(201, { number: 1, html_url: 'x' }));
        await expect(
          createReleasePullRequest({ plan, determined: DETERMINED, release: RELEASE, fetchFn }),
        ).rejects.toThrowError(/is empty/);
        expect(calls.length).toBe(0);
      });
    });
  });

  it('throws when the token file cannot be read', async () => {
    await withTempDir(async (dir) => {
      await withEnv({ GITHUB_TOKEN: undefined }, async () => {
        const plan = makePlan({ cwd: dir, githubTokenFile: 'missing.txt' });
        const { calls, fetchFn } = createRecordingFetch(() => makeResponse(201, { number: 1, html_url: 'x' }));
        await expect(
          createReleasePullRequest({ plan, determined: DETERMINED, release: RELEASE, fetchFn }),
        ).rejects.toThrowError(/Failed to read githubTokenFile/);
        expect(calls.length).toBe(0);
      });
    });
  });

  it('rejects a non-string explicit token', async () => {
    await withEnv({ GITHUB_TOKEN: undefined }, async () => {
      const plan = makePlan();
      const { calls, fetchFn } = createRecordingFetch(() => makeResponse(201, { number: 1, html_url: 'x' }));
      await expect(
        createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: RELEASE,
          githubToken: 42 as unknown as string,
          fetchFn,
        }),
      ).rejects.toThrowError('githubToken must be a string');
      expect(calls.length).toBe(0);
    });
  });
});

describe('createReleasePullRequest repository resolution', () => {
  it('prefers explicit repository over GITHUB_REPOSITORY', async () => {
    await withEnv({ GITHUB_REPOSITORY: 'env-owner/env-repo' }, async () => {
      const plan = makePlan({ githubRepository: 'octo/hello' });
      const { calls, fetchFn } = createRecordingFetch(() =>
        makeResponse(201, { number: 11, html_url: 'https://github.com/octo/hello/pull/11' }),
      );
      await createReleasePullRequest({
        plan,
        determined: DETERMINED,
        release: RELEASE,
        githubToken: TOKEN_CANARY,
        fetchFn,
      });
      expect(calls[0].url).toBe('https://api.github.com/repos/octo/hello/pulls');
    });
  });

  it('uses GITHUB_REPOSITORY when no explicit repository exists', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: 'env-owner/env-repo' }, async () => {
      const plan = resolveReleaseTagPlan({});
      const { calls, fetchFn } = createRecordingFetch(() =>
        makeResponse(201, { number: 12, html_url: 'https://github.com/env-owner/env-repo/pull/12' }),
      );
      await createReleasePullRequest({
        plan,
        determined: DETERMINED,
        release: RELEASE,
        githubToken: TOKEN_CANARY,
        fetchFn,
      });
      expect(calls[0].url).toBe('https://api.github.com/repos/env-owner/env-repo/pulls');
    });
  });

  it('throws when no repository is configured', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = resolveReleaseTagPlan({});
      const { calls, fetchFn } = createRecordingFetch(() => makeResponse(201, { number: 1, html_url: 'x' }));
      await expect(
        createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: RELEASE,
          githubToken: TOKEN_CANARY,
          fetchFn,
        }),
      ).rejects.toThrowError('githubRepository is required (explicit --github-repository or GITHUB_REPOSITORY).');
      expect(calls.length).toBe(0);
    });
  });

  it('throws on a malformed GITHUB_REPOSITORY', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: 'owner/repo/extra' }, async () => {
      const plan = resolveReleaseTagPlan({});
      const { calls, fetchFn } = createRecordingFetch(() => makeResponse(201, { number: 1, html_url: 'x' }));
      await expect(
        createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: RELEASE,
          githubToken: TOKEN_CANARY,
          fetchFn,
        }),
      ).rejects.toThrowError(/owner\/repo/);
      expect(calls.length).toBe(0);
    });
  });
});

describe('createReleasePullRequest success paths', () => {
  it('creates a PR and applies labels with exact shapes and headers', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan();
      const { calls, fetchFn } = createRecordingFetch((call, index) => {
        if (index === 0) {
          return makeResponse(201, { number: 42, html_url: 'https://github.com/octo/hello/pull/42' });
        }
        return makeResponse(200, [{ name: 'changelog' }]);
      });
      const result: PullRequestResult = await createReleasePullRequest({
        plan,
        determined: DETERMINED,
        release: RELEASE,
        githubToken: TOKEN_CANARY,
        fetchFn,
      });
      expect(result).toEqual({
        skipped: false,
        skippedReason: null,
        number: 42,
        url: 'https://github.com/octo/hello/pull/42',
        merged: false,
        branchDeleted: false,
      });
      expect(calls.length).toBe(2);

      expect(calls[0].url).toBe('https://api.github.com/repos/octo/hello/pulls');
      expect(calls[0].method).toBe('POST');
      expect(headerValue(calls[0].headers, 'accept')).toBe('application/vnd.github+json');
      expect(headerValue(calls[0].headers, 'x-github-api-version')).toBe('2022-11-28');
      expect(headerValue(calls[0].headers, 'user-agent')).toBe('repo-toolkit-release-tag');
      expect(headerValue(calls[0].headers, 'content-type')).toBe('application/json');
      expect(headerValue(calls[0].headers, 'authorization')).toBe(`Bearer ${TOKEN_CANARY}`);
      expect(calls[0].hasSignal).toBe(true);
      const createPayload = JSON.parse(calls[0].body ?? '{}') as Record<string, unknown>;
      expect(createPayload).toEqual({
        head: 'changelog/1.2.3',
        base: 'main',
        title: 'chore(release): release candidate v1.2.3',
        body: '### Release Candidate Details\n\nRelease 1.2.3 notes\n\n---\n\n> This PR was automatically generated.',
      });

      expect(calls[1].url).toBe('https://api.github.com/repos/octo/hello/issues/42/labels');
      expect(calls[1].method).toBe('POST');
      expect(headerValue(calls[1].headers, 'authorization')).toBe(`Bearer ${TOKEN_CANARY}`);
      const labelsPayload = JSON.parse(calls[1].body ?? '{}') as Record<string, unknown>;
      expect(labelsPayload).toEqual({ labels: ['changelog', 'release-candidate', 'v1.2.3'] });

      expectCanaryAbsent(JSON.stringify(result), TOKEN_CANARY);
    });
  });

  it('trims trailing slashes from a custom API base URL', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan({ githubApiUrl: 'https://ghes.example.com/api/v3///' });
      const { calls, fetchFn } = createRecordingFetch(() =>
        makeResponse(201, { number: 43, html_url: 'https://ghes.example.com/octo/hello/pull/43' }),
      );
      await createReleasePullRequest({
        plan,
        determined: DETERMINED,
        release: RELEASE,
        githubToken: TOKEN_CANARY,
        fetchFn,
      });
      expect(calls[0].url).toBe('https://ghes.example.com/api/v3/repos/octo/hello/pulls');
    });
  });

  it('merges on autoMergePr and deletes the branch when both flags are set', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan({ autoMergePr: true, deleteMergedBranch: true });
      const { calls, fetchFn } = createRecordingFetch((call, index) => {
        if (index === 0) {
          return makeResponse(201, { number: 44, html_url: 'https://github.com/octo/hello/pull/44' });
        }
        if (index === 1) {
          return makeResponse(200, []);
        }
        if (index === 2) {
          return makeResponse(200, { merged: true });
        }
        return makeResponse(204, '');
      });
      const result = await createReleasePullRequest({
        plan,
        determined: DETERMINED,
        release: RELEASE,
        githubToken: TOKEN_CANARY,
        fetchFn,
      });
      expect(result.merged).toBe(true);
      expect(result.branchDeleted).toBe(true);
      expect(calls.length).toBe(4);
      expect(calls[2].url).toBe('https://api.github.com/repos/octo/hello/pulls/44/merge');
      expect(calls[2].method).toBe('PUT');
      expect(JSON.parse(calls[2].body ?? '{}')).toEqual({ merge_method: 'merge' });
      expect(calls[3].url).toBe('https://api.github.com/repos/octo/hello/git/refs/heads/changelog/1.2.3');
      expect(calls[3].method).toBe('DELETE');
      expect(calls[3].body).toBeUndefined();
    });
  });

  it('ignores deleteMergedBranch when autoMergePr is false', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan({ autoMergePr: false, deleteMergedBranch: true });
      const { calls, fetchFn } = createRecordingFetch((call, index) => {
        if (index === 0) {
          return makeResponse(201, { number: 45, html_url: 'https://github.com/octo/hello/pull/45' });
        }
        return makeResponse(200, []);
      });
      const result = await createReleasePullRequest({
        plan,
        determined: DETERMINED,
        release: RELEASE,
        githubToken: TOKEN_CANARY,
        fetchFn,
      });
      expect(result.merged).toBe(false);
      expect(result.branchDeleted).toBe(false);
      expect(calls.length).toBe(2);
    });
  });

  it('keeps the branch when only autoMergePr is set', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan({ autoMergePr: true, deleteMergedBranch: false });
      const { calls, fetchFn } = createRecordingFetch((call, index) => {
        if (index === 0) {
          return makeResponse(201, { number: 46, html_url: 'https://github.com/octo/hello/pull/46' });
        }
        if (index === 1) {
          return makeResponse(200, []);
        }
        return makeResponse(200, { merged: true });
      });
      const result = await createReleasePullRequest({
        plan,
        determined: DETERMINED,
        release: RELEASE,
        githubToken: TOKEN_CANARY,
        fetchFn,
      });
      expect(result.merged).toBe(true);
      expect(result.branchDeleted).toBe(false);
      expect(calls.length).toBe(3);
    });
  });

  it('accepts a 200 create response', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan();
      const { calls, fetchFn } = createRecordingFetch((call, index) => {
        if (index === 0) {
          return makeResponse(200, { number: 47, html_url: 'https://github.com/octo/hello/pull/47' });
        }
        return makeResponse(200, []);
      });
      const result = await createReleasePullRequest({
        plan,
        determined: DETERMINED,
        release: RELEASE,
        githubToken: TOKEN_CANARY,
        fetchFn,
      });
      expect(result.number).toBe(47);
      expect(calls.length).toBe(2);
    });
  });
});

describe('createReleasePullRequest failures', () => {
  it('redacts the token on create failure with truncated diagnostics', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan();
      const longBody = `bad credentials for ${TOKEN_CANARY} ` + 'x'.repeat(5000);
      const { calls, fetchFn } = createRecordingFetch(() => makeResponse(401, longBody));
      let message = '';
      try {
        await createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: RELEASE,
          githubToken: TOKEN_CANARY,
          fetchFn,
        });
        expect.unreachable('expected create to throw');
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message.includes('status=401')).toBe(true);
      expectCanaryAbsent(message, TOKEN_CANARY);
      expect(message.includes('[redacted]')).toBe(true);
      expect(message.length).toBeLessThan(longBody.length);
      expect(calls.length).toBe(1);
    });
  });

  it('throws on a 422 create failure without retrying', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan();
      const { calls, fetchFn } = createRecordingFetch(() =>
        makeResponse(422, { message: 'Validation Failed', errors: [{ code: 'custom' }] }),
      );
      await expect(
        createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: RELEASE,
          githubToken: TOKEN_CANARY,
          fetchFn,
        }),
      ).rejects.toThrowError(/status=422/);
      expect(calls.length).toBe(1);
    });
  });

  it('throws when the create payload misses number or html_url', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan();
      const missingNumber = createRecordingFetch(() => makeResponse(201, { html_url: 'https://x/pull/1' }));
      await expect(
        createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: RELEASE,
          githubToken: TOKEN_CANARY,
          fetchFn: missingNumber.fetchFn,
        }),
      ).rejects.toThrowError(/numeric pull request number/);
      expect(missingNumber.calls.length).toBe(1);

      const missingUrl = createRecordingFetch(() => makeResponse(201, { number: 50 }));
      await expect(
        createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: RELEASE,
          githubToken: TOKEN_CANARY,
          fetchFn: missingUrl.fetchFn,
        }),
      ).rejects.toThrowError(/html_url/);
      expect(missingUrl.calls.length).toBe(1);
    });
  });

  it('throws on non-JSON create responses', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan();
      const { calls, fetchFn } = createRecordingFetch(() => makeResponse(201, '<html>not json'));
      await expect(
        createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: RELEASE,
          githubToken: TOKEN_CANARY,
          fetchFn,
        }),
      ).rejects.toThrowError(/not valid JSON/);
      expect(calls.length).toBe(1);
    });
  });

  it('throws on labels failure without proceeding', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan({ autoMergePr: true, deleteMergedBranch: true });
      const { calls, fetchFn } = createRecordingFetch((call, index) => {
        if (index === 0) {
          return makeResponse(201, { number: 51, html_url: 'https://github.com/octo/hello/pull/51' });
        }
        return makeResponse(403, { message: 'forbidden' });
      });
      await expect(
        createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: RELEASE,
          githubToken: TOKEN_CANARY,
          fetchFn,
        }),
      ).rejects.toThrowError(/POST labels/);
      expect(calls.length).toBe(2);
    });
  });

  it('throws on merge failure without deleting the branch', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan({ autoMergePr: true, deleteMergedBranch: true });
      const { calls, fetchFn } = createRecordingFetch((call, index) => {
        if (index === 0) {
          return makeResponse(201, { number: 52, html_url: 'https://github.com/octo/hello/pull/52' });
        }
        if (index === 1) {
          return makeResponse(200, []);
        }
        return makeResponse(405, { message: 'not mergeable' });
      });
      await expect(
        createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: RELEASE,
          githubToken: TOKEN_CANARY,
          fetchFn,
        }),
      ).rejects.toThrowError(/PUT merge/);
      expect(calls.length).toBe(3);
    });
  });

  it('throws on branch-delete failure', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan({ autoMergePr: true, deleteMergedBranch: true });
      const { calls, fetchFn } = createRecordingFetch((call, index) => {
        if (index === 0) {
          return makeResponse(201, { number: 53, html_url: 'https://github.com/octo/hello/pull/53' });
        }
        if (index === 1) {
          return makeResponse(200, []);
        }
        if (index === 2) {
          return makeResponse(200, { merged: true });
        }
        return makeResponse(422, { message: 'no such ref' });
      });
      await expect(
        createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: RELEASE,
          githubToken: TOKEN_CANARY,
          fetchFn,
        }),
      ).rejects.toThrowError(/DELETE ref/);
      expect(calls.length).toBe(4);
    });
  });

  it('refuses oversized responses', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan({ maxOutputBytes: 16 });
      const { calls, fetchFn } = createRecordingFetch(() =>
        makeResponse(201, { number: 54, html_url: 'https://github.com/octo/hello/pull/54', pad: 'x'.repeat(100) }),
      );
      let message = '';
      try {
        await createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: RELEASE,
          githubToken: TOKEN_CANARY,
          fetchFn,
        });
        expect.unreachable('expected oversized response to throw');
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message.includes('exceeding the 16-byte response limit')).toBe(true);
      expectCanaryAbsent(message, TOKEN_CANARY);
      expect(calls.length).toBe(1);
    });
  });

  it('surfaces timeout aborts with redaction', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan({ timeoutMs: 5 });
      const { calls, fetchFn } = createRecordingFetch(() => {
        const error = new Error(`network stalled with ${TOKEN_CANARY}`);
        error.name = 'AbortError';
        throw error;
      });
      let message = '';
      try {
        await createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: RELEASE,
          githubToken: TOKEN_CANARY,
          fetchFn,
        });
        expect.unreachable('expected abort to throw');
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message.includes('timed out after 5ms')).toBe(true);
      expectCanaryAbsent(message, TOKEN_CANARY);
      expect(calls.length).toBe(1);
    });
  });

  it('aborts the request signal after timeoutMs', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan({ timeoutMs: 10 });
      let observed: AbortSignal | undefined;
      const waitingFetch = (async (_url: unknown, init?: { signal?: unknown }) => {
        const signal = init?.signal;
        if (!(signal instanceof AbortSignal)) {
          throw new Error('expected an AbortSignal');
        }
        observed = signal;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('signal did not abort')), 1000);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
        });
        throw new Error('unreachable');
      }) as unknown as typeof fetch;
      await expect(
        createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: RELEASE,
          githubToken: TOKEN_CANARY,
          fetchFn: waitingFetch,
        }),
      ).rejects.toThrowError(/timed out after 10ms/);
      expect(observed instanceof AbortSignal).toBe(true);
    });
  });

  it('wraps network failures with redaction', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const plan = makePlan();
      const { calls, fetchFn } = createRecordingFetch(() => {
        throw new Error(`socket hangup ${TOKEN_CANARY}`);
      });
      let message = '';
      try {
        await createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: RELEASE,
          githubToken: TOKEN_CANARY,
          fetchFn,
        });
        expect.unreachable('expected network failure to throw');
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message.includes('POST pulls')).toBe(true);
      expectCanaryAbsent(message, TOKEN_CANARY);
      expect(calls.length).toBe(1);
    });
  });
});

describe('createReleasePullRequest input validation', () => {
  it('rejects non-object inputs', async () => {
    await expect(createReleasePullRequest(42 as unknown as never)).rejects.toThrowError('input must be an object');
  });

  it('uses the plan fetchFn when no input fetchFn is given', async () => {
    await withEnv({ GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined }, async () => {
      const { calls, fetchFn } = createRecordingFetch(() =>
        makeResponse(201, { number: 55, html_url: 'https://github.com/octo/hello/pull/55' }),
      );
      const plan = makePlan({ fetchFn });
      const result = await createReleasePullRequest({
        plan,
        determined: DETERMINED,
        release: RELEASE,
        githubToken: TOKEN_CANARY,
      });
      expect(result.number).toBe(55);
      expect(calls.length).toBe(2);
    });
  });
});
