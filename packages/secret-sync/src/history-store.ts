import { MAX_SCAN_RECORDS } from './config';
import { mapWithConcurrency, validateConcurrency } from './concurrency';
import { SecretSyncError } from './errors';
import { findMissingParents } from './graph';
import {
  canonicalJson,
  createBlobRecord,
  createCommitRecord,
  decodeRecordEnvelope,
  deduplicateRecordDetails,
  parseRecordTitle,
  sha256Hex,
  type BlobEnvelope,
  type CommitEnvelope,
  type RecordEnvelope,
} from './records';
import type { SecretItemDetail, SecretStore } from './store';

export const HISTORY_MAX_RECORDS = MAX_SCAN_RECORDS;
export const HISTORY_DEFAULT_CONCURRENCY = 4;

export interface HistoryLoadOptions {
  maxRecords?: number;
  concurrency?: number;
}

export interface LoadedHistory {
  blobs: Map<string, BlobEnvelope>;
  commits: Map<string, CommitEnvelope>;
  blobProviders: Map<string, string>;
  commitProviders: Map<string, string>;
}

export interface PublishBlobOptions {
  logicalId?: string;
}

export interface PublishBlobResult {
  envelope: BlobEnvelope;
  providerId: string;
  reconciled: boolean;
}

export interface PublishCommitArgs {
  branch: string;
  parents: string[];
  tree: Array<{ path: string; blobId: string; sha256: string; byteLength: number }>;
  timestamp: number;
  message?: string;
  operationId: string;
  operationKind: string;
}

export interface PublishCommitOptions {
  logicalId?: string;
}

export interface PublishCommitResult {
  envelope: CommitEnvelope;
  providerId: string;
  reconciled: boolean;
}

export interface PublishSnapshotArgs {
  projectId: string;
  branch: string;
  parents: string[];
  files: Array<{ path: string; bytes: Uint8Array }>;
  timestamp: number;
  message?: string;
  operationId: string;
  operationKind: string;
  blobIds?: Record<string, string>;
  commitId?: string;
}

export interface PublishSnapshotResult {
  blobs: Map<string, BlobEnvelope>;
  commit: CommitEnvelope;
  commitProviderId: string;
}

function resolveMaxRecords(value: number | undefined): number {
  const candidate = value === undefined ? HISTORY_MAX_RECORDS : value;
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > HISTORY_MAX_RECORDS) {
    throw new SecretSyncError('validation', 'History scan bound is out of range.');
  }
  return candidate;
}

function resolveConcurrency(value: number | undefined): number {
  return validateConcurrency(value, HISTORY_DEFAULT_CONCURRENCY);
}

export async function loadRawHistory(
  store: SecretStore,
  projectId: string,
  options: HistoryLoadOptions = {},
): Promise<LoadedHistory> {
  const maxRecords = resolveMaxRecords(options.maxRecords);
  const concurrency = resolveConcurrency(options.concurrency);
  const summaries = await store.listItems();
  if (summaries.length > maxRecords) {
    throw new SecretSyncError('too-large', 'Remote record scan exceeds the 10000-record bound.');
  }
  const targets = [];
  for (const summary of summaries) {
    let parsed: { projectId: string; kind: string; logicalId: string };
    try {
      parsed = parseRecordTitle(summary.title);
    } catch {
      continue;
    }
    if (parsed.projectId !== projectId) {
      continue;
    }
    targets.push(summary);
  }
  const pairs = await mapWithConcurrency(
    targets,
    async (summary) => {
      const detail = await store.getItem(summary.id);
      let envelope: RecordEnvelope;
      try {
        envelope = decodeRecordEnvelope(detail, projectId);
      } catch (error) {
        if (error instanceof SecretSyncError && error.code === 'validation') {
          return undefined;
        }
        throw error;
      }
      return { detail, envelope };
    },
    concurrency,
  );
  const defined = [];
  for (const entry of pairs) {
    if (entry !== undefined) {
      defined.push(entry);
    }
  }
  const deduped = deduplicateRecordDetails(defined);
  return {
    blobs: deduped.blobs,
    commits: deduped.commits,
    blobProviders: deduped.blobProviders,
    commitProviders: deduped.commitProviders,
  };
}

export function validateHistoryDependencies(history: LoadedHistory, projectId: string): void {
  for (const blob of history.blobs.values()) {
    if (blob.projectId !== projectId) {
      throw new SecretSyncError('remote-corrupt', 'History mixes multiple projects.');
    }
  }
  for (const commit of history.commits.values()) {
    if (commit.projectId !== projectId) {
      throw new SecretSyncError('remote-corrupt', 'History mixes multiple projects.');
    }
  }
  const byId = new Map<string, CommitEnvelope>(history.commits);
  const missing = findMissingParents(byId);
  if (missing.length > 0) {
    throw new SecretSyncError('remote-incomplete', 'History references missing parent commits.');
  }
  for (const commit of history.commits.values()) {
    for (const entry of commit.tree) {
      const blob = history.blobs.get(entry.blobId);
      if (blob === undefined) {
        throw new SecretSyncError('remote-incomplete', 'History references missing blobs.');
      }
      if (blob.sha256 !== entry.sha256 || blob.byteLength !== entry.byteLength) {
        throw new SecretSyncError('remote-corrupt', 'Commit tree disagrees with its blob record.');
      }
    }
  }
}

export async function loadValidatedHistory(
  store: SecretStore,
  projectId: string,
  options: HistoryLoadOptions = {},
): Promise<LoadedHistory> {
  const history = await loadRawHistory(store, projectId, options);
  validateHistoryDependencies(history, projectId);
  return history;
}

export function materializeTreeBytes(history: LoadedHistory, commitId: string): Map<string, Uint8Array> {
  const commit = history.commits.get(commitId);
  if (commit === undefined) {
    throw new SecretSyncError('remote-incomplete', 'Commit is missing from the observed history.');
  }
  for (const entry of commit.tree) {
    const blob = history.blobs.get(entry.blobId);
    if (blob === undefined) {
      throw new SecretSyncError('remote-incomplete', 'Commit tree references a missing blob.');
    }
    if (blob.sha256 !== entry.sha256 || blob.byteLength !== entry.byteLength) {
      throw new SecretSyncError('remote-corrupt', 'Commit tree disagrees with its blob record.');
    }
  }
  const result = new Map<string, Uint8Array>();
  for (const entry of commit.tree) {
    const blob = history.blobs.get(entry.blobId) as BlobEnvelope;
    const bytes = new Uint8Array(Buffer.from(blob.contentBase64, 'base64'));
    if (bytes.byteLength !== blob.byteLength || bytes.byteLength !== entry.byteLength) {
      throw new SecretSyncError('remote-corrupt', 'Blob bytes do not match the recorded length.');
    }
    if (sha256Hex(bytes) !== blob.sha256 || sha256Hex(bytes) !== entry.sha256) {
      throw new SecretSyncError('remote-corrupt', 'Blob bytes do not match the recorded digest.');
    }
    result.set(entry.path, bytes);
  }
  return result;
}

export function findCommitsByOperationId(
  commits: ReadonlyMap<string, CommitEnvelope> | LoadedHistory,
  operationId: string,
): CommitEnvelope[] {
  const source = commits instanceof Map ? commits : (commits as LoadedHistory).commits;
  const result: CommitEnvelope[] = [];
  for (const commit of source.values()) {
    if (commit.operationId === operationId) {
      result.push(commit);
    }
  }
  result.sort((a, b) => (a.logicalId < b.logicalId ? -1 : a.logicalId > b.logicalId ? 1 : 0));
  return result;
}

export async function reconcileRecordByLogicalId(
  store: SecretStore,
  projectId: string,
  kind: string,
  logicalId: string,
  expected: RecordEnvelope,
): Promise<SecretItemDetail | undefined> {
  const summaries = await store.listItems();
  const candidates = [];
  for (const summary of summaries) {
    let parsed: { projectId: string; kind: string; logicalId: string };
    try {
      parsed = parseRecordTitle(summary.title);
    } catch {
      continue;
    }
    if (parsed.projectId === projectId && parsed.kind === kind && parsed.logicalId === logicalId) {
      candidates.push(summary);
    }
  }
  const expectedCanonical = canonicalJson(expected);
  for (const candidate of candidates) {
    const detail = await store.getItem(candidate.id);
    const envelope = decodeRecordEnvelope(detail, projectId);
    if (envelope.logicalId !== logicalId || envelope.kind !== kind) {
      throw new SecretSyncError('remote-corrupt', 'Reconciled record disagrees with its title.');
    }
    if (canonicalJson(envelope) !== expectedCanonical) {
      throw new SecretSyncError('remote-corrupt', 'Conflicting duplicate logical ids are corruption.');
    }
    return detail;
  }
  return undefined;
}

export async function publishBlob(
  store: SecretStore,
  projectId: string,
  bytes: Uint8Array,
  options: PublishBlobOptions = {},
): Promise<PublishBlobResult> {
  const record = createBlobRecord(projectId, bytes, options.logicalId);
  const result = await store.createItem(record.input);
  if (result.status === 'created') {
    const envelope = decodeRecordEnvelope(result.item, projectId);
    if (envelope.kind !== 'blob' || canonicalJson(envelope) !== canonicalJson(record.envelope)) {
      throw new SecretSyncError('remote-corrupt', 'Published blob disagrees with its receipt.');
    }
    return { envelope: record.envelope, providerId: result.item.id, reconciled: false };
  }
  const reconciled = await reconcileRecordByLogicalId(
    store,
    projectId,
    'blob',
    record.envelope.logicalId,
    record.envelope,
  );
  if (reconciled === undefined) {
    throw new SecretSyncError('uncertain-write', 'Blob write outcome is uncertain; retry with the same logical id.');
  }
  return { envelope: record.envelope, providerId: reconciled.id, reconciled: true };
}

export async function publishCommit(
  store: SecretStore,
  projectId: string,
  args: PublishCommitArgs,
  options: PublishCommitOptions = {},
): Promise<PublishCommitResult> {
  const record = createCommitRecord({
    projectId,
    branch: args.branch,
    parents: [...args.parents],
    tree: args.tree.map((entry) => ({ ...entry })),
    timestamp: args.timestamp,
    ...(args.message === undefined ? {} : { message: args.message }),
    operationId: args.operationId,
    operationKind: args.operationKind,
    ...(options.logicalId === undefined ? {} : { logicalId: options.logicalId }),
  });
  const result = await store.createItem(record.input);
  if (result.status === 'created') {
    const envelope = decodeRecordEnvelope(result.item, projectId);
    if (envelope.kind !== 'commit' || canonicalJson(envelope) !== canonicalJson(record.envelope)) {
      throw new SecretSyncError('remote-corrupt', 'Published commit disagrees with its receipt.');
    }
    return { envelope: record.envelope, providerId: result.item.id, reconciled: false };
  }
  const reconciled = await reconcileRecordByLogicalId(
    store,
    projectId,
    'commit',
    record.envelope.logicalId,
    record.envelope,
  );
  if (reconciled === undefined) {
    throw new SecretSyncError('uncertain-write', 'Commit write outcome is uncertain; retry with the same logical id.');
  }
  return { envelope: record.envelope, providerId: reconciled.id, reconciled: true };
}

export async function publishSnapshot(store: SecretStore, args: PublishSnapshotArgs): Promise<PublishSnapshotResult> {
  const blobs = new Map<string, BlobEnvelope>();
  for (const file of args.files) {
    const blobIds = args.blobIds;
    const preselected = blobIds === undefined ? undefined : blobIds[file.path];
    const published = await publishBlob(
      store,
      args.projectId,
      file.bytes,
      preselected === undefined ? {} : { logicalId: preselected },
    );
    const existing = blobs.get(file.path);
    if (existing !== undefined && canonicalJson(existing) !== canonicalJson(published.envelope)) {
      throw new SecretSyncError('remote-corrupt', 'Snapshot carries conflicting blob ids for one path.');
    }
    blobs.set(file.path, published.envelope);
  }
  const tree = [];
  for (const file of args.files) {
    const envelope = blobs.get(file.path) as BlobEnvelope;
    tree.push({
      path: file.path,
      blobId: envelope.logicalId,
      sha256: envelope.sha256,
      byteLength: envelope.byteLength,
    });
  }
  tree.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const commitOptions = args.commitId === undefined ? {} : { logicalId: args.commitId };
  const published = await publishCommit(
    store,
    args.projectId,
    {
      branch: args.branch,
      parents: [...args.parents],
      tree,
      timestamp: args.timestamp,
      ...(args.message === undefined ? {} : { message: args.message }),
      operationId: args.operationId,
      operationKind: args.operationKind,
    },
    commitOptions,
  );
  return { blobs, commit: published.envelope, commitProviderId: published.providerId };
}
