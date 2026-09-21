import { stat } from 'node:fs/promises';

import {
  CONNECT_MAX_DETAIL_BYTES,
  CONNECT_MAX_GET_RETRIES,
  CONNECT_MAX_LIST_BYTES,
  CONNECT_TIMEOUT_MS,
} from './connect';
import {
  MAX_CONCURRENCY_HARD_CEILING,
  MAX_FILES_HARD_CEILING,
  MAX_FILE_BYTES_HARD_CEILING,
  MAX_SCAN_RECORDS,
} from './config';
import { discoverLocalFiles } from './discovery';
import { SecretSyncError } from './errors';
import { identitiesMatch, readStateIfPresent, validateRemoteIdentity, type RemoteIdentity } from './state';
import { SDK_MAX_DETAIL_BYTES, SDK_MAX_GET_RETRIES, SDK_MAX_RECORDS, SDK_TIMEOUT_MS } from './sdk';
import type { SecretStore } from './store';

export type DoctorProvider = 'onepassword-connect' | 'onepassword-sdk';
export type DoctorAuthMode = 'token' | 'service-account' | 'desktop';

export interface DoctorOptions {
  store: SecretStore;
  rootAbsolute: string;
  projectId?: string;
  branch: string;
  endpoint?: string;
  vaultId?: string;
  remote?: unknown;
  identity?: unknown;
  files: string[];
  ignore: string[];
  configRelPath?: string;
  maxFileBytes: number;
  maxFiles: number;
  concurrency: number;
  configPath?: string;
}

export interface DoctorCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface DoctorResult {
  branch: string;
  projectId: string;
  vaultId: string;
  provider: DoctorProvider;
  authMode: DoctorAuthMode;
  endpointHost?: string;
  account?: string;
  checks: DoctorCheck[];
  recordCount: number;
  localMatchCount: number;
  bounds: Record<string, number>;
  writeProbed: boolean;
  note: string;
}

function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return '(invalid)';
  }
}

function resolveDoctorIdentity(options: DoctorOptions): RemoteIdentity {
  if (options.identity !== undefined) {
    if (options.endpoint !== undefined || options.vaultId !== undefined || options.projectId !== undefined) {
      throw new SecretSyncError('validation', 'Operation identity mixes old and new identity forms.');
    }
    return validateRemoteIdentity(options.identity);
  }
  if (options.remote !== undefined) {
    if (options.endpoint !== undefined || options.vaultId !== undefined) {
      throw new SecretSyncError('validation', 'Operation identity mixes old and new identity forms.');
    }
    if (options.projectId === undefined) {
      throw new SecretSyncError('validation', 'Operation remote binding requires a project id.');
    }
    const remote = options.remote as Record<string, unknown>;
    if (remote.type === 'onepassword-sdk') {
      return validateRemoteIdentity({
        type: 'onepassword-sdk',
        vaultId: remote.vaultId,
        projectId: options.projectId,
      });
    }
    return validateRemoteIdentity({
      endpoint: options.endpoint,
      vaultId: remote.vaultId,
      projectId: options.projectId,
    });
  }
  return validateRemoteIdentity({
    endpoint: options.endpoint,
    vaultId: options.vaultId,
    projectId: options.projectId,
  });
}

function resolveDoctorAuth(identity: RemoteIdentity, remote: unknown): { mode: DoctorAuthMode; account?: string } {
  if (identity.type === 'onepassword-sdk') {
    const record = (remote ?? {}) as { auth?: { type?: unknown; account?: unknown } };
    const auth = record.auth as { type?: unknown; account?: unknown } | undefined;
    if (auth !== undefined && auth.type === 'desktop') {
      return {
        mode: 'desktop',
        ...(typeof auth.account === 'string' && auth.account.length > 0 ? { account: auth.account } : {}),
      };
    }
    return { mode: 'service-account' };
  }
  return { mode: 'token' };
}

export async function doctorSecrets(options: DoctorOptions): Promise<DoctorResult> {
  const identity = resolveDoctorIdentity(options);
  const auth = resolveDoctorAuth(identity, options.remote);
  const provider: DoctorProvider = identity.type;
  const vaultId = identity.vaultId;
  const projectId = identity.projectId;
  const checks: DoctorCheck[] = [];
  checks.push({
    name: 'config',
    status: 'pass',
    detail: 'Config schema, branch, limits, and remote identity validated.',
  });
  checks.push({
    name: 'matching',
    status: 'pass',
    detail: `Glob selection uses picomatch with dotfiles enabled and case-sensitive matching over ${options.files.length} inclusion pattern(s).`,
  });

  let localMatchCount = 0;
  try {
    const discovered = await discoverLocalFiles({
      root: options.rootAbsolute,
      files: options.files,
      ignore: options.ignore,
      ...(options.configRelPath === undefined ? {} : { configRelPath: options.configRelPath }),
    });
    localMatchCount = discovered.paths.length;
    checks.push({
      name: 'local-permissions',
      status: 'pass',
      detail: `Discovered ${discovered.paths.length} selected file(s); symlinks and special files are never followed.`,
    });
  } catch (error) {
    checks.push({
      name: 'local-permissions',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const state = await readStateIfPresent(options.rootAbsolute);
  if (state === undefined) {
    checks.push({
      name: 'state',
      status: 'warn',
      detail:
        provider === 'onepassword-sdk'
          ? 'No local state yet; it is created on the first push and pinned to vault and project.'
          : 'No local state yet; it is created on the first push and pinned to endpoint, vault, and project.',
    });
  } else if (!identitiesMatch(identity, state)) {
    checks.push({
      name: 'state',
      status: 'fail',
      detail:
        'Local state pins a different endpoint, vault, or project; reinitialize explicitly instead of reusing it.',
    });
  } else {
    checks.push({
      name: 'state',
      status: 'pass',
      detail: `Local state present for branch ${state.activeBranch} with per-file baselines and no secret bodies.`,
    });
  }

  try {
    await stat(options.rootAbsolute);
    checks.push({
      name: 'permissions',
      status: 'pass',
      detail: 'Sync root is accessible; state uses 0700 dirs and 0600 files on POSIX.',
    });
  } catch (error) {
    checks.push({
      name: 'permissions',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  if (provider === 'onepassword-sdk') {
    checks.push({
      name: 'backend',
      status: 'pass',
      detail:
        auth.mode === 'desktop'
          ? `Direct SDK backend for vault ${vaultId}; desktop approval is granted interactively for the configured account.`
          : `Direct SDK backend for vault ${vaultId}; service-account token comes from the environment only.`,
    });
  } else {
    const host = endpointHost((identity as { endpoint: string }).endpoint);
    checks.push({
      name: 'endpoint',
      status: 'pass',
      detail: `Endpoint ${host} with vault ${vaultId}; token comes from the environment only.`,
    });
  }

  let recordCount = 0;
  try {
    const summaries = await options.store.listItems();
    recordCount = summaries.length;
    if (summaries.length > MAX_SCAN_RECORDS) {
      checks.push({
        name: 'read',
        status: 'fail',
        detail: `Remote lists ${summaries.length} record(s), above the ${MAX_SCAN_RECORDS} scan bound.`,
      });
    } else {
      checks.push({
        name: 'read',
        status: 'pass',
        detail: `Read probe listed ${summaries.length} remote record(s); write access was not probed.`,
      });
    }
  } catch (error) {
    checks.push({ name: 'read', status: 'fail', detail: error instanceof Error ? error.message : String(error) });
  }

  if (provider === 'onepassword-sdk') {
    checks.push({
      name: 'bounds',
      status: 'pass',
      detail: `Tool bounds are ${options.maxFileBytes}/${MAX_FILE_BYTES_HARD_CEILING} bytes per file and ${options.maxFiles}/${MAX_FILES_HARD_CEILING} files; SDK detail ${SDK_MAX_DETAIL_BYTES} bytes, record scan ${SDK_MAX_RECORDS}, timeout ${SDK_TIMEOUT_MS}ms with ${SDK_MAX_GET_RETRIES} read retries and no create retries.`,
    });
  } else {
    checks.push({
      name: 'bounds',
      status: 'pass',
      detail: `Tool bounds are ${options.maxFileBytes}/${MAX_FILE_BYTES_HARD_CEILING} bytes per file and ${options.maxFiles}/${MAX_FILES_HARD_CEILING} files; list ${CONNECT_MAX_LIST_BYTES}, detail ${CONNECT_MAX_DETAIL_BYTES}, timeout ${CONNECT_TIMEOUT_MS}ms with ${CONNECT_MAX_GET_RETRIES} GET retries.`,
    });
  }

  return {
    branch: options.branch,
    projectId,
    vaultId,
    provider,
    authMode: auth.mode,
    ...(provider === 'onepassword-connect'
      ? { endpointHost: endpointHost((identity as { endpoint: string }).endpoint) }
      : {}),
    ...(auth.account === undefined ? {} : { account: auth.account }),
    checks,
    recordCount,
    localMatchCount,
    bounds: {
      maxFileBytes: options.maxFileBytes,
      maxFiles: options.maxFiles,
      concurrency: options.concurrency,
      maxConcurrencyCeiling: MAX_CONCURRENCY_HARD_CEILING,
      maxScanRecords: MAX_SCAN_RECORDS,
    },
    writeProbed: false,
    note: 'Doctor reports observable connectivity and read capability only; write access was not tested and requires a write probe such as push, rollback, or branch creation.',
  };
}
