import type { GitFixture } from './git-fixture';
import {
  makeResponse,
  pullRequestListData,
  successfulGitHubResponse,
  type PullRequestFixtureOptions,
} from './http-fixture';

export const RECOVERY_BRANCH = 'changelog/1.2.3';
export const RECOVERY_TAG = 'v1.2.3';

export function seedRecovery(
  fixture: GitFixture,
  options: { local?: boolean; remote?: boolean; lightweight?: boolean; message?: string; branch?: string } = {},
): string {
  const branch = options.branch ?? RECOVERY_BRANCH;
  const message = options.message ?? 'Recovered release notes';
  const head = fixture.commit(message);
  fixture.git(options.lightweight ? ['tag', RECOVERY_TAG, head] : ['tag', '-a', RECOVERY_TAG, head, '-m', message]);
  if (options.local !== false) {
    fixture.git(['branch', branch, head]);
  }
  fixture.git([
    'push',
    '--quiet',
    'origin',
    `refs/tags/${RECOVERY_TAG}:refs/tags/${RECOVERY_TAG}`,
    ...(options.remote === false ? [] : [`${head}:refs/heads/${branch}`]),
  ]);
  return head;
}

export function recoveryFetch(options: PullRequestFixtureOptions & { absent?: boolean; missingBranch?: boolean } = {}) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    const path = new URL(url).pathname;
    if (method === 'GET' && path.endsWith('/pulls')) {
      return makeResponse(200, options.absent ? [] : [pullRequestListData(options)]);
    }
    if (options.missingBranch && method === 'GET' && path.includes('/git/ref/')) {
      return makeResponse(404, { message: 'Not Found' });
    }
    return successfulGitHubResponse(input, init, options);
  };
  return { calls, fetchFn };
}
