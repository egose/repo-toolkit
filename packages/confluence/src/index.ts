import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import type { FlagSpec } from '@repo-toolkit/publish-package';

import { ConfluenceClient, ConfluenceApiError, CONFLUENCE_MANAGED_LABEL } from './confluence-client';
import type { ConfluenceGateway, Page, PageDescendant, PageLabel } from './confluence-client';
export { ConfluenceClient, ConfluenceApiError };
export { CONFLUENCE_MANAGED_LABEL } from './confluence-client';
export type {
  ConfluenceGateway,
  AttachmentGateway,
  ConfluenceClientOptions,
  Page,
  Attachment,
  PageBody,
  PageVersion,
  CreatePageInput,
  UpdatePageInput,
  PageDescendant,
  PageLabel,
} from './confluence-client';

import {
  readDocTree,
  titleFromSegment,
  isMarkdownName,
  pageTitleFromSegments,
  resolvePageTitleStrategy,
  type DocEntry,
  type PageTitleStrategy,
} from './files';
export { readDocTree, titleFromSegment, isMarkdownName };
export {
  resolvePageTitleStrategy,
  pageTitleFromSegments,
  PAGE_TITLE_STRATEGIES,
  DEFAULT_PAGE_TITLE_STRATEGY,
} from './files';
export type { DocEntry, DocTree, PageTitleStrategy } from './files';

import {
  markdownToStorage,
  isRemoteUrl,
  isAllowedUrl,
  escapeHtml,
  escapeXmlAttribute,
  escapeAttachmentFilename,
  LOCAL_IMAGE_PLACEHOLDER_RE,
} from './markdown';
export { markdownToStorage, isRemoteUrl, isAllowedUrl, escapeXmlAttribute, escapeAttachmentFilename };
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

import {
  renderParentSummary,
  mergeParentSummaryBody,
  type ManagedPageRecord,
  type ParentSummaryStats,
} from './parent-summary';

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
  /**
   * Leaf page title strategy (default: `filename-stem`). Applied only to
   * Markdown leaf pages; folder-generated parent pages keep their raw
   * directory-segment titles. See {@link PAGE_TITLE_STRATEGIES}.
   */
  pageTitleStrategy?: PageTitleStrategy;
  /** Render ```html fenced blocks as inline HTML via the Confluence `html` macro instead of a code box (default: false). */
  renderHtmlBlocks?: boolean;
  /** Repository URL appended to synced pages as an italic source notice. */
  repositoryUrl?: string;
  /**
   * Destructive reset (default: false). When true, a real sync first moves
   * every page descendant of `parentPageId` — including manual/unlabeled
   * pages — to the Confluence trash, then recreates the local hierarchy.
   * `parentPageId` itself is never deleted.
   */
  clean?: boolean;
  /**
   * Update the target parent summary (default: true). When true, a successful
   * real sync fetches and merges a deterministic tool-managed region into the
   * parent page body, preserving all external content.
   */
  updateParentPage?: boolean;
  /**
   * Dry-run: walk the tree and validate every markdown file and local image
   * source (same preflight as a real sync) then print the plan, but make no
   * API mutation calls. Credentials are not required under `--dry-run`.
   */
  dryRun?: boolean;
  /**
   * Custom Confluence gateway. Any object whose method shapes match
   * {@link ConfluenceGateway} is accepted (typed fakes — no `unknown` cast).
   * When supplied, `username`/`apiToken`/`baseUrl`/`spaceKey`/`parentPageId`
   * are ignored by the orchestrator and the credential/baseUrl required-field
   * checks are skipped — the gateway owns all remote work.
   */
  client?: ConfluenceGateway;
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
  repositoryUrl: string;
  /** Destructive reset flag; resolved from {@link ConfluenceSyncOptions.clean} with default false. */
  clean: boolean;
  /** Parent-summary flag; resolved from {@link ConfluenceSyncOptions.updateParentPage} with default true. */
  updateParentPage: boolean;
  /** Validated leaf page title strategy applied during planning. */
  pageTitleStrategy: PageTitleStrategy;
}

/** A single markdown entry's locally-validated sync plan. */
export interface LocalSyncEntryPlan {
  /** The original doc-tree entry this plan covers. */
  entry: DocEntry;
  /**
   * The resolved Confluence page title for this leaf entry, computed once via
   * {@link pageTitleFromSegments} with the plan's {@link ConfluenceSyncPlan.pageTitleStrategy}.
   * Consumed verbatim by local hierarchy validation, dry-run output, remote
   * lookup, create, and update paths.
   */
  title: string;
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
      const fileRepositoryUrl = repositoryFileUrl(plan, entry.segments);
      const body = appendRepositoryNotice(html, fileRepositoryUrl);
      const markdownDir = dirname(entry.absolute);
      const hasLocalImages = hasLocalImagePlaceholder(body);
      const hasMermaidBlocks = mermaidBlocks.length > 0;
      const attachments = hasLocalImages
        ? validateAttachmentSources(body, {
            markdownDir,
            allowedRoot: plan.folder,
          })
        : [];
      plans.push({
        entry,
        title: pageTitleFromSegments(entry.segments, plan.pageTitleStrategy),
        html: body,
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
  /** Page ids that received the global ownership marker during this run. */
  labelsAdded: ReadonlyArray<string>;
  /** Page ids trashed by the explicit `clean: true` pre-sync reset. */
  cleanDeletions: ReadonlyArray<string>;
  /** Page ids trashed by the default label-gated prune after a successful sync. */
  pruneDeletions: ReadonlyArray<string>;
  /** Stale labeled pages retained because an unlabeled, non-page, or otherwise
   * retained descendant made deletion unsafe. */
  blocked: ReadonlyArray<string>;
  /** Parent-summary outcome: `updated` when the parent body changed, `unchanged` when already equal, `skipped` when opt-out. */
  parentStatus: 'updated' | 'unchanged' | 'skipped';
}

/** A single failed clean/prune deletion. */
export interface ReconciliationFailure {
  pageId: string;
  error: Error;
}

/**
 * Structured partial-mutation report for the clean and prune phases. Thrown
 * when trashing a page fails mid-phase. Carries every completed deletion, the
 * failed page, and the planned deletions that were never attempted.
 */
export class ReconciliationError extends Error {
  readonly phase: 'clean' | 'prune';
  readonly completed: ReadonlyArray<string>;
  readonly failure: ReconciliationFailure;
  readonly unprocessed: ReadonlyArray<string>;
  constructor(input: {
    phase: 'clean' | 'prune';
    completed: ReadonlyArray<string>;
    failure: ReconciliationFailure;
    unprocessed: ReadonlyArray<string>;
  }) {
    super(input.failure.error.message);
    this.name = 'ReconciliationError';
    this.phase = input.phase;
    this.completed = input.completed;
    this.failure = input.failure;
    this.unprocessed = input.unprocessed;
  }
}

export class ParentSummaryError extends Error {
  readonly phase: 'parent-summary';
  readonly changes: ReadonlyArray<SyncChange>;
  readonly labelsAdded: ReadonlyArray<string>;
  readonly cleanDeletions: ReadonlyArray<string>;
  readonly pruneDeletions: ReadonlyArray<string>;
  readonly blocked: ReadonlyArray<string>;
  readonly failure: ReconciliationFailure;
  constructor(input: {
    changes: ReadonlyArray<SyncChange>;
    labelsAdded: ReadonlyArray<string>;
    cleanDeletions: ReadonlyArray<string>;
    pruneDeletions: ReadonlyArray<string>;
    blocked: ReadonlyArray<string>;
    failure: ReconciliationFailure;
  }) {
    super(input.failure.error.message);
    this.name = 'ParentSummaryError';
    this.phase = 'parent-summary';
    this.changes = input.changes;
    this.labelsAdded = input.labelsAdded;
    this.cleanDeletions = input.cleanDeletions;
    this.pruneDeletions = input.pruneDeletions;
    this.blocked = input.blocked;
    this.failure = input.failure;
  }
}

/** One inventoried descendant of the target page, annotated with ownership. */
export interface RemoteInventoryEntry {
  id: string;
  type: string;
  parentId?: string;
  depth?: number;
  title?: string;
  /** Whether the page carries the exact global ownership marker. */
  labeled: boolean;
}

/** Outcome of the pure deletion planners. */
export interface DeletionPlan {
  /** Page ids to trash, ordered deepest-first (children before parents). */
  deletions: ReadonlyArray<string>;
  /** Stale labeled pages retained because deleting them would also remove a
   * retained (unlabeled, non-page, or expected) descendant. */
  blocked: ReadonlyArray<string>;
}

/**
 * Pure label-gated stale-page planner. Protects the target page, expected
 * (mapped) ids, unlabeled pages, non-page content, and any stale page with a
 * retained descendant. Throws when the inventory is too incomplete to verify
 * ancestry safely.
 */
export function planStalePruning(input: {
  parentPageId: string;
  expectedIds: ReadonlySet<string>;
  inventory: ReadonlyArray<RemoteInventoryEntry>;
}): DeletionPlan {
  const nodes = buildInventoryNodes(input.parentPageId, input.inventory);
  const retained = new Set<string>();
  const visited = new Set<string>();

  const isStale = (entry: RemoteInventoryEntry): boolean =>
    entry.type === 'page' && entry.labeled && !input.expectedIds.has(entry.id) && entry.id !== input.parentPageId;

  const visit = (node: InventoryNode): void => {
    if (visited.has(node.entry.id)) {
      return;
    }
    visited.add(node.entry.id);
    let safe = isStale(node.entry);
    for (const child of node.children) {
      visit(child);
      if (retained.has(child.entry.id)) {
        safe = false;
      }
    }
    if (!safe) {
      retained.add(node.entry.id);
    }
  };
  for (const node of nodes.values()) {
    visit(node);
  }

  const deletions = deepestFirst([...nodes.values()].filter((n) => !retained.has(n.entry.id)));
  const blocked = [...nodes.values()]
    .filter((n) => retained.has(n.entry.id) && isStale(n.entry))
    .map((n) => n.entry.id)
    .sort();
  return { deletions, blocked };
}

/**
 * Pure explicit-clean planner. Trash every page descendant regardless of
 * label. Fails closed before any deletion when the subtree contains non-page
 * content whose retention cannot be proven, or when the inventory is
 * incomplete.
 */
export function planCleanDeletions(input: {
  parentPageId: string;
  inventory: ReadonlyArray<RemoteInventoryEntry>;
}): DeletionPlan {
  const nodes = buildInventoryNodes(input.parentPageId, input.inventory);
  for (const node of nodes.values()) {
    if (node.entry.type !== 'page') {
      throw new Error(
        `clean refused: descendant ${node.entry.id} has unsupported type "${node.entry.type}"; ` +
          'deleting its ancestors could remove content that cannot be restored by this tool',
      );
    }
  }
  return { deletions: deepestFirst([...nodes.values()]), blocked: [] };
}

interface InventoryNode {
  entry: RemoteInventoryEntry;
  depth: number;
  children: InventoryNode[];
}

function buildInventoryNodes(
  parentPageId: string,
  inventory: ReadonlyArray<RemoteInventoryEntry>,
): Map<string, InventoryNode> {
  const nodes = new Map<string, InventoryNode>();
  for (const entry of inventory) {
    if (entry.id === parentPageId) {
      continue;
    }
    if (nodes.has(entry.id)) {
      throw new Error(`Incomplete descendant inventory: duplicate id ${entry.id}`);
    }
    nodes.set(entry.id, { entry, depth: -1, children: [] });
  }

  const depthOf = (node: InventoryNode): number => {
    if (node.depth >= 0) {
      return node.depth;
    }
    if (typeof node.entry.depth === 'number') {
      node.depth = node.entry.depth;
      return node.depth;
    }
    let depth = 0;
    let current = node;
    const seen = new Set<string>([node.entry.id]);
    while (true) {
      const pid = current.entry.parentId;
      if (pid === parentPageId) {
        depth += 1;
        node.depth = depth;
        return depth;
      }
      if (!pid) {
        throw new Error(`Incomplete descendant inventory: missing parent for ${node.entry.id}`);
      }
      if (seen.has(pid)) {
        throw new Error(`Incomplete descendant inventory: parent cycle at ${pid}`);
      }
      seen.add(pid);
      const parent = nodes.get(pid);
      if (!parent) {
        throw new Error(
          `Incomplete descendant inventory: ancestor ${pid} of ${node.entry.id} is missing from the listing`,
        );
      }
      depth += 1;
      current = parent;
    }
  };

  for (const node of nodes.values()) {
    depthOf(node);
    const pid = node.entry.parentId;
    if (pid !== undefined && pid !== parentPageId) {
      nodes.get(pid)?.children.push(node);
    }
  }
  return nodes;
}

function deepestFirst(nodes: ReadonlyArray<InventoryNode>): string[] {
  return [...nodes]
    .sort((a, b) => (b.depth - a.depth !== 0 ? b.depth - a.depth : a.entry.id.localeCompare(b.entry.id)))
    .map((n) => n.entry.id);
}

function hasManagedMarker(labels: ReadonlyArray<PageLabel>): boolean {
  return labels.some((label) => label.name === CONFLUENCE_MANAGED_LABEL && label.prefix === 'global');
}

export function resolveConfluenceSyncPlan(options: ConfluenceSyncOptions = {}): ConfluenceSyncPlan {
  const pageTitleStrategy = resolvePageTitleStrategy(options.pageTitleStrategy);
  const cwd = resolve(options.cwd ?? process.cwd());
  const folder = resolveInputPath(cwd, options.folder ?? '');
  if (!options.folder) {
    throw new Error('folder is required');
  }
  const hasGateway = options.client !== undefined;
  // A supplied gateway replaces the credentials/baseUrl contract: the
  // orchestrator drives remote work through `options.client`, so the network
  // credentials that the bundled ConfluenceClient would need are not required.
  // `spaceKey` and `parentPageId` are sync-target inputs — even a custom
  // gateway doesn't know which space or parent page to publish under — so
  // they remain required unless `--dry-run` is set.
  if (!options.dryRun) {
    if (!hasGateway) {
      if (!options.username) {
        throw new Error('username is required');
      }
      if (!options.apiToken) {
        throw new Error('apiToken is required');
      }
      if (!options.baseUrl) {
        throw new Error('baseUrl is required');
      }
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

  const repositoryUrl = options.repositoryUrl
    ? repositoryNoticeUrl(options.repositoryUrl, cwd, options.folder ?? '')
    : '';

  if (repositoryUrl && !isAllowedUrl(repositoryUrl)) {
    throw new Error(
      'repositoryUrl must be an http(s), protocol-relative, server-relative, mailto, tel, or relative URL',
    );
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
    repositoryUrl,
    clean: options.clean ?? false,
    updateParentPage: options.updateParentPage ?? true,
    pageTitleStrategy,
  };
}

export async function syncConfluenceToDocs(options: ConfluenceSyncOptions = {}): Promise<SyncResult | void> {
  const plan = resolveConfluenceSyncPlan(options);
  const log = options.log ?? ((msg: string) => console.log(msg));

  const tree = await readDocTree(plan.folder);
  if (tree.entries.length === 0) {
    log(`No markdown files found under ${plan.folder}`);
  }

  const localPlan = validateLocalSync(tree.entries, plan);

  validateLocalHierarchy(localPlan.entries, plan.pageTitleStrategy);

  if (plan.dryRun) {
    log('[dry-run] Walking documentation tree only.');
    for (const entryPlan of localPlan.entries) {
      const attCount = entryPlan.attachments.length;
      const mermaidCount = entryPlan.mermaidBlocks.length;
      log(
        `[dry-run] would sync ${entryPlan.entry.segments.join('/')} as "${entryPlan.title}"` +
          (attCount > 0 ? ` (${attCount} attachment${attCount === 1 ? '' : 's'} validated)` : '') +
          (mermaidCount > 0 ? ` (${mermaidCount} mermaid block${mermaidCount === 1 ? '' : 's'})` : ''),
      );
    }
    if (plan.clean) {
      log(
        '[dry-run] clean requested: a real sync would move every page descendant of the target page to trash before recreating the local hierarchy.',
      );
    }
    log(
      '[dry-run] a real sync would label every mapped page with the ownership marker and prune stale labeled descendants.',
    );
    if (plan.updateParentPage) {
      const stats = computeDryRunStats(localPlan);
      log(
        `[dry-run] parent summary: Markdown pages: ${stats.markdownPages}, Directory pages: ${stats.directoryPages}, Total managed pages: ${stats.totalPages}, Maximum depth: ${stats.maxDepth}, Attachment references: ${stats.attachmentReferences}, Mermaid blocks: ${stats.mermaidBlocks}`,
      );
      if (localPlan.entries.length === 0) {
        log('[dry-run] parent tree: No managed child pages');
      } else {
        for (const entryPlan of localPlan.entries) {
          const dirParts = entryPlan.entry.segments.slice(0, -1);
          for (let i = 0; i < dirParts.length; i += 1) {
            const dirPath = dirParts.slice(0, i + 1).join('/');
            log(`[dry-run] parent tree: ${dirPath} (directory) => "${dirParts[i] ?? ''}"`);
          }
          log(`[dry-run] parent tree: ${entryPlan.entry.segments.join('/')} (page) => "${entryPlan.title}"`);
        }
      }
    }
    return;
  }

  const client: ConfluenceGateway =
    options.client ??
    new ConfluenceClient({
      baseUrl: plan.baseUrl,
      username: plan.username,
      apiToken: plan.apiToken,
    });

  const labelsAdded: string[] = [];
  const cleanDeletions: string[] = [];
  const pruneDeletions: string[] = [];
  const blocked: string[] = [];

  if (plan.clean) {
    const descendants = await client.getPageDescendants(plan.parentPageId);
    const inventory = descendants.filter((d) => d.id !== plan.parentPageId).map((d) => toInventoryEntry(d, false));
    const cleanPlan = planCleanDeletions({ parentPageId: plan.parentPageId, inventory });
    await executeDeletions(cleanPlan.deletions, 'clean', client, log, cleanDeletions);
  }

  const spaceId = await client.getSpaceIdByKey(plan.spaceKey);
  const cache = new PageTitleCache(spaceId, client);

  const syncState: SyncTraversalState = {
    mappedIds: new Set<string>(),
    ensuredLabels: new Set<string>(),
    labelsAdded,
    mappedRecords: new Map<string, ManagedPageRecord>(),
  };

  const changes: SyncChange[] = [];
  for (let i = 0; i < localPlan.entries.length; i += 1) {
    const entryPlan = localPlan.entries[i];
    try {
      await syncEntry(entryPlan, plan, client, cache, log, changes, syncState);
    } catch (error) {
      throw new SyncMutationError({
        changes,
        failure: { entry: entryPlan.entry, error: error instanceof Error ? error : new Error(String(error)) },
        unprocessed: localPlan.entries.slice(i + 1).map((p) => p.entry),
      });
    }
  }

  if (!plan.clean) {
    const descendants = await client.getPageDescendants(plan.parentPageId);
    const inventory: RemoteInventoryEntry[] = [];
    for (const d of descendants) {
      if (d.id === plan.parentPageId) {
        continue;
      }
      if (d.type !== 'page') {
        inventory.push(toInventoryEntry(d, false));
        continue;
      }
      if (syncState.mappedIds.has(d.id)) {
        inventory.push(toInventoryEntry(d, true));
        continue;
      }
      const labels = await client.getPageLabels(d.id);
      inventory.push(toInventoryEntry(d, hasManagedMarker(labels)));
    }
    const prunePlan = planStalePruning({
      parentPageId: plan.parentPageId,
      expectedIds: syncState.mappedIds,
      inventory,
    });
    await executeDeletions(prunePlan.deletions, 'prune', client, log, pruneDeletions);
    for (const pageId of prunePlan.blocked) {
      blocked.push(pageId);
      log(`blocked: stale page ${pageId} retained because it has unlabeled, non-page, or expected descendants`);
    }
  }

  let parentStatus: 'updated' | 'unchanged' | 'skipped' = 'skipped';
  if (plan.updateParentPage) {
    try {
      const parentPage = await client.getPage(plan.parentPageId);
      const stats = computeParentStats(localPlan, syncState);
      const pages = [...syncState.mappedRecords.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
      const region = renderParentSummary({ repositoryUrl: plan.repositoryUrl, stats, pages });
      const currentBody = parentPage.body?.storage?.value ?? '';
      const merged = mergeParentSummaryBody(currentBody, region);
      if (merged === currentBody) {
        log(`parent-unchanged: page ${plan.parentPageId}`);
        parentStatus = 'unchanged';
      } else {
        await client.updatePage({
          id: plan.parentPageId,
          title: parentPage.title,
          body: { representation: 'storage', value: merged },
          version: { number: (parentPage.version?.number ?? 0) + 1, message: plan.versionMessage },
        });
        log(`parent-updated: page ${plan.parentPageId}`);
        parentStatus = 'updated';
      }
    } catch (error) {
      throw new ParentSummaryError({
        changes,
        labelsAdded: [...labelsAdded],
        cleanDeletions: [...cleanDeletions],
        pruneDeletions: [...pruneDeletions],
        blocked: [...blocked],
        failure: { pageId: plan.parentPageId, error: error instanceof Error ? error : new Error(String(error)) },
      });
    }
  }

  return { changes, labelsAdded, cleanDeletions, pruneDeletions, blocked, parentStatus };
}

function computeParentStats(localPlan: LocalSyncPlan, state: SyncTraversalState): ParentSummaryStats {
  const dirSet = new Set<string>();
  let maxDepth = 0;
  let attachmentReferences = 0;
  let mermaidBlocks = 0;
  for (const entryPlan of localPlan.entries) {
    const segs = entryPlan.entry.segments;
    if (segs.length > maxDepth) {
      maxDepth = segs.length;
    }
    for (let i = 0; i < segs.length - 1; i += 1) {
      dirSet.add(segs.slice(0, i + 1).join('/'));
    }
    attachmentReferences += entryPlan.attachments.length;
    mermaidBlocks += entryPlan.mermaidBlocks.length;
  }
  const markdownPages = localPlan.entries.length;
  const directoryPages = dirSet.size;
  const totalPages = state.mappedRecords.size;
  const effectiveMaxDepth = localPlan.entries.length === 0 ? 0 : maxDepth;
  return {
    markdownPages,
    directoryPages,
    totalPages: totalPages > 0 ? totalPages : directoryPages + markdownPages,
    maxDepth: effectiveMaxDepth,
    attachmentReferences,
    mermaidBlocks,
  };
}

function computeDryRunStats(localPlan: LocalSyncPlan): ParentSummaryStats {
  const dirSet = new Set<string>();
  let maxDepth = 0;
  let attachmentReferences = 0;
  let mermaidBlocks = 0;
  for (const entryPlan of localPlan.entries) {
    const segs = entryPlan.entry.segments;
    if (segs.length > maxDepth) {
      maxDepth = segs.length;
    }
    for (let i = 0; i < segs.length - 1; i += 1) {
      dirSet.add(segs.slice(0, i + 1).join('/'));
    }
    attachmentReferences += entryPlan.attachments.length;
    mermaidBlocks += entryPlan.mermaidBlocks.length;
  }
  const markdownPages = localPlan.entries.length;
  const directoryPages = dirSet.size;
  return {
    markdownPages,
    directoryPages,
    totalPages: directoryPages + markdownPages,
    maxDepth: markdownPages === 0 ? 0 : maxDepth,
    attachmentReferences,
    mermaidBlocks,
  };
}

function toInventoryEntry(d: PageDescendant, labeled: boolean): RemoteInventoryEntry {
  const entry: RemoteInventoryEntry = { id: d.id, type: d.type, labeled };
  if (d.parentId !== undefined) {
    entry.parentId = d.parentId;
  }
  if (d.depth !== undefined) {
    entry.depth = d.depth;
  }
  if (d.title !== undefined) {
    entry.title = d.title;
  }
  return entry;
}

interface SyncTraversalState {
  /** Every folder and leaf page id mapped during this run; the reconciliation key. */
  mappedIds: Set<string>;
  /** Page ids whose ownership label was verified/added during this run. */
  ensuredLabels: Set<string>;
  labelsAdded: string[];
  mappedRecords: Map<string, ManagedPageRecord>;
}

async function ensureManagedLabel(
  pageId: string,
  client: ConfluenceGateway,
  state: SyncTraversalState,
  log: (message: string) => void,
): Promise<void> {
  if (state.ensuredLabels.has(pageId)) {
    return;
  }
  const labels = await client.getPageLabels(pageId);
  if (!hasManagedMarker(labels)) {
    await client.addManagedLabel(pageId);
    state.labelsAdded.push(pageId);
    log(`labeled: page ${pageId}`);
  }
  state.ensuredLabels.add(pageId);
}

async function executeDeletions(
  ids: ReadonlyArray<string>,
  phase: 'clean' | 'prune',
  client: ConfluenceGateway,
  log: (message: string) => void,
  evidence: string[],
): Promise<void> {
  for (let i = 0; i < ids.length; i += 1) {
    const pageId = ids[i];
    if (pageId === undefined) {
      continue;
    }
    try {
      await client.deletePage(pageId);
      evidence.push(pageId);
      log(`${phase === 'clean' ? 'clean' : 'pruned'}: trashed page ${pageId}`);
    } catch (error) {
      throw new ReconciliationError({
        phase,
        completed: [...evidence],
        failure: { pageId, error: error instanceof Error ? error : new Error(String(error)) },
        unprocessed: ids.slice(i + 1),
      });
    }
  }
}

async function syncEntry(
  entryPlan: LocalSyncEntryPlan,
  plan: ConfluenceSyncPlan,
  client: ConfluenceGateway,
  cache: PageTitleCache,
  log: (message: string) => void,
  changes: SyncChange[],
  state: SyncTraversalState,
): Promise<void> {
  const { entry, html: precomputedHtml, mermaidBlocks, markdownDir, hasLocalImages, hasMermaidBlocks } = entryPlan;
  const segments = entry.segments;
  if (segments.length === 0) {
    return;
  }

  let currentParentId = plan.parentPageId;

  const recordDirectory = (relativePath: string, title: string, pageId: string, depth: number): void => {
    if (!state.mappedRecords.has(relativePath)) {
      state.mappedRecords.set(relativePath, {
        relativePath,
        kind: 'directory',
        title,
        pageId,
        depth,
        attachmentCount: 0,
        mermaidCount: 0,
      });
    }
  };

  const recordLeaf = (relativePath: string, title: string, pageId: string, depth: number): void => {
    state.mappedRecords.set(relativePath, {
      relativePath,
      kind: 'leaf',
      title,
      pageId,
      depth,
      attachmentCount: entryPlan.attachments.length,
      mermaidCount: entryPlan.mermaidBlocks.length,
    });
  };

  for (let idx = 0; idx < segments.length; idx += 1) {
    const isLast = idx === segments.length - 1;
    const segment = segments[idx] ?? '';

    if (isLast && isMarkdownName(segment)) {
      const title = entryPlan.title;
      const leafNeedsUploads = hasLocalImages || hasMermaidBlocks;

      const existing = await cache.find(title, currentParentId);

      if (!existing && !leafNeedsUploads) {
        const pageId = await cache.createEntry({
          title,
          parentId: currentParentId,
          body: { representation: 'storage', value: precomputedHtml },
        });
        state.mappedIds.add(pageId);
        await ensureManagedLabel(pageId, client, state, log);
        recordLeaf(segments.join('/'), title, pageId, segments.length);
        log(`created: ${segments.join('/')} (page ${pageId})`);
        changes.push({ entry, pageId, kind: 'created' });
        return;
      }

      const existingPage = existing ?? (await cache.findOrCreate(title, currentParentId));
      const pageId = existingPage.id;
      state.mappedIds.add(pageId);
      await ensureManagedLabel(pageId, client, state, log);
      recordLeaf(segments.join('/'), title, pageId, segments.length);

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
      const title = pageTitleFromSegments(segments.slice(0, idx + 1), plan.pageTitleStrategy);
      const page = await cache.findOrCreate(title, currentParentId);
      state.mappedIds.add(page.id);
      await ensureManagedLabel(page.id, client, state, log);
      recordDirectory(segments.slice(0, idx + 1).join('/'), title, page.id, idx + 1);
      currentParentId = page.id;
      continue;
    }

    const page = await cache.findOrCreate(segment, currentParentId);
    state.mappedIds.add(page.id);
    await ensureManagedLabel(page.id, client, state, log);
    recordDirectory(segments.slice(0, idx + 1).join('/'), segment, page.id, idx + 1);
    currentParentId = page.id;
  }
}

class PageTitleCache {
  private readonly cache = new Map<string, { id: string }>();
  private readonly spaceId: string;
  private readonly client: ConfluenceGateway;

  constructor(spaceId: string, client: ConfluenceGateway) {
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

function appendRepositoryNotice(html: string, repositoryUrl: string): string {
  if (repositoryUrl.length === 0) {
    return html;
  }
  const url = escapeXmlAttribute(repositoryUrl);
  const text = escapeHtml(repositoryUrl);
  return html + '\n<p><em>This document is synced from repository <a href="' + url + '">' + text + '</a>.</em></p>';
}

function repositoryNoticeUrl(repositoryUrl: string, cwd: string, folder: string): string {
  const folderPath = repositoryFolderPath(cwd, folder);
  if (folderPath.length === 0) {
    return repositoryUrl;
  }
  const trimmedUrl = repositoryUrl.replace(/\/+$/, '').replace(/\.git$/, '');
  const encodedFolder = folderPath.split('/').map(encodeURIComponent).join('/');
  if (/^https?:\/\/github\.com\//i.test(trimmedUrl) && !/\/tree\/|\/blob\//.test(trimmedUrl)) {
    return trimmedUrl + '/tree/HEAD/' + encodedFolder;
  }
  return trimmedUrl + '/' + encodedFolder;
}

function repositoryFileUrl(plan: ConfluenceSyncPlan, segments: ReadonlyArray<string>): string {
  if (plan.repositoryUrl.length === 0) {
    return '';
  }
  const encodedSegments = segments.map(encodeURIComponent).join('/');
  if (plan.repositoryUrl.includes('/tree/HEAD/') || plan.repositoryUrl.includes('/blob/HEAD/')) {
    const baseBlob = plan.repositoryUrl.replace('/tree/HEAD/', '/blob/HEAD/');
    return baseBlob.replace(/\/+$/, '') + '/' + encodedSegments;
  }
  const folderPath = repositoryFolderPath(plan.cwd, plan.folder);
  const trimmedBase = plan.repositoryUrl.replace(/\/+$/, '').replace(/\.git$/, '');
  const isGithub = /^https?:\/\/github\.com\//i.test(trimmedBase);
  if (isGithub) {
    const fullPath = folderPath ? folderPath + '/' + segments.join('/') : segments.join('/');
    const encodedFull = fullPath.split('/').map(encodeURIComponent).join('/');
    return trimmedBase + '/blob/HEAD/' + encodedFull;
  }
  return plan.repositoryUrl.replace(/\/+$/, '') + '/' + encodedSegments;
}

function repositoryFolderPath(cwd: string, folder: string): string {
  if (folder.length === 0) {
    return '';
  }
  const relativePath = relative(cwd, resolveInputPath(cwd, folder));
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return '';
  }
  return relativePath
    .split(/[\\/]+/)
    .filter((part) => part !== '' && part !== '.')
    .join('/');
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
  client: ConfluenceGateway,
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

function validateLocalHierarchy(entries: ReadonlyArray<LocalSyncEntryPlan>, strategy: PageTitleStrategy): void {
  const seen = new Map<string, 'file' | 'dir'>();

  for (const entryPlan of entries) {
    const { entry } = entryPlan;
    let parentKey = '';

    for (let index = 0; index < entry.segments.length; index += 1) {
      const segment = entry.segments[index] ?? '';
      const isLast = index === entry.segments.length - 1;
      const title = isMarkdownName(segment)
        ? isLast
          ? entryPlan.title
          : pageTitleFromSegments(entry.segments.slice(0, index + 1), strategy)
        : segment;
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
