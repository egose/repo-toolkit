import { createHmac } from 'node:crypto';
import { chmod, mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { isPlainObject } from '@repo-toolkit/publish-package';

import { normalizeProjectRelPath } from './config';
import { SecretSyncError } from './errors';
import { readFileBounded, SAFE_WRITE_TEMP_PREFIX } from './filesystem';
import { resolveStatePaths, STATE_DIR_MODE, STATE_FILE_MODE } from './state';

export const JOURNAL_SCHEMA_VERSION = 1;
export const JOURNAL_FILE_NAME = 'journal.jsonl';

export type JournalEntryStatus = 'pending' | 'written' | 'acknowledged';
export type JournalEntryKind = 'write' | 'remove';

export interface JournalEntry {
  schemaVersion: 1;
  seq: number;
  opId: string;
  path: string;
  kind: JournalEntryKind;
  byteLength?: number;
  hmac?: string;
  blobId?: string;
  tempName?: string;
  status: JournalEntryStatus;
  timestamp: number;
}

export interface NewJournalEntry {
  opId: string;
  path: string;
  kind: JournalEntryKind;
  byteLength?: number;
  hmac?: string;
  blobId?: string;
  tempName?: string;
  timestamp: number;
}

export interface JournalHooks {
  beforeAppend?: () => void | Promise<void>;
  afterAppend?: () => void | Promise<void>;
  beforeRewrite?: () => void | Promise<void>;
  afterRewrite?: () => void | Promise<void>;
}

export interface AppendJournalOptions {
  hooks?: JournalHooks;
}

export interface MarkJournalOptions {
  hooks?: JournalHooks;
}

export interface VerifyFileResult {
  hmac: string;
  byteLength: number;
}

export interface RecoverJournalOptions {
  readFile?: (path: string) => Promise<Uint8Array | undefined>;
}

export interface JournalRecovery {
  verified: JournalEntry[];
  pending: JournalEntry[];
  acknowledged: JournalEntry[];
  orphanTempsRemoved: string[];
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HMAC_PATTERN = /^[0-9a-f]{64}$/;

export function resolveJournalPath(rootAbsolute: string): string {
  return resolveStatePaths(rootAbsolute).journalFile;
}

function assertUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new SecretSyncError('state-corrupt', `Journal entry carries an invalid ${field}.`);
  }
  return value;
}

export function assertJournalEntry(value: unknown): JournalEntry {
  if (!isPlainObject(value)) {
    throw new SecretSyncError('state-corrupt', 'Journal entry is not an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== JOURNAL_SCHEMA_VERSION) {
    throw new SecretSyncError('state-corrupt', 'Journal entry carries an unsupported schema version.');
  }
  if (typeof record.seq !== 'number' || !Number.isSafeInteger(record.seq) || record.seq < 0) {
    throw new SecretSyncError('state-corrupt', 'Journal entry carries an invalid sequence.');
  }
  const opId = assertUuid(record.opId, 'operation id');
  if (typeof record.path !== 'string') {
    throw new SecretSyncError('state-corrupt', 'Journal entry carries an invalid path.');
  }
  const path = normalizeProjectRelPath(record.path, 'journal path');
  if (path !== record.path) {
    throw new SecretSyncError('state-corrupt', 'Journal path is not in normalized form.');
  }
  if (record.kind !== 'write' && record.kind !== 'remove') {
    throw new SecretSyncError('state-corrupt', 'Journal entry carries an unknown kind.');
  }
  if (record.status !== 'pending' && record.status !== 'written' && record.status !== 'acknowledged') {
    throw new SecretSyncError('state-corrupt', 'Journal entry carries an unknown status.');
  }
  if (typeof record.timestamp !== 'number' || !Number.isSafeInteger(record.timestamp) || record.timestamp < 0) {
    throw new SecretSyncError('state-corrupt', 'Journal entry carries an invalid timestamp.');
  }
  const allowed = new Set([
    'schemaVersion',
    'seq',
    'opId',
    'path',
    'kind',
    'byteLength',
    'hmac',
    'blobId',
    'tempName',
    'status',
    'timestamp',
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new SecretSyncError('state-corrupt', 'Journal entry carries an unknown field.');
    }
  }
  for (const forbidden of ['bytes', 'content', 'contentBase64', 'body', 'sha256']) {
    if (Object.prototype.hasOwnProperty.call(record, forbidden)) {
      throw new SecretSyncError('state-corrupt', 'Journal entry exposes a forbidden body field.');
    }
  }
  const entry: JournalEntry = {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    seq: record.seq as number,
    opId,
    path,
    kind: record.kind,
    status: record.status,
    timestamp: record.timestamp as number,
  };
  if (record.byteLength !== undefined) {
    if (typeof record.byteLength !== 'number' || !Number.isSafeInteger(record.byteLength) || record.byteLength < 0) {
      throw new SecretSyncError('state-corrupt', 'Journal entry carries an invalid byteLength.');
    }
    entry.byteLength = record.byteLength;
  }
  if (record.hmac !== undefined) {
    if (typeof record.hmac !== 'string' || !HMAC_PATTERN.test(record.hmac)) {
      throw new SecretSyncError('state-corrupt', 'Journal entry carries an invalid hmac.');
    }
    entry.hmac = record.hmac;
  }
  if (record.blobId !== undefined) {
    entry.blobId = assertUuid(record.blobId, 'blob id');
  }
  if (record.tempName !== undefined) {
    if (typeof record.tempName !== 'string' || record.tempName.length === 0 || record.tempName.includes('/')) {
      throw new SecretSyncError('state-corrupt', 'Journal entry carries an invalid temp name.');
    }
    entry.tempName = record.tempName;
  }
  if (entry.kind === 'write' && (entry.hmac === undefined || entry.byteLength === undefined)) {
    throw new SecretSyncError('state-corrupt', 'Journal write entry is missing its fingerprint.');
  }
  return entry;
}

export function assertNewJournalEntry(value: NewJournalEntry): void {
  assertUuid(value.opId, 'operation id');
  const normalized = normalizeProjectRelPath(value.path, 'journal path');
  if (normalized !== value.path) {
    throw new SecretSyncError('validation', 'Journal path is not in normalized form.');
  }
  if (value.kind !== 'write' && value.kind !== 'remove') {
    throw new SecretSyncError('validation', 'Journal entry carries an unknown kind.');
  }
  if (!Number.isSafeInteger(value.timestamp) || value.timestamp < 0) {
    throw new SecretSyncError('validation', 'Journal entry carries an invalid timestamp.');
  }
  if (value.hmac !== undefined && (typeof value.hmac !== 'string' || !HMAC_PATTERN.test(value.hmac))) {
    throw new SecretSyncError('validation', 'Journal entry carries an invalid hmac.');
  }
  if (value.byteLength !== undefined && (!Number.isSafeInteger(value.byteLength) || value.byteLength < 0)) {
    throw new SecretSyncError('validation', 'Journal entry carries an invalid byteLength.');
  }
  if (value.blobId !== undefined) {
    assertUuidForInput(value.blobId);
  }
  if (value.kind === 'write' && (value.hmac === undefined || value.byteLength === undefined)) {
    throw new SecretSyncError('validation', 'Journal write entry is missing its fingerprint.');
  }
}

function assertUuidForInput(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new SecretSyncError('validation', 'Journal entry carries an invalid blob id.');
  }
}

async function ensureStateDirFor(rootAbsolute: string): Promise<string> {
  const paths = resolveStatePaths(rootAbsolute);
  await mkdir(paths.dir, { recursive: true, mode: STATE_DIR_MODE });
  await chmod(paths.dir, STATE_DIR_MODE);
  return paths.journalFile;
}

export async function loadJournal(rootAbsolute: string): Promise<JournalEntry[]> {
  const journalFile = resolveStatePaths(rootAbsolute).journalFile;
  let raw: string;
  try {
    raw = await readFile(journalFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const entries: JournalEntry[] = [];
  const lines = raw.split('\n');
  for (const line of lines) {
    if (line === '') {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      const wrapped = new SecretSyncError('state-corrupt', 'Journal file holds invalid JSON.');
      (wrapped as { cause?: unknown }).cause = error;
      throw wrapped;
    }
    entries.push(assertJournalEntry(parsed));
  }
  entries.sort((left, right) => left.seq - right.seq);
  const seen = new Set<number>();
  for (const entry of entries) {
    if (seen.has(entry.seq)) {
      throw new SecretSyncError('state-corrupt', 'Journal file repeats a sequence number.');
    }
    seen.add(entry.seq);
  }
  return entries;
}

function serializeEntry(entry: JournalEntry): string {
  const record: Record<string, unknown> = {
    schemaVersion: entry.schemaVersion,
    seq: entry.seq,
    opId: entry.opId,
    path: entry.path,
    kind: entry.kind,
    status: entry.status,
    timestamp: entry.timestamp,
  };
  if (entry.byteLength !== undefined) {
    record.byteLength = entry.byteLength;
  }
  if (entry.hmac !== undefined) {
    record.hmac = entry.hmac;
  }
  if (entry.blobId !== undefined) {
    record.blobId = entry.blobId;
  }
  if (entry.tempName !== undefined) {
    record.tempName = entry.tempName;
  }
  return JSON.stringify(record);
}

export async function appendJournalEntry(
  rootAbsolute: string,
  input: NewJournalEntry,
  options: AppendJournalOptions = {},
): Promise<JournalEntry> {
  assertNewJournalEntry(input);
  if (options.hooks?.beforeAppend !== undefined) {
    await options.hooks.beforeAppend();
  }
  const journalFile = await ensureStateDirFor(rootAbsolute);
  const existing = await loadJournal(rootAbsolute);
  const seq = existing.length === 0 ? 0 : (existing[existing.length - 1] as JournalEntry).seq + 1;
  const entry: JournalEntry = {
    schemaVersion: JOURNAL_SCHEMA_VERSION,
    seq,
    opId: input.opId,
    path: input.path,
    kind: input.kind,
    status: 'pending',
    timestamp: input.timestamp,
    ...(input.byteLength === undefined ? {} : { byteLength: input.byteLength }),
    ...(input.hmac === undefined ? {} : { hmac: input.hmac }),
    ...(input.blobId === undefined ? {} : { blobId: input.blobId }),
    ...(input.tempName === undefined ? {} : { tempName: input.tempName }),
  };
  assertJournalEntry(JSON.parse(JSON.stringify(entry)) as unknown);
  const handle = await open(journalFile, 'a', STATE_FILE_MODE);
  try {
    await handle.writeFile(`${serializeEntry(entry)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(journalFile, STATE_FILE_MODE);
  if (options.hooks?.afterAppend !== undefined) {
    await options.hooks.afterAppend();
  }
  return entry;
}

async function rewriteJournal(rootAbsolute: string, entries: JournalEntry[], hooks?: JournalHooks): Promise<void> {
  const journalFile = await ensureStateDirFor(rootAbsolute);
  if (hooks?.beforeRewrite !== undefined) {
    await hooks.beforeRewrite();
  }
  const serialized = entries.map((entry) => serializeEntry(entry)).join('\n');
  const payload = serialized.length === 0 ? '' : `${serialized}\n`;
  const dir = dirname(journalFile);
  const tempName = `.tmp-journal-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 0xffffffff).toString(16)}.tmp`;
  const tempPath = join(dir, tempName);
  await writeFile(tempPath, payload, { mode: STATE_FILE_MODE });
  await chmod(tempPath, STATE_FILE_MODE);
  const handle = await open(tempPath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, journalFile);
  if (hooks?.afterRewrite !== undefined) {
    await hooks.afterRewrite();
  }
  await chmod(journalFile, STATE_FILE_MODE);
  const dirHandle = await open(dir, 'r');
  try {
    await dirHandle.sync();
  } finally {
    await dirHandle.close();
  }
}

export async function markJournalStatus(
  rootAbsolute: string,
  seq: number,
  status: JournalEntryStatus,
  options: MarkJournalOptions = {},
): Promise<JournalEntry> {
  const entries = await loadJournal(rootAbsolute);
  const index = entries.findIndex((entry) => entry.seq === seq);
  if (index === -1) {
    throw new SecretSyncError('state-corrupt', 'Journal has no entry for the requested sequence.');
  }
  const current = entries[index] as JournalEntry;
  const updated: JournalEntry = { ...current, status };
  assertJournalEntry(JSON.parse(JSON.stringify(updated)) as unknown);
  entries[index] = updated;
  await rewriteJournal(rootAbsolute, entries, options.hooks);
  return updated;
}

export async function clearAcknowledgedEntries(
  rootAbsolute: string,
  options: MarkJournalOptions = {},
): Promise<number> {
  const entries = await loadJournal(rootAbsolute);
  const remaining = entries.filter((entry) => entry.status !== 'acknowledged');
  const removed = entries.length - remaining.length;
  if (removed > 0) {
    await rewriteJournal(rootAbsolute, remaining, options.hooks);
  }
  return removed;
}

export async function removeOrphanTempFiles(rootAbsolute: string): Promise<string[]> {
  const paths = resolveStatePaths(rootAbsolute);
  const entries = await loadJournal(rootAbsolute);
  const live = new Set<string>();
  for (const entry of entries) {
    if (entry.status !== 'acknowledged' && entry.tempName !== undefined) {
      live.add(entry.tempName);
    }
  }
  const removed: string[] = [];
  let top: string[];
  try {
    top = await readdir(paths.dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  for (const name of top) {
    if (!name.startsWith(SAFE_WRITE_TEMP_PREFIX) && !name.startsWith('.tmp-')) {
      continue;
    }
    if (live.has(name)) {
      continue;
    }
    try {
      await unlink(join(paths.dir, name));
      removed.push(name);
    } catch {
      continue;
    }
  }
  return removed.sort();
}

export function hmacForBytes(bytes: Uint8Array, localKeyHex: string): string {
  return createHmac('sha256', Buffer.from(localKeyHex, 'hex'))
    .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest('hex');
}

export async function recoverJournal(
  rootAbsolute: string,
  localKeyHex: string,
  options: RecoverJournalOptions = {},
): Promise<JournalRecovery> {
  const entries = await loadJournal(rootAbsolute);
  const verified: JournalEntry[] = [];
  const pending: JournalEntry[] = [];
  const acknowledged: JournalEntry[] = [];
  for (const entry of entries) {
    if (entry.status === 'acknowledged') {
      acknowledged.push(entry);
      continue;
    }
    if (entry.status === 'pending') {
      pending.push(entry);
      continue;
    }
    if (entry.kind === 'remove') {
      verified.push(entry);
      continue;
    }
    let bytes: Uint8Array | undefined;
    if (options.readFile !== undefined) {
      bytes = await options.readFile(entry.path);
    } else {
      try {
        bytes = await readFileBounded(rootAbsolute, entry.path);
      } catch {
        bytes = undefined;
      }
    }
    if (bytes === undefined || entry.hmac === undefined || entry.byteLength === undefined) {
      pending.push(entry);
      continue;
    }
    if (bytes.byteLength !== entry.byteLength) {
      pending.push(entry);
      continue;
    }
    const actual = hmacForBytes(bytes, localKeyHex);
    if (actual !== entry.hmac) {
      pending.push(entry);
      continue;
    }
    verified.push(entry);
  }
  const orphanTempsRemoved = await removeOrphanTempFiles(rootAbsolute);
  return { verified, pending, acknowledged, orphanTempsRemoved };
}
