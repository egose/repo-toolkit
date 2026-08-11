import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));
const DIST_INDEX_DTS = resolve(TEST_DIR, '..', 'dist', 'index.d.ts');

import {
  resolveConfluenceSyncPlan,
  syncConfluenceToDocs,
  validateLocalSync,
  LocalSyncValidationAggregateError,
  SyncMutationError,
  validateAttachmentSources,
  type ConfluenceSyncOptions,
  type ConfluenceGateway,
  type Page,
  type SyncChange,
} from '../src/index';

function pageFixture(id: string, title: string, versionNumber = 1, bodyValue = '', parentId = 'PARENT'): Page {
  return {
    id,
    status: 'current',
    title,
    spaceId: 'SPACE',
    parentId,
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
  existingPages?: Page[];
  initialAttachmentIds?: Record<string, string>;
}): { client: ConfluenceGateway; calls: RecordedCall[] } {
  const spaceId = opts.spaceId ?? 'SPACE';
  const pages = new Map<string, Page>();
  const attachmentsByPage = new Map<string, Map<string, { id: string; filename?: string }>>();
  const calls: RecordedCall[] = [];
  let pageIdCounter = 100;

  const client: ConfluenceGateway = {
    async getSpaceIdByKey(key: string): Promise<string> {
      calls.push({ method: 'getSpaceIdByKey', args: [key] });
      return spaceId;
    },
    async getPagesByTitle(_spaceId: string, title: string): Promise<Page[]> {
      calls.push({ method: 'getPagesByTitle', args: [_spaceId, title] });
      const fromExisting = (opts.existingPages ?? [])
        .filter((page) => page.title === title)
        .map((page) => ({ ...page }));
      const fromCreated: Page[] = [];
      for (const page of pages.values()) {
        if (page.title === title) {
          fromCreated.push({ ...page });
        }
      }
      const seen = new Set<string>();
      const merged: Page[] = [];
      for (const page of [...fromExisting, ...fromCreated]) {
        if (page.id !== undefined && !seen.has(page.id)) {
          seen.add(page.id);
          merged.push(page);
        }
      }
      return merged;
    },
    async getPage(pageId: string): Promise<Page> {
      calls.push({ method: 'getPage', args: [pageId] });
      const internal = pages.get(pageId);
      if (internal) {
        return { ...internal };
      }
      for (const p of opts.existingPages ?? []) {
        if (p.id === pageId) {
          return { ...p };
        }
      }
      return pageFixture(pageId, 'unknown', 1, '');
    },
    async createPage(input: { title: string; parentId: string; body?: { value: string } }): Promise<Page> {
      calls.push({ method: 'createPage', args: [input] });
      const id = String(pageIdCounter);
      pageIdCounter += 1;
      const bodyValue = input.body?.value ?? '';
      const created = pageFixture(id, input.title, 1, bodyValue, input.parentId);
      pages.set(id, {
        ...created,
        body: bodyValue ? { storage: { value: bodyValue, representation: 'storage' } } : undefined,
      });
      return created;
    },
    async updatePage(input: {
      id: string;
      title: string;
      body: { value: string };
      version: { number: number };
    }): Promise<Page> {
      calls.push({ method: 'updatePage', args: [input] });
      const existing = pages.get(input.id);
      const parentId = existing?.parentId ?? 'PARENT';
      const next = pageFixture(input.id, input.title, input.version.number, input.body.value, parentId);
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
      comment?: string,
      filenameOverride?: string,
    ): Promise<{
      id: string;
      filename?: string;
      title: string;
      version: { number: number; message?: string };
      _links: { webui: string };
    }> {
      calls.push({ method: 'uploadAttachment', args: [pageId, filePath, comment, filenameOverride] });
      const map = attachmentsByPage.get(pageId) ?? new Map();
      const id = 'att-' + pageId + '-' + (map.size + 1);
      const filename = filenameOverride ?? filePath.split(/[\\/]/).pop() ?? 'unknown';
      const att = {
        id,
        filename,
        title: filename,
        version: { number: 1, message: comment },
        _links: { webui: '/x' },
      };
      map.set(filename, att);
      attachmentsByPage.set(pageId, map);
      return att;
    },
    async updateAttachmentData(
      pageId: string,
      attachmentId: string,
      filePath: string,
      comment?: string,
      filenameOverride?: string,
    ): Promise<{
      id: string;
      filename?: string;
      title: string;
      version: { number: number; message?: string };
      _links: { webui: string };
    }> {
      calls.push({ method: 'updateAttachmentData', args: [pageId, attachmentId, filePath, comment, filenameOverride] });
      const filename = filenameOverride ?? filePath.split(/[\\/]/).pop() ?? 'unknown';
      const att = {
        id: attachmentId,
        filename,
        title: filename,
        version: { number: 2, message: comment },
        _links: { webui: '/u' },
      };
      const map = attachmentsByPage.get(pageId) ?? new Map();
      map.set(filename, att);
      attachmentsByPage.set(pageId, map);
      return att;
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
    expect(plan.renderHtmlBlocks).toBe(false);
    expect(plan.versionMessage).toMatch(/repo-toolkit-confluence/);
  });

  it('fills renderHtmlBlocks true when provided', () => {
    const plan = resolveConfluenceSyncPlan({ ...base, renderHtmlBlocks: true });
    expect(plan.renderHtmlBlocks).toBe(true);
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
      client: client,
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
      client: client,
      log: logSpy,
    });
    const methods = calls.map((c) => c.method);
    expect(methods).toContain('getSpaceIdByKey');
    expect(methods).toContain('getPagesByTitle');
    expect(methods).toContain('createPage');
    const createTitles = calls
      .filter((c) => c.method === 'createPage')
      .map((c) => (c.args[0] as { title: string }).title);
    expect(createTitles).toContain('guide');
    expect(createTitles).toContain('intro');
    // CFARC-03: leaf pages whose body needs no attachment uploads are created
    // in a single POST with the final rendered body — no follow-up updatePage.
    const introCreate = calls.find(
      (c) => c.method === 'createPage' && (c.args[0] as { title: string }).title === 'intro',
    )?.args[0] as { body?: { value: string } } | undefined;
    expect(introCreate?.body).toBeDefined();
    expect(introCreate?.body?.value).toBe('<h1>Intro</h1>');
    expect(methods).not.toContain('updatePage');
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
      client: client,
      log: logSpy,
    });
    const uploadCalls = calls.filter((c) => c.method === 'uploadAttachment');
    expect(uploadCalls).toHaveLength(1);
    const updateCalls = calls.filter((c) => c.method === 'updatePage');
    expect(updateCalls).toHaveLength(1);
    const body = (updateCalls[0].args[0] as { body: { value: string } }).body.value;
    // The attachment filename is content-addressed: <stem>-<sha256[:16]>.<ext>,
    // so identical content always maps to a stable, insertion-order-independent name.
    expect(body).toMatch(/<ac:image><ri:attachment ri:filename="logo-[0-9a-f]{16}\.png" \/><\/ac:image>/);
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
      client: client,
      log: logSpy,
    });
    // CFARC-03: a leaf page with no local uploads is created with its final
    // body in a single POST (no follow-up PUT). The body is therefore carried
    // by createPage, not updatePage.
    const createCall = calls.find((c) => c.method === 'createPage');
    expect(createCall).toBeDefined();
    const body = (createCall!.args[0] as { body?: { value: string } }).body?.value ?? '';
    expect(body).toContain('<ri:url ri:value="https://cdn.example/logo.png"');
    expect(body).not.toContain('data-local-src');
  });

  it('skips unchanged pages when skipUnchanged is on', async () => {
    const body = '<h1>Intro</h1>';
    await writeFile(join(tmp, 'intro.md'), '# Intro');
    const logSpy = vi.fn();
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [pageFixture('P1', 'intro', 3, body, '123')],
    });
    await syncConfluenceToDocs({
      folder: tmp,
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
      client: client,
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
      client: client,
      log: () => {},
    });
    const pageByTitle = calls.filter((c) => c.method === 'getPagesByTitle');
    const titlesPerLookup = pageByTitle.map((c) => c.args[1] as string);
    expect(titlesPerLookup.filter((t) => t === 'x')).toHaveLength(2);
  });

  it('selects the page that matches the requested parent when the same title exists elsewhere', async () => {
    await mkdir(join(tmp, 'guide'), { recursive: true });
    await writeFile(join(tmp, 'guide', 'intro.md'), '# Intro');
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [pageFixture('P-other', 'intro', 1, '', '999'), pageFixture('P-guide', 'guide', 1, '', '123')],
    });

    await syncConfluenceToDocs({
      folder: tmp,
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
      client: client,
      log: () => {},
    });

    const createCalls = calls.filter((call) => call.method === 'createPage');
    expect(createCalls).toHaveLength(1);
    expect((createCalls[0].args[0] as { title: string }).title).toBe('intro');
  });

  it('rejects ambiguous same-parent page title matches before mutating pages', async () => {
    await writeFile(join(tmp, 'intro.md'), '# Intro');
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [pageFixture('P1', 'intro', 1, '', '123'), pageFixture('P2', 'intro', 1, '', '123')],
    });

    await expect(
      syncConfluenceToDocs({
        folder: tmp,
        username: 'u',
        apiToken: 't',
        baseUrl: 'https://x/wiki',
        spaceKey: 'ENG',
        parentPageId: '123',
        client: client,
        log: () => {},
      }),
    ).rejects.toThrowError(/Multiple Confluence pages matched title intro/);
    expect(calls.some((call) => call.method === 'updatePage')).toBe(false);
  });

  it('rejects local file and folder title collisions before making API calls', async () => {
    await mkdir(join(tmp, 'foo'), { recursive: true });
    await writeFile(join(tmp, 'foo.md'), '# Foo');
    await writeFile(join(tmp, 'foo', 'bar.md'), '# Bar');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });

    await expect(
      syncConfluenceToDocs({
        folder: tmp,
        username: 'u',
        apiToken: 't',
        baseUrl: 'https://x/wiki',
        spaceKey: 'ENG',
        parentPageId: '123',
        client: client,
        log: () => {},
      }),
    ).rejects.toThrowError(/conflicting page titles/);
    expect(calls).toHaveLength(0);
  });

  it('rejects attachment sources that escape the documentation root', async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), 'rt-sync-outside-'));

    try {
      await mkdir(join(tmp, 'img'), { recursive: true });
      await writeFile(join(outsideDir, 'secret.png'), Buffer.from([1]));
      await symlink(join(outsideDir, 'secret.png'), join(tmp, 'img', 'secret.png'));
      await writeFile(join(tmp, 'page.md'), '![logo](./img/secret.png)');
      const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });

      await expect(
        syncConfluenceToDocs({
          folder: tmp,
          username: 'u',
          apiToken: 't',
          baseUrl: 'https://x/wiki',
          spaceKey: 'ENG',
          parentPageId: '123',
          client: client,
          log: () => {},
        }),
      ).rejects.toThrowError(/escapes the documentation root/);
      expect(calls.some((call) => call.method === 'updatePage')).toBe(false);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('renders ```html fenced blocks as the html macro when renderHtmlBlocks is on', async () => {
    await writeFile(join(tmp, 'page.md'), '```html\n<div class="card">hi</div>\n```');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await syncConfluenceToDocs({
      folder: tmp,
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
      renderHtmlBlocks: true,
      client: client,
      log: () => {},
    });
    // CFARC-03: leaf with no attachments is created in one POST with its
    // final rendered body — the body is on createPage, not updatePage.
    const created = calls.find((c) => c.method === 'createPage')?.args[0] as { body?: { value: string } } | undefined;
    expect(created?.body?.value).toBeDefined();
    expect(created?.body?.value).toContain('<ac:structured-macro ac:name="html"');
    expect(created?.body?.value).not.toContain('ac:name="code"');
  });

  it('renders ```html fenced blocks as a code macro by default', async () => {
    await writeFile(join(tmp, 'page.md'), '```html\n<div>hi</div>\n```');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await syncConfluenceToDocs({
      folder: tmp,
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
      client: client,
      log: () => {},
    });
    const created = calls.find((c) => c.method === 'createPage')?.args[0] as { body?: { value: string } } | undefined;
    expect(created?.body?.value).toBeDefined();
    expect(created?.body?.value).toContain('<ac:structured-macro ac:name="code"');
    expect(created?.body?.value).toContain('<ac:parameter ac:name="language">html</ac:parameter>');
  });
});

describe('CFARC-02: content-addressed attachments and no-op second sync', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'rt-sync-cfarc02-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('a second identical sync performs no page PUT, no attachment mutation, and no upload', async () => {
    await mkdir(join(tmp, 'img'));
    await writeFile(join(tmp, 'img', 'logo.png'), Buffer.from([1, 2, 3]));
    await writeFile(join(tmp, 'page.md'), '# Page\n\n![logo](./img/logo.png)');

    // pre-populate the existing-pages fixture so the leaf page already exists
    // (the first sync will PUT its body; the second sync must NOT)
    const initialPage = pageFixture('P1', 'page', 1, 'STALE_BODY', '123');

    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [initialPage],
    });

    // First sync — should put the page (real upload + PUT)
    await syncConfluenceToDocs({
      folder: tmp,
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
      client: client,
      log: () => {},
    });

    const firstRunGetAtt = calls.filter((c) => c.method === 'getAttachments').length;
    const firstRunUploads = calls.filter((c) => c.method === 'uploadAttachment').length;
    const firstRunUpdates = calls.filter((c) => c.method === 'updateAttachmentData').length;
    const firstRunPuts = calls.filter((c) => c.method === 'updatePage').length;

    expect(firstRunUploads).toBe(1);
    expect(firstRunPuts).toBe(1);

    // Second identical sync — call counts must not advance for mutations.
    // Re-use the same client (its pages/attachments maps persist).
    await syncConfluenceToDocs({
      folder: tmp,
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
      client: client,
      log: () => {},
    });

    const uploadsAfterSecond = calls.filter((c) => c.method === 'uploadAttachment').length;
    const updatesAfterSecond = calls.filter((c) => c.method === 'updateAttachmentData').length;
    const putsAfterSecond = calls.filter((c) => c.method === 'updatePage').length;

    expect(uploadsAfterSecond).toBe(firstRunUploads);
    expect(updatesAfterSecond).toBe(firstRunUpdates);
    expect(putsAfterSecond).toBe(firstRunPuts);

    // The second sync should have called getAttachments once (during preflight)
    // but no upload/PUT after that — so total getAttachments = firstRun + 1
    expect(calls.filter((c) => c.method === 'getAttachments').length).toBe(firstRunGetAtt + 1);
  });

  it('two same-basename images with different content get distinct content-addressed filenames', async () => {
    await mkdir(join(tmp, 'a'));
    await mkdir(join(tmp, 'b'));
    await writeFile(join(tmp, 'a', 'logo.png'), Buffer.from([1, 2, 3]));
    await writeFile(join(tmp, 'b', 'logo.png'), Buffer.from([4, 5, 6]));
    await writeFile(join(tmp, 'page.md'), '![a](./a/logo.png)\n\n![b](./b/logo.png)');

    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await syncConfluenceToDocs({
      folder: tmp,
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
      client: client,
      log: () => {},
    });

    const uploadCalls = calls.filter((c) => c.method === 'uploadAttachment');
    expect(uploadCalls).toHaveLength(2);
    const filenames = uploadCalls.map((c) => c.args[3] as string | undefined);
    expect(filenames[0]).toMatch(/^logo-[0-9a-f]{16}\.png$/);
    expect(filenames[1]).toMatch(/^logo-[0-9a-f]{16}\.png$/);
    expect(filenames[0]).not.toBe(filenames[1]);
    const updateCall = calls.find((c) => c.method === 'updatePage')?.args[0] as { body: { value: string } };
    expect(updateCall.body.value).toContain(`ri:filename="${filenames[0]}"`);
    expect(updateCall.body.value).toContain(`ri:filename="${filenames[1]}"`);
  });

  it('inserting an earlier mermaid diagram does not rename the existing diagrams (insertion stability is tested in mermaid.test.ts via rewriteMermaidBlocks)', async () => {
    // A mermaid-only page (no attachments, no local images) where mmdc is
    // unavailable (default in the fake environment) falls back to code macros.
    // Re-syncing the same file must be a no-op (no PUT).
    await writeFile(join(tmp, 'page.md'), '```mermaid\ngraph TD\nA-->B\n```');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await syncConfluenceToDocs({
      folder: tmp,
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
      client: client,
      log: () => {},
    });
    const firstPuts = calls.filter((c) => c.method === 'updatePage').length;
    const firstUploads = calls.filter((c) => c.method === 'uploadAttachment').length;
    expect(firstPuts).toBe(1);
    expect(firstUploads).toBe(0);

    await syncConfluenceToDocs({
      folder: tmp,
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
      client: client,
      log: () => {},
    });
    const secondPuts = calls.filter((c) => c.method === 'updatePage').length;
    const secondUploads = calls.filter((c) => c.method === 'uploadAttachment').length;
    expect(secondPuts).toBe(firstPuts);
    expect(secondUploads).toBe(firstUploads);
  });
});

describe('CFARC-03: validate locally before remote mutation', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'rt-sync-cfarc03-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  function mutationMethods(calls: RecordedCall[]): string[] {
    const MUTATION_METHODS = new Set(['createPage', 'updatePage', 'uploadAttachment', 'updateAttachmentData']);
    return calls.map((c) => c.method).filter((m) => MUTATION_METHODS.has(m));
  }

  it('rejects an attachment source that escapes the doc root before any API call (no client constructed)', async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), 'rt-cfarc03-outside-'));
    try {
      await mkdir(join(tmp, 'img'), { recursive: true });
      await writeFile(join(outsideDir, 'secret.png'), Buffer.from([1]));
      await symlink(join(outsideDir, 'secret.png'), join(tmp, 'img', 'secret.png'));
      await writeFile(join(tmp, 'page.md'), '![logo](./img/secret.png)');
      const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });

      await expect(
        syncConfluenceToDocs({
          folder: tmp,
          username: 'u',
          apiToken: 't',
          baseUrl: 'https://x/wiki',
          spaceKey: 'ENG',
          parentPageId: '123',
          client: client,
          log: () => {},
        }),
      ).rejects.toBeInstanceOf(LocalSyncValidationAggregateError);
      // Criterion 1: every local validation failure causes zero API mutation calls.
      // Stronger: no API call of ANY kind runs when local validation fails,
      // because validation occurs before the client is constructed/used.
      expect(mutationMethods(calls)).toHaveLength(0);
      expect(calls.some((c) => c.method === 'getSpaceIdByKey')).toBe(false);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('rejects a missing attachment source before any API call', async () => {
    await writeFile(join(tmp, 'page.md'), '![logo](./img/missing.png)');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });

    await expect(
      syncConfluenceToDocs({
        folder: tmp,
        username: 'u',
        apiToken: 't',
        baseUrl: 'https://x/wiki',
        spaceKey: 'ENG',
        parentPageId: '123',
        client: client,
        log: () => {},
      }),
    ).rejects.toBeInstanceOf(LocalSyncValidationAggregateError);
    expect(mutationMethods(calls)).toHaveLength(0);
    expect(calls.some((c) => c.method === 'getSpaceIdByKey')).toBe(false);
  });

  it('aggregates multiple per-entry defects into one LocalSyncValidationAggregateError', async () => {
    // Two unrelated broken inputs, plus a valid third page:
    await writeFile(join(tmp, 'bad1.md'), '![nope](./missing-a.png)');
    await writeFile(join(tmp, 'bad2.md'), '![nope](./missing-b.png)');
    await writeFile(join(tmp, 'ok.md'), '# OK');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });

    let thrown: unknown;
    try {
      await syncConfluenceToDocs({
        folder: tmp,
        username: 'u',
        apiToken: 't',
        baseUrl: 'https://x/wiki',
        spaceKey: 'ENG',
        parentPageId: '123',
        client: client,
        log: () => {},
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LocalSyncValidationAggregateError);
    const aggregate = thrown as LocalSyncValidationAggregateError;
    const failingSegments = aggregate.defects.map((d) => d.entry.segments.join('/')).sort();
    expect(failingSegments).toEqual(['bad1.md', 'bad2.md']);
    // All defects carry a real error message surfacing the local failure.
    expect(aggregate.defects.every((d) => /not found|escapes|regular file|size/i.test(d.error.message))).toBe(true);
    expect(aggregate.message).toMatch(/2 document\(s\)/);
    expect(mutationMethods(calls)).toHaveLength(0);
  });

  it('does not aggregate defects across already-validated entries (validateLocalSync returns a plan when all are valid)', async () => {
    await mkdir(join(tmp, 'img'));
    await writeFile(join(tmp, 'img', 'logo.png'), Buffer.from([1, 2, 3]));
    await writeFile(join(tmp, 'page.md'), '# Page\n\n![logo](./img/logo.png)');
    const plan = resolveConfluenceSyncPlan({
      folder: tmp,
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
    });
    const localPlan = validateLocalSync(
      [
        {
          segments: ['page.md'],
          absolute: join(tmp, 'page.md'),
        },
      ],
      plan,
    );
    expect(localPlan.entries).toHaveLength(1);
    const entryPlan = localPlan.entries[0];
    expect(entryPlan?.hasLocalImages).toBe(true);
    expect(entryPlan?.attachments).toHaveLength(1);
    const att = entryPlan?.attachments[0];
    expect(att?.filename).toMatch(/^logo-[0-9a-f]{16}\.png$/);
    expect(att?.src).toBe('./img/logo.png');
  });

  it('exposes validateAttachmentSources standalone for local preflight with no client', () => {
    const html = '<p>x</p><ac:image data-local-src="missing.png"></ac:image>';
    expect(() =>
      validateAttachmentSources(html, {
        markdownDir: tmp,
        allowedRoot: tmp,
      }),
    ).toThrowError(/not found|escapes|regular file/i);
  });

  it('dry-run validates locally without credentials or a client', async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), 'rt-cfarc03-dry-outside-'));
    try {
      await mkdir(join(tmp, 'img'), { recursive: true });
      await writeFile(join(outsideDir, 'secret.png'), Buffer.from([1]));
      await symlink(join(outsideDir, 'secret.png'), join(tmp, 'img', 'secret.png'));
      await writeFile(join(tmp, 'page.md'), '![logo](./img/secret.png)');

      // No `client`, no credentials — dry-run must still run the same local
      // validation plan and reject with LocalSyncValidationAggregateError.
      await expect(
        syncConfluenceToDocs({
          folder: tmp,
          dryRun: true,
          log: () => {},
        } as ConfluenceSyncOptions),
      ).rejects.toBeInstanceOf(LocalSyncValidationAggregateError);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('dry-run with valid docs logs the per-entry plan and makes zero API calls even when a client is supplied', async () => {
    await mkdir(join(tmp, 'img'));
    await writeFile(join(tmp, 'img', 'logo.png'), Buffer.from([1, 2, 3]));
    await writeFile(join(tmp, 'page.md'), '# Page\n\n![logo](./img/logo.png)\n\n```mermaid\ngraph TD\nA-->B\n```');
    const logSpy = vi.fn();
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });

    await syncConfluenceToDocs({
      folder: tmp,
      dryRun: true,
      // Credentials are accepted but MUST NOT be required and not be used.
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
      client: client,
      log: logSpy,
    } as ConfluenceSyncOptions);

    expect(calls).toHaveLength(0);
    expect(logSpy.mock.calls.some((c) => /\[dry-run\] Walking documentation tree only./.test(c[0]))).toBe(true);
    const planLine = logSpy.mock.calls.map((c) => c[0]).find((m) => /would sync page\.md/.test(m));
    expect(planLine).toBeDefined();
    // The same per-entry plan that a real sync would consume — including the
    // validated attachment count and parsed mermaid block count.
    expect(planLine).toMatch(/1 attachment validated/);
    expect(planLine).toMatch(/1 mermaid block/);
  });

  it('reports changes, the failing entry, and remaining unprocessed work when a remote failure aborts mid-loop', async () => {
    // Three valid docs: doc-a (no attachments → createEntry one-POST path),
    // doc-b (no attachments → createEntry fails on updatePage), doc-c (would
    // also be created; remaining unprocessed when doc-b aborts). To force
    // doc-b to fail mid-mutation, we set up an existing page for doc-b so the
    // flow hits updatePage, then stub updatePage to throw the second time.
    await writeFile(join(tmp, 'a.md'), '# A');
    await writeFile(join(tmp, 'b.md'), '# B');
    await writeFile(join(tmp, 'c.md'), '# C');
    const logSpy = vi.fn();
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [pageFixture('P-B', 'b', 1, '<h1>STALE B</h1>', '123')],
    });

    let updateCount = 0;
    const originalUpdate = client.updatePage.bind(client);
    client.updatePage = async (input: {
      id: string;
      title: string;
      body: { value: string };
      version: { number: number };
    }): Promise<Page> => {
      updateCount += 1;
      if (updateCount === 1) {
        throw new Error('server 500 during updatePage');
      }
      return originalUpdate(input);
    };

    let thrown: unknown;
    try {
      await syncConfluenceToDocs({
        folder: tmp,
        username: 'u',
        apiToken: 't',
        baseUrl: 'https://x/wiki',
        spaceKey: 'ENG',
        parentPageId: '123',
        client: client,
        log: logSpy,
      } as ConfluenceSyncOptions);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SyncMutationError);
    const syncErr = thrown as SyncMutationError;

    // Criterion 2: changed pages/attachments are reported.
    expect(calls.some((c) => c.method === 'createPage')).toBe(true);

    // doc-a was created with its final body (no attachments) — recorded as kind:'created'.
    const createTitles = calls
      .filter((c) => c.method === 'createPage')
      .map((c) => (c.args[0] as { title: string }).title);
    expect(createTitles).toContain('a');
    const docAChange = syncErr.changes.find((ch: SyncChange) => ch.entry.segments.join('/').startsWith('a'));
    expect(docAChange).toBeDefined();
    expect(docAChange?.kind).toBe('created');
    expect(typeof docAChange?.pageId).toBe('string');

    // The failing entry (doc-b) is captured on `failure` with the underlying error message intact.
    expect(syncErr.failure.entry.segments.join('/')).toBe('b.md');
    expect(syncErr.failure.error.message).toMatch(/server 500 during updatePage/);

    // Remaining entries (doc-c) are reported as unprocessed.
    expect(syncErr.unprocessed.map((e) => e.segments.join('/'))).toEqual(['c.md']);

    // SyncMutationError carries the underlying message so existing .toThrowError(/regex/) keep matching.
    expect(syncErr.message).toMatch(/server 500 during updatePage/);
  });

  it('reports a typed gateway fake via `client` without `unknown as` at the call site', async () => {
    // CFARC-04 criterion: tests inject fakes without `unknown as`.
    // buildFakeClient already returns `ConfluenceGateway`; this test pins the
    // contract by flowing a typed fake end-to-end through syncConfluenceToDocs.
    await writeFile(join(tmp, 'a.md'), '# A');
    await writeFile(join(tmp, 'b.md'), '# B');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });

    const result = await syncConfluenceToDocs({
      folder: tmp,
      spaceKey: 'ENG',
      parentPageId: '123',
      client,
      log: () => {},
    });

    // The typed fake ran the full remote path: getSpaceIdByKey + two creates.
    const methods = calls.map((c) => c.method);
    expect(methods).toContain('getSpaceIdByKey');
    expect(methods.filter((m) => m === 'createPage')).toHaveLength(2);
    // Returned SyncResult.changes enumerates every created page.
    expect(result).toBeDefined();
    const changes = (result as { changes?: SyncChange[] }).changes ?? [];
    expect(changes.map((c) => c.entry.segments.join('/')).sort()).toEqual(['a.md', 'b.md']);
    expect(changes.every((c) => c.kind === 'created')).toBe(true);
  });

  it('rejects a missing spaceKey/parentPageId even when a client is supplied', async () => {
    // spaceKey and parentPageId are sync-target inputs that even a custom
    // gateway cannot derive — they must remain required without --dry-run.
    await writeFile(join(tmp, 'a.md'), '# A');
    const { client } = buildFakeClient({ spaceId: 'SPACE' });

    await expect(
      syncConfluenceToDocs({
        folder: tmp,
        parentPageId: '123',
        client,
        log: () => {},
      } as ConfluenceSyncOptions),
    ).rejects.toThrowError(/spaceKey is required/);

    await expect(
      syncConfluenceToDocs({
        folder: tmp,
        spaceKey: 'ENG',
        client,
        log: () => {},
      } as ConfluenceSyncOptions),
    ).rejects.toThrowError(/parentPageId is required/);
  });

  it('CFARC-04: a supplied gateway works without username/apiToken/baseUrl (no dummy credentials)', async () => {
    // The supported-contract criterion: a custom client replaces the
    // credentials/baseUrl requirement entirely. No username/apiToken/baseUrl
    // are supplied, and the sync still runs against the typed fake.
    await mkdir(join(tmp, 'guide'));
    await writeFile(join(tmp, 'guide', 'intro.md'), '# Intro');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });

    await syncConfluenceToDocs({
      folder: tmp,
      spaceKey: 'ENG',
      parentPageId: '123',
      client,
      log: () => {},
      // No username / apiToken / baseUrl supplied — the gateway replaces them.
    } as ConfluenceSyncOptions);

    const methods = calls.map((c) => c.method);
    expect(methods).toContain('getSpaceIdByKey');
    expect(methods).toContain('createPage');
    const createTitles = calls
      .filter((c) => c.method === 'createPage')
      .map((c) => (c.args[0] as { title: string }).title);
    expect(createTitles).toContain('guide');
    expect(createTitles).toContain('intro');
  });

  it('CFARC-04: resolveConfluenceSyncPlan skips credential/baseUrl checks when a client is supplied', () => {
    // The plan-resolver alone (no sync) must accept the credentials-free shape.
    const plan = resolveConfluenceSyncPlan({
      folder: tmp,
      spaceKey: 'ENG',
      parentPageId: '123',
      client: buildFakeClient({ spaceId: 'SPACE' }).client,
    });
    expect(plan.username).toBe('');
    expect(plan.apiToken).toBe('');
    expect(plan.baseUrl).toBe('');
    expect(plan.spaceKey).toBe('ENG');
    expect(plan.parentPageId).toBe('123');

    // ...but still requires username/apiToken/baseUrl when no client is given.
    expect(() =>
      resolveConfluenceSyncPlan({
        folder: tmp,
        spaceKey: 'ENG',
        parentPageId: '123',
      } as ConfluenceSyncOptions),
    ).toThrowError(/username is required/);
  });
});

describe('CFARC-04: public declarations expose only intentional package contracts', () => {
  // Runtime values exported from the root barrel. TypeScript-only re-exports
  // (interfaces, type aliases) are not enumerable via `Object.keys` and are
  // asserted separately against `dist/index.d.ts`.
  const SUPPORTED_RUNTIME_EXPORTS = new Set([
    // sync orchestrator + plan
    'syncConfluenceToDocs',
    'resolveConfluenceSyncPlan',
    'resolveSyncPlan',
    'LocalSyncValidationAggregateError',
    'SyncMutationError',
    'validateLocalSync',
    'INTERACTIVE_FLAG',
    // gateway + client
    'ConfluenceClient',
    'ConfluenceApiError',
    // doc-tree + markdown
    'readDocTree',
    'titleFromSegment',
    'isMarkdownName',
    'markdownToStorage',
    'isAllowedUrl',
    'isRemoteUrl',
    'escapeXmlAttribute',
    'escapeAttachmentFilename',
    // attachments + mermaid
    'rewriteImagesToAttachments',
    'preflightImagesToAttachments',
    'validateAttachmentSources',
    'rewriteMermaidBlocks',
    'preflightMermaidBlocks',
  ]);

  // Type-only declarations exported from the root barrel. Asserted against the
  // generated `dist/index.d.ts` so the type surface and the runtime surface
  // agree on the supported contract.
  const SUPPORTED_TYPE_EXPORTS = new Set([
    'ConfluenceSyncOptions',
    'ConfluenceSyncPlan',
    'LocalSyncEntryPlan',
    'LocalSyncPlan',
    'LocalSyncValidationError',
    'SyncChange',
    'SyncFailure',
    'SyncResult',
    'ConfluenceGateway',
    'AttachmentGateway',
    'ConfluenceClientOptions',
    'Page',
    'Attachment',
    'PageBody',
    'PageVersion',
    'CreatePageInput',
    'UpdatePageInput',
    'DocEntry',
    'DocTree',
    'MermaidBlock',
    'MarkdownConvertResult',
    'MarkdownConvertOptions',
    'RewriteResult',
    'RewriteOptions',
    'AttachmentPreflightResult',
    'ValidatedAttachmentSource',
    'MermaidRewriteResult',
    'MermaidRewriteOptions',
    'MermaidPreflightResult',
  ]);

  // Implementation internals that must NOT be re-exported from the root API.
  const UNSUPPORTED_RUNTIME_EXPORTS = [
    'LOCAL_IMAGE_PLACEHOLDER_RE',
    'renderInline',
    'renderHtmlBlock',
    'renderCodeBlock',
    'renderMermaidPlaceholder',
    'mermaidPlaceholderRe',
    'escapeHtml',
    'collectLocalImagePaths',
    'resolveDocRelative',
    'parseFlags',
    'resolveCliOptions',
    'isPlainObject',
  ];

  // Implementation-internal type/regex helpers that must not appear in the
  // generated type declarations either.
  const UNSUPPORTED_TYPE_EXPORTS = [
    'LOCAL_IMAGE_PLACEHOLDER_RE',
    'renderInline',
    'renderHtmlBlock',
    'renderCodeBlock',
    'renderMermaidPlaceholder',
    'mermaidPlaceholderRe',
    'escapeHtml',
    'collectLocalImagePaths',
    'resolveDocRelative',
    'resolveCliOptions',
    'isPlainObject',
  ];

  it('does not re-export implementation regexes or low-level renderer helpers at runtime', async () => {
    const mod = await import('../src/index');
    const exportedKeys = new Set(Object.keys(mod));
    for (const name of UNSUPPORTED_RUNTIME_EXPORTS) {
      expect(exportedKeys.has(name)).toBe(false);
    }
  });

  it('re-exports the supported runtime contracts (values + classes + consts)', async () => {
    const mod = await import('../src/index');
    const exportedKeys = new Set(Object.keys(mod));
    const missing: string[] = [];
    const extra: string[] = [];
    for (const name of SUPPORTED_RUNTIME_EXPORTS) {
      if (!exportedKeys.has(name)) {
        missing.push(name);
      }
    }
    for (const name of exportedKeys) {
      if (!SUPPORTED_RUNTIME_EXPORTS.has(name)) {
        extra.push(name);
      }
    }
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
  });

  it('exposes the supported type contracts in dist/index.d.ts', async () => {
    let dts: string;
    try {
      dts = await readFile(DIST_INDEX_DTS, 'utf8');
    } catch {
      // dist may not be built in a fresh checkout; skip the type-surface
      // assertion when the declarations file is absent. The runtime-surface
      // tests above still pass and `pnpm build` emits the d.ts in CI.
      console.warn(`CFARC-04: skipping type-surface assertion — ${DIST_INDEX_DTS} not present (run \`pnpm build\`).`);
      return;
    }
    for (const name of SUPPORTED_TYPE_EXPORTS) {
      // `export type { X }` or `export { type X }` or `export interface X` /
      // `export declare class X` — match the identifier anywhere in the d.ts.
      const re = new RegExp(`\\b${name}\\b`);
      expect(re.test(dts)).toBe(true);
    }
    for (const name of UNSUPPORTED_TYPE_EXPORTS) {
      const re = new RegExp(`\\b${name}\\b`);
      expect(re.test(dts)).toBe(false);
    }
  });
});
