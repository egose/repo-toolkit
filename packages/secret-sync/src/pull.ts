import { validateBranchName } from './config';
import { SecretSyncError } from './errors';
import {
  assertAncestorDirsSafe,
  assertNoCaseCollision,
  checkDestinationKind,
  readFileBounded,
  removeFileGuarded,
  resolveSafeDestination,
  writeFileAtomically,
} from './filesystem';
import { materializeTreeBytes } from './history-store';
import { sha256Hex } from './records';
import {
  appendJournalEntry,
  clearAcknowledgedEntries,
  loadJournal,
  markJournalStatus,
  recoverJournal,
} from './journal';
import {
  acquireStateLock,
  computeFileHmac,
  initState,
  readStateIfPresent,
  saveState,
  setBaseline,
  setObservedHeads,
} from './state';
import { planSync } from './plan';
import type { LocalSlot } from './status';
import type { SecretStore } from './store';
import {
  baselinesToSlots,
  buildPullNote,
  createOperationId,
  loadBranchHistory,
  requireSingleOperationHead,
  resolveOperationConcurrency,
  resolveSyncCandidates,
  resolveTimestamp,
  scanLocalSlots,
  validateSizeBounds,
  writeOperationRecord,
} from './operations';

export interface PullHooks {
  beforeFile?: (path: string) => void | Promise<void>;
  beforeStateSave?: () => void | Promise<void>;
}

export interface PullOptions {
  store: SecretStore;
  rootAbsolute: string;
  projectId: string;
  branch: string;
  endpoint: string;
  vaultId: string;
  selection?: string[];
  allowDelete?: boolean;
  concurrency?: number;
  timestamp?: number;
  operationId?: string;
  dryRun?: boolean;
  maxFileBytes?: number;
  maxFiles?: number;
  hooks?: PullHooks;
}

export interface PullResult {
  noop: boolean;
  downloaded: string[];
  removedLocal: string[];
  acknowledged: string[];
  pendingDeletions: Array<{ path: string; requiredFlag: string; current: string }>;
  heads: string[];
  resumedFromJournal: boolean;
  note: string;
  stateSaved: boolean;
  dryRun: boolean;
}

function assertProjectId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SecretSyncError('validation', 'Pull project id must be a non-empty string.');
  }
  return value;
}

function slotHmac(slot: LocalSlot, bytes: Uint8Array | undefined, localKey: string): string | undefined {
  if (slot.state !== 'present' || bytes === undefined) {
    return undefined;
  }
  return computeFileHmac(bytes, localKey);
}

async function acknowledgeCleanPullPaths(
  rootAbsolute: string,
  localKey: string,
  apply: (
    path: string,
    baseline:
      | { state: 'absent' }
      | { state: 'present'; hmac: string; byteLength: number; blobId: string; commitId: string },
  ) => void,
  selected: ReadonlyArray<string>,
  skip: ReadonlySet<string>,
  headTree: ReadonlyMap<string, { blobId: string; sha256: string; byteLength: number }>,
  headCommitId: string,
  maxFileBytes: number,
): Promise<string[]> {
  const acknowledged: string[] = [];
  for (const path of selected) {
    if (skip.has(path)) {
      continue;
    }
    const remote = headTree.get(path);
    let current: Uint8Array | undefined;
    try {
      current = await readFileBounded(rootAbsolute, path, { maxFileBytes });
    } catch (error) {
      if (error instanceof SecretSyncError) {
        continue;
      }
      throw error;
    }
    if (current === undefined && remote === undefined) {
      apply(path, { state: 'absent' });
      acknowledged.push(path);
      continue;
    }
    if (current !== undefined && remote !== undefined) {
      if (current.byteLength === remote.byteLength && sha256Hex(current) === remote.sha256) {
        apply(path, {
          state: 'present',
          hmac: computeFileHmac(current, localKey),
          byteLength: current.byteLength,
          blobId: remote.blobId,
          commitId: headCommitId,
        });
        acknowledged.push(path);
      }
    }
  }
  return acknowledged;
}

export async function pullSecrets(options: PullOptions): Promise<PullResult> {
  const branch = validateBranchName(options.branch);
  const projectId = assertProjectId(options.projectId);
  const concurrency = resolveOperationConcurrency(options.concurrency);
  const bounds = validateSizeBounds(options.maxFileBytes, options.maxFiles);
  const allowDelete = options.allowDelete === true;
  const dryRun = options.dryRun === true;
  const timestamp = resolveTimestamp(options.timestamp);

  if (options.selection !== undefined && options.selection.length > bounds.maxFiles) {
    throw new SecretSyncError('too-large', 'Pull selection exceeds the configured file-count bound.');
  }

  if (dryRun) {
    const state = await readStateIfPresent(options.rootAbsolute);
    const loaded = await loadBranchHistory(options.store, projectId, branch, concurrency);
    requireSingleOperationHead(loaded.heads, branch);
    const remotePaths =
      loaded.heads.length === 0
        ? []
        : (loaded.heads[0] as { tree: Array<{ path: string }> }).tree.map((entry) => entry.path);
    const baselinePaths = state === undefined ? [] : Object.keys(state.baselines);
    const selected = await resolveSyncCandidates(options.rootAbsolute, options.selection, baselinePaths, remotePaths);
    const baselines = state === undefined ? new Map() : baselinesToSlots(state.baselines, loaded.history.blobs);
    const scanned = await scanLocalSlots(
      (path) => readFileBounded(options.rootAbsolute, path, { maxFileBytes: bounds.maxFileBytes }),
      selected,
    );
    const plan = planSync(
      { baselines, locals: scanned.slots, heads: loaded.heads },
      { direction: 'pull', branch, selection: selected, allowDelete, dryRun: true },
    );
    return {
      noop: plan.noop,
      downloaded: plan.actions.filter((action) => action.kind === 'download').map((action) => action.path),
      removedLocal: plan.actions.filter((action) => action.kind === 'delete-local').map((action) => action.path),
      acknowledged: [],
      pendingDeletions: plan.pendingDeletions.map((entry) => ({
        path: entry.path,
        requiredFlag: entry.requiredFlag,
        current: entry.current,
      })),
      heads: loaded.headIds,
      resumedFromJournal: false,
      note: 'Dry run: reads permitted; no remote or local writes were performed.',
      stateSaved: true,
      dryRun: true,
    };
  }

  const lock = await acquireStateLock(options.rootAbsolute);
  try {
    const state = await initState(
      options.rootAbsolute,
      { endpoint: options.endpoint, vaultId: options.vaultId, projectId },
      { branch },
    );
    const loaded = await loadBranchHistory(options.store, projectId, branch, concurrency);
    const head = requireSingleOperationHead(loaded.heads, branch);
    const heads = loaded.headIds;
    if (head === undefined) {
      setObservedHeads(state, branch, []);
      await saveState(options.rootAbsolute, state);
      return {
        noop: true,
        downloaded: [],
        removedLocal: [],
        acknowledged: [],
        pendingDeletions: [],
        heads,
        resumedFromJournal: false,
        note: `No-op pull on branch ${JSON.stringify(branch)}: remote has no commits and unrelated baselines left untouched.`,
        stateSaved: true,
        dryRun: false,
      };
    }
    const remotePaths = head.tree.map((entry) => entry.path);
    const selected = await resolveSyncCandidates(
      options.rootAbsolute,
      options.selection,
      Object.keys(state.baselines),
      remotePaths,
    );
    if (selected.length > bounds.maxFiles) {
      throw new SecretSyncError('too-large', 'Pull selection exceeds the configured file-count bound.');
    }
    const baselines = baselinesToSlots(state.baselines, loaded.history.blobs);
    const scanned = await scanLocalSlots(
      (path) => readFileBounded(options.rootAbsolute, path, { maxFileBytes: bounds.maxFileBytes }),
      selected,
    );
    const plan = planSync(
      { baselines, locals: scanned.slots, heads: loaded.heads },
      { direction: 'pull', branch, selection: selected, allowDelete },
    );

    if (plan.noop) {
      const skipNoop = new Set<string>(plan.pendingDeletions.map((entry) => entry.path));
      const treeNoop = new Map(head.tree.map((entry) => [entry.path, entry]));
      const cleanNoop = await acknowledgeCleanPullPaths(
        options.rootAbsolute,
        state.localKey,
        (path, baseline) => setBaseline(state, path, baseline),
        plan.selected,
        skipNoop,
        treeNoop,
        head.logicalId,
        bounds.maxFileBytes,
      );
      setObservedHeads(state, branch, heads);
      await saveState(options.rootAbsolute, state);
      return {
        noop: true,
        downloaded: [],
        removedLocal: [],
        acknowledged: cleanNoop.sort(),
        pendingDeletions: plan.pendingDeletions.map((entry) => ({
          path: entry.path,
          requiredFlag: entry.requiredFlag,
          current: entry.current,
        })),
        heads,
        resumedFromJournal: false,
        note: `No-op pull on branch ${JSON.stringify(branch)}: no downloads needed and unrelated baselines left untouched.`,
        stateSaved: true,
        dryRun: false,
      };
    }

    const downloads = plan.actions.filter((action) => action.kind === 'download');
    const removals = plan.actions.filter((action) => action.kind === 'delete-local');
    const downloadBytes = materializeTreeBytes(loaded.history, head.logicalId);
    for (const action of downloads) {
      if (action.kind !== 'download') {
        continue;
      }
      const bytes = downloadBytes.get(action.path);
      if (bytes === undefined) {
        throw new SecretSyncError('remote-incomplete', `Remote bytes for ${JSON.stringify(action.path)} are missing.`);
      }
      if (bytes.byteLength !== action.byteLength) {
        throw new SecretSyncError('remote-corrupt', `Remote bytes disagree for ${JSON.stringify(action.path)}.`);
      }
      if (bytes.byteLength > bounds.maxFileBytes) {
        throw new SecretSyncError(
          'too-large',
          `Remote file ${JSON.stringify(action.path)} exceeds the per-file bound.`,
        );
      }
    }
    assertNoCaseCollision([...downloads.map((action) => action.path), ...removals.map((action) => action.path)]);
    for (const action of [...downloads, ...removals]) {
      resolveSafeDestination(options.rootAbsolute, action.path);
      await assertAncestorDirsSafe(options.rootAbsolute, action.path);
      const absolute = resolveSafeDestination(options.rootAbsolute, action.path);
      const kind = await checkDestinationKind(absolute);
      if (kind === 'symlink' || kind === 'special') {
        throw new SecretSyncError(
          'unsafe-path',
          `Refusing pull over a symlink or special file at ${JSON.stringify(action.path)}.`,
        );
      }
      if (kind === 'directory') {
        throw new SecretSyncError('unsafe-path', `Refusing pull over a directory at ${JSON.stringify(action.path)}.`);
      }
    }

    const operationId = createOperationId(options.operationId);
    await writeOperationRecord(options.rootAbsolute, {
      schemaVersion: 1,
      operationId,
      kind: 'pull',
      branch,
      commitId: head.logicalId,
      blobIds: {},
      timestamp,
    });

    const recovery = await recoverJournal(options.rootAbsolute, state.localKey);
    const resumedFromJournal = recovery.verified.length > 0 || recovery.pending.length > 0;

    const downloaded: string[] = [];
    const removedLocal: string[] = [];
    const acknowledged: string[] = [];

    for (const action of [...downloads].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    )) {
      if (action.kind !== 'download') {
        continue;
      }
      const bytes = downloadBytes.get(action.path) as Uint8Array;
      const expectedHmac = computeFileHmac(bytes, state.localKey);
      const planSlot = scanned.slots.get(action.path) ?? { state: 'absent' as const };
      const planBytes = scanned.bytes.get(action.path);
      const planHmac = planSlot.state === 'present' ? slotHmac(planSlot, planBytes, state.localKey) : undefined;
      const current = await readFileBounded(options.rootAbsolute, action.path, { maxFileBytes: bounds.maxFileBytes });
      if (
        current !== undefined &&
        current.byteLength === bytes.byteLength &&
        computeFileHmac(current, state.localKey) === expectedHmac
      ) {
        downloaded.push(action.path);
        acknowledged.push(action.path);
        setBaseline(state, action.path, {
          state: 'present',
          hmac: expectedHmac,
          byteLength: bytes.byteLength,
          blobId: action.blobId,
          commitId: head.logicalId,
        });
        continue;
      }
      const entry = await appendJournalEntry(options.rootAbsolute, {
        opId: operationId,
        path: action.path,
        kind: 'write',
        byteLength: bytes.byteLength,
        hmac: expectedHmac,
        blobId: action.blobId,
        timestamp,
      });
      if (options.hooks?.beforeFile !== undefined) {
        await options.hooks.beforeFile(action.path);
      }
      const guarded = await readFileBounded(options.rootAbsolute, action.path, { maxFileBytes: bounds.maxFileBytes });
      const guardedHmac = guarded === undefined ? undefined : computeFileHmac(guarded, state.localKey);
      if (planSlot.state === 'present') {
        if (guardedHmac !== planHmac) {
          throw new SecretSyncError(
            'local-changed',
            `Refusing pull over an unexpected concurrent local edit of ${JSON.stringify(action.path)}.`,
          );
        }
      } else if (planSlot.state === 'absent') {
        if (guarded !== undefined && guardedHmac !== expectedHmac) {
          throw new SecretSyncError(
            'local-changed',
            `Refusing pull over an unexpected concurrent local edit of ${JSON.stringify(action.path)}.`,
          );
        }
        if (guardedHmac === expectedHmac) {
          await markJournalStatus(options.rootAbsolute, entry.seq, 'written');
          downloaded.push(action.path);
          acknowledged.push(action.path);
          setBaseline(state, action.path, {
            state: 'present',
            hmac: expectedHmac,
            byteLength: bytes.byteLength,
            blobId: action.blobId,
            commitId: head.logicalId,
          });
          continue;
        }
      }
      await writeFileAtomically(options.rootAbsolute, action.path, bytes, { maxFileBytes: bounds.maxFileBytes });
      const verify = await readFileBounded(options.rootAbsolute, action.path, { maxFileBytes: bounds.maxFileBytes });
      if (verify === undefined || computeFileHmac(verify, state.localKey) !== expectedHmac) {
        throw new SecretSyncError(
          'local-changed',
          `Pull verification failed after replacement of ${JSON.stringify(action.path)}.`,
        );
      }
      await markJournalStatus(options.rootAbsolute, entry.seq, 'written');
      downloaded.push(action.path);
      acknowledged.push(action.path);
      setBaseline(state, action.path, {
        state: 'present',
        hmac: expectedHmac,
        byteLength: bytes.byteLength,
        blobId: action.blobId,
        commitId: head.logicalId,
      });
    }

    for (const action of [...removals].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    )) {
      if (action.kind !== 'delete-local') {
        continue;
      }
      const planSlot = scanned.slots.get(action.path) ?? { state: 'absent' as const };
      if (planSlot.state === 'absent') {
        removedLocal.push(action.path);
        acknowledged.push(action.path);
        setBaseline(state, action.path, { state: 'absent' });
        continue;
      }
      if (planSlot.state === 'error') {
        throw new SecretSyncError(planSlot.code as 'local-changed', `${action.path}: ${planSlot.message}`);
      }
      const entry = await appendJournalEntry(options.rootAbsolute, {
        opId: operationId,
        path: action.path,
        kind: 'remove',
        timestamp,
      });
      if (options.hooks?.beforeFile !== undefined) {
        await options.hooks.beforeFile(action.path);
      }
      const guarded = await readFileBounded(options.rootAbsolute, action.path, { maxFileBytes: bounds.maxFileBytes });
      const planBytes = scanned.bytes.get(action.path);
      const expected = planBytes === undefined ? undefined : computeFileHmac(planBytes, state.localKey);
      const guardedHmac = guarded === undefined ? undefined : computeFileHmac(guarded, state.localKey);
      if (guarded === undefined) {
        await markJournalStatus(options.rootAbsolute, entry.seq, 'written');
        removedLocal.push(action.path);
        acknowledged.push(action.path);
        setBaseline(state, action.path, { state: 'absent' });
        continue;
      }
      if (guardedHmac !== expected) {
        throw new SecretSyncError(
          'local-changed',
          `Refusing pull removal after an unexpected concurrent local edit of ${JSON.stringify(action.path)}.`,
        );
      }
      await removeFileGuarded(options.rootAbsolute, action.path, {
        expectedHmac: expected as string,
        expectedByteLength: (planBytes as Uint8Array).byteLength,
        localKey: state.localKey,
      });
      await markJournalStatus(options.rootAbsolute, entry.seq, 'written');
      removedLocal.push(action.path);
      acknowledged.push(action.path);
      setBaseline(state, action.path, { state: 'absent' });
    }

    downloaded.sort();
    removedLocal.sort();
    acknowledged.sort();
    const actedPaths = new Set<string>([
      ...downloaded,
      ...removedLocal,
      ...plan.pendingDeletions.map((entry) => entry.path),
    ]);
    const headTree = new Map(head.tree.map((entry) => [entry.path, entry]));
    const cleanAck = await acknowledgeCleanPullPaths(
      options.rootAbsolute,
      state.localKey,
      (path, baseline) => setBaseline(state, path, baseline),
      plan.selected,
      actedPaths,
      headTree,
      head.logicalId,
      bounds.maxFileBytes,
    );
    for (const path of cleanAck) {
      acknowledged.push(path);
    }
    acknowledged.sort();
    setObservedHeads(state, branch, heads);
    if (options.hooks?.beforeStateSave !== undefined) {
      await saveState(options.rootAbsolute, state, { hooks: { beforeRename: options.hooks.beforeStateSave } });
    } else {
      await saveState(options.rootAbsolute, state);
    }
    await clearAcknowledgedEntries(options.rootAbsolute);
    const acknowledgedPaths = new Set(acknowledged);
    const journal = await loadJournal(options.rootAbsolute);
    for (const record of journal) {
      if ((record.status === 'written' || record.status === 'pending') && acknowledgedPaths.has(record.path)) {
        await markJournalStatus(options.rootAbsolute, record.seq, 'acknowledged');
      }
    }
    await clearAcknowledgedEntries(options.rootAbsolute);

    return {
      noop: false,
      downloaded,
      removedLocal,
      acknowledged,
      pendingDeletions: plan.pendingDeletions.map((entry) => ({
        path: entry.path,
        requiredFlag: entry.requiredFlag,
        current: entry.current,
      })),
      heads,
      resumedFromJournal,
      note: buildPullNote(downloaded.length, removedLocal.length),
      stateSaved: true,
      dryRun: false,
    };
  } finally {
    await lock.release();
  }
}
