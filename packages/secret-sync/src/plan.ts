import { normalizeProjectRelPath, validateBranchName } from './config';
import { SecretSyncError, type SecretSyncErrorCode } from './errors';
import type { CommitEnvelope } from './records';
import {
  compareFile,
  type BaselineSlot,
  type FileStatus,
  type LocalSlot,
  type RemoteSlot,
  type SlotMap,
} from './status';

export type SyncDirection = 'push' | 'pull';

export interface PlanOptions {
  direction: SyncDirection;
  branch: string;
  selection?: string[];
  allowDelete?: boolean;
  dryRun?: boolean;
}

export interface PlanSnapshots {
  baselines: SlotMap<BaselineSlot>;
  locals: SlotMap<LocalSlot>;
  heads: ReadonlyArray<CommitEnvelope>;
  remoteError?: unknown;
}

export type PlannedAction =
  | { kind: 'upload'; path: string; byteLength: number; sha256: string }
  | { kind: 'delete-remote'; path: string }
  | { kind: 'download'; path: string; blobId: string; byteLength: number; sha256: string }
  | { kind: 'delete-local'; path: string };

export interface PendingDeletion {
  path: string;
  direction: SyncDirection;
  requiredFlag: '--delete';
  current: 'local-deleted' | 'remote-deleted';
}

export interface ResultingTreeEntry {
  path: string;
  blobId?: string;
  sha256: string;
  byteLength: number;
  source: 'local' | 'remote' | 'preserved';
}

export interface SyncPlan {
  direction: SyncDirection;
  branch: string;
  parents: string[];
  heads: string[];
  selected: string[];
  actions: PlannedAction[];
  pendingDeletions: PendingDeletion[];
  conflicts: string[];
  outOfSelectionPreserved: string[];
  resultingTree: ResultingTreeEntry[];
  commitNeeded: boolean;
  noop: boolean;
  dryRun: boolean;
}

export interface SyncEffects {
  writeRemote?: (path: string) => void;
  writeLocal?: (path: string) => void;
  lock?: (scope: string) => void;
  updateState?: (path: string) => void;
}

interface RemoteTreeEntry {
  blobId: string;
  sha256: string;
  byteLength: number;
}

export function deriveRemoteTree(head: CommitEnvelope | undefined): Map<string, RemoteTreeEntry> {
  const tree = new Map<string, RemoteTreeEntry>();
  if (head === undefined) {
    return tree;
  }
  for (const entry of head.tree) {
    tree.set(entry.path, { blobId: entry.blobId, sha256: entry.sha256, byteLength: entry.byteLength });
  }
  return tree;
}

export function requireSingleBranchHead(
  heads: ReadonlyArray<CommitEnvelope>,
  branch: string,
): CommitEnvelope | undefined {
  const scoped = heads
    .filter((head) => head.branch === branch)
    .sort((left, right) => (left.logicalId < right.logicalId ? -1 : left.logicalId > right.logicalId ? 1 : 0));
  if (scoped.length > 1) {
    throw new SecretSyncError('remote-diverged', `Branch ${JSON.stringify(branch)} has multiple heads.`);
  }
  const head = scoped[0];
  return head === undefined ? undefined : head;
}

function readSlot<T>(map: SlotMap<T>, path: string): T | undefined {
  if (map instanceof Map) {
    return map.get(path);
  }
  if (Object.prototype.hasOwnProperty.call(map, path)) {
    return (map as Record<string, T>)[path];
  }
  return undefined;
}

function unionSnapshotPaths(
  baselines: SlotMap<BaselineSlot>,
  locals: SlotMap<LocalSlot>,
  remoteTree: ReadonlyMap<string, RemoteTreeEntry>,
): string[] {
  const paths = new Set<string>();
  const collect = (map: SlotMap<unknown>): void => {
    if (map instanceof Map) {
      for (const key of map.keys()) {
        paths.add(key);
      }
      return;
    }
    for (const key of Object.keys(map)) {
      paths.add(key);
    }
  };
  collect(baselines);
  collect(locals);
  for (const key of remoteTree.keys()) {
    paths.add(key);
  }
  return [...paths].sort();
}

function resolvePlanSelection(union: ReadonlyArray<string>, selection: ReadonlyArray<string> | undefined): string[] {
  if (selection === undefined) {
    return [...union];
  }
  const resolved = new Set<string>();
  for (const raw of selection) {
    resolved.add(normalizeProjectRelPath(raw, '--file'));
  }
  return [...resolved].sort();
}

function toRemoteSlot(entry: RemoteTreeEntry | undefined): RemoteSlot {
  if (entry === undefined) {
    return { state: 'absent' };
  }
  return {
    state: 'present',
    fingerprint: { sha256: entry.sha256, byteLength: entry.byteLength, blobId: entry.blobId },
  };
}

function statusOf(
  baselines: SlotMap<BaselineSlot>,
  locals: SlotMap<LocalSlot>,
  remoteTree: ReadonlyMap<string, RemoteTreeEntry>,
  path: string,
): { status: FileStatus; baseline: BaselineSlot; local: LocalSlot; remote: RemoteSlot } {
  const baseline = readSlot(baselines, path) ?? { state: 'unknown' as const };
  const local = readSlot(locals, path) ?? { state: 'absent' as const };
  const remote = toRemoteSlot(remoteTree.get(path));
  return { status: compareFile(baseline, local, remote), baseline, local, remote };
}

function throwOnSnapshotError(path: string, slot: LocalSlot): void {
  if (slot.state === 'error') {
    throw new SecretSyncError(slot.code as SecretSyncErrorCode, `${path}: ${slot.message}`);
  }
}

export function planSync(snapshots: PlanSnapshots, options: PlanOptions, effects?: SyncEffects): SyncPlan {
  void effects;
  if (snapshots.remoteError !== undefined) {
    throw snapshots.remoteError;
  }
  if (options.direction !== 'push' && options.direction !== 'pull') {
    throw new SecretSyncError('validation', `Unknown sync direction ${JSON.stringify(options.direction)}.`);
  }
  const branch = validateBranchName(options.branch);
  const head = requireSingleBranchHead(snapshots.heads, branch);
  const remoteTree = deriveRemoteTree(head);
  const parents = head === undefined ? [] : [head.logicalId];
  const heads = head === undefined ? [] : [head.logicalId];
  const union = unionSnapshotPaths(snapshots.baselines, snapshots.locals, remoteTree);
  const selected = resolvePlanSelection(union, options.selection);
  const allowDelete = options.allowDelete === true;
  const dryRun = options.dryRun === true;

  const statuses = new Map<string, FileStatus>();
  for (const path of selected) {
    const resolved = statusOf(snapshots.baselines, snapshots.locals, remoteTree, path);
    throwOnSnapshotError(path, resolved.local);
    throwOnSnapshotError(path, resolved.remote);
    statuses.set(path, resolved.status);
  }

  const conflicts: string[] = [];
  for (const path of selected) {
    const status = statuses.get(path) as FileStatus;
    if (status === 'conflict' || status === 'unbased-conflict') {
      conflicts.push(path);
    }
  }
  if (conflicts.length > 0) {
    throw new SecretSyncError(
      'validation',
      `Refusing to plan: selected paths include conflicts: ${conflicts.join(', ')}.`,
    );
  }

  const actions: PlannedAction[] = [];
  const pendingDeletions: PendingDeletion[] = [];
  const resulting = new Map<string, ResultingTreeEntry>();
  for (const [path, entry] of remoteTree) {
    resulting.set(path, {
      path,
      blobId: entry.blobId,
      sha256: entry.sha256,
      byteLength: entry.byteLength,
      source: 'remote',
    });
  }

  if (options.direction === 'push') {
    for (const path of selected) {
      const status = statuses.get(path) as FileStatus;
      const resolved = statusOf(snapshots.baselines, snapshots.locals, remoteTree, path);
      if (status === 'local-added' || status === 'local-modified') {
        const local = resolved.local;
        if (local.state !== 'present') {
          throw new SecretSyncError('validation', `Cannot upload ${JSON.stringify(path)} without local content.`);
        }
        actions.push({
          kind: 'upload',
          path,
          byteLength: local.fingerprint.byteLength,
          sha256: local.fingerprint.sha256,
        });
        resulting.set(path, {
          path,
          sha256: local.fingerprint.sha256,
          byteLength: local.fingerprint.byteLength,
          source: 'local',
        });
      } else if (status === 'local-deleted') {
        if (allowDelete) {
          actions.push({ kind: 'delete-remote', path });
          resulting.delete(path);
        } else {
          pendingDeletions.push({ path, direction: 'push', requiredFlag: '--delete', current: 'local-deleted' });
        }
      }
    }
  } else {
    for (const path of selected) {
      const status = statuses.get(path) as FileStatus;
      const remote = toRemoteSlot(remoteTree.get(path));
      if (status === 'remote-added' || status === 'remote-modified') {
        if (remote.state !== 'present') {
          throw new SecretSyncError('validation', `Cannot download ${JSON.stringify(path)} without remote content.`);
        }
        const blobId = remote.fingerprint.blobId;
        if (blobId === undefined) {
          throw new SecretSyncError('validation', `Remote entry for ${JSON.stringify(path)} is missing its blob id.`);
        }
        actions.push({
          kind: 'download',
          path,
          blobId,
          byteLength: remote.fingerprint.byteLength,
          sha256: remote.fingerprint.sha256,
        });
      } else if (status === 'remote-deleted') {
        if (allowDelete) {
          actions.push({ kind: 'delete-local', path });
        } else {
          pendingDeletions.push({ path, direction: 'pull', requiredFlag: '--delete', current: 'remote-deleted' });
        }
      }
    }
  }

  const selectedSet = new Set(selected);
  const outOfSelectionPreserved: string[] = [];
  for (const path of resulting.keys()) {
    if (!selectedSet.has(path) && remoteTree.has(path)) {
      const preserved = resulting.get(path) as ResultingTreeEntry;
      preserved.source = 'preserved';
      outOfSelectionPreserved.push(path);
    }
  }
  outOfSelectionPreserved.sort();

  const resultingTree = [...resulting.values()].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const commitNeeded = options.direction === 'push' && actions.length > 0;
  const noop = actions.length === 0;
  return {
    direction: options.direction,
    branch,
    parents,
    heads,
    selected,
    actions,
    pendingDeletions,
    conflicts,
    outOfSelectionPreserved,
    resultingTree,
    commitNeeded,
    noop,
    dryRun,
  };
}

export function isNoopPlan(plan: SyncPlan): boolean {
  return plan.noop;
}
