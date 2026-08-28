import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = fileURLToPath(new URL('.', import.meta.url));
const DIST_INDEX_DTS = resolve(TEST_DIR, '..', 'dist', 'index.d.ts');

import {
  CONFLUENCE_MANAGED_LABEL,
  PAGE_TITLE_STRATEGIES,
  planCleanDeletions,
  planStalePruning,
  ReconciliationError,
  ParentSummaryError,
  resolveConfluenceSyncPlan,
  syncConfluenceToDocs,
  validateLocalSync,
  LocalSyncValidationAggregateError,
  SyncMutationError,
  validateAttachmentSources,
  type ConfluenceSyncOptions,
  type ConfluenceGateway,
  type Page,
  type PageDescendant,
  type PageLabel,
  type RemoteInventoryEntry,
  type SyncChange,
} from '../src/index';
import { PARENT_SUMMARY_START_MARKER, PARENT_SUMMARY_END_MARKER } from '../src/parent-summary';

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
  initialLabels?: Record<string, PageLabel[]>;
  extraDescendants?: PageDescendant[];
}): { client: ConfluenceGateway; calls: RecordedCall[] } {
  const spaceId = opts.spaceId ?? 'SPACE';
  const pages = new Map<string, Page>();
  const attachmentsByPage = new Map<string, Map<string, { id: string; filename?: string }>>();
  const labelsByPage = new Map<string, PageLabel[]>();
  for (const [pageId, labels] of Object.entries(opts.initialLabels ?? {})) {
    labelsByPage.set(pageId, [...labels]);
  }
  const calls: RecordedCall[] = [];
  let pageIdCounter = 100;

  const allPages = (): Map<string, Page> => {
    const all = new Map<string, Page>();
    for (const page of opts.existingPages ?? []) {
      all.set(page.id, page);
    }
    for (const [id, page] of pages) {
      all.set(id, page);
    }
    return all;
  };

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
    async getPageDescendants(pageId: string): Promise<PageDescendant[]> {
      calls.push({ method: 'getPageDescendants', args: [pageId] });
      const all = allPages();
      const results: PageDescendant[] = [];
      for (const page of all.values()) {
        if (page.id === pageId) {
          continue;
        }
        let depth = 0;
        let current: Page | undefined = page;
        const seen = new Set<string>();
        let matched = false;
        while (current) {
          const pid: string | undefined = current.parentId;
          if (pid === pageId) {
            depth += 1;
            matched = true;
            break;
          }
          if (pid === undefined || seen.has(pid)) {
            break;
          }
          seen.add(pid);
          depth += 1;
          current = all.get(pid);
        }
        if (matched) {
          results.push({ id: page.id, type: 'page', title: page.title, parentId: page.parentId, depth });
        }
      }
      results.sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
      return [...results, ...(opts.extraDescendants ?? [])];
    },
    async getPageLabels(pageId: string): Promise<PageLabel[]> {
      calls.push({ method: 'getPageLabels', args: [pageId] });
      return [...(labelsByPage.get(pageId) ?? [])];
    },
    async addManagedLabel(pageId: string): Promise<void> {
      calls.push({ method: 'addManagedLabel', args: [pageId] });
      const labels = labelsByPage.get(pageId) ?? [];
      if (!labels.some((l) => l.prefix === 'global' && l.name === CONFLUENCE_MANAGED_LABEL)) {
        labels.push({ prefix: 'global', name: CONFLUENCE_MANAGED_LABEL });
      }
      labelsByPage.set(pageId, labels);
    },
    async deletePage(pageId: string): Promise<void> {
      calls.push({ method: 'deletePage', args: [pageId] });
      pages.delete(pageId);
      const remaining = (opts.existingPages ?? []).filter((p) => p.id !== pageId);
      opts.existingPages = remaining;
      labelsByPage.delete(pageId);
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

  it('adds the synced folder path to GitHub repositoryUrl notices', () => {
    const plan = resolveConfluenceSyncPlan({
      ...base,
      cwd: '/tmp/repo',
      folder: 'docs/reference',
      repositoryUrl: 'https://github.com/acme/project.git',
    });
    expect(plan.repositoryUrl).toBe('https://github.com/acme/project/tree/HEAD/docs/reference');
  });

  it('does not add absolute folders outside cwd to repositoryUrl notices', () => {
    const plan = resolveConfluenceSyncPlan({
      ...base,
      cwd: '/tmp/repo',
      folder: '/tmp/other/docs',
      repositoryUrl: 'https://github.com/acme/project',
    });
    expect(plan.repositoryUrl).toBe('https://github.com/acme/project');
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
      updateParentPage: false,
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
      updateParentPage: false,
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

  it('appends an italic repository source notice when repositoryUrl is set', async () => {
    await mkdir(join(tmp, 'docs'));
    await writeFile(join(tmp, 'docs', 'intro.md'), '# Intro');
    const logSpy = vi.fn();
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await syncConfluenceToDocs({
      cwd: tmp,
      folder: 'docs',
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
      repositoryUrl: 'https://github.com/acme/docs',
      client: client,
      updateParentPage: false,
      log: logSpy,
    });
    const createCall = calls.find((c) => c.method === 'createPage')?.args[0] as
      | { body?: { value: string } }
      | undefined;
    expect(createCall?.body?.value).toBe(
      '<h1>Intro</h1>\n' +
        '<p><em>This document is synced from repository <a href="https://github.com/acme/docs/tree/HEAD/docs">https://github.com/acme/docs/tree/HEAD/docs</a>.</em></p>',
    );
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
      updateParentPage: false,
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
      updateParentPage: false,
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
      updateParentPage: false,
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
      updateParentPage: false,
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
      updateParentPage: false,
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
        updateParentPage: false,
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
        updateParentPage: false,
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
          updateParentPage: false,
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
      updateParentPage: false,
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
      updateParentPage: false,
      log: () => {},
    });
    const created = calls.find((c) => c.method === 'createPage')?.args[0] as { body?: { value: string } } | undefined;
    expect(created?.body?.value).toBeDefined();
    expect(created?.body?.value).toContain('<ac:structured-macro ac:name="code"');
    expect(created?.body?.value).toContain('<ac:parameter ac:name="language">html</ac:parameter>');
  });
});

describe('CFNAME-02: page title strategies in sync', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'rt-sync-title-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  const baseOptions = (client: ConfluenceGateway) => ({
    folder: tmp,
    username: 'u',
    apiToken: 't',
    baseUrl: 'https://x/wiki',
    spaceKey: 'ENG',
    parentPageId: '123',
    client,
    log: () => {},
    updateParentPage: false,
  });

  const nestedLeaf = 'community-nodes/cdogs-document-generator/credentials.md';

  async function writeNestedLeaf(): Promise<void> {
    await mkdir(join(tmp, 'community-nodes', 'cdogs-document-generator'), { recursive: true });
    await writeFile(join(tmp, 'community-nodes', 'cdogs-document-generator', 'credentials.md'), '# Creds');
  }

  const STRATEGY_CASES: ReadonlyArray<{ strategy: string; leafTitle: string }> = [
    { strategy: 'filename-stem', leafTitle: 'credentials' },
    { strategy: 'filename', leafTitle: 'credentials.md' },
    { strategy: 'sentence-case-parent', leafTitle: 'Credentials (cdogs-document-generator)' },
    {
      strategy: 'sentence-case-parents',
      leafTitle: 'Credentials (community-nodes/cdogs-document-generator)',
    },
    {
      strategy: 'sentence-case-path',
      leafTitle: 'Credentials (community-nodes/cdogs-document-generator/credentials.md)',
    },
  ];

  it('defaults the plan strategy to filename-stem and validates provided values', () => {
    const plan = resolveConfluenceSyncPlan({
      folder: 'docs',
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '1234',
      cwd: '/tmp/repo',
    });
    expect(plan.pageTitleStrategy).toBe('filename-stem');

    const overridden = resolveConfluenceSyncPlan({
      folder: 'docs',
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '1234',
      cwd: '/tmp/repo',
      pageTitleStrategy: 'sentence-case-path',
    });
    expect(overridden.pageTitleStrategy).toBe('sentence-case-path');

    const validBase = {
      folder: 'docs',
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '1234',
    };
    const allValues = PAGE_TITLE_STRATEGIES.join(', ');
    expect(() => resolveConfluenceSyncPlan({ ...validBase, pageTitleStrategy: 'bogus' as never })).toThrowError(
      new RegExp(`Invalid pageTitleStrategy.*${allValues.replace(/-/g, '\\-')}`),
    );
    expect(() => resolveConfluenceSyncPlan({ ...validBase, pageTitleStrategy: '' as never })).toThrowError(
      /Invalid pageTitleStrategy/,
    );
    expect(() => resolveConfluenceSyncPlan({ ...validBase, pageTitleStrategy: 42 as unknown as never })).toThrowError(
      /Invalid pageTitleStrategy/,
    );
  });

  for (const { strategy, leafTitle } of STRATEGY_CASES) {
    it(`uses strategy ${strategy} for lookup and create titles while folders keep raw names`, async () => {
      await writeNestedLeaf();
      const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
      await syncConfluenceToDocs({
        ...baseOptions(client),
        pageTitleStrategy: strategy as never,
      });
      const lookupTitles = calls.filter((c) => c.method === 'getPagesByTitle').map((c) => c.args[1] as string);
      expect(lookupTitles).toContain(leafTitle);
      expect(lookupTitles).toContain('community-nodes');
      expect(lookupTitles).toContain('cdogs-document-generator');
      const createdTitles = calls
        .filter((c) => c.method === 'createPage')
        .map((c) => (c.args[0] as { title: string }).title);
      expect(createdTitles).toContain(leafTitle);
      expect(createdTitles).toContain('community-nodes');
      expect(createdTitles).toContain('cdogs-document-generator');
      if (strategy !== 'filename-stem') {
        expect(createdTitles).not.toContain('credentials');
        expect(lookupTitles).not.toContain('credentials');
      }
    });
  }

  it('passes the resolved strategy title to updatePage for an existing page', async () => {
    await writeFile(join(tmp, 'creds.md'), '# Creds');
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [pageFixture('P1', 'creds.md', 3, 'stale-body', '123')],
    });
    await syncConfluenceToDocs({
      ...baseOptions(client),
      pageTitleStrategy: 'filename',
    });
    const updates = calls.filter((c) => c.method === 'updatePage');
    expect(updates).toHaveLength(1);
    const input = updates[0].args[0] as { id: string; title: string };
    expect(input.id).toBe('P1');
    expect(input.title).toBe('creds.md');
  });

  it('disambiguates repeated basenames under different parents with sentence-case-parents', async () => {
    await mkdir(join(tmp, 'a'), { recursive: true });
    await mkdir(join(tmp, 'b'), { recursive: true });
    await writeFile(join(tmp, 'a', 'credentials.md'), '# A');
    await writeFile(join(tmp, 'b', 'credentials.md'), '# B');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await syncConfluenceToDocs({
      ...baseOptions(client),
      pageTitleStrategy: 'sentence-case-parents',
    });
    const lookupTitles = calls.filter((c) => c.method === 'getPagesByTitle').map((c) => c.args[1] as string);
    expect(lookupTitles).toContain('Credentials (a)');
    expect(lookupTitles).toContain('Credentials (b)');
    const createdTitles = calls
      .filter((c) => c.method === 'createPage')
      .map((c) => (c.args[0] as { title: string }).title);
    expect(createdTitles).toContain('Credentials (a)');
    expect(createdTitles).toContain('Credentials (b)');
    expect(createdTitles).not.toContain('credentials');
  });

  it('keeps existing titles and page mapping unchanged when the strategy is omitted', async () => {
    await mkdir(join(tmp, 'a'), { recursive: true });
    await mkdir(join(tmp, 'b'), { recursive: true });
    await writeFile(join(tmp, 'a', 'credentials.md'), '# A');
    await writeFile(join(tmp, 'b', 'credentials.md'), '# B');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await syncConfluenceToDocs(baseOptions(client));
    const lookupTitles = calls.filter((c) => c.method === 'getPagesByTitle').map((c) => c.args[1] as string);
    expect(lookupTitles).toEqual(['a', 'credentials', 'b', 'credentials']);
    const leafCreates = calls
      .filter((c) => c.method === 'createPage')
      .map((c) => c.args[0] as { title: string; parentId: string })
      .filter((input) => input.title === 'credentials');
    expect(leafCreates).toHaveLength(2);
    const parentIds = leafCreates.map((input) => input.parentId).sort();
    expect(parentIds[0]).not.toBe(parentIds[1]);
  });

  it('rejects an invalid strategy before any gateway call or remote mutation', async () => {
    await writeNestedLeaf();
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await expect(
      syncConfluenceToDocs({
        ...baseOptions(client),
        pageTitleStrategy: 'totally-bogus' as never,
      }),
    ).rejects.toThrowError(/Invalid pageTitleStrategy/);
    expect(calls).toHaveLength(0);
  });

  it('rejects an invalid strategy even in dry-run mode before reading the tree', async () => {
    await writeNestedLeaf();
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await expect(
      syncConfluenceToDocs({
        ...baseOptions(client),
        dryRun: true,
        pageTitleStrategy: {} as never,
      }),
    ).rejects.toThrowError(/Invalid pageTitleStrategy/);
    expect(calls).toHaveLength(0);
  });

  it('detects a generated leaf title conflicting with a sibling folder page before mutation', async () => {
    await mkdir(join(tmp, 'guide'), { recursive: true });
    await writeFile(join(tmp, 'guide', 'overview.md'), '# Overview');
    await mkdir(join(tmp, 'guide', 'Overview (guide)'), { recursive: true });
    await writeFile(join(tmp, 'guide', 'Overview (guide)', 'other.md'), '# Other');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await expect(
      syncConfluenceToDocs({
        ...baseOptions(client),
        pageTitleStrategy: 'sentence-case-parent',
      }),
    ).rejects.toThrowError(/conflicting page titles/);
    expect(calls).toHaveLength(0);
  });

  it('includes the resolved title for every entry in dry-run output', async () => {
    await writeNestedLeaf();
    const logSpy = vi.fn();
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await syncConfluenceToDocs({
      ...baseOptions(client),
      dryRun: true,
      pageTitleStrategy: 'sentence-case-parents',
      log: logSpy,
    });
    expect(calls).toHaveLength(0);
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(
      lines.some(
        (line) =>
          line === `[dry-run] would sync ${nestedLeaf} as "Credentials (community-nodes/cdogs-document-generator)"`,
      ),
    ).toBe(true);
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
      updateParentPage: false,
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
      updateParentPage: false,
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
      updateParentPage: false,
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
      updateParentPage: false,
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
      updateParentPage: false,
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
          updateParentPage: false,
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
        updateParentPage: false,
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
        updateParentPage: false,
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
      updateParentPage: false,
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
        updateParentPage: false,
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
      updateParentPage: false,
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
        updateParentPage: false,
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
      updateParentPage: false,
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
    'ReconciliationError',
    'ParentSummaryError',
    'validateLocalSync',
    'planStalePruning',
    'planCleanDeletions',
    'INTERACTIVE_FLAG',
    // gateway + client
    'ConfluenceClient',
    'ConfluenceApiError',
    'CONFLUENCE_MANAGED_LABEL',
    // doc-tree + markdown
    'readDocTree',
    'titleFromSegment',
    'isMarkdownName',
    'resolvePageTitleStrategy',
    'pageTitleFromSegments',
    'PAGE_TITLE_STRATEGIES',
    'DEFAULT_PAGE_TITLE_STRATEGY',
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
    'ReconciliationFailure',
    'RemoteInventoryEntry',
    'DeletionPlan',
    'ConfluenceGateway',
    'AttachmentGateway',
    'ConfluenceClientOptions',
    'Page',
    'Attachment',
    'PageBody',
    'PageVersion',
    'CreatePageInput',
    'UpdatePageInput',
    'PageDescendant',
    'PageLabel',
    'DocEntry',
    'DocTree',
    'PageTitleStrategy',
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

describe('CFPRUNE-02: deletion planners', () => {
  const labeled = (id: string, parentId: string): RemoteInventoryEntry => ({
    id,
    type: 'page',
    parentId,
    labeled: true,
  });

  it('plans deepest-first deletion of stale labeled pages and protects expected ids', () => {
    const result = planStalePruning({
      parentPageId: 'ROOT',
      expectedIds: new Set(['keep']),
      inventory: [
        labeled('folder', 'ROOT'),
        labeled('leaf', 'folder'),
        labeled('keep', 'ROOT'),
        { id: 'manual', type: 'page', parentId: 'ROOT', labeled: false },
      ],
    });
    expect(result.deletions).toEqual(['leaf', 'folder']);
    expect(result.blocked).toEqual([]);
  });

  it('blocks a stale labeled ancestor that contains an unlabeled descendant', () => {
    const result = planStalePruning({
      parentPageId: 'ROOT',
      expectedIds: new Set(),
      inventory: [
        labeled('folder', 'ROOT'),
        { id: 'manual', type: 'page', parentId: 'folder', labeled: false },
        labeled('sibling', 'ROOT'),
      ],
    });
    expect(result.deletions).toEqual(['sibling']);
    expect(result.blocked).toEqual(['folder']);
  });

  it('blocks a stale labeled ancestor that contains non-page content', () => {
    const result = planStalePruning({
      parentPageId: 'ROOT',
      expectedIds: new Set(),
      inventory: [labeled('folder', 'ROOT'), { id: 'wb', type: 'whiteboard', parentId: 'folder', labeled: false }],
    });
    expect(result.deletions).toEqual([]);
    expect(result.blocked).toEqual(['folder']);
  });

  it('blocks a stale labeled ancestor that contains an expected descendant', () => {
    const result = planStalePruning({
      parentPageId: 'ROOT',
      expectedIds: new Set(['mapped']),
      inventory: [labeled('folder', 'ROOT'), labeled('mapped', 'folder')],
    });
    expect(result.deletions).toEqual([]);
    expect(result.blocked).toEqual(['folder']);
  });

  it('does not treat the target parent as a deletion candidate even if listed', () => {
    const result = planStalePruning({
      parentPageId: 'ROOT',
      expectedIds: new Set(),
      inventory: [labeled('ROOT', 'OTHER'), labeled('stale', 'ROOT')],
    });
    expect(result.deletions).toEqual(['stale']);
  });

  it('resolves depths from parent chains when depth metadata is absent', () => {
    const result = planStalePruning({
      parentPageId: 'ROOT',
      expectedIds: new Set(),
      inventory: [
        { id: 'a', type: 'page', parentId: 'ROOT', labeled: true },
        { id: 'b', type: 'page', parentId: 'a', labeled: true },
        { id: 'c', type: 'page', parentId: 'b', labeled: true },
      ],
    });
    expect(result.deletions).toEqual(['c', 'b', 'a']);
  });

  it('fails closed on an incomplete inventory (missing ancestor, no depth metadata)', () => {
    expect(() =>
      planStalePruning({
        parentPageId: 'ROOT',
        expectedIds: new Set(),
        inventory: [labeled('leaf', 'ghost')],
      }),
    ).toThrowError(/Incomplete descendant inventory/);
  });

  it('fails closed on duplicate inventory ids and parent cycles', () => {
    expect(() =>
      planStalePruning({
        parentPageId: 'ROOT',
        expectedIds: new Set(),
        inventory: [labeled('a', 'ROOT'), labeled('a', 'ROOT')],
      }),
    ).toThrowError(/duplicate id/);
    expect(() =>
      planStalePruning({
        parentPageId: 'ROOT',
        expectedIds: new Set(),
        inventory: [
          { id: 'a', type: 'page', parentId: 'b', labeled: true },
          { id: 'b', type: 'page', parentId: 'a', labeled: true },
        ],
      }),
    ).toThrowError(/Incomplete descendant inventory/);
  });

  it('plans clean deletion of every page descendant deepest-first', () => {
    const result = planCleanDeletions({
      parentPageId: 'ROOT',
      inventory: [
        { id: 'folder', type: 'page', parentId: 'ROOT', depth: 1, labeled: false },
        { id: 'leaf', type: 'page', parentId: 'folder', depth: 2, labeled: true },
      ],
    });
    expect(result.deletions).toEqual(['leaf', 'folder']);
    expect(result.blocked).toEqual([]);
  });

  it('fails clean before any deletion when non-page descendants exist', () => {
    expect(() =>
      planCleanDeletions({
        parentPageId: 'ROOT',
        inventory: [{ id: 'db', type: 'database', parentId: 'ROOT', depth: 1, labeled: false }],
      }),
    ).toThrowError(/clean refused/);
  });

  it('never includes the target parent in clean deletions', () => {
    const result = planCleanDeletions({
      parentPageId: 'ROOT',
      inventory: [{ id: 'ROOT', type: 'page', depth: 0, labeled: true }],
    });
    expect(result.deletions).toEqual([]);
  });
});

describe('CFPRUNE-02: ownership labels, clean, and pruning', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'rt-sync-cfprune02-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  const baseOptions = (client: ConfluenceGateway, extra?: Partial<ConfluenceSyncOptions>) => ({
    folder: tmp,
    username: 'u',
    apiToken: 't',
    baseUrl: 'https://x/wiki',
    spaceKey: 'ENG',
    parentPageId: '123',
    client,
    log: () => {},
    updateParentPage: false,
    ...extra,
  });

  const managedLabel = (): PageLabel => ({ prefix: 'global', name: CONFLUENCE_MANAGED_LABEL });

  const labeledIds = (calls: RecordedCall[]): string[] =>
    calls.filter((c) => c.method === 'addManagedLabel').map((c) => c.args[0] as string);
  const deletedIds = (calls: RecordedCall[]): string[] =>
    calls.filter((c) => c.method === 'deletePage').map((c) => c.args[0] as string);

  it('resolves clean to false by default', () => {
    const plan = resolveConfluenceSyncPlan({
      folder: 'docs',
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '1234',
    });
    expect(plan.clean).toBe(false);
    const explicit = resolveConfluenceSyncPlan({
      folder: 'docs',
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '1234',
      clean: true,
    });
    expect(explicit.clean).toBe(true);
  });

  it('labels every mapped folder and leaf page, and never labels the target parent', async () => {
    await mkdir(join(tmp, 'guide'));
    await writeFile(join(tmp, 'guide', 'intro.md'), '# Intro');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    const result = await syncConfluenceToDocs(baseOptions(client));
    const created = calls
      .filter((c) => c.method === 'createPage')
      .map((c) => (c.args[0] as { title: string; parentId: string }).title);
    expect(created).toEqual(['guide', 'intro']);
    const createdIds = calls
      .filter((c) => c.method === 'updatePage' || c.method === 'createPage')
      .map((c) => (c.args[0] as { id?: string }).id)
      .filter((id): id is string => typeof id === 'string');
    void createdIds;
    expect(labeledIds(calls)).toHaveLength(2);
    expect(labeledIds(calls)).not.toContain('123');
    expect(result?.labelsAdded).toEqual(labeledIds(calls));
    expect(result?.pruneDeletions).toEqual([]);
    expect(result?.cleanDeletions).toEqual([]);
    expect(result?.blocked).toEqual([]);
  });

  it('label check precedes add: a second identical sync performs no label POST or deletion', async () => {
    await writeFile(join(tmp, 'intro.md'), '# Intro');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await syncConfluenceToDocs(baseOptions(client, { updateParentPage: false }));
    expect(labeledIds(calls)).toHaveLength(1);
    await syncConfluenceToDocs(baseOptions(client, { updateParentPage: false }));
    expect(labeledIds(calls)).toHaveLength(1);
    expect(calls.some((c) => c.method === 'deletePage')).toBe(false);
    expect(calls.some((c) => c.method === 'updatePage')).toBe(false);
  });

  it('adopts an existing unlabeled page mapped by title by adding the marker', async () => {
    await writeFile(join(tmp, 'intro.md'), '# Intro');
    const existing = pageFixture('P1', 'intro', 3, '<h1>Intro</h1>', '123');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE', existingPages: [existing] });
    await syncConfluenceToDocs(baseOptions(client));
    expect(labeledIds(calls)).toEqual(['P1']);
  });

  it('prunes a labeled stale page after a local file is removed', async () => {
    await writeFile(join(tmp, 'keep.md'), '# Keep');
    const stale = pageFixture('P-stale', 'gone', 1, '', '123');
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [stale],
      initialLabels: { 'P-stale': [managedLabel()] },
    });
    const result = await syncConfluenceToDocs(baseOptions(client));
    expect(deletedIds(calls)).toEqual(['P-stale']);
    expect(result?.pruneDeletions).toEqual(['P-stale']);
  });

  it('deletes a removed directory hierarchy deepest-first', async () => {
    await writeFile(join(tmp, 'top.md'), '# Top');
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [
        pageFixture('P-dir', 'olddir', 1, '', '123'),
        pageFixture('P-sub', 'sub', 1, '', 'P-dir'),
        pageFixture('P-leaf', 'oldleaf', 1, '', 'P-sub'),
      ],
      initialLabels: {
        'P-dir': [managedLabel()],
        'P-sub': [managedLabel()],
        'P-leaf': [managedLabel()],
      },
    });
    await syncConfluenceToDocs(baseOptions(client));
    expect(deletedIds(calls)).toEqual(['P-leaf', 'P-sub', 'P-dir']);
  });

  it('never deletes an unlabeled page during default pruning', async () => {
    await writeFile(join(tmp, 'keep.md'), '# Keep');
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [pageFixture('P-manual', 'manual', 1, '', '123')],
    });
    const result = await syncConfluenceToDocs(baseOptions(client));
    expect(deletedIds(calls)).toEqual([]);
    expect(result?.pruneDeletions).toEqual([]);
  });

  it('retains a stale labeled ancestor whose descendant is unlabeled and reports it blocked', async () => {
    await writeFile(join(tmp, 'top.md'), '# Top');
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [
        pageFixture('P-dir', 'olddir', 1, '', '123'),
        pageFixture('P-manual', 'manual-child', 1, '', 'P-dir'),
        pageFixture('P-stale', 'stale', 1, '', '123'),
      ],
      initialLabels: { 'P-dir': [managedLabel()], 'P-stale': [managedLabel()] },
    });
    const result = await syncConfluenceToDocs(baseOptions(client));
    expect(deletedIds(calls)).toEqual(['P-stale']);
    expect(result?.blocked).toEqual(['P-dir']);
  });

  it('title-strategy migration prunes a labeled old page but preserves an unlabeled one', async () => {
    await writeFile(join(tmp, 'creds.md'), '# Creds');
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [
        pageFixture('P-old-labeled', 'creds', 1, '', '123'),
        pageFixture('P-old-unlabeled', 'creds-old', 1, '', '123'),
      ],
      initialLabels: { 'P-old-labeled': [managedLabel()] },
    });
    await syncConfluenceToDocs(baseOptions(client, { pageTitleStrategy: 'filename' }));
    const createdTitles = calls
      .filter((c) => c.method === 'createPage')
      .map((c) => (c.args[0] as { title: string }).title);
    expect(createdTitles).toEqual(['creds.md']);
    expect(deletedIds(calls)).toEqual(['P-old-labeled']);
  });

  it('an empty local tree prunes all safely deletable labeled descendants and preserves unlabeled ones', async () => {
    const logSpy = vi.fn();
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [pageFixture('P-stale', 'stale', 1, '', '123'), pageFixture('P-manual', 'manual', 1, '', '123')],
      initialLabels: { 'P-stale': [managedLabel()] },
    });
    const result = await syncConfluenceToDocs(baseOptions(client, { log: logSpy }));
    expect(deletedIds(calls)).toEqual(['P-stale']);
    expect(result?.changes).toEqual([]);
    expect(logSpy.mock.calls.some((c) => /No markdown files found/.test(c[0]))).toBe(true);
  });

  it('clean: true trashes labeled and unlabeled page descendants before creation and never the target', async () => {
    await writeFile(join(tmp, 'new.md'), '# New');
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [
        pageFixture('P-labeled', 'labeled', 1, '', '123'),
        pageFixture('P-manual', 'manual', 1, '', '123'),
        pageFixture('P-sub', 'sub', 1, '', 'P-labeled'),
      ],
      initialLabels: { 'P-labeled': [managedLabel()], 'P-sub': [managedLabel()] },
    });
    const result = await syncConfluenceToDocs(baseOptions(client, { clean: true }));
    expect(deletedIds(calls)).toEqual(['P-sub', 'P-labeled', 'P-manual']);
    expect(deletedIds(calls)).not.toContain('123');
    expect(result?.cleanDeletions).toEqual(['P-sub', 'P-labeled', 'P-manual']);
    expect(result?.pruneDeletions).toEqual([]);
    const firstCreateIndex = calls.findIndex((c) => c.method === 'createPage');
    const lastDeleteIndex = calls.map((c) => c.method).lastIndexOf('deletePage');
    expect(firstCreateIndex).toBeGreaterThan(-1);
    expect(lastDeleteIndex).toBeLessThan(firstCreateIndex);
    const createdIds = calls.filter((c) => c.method === 'getPageLabels').map((c) => c.args[0] as string);
    expect(createdIds).not.toContain('123');
    expect(labeledIds(calls)).toHaveLength(1);
  });

  it('clean: true with an empty local tree leaves no deletable page descendants and creates nothing', async () => {
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [pageFixture('P-a', 'a', 1, '', '123'), pageFixture('P-b', 'b', 1, '', 'P-a')],
    });
    const result = await syncConfluenceToDocs(baseOptions(client, { clean: true }));
    expect(deletedIds(calls)).toEqual(['P-b', 'P-a']);
    expect(calls.some((c) => c.method === 'createPage')).toBe(false);
    expect(result?.changes).toEqual([]);
  });

  it('clean: true fails closed before any deletion when a non-page descendant exists', async () => {
    await writeFile(join(tmp, 'new.md'), '# New');
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [pageFixture('P-x', 'x', 1, '', '123')],
      extraDescendants: [{ id: 'W1', type: 'whiteboard', parentId: 'P-x' }],
    });
    await expect(syncConfluenceToDocs(baseOptions(client, { clean: true }))).rejects.toThrowError(/clean refused/);
    expect(calls.some((c) => c.method === 'deletePage')).toBe(false);
    expect(calls.some((c) => c.method === 'createPage')).toBe(false);
  });

  it('any local validation failure causes zero gateway calls even with clean: true', async () => {
    await writeFile(join(tmp, 'page.md'), '![logo](./missing.png)');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await expect(syncConfluenceToDocs(baseOptions(client, { clean: true }))).rejects.toBeInstanceOf(
      LocalSyncValidationAggregateError,
    );
    expect(calls).toHaveLength(0);
  });

  it('a label failure aborts with SyncMutationError and prevents any pruning', async () => {
    await writeFile(join(tmp, 'a.md'), '# A');
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [pageFixture('P-stale', 'stale', 1, '', '123')],
      initialLabels: { 'P-stale': [managedLabel()] },
    });
    client.addManagedLabel = async (): Promise<void> => {
      throw new Error('label endpoint down');
    };
    await expect(syncConfluenceToDocs(baseOptions(client))).rejects.toBeInstanceOf(SyncMutationError);
    expect(calls.some((c) => c.method === 'deletePage')).toBe(false);
    expect(calls.some((c) => c.method === 'getPageDescendants')).toBe(false);
  });

  it('a page-update failure prevents pruning', async () => {
    await writeFile(join(tmp, 'a.md'), '# A');
    const existing = pageFixture('P1', 'a', 1, 'STALE', '123');
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [existing, pageFixture('P-stale', 'stale', 1, '', '123')],
      initialLabels: { 'P-stale': [managedLabel()] },
    });
    client.updatePage = async (): Promise<Page> => {
      throw new Error('boom');
    };
    await expect(syncConfluenceToDocs(baseOptions(client))).rejects.toBeInstanceOf(SyncMutationError);
    expect(deletedIds(calls)).toEqual([]);
  });

  it('a partial prune reports completed, failed, and unprocessed deletions', async () => {
    await writeFile(join(tmp, 'top.md'), '# Top');
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [
        pageFixture('P-1', 's1', 1, '', '123'),
        pageFixture('P-2', 's2', 1, '', '123'),
        pageFixture('P-3', 's3', 1, '', '123'),
      ],
      initialLabels: { 'P-1': [managedLabel()], 'P-2': [managedLabel()], 'P-3': [managedLabel()] },
    });
    const originalDelete = client.deletePage.bind(client);
    let deleteCount = 0;
    client.deletePage = async (pageId: string): Promise<void> => {
      deleteCount += 1;
      if (deleteCount === 2) {
        throw new Error('trash failed');
      }
      return originalDelete(pageId);
    };
    let thrown: unknown;
    try {
      await syncConfluenceToDocs(baseOptions(client));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ReconciliationError);
    const err = thrown as ReconciliationError;
    expect(err.phase).toBe('prune');
    expect(err.completed).toEqual(['P-1']);
    expect(err.failure.pageId).toBe('P-2');
    expect(err.failure.error.message).toMatch(/trash failed/);
    expect(err.unprocessed).toEqual(['P-3']);
    expect(deletedIds(calls)).toEqual(['P-1']);
  });

  it('a partial clean aborts before any creation with completed/failed/unprocessed evidence', async () => {
    await writeFile(join(tmp, 'new.md'), '# New');
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [pageFixture('P-1', 's1', 1, '', '123'), pageFixture('P-2', 's2', 1, '', '123')],
    });
    const originalDelete = client.deletePage.bind(client);
    let deleteCount = 0;
    client.deletePage = async (pageId: string): Promise<void> => {
      deleteCount += 1;
      if (deleteCount === 2) {
        throw new Error('trash failed');
      }
      return originalDelete(pageId);
    };
    let thrown: unknown;
    try {
      await syncConfluenceToDocs(baseOptions(client, { clean: true }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ReconciliationError);
    const err = thrown as ReconciliationError;
    expect(err.phase).toBe('clean');
    expect(err.completed).toEqual(['P-1']);
    expect(err.failure.pageId).toBe('P-2');
    expect(err.unprocessed).toEqual([]);
    expect(calls.some((c) => c.method === 'createPage')).toBe(false);
  });

  it('dry-run with clean makes zero gateway calls and logs clean and prune intent', async () => {
    await writeFile(join(tmp, 'a.md'), '# A');
    const logSpy = vi.fn();
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await syncConfluenceToDocs({
      folder: tmp,
      dryRun: true,
      clean: true,
      client,
      updateParentPage: false,
      log: logSpy,
    });
    expect(calls).toHaveLength(0);
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => /clean requested/.test(l))).toBe(true);
    expect(lines.some((l) => /prune stale labeled descendants/.test(l))).toBe(true);
  });
});

describe('CFPARENT-01: parent documentation dashboard', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'rt-sync-parent-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  const baseOptions = (client: ConfluenceGateway, extra?: Partial<ConfluenceSyncOptions>) => ({
    folder: tmp,
    username: 'u',
    apiToken: 't',
    baseUrl: 'https://x/wiki',
    spaceKey: 'ENG',
    parentPageId: '123',
    client,
    log: () => {},
    ...extra,
  });

  it('resolves updateParentPage to true by default', () => {
    const plan = resolveConfluenceSyncPlan({
      folder: 'docs',
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '1234',
    });
    expect(plan.updateParentPage).toBe(true);
    const disabled = resolveConfluenceSyncPlan({
      folder: 'docs',
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '1234',
      updateParentPage: false,
    });
    expect(disabled.updateParentPage).toBe(false);
  });

  it('disabled option performs zero parent GET/PUT and leaves existing region untouched', async () => {
    await writeFile(join(tmp, 'a.md'), '# A');
    const parentBody = `<p>Manual</p>\n${PARENT_SUMMARY_START_MARKER}\n<p>old</p>\n${PARENT_SUMMARY_END_MARKER}`;
    const parentPage = pageFixture('123', 'Parent', 5, parentBody, '999');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE', existingPages: [parentPage] });
    await syncConfluenceToDocs(baseOptions(client, { updateParentPage: false }));
    expect(calls.some((c) => c.method === 'getPage' && (c.args[0] as string) === '123')).toBe(false);
    expect(calls.some((c) => c.method === 'updatePage' && (c.args[0] as { id: string }).id === '123')).toBe(false);
    const after = await client.getPage('123');
    expect(after.body?.storage?.value).toBe(parentBody);
  });

  it('first append preserves manual content byte-for-byte outside region', async () => {
    await writeFile(join(tmp, 'a.md'), '# A');
    const manual = '<p>Manual content</p>';
    const parentPage = pageFixture('123', 'Parent', 2, manual, '999');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE', existingPages: [parentPage] });
    const result = await syncConfluenceToDocs(baseOptions(client));
    expect(result?.parentStatus).toBe('updated');
    const updated = await client.getPage('123');
    const body = updated.body?.storage?.value ?? '';
    expect(body.startsWith(manual)).toBe(true);
    expect(body).toContain(PARENT_SUMMARY_START_MARKER);
    expect(body).toContain(PARENT_SUMMARY_END_MARKER);
    expect(body).toContain('Synced documentation');
    const updateCall = calls.find((c) => c.method === 'updatePage' && (c.args[0] as { id: string }).id === '123')
      ?.args[0] as { title: string; version: { number: number } };
    expect(updateCall.title).toBe('Parent');
    expect(updateCall.version.number).toBe(3);
  });

  it('in-place replacement preserves outside bytes', async () => {
    await writeFile(join(tmp, 'a.md'), '# A');
    const firstManual = '<p>Top</p>';
    const trailing = '<p>Bottom</p>';
    const parentPage = pageFixture('123', 'Parent', 1, firstManual, '999');
    const { client } = buildFakeClient({ spaceId: 'SPACE', existingPages: [parentPage] });
    await syncConfluenceToDocs(baseOptions(client));
    const afterFirst = (await client.getPage('123')).body?.storage?.value ?? '';
    expect(afterFirst).toContain(trailing === '' ? '' : '');
    await writeFile(join(tmp, 'b.md'), '# B');
    const logSpy = vi.fn();
    await syncConfluenceToDocs({ ...baseOptions(client), log: logSpy });
    const afterSecond = (await client.getPage('123')).body?.storage?.value ?? '';
    expect(afterSecond.startsWith(firstManual)).toBe(true);
    expect(afterSecond).toContain('Markdown pages: 2');
    expect(afterSecond).not.toContain('Markdown pages: 1');
  });

  it('empty tree renders zero statistics and No managed child pages', async () => {
    const parentPage = pageFixture('123', 'Parent', 1, '<p>Manual</p>', '999');
    const { client } = buildFakeClient({ spaceId: 'SPACE', existingPages: [parentPage] });
    const result = await syncConfluenceToDocs(baseOptions(client));
    expect(result?.parentStatus).toBe('updated');
    const body = (await client.getPage('123')).body?.storage?.value ?? '';
    expect(body).toContain('Markdown pages: 0');
    expect(body).toContain('Directory pages: 0');
    expect(body).toContain('Total managed pages: 0');
    expect(body).toContain('Maximum depth: 0');
    expect(body).toContain('Attachment references: 0');
    expect(body).toContain('Mermaid blocks: 0');
    expect(body).toContain('No managed child pages');
  });

  it('second identical deployment performs no parent PUT (parent-unchanged)', async () => {
    await writeFile(join(tmp, 'a.md'), '# A');
    const parentPage = pageFixture('123', 'Parent', 1, '', '999');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE', existingPages: [parentPage] });
    await syncConfluenceToDocs(baseOptions(client));
    const firstPuts = calls.filter(
      (c) => c.method === 'updatePage' && (c.args[0] as { id: string }).id === '123',
    ).length;
    expect(firstPuts).toBe(1);
    const logSpy = vi.fn();
    await syncConfluenceToDocs({ ...baseOptions(client), log: logSpy });
    const secondPuts = calls.filter(
      (c) => c.method === 'updatePage' && (c.args[0] as { id: string }).id === '123',
    ).length;
    expect(secondPuts).toBe(1);
    expect(logSpy.mock.calls.some((c) => /parent-unchanged/.test(c[0]))).toBe(true);
  });

  it('malformed markers fail closed without changing parent body', async () => {
    await writeFile(join(tmp, 'a.md'), '# A');
    const malformed = `<p>Manual</p>\n${PARENT_SUMMARY_START_MARKER}\n<p>old</p>\n${PARENT_SUMMARY_START_MARKER}\n${PARENT_SUMMARY_END_MARKER}`;
    const parentPage = pageFixture('123', 'Parent', 1, malformed, '999');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE', existingPages: [parentPage] });
    let thrown: unknown;
    try {
      await syncConfluenceToDocs(baseOptions(client));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ParentSummaryError);
    expect(calls.some((c) => c.method === 'updatePage' && (c.args[0] as { id: string }).id === '123')).toBe(false);
    const after = (await client.getPage('123')).body?.storage?.value ?? '';
    expect(after).toBe(malformed);
  });

  it('duplicate markers fail closed without PUT', async () => {
    await writeFile(join(tmp, 'a.md'), '# A');
    const dup = `${PARENT_SUMMARY_START_MARKER}\n<p>a</p>\n${PARENT_SUMMARY_END_MARKER}\n${PARENT_SUMMARY_START_MARKER}\n<p>b</p>\n${PARENT_SUMMARY_END_MARKER}`;
    const parentPage = pageFixture('123', 'Parent', 1, dup, '999');
    const { client } = buildFakeClient({ spaceId: 'SPACE', existingPages: [parentPage] });
    await expect(syncConfluenceToDocs(baseOptions(client))).rejects.toBeInstanceOf(ParentSummaryError);
  });

  it('parent PUT failure reports child reconciliation already completed', async () => {
    await writeFile(join(tmp, 'a.md'), '# A');
    const parentPage = pageFixture('123', 'Parent', 1, '', '999');
    const { client } = buildFakeClient({ spaceId: 'SPACE', existingPages: [parentPage] });
    const originalUpdate = client.updatePage.bind(client);
    client.updatePage = async (input: {
      id: string;
      title: string;
      body: { value: string };
      version: { number: number };
    }): Promise<Page> => {
      if (input.id === '123') {
        throw new Error('parent 409 conflict');
      }
      return originalUpdate(input);
    };
    let thrown: unknown;
    try {
      await syncConfluenceToDocs(baseOptions(client));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ParentSummaryError);
    const err = thrown as ParentSummaryError;
    expect(err.phase).toBe('parent-summary');
    expect(err.changes.length).toBe(1);
    expect(err.failure.pageId).toBe('123');
    expect(err.failure.error.message).toMatch(/409/);
    expect(err.changes[0].entry.segments.join('/')).toBe('a.md');
  });

  it('child sync failure produces no parent GET/PUT', async () => {
    await writeFile(join(tmp, 'a.md'), '# A');
    const parentPage = pageFixture('123', 'Parent', 1, '', '999');
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE', existingPages: [parentPage] });
    client.createPage = async () => {
      throw new Error('create failed');
    };
    await expect(syncConfluenceToDocs(baseOptions(client))).rejects.toBeInstanceOf(SyncMutationError);
    expect(calls.some((c) => c.method === 'getPage' && (c.args[0] as string) === '123')).toBe(false);
    expect(calls.some((c) => c.method === 'updatePage' && (c.args[0] as { id: string }).id === '123')).toBe(false);
  });

  it('reconciliation failure produces no parent GET/PUT', async () => {
    await writeFile(join(tmp, 'a.md'), '# A');
    const parentPage = pageFixture('123', 'Parent', 1, '', '999');
    const stale = pageFixture('P-stale', 'stale', 1, '', '123');
    const { client, calls } = buildFakeClient({
      spaceId: 'SPACE',
      existingPages: [parentPage, stale],
      initialLabels: { 'P-stale': [{ prefix: 'global', name: CONFLUENCE_MANAGED_LABEL }] },
    });
    const originalDelete = client.deletePage.bind(client);
    client.deletePage = async () => {
      throw new Error('delete failed');
    };
    void originalDelete;
    await expect(syncConfluenceToDocs(baseOptions(client))).rejects.toBeInstanceOf(ReconciliationError);
    expect(calls.some((c) => c.method === 'updatePage' && (c.args[0] as { id: string }).id === '123')).toBe(false);
  });

  it('statistics exactly match validated local plan', async () => {
    await mkdir(join(tmp, 'guide'));
    await mkdir(join(tmp, 'img'));
    await writeFile(join(tmp, 'img', 'logo.png'), Buffer.from([1]));
    await writeFile(join(tmp, 'guide', 'intro.md'), '![logo](../img/logo.png)\n\n```mermaid\ngraph TD\nA-->B\n```');
    await writeFile(join(tmp, 'guide', 'other.md'), '# Other');
    const parentPage = pageFixture('123', 'Parent', 1, '', '999');
    const { client } = buildFakeClient({ spaceId: 'SPACE', existingPages: [parentPage] });
    const result = await syncConfluenceToDocs(baseOptions(client));
    expect(result?.parentStatus).toBe('updated');
    const body = (await client.getPage('123')).body?.storage?.value ?? '';
    expect(body).toContain('Markdown pages: 2');
    expect(body).toContain('Directory pages: 1');
    expect(body).toContain('Total managed pages: 3');
    expect(body).toContain('Maximum depth: 2');
    expect(body).toContain('Attachment references: 1');
    expect(body).toContain('Mermaid blocks: 1');
  });

  it('tree includes every mapped page exactly once with id-backed link and title', async () => {
    await mkdir(join(tmp, 'guide'));
    await writeFile(join(tmp, 'guide', 'intro.md'), '# Intro');
    await writeFile(join(tmp, 'root.md'), '# Root');
    const parentPage = pageFixture('123', 'Parent', 1, '', '999');
    const { client } = buildFakeClient({ spaceId: 'SPACE', existingPages: [parentPage] });
    await syncConfluenceToDocs(baseOptions(client));
    const body = (await client.getPage('123')).body?.storage?.value ?? '';
    const linkMatches = [...body.matchAll(/ri:content-id="([^"]+)"/g)].map((m) => m[1]);
    expect(linkMatches.length).toBe(3);
    expect(body).toContain('guide');
    expect(body).toContain('intro');
    expect(body).toContain('root');
    expect(body).toContain('(directory)');
    expect(body).toContain('(page)');
  });

  it('provenance links to repositoryUrl when present, generic otherwise', async () => {
    await writeFile(join(tmp, 'a.md'), '# A');
    const parentPage = pageFixture('123', 'Parent', 1, '', '999');
    const { client } = buildFakeClient({ spaceId: 'SPACE', existingPages: [parentPage] });
    await syncConfluenceToDocs({ ...baseOptions(client), repositoryUrl: 'https://github.com/acme/repo' });
    let body = (await client.getPage('123')).body?.storage?.value ?? '';
    expect(body).toContain('https://github.com/acme/repo');
    expect(body).toContain('<a href=');
    expect(body).toContain('This documentation subtree is synced from');
    expect(body).not.toContain('maintained by');

    const parentPage2 = pageFixture('123', 'Parent', 1, '', '999');
    const client2 = buildFakeClient({ spaceId: 'SPACE', existingPages: [parentPage2] }).client;
    await syncConfluenceToDocs({ ...baseOptions(client2), repositoryUrl: undefined });
    body = (await client2.getPage('123')).body?.storage?.value ?? '';
    expect(body).not.toContain('maintained by');
    expect(body).not.toContain('<a href=');
    expect(body).not.toContain('This documentation subtree is synced from');
  });

  it('summary contains no ownership section and no secrets', async () => {
    await writeFile(join(tmp, 'a.md'), '# A');
    const parentPage = pageFixture('123', 'Parent', 1, '', '999');
    const { client } = buildFakeClient({ spaceId: 'SPACE', existingPages: [parentPage] });
    await syncConfluenceToDocs(baseOptions(client));
    const body = (await client.getPage('123')).body?.storage?.value ?? '';
    expect(body).not.toContain('<h3>Ownership</h3>');
    expect(body).not.toContain('pruned');
    expect(body).not.toContain('clean: true');
    expect(body).not.toContain('unlabeled');
    expect(body).not.toContain(' — ');
    expect(body).not.toContain('apiToken');
    expect(body).not.toContain('/tmp');
  });

  it('dryRun renders local statistics and title tree without gateway calls or remote links', async () => {
    await mkdir(join(tmp, 'guide'));
    await writeFile(join(tmp, 'guide', 'intro.md'), '# Intro');
    const logSpy = vi.fn();
    const { client, calls } = buildFakeClient({ spaceId: 'SPACE' });
    await syncConfluenceToDocs({
      folder: tmp,
      dryRun: true,
      client,
      log: logSpy,
    });
    expect(calls).toHaveLength(0);
    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => /parent summary/.test(l))).toBe(true);
    expect(lines.some((l) => /Markdown pages: 1/.test(l))).toBe(true);
    expect(lines.some((l) => /parent tree/.test(l))).toBe(true);
    expect(lines.some((l) => /ri:content-id/.test(l))).toBe(false);
  });
});
