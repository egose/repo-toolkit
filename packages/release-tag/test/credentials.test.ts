import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_TOKEN_FILE_BYTES } from '../src/credentials';
import {
  createReleasePullRequest,
  determineNextTag,
  resolveReleaseTagPlan,
  runPreflight,
  runReleaseBranch,
  runReleaseTag,
  type ReleaseTagOptions,
} from '../src/index';
import { resolveReleaseBranchRefs } from '../src/release';
import { createReleaseRunner, RELEASED_HEAD } from './release-fixture';
import { makeResponse, successfulGitHubResponse } from './http-fixture';
import {
  caughtError,
  DETERMINED,
  ENV_TOKEN,
  EXPLICIT_TOKEN,
  expectSecretFree,
  FILE_TOKEN,
  RELEASE,
  unsafeError,
} from './security-fixture';

vi.mock('node:fs/promises', async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }));

const ROTATED_TOKEN = 'boundary-rotated-secret-6d4c2a';
const CUSTOM_ENV = 'RELEASE_TAG_BOUNDARY_TOKEN';

beforeEach(() => {
  for (const name of [
    'GITHUB_TOKEN',
    CUSTOM_ENV,
    'GITHUB_API_URL',
    'GITHUB_REPOSITORY',
    'GITHUB_REF_NAME',
    'GITHUB_REF_TYPE',
    'GITHUB_REF',
    'GIT_SSH_COMMAND',
    'GIT_SSH',
  ]) {
    vi.stubEnv(name, undefined);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function withDirectory(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'release-tag-credential-'));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function options(overrides: ReleaseTagOptions = {}): ReleaseTagOptions {
  return {
    cwd: tmpdir(),
    tag: '1.2.3',
    baseBranch: 'main',
    githubRepository: 'octo/repo',
    releaseCommand: 'controlled-release',
    ...overrides,
  };
}

function successfulFetch() {
  return vi.fn<typeof fetch>(async (url, init) =>
    successfulGitHubResponse(url, init, { repository: 'octo/repo', number: 7 }),
  );
}

describe('bounded credential files and strict precedence', () => {
  it('accepts a trimmed token at the exact 64 KiB file cap and closes the file', async () => {
    await withDirectory(async (dir) => {
      await fs.writeFile(join(dir, 'token'), FILE_TOKEN.padEnd(MAX_TOKEN_FILE_BYTES, ' '));
      const open = vi.spyOn(fs, 'open');
      const fetchFn = successfulFetch();
      const result = await runPreflight({
        plan: resolveReleaseTagPlan(options({ cwd: dir, only: ['pr'], githubTokenFile: 'token' })),
        fetchFn,
      });
      expect(result.token.skipped).toBe(false);
      expect(fetchFn.mock.calls[0][1]?.headers).toMatchObject({ Authorization: `Bearer ${FILE_TOKEN}` });
      expect(open).toHaveBeenCalledOnce();
      expect((await open.mock.results[0].value).fd).toBe(-1);
      expectSecretFree(result);
    });
  });

  it('rejects an oversized file before reading its contents and never falls back to env', async () => {
    await withDirectory(async (dir) => {
      vi.stubEnv('GITHUB_TOKEN', ENV_TOKEN);
      await fs.writeFile(join(dir, 'token'), FILE_TOKEN.padEnd(MAX_TOKEN_FILE_BYTES + 1, ' '));
      const originalOpen = fs.open;
      const reads = vi.fn();
      const open = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
        const file = await originalOpen(...args);
        const read = file.read.bind(file);
        vi.spyOn(file, 'read').mockImplementation((...input: Parameters<typeof read>) => {
          reads();
          return read(...input);
        });
        return file;
      });
      const fetchFn = successfulFetch();
      const error = await caughtError(
        runPreflight({
          plan: resolveReleaseTagPlan(options({ cwd: dir, only: ['pr'], githubTokenFile: 'token' })),
          fetchFn,
        }),
      );
      expect(error.message).toContain('65536-byte limit');
      expect(reads).not.toHaveBeenCalled();
      expect((await open.mock.results[0].value).fd).toBe(-1);
      expect(fetchFn).not.toHaveBeenCalled();
      expectSecretFree(error);
    });
  });

  it('reads at most cap plus one byte when a regular file grows after stat', async () => {
    await withDirectory(async (dir) => {
      const path = join(dir, 'token');
      await fs.writeFile(path, FILE_TOKEN);
      const originalOpen = fs.open;
      let bytesRead = 0;
      const open = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
        const file = await originalOpen(...args);
        const stat = file.stat.bind(file);
        const read = file.read.bind(file);
        vi.spyOn(file, 'stat').mockImplementation(async () => {
          const info = await stat();
          await fs.appendFile(path, Buffer.alloc(MAX_TOKEN_FILE_BYTES * 8, 120));
          return info;
        });
        vi.spyOn(file, 'read').mockImplementation(async (...input: Parameters<typeof read>) => {
          const result = await read(...input);
          bytesRead += result.bytesRead;
          return result;
        });
        return file;
      });
      const fetchFn = successfulFetch();
      const error = await caughtError(
        runPreflight({
          plan: resolveReleaseTagPlan(options({ cwd: dir, only: ['pr'], githubTokenFile: 'token' })),
          fetchFn,
        }),
      );
      expect(error.message).toContain('65536-byte limit');
      expect(bytesRead).toBe(MAX_TOKEN_FILE_BYTES + 1);
      expect((await open.mock.results[0].value).fd).toBe(-1);
      expect(fetchFn).not.toHaveBeenCalled();
      expectSecretFree(error);
    });
  });

  it.each(['directory', 'fifo'] as const)('rejects a %s without blocking or env fallback', async (kind) => {
    await withDirectory(async (dir) => {
      vi.stubEnv('GITHUB_TOKEN', ENV_TOKEN);
      const path = join(dir, kind);
      if (kind === 'directory') {
        await fs.mkdir(path);
      } else {
        execFileSync('mkfifo', ['--', path], { cwd: dir, timeout: 1000 });
      }
      const fetchFn = successfulFetch();
      const started = performance.now();
      const error = await caughtError(
        runPreflight({
          plan: resolveReleaseTagPlan(options({ cwd: dir, only: ['pr'], githubTokenFile: kind })),
          fetchFn,
        }),
      );
      expect(performance.now() - started).toBeLessThan(1000);
      expect(error.message).toContain('regular file');
      expect(fetchFn).not.toHaveBeenCalled();
      expectSecretFree(error);
    });
  });

  it.each([
    ['', /empty/],
    [' \r\n\t', /empty/],
    [`${FILE_TOKEN}\0`, /NUL/],
    [`${FILE_TOKEN}\nsecond-token`, /bearer token/],
    [`${FILE_TOKEN}\tother`, /bearer token/],
    [`${FILE_TOKEN}\u007f`, /bearer token/],
    [`${FILE_TOKEN}é`, /ASCII/],
    [`${FILE_TOKEN}:other`, /bearer token/],
    [Buffer.from([255, 254]), /ASCII/],
  ] as const)('rejects invalid file contents case %# without env fallback', async (contents, expected) => {
    await withDirectory(async (dir) => {
      vi.stubEnv('GITHUB_TOKEN', ENV_TOKEN);
      await fs.writeFile(join(dir, 'token'), contents);
      const fetchFn = successfulFetch();
      const error = await caughtError(
        createReleasePullRequest({
          plan: resolveReleaseTagPlan(options({ cwd: dir, githubTokenFile: 'token' })),
          determined: DETERMINED,
          release: RELEASE,
          fetchFn,
        }),
      );
      expect(error.message).toMatch(expected);
      expect(fetchFn).not.toHaveBeenCalled();
      expectSecretFree(error);
    });
  });

  it.each(['open', 'read', 'close'] as const)(
    'discards token-bearing %s errors and unsafe causes',
    async (operation) => {
      await withDirectory(async (dir) => {
        await fs.writeFile(join(dir, 'token'), FILE_TOKEN);
        const originalOpen = fs.open;
        const open = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
          if (operation === 'open') {
            throw unsafeError(`native failure ${FILE_TOKEN}`);
          }
          const file = await originalOpen(...args);
          if (operation === 'read') {
            vi.spyOn(file, 'read').mockRejectedValue(unsafeError(`native read ${FILE_TOKEN}`));
          } else {
            const close = file.close.bind(file);
            vi.spyOn(file, 'close').mockImplementation(async () => {
              await close();
              throw unsafeError(`native close ${FILE_TOKEN}`);
            });
          }
          return file;
        });
        const fetchFn = successfulFetch();
        const error = await caughtError(
          runPreflight({
            plan: resolveReleaseTagPlan(options({ cwd: dir, only: ['pr'], githubTokenFile: 'token' })),
            fetchFn,
          }),
        );
        expect(error.message).toContain('githubTokenFile');
        if (operation !== 'open') {
          expect((await open.mock.results[0].value).fd).toBe(-1);
        }
        expectSecretFree(error);
        expect(fetchFn).not.toHaveBeenCalled();
      });
    },
  );

  it('does not expose credential paths in missing-file errors', async () => {
    await withDirectory(async (dir) => {
      const fetchFn = successfulFetch();
      const error = await caughtError(
        runPreflight({
          plan: resolveReleaseTagPlan(options({ cwd: dir, only: ['pr'], githubTokenFile: `missing-${FILE_TOKEN}` })),
          fetchFn,
        }),
      );
      expect(error.message).toContain('Failed to read githubTokenFile (ENOENT)');
      expectSecretFree(error);
      expect(fetchFn).not.toHaveBeenCalled();
    });
  });

  it('gives explicit tokens precedence without opening even an invalid file', async () => {
    vi.stubEnv('GITHUB_TOKEN', ENV_TOKEN);
    const open = vi.spyOn(fs, 'open');
    const fetchFn = successfulFetch();
    await runPreflight({
      plan: resolveReleaseTagPlan(options({ only: ['pr'], githubTokenFile: 'absent-token' })),
      githubToken: EXPLICIT_TOKEN,
      fetchFn,
    });
    expect(open).not.toHaveBeenCalled();
    expect(fetchFn.mock.calls[0][1]?.headers).toMatchObject({ Authorization: `Bearer ${EXPLICIT_TOKEN}` });
  });

  it.each([
    '',
    ' ',
    `${EXPLICIT_TOKEN}\r\ninjected`,
    `${EXPLICIT_TOKEN}\tother`,
    `${EXPLICIT_TOKEN}\u007f`,
    `${EXPLICIT_TOKEN}é`,
  ])('refuses invalid explicit header tokens case %# without fallback', async (token) => {
    vi.stubEnv('GITHUB_TOKEN', ENV_TOKEN);
    const open = vi.spyOn(fs, 'open');
    const fetchFn = successfulFetch();
    const error = await caughtError(
      createReleasePullRequest({
        plan: resolveReleaseTagPlan(options({ githubTokenFile: 'absent-token' })),
        determined: DETERMINED,
        release: RELEASE,
        githubToken: token,
        fetchFn,
      }),
    );
    expect(error.message).toContain('githubToken');
    expect(open).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expectSecretFree(error);
  });

  it('rejects invalid custom-env token bytes without falling back to GITHUB_TOKEN', async () => {
    vi.stubEnv('GITHUB_TOKEN', ENV_TOKEN);
    vi.stubEnv(CUSTOM_ENV, `${EXPLICIT_TOKEN}\nother`);
    const fetchFn = successfulFetch();
    const error = await caughtError(
      runPreflight({ plan: resolveReleaseTagPlan(options({ only: ['pr'], githubTokenEnv: CUSTOM_ENV })), fetchFn }),
    );
    expect(error.message).toContain(CUSTOM_ENV);
    expect(fetchFn).not.toHaveBeenCalled();
    expectSecretFree(error);
  });
});

describe('private lazy credential context', () => {
  it.each([false, true])(
    'uses the file token once across preflight, release, PR and later errors (failure=%s)',
    async (failure) => {
      await withDirectory(async (dir) => {
        vi.stubEnv('GITHUB_TOKEN', ENV_TOKEN);
        const path = join(dir, 'token');
        await fs.writeFile(path, FILE_TOKEN);
        const open = vi.spyOn(fs, 'open');
        const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
          expect(init?.headers).toMatchObject({ Authorization: `Bearer ${FILE_TOKEN}` });
          if (String(_url).endsWith('/repos/octo/repo')) {
            await fs.writeFile(path, ROTATED_TOKEN);
            return makeResponse(200, { permissions: { push: true } });
          }
          if (failure && String(_url).endsWith('/labels')) {
            return makeResponse(403, `${FILE_TOKEN} ${ENV_TOKEN}`);
          }
          return successfulGitHubResponse(_url, init, {
            repository: 'octo/repo',
            number: 7,
            url: `https://github.com/octo/repo/pull/7?token=${FILE_TOKEN}`,
          });
        });
        const runner = createReleaseRunner({ tagMessage: `annotation ${FILE_TOKEN} ${ENV_TOKEN}` });
        const promise = runReleaseTag(options({ cwd: dir, githubTokenFile: 'token', runner, fetchFn }));
        if (failure) {
          const error = await caughtError(promise);
          expect(error.message).toContain('status=403');
          expectSecretFree(error);
        } else {
          const result = await promise;
          expect(result.release?.tagMessage).toBe('annotation [redacted] [redacted]');
          expect(result.pullRequest?.url).toContain('[redacted]');
          expectSecretFree(result);
        }
        expect(open).toHaveBeenCalledOnce();
        expect(fetchFn).toHaveBeenCalledTimes(4);
        expect(runner.runs).toHaveLength(1);
        const description = JSON.parse(String(fetchFn.mock.calls[2][1]?.body)).body;
        expectSecretFree(description);
      });
    },
  );

  it('keeps a rotated environment token pinned for the full orchestration', async () => {
    vi.stubEnv(CUSTOM_ENV, ENV_TOKEN);
    const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
      expect(init?.headers).toMatchObject({ Authorization: `Bearer ${ENV_TOKEN}` });
      if (String(_url).endsWith('/repos/octo/repo')) {
        process.env[CUSTOM_ENV] = ROTATED_TOKEN;
        return makeResponse(200, { permissions: { push: true } });
      }
      return successfulGitHubResponse(_url, init, { repository: 'octo/repo', number: 7 });
    });
    const result = await runReleaseTag(options({ githubTokenEnv: CUSTOM_ENV, runner: createReleaseRunner(), fetchFn }));
    expect(result.pullRequest?.number).toBe(7);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('keeps independent overlapping orchestrations isolated without a shared token registry', async () => {
    await withDirectory(async (dir) => {
      const tokens = [FILE_TOKEN, ROTATED_TOKEN];
      await Promise.all(tokens.map((token, index) => fs.writeFile(join(dir, `token-${index}`), token)));
      let arrivals = 0;
      let release!: () => void;
      const ready = new Promise<void>((resolve) => {
        release = resolve;
      });
      const results = await Promise.all(
        tokens.map((token, index) =>
          runReleaseTag(
            options({
              cwd: dir,
              githubTokenFile: `token-${index}`,
              runner: createReleaseRunner({ tagMessage: `notes ${token}` }),
              fetchFn: async (_url, init) => {
                expect(init?.headers).toMatchObject({ Authorization: `Bearer ${token}` });
                if (String(_url).endsWith('/repos/octo/repo')) {
                  arrivals += 1;
                  if (arrivals === tokens.length) {
                    release();
                  }
                  await ready;
                  return makeResponse(200, { permissions: { push: true } });
                }
                return successfulGitHubResponse(_url, init, {
                  repository: 'octo/repo',
                  number: index + 1,
                  url: `https://github.com/octo/repo/pull/${index + 1}?token=${token}`,
                });
              },
            }),
          ),
        ),
      );
      expect(results.map((result) => result.pullRequest?.number)).toEqual([1, 2]);
      for (const result of results) {
        expectSecretFree(result, tokens);
      }
    });
  });

  it.each([{ dryRun: true }, { skipPr: true }, { only: ['determine', 'release'] }])(
    'leaves skipped direct PR credentials unopened: %j',
    async (selection) => {
      const open = vi.spyOn(fs, 'open');
      const fetchFn = successfulFetch();
      const result = await createReleasePullRequest({
        plan: resolveReleaseTagPlan(options({ ...selection, githubTokenFile: 'absent-token' })),
        determined: DETERMINED,
        release: RELEASE,
        fetchFn,
      });
      expect(result.skipped).toBe(true);
      expect(open).not.toHaveBeenCalled();
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it.each([{ dryRun: true }, { skipPreflight: true }, { skipPr: true }, { only: ['determine'] }])(
    'leaves skipped preflight credentials unopened: %j',
    async (selection) => {
      const open = vi.spyOn(fs, 'open');
      const fetchFn = successfulFetch();
      const result = await runPreflight({
        plan: resolveReleaseTagPlan(options({ only: ['pr'], ...selection, githubTokenFile: 'absent-token' })),
        fetchFn,
      });
      expect(result.token.skipped).toBe(true);
      expect(open).not.toHaveBeenCalled();
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it.each([{ dryRun: true }, { only: ['determine'] }])(
    'leaves excluded/dry-run release credentials and transports untouched: %j',
    async (selection) => {
      const open = vi.spyOn(fs, 'open');
      const runner = createReleaseRunner();
      const fetchFn = successfulFetch();
      await runReleaseBranch({
        plan: resolveReleaseTagPlan(options({ ...selection, githubTokenFile: 'absent-token', runner, fetchFn })),
        determined: DETERMINED,
      });
      expect(open).not.toHaveBeenCalled();
      expect(runner.captures).toHaveLength(0);
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it.each([
    { dryRun: true },
    { only: [] },
    { only: ['determine'] },
    { skipPr: true },
    { skipPreflight: true, skipPr: true },
  ])('keeps orchestration file credentials lazy with selection %j', async (selection) => {
    const open = vi.spyOn(fs, 'open');
    const fetchFn = successfulFetch();
    const runner = createReleaseRunner();
    await runReleaseTag(options({ ...selection, githubTokenFile: 'absent-token', runner, fetchFn }));
    expect(open).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    if (selection.dryRun || selection.only !== undefined) {
      expect(runner.captures).toHaveLength(0);
    }
  });

  it('does not resolve a token file before determination succeeds, and omits unknown file-token diagnostics', async () => {
    const open = vi.spyOn(fs, 'open');
    const runner = createReleaseRunner({ capture: () => ({ code: 128, stdout: '', stderr: `failed ${FILE_TOKEN}` }) });
    const fetchFn = successfulFetch();
    const error = await caughtError(
      runReleaseTag(options({ tag: undefined, githubTokenFile: 'absent-token', runner, fetchFn })),
    );
    expect(error.message).toContain('No previous tag found');
    expect(error.message).toContain('output omitted while file credential is unresolved');
    expect(open).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expectSecretFree(error);
  });

  it('validates a Git-inferred base before opening a credential file or starting preflight', async () => {
    const open = vi.spyOn(fs, 'open');
    const runner = createReleaseRunner({ baseBranch: '--mirror' });
    const fetchFn = successfulFetch();
    const error = await caughtError(
      runReleaseTag(options({ baseBranch: undefined, githubTokenFile: 'absent-token', runner, fetchFn })),
    );
    expect(error.message).toContain('baseBranch');
    expect(open).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(runner.captures.map((call) => call.args)).toEqual([['symbolic-ref', '--short', 'HEAD']]);
  });
});

describe('secret-safe direct stages and output snapshots', () => {
  it.each(['explicit', 'env', 'file'] as const)(
    'redacts %s credentials in every process stage error without raw causes',
    async (source) => {
      await withDirectory(async (dir) => {
        const token = source === 'explicit' ? EXPLICIT_TOKEN : source === 'env' ? ENV_TOKEN : FILE_TOKEN;
        await fs.writeFile(join(dir, 'token'), FILE_TOKEN);
        if (source === 'env') {
          vi.stubEnv(CUSTOM_ENV, ENV_TOKEN);
        }
        for (const stage of ['determine', 'refs', 'preflight', 'release'] as const) {
          for (const mode of ['stderr', 'throw'] as const) {
            const open = vi.spyOn(fs, 'open');
            open.mockClear();
            const runner = createReleaseRunner({
              capture: () => {
                if (mode === 'throw') {
                  throw unsafeError(`transport ${token}`);
                }
                return { code: 17, stdout: '', stderr: `denied ${token}` };
              },
            });
            const plan = resolveReleaseTagPlan(
              options({
                cwd: dir,
                tag: stage === 'determine' ? undefined : '1.2.3',
                baseBranch: stage === 'refs' ? undefined : 'main',
                skipRelease: true,
                githubTokenEnv: CUSTOM_ENV,
                githubTokenFile: source === 'file' ? 'token' : undefined,
                runner,
              }),
            );
            const input = { plan, githubToken: source === 'explicit' ? token : undefined, determined: DETERMINED };
            const promise =
              stage === 'determine'
                ? determineNextTag(input)
                : stage === 'refs'
                  ? resolveReleaseBranchRefs(input)
                  : stage === 'preflight'
                    ? runPreflight(input)
                    : runReleaseBranch(input);
            const error = await caughtError(promise);
            expect(error.message).toContain(mode === 'throw' ? 'process transport failed' : 'exit code 17');
            expectSecretFree(error);
            expect(runner.captures).toHaveLength(1);
            expect(open).toHaveBeenCalledTimes(source === 'file' && stage !== 'determine' && stage !== 'refs' ? 1 : 0);
          }
        }
      });
    },
  );

  it.each(['explicit', 'env', 'file'] as const)(
    'sanitizes direct release metadata and PR descriptions for %s credentials',
    async (source) => {
      await withDirectory(async (dir) => {
        const token = source === 'explicit' ? EXPLICIT_TOKEN : source === 'env' ? ENV_TOKEN : FILE_TOKEN;
        vi.stubEnv(CUSTOM_ENV, ENV_TOKEN);
        await fs.writeFile(join(dir, 'token'), FILE_TOKEN);
        const plan = resolveReleaseTagPlan(
          options({
            cwd: dir,
            githubTokenEnv: CUSTOM_ENV,
            githubTokenFile: source === 'file' ? 'token' : undefined,
            skipRelease: true,
          }),
        );
        const credential = { githubToken: source === 'explicit' ? token : undefined };
        const release = await runReleaseBranch({
          plan,
          determined: DETERMINED,
          ...credential,
          runner: createReleaseRunner({ tagMessage: `annotation ${token} ${ENV_TOKEN}` }),
        });
        expectSecretFree(release);
        expect(release.tagMessage).toBe('annotation [redacted] [redacted]');
        const inputRelease = { ...RELEASE, prTitle: `candidate ${token}`, tagMessage: `notes ${token} ${ENV_TOKEN}` };
        const fetchFn = vi.fn<typeof fetch>(async (url, init) =>
          successfulGitHubResponse(url, init, {
            repository: 'octo/repo',
            number: 7,
            url: `https://${token}@github.com/octo/repo/pull/7?token=${token}`,
          }),
        );
        const result = await createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: inputRelease,
          ...credential,
          fetchFn,
        });
        expectSecretFree(result);
        const payload = JSON.parse(String(fetchFn.mock.calls[1][1]?.body));
        expectSecretFree(payload);
        expect(payload.title).toBe('candidate [redacted]');
        expect(inputRelease.tagMessage).toBe(`notes ${token} ${ENV_TOKEN}`);
      });
    },
  );

  it.each(['explicit', 'env', 'file'] as const)(
    'preserves operational values while sanitizing the full %s result',
    async (source) => {
      await withDirectory(async (dir) => {
        const token = source === 'explicit' ? EXPLICIT_TOKEN : source === 'env' ? ENV_TOKEN : FILE_TOKEN;
        vi.stubEnv(CUSTOM_ENV, ENV_TOKEN);
        await fs.writeFile(join(dir, 'token'), FILE_TOKEN);
        const baseBranch = `base-${token}`;
        const releaseBranch = `candidate/${token}`;
        const runner = createReleaseRunner({ baseBranch, tagMessage: `annotation ${token}` });
        const runtime = { token, cycle: {} };
        runtime.cycle = runtime;
        Object.assign(runner, { runtime });
        const fetchFn = vi.fn<typeof fetch>(async (url, init) =>
          successfulGitHubResponse(url, init, {
            repository: 'octo/repo',
            number: 7,
            head: releaseBranch,
            base: baseBranch,
            url: `https://github.com/octo/repo/pull/7?token=${token}`,
          }),
        );
        Object.assign(fetchFn, { runtime });
        const result = await runReleaseTag(
          options({
            cwd: dir,
            baseBranch,
            releaseBranch,
            githubTokenEnv: CUSTOM_ENV,
            githubToken: source === 'explicit' ? token : undefined,
            githubTokenFile: source === 'file' ? 'token' : undefined,
            gitUserName: `bot ${token}`,
            releaseArgs: [`--value=${token}`],
            runner,
            fetchFn,
          }),
        );
        expect(result.release?.releasedHead).toBe(RELEASED_HEAD);
        expectSecretFree(result);
        expect(Object.keys(result.plan)).not.toContain('runner');
        expect('runner' in result.plan).toBe(false);
        expect('fetchFn' in result.plan).toBe(false);
        expect(runner.captures.map((call) => call.args)).toContainEqual(['config', 'user.name', `bot ${token}`]);
        expect(runner.runs[0].args).toContain(`--value=${token}`);
        expect(runner.state.branch).toBe(releaseBranch);
        const payload = JSON.parse(String(fetchFn.mock.calls[2][1]?.body));
        expect(payload.head).toBe(releaseBranch);
        expect(payload.base).toBe(baseBranch);
        expectSecretFree(payload.body);
        expect(runner.runtime).toBe(runtime);
        for (const call of fetchFn.mock.calls) {
          expect(call[1]?.headers).toMatchObject({ Authorization: `Bearer ${token}` });
        }
      });
    },
  );

  it('serializes a safe plan snapshot without traversing runtime objects or changing execution fields', () => {
    vi.stubEnv(CUSTOM_ENV, ENV_TOKEN);
    const forbidden = vi.fn(() => {
      throw new Error(FILE_TOKEN);
    });
    const runner = createReleaseRunner();
    Object.defineProperty(runner, 'transport', { get: forbidden, enumerable: true });
    Object.assign(runner, { secret: FILE_TOKEN, self: runner });
    const fetchFn = successfulFetch();
    Object.assign(fetchFn, { secret: FILE_TOKEN, toJSON: forbidden });
    const plan = resolveReleaseTagPlan(
      options({
        githubToken: EXPLICIT_TOKEN,
        githubTokenEnv: CUSTOM_ENV,
        gitUserName: EXPLICIT_TOKEN,
        releaseArgs: [`--value=${ENV_TOKEN}`],
        runner,
        fetchFn,
      }),
    );
    expectSecretFree(plan);
    expect(plan.runner).toBe(runner);
    expect(plan.fetchFn).toBe(fetchFn);
    expect(plan.gitUserName).toBe(EXPLICIT_TOKEN);
    expect(plan.releaseArgs).toEqual([`--value=${ENV_TOKEN}`]);
    expect(Object.keys(plan)).not.toContain('runner');
    expect(Object.keys(plan)).not.toContain('fetchFn');
    expect(forbidden).not.toHaveBeenCalled();
    expect(JSON.parse(JSON.stringify(plan)).gitUserName).toBe('[redacted]');
  });

  it('keeps runtime dependency overrides writable and hidden on operational plans', async () => {
    const initialRunner = createReleaseRunner();
    const initialFetch = successfulFetch();
    const plan = resolveReleaseTagPlan(options({ only: ['pr'], runner: initialRunner, fetchFn: initialFetch }));
    const replacementRunner = createReleaseRunner();
    const replacementFetch = successfulFetch();
    plan.runner = replacementRunner;
    plan.fetchFn = replacementFetch;
    await runPreflight({ plan, githubToken: EXPLICIT_TOKEN });
    expect(plan.runner).toBe(replacementRunner);
    expect(initialFetch).not.toHaveBeenCalled();
    expect(replacementFetch).toHaveBeenCalledOnce();
    expect(Object.keys(plan)).not.toContain('runner');
    expect(Object.keys(plan)).not.toContain('fetchFn');
    expectSecretFree(plan);
  });

  it('sanitizes plan validation errors through both plan resolution and orchestration', async () => {
    const input = options({ githubToken: EXPLICIT_TOKEN, only: [EXPLICIT_TOKEN] });
    try {
      resolveReleaseTagPlan(input);
      expect.unreachable();
    } catch (error) {
      expectSecretFree(error);
    }
    expectSecretFree(await caughtError(runReleaseTag(input)));
  });

  it('redacts URI-encoded known tokens in returned PR URLs and diagnostic response bodies', async () => {
    const token = 'uri+encoded/token==';
    const plan = resolveReleaseTagPlan(options());
    for (const status of [201, 401]) {
      const fetchFn = vi.fn<typeof fetch>(async (url, init) =>
        status === 401 && init?.method === 'POST'
          ? makeResponse(status, { message: `denied ${encodeURIComponent(token)}` })
          : successfulGitHubResponse(url, init, {
              repository: 'octo/repo',
              number: 7,
              url: `https://github.com/octo/repo/pull/7?token=${encodeURIComponent(token)}`,
            }),
      );
      const promise = createReleasePullRequest({
        plan,
        determined: DETERMINED,
        release: RELEASE,
        githubToken: token,
        fetchFn,
      });
      expectSecretFree(status === 201 ? await promise : await caughtError(promise), [token]);
    }
  });

  it('stops release mutations when a preflight body fails', async () => {
    const runner = createReleaseRunner();
    const fetchFn = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.error(unsafeError(`body ${EXPLICIT_TOKEN}`));
            },
          }),
        ),
    );
    const error = await caughtError(runReleaseTag(options({ githubToken: EXPLICIT_TOKEN, runner, fetchFn })));
    expectSecretFree(error);
    expect(runner.state.branch).toBe('main');
    expect(runner.runs).toHaveLength(0);
    expect(runner.captures.map((call) => call.args)).toEqual([
      ['config', '--get', 'core.sshCommand'],
      ['ls-remote', 'origin', 'HEAD'],
    ]);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it.each(['overflow', 'timeout', 'body-error', 'redirect'] as const)(
    'does not merge or delete after a labels %s failure',
    async (failure) => {
      const cancel = vi.fn();
      const fetchFn = vi.fn<typeof fetch>(async (url, init) => {
        if (!String(url).endsWith('/labels')) {
          return successfulGitHubResponse(url, init, { repository: 'octo/repo', number: 7 });
        }
        return new Response(
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                if (failure === 'overflow') {
                  controller.enqueue(new Uint8Array(1025));
                }
                if (failure === 'body-error') {
                  controller.error(unsafeError(`body ${EXPLICIT_TOKEN}`));
                }
              },
              cancel,
            },
            { highWaterMark: 0 },
          ),
          failure === 'redirect'
            ? { status: 307, headers: { Location: `https://other.example/${EXPLICIT_TOKEN}` } }
            : {},
        );
      });
      const error = await caughtError(
        createReleasePullRequest({
          plan: resolveReleaseTagPlan(
            options({ autoMergePr: true, deleteMergedBranch: true, timeoutMs: 40, maxOutputBytes: 1024 }),
          ),
          determined: DETERMINED,
          release: RELEASE,
          githubToken: EXPLICIT_TOKEN,
          fetchFn,
        }),
      );
      expectSecretFree(error);
      expect(fetchFn).toHaveBeenCalledTimes(3);
      expect(error.message).toContain('PR #7');
      expect(error.message).toContain('failed at labels');
      if (failure !== 'body-error') {
        expect(cancel).toHaveBeenCalledOnce();
      }
    },
  );
});
