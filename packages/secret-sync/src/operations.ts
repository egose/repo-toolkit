import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  MAX_FILES_HARD_CEILING,
  MAX_FILE_BYTES_HARD_CEILING,
  MAX_SCAN_RECORDS,
  normalizeProjectRelPath,
  validateBranchName,
} from './config';
import { mapWithConcurrency, validateConcurrency } from './connect';
import { SECRET_SYNC_STATE_DIR } from './discovery';
import { SecretSyncError } from './errors';
import { deriveBranchHeads } from './graph';
import { loadValidatedHistory, publishBlob, type LoadedHistory } from './history-store';
import { sha256Hex, type BlobEnvelope, type CommitEnvelope } from './records';
import type { FileBaseline } from './state';
import type { BaselineSlot, LocalSlot } from './status';
import type { SecretStore } from './store';

export const OPERATION_RECORD_SCHEMA_VERSION = 1;
export const OPERATION_RECORD_DIR_NAME = 'operations';
export const OPERATION_DEFAULT_CONCURRENCY = 4;

export type OperationKind = 'push' | 'pull' | 'rollback' | 'resolve' | 'branch';

export interface PersistedOperation {
  schemaVersion: 1;
  operationId: string;
  kind: OperationKind;
  branch: string;
  commitId: string;
  blobIds: Record<string, string>;
  timestamp: number;
  message?: string;
}

export interface UploadInput {
  path: string;
  bytes: Uint8Array;
}

export interface PublishedUpload {
  envelope: BlobEnvelope;
  reconciled: boolean;
}

export interface BranchHistory {
  history: LoadedHistory;
  heads: CommitEnvelope[];
  headIds: string[];
  commits: CommitEnvelope[];
}

export interface ObservedHistory extends BranchHistory {
  diverged: boolean;
}

export interface ScannedLocal {
  bytes: Map<string, Uint8Array>;
  slots: Map<string, LocalSlot>;
  presentCount: number;
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function assertUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new SecretSyncError('validation', `Operation ${field} must be a UUID string.`);
  }
  return value;
}

export function createOperationId(provided?: string): string {
  if (provided === undefined) {
    return randomUUID();
  }
  return assertUuid(provided, 'operationId');
}

export function resolveOperationConcurrency(value: number | undefined): number {
  return validateConcurrency(value, OPERATION_DEFAULT_CONCURRENCY);
}

export function resolveTimestamp(value: number | undefined): number {
  const candidate = value === undefined ? Date.now() : value;
  if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 0) {
    throw new SecretSyncError('validation', 'Operation timestamp must be a non-negative safe integer.');
  }
  return candidate;
}

export function validateSizeBounds(
  maxFileBytes?: number,
  maxFiles?: number,
): { maxFileBytes: number; maxFiles: number } {
  const resolvedBytes = maxFileBytes === undefined ? MAX_FILE_BYTES_HARD_CEILING : maxFileBytes;
  const resolvedFiles = maxFiles === undefined ? MAX_FILES_HARD_CEILING : maxFiles;
  if (!Number.isSafeInteger(resolvedBytes) || resolvedBytes < 1 || resolvedBytes > MAX_FILE_BYTES_HARD_CEILING) {
    throw new SecretSyncError('validation', 'Per-file byte bound is out of range.');
  }
  if (!Number.isSafeInteger(resolvedFiles) || resolvedFiles < 1 || resolvedFiles > MAX_FILES_HARD_CEILING) {
    throw new SecretSyncError('validation', 'Selected file-count bound is out of range.');
  }
  return { maxFileBytes: resolvedBytes, maxFiles: resolvedFiles };
}

export function resolveOperationDir(rootAbsolute: string): string {
  return join(resolve(rootAbsolute), SECRET_SYNC_STATE_DIR, OPERATION_RECORD_DIR_NAME);
}

export function assertPersistedOperation(value: unknown): PersistedOperation {
  if (typeof value !== 'object' || value === null) {
    throw new SecretSyncError('state-corrupt', 'Operation record is not an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== OPERATION_RECORD_SCHEMA_VERSION) {
    throw new SecretSyncError('state-corrupt', 'Operation record carries an unsupported schema version.');
  }
  const operationId = assertUuid(record.operationId, 'operationId');
  if (
    record.kind !== 'push' &&
    record.kind !== 'pull' &&
    record.kind !== 'rollback' &&
    record.kind !== 'resolve' &&
    record.kind !== 'branch'
  ) {
    throw new SecretSyncError('state-corrupt', 'Operation record carries an unknown kind.');
  }
  const branch = validateBranchName(record.branch);
  const commitId = assertUuid(record.commitId, 'commitId');
  if (typeof record.blobIds !== 'object' || record.blobIds === null || Array.isArray(record.blobIds)) {
    throw new SecretSyncError('state-corrupt', 'Operation record carries invalid blob ids.');
  }
  const blobIds: Record<string, string> = {};
  for (const key of Object.keys(record.blobIds as Record<string, unknown>)) {
    const normalized = normalizeProjectRelPath(key, 'operation path');
    if (normalized !== key) {
      throw new SecretSyncError('state-corrupt', 'Operation record path is not in normalized form.');
    }
    blobIds[key] = assertUuid((record.blobIds as Record<string, unknown>)[key], 'blobId');
  }
  if (typeof record.timestamp !== 'number' || !Number.isSafeInteger(record.timestamp) || record.timestamp < 0) {
    throw new SecretSyncError('state-corrupt', 'Operation record carries an invalid timestamp.');
  }
  const operation: PersistedOperation = {
    schemaVersion: OPERATION_RECORD_SCHEMA_VERSION,
    operationId,
    kind: record.kind,
    branch,
    commitId,
    blobIds,
    timestamp: record.timestamp,
  };
  if (record.message !== undefined) {
    if (typeof record.message !== 'string') {
      throw new SecretSyncError('state-corrupt', 'Operation record carries an invalid message.');
    }
    operation.message = record.message;
  }
  return operation;
}

export async function writeOperationRecord(
  rootAbsolute: string,
  record: PersistedOperation,
): Promise<PersistedOperation> {
  const validated = assertPersistedOperation(JSON.parse(JSON.stringify(record)) as unknown);
  const dir = resolveOperationDir(rootAbsolute);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const target = join(dir, `${validated.operationId}.json`);
  await writeFile(target, `${JSON.stringify(validated)}\n`, { mode: 0o600 });
  await chmod(target, 0o600);
  return validated;
}

export async function readOperationRecord(
  rootAbsolute: string,
  operationId: string,
): Promise<PersistedOperation | undefined> {
  const validatedId = assertUuid(operationId, 'operationId');
  const target = join(resolveOperationDir(rootAbsolute), `${validatedId}.json`);
  let raw: string;
  try {
    raw = await readFile(target, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const wrapped = new SecretSyncError('state-corrupt', 'Operation record is not valid JSON.');
    (wrapped as { cause?: unknown }).cause = error;
    throw wrapped;
  }
  return assertPersistedOperation(parsed);
}

export function sortedHeadIds(heads: ReadonlyArray<CommitEnvelope>): string[] {
  return heads.map((head) => head.logicalId).sort();
}

export function headsEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  for (let index = 0; index < sortedLeft.length; index += 1) {
    if (sortedLeft[index] !== sortedRight[index]) {
      return false;
    }
  }
  return true;
}

export async function loadBranchHistory(
  store: SecretStore,
  projectId: string,
  branch: string,
  concurrency?: number,
): Promise<BranchHistory> {
  const resolvedBranch = validateBranchName(branch);
  const history = await loadValidatedHistory(store, projectId, {
    concurrency: resolveOperationConcurrency(concurrency),
  });
  const heads = deriveBranchHeads(history.commits, resolvedBranch);
  return { history, heads, headIds: sortedHeadIds(heads), commits: [...history.commits.values()] };
}

export function requireSingleOperationHead(
  heads: ReadonlyArray<CommitEnvelope>,
  branch: string,
): CommitEnvelope | undefined {
  if (heads.length > 1) {
    throw new SecretSyncError(
      'remote-diverged',
      `Branch ${JSON.stringify(branch)} has multiple heads; resolve the fork before pushing or pulling.`,
    );
  }
  const head = heads[0];
  return head === undefined ? undefined : head;
}

export async function recheckHeads(
  store: SecretStore,
  projectId: string,
  branch: string,
  expectedHeadIds: ReadonlyArray<string>,
  concurrency?: number,
): Promise<BranchHistory> {
  const fresh = await loadBranchHistory(store, projectId, branch, concurrency);
  if (!headsEqual(fresh.headIds, expectedHeadIds)) {
    throw new SecretSyncError(
      'remote-diverged',
      `Branch ${JSON.stringify(branch)} heads changed between planning and publication; refusing to publish over a new head.`,
    );
  }
  return fresh;
}

export async function observeHeadsAfter(
  store: SecretStore,
  projectId: string,
  branch: string,
  concurrency?: number,
): Promise<ObservedHistory> {
  const fresh = await loadBranchHistory(store, projectId, branch, concurrency);
  return { ...fresh, diverged: fresh.headIds.length > 1 };
}

export async function publishUploadsBounded(
  store: SecretStore,
  projectId: string,
  uploads: ReadonlyArray<UploadInput>,
  blobIds: Record<string, string>,
  concurrency?: number,
): Promise<Map<string, PublishedUpload>> {
  const limit = resolveOperationConcurrency(concurrency);
  const sorted = [...uploads].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const published = await mapWithConcurrency(
    sorted,
    async (upload) => {
      const normalized = normalizeProjectRelPath(upload.path, 'upload path');
      const logicalId = blobIds[normalized];
      if (logicalId === undefined) {
        throw new SecretSyncError('validation', `Upload for ${JSON.stringify(normalized)} is missing its blob id.`);
      }
      assertUuid(logicalId, 'blobId');
      if (!(upload.bytes instanceof Uint8Array)) {
        throw new SecretSyncError('validation', `Upload bytes for ${JSON.stringify(normalized)} must be a Uint8Array.`);
      }
      if (upload.bytes.byteLength > MAX_FILE_BYTES_HARD_CEILING) {
        throw new SecretSyncError('too-large', `Upload for ${JSON.stringify(normalized)} exceeds the per-file bound.`);
      }
      const result = await publishBlob(store, projectId, upload.bytes, { logicalId });
      if (
        result.envelope.sha256 !== sha256Hex(upload.bytes) ||
        result.envelope.byteLength !== upload.bytes.byteLength
      ) {
        throw new SecretSyncError(
          'remote-corrupt',
          `Published blob receipt disagrees for ${JSON.stringify(normalized)}.`,
        );
      }
      return { path: normalized, envelope: result.envelope, reconciled: result.reconciled };
    },
    limit,
  );
  const result = new Map<string, PublishedUpload>();
  for (const entry of published) {
    result.set(entry.path, { envelope: entry.envelope, reconciled: entry.reconciled });
  }
  return result;
}

export function baselinesToSlots(
  baselines: Record<string, FileBaseline>,
  blobs: ReadonlyMap<string, BlobEnvelope>,
): Map<string, BaselineSlot> {
  const slots = new Map<string, BaselineSlot>();
  for (const path of Object.keys(baselines)) {
    const baseline = baselines[path] as FileBaseline;
    if (baseline.state === 'absent') {
      slots.set(path, { state: 'absent' });
      continue;
    }
    const blob = blobs.get(baseline.blobId);
    if (blob === undefined) {
      slots.set(path, { state: 'unknown' });
      continue;
    }
    slots.set(path, {
      state: 'present',
      fingerprint: { sha256: blob.sha256, byteLength: blob.byteLength, blobId: blob.logicalId },
    });
  }
  return slots;
}

export function localBytesToSlots(scanned: ReadonlyMap<string, Uint8Array | undefined>): Map<string, LocalSlot> {
  const slots = new Map<string, LocalSlot>();
  for (const [path, bytes] of scanned) {
    if (bytes === undefined) {
      slots.set(path, { state: 'absent' });
    } else {
      slots.set(path, {
        state: 'present',
        fingerprint: { sha256: sha256Hex(bytes), byteLength: bytes.byteLength },
      });
    }
  }
  return slots;
}

export async function listWorktreeFiles(rootAbsolute: string, maxRecords?: number): Promise<string[]> {
  const root = resolve(rootAbsolute);
  const bound = maxRecords === undefined ? MAX_SCAN_RECORDS : maxRecords;
  if (!Number.isSafeInteger(bound) || bound < 1) {
    throw new SecretSyncError('validation', 'Worktree scan bound is out of range.');
  }
  const collected: string[] = [];
  let scanned = 0;
  const pending: string[] = [''];
  while (pending.length > 0) {
    const dirRel = pending.pop() as string;
    const dirAbsolute = dirRel === '' ? root : join(root, ...dirRel.split('/'));
    let entries;
    try {
      entries = await readdir(dirAbsolute, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && dirRel !== '') {
        continue;
      }
      throw error;
    }
    const sorted = [...entries].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of sorted) {
      const rel = dirRel === '' ? entry.name : `${dirRel}/${entry.name}`;
      scanned += 1;
      if (scanned > bound) {
        throw new SecretSyncError('too-large', 'Refusing to scan more directory records than the configured bound.');
      }
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (
          rel !== '.git' &&
          !rel.startsWith('.git/') &&
          rel !== SECRET_SYNC_STATE_DIR &&
          !rel.startsWith(`${SECRET_SYNC_STATE_DIR}/`)
        ) {
          pending.push(rel);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      collected.push(rel.split('\\').join('/'));
    }
  }
  return [...new Set(collected)].sort();
}

export async function resolveSyncCandidates(
  rootAbsolute: string,
  selection: ReadonlyArray<string> | undefined,
  baselinePaths: ReadonlyArray<string>,
  remotePaths: ReadonlyArray<string>,
): Promise<string[]> {
  if (selection !== undefined) {
    const normalized = selection.map((raw) => normalizeProjectRelPath(raw, '--file'));
    return [...new Set(normalized)].sort();
  }
  const scanned = await listWorktreeFiles(rootAbsolute);
  return [...new Set([...scanned, ...baselinePaths, ...remotePaths])].sort();
}

export async function scanLocalSlots(
  readFile: (path: string) => Promise<Uint8Array | undefined>,
  candidates: ReadonlyArray<string>,
): Promise<ScannedLocal> {
  const bytes = new Map<string, Uint8Array>();
  const scanned = new Map<string, Uint8Array | undefined>();
  const slots = new Map<string, LocalSlot>();
  for (const path of candidates) {
    let data: Uint8Array | undefined;
    try {
      data = await readFile(path);
    } catch (error) {
      if (error instanceof SecretSyncError) {
        slots.set(path, { state: 'error', code: error.code, message: error.message });
        continue;
      }
      slots.set(path, {
        state: 'error',
        code: 'local-changed',
        message: `Local read failed for ${JSON.stringify(path)}.`,
      });
      continue;
    }
    scanned.set(path, data);
    if (data === undefined) {
      slots.set(path, { state: 'absent' });
    } else {
      bytes.set(path, data);
      slots.set(path, {
        state: 'present',
        fingerprint: { sha256: sha256Hex(data), byteLength: data.byteLength },
      });
    }
  }
  return { bytes, slots, presentCount: bytes.size };
}

export function buildPublishNote(commitId: string): string {
  return (
    `Push commit ${commitId} was verified on the configured endpoint and vault. ` +
    `Observed-head checks narrow races but do not serialize writers; delayed synchronization can reveal another head later. ` +
    `This result is not a claim of durability on any other server.`
  );
}

export function buildPullNote(downloaded: number, removed: number): string {
  return (
    `Pulled ${downloaded} file(s) and removed ${removed} file(s) with per-file atomic replacement on the configured root. ` +
    `Each replacement was rechecked immediately before rename and journaled for resume. ` +
    `This result is not a claim of durability on any other server.`
  );
}
