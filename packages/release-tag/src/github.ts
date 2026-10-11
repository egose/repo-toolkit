import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

import { redactSensitiveValues } from '@repo-toolkit/publish-package';

import type { ReleaseTagPlan } from './plan';

export const GITHUB_API_VERSION = '2022-11-28';
export const USER_AGENT = 'repo-toolkit-release-tag';
export const MAX_ERROR_CHARS = 2048;
export const MAX_RESPONSE_BYTES_CAP = 1048576;

const WHITESPACE_PATTERN = /\s/;

export interface GitHubRequestResult {
  status: number;
  text: string;
}

export function truncateChars(text: string): string {
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

export function createGitHubHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export function resolveExplicitToken(value: unknown): string | undefined {
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

export async function resolveGitHubToken(
  plan: ReleaseTagPlan,
  explicit: string | undefined,
): Promise<string | undefined> {
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

export function resolveOwnerRepo(plan: ReleaseTagPlan): { owner: string; repo: string } {
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

export function resolveFetchFn(plan: ReleaseTagPlan, input: { fetchFn?: typeof fetch }): typeof fetch {
  const candidate = input.fetchFn ?? plan.fetchFn ?? globalThis.fetch;
  if (typeof candidate !== 'function') {
    throw new Error('fetchFn must be a function');
  }
  return candidate;
}

export async function sendGitHubRequest(
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
