import { performance } from 'node:perf_hooks';

import { resolveExplicitToken } from './credentials';
import { diagnosticText, safeError } from './diagnostics';
import { assertGitHubRequestUrl } from './github-url';
import type { ReleaseTagPlan } from './plan';
import { assertProcessLimits } from './process';
import { resolveOptionalOwnerRepo } from './validation';

export const GITHUB_API_VERSION = '2022-11-28';
export const USER_AGENT = 'repo-toolkit-release-tag';
export const MAX_ERROR_CHARS = 2048;
export const MAX_RESPONSE_BYTES_CAP = 1048576;

export interface GitHubRequestResult {
  status: number;
  text: string;
}

export function createGitHubHeaders(token: string): Record<string, string> {
  resolveExplicitToken(token);
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

export function resolveOwnerRepo(plan: ReleaseTagPlan): { owner: string; repo: string } {
  const repository = resolveOptionalOwnerRepo(plan, process.env);
  if (repository === undefined) {
    throw new Error('githubRepository is required (explicit --github-repository or GITHUB_REPOSITORY).');
  }
  return repository;
}

export function resolveFetchFn(plan: ReleaseTagPlan, input: { fetchFn?: typeof fetch }): typeof fetch {
  const candidate = input.fetchFn ?? plan.fetchFn ?? globalThis.fetch;
  if (typeof candidate !== 'function') {
    throw new Error('fetchFn must be a function');
  }
  return candidate;
}

function cancelBody(body: ReadableStream<Uint8Array> | null | undefined): void {
  try {
    void body?.cancel().catch(() => undefined);
  } catch {
    return;
  }
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
  secrets: ReadonlyArray<string | undefined>,
): Promise<GitHubRequestResult> {
  assertGitHubRequestUrl(url);
  assertProcessLimits({ timeoutMs, maxOutputBytes: responseLimit });
  const limit = Math.min(responseLimit, MAX_RESPONSE_BYTES_CAP);
  const controller = new AbortController();
  const started = performance.now();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let finished = false;
  let timedOut = false;
  let phase = 'request';
  const timeoutError = new Error(`GitHub API request to ${label} timed out after ${timeoutMs}ms`);
  timeoutError.name = 'TimeoutError';

  const cancel = (): void => {
    controller.abort();
    try {
      void reader?.cancel().catch(() => undefined);
    } catch {
      return;
    }
  };
  const checkDeadline = (): void => {
    if (timedOut || performance.now() - started >= timeoutMs) {
      timedOut = true;
      throw timeoutError;
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      cancel();
      reject(timeoutError);
    }, timeoutMs);
  });

  const consume = async (): Promise<GitHubRequestResult> => {
    const response = await fetchFn(url, { method, headers, body, signal: controller.signal, redirect: 'error' });
    if (finished || timedOut || performance.now() - started >= timeoutMs) {
      cancelBody(response.body);
      throw timeoutError;
    }
    if (
      response.redirected ||
      response.type === 'opaqueredirect' ||
      (response.status >= 300 && response.status < 400)
    ) {
      cancelBody(response.body);
      throw new Error('authenticated redirects are disabled');
    }
    if (!Number.isInteger(response.status) || response.status < 200 || response.status > 599) {
      cancelBody(response.body);
      throw new Error('fetchFn returned an invalid HTTP response status');
    }
    phase = 'response body';
    if (response.body === null) {
      return { status: response.status, text: '' };
    }
    reader = response.body.getReader();
    let retained: Buffer | undefined;
    let size = 0;
    while (true) {
      checkDeadline();
      const chunk = await reader.read();
      checkDeadline();
      if (chunk.done) {
        break;
      }
      if (!(chunk.value instanceof Uint8Array)) {
        throw new Error('fetchFn returned a response body with non-byte chunks');
      }
      if (chunk.value.byteLength > limit - size) {
        throw new Error(
          `GitHub API response from ${label} produced more than ${limit} bytes, exceeding the ${limit}-byte response limit`,
        );
      }
      if (chunk.value.byteLength > 0) {
        retained ??= Buffer.allocUnsafe(limit);
        retained.set(chunk.value, size);
        size += chunk.value.byteLength;
      }
    }
    const text = retained?.toString('utf8', 0, size) ?? '';
    checkDeadline();
    return { status: response.status, text };
  };

  try {
    return await Promise.race([consume(), deadline]);
  } catch (error) {
    cancel();
    if (timedOut || performance.now() - started >= timeoutMs) {
      throw safeError(timeoutError, secrets);
    }
    const sanitized = safeError(error, secrets);
    const name = sanitized.name;
    const problem =
      name === 'AbortError' ? 'was aborted' : name === 'TimeoutError' ? 'timed out in the transport' : 'failed';
    const detail = diagnosticText(sanitized.message, secrets, MAX_ERROR_CHARS);
    const wrapped = new Error(`GitHub API ${phase} to ${label} ${problem}: ${detail}`);
    wrapped.name = name;
    throw safeError(wrapped, secrets);
  } finally {
    finished = true;
    clearTimeout(timer);
    try {
      reader?.releaseLock();
    } catch {
      cancel();
    }
  }
}
