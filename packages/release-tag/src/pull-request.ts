import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

import { isPlainObject, redactSensitiveValues } from '@repo-toolkit/publish-package';

import type { DeterminedTag } from './determine';
import type { ReleaseTagPlan } from './plan';
import type { ReleaseBranchResult } from './release';

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

const GITHUB_API_VERSION = '2022-11-28';
const USER_AGENT = 'repo-toolkit-release-tag';
const MAX_ERROR_CHARS = 2048;
const MAX_RESPONSE_BYTES_CAP = 1048576;
const WHITESPACE_PATTERN = /\s/;

export function formatPullRequestBody(tagMessage: string): string {
  if (typeof tagMessage !== 'string') {
    throw new Error('tagMessage must be a string');
  }
  return `### Release Candidate Details\n\n${tagMessage}\n\n---\n\n> This PR was automatically generated.`;
}

function skippedResult(reason: string): PullRequestResult {
  return { skipped: true, skippedReason: reason, number: null, url: null, merged: false, branchDeleted: false };
}

function truncateChars(text: string): string {
  if (text.length <= MAX_ERROR_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_ERROR_CHARS)}...[truncated]`;
}

function makeTimeoutSignal(timeoutMs: number): AbortSignal {
  const candidate = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
  if (typeof candidate.timeout === 'function') {
    return candidate.timeout(timeoutMs);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
  const maybeUnref = timer as unknown as { unref?: () => void };
  if (typeof maybeUnref.unref === 'function') {
    maybeUnref.unref();
  }
  return controller.signal;
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

function resolveExplicitToken(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error('githubToken must be a string');
  }
  if (value.includes('\0')) {
    throw new Error('githubToken must not contain NUL bytes');
  }
  return value.length === 0 ? undefined : value;
}

async function resolveToken(plan: ReleaseTagPlan, explicit: string | undefined): Promise<string | undefined> {
  if (explicit !== undefined) {
    return explicit;
  }
  if (plan.githubTokenFile !== undefined) {
    const path = resolvePath(plan.cwd, plan.githubTokenFile);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      const wrapped = new Error(`Failed to read githubTokenFile at ${path}`) as Error & { cause?: unknown };
      wrapped.cause = error;
      throw wrapped;
    }
    const token = raw.trim();
    if (token.length === 0) {
      throw new Error(`githubTokenFile at ${path} is empty`);
    }
    return token;
  }
  const envValue = process.env[plan.githubTokenEnv];
  if (typeof envValue === 'string' && envValue.length > 0) {
    return envValue;
  }
  return undefined;
}

function resolveOwnerRepo(plan: ReleaseTagPlan): { owner: string; repo: string } {
  let raw: string;
  let label: string;
  if (plan.githubRepository !== undefined) {
    raw = plan.githubRepository;
    label = 'githubRepository';
  } else {
    const envValue = process.env.GITHUB_REPOSITORY;
    if (envValue === undefined || envValue.trim().length === 0) {
      throw new Error('githubRepository is required (explicit --github-repository or GITHUB_REPOSITORY).');
    }
    raw = envValue.trim();
    label = 'GITHUB_REPOSITORY';
  }
  if (WHITESPACE_PATTERN.test(raw)) {
    throw new Error(`${label} must use owner/repo form with no empty segments or whitespace`);
  }
  const parts = raw.split('/');
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    throw new Error(`${label} must use owner/repo form with no empty segments or whitespace`);
  }
  return { owner: parts[0], repo: parts[1] };
}

function resolveFetchFn(plan: ReleaseTagPlan, input: CreateReleasePullRequestInput): typeof fetch {
  const candidate = input.fetchFn ?? plan.fetchFn ?? globalThis.fetch;
  if (typeof candidate !== 'function') {
    throw new Error('fetchFn must be a function');
  }
  return candidate;
}

function encodeBranchRef(branch: string): string {
  return branch
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

interface GitHubRequestResult {
  status: number;
  text: string;
}

async function sendGitHubRequest(
  fetchFn: typeof fetch,
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
  responseLimit: number,
  label: string,
  token: string,
): Promise<GitHubRequestResult> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method,
      headers,
      body,
      signal: makeTimeoutSignal(timeoutMs),
    } as unknown as Parameters<typeof fetch>[1]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof Error && error.name === 'AbortError') {
      const wrapped = new Error(
        redactSensitiveValues(`GitHub API request to ${label} timed out after ${timeoutMs}ms: ${message}`, [token]),
      ) as Error & { cause?: unknown };
      wrapped.cause = error;
      throw wrapped;
    }
    const wrapped = new Error(
      redactSensitiveValues(`GitHub API request to ${label} failed: ${message}`, [token]),
    ) as Error & { cause?: unknown };
    wrapped.cause = error;
    throw wrapped;
  }
  const text = await response.text();
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > responseLimit) {
    throw new Error(
      redactSensitiveValues(
        `GitHub API response from ${label} produced ${bytes} bytes, exceeding the ${responseLimit}-byte response limit`,
        [token],
      ),
    );
  }
  return { status: response.status, text };
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
  const token = await resolveToken(plan, explicitToken);
  if (token === undefined) {
    return skippedResult('github token not available');
  }

  const fetchFn = resolveFetchFn(plan, input);
  const ownerRepo = resolveOwnerRepo(plan);
  const owner = encodeURIComponent(ownerRepo.owner);
  const repo = encodeURIComponent(ownerRepo.repo);
  const apiBase = plan.githubApiUrl.replace(/\/+$/, '');
  const responseLimit = Math.min(plan.maxOutputBytes, MAX_RESPONSE_BYTES_CAP);
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

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
