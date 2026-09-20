import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  CONNECT_DEFAULT_CONCURRENCY,
  CONNECT_MAX_CONCURRENCY,
  ConnectSecretStore,
  buildTitleFilter,
  createConnectStore,
  delayForAttempt,
  escapeConnectFilterValue,
  isLoopbackHostname,
  mapWithConcurrency,
  parseRetryAfterMs,
  readBoundedText,
  resolveConnectBaseUrl,
} from '../src/connect';
import { SecretSyncError } from '../src/errors';
import type { ConnectItemDetail, CreateConnectItemInput } from '../src/store';
import type { FetchResponseLike } from '../src/connect';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const VAULT_ID = 'vault-test-1';
const MARKER = 'repo-toolkit-secret-sync';
const HOST_ENV = 'OP_CONNECT_HOST';
const TOKEN_ENV = 'OP_CONNECT_TOKEN';

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function makeBlobEnvelope(logicalId: string, raw: Uint8Array) {
  return {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    kind: 'blob',
    logicalId,
    byteLength: raw.byteLength,
    sha256: sha256Hex(raw),
    contentBase64: Buffer.from(raw).toString('base64'),
  };
}

function makeConnectItem(providerId: string, envelope: Record<string, unknown>): ConnectItemDetail {
  const kind = String((envelope as Record<string, unknown>).kind ?? 'blob');
  const logicalId = String((envelope as Record<string, unknown>).logicalId ?? providerId);
  return {
    id: providerId,
    title: `${MARKER} ${PROJECT_ID} ${kind} ${logicalId}`,
    tags: [MARKER, PROJECT_ID, kind],
    category: 'SECURE_NOTE',
    fields: [
      { type: 'STRING', label: 'notesPlain', value: '' },
      { type: 'CONCEALED', label: 'payload', value: JSON.stringify(envelope) },
    ],
  };
}

function headersFor(map: Record<string, string> = {}) {
  const lower: Record<string, string> = {};
  for (const key of Object.keys(map)) {
    lower[key.toLowerCase()] = map[key] as string;
  }
  return {
    get(name: string): string | null {
      const hit = lower[name.toLowerCase()];
      return hit === undefined ? null : hit;
    },
  };
}

function textResponse(
  status: number,
  body: string,
  headers: Record<string, string> = {},
  extra: Record<string, unknown> = {},
): FetchResponseLike {
  return {
    status,
    headers: headersFor(headers),
    text: async () => body,
    body: undefined,
    ...extra,
  };
}

function streamResponse(
  status: number,
  chunks: Array<string | Uint8Array>,
  headers: Record<string, string> = {},
): FetchResponseLike {
  const queue = [...chunks];
  return {
    status,
    headers: headersFor(headers),
    text: async () => {
      throw new Error('streamed body has no text fallback');
    },
    body: {
      getReader() {
        return {
          async read() {
            const next = queue.shift();
            if (next === undefined) {
              return { done: true, value: undefined };
            }
            return { done: false, value: next };
          },
        };
      },
    },
  };
}

function makeEnv(host: string, token: string): Record<string, string | undefined> {
  return { [HOST_ENV]: host, [TOKEN_ENV]: token };
}

function authOf(init: { headers?: Record<string, string> } | undefined): string | undefined {
  if (init === undefined || init.headers === undefined) {
    return undefined;
  }
  return init.headers['Authorization'];
}

describe('url policy', () => {
  it('allows https and http loopback only', () => {
    expect(resolveConnectBaseUrl('https://connect.example.com').protocol).toBe('https:');
    expect(resolveConnectBaseUrl('http://localhost:8080').hostname).toBe('localhost');
    expect(resolveConnectBaseUrl('http://127.0.0.1:8080').hostname).toBe('127.0.0.1');
    expect(isLoopbackHostname(resolveConnectBaseUrl('http://[::1]:8080').hostname)).toBe(true);
    expect(() => resolveConnectBaseUrl('http://connect.example.com')).toThrow(/loopback/);
    expect(() => resolveConnectBaseUrl('https://user:pass@connect.example.com')).toThrow(/credentials/);
    expect(() => resolveConnectBaseUrl('https://connect.example.com/#frag')).toThrow(/fragment/);
    expect(() => resolveConnectBaseUrl('ftp://connect.example.com')).toThrow(/https or http loopback/);
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('127.0.0.5')).toBe(true);
    expect(isLoopbackHostname('example.com')).toBe(false);
  });

  it('rejects missing credentials at execution time without leaking values', () => {
    const canary = `tok-canary-${Date.now()}`;
    const env: Record<string, string | undefined> = makeEnv('https://connect.example.invalid', canary);
    const store = new ConnectSecretStore({ vaultId: VAULT_ID, env, fetchImpl: async () => textResponse(200, '[]') });
    delete env[TOKEN_ENV];
    return expect(store.listItems()).rejects.toMatchObject({ code: 'auth' });
  });

  it('resolves credentials at execution time', async () => {
    const env = makeEnv('https://connect.example.invalid', 'token-one');
    const seen: string[] = [];
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env,
      fetchImpl: async (_url, init) => {
        seen.push(String(authOf(init)));
        return textResponse(200, '[]');
      },
    });
    await store.listItems();
    env[TOKEN_ENV] = 'token-two';
    await store.listItems();
    expect(seen).toEqual(['Bearer token-one', 'Bearer token-two']);
    expect(JSON.stringify(seen)).not.toContain('token-one-extra');
  });
});

describe('status mapping', () => {
  it('maps 401 and 403 to auth without retry', async () => {
    for (const status of [401, 403]) {
      let calls = 0;
      const sleeps: number[] = [];
      const store = new ConnectSecretStore({
        vaultId: VAULT_ID,
        env: makeEnv('https://connect.example.invalid', 't'),
        fetchImpl: async () => {
          calls += 1;
          return textResponse(status, '{}');
        },
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      });
      const error = await store.listItems().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SecretSyncError);
      expect((error as SecretSyncError).code).toBe('auth');
      expect(calls).toBe(1);
      expect(sleeps).toEqual([]);
    }
  });

  it('maps 404 to not-found', async () => {
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async () => textResponse(404, '{}'),
    });
    await expect(store.getItem('missing-id')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('retries 429 with Retry-After then succeeds', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const item = makeConnectItem('p1', makeBlobEnvelope('logical-1', Buffer.from('hello')));
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return textResponse(429, '{}', { 'retry-after': '1' });
        }
        return textResponse(200, JSON.stringify([item]));
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const listed = await store.listItems();
    expect(listed).toEqual([{ id: 'p1', title: item.title, tags: item.tags, category: 'SECURE_NOTE' }]);
    expect(calls).toBe(2);
    expect(sleeps).toEqual([1000]);
  });

  it('retries 5xx with backoff and exhausts to server', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async () => {
        calls += 1;
        return textResponse(503, '{}');
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await expect(store.listItems()).rejects.toMatchObject({ code: 'server' });
    expect(calls).toBe(4);
    expect(sleeps).toEqual([100, 200, 400]);
  });

  it('does not retry validation failures', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async () => {
        calls += 1;
        return textResponse(400, '{}');
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    await expect(store.listItems()).rejects.toMatchObject({ code: 'validation' });
    expect(calls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('parses Retry-After seconds and dates with bounds', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs('  ')).toBeUndefined();
    expect(parseRetryAfterMs('2')).toBe(2000);
    expect(parseRetryAfterMs('9999')).toBe(5000);
    expect(parseRetryAfterMs('not-a-date')).toBeUndefined();
    const future = new Date(Date.now() + 1500).toUTCString();
    const parsed = parseRetryAfterMs(future);
    expect(parsed !== undefined && parsed > 0 && parsed <= 5000).toBe(true);
    expect(delayForAttempt(0, undefined)).toBe(100);
    expect(delayForAttempt(1, undefined)).toBe(200);
    expect(delayForAttempt(0, 1000)).toBe(1000);
    expect(delayForAttempt(0, 99999)).toBe(5000);
  });
});

describe('bounds and schemas', () => {
  it('rejects oversized list bodies', async () => {
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async () => textResponse(200, JSON.stringify([{ id: 'x'.repeat(50), title: 't', tags: [] }])),
      maxListBytes: 16,
    });
    await expect(store.listItems()).rejects.toMatchObject({ code: 'too-large' });
  });

  it('rejects oversized streamed detail bodies', async () => {
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async () => streamResponse(200, ['{"a":"', 'x'.repeat(200), '"}']),
      maxDetailBytes: 64,
    });
    await expect(store.getItem('any-id')).rejects.toMatchObject({ code: 'too-large' });
  });

  it('reads streamed bodies within bounds', async () => {
    const response = streamResponse(200, [Buffer.from('{"hel'), Buffer.from('lo":"world"}')]);
    const text = await readBoundedText(response, 1024, 'GET', '/p');
    expect(text).toBe('{"hello":"world"}');
  });

  it('maps truncated json to truncated and malformed json to schema', async () => {
    const truncatedStore = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async () => textResponse(200, '{"id":"abc"', { 'content-length': '200' }),
    });
    await expect(truncatedStore.getItem('abc')).rejects.toMatchObject({ code: 'truncated' });
    const malformedStore = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async () => textResponse(200, 'not-json{{{'),
    });
    await expect(malformedStore.getItem('abc')).rejects.toMatchObject({ code: 'schema' });
  });

  it('rejects structurally invalid list entries', async () => {
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async () => textResponse(200, JSON.stringify([{ title: 'no-id', tags: [] }])),
    });
    await expect(store.listItems()).rejects.toMatchObject({ code: 'schema' });
  });

  it('rejects non-array list responses', async () => {
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async () => textResponse(200, JSON.stringify({ id: 'x' })),
    });
    await expect(store.listItems()).rejects.toMatchObject({ code: 'schema' });
  });
});

describe('timeout', () => {
  it('times out slow GET responses with retries', async () => {
    let calls = 0;
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async (_url, init) => {
        calls += 1;
        return new Promise<FetchResponseLike>((_resolve, reject) => {
          const signal = init?.signal;
          const timer = setTimeout(() => textResponse(200, '[]'), 80);
          void timer;
          if (signal !== undefined) {
            if (signal.aborted) {
              reject(new DOMException('Aborted', 'AbortError'));
              return;
            }
            signal.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }
        });
      },
      timeoutMs: 10,
      sleep: async () => {},
    });
    await expect(store.listItems()).rejects.toMatchObject({ code: 'timeout' });
    expect(calls).toBe(4);
  });

  it('returns uncertain for slow POST responses', async () => {
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async (_url, init) => {
        return new Promise<FetchResponseLike>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal !== undefined) {
            signal.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }
        });
      },
      timeoutMs: 10,
    });
    const input: CreateConnectItemInput = {
      title: 'title',
      category: 'SECURE_NOTE',
      tags: [],
      fields: [{ type: 'CONCEALED', value: 'v' }],
    };
    await expect(store.createItem(input)).resolves.toEqual({ status: 'uncertain', attempts: 1 });
  });
});

describe('redirects', () => {
  it('blocks 3xx without sending auth to the redirected origin', async () => {
    const requested: string[] = [];
    const authed: Array<string | undefined> = [];
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async (url, init) => {
        requested.push(url);
        authed.push(authOf(init));
        return textResponse(302, '{}', { location: 'https://evil.example.invalid/v1/vaults/x/items' });
      },
    });
    await expect(store.listItems()).rejects.toMatchObject({ code: 'redirect-blocked' });
    expect(requested).toHaveLength(1);
    expect(authed).toEqual(['Bearer t']);
    expect(requested[0] as string).not.toContain('evil.example.invalid');
  });

  it('blocks flagged redirected responses', async () => {
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async () =>
        textResponse(200, '[]', {}, { redirected: true, url: 'https://connect.example.invalid/x' }),
    });
    await expect(store.listItems()).rejects.toMatchObject({ code: 'redirect-blocked' });
  });
});

describe('filters', () => {
  it('escapes quotes and backslashes in title filters', async () => {
    const seenUrls: string[] = [];
    const tricky = `we"ird\\title ${randomUUID()}`;
    const expected = buildTitleFilter(tricky);
    expect(escapeConnectFilterValue('a"b\\c')).toBe('a\\"b\\\\c');
    expect(expected).toBe(`title eq "${escapeConnectFilterValue(tricky)}"`);
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async (url) => {
        seenUrls.push(url);
        const parsed = new URL(url);
        expect(parsed.searchParams.get('filter')).toBe(expected);
        return textResponse(200, '[]');
      },
    });
    await store.listItems({ titleFilter: tricky });
    expect(seenUrls).toHaveLength(1);
    const rawUrl = seenUrls[0] as string;
    expect(rawUrl).toContain('filter=');
    expect(rawUrl).not.toContain(`title eq "${tricky}"`);
  });

  it('validates every listed record after server filtering', async () => {
    const good = makeConnectItem('good-1', makeBlobEnvelope('logical-good', Buffer.from('ok')));
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async () => textResponse(200, JSON.stringify([good, { id: '', title: 'bad', tags: [] }])),
    });
    await expect(store.listItems({ titleFilter: good.title })).rejects.toMatchObject({ code: 'schema' });
  });
});

describe('uncertain writes', () => {
  function makeRegistry() {
    const items = new Map<string, ConnectItemDetail>();
    return items;
  }

  it('never retries POST and returns uncertain on 500 after acceptance', async () => {
    const items = makeRegistry();
    let posts = 0;
    const envelope = makeBlobEnvelope('logical-commit-1', Buffer.from('payload-bytes'));
    const stored = makeConnectItem('provider-1', envelope);
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async (url, init) => {
        const parsed = new URL(url);
        if (init?.method === 'POST' && parsed.pathname.endsWith('/items')) {
          posts += 1;
          items.set(stored.id, stored);
          return textResponse(500, '{}');
        }
        if (parsed.pathname.endsWith('/items')) {
          return textResponse(200, JSON.stringify([...items.values()]));
        }
        const id = parsed.pathname.split('/').pop() as string;
        const hit = items.get(id);
        if (hit === undefined) {
          return textResponse(404, '{}');
        }
        return textResponse(200, JSON.stringify(hit));
      },
    });
    const input: CreateConnectItemInput = {
      title: stored.title,
      category: 'SECURE_NOTE',
      tags: stored.tags,
      fields: stored.fields,
    };
    await expect(store.createItem(input)).resolves.toEqual({ status: 'uncertain', attempts: 1 });
    expect(posts).toBe(1);
    const listed = await store.listItems();
    expect(listed.map((entry) => entry.id)).toEqual(['provider-1']);
    const fetched = await store.getItem('provider-1');
    expect(fetched.fields[1]?.value).toBe(JSON.stringify(envelope));
  });

  it('returns uncertain on network loss after acceptance and reconciles', async () => {
    const items = makeRegistry();
    let posts = 0;
    const envelope = makeBlobEnvelope('logical-commit-2', Buffer.from([0, 1, 2, 255, 10, 13, 10]));
    const stored = makeConnectItem('provider-2', envelope);
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async (url, init) => {
        const parsed = new URL(url);
        if (init?.method === 'POST') {
          posts += 1;
          items.set(stored.id, stored);
          throw new TypeError('socket hang up');
        }
        if (parsed.pathname.endsWith('/items')) {
          return textResponse(200, JSON.stringify([...items.values()]));
        }
        return textResponse(404, '{}');
      },
    });
    const result = await store.createItem({
      title: stored.title,
      category: 'SECURE_NOTE',
      tags: stored.tags,
      fields: stored.fields,
    });
    expect(result).toEqual({ status: 'uncertain', attempts: 1 });
    expect(posts).toBe(1);
    expect((await store.listItems()).map((entry) => entry.id)).toEqual(['provider-2']);
  });

  it('returns uncertain on malformed success bodies', async () => {
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async (_url, init) => {
        if (init?.method === 'POST') {
          return textResponse(201, '{"id":');
        }
        return textResponse(200, '[]');
      },
    });
    await expect(
      store.createItem({ title: 't', category: 'SECURE_NOTE', tags: [], fields: [{ type: 'CONCEALED', value: 'v' }] }),
    ).resolves.toEqual({ status: 'uncertain', attempts: 1 });
  });

  it('throws auth for POST without uncertain fallback', async () => {
    let posts = 0;
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async () => {
        posts += 1;
        return textResponse(401, '{}');
      },
    });
    await expect(
      store.createItem({ title: 't', category: 'SECURE_NOTE', tags: [], fields: [{ type: 'CONCEALED', value: 'v' }] }),
    ).rejects.toMatchObject({ code: 'auth' });
    expect(posts).toBe(1);
  });
});

describe('visibility and round-trips', () => {
  it('models delayed visibility without assuming transactions', async () => {
    const envelope = makeBlobEnvelope('logical-delayed', Buffer.from('line1\nline2\r\nline3\0binary'));
    const stored = makeConnectItem('provider-delayed', envelope);
    let visible = false;
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/items')) {
          return textResponse(200, visible ? JSON.stringify([stored]) : '[]');
        }
        if (!visible) {
          return textResponse(404, '{}');
        }
        return textResponse(200, JSON.stringify(stored));
      },
    });
    expect(await store.listItems()).toEqual([]);
    await expect(store.getItem(stored.id)).rejects.toMatchObject({ code: 'not-found' });
    visible = true;
    expect((await store.listItems()).map((entry) => entry.id)).toEqual([stored.id]);
    const fetched = await store.getItem(stored.id);
    expect(fetched.fields[1]?.value).toBe(JSON.stringify(envelope));
  });

  it('round-trips empty binary and 32kib payloads byte-equal', async () => {
    const payloads: Uint8Array[] = [Buffer.from([]), Buffer.from([0, 255, 10, 13, 10]), Buffer.alloc(32768, 7)];
    const storedItems = payloads.map((bytes, index) =>
      makeConnectItem(`p-round-${index}`, makeBlobEnvelope(`logical-round-${index}`, bytes)),
    );
    const byId = new Map(storedItems.map((item) => [item.id, item]));
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith('/items')) {
          return textResponse(200, JSON.stringify(storedItems));
        }
        const id = parsed.pathname.split('/').pop() as string;
        const hit = byId.get(id);
        if (hit === undefined) {
          return textResponse(404, '{}');
        }
        return textResponse(200, JSON.stringify(hit));
      },
    });
    const listed = await store.listItems();
    expect(listed).toHaveLength(3);
    for (const item of storedItems) {
      const fetched = await store.getItem(item.id);
      const payloadRaw = fetched.fields.find((field) => field.label === 'payload')?.value as string;
      const parsed = JSON.parse(payloadRaw) as { contentBase64: string; sha256: string; byteLength: number };
      const bytes = Buffer.from(parsed.contentBase64, 'base64');
      expect(bytes.byteLength).toBe(parsed.byteLength);
      expect(sha256Hex(bytes)).toBe(parsed.sha256);
      expect(payloadRaw).toBe(item.fields[1]?.value);
    }
  });
});

describe('secrecy', () => {
  it('keeps tokens and payload canaries out of results and errors', async () => {
    const tokenCanary = `connect-token-${randomUUID()}`;
    const payloadCanary = `payload-canary-${randomUUID()}-bytes`;
    const env = makeEnv('https://connect.example.invalid', tokenCanary);
    const envelope = makeBlobEnvelope('logical-secret', Buffer.from(payloadCanary));
    const stored = makeConnectItem('provider-secret', envelope);
    const store = new ConnectSecretStore({
      vaultId: VAULT_ID,
      env,
      fetchImpl: async (url, init) => {
        expect(String(authOf(init))).toBe(`Bearer ${tokenCanary}`);
        const parsed = new URL(url);
        if (init?.method === 'POST') {
          return textResponse(401, '{}');
        }
        if (parsed.pathname.endsWith('/items')) {
          return textResponse(200, JSON.stringify([stored]));
        }
        return textResponse(200, JSON.stringify(stored));
      },
    });
    const listed = await store.listItems();
    const fetched = await store.getItem(stored.id);
    const error = await store
      .createItem({
        title: 't',
        category: 'SECURE_NOTE',
        tags: [],
        fields: [{ type: 'CONCEALED', value: payloadCanary }],
      })
      .catch((e: unknown) => e);
    const serialized = JSON.stringify({ listed, fetchedId: fetched.id, error: String((error as Error).message) });
    expect(serialized).not.toContain(tokenCanary);
    const listedSummaries = JSON.stringify(listed);
    expect(listedSummaries).not.toContain(payloadCanary);
    expect(String((error as Error).message)).not.toContain(tokenCanary);
    expect(String((error as Error).message)).not.toContain(payloadCanary);
    const diagnostics = JSON.stringify({
      code: (error as SecretSyncError).code,
      status: (error as SecretSyncError).status,
    });
    expect(diagnostics).not.toContain(tokenCanary);
    expect(diagnostics).not.toContain(payloadCanary);
  });
});

describe('concurrency', () => {
  it('defaults to 4 and caps at 8', () => {
    const base = {
      vaultId: VAULT_ID,
      env: makeEnv('https://x.invalid', 't'),
      fetchImpl: async () => textResponse(200, '[]'),
    };
    expect(new ConnectSecretStore(base).getConcurrency()).toBe(CONNECT_DEFAULT_CONCURRENCY);
    expect(new ConnectSecretStore({ ...base, concurrency: 8 }).getConcurrency()).toBe(8);
    expect(() => new ConnectSecretStore({ ...base, concurrency: 9 })).toThrow(/Concurrency/);
    expect(() => new ConnectSecretStore({ ...base, concurrency: 0 })).toThrow(/Concurrency/);
    expect(CONNECT_MAX_CONCURRENCY).toBe(8);
  });

  it('bounds parallel work and preserves order', async () => {
    let live = 0;
    let peak = 0;
    const items = [1, 2, 3, 4, 5, 6];
    const results = await mapWithConcurrency(
      items,
      async (value) => {
        live += 1;
        peak = Math.max(peak, live);
        await new Promise((resolve) => setTimeout(resolve, 5));
        live -= 1;
        return value * 2;
      },
      2,
    );
    expect(results).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('exposes a factory with the store contract', async () => {
    const store = createConnectStore({
      vaultId: VAULT_ID,
      env: makeEnv('https://connect.example.invalid', 't'),
      fetchImpl: async () => textResponse(200, '[]'),
    });
    expect(await store.listItems()).toEqual([]);
    const spy = vi.fn();
    void spy;
  });
});
