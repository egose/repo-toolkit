import { randomUUID } from 'node:crypto';

import { normalizeProjectRelPath, validateBranchName } from './config';
import { SecretSyncError } from './errors';
import { readFileBounded } from './filesystem';
import { publishCommit, validateHistoryDependencies } from './history-store';
import { sha256Hex } from './records';
import {
  acquireStateLock,
  assertIdentityMatches,
  computeFileHmac,
  initState,
  normalizeOperationIdentity,
  readStateIfPresent,
  saveState,
  setBaseline,
  setObservedHeads,
  type FileBaseline,
} from './state';
import { planSync, type ResultingTreeEntry } from './plan';
import type { LocalSlot } from './status';
import type { SecretStore } from './store';
import {
  baselinesToSlots,
  buildPublishNote,
  createOperationId,
  loadBranchHistory,
  publishUploadsBounded,
  recheckHeads,
  requireSingleOperationHead,
  resolveOperationConcurrency,
  resolveSyncCandidates,
  resolveTimestamp,
  scanLocalSlots,
  validateSizeBounds,
  writeOperationRecord,
  type UploadInput,
} from './operations';

export interface PushHooks {
  beforePublish?: () => void | Promise<void>;
  afterPublish?: (commitId: string) => void | Promise<void>;
  beforeStateSave?: () => void | Promise<void>;
}

export interface PushOptions {
  store: SecretStore;
  rootAbsolute: string;
  projectId?: string;
  branch: string;
  endpoint?: string;
  vaultId?: string;
  remote?: unknown;
  identity?: unknown;
  selection?: string[];
  allowDelete?: boolean;
  message?: string;
  concurrency?: number;
  timestamp?: number;
  operationId?: string;
  blobIds?: Record<string, string>;
  commitId?: string;
  dryRun?: boolean;
  maxFileBytes?: number;
  maxFiles?: number;
  hooks?: PushHooks;
}

export interface PushResult {
  noop: boolean;
  published: boolean;
  commitId?: string;
  parents: string[];
  headsBefore: string[];
  headsAfter: string[];
  divergedAfter: boolean;
  commitVisible: boolean;
  reconciled: boolean;
  uploaded: string[];
  removedRemote: string[];
  acknowledged: string[];
  pendingDeletions: Array<{ path: string; requiredFlag: string; current: string }>;
  outOfSelectionPreserved: string[];
  note: string;
  localRecoveryOk: boolean;
  localRecoveryError?: string;
  dryRun: boolean;
}

function normalizeBlobIds(value: Record<string, string> | undefined): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const key of Object.keys(value)) {
    result[normalizeProjectRelPath(key, '--file')] = value[key] as string;
  }
  return result;
}

interface CleanAck {
  path: string;
  baseline: FileBaseline;
}

function acknowledgeCleanPaths(
  localKey: string,
  selected: ReadonlyArray<string>,
  locals: ReadonlyMap<string, LocalSlot>,
  localBytes: ReadonlyMap<string, Uint8Array>,
  resultingTree: ReadonlyArray<ResultingTreeEntry>,
  commitId: string | undefined,
  exclude: ReadonlySet<string>,
): CleanAck[] {
  const treeByPath = new Map(resultingTree.map((entry) => [entry.path, entry]));
  const result: CleanAck[] = [];
  for (const path of selected) {
    if (exclude.has(path)) {
      continue;
    }
    const local = locals.get(path) ?? { state: 'absent' as const };
    if (local.state === 'error') {
      continue;
    }
    const remote = treeByPath.get(path);
    if (local.state === 'absent' && remote === undefined) {
      result.push({ path, baseline: { state: 'absent' } });
      continue;
    }
    if (local.state === 'present' && remote !== undefined && remote.blobId !== undefined) {
      if (local.fingerprint.sha256 === remote.sha256 && local.fingerprint.byteLength === remote.byteLength) {
        const bytes = localBytes.get(path);
        if (bytes === undefined) {
          continue;
        }
        const baseline: FileBaseline = {
          state: 'present',
          hmac: computeFileHmac(bytes, localKey),
          byteLength: bytes.byteLength,
          blobId: remote.blobId,
        };
        if (commitId !== undefined) {
          baseline.commitId = commitId;
        }
        result.push({ path, baseline });
      }
    }
  }
  return result;
}

export async function pushSecrets(options: PushOptions): Promise<PushResult> {
  const branch = validateBranchName(options.branch);
  const identity = normalizeOperationIdentity({
    endpoint: options.endpoint,
    vaultId: options.vaultId,
    projectId: options.projectId,
    remote: options.remote,
    identity: options.identity,
  });
  const projectId = identity.projectId;
  const concurrency = resolveOperationConcurrency(options.concurrency);
  const bounds = validateSizeBounds(options.maxFileBytes, options.maxFiles);
  const allowDelete = options.allowDelete === true;
  const dryRun = options.dryRun === true;
  const timestamp = resolveTimestamp(options.timestamp);
  const requestedBlobs = normalizeBlobIds(options.blobIds);

  if (options.selection !== undefined && options.selection.length > bounds.maxFiles) {
    throw new SecretSyncError('too-large', 'Push selection exceeds the configured file-count bound.');
  }

  if (dryRun) {
    const state = await readStateIfPresent(options.rootAbsolute);
    if (state !== undefined) {
      assertIdentityMatches(identity, state);
    }
    const loaded = await loadBranchHistory(options.store, projectId, branch, concurrency);
    requireSingleOperationHead(loaded.heads, branch);
    const remotePaths =
      loaded.heads.length === 0
        ? []
        : (loaded.heads[0] as { tree: Array<{ path: string }> }).tree.map((entry) => entry.path);
    const baselinePaths = state === undefined ? [] : Object.keys(state.baselines);
    const selected = await resolveSyncCandidates(options.rootAbsolute, options.selection, baselinePaths, remotePaths);
    if (selected.length > bounds.maxFiles) {
      throw new SecretSyncError('too-large', 'Push selection exceeds the configured file-count bound.');
    }
    const baselines = state === undefined ? new Map() : baselinesToSlots(state.baselines, loaded.history.blobs);
    const scanned = await scanLocalSlots(
      (path) => readFileBounded(options.rootAbsolute, path, { maxFileBytes: bounds.maxFileBytes }),
      selected,
    );
    const plan = planSync(
      { baselines, locals: scanned.slots, heads: loaded.heads },
      { direction: 'push', branch, selection: selected, allowDelete, dryRun: true },
    );
    return {
      noop: plan.noop,
      published: false,
      parents: plan.parents,
      headsBefore: loaded.headIds,
      headsAfter: loaded.headIds,
      divergedAfter: false,
      commitVisible: false,
      reconciled: false,
      uploaded: plan.actions.filter((action) => action.kind === 'upload').map((action) => action.path),
      removedRemote: plan.actions.filter((action) => action.kind === 'delete-remote').map((action) => action.path),
      acknowledged: [],
      pendingDeletions: plan.pendingDeletions.map((entry) => ({
        path: entry.path,
        requiredFlag: entry.requiredFlag,
        current: entry.current,
      })),
      outOfSelectionPreserved: plan.outOfSelectionPreserved,
      note: 'Dry run: reads permitted; no remote or local writes were performed.',
      localRecoveryOk: true,
      dryRun: true,
    };
  }

  const lock = await acquireStateLock(options.rootAbsolute);
  try {
    const state = await initState(options.rootAbsolute, identity, { branch });
    const loaded = await loadBranchHistory(options.store, projectId, branch, concurrency);
    const head = requireSingleOperationHead(loaded.heads, branch);
    const headsBefore = loaded.headIds;
    const remotePaths = head === undefined ? [] : head.tree.map((entry) => entry.path);
    const selected = await resolveSyncCandidates(
      options.rootAbsolute,
      options.selection,
      Object.keys(state.baselines),
      remotePaths,
    );
    if (selected.length > bounds.maxFiles) {
      throw new SecretSyncError('too-large', 'Push selection exceeds the configured file-count bound.');
    }
    const baselines = baselinesToSlots(state.baselines, loaded.history.blobs);
    const scanned = await scanLocalSlots(
      (path) => readFileBounded(options.rootAbsolute, path, { maxFileBytes: bounds.maxFileBytes }),
      selected,
    );
    const plan = planSync(
      { baselines, locals: scanned.slots, heads: loaded.heads },
      { direction: 'push', branch, selection: selected, allowDelete },
    );

    if (plan.noop) {
      const clean = acknowledgeCleanPaths(
        state.localKey,
        plan.selected,
        scanned.slots,
        scanned.bytes,
        plan.resultingTree,
        head === undefined ? undefined : head.logicalId,
        new Set<string>(),
      );
      for (const entry of clean) {
        setBaseline(state, entry.path, entry.baseline);
      }
      setObservedHeads(state, branch, headsBefore);
      await saveState(options.rootAbsolute, state);
      return {
        noop: true,
        published: false,
        parents: plan.parents,
        headsBefore,
        headsAfter: headsBefore,
        divergedAfter: false,
        commitVisible: head !== undefined,
        reconciled: false,
        uploaded: [],
        removedRemote: [],
        acknowledged: clean.map((entry) => entry.path).sort(),
        pendingDeletions: plan.pendingDeletions.map((entry) => ({
          path: entry.path,
          requiredFlag: entry.requiredFlag,
          current: entry.current,
        })),
        outOfSelectionPreserved: plan.outOfSelectionPreserved,
        note: `No-op push on branch ${JSON.stringify(branch)}: no commit created and unrelated baselines left untouched.`,
        localRecoveryOk: true,
        dryRun: false,
      };
    }

    const operationId = createOperationId(options.operationId);
    const commitId = options.commitId === undefined ? randomUUID() : options.commitId;
    const uploads: UploadInput[] = [];
    const uploadBlobIds: Record<string, string> = {};
    for (const action of plan.actions) {
      if (action.kind !== 'upload') {
        continue;
      }
      const bytes = scanned.bytes.get(action.path);
      if (bytes === undefined) {
        throw new SecretSyncError('validation', `Cannot upload ${JSON.stringify(action.path)} without local content.`);
      }
      uploads.push({ path: action.path, bytes });
      const preselected = requestedBlobs[action.path] ?? uploadBlobIds[action.path];
      uploadBlobIds[action.path] = preselected === undefined ? randomUUID() : preselected;
    }
    await writeOperationRecord(options.rootAbsolute, {
      schemaVersion: 1,
      operationId,
      kind: 'push',
      branch,
      commitId,
      blobIds: { ...uploadBlobIds },
      timestamp,
      ...(options.message === undefined ? {} : { message: options.message }),
    });

    for (const upload of uploads) {
      const retained = scanned.bytes.get(upload.path) as Uint8Array;
      const reread = await readFileBounded(options.rootAbsolute, upload.path, { maxFileBytes: bounds.maxFileBytes });
      if (reread === undefined || sha256Hex(reread) !== sha256Hex(retained)) {
        throw new SecretSyncError(
          'local-changed',
          `Refusing push after an unexpected concurrent local edit of ${JSON.stringify(upload.path)}.`,
        );
      }
    }

    const publishedBlobs = await publishUploadsBounded(options.store, projectId, uploads, uploadBlobIds, concurrency);
    let reconciledAny = false;
    for (const upload of uploads) {
      const published = publishedBlobs.get(upload.path);
      if (published !== undefined && published.reconciled) {
        reconciledAny = true;
      }
    }

    const tree = plan.resultingTree.map((entry) => {
      if (entry.blobId !== undefined) {
        return { path: entry.path, blobId: entry.blobId, sha256: entry.sha256, byteLength: entry.byteLength };
      }
      const published = publishedBlobs.get(entry.path);
      if (published === undefined) {
        throw new SecretSyncError('validation', `Push tree for ${JSON.stringify(entry.path)} is missing its blob id.`);
      }
      return {
        path: entry.path,
        blobId: published.envelope.logicalId,
        sha256: published.envelope.sha256,
        byteLength: published.envelope.byteLength,
      };
    });

    await recheckHeads(options.store, projectId, branch, headsBefore, concurrency);

    if (options.hooks?.beforePublish !== undefined) {
      await options.hooks.beforePublish();
    }
    for (const upload of uploads) {
      const retained = scanned.bytes.get(upload.path) as Uint8Array;
      const reread = await readFileBounded(options.rootAbsolute, upload.path, { maxFileBytes: bounds.maxFileBytes });
      if (reread === undefined || sha256Hex(reread) !== sha256Hex(retained)) {
        throw new SecretSyncError(
          'local-changed',
          `Refusing push after an unexpected concurrent local edit of ${JSON.stringify(upload.path)}.`,
        );
      }
    }
    const publishedCommit = await publishCommit(
      options.store,
      projectId,
      {
        branch,
        parents: [...plan.parents],
        tree,
        timestamp,
        ...(options.message === undefined ? {} : { message: options.message }),
        operationId,
        operationKind: 'push',
      },
      { logicalId: commitId },
    );
    if (publishedCommit.reconciled) {
      reconciledAny = true;
    }

    const after = await loadBranchHistory(options.store, projectId, branch, concurrency);
    const commitVisible = after.history.commits.has(commitId);
    if (commitVisible) {
      validateHistoryDependencies(after.history, projectId);
    }
    const headsAfter = after.headIds;
    const divergedAfter = headsAfter.length > 1 || !headsAfter.includes(commitId);

    if (options.hooks?.afterPublish !== undefined) {
      await options.hooks.afterPublish(commitId);
    }

    const uploadedPaths = uploads.map((upload) => upload.path).sort();
    const removedPaths = plan.actions
      .filter((action) => action.kind === 'delete-remote')
      .map((action) => action.path)
      .sort();
    const completed = new Set<string>([...uploadedPaths, ...removedPaths]);
    const acknowledged: string[] = [];
    for (const path of uploadedPaths) {
      const bytes = scanned.bytes.get(path) as Uint8Array;
      const published = publishedBlobs.get(path);
      if (published === undefined) {
        continue;
      }
      setBaseline(state, path, {
        state: 'present',
        hmac: computeFileHmac(bytes, state.localKey),
        byteLength: bytes.byteLength,
        blobId: published.envelope.logicalId,
        commitId,
      });
      acknowledged.push(path);
    }
    for (const path of removedPaths) {
      setBaseline(state, path, { state: 'absent' });
      acknowledged.push(path);
    }
    const resolvedTree: ResultingTreeEntry[] = plan.resultingTree.map((entry) => {
      if (entry.blobId !== undefined) {
        return entry;
      }
      const published = publishedBlobs.get(entry.path);
      if (published === undefined) {
        return entry;
      }
      return {
        path: entry.path,
        blobId: published.envelope.logicalId,
        sha256: published.envelope.sha256,
        byteLength: published.envelope.byteLength,
        source: entry.source,
      };
    });
    const clean = acknowledgeCleanPaths(
      state.localKey,
      plan.selected,
      scanned.slots,
      scanned.bytes,
      resolvedTree,
      commitId,
      completed,
    );
    for (const entry of clean) {
      setBaseline(state, entry.path, entry.baseline);
      acknowledged.push(entry.path);
    }
    acknowledged.sort();
    setObservedHeads(state, branch, headsAfter);
    try {
      await saveState(
        options.rootAbsolute,
        state,
        options.hooks?.beforeStateSave === undefined ? {} : { hooks: { beforeRename: options.hooks.beforeStateSave } },
      );
    } catch (error) {
      return {
        noop: false,
        published: true,
        commitId,
        parents: plan.parents,
        headsBefore,
        headsAfter,
        divergedAfter,
        commitVisible,
        reconciled: reconciledAny,
        uploaded: uploadedPaths,
        removedRemote: removedPaths,
        acknowledged,
        pendingDeletions: plan.pendingDeletions.map((entry) => ({
          path: entry.path,
          requiredFlag: entry.requiredFlag,
          current: entry.current,
        })),
        outOfSelectionPreserved: plan.outOfSelectionPreserved,
        note: buildPublishNote(commitId),
        localRecoveryOk: false,
        localRecoveryError: error instanceof Error ? error.message : String(error),
        dryRun: false,
      };
    }

    return {
      noop: false,
      published: true,
      commitId,
      parents: plan.parents,
      headsBefore,
      headsAfter,
      divergedAfter,
      commitVisible,
      reconciled: reconciledAny,
      uploaded: uploadedPaths,
      removedRemote: removedPaths,
      acknowledged,
      pendingDeletions: plan.pendingDeletions.map((entry) => ({
        path: entry.path,
        requiredFlag: entry.requiredFlag,
        current: entry.current,
      })),
      outOfSelectionPreserved: plan.outOfSelectionPreserved,
      note: buildPublishNote(commitId),
      localRecoveryOk: true,
      dryRun: false,
    };
  } finally {
    await lock.release();
  }
}
