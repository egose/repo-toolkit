import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveConfluenceSyncPlan, syncConfluenceToDocs, type ConfluenceSyncOptions, type Page } from '../src/index';

function pageFixture(id: string, title: string, versionNumber = 1, bodyValue = ''): Page {
  return {
    id,
    status: 'current',
    title,
    spaceId: 'SPACE',
    parentId: 'PARENT',
    body: bodyValue ? { storage: { value: bodyValue, representation: 'storage' } } : undefined,
    version: { number: versionNumber },
    _links: { webui: `/pages/${id}` },
  };
}

interface RecordedCall {
  method: string;
  args: unknown[];
}

function buildFakeClient(opts: {
  spaceId?: string;
  existingPages?: Record<string, Page>;
  initialAttachmentIds?: Record<string, string>;
}) {
  const spaceId = opts.spaceId ?? 'SPACE';
  const pages = new Map<string, Page>();
  const attachmentsByPage = new Map<string, Map<string, { id: string; filename?: string }>>();
  const calls: RecordedCall[] = [];
  let pageIdCounter = 100;

  const client = {
    async getSpaceIdByKey(key: string): Promise<string> {
      calls.push({ method: 'getSpaceIdByKey', args: [key] });
      return spaceId;
    },
    async getPageByTitle(_spaceId: string, title: string): Promise<Page | undefined> {
      calls.push({ method: 'getPageByTitle', args: [_spaceId, title] });
      const existing = opts.existingPages?.[title];
      return existing ? { ...existing } : undefined;
    },
    async getPage(pageId: string): Promise<Page> {
      calls.push({ method: 'getPage', args: [pageId] });
      const internal = pages.get(pageId);
      if (internal) {
        return { ...internal };
      }
      for (const p of Object.values(opts.existingPages ?? {})) {
        if (p.id === pageId) {
          return { ...p };
        }
      }
      return pageFixture(pageId, 'unknown', 1, '');
    },
    async createPage(input: { title: string; parentId: string }): Promise<Page> {
      calls.push({ method: 'createPage', args: [input] });
      const id = String(pageIdCounter);
      pageIdCounter += 1;
      const created = pageFixture(id, input.title, 1, '');
      pages.set(id, created);
      return created;
    },
    async updatePage(input: {
      id: string;
      title: string;
      body: { value: string };
      version: { number: number };
    }): Promise<Page> {
      calls.push({ method: 'updatePage', args: [input] });
      const next = pageFixture(input.id, input.title, input.version.number, input.body.value);
      pages.set(input.id, { ...next, body: { storage: { value: input.body.value, representation: 'storage' } } });
      return next;
    },
    async getAttachments(
      pageId: string,
    ): Promise<
      { id: string; filename?: string; title: string; version: { number: number }; _links: { webui: string } }[]
    > {
      calls.push({ method: 'getAttachments', args: [pageId] });
      const map = attachmentsByPage.get(pageId) ?? new Map();
      return Array.from(map.values());
    },
    async uploadAttachment(
      pageId: string,
      filePath: string,
    ): Promise<{
      id: string;
      filename?: string;
      title: string;
      version: { number: number };
      _links: { webui: string };
    }> {
      calls.push({ method: 'uploadAttachment', args: [pageId, filePath] });
      const map = attachmentsByPage.get(pageId) ?? new Map();
      const id = 'att-' + pageId + '-' + (map.size + 1);
      const filename = filePath.split(/[\\/]/).pop() ?? 'unknown';
      const att = { id, filename, title: filename, version: { number: 1 }, _links: { webui: '/x' } };
      map.set(filename, att);
      attachmentsByPage.set(pageId, map);
      return att;
    },
    async updateAttachmentData(
      pageId: string,
      attachmentId: string,
      filePath: string,
    ): Promise<{
      id: string;
      filename?: string;
      title: string;
      version: { number: number };
      _links: { webui: string };
    }> {
      calls.push({ method: 'updateAttachmentData', args: [pageId, attachmentId, filePath] });
      const filename = filePath.split(/[\\/]/).pop() ?? 'unknown';
      return { id: attachmentId, filename, title: filename, version: { number: 2 }, _links: { webui: '/u' } };
    },
  };
  return { client, calls };
}

describe('resolveConfluenceSyncPlan', () => {
  const base: ConfluenceSyncOptions = {
    folder: 'docs',
    username: 'u',
    apiToken: 't',
    baseUrl: 'https://x/wiki',
    spaceKey: 'ENG',
    parentPageId: '1234',
  };

  it('fills defaults and resolves folder against cwd', () => {
    const plan = resolveConfluenceSyncPlan({ ...base, cwd: '/tmp/repo' });
    expect(plan.folder).toBe('/tmp/repo/docs');
    expect(plan.skipUnchanged).toBe(true);
    expect(plan.dryRun).toBe(false);
    expect(plan.versionMessage).toMatch(/repo-toolkit-confluence/);
  });

  it('requires folder', () => {
    expect(() => resolveConfluenceSyncPlan({ ...base, folder: '' })).toThrowError(/folder/);
  });

  it('requires username, apiToken, baseUrl, spaceKey, parentPageId', () => {
    const { username, ...noUser } = base;
    void username;
    expect(() => resolveConfluenceSyncPlan(noUser as ConfluenceSyncOptions)).toThrowError(/username/);
  });

  it('rejects non-numeric parentPageId', () => {
    expect(() => resolveConfluenceSyncPlan({ ...base, parentPageId: 'abc' })).toThrowError(/numeric/);
  });
});

describe('syncConfluenceToDocs', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'rt-sync-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('dry-runs without making API calls', async () => {
    await writeFile(join(tmp, 'a.md'), '# A');
    const logSpy = vi.fn();
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await syncConfluenceToDocs({
      folder: tmp,
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
      dryRun: true,
      client: client as unknown as Parameters<typeof syncConfluenceToDocs>[0]['client'],
      log: logSpy,
    });
    expect(calls).toHaveLength(0);
    expect(logSpy).toHaveBeenCalled();
    expect(logSpy.mock.calls[0][0]).toMatch(/dry-run/);
  });

  it('creates parent pages for folders and a leaf page for the markdown file', async () => {
    await mkdir(join(tmp, 'guide'));
    await writeFile(join(tmp, 'guide', 'intro.md'), '# Intro');
    const logSpy = vi.fn();
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await syncConfluenceToDocs({
      folder: tmp,
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
      client: client as unknown as Parameters<typeof syncConfluenceToDocs>[0]['client'],
      log: logSpy,
    });
    const methods = calls.map((c) => c.method);
    expect(methods).toContain('getSpaceIdByKey');
    expect(methods).toContain('getPageByTitle');
    expect(methods).toContain('createPage');
    expect(methods).toContain('updatePage');
    const createTitles = calls
      .filter((c) => c.method === 'createPage')
      .map((c) => (c.args[0] as { title: string }).title);
    expect(createTitles).toContain('guide');
    expect(createTitles).toContain('intro');
  });

  it('uploads local images as attachments and rewrites the placeholder macro', async () => {
    await mkdir(join(tmp, 'img'));
    await writeFile(join(tmp, 'img', 'logo.png'), Buffer.from([1]));
    await writeFile(join(tmp, 'page.md'), '![logo](./img/logo.png)');
    const logSpy = vi.fn();
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await syncConfluenceToDocs({
      folder: tmp,
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
      client: client as unknown as Parameters<typeof syncConfluenceToDocs>[0]['client'],
      log: logSpy,
    });
    const uploadCalls = calls.filter((c) => c.method === 'uploadAttachment');
    expect(uploadCalls).toHaveLength(1);
    const updateCalls = calls.filter((c) => c.method === 'updatePage');
    expect(updateCalls).toHaveLength(1);
    const body = (updateCalls[0].args[0] as { body: { value: string } }).body.value;
    expect(body).toContain('<ac:image><ri:attachment ri:filename="logo.png" /></ac:image>');
    expect(body).not.toContain('data-local-src');
  });

  it('leaves remote images as ri:url macros', async () => {
    await writeFile(join(tmp, 'page.md'), '![alt](https://cdn.example/logo.png)');
    const logSpy = vi.fn();
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await syncConfluenceToDocs({
      folder: tmp,
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
      client: client as unknown as Parameters<typeof syncConfluenceToDocs>[0]['client'],
      log: logSpy,
    });
    const updateCall = calls.find((c) => c.method === 'updatePage');
    expect(updateCall).toBeDefined();
    const body = (updateCall!.args[0] as { body: { value: string } }).body.value;
    expect(body).toContain('<ri:url ri:value="https://cdn.example/logo.png"');
    expect(body).not.toContain('data-local-src');
  });

  it('skips unchanged pages when skipUnchanged is on', async () => {
    const body = '<h1>Intro</h1>';
    await writeFile(join(tmp, 'intro.md'), '# Intro');
    const logSpy = vi.fn();
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: {
        intro: pageFixture('P1', 'intro', 3, body),
      },
    });
    await syncConfluenceToDocs({
      folder: tmp,
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
      client: client as unknown as Parameters<typeof syncConfluenceToDocs>[0]['client'],
      log: logSpy,
    });
    expect(calls.some((c) => c.method === 'updatePage')).toBe(false);
    expect(logSpy.mock.calls.some((c) => /unchanged/.test(c[0]))).toBe(true);
  });

  it('reuses page id from cache when the same title appears under the same parent', async () => {
    await mkdir(join(tmp, 'a'));
    await mkdir(join(tmp, 'b'));
    await writeFile(join(tmp, 'a', 'x.md'), '# A');
    await writeFile(join(tmp, 'b', 'x.md'), '# B');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await syncConfluenceToDocs({
      folder: tmp,
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
      client: client as unknown as Parameters<typeof syncConfluenceToDocs>[0]['client'],
      log: () => {},
    });
    const pageByTitle = calls.filter((c) => c.method === 'getPageByTitle');
    const titlesPerLookup = pageByTitle.map((c) => c.args[1] as string);
    expect(titlesPerLookup.filter((t) => t === 'x')).toHaveLength(2);
  });
});
