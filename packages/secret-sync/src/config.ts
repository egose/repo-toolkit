import { isAbsolute, resolve } from 'node:path';

import picomatch from 'picomatch';
import { isPlainObject, loadConfigFile, resolveConfigPath } from '@repo-toolkit/publish-package';

import type {
  BranchSubcommand,
  SecretSyncCommand,
  SecretSyncCommandOptions,
  SecretSyncLimits,
  SecretSyncRawConfig,
  SecretSyncRemoteConfig,
  SecretSyncValidatedConfig,
} from './types';

export const SECRET_SYNC_SCHEMA_VERSION = 1;

export const MAX_FILE_BYTES_HARD_CEILING = 32768;
export const MAX_FILES_HARD_CEILING = 100;
export const MAX_CONCURRENCY_HARD_CEILING = 8;
export const MAX_SCAN_RECORDS = 10000;

export const DEFAULT_LIMITS: SecretSyncLimits = {
  maxFileBytes: MAX_FILE_BYTES_HARD_CEILING,
  maxFiles: MAX_FILES_HARD_CEILING,
  concurrency: 4,
};

export const DEFAULT_BRANCH = 'main';
export const DEFAULT_HOST_ENV = 'OP_CONNECT_HOST';
export const DEFAULT_TOKEN_ENV = 'OP_CONNECT_TOKEN';

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const WINDOWS_ABSOLUTE_PATTERN = /^[A-Za-z]:(\/|$)/;

const TOP_LEVEL_KEYS = new Set(['schemaVersion', 'projectId', 'root', 'remote', 'branch', 'files', 'ignore', 'limits']);

const REMOTE_KEYS = new Set(['type', 'vaultId', 'hostEnv', 'tokenEnv']);
const LIMIT_KEYS = new Set(['maxFileBytes', 'maxFiles', 'concurrency']);

function assertNoUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, what: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`Unknown ${what} field: ${JSON.stringify(key)}.`);
    }
  }
}

export function validateBranchName(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('branch must be a non-empty string matching [A-Za-z0-9][A-Za-z0-9._/-]{0,127}.');
  }
  if (!BRANCH_PATTERN.test(value)) {
    throw new Error(`Invalid branch name ${JSON.stringify(value)}: must match [A-Za-z0-9][A-Za-z0-9._/-]{0,127}.`);
  }
  for (const segment of value.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`Invalid branch name ${JSON.stringify(value)}: empty, ".", and ".." segments are rejected.`);
    }
  }
  return value;
}

function validateEnvName(value: unknown, field: string, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || !ENV_NAME_PATTERN.test(value)) {
    throw new Error(
      `Invalid remote.${field} ${JSON.stringify(value)}: must be an environment variable name (${fallback} by default).`,
    );
  }
  return value;
}

function assertGlobCompilable(pattern: string, field: string): void {
  let compiled: RegExp;
  try {
    compiled = picomatch.makeRe(pattern, { dot: true });
  } catch {
    throw new Error(`Invalid ${field} glob pattern ${JSON.stringify(pattern)}: picomatch cannot compile it.`);
  }
  if (compiled.source === '$^') {
    throw new Error(
      `Invalid ${field} glob pattern ${JSON.stringify(pattern)}: it can never match (did you mean to escape a brace or backslash?).`,
    );
  }
}

export function validateGlobPatterns(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array of glob strings.`);
  }
  const patterns: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      if (entry instanceof RegExp) {
        throw new Error(
          `${field} entries must be glob strings, not RegExp objects (${String(entry)}). Use glob syntax instead.`,
        );
      }
      if (isPlainObject(entry)) {
        throw new Error(`${field} entries must be glob strings, not regex-looking objects. Use glob syntax instead.`);
      }
      throw new Error(`${field} entries must be glob strings, got ${JSON.stringify(entry)}.`);
    }
    if (entry.length === 0) {
      throw new Error(`${field} entries must be non-empty glob strings.`);
    }
    if (entry.includes('\0')) {
      throw new Error(`${field} entries must not contain NUL bytes: ${JSON.stringify(entry)}.`);
    }
    if (entry.startsWith('!')) {
      throw new Error(
        `${field} entry ${JSON.stringify(entry)} starts with "!": re-inclusion ordering is ambiguous; put exclusions in "ignore" instead.`,
      );
    }
    if (entry.startsWith('/') || isAbsolute(entry) || WINDOWS_ABSOLUTE_PATTERN.test(entry)) {
      throw new Error(`${field} entry ${JSON.stringify(entry)} must be a project-relative glob, not an absolute path.`);
    }
    const segments = entry.split(/[\\/]/);
    if (segments.includes('..')) {
      throw new Error(`${field} entry ${JSON.stringify(entry)} must not contain ".." traversal segments.`);
    }
    assertGlobCompilable(entry, field);
    patterns.push(entry);
  }
  return patterns;
}

export function normalizeProjectRelPath(value: unknown, what = 'path'): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${what} must be a non-empty project-relative path.`);
  }
  if (value.includes('\0')) {
    throw new Error(`${what} must not contain NUL bytes.`);
  }
  const slashed = value.split('\\').join('/');
  if (slashed.startsWith('/') || WINDOWS_ABSOLUTE_PATTERN.test(slashed)) {
    throw new Error(`${what} ${JSON.stringify(value)} must be project-relative, not absolute.`);
  }
  const segments = slashed.split('/');
  const cleaned: string[] = [];
  for (const segment of segments) {
    if (cleaned.length === 0 && segment === '.') {
      continue;
    }
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`${what} ${JSON.stringify(value)} is not a valid project-relative file path.`);
    }
    cleaned.push(segment);
  }
  if (cleaned.length === 0) {
    throw new Error(`${what} ${JSON.stringify(value)} is not a valid project-relative file path.`);
  }
  return cleaned.join('/');
}

export function validateRemoteConfig(value: unknown): SecretSyncRemoteConfig {
  if (!isPlainObject(value)) {
    throw new Error('remote must be an object with { type, vaultId, hostEnv, tokenEnv }.');
  }
  const record = value as Record<string, unknown>;
  assertNoUnknownKeys(record, REMOTE_KEYS, 'remote');
  const type = record.type === undefined ? 'onepassword-connect' : record.type;
  if (type !== 'onepassword-connect') {
    throw new Error(`Unsupported remote.type ${JSON.stringify(type)}: expected "onepassword-connect".`);
  }
  if (typeof record.vaultId !== 'string' || record.vaultId.length === 0) {
    throw new Error('remote.vaultId must be a non-empty 1Password vault ID.');
  }
  return {
    type: 'onepassword-connect',
    vaultId: record.vaultId,
    hostEnv: validateEnvName(record.hostEnv, 'hostEnv', DEFAULT_HOST_ENV),
    tokenEnv: validateEnvName(record.tokenEnv, 'tokenEnv', DEFAULT_TOKEN_ENV),
  };
}

export function validateLimits(value: unknown): SecretSyncLimits {
  if (value === undefined) {
    return { ...DEFAULT_LIMITS };
  }
  if (!isPlainObject(value)) {
    throw new Error('limits must be an object with { maxFileBytes, maxFiles, concurrency }.');
  }
  const record = value as Record<string, unknown>;
  assertNoUnknownKeys(record, LIMIT_KEYS, 'limits');
  return {
    maxFileBytes: validateBoundedInt(
      record.maxFileBytes,
      'maxFileBytes',
      MAX_FILE_BYTES_HARD_CEILING,
      DEFAULT_LIMITS.maxFileBytes,
    ),
    maxFiles: validateBoundedInt(record.maxFiles, 'maxFiles', MAX_FILES_HARD_CEILING, DEFAULT_LIMITS.maxFiles),
    concurrency: validateBoundedInt(
      record.concurrency,
      'concurrency',
      MAX_CONCURRENCY_HARD_CEILING,
      DEFAULT_LIMITS.concurrency,
    ),
  };
}

function validateBoundedInt(value: unknown, field: string, ceiling: number, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`limits.${field} must be a positive safe integer, got ${JSON.stringify(value)}.`);
  }
  if (value > ceiling) {
    throw new Error(`limits.${field} ${value} exceeds the hard ceiling of ${ceiling}; lower it instead.`);
  }
  return value;
}

function validateRoot(value: unknown): string {
  if (value === undefined) {
    return '.';
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('root must be a non-empty project-relative directory path.');
  }
  const slashed = value.split('\\').join('/');
  if (slashed.startsWith('/') || WINDOWS_ABSOLUTE_PATTERN.test(slashed)) {
    throw new Error(`root ${JSON.stringify(value)} must be relative to the config directory, not absolute.`);
  }
  const segments = slashed.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) {
    throw new Error(`root ${JSON.stringify(value)} must not escape the config directory with ".." segments.`);
  }
  return segments.length === 0 ? '.' : segments.join('/');
}

export function validateSecretSyncConfig(raw: unknown): SecretSyncValidatedConfig {
  if (!isPlainObject(raw)) {
    throw new Error('Config must be an object.');
  }
  const record = raw as SecretSyncRawConfig & Record<string, unknown>;
  assertNoUnknownKeys(record as Record<string, unknown>, TOP_LEVEL_KEYS, 'config');
  if (record.schemaVersion !== SECRET_SYNC_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schemaVersion ${JSON.stringify(record.schemaVersion)}: expected ${SECRET_SYNC_SCHEMA_VERSION}.`,
    );
  }
  if (typeof record.projectId !== 'string' || !UUID_PATTERN.test(record.projectId)) {
    throw new Error('projectId must be a UUID string.');
  }
  if (record.remote === undefined) {
    throw new Error('remote is required: configure { type, vaultId, hostEnv, tokenEnv }.');
  }
  const files = record.files === undefined ? [] : validateGlobPatterns(record.files, 'files');
  const ignore = record.ignore === undefined ? [] : validateGlobPatterns(record.ignore, 'ignore');
  return {
    schemaVersion: SECRET_SYNC_SCHEMA_VERSION,
    projectId: record.projectId,
    root: validateRoot(record.root),
    remote: validateRemoteConfig(record.remote),
    branch: record.branch === undefined ? DEFAULT_BRANCH : validateBranchName(record.branch),
    files,
    ignore,
    limits: validateLimits(record.limits),
  };
}

export interface LoadedSecretSyncConfig {
  configPath: string;
  configDir: string;
  raw: SecretSyncRawConfig;
}

export async function loadSecretSyncConfigFile(configPath: string, cwd?: string): Promise<LoadedSecretSyncConfig> {
  const resolved = resolveConfigPath(configPath, cwd);
  const raw = await loadConfigFile<SecretSyncRawConfig>(resolved);
  return { configPath: resolved, configDir: resolve(resolved, '..'), raw };
}

const READ_ONLY_COMMANDS: ReadonlySet<SecretSyncCommand> = new Set(['doctor', 'status', 'diff', 'log']);
const DELETION_COMMANDS: ReadonlySet<SecretSyncCommand> = new Set(['push', 'pull']);

export function validateSecretSyncCommandOptions(
  command: SecretSyncCommand,
  options: SecretSyncCommandOptions,
  branchSubcommand: BranchSubcommand = 'list',
): void {
  if (options.check === true && command !== 'status') {
    throw new Error('--check is only supported by the status command.');
  }
  if (options.remove === true && !DELETION_COMMANDS.has(command)) {
    throw new Error('--delete is only supported by the push and pull commands.');
  }
  if (options.message !== undefined && command !== 'push' && command !== 'rollback') {
    throw new Error('--message is only supported by the push and rollback commands.');
  }
  if (options.revision !== undefined && command !== 'restore' && command !== 'rollback') {
    throw new Error('--revision is only supported by the restore and rollback commands.');
  }
  if (options.limit !== undefined && command !== 'log') {
    throw new Error('--limit is only supported by the log command.');
  }
  if (options.overwrite === true && command !== 'restore') {
    throw new Error('--overwrite is only supported by the restore command.');
  }
  if (options.acknowledgeRemote === true && command !== 'restore') {
    throw new Error('--acknowledge-remote is only supported by the restore command.');
  }
  if (options.fromBranch !== undefined && command !== 'restore') {
    throw new Error('--from-branch is only supported by the restore command.');
  }
  if ((options.heads !== undefined || options.take !== undefined) && command !== 'resolve') {
    throw new Error('--head and --take are only supported by the resolve command.');
  }
  if (
    (options.name !== undefined || options.from !== undefined) &&
    !(command === 'branch' && branchSubcommand === 'create')
  ) {
    throw new Error('--name and --from are only supported by the branch create subcommand.');
  }
  if (options.vault !== undefined && command !== 'init') {
    throw new Error('--vault is only supported by the init command.');
  }
  if (
    options.branch !== undefined &&
    !READ_ONLY_COMMANDS.has(command) &&
    command !== 'branch' &&
    command !== 'switch'
  ) {
    throw new Error(
      '--branch targets read-only commands and branch/switch; worktree-mutating commands use the active branch.',
    );
  }

  if (command === 'restore') {
    if (options.revision !== undefined && options.fromBranch !== undefined) {
      throw new Error(
        '--revision and --from-branch are mutually exclusive: restore one historical revision or one branch revision.',
      );
    }
    if (options.revision === undefined && options.fromBranch === undefined) {
      throw new Error('restore requires --revision <blob-id> or --from-branch <name>.');
    }
    if (!options.files || options.files.length === 0) {
      throw new Error('restore requires exactly one --file <path>.');
    }
    if (options.files.length > 1) {
      throw new Error('restore accepts exactly one --file <path>.');
    }
  }
  if (command === 'rollback') {
    if (options.revision === undefined) {
      throw new Error('rollback requires --revision <blob-id>.');
    }
    if (!options.files || options.files.length === 0) {
      throw new Error('rollback requires exactly one --file <path>.');
    }
    if (options.files.length > 1) {
      throw new Error('rollback accepts exactly one --file <path>.');
    }
  }
  if (command === 'resolve') {
    if (!options.heads || options.heads.length < 2) {
      throw new Error('resolve requires at least two --head <commit-id> values.');
    }
    if (options.take === undefined) {
      throw new Error('resolve requires --take <commit-id>.');
    }
    if (!options.heads.includes(options.take)) {
      throw new Error('--take must be one of the --head commit IDs.');
    }
  }
  if (command === 'branch' && branchSubcommand === 'create' && options.name === undefined) {
    throw new Error('branch create requires --name <branch>.');
  }
  if (command === 'branch' && branchSubcommand === 'create' && options.name !== undefined) {
    validateBranchName(options.name);
  }
  if (command === 'branch' && branchSubcommand === 'create' && options.from !== undefined) {
    validateBranchName(options.from);
  }
  if (
    command === 'branch' &&
    branchSubcommand === 'list' &&
    (options.name !== undefined || options.from !== undefined)
  ) {
    throw new Error('branch list takes no --name or --from.');
  }
  if (command === 'switch' && options.branch === undefined) {
    throw new Error('switch requires --branch <name>.');
  }
  if (options.branch !== undefined) {
    validateBranchName(options.branch);
  }
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1)) {
    throw new Error('--limit must be a positive safe integer.');
  }
}
