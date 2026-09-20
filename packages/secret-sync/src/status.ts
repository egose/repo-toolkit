import { normalizeProjectRelPath, validateBranchName } from './config';

export interface FileFingerprint {
  sha256: string;
  byteLength: number;
  blobId?: string;
}

export type BaselineSlot =
  | { state: 'unknown' }
  | { state: 'absent' }
  | { state: 'present'; fingerprint: FileFingerprint };

export type LocalSlot =
  | { state: 'absent' }
  | { state: 'present'; fingerprint: FileFingerprint }
  | { state: 'error'; code: string; message: string };

export type RemoteSlot = LocalSlot;

export type FileStatus =
  | 'clean'
  | 'local-added'
  | 'local-modified'
  | 'local-deleted'
  | 'remote-added'
  | 'remote-modified'
  | 'remote-deleted'
  | 'conflict'
  | 'unbased-conflict'
  | 'local-error'
  | 'remote-error';

export type SlotMap<T> = ReadonlyMap<string, T> | Record<string, T>;

export interface FileStatusEntry {
  path: string;
  status: FileStatus;
  baseline: 'unknown' | 'absent' | 'present';
  local: 'absent' | 'present' | 'error';
  remote: 'absent' | 'present' | 'error';
  baselineBlobId?: string;
  localByteLength?: number;
  localBlobId?: string;
  remoteByteLength?: number;
  remoteBlobId?: string;
}

export type HeadState = 'empty' | 'single' | 'diverged';

export interface BranchHeadSummary {
  branch: string;
  state: HeadState;
  heads: string[];
  activeBranch?: string;
  materializedBranch?: string;
  switched: boolean;
}

export interface StatusReport {
  branch: string;
  heads: string[];
  headState: HeadState;
  activeBranch?: string;
  materializedBranch?: string;
  switched: boolean;
  files: FileStatusEntry[];
  counts: Record<FileStatus, number>;
  clean: boolean;
  diverged: boolean;
  hasConflict: boolean;
  hasError: boolean;
  checkFailed: boolean;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function assertFingerprint(value: unknown): FileFingerprint {
  if (typeof value !== 'object' || value === null) {
    throw new Error('File fingerprint must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.sha256 !== 'string' || !SHA256_PATTERN.test(record.sha256)) {
    throw new Error('File fingerprint carries an invalid sha256 digest.');
  }
  if (typeof record.byteLength !== 'number' || !Number.isSafeInteger(record.byteLength) || record.byteLength < 0) {
    throw new Error('File fingerprint carries an invalid byteLength.');
  }
  if (record.blobId !== undefined && typeof record.blobId !== 'string') {
    throw new Error('File fingerprint carries an invalid blob id.');
  }
  const fingerprint: FileFingerprint = {
    sha256: record.sha256,
    byteLength: record.byteLength,
  };
  if (typeof record.blobId === 'string') {
    fingerprint.blobId = record.blobId;
  }
  return fingerprint;
}

export function assertBaselineSlot(value: unknown): BaselineSlot {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Baseline slot must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.state === 'unknown') {
    return { state: 'unknown' };
  }
  if (record.state === 'absent') {
    return { state: 'absent' };
  }
  if (record.state === 'present') {
    return { state: 'present', fingerprint: assertFingerprint(record.fingerprint) };
  }
  throw new Error('Baseline slot carries an unknown state.');
}

export function assertLocalSlot(value: unknown): LocalSlot {
  if (typeof value !== 'object' || value === null) {
    throw new Error('File slot must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.state === 'absent') {
    return { state: 'absent' };
  }
  if (record.state === 'present') {
    return { state: 'present', fingerprint: assertFingerprint(record.fingerprint) };
  }
  if (record.state === 'error') {
    if (typeof record.code !== 'string' || record.code.length === 0) {
      throw new Error('File error slot carries an invalid code.');
    }
    if (typeof record.message !== 'string' || record.message.length === 0) {
      throw new Error('File error slot carries an invalid message.');
    }
    return { state: 'error', code: record.code, message: record.message };
  }
  throw new Error('File slot carries an unknown state.');
}

function sameContent(left: FileFingerprint, right: FileFingerprint): boolean {
  return left.sha256 === right.sha256 && left.byteLength === right.byteLength;
}

type Side = { present: false } | { present: true; fingerprint: FileFingerprint };

function localSide(slot: LocalSlot): Side {
  if (slot.state === 'present') {
    return { present: true, fingerprint: slot.fingerprint };
  }
  return { present: false };
}

function baselineSide(slot: BaselineSlot): Side | undefined {
  if (slot.state === 'unknown') {
    return undefined;
  }
  if (slot.state === 'present') {
    return { present: true, fingerprint: slot.fingerprint };
  }
  return { present: false };
}

function sidesEqual(left: Side, right: Side): boolean {
  if (!left.present && !right.present) {
    return true;
  }
  if (left.present && right.present) {
    return sameContent(left.fingerprint, right.fingerprint);
  }
  return false;
}

export function compareFile(baseline: BaselineSlot, local: LocalSlot, remote: RemoteSlot): FileStatus {
  if (local.state === 'error') {
    return 'local-error';
  }
  if (remote.state === 'error') {
    return 'remote-error';
  }
  if (baseline.state === 'unknown') {
    if (local.state === 'absent' && remote.state === 'absent') {
      return 'clean';
    }
    if (local.state === 'absent') {
      return 'remote-added';
    }
    if (remote.state === 'absent') {
      return 'local-added';
    }
    return sameContent(local.fingerprint, remote.fingerprint) ? 'clean' : 'unbased-conflict';
  }
  const localAsSide = localSide(local);
  const remoteAsSide = localSide(remote);
  const baselineAsSide = baselineSide(baseline) as Side;
  if (sidesEqual(localAsSide, remoteAsSide)) {
    return 'clean';
  }
  if (sidesEqual(remoteAsSide, baselineAsSide)) {
    if (local.state === 'absent') {
      return 'local-deleted';
    }
    return baseline.state === 'absent' ? 'local-added' : 'local-modified';
  }
  if (sidesEqual(localAsSide, baselineAsSide)) {
    if (remote.state === 'absent') {
      return 'remote-deleted';
    }
    return baseline.state === 'absent' ? 'remote-added' : 'remote-modified';
  }
  return 'conflict';
}

function readFromMap<T>(map: SlotMap<T>, path: string): T | undefined {
  if (map instanceof Map) {
    return map.get(path);
  }
  if (Object.prototype.hasOwnProperty.call(map, path)) {
    return (map as Record<string, T>)[path];
  }
  return undefined;
}

function unionPaths(
  baselines: SlotMap<BaselineSlot>,
  locals: SlotMap<LocalSlot>,
  remotes: SlotMap<RemoteSlot>,
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
  collect(remotes);
  return [...paths].sort();
}

export function resolveStatusSelection(union: ReadonlyArray<string>, selection?: ReadonlyArray<string>): string[] {
  if (selection === undefined) {
    return [...union].sort();
  }
  const resolved = new Set<string>();
  for (const raw of selection) {
    resolved.add(normalizeProjectRelPath(raw, '--file'));
  }
  return [...resolved].sort();
}

export interface CollectStatusArgs {
  baselines: SlotMap<BaselineSlot>;
  locals: SlotMap<LocalSlot>;
  remotes: SlotMap<RemoteSlot>;
  selection?: ReadonlyArray<string>;
}

function toEntry(
  path: string,
  status: FileStatus,
  baseline: BaselineSlot,
  local: LocalSlot,
  remote: RemoteSlot,
): FileStatusEntry {
  const entry: FileStatusEntry = {
    path,
    status,
    baseline: baseline.state,
    local: local.state,
    remote: remote.state,
  };
  if (baseline.state === 'present' && baseline.fingerprint.blobId !== undefined) {
    entry.baselineBlobId = baseline.fingerprint.blobId;
  }
  if (local.state === 'present') {
    entry.localByteLength = local.fingerprint.byteLength;
    if (local.fingerprint.blobId !== undefined) {
      entry.localBlobId = local.fingerprint.blobId;
    }
  }
  if (remote.state === 'present') {
    entry.remoteByteLength = remote.fingerprint.byteLength;
    if (remote.fingerprint.blobId !== undefined) {
      entry.remoteBlobId = remote.fingerprint.blobId;
    }
  }
  return entry;
}

export function collectStatusEntries(args: CollectStatusArgs): FileStatusEntry[] {
  const union = unionPaths(args.baselines, args.locals, args.remotes);
  const selected = resolveStatusSelection(union, args.selection);
  const entries: FileStatusEntry[] = [];
  for (const path of selected) {
    const baseline = readFromMap(args.baselines, path) ?? { state: 'unknown' as const };
    const local = readFromMap(args.locals, path) ?? { state: 'absent' as const };
    const remote = readFromMap(args.remotes, path) ?? { state: 'absent' as const };
    entries.push(toEntry(path, compareFile(baseline, local, remote), baseline, local, remote));
  }
  return entries;
}

function normalizeHeadId(head: string | { logicalId: string }): string {
  return typeof head === 'string' ? head : head.logicalId;
}

export interface SummarizeHeadsOptions {
  activeBranch?: string;
  materializedBranch?: string;
}

export function summarizeHeads(
  branch: string,
  heads: ReadonlyArray<string | { logicalId: string }>,
  options: SummarizeHeadsOptions = {},
): BranchHeadSummary {
  const resolvedBranch = validateBranchName(branch);
  const ids = [...new Set(heads.map((head) => normalizeHeadId(head)))].sort();
  const state: HeadState = ids.length === 0 ? 'empty' : ids.length === 1 ? 'single' : 'diverged';
  const summary: BranchHeadSummary = {
    branch: resolvedBranch,
    state,
    heads: ids,
    switched: options.materializedBranch !== undefined && options.materializedBranch !== resolvedBranch,
  };
  if (options.activeBranch !== undefined) {
    summary.activeBranch = validateBranchName(options.activeBranch);
  }
  if (options.materializedBranch !== undefined) {
    summary.materializedBranch = validateBranchName(options.materializedBranch);
  }
  return summary;
}

function emptyCounts(): Record<FileStatus, number> {
  return {
    clean: 0,
    'local-added': 0,
    'local-modified': 0,
    'local-deleted': 0,
    'remote-added': 0,
    'remote-modified': 0,
    'remote-deleted': 0,
    conflict: 0,
    'unbased-conflict': 0,
    'local-error': 0,
    'remote-error': 0,
  };
}

export interface BuildStatusReportArgs {
  branch: string;
  heads: ReadonlyArray<string | { logicalId: string }>;
  baselines: SlotMap<BaselineSlot>;
  locals: SlotMap<LocalSlot>;
  remotes: SlotMap<RemoteSlot>;
  selection?: ReadonlyArray<string>;
  activeBranch?: string;
  materializedBranch?: string;
}

export function buildStatusReport(args: BuildStatusReportArgs): StatusReport {
  const summary = summarizeHeads(args.branch, args.heads, {
    ...(args.activeBranch === undefined ? {} : { activeBranch: args.activeBranch }),
    ...(args.materializedBranch === undefined ? {} : { materializedBranch: args.materializedBranch }),
  });
  const files = collectStatusEntries({
    baselines: args.baselines,
    locals: args.locals,
    remotes: args.remotes,
    ...(args.selection === undefined ? {} : { selection: args.selection }),
  });
  const counts = emptyCounts();
  for (const entry of files) {
    counts[entry.status] += 1;
  }
  const clean = files.every((entry) => entry.status === 'clean');
  const diverged = summary.state === 'diverged';
  const hasConflict = files.some((entry) => entry.status === 'conflict' || entry.status === 'unbased-conflict');
  const hasError = files.some((entry) => entry.status === 'local-error' || entry.status === 'remote-error');
  const report: StatusReport = {
    branch: summary.branch,
    heads: summary.heads,
    headState: summary.state,
    switched: summary.switched,
    files,
    counts,
    clean,
    diverged,
    hasConflict,
    hasError,
    checkFailed: !clean || diverged || hasConflict || hasError,
  };
  if (summary.activeBranch !== undefined) {
    report.activeBranch = summary.activeBranch;
  }
  if (summary.materializedBranch !== undefined) {
    report.materializedBranch = summary.materializedBranch;
  }
  return report;
}

export function evaluateCheck(report: StatusReport): boolean {
  return report.checkFailed;
}
