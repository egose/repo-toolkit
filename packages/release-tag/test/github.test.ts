import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGitHubHeaders, MAX_RESPONSE_BYTES_CAP, sendGitHubRequest } from '../src/github';
import { buildGitHubApiUrl } from '../src/github-url';
import { createReleasePullRequest, resolveReleaseTagPlan, runPreflight } from '../src/index';
import {
  caughtError,
  DETERMINED,
  ENV_TOKEN,
  EXPLICIT_TOKEN,
  expectSecretFree,
  RELEASE,
  unsafeError,
} from './security-fixture';

beforeEach(() => {
  for (const name of [
    'GITHUB_TOKEN',
    'GITHUB_API_URL',
    'GITHUB_REPOSITORY',
    'GITHUB_REF_NAME',
    'GITHUB_REF_TYPE',
    'GITHUB_REF',
  ]) {
    vi.stubEnv(name, undefined);
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function request(fetchFn: typeof fetch, limit = 65537, timeoutMs = 500) {
  return sendGitHubRequest(
    fetchFn,
    'https://api.github.com/repos/octo/repo/pulls',
    'POST',
    createGitHubHeaders(EXPLICIT_TOKEN),
    '{}',
    timeoutMs,
    limit,
    'POST pulls',
    [EXPLICIT_TOKEN, ENV_TOKEN],
  );
}

describe('GitHub streamed response boundary', () => {
  it('decodes split multibyte chunks at the exact raw-byte cap without buffered body helpers', async () => {
    const text = '🌍é漢';
    const bytes = Buffer.from(text);
    let offset = 0;
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (offset === bytes.length) {
              controller.close();
            } else {
              controller.enqueue(bytes.subarray(offset, ++offset));
            }
          },
        },
        { highWaterMark: 0 },
      ),
    );
    const textSpy = vi.spyOn(response, 'text');
    const bufferSpy = vi.spyOn(response, 'arrayBuffer');
    const fetchFn = vi.fn<typeof fetch>(async () => response);
    expect(await request(fetchFn, bytes.length)).toEqual({ status: 200, text });
    expect(textSpy).not.toHaveBeenCalled();
    expect(bufferSpy).not.toHaveBeenCalled();
    expect(response.body?.locked).toBe(false);
    const init = fetchFn.mock.calls[0][1];
    expect(init?.redirect).toBe('error');
    expect(init?.signal?.aborted).toBe(false);
  });

  it.each([31, 65537, 4 * MAX_RESPONSE_BYTES_CAP])(
    'cancels a 64 MiB producer early with maxOutputBytes=%i',
    async (configured) => {
      const cap = Math.min(configured, MAX_RESPONSE_BYTES_CAP);
      const chunkSize = Math.min(65536, cap);
      let produced = 0;
      const total = 64 * 1024 * 1024;
      const cancel = vi.fn();
      const response = new Response(
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              if (produced >= total) {
                controller.close();
                return;
              }
              produced += chunkSize;
              controller.enqueue(new Uint8Array(chunkSize).fill(120));
            },
            cancel,
          },
          { highWaterMark: 0 },
        ),
      );
      const fetchFn = vi.fn<typeof fetch>(async () => response);
      const error = await caughtError(request(fetchFn, configured));
      expect(error.message).toContain(`exceeding the ${cap}-byte response limit`);
      expect(produced).toBeGreaterThan(cap);
      expect(produced).toBeLessThanOrEqual(cap + chunkSize);
      expect(produced).toBeLessThan(total);
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(response.body?.locked).toBe(false);
      expectSecretFree(error);
    },
  );

  it('does not retain or echo a single oversized token-bearing chunk', async () => {
    const cancel = vi.fn(() => Promise.reject(unsafeError(EXPLICIT_TOKEN)));
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            controller.enqueue(Buffer.from(EXPLICIT_TOKEN.repeat(10000)));
          },
          cancel,
        },
        { highWaterMark: 0 },
      ),
    );
    const error = await caughtError(request(async () => response, 16));
    expect(cancel).toHaveBeenCalledOnce();
    expectSecretFree(error);
    expect(error.message.length).toBeLessThan(300);
  });

  it.each(['resolves', 'stalls'] as const)(
    'keeps the deadline through a stalled body even when cancellation %s',
    async (cancellation) => {
      const cancel = vi.fn(() => (cancellation === 'stalls' ? new Promise<void>(() => undefined) : undefined));
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(Buffer.from('partial response'));
          },
          cancel,
        }),
      );
      const fetchFn = vi.fn<typeof fetch>(async () => response);
      const started = performance.now();
      const error = await caughtError(request(fetchFn, 128, 40));
      expect(performance.now() - started).toBeLessThan(1000);
      expect(error.name).toBe('TimeoutError');
      expect(error.message).toContain('timed out after 40ms');
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(response.body?.locked).toBe(false);
      expectSecretFree(error);
    },
  );

  it('uses one request deadline across fetch and body consumption', async () => {
    const cancel = vi.fn();
    const fetchFn = vi.fn<typeof fetch>(async () => {
      await delay(40);
      return new Response(new ReadableStream<Uint8Array>({ cancel }));
    });
    const started = performance.now();
    const error = await caughtError(request(fetchFn, 128, 70));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(error.message).toContain('timed out after 70ms');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('times out an uncooperative fetch and cancels its late response', async () => {
    let complete!: (response: Response) => void;
    const fetchFn = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    const error = await caughtError(request(fetchFn, 128, 25));
    expect(error.name).toBe('TimeoutError');
    expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const cancel = vi.fn();
    complete(new Response(new ReadableStream<Uint8Array>({ cancel })));
    await delay(0);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('checks elapsed time during a microtask-only empty-chunk producer', async () => {
    let produced = 0;
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            produced += 1;
            controller.enqueue(new Uint8Array());
          },
          cancel,
        },
        { highWaterMark: 0 },
      ),
    );
    const started = performance.now();
    const error = await caughtError(request(async () => response, 128, 25));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(produced).toBeGreaterThan(0);
    expect(error.name).toBe('TimeoutError');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(['fetch', 'body'] as const)('cleans %s errors, causes, stacks and thrown strings', async (source) => {
    for (const name of ['Error', 'AbortError', 'TimeoutError', 'string']) {
      const raw =
        name === 'string'
          ? `transport failure ${EXPLICIT_TOKEN}`
          : unsafeError(`transport failure ${EXPLICIT_TOKEN}`, name);
      const fetchFn = vi.fn<typeof fetch>(async () => {
        if (source === 'fetch') {
          throw raw;
        }
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.error(raw);
            },
          }),
        );
      });
      const error = await caughtError(request(fetchFn));
      expect(error.message).toContain('transport failure');
      expect(error.message).toContain('[redacted]');
      if (name === 'AbortError') {
        expect(error.name).toBe('AbortError');
        expect(error.message).toContain('was aborted');
        expect(error.message).not.toContain('timed out after');
      } else if (name === 'TimeoutError') {
        expect(error.name).toBe('TimeoutError');
        expect(error.message).toContain('timed out in the transport');
      }
      expectSecretFree(error);
      expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(true);
    }
  });

  it('cancels the reader after a token-bearing body failure and releases its lock', async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(unsafeError('stream failed'));
        },
      }),
    );
    const cancel = vi.spyOn(ReadableStreamDefaultReader.prototype, 'cancel');
    const error = await caughtError(request(async () => response));
    expect(cancel).toHaveBeenCalled();
    expect(response.body?.locked).toBe(false);
    expectSecretFree(error);
  });

  it('does not recursively inspect caller-owned transport error objects', async () => {
    const forbidden = vi.fn(() => {
      throw new Error(EXPLICIT_TOKEN);
    });
    const raw = unsafeError('socket failure');
    const nested: Record<string, unknown> = {};
    nested.self = nested;
    Object.defineProperty(nested, 'headers', { enumerable: true, get: forbidden });
    Object.assign(raw, { cause: nested, toJSON: forbidden });
    const error = await caughtError(
      request(async () => {
        throw raw;
      }),
    );
    expect(forbidden).not.toHaveBeenCalled();
    expect(error.message).toContain('socket failure');
    expectSecretFree(error);
  });

  it('clears the deadline after a completed response', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    expect(await request(fetchFn, 128, 30)).toEqual({ status: 204, text: '' });
    await delay(50);
    expect(fetchFn.mock.calls[0][1]?.signal?.aborted).toBe(false);
  });

  it.each([301, 302, 303, 307, 308])(
    'rejects authenticated HTTP %i without reading or following Location',
    async (status) => {
      const pull = vi.fn();
      const cancel = vi.fn();
      const response = new Response(new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }), {
        status,
        headers: { Location: `https://other.example/${EXPLICIT_TOKEN}` },
      });
      const fetchFn = vi.fn<typeof fetch>(async () => response);
      const error = await caughtError(request(fetchFn));
      expect(error.message).toContain('authenticated redirects are disabled');
      expect(fetchFn).toHaveBeenCalledOnce();
      expect(fetchFn.mock.calls[0][1]?.redirect).toBe('error');
      expect(pull).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledOnce();
      expectSecretFree(error);
    },
  );

  it('rejects a redirected response from a custom fetch that ignored redirect policy', async () => {
    const response = new Response('{}');
    Object.defineProperty(response, 'redirected', { value: true });
    Object.defineProperty(response, 'url', { value: `https://${EXPLICIT_TOKEN}@other.example/` });
    const error = await caughtError(request(async () => response));
    expect(error.message).toContain('redirects are disabled');
    expectSecretFree(error);
  });
});

const UNSAFE_BASES = [
  'http://api.github.com',
  'http://localhost.example/api/v3',
  'http://127.0.0.1.example',
  'http://0.0.0.0',
  'http://[::]',
  'ftp://127.0.0.1',
  '//api.github.com',
  `https://user:${EXPLICIT_TOKEN}@api.github.com`,
  'https://@api.github.com',
  `https://api.github.com?token=${EXPLICIT_TOKEN}`,
  'https://api.github.com?',
  `https://api.github.com/#${EXPLICIT_TOKEN}`,
  'https://api.github.com/#',
  'https://api.github.com/\napi',
  'https://api.github.com\\@other.example',
  'https://api.github.com/api/../v3',
  'https://api.github.com/api/%2e%2e/v3',
  'https://api.github.com/api/%252e%252e/v3',
  'https://api.github.com/api/%2f/v3',
  'https://api.github.com/api/%0a/v3',
  'https://api.github.com/api/%zz/v3',
];

describe('GitHub API routing boundary', () => {
  it.each([null, 42, {}, []])(
    'rejects non-string API base values rather than using an environment fallback: %j',
    (value) => {
      vi.stubEnv('GITHUB_API_URL', 'https://ghe.example/api/v3');
      expect(() => resolveReleaseTagPlan({ githubApiUrl: value as unknown as string })).toThrow(/githubApiUrl/);
    },
  );

  it.each([
    'http://other.example/repos/octo/repo',
    `https://${EXPLICIT_TOKEN}@api.github.com/repos/octo/repo`,
    'https://api.github.com/repos/octo/repo#fragment',
  ])('rejects unsafe request URLs at the transport boundary: %s', async (url) => {
    const fetchFn = vi.fn<typeof fetch>();
    const error = await caughtError(
      sendGitHubRequest(fetchFn, url, 'GET', createGitHubHeaders(EXPLICIT_TOKEN), undefined, 500, 1024, 'GET repo', [
        EXPLICIT_TOKEN,
      ]),
    );
    expectSecretFree(error);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each(UNSAFE_BASES)('rejects unsafe explicit and environment API base %s', (base) => {
    vi.stubEnv('GITHUB_TOKEN', EXPLICIT_TOKEN);
    for (const source of ['explicit', 'environment']) {
      vi.stubEnv('GITHUB_API_URL', source === 'environment' ? base : undefined);
      try {
        resolveReleaseTagPlan(source === 'explicit' ? { githubApiUrl: base } : {});
        expect.unreachable();
      } catch (error) {
        expect((error as Error).message).toContain('githubApiUrl');
        expectSecretFree(error);
      }
    }
  });

  it.each(UNSAFE_BASES)('revalidates edited direct-stage API base %s before forwarding credentials', async (base) => {
    const plan = resolveReleaseTagPlan({ githubRepository: 'octo/repo', only: ['pr'] });
    plan.githubApiUrl = base;
    const fetchFn = vi.fn<typeof fetch>();
    const preflight = await caughtError(runPreflight({ plan, fetchFn, githubToken: EXPLICIT_TOKEN }));
    const pr = await caughtError(
      createReleasePullRequest({
        plan,
        determined: DETERMINED,
        release: RELEASE,
        fetchFn,
        githubToken: EXPLICIT_TOKEN,
      }),
    );
    expectSecretFree(preflight);
    expectSecretFree(pr);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each(['http://127.0.0.1:8123', 'http://127.22.3.4:8123', 'http://[::1]:8123', 'http://localhost:8123'])(
    'accepts explicit loopback HTTP base %s',
    (base) => {
      const plan = resolveReleaseTagPlan({ githubApiUrl: `${base}/api/v3/` });
      expect(buildGitHubApiUrl(plan.githubApiUrl, ['repos', 'octo', 'repo'])).toBe(`${base}/api/v3/repos/octo/repo`);
    },
  );

  it('preserves a GHES path and encodes each endpoint segment without resetting the base', () => {
    vi.stubEnv('GITHUB_API_URL', 'https://ghe.example/prefix/api/v3///');
    const plan = resolveReleaseTagPlan();
    expect(plan.githubApiUrl).toBe('https://ghe.example/prefix/api/v3///');
    expect(buildGitHubApiUrl(plan.githubApiUrl, ['repos', 'owner', 'repo', 'git', 'refs', 'heads', '日本語#tag'])).toBe(
      'https://ghe.example/prefix/api/v3/repos/owner/repo/git/refs/heads/%E6%97%A5%E6%9C%AC%E8%AA%9E%23tag',
    );
    expect(buildGitHubApiUrl(plan.githubApiUrl, ['installation', 'repositories'], { per_page: '1' })).toBe(
      'https://ghe.example/prefix/api/v3/installation/repositories?per_page=1',
    );
    expect(resolveReleaseTagPlan({ githubApiUrl: 'https://explicit.example' }).githubApiUrl).toBe(
      'https://explicit.example',
    );
  });
});
