import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

import { parseFlags, type FlagSpec, resolveCliOptions, isPlainObject } from '@repo-toolkit/publish-package';
export { parseFlags, type FlagSpec, resolveCliOptions, isPlainObject };

import { ConfluenceClient, ConfluenceApiError } from './confluence-client';
import type { Page } from './confluence-client';
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
  isAllowedUrl,
  LOCAL_IMAGE_PLACEHOLDER_RE,
  renderInline,
  renderHtmlBlock,
} from './markdown';
export {
  markdownToStorage,
  escapeAttachmentFilename,
  escapeXmlAttribute,
  isRemoteUrl,
  isAllowedUrl,
  LOCAL_IMAGE_PLACEHOLDER_RE,
  renderInline,
  renderHtmlBlock,
};
export type { MermaidBlock, MarkdownConvertResult, MarkdownConvertOptions } from './markdown';

import { rewriteImagesToAttachments, preflightImagesToAttachments, validateAttachmentSources } from './attachments';
import type { ValidatedAttachmentSource } from './attachments';
export { rewriteImagesToAttachments, preflightImagesToAttachments, validateAttachmentSources };
export type {
  RewriteResult,
  RewriteOptions,
  PreflightResult as AttachmentPreflightResult,
  ValidatedAttachmentSource,
} from './attachments';

import { rewriteMermaidBlocks, preflightMermaidBlocks } from './mermaid';
export { rewriteMermaidBlocks, preflightMermaidBlocks };
export type { MermaidRewriteResult, MermaidRewriteOptions, MermaidPreflightResult } from './mermaid';

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
  /**
   * Skip uploads that would have no markdown changes (default: true).
   *
   * When true, a second identical sync performs no page PUT, no attachment
   * mutation, and no Mermaid `mmdc` spawn: attachment and Mermaid names are
   * content-addressed (sha256 of the source), so detecting an unchanged body
   * produces byte-equal storage HTML to the current page body before any
   * render/upload work is performed.
   */
  skipUnchanged?: boolean;
  /** Render ```html fenced blocks as inline HTML via the Confluence `html` macro instead of a code box (default: false). */
  renderHtmlBlocks?: boolean;
  /**
   * Dry-run: walk the tree and validate every markdown file and local image
   * source (same preflight as a real sync) then print the plan, but make no
   * API mutation calls. Credentials are not required under `--dry-run`.
   */
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
  renderHtmlBlocks: boolean;
}

/** A single markdown entry's locally-validated sync plan. */
export interface LocalSyncEntryPlan {
  /** The original doc-tree entry this plan covers. */
  entry: DocEntry;
  /** Rendered storage HTML from `markdownToStorage` (placeholder macros intact). */
  html: string;
  /** Mermaid blocks parsed from the markdown source. */
  mermaidBlocks: ReadonlyArray<import('./markdown').MermaidBlock>;
  /** Markdown file's directory, used to resolve relative image src values. */
  markdownDir: string;
  /** Whether the rendered body contains any local-image placeholders (`<ac:image data-local-src>`). */
  hasLocalImages: boolean;
  /** Whether the rendered body contains any Mermaid placeholder macros. */
  hasMermaidBlocks: boolean;
  /**
   * Resolved content-addressed attachment sources for every local image
   * placeholder, validated (root confinement, regular file, size limits) by
   * the local preflight pass. Empty when the body has no local images.
   */
  attachments: ReadonlyArray<ValidatedAttachmentSource>;
}

/** Aggregate result of the local preflight pass over every doc-tree entry. */
export interface LocalSyncPlan {
  entries: ReadonlyArray<LocalSyncEntryPlan>;
}

/**
 * Structured report returned from {@link validateLocalSync}. Each defect names
 * the doc-tree path that failed and the error message the upload path would
 * have produced, so callers can fix local inputs without any remote mutation.
 */
export interface LocalSyncValidationError {
  entry: DocEntry;
  error: Error;
}

export class LocalSyncValidationAggregateError extends Error {
  readonly defects: ReadonlyArray<LocalSyncValidationError>;
  constructor(defects: ReadonlyArray<LocalSyncValidationError>) {
    const summary = defects.map((d) => `${d.entry.segments.join('/')}: ${d.error.message}`).join('; ');
    super(`Local sync validation failed for ${defects.length} document(s): ${summary}`);
    this.name = 'LocalSyncValidationAggregateError';
    this.defects = defects;
  }
}

/**
 * Pre-read the document tree, convert every Markdown file to storage HTML,
 * and validate every local image source (root confinement, regular file,
 * size limits) using the same {@link validateAttachmentSources} path that
 * {@link rewriteImagesToAttachments} applies at upload time.
 *
 * Runs against local files only — no client, no network, and no API mutation.
 * Throws {@link LocalSyncValidationAggregateError} listing every defect so a
 * caller can fix all local inputs in one pass instead of failing entry by
 * entry after orphan pages or partial uploads have already occurred.
 */
export function validateLocalSync(entries: ReadonlyArray<DocEntry>, plan: ConfluenceSyncPlan): LocalSyncPlan {
  const defects: LocalSyncValidationError[] = [];
  const plans: LocalSyncEntryPlan[] = [];

  for (const entry of entries) {
    try {
      const markdown = readFileSync(entry.absolute, 'utf8');
      const { html, mermaidBlocks } = markdownToStorage(markdown, {
        renderHtmlBlocks: plan.renderHtmlBlocks,
      });
      const markdownDir = dirname(entry.absolute);
      const hasLocalImages = hasLocalImagePlaceholder(html);
      const hasMermaidBlocks = mermaidBlocks.length > 0;
      const attachments = hasLocalImages
        ? validateAttachmentSources(html, {
            markdownDir,
            allowedRoot: plan.folder,
          })
        : [];
      plans.push({
        entry,
        html,
        mermaidBlocks,
        markdownDir,
        hasLocalImages,
        hasMermaidBlocks,
        attachments,
      });
    } catch (error) {
      defects.push({
        entry,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  if (defects.length > 0) {
    throw new LocalSyncValidationAggregateError(defects);
  }

  return { entries: plans };
}

/** A page successfully created or updated during the remote mutation phase. */
export interface SyncChange {
  /** Doc-tree entry that was synced. */
  entry: DocEntry;
  /** Confluence page id that was created or updated. */
  pageId: string;
  /** Outcome: `created` (page POSTed, optionally with final body), `updated` (page PUT), or `unchanged` (skipUnchanged no-op). */
  kind: 'created' | 'updated' | 'unchanged';
}

/** A single remote-mutation failure during the sync loop. */
export interface SyncFailure {
  /** Doc-tree entry that failed. */
  entry: DocEntry;
  /** Underlying error from the remote call. */
  error: Error;
}

/**
 * Structured partial-mutation report. Thrown when the remote mutation phase
 * fails after at least one page has been created/updated. Carries every
 * successful {@link SyncChange}, the {@link SyncFailure} that aborted the run,
 * and the doc-tree entries that remained unprocessed after the abort.
 *
 * The error message echoes the underlying failure message so existing
 * `.rejects.toThrowError(/regex/)` assertions on remote errors keep matching.
 */
export class SyncMutationError extends Error {
  readonly changes: ReadonlyArray<SyncChange>;
  readonly failure: SyncFailure;
  readonly unprocessed: ReadonlyArray<DocEntry>;
  constructor(input: {
    changes: ReadonlyArray<SyncChange>;
    failure: SyncFailure;
    unprocessed: ReadonlyArray<DocEntry>;
  }) {
    super(input.failure.error.message);
    this.name = 'SyncMutationError';
    this.changes = input.changes;
    this.failure = input.failure;
    this.unprocessed = input.unprocessed;
  }
}

/** Result shape returned by {@link syncConfluenceToDocs}. `void` is preserved
 * for callers that ignore the return value; structured evidence is available
 * when a full run completes without error. */
export interface SyncResult {
  changes: ReadonlyArray<SyncChange>;
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
    renderHtmlBlocks: options.renderHtmlBlocks === true,
  };
}

export async function syncConfluenceToDocs(options: ConfluenceSyncOptions = {}): Promise<SyncResult | void> {
  const plan = resolveConfluenceSyncPlan(options);
  const log = options.log ?? ((msg: string) => console.log(msg));

  const tree = await readDocTree(plan.folder);
  if (tree.entries.length === 0) {
    log(`No markdown files found under ${plan.folder}`);
    return;
  }

  validateLocalHierarchy(tree.entries);

  const localPlan = validateLocalSync(tree.entries, plan);

  if (plan.dryRun) {
    log('[dry-run] Walking documentation tree only.');
    for (const entryPlan of localPlan.entries) {
      const attCount = entryPlan.attachments.length;
      const mermaidCount = entryPlan.mermaidBlocks.length;
      log(
        `[dry-run] would sync ${entryPlan.entry.segments.join('/')}` +
          (attCount > 0 ? ` (${attCount} attachment${attCount === 1 ? '' : 's'} validated)` : '') +
          (mermaidCount > 0 ? ` (${mermaidCount} mermaid block${mermaidCount === 1 ? '' : 's'})` : ''),
      );
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

  const changes: SyncChange[] = [];
  for (let i = 0; i < localPlan.entries.length; i += 1) {
    const entryPlan = localPlan.entries[i];
    try {
      await syncEntry(entryPlan, plan, client, cache, log, changes);
    } catch (error) {
      throw new SyncMutationError({
        changes,
        failure: { entry: entryPlan.entry, error: error instanceof Error ? error : new Error(String(error)) },
        unprocessed: localPlan.entries.slice(i + 1).map((p) => p.entry),
      });
    }
  }
  return { changes };
}

async function syncEntry(
  entryPlan: LocalSyncEntryPlan,
  plan: ConfluenceSyncPlan,
  client: ConfluenceClient,
  cache: PageTitleCache,
  log: (message: string) => void,
  changes: SyncChange[],
): Promise<void> {
  const { entry, html: precomputedHtml, mermaidBlocks, markdownDir, hasLocalImages, hasMermaidBlocks } = entryPlan;
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
      const leafNeedsUploads = hasLocalImages || hasMermaidBlocks;

      const existing = await cache.find(title, currentParentId);

      if (!existing && !leafNeedsUploads) {
        const pageId = await cache.createEntry({
          title,
          parentId: currentParentId,
          body: { representation: 'storage', value: precomputedHtml },
        });
        log(`created: ${segments.join('/')} (page ${pageId})`);
        changes.push({ entry, pageId, kind: 'created' });
        return;
      }

      const existingPage = existing ?? (await cache.findOrCreate(title, currentParentId));
      const pageId = existingPage.id;

      const current = await client.getPage(pageId);
      const currentBody = current.body?.storage?.value ?? '';

      let body = precomputedHtml;
      if (plan.skipUnchanged) {
        const predicted = await predictBody(precomputedHtml, mermaidBlocks, pageId, client, {
          markdownDir,
          allowedRoot: plan.folder,
          hasLocalImages,
          hasMermaidBlocks,
        });
        if (predicted !== null && predicted === currentBody) {
          log(`unchanged: ${segments.join('/')} (page ${pageId})`);
          changes.push({ entry, pageId, kind: 'unchanged' });
          return;
        }
      }

      if (hasMermaidBlocks) {
        const mermaidResult = await rewriteMermaidBlocks(body, [...mermaidBlocks], pageId, client);
        body = mermaidResult.html;
        if (mermaidResult.fallbacks.length > 0) {
          log(
            `mermaid: ${mermaidResult.fallbacks.length} block(s) not rendered (mmdc unavailable or failed); emitted as code macros`,
          );
        }
      }
      if (hasLocalImages) {
        const result = await rewriteImagesToAttachments(body, pageId, client, {
          markdownDir,
          allowedRoot: plan.folder,
        });
        body = result.html;
      }

      const nextVersion = (current.version?.number ?? 0) + 1;

      await client.updatePage({
        id: pageId,
        title,
        body: { representation: 'storage', value: body },
        version: { number: nextVersion, message: plan.versionMessage },
      });

      log(`updated: ${segments.join('/')} (page ${pageId}, v${nextVersion})`);
      changes.push({ entry, pageId, kind: 'updated' });
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

  async find(title: string, parentId: string): Promise<Page | undefined> {
    const key = `${parentId}::${title}`;
    const cached = this.cache.get(key);
    if (cached) {
      return undefined;
    }
    const matches = (await this.client.getPagesByTitle(this.spaceId, title)).filter(
      (page) => page.parentId === parentId,
    );
    if (matches.length > 1) {
      throw new Error(`Multiple Confluence pages matched title ${title} under parent ${parentId}`);
    }
    const found = matches[0];
    if (found) {
      this.cache.set(key, { id: found.id });
    }
    return found;
  }

  async createEntry(input: {
    title: string;
    parentId: string;
    body: { representation: 'storage'; value: string };
  }): Promise<string> {
    const created = await this.client.createPage({
      spaceId: this.spaceId,
      title: input.title,
      parentId: input.parentId,
      body: { representation: input.body.representation, value: input.body.value },
    });
    const pageId = created.id;
    this.cache.set(`${input.parentId}::${input.title}`, { id: pageId });
    return pageId;
  }

  async findOrCreate(title: string, parentId: string): Promise<{ id: string }> {
    const key = `${parentId}::${title}`;
    const existing = this.cache.get(key);
    if (existing) {
      return existing;
    }

    const matches = (await this.client.getPagesByTitle(this.spaceId, title)).filter(
      (page) => page.parentId === parentId,
    );

    let page = matches[0];
    if (matches.length > 1) {
      throw new Error(`Multiple Confluence pages matched title ${title} under parent ${parentId}`);
    }

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

function hasLocalImagePlaceholder(html: string): boolean {
  LOCAL_IMAGE_PLACEHOLDER_RE.lastIndex = 0;
  return LOCAL_IMAGE_PLACEHOLDER_RE.test(html);
}

interface PredictContext {
  markdownDir: string;
  allowedRoot: string;
  hasLocalImages: boolean;
  hasMermaidBlocks: boolean;
}

/**
 * Build the would-be body without performing any attachment upload, attachment
 * mutation, or `mmdc` spawn. Returns `null` when prediction is impossible (to
 * avoid false positives), e.g. when the rewrite options should be passed
 * through to the real rewrite path because data dependencies are unknown.
 *
 * - Preflight attachments replaces every `<ac:image data-local-src>` with the
 *   content-addressed `<ri:attachment>` macro for the deterministic
 *   `<stem>-<hash16>.<ext>` filename, validating root/size containment first
 *   (so a dry-validation pass before a PUT never relaxes the CFSEC-02
 *   boundary).
 * - Preflight mermaid replaces every `<ac:structured-macro ac:name="mermaid-placeholder">`
 *   with the content-addressed `mermaid-<hash16>.svg` macro when an existing
 *   attachment matches the source hash, or a `code` macro when `mmdc` would
 *   be unavailable; producing the same predicted HTML the real rewrite would.
 */
async function predictBody(
  html: string,
  mermaidBlocks: ReadonlyArray<import('./markdown').MermaidBlock>,
  pageId: string,
  client: ConfluenceClient,
  ctx: PredictContext,
): Promise<string | null> {
  let predicted = html;
  if (ctx.hasMermaidBlocks) {
    const preflight = await preflightMermaidBlocks(predicted, [...mermaidBlocks], pageId, client);
    if (preflight.pending.length > 0) {
      return null;
    }
    predicted = preflight.html;
  }
  if (ctx.hasLocalImages) {
    const preflight = await preflightImagesToAttachments(predicted, pageId, client, {
      markdownDir: ctx.markdownDir,
      allowedRoot: ctx.allowedRoot,
    });
    if (preflight.pending.length > 0) {
      return null;
    }
    predicted = preflight.html;
  }
  return predicted;
}

function validateLocalHierarchy(entries: ReadonlyArray<DocEntry>): void {
  const seen = new Map<string, 'file' | 'dir'>();

  for (const entry of entries) {
    let parentKey = '';

    for (let index = 0; index < entry.segments.length; index += 1) {
      const segment = entry.segments[index] ?? '';
      const isLast = index === entry.segments.length - 1;
      const title = isMarkdownName(segment) ? titleFromSegment(segment) : segment;
      const kind: 'file' | 'dir' = isLast && isMarkdownName(segment) ? 'file' : 'dir';
      const key = `${parentKey}::${title}`;
      const existing = seen.get(key);

      if (existing && existing !== kind) {
        throw new Error(`Local documentation tree contains conflicting page titles under the same parent: ${title}`);
      }

      seen.set(key, existing ?? kind);
      parentKey = key;
    }
  }
}

export { resolveConfluenceSyncPlan as resolveSyncPlan };
