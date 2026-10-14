import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveReleaseTagPlan, runReleaseBranch, runReleaseTag, type DeterminedTag } from '../src/index';
import { recordingGitRunner, snapshotGitFixture, withGitFixture, type GitFixture } from './git-fixture';

const RELEASE_BRANCH = 'changelog/1.2.3';
const RELEASE_REF = `refs/heads/${RELEASE_BRANCH}`;
const TAG_REF = 'refs/tags/v1.2.3';
const DETERMINED: DeterminedTag = {
  version: '1.2.3',
  tagVersion: 'v1.2.3',
  bump: null,
  lastTag: null,
  manual: true,
  noChanges: false,
};
const COMMIT_RELEASE = "git(['commit', '--quiet', '--allow-empty', '--no-gpg-sign', '-m', 'fixture release']);";
const TAG_RELEASE = "git(['tag', '-a', tag, '-m', 'Release notes']);";

beforeEach(() => {
  for (const key of ['GITHUB_REF_NAME', 'GITHUB_REF_TYPE', 'GITHUB_REF', 'GITHUB_REPOSITORY', 'GITHUB_TOKEN']) {
    vi.stubEnv(key, undefined);
  }
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function expectBaseUnchanged(fixture: GitFixture): void {
  expect(fixture.git(['rev-parse', 'refs/heads/main']).trim()).toBe(fixture.sourceCommit);
  expect(fixture.remoteGit(['rev-parse', 'refs/heads/main']).trim()).toBe(fixture.sourceCommit);
}

function expectNoMutations(runner: ReturnType<typeof recordingGitRunner>): void {
  expect(runner.runs).toEqual([]);
  expect(
    runner.captures.filter((args) => ['config', 'checkout', 'push', 'branch', 'update-ref'].includes(args[0])),
  ).toEqual([]);
}

describe('release preparation invariants (real Git)', () => {
  it.each(['tracked', 'staged', 'untracked'])(
    'preserves %s work, refs, index, and config on a dirty checkout',
    async (kind) => {
      await withGitFixture(async (fixture) => {
        const path = join(fixture.cwd, kind === 'untracked' ? 'untracked.txt' : 'tracked.txt');
        await writeFile(path, 'work that must survive\n');
        if (kind === 'staged') {
          fixture.git(['add', 'tracked.txt']);
        }
        const before = await snapshotGitFixture(fixture);
        const runner = recordingGitRunner(fixture);
        const releaseCommand = await fixture.releaseCommand(`${COMMIT_RELEASE}\n${TAG_RELEASE}`);
        const plan = resolveReleaseTagPlan({ cwd: fixture.cwd, baseBranch: 'main', releaseCommand });
        await expect(runReleaseBranch({ plan, determined: DETERMINED, runner })).rejects.toThrow(
          /clean tracked\/untracked.*Commit, stash/,
        );
        expect(await readFile(path, 'utf8')).toBe('work that must survive\n');
        expect(await snapshotGitFixture(fixture)).toEqual(before);
        expectNoMutations(runner);
      });
    },
  );

  it.each(['same-commit branch', 'other-commit branch', 'detached HEAD', 'tag checkout', 'missing base'])(
    'refuses a %s without switching or changing refs',
    async (kind) => {
      await withGitFixture(async (fixture) => {
        if (kind.endsWith('branch')) {
          fixture.git([
            'checkout',
            '-b',
            'feature',
            kind === 'same-commit branch' ? fixture.sourceCommit : fixture.commit('feature work'),
          ]);
        } else if (kind === 'detached HEAD') {
          fixture.git(['checkout', '--detach', fixture.sourceCommit]);
        } else if (kind === 'tag checkout') {
          fixture.git(['tag', 'v1.2.2']);
          fixture.git(['checkout', 'v1.2.2']);
        }
        const before = await snapshotGitFixture(fixture);
        const runner = recordingGitRunner(fixture);
        const plan = resolveReleaseTagPlan({
          cwd: fixture.cwd,
          baseBranch: kind === 'missing base' ? 'missing' : 'main',
          skipRelease: true,
        });
        await expect(runReleaseBranch({ plan, determined: DETERMINED, runner })).rejects.toThrow(
          /check out.*base branch/i,
        );
        expect(await snapshotGitFixture(fixture)).toEqual(before);
        expectNoMutations(runner);
      });
    },
  );

  it('refuses HEAD changing after the selected base commit was inspected', async () => {
    await withGitFixture(async (fixture) => {
      const moved = fixture.commit('concurrent base update');
      const config = await readFile(join(fixture.cwd, '.git', 'config'), 'utf8');
      const runner = recordingGitRunner(fixture, (args) => {
        if (args[0] === 'rev-parse' && args[2] === 'HEAD^{commit}') {
          fixture.git(['update-ref', 'refs/heads/main', moved]);
        }
      });
      const plan = resolveReleaseTagPlan({ cwd: fixture.cwd, baseBranch: 'main', skipRelease: true });
      await expect(runReleaseBranch({ plan, determined: DETERMINED, runner })).rejects.toThrow(
        /HEAD does not match.*base commit/,
      );
      expect(fixture.git(['rev-parse', 'HEAD']).trim()).toBe(moved);
      expect(fixture.git(['for-each-ref', '--format=%(refname)', RELEASE_REF])).toBe('');
      expect(await readFile(join(fixture.cwd, '.git', 'config'), 'utf8')).toBe(config);
      expectNoMutations(runner);
    });
  });

  it.each(['local', 'remote', 'local and remote'])(
    'preserves %s release-branch collisions by default',
    async (location) => {
      await withGitFixture(async (fixture) => {
        const existing = fixture.commit('existing release work');
        if (location.includes('local')) {
          fixture.git(['branch', RELEASE_BRANCH, existing]);
        }
        if (location.includes('remote')) {
          fixture.git(['push', '--quiet', 'origin', `${existing}:${RELEASE_REF}`]);
        }
        const before = await snapshotGitFixture(fixture);
        const runner = recordingGitRunner(fixture);
        const plan = resolveReleaseTagPlan({ cwd: fixture.cwd, baseBranch: 'main', skipRelease: true });
        await expect(runReleaseBranch({ plan, determined: DETERMINED, runner })).rejects.toThrow(
          /already exists.*resetReleaseBranch: true/,
        );
        expect(await snapshotGitFixture(fixture)).toEqual(before);
        expectNoMutations(runner);
      });
    },
  );

  it('restarts explicitly from the verified base with a matching observed remote lease and retained reflog', async () => {
    await withGitFixture(async (fixture) => {
      const local = fixture.commit('local release work');
      const remote = fixture.commit('remote release work');
      fixture.git(['branch', RELEASE_BRANCH, local]);
      fixture.git(['push', '--quiet', 'origin', `${remote}:${RELEASE_REF}`]);
      const runner = recordingGitRunner(fixture);
      const plan = resolveReleaseTagPlan({
        cwd: fixture.cwd,
        baseBranch: 'main',
        skipRelease: true,
        resetReleaseBranch: true,
      });
      const result = await runReleaseBranch({ plan, determined: DETERMINED, runner });
      expect(result.releaseRan).toBe(false);
      expect(result.releasedHead).toBeUndefined();
      expect(fixture.git(['symbolic-ref', '--short', 'HEAD']).trim()).toBe(RELEASE_BRANCH);
      expect(fixture.git(['rev-parse', RELEASE_REF]).trim()).toBe(fixture.sourceCommit);
      expect(fixture.remoteGit(['rev-parse', RELEASE_REF]).trim()).toBe(fixture.sourceCommit);
      expect(fixture.git(['rev-parse', `${RELEASE_BRANCH}@{1}`]).trim()).toBe(local);
      expect(fixture.git(['rev-parse', '--symbolic-full-name', '@{upstream}']).trim()).toBe(
        `refs/remotes/origin/${RELEASE_BRANCH}`,
      );
      expect(runner.captures.find((args) => args[0] === 'push')).toContain(
        `--force-with-lease=${RELEASE_REF}:${remote}`,
      );
      expectBaseUnchanged(fixture);
    });
  });

  it.each(['absent', 'existing'])(
    'refuses a raced %s remote branch even after remote-tracking refs refresh',
    async (initial) => {
      await withGitFixture(async (fixture) => {
        const observed = fixture.commit('observed release');
        const raced = fixture.commit('concurrent release update', observed);
        if (initial === 'existing') {
          fixture.git(['branch', RELEASE_BRANCH, observed]);
          fixture.git(['push', '--quiet', 'origin', `${observed}:${RELEASE_REF}`]);
        }
        const releaseCommand = await fixture.releaseCommand(`${COMMIT_RELEASE}\n${TAG_RELEASE}`);
        const runner = recordingGitRunner(fixture, (args) => {
          if (args[0] === 'push') {
            fixture.git(['push', '--quiet', 'origin', `${raced}:${RELEASE_REF}`]);
          }
        });
        const plan = resolveReleaseTagPlan({
          cwd: fixture.cwd,
          baseBranch: 'main',
          resetReleaseBranch: initial === 'existing',
          releaseCommand,
        });
        await expect(runReleaseBranch({ plan, determined: DETERMINED, runner })).rejects.toThrow(
          /explicit lease.*stale info/s,
        );
        expect(fixture.remoteGit(['rev-parse', RELEASE_REF]).trim()).toBe(raced);
        expect(fixture.git(['rev-parse', `refs/remotes/origin/${RELEASE_BRANCH}`]).trim()).toBe(raced);
        expect(runner.runs).toEqual([]);
        expectBaseUnchanged(fixture);
      });
    },
  );

  it.each(['local', 'dangling local', 'remote'])(
    'refuses a %s symbolic release alias before reset can move the base',
    async (location) => {
      await withGitFixture(async (fixture) => {
        if (location !== 'remote') {
          fixture.git([
            'symbolic-ref',
            RELEASE_REF,
            location === 'local' ? 'refs/heads/main' : 'refs/heads/not-created',
          ]);
        } else {
          fixture.remoteGit(['symbolic-ref', RELEASE_REF, 'refs/heads/main']);
        }
        const before = await snapshotGitFixture(fixture);
        const runner = recordingGitRunner(fixture);
        const plan = resolveReleaseTagPlan({
          cwd: fixture.cwd,
          baseBranch: 'main',
          skipRelease: true,
          resetReleaseBranch: true,
        });
        await expect(runReleaseBranch({ plan, determined: DETERMINED, runner })).rejects.toThrow(/symbolic ref.*alias/);
        expect(await snapshotGitFixture(fixture)).toEqual(before);
        if (location !== 'remote') {
          expect(fixture.git(['symbolic-ref', '--quiet', '--no-recurse', RELEASE_REF]).trim()).toBe(
            location === 'local' ? 'refs/heads/main' : 'refs/heads/not-created',
          );
        }
        expectNoMutations(runner);
        expectBaseUnchanged(fixture);
      });
    },
  );

  it.each(['local lightweight', 'local annotated', 'remote lightweight', 'remote annotated'])(
    'refuses an existing %s target tag without changing refs or running the executable',
    async (kind) => {
      await withGitFixture(async (fixture) => {
        fixture.git(kind.includes('annotated') ? ['tag', '-a', 'v1.2.3', '-m', 'existing release'] : ['tag', 'v1.2.3']);
        if (kind.startsWith('remote')) {
          fixture.git(['push', '--quiet', 'origin', `${TAG_REF}:${TAG_REF}`]);
          fixture.git(['update-ref', '-d', TAG_REF]);
        }
        const before = await snapshotGitFixture(fixture);
        const runner = recordingGitRunner(fixture);
        const releaseCommand = await fixture.releaseCommand(`${COMMIT_RELEASE}\n${TAG_RELEASE}`);
        const plan = resolveReleaseTagPlan({
          cwd: fixture.cwd,
          baseBranch: 'main',
          releaseCommand,
          resetReleaseBranch: true,
        });
        await expect(runReleaseBranch({ plan, determined: DETERMINED, runner })).rejects.toThrow(
          /Release tag.*already exists.*new version/,
        );
        expect(await snapshotGitFixture(fixture)).toEqual(before);
        expectNoMutations(runner);
      });
    },
  );

  it('allows deliberate skipRelease preparation with existing tag metadata without probing a command', async () => {
    await withGitFixture(async (fixture) => {
      fixture.git(['tag', '-a', 'v1.2.3', '-m', 'Existing metadata']);
      fixture.git(['push', '--quiet', 'origin', `${TAG_REF}:${TAG_REF}`]);
      const tag = fixture.git(['rev-parse', TAG_REF]).trim();
      const runner = recordingGitRunner(fixture);
      const plan = resolveReleaseTagPlan({
        cwd: fixture.cwd,
        baseBranch: 'main',
        releaseCommand: './missing-command',
        skipRelease: true,
      });
      const result = await runReleaseBranch({ plan, determined: DETERMINED, runner });
      expect(result.tagMessage).toBe('Existing metadata');
      expect(result.releasedHead).toBeUndefined();
      expect(runner.runs).toEqual([]);
      expect(runner.captures.some((args) => args[0] === 'ls-remote' && args.includes(TAG_REF))).toBe(false);
      expect(fixture.git(['rev-parse', TAG_REF]).trim()).toBe(tag);
      expect(fixture.remoteGit(['rev-parse', TAG_REF]).trim()).toBe(tag);
      expect(fixture.remoteGit(['rev-parse', RELEASE_REF]).trim()).toBe(fixture.sourceCommit);
      expectBaseUnchanged(fixture);
    });
  });

  it.each(['missing', 'non-executable', 'directory'])(
    'fails a %s release command before config, checkout, or push',
    async (kind) => {
      await withGitFixture(async (fixture) => {
        let releaseCommand = join(fixture.root, 'missing-command');
        if (kind === 'non-executable') {
          releaseCommand = await fixture.releaseCommand('');
          await chmod(releaseCommand, 0o600);
        } else if (kind === 'directory') {
          releaseCommand = fixture.root;
        }
        const before = await snapshotGitFixture(fixture);
        const runner = recordingGitRunner(fixture);
        const plan = resolveReleaseTagPlan({ cwd: fixture.cwd, baseBranch: 'main', releaseCommand });
        await expect(runReleaseBranch({ plan, determined: DETERMINED, runner })).rejects.toThrow(
          /not available.*Install.*skipRelease/,
        );
        expect(await snapshotGitFixture(fixture)).toEqual(before);
        expect(runner.captures).toEqual([]);
        expectNoMutations(runner);
      });
    },
  );
});

describe('release execution postconditions (real Git)', () => {
  it.each(['package final push', 'executable pushes its own branch'])(
    'returns a verified released head, leaves the base intact, and supports %s',
    async (pushMode) => {
      await withGitFixture(async (fixture) => {
        const push =
          pushMode === 'executable pushes its own branch'
            ? `git(['push', '--quiet', 'origin', 'HEAD:${RELEASE_REF}']);`
            : '';
        const releaseCommand = await fixture.releaseCommand(`${COMMIT_RELEASE}\n${TAG_RELEASE}\n${push}`);
        const runner = recordingGitRunner(fixture);
        const result = await runReleaseBranch({
          plan: resolveReleaseTagPlan({ cwd: fixture.cwd, baseBranch: 'main', releaseCommand }),
          determined: DETERMINED,
          runner,
        });
        const head = fixture.git(['rev-parse', 'HEAD']).trim();
        expect(result.releasedHead).toBe(head);
        expect(result.releaseRan).toBe(true);
        expect(result.tagMessage).toBe('Release notes');
        expect(head).not.toBe(fixture.sourceCommit);
        expect(fixture.git(['rev-parse', 'HEAD^']).trim()).toBe(fixture.sourceCommit);
        expect(fixture.git(['rev-parse', `${TAG_REF}^{commit}`]).trim()).toBe(head);
        expect(fixture.remoteGit(['rev-parse', RELEASE_REF]).trim()).toBe(head);
        expect(fixture.git(['status', '--porcelain=v1'])).toBe('');
        expectBaseUnchanged(fixture);
      });
    },
  );

  it.each([
    ['wrong branch', `${COMMIT_RELEASE}\n${TAG_RELEASE}\ngit(['checkout', 'main']);`, /expected branch/],
    ['detached HEAD', `${COMMIT_RELEASE}\n${TAG_RELEASE}\ngit(['checkout', '--detach']);`, /postcondition failed/],
    [
      'tracked edits',
      `${COMMIT_RELEASE}\n${TAG_RELEASE}\nwriteFileSync('tracked.txt', 'uncommitted');`,
      /clean tracked\/untracked/,
    ],
    [
      'untracked work',
      `${COMMIT_RELEASE}\n${TAG_RELEASE}\nwriteFileSync('pending.txt', 'untracked');`,
      /clean tracked\/untracked/,
    ],
    ['missing tag', COMMIT_RELEASE, /target tag v1.2.3 must exist/],
    ['mismatched tag', `${TAG_RELEASE}\n${COMMIT_RELEASE}`, /target tag v1.2.3 points to/],
  ] as const)('rejects zero-exit release with %s before final push or PR', async (_kind, body, message) => {
    await withGitFixture(async (fixture) => {
      const releaseCommand = await fixture.releaseCommand(body);
      const runner = recordingGitRunner(fixture);
      const fetchFn = vi.fn<typeof fetch>(async () => {
        throw new Error('PR must not run after a failed release postcondition');
      });
      await expect(
        runReleaseTag({
          cwd: fixture.cwd,
          tag: '1.2.3',
          baseBranch: 'main',
          releaseCommand,
          skipPreflight: true,
          githubRepository: 'fixture/repo',
          githubToken: 'fixture-token',
          runner,
          fetchFn,
        }),
      ).rejects.toThrow(message);
      expect(runner.runs).toHaveLength(1);
      expect(runner.captures.filter((args) => args[0] === 'push')).toHaveLength(1);
      expect(fixture.remoteGit(['rev-parse', RELEASE_REF]).trim()).toBe(fixture.sourceCommit);
      expect(fetchFn).not.toHaveBeenCalled();
      expectBaseUnchanged(fixture);
    });
  });

  it('rejects a raced final push and stops PR creation while retaining the verified local release', async () => {
    await withGitFixture(async (fixture) => {
      const raced = fixture.commit('remote update while releasing');
      const releaseCommand = await fixture.releaseCommand(`${COMMIT_RELEASE}\n${TAG_RELEASE}`);
      let pushes = 0;
      const runner = recordingGitRunner(fixture, (args) => {
        if (args[0] === 'push' && ++pushes === 2) {
          fixture.git(['push', '--quiet', 'origin', `${raced}:${RELEASE_REF}`]);
        }
      });
      const fetchFn = vi.fn<typeof fetch>(async () => {
        throw new Error('PR must not run after a failed final push');
      });
      await expect(
        runReleaseTag({
          cwd: fixture.cwd,
          tag: '1.2.3',
          baseBranch: 'main',
          releaseCommand,
          skipPreflight: true,
          githubRepository: 'fixture/repo',
          githubToken: 'fixture-token',
          runner,
          fetchFn,
        }),
      ).rejects.toThrow(/explicit lease.*stale info/s);
      expect(fixture.remoteGit(['rev-parse', RELEASE_REF]).trim()).toBe(raced);
      expect(fixture.git(['rev-parse', `${TAG_REF}^{commit}`])).toBe(fixture.git(['rev-parse', 'HEAD']));
      expect(fetchFn).not.toHaveBeenCalled();
      expectBaseUnchanged(fixture);
    });
  });
});
