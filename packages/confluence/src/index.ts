import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { parseFlags, type FlagSpec, resolveCliOptions, isPlainObject } from '@repo-toolkit/publish-package';
export { parseFlags, type FlagSpec, resolveCliOptions, isPlainObject };

import { ConfluenceClient, ConfluenceApiError } from './confluence-client';
export { ConfluenceClient, ConfluenceApiError };
export type { ConfluenceClientOptions, Page, Attachment, PageBody, PageVersion } from './confluence-client';

import { readDocTree, titleFromSegment, isMarkdownName, type DocEntry } from './files';
export { readDocTree, titleFromSegment, isMarkdownName };
export type { DocEntry, DocTree } from './files';

import {
  markdownToStorage,
  escapeAttachmentFilename,
  escapeXmlAttribute,
  isRemoteUrl,
  LOCAL_IMAGE_PLACEHOLDER_RE,
  renderInline,
} from './markdown';
export {
  markdownToStorage,
  escapeAttachmentFilename,
  escapeXmlAttribute,
  isRemoteUrl,
  LOCAL_IMAGE_PLACEHOLDER_RE,
  renderInline,
};
export type { MermaidBlock, MarkdownConvertResult } from './markdown';

import { rewriteImagesToAttachments } from './attachments';
export { rewriteImagesToAttachments };

import { rewriteMermaidBlocks } from './mermaid';
export { rewriteMermaidBlocks };
export type { MermaidRewriteResult, MermaidRewriteOptions } from './mermaid';

export const INTERACTIVE_FLAG: FlagSpec = { name: 'interactive', aliases: ['i'], boolean: true };

export interface ConfluenceSyncOptions {
  /** Documentation root folder (relative to `cwd`, or absolute). Required. */
  folder?: string;
  /** Confluence username or email. Required. */
  username?: string;
  /** Confluence API token (NOT account password). Required. */
  apiToken?: string;
  /** Confluence base URL ending with `/wiki`, e.g. `https://mydomain.atlassian.net/wiki`. Required. */
  baseUrl?: string;
  /** Confluence space key (e.g. `ENG` or `~1234`). Required; resolved to a spaceId via the API. */
  spaceKey?: string;
  /** Numeric Confluence page id of the parent under which docs will be published. Required. */
  parentPageId?: string;
  /** Working directory. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Version-message suffix appended to every page/attachment PUT. */
  versionMessage?: string;
  /** Skip uploads that would have no markdown changes (default: true). */
  skipUnchanged?: boolean;
  /** Dry-run: walk the tree and print the plan but make no API calls. */
  dryRun?: boolean;
  /** Custom Confluence client instance (testing). When supplied, `username`/`apiToken`/`baseUrl` are ignored. */
  client?: ConfluenceClient;
  /** Logger sink; defaults to `console`. */
  log?: (message: string) => void;
}

export interface ConfluenceSyncPlan {
  cwd: string;
  folder: string;
  username: string;
  apiToken: string;
  baseUrl: string;
  spaceKey: string;
  parentPageId: string;
  versionMessage: string;
  skipUnchanged: boolean;
  dryRun: boolean;
}

export function resolveConfluenceSyncPlan(options: ConfluenceSyncOptions = {}): ConfluenceSyncPlan {
  const cwd = resolve(options.cwd ?? process.cwd());
  const folder = resolveInputPath(cwd, options.folder ?? '');
  if (!options.folder) {
    throw new Error('folder is required');
  }
  if (!options.dryRun) {
    if (!options.username) {
      throw new Error('username is required');
    }
    if (!options.apiToken) {
      throw new Error('apiToken is required');
    }
    if (!options.baseUrl) {
      throw new Error('baseUrl is required');
    }
    if (!options.spaceKey) {
      throw new Error('spaceKey is required');
    }
    if (!options.parentPageId) {
      throw new Error('parentPageId is required');
    }
    if (!/^[0-9]+$/.test(options.parentPageId)) {
      throw new Error(`parentPageId must be numeric, got: ${options.parentPageId}`);
    }
  }

  return {
    cwd,
    folder,
    username: options.username ?? '',
    apiToken: options.apiToken ?? '',
    baseUrl: options.baseUrl ?? '',
    spaceKey: options.spaceKey ?? '',
    parentPageId: options.parentPageId ?? '',
    versionMessage: options.versionMessage ?? 'Synced via repo-toolkit-confluence',
    skipUnchanged: options.skipUnchanged ?? true,
    dryRun: options.dryRun ?? false,
  };
}

export async function syncConfluenceToDocs(options: ConfluenceSyncOptions = {}): Promise<void> {
  const plan = resolveConfluenceSyncPlan(options);
  const log = options.log ?? ((msg: string) => console.log(msg));

  if (plan.dryRun) {
    log('[dry-run] Walking documentation tree only.');
  }

  const tree = await readDocTree(plan.folder);
  if (tree.entries.length === 0) {
    log(`No markdown files found under ${plan.folder}`);
    return;
  }

  if (plan.dryRun) {
    for (const entry of tree.entries) {
      log(`[dry-run] would sync ${entry.segments.join('/')}`);
    }
    return;
  }

  const client =
    options.client ??
    new ConfluenceClient({
      baseUrl: plan.baseUrl,
      username: plan.username,
      apiToken: plan.apiToken,
    });

  const spaceId = await client.getSpaceIdByKey(plan.spaceKey);
  const cache = new PageTitleCache(spaceId, client);

  for (const entry of tree.entries) {
    await syncEntry(entry, plan, client, cache, log);
  }
}

async function syncEntry(
  entry: DocEntry,
  plan: ConfluenceSyncPlan,
  client: ConfluenceClient,
  cache: PageTitleCache,
  log: (message: string) => void,
): Promise<void> {
  const segments = entry.segments;
  if (segments.length === 0) {
    return;
  }

  let currentParentId = plan.parentPageId;

  for (let idx = 0; idx < segments.length; idx += 1) {
    const isLast = idx === segments.length - 1;
    const segment = segments[idx] ?? '';

    if (isLast && isMarkdownName(segment)) {
      const title = titleFromSegment(segment);
      const page = await cache.findOrCreate(title, currentParentId);
      const pageId = page.id;

      const markdown = readFileSync(entry.absolute, 'utf8');
      const { html, mermaidBlocks } = markdownToStorage(markdown);

      const markdownDir = dirname(entry.absolute);
      let body = html;
      if (mermaidBlocks.length > 0) {
        const mermaidResult = await rewriteMermaidBlocks(body, mermaidBlocks, pageId, client);
        body = mermaidResult.html;
        if (mermaidResult.fallbacks.length > 0) {
          log(
            `mermaid: ${mermaidResult.fallbacks.length} block(s) not rendered (mmdc unavailable or failed); emitted as code macros`,
          );
        }
      }
      LOCAL_IMAGE_PLACEHOLDER_RE.lastIndex = 0;
      if (LOCAL_IMAGE_PLACEHOLDER_RE.test(body)) {
        const result = await rewriteImagesToAttachments(body, pageId, client, { markdownDir });
        body = result.html;
      }

      const current = await client.getPage(pageId);
      const currentBody = current.body?.storage?.value ?? '';
      const nextVersion = (current.version?.number ?? 0) + 1;

      if (plan.skipUnchanged && currentBody === body) {
        log(`unchanged: ${segments.join('/')} (page ${pageId})`);
        return;
      }

      await client.updatePage({
        id: pageId,
        title,
        body: { representation: 'storage', value: body },
        version: { number: nextVersion, message: plan.versionMessage },
      });

      log(`updated: ${segments.join('/')} (page ${pageId}, v${nextVersion})`);
      return;
    }

    if (isMarkdownName(segment)) {
      const title = titleFromSegment(segment);
      const page = await cache.findOrCreate(title, currentParentId);
      currentParentId = page.id;
      continue;
    }

    const page = await cache.findOrCreate(segment, currentParentId);
    currentParentId = page.id;
  }
}

class PageTitleCache {
  private readonly cache = new Map<string, { id: string }>();
  private readonly spaceId: string;
  private readonly client: ConfluenceClient;

  constructor(spaceId: string, client: ConfluenceClient) {
    this.spaceId = spaceId;
    this.client = client;
  }

  async findOrCreate(title: string, parentId: string): Promise<{ id: string }> {
    const key = `${parentId}::${title}`;
    const existing = this.cache.get(key);
    if (existing) {
      return existing;
    }

    let page = await this.client.getPageByTitle(this.spaceId, title);
    if (!page) {
      page = await this.client.createPage({
        spaceId: this.spaceId,
        title,
        parentId,
        body: { representation: 'storage', value: '' },
      });
    }

    const result = { id: page.id };
    this.cache.set(key, result);
    return result;
  }
}

function resolveInputPath(baseDir: string, inputPath: string): string {
  if (isAbsolute(inputPath)) {
    return inputPath;
  }
  return resolve(baseDir, inputPath);
}

export { resolveConfluenceSyncPlan as resolveSyncPlan };
