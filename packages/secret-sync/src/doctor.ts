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
import { readStateIfPresent } from './state';
import type { SecretStore } from './store';

export interface DoctorOptions {
  store: SecretStore;
  rootAbsolute: string;
  projectId: string;
  branch: string;
  endpoint: string;
  vaultId: string;
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
  endpointHost: string;
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

export async function doctorSecrets(options: DoctorOptions): Promise<DoctorResult> {
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
      detail: 'No local state yet; it is created on the first push and pinned to endpoint, vault, and project.',
    });
  } else if (
    state.remote.endpoint !== options.endpoint ||
    state.remote.vaultId !== options.vaultId ||
    state.projectId !== options.projectId
  ) {
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

  checks.push({
    name: 'endpoint',
    status: 'pass',
    detail: `Endpoint ${endpointHost(options.endpoint)} with vault ${options.vaultId}; token comes from the environment only.`,
  });

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

  checks.push({
    name: 'bounds',
    status: 'pass',
    detail: `Tool bounds are ${options.maxFileBytes}/${MAX_FILE_BYTES_HARD_CEILING} bytes per file and ${options.maxFiles}/${MAX_FILES_HARD_CEILING} files; list ${CONNECT_MAX_LIST_BYTES}, detail ${CONNECT_MAX_DETAIL_BYTES}, timeout ${CONNECT_TIMEOUT_MS}ms with ${CONNECT_MAX_GET_RETRIES} GET retries.`,
  });

  return {
    branch: options.branch,
    projectId: options.projectId,
    vaultId: options.vaultId,
    endpointHost: endpointHost(options.endpoint),
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
