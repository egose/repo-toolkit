import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCredentialContext } from '../src/credentials';
import { resolveReleaseTagPlan, runReleaseTag, type ReleaseTagOptions } from '../src/index';
import { cloneStagePlan } from '../src/plan';
import { createReleasePullRequestWithContext } from '../src/pull-request';
import { readReleaseRecoveryWithContext, type ReleaseRecovery } from '../src/recovery';
import { recordingGitRunner, snapshotGitFixture, withGitFixture } from './git-fixture';
import { makeResponse, pullRequestData, pullRequestListData } from './http-fixture';
import { createReleaseRunner } from './release-fixture';
import { RECOVERY_BRANCH, RECOVERY_TAG, recoveryFetch, seedRecovery } from './recovery-fixture';

vi.mock('node:fs/promises', async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }));

const TOKEN = 'recovery-explicit-canary-4d718';
const ENV_TOKEN = 'recovery-env-canary-671bc';
const FILE_TOKEN = 'recovery-file-canary-ae542';

function options(overrides: ReleaseTagOptions = {}): ReleaseTagOptions {
  return {
    only: ['pr'],
    tag: 'v1.2.3',
    baseBranch: 'main',
    githubRepository: 'octo/hello',
    githubToken: TOKEN,
    releaseCommand: 'must-never-run-this-release-command',
    ...overrides,
  };
}

beforeEach(() => {
  for (const name of [
    'GITHUB_TOKEN',
    'GITHUB_REPOSITORY',
    'GITHUB_REF_NAME',
    'GITHUB_REF_TYPE',
    'GITHUB_REF',
    'GITHUB_API_URL',
    'GIT_SSH',
    'GIT_SSH_COMMAND',
  ]) {
    vi.stubEnv(name, undefined);
  }
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('PR-only composition validation and skips', () => {
  it.each([false, true])(
    'rejects invalid combinations and missing explicit recovery inputs before I/O (dryRun=%s)',
    async (dryRun) => {
      vi.stubEnv('GITHUB_REF_NAME', 'main');
      const runner = createReleaseRunner({
        capture: () => {
          throw new Error('unexpected Git');
        },
      });
      const fetchFn = vi.fn<typeof fetch>(async () => {
        throw new Error('unexpected fetch');
      });
      const fileReads = [vi.spyOn(fs, 'open'), vi.spyOn(fs, 'stat'), vi.spyOn(fs, 'access')];
      for (const selection of [
        { only: ['release'] },
        { only: ['release', 'pr'] },
        { only: ['determine', 'pr'] },
        { only: ['pr'], tag: undefined },
        { only: ['pr'], baseBranch: undefined },
        { only: ['pr'], tag: undefined, baseBranch: undefined },
      ]) {
        await expect(
          runReleaseTag(
            options({
              ...selection,
              dryRun,
              runner,
              fetchFn,
              githubToken: undefined,
              githubTokenFile: 'unopened-token',
            }),
          ),
        ).rejects.toThrow(/requires/);
      }
      expect(runner.captures).toHaveLength(0);
      expect(fetchFn).not.toHaveBeenCalled();
      for (const read of fileReads) {
        expect(read).not.toHaveBeenCalled();
      }
    },
  );

  it.each([
    { dryRun: true, githubTokenFile: 'unopened-token' },
    { skipPr: true, githubTokenFile: 'unopened-token' },
    { githubToken: undefined },
  ])('does not read Git, credentials, or endpoints for skipped recovery %j', async (selection) => {
    vi.stubEnv('GITHUB_REF_TYPE', 'tag');
    vi.stubEnv('GITHUB_REF_NAME', '--unused-environment-ref');
    const runner = createReleaseRunner({
      capture: () => {
        throw new Error('unexpected Git');
      },
    });
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new Error('unexpected fetch');
    });
    const fileReads = [vi.spyOn(fs, 'open'), vi.spyOn(fs, 'stat'), vi.spyOn(fs, 'access')];
    const result = await runReleaseTag(options({ githubToken: undefined, ...selection, runner, fetchFn }));
    expect(result.determined).toBeNull();
    expect(result.release).toBeNull();
    if (selection.dryRun) {
      expect(result.pullRequest).toBeNull();
    } else {
      expect(result.pullRequest).toMatchObject({
        skipped: true,
        skippedReason: selection.skipPr ? 'skipped via skipPr' : 'github token not available',
        reused: false,
      });
    }
    expect(runner.captures).toHaveLength(0);
    expect(fetchFn).not.toHaveBeenCalled();
    for (const read of fileReads) {
      expect(read).not.toHaveBeenCalled();
    }
  });
});

describe('PR-only read-only Git identity', () => {
  it.each([false, true])(
    'uses tag metadata and the pinned head without changing a dirty detached checkout (lightweight=%s)',
    async (lightweight) => {
      await withGitFixture(async (fixture) => {
        const message = 'Recovery notes\n\n-----BEGIN PGP SIGNATURE-----\nfixture\n-----END PGP SIGNATURE-----';
        const sha = seedRecovery(fixture, { lightweight, message });
        fixture.git(['checkout', '--quiet', '--detach', fixture.sourceCommit]);
        await fs.writeFile(join(fixture.cwd, 'tracked.txt'), 'preserve dirty work\n');
        await fs.writeFile(join(fixture.cwd, 'untracked.txt'), 'preserve untracked work\n');
        const before = await snapshotGitFixture(fixture);
        const objects = fixture.git(['count-objects', '-v']);
        const runner = recordingGitRunner(fixture);
        const { fetchFn, calls } = recoveryFetch({ sha });
        const result = await runReleaseTag(
          options({
            cwd: fixture.cwd,
            runner,
            fetchFn,
            resetReleaseBranch: true,
            signCommit: true,
            allowEmptyRelease: true,
          }),
        );
        expect(await snapshotGitFixture(fixture)).toEqual(before);
        expect(fixture.git(['count-objects', '-v'])).toBe(objects);
        expect(await fs.readFile(join(fixture.cwd, 'untracked.txt'), 'utf8')).toBe('preserve untracked work\n');
        expect(runner.runs).toHaveLength(0);
        expect(
          runner.captures.some((args) =>
            ['config', 'checkout', 'reset', 'push', 'fetch', 'branch', 'tag', 'update-ref'].includes(args[0]),
          ),
        ).toBe(false);
        expect(result.determined).toBeNull();
        expect(result.release).toBeNull();
        expect(result.pullRequest).toMatchObject({ skipped: false, reused: true, number: 42 });
        expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
          title: 'chore(release): release candidate v1.2.3',
          body: '### Release Candidate Details\n\nRecovery notes\n\n---\n\n> This PR was automatically generated.',
        });
        expect(calls.some((call) => call.method === 'POST' && new URL(call.url).pathname.endsWith('/pulls'))).toBe(
          false,
        );
        expect(result.plan).not.toHaveProperty('runner');
        expect(result.plan).not.toHaveProperty('fetchFn');
        expect(JSON.stringify(result)).not.toContain(TOKEN);
      });
    },
  );

  it('creates the missing PR for a verified remote-only branch in a fresh checkout without a local base', async () => {
    await withGitFixture(async (fixture) => {
      const sha = seedRecovery(fixture);
      const cwd = join(fixture.root, 'fresh');
      fixture.git(['clone', '--quiet', fixture.remote, cwd]);
      const fresh = {
        ...fixture,
        cwd,
        git: (args: ReadonlyArray<string>, input?: string) => fixture.git(['-C', cwd, ...args], input),
      };
      fresh.git(['checkout', '--quiet', '--detach', sha]);
      fresh.git(['branch', '-D', 'main']);
      fresh.git(['update-ref', `refs/remotes/origin/${RECOVERY_BRANCH}`, fixture.sourceCommit]);
      const before = await snapshotGitFixture(fresh);
      const { fetchFn, calls } = recoveryFetch({ sha, absent: true });
      const result = await runReleaseTag(options({ cwd, fetchFn, autoMergePr: true, mergeMethod: 'squash' }));
      expect(await snapshotGitFixture(fresh)).toEqual(before);
      expect(result.pullRequest).toMatchObject({ reused: false, merged: true });
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ merge_method: 'squash', sha });
      expect(fresh.git(['for-each-ref', '--format=%(refname)', 'refs/heads'])).toBe('');
    });
  });

  it.each([
    'missing tag',
    'local mismatch',
    'remote mismatch',
    'local alias',
    'dangling alias',
    'tag alias',
    'noncommit tag',
  ] as const)('rejects %s before any HTTP or Git mutation', async (failure) => {
    await withGitFixture(async (fixture) => {
      const sha = seedRecovery(fixture);
      const releaseRef = `refs/heads/${RECOVERY_BRANCH}`;
      const tagRef = `refs/tags/${RECOVERY_TAG}`;
      if (failure === 'missing tag') {
        fixture.git(['tag', '-d', RECOVERY_TAG]);
      }
      if (failure === 'local mismatch') {
        fixture.git(['update-ref', releaseRef, fixture.sourceCommit]);
      }
      if (failure === 'remote mismatch') {
        fixture.remoteGit(['update-ref', releaseRef, fixture.sourceCommit]);
      }
      if (failure === 'local alias' || failure === 'dangling alias') {
        fixture.git(['update-ref', '-d', releaseRef]);
        fixture.git(['symbolic-ref', releaseRef, failure === 'local alias' ? 'refs/heads/main' : 'refs/heads/absent']);
      }
      if (failure === 'tag alias') {
        fixture.git(['tag', '-d', RECOVERY_TAG]);
        fixture.git(['symbolic-ref', tagRef, releaseRef]);
      }
      if (failure === 'noncommit tag') {
        fixture.git(['tag', '-d', RECOVERY_TAG]);
        fixture.git(['tag', '-a', RECOVERY_TAG, `${sha}^{tree}`, '-m', 'not a released commit']);
      }
      const before = await snapshotGitFixture(fixture);
      const { fetchFn, calls } = recoveryFetch({ sha });
      await expect(runReleaseTag(options({ cwd: fixture.cwd, fetchFn }))).rejects.toThrow(
        /target tag|symbolic ref|does not match/,
      );
      expect(await snapshotGitFixture(fixture)).toEqual(before);
      expect(calls).toHaveLength(0);
    });
  });

  it('refuses a remote-advertised symbolic release alias before HTTP', async () => {
    await withGitFixture(async (fixture) => {
      const sha = seedRecovery(fixture);
      fixture.remoteGit(['symbolic-ref', `refs/heads/${RECOVERY_BRANCH}`, 'refs/heads/main']);
      const before = await snapshotGitFixture(fixture);
      const { fetchFn, calls } = recoveryFetch({ sha });
      await expect(runReleaseTag(options({ cwd: fixture.cwd, fetchFn }))).rejects.toThrow(/symbolic ref/);
      expect(await snapshotGitFixture(fixture)).toEqual(before);
      expect(calls).toHaveLength(0);
    });
  });

  it('pins annotation reads to the tag object and rejects a tag moved during inspection', async () => {
    await withGitFixture(async (fixture) => {
      const sha = seedRecovery(fixture);
      const originalTag = fixture.git(['rev-parse', `refs/tags/${RECOVERY_TAG}`]).trim();
      const { fetchFn, calls } = recoveryFetch({ sha });
      const runner = recordingGitRunner(fixture, (args) => {
        if (args[0] === 'cat-file') {
          fixture.git(['tag', '-f', RECOVERY_TAG, fixture.sourceCommit]);
        }
      });
      await expect(runReleaseTag(options({ cwd: fixture.cwd, runner, fetchFn }))).rejects.toThrow(
        /target tag changed during inspection/,
      );
      expect(runner.captures).toContainEqual(['cat-file', '-p', originalTag]);
      expect(fixture.git(['rev-parse', `refs/tags/${RECOVERY_TAG}`]).trim()).toBe(fixture.sourceCommit);
      expect(fixture.git(['rev-parse', `refs/heads/${RECOVERY_BRANCH}`]).trim()).toBe(sha);
      expect(calls).toHaveLength(0);
    });
  });

  it('refuses an API head mismatch even when Git refs and the local tag match', async () => {
    await withGitFixture(async (fixture) => {
      seedRecovery(fixture);
      const before = await snapshotGitFixture(fixture);
      const { fetchFn, calls } = recoveryFetch({ sha: fixture.sourceCommit });
      await expect(runReleaseTag(options({ cwd: fixture.cwd, fetchFn }))).rejects.toThrow(/head SHA does not match/);
      expect(calls.every((call) => call.method === 'GET')).toBe(true);
      expect(await snapshotGitFixture(fixture)).toEqual(before);
    });
  });
});

describe('already-deleted release-branch recovery', () => {
  it.each([false, true])(
    'confirms an already-merged exact PR and absent cleanup without rebuilding refs (local=%s)',
    async (local) => {
      await withGitFixture(async (fixture) => {
        const sha = seedRecovery(fixture, { local, remote: false });
        const before = await snapshotGitFixture(fixture);
        const { fetchFn, calls } = recoveryFetch({ sha, merged: true, missingBranch: true });
        const result = await runReleaseTag(
          options({
            cwd: fixture.cwd,
            fetchFn,
            autoMergePr: true,
            deleteMergedBranch: true,
            resetReleaseBranch: true,
          }),
        );
        expect(result.determined).toBeNull();
        expect(result.release).toBeNull();
        expect(result.pullRequest).toMatchObject({ reused: true, merged: true, branchDeleted: true });
        expect(
          calls.filter((call) => call.method !== 'GET').map((call) => [call.method, new URL(call.url).pathname]),
        ).toEqual([['POST', '/repos/octo/hello/issues/42/labels']]);
        expect(await snapshotGitFixture(fixture)).toEqual(before);
      });
    },
  );

  it.each([
    'absent PR',
    'open PR',
    'closed-unmerged PR',
    'wrong SHA',
    'wrong base',
    'ambiguous',
    'list-only merged',
  ] as const)('rejects missing-branch recovery with %s before any write API', async (failure) => {
    await withGitFixture(async (fixture) => {
      const sha = seedRecovery(fixture, { remote: false, local: false });
      const before = await snapshotGitFixture(fixture);
      const observed: string[] = [];
      const fetchFn: typeof fetch = async (url, init) => {
        observed.push(init?.method ?? 'GET');
        const data = {
          sha,
          merged: true,
          ...(failure === 'wrong SHA' ? { sha: fixture.sourceCommit } : {}),
          ...(failure === 'wrong base' ? { base: 'other' } : {}),
        };
        if (new URL(String(url)).pathname.endsWith('/pulls')) {
          const list = pullRequestListData(data);
          return makeResponse(200, failure === 'absent PR' ? [] : failure === 'ambiguous' ? [list, list] : [list]);
        }
        return makeResponse(
          200,
          pullRequestData({
            ...data,
            merged: false,
            state: failure === 'closed-unmerged PR' || failure === 'list-only merged' ? 'closed' : 'open',
          }),
        );
      };
      await expect(
        runReleaseTag({
          ...options({ cwd: fixture.cwd, fetchFn, skipPreflight: true }),
          ...{ allowMissingBranch: true, remoteBranchMissing: false },
        }),
      ).rejects.toThrow(/already.*merged|closed without merging|identity mismatch|head SHA|Ambiguous/);
      expect(observed.length).toBeGreaterThan(0);
      expect(observed.every((method) => method === 'GET')).toBe(true);
      expect(await snapshotGitFixture(fixture)).toEqual(before);
    });
  });

  it('does not accept forged or substituted internal recovery evidence', async () => {
    await withGitFixture(async (fixture) => {
      const sha = seedRecovery(fixture, { remote: false, local: false });
      const { fetchFn, calls } = recoveryFetch({ sha, absent: true });
      const plan = resolveReleaseTagPlan(options({ cwd: fixture.cwd, fetchFn }));
      const context = createCredentialContext(TOKEN, undefined);
      const recovery = await readReleaseRecoveryWithContext(plan, context);
      const input = { plan, determined: recovery.determined, release: recovery.release };
      await expect(
        createReleasePullRequestWithContext(input, context, {
          ...recovery,
          remoteBranchMissing: false,
        } as ReleaseRecovery),
      ).rejects.toThrow(/original read-only verified/);
      await expect(
        createReleasePullRequestWithContext({ ...input, release: { ...input.release } }, context, recovery),
      ).rejects.toThrow(/original read-only verified/);
      await expect(
        createReleasePullRequestWithContext({ ...input, determined: { ...input.determined } }, context, recovery),
      ).rejects.toThrow(/original read-only verified/);
      expect(calls).toHaveLength(0);
      expect(Object.isFrozen(recovery)).toBe(true);
      expect(Object.isFrozen(recovery.release)).toBe(true);
    });
  });
});

describe('recovery credential and snapshot boundaries', () => {
  it('pins file credentials across recovery/preflight/PR and sanitizes reporting and outgoing descriptions', async () => {
    await withGitFixture(async (fixture) => {
      vi.stubEnv('CUSTOM_RECOVERY_TOKEN', ENV_TOKEN);
      const tokenFile = join(fixture.root, 'token');
      await fs.writeFile(tokenFile, FILE_TOKEN);
      const sha = seedRecovery(fixture, { message: `notes ${FILE_TOKEN} ${ENV_TOKEN}` });
      const before = await snapshotGitFixture(fixture);
      const open = vi.spyOn(fs, 'open');
      const fetch = recoveryFetch({ sha, url: `https://github.com/octo/hello/pull/42?token=${FILE_TOKEN}` });
      const fetchFn: typeof globalThis.fetch = async (url, init) => {
        expect(init?.headers).toMatchObject({ Authorization: `Bearer ${FILE_TOKEN}` });
        if (new URL(String(url)).pathname === '/repos/octo/hello') {
          await fs.writeFile(tokenFile, TOKEN);
        }
        return fetch.fetchFn(url, init);
      };
      const runner = recordingGitRunner(fixture);
      Object.assign(runner, { privateState: { token: FILE_TOKEN, self: runner } });
      Object.assign(fetchFn, { token: FILE_TOKEN });
      const result = await runReleaseTag(
        options({
          cwd: fixture.cwd,
          githubToken: undefined,
          githubTokenFile: tokenFile,
          githubTokenEnv: 'CUSTOM_RECOVERY_TOKEN',
          gitUserName: `bot ${FILE_TOKEN}`,
          releaseArgs: [`--value=${FILE_TOKEN}`],
          runner,
          fetchFn,
        }),
      );
      expect(open).toHaveBeenCalledOnce();
      for (const token of [FILE_TOKEN, ENV_TOKEN]) {
        expect(JSON.stringify(result)).not.toContain(token);
        expect(inspect(result, { depth: 10 })).not.toContain(token);
        expect(JSON.stringify(fetch.calls)).not.toContain(token);
      }
      expect(result.plan.releaseArgs).toEqual(['--value=[redacted]']);
      expect(result.plan.gitUserName).toBe('bot [redacted]');
      expect(result.plan).not.toHaveProperty('runner');
      expect(result.plan).not.toHaveProperty('fetchFn');
      expect(await snapshotGitFixture(fixture)).toEqual(before);
    });
  });

  it('restores safe stage-plan snapshots with current refs without serializing runtime state or changing operational secrets', () => {
    const runner = createReleaseRunner();
    const forbidden = vi.fn(() => {
      throw new Error(FILE_TOKEN);
    });
    Object.defineProperty(runner, 'secretState', { enumerable: true, get: forbidden });
    Object.assign(runner, { secret: FILE_TOKEN, self: runner });
    const fetchFn = recoveryFetch().fetchFn;
    Object.assign(fetchFn, { toJSON: forbidden });
    const plan = resolveReleaseTagPlan(
      options({ gitUserName: TOKEN, releaseArgs: [`--value=${FILE_TOKEN}`], runner, fetchFn }),
    );
    const refs = { baseBranch: `base-${FILE_TOKEN}`, releaseBranch: `release/${ENV_TOKEN}` };
    const stage = cloneStagePlan(plan, refs, [TOKEN, ENV_TOKEN, FILE_TOKEN]);
    expect(stage.runner).toBe(runner);
    expect(stage.fetchFn).toBe(fetchFn);
    expect(stage.baseBranch).toBe(refs.baseBranch);
    expect(stage.releaseArgs).toEqual([`--value=${FILE_TOKEN}`]);
    const report = JSON.parse(JSON.stringify(stage));
    expect(report.baseBranch).toBe('base-[redacted]');
    expect(report.releaseBranch).toBe('release/[redacted]');
    expect(report.releaseArgs).toEqual(['--value=[redacted]']);
    expect(report.gitUserName).toBe('[redacted]');
    expect(report).not.toHaveProperty('runner');
    expect(report).not.toHaveProperty('fetchFn');
    for (const token of [TOKEN, ENV_TOKEN, FILE_TOKEN]) {
      expect(inspect(stage)).not.toContain(token);
    }
    expect(forbidden).not.toHaveBeenCalled();
    expect(JSON.parse(JSON.stringify(plan)).baseBranch).toBe('main');
  });
});
