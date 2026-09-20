import { normalizeProjectRelPath } from './config';
import { SecretSyncError, type SecretSyncErrorCode } from './errors';
import type { BlobTreeEntry, CommitEnvelope } from './records';
import type { FileFingerprint, LocalSlot, RemoteSlot, SlotMap } from './status';

export interface DiffEntry {
  path: string;
  changed: boolean;
  localByteLength?: number;
  remoteByteLength?: number;
  localBlobId?: string;
  remoteBlobId?: string;
}

export interface DiffSummary {
  total: number;
  changed: number;
  unchanged: number;
}

function fingerprintOf(slot: LocalSlot): FileFingerprint | undefined {
  return slot.state === 'present' ? slot.fingerprint : undefined;
}

function sameContent(left: FileFingerprint | undefined, right: FileFingerprint | undefined): boolean {
  if (left === undefined && right === undefined) {
    return true;
  }
  if (left === undefined || right === undefined) {
    return false;
  }
  return left.sha256 === right.sha256 && left.byteLength === right.byteLength;
}

function toEntry(path: string, local: FileFingerprint | undefined, remote: FileFingerprint | undefined): DiffEntry {
  const entry: DiffEntry = { path, changed: !sameContent(local, remote) };
  if (local !== undefined) {
    entry.localByteLength = local.byteLength;
    if (local.blobId !== undefined) {
      entry.localBlobId = local.blobId;
    }
  }
  if (remote !== undefined) {
    entry.remoteByteLength = remote.byteLength;
    if (remote.blobId !== undefined) {
      entry.remoteBlobId = remote.blobId;
    }
  }
  return entry;
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

function throwOnErrorSlot(path: string, slot: LocalSlot): void {
  if (slot.state === 'error') {
    throw new SecretSyncError(slot.code as SecretSyncErrorCode, `${path}: ${slot.message}`);
  }
}

function unionDiffPaths(locals: SlotMap<LocalSlot>, remotes: SlotMap<RemoteSlot>): string[] {
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
  collect(locals);
  collect(remotes);
  return [...paths].sort();
}

function resolveDiffSelection(union: ReadonlyArray<string>, selection: ReadonlyArray<string> | undefined): string[] {
  if (selection === undefined) {
    return [...union];
  }
  const resolved = new Set<string>();
  for (const raw of selection) {
    resolved.add(normalizeProjectRelPath(raw, '--file'));
  }
  return [...resolved].sort();
}

export function diffSnapshots(
  locals: SlotMap<LocalSlot>,
  remotes: SlotMap<RemoteSlot>,
  selection?: ReadonlyArray<string>,
): DiffEntry[] {
  const union = unionDiffPaths(locals, remotes);
  const selected = resolveDiffSelection(union, selection);
  const entries: DiffEntry[] = [];
  for (const path of selected) {
    const local = readSlot(locals, path) ?? { state: 'absent' as const };
    const remote = readSlot(remotes, path) ?? { state: 'absent' as const };
    throwOnErrorSlot(path, local);
    throwOnErrorSlot(path, remote);
    if (local.state === 'absent' && remote.state === 'absent') {
      continue;
    }
    entries.push(toEntry(path, fingerprintOf(local), fingerprintOf(remote)));
  }
  return entries;
}

function indexTreeEntries(tree: ReadonlyArray<BlobTreeEntry>): Map<string, FileFingerprint> {
  const indexed = new Map<string, FileFingerprint>();
  for (const entry of tree) {
    indexed.set(entry.path, { sha256: entry.sha256, byteLength: entry.byteLength, blobId: entry.blobId });
  }
  return indexed;
}

export function diffCommits(left: CommitEnvelope, right: CommitEnvelope): DiffEntry[] {
  const leftTree = indexTreeEntries(left.tree);
  const rightTree = indexTreeEntries(right.tree);
  const paths = new Set<string>([...leftTree.keys(), ...rightTree.keys()]);
  const entries: DiffEntry[] = [];
  for (const path of [...paths].sort()) {
    entries.push(toEntry(path, leftTree.get(path), rightTree.get(path)));
  }
  return entries;
}

export function summarizeDiff(entries: ReadonlyArray<DiffEntry>): DiffSummary {
  let changed = 0;
  for (const entry of entries) {
    if (entry.changed) {
      changed += 1;
    }
  }
  return { total: entries.length, changed, unchanged: entries.length - changed };
}
