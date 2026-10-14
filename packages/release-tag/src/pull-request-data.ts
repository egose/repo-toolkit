import { isPlainObject } from '@repo-toolkit/publish-package';

import type { GitHubRequestResult } from './github';
import { assertDistinctBranches, assertGitObjectId, parseOwnerRepo } from './validation';

export interface ExpectedPullRequest {
  owner: string;
  repo: string;
  head: string;
  base: string;
  releasedHead?: string;
}

export interface PullRequestReference {
  number: number;
  url: string;
}

export interface PullRequestRecord extends PullRequestReference {
  state: 'open' | 'closed';
  headSha: string;
  repositoryId: number;
}

export interface PullRequestDetails extends PullRequestRecord {
  merged: boolean;
}

export function parsePullRequestJson(response: GitHubRequestResult, label: string): unknown {
  try {
    return JSON.parse(response.text);
  } catch {
    throw new Error(`GitHub API response from ${label} was not valid JSON (status=${response.status})`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`GitHub API response from ${label} had an unexpected shape`);
  }
  return value;
}

function positiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function parsePullRequestReference(
  value: unknown,
  expected: ExpectedPullRequest,
  label: string,
): PullRequestReference {
  const data = record(value, label);
  if (!positiveId(data.number)) {
    throw new Error(`GitHub API response from ${label} is missing a numeric pull request number`);
  }
  const invalidUrl = new Error(
    `GitHub API response from ${label} is missing a valid html_url for the expected repository and PR number`,
  );
  if (typeof data.html_url !== 'string' || /[\s\\\p{Cc}\p{Cs}]/u.test(data.html_url)) {
    throw invalidUrl;
  }
  let url: URL;
  try {
    url = new URL(data.html_url);
  } catch {
    throw invalidUrl;
  }
  const parts = url.pathname.split('/');
  const suffix = parts.slice(-4);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    suffix[0]?.toLowerCase() !== expected.owner.toLowerCase() ||
    suffix[1]?.toLowerCase() !== expected.repo.toLowerCase() ||
    suffix[2] !== 'pull' ||
    suffix[3] !== String(data.number)
  ) {
    throw invalidUrl;
  }
  return { number: data.number, url: data.html_url };
}

function repositoryId(value: unknown, expected: ExpectedPullRequest, label: string): number {
  const repo = record(value, label);
  const identity = parseOwnerRepo(repo.full_name, `${label}.repo.full_name`);
  const owner = record(repo.owner, `${label}.repo.owner`);
  if (
    identity.owner.toLowerCase() !== expected.owner.toLowerCase() ||
    identity.repo.toLowerCase() !== expected.repo.toLowerCase() ||
    typeof repo.name !== 'string' ||
    repo.name.toLowerCase() !== identity.repo.toLowerCase() ||
    typeof owner.login !== 'string' ||
    owner.login.toLowerCase() !== identity.owner.toLowerCase()
  ) {
    throw new Error(`${label} repository identity mismatch; cross-repository or fork pull requests are not supported`);
  }
  if (!positiveId(repo.id)) {
    throw new Error(`${label} is missing a valid repository ID`);
  }
  return repo.id;
}

export function parsePullRequestRecord(
  value: unknown,
  expected: ExpectedPullRequest,
  label: string,
): PullRequestRecord {
  const data = record(value, label);
  const reference = parsePullRequestReference(data, expected, label);
  const head = record(data.head, `${label}.head`);
  const base = record(data.base, `${label}.base`);
  if (head.ref !== expected.head || base.ref !== expected.base) {
    throw new Error(`${label} head/base identity mismatch; refusing a different release or base branch`);
  }
  const headRepoId = repositoryId(head.repo, expected, `${label}.head`);
  const baseRepoId = repositoryId(base.repo, expected, `${label}.base`);
  if (headRepoId !== baseRepoId) {
    throw new Error(`${label} head/base repository IDs differ; refusing a fork or changed repository identity`);
  }
  assertGitObjectId(head.sha, `${label}.head.sha`);
  if (expected.releasedHead !== undefined && head.sha !== expected.releasedHead) {
    throw new Error(
      `${label} head SHA does not match release.releasedHead; inspect the released commit before resuming`,
    );
  }
  if (data.state !== 'open' && data.state !== 'closed') {
    throw new Error(`${label} is missing a valid open/closed pull request state`);
  }
  return { ...reference, state: data.state, headSha: head.sha, repositoryId: baseRepoId };
}

export function parsePullRequestList(
  response: GitHubRequestResult,
  expected: ExpectedPullRequest,
): PullRequestRecord | null {
  const data = parsePullRequestJson(response, 'GET pulls');
  if (!Array.isArray(data)) {
    throw new Error('GitHub API response from GET pulls must be an array');
  }
  if (data.length > 1) {
    throw new Error(
      'Ambiguous release PR lookup: multiple records match the repository/head/base filters; inspect them before resuming',
    );
  }
  return data.length === 0 ? null : parsePullRequestRecord(data[0], expected, 'GET pulls');
}

export function parsePullRequestDetails(
  value: unknown,
  expected: ExpectedPullRequest,
  label: string,
  previous?: PullRequestRecord,
): PullRequestDetails {
  const data = record(value, label);
  const pull = parsePullRequestRecord(data, expected, label);
  if (previous !== undefined) {
    if (pull.number !== previous.number || pull.repositoryId !== previous.repositoryId) {
      throw new Error(`${label} pull request or repository identity changed; inspect the selected PR before resuming`);
    }
    if (pull.headSha !== previous.headSha) {
      throw new Error(`${label} head SHA changed; inspect the released commit before resuming`);
    }
  }
  if (typeof data.merged !== 'boolean' || (data.merged && pull.state !== 'closed')) {
    throw new Error(`${label} did not provide a consistent boolean merged state; merge is not confirmed`);
  }
  return { ...pull, merged: data.merged };
}

export function assertMergeConfirmed(response: GitHubRequestResult): void {
  const data = parsePullRequestJson(response, 'PUT merge');
  if (!isPlainObject(data) || data.merged !== true) {
    throw new Error('PUT merge did not confirm merged === true; merge is not confirmed and branch cleanup is refused');
  }
}

export function assertCleanupRef(response: GitHubRequestResult, expected: ExpectedPullRequest, headSha: string): void {
  assertDistinctBranches(expected.base, expected.head);
  const data = record(parsePullRequestJson(response, 'GET ref'), 'GET ref');
  if (data.ref !== `refs/heads/${expected.head}` || data.ref === `refs/heads/${expected.base}`) {
    throw new Error('GET ref identity mismatch; refusing to delete the base or a different release ref');
  }
  const object = record(data.object, 'GET ref.object');
  if (object.type !== 'commit') {
    throw new Error('GET ref must identify a commit before branch cleanup');
  }
  assertGitObjectId(object.sha, 'GET ref.object.sha');
  if (object.sha !== headSha || (expected.releasedHead !== undefined && object.sha !== expected.releasedHead)) {
    throw new Error(
      'GET ref head SHA changed; refusing to delete a branch that no longer points to the merged release head',
    );
  }
}
