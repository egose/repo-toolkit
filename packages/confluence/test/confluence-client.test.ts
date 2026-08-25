import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfluenceClient, ConfluenceApiError } from '../src/confluence-client';

interface FakeCall {
  endpoint: string;
  init: { method: string; headers: Record<string, string>; body?: string | Buffer };
}

function makeResponse(status: number, body: unknown, responseHeaders?: Record<string, string>): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = new Headers();
  if (responseHeaders) {
    for (const [k, v] of Object.entries(responseHeaders)) {
      headers.set(k, v);
    }
  }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
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

function makeStreamingResponse(status: number, bodyBuffer: Buffer): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const chunkSize = 1024;
      for (let off = 0; off < bodyBuffer.length; off += chunkSize) {
        controller.enqueue(bodyBuffer.subarray(off, Math.min(off + chunkSize, bodyBuffer.length)));
      }
      controller.close();
    },
  });
  const headers = new Headers();
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    body: stream as unknown as BodyInit,
  } as Response;
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

  it('rejects insecure or malformed base URLs', () => {
    expect(() => new ConfluenceClient({ baseUrl: 'http://x/wiki', username: 'u', apiToken: 't' })).toThrowError(
      /https/,
    );
    expect(() => new ConfluenceClient({ baseUrl: 'https://u:p@x/wiki', username: 'u', apiToken: 't' })).toThrowError(
      /embedded credentials/,
    );
    expect(() => new ConfluenceClient({ baseUrl: 'https://x/wiki?test=1', username: 'u', apiToken: 't' })).toThrowError(
      /query or fragment/,
    );
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

describe('ConfluenceClient.getPagesByTitle', () => {
  it('returns an empty array when no match', async () => {
    const { fetchFn } = buildFetchSequence([{ status: 200, body: { results: [] } }]);
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(await client.getPagesByTitle('S1', 'Missing')).toEqual([]);
  });

  it('returns every matching page across pagination', async () => {
    const { fetchFn, calls } = buildFetchSequence([
      {
        status: 200,
        body: {
          results: [{ id: 'P1', title: 'Intro', parentId: '1', _links: { webui: '/x' } }],
          _links: { next: '/wiki/api/v2/pages?cursor=abc' },
        },
      },
      { status: 200, body: { results: [{ id: 'P2', title: 'Intro', parentId: '2', _links: { webui: '/y' } }] } },
    ]);
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });
    const pages = await client.getPagesByTitle('S1', 'Intro');
    expect(pages.map((page) => page.id)).toEqual(['P1', 'P2']);
    expect(calls[0].endpoint).toContain('/spaces/S1/pages?');
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
    const err = (await client.getPage('123').catch((e) => e)) as ConfluenceApiError;
    expect(err.message).toContain('responseBody={"message":"gone"}');
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

  it('rejects redirect responses before following them', async () => {
    const fetchFn = vi.fn(
      async () => ({ ok: false, status: 302, headers: new Headers(), text: async () => '' }) as Response,
    );
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });

    await expect(client.getPage('P1')).rejects.toMatchObject({ status: 302, responseBody: '' });
  });

  it('includes the response body in invalid JSON errors', async () => {
    const fetchFn = vi.fn(async () => makeResponse(200, '<html>login</html>') as Response);
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });

    const err = (await client.getPage('P1').catch((e) => e)) as ConfluenceApiError;
    expect(err).toBeInstanceOf(ConfluenceApiError);
    expect(err.message).toContain('Response was not valid JSON');
    expect(err.message).toContain('responseBody=<html>login</html>');
    expect(err.responseBody).toBe('<html>login</html>');
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

  async function drainBodyStream(body: unknown): Promise<string> {
    if (body && typeof (body as AsyncIterable<Buffer>)[Symbol.asyncIterator] === 'function') {
      const chunks: Buffer[] = [];
      for await (const chunk of body as AsyncIterable<Buffer>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
      }
      return Buffer.concat(chunks).toString('utf8');
    }
    return body instanceof Buffer ? body.toString('utf8') : String(body);
  }

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
    const wire = await drainBodyStream(call.init.body);
    expect(wire).toContain('Content-Disposition: form-data; name="file"; filename="logo.png"');
    expect(wire).toContain('Content-Disposition: form-data; name="comment"');
    expect(wire).toContain('first upload');
    const fileBytes = Buffer.from([1, 2, 3]).toString('binary');
    expect(wire).toContain(fileBytes);
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

  it('sanitizes hostile filename characters so they cannot inject header lines', async () => {
    const hostileName = 'a"b\r\nContent-Disposition: malicious\r\nx.png';
    const file = join(tmpDir, hostileName);
    await writeFile(file, Buffer.from([4, 5]));
    const { fetchFn, calls } = buildFetchSequence([
      {
        status: 200,
        body: { results: [{ id: 'A3', title: 'x', version: { number: 1 }, _links: { webui: '/a3' } }] },
      },
    ]);
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });
    await client.uploadAttachment('P1', file, 'c');
    const wire = await drainBodyStream(calls[0].init.body);
    expect(wire).not.toContain('\r\nContent-Disposition: malicious\r\n');
    expect(wire).not.toContain('\nContent-Disposition: malicious');
    expect(wire).not.toContain('Content-Disposition: form-data; name="malicious"');
    const fileLines = wire
      .split('\r\n')
      .filter((line) => line.startsWith('Content-Disposition: form-data; name="file"'));
    expect(fileLines).toHaveLength(1);
    const sanitizedOnLine = fileLines[0] ?? '';
    expect(sanitizedOnLine).not.toContain('"a"b');
  });

  it('keeps Unicode filenames valid and intact in the multipart body', async () => {
    const unicodeName = '文档-éàü-αβγ.png';
    const file = join(tmpDir, unicodeName);
    await writeFile(file, Buffer.from([7, 8, 9]));
    const { fetchFn, calls } = buildFetchSequence([
      {
        status: 200,
        body: { results: [{ id: 'A4', title: 'u', version: { number: 1 }, _links: { webui: '/a4' } }] },
      },
    ]);
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });
    await client.uploadAttachment('P1', file);
    const wire = await drainBodyStream(calls[0].init.body);
    expect(wire).toContain(`filename="${unicodeName}"`);
    expect(wire).toContain('文档');
  });

  it('rejects files exceeding maxUploadBytes before reading them', async () => {
    const file = join(tmpDir, 'big.bin');
    await writeFile(file, Buffer.alloc(1024, 1));
    const { fetchFn, calls } = buildFetchSequence([
      { status: 200, body: { results: [{ id: 'A5', version: { number: 1 }, _links: { webui: '/a5' } }] } },
    ]);
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
      maxUploadBytes: 512,
    });
    await expect(client.uploadAttachment('P1', file)).rejects.toThrowError(/upload size limit/);
    expect(calls).toHaveLength(0);
  });

  it('streams large uploads in bounded chunks without buffering the whole file', async () => {
    const fileBytes = Buffer.alloc(3 * 1024 * 1024, 7);
    const file = join(tmpDir, 'large.bin');
    await writeFile(file, fileBytes);
    const { fetchFn, calls } = buildFetchSequence([
      { status: 200, body: { results: [{ id: 'A6', version: { number: 1 }, _links: { webui: '/a6' } }] } },
    ]);
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
      maxUploadBytes: 64 * 1024 * 1024,
    });
    await client.uploadAttachment('P1', file);

    const body = calls[0]?.init.body;
    expect(typeof (body as AsyncIterable<Buffer>)[Symbol.asyncIterator]).toBe('function');
    expect(Buffer.isBuffer(body)).toBe(false);

    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    const totalBody = Buffer.concat(chunks);

    const tooLarge = chunks.some((c) => c.length > fileBytes.length);
    expect(tooLarge).toBe(false);

    const maxReadStreamChunk = 1024 * 1024;
    const streamingChunks = chunks.filter((c) => c.length <= maxReadStreamChunk);
    expect(streamingChunks.length).toBeGreaterThan(1);

    expect(totalBody.toString('utf8')).toMatch(/------repo-toolkit-confluence-/);
    expect(totalBody.includes(fileBytes)).toBe(true);
  });
});

describe('ConfluenceClient network controls (timeout, retry, pagination)', () => {
  it('aborts a hanging request after the configured timeout', async () => {
    const fetchFn = vi.fn(async (_endpoint: string, init: RequestInit) => {
      expect(init.signal).toBeDefined();
      return new Promise<Response>((_resolve, reject) => {
        const sig = (init.signal as AbortSignal) ?? new AbortController().signal;
        sig.addEventListener('abort', () => reject(new Error('timed out')) as unknown as () => void);
      });
    });
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
      requestTimeoutMs: 30,
    });
    await expect(client.getSpaceIdByKey('X')).rejects.toMatchObject({ name: 'ConfluenceApiError', status: 0 });
  });

  it('retries 429 responses on safe GETs honoring Retry-After, then succeeds', async () => {
    let callCount = 0;
    const fetchFn = vi.fn(async (): Promise<Response> => {
      callCount += 1;
      if (callCount === 1) {
        return makeResponse(429, { message: 'slow down' }, { 'Retry-After': '0' }) as Response;
      }
      return makeResponse(200, { results: [{ id: 'S1', key: 'X' }] }) as Response;
    });
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
      maxRetries: 3,
    });
    const id = await client.getSpaceIdByKey('X');
    expect(id).toBe('S1');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not retry writes (POST)', async () => {
    const fetchFn = vi.fn(async () => {
      return makeResponse(500, { message: 'boom' }, { 'Retry-After': '0' }) as Response;
    });
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
      maxRetries: 3,
    });
    await client
      .createPage({
        spaceId: 'S1',
        title: 't',
        body: { representation: 'storage', value: '<p/>' },
      })
      .catch((e) => e);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('caps pagination and rejects a next-link loop', async () => {
    const fetchFn = vi.fn(async () => {
      return makeResponse(200, {
        results: [{ id: 'A', title: 'x', version: { number: 1 }, _links: { webui: '/z' } }],
        _links: { next: 'https://x/wiki/api/v2/pages?cursor=loop' },
      }) as Response;
    });
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
      maxRetries: 0,
    });
    await expect(client.getPagesByTitle('S1', 'x')).rejects.toMatchObject({ name: 'ConfluenceApiError' });
  });

  it('rejects cross-origin pagination next links', async () => {
    const fetchFn = vi.fn(async () => {
      return makeResponse(200, {
        results: [],
        _links: { next: 'https://evil.example/api/v2/pages' },
      }) as Response;
    });
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });
    await expect(client.getPagesByTitle('S1', 'x')).rejects.toThrowError(/cross-origin/);
  });

  it('truncates oversized streaming response bodies surfaced in errors', async () => {
    const oversized = Buffer.from('0'.repeat(20_000), 'utf8');
    const fetchFn = vi.fn(async () => makeStreamingResponse(404, oversized) as Response);
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });
    const err = (await client.getPage('P1').catch((e) => e)) as ConfluenceApiError;
    expect(err).toBeInstanceOf(ConfluenceApiError);
    expect(err.responseBody.endsWith('...')).toBe(true);
    expect(err.responseBody.length).toBeLessThan(oversized.length);
  });

  it('accumulates getAttachments across pagination exactly once and terminates', async () => {
    const responses = [
      {
        status: 200,
        body: {
          results: [
            { id: 'A1', title: 'a.png', version: { number: 1 }, _links: { webui: '/a1' } },
            { id: 'A2', title: 'b.png', version: { number: 1 }, _links: { webui: '/a2' } },
          ],
          _links: { next: '/wiki/api/v2/pages/P1/attachments?cursor=2' },
        },
      },
      {
        status: 200,
        body: {
          results: [{ id: 'A3', title: 'c.png', version: { number: 1 }, _links: { webui: '/a3' } }],
        },
      },
    ];
    const { fetchFn, calls } = buildFetchSequence(responses);
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });
    const attachments = await client.getAttachments('P1');
    expect(attachments.map((a) => a.id)).toEqual(['A1', 'A2', 'A3']);
    expect(calls).toHaveLength(2);
  });

  it('rejects a getAttachments next-link cycle before the page cap is hit', async () => {
    const seen = new Set<string>();
    let callCount = 0;
    const fetchFn = vi.fn(async (endpoint: string) => {
      callCount += 1;
      seen.add(endpoint);
      return makeResponse(200, {
        results: [{ id: 'A1', title: 'x', version: { number: 1 }, _links: { webui: '/z' } }],
        _links: { next: callCount < 2 ? 'https://x/wiki/api/v2/pages/P1/attachments?cursor=2' : endpoint },
      }) as Response;
    });
    const client = new ConfluenceClient({
      baseUrl: 'https://x/wiki',
      username: 'u',
      apiToken: 't',
      fetch: fetchFn as unknown as typeof fetch,
    });
    await expect(client.getAttachments('P1')).rejects.toMatchObject({ name: 'ConfluenceApiError' });
    expect(callCount).toBeLessThan(5);
  });
});
