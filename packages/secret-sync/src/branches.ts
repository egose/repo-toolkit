import { randomUUID } from 'node:crypto';

import { normalizeProjectRelPath, validateBranchName } from './config';
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
import { deriveBranchHeads } from './graph';
import { loadValidatedHistory, materializeTreeBytes, publishCommit } from './history-store';
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
  assertIdentityMatches,
  computeFileHmac,
  initState,
  normalizeOperationIdentity,
  readStateIfPresent,
  saveState,
  setActiveBranch,
  setBaseline,
  setMaterializedBranch,
  setObservedHeads,
  validateRemoteIdentity,
  validateStateRemote,
} from './state';
import { compareFile } from './status';
import type { SecretStore } from './store';
import {
  baselinesToSlots,
  createOperationId,
  loadBranchHistory,
  recheckHeads,
  resolveOperationConcurrency,
  resolveTimestamp,
  scanLocalSlots,
  writeOperationRecord,
} from './operations';

export interface BranchCreateOptions {
  store: SecretStore;
  rootAbsolute: string;
  projectId?: string;
  name: string;
  from?: string;
  message?: string;
  concurrency?: number;
  timestamp?: number;
  operationId?: string;
  commitId?: string;
  dryRun?: boolean;
  remote?: unknown;
  identity?: unknown;
}

export interface BranchCreateResult {
  created: boolean;
  branch: string;
  sourceBranch: string;
  commitId?: string;
  parents: string[];
  headsAfter: string[];
  reconciled: boolean;
  dryRun: boolean;
  note: string;
}

export interface BranchListEntry {
  branch: string;
  state: 'empty' | 'single' | 'diverged';
  heads: string[];
  commitCount: number;
}

export interface BranchListResult {
  branches: BranchListEntry[];
}

export interface SwitchHooks {
  beforeFile?: (path: string) => void | Promise<void>;
  beforeStateSave?: () => void | Promise<void>;
}

export interface SwitchOptions {
  store: SecretStore;
  rootAbsolute: string;
  projectId?: string;
  targetBranch: string;
  endpoint?: string;
  vaultId?: string;
  remote?: unknown;
  identity?: unknown;
  concurrency?: number;
  timestamp?: number;
  operationId?: string;
  dryRun?: boolean;
  maxFileBytes?: number;
  hooks?: SwitchHooks;
}

export interface SwitchResult {
  switched: boolean;
  noop: boolean;
  from: string;
  to: string;
  downloaded: string[];
  removedLocal: string[];
  acknowledged: string[];
  heads: string[];
  resumedFromJournal: boolean;
  dryRun: boolean;
  note: string;
}

function assertProjectId(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SecretSyncError('validation', `${what} project id must be a non-empty string.`);
  }
  return value;
}

function resolveMetadataProjectId(
  options: { projectId?: unknown; remote?: unknown; identity?: unknown },
  what: string,
): string {
  const hasIdentity = options.identity !== undefined;
  const hasRemote = options.remote !== undefined;
  const hasProject = options.projectId !== undefined;
  if (hasIdentity) {
    if (hasRemote || hasProject) {
      throw new SecretSyncError('validation', 'Operation identity mixes old and new identity forms.');
    }
    return validateRemoteIdentity(options.identity).projectId;
  }
  if (hasRemote) {
    if (hasProject === false) {
      throw new SecretSyncError('validation', 'Operation remote binding requires a project id.');
    }
    validateStateRemote(options.remote);
    return assertProjectId(options.projectId, what);
  }
  return assertProjectId(options.projectId, what);
}

function assertCommitId(value: string): string {
  const pattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!pattern.test(value)) {
    throw new SecretSyncError('validation', 'Branch commit id must be a UUID string.');
  }
  return value;
}

export async function createBranch(options: BranchCreateOptions): Promise<BranchCreateResult> {
  const branch = validateBranchName(options.name);
  const sourceBranch = options.from === undefined ? 'main' : validateBranchName(options.from);
  const projectId = resolveMetadataProjectId(options, 'Branch create');
  const concurrency = resolveOperationConcurrency(options.concurrency);
  const timestamp = resolveTimestamp(options.timestamp);
  const dryRun = options.dryRun === true;
  if (branch === sourceBranch) {
    const history = await loadValidatedHistory(options.store, projectId, { concurrency });
    const existing = deriveBranchHeads(history.commits, branch);
    if (existing.length > 0) {
      throw new SecretSyncError('validation', `Branch ${JSON.stringify(branch)} already exists.`);
    }
  }
  const history = await loadValidatedHistory(options.store, projectId, { concurrency });
  const sourceHeads = deriveBranchHeads(history.commits, sourceBranch);
  if (sourceHeads.length > 1) {
    throw new SecretSyncError(
      'remote-diverged',
      `Branch ${JSON.stringify(sourceBranch)} has multiple heads; resolve the fork before branching.`,
    );
  }
  const targetHeads = branch === sourceBranch ? sourceHeads : deriveBranchHeads(history.commits, branch);
  if (targetHeads.length > 0) {
    throw new SecretSyncError('validation', `Branch ${JSON.stringify(branch)} already exists.`);
  }
  const sourceHead = sourceHeads[0];
  const tree = sourceHead === undefined ? [] : sourceHead.tree.map((entry) => ({ ...entry }));
  const parents = sourceHead === undefined ? [] : [sourceHead.logicalId];
  if (dryRun) {
    return {
      created: false,
      branch,
      sourceBranch,
      parents,
      headsAfter: [],
      reconciled: false,
      dryRun: true,
      note: 'Dry run: reads permitted; no remote or local writes were performed.',
    };
  }
  const operationId = createOperationId(options.operationId);
  const commitId = options.commitId === undefined ? randomUUID() : assertCommitId(options.commitId);
  await writeOperationRecord(options.rootAbsolute, {
    schemaVersion: 1,
    operationId,
    kind: 'branch',
    branch,
    commitId,
    blobIds: {},
    timestamp,
    ...(options.message === undefined ? {} : { message: options.message }),
  });
  await recheckHeads(
    options.store,
    projectId,
    sourceBranch,
    sourceHeads.map((head) => head.logicalId),
    concurrency,
  );
  const published = await publishCommit(
    options.store,
    projectId,
    {
      branch,
      parents,
      tree,
      timestamp,
      ...(options.message === undefined ? {} : { message: options.message }),
      operationId,
      operationKind: 'branch',
    },
    { logicalId: commitId },
  );
  const after = await loadBranchHistory(options.store, projectId, branch, concurrency);
  return {
    created: true,
    branch,
    sourceBranch,
    commitId,
    parents,
    headsAfter: after.headIds,
    reconciled: published.reconciled,
    dryRun: false,
    note:
      `Branch ${JSON.stringify(branch)} was created metadata-only from ${JSON.stringify(sourceBranch)} ` +
      `on the configured endpoint and vault; no file bytes were copied and the source head is unchanged.`,
  };
}

export async function listBranches(
  store: SecretStore,
  projectId: string,
  concurrency?: number,
): Promise<BranchListResult> {
  const resolvedProject = assertProjectId(projectId, 'Branch list');
  const history = await loadValidatedHistory(store, resolvedProject, {
    concurrency: resolveOperationConcurrency(concurrency),
  });
  const names = new Set<string>();
  for (const commit of history.commits.values()) {
    names.add(commit.branch);
  }
  const branches: BranchListEntry[] = [];
  for (const name of [...names].sort()) {
    const heads = deriveBranchHeads(history.commits, name);
    let commitCount = 0;
    for (const commit of history.commits.values()) {
      if (commit.branch === name) {
        commitCount += 1;
      }
    }
    branches.push({
      branch: name,
      state: heads.length <= 1 ? 'single' : 'diverged',
      heads: heads.map((head) => head.logicalId).sort(),
      commitCount,
    });
  }
  return { branches };
}

export async function switchBranch(options: SwitchOptions): Promise<SwitchResult> {
  const targetBranch = validateBranchName(options.targetBranch);
  const identity = normalizeOperationIdentity({
    endpoint: options.endpoint,
    vaultId: options.vaultId,
    projectId: options.projectId,
    remote: options.remote,
    identity: options.identity,
  });
  const projectId = identity.projectId;
  const concurrency = resolveOperationConcurrency(options.concurrency);
  const timestamp = resolveTimestamp(options.timestamp);
  const dryRun = options.dryRun === true;

  if (dryRun) {
    const prior = await readStateIfPresent(options.rootAbsolute);
    if (prior !== undefined) {
      assertIdentityMatches(identity, prior);
    }
    const history = await loadValidatedHistory(options.store, projectId, { concurrency });
    const targetHeads = deriveBranchHeads(history.commits, targetBranch);
    if (targetHeads.length > 1) {
      throw new SecretSyncError('remote-diverged', `Branch ${JSON.stringify(targetBranch)} has multiple heads.`);
    }
    const target = targetHeads[0];
    const targetBytes =
      target === undefined ? new Map<string, Uint8Array>() : materializeTreeBytes(history, target.logicalId);
    const tracked = new Set<string>([
      ...(prior === undefined ? [] : Object.keys(prior.baselines)),
      ...targetBytes.keys(),
    ]);
    if (target !== undefined) {
      for (const entry of target.tree) {
        tracked.add(entry.path);
      }
    }
    const ordered = [...tracked].sort();
    const scanned = await scanLocalSlots(
      (path) => readFileBounded(options.rootAbsolute, path, { maxFileBytes: options.maxFileBytes }),
      ordered,
    );
    const downloaded: string[] = [];
    const removedLocal: string[] = [];
    for (const path of ordered) {
      const wanted = targetBytes.get(path);
      const local = scanned.bytes.get(path);
      if (wanted !== undefined) {
        if (local === undefined || sha256Hex(local) !== sha256Hex(wanted)) {
          downloaded.push(path);
        }
        continue;
      }
      if (local !== undefined) {
        removedLocal.push(path);
      }
    }
    downloaded.sort();
    removedLocal.sort();
    return {
      switched: false,
      noop: downloaded.length === 0 && removedLocal.length === 0,
      from: prior === undefined ? '(uninitialized)' : prior.activeBranch,
      to: targetBranch,
      downloaded,
      removedLocal,
      acknowledged: [],
      heads: targetHeads.map((head) => head.logicalId).sort(),
      resumedFromJournal: false,
      dryRun: true,
      note: 'Dry run: reads permitted; no remote or local writes were performed.',
    };
  }

  const lock = await acquireStateLock(options.rootAbsolute);
  try {
    const state = await initState(options.rootAbsolute, identity, { branch: targetBranch });
    const from = state.activeBranch;
    const history = await loadValidatedHistory(options.store, projectId, { concurrency });
    const currentHeads = deriveBranchHeads(history.commits, from);
    if (currentHeads.length > 1) {
      throw new SecretSyncError(
        'remote-diverged',
        `Branch ${JSON.stringify(from)} has multiple heads; resolve the fork before switching.`,
      );
    }
    const currentHead = currentHeads[0];
    const targetHeads = deriveBranchHeads(history.commits, targetBranch);
    if (targetHeads.length > 1) {
      throw new SecretSyncError('remote-diverged', `Branch ${JSON.stringify(targetBranch)} has multiple heads.`);
    }
    const targetHead = targetHeads[0];
    const currentTree = new Map(
      (currentHead === undefined ? [] : currentHead.tree).map((entry) => [entry.path, entry]),
    );
    const targetBytes =
      targetHead === undefined ? new Map<string, Uint8Array>() : materializeTreeBytes(history, targetHead.logicalId);
    const targetTree = new Map((targetHead === undefined ? [] : targetHead.tree).map((entry) => [entry.path, entry]));

    const operationId = createOperationId(options.operationId);
    await writeOperationRecord(options.rootAbsolute, {
      schemaVersion: 1,
      operationId,
      kind: 'pull',
      branch: targetBranch,
      commitId: targetHead === undefined ? operationId : targetHead.logicalId,
      blobIds: {},
      timestamp,
    });

    const recovery = await recoverJournal(options.rootAbsolute, state.localKey);
    const resumedFromJournal = recovery.verified.length > 0 || recovery.pending.length > 0;

    const baselines = baselinesToSlots(state.baselines, history.blobs);
    const candidates = new Set<string>([...Object.keys(state.baselines), ...currentTree.keys(), ...targetTree.keys()]);
    const ordered = [...candidates].sort();
    const scanned = await scanLocalSlots(
      (path) => readFileBounded(options.rootAbsolute, path, { maxFileBytes: options.maxFileBytes }),
      ordered,
    );
    for (const path of ordered) {
      normalizeProjectRelPath(path, 'worktree path');
      const baseline = baselines.get(path) ?? { state: 'unknown' as const };
      const local = scanned.slots.get(path) ?? { state: 'absent' as const };
      const remoteEntry = currentTree.get(path);
      const remote =
        remoteEntry === undefined
          ? { state: 'absent' as const }
          : {
              state: 'present' as const,
              fingerprint: {
                sha256: remoteEntry.sha256,
                byteLength: remoteEntry.byteLength,
                blobId: remoteEntry.blobId,
              },
            };
      const status = compareFile(baseline, local, remote);
      if (status !== 'clean') {
        throw new SecretSyncError(
          'local-changed',
          `Refusing switch with local drift at ${JSON.stringify(path)} (observed ${status}); restore or sync a clean worktree first.`,
        );
      }
    }

    if (from === targetBranch) {
      const heads = targetHeads.map((head) => head.logicalId).sort();
      setObservedHeads(state, targetBranch, heads);
      await saveState(options.rootAbsolute, state);
      return {
        switched: false,
        noop: true,
        from,
        to: targetBranch,
        downloaded: [],
        removedLocal: [],
        acknowledged: [...ordered],
        heads,
        resumedFromJournal,
        dryRun: false,
        note: `Already on branch ${JSON.stringify(targetBranch)} with a clean worktree; the active branch is unchanged.`,
      };
    }

    const downloads: string[] = [];
    const removals: string[] = [];
    for (const path of ordered) {
      const wanted = targetBytes.get(path);
      const local = scanned.bytes.get(path);
      if (wanted !== undefined) {
        if (local === undefined || sha256Hex(local) !== sha256Hex(wanted)) {
          downloads.push(path);
        }
        continue;
      }
      if (local !== undefined) {
        const baseline = baselines.get(path);
        const inCurrent = currentTree.has(path);
        const inTarget = targetTree.has(path);
        if (baseline !== undefined || inCurrent || inTarget) {
          removals.push(path);
        }
      }
    }
    downloads.sort();
    removals.sort();
    assertNoCaseCollision([...downloads, ...removals]);
    for (const path of [...downloads, ...removals]) {
      resolveSafeDestination(options.rootAbsolute, path);
      await assertAncestorDirsSafe(options.rootAbsolute, path);
      const kind = await checkDestinationKind(resolveSafeDestination(options.rootAbsolute, path));
      if (kind === 'symlink' || kind === 'special') {
        throw new SecretSyncError(
          'unsafe-path',
          `Refusing switch over a symlink or special file at ${JSON.stringify(path)}.`,
        );
      }
      if (kind === 'directory') {
        throw new SecretSyncError('unsafe-path', `Refusing switch over a directory at ${JSON.stringify(path)}.`);
      }
    }

    const downloaded: string[] = [];
    const removedLocal: string[] = [];
    for (const path of downloads) {
      const bytes = targetBytes.get(path) as Uint8Array;
      const expectedHmac = computeFileHmac(bytes, state.localKey);
      const entry = await appendJournalEntry(options.rootAbsolute, {
        opId: operationId,
        path,
        kind: 'write',
        byteLength: bytes.byteLength,
        hmac: expectedHmac,
        timestamp,
      });
      if (options.hooks?.beforeFile !== undefined) {
        await options.hooks.beforeFile(path);
      }
      const guarded = await readFileBounded(options.rootAbsolute, path, { maxFileBytes: options.maxFileBytes });
      const planned = scanned.bytes.get(path);
      const plannedHmac = planned === undefined ? undefined : computeFileHmac(planned, state.localKey);
      const guardedHmac = guarded === undefined ? undefined : computeFileHmac(guarded, state.localKey);
      if (plannedHmac !== guardedHmac) {
        throw new SecretSyncError(
          'local-changed',
          `Refusing switch after an unexpected concurrent local edit of ${JSON.stringify(path)}.`,
        );
      }
      if (guardedHmac === expectedHmac) {
        await markJournalStatus(options.rootAbsolute, entry.seq, 'written');
        downloaded.push(path);
        continue;
      }
      await writeFileAtomically(options.rootAbsolute, path, bytes, { maxFileBytes: options.maxFileBytes });
      const verify = await readFileBounded(options.rootAbsolute, path, { maxFileBytes: options.maxFileBytes });
      if (verify === undefined || computeFileHmac(verify, state.localKey) !== expectedHmac) {
        throw new SecretSyncError(
          'local-changed',
          `Switch verification failed after replacement of ${JSON.stringify(path)}.`,
        );
      }
      await markJournalStatus(options.rootAbsolute, entry.seq, 'written');
      downloaded.push(path);
    }
    for (const path of removals) {
      const planned = scanned.bytes.get(path);
      const entry = await appendJournalEntry(options.rootAbsolute, {
        opId: operationId,
        path,
        kind: 'remove',
        timestamp,
      });
      if (options.hooks?.beforeFile !== undefined) {
        await options.hooks.beforeFile(path);
      }
      const guarded = await readFileBounded(options.rootAbsolute, path, { maxFileBytes: options.maxFileBytes });
      const expected = planned === undefined ? undefined : computeFileHmac(planned, state.localKey);
      const guardedHmac = guarded === undefined ? undefined : computeFileHmac(guarded, state.localKey);
      if (guarded === undefined) {
        await markJournalStatus(options.rootAbsolute, entry.seq, 'written');
        removedLocal.push(path);
        continue;
      }
      if (guardedHmac !== expected) {
        throw new SecretSyncError(
          'local-changed',
          `Refusing switch removal after an unexpected concurrent local edit of ${JSON.stringify(path)}.`,
        );
      }
      await removeFileGuarded(options.rootAbsolute, path, {
        expectedHmac: expected as string,
        expectedByteLength: (planned as Uint8Array).byteLength,
        localKey: state.localKey,
      });
      await markJournalStatus(options.rootAbsolute, entry.seq, 'written');
      removedLocal.push(path);
    }

    const acknowledged: string[] = [];
    for (const path of ordered) {
      const wanted = targetBytes.get(path);
      const targetEntry = targetTree.get(path);
      const current = await readFileBounded(options.rootAbsolute, path, { maxFileBytes: options.maxFileBytes });
      if (wanted !== undefined && targetEntry !== undefined) {
        if (current === undefined || sha256Hex(current) !== sha256Hex(wanted)) {
          throw new SecretSyncError(
            'local-changed',
            `Refusing switch after an unexpected concurrent local edit of ${JSON.stringify(path)}.`,
          );
        }
        setBaseline(state, path, {
          state: 'present',
          hmac: computeFileHmac(wanted, state.localKey),
          byteLength: wanted.byteLength,
          blobId: targetEntry.blobId,
          ...(targetHead === undefined ? {} : { commitId: targetHead.logicalId }),
        });
        acknowledged.push(path);
        continue;
      }
      if (wanted === undefined) {
        if (current !== undefined) {
          throw new SecretSyncError(
            'local-changed',
            `Refusing switch after an unexpected concurrent local edit of ${JSON.stringify(path)}.`,
          );
        }
        setBaseline(state, path, { state: 'absent' });
        acknowledged.push(path);
      }
    }
    acknowledged.sort();
    setObservedHeads(state, targetBranch, targetHeads.map((head) => head.logicalId).sort());
    setActiveBranch(state, targetBranch);
    setMaterializedBranch(state, targetBranch);
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
      switched: true,
      noop: false,
      from,
      to: targetBranch,
      downloaded: downloaded.sort(),
      removedLocal: removedLocal.sort(),
      acknowledged,
      heads: targetHeads.map((head) => head.logicalId).sort(),
      resumedFromJournal,
      dryRun: false,
      note:
        `Switched from ${JSON.stringify(from)} to ${JSON.stringify(targetBranch)} through guarded per-file replacement ` +
        `on the configured root; the active branch was persisted only after every write completed.`,
    };
  } finally {
    await lock.release();
  }
}
