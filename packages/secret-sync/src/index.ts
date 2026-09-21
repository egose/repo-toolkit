import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { isPlainObject } from '@repo-toolkit/publish-package';

import {
  loadSecretSyncConfigFile,
  validateBranchName,
  validateSecretSyncCommandOptions,
  validateSecretSyncConfig,
} from './config';
import { selectExactFiles, toSlashPath } from './discovery';
import type {
  BranchSubcommand,
  SecretSyncCommand,
  SecretSyncCommandOptions,
  SecretSyncPlan,
  SecretSyncRawConfig,
  VaultSubcommand,
} from './types';

export type {
  BranchSubcommand,
  SecretSyncCommand,
  SecretSyncCommandOptions,
  SecretSyncPlan,
  VaultSubcommand,
} from './types';
export type {
  SecretSyncConnectRemoteConfig,
  SecretSyncLimits,
  SecretSyncRawConfig,
  SecretSyncRemoteConfig,
  SecretSyncSdkAuthConfig,
  SecretSyncSdkDesktopAuth,
  SecretSyncSdkRemoteConfig,
  SecretSyncSdkServiceAccountAuth,
  SecretSyncValidatedConfig,
} from './types';
export {
  DEFAULT_BRANCH,
  DEFAULT_LIMITS,
  DEFAULT_SDK_TOKEN_ENV,
  MAX_CONCURRENCY_HARD_CEILING,
  MAX_FILES_HARD_CEILING,
  MAX_FILE_BYTES_HARD_CEILING,
  MAX_SCAN_RECORDS,
  SECRET_SYNC_SCHEMA_VERSION,
  isConnectRemote,
  isSdkRemote,
  loadSecretSyncConfigFile,
  normalizeProjectRelPath,
  validateBranchName,
  validateGlobPatterns,
  validateLimits,
  validateRemoteConfig,
  validateSecretSyncCommandOptions,
  validateSecretSyncConfig,
} from './config';
export {
  SECRET_SYNC_STATE_DIR,
  createSelectionMatcher,
  discoverLocalFiles,
  isAlwaysExcluded,
  matchesExclusion,
  matchesFilesSelection,
  selectExactFiles,
} from './discovery';
export type { DiscoveryOptions, DiscoveryResult, ExactSelectionOptions, SelectionMatcherOptions } from './discovery';
export { SecretSyncError, isRetryableSecretSyncError, isSecretSyncError } from './errors';
export type { SecretSyncErrorCode, SecretSyncErrorOptions } from './errors';
export {
  validateConnectItemDetail,
  validateConnectItemSummary,
  validateCreateConnectItemInput,
  validateCreateSecretItemInput,
  validateItemId,
  validateListResponse,
  validateSecretItemDetail,
  validateSecretItemSummary,
} from './store';
export type {
  ConnectItemDetail,
  ConnectItemField,
  ConnectItemSummary,
  CreateConnectItemInput,
  CreateItemResult,
  CreateSecretItemInput,
  ListItemsOptions,
  SecretItemDetail,
  SecretItemField,
  SecretItemSummary,
  SecretStore,
} from './store';
export {
  SHARED_DEFAULT_CONCURRENCY,
  SHARED_MAX_CONCURRENCY,
  mapWithConcurrency,
  validateConcurrency,
} from './concurrency';
export {
  CONNECT_DEFAULT_CONCURRENCY,
  CONNECT_MAX_CONCURRENCY,
  CONNECT_MAX_DETAIL_BYTES,
  CONNECT_MAX_GET_RETRIES,
  CONNECT_MAX_LIST_BYTES,
  CONNECT_TIMEOUT_MS,
  ConnectSecretStore,
  buildTitleFilter,
  createConnectStore,
  delayForAttempt,
  escapeConnectFilterValue,
  isLoopbackHostname,
  parseRetryAfterMs,
  readBoundedText,
  resolveConnectBaseUrl,
} from './connect';
export type { ConnectStoreOptions, FetchHeadersLike, FetchLike, FetchRequestInit, FetchResponseLike } from './connect';
export {
  SDK_INTEGRATION_NAME,
  SDK_INTEGRATION_VERSION,
  SDK_MAX_DETAIL_BYTES,
  SDK_MAX_GET_RETRIES,
  SDK_MAX_RECORDS,
  SDK_TIMEOUT_MS,
  SdkSecretStore,
  createSdkStore,
  defaultSdkClientFactory,
} from './sdk';
export type {
  SdkClientFactory,
  SdkClientLike,
  SdkCreateField,
  SdkCreateParams,
  SdkFactoryAuth,
  SdkFactoryConfig,
  SdkFieldLike,
  SdkItemLike,
  SdkItemsApiLike,
  SdkListFilter,
  SdkOverviewLike,
  SdkStoreOptions,
} from './sdk';
export {
  MAX_BLOB_BYTES,
  MAX_OPERATION_KIND_CHARS,
  MAX_PARENTS,
  MAX_RECORD_BYTES,
  MAX_TREE_ENTRIES,
  RECORD_MARKER,
  RECORD_SCHEMA_VERSION,
  buildCreateInput,
  buildRecordTitle,
  canonicalJson,
  createBlobRecord,
  createCommitRecord,
  decodeEnvelopeJson,
  decodeRecordEnvelope,
  deduplicateDecodedEnvelopes,
  deduplicateRecordDetails,
  parseRecordTitle,
  serializeBlobEnvelope,
  serializeCommitEnvelope,
  sha256Hex,
  validateTreePath,
} from './records';
export type {
  BlobEnvelope,
  BlobRecord,
  BlobTreeEntry,
  CommitEnvelope,
  CommitRecord,
  CreateCommitArgs,
  DeduplicatedDetails,
  RecordEnvelope,
} from './records';
export {
  MAX_GRAPH_NODES,
  classifyBranchState,
  collectAncestors,
  collectReachableCommits,
  deriveBranchHeads,
  findMissingParents,
  indexCommitsById,
  isAncestor,
  requireSingleHead,
} from './graph';
export type { BranchGraphStatus } from './graph';
export {
  HISTORY_DEFAULT_CONCURRENCY,
  HISTORY_MAX_RECORDS,
  findCommitsByOperationId,
  loadRawHistory,
  loadValidatedHistory,
  materializeTreeBytes,
  publishBlob,
  publishCommit,
  publishSnapshot,
  reconcileBlobByContent,
  reconcileRecordByLogicalId,
  validateHistoryDependencies,
} from './history-store';
export type {
  HistoryLoadOptions,
  LoadedHistory,
  PublishBlobOptions,
  PublishBlobResult,
  PublishCommitArgs,
  PublishCommitOptions,
  PublishCommitResult,
  PublishSnapshotArgs,
  PublishSnapshotResult,
} from './history-store';
export {
  assertBaselineSlot,
  assertLocalSlot,
  buildStatusReport,
  collectStatusEntries,
  compareFile,
  evaluateCheck,
  resolveStatusSelection,
  summarizeHeads,
} from './status';
export type {
  BaselineSlot,
  BranchHeadSummary,
  BuildStatusReportArgs,
  CollectStatusArgs,
  FileFingerprint,
  FileStatus,
  FileStatusEntry,
  HeadState,
  LocalSlot,
  RemoteSlot,
  SlotMap,
  StatusReport,
  SummarizeHeadsOptions,
} from './status';
export { deriveRemoteTree, isNoopPlan, planSync, requireSingleBranchHead } from './plan';
export type {
  PendingDeletion,
  PlannedAction,
  PlanOptions,
  PlanSnapshots,
  ResultingTreeEntry,
  SyncDirection,
  SyncEffects,
  SyncPlan,
} from './plan';
export { diffCommits, diffSnapshots, summarizeDiff } from './diff';
export type { DiffEntry, DiffSummary } from './diff';
export {
  SECRET_SYNC_LOCK_FILE_NAME,
  SECRET_SYNC_STATE_FILE_NAME,
  SECRET_SYNC_STATE_SCHEMA_VERSION,
  STATE_DIR_MODE,
  STATE_FILE_MODE,
  STATE_LOCK_RACE_LIMITS,
  STATE_LOCK_STALE_MS,
  acquireStateLock,
  assertIdentityMatches,
  assertSecretSyncState,
  computeFileHmac,
  createFingerprintKey,
  fingerprintBytes,
  getBaseline,
  identitiesMatch,
  initState,
  loadState,
  loadStateFile,
  normalizeOperationIdentity,
  readStateIfPresent,
  remoteIdentityFromConfig,
  resolveStateDir,
  resolveStatePaths,
  resolveStateRoot,
  saveState,
  setActiveBranch,
  setBaseline,
  setMaterializedBranch,
  setObservedHeads,
  validateRemoteEndpoint,
  validateRemoteIdentity,
  validateStateRemote,
} from './state';
export type {
  AbsentBaseline,
  AcquireLockOptions,
  ConnectRemoteIdentity,
  ConnectStateRemote,
  FileBaseline,
  InitStateOptions,
  LegacyRemoteIdentity,
  OperationIdentityInput,
  PresentBaseline,
  RemoteBinding,
  RemoteIdentity,
  SaveStateHooks,
  SaveStateOptions,
  SdkRemoteIdentity,
  SdkStateRemote,
  SecretSyncState,
  StateLock,
  StatePaths,
  StateRemote,
} from './state';
export {
  FILESYSTEM_RACE_LIMITS,
  SAFE_WRITE_FILE_MODE,
  SAFE_WRITE_TEMP_PREFIX,
  assertAncestorDirsSafe,
  assertNoCaseCollision,
  checkDestinationKind,
  detectCaseCollision,
  readFileBounded,
  removeFileGuarded,
  resolveSafeDestination,
  writeFileAtomically,
} from './filesystem';
export type {
  DestinationKind,
  ReadBoundedOptions,
  RemoveGuardOptions,
  SafeWriteHooks,
  SafeWriteOptions,
} from './filesystem';
export {
  JOURNAL_FILE_NAME,
  JOURNAL_SCHEMA_VERSION,
  appendJournalEntry,
  assertJournalEntry,
  assertNewJournalEntry,
  clearAcknowledgedEntries,
  hmacForBytes,
  loadJournal,
  markJournalStatus,
  recoverJournal,
  removeOrphanTempFiles,
  resolveJournalPath,
} from './journal';
export type {
  AppendJournalOptions,
  JournalEntry,
  JournalEntryKind,
  JournalEntryStatus,
  JournalHooks,
  JournalRecovery,
  MarkJournalOptions,
  NewJournalEntry,
  RecoverJournalOptions,
  VerifyFileResult,
} from './journal';
export {
  OPERATION_DEFAULT_CONCURRENCY,
  OPERATION_RECORD_DIR_NAME,
  OPERATION_RECORD_SCHEMA_VERSION,
  assertPersistedOperation,
  baselinesToSlots,
  buildPublishNote,
  buildPullNote,
  createOperationId,
  headsEqual,
  listWorktreeFiles,
  loadBranchHistory,
  localBytesToSlots,
  observeHeadsAfter,
  publishUploadsBounded,
  recheckHeads,
  requireSingleOperationHead,
  resolveOperationConcurrency,
  resolveOperationDir,
  resolveSyncCandidates,
  resolveTimestamp,
  readOperationRecord,
  scanLocalSlots,
  sortedHeadIds,
  validateSizeBounds,
  writeOperationRecord,
} from './operations';
export type {
  BranchHistory,
  ObservedHistory,
  OperationKind,
  PersistedOperation,
  PublishedUpload,
  ScannedLocal,
  UploadInput,
} from './operations';
export { CLI_SCHEMA_VERSION, buildErrorEnvelope, buildSuccessEnvelope, redactText, sanitizeValue } from './format';
export { INIT_DEFAULT_CONFIG, initSecrets } from './init';
export type { InitOptions, InitResult } from './init';
export { doctorSecrets } from './doctor';
export type { DoctorAuthMode, DoctorCheck, DoctorOptions, DoctorProvider, DoctorResult } from './doctor';
export {
  assertCommandFlags,
  collectCliSecrets,
  createSecretStoreForPlan,
  resolveEndpointForPlan,
  resolveIdentityForPlan,
} from './cli-options';
export type { StoreOverrides } from './cli-options';
export { listVaults } from './vaults';
export type { VaultListOptions, VaultListResult } from './vaults';
export { showFile } from './show';
export type { ShowOptions, ShowResult } from './show';
export { defaultClipboardSpawn, resolveClipboardCandidates, systemClipboardWriter } from './clipboard';
export type { ClipboardCommand, ClipboardSpawn, ClipboardWriter } from './clipboard';
export { INTERACTIVE_CURRENT_REVISION, resolveInteractiveShowTarget } from './show-interactive';
export type {
  InteractiveRevisionEntry,
  InteractiveShowTarget,
  ResolveInteractiveShowTargetOptions,
  ShowPicker,
} from './show-interactive';
export { pushSecrets } from './push';
export type { PushHooks, PushOptions, PushResult } from './push';
export { pullSecrets } from './pull';
export type { PullHooks, PullOptions, PullResult } from './pull';
export { LOG_DEFAULT_LIMIT, LOG_MAX_LIMIT, logFileHistory } from './log';
export type { LogEntry, LogOptions, LogResult } from './log';
export { restoreFile } from './restore';
export type { RestoreHooks, RestoreOptions, RestoreResult } from './restore';
export { rollbackFile } from './rollback';
export type { RollbackHooks, RollbackOptions, RollbackResult } from './rollback';
export { createBranch, listBranches, switchBranch } from './branches';
export type {
  BranchCreateOptions,
  BranchCreateResult,
  BranchListEntry,
  BranchListResult,
  SwitchHooks,
  SwitchOptions,
  SwitchResult,
} from './branches';
export { resolveFork } from './resolve';
export type { ResolveOptions, ResolveResult } from './resolve';

export const SECRET_SYNC_COMMANDS: ReadonlyArray<SecretSyncCommand> = [
  'init',
  'doctor',
  'status',
  'push',
  'pull',
  'diff',
  'log',
  'restore',
  'rollback',
  'branch',
  'switch',
  'resolve',
  'vault',
  'show',
];

export interface SecretSyncOptions {
  config?: string;
  cwd?: string;
  command?: string;
  branchSubcommand?: string;
  vaultSubcommand?: string;
  interactive?: boolean;
  copy?: boolean;
  clipboard?: import('./clipboard').ClipboardWriter;
  projectId?: string;
  root?: string;
  remote?: unknown;
  branch?: string;
  files?: string[];
  ignore?: string[];
  limits?: unknown;
  file?: string[];
  dryRun?: boolean;
  json?: boolean;
  check?: boolean;
  remove?: boolean;
  message?: string;
  revision?: string;
  limit?: number | string;
  overwrite?: boolean;
  acknowledgeRemote?: boolean;
  fromBranch?: string;
  heads?: string[];
  take?: string;
  name?: string;
  from?: string;
  vault?: string;
  provider?: string;
  auth?: string;
  account?: string;
  tokenEnv?: string;
  store?: import('./store').SecretStore;
  fetchImpl?: import('./connect').FetchLike;
  sdkClientFactory?: import('./sdk').SdkClientFactory;
  env?: Record<string, string | undefined>;
}

export type SecretSyncResult =
  | { command: 'init'; result: import('./init').InitResult }
  | { command: 'doctor'; result: import('./doctor').DoctorResult }
  | { command: 'status'; result: import('./status').StatusReport }
  | { command: 'push'; result: import('./push').PushResult }
  | { command: 'pull'; result: import('./pull').PullResult }
  | { command: 'diff'; result: DiffCommandResult }
  | { command: 'log'; result: import('./log').LogResult }
  | { command: 'restore'; result: import('./restore').RestoreResult }
  | { command: 'rollback'; result: import('./rollback').RollbackResult }
  | { command: 'branch'; result: BranchCommandResult }
  | { command: 'switch'; result: import('./branches').SwitchResult }
  | { command: 'resolve'; result: import('./resolve').ResolveResult }
  | { command: 'vault'; result: VaultCommandResult }
  | { command: 'show'; result: import('./show').ShowResult; bytes: Uint8Array };

export interface DiffCommandResult {
  branch: string;
  heads: string[];
  entries: import('./diff').DiffEntry[];
  summary: import('./diff').DiffSummary;
  dryRun: boolean;
}

export type BranchCommandResult =
  | ({ subcommand: 'list' } & import('./branches').BranchListResult)
  | ({ subcommand: 'create' } & import('./branches').BranchCreateResult);

export type VaultCommandResult = { subcommand: 'list' } & import('./vaults').VaultListResult;

function resolveCommand(value: string | undefined): SecretSyncCommand {
  const command = value ?? 'status';
  if (!(SECRET_SYNC_COMMANDS as ReadonlyArray<string>).includes(command)) {
    throw new Error(`Unknown command: ${command}. Expected one of ${SECRET_SYNC_COMMANDS.join(', ')}.`);
  }
  return command as SecretSyncCommand;
}

function resolveBranchSubcommand(command: SecretSyncCommand, value: string | undefined): BranchSubcommand | undefined {
  if (command !== 'branch') {
    if (value !== undefined) {
      throw new Error('A branch subcommand is only accepted after the branch command.');
    }
    return undefined;
  }
  const subcommand = value ?? 'list';
  if (subcommand !== 'list' && subcommand !== 'create') {
    throw new Error(`Unknown branch subcommand: ${subcommand}. Expected one of list, create.`);
  }
  return subcommand;
}

function resolveVaultSubcommand(command: SecretSyncCommand, value: string | undefined): VaultSubcommand | undefined {
  if (command !== 'vault') {
    return undefined;
  }
  const subcommand = value ?? 'list';
  if (subcommand !== 'list') {
    throw new Error(`Unknown vault subcommand: ${subcommand}. Expected one of list.`);
  }
  return subcommand;
}

const VAULT_DISCOVERY_VAULT_ID = 'vault-discovery';

function buildVaultDiscoveryRemote(options: SecretSyncOptions): unknown {
  if (options.remote !== undefined) {
    return options.remote;
  }
  if (options.provider === undefined) {
    throw new Error(
      'vault list without a config file requires --provider <onepassword-connect|onepassword-sdk> to select a backend.',
    );
  }
  if (options.provider !== 'onepassword-connect' && options.provider !== 'onepassword-sdk') {
    throw new Error('--provider must be "onepassword-connect" or "onepassword-sdk".');
  }
  if (options.provider === 'onepassword-sdk') {
    if (options.auth === undefined) {
      throw new Error('vault list with --provider onepassword-sdk requires --auth <service-account|desktop>.');
    }
    if (options.auth !== 'service-account' && options.auth !== 'desktop') {
      throw new Error('--auth must be "service-account" or "desktop".');
    }
    if (options.account !== undefined && options.auth !== 'desktop') {
      throw new Error('--account requires --auth desktop.');
    }
    if (options.tokenEnv !== undefined && options.auth !== 'service-account') {
      throw new Error('--token-env requires --auth service-account.');
    }
    if (options.tokenEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.tokenEnv)) {
      throw new Error('--token-env must be an environment variable name (OP_SERVICE_ACCOUNT_TOKEN by default).');
    }
    if (options.auth === 'desktop') {
      if (options.account === undefined || options.account.length === 0) {
        throw new Error('vault list with --auth desktop requires --account <selector>.');
      }
      return {
        type: 'onepassword-sdk',
        vaultId: VAULT_DISCOVERY_VAULT_ID,
        auth: { type: 'desktop', account: options.account },
      };
    }
    return {
      type: 'onepassword-sdk',
      vaultId: VAULT_DISCOVERY_VAULT_ID,
      auth: {
        type: 'service-account',
        tokenEnv: options.tokenEnv ?? 'OP_SERVICE_ACCOUNT_TOKEN',
      },
    };
  }
  if (options.auth !== undefined || options.account !== undefined || options.tokenEnv !== undefined) {
    throw new Error('--auth, --account, and --token-env are only supported with --provider onepassword-sdk.');
  }
  return { type: 'onepassword-connect', vaultId: VAULT_DISCOVERY_VAULT_ID };
}

function resolveLimit(value: number | string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`--limit must be a positive safe integer, got ${JSON.stringify(value)}.`);
  }
  return parsed;
}

export async function resolveSecretSyncPlan(options: SecretSyncOptions = {}): Promise<SecretSyncPlan> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const command = resolveCommand(options.command);
  const branchSubcommand = resolveBranchSubcommand(command, options.branchSubcommand);
  const vaultSubcommand = resolveVaultSubcommand(command, options.vaultSubcommand);
  if (command !== 'vault' && options.vaultSubcommand !== undefined) {
    throw new Error('A vault subcommand is only accepted after the vault command.');
  }

  let raw: SecretSyncRawConfig = {};
  let configPath: string | undefined;
  let configDir = cwd;
  let configLoaded = false;
  if (options.config !== undefined) {
    const loaded = await loadSecretSyncConfigFile(options.config, cwd);
    if (!isPlainObject(loaded.raw)) {
      throw new Error(`Config file must export an object: ${loaded.configPath}`);
    }
    raw = loaded.raw;
    configPath = loaded.configPath;
    configDir = loaded.configDir;
    configLoaded = true;
  }
  if (
    options.config === undefined &&
    options.remote === undefined &&
    options.projectId === undefined &&
    options.root === undefined &&
    options.branch === undefined &&
    options.files === undefined &&
    options.ignore === undefined &&
    options.limits === undefined
  ) {
    const implicitPath = resolve(cwd, 'secret-sync.config.json');
    try {
      const text = await readFile(implicitPath, 'utf8');
      const parsed: unknown = JSON.parse(text);
      if (!isPlainObject(parsed)) {
        throw new Error(`Config file must export an object: ${implicitPath}`);
      }
      raw = parsed as SecretSyncRawConfig;
      configPath = implicitPath;
      configDir = cwd;
      configLoaded = true;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Config file must export an object')) {
        throw error;
      }
    }
  }
  const merged: SecretSyncRawConfig = { ...raw };
  if (options.projectId !== undefined) merged.projectId = options.projectId;
  if (options.root !== undefined) merged.root = options.root;
  if (options.remote !== undefined) merged.remote = options.remote;
  if (options.branch !== undefined) merged.branch = options.branch;
  if (options.files !== undefined) merged.files = options.files;
  if (options.ignore !== undefined) merged.ignore = options.ignore;
  if (options.limits !== undefined) merged.limits = options.limits;
  if (options.config === undefined && merged.schemaVersion === undefined) {
    merged.schemaVersion = 1;
  }
  if (!configLoaded && command !== 'vault' && merged.remote === undefined && merged.projectId === undefined) {
    throw new Error(
      `No config file found. Pass --config <path> (default: ./secret-sync.config.json in the working directory) or run 'repo-toolkit-secret-sync init --vault <vault-id>' to create one.`,
    );
  }
  if (command === 'vault' && !configLoaded) {
    if (
      options.provider !== undefined ||
      options.auth !== undefined ||
      options.account !== undefined ||
      options.tokenEnv !== undefined ||
      options.remote !== undefined
    ) {
      merged.remote = buildVaultDiscoveryRemote(options);
    } else if (merged.remote === undefined) {
      throw new Error(
        'vault list without a config file requires --provider <onepassword-connect|onepassword-sdk> to select a backend.',
      );
    }
    if (merged.projectId === undefined) {
      merged.projectId = randomUUID();
    }
  } else if (
    command === 'vault' &&
    (options.provider !== undefined ||
      options.auth !== undefined ||
      options.account !== undefined ||
      options.tokenEnv !== undefined)
  ) {
    throw new Error(
      'vault list with a config file takes no --provider/--auth/--account/--token-env; the config already selects the backend.',
    );
  }

  const validated = validateSecretSyncConfig(merged);
  const activeBranch = options.branch !== undefined ? validateBranchName(options.branch) : validated.branch;
  const rootAbsolute = resolve(configDir, validated.root);

  let configRelPath: string | undefined;
  if (configPath !== undefined) {
    const rel = relative(rootAbsolute, configPath);
    if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) {
      configRelPath = toSlashPath(rel);
    }
  }

  const selection =
    options.file !== undefined
      ? await selectExactFiles(options.file, {
          root: rootAbsolute,
          files: validated.files,
          ignore: validated.ignore,
          ...(configRelPath === undefined ? {} : { configRelPath }),
        })
      : [];

  const commandOptions: SecretSyncCommandOptions = {
    ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
    ...(options.json === undefined ? {} : { json: options.json }),
    ...(options.check === undefined ? {} : { check: options.check }),
    ...(options.remove === undefined ? {} : { remove: options.remove }),
    ...(options.message === undefined ? {} : { message: options.message }),
    ...(options.revision === undefined ? {} : { revision: options.revision }),
    ...(resolveLimit(options.limit) === undefined ? {} : { limit: resolveLimit(options.limit) as number }),
    ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
    ...(options.acknowledgeRemote === undefined ? {} : { acknowledgeRemote: options.acknowledgeRemote }),
    ...(options.fromBranch === undefined ? {} : { fromBranch: options.fromBranch }),
    ...(options.heads === undefined ? {} : { heads: [...options.heads] }),
    ...(options.take === undefined ? {} : { take: options.take }),
    ...(options.name === undefined ? {} : { name: options.name }),
    ...(options.from === undefined ? {} : { from: options.from }),
    ...(options.vault === undefined ? {} : { vault: options.vault }),
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    ...(options.auth === undefined ? {} : { auth: options.auth }),
    ...(options.account === undefined ? {} : { account: options.account }),
    ...(options.tokenEnv === undefined ? {} : { tokenEnv: options.tokenEnv }),
    ...(options.branch === undefined ? {} : { branch: activeBranch }),
    ...(selection.length === 0 ? {} : { files: selection }),
    ...(branchSubcommand === undefined ? {} : { branchSubcommand }),
    ...(vaultSubcommand === undefined ? {} : { vaultSubcommand }),
    ...(options.interactive === undefined ? {} : { interactive: options.interactive }),
    ...(options.copy === undefined ? {} : { copy: options.copy }),
  };

  validateSecretSyncCommandOptions(command, commandOptions, branchSubcommand ?? 'list');

  return {
    ...validated,
    branch: activeBranch,
    cwd,
    rootAbsolute,
    ...(configPath === undefined ? {} : { configPath }),
    command,
    commandOptions,
  };
}

export async function runSecretSync(options: SecretSyncOptions = {}): Promise<SecretSyncResult> {
  const command = resolveCommand(options.command);
  const branchSubcommand = resolveBranchSubcommand(command, options.branchSubcommand);
  const vaultSubcommand = resolveVaultSubcommand(command, options.vaultSubcommand);
  if (command !== 'vault' && options.vaultSubcommand !== undefined) {
    throw new Error('A vault subcommand is only accepted after the vault command.');
  }
  if (command === 'init') {
    const { initSecrets } = await import('./init');
    const result = await initSecrets({
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.config === undefined ? {} : { config: options.config }),
      ...(options.vault === undefined ? {} : { vault: options.vault }),
      ...(options.provider === undefined ? {} : { provider: options.provider }),
      ...(options.auth === undefined ? {} : { auth: options.auth }),
      ...(options.account === undefined ? {} : { account: options.account }),
      ...(options.tokenEnv === undefined ? {} : { tokenEnv: options.tokenEnv }),
      ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
      ...(options.branch === undefined ? {} : { branch: options.branch }),
      ...(options.root === undefined ? {} : { root: options.root }),
      ...(options.env === undefined ? {} : { env: options.env }),
    });
    return { command: 'init', result };
  }
  const plan = await resolveSecretSyncPlan(options);
  const env = options.env ?? (process.env as Record<string, string | undefined>);
  const { createSecretStoreForPlan, resolveIdentityForPlan } = await import('./cli-options');
  const store = createSecretStoreForPlan(plan, {
    ...(options.store === undefined ? {} : { store: options.store }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.sdkClientFactory === undefined ? {} : { sdkClientFactory: options.sdkClientFactory }),
    env,
  });
  const identity = resolveIdentityForPlan(plan, env);
  const dryRun = plan.commandOptions.dryRun === true;
  switch (plan.command) {
    case 'doctor': {
      const { doctorSecrets } = await import('./doctor');
      const result = await doctorSecrets({
        store,
        rootAbsolute: plan.rootAbsolute,
        branch: resolveTargetBranch(plan),
        identity,
        remote: plan.remote,
        files: plan.files,
        ignore: plan.ignore,
        ...(configRelForPlan(plan) === undefined ? {} : { configRelPath: configRelForPlan(plan) as string }),
        maxFileBytes: plan.limits.maxFileBytes,
        maxFiles: plan.limits.maxFiles,
        concurrency: plan.limits.concurrency,
        ...(plan.configPath === undefined ? {} : { configPath: plan.configPath }),
      });
      return { command: 'doctor', result };
    }
    case 'status': {
      const result = await executeStatus(plan, store, identity);
      return { command: 'status', result };
    }
    case 'push': {
      const { pushSecrets } = await import('./push');
      const branch = await resolveActiveBranch(plan);
      const selection = await resolveEffectiveSelection(plan, store, branch);
      const result = await pushSecrets({
        store,
        rootAbsolute: plan.rootAbsolute,
        branch,
        identity,
        ...(selection === undefined ? {} : { selection }),
        ...(plan.commandOptions.remove === undefined ? {} : { allowDelete: plan.commandOptions.remove }),
        ...(plan.commandOptions.message === undefined ? {} : { message: plan.commandOptions.message }),
        concurrency: plan.limits.concurrency,
        maxFileBytes: plan.limits.maxFileBytes,
        maxFiles: plan.limits.maxFiles,
        ...(dryRun ? { dryRun: true } : {}),
      });
      return { command: 'push', result };
    }
    case 'pull': {
      const { pullSecrets } = await import('./pull');
      const branch = await resolveActiveBranch(plan);
      const selection = await resolveEffectiveSelection(plan, store, branch);
      const result = await pullSecrets({
        store,
        rootAbsolute: plan.rootAbsolute,
        branch,
        identity,
        ...(selection === undefined ? {} : { selection }),
        ...(plan.commandOptions.remove === undefined ? {} : { allowDelete: plan.commandOptions.remove }),
        concurrency: plan.limits.concurrency,
        maxFileBytes: plan.limits.maxFileBytes,
        maxFiles: plan.limits.maxFiles,
        ...(dryRun ? { dryRun: true } : {}),
      });
      return { command: 'pull', result };
    }
    case 'diff': {
      const result = await executeDiff(plan, store);
      return { command: 'diff', result };
    }
    case 'log': {
      const { logFileHistory } = await import('./log');
      const files = plan.commandOptions.files;
      if (files === undefined || files.length !== 1) {
        throw new Error('log requires exactly one --file <path>.');
      }
      const result = await logFileHistory({
        store,
        projectId: identity.projectId,
        branch: resolveTargetBranch(plan),
        path: files[0] as string,
        ...(plan.commandOptions.limit === undefined ? {} : { limit: plan.commandOptions.limit }),
        concurrency: plan.limits.concurrency,
      });
      return { command: 'log', result };
    }
    case 'restore': {
      const { restoreFile } = await import('./restore');
      const files = plan.commandOptions.files;
      if (files === undefined || files.length !== 1) {
        throw new Error('restore requires exactly one --file <path>.');
      }
      const result = await restoreFile({
        store,
        rootAbsolute: plan.rootAbsolute,
        branch: await resolveActiveBranch(plan),
        path: files[0] as string,
        ...(plan.commandOptions.revision === undefined ? {} : { revision: plan.commandOptions.revision }),
        ...(plan.commandOptions.fromBranch === undefined ? {} : { fromBranch: plan.commandOptions.fromBranch }),
        ...(plan.commandOptions.overwrite === undefined ? {} : { overwrite: plan.commandOptions.overwrite }),
        ...(plan.commandOptions.acknowledgeRemote === undefined
          ? {}
          : { acknowledgeRemote: plan.commandOptions.acknowledgeRemote }),
        ...(dryRun ? { dryRun: true } : {}),
        maxFileBytes: plan.limits.maxFileBytes,
        concurrency: plan.limits.concurrency,
        identity,
      });
      return { command: 'restore', result };
    }
    case 'rollback': {
      const { rollbackFile } = await import('./rollback');
      const files = plan.commandOptions.files;
      if (files === undefined || files.length !== 1) {
        throw new Error('rollback requires exactly one --file <path>.');
      }
      if (plan.commandOptions.revision === undefined) {
        throw new Error('rollback requires --revision <blob-id>.');
      }
      const result = await rollbackFile({
        store,
        rootAbsolute: plan.rootAbsolute,
        branch: await resolveActiveBranch(plan),
        path: files[0] as string,
        revision: plan.commandOptions.revision,
        ...(plan.commandOptions.message === undefined ? {} : { message: plan.commandOptions.message }),
        concurrency: plan.limits.concurrency,
        ...(dryRun ? { dryRun: true } : {}),
        maxFileBytes: plan.limits.maxFileBytes,
        identity,
      });
      return { command: 'rollback', result };
    }
    case 'branch': {
      if ((branchSubcommand ?? 'list') === 'list') {
        const { listBranches } = await import('./branches');
        const listed = await listBranches(store, identity.projectId, plan.limits.concurrency);
        return { command: 'branch', result: { subcommand: 'list', ...listed } };
      }
      const { createBranch } = await import('./branches');
      if (plan.commandOptions.name === undefined) {
        throw new Error('branch create requires --name <branch>.');
      }
      const created = await createBranch({
        store,
        rootAbsolute: plan.rootAbsolute,
        name: plan.commandOptions.name,
        ...(plan.commandOptions.from === undefined ? {} : { from: plan.commandOptions.from }),
        concurrency: plan.limits.concurrency,
        ...(dryRun ? { dryRun: true } : {}),
        identity,
      });
      return { command: 'branch', result: { subcommand: 'create', ...created } };
    }
    case 'switch': {
      const { switchBranch } = await import('./branches');
      if (plan.commandOptions.branch === undefined) {
        throw new Error('switch requires --branch <name>.');
      }
      const result = await switchBranch({
        store,
        rootAbsolute: plan.rootAbsolute,
        targetBranch: plan.commandOptions.branch,
        identity,
        concurrency: plan.limits.concurrency,
        maxFileBytes: plan.limits.maxFileBytes,
        ...(dryRun ? { dryRun: true } : {}),
      });
      return { command: 'switch', result };
    }
    case 'resolve': {
      const { resolveFork } = await import('./resolve');
      if (plan.commandOptions.heads === undefined || plan.commandOptions.take === undefined) {
        throw new Error('resolve requires --head <commit-id> (repeatable) and --take <commit-id>.');
      }
      const result = await resolveFork({
        store,
        rootAbsolute: plan.rootAbsolute,
        branch: resolveTargetBranch(plan),
        heads: [...plan.commandOptions.heads],
        take: plan.commandOptions.take,
        concurrency: plan.limits.concurrency,
        ...(dryRun ? { dryRun: true } : {}),
        identity,
      });
      return { command: 'resolve', result };
    }
    case 'vault': {
      if ((vaultSubcommand ?? plan.commandOptions.vaultSubcommand ?? 'list') !== 'list') {
        throw new Error(`Unknown vault subcommand. Expected one of list.`);
      }
      const { listVaults } = await import('./vaults');
      const listed = await listVaults({ store, ...(dryRun ? { dryRun: true } : {}) });
      return { command: 'vault', result: { subcommand: 'list', ...listed } };
    }
    case 'show': {
      const { showFile } = await import('./show');
      let path: string;
      let revision = plan.commandOptions.revision;
      let branch = resolveTargetBranch(plan);
      if (plan.commandOptions.interactive === true) {
        const { resolveInteractiveShowTarget } = await import('./show-interactive');
        const files = plan.commandOptions.files;
        if (files !== undefined && files.length > 1) {
          throw new Error('show accepts exactly one --file <path>.');
        }
        const target = await resolveInteractiveShowTarget({
          store,
          branch,
          ...(files?.[0] === undefined ? {} : { path: files[0] as string }),
          ...(revision === undefined ? {} : { revision }),
          concurrency: plan.limits.concurrency,
          identity,
        });
        path = target.path;
        revision = target.revision;
        branch = target.branch;
      } else {
        const files = plan.commandOptions.files;
        if (files === undefined || files.length !== 1) {
          throw new Error('show requires exactly one --file <path>.');
        }
        path = files[0] as string;
      }
      const shown = await showFile({
        store,
        branch,
        path,
        ...(revision === undefined ? {} : { revision }),
        concurrency: plan.limits.concurrency,
        ...(dryRun ? { dryRun: true } : {}),
        ...(plan.commandOptions.copy === true ? { copy: true as const } : {}),
        ...(options.clipboard === undefined ? {} : { clipboard: options.clipboard }),
        identity,
      });
      return { command: 'show', result: shown.result, bytes: shown.bytes };
    }
    default: {
      throw new Error(`Command "${plan.command}" is not yet implemented (scaffold only).`);
    }
  }
}

function configRelForPlan(plan: SecretSyncPlan): string | undefined {
  if (plan.configPath === undefined) {
    return undefined;
  }
  const rel = relative(plan.rootAbsolute, plan.configPath);
  if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) {
    return toSlashPath(rel);
  }
  return undefined;
}

function resolveTargetBranch(plan: SecretSyncPlan): string {
  if (plan.commandOptions.branch !== undefined) {
    return plan.commandOptions.branch;
  }
  return plan.branch;
}

async function resolveActiveBranch(plan: SecretSyncPlan): Promise<string> {
  const { readStateIfPresent } = await import('./state');
  const state = await readStateIfPresent(plan.rootAbsolute);
  if (state !== undefined) {
    return state.activeBranch;
  }
  return plan.branch;
}

async function resolveEffectiveSelection(
  plan: SecretSyncPlan,
  _store: import('./store').SecretStore,
  branch: string,
): Promise<string[] | undefined> {
  void _store;
  void branch;
  if (plan.commandOptions.files !== undefined) {
    return [...plan.commandOptions.files];
  }
  const { createSelectionMatcher, discoverLocalFiles } = await import('./discovery');
  const { readStateIfPresent } = await import('./state');
  const { loadBranchHistory } = await import('./operations');
  const configRelPath = configRelForPlan(plan);
  const matcher = createSelectionMatcher({
    files: plan.files,
    ignore: plan.ignore,
    ...(configRelPath === undefined ? {} : { extraExcludes: [configRelPath] }),
  });
  const discovered = await discoverLocalFiles({
    root: plan.rootAbsolute,
    files: plan.files,
    ignore: plan.ignore,
    ...(configRelPath === undefined ? {} : { configRelPath }),
  });
  const state = await readStateIfPresent(plan.rootAbsolute);
  const baselinePaths = state === undefined ? [] : Object.keys(state.baselines).filter((path) => matcher(path));
  let remotePaths: string[];
  try {
    const loaded = await loadBranchHistory(_store, plan.projectId, branch, plan.limits.concurrency);
    const head = loaded.heads[0] as { tree: Array<{ path: string }> } | undefined;
    remotePaths = (head === undefined ? [] : head.tree.map((entry) => entry.path)).filter((path) => matcher(path));
  } catch {
    remotePaths = [];
  }
  const union = [...new Set([...discovered.paths, ...baselinePaths, ...remotePaths])].sort();
  return union;
}

async function executeStatus(
  plan: SecretSyncPlan,
  store: import('./store').SecretStore,
  _identity: import('./state').RemoteIdentity,
): Promise<import('./status').StatusReport> {
  void _identity;
  const { baselinesToSlots, loadBranchHistory, scanLocalSlots } = await import('./operations');
  const { readFileBounded } = await import('./filesystem');
  const { readStateIfPresent } = await import('./state');
  const { buildStatusReport } = await import('./status');
  const state = await readStateIfPresent(plan.rootAbsolute);
  const requested = plan.commandOptions.branch;
  const branch = requested !== undefined ? requested : state === undefined ? plan.branch : state.activeBranch;
  const loaded = await loadBranchHistory(store, plan.projectId, branch, plan.limits.concurrency);
  const selection = await resolveEffectiveSelection(plan, store, branch);
  const baselines = state === undefined ? new Map() : baselinesToSlots(state.baselines, loaded.history.blobs);
  const scanned = await scanLocalSlots(
    (path) => readFileBounded(plan.rootAbsolute, path, { maxFileBytes: plan.limits.maxFileBytes }),
    selection ?? [],
  );
  const { deriveRemoteTree } = await import('./plan');
  const head = loaded.heads[0] as import('./records').CommitEnvelope | undefined;
  const remoteTree = deriveRemoteTree(head);
  const remotes = new Map();
  for (const [path, entry] of remoteTree) {
    remotes.set(path, {
      state: 'present',
      fingerprint: { sha256: entry.sha256, byteLength: entry.byteLength, blobId: entry.blobId },
    });
  }
  for (const path of selection ?? []) {
    if (!remotes.has(path)) {
      remotes.set(path, { state: 'absent' });
    }
  }
  return buildStatusReport({
    branch,
    heads: loaded.headIds,
    baselines,
    locals: scanned.slots,
    remotes,
    ...(selection === undefined ? {} : { selection }),
    ...(state === undefined ? {} : { activeBranch: state.activeBranch }),
    ...(state?.materializedBranch === undefined ? {} : { materializedBranch: state.materializedBranch as string }),
  });
}

async function executeDiff(plan: SecretSyncPlan, store: import('./store').SecretStore): Promise<DiffCommandResult> {
  const { baselinesToSlots, loadBranchHistory, scanLocalSlots } = await import('./operations');
  const { readFileBounded } = await import('./filesystem');
  const { readStateIfPresent } = await import('./state');
  const { diffSnapshots, summarizeDiff } = await import('./diff');
  const { deriveRemoteTree } = await import('./plan');
  const state = await readStateIfPresent(plan.rootAbsolute);
  const branch = resolveTargetBranch(plan);
  const loaded = await loadBranchHistory(store, plan.projectId, branch, plan.limits.concurrency);
  const selection = await resolveEffectiveSelection(plan, store, branch);
  const scanned = await scanLocalSlots(
    (path) => readFileBounded(plan.rootAbsolute, path, { maxFileBytes: plan.limits.maxFileBytes }),
    selection ?? [],
  );
  const head = loaded.heads[0] as import('./records').CommitEnvelope | undefined;
  const remoteTree = deriveRemoteTree(head);
  const remotes = new Map();
  for (const [path, entry] of remoteTree) {
    remotes.set(path, {
      state: 'present',
      fingerprint: { sha256: entry.sha256, byteLength: entry.byteLength, blobId: entry.blobId },
    });
  }
  void baselinesToSlots;
  void state;
  const entries = diffSnapshots(scanned.slots, remotes, selection);
  return {
    branch,
    heads: loaded.headIds,
    entries,
    summary: summarizeDiff(entries),
    dryRun: plan.commandOptions.dryRun === true,
  };
}
