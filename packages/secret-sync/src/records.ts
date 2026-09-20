import { createHash, randomUUID } from 'node:crypto';

import { isPlainObject } from '@repo-toolkit/publish-package';

import {
  MAX_FILES_HARD_CEILING,
  MAX_FILE_BYTES_HARD_CEILING,
  normalizeProjectRelPath,
  validateBranchName,
} from './config';
import { SecretSyncError } from './errors';
import type { ConnectItemDetail, CreateConnectItemInput } from './store';

export const RECORD_MARKER = 'repo-toolkit-secret-sync';
export const RECORD_SCHEMA_VERSION = 1;
export const MAX_RECORD_BYTES = 65536;
export const MAX_TREE_ENTRIES = MAX_FILES_HARD_CEILING;
export const MAX_BLOB_BYTES = MAX_FILE_BYTES_HARD_CEILING;
export const MAX_MESSAGE_CHARS = 4096;
export const MAX_OPERATION_KIND_CHARS = 64;
export const MAX_PARENTS = 64;

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export interface BlobTreeEntry {
  path: string;
  blobId: string;
  sha256: string;
  byteLength: number;
}

export interface BlobEnvelope {
  schemaVersion: 1;
  projectId: string;
  kind: 'blob';
  logicalId: string;
  byteLength: number;
  sha256: string;
  contentBase64: string;
}

export interface CommitEnvelope {
  schemaVersion: 1;
  projectId: string;
  kind: 'commit';
  logicalId: string;
  branch: string;
  parents: string[];
  tree: BlobTreeEntry[];
  timestamp: number;
  message?: string;
  operationId: string;
  operationKind: string;
}

export type RecordEnvelope = BlobEnvelope | CommitEnvelope;

export interface BlobRecord {
  envelope: BlobEnvelope;
  serialized: string;
  input: CreateConnectItemInput;
}

export interface CommitRecord {
  envelope: CommitEnvelope;
  serialized: string;
  input: CreateConnectItemInput;
}

function byteLengthUtf8(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${parts.join(',')}}`;
  }
  return JSON.stringify(value) as string;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new SecretSyncError('remote-corrupt', `Record has an invalid ${field}.`);
  }
  return value;
}

function assertUuidInput(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new SecretSyncError('validation', `Record ${field} must be a UUID string.`);
  }
  return value;
}

export function buildRecordTitle(projectId: string, kind: string, logicalId: string): string {
  return `${RECORD_MARKER} ${projectId} ${kind} ${logicalId}`;
}

export function parseRecordTitle(title: unknown): { projectId: string; kind: string; logicalId: string } {
  if (typeof title !== 'string') {
    throw new SecretSyncError('remote-corrupt', 'Record title is not a string.');
  }
  const parts = title.split(' ');
  if (parts.length !== 4 || parts[0] !== RECORD_MARKER) {
    throw new SecretSyncError('remote-corrupt', 'Record title does not carry the expected opaque marker.');
  }
  const projectId = parts[1] as string;
  const kind = parts[2] as string;
  const logicalId = parts[3] as string;
  if (!UUID_PATTERN.test(projectId)) {
    throw new SecretSyncError('remote-corrupt', 'Record title carries an invalid project id.');
  }
  if (kind !== 'blob' && kind !== 'commit') {
    throw new SecretSyncError('remote-corrupt', 'Record title carries an unknown record kind.');
  }
  if (!UUID_PATTERN.test(logicalId)) {
    throw new SecretSyncError('remote-corrupt', 'Record title carries an invalid logical id.');
  }
  return { projectId, kind, logicalId };
}

export function validateTreePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SecretSyncError('remote-corrupt', 'Tree path must be a non-empty string.');
  }
  if (value.includes('\0')) {
    throw new SecretSyncError('remote-corrupt', 'Tree path must not contain NUL bytes.');
  }
  if (value.includes('\\')) {
    throw new SecretSyncError('remote-corrupt', 'Tree path must use forward slashes.');
  }
  let normalized: string;
  try {
    normalized = normalizeProjectRelPath(value, 'tree path');
  } catch {
    throw new SecretSyncError('remote-corrupt', 'Tree path is not a safe project-relative path.');
  }
  if (normalized !== value) {
    throw new SecretSyncError('remote-corrupt', 'Tree path is not in normalized slash form.');
  }
  return normalized;
}

function validateTreePathInput(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SecretSyncError('validation', 'Tree path must be a non-empty string.');
  }
  if (value.includes('\0')) {
    throw new SecretSyncError('validation', 'Tree path must not contain NUL bytes.');
  }
  if (value.includes('\\')) {
    throw new SecretSyncError('validation', 'Tree path must use forward slashes.');
  }
  let normalized: string;
  try {
    normalized = normalizeProjectRelPath(value, 'tree path');
  } catch {
    throw new SecretSyncError('validation', 'Tree path is not a safe project-relative path.');
  }
  if (normalized !== value) {
    throw new SecretSyncError('validation', 'Tree path is not in normalized slash form.');
  }
  return normalized;
}

function validateSha256(value: unknown, corrupt: boolean): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new SecretSyncError(corrupt ? 'remote-corrupt' : 'validation', 'Record carries an invalid sha256 digest.');
  }
  return value;
}

function validateBase64(value: unknown, corrupt: boolean): string {
  if (typeof value !== 'string') {
    throw new SecretSyncError(corrupt ? 'remote-corrupt' : 'validation', 'Record carries an invalid base64 payload.');
  }
  if (value.length > 0 && (value.length % 4 !== 0 || !BASE64_PATTERN.test(value))) {
    throw new SecretSyncError(corrupt ? 'remote-corrupt' : 'validation', 'Record carries an invalid base64 payload.');
  }
  if (value.includes('\n') || value.includes('\r') || value.includes(' ') || value.includes('\t')) {
    throw new SecretSyncError(corrupt ? 'remote-corrupt' : 'validation', 'Record carries an invalid base64 payload.');
  }
  return value;
}

function validateOperationKind(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_OPERATION_KIND_CHARS) {
    throw new SecretSyncError('validation', 'Record operationKind must be a non-empty string of bounded length.');
  }
  if (value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    throw new SecretSyncError('validation', 'Record operationKind carries unsupported control characters.');
  }
  return value;
}

function decodeOperationKind(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_OPERATION_KIND_CHARS) {
    throw new SecretSyncError('remote-corrupt', 'Record carries an invalid operationKind.');
  }
  if (value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    throw new SecretSyncError('remote-corrupt', 'Record carries an invalid operationKind.');
  }
  return value;
}

function validateMessageInput(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length > MAX_MESSAGE_CHARS) {
    throw new SecretSyncError('validation', 'Record message must be a string within the length bound.');
  }
  if (value.includes('\0')) {
    throw new SecretSyncError('validation', 'Record message must not contain NUL bytes.');
  }
  return value;
}

function decodeMessage(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length > MAX_MESSAGE_CHARS) {
    throw new SecretSyncError('remote-corrupt', 'Record carries an invalid message.');
  }
  if (value.includes('\0')) {
    throw new SecretSyncError('remote-corrupt', 'Record carries an invalid message.');
  }
  return value;
}

function validateTimestampInput(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new SecretSyncError('validation', 'Record timestamp must be a non-negative safe integer.');
  }
  return value;
}

function decodeTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new SecretSyncError('remote-corrupt', 'Record carries an invalid timestamp.');
  }
  return value;
}

function validateBranchInput(value: unknown): string {
  try {
    return validateBranchName(value);
  } catch {
    throw new SecretSyncError('validation', 'Record branch name is invalid.');
  }
}

function decodeBranch(value: unknown): string {
  try {
    return validateBranchName(value);
  } catch {
    throw new SecretSyncError('remote-corrupt', 'Record carries an invalid branch name.');
  }
}

export function serializeBlobEnvelope(envelope: BlobEnvelope): string {
  return JSON.stringify({
    schemaVersion: envelope.schemaVersion,
    projectId: envelope.projectId,
    kind: envelope.kind,
    logicalId: envelope.logicalId,
    byteLength: envelope.byteLength,
    sha256: envelope.sha256,
    contentBase64: envelope.contentBase64,
  });
}

export function serializeCommitEnvelope(envelope: CommitEnvelope): string {
  const sorted = [...envelope.tree].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const tree = sorted.map((entry) => ({
    path: entry.path,
    blobId: entry.blobId,
    sha256: entry.sha256,
    byteLength: entry.byteLength,
  }));
  const base: Record<string, unknown> = {
    schemaVersion: envelope.schemaVersion,
    projectId: envelope.projectId,
    kind: envelope.kind,
    logicalId: envelope.logicalId,
    branch: envelope.branch,
    parents: [...envelope.parents],
    tree,
    timestamp: envelope.timestamp,
    operationId: envelope.operationId,
    operationKind: envelope.operationKind,
  };
  if (envelope.message !== undefined) {
    base.message = envelope.message;
  }
  return JSON.stringify(base);
}

export function assertSerializedFits(serialized: string): void {
  if (byteLengthUtf8(serialized) > MAX_RECORD_BYTES) {
    throw new SecretSyncError('too-large', 'Serialized record exceeds the 64KiB record bound without truncation.');
  }
}

export function buildCreateInput(
  projectId: string,
  kind: string,
  logicalId: string,
  serialized: string,
): CreateConnectItemInput {
  assertSerializedFits(serialized);
  return {
    title: buildRecordTitle(projectId, kind, logicalId),
    category: 'SECURE_NOTE',
    tags: [RECORD_MARKER, projectId, kind],
    fields: [
      { type: 'STRING', label: 'notesPlain', value: '' },
      { type: 'CONCEALED', label: 'payload', value: serialized },
    ],
  };
}

export function createBlobRecord(projectId: string, bytes: Uint8Array, logicalId?: string): BlobRecord {
  const resolvedProject = assertUuidInput(projectId, 'projectId');
  const resolvedId = logicalId === undefined ? randomUUID() : assertUuidInput(logicalId, 'logicalId');
  if (!(bytes instanceof Uint8Array)) {
    throw new SecretSyncError('validation', 'Blob bytes must be a Uint8Array.');
  }
  if (bytes.byteLength > MAX_BLOB_BYTES) {
    throw new SecretSyncError('too-large', 'Blob bytes exceed the per-file bound without truncation.');
  }
  const digest = sha256Hex(bytes);
  const contentBase64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  const envelope: BlobEnvelope = {
    schemaVersion: RECORD_SCHEMA_VERSION,
    projectId: resolvedProject,
    kind: 'blob',
    logicalId: resolvedId,
    byteLength: bytes.byteLength,
    sha256: digest,
    contentBase64,
  };
  const serialized = serializeBlobEnvelope(envelope);
  const input = buildCreateInput(resolvedProject, 'blob', resolvedId, serialized);
  return { envelope, serialized, input };
}

export interface CreateCommitArgs {
  projectId: string;
  branch: string;
  parents: string[];
  tree: BlobTreeEntry[];
  timestamp: number;
  message?: string;
  operationId: string;
  operationKind: string;
  logicalId?: string;
}

export function createCommitRecord(args: CreateCommitArgs): CommitRecord {
  const resolvedProject = assertUuidInput(args.projectId, 'projectId');
  const resolvedId = args.logicalId === undefined ? randomUUID() : assertUuidInput(args.logicalId, 'logicalId');
  const branch = validateBranchInput(args.branch);
  if (!Array.isArray(args.parents)) {
    throw new SecretSyncError('validation', 'Commit parents must be an array of commit ids.');
  }
  if (args.parents.length > MAX_PARENTS) {
    throw new SecretSyncError('validation', 'Commit carries too many parents.');
  }
  const parents: string[] = [];
  const seenParents = new Set<string>();
  for (const parent of args.parents) {
    const resolved = assertUuidInput(parent, 'parents entry');
    if (resolved === resolvedId) {
      throw new SecretSyncError('validation', 'Commit must not list itself as a parent.');
    }
    if (seenParents.has(resolved)) {
      throw new SecretSyncError('validation', 'Commit parents must not repeat an id.');
    }
    seenParents.add(resolved);
    parents.push(resolved);
  }
  if (!Array.isArray(args.tree)) {
    throw new SecretSyncError('validation', 'Commit tree must be an array.');
  }
  if (args.tree.length > MAX_TREE_ENTRIES) {
    throw new SecretSyncError('too-large', 'Commit tree exceeds the file-count bound without truncation.');
  }
  const tree: BlobTreeEntry[] = [];
  const seenPaths = new Set<string>();
  for (const entry of args.tree) {
    if (!isPlainObject(entry)) {
      throw new SecretSyncError('validation', 'Commit tree entry must be an object.');
    }
    const record = entry as Record<string, unknown>;
    const path = validateTreePathInput(record.path);
    const blobId = assertUuidInput(record.blobId, 'tree blobId');
    const sha256 = validateSha256(record.sha256, false);
    const byteLength = record.byteLength;
    if (
      typeof byteLength !== 'number' ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0 ||
      byteLength > MAX_BLOB_BYTES
    ) {
      throw new SecretSyncError('validation', 'Commit tree entry carries an invalid byteLength.');
    }
    if (seenPaths.has(path)) {
      throw new SecretSyncError('validation', 'Commit tree carries a duplicate path.');
    }
    seenPaths.add(path);
    tree.push({ path, blobId, sha256, byteLength });
  }
  tree.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const timestamp = validateTimestampInput(args.timestamp);
  const message = validateMessageInput(args.message);
  const operationId = assertUuidInput(args.operationId, 'operationId');
  const operationKind = validateOperationKind(args.operationKind);
  const envelope: CommitEnvelope = {
    schemaVersion: RECORD_SCHEMA_VERSION,
    projectId: resolvedProject,
    kind: 'commit',
    logicalId: resolvedId,
    branch,
    parents,
    tree,
    timestamp,
    ...(message === undefined ? {} : { message }),
    operationId,
    operationKind,
  };
  const serialized = serializeCommitEnvelope(envelope);
  const input = buildCreateInput(resolvedProject, 'commit', resolvedId, serialized);
  return { envelope, serialized, input };
}

function findPayloadValue(detail: ConnectItemDetail): string {
  const matches = detail.fields.filter((field) => field.label === 'payload');
  if (matches.length !== 1) {
    throw new SecretSyncError('remote-corrupt', 'Record does not carry exactly one concealed payload field.');
  }
  const field = matches[0] as { type?: string; value?: string };
  if (field.type !== 'CONCEALED' || typeof field.value !== 'string') {
    throw new SecretSyncError('remote-corrupt', 'Record payload field is not concealed text.');
  }
  return field.value;
}

function parseEnvelopeJson(serialized: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new SecretSyncError('remote-corrupt', 'Record payload is not valid JSON.');
  }
  if (!isPlainObject(parsed)) {
    throw new SecretSyncError('remote-corrupt', 'Record payload is not an object.');
  }
  return parsed as Record<string, unknown>;
}

function decodeBlobEnvelope(record: Record<string, unknown>): BlobEnvelope {
  if (record.schemaVersion !== RECORD_SCHEMA_VERSION) {
    throw new SecretSyncError('remote-corrupt', 'Blob carries an unsupported schema version.');
  }
  if (record.kind !== 'blob') {
    throw new SecretSyncError('remote-corrupt', 'Blob carries an unexpected kind.');
  }
  const projectId = assertUuid(record.projectId, 'projectId');
  const logicalId = assertUuid(record.logicalId, 'logicalId');
  const byteLength = record.byteLength;
  if (
    typeof byteLength !== 'number' ||
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    byteLength > MAX_BLOB_BYTES
  ) {
    throw new SecretSyncError('remote-corrupt', 'Blob carries an invalid byteLength.');
  }
  const sha256 = validateSha256(record.sha256, true);
  const contentBase64 = validateBase64(record.contentBase64, true);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(contentBase64, 'base64'));
  } catch {
    throw new SecretSyncError('remote-corrupt', 'Blob carries undecodable base64 bytes.');
  }
  if (bytes.byteLength !== byteLength) {
    throw new SecretSyncError('remote-corrupt', 'Blob byteLength does not match its bytes.');
  }
  if (sha256Hex(bytes) !== sha256) {
    throw new SecretSyncError('remote-corrupt', 'Blob digest does not match its bytes.');
  }
  const allowed = new Set(['schemaVersion', 'projectId', 'kind', 'logicalId', 'byteLength', 'sha256', 'contentBase64']);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new SecretSyncError('remote-corrupt', 'Blob carries an unknown field.');
    }
  }
  return { schemaVersion: 1, projectId, kind: 'blob', logicalId, byteLength, sha256, contentBase64 };
}

function decodeCommitEnvelope(record: Record<string, unknown>): CommitEnvelope {
  if (record.schemaVersion !== RECORD_SCHEMA_VERSION) {
    throw new SecretSyncError('remote-corrupt', 'Commit carries an unsupported schema version.');
  }
  if (record.kind !== 'commit') {
    throw new SecretSyncError('remote-corrupt', 'Commit carries an unexpected kind.');
  }
  const projectId = assertUuid(record.projectId, 'projectId');
  const logicalId = assertUuid(record.logicalId, 'logicalId');
  const branch = decodeBranch(record.branch);
  if (!Array.isArray(record.parents)) {
    throw new SecretSyncError('remote-corrupt', 'Commit carries invalid parents.');
  }
  if (record.parents.length > MAX_PARENTS) {
    throw new SecretSyncError('remote-corrupt', 'Commit carries too many parents.');
  }
  const parents: string[] = [];
  const seenParents = new Set<string>();
  for (const parent of record.parents) {
    const resolved = assertUuid(parent, 'parent id');
    if (resolved === logicalId) {
      throw new SecretSyncError('remote-corrupt', 'Commit lists itself as a parent.');
    }
    if (seenParents.has(resolved)) {
      throw new SecretSyncError('remote-corrupt', 'Commit repeats a parent id.');
    }
    seenParents.add(resolved);
    parents.push(resolved);
  }
  if (!Array.isArray(record.tree)) {
    throw new SecretSyncError('remote-corrupt', 'Commit carries an invalid tree.');
  }
  if (record.tree.length > MAX_TREE_ENTRIES) {
    throw new SecretSyncError('too-large', 'Commit tree exceeds the file-count bound.');
  }
  const tree: BlobTreeEntry[] = [];
  let previousPath: string | undefined;
  const seenPaths = new Set<string>();
  for (const entry of record.tree) {
    if (!isPlainObject(entry)) {
      throw new SecretSyncError('remote-corrupt', 'Commit tree entry is not an object.');
    }
    const entryRecord = entry as Record<string, unknown>;
    const allowed = new Set(['path', 'blobId', 'sha256', 'byteLength']);
    for (const key of Object.keys(entryRecord)) {
      if (!allowed.has(key)) {
        throw new SecretSyncError('remote-corrupt', 'Commit tree entry carries an unknown field.');
      }
    }
    const path = validateTreePath(entryRecord.path);
    const blobId = assertUuid(entryRecord.blobId, 'tree blobId');
    const sha256 = validateSha256(entryRecord.sha256, true);
    const byteLength = entryRecord.byteLength;
    if (
      typeof byteLength !== 'number' ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 0 ||
      byteLength > MAX_BLOB_BYTES
    ) {
      throw new SecretSyncError('remote-corrupt', 'Commit tree entry carries an invalid byteLength.');
    }
    if (seenPaths.has(path)) {
      throw new SecretSyncError('remote-corrupt', 'Commit tree repeats a path.');
    }
    seenPaths.add(path);
    if (previousPath !== undefined && path <= previousPath) {
      throw new SecretSyncError('remote-corrupt', 'Commit tree is not in sorted path order.');
    }
    previousPath = path;
    tree.push({ path, blobId, sha256, byteLength });
  }
  const timestamp = decodeTimestamp(record.timestamp);
  const message = decodeMessage(record.message);
  const operationId = assertUuid(record.operationId, 'operationId');
  const operationKind = decodeOperationKind(record.operationKind);
  const allowedTop = new Set([
    'schemaVersion',
    'projectId',
    'kind',
    'logicalId',
    'branch',
    'parents',
    'tree',
    'timestamp',
    'message',
    'operationId',
    'operationKind',
  ]);
  for (const key of Object.keys(record)) {
    if (!allowedTop.has(key)) {
      throw new SecretSyncError('remote-corrupt', 'Commit carries an unknown field.');
    }
  }
  return {
    schemaVersion: 1,
    projectId,
    kind: 'commit',
    logicalId,
    branch,
    parents,
    tree,
    timestamp,
    ...(message === undefined ? {} : { message }),
    operationId,
    operationKind,
  };
}

export function decodeRecordEnvelope(detail: ConnectItemDetail, expectedProjectId: string): RecordEnvelope {
  assertUuidInput(expectedProjectId, 'projectId');
  const title = parseRecordTitle(detail.title);
  const tags = detail.tags;
  if (!Array.isArray(tags) || tags.length !== 3 || tags[0] !== RECORD_MARKER || tags[2] !== title.kind) {
    throw new SecretSyncError('remote-corrupt', 'Record tags do not carry the expected opaque marker.');
  }
  if (tags[1] !== title.projectId) {
    throw new SecretSyncError('remote-corrupt', 'Record tags disagree with the record title.');
  }
  if (detail.category !== 'SECURE_NOTE') {
    throw new SecretSyncError('remote-corrupt', 'Record category is not SECURE_NOTE.');
  }
  const serialized = findPayloadValue(detail);
  if (byteLengthUtf8(serialized) > MAX_RECORD_BYTES) {
    throw new SecretSyncError('too-large', 'Stored record exceeds the 64KiB record bound.');
  }
  const record = parseEnvelopeJson(serialized);
  let envelope: RecordEnvelope;
  if (record.kind === 'blob') {
    envelope = decodeBlobEnvelope(record);
  } else if (record.kind === 'commit') {
    envelope = decodeCommitEnvelope(record);
  } else {
    throw new SecretSyncError('remote-corrupt', 'Record carries an unknown kind.');
  }
  if (envelope.logicalId !== title.logicalId || envelope.projectId !== title.projectId) {
    throw new SecretSyncError('remote-corrupt', 'Record title disagrees with the concealed payload.');
  }
  if (envelope.projectId !== title.projectId || tags[1] !== envelope.projectId) {
    throw new SecretSyncError('remote-corrupt', 'Record identity fields disagree.');
  }
  if (envelope.projectId !== expectedProjectId) {
    throw new SecretSyncError('validation', 'Record belongs to a different project.');
  }
  if (envelope.kind !== title.kind) {
    throw new SecretSyncError('remote-corrupt', 'Record kind disagrees with the record title.');
  }
  return envelope;
}

export function decodeEnvelopeJson(serialized: string): RecordEnvelope {
  const record = parseEnvelopeJson(serialized);
  if (record.kind === 'blob') {
    return decodeBlobEnvelope(record);
  }
  if (record.kind === 'commit') {
    return decodeCommitEnvelope(record);
  }
  throw new SecretSyncError('remote-corrupt', 'Record carries an unknown kind.');
}

export interface DeduplicatedDetails {
  blobs: Map<string, BlobEnvelope>;
  commits: Map<string, CommitEnvelope>;
  blobProviders: Map<string, string>;
  commitProviders: Map<string, string>;
}

export function deduplicateDecodedEnvelopes(envelopes: RecordEnvelope[]): DeduplicatedDetails {
  const blobs = new Map<string, BlobEnvelope>();
  const commits = new Map<string, CommitEnvelope>();
  const blobProviders = new Map<string, string>();
  const commitProviders = new Map<string, string>();
  const seenCanonical = new Map<string, string>();
  for (const envelope of envelopes) {
    const canonical = canonicalJson(envelope);
    const previous = seenCanonical.get(envelope.logicalId);
    if (previous === undefined) {
      seenCanonical.set(envelope.logicalId, canonical);
      if (envelope.kind === 'blob') {
        const existing = blobs.get(envelope.logicalId);
        if (existing !== undefined) {
          throw new SecretSyncError('remote-corrupt', 'Conflicting duplicate blob ids are corruption.');
        }
        const clash = commits.get(envelope.logicalId);
        if (clash !== undefined) {
          throw new SecretSyncError('remote-corrupt', 'A logical id is used by both a blob and a commit.');
        }
        blobs.set(envelope.logicalId, envelope);
      } else {
        const existing = commits.get(envelope.logicalId);
        if (existing !== undefined) {
          throw new SecretSyncError('remote-corrupt', 'Conflicting duplicate commit ids are corruption.');
        }
        const clash = blobs.get(envelope.logicalId);
        if (clash !== undefined) {
          throw new SecretSyncError('remote-corrupt', 'A logical id is used by both a blob and a commit.');
        }
        commits.set(envelope.logicalId, envelope);
      }
      continue;
    }
    if (previous !== canonical) {
      throw new SecretSyncError('remote-corrupt', 'Conflicting duplicate logical ids are corruption.');
    }
  }
  void blobProviders;
  void commitProviders;
  return { blobs, commits, blobProviders, commitProviders };
}

export function deduplicateRecordDetails(
  details: Array<{ detail: ConnectItemDetail; envelope: RecordEnvelope }>,
): DeduplicatedDetails {
  const blobs = new Map<string, BlobEnvelope>();
  const commits = new Map<string, CommitEnvelope>();
  const blobProviders = new Map<string, string>();
  const commitProviders = new Map<string, string>();
  const seenCanonical = new Map<string, string>();
  for (const entry of details) {
    const envelope = entry.envelope;
    const canonical = canonicalJson(envelope);
    const previous = seenCanonical.get(envelope.logicalId);
    if (previous !== undefined && previous !== canonical) {
      throw new SecretSyncError('remote-corrupt', 'Conflicting duplicate logical ids are corruption.');
    }
    if (previous !== undefined) {
      continue;
    }
    seenCanonical.set(envelope.logicalId, canonical);
    if (envelope.kind === 'blob') {
      if (commits.has(envelope.logicalId)) {
        throw new SecretSyncError('remote-corrupt', 'A logical id is used by both a blob and a commit.');
      }
      blobs.set(envelope.logicalId, envelope);
      blobProviders.set(envelope.logicalId, entry.detail.id);
    } else {
      if (blobs.has(envelope.logicalId)) {
        throw new SecretSyncError('remote-corrupt', 'A logical id is used by both a blob and a commit.');
      }
      commits.set(envelope.logicalId, envelope);
      commitProviders.set(envelope.logicalId, entry.detail.id);
    }
  }
  return { blobs, commits, blobProviders, commitProviders };
}
