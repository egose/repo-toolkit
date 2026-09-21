import { createHmac, randomBytes } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { isPlainObject } from '@repo-toolkit/publish-package';

import { normalizeProjectRelPath, validateBranchName } from './config';
import { SECRET_SYNC_STATE_DIR } from './discovery';
import { SecretSyncError } from './errors';

export const SECRET_SYNC_STATE_SCHEMA_VERSION = 2;
export const SECRET_SYNC_STATE_FILE_NAME = 'state.json';
export const SECRET_SYNC_LOCK_FILE_NAME = 'state.lock';
export const SECRET_SYNC_JOURNAL_FILE_NAME = 'journal.jsonl';
export const STATE_LOCK_STALE_MS = 30000;
export const STATE_DIR_MODE = 0o700;
export const STATE_FILE_MODE = 0o600;

export const STATE_LOCK_RACE_LIMITS = [
  'Local state locks coordinate processes on one host only; they are not a remote distributed lock.',
  'Stale recovery probes the owner with a same-host signal check plus an age bound; a PID that was recycled on the same host can look live.',
  'Lock acquisition, destination rechecks, and rename are separate filesystem steps; a privileged local writer can still race them.',
  'On network or case-insensitive filesystems, lock visibility and name comparisons may lag; callers must treat a busy lock as a reason to retry later.',
  'Windows ACLs do not map one-to-one to POSIX modes; permission values asserted on POSIX are recorded as unverified on Windows.',
].join(' ');

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const HEX64_PATTERN = /^[0-9a-f]{64}$/;
const HMAC_PATTERN = /^[0-9a-f]{64}$/;

export interface ConnectStateRemote {
  type: 'onepassword-connect';
  endpoint: string;
  vaultId: string;
}

export interface SdkStateRemote {
  type: 'onepassword-sdk';
  vaultId: string;
}

export type StateRemote = ConnectStateRemote | SdkStateRemote;
export type RemoteBinding = StateRemote;

export interface ConnectRemoteIdentity {
  type: 'onepassword-connect';
  endpoint: string;
  vaultId: string;
  projectId: string;
}

export interface SdkRemoteIdentity {
  type: 'onepassword-sdk';
  vaultId: string;
  projectId: string;
}

export type RemoteIdentity = ConnectRemoteIdentity | SdkRemoteIdentity;

export type LegacyRemoteIdentity = {
  endpoint: string;
  vaultId: string;
  projectId: string;
};

export interface AbsentBaseline {
  state: 'absent';
}

export interface PresentBaseline {
  state: 'present';
  hmac: string;
  byteLength: number;
  blobId: string;
  commitId?: string;
}

export type FileBaseline = AbsentBaseline | PresentBaseline;

export interface SecretSyncState {
  schemaVersion: 2;
  projectId: string;
  remote: StateRemote;
  activeBranch: string;
  materializedBranch?: string;
  localKey: string;
  baselines: Record<string, FileBaseline>;
  heads: Record<string, string[]>;
  journalSeq: number;
}

export interface StatePaths {
  dir: string;
  stateFile: string;
  lockFile: string;
  journalFile: string;
}

export interface StateLock {
  release(): Promise<void>;
}

export interface AcquireLockOptions {
  staleMs?: number;
  now?: number;
  pid?: number;
  nonce?: string;
}

export interface SaveStateHooks {
  beforeRename?: () => void | Promise<void>;
  afterRename?: () => void | Promise<void>;
}

export interface SaveStateOptions {
  hooks?: SaveStateHooks;
}

export interface InitStateOptions {
  branch?: string;
  hooks?: SaveStateHooks;
}

export function resolveStateDir(rootAbsolute: string): string {
  return join(resolve(rootAbsolute), SECRET_SYNC_STATE_DIR);
}

export function resolveStatePaths(rootAbsolute: string): StatePaths {
  const dir = resolveStateDir(rootAbsolute);
  return {
    dir,
    stateFile: join(dir, SECRET_SYNC_STATE_FILE_NAME),
    lockFile: join(dir, SECRET_SYNC_LOCK_FILE_NAME),
    journalFile: join(dir, SECRET_SYNC_JOURNAL_FILE_NAME),
  };
}

export function createFingerprintKey(): string {
  return randomBytes(32).toString('hex');
}

export function computeFileHmac(bytes: Uint8Array, localKeyHex: string): string {
  if (!HEX64_PATTERN.test(localKeyHex)) {
    throw new SecretSyncError('state-corrupt', 'Local fingerprint key has an invalid shape.');
  }
  return createHmac('sha256', Buffer.from(localKeyHex, 'hex'))
    .update(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    .digest('hex');
}

export function fingerprintBytes(bytes: Uint8Array, localKeyHex: string): { hmac: string; byteLength: number } {
  return { hmac: computeFileHmac(bytes, localKeyHex), byteLength: bytes.byteLength };
}

export function validateRemoteEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SecretSyncError('validation', 'Remote endpoint must be a non-empty URL string.');
  }
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new SecretSyncError('validation', 'Remote endpoint is not a valid URL.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new SecretSyncError('validation', 'Remote endpoint must not contain credentials.');
  }
  if (url.hash !== '') {
    throw new SecretSyncError('validation', 'Remote endpoint must not contain a fragment.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SecretSyncError('validation', 'Remote endpoint must use https or http loopback.');
  }
  if (url.protocol === 'http:') {
    const host = url.hostname.toLowerCase();
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!loopback) {
      throw new SecretSyncError('validation', 'Plain http endpoints are only allowed for loopback hosts.');
    }
  }
  return trimmed;
}

function assertVaultId(value: unknown, code: 'validation' | 'state-corrupt', what: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new SecretSyncError(code, `${what} carries an invalid vault id.`);
  }
  if (value.includes('\0') || value.includes('/') || value.includes('\n') || value.includes('\r')) {
    throw new SecretSyncError(code, `${what} carries an invalid vault id.`);
  }
  return value;
}

function assertProjectUuid(value: unknown, code: 'validation' | 'state-corrupt', what: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new SecretSyncError(code, `${what} carries an invalid project id.`);
  }
  return value;
}

function rejectUnknownFields(record: Record<string, unknown>, allowed: ReadonlySet<string>, what: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new SecretSyncError('validation', `${what} carries an unknown field ${JSON.stringify(key)}.`);
    }
  }
}

const CONNECT_IDENTITY_FIELDS = new Set(['type', 'endpoint', 'vaultId', 'projectId']);
const SDK_IDENTITY_FIELDS = new Set(['type', 'vaultId', 'projectId']);
const CONNECT_REMOTE_FIELDS = new Set(['type', 'endpoint', 'vaultId']);
const SDK_REMOTE_FIELDS = new Set(['type', 'vaultId']);
const SDK_FORBIDDEN_IDENTITY_FIELDS = new Set(['endpoint', 'auth', 'token', 'tokenEnv', 'account', 'session']);

export function validateStateRemote(value: unknown): StateRemote {
  if (!isPlainObject(value)) {
    throw new SecretSyncError('validation', 'Remote binding must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.type === 'onepassword-connect') {
    rejectUnknownFields(record, CONNECT_REMOTE_FIELDS, 'Remote binding');
    return {
      type: 'onepassword-connect',
      endpoint: validateRemoteEndpoint(record.endpoint),
      vaultId: assertVaultId(record.vaultId, 'validation', 'Remote binding'),
    };
  }
  if (record.type === 'onepassword-sdk') {
    rejectUnknownFields(record, SDK_REMOTE_FIELDS, 'Remote binding');
    return { type: 'onepassword-sdk', vaultId: assertVaultId(record.vaultId, 'validation', 'Remote binding') };
  }
  throw new SecretSyncError('validation', 'Remote binding carries an unknown type.');
}

export function validateRemoteIdentity(value: unknown): RemoteIdentity {
  if (!isPlainObject(value)) {
    throw new SecretSyncError('validation', 'Remote identity must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.type === undefined) {
    rejectUnknownFields(record, CONNECT_IDENTITY_FIELDS, 'Remote identity');
    const endpoint = validateRemoteEndpoint(record.endpoint);
    const vaultId = assertVaultId(record.vaultId, 'validation', 'Remote identity');
    const projectId = assertProjectUuid(record.projectId, 'validation', 'Remote identity');
    return { type: 'onepassword-connect', endpoint, vaultId, projectId };
  }
  if (record.type === 'onepassword-connect') {
    rejectUnknownFields(record, CONNECT_IDENTITY_FIELDS, 'Remote identity');
    return {
      type: 'onepassword-connect',
      endpoint: validateRemoteEndpoint(record.endpoint),
      vaultId: assertVaultId(record.vaultId, 'validation', 'Remote identity'),
      projectId: assertProjectUuid(record.projectId, 'validation', 'Remote identity'),
    };
  }
  if (record.type === 'onepassword-sdk') {
    rejectUnknownFields(record, SDK_IDENTITY_FIELDS, 'Remote identity');
    for (const forbidden of SDK_FORBIDDEN_IDENTITY_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(record, forbidden)) {
        throw new SecretSyncError('validation', 'Remote identity mixes Connect and SDK identity forms.');
      }
    }
    return {
      type: 'onepassword-sdk',
      vaultId: assertVaultId(record.vaultId, 'validation', 'Remote identity'),
      projectId: assertProjectUuid(record.projectId, 'validation', 'Remote identity'),
    };
  }
  throw new SecretSyncError('validation', 'Remote identity carries an unknown type.');
}

export interface OperationIdentityInput {
  endpoint?: unknown;
  vaultId?: unknown;
  projectId?: unknown;
  remote?: unknown;
  identity?: unknown;
}

export function normalizeOperationIdentity(input: OperationIdentityInput): RemoteIdentity {
  const hasIdentity = input.identity !== undefined;
  const hasRemote = input.remote !== undefined;
  const hasEndpoint = input.endpoint !== undefined;
  const hasVault = input.vaultId !== undefined;
  const hasProject = input.projectId !== undefined;
  if (hasIdentity) {
    if (hasRemote || hasEndpoint || hasVault || hasProject) {
      throw new SecretSyncError('validation', 'Operation identity mixes old and new identity forms.');
    }
    return validateRemoteIdentity(input.identity);
  }
  if (hasRemote) {
    if (hasEndpoint || hasVault) {
      throw new SecretSyncError('validation', 'Operation identity mixes old and new identity forms.');
    }
    if (!hasProject) {
      throw new SecretSyncError('validation', 'Operation remote binding requires a project id.');
    }
    const remote = validateStateRemote(input.remote);
    const projectId = assertProjectUuid(input.projectId, 'validation', 'Remote identity');
    if (remote.type === 'onepassword-connect') {
      return { type: 'onepassword-connect', endpoint: remote.endpoint, vaultId: remote.vaultId, projectId };
    }
    return { type: 'onepassword-sdk', vaultId: remote.vaultId, projectId };
  }
  return validateRemoteIdentity({ endpoint: input.endpoint, vaultId: input.vaultId, projectId: input.projectId });
}

export function remoteIdentityFromConfig(
  remote: { type: string; vaultId: string },
  projectId: string,
  endpoint?: string,
): RemoteIdentity {
  const resolvedProject = assertProjectUuid(projectId, 'validation', 'Remote identity');
  if (remote.type === 'onepassword-sdk') {
    return {
      type: 'onepassword-sdk',
      vaultId: assertVaultId(remote.vaultId, 'validation', 'Remote identity'),
      projectId: resolvedProject,
    };
  }
  if (remote.type === 'onepassword-connect') {
    if (typeof endpoint !== 'string' || endpoint.length === 0) {
      throw new SecretSyncError('validation', 'Connect identity requires a resolved endpoint.');
    }
    return {
      type: 'onepassword-connect',
      endpoint: validateRemoteEndpoint(endpoint),
      vaultId: assertVaultId(remote.vaultId, 'validation', 'Remote identity'),
      projectId: resolvedProject,
    };
  }
  throw new SecretSyncError('validation', 'Remote identity carries an unknown type.');
}

function assertUuidField(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new SecretSyncError('state-corrupt', `State carries an invalid ${field}.`);
  }
  return value;
}

function assertBaseline(path: string, value: unknown): FileBaseline {
  if (!isPlainObject(value)) {
    throw new SecretSyncError('state-corrupt', `State baseline for ${JSON.stringify(path)} is not an object.`);
  }
  const record = value as Record<string, unknown>;
  for (const forbidden of ['sha256', 'contentBase64', 'bytes', 'content', 'body']) {
    if (Object.prototype.hasOwnProperty.call(record, forbidden)) {
      throw new SecretSyncError(
        'state-corrupt',
        `State baseline for ${JSON.stringify(path)} exposes a forbidden field.`,
      );
    }
  }
  if (record.state === 'absent') {
    for (const key of Object.keys(record)) {
      if (key !== 'state') {
        throw new SecretSyncError(
          'state-corrupt',
          `State baseline for ${JSON.stringify(path)} carries an unknown field.`,
        );
      }
    }
    return { state: 'absent' };
  }
  if (record.state === 'present') {
    if (typeof record.hmac !== 'string' || !HMAC_PATTERN.test(record.hmac)) {
      throw new SecretSyncError('state-corrupt', `State baseline for ${JSON.stringify(path)} carries an invalid hmac.`);
    }
    if (typeof record.byteLength !== 'number' || !Number.isSafeInteger(record.byteLength) || record.byteLength < 0) {
      throw new SecretSyncError(
        'state-corrupt',
        `State baseline for ${JSON.stringify(path)} carries an invalid byteLength.`,
      );
    }
    const blobId = assertUuidField(record.blobId, 'blob id');
    const allowed = new Set(['state', 'hmac', 'byteLength', 'blobId', 'commitId']);
    for (const key of Object.keys(record)) {
      if (!allowed.has(key)) {
        throw new SecretSyncError(
          'state-corrupt',
          `State baseline for ${JSON.stringify(path)} carries an unknown field.`,
        );
      }
    }
    const baseline: PresentBaseline = { state: 'present', hmac: record.hmac, byteLength: record.byteLength, blobId };
    if (record.commitId !== undefined) {
      baseline.commitId = assertUuidField(record.commitId, 'commit id');
    }
    return baseline;
  }
  throw new SecretSyncError('state-corrupt', `State baseline for ${JSON.stringify(path)} carries an unknown state.`);
}

function assertStateRemoteRecord(value: unknown): StateRemote {
  if (!isPlainObject(value)) {
    throw new SecretSyncError('state-corrupt', 'State file carries an invalid remote identity.');
  }
  const record = value as Record<string, unknown>;
  if (record.type === undefined) {
    for (const key of Object.keys(record)) {
      if (key !== 'endpoint' && key !== 'vaultId') {
        throw new SecretSyncError('state-corrupt', 'State file carries an unknown remote field.');
      }
    }
    if (typeof record.endpoint !== 'string' || record.endpoint.length === 0) {
      throw new SecretSyncError('state-corrupt', 'State file carries an invalid remote endpoint.');
    }
    let endpoint: string;
    try {
      endpoint = validateRemoteEndpoint(record.endpoint);
    } catch {
      throw new SecretSyncError('state-corrupt', 'State file carries an invalid remote endpoint.');
    }
    const vaultId = assertVaultId(record.vaultId, 'state-corrupt', 'State file');
    return { type: 'onepassword-connect', endpoint, vaultId };
  }
  if (record.type === 'onepassword-connect') {
    for (const key of Object.keys(record)) {
      if (key !== 'type' && key !== 'endpoint' && key !== 'vaultId') {
        throw new SecretSyncError('state-corrupt', 'State file carries an unknown remote field.');
      }
    }
    let endpoint: string;
    try {
      endpoint = validateRemoteEndpoint(record.endpoint);
    } catch {
      throw new SecretSyncError('state-corrupt', 'State file carries an invalid remote endpoint.');
    }
    return {
      type: 'onepassword-connect',
      endpoint,
      vaultId: assertVaultId(record.vaultId, 'state-corrupt', 'State file'),
    };
  }
  if (record.type === 'onepassword-sdk') {
    for (const key of Object.keys(record)) {
      if (key !== 'type' && key !== 'vaultId') {
        throw new SecretSyncError('state-corrupt', 'State file carries an unknown remote field.');
      }
    }
    return { type: 'onepassword-sdk', vaultId: assertVaultId(record.vaultId, 'state-corrupt', 'State file') };
  }
  throw new SecretSyncError('state-corrupt', 'State file carries an unknown remote type.');
}

export function assertSecretSyncState(value: unknown): SecretSyncState {
  if (!isPlainObject(value)) {
    throw new SecretSyncError('state-corrupt', 'State file is not a JSON object.');
  }
  const record = value as Record<string, unknown>;
  const allowedTop = new Set([
    'schemaVersion',
    'projectId',
    'remote',
    'activeBranch',
    'materializedBranch',
    'localKey',
    'baselines',
    'heads',
    'journalSeq',
  ]);
  for (const key of Object.keys(record)) {
    if (!allowedTop.has(key)) {
      throw new SecretSyncError('state-corrupt', 'State file carries an unknown field.');
    }
  }
  if (record.schemaVersion !== SECRET_SYNC_STATE_SCHEMA_VERSION && record.schemaVersion !== 1) {
    throw new SecretSyncError('state-corrupt', 'State file carries an unsupported schema version.');
  }
  const projectId = assertUuidField(record.projectId, 'project id');
  const remote = assertStateRemoteRecord(record.remote);
  let activeBranch: string;
  let materializedBranch: string | undefined;
  try {
    activeBranch = validateBranchName(record.activeBranch);
  } catch {
    throw new SecretSyncError('state-corrupt', 'State file carries an invalid active branch.');
  }
  if (record.materializedBranch !== undefined) {
    try {
      materializedBranch = validateBranchName(record.materializedBranch);
    } catch {
      throw new SecretSyncError('state-corrupt', 'State file carries an invalid materialized branch.');
    }
  }
  if (typeof record.localKey !== 'string' || !HEX64_PATTERN.test(record.localKey)) {
    throw new SecretSyncError('state-corrupt', 'State file carries an invalid local fingerprint key.');
  }
  if (!isPlainObject(record.baselines)) {
    throw new SecretSyncError('state-corrupt', 'State file carries invalid baselines.');
  }
  const baselines: Record<string, FileBaseline> = {};
  for (const key of Object.keys(record.baselines as Record<string, unknown>)) {
    const normalized = normalizeProjectRelPath(key, 'baseline path');
    if (normalized !== key) {
      throw new SecretSyncError('state-corrupt', 'State baseline path is not in normalized form.');
    }
    baselines[key] = assertBaseline(key, (record.baselines as Record<string, unknown>)[key]);
  }
  if (!isPlainObject(record.heads)) {
    throw new SecretSyncError('state-corrupt', 'State file carries invalid heads.');
  }
  const heads: Record<string, string[]> = {};
  for (const key of Object.keys(record.heads as Record<string, unknown>)) {
    const branch = validateBranchName(key);
    const ids = (record.heads as Record<string, unknown>)[key];
    if (!Array.isArray(ids)) {
      throw new SecretSyncError('state-corrupt', 'State heads entry is not an array.');
    }
    const resolved: string[] = [];
    for (const id of ids) {
      resolved.push(assertUuidField(id, 'head id'));
    }
    heads[branch] = [...new Set(resolved)].sort();
  }
  if (typeof record.journalSeq !== 'number' || !Number.isSafeInteger(record.journalSeq) || record.journalSeq < 0) {
    throw new SecretSyncError('state-corrupt', 'State file carries an invalid journal sequence.');
  }
  const state: SecretSyncState = {
    schemaVersion: SECRET_SYNC_STATE_SCHEMA_VERSION,
    projectId,
    remote,
    activeBranch,
    localKey: record.localKey as string,
    baselines,
    heads,
    journalSeq: record.journalSeq as number,
  };
  if (materializedBranch !== undefined) {
    state.materializedBranch = materializedBranch;
  }
  return state;
}

export function identitiesMatch(left: RemoteIdentity, state: SecretSyncState): boolean {
  if (left.projectId !== state.projectId || left.vaultId !== state.remote.vaultId) {
    return false;
  }
  if (left.type !== state.remote.type) {
    return false;
  }
  if (left.type === 'onepassword-connect' && state.remote.type === 'onepassword-connect') {
    return left.endpoint === state.remote.endpoint;
  }
  return true;
}

export function assertIdentityMatches(identity: RemoteIdentity, state: SecretSyncState): void {
  if (!identitiesMatch(identity, state)) {
    throw new SecretSyncError(
      'identity-mismatch',
      'Configured remote identity differs from local state; use a fresh worktree and state directory with the same vault and project ids, then reconcile local files through unbased-conflict rules instead of reusing this baseline.',
    );
  }
}

async function ensureStateDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: STATE_DIR_MODE });
  await chmod(dir, STATE_DIR_MODE);
}

async function writeAtomicFile(target: string, serialized: string, hooks?: SaveStateHooks): Promise<void> {
  const dir = dirname(target);
  await ensureStateDir(dir);
  const tempName = `.tmp-state-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 0xffffffff).toString(16)}.json`;
  const tempPath = join(dir, tempName);
  await writeFile(tempPath, serialized, { mode: STATE_FILE_MODE });
  await chmod(tempPath, STATE_FILE_MODE);
  const handle = await open(tempPath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (hooks?.beforeRename !== undefined) {
    await hooks.beforeRename();
  }
  await rename(tempPath, target);
  if (hooks?.afterRename !== undefined) {
    await hooks.afterRename();
  }
  await chmod(target, STATE_FILE_MODE);
  const dirHandle = await open(dir, 'r');
  try {
    await dirHandle.sync();
  } finally {
    await dirHandle.close();
  }
}

export async function saveState(
  rootAbsolute: string,
  state: SecretSyncState,
  options: SaveStateOptions = {},
): Promise<void> {
  const validated = assertSecretSyncState(JSON.parse(JSON.stringify(state)) as unknown);
  const paths = resolveStatePaths(rootAbsolute);
  await writeAtomicFile(paths.stateFile, `${JSON.stringify(validated)}\n`, options.hooks);
}

export async function loadStateFile(rootAbsolute: string): Promise<SecretSyncState> {
  const paths = resolveStatePaths(rootAbsolute);
  let raw: string;
  try {
    raw = await readFile(paths.stateFile, 'utf8');
  } catch (error) {
    const wrapped = new SecretSyncError('state-corrupt', 'Local state file is missing or unreadable.');
    (wrapped as { cause?: unknown }).cause = error;
    throw wrapped;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const wrapped = new SecretSyncError('state-corrupt', 'Local state file is not valid JSON.');
    (wrapped as { cause?: unknown }).cause = error;
    throw wrapped;
  }
  return assertSecretSyncState(parsed);
}

export async function loadState(
  rootAbsolute: string,
  expectedIdentity?: RemoteIdentity | LegacyRemoteIdentity,
): Promise<SecretSyncState> {
  const state = await loadStateFile(rootAbsolute);
  if (expectedIdentity !== undefined) {
    assertIdentityMatches(validateRemoteIdentity({ ...(expectedIdentity as Record<string, unknown>) }), state);
  }
  return state;
}

export async function readStateIfPresent(rootAbsolute: string): Promise<SecretSyncState | undefined> {
  const paths = resolveStatePaths(rootAbsolute);
  let raw: string;
  try {
    raw = await readFile(paths.stateFile, 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    const wrapped = new SecretSyncError('state-corrupt', 'Local state file is not valid JSON.');
    (wrapped as { cause?: unknown }).cause = error;
    throw wrapped;
  }
  return assertSecretSyncState(parsed);
}

export async function initState(
  rootAbsolute: string,
  identity: RemoteIdentity | LegacyRemoteIdentity | OperationIdentityInput,
  options: InitStateOptions = {},
): Promise<SecretSyncState> {
  const candidate = identity as Record<string, unknown>;
  const normalized =
    Object.prototype.hasOwnProperty.call(candidate, 'identity') ||
    Object.prototype.hasOwnProperty.call(candidate, 'remote')
      ? normalizeOperationIdentity(candidate as OperationIdentityInput)
      : validateRemoteIdentity({ ...candidate });
  const validatedIdentity = normalized;
  const branch = options.branch === undefined ? 'main' : validateBranchName(options.branch);
  const existing = await readStateIfPresent(rootAbsolute);
  if (existing !== undefined) {
    assertIdentityMatches(validatedIdentity, existing);
    return existing;
  }
  const remote: StateRemote =
    validatedIdentity.type === 'onepassword-connect'
      ? { type: 'onepassword-connect', endpoint: validatedIdentity.endpoint, vaultId: validatedIdentity.vaultId }
      : { type: 'onepassword-sdk', vaultId: validatedIdentity.vaultId };
  const state: SecretSyncState = {
    schemaVersion: SECRET_SYNC_STATE_SCHEMA_VERSION,
    projectId: validatedIdentity.projectId,
    remote,
    activeBranch: branch,
    materializedBranch: branch,
    localKey: createFingerprintKey(),
    baselines: {},
    heads: {},
    journalSeq: 0,
  };
  await saveState(rootAbsolute, state, { ...(options.hooks === undefined ? {} : { hooks: options.hooks }) });
  return state;
}

export function getBaseline(state: SecretSyncState, path: string): FileBaseline | undefined {
  const normalized = normalizeProjectRelPath(path, 'baseline path');
  if (Object.prototype.hasOwnProperty.call(state.baselines, normalized)) {
    return state.baselines[normalized];
  }
  return undefined;
}

export function setBaseline(state: SecretSyncState, path: string, baseline: FileBaseline): void {
  const normalized = normalizeProjectRelPath(path, 'baseline path');
  state.baselines[normalized] = assertBaseline(normalized, JSON.parse(JSON.stringify(baseline)) as unknown);
}

export function setActiveBranch(state: SecretSyncState, branch: string): void {
  state.activeBranch = validateBranchName(branch);
}

export function setMaterializedBranch(state: SecretSyncState, branch: string): void {
  state.materializedBranch = validateBranchName(branch);
}

export function setObservedHeads(state: SecretSyncState, branch: string, heads: string[]): void {
  const resolvedBranch = validateBranchName(branch);
  const resolved = heads.map((id) => assertUuidField(id, 'head id'));
  state.heads[resolvedBranch] = [...new Set(resolved)].sort();
}

interface LockPayload {
  pid: number;
  timestamp: number;
  nonce: string;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM') {
      return true;
    }
    return false;
  }
}

async function readLockPayload(lockFile: string): Promise<{ payload?: LockPayload; mtimeMs?: number }> {
  let raw: string;
  try {
    raw = await readFile(lockFile, 'utf8');
  } catch {
    return {};
  }
  let mtimeMs: number | undefined;
  try {
    const stats = await stat(lockFile);
    mtimeMs = stats.mtimeMs;
  } catch {
    mtimeMs = undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.pid !== 'number' || !Number.isSafeInteger(parsed.pid) || parsed.pid <= 0) {
      return { mtimeMs };
    }
    if (typeof parsed.timestamp !== 'number' || !Number.isSafeInteger(parsed.timestamp)) {
      return { mtimeMs };
    }
    if (typeof parsed.nonce !== 'string' || parsed.nonce.length === 0) {
      return { mtimeMs };
    }
    return { payload: { pid: parsed.pid, timestamp: parsed.timestamp, nonce: parsed.nonce }, mtimeMs };
  } catch {
    return { mtimeMs };
  }
}

export async function acquireStateLock(rootAbsolute: string, options: AcquireLockOptions = {}): Promise<StateLock> {
  const paths = resolveStatePaths(rootAbsolute);
  await ensureStateDir(paths.dir);
  const staleMs = options.staleMs ?? STATE_LOCK_STALE_MS;
  const now = options.now ?? Date.now();
  const pid = options.pid ?? process.pid;
  const nonce = options.nonce ?? `${pid}-${now}-${Math.floor(Math.random() * 0xffffffff).toString(16)}`;
  const payload: LockPayload = { pid, timestamp: now, nonce };
  const serialized = `${JSON.stringify(payload)}\n`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(paths.lockFile, 'wx', STATE_FILE_MODE);
      try {
        await handle.writeFile(serialized, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await chmod(paths.lockFile, STATE_FILE_MODE);
      let released = false;
      return {
        release: async (): Promise<void> => {
          if (released) {
            return;
          }
          released = true;
          let current: string;
          try {
            current = await readFile(paths.lockFile, 'utf8');
          } catch {
            return;
          }
          try {
            const parsed = JSON.parse(current) as Record<string, unknown>;
            if (parsed.nonce !== nonce) {
              return;
            }
          } catch {
            return;
          }
          try {
            await unlink(paths.lockFile);
          } catch {
            return;
          }
        },
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw error;
      }
      const observed = await readLockPayload(paths.lockFile);
      const existing = observed.payload;
      const ageMs = observed.mtimeMs === undefined ? now - (existing?.timestamp ?? 0) : now - observed.mtimeMs;
      let stale: boolean;
      if (existing === undefined) {
        stale = ageMs > staleMs;
      } else if (!isPidAlive(existing.pid)) {
        stale = true;
      } else {
        stale = now - existing.timestamp > staleMs;
      }
      if (!stale) {
        throw new SecretSyncError('lock-busy', 'Local state is locked by another process; retry after it finishes.');
      }
      try {
        await unlink(paths.lockFile);
      } catch {
        throw new SecretSyncError('lock-busy', 'Local state is locked by another process; retry after it finishes.');
      }
    }
  }
  throw new SecretSyncError('lock-busy', 'Local state is locked by another process; retry after it finishes.');
}

export function resolveStateRoot(rootAbsolute: string): string {
  return resolve(rootAbsolute);
}
