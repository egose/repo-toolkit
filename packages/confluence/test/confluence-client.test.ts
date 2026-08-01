import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfluenceClient, ConfluenceApiError } from '../src/confluence-client';

interface FakeCall {
  endpoint: string;
  init: { method: string; headers: Record<string, string>; body?: string | Buffer };
}

function makeResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  } as Response;
}

function buildFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  const calls: FakeCall[] = [];
  let i = 0;
  const fetchFn = vi.fn(
    async (endpoint: string, init: { method: string; headers?: Record<string, string>; body?: unknown }) => {
      calls.push({ endpoint, init: { method: init.method, headers: init.headers ?? {}, body: init.body } });
      const r = responses[i] ?? responses[responses.length - 1];
      i += 1;
      return makeResponse(r.status, r.body);
    },
  );
  return { fetchFn, calls };
}

describe('ConfluenceClient construction', () => {
  it('requires baseUrl, username, apiToken', () => {
    expect(() => new ConfluenceClient({ baseUrl: '', username: 'u', apiToken: 't' })).toThrowError(/baseUrl/);
    expect(() => new ConfluenceClient({ baseUrl: 'https://x/wiki', username: '', apiToken: 't' })).toThrowError(
      /username/,
    );
    expect(() => new ConfluenceClient({ baseUrl: 'https://x/wiki', username: 'u', apiToken: '' })).toThrowError(
      /username/,
    );
  });

  it('normalizes baseUrl (strips trailing slash, keeps /wiki)', () => {
    const { fetchFn, calls } = buildFetchSequence([{ status: 200, body: { results: [{ id: 'S1', key: 'ENG' }] } }]);
    const client = new ConfluenceClient({
      baseUrl: 'https://x.atlassian.net/wiki/',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });
    return client.getSpaceIdByKey('ENG').then((id) => {
      expect(id).toBe('S1');
      expect(calls[0].endpoint).toBe('https://x.atlassian.net/wiki/api/v2/spaces?keys=ENG&limit=1');
    });
  });

  it('sends basic auth header', async () => {
    const { fetchFn, calls } = buildFetchSequence([{ status: 200, body: { results: [{ id: 'S1', key: 'ENG' }] } }]);
    const client = new ConfluenceClient({
      baseUrl: 'https://x.atlassian.net/wiki',
      username: 'u@example.com',
      apiToken: 'tok',
      fetch: fetchFn as unknown as typeof fetch,
    });
    await client.getSpaceIdByKey('ENG');
    expect(calls[0].init.headers.Authorization).toMatch(/^Basic /);
  });
});

describe('ConfluenceClient.getSpaceIdByKey', () => {
  it('throws when space key not found', async () => {
    const { fetchFn } = buildFetchSequence([{ status: 200, body: { results: [] } }]);
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });
    await expect(client.getSpaceIdByKey('NOPE')).rejects.toThrowError(/space not found/);
  });
});

describe('ConfluenceClient.getPageByTitle', () => {
  it('returns undefined when no match', async () => {
    const { fetchFn } = buildFetchSequence([{ status: 200, body: { results: [] } }]);
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(await client.getPageByTitle('S1', 'Missing')).toBeUndefined();
  });

  it('returns the first matching page', async () => {
    const { fetchFn, calls } = buildFetchSequence([
      { status: 200, body: { results: [{ id: 'P1', title: 'Intro', _links: { webui: '/x' } }] } },
    ]);
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });
    const page = await client.getPageByTitle('S1', 'Intro');
    expect(page?.id).toBe('P1');
    expect(calls[0].endpoint).toContain('space-id=S1');
    expect(calls[0].endpoint).toContain('title=Intro');
    expect(calls[0].endpoint).toContain('body-format=storage');
  });
});

describe('ConfluenceClient.updatePage', () => {
  it('PUTs with incremented version', async () => {
    const { fetchFn, calls } = buildFetchSequence([
      { status: 200, body: { id: 'P1', version: { number: 4 }, _links: { webui: '/p1' }, title: 'Intro' } },
    ]);
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });
    await client.updatePage({
      id: 'P1',
      title: 'Intro',
      body: { representation: 'storage', value: '<p>hi</p>' },
      version: { number: 4, message: 'sync' },
    });
    expect(calls[0].init.method).toBe('PUT');
    expect(calls[0].init.headers['Content-Type']).toBe('application/json');
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent.version.number).toBe(4);
    expect(sent.title).toBe('Intro');
    expect(sent.body.value).toBe('<p>hi</p>');
  });
});

describe('ConfluenceClient error handling', () => {
  it('wraps non-2xx responses in ConfluenceApiError', async () => {
    const { fetchFn } = buildFetchSequence([{ status: 404, body: { message: 'gone' } }]);
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });
    await expect(client.getPage('123')).rejects.toMatchObject({
      name: 'ConfluenceApiError',
      status: 404,
    });
  });

  it('throws ConfluenceApiError on network failure', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ETIMEDOUT');
    });
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });
    await expect(client.getSpaceIdByKey('X')).rejects.toMatchObject({ name: 'ConfluenceApiError', status: 0 });
  });

  it('reports 409 as version conflict', async () => {
    const { fetchFn } = buildFetchSequence([{ status: 409, body: { message: 'conflict' } }]);
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });
    const err = await client.getPage('P1').catch((e) => e);
    expect(err).toBeInstanceOf(ConfluenceApiError);
    expect((err as ConfluenceApiError).message).toMatch(/version conflict/i);
  });
});

describe('ConfluenceClient.uploadAttachment (multipart)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'rt-conf-'));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('POSTs multipart to v1 attachment endpoint with X-Atlassian-Token: no-check', async () => {
    const file = join(tmpDir, 'logo.png');
    await writeFile(file, Buffer.from([1, 2, 3]));
    const { fetchFn, calls } = buildFetchSequence([
      {
        status: 200,
        body: { results: [{ id: 'A1', title: 'logo.png', version: { number: 1 }, _links: { webui: '/a1' } }] },
      },
    ]);
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });
    const attachment = await client.uploadAttachment('P1', file, 'first upload');
    expect(attachment.id).toBe('A1');
    const call = calls[0];
    expect(call.endpoint).toBe('https://x/wiki/rest/api/content/P1/child/attachment');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers['X-Atlassian-Token']).toBe('no-check');
    expect(call.init.headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=----repo-toolkit-confluence-/);
    const body = call.init.body as Buffer;
    expect(body.toString('utf8')).toContain('Content-Disposition: form-data; name="file"; filename="logo.png"');
    expect(body.toString('utf8')).toContain('Content-Disposition: form-data; name="comment"');
  });

  it('targets the existing-attachment data endpoint when attachmentId given', async () => {
    const file = join(tmpDir, 'pic.png');
    await writeFile(file, Buffer.from([9]));
    const { fetchFn, calls } = buildFetchSequence([
      { status: 200, body: { id: 'A2', title: 'pic.png', version: { number: 2 }, _links: { webui: '/a2' } } },
    ]);
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });
    await client.updateAttachmentData('P1', 'A1', file, 'update');
    expect(calls[0].endpoint).toBe('https://x/wiki/rest/api/content/P1/child/attachment/A1/data');
  });
});
