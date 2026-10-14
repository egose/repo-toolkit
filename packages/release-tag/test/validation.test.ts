import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapturingProcessRunner } from '@repo-toolkit/publish-package';

import {
  createReleasePullRequest,
  determineNextTag,
  resolveReleaseTagPlan,
  runPreflight,
  runReleaseBranch,
  runReleaseTag,
  type DeterminedTag,
  type ReleaseBranchResult,
  type ReleaseTagOptions,
  type ReleaseTagPlan,
} from '../src/index';
import { createReleaseRunner } from './release-fixture';
import { successfulGitHubResponse } from './http-fixture';
import { commitLog } from './commit-fixture';

const DETERMINED: DeterminedTag = {
  version: '1.2.3',
  tagVersion: 'v1.2.3',
  bump: null,
  lastTag: null,
  manual: true,
  noChanges: false,
};

const RELEASE: ReleaseBranchResult = {
  baseBranch: 'main',
  releaseBranch: 'changelog/1.2.3',
  releaseRan: false,
  skippedReason: 'skipped via skipRelease',
  tagMessage: 'Release notes',
  prTitle: 'chore(release): release candidate v1.2.3',
};

const DANGEROUS_BRANCHES = ['--mirror', '-D', 'main:other', 'refs/heads/main', 'a/../b', 'a.lock', 'a@{b', 'HEAD'];
const INVALID_BRANCHES = [
  ...DANGEROUS_BRANCHES,
  '',
  '@',
  'refs/tags/main',
  '/main',
  'main/',
  'a//b',
  '.hidden',
  'a/.hidden',
  'a.lock/b',
  'main.',
  'main..next',
  'main~1',
  'main^1',
  'main?next',
  'main*',
  'main[1]',
  'a\\b',
  'main branch',
  ' main',
  'main\t',
  'main\n',
  'main\0',
  'main\u0001',
  'main\u007f',
  'main\u0085',
  'main\ud800',
];
const UNSAFE_VERSIONS = [
  '9007199254740992.0.0',
  '1.9007199254740992.0',
  '1.2.9007199254740992',
  `${'9'.repeat(400)}.0.0`,
];
const INVALID_REPOSITORIES = [
  './repo',
  '../repo',
  'owner/.',
  'owner/..',
  'owner/repo/extra',
  'owner//repo',
  'owner/repo?route',
  'owner/repo#fragment',
  'owner/repo:route',
  'owner/repo\\route',
  '%2e%2e/repo',
  'owner/%2froute',
  'owner/repo\n',
  ' owner/repo',
  'owner\u0001/repo',
];

function createTransports(baseBranch = 'main') {
  const releaseRunner = createReleaseRunner({ baseBranch });
  const runner = {
    run: vi.fn<CapturingProcessRunner['run']>(),
    runShell: vi.fn<CapturingProcessRunner['runShell']>(),
    capture: vi.fn<CapturingProcessRunner['capture']>(releaseRunner.capture),
  };
  const fetchFn = vi.fn<typeof fetch>(async () => {
    throw new Error('unexpected fetch');
  });
  return { runner, fetchFn };
}

function optionsFor(
  transports: ReturnType<typeof createTransports>,
  overrides: ReleaseTagOptions = {},
): ReleaseTagOptions {
  return {
    cwd: tmpdir(),
    tag: 'v1.2.3',
    baseBranch: 'main',
    githubRepository: 'octo/repo',
    githubToken: 'validation-fixture-token',
    skipRelease: true,
    ...transports,
    ...overrides,
  };
}

function expectNoIo({ runner, fetchFn }: ReturnType<typeof createTransports>): void {
  expect(runner.capture).not.toHaveBeenCalled();
  expect(runner.run).not.toHaveBeenCalled();
  expect(runner.runShell).not.toHaveBeenCalled();
  expect(fetchFn).not.toHaveBeenCalled();
}

function stageCalls(plan: ReleaseTagPlan): Array<() => Promise<unknown>> {
  return [
    () => determineNextTag({ plan }),
    () => runPreflight({ plan, githubToken: 'validation-fixture-token' }),
    () => runReleaseBranch({ plan, determined: DETERMINED }),
    () =>
      createReleasePullRequest({
        plan,
        determined: DETERMINED,
        release: RELEASE,
        githubToken: 'validation-fixture-token',
      }),
  ];
}

beforeEach(() => {
  for (const key of ['GITHUB_REF_NAME', 'GITHUB_REF_TYPE', 'GITHUB_REF', 'GITHUB_REPOSITORY', 'GITHUB_TOKEN']) {
    vi.stubEnv(key, undefined);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('short Git ref boundaries', () => {
  it.each(INVALID_BRANCHES)('rejects %j in plans and orchestration before any I/O', async (branch) => {
    const transports = createTransports();
    for (const field of ['baseBranch', 'releaseBranch'] as const) {
      for (const dryRun of [false, true]) {
        const options = optionsFor(transports, { [field]: branch, dryRun });
        expect(() => resolveReleaseTagPlan(options)).toThrow(new RegExp(field));
        await expect(runReleaseTag(options)).rejects.toThrow(new RegExp(field));
      }
    }
    expectNoIo(transports);
  });

  it.each(DANGEROUS_BRANCHES)('rejects forged plan and release refs %j at direct stages', async (branch) => {
    const transports = createTransports();
    for (const field of ['baseBranch', 'releaseBranch'] as const) {
      for (const dryRun of [false, true]) {
        const plan = resolveReleaseTagPlan(optionsFor(transports, { dryRun }));
        const invalidPlan = { ...plan, [field]: branch };
        for (const call of stageCalls(invalidPlan)) {
          await expect(call()).rejects.toThrow(new RegExp(field));
        }
        await expect(
          createReleasePullRequest({
            plan,
            determined: DETERMINED,
            release: { ...RELEASE, [field]: branch },
            githubToken: 'validation-fixture-token',
          }),
        ).rejects.toThrow(new RegExp(`release\\.${field}`));
      }
    }
    expectNoIo(transports);
  });

  it.each([null, 42, {}])('rejects non-string refs %j in forged plans', async (value) => {
    const transports = createTransports();
    for (const field of ['baseBranch', 'releaseBranch'] as const) {
      const plan = { ...resolveReleaseTagPlan(optionsFor(transports)), [field]: value } as ReleaseTagPlan;
      for (const call of stageCalls(plan)) {
        await expect(call()).rejects.toThrow(new RegExp(field));
      }
    }
    expectNoIo(transports);
  });

  it.each([...DANGEROUS_BRANCHES, ' main ', 'main\n'])(
    'rejects environment ref %j before preflight or fetch',
    async (branch) => {
      vi.stubEnv('GITHUB_REF_NAME', branch);
      const transports = createTransports();
      for (const dryRun of [false, true]) {
        const options = optionsFor(transports, { baseBranch: undefined, dryRun });
        const plan = resolveReleaseTagPlan(options);
        await expect(runReleaseTag(options)).rejects.toThrow(/GITHUB_REF_NAME/);
        await expect(runPreflight({ plan })).rejects.toThrow(/GITHUB_REF_NAME/);
        await expect(runReleaseBranch({ plan, determined: DETERMINED })).rejects.toThrow(/GITHUB_REF_NAME/);
        await expect(createReleasePullRequest({ plan, determined: DETERMINED, release: RELEASE })).rejects.toThrow(
          /GITHUB_REF_NAME/,
        );
      }
      expectNoIo(transports);
    },
  );

  it.each(['GITHUB_REF_TYPE', 'GITHUB_REF'])('refuses arbitrary tag names identified by %s', async (marker) => {
    vi.stubEnv('GITHUB_REF_NAME', 'latest');
    vi.stubEnv(marker, marker === 'GITHUB_REF_TYPE' ? 'tag' : 'refs/tags/latest');
    const transports = createTransports();
    for (const dryRun of [false, true]) {
      const options = optionsFor(transports, { baseBranch: undefined, dryRun });
      const plan = resolveReleaseTagPlan(options);
      await expect(runReleaseTag(options)).rejects.toThrow(/tag checkout.*Check out.*--base-branch/);
      await expect(runPreflight({ plan })).rejects.toThrow(/tag checkout/);
      await expect(runReleaseBranch({ plan, determined: DETERMINED })).rejects.toThrow(/tag checkout/);
    }
    const onlyDetermine = await runReleaseTag(optionsFor(transports, { baseBranch: undefined, only: ['determine'] }));
    expect(onlyDetermine.determined).toEqual(DETERMINED);
    expectNoIo(transports);
  });

  it('retains explicit precedence over unused environment identities', async () => {
    vi.stubEnv('GITHUB_REF_TYPE', 'tag');
    vi.stubEnv('GITHUB_REF', 'refs/tags/latest');
    vi.stubEnv('GITHUB_REF_NAME', '--mirror');
    vi.stubEnv('GITHUB_REPOSITORY', '../repo');
    const transports = createTransports();
    const options = optionsFor(transports, { dryRun: true });
    expect((await runReleaseTag(options)).plan.baseBranch).toBe('main');
    const release = await runReleaseBranch({ plan: resolveReleaseTagPlan(options), determined: DETERMINED });
    expect(release.baseBranch).toBe('main');
    expectNoIo(transports);
  });

  it.each(['feature/nested/topic', 'développement/日本語/🚀', 'feature/naïve+test#1', 'foo./bar', 'feature/closing]'])(
    'preserves valid ref %j in no-I/O dry runs',
    async (branch) => {
      const transports = createTransports();
      const options = optionsFor(transports, { baseBranch: branch, releaseBranch: `release/${branch}`, dryRun: true });
      const plan = resolveReleaseTagPlan(options);
      const result = await runReleaseBranch({ plan, determined: DETERMINED });
      expect(result.baseBranch).toBe(branch);
      expect(result.releaseBranch).toBe(`release/${branch}`);
      expect((await runReleaseTag(options)).plan.releaseBranch).toBe(`release/${branch}`);
      expectNoIo(transports);
    },
  );

  it('agrees with Git about valid nested and Unicode branch syntax', () => {
    for (const branch of ['développement/日本語/🚀', 'feature/naïve+test#1', 'foo./bar', 'feature/closing]']) {
      expect(
        execFileSync('git', ['check-ref-format', '--branch', branch], {
          cwd: tmpdir(),
          encoding: 'utf8',
          env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
        }),
      ).toBe(`${branch}\n`);
      expect(resolveReleaseTagPlan({ baseBranch: branch }).baseBranch).toBe(branch);
    }
  });

  it.each(['environment', 'git'])('preserves nested Unicode base refs resolved from %s', async (source) => {
    const baseBranch = 'développement/日本語';
    const transports = createTransports(baseBranch);
    if (source === 'environment') {
      vi.stubEnv('GITHUB_REF_NAME', baseBranch);
    } else {
      transports.runner.capture.mockResolvedValueOnce({ stdout: `${baseBranch}\n`, stderr: '', code: 0 });
    }
    const result = await runReleaseTag(optionsFor(transports, { baseBranch: undefined, skipPr: true }));
    expect(result.release?.baseBranch).toBe(baseBranch);
    expect(
      transports.runner.capture.mock.calls.filter((call) => call[1][0] === 'symbolic-ref' && call[1][1] === '--short'),
    ).toHaveLength(source === 'git' ? 1 : 0);
    expect(transports.runner.run).not.toHaveBeenCalled();
    expect(transports.fetchFn).not.toHaveBeenCalled();
  });

  it('rejects explicit and generated base/release equality, including forged plans', async () => {
    const transports = createTransports();
    for (const dryRun of [false, true]) {
      for (const overrides of [{ releaseBranch: 'main' }, { baseBranch: 'changelog/1.2.3' }]) {
        const options = optionsFor(transports, { ...overrides, dryRun });
        expect(() => resolveReleaseTagPlan(options)).toThrow(/different from baseBranch/);
        await expect(runReleaseTag(options)).rejects.toThrow(/different from baseBranch/);
        const plan = { ...resolveReleaseTagPlan(optionsFor(transports, { dryRun })), ...overrides };
        for (const call of stageCalls(plan)) {
          await expect(call()).rejects.toThrow(/different from baseBranch/);
        }
      }
      const plan = resolveReleaseTagPlan(optionsFor(transports, { tag: undefined, releaseBranch: undefined, dryRun }));
      await expect(
        runReleaseBranch({ plan: { ...plan, baseBranch: 'changelog/1.2.3' }, determined: DETERMINED }),
      ).rejects.toThrow(/different from baseBranch/);
      await expect(
        createReleasePullRequest({ plan, determined: DETERMINED, release: { ...RELEASE, releaseBranch: 'main' } }),
      ).rejects.toThrow(/different from baseBranch/);
    }
    expectNoIo(transports);
  });

  it('rejects a manual release branch equal to the environment base in execution and dry-run', async () => {
    const transports = createTransports();
    vi.stubEnv('GITHUB_REF_NAME', 'changelog/1.2.3');
    for (const dryRun of [false, true]) {
      const options = optionsFor(transports, { baseBranch: undefined, dryRun });
      await expect(runReleaseTag(options)).rejects.toThrow(/different from baseBranch/);
      const plan = resolveReleaseTagPlan(options);
      await expect(runReleaseBranch({ plan, determined: DETERMINED })).rejects.toThrow(/different from baseBranch/);
    }
    expectNoIo(transports);
  });

  it.each(['explicit', 'environment'])(
    'rejects an automatically generated branch equal to the %s base before preflight',
    async (source) => {
      const transports = createTransports();
      const baseBranch = 'changelog/1.2.3';
      if (source === 'environment') {
        vi.stubEnv('GITHUB_REF_NAME', baseBranch);
      }
      await expect(
        runReleaseTag(
          optionsFor(transports, { tag: undefined, baseBranch: source === 'explicit' ? baseBranch : undefined }),
        ),
      ).rejects.toThrow(/different from baseBranch/);
      expect(transports.runner.capture.mock.calls.map((call) => call[1][0])).toEqual(['describe', 'log']);
      expect(transports.runner.run).not.toHaveBeenCalled();
      expect(transports.fetchFn).not.toHaveBeenCalled();
    },
  );

  it.each([...DANGEROUS_BRANCHES, 'main'])(
    'validates Git-inferred ref %j before preflight or mutation',
    async (branch) => {
      for (const direct of [false, true]) {
        const transports = createTransports();
        transports.runner.capture.mockResolvedValue({ stdout: `${branch}\n`, stderr: '', code: 0 });
        const options = optionsFor(transports, { baseBranch: undefined, releaseBranch: 'main' });
        const operation = direct
          ? runReleaseBranch({ plan: resolveReleaseTagPlan(options), determined: DETERMINED })
          : runReleaseTag(options);
        await expect(operation).rejects.toThrow(/baseBranch/);
        expect(transports.runner.capture.mock.calls.map((call) => call[1])).toEqual([
          ['symbolic-ref', '--short', 'HEAD'],
        ]);
        expect(transports.runner.run).not.toHaveBeenCalled();
        expect(transports.fetchFn).not.toHaveBeenCalled();
      }
    },
  );
});

describe('stable version and stage payload boundaries', () => {
  it.each(['true', 1, null])(
    'rejects forged allowEmptyRelease %j before direct-stage I/O',
    async (allowEmptyRelease) => {
      const transports = createTransports();
      const plan = { ...resolveReleaseTagPlan(optionsFor(transports)), allowEmptyRelease } as ReleaseTagPlan;
      for (const call of stageCalls(plan)) {
        await expect(call()).rejects.toThrow(/allowEmptyRelease must be a boolean/);
      }
      expectNoIo(transports);
    },
  );

  it.each(UNSAFE_VERSIONS)('rejects unsafe numeric components in %s across input paths', async (version) => {
    const transports = createTransports();
    for (const dryRun of [false, true]) {
      const plan = resolveReleaseTagPlan(optionsFor(transports, { dryRun }));
      for (const tag of [version, `v${version}`]) {
        expect(() => resolveReleaseTagPlan(optionsFor(transports, { tag, dryRun }))).toThrow(/safe integers/);
        await expect(runReleaseTag(optionsFor(transports, { tag, dryRun }))).rejects.toThrow(/safe integers/);
        await expect(determineNextTag({ plan: { ...plan, tag } })).rejects.toThrow(/safe integers/);
      }
      const determined = { ...DETERMINED, version, tagVersion: `v${version}` };
      await expect(runReleaseBranch({ plan, determined })).rejects.toThrow(/determined.version.*safe integers/);
      await expect(createReleasePullRequest({ plan, determined, release: RELEASE })).rejects.toThrow(
        /determined.version.*safe integers/,
      );
    }
    expectNoIo(transports);
  });

  it('accepts exact safe-integer boundaries without spawning processes', async () => {
    const transports = createTransports();
    for (const version of ['0.0.0', '9007199254740991.9007199254740991.9007199254740991']) {
      const plan = resolveReleaseTagPlan(optionsFor(transports, { tag: `v${version}`, dryRun: true }));
      const determined = await determineNextTag({ plan });
      expect(determined.version).toBe(version);
      expect(determined.tagVersion).toBe(`v${version}`);
      expect((await runReleaseBranch({ plan, determined })).releaseBranch).toBe(`changelog/${version}`);
    }
    expectNoIo(transports);
  });

  it.each(UNSAFE_VERSIONS)('refuses unsafe last tag v%s before reading commits', async (version) => {
    const transports = createTransports();
    transports.runner.capture.mockResolvedValue({ stdout: `v${version}\n`, stderr: '', code: 0 });
    await expect(runReleaseTag(optionsFor(transports, { tag: undefined }))).rejects.toThrow(/Last tag.*safe integers/);
    expect(transports.runner.capture.mock.calls.map((call) => call[1][0])).toEqual(['describe']);
    expect(transports.runner.run).not.toHaveBeenCalled();
    expect(transports.fetchFn).not.toHaveBeenCalled();
  });

  it('blocks an unsafe generated determined payload before preflight', async () => {
    const transports = createTransports();
    transports.runner.capture
      .mockResolvedValueOnce({ stdout: 'v1.2.9007199254740991\n', stderr: '', code: 0 })
      .mockResolvedValueOnce({ stdout: commitLog('fix: repair\n'), stderr: '', code: 0 });
    await expect(runReleaseTag(optionsFor(transports, { tag: undefined }))).rejects.toThrow(
      /determined.version.*safe integers/,
    );
    expect(transports.runner.capture.mock.calls.map((call) => call[1][0])).toEqual(['describe', 'log']);
    expect(transports.runner.run).not.toHaveBeenCalled();
    expect(transports.fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    { version: '--mirror', tagVersion: 'v--mirror' },
    { version: 'v1.2.3' },
    { version: '1.2.3\n' },
    { tagVersion: 'v1.2.4' },
    { tagVersion: 'v1.2.3\n' },
    { tagVersion: 'v1.2.9007199254740992' },
    { bump: 'unknown' },
    { lastTag: 'v1.2.9007199254740992' },
    { manual: 'true' },
    { noChanges: 'false' },
    { noChanges: undefined },
  ])('rejects malformed determined payload %j before token reads or I/O', async (overrides) => {
    const transports = createTransports();
    const determined = { ...DETERMINED, ...overrides } as DeterminedTag;
    for (const dryRun of [false, true]) {
      const plan = resolveReleaseTagPlan(optionsFor(transports, { githubTokenFile: 'must-not-be-read', dryRun }));
      await expect(runReleaseBranch({ plan, determined })).rejects.toThrow(/determined\./);
      await expect(createReleasePullRequest({ plan, determined, release: RELEASE })).rejects.toThrow(/determined\./);
    }
    expectNoIo(transports);
  });

  it('requires the plan tag to match the determined version at both downstream stages', async () => {
    const transports = createTransports();
    for (const dryRun of [false, true]) {
      const plan = resolveReleaseTagPlan(optionsFor(transports, { tag: 'v2.0.0', dryRun }));
      await expect(runReleaseBranch({ plan, determined: DETERMINED })).rejects.toThrow(
        /plan.tag must match determined.version/,
      );
      await expect(createReleasePullRequest({ plan, determined: DETERMINED, release: RELEASE })).rejects.toThrow(
        /plan.tag must match determined.version/,
      );
    }
    expectNoIo(transports);
  });

  it.each([
    { baseBranch: 'develop' },
    { releaseBranch: 'changelog/9.9.9' },
    { baseBranch: null },
    { releaseBranch: null },
    { prTitle: '' },
    { tagMessage: null },
    { releaseRan: 'true' },
    { releasedHead: 'abc123' },
    { releasedHead: '--mirror' },
    { releasedHead: `${'a'.repeat(40)}\n` },
    { skippedReason: false },
  ])('rejects inconsistent release payload %j before token reads or fetch', async (overrides) => {
    const transports = createTransports();
    for (const dryRun of [false, true]) {
      const plan = resolveReleaseTagPlan(optionsFor(transports, { githubTokenFile: 'must-not-be-read', dryRun }));
      await expect(
        createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: { ...RELEASE, ...overrides } as ReleaseBranchResult,
        }),
      ).rejects.toThrow(/release\./);
    }
    expectNoIo(transports);
  });

  it('requires a direct PR payload to match the inferred base and default release branch', async () => {
    const transports = createTransports();
    const plan = resolveReleaseTagPlan(optionsFor(transports, { tag: undefined, baseBranch: undefined }));
    vi.stubEnv('GITHUB_REF_NAME', 'develop');
    await expect(createReleasePullRequest({ plan, determined: DETERMINED, release: RELEASE })).rejects.toThrow(
      /release.baseBranch must match/,
    );
    vi.stubEnv('GITHUB_REF_NAME', undefined);
    await expect(
      createReleasePullRequest({
        plan,
        determined: DETERMINED,
        release: { ...RELEASE, releaseBranch: 'another/release' },
      }),
    ).rejects.toThrow(/release.releaseBranch must match/);
    expectNoIo(transports);
  });
});

describe('owner/repo and valid nested PR refs', () => {
  it.each(INVALID_REPOSITORIES)(
    'rejects repository routing shape %j at explicit and environment boundaries',
    async (repository) => {
      const transports = createTransports();
      expect(() => resolveReleaseTagPlan(optionsFor(transports, { githubRepository: repository }))).toThrow(
        /githubRepository/,
      );
      for (const dryRun of [false, true]) {
        const options = optionsFor(transports, { githubRepository: undefined, dryRun });
        const plan = resolveReleaseTagPlan(options);
        vi.stubEnv('GITHUB_REPOSITORY', repository);
        await expect(runReleaseTag(options)).rejects.toThrow(/GITHUB_REPOSITORY/);
        await expect(runPreflight({ plan })).rejects.toThrow(/GITHUB_REPOSITORY/);
        await expect(createReleasePullRequest({ plan, determined: DETERMINED, release: RELEASE })).rejects.toThrow(
          /GITHUB_REPOSITORY/,
        );
        const forged = { ...plan, githubRepository: repository };
        await expect(runPreflight({ plan: forged })).rejects.toThrow(/githubRepository/);
        await expect(
          createReleasePullRequest({ plan: forged, determined: DETERMINED, release: RELEASE }),
        ).rejects.toThrow(/githubRepository/);
      }
      expectNoIo(transports);
    },
  );

  it('preserves nested Unicode refs through release preparation and encoded PR cleanup', async () => {
    const baseBranch = 'développement/日本語';
    const transports = createTransports(baseBranch);
    const releaseBranch = 'release/日本語/🚀';
    const plan = resolveReleaseTagPlan(
      optionsFor(transports, {
        baseBranch,
        releaseBranch,
        githubRepository: 'octo-org/_repo.name-1',
        autoMergePr: true,
        deleteMergedBranch: true,
      }),
    );
    const release = await runReleaseBranch({ plan, determined: DETERMINED });
    expect(release.baseBranch).toBe(baseBranch);
    expect(release.releaseBranch).toBe(releaseBranch);
    transports.fetchFn.mockImplementation(async (url, init) =>
      successfulGitHubResponse(url, init, {
        number: 1,
        repository: 'octo-org/_repo.name-1',
        head: releaseBranch,
        base: baseBranch,
      }),
    );
    const result = await createReleasePullRequest({
      plan,
      determined: DETERMINED,
      release,
      githubToken: 'validation-fixture-token',
    });
    expect(result.branchDeleted).toBe(true);
    const create = transports.fetchFn.mock.calls[1];
    expect(JSON.parse(String(create[1]?.body))).toMatchObject({ head: releaseBranch, base: baseBranch });
    expect(transports.fetchFn.mock.calls[5][0]).toBe(
      'https://api.github.com/repos/octo-org/_repo.name-1/git/ref/heads/release/%E6%97%A5%E6%9C%AC%E8%AA%9E/%F0%9F%9A%80',
    );
    expect(transports.fetchFn.mock.calls[6][0]).toBe(
      'https://api.github.com/repos/octo-org/_repo.name-1/git/refs/heads/release/%E6%97%A5%E6%9C%AC%E8%AA%9E/%F0%9F%9A%80',
    );
  });
});
