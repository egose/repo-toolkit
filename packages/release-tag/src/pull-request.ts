import { isPlainObject, redactSensitiveValues } from '@repo-toolkit/publish-package';

import type { DeterminedTag } from './determine';
import {
  MAX_RESPONSE_BYTES_CAP,
  createGitHubHeaders,
  resolveExplicitToken,
  resolveFetchFn,
  resolveGitHubToken,
  resolveOwnerRepo,
  sendGitHubRequest,
  truncateChars,
} from './github';
import type { ReleaseTagPlan } from './plan';
import type { ReleaseBranchResult } from './release';
import { stripTagSignature } from './tag-message';

export interface PullRequestResult {
  skipped: boolean;
  skippedReason: string | null;
  number: number | null;
  url: string | null;
  merged: boolean;
  branchDeleted: boolean;
}

export interface CreateReleasePullRequestInput {
  plan: ReleaseTagPlan;
  determined: DeterminedTag;
  release: ReleaseBranchResult;
  githubToken?: string;
  fetchFn?: typeof fetch;
}

export function formatPullRequestBody(tagMessage: string): string {
  if (typeof tagMessage !== 'string') {
    throw new Error('tagMessage must be a string');
  }
  return `### Release Candidate Details\n\n${stripTagSignature(tagMessage)}\n\n---\n\n> This PR was automatically generated.`;
}

function skippedResult(reason: string): PullRequestResult {
  return { skipped: true, skippedReason: reason, number: null, url: null, merged: false, branchDeleted: false };
}

function assertDetermined(value: unknown): asserts value is DeterminedTag {
  if (!isPlainObject(value)) {
    throw new Error('determined must be an object');
  }
  const candidate = value as Partial<DeterminedTag>;
  if (typeof candidate.tagVersion !== 'string' || candidate.tagVersion.length === 0) {
    throw new Error('determined.tagVersion must be a non-empty string');
  }
}

function assertRelease(value: unknown): asserts value is ReleaseBranchResult {
  if (!isPlainObject(value)) {
    throw new Error('release must be an object');
  }
  const candidate = value as Partial<ReleaseBranchResult>;
  if (typeof candidate.baseBranch !== 'string' || candidate.baseBranch.length === 0) {
    throw new Error('release.baseBranch must be a non-empty string');
  }
  if (typeof candidate.releaseBranch !== 'string' || candidate.releaseBranch.length === 0) {
    throw new Error('release.releaseBranch must be a non-empty string');
  }
  if (typeof candidate.prTitle !== 'string' || candidate.prTitle.length === 0) {
    throw new Error('release.prTitle must be a non-empty string');
  }
  if (typeof candidate.tagMessage !== 'string') {
    throw new Error('release.tagMessage must be a string');
  }
}

function encodeBranchRef(branch: string): string {
  return branch
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function requireOkStatus(status: number, text: string, label: string, token: string): void {
  if (status >= 200 && status < 300) {
    return;
  }
  throw new Error(
    redactSensitiveValues(`GitHub API request to ${label} failed (status=${status}): ${truncateChars(text)}`, [token]),
  );
}

function parsePullNumber(text: string, status: number, token: string): { number: number; url: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      redactSensitiveValues(
        `GitHub API response from POST pulls was not valid JSON (status=${status}): ${truncateChars(text)}`,
        [token],
      ),
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      redactSensitiveValues(
        `GitHub API response from POST pulls had an unexpected shape (status=${status}): ${truncateChars(text)}`,
        [token],
      ),
    );
  }
  const record = parsed as Record<string, unknown>;
  const number = record['number'];
  const url = record['html_url'];
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) {
    throw new Error(
      redactSensitiveValues(
        `GitHub API response from POST pulls is missing a numeric pull request number (status=${status}): ${truncateChars(text)}`,
        [token],
      ),
    );
  }
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error(
      redactSensitiveValues(
        `GitHub API response from POST pulls is missing html_url (status=${status}): ${truncateChars(text)}`,
        [token],
      ),
    );
  }
  return { number, url };
}

export async function createReleasePullRequest(input: CreateReleasePullRequestInput): Promise<PullRequestResult> {
  if (!isPlainObject(input)) {
    throw new Error('input must be an object');
  }
  if (!isPlainObject(input.plan)) {
    throw new Error('plan must be an object');
  }
  assertDetermined(input.determined);
  assertRelease(input.release);
  const plan = input.plan;
  const determined = input.determined;
  const release = input.release;

  if (plan.skipPr) {
    return skippedResult('skipped via skipPr');
  }
  if (!plan.only.includes('pr')) {
    return skippedResult('stage not selected');
  }
  if (plan.dryRun) {
    return skippedResult('dry-run');
  }

  const explicitToken = resolveExplicitToken(input.githubToken);
  const token = await resolveGitHubToken(plan, explicitToken);
  if (token === undefined) {
    return skippedResult('github token not available');
  }

  const fetchFn = resolveFetchFn(plan, input);
  const ownerRepo = resolveOwnerRepo(plan);
  const owner = encodeURIComponent(ownerRepo.owner);
  const repo = encodeURIComponent(ownerRepo.repo);
  const apiBase = plan.githubApiUrl.replace(/\/+$/, '');
  const responseLimit = Math.min(plan.maxOutputBytes, MAX_RESPONSE_BYTES_CAP);
  const headers = createGitHubHeaders(token);

  const body = formatPullRequestBody(release.tagMessage);
  const labels = ['changelog', 'release-candidate', determined.tagVersion];

  const createResult = await sendGitHubRequest(
    fetchFn,
    `${apiBase}/repos/${owner}/${repo}/pulls`,
    'POST',
    headers,
    JSON.stringify({ head: release.releaseBranch, base: release.baseBranch, title: release.prTitle, body }),
    plan.timeoutMs,
    responseLimit,
    'POST pulls',
    token,
  );
  if (createResult.status !== 201 && createResult.status !== 200) {
    throw new Error(
      redactSensitiveValues(
        `GitHub API request to POST pulls failed (status=${createResult.status}): ${truncateChars(createResult.text)}`,
        [token],
      ),
    );
  }
  const created = parsePullNumber(createResult.text, createResult.status, token);

  const labelsResult = await sendGitHubRequest(
    fetchFn,
    `${apiBase}/repos/${owner}/${repo}/issues/${String(created.number)}/labels`,
    'POST',
    headers,
    JSON.stringify({ labels }),
    plan.timeoutMs,
    responseLimit,
    'POST labels',
    token,
  );
  requireOkStatus(labelsResult.status, labelsResult.text, 'POST labels', token);

  let merged = false;
  let branchDeleted = false;
  if (plan.autoMergePr) {
    const mergeResult = await sendGitHubRequest(
      fetchFn,
      `${apiBase}/repos/${owner}/${repo}/pulls/${String(created.number)}/merge`,
      'PUT',
      headers,
      JSON.stringify({ merge_method: 'merge' }),
      plan.timeoutMs,
      responseLimit,
      'PUT merge',
      token,
    );
    requireOkStatus(mergeResult.status, mergeResult.text, 'PUT merge', token);
    merged = true;
    if (plan.deleteMergedBranch) {
      const deleteResult = await sendGitHubRequest(
        fetchFn,
        `${apiBase}/repos/${owner}/${repo}/git/refs/heads/${encodeBranchRef(release.releaseBranch)}`,
        'DELETE',
        headers,
        undefined,
        plan.timeoutMs,
        responseLimit,
        'DELETE ref',
        token,
      );
      requireOkStatus(deleteResult.status, deleteResult.text, 'DELETE ref', token);
      branchDeleted = true;
    }
  }

  return { skipped: false, skippedReason: null, number: created.number, url: created.url, merged, branchDeleted };
}
