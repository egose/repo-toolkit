import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createReleasePullRequest,
  formatPullRequestBody,
  resolveReleaseTagPlan,
  runReleaseTag,
  type ReleaseBranchResult,
  type ReleaseTagOptions,
  type ReleaseTagPlan,
} from '../src/index';
import {
  branchRefData,
  makeResponse,
  pullRequestData,
  pullRequestListData,
  successfulGitHubResponse,
  type PullRequestFixtureOptions,
} from './http-fixture';
import { createReleaseRunner, RELEASED_HEAD } from './release-fixture';
import { caughtError, DETERMINED, ENV_TOKEN, EXPLICIT_TOKEN, expectSecretFree, unsafeError } from './security-fixture';

const RELEASE: ReleaseBranchResult = {
  baseBranch: 'main',
  releaseBranch: 'changelog/1.2.3',
  releaseRan: true,
  releasedHead: RELEASED_HEAD,
  skippedReason: null,
  tagMessage: 'Verified release notes',
  prTitle: 'Release candidate v1.2.3',
};
const OTHER_HEAD = 'd'.repeat(40);

interface Call {
  url: URL;
  method: string;
  body: Record<string, unknown> | undefined;
}

interface State {
  exists: boolean;
  merged: boolean;
  deleted: boolean;
  sha: string;
}

function lifecycleFetch(
  initial: Partial<State> = {},
  handle?: (call: Call, state: State) => Response | undefined,
  fixture: PullRequestFixtureOptions = {},
) {
  const state: State = { exists: false, merged: false, deleted: false, sha: RELEASED_HEAD, ...initial };
  const calls: Call[] = [];
  const fetchFn = vi.fn<typeof fetch>(async (url, init) => {
    const call: Call = {
      url: new URL(String(url)),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const override = handle?.(call, state);
    if (override !== undefined) {
      return override;
    }
    const options = { ...fixture, sha: state.sha, merged: state.merged };
    if (call.url.pathname.endsWith('/pulls')) {
      if (call.method === 'GET') {
        return makeResponse(200, state.exists ? [pullRequestListData(options)] : []);
      }
      if (call.method === 'POST') {
        if (state.exists) {
          return makeResponse(422, { message: 'A pull request already exists' });
        }
        state.exists = true;
      }
    }
    if (call.method === 'PUT') {
      state.merged = true;
    }
    if (call.url.pathname.includes('/git/ref/heads/') && state.deleted) {
      return makeResponse(404, { message: 'Not Found' });
    }
    if (call.method === 'DELETE') {
      state.deleted = true;
    }
    return successfulGitHubResponse(url, init, options);
  });
  return { state, calls, fetchFn };
}

function run(fixture: ReturnType<typeof lifecycleFetch>, options: ReleaseTagOptions = {}, release = RELEASE) {
  return createReleasePullRequest({
    plan: resolveReleaseTagPlan({ tag: '1.2.3', baseBranch: 'main', githubRepository: 'octo/hello', ...options }),
    determined: DETERMINED,
    release,
    githubToken: EXPLICIT_TOKEN,
    fetchFn: fixture.fetchFn,
  });
}

function lookups(fixture: ReturnType<typeof lifecycleFetch>) {
  return fixture.calls.filter((call) => call.method === 'GET' && call.url.pathname.endsWith('/pulls'));
}

function creations(fixture: ReturnType<typeof lifecycleFetch>) {
  return fixture.calls.filter((call) => call.method === 'POST' && call.url.pathname.endsWith('/pulls'));
}

function mutations(fixture: ReturnType<typeof lifecycleFetch>) {
  return fixture.calls.filter((call) => call.method !== 'GET');
}

function expectRecovery(error: Error, stage: string) {
  expect(error.message).toContain('PR #42');
  expect(error.message).toContain('/octo/hello/pull/42');
  expect(error.message).toContain(`failed at ${stage}`);
  expect(error.message).toContain('Resume createReleasePullRequest');
  expect(error.message).toContain('verified determined/release metadata');
  expectSecretFree(error);
}

beforeEach(() => {
  for (const key of [
    'GITHUB_TOKEN',
    'GITHUB_REPOSITORY',
    'GITHUB_API_URL',
    'GITHUB_REF',
    'GITHUB_REF_NAME',
    'GITHUB_REF_TYPE',
  ]) {
    vi.stubEnv(key, undefined);
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('recoverable exact PR discovery', () => {
  it('reuses the same PR, updates its description and reapplies labels on repeated stage calls', async () => {
    const fixture = lifecycleFetch();
    const first = await run(fixture);
    const tagMessage = 'Revised notes\n\n-----BEGIN SSH SIGNATURE-----\nfixture-signature\n-----END SSH SIGNATURE-----';
    const second = await run(fixture, {}, { ...RELEASE, prTitle: 'Revised candidate', tagMessage });
    expect(first).toMatchObject({ number: 42, reused: false, merged: false });
    expect(second).toMatchObject({ number: 42, url: first.url, reused: true, merged: false });
    expect(creations(fixture)).toHaveLength(1);
    expect(fixture.calls.filter((call) => call.method === 'PATCH').map((call) => call.body)).toEqual([
      { title: 'Revised candidate', body: formatPullRequestBody(tagMessage) },
    ]);
    expect(fixture.calls.filter((call) => call.url.pathname.endsWith('/labels')).map((call) => call.body)).toEqual([
      { labels: ['changelog', 'release-candidate', 'v1.2.3'] },
      { labels: ['changelog', 'release-candidate', 'v1.2.3'] },
    ]);
    expect(lookups(fixture)).toHaveLength(2);
    for (const call of lookups(fixture)) {
      expect(Object.fromEntries(call.url.searchParams)).toEqual({
        state: 'all',
        head: 'octo:changelog/1.2.3',
        base: 'main',
        per_page: '2',
        page: '1',
      });
    }
    expect(fixture.calls.some((call) => call.method === 'PUT' || call.method === 'DELETE')).toBe(false);
    expect(JSON.stringify(fixture.calls.map((call) => call.body))).not.toContain('fixture-signature');
  });

  it('recovers from label failure after creation without duplicating the PR', async () => {
    let failLabels = true;
    const fixture = lifecycleFetch({}, (call) =>
      call.url.pathname.endsWith('/labels') && failLabels
        ? makeResponse(403, `Label permission denied ${EXPLICIT_TOKEN}`)
        : undefined,
    );
    expectRecovery(await caughtError(run(fixture, { autoMergePr: true, deleteMergedBranch: true })), 'labels');
    expect(fixture.state).toMatchObject({ exists: true, merged: false, deleted: false });
    failLabels = false;
    const result = await run(fixture, { autoMergePr: true, deleteMergedBranch: true });
    expect(result).toMatchObject({ reused: true, merged: true, branchDeleted: true });
    expect(creations(fixture)).toHaveLength(1);
    expect(fixture.calls.filter((call) => call.url.pathname.endsWith('/labels'))).toHaveLength(2);
    expect(fixture.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  });

  it('recovers an update failure on an existing PR with safe identity guidance', async () => {
    let failUpdate = true;
    const fixture = lifecycleFetch({ exists: true }, (call) =>
      call.method === 'PATCH' && failUpdate ? makeResponse(422, `Update refused ${EXPLICIT_TOKEN}`) : undefined,
    );
    expectRecovery(await caughtError(run(fixture)), 'update');
    expect(fixture.calls.some((call) => call.url.pathname.endsWith('/labels'))).toBe(false);
    failUpdate = false;
    expect((await run(fixture)).reused).toBe(true);
    expect(creations(fixture)).toHaveLength(0);
    expect(lookups(fixture)).toHaveLength(2);
  });

  it('recovers a protected-branch merge failure without another creation', async () => {
    let protectedBranch = true;
    const fixture = lifecycleFetch({}, (call) =>
      call.method === 'PUT' && protectedBranch
        ? makeResponse(405, { message: 'Required reviews have not been approved' })
        : undefined,
    );
    const error = await caughtError(run(fixture, { autoMergePr: true, deleteMergedBranch: true }));
    expectRecovery(error, 'merge');
    expect(error.message).toContain('required reviews/status checks');
    expect(fixture.state.deleted).toBe(false);
    protectedBranch = false;
    expect(await run(fixture, { autoMergePr: true, deleteMergedBranch: true })).toMatchObject({
      reused: true,
      merged: true,
      branchDeleted: true,
    });
    expect(creations(fixture)).toHaveLength(1);
  });

  it.each([409, 422])('recovers create status %i with one exact relookup and no create retry', async (status) => {
    const fixture = lifecycleFetch({}, (call, state) => {
      if (call.method === 'POST' && call.url.pathname.endsWith('/pulls')) {
        state.exists = true;
        return makeResponse(status, { message: 'Concurrent creation' });
      }
      return undefined;
    });
    expect(await run(fixture)).toMatchObject({ number: 42, reused: true });
    expect(creations(fixture)).toHaveLength(1);
    expect(lookups(fixture)).toHaveLength(2);
    expect(lookups(fixture)[0].url.href).toBe(lookups(fixture)[1].url.href);
    expect(fixture.calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  });

  it.each([409, 422])('stops when create status %i has no exact match in the one relookup', async (status) => {
    const fixture = lifecycleFetch({}, (call) =>
      call.method === 'POST' ? makeResponse(status, 'Validation failed') : undefined,
    );
    const error = await caughtError(run(fixture));
    expect(error.message).toContain(`status=${status}`);
    expect(error.message).toContain('single conflict relookup');
    expect(lookups(fixture)).toHaveLength(2);
    expect(creations(fixture)).toHaveLength(1);
    expect(fixture.calls).toHaveLength(3);
  });

  it('bounds the complete create-conflict, merge and cleanup path to ten HTTP requests', async () => {
    const fixture = lifecycleFetch({}, (call, state) => {
      if (call.method === 'POST' && call.url.pathname.endsWith('/pulls')) {
        state.exists = true;
        return makeResponse(422, 'Concurrent creation');
      }
      return undefined;
    });
    expect(await run(fixture, { autoMergePr: true, deleteMergedBranch: true })).toMatchObject({
      reused: true,
      merged: true,
      branchDeleted: true,
    });
    expect(fixture.calls).toHaveLength(10);
    expect(lookups(fixture)).toHaveLength(2);
    expect(creations(fixture)).toHaveLength(1);
    expect(
      fixture.calls.filter((call) => call.method === 'GET' && call.url.pathname.endsWith('/pulls/42')),
    ).toHaveLength(2);
  });

  it.each([400, 401, 403, 404, 429, 500, 503])(
    'does not retry or relookup other create failures (%i)',
    async (status) => {
      const fixture = lifecycleFetch({}, (call) =>
        call.method === 'POST' ? makeResponse(status, 'Creation refused') : undefined,
      );
      expect((await caughtError(run(fixture))).message).toContain(`status=${status}`);
      expect(lookups(fixture)).toHaveLength(1);
      expect(creations(fixture)).toHaveLength(1);
      expect(fixture.calls).toHaveLength(2);
    },
  );

  it.each(['open', 'merged', 'duplicate'] as const)(
    'rejects ambiguous %s records without following pagination or mutating',
    async (kind) => {
      const records = [
        pullRequestListData(),
        pullRequestListData({ number: kind === 'duplicate' ? 42 : 43, merged: kind === 'merged' }),
      ];
      const fixture = lifecycleFetch(
        {},
        () =>
          new Response(JSON.stringify(records), {
            headers: { Link: '<https://untrusted.example/page2>; rel="next"' },
          }),
      );
      expect((await caughtError(run(fixture))).message).toContain('Ambiguous release PR lookup');
      expect(fixture.calls).toHaveLength(1);
      expect(mutations(fixture)).toHaveLength(0);
    },
  );

  it('rejects ambiguity in a create-conflict relookup without a third lookup', async () => {
    const fixture = lifecycleFetch({}, (call, state) => {
      if (call.method === 'POST') {
        state.exists = true;
        return makeResponse(422, 'Concurrent creation');
      }
      if (state.exists) {
        return makeResponse(200, [pullRequestListData(), pullRequestListData({ number: 43 })]);
      }
      return undefined;
    });
    expect((await caughtError(run(fixture))).message).toContain('Ambiguous');
    expect(fixture.calls).toHaveLength(3);
    expect(creations(fixture)).toHaveLength(1);
  });

  it('accepts canonical repository casing while keeping branch identity case-sensitive', async () => {
    const fixture = lifecycleFetch({ exists: true }, undefined, { repository: 'Octo/Hello' });
    expect((await run(fixture)).reused).toBe(true);
    expect(lookups(fixture)[0].url.searchParams.get('head')).toBe('octo:changelog/1.2.3');
  });
});

type ListData = ReturnType<typeof pullRequestListData>;
const IDENTITY_CASES: Array<{ name: string; change: (pull: ListData) => unknown }> = [
  {
    name: 'fork head',
    change: (pull) => ({
      ...pull,
      head: {
        ...pull.head,
        repo: { ...pull.head.repo, full_name: 'fork/hello', owner: { login: 'fork' }, id: 456, fork: true },
      },
    }),
  },
  {
    name: 'different base repository',
    change: (pull) => ({
      ...pull,
      base: { ...pull.base, repo: { ...pull.base.repo, full_name: 'other/hello', owner: { login: 'other' } } },
    }),
  },
  {
    name: 'different head repository ID',
    change: (pull) => ({ ...pull, head: { ...pull.head, repo: { ...pull.head.repo, id: 456 } } }),
  },
  {
    name: 'inconsistent repository owner',
    change: (pull) => ({ ...pull, head: { ...pull.head, repo: { ...pull.head.repo, owner: { login: 'other' } } } }),
  },
  {
    name: 'inconsistent repository name',
    change: (pull) => ({ ...pull, base: { ...pull.base, repo: { ...pull.base.repo, name: 'different' } } }),
  },
  { name: 'deleted head repository', change: (pull) => ({ ...pull, head: { ...pull.head, repo: null } }) },
  { name: 'missing head metadata', change: (pull) => ({ ...pull, head: undefined }) },
  { name: 'base mismatch', change: (pull) => ({ ...pull, base: { ...pull.base, ref: 'develop' } }) },
  { name: 'head equals base', change: (pull) => ({ ...pull, head: { ...pull.head, ref: 'main' } }) },
  { name: 'head case mismatch', change: (pull) => ({ ...pull, head: { ...pull.head, ref: 'Changelog/1.2.3' } }) },
  { name: 'unverified released head', change: (pull) => ({ ...pull, head: { ...pull.head, sha: OTHER_HEAD } }) },
];

describe.each(['lookup', 'create', 'read', 'update'] as const)('exact identities in %s responses', (stage) => {
  it.each(IDENTITY_CASES)('rejects $name before subsequent mutations', async ({ change }) => {
    const fixture = lifecycleFetch({ exists: stage !== 'create' }, (call) => {
      if (stage === 'lookup' && call.url.pathname.endsWith('/pulls')) {
        return makeResponse(200, [change(pullRequestListData())]);
      }
      if (stage === 'create' && call.method === 'POST') {
        return makeResponse(201, change(pullRequestData()));
      }
      if (stage === 'read' && call.url.pathname.endsWith('/pulls/42')) {
        return makeResponse(200, change(pullRequestData()));
      }
      if (stage === 'update' && call.method === 'PATCH') {
        return makeResponse(200, change(pullRequestData()));
      }
      return undefined;
    });
    const error = await caughtError(run(fixture, { autoMergePr: true, deleteMergedBranch: true }));
    expect(error.message).toMatch(/identity|repository|shape|releasedHead/);
    expect(
      fixture.calls.some(
        (call) => call.url.pathname.endsWith('/labels') || call.method === 'PUT' || call.method === 'DELETE',
      ),
    ).toBe(false);
    expect(mutations(fixture)).toHaveLength(stage === 'create' || stage === 'update' ? 1 : 0);
    if (stage !== 'lookup') {
      expectRecovery(error, stage);
    }
  });
});

describe('real REST list/detail shapes and closed PR recovery', () => {
  it('reads detail merged state even though the list response has no merged boolean', async () => {
    const list = pullRequestListData({ merged: true });
    expect(Object.prototype.hasOwnProperty.call(list, 'merged')).toBe(false);
    const fixture = lifecycleFetch({ exists: true, merged: true });
    const result = await run(fixture, { autoMergePr: true, deleteMergedBranch: true });
    expect(result).toMatchObject({ reused: true, merged: true, branchDeleted: true });
    expect(fixture.calls.map((call) => call.method)).toEqual(['GET', 'GET', 'POST', 'GET', 'DELETE']);
    expect(fixture.calls[1].url.pathname).toBe('/repos/octo/hello/pulls/42');
  });

  it('gives closed-unmerged guidance without recreating, reopening, labeling or deleting', async () => {
    const fixture = lifecycleFetch({ exists: true }, (call) =>
      call.url.pathname.endsWith('/pulls/42') ? makeResponse(200, pullRequestData({ state: 'closed' })) : undefined,
    );
    const error = await caughtError(run(fixture, { autoMergePr: true, deleteMergedBranch: true }));
    expectRecovery(error, 'read');
    expect(error.message).toContain('closed without merging');
    expect(error.message).toContain('Reopen that PR');
    expect(mutations(fixture)).toHaveLength(0);
  });

  it.each([undefined, null, false, 'true', 1, {}, []])(
    'never treats a list timestamp as merged when detail merged is %j',
    async (merged) => {
      const fixture = lifecycleFetch({ exists: true, merged: true }, (call) =>
        call.url.pathname.endsWith('/pulls/42')
          ? makeResponse(200, { ...pullRequestData({ merged: true }), merged })
          : undefined,
      );
      expectRecovery(await caughtError(run(fixture, { autoMergePr: true, deleteMergedBranch: true })), 'read');
      expect(mutations(fixture)).toHaveLength(0);
    },
  );

  it('refuses contradictory open/merged detail metadata', async () => {
    const fixture = lifecycleFetch({ exists: true }, (call) =>
      call.url.pathname.endsWith('/pulls/42')
        ? makeResponse(200, pullRequestData({ state: 'open', merged: true }))
        : undefined,
    );
    expect((await caughtError(run(fixture))).message).toContain('consistent boolean merged state');
    expect(mutations(fixture)).toHaveLength(0);
  });

  it('recovers deletion failure on an already-merged PR and remains idempotent after deletion', async () => {
    let failDeletion = true;
    const fixture = lifecycleFetch({ exists: true, merged: true }, (call) =>
      call.method === 'DELETE' && failDeletion ? makeResponse(403, `Cannot delete ${EXPLICIT_TOKEN}`) : undefined,
    );
    const options = { autoMergePr: true, deleteMergedBranch: true };
    const error = await caughtError(run(fixture, options));
    expectRecovery(error, 'cleanup');
    expect(error.message).toContain('Merge is confirmed');
    failDeletion = false;
    expect(await run(fixture, options)).toMatchObject({ reused: true, merged: true, branchDeleted: true });
    const completed = await run(fixture, options);
    expect(completed).toMatchObject({ reused: true, merged: true, branchDeleted: true });
    expect(creations(fixture)).toHaveLength(0);
    expect(fixture.calls.filter((call) => call.method === 'PUT' || call.method === 'PATCH')).toHaveLength(0);
    expect(fixture.calls.filter((call) => call.method === 'DELETE')).toHaveLength(2);
    expect(fixture.calls.filter((call) => call.url.pathname.endsWith('/labels'))).toHaveLength(3);
  });

  it('recovers a lost successful merge response by confirming details before cleanup', async () => {
    let loseResponse = true;
    const fixture = lifecycleFetch({}, (call, state) => {
      if (call.method === 'PUT' && loseResponse) {
        state.merged = true;
        throw unsafeError(`Connection lost ${EXPLICIT_TOKEN}`);
      }
      return undefined;
    });
    const options = { autoMergePr: true, deleteMergedBranch: true };
    expectRecovery(await caughtError(run(fixture, options)), 'merge');
    expect(fixture.state.deleted).toBe(false);
    loseResponse = false;
    expect(await run(fixture, options)).toMatchObject({ reused: true, merged: true, branchDeleted: true });
    expect(creations(fixture)).toHaveLength(1);
    expect(fixture.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  });

  it('accepts an already-deleted ref after verified merge without attempting DELETE', async () => {
    const fixture = lifecycleFetch({ exists: true, merged: true, deleted: true });
    expect(await run(fixture, { autoMergePr: true, deleteMergedBranch: true })).toMatchObject({
      reused: true,
      merged: true,
      branchDeleted: true,
    });
    expect(fixture.calls.filter((call) => call.method === 'DELETE' || call.method === 'PUT')).toHaveLength(0);
    expect(fixture.calls).toHaveLength(4);
  });

  it('accepts GitHub-owned branch deletion immediately after a confirmed merge', async () => {
    const fixture = lifecycleFetch({}, (call) =>
      call.url.pathname.includes('/git/ref/heads/') ? makeResponse(404, { message: 'Not Found' }) : undefined,
    );
    expect((await run(fixture, { autoMergePr: true, deleteMergedBranch: true })).branchDeleted).toBe(true);
    expect(fixture.calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  });

  it.each([
    { autoMergePr: false, deleteMergedBranch: true },
    { autoMergePr: true, deleteMergedBranch: false },
  ])('reports already-merged state without unrequested cleanup (%j)', async (options) => {
    const fixture = lifecycleFetch({ exists: true, merged: true });
    expect(await run(fixture, options)).toMatchObject({ reused: true, merged: true, branchDeleted: false });
    expect(fixture.calls).toHaveLength(3);
    expect(mutations(fixture).map((call) => call.url.pathname)).toEqual(['/repos/octo/hello/issues/42/labels']);
  });
});

describe('malformed PR response metadata', () => {
  it.each([{}, null, 'invalid JSON', '', { items: [] }])(
    'rejects a malformed list response without creation (%j)',
    async (body) => {
      const fixture = lifecycleFetch({}, () => makeResponse(200, body));
      expect((await caughtError(run(fixture))).message).toMatch(/array|not valid JSON/);
      expect(fixture.calls).toHaveLength(1);
      expect(mutations(fixture)).toHaveLength(0);
    },
  );

  it.each([
    { number: 0 },
    { number: -1 },
    { number: 1.5 },
    { number: Number.MAX_SAFE_INTEGER + 1 },
    { number: '42' },
    { html_url: 'https://github.com/other/repo/pull/42' },
    { html_url: 'https://github.com/octo/hello/pull/43' },
    { html_url: 'javascript:alert(42)' },
    { html_url: 'not a URL' },
    { html_url: null },
    { merged: undefined },
    { merged: null },
    { merged: 'false' },
    { state: 'unknown' },
    { merged: true, state: 'open' },
    { merged: true, state: 'closed' },
  ])('refuses malformed create metadata before labels (%j)', async (changes) => {
    const fixture = lifecycleFetch({}, (call) =>
      call.method === 'POST' ? makeResponse(201, { ...pullRequestData(), ...changes }) : undefined,
    );
    const error = await caughtError(run(fixture, { autoMergePr: true, deleteMergedBranch: true }));
    expect(error.message).toContain('failed at create');
    expect(error.message).toContain('inspect the exact repository/head/base');
    expect(fixture.calls).toHaveLength(2);
    expectSecretFree(error);
  });

  it.each([undefined, null, '', 'b'.repeat(39), 'B'.repeat(40), '0'.repeat(40), 'x'.repeat(40), 42])(
    'rejects invalid API head SHA %j before labels or merge',
    async (sha) => {
      const pull = pullRequestData();
      const fixture = lifecycleFetch({}, (call) =>
        call.method === 'POST' ? makeResponse(201, { ...pull, head: { ...pull.head, sha } }) : undefined,
      );
      const error = await caughtError(
        run(fixture, { autoMergePr: true, deleteMergedBranch: true }, { ...RELEASE, releasedHead: undefined }),
      );
      expectRecovery(error, 'create');
      expect(error.message).toContain('full nonzero Git object ID');
      expect(fixture.calls).toHaveLength(2);
    },
  );

  it('uses the shared full-object-ID contract for a SHA-256 head and cleanup ref', async () => {
    const sha = 'e'.repeat(64);
    const fixture = lifecycleFetch({ sha });
    expect(
      await run(fixture, { autoMergePr: true, deleteMergedBranch: true }, { ...RELEASE, releasedHead: sha }),
    ).toMatchObject({ merged: true, branchDeleted: true });
    expect(fixture.calls.find((call) => call.method === 'PUT')?.body?.sha).toBe(sha);
  });
});

describe('affirmative merge confirmation and expected SHA', () => {
  it.each([
    { merged: false, message: 'Merge refused' },
    {},
    null,
    [],
    { merged: 'true' },
    { merged: 1 },
    { merged: null },
    { merged: {} },
    '',
    'invalid JSON',
    '{"merged":true',
  ])('never cleans up after an unconfirmed HTTP 200 merge response (%j)', async (body) => {
    const fixture = lifecycleFetch({}, (call) => (call.method === 'PUT' ? makeResponse(200, body) : undefined));
    const error = await caughtError(run(fixture, { autoMergePr: true, deleteMergedBranch: true }));
    expectRecovery(error, 'merge');
    expect(error.message).toMatch(/not confirm|not valid JSON/);
    expect(fixture.calls.some((call) => call.url.pathname.includes('/git/ref'))).toBe(false);
    expect(fixture.state.deleted).toBe(false);
  });

  it.each([204, 405, 409, 422, 500])('refuses HTTP %i even with an affirmative body where possible', async (status) => {
    const fixture = lifecycleFetch({}, (call) =>
      call.method === 'PUT' ? makeResponse(status, { merged: true }) : undefined,
    );
    expectRecovery(await caughtError(run(fixture, { autoMergePr: true, deleteMergedBranch: true })), 'merge');
    expect(fixture.calls.some((call) => call.url.pathname.includes('/git/ref'))).toBe(false);
  });

  it.each(['merge', 'squash', 'rebase'] as const)(
    'pins the expected SHA using %s with and without stage-2 verification',
    async (mergeMethod) => {
      for (const releasedHead of [RELEASED_HEAD, undefined]) {
        const fixture = lifecycleFetch();
        const result = await run(fixture, { autoMergePr: true, mergeMethod }, { ...RELEASE, releasedHead });
        expect(result.merged).toBe(true);
        expect(fixture.calls.filter((call) => call.method === 'PUT').map((call) => call.body)).toEqual([
          { sha: RELEASED_HEAD, merge_method: mergeMethod },
        ]);
        expect(fixture.calls.some((call) => call.url.pathname.includes('/git/ref'))).toBe(false);
      }
    },
  );

  it.each(['read', 'update', 'merge validation'] as const)(
    'rejects head changes during %s even without releasedHead',
    async (stage) => {
      let detailReads = 0;
      const fixture = lifecycleFetch({ exists: true }, (call) => {
        if (call.method === 'GET' && call.url.pathname.endsWith('/pulls/42')) {
          detailReads += 1;
          if (stage === 'read' || (stage === 'merge validation' && detailReads === 2)) {
            return makeResponse(200, pullRequestData({ sha: OTHER_HEAD }));
          }
        }
        if (stage === 'update' && call.method === 'PATCH') {
          return makeResponse(200, pullRequestData({ sha: OTHER_HEAD }));
        }
        return undefined;
      });
      const error = await caughtError(
        run(fixture, { autoMergePr: true, deleteMergedBranch: true }, { ...RELEASE, releasedHead: undefined }),
      );
      expectRecovery(error, stage);
      expect(error.message).toContain('head SHA changed');
      expect(fixture.calls.some((call) => call.method === 'PUT' || call.method === 'DELETE')).toBe(false);
    },
  );

  it.each(['number', 'repository', 'base'] as const)(
    'rejects changed %s identity on the final pre-merge detail read',
    async (identity) => {
      const fixture = lifecycleFetch({}, (call) =>
        call.method === 'GET' && call.url.pathname.endsWith('/pulls/42')
          ? makeResponse(
              200,
              pullRequestData(
                identity === 'number'
                  ? { number: 43 }
                  : identity === 'repository'
                    ? { repositoryId: 456 }
                    : { base: 'develop' },
              ),
            )
          : undefined,
      );
      expectRecovery(
        await caughtError(run(fixture, { autoMergePr: true, deleteMergedBranch: true })),
        'merge validation',
      );
      expect(fixture.calls.some((call) => call.method === 'PUT' || call.method === 'DELETE')).toBe(false);
    },
  );

  it('pins against a head update racing after the last read and does not delete after GitHub rejects it', async () => {
    const fixture = lifecycleFetch({}, (call, state) => {
      if (call.method === 'PUT') {
        state.sha = OTHER_HEAD;
        expect(call.body?.sha).toBe(RELEASED_HEAD);
        return makeResponse(409, { message: 'Head branch was modified' });
      }
      return undefined;
    });
    expectRecovery(await caughtError(run(fixture, { autoMergePr: true, deleteMergedBranch: true })), 'merge');
    expect(fixture.state.deleted).toBe(false);
    expect(fixture.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  });

  it('recognizes another actor merging during label application and skips the merge mutation', async () => {
    const fixture = lifecycleFetch({}, (call, state) => {
      if (call.url.pathname.endsWith('/labels')) {
        state.merged = true;
      }
      return undefined;
    });
    expect(await run(fixture, { autoMergePr: true, deleteMergedBranch: true })).toMatchObject({
      reused: false,
      merged: true,
      branchDeleted: true,
    });
    expect(fixture.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });

  it('preserves mergeMethod, verified head, and hidden transports through full orchestration', async () => {
    const fixture = lifecycleFetch();
    const result = await runReleaseTag({
      tag: '1.2.3',
      baseBranch: 'main',
      githubRepository: 'octo/hello',
      githubToken: EXPLICIT_TOKEN,
      releaseCommand: 'controlled-release',
      skipPreflight: true,
      autoMergePr: true,
      mergeMethod: 'squash',
      runner: createReleaseRunner(),
      fetchFn: fixture.fetchFn,
    });
    expect(result.plan.mergeMethod).toBe('squash');
    expect(result.release?.releasedHead).toBe(RELEASED_HEAD);
    expect(result.pullRequest).toMatchObject({ reused: false, merged: true });
    expect(fixture.calls.find((call) => call.method === 'PUT')?.body).toEqual({
      sha: RELEASED_HEAD,
      merge_method: 'squash',
    });
    expect('runner' in result.plan).toBe(false);
    expect('fetchFn' in result.plan).toBe(false);
    expectSecretFree(result);
  });

  it.each(['queue', 'MERGE', ' merge', '', null, 1, false, {}, []])(
    'validates a forged direct-stage mergeMethod before I/O (%j)',
    async (mergeMethod) => {
      const fixture = lifecycleFetch();
      const plan = {
        ...resolveReleaseTagPlan({ baseBranch: 'main', githubRepository: 'octo/hello' }),
        mergeMethod,
      } as ReleaseTagPlan;
      await expect(
        createReleasePullRequest({
          plan,
          determined: DETERMINED,
          release: RELEASE,
          githubToken: EXPLICIT_TOKEN,
          fetchFn: fixture.fetchFn,
        }),
      ).rejects.toThrow(/mergeMethod/);
      expect(fixture.calls).toHaveLength(0);
    },
  );
});

describe('release-ref deletion guards', () => {
  it.each([
    { ref: 'refs/heads/main', object: { type: 'commit', sha: RELEASED_HEAD } },
    branchRefData({ head: 'different/release' }),
    { ref: 'changelog/1.2.3', object: { type: 'commit', sha: RELEASED_HEAD } },
    { ref: 'refs/heads/changelog/1.2.3', object: { type: 'tag', sha: RELEASED_HEAD } },
    { ref: 'refs/heads/changelog/1.2.3', object: null },
    { ref: 'refs/heads/changelog/1.2.3' },
    branchRefData({ sha: OTHER_HEAD }),
    branchRefData({ sha: 'abcd' }),
    branchRefData({ sha: '0'.repeat(40) }),
    [],
    null,
    'invalid JSON',
  ])('refuses cleanup on a mismatched or malformed current ref (%j)', async (body) => {
    const fixture = lifecycleFetch({}, (call) =>
      call.url.pathname.includes('/git/ref/heads/') ? makeResponse(200, body) : undefined,
    );
    const error = await caughtError(run(fixture, { autoMergePr: true, deleteMergedBranch: true }));
    expectRecovery(error, 'cleanup');
    expect(error.message).toContain('Merge is confirmed');
    expect(fixture.calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
    expect(fixture.state).toMatchObject({ merged: true, deleted: false });
  });

  it.each([401, 403, 409, 422, 500])('does not treat ref-read HTTP %i as branch absence', async (status) => {
    const fixture = lifecycleFetch({ exists: true, merged: true }, (call) =>
      call.url.pathname.includes('/git/ref/heads/') ? makeResponse(status, 'Ref read failed') : undefined,
    );
    expectRecovery(await caughtError(run(fixture, { autoMergePr: true, deleteMergedBranch: true })), 'cleanup');
    expect(fixture.calls.filter((call) => call.method === 'DELETE')).toHaveLength(0);
  });

  it('requires the documented 204 deletion acknowledgment', async () => {
    const fixture = lifecycleFetch({}, (call) => (call.method === 'DELETE' ? makeResponse(200, {}) : undefined));
    expectRecovery(await caughtError(run(fixture, { autoMergePr: true, deleteMergedBranch: true })), 'cleanup');
    expect(fixture.calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });
});

describe('safe partial lifecycle diagnostics', () => {
  it('sanitizes thrown strings after creation and retains recovery guidance', async () => {
    const fixture = lifecycleFetch({}, (call) => {
      if (call.url.pathname.endsWith('/labels')) {
        throw `Label transport failed ${EXPLICIT_TOKEN}`;
      }
      return undefined;
    });
    const error = await caughtError(run(fixture));
    expectRecovery(error, 'labels');
    expect(error.message).toContain('Label transport failed [redacted]');
  });

  it.each(['read', 'update', 'labels', 'merge validation', 'merge', 'cleanup'] as const)(
    'reports safe PR identity and %s recovery without caller causes or secrets',
    async (stage) => {
      vi.stubEnv('GITHUB_TOKEN', ENV_TOKEN);
      let detailReads = 0;
      const fixture = lifecycleFetch(
        { exists: true },
        (call) => {
          if (call.method === 'GET' && call.url.pathname.endsWith('/pulls/42')) {
            detailReads += 1;
          }
          const fail =
            (stage === 'read' && detailReads === 1 && call.url.pathname.endsWith('/pulls/42')) ||
            (stage === 'update' && call.method === 'PATCH') ||
            (stage === 'labels' && call.url.pathname.endsWith('/labels')) ||
            (stage === 'merge validation' && detailReads === 2 && call.method === 'GET') ||
            (stage === 'merge' && call.method === 'PUT') ||
            (stage === 'cleanup' && call.method === 'DELETE');
          if (fail) {
            throw unsafeError(`Transport failure ${EXPLICIT_TOKEN} ${ENV_TOKEN}`, 'TimeoutError');
          }
          return undefined;
        },
        { url: `https://${EXPLICIT_TOKEN}@github.com/octo/hello/pull/42?token=${ENV_TOKEN}` },
      );
      const error = await caughtError(run(fixture, { autoMergePr: true, deleteMergedBranch: true }));
      expectRecovery(error, stage);
      expect(error.name).toBe('TimeoutError');
      expect(error.message).toContain('[redacted]');
      expect(Object.keys(error)).not.toContain('request');
    },
  );
});
