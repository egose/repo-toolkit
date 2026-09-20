import { MAX_SCAN_RECORDS, normalizeProjectRelPath, validateBranchName } from './config';
import { SecretSyncError } from './errors';
import { collectReachableCommits, deriveBranchHeads } from './graph';
import { loadValidatedHistory } from './history-store';
import type { SecretStore } from './store';

export const LOG_DEFAULT_LIMIT = 20;
export const LOG_MAX_LIMIT = 1000;

export interface LogOptions {
  store: SecretStore;
  projectId: string;
  branch: string;
  path: string;
  limit?: number;
  concurrency?: number;
  maxRecords?: number;
}

export interface LogEntry {
  commitId: string;
  parents: string[];
  blobId?: string;
  sha256?: string;
  byteLength?: number;
  deleted: boolean;
  message?: string;
  timestamp: number;
  operationId: string;
  operationKind: string;
  branch: string;
  isHead: boolean;
}

export interface LogResult {
  branch: string;
  path: string;
  heads: string[];
  diverged: boolean;
  entries: LogEntry[];
  total: number;
  limit: number;
  truncated: boolean;
}

function assertProjectId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SecretSyncError('validation', 'Log project id must be a non-empty string.');
  }
  return value;
}

function resolveLimit(value: number | undefined): number {
  if (value === undefined) {
    return LOG_DEFAULT_LIMIT;
  }
  if (!Number.isSafeInteger(value) || value < 1 || value > LOG_MAX_LIMIT) {
    throw new SecretSyncError('validation', 'Log limit must be a positive safe integer within the bounded range.');
  }
  return value;
}

function resolveMaxRecords(value: number | undefined): number {
  if (value === undefined) {
    return MAX_SCAN_RECORDS;
  }
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_SCAN_RECORDS) {
    throw new SecretSyncError('validation', 'Log traversal bound is out of range.');
  }
  return value;
}

export async function logFileHistory(options: LogOptions): Promise<LogResult> {
  const branch = validateBranchName(options.branch);
  const projectId = assertProjectId(options.projectId);
  const path = normalizeProjectRelPath(options.path, '--file');
  const limit = resolveLimit(options.limit);
  const maxRecords = resolveMaxRecords(options.maxRecords);
  const history = await loadValidatedHistory(options.store, projectId, {
    concurrency: options.concurrency,
    maxRecords,
  });
  const heads = deriveBranchHeads(history.commits, branch);
  const headIds = heads.map((head) => head.logicalId).sort();
  if (headIds.length === 0) {
    return { branch, path, heads: [], diverged: false, entries: [], total: 0, limit, truncated: false };
  }
  const reachable = collectReachableCommits(headIds, history.commits, maxRecords);
  const byId = new Map(reachable.map((commit) => [commit.logicalId, commit]));
  const headSet = new Set(headIds);
  const events: LogEntry[] = [];
  for (const commit of reachable) {
    const current = commit.tree.find((entry) => entry.path === path);
    const currentId = current === undefined ? undefined : current.blobId;
    if (commit.parents.length === 0) {
      if (current === undefined) {
        continue;
      }
      const entry: LogEntry = {
        commitId: commit.logicalId,
        parents: [],
        blobId: current.blobId,
        sha256: current.sha256,
        byteLength: current.byteLength,
        deleted: false,
        timestamp: commit.timestamp,
        operationId: commit.operationId,
        operationKind: commit.operationKind,
        branch: commit.branch,
        isHead: headSet.has(commit.logicalId),
      };
      if (commit.message !== undefined) {
        entry.message = commit.message;
      }
      events.push(entry);
      continue;
    }
    let differs = false;
    let missingParent = false;
    for (const parentId of commit.parents) {
      const parent = byId.get(parentId);
      if (parent === undefined) {
        missingParent = true;
        continue;
      }
      const parentEntry = parent.tree.find((entry) => entry.path === path);
      const parentIdValue = parentEntry === undefined ? undefined : parentEntry.blobId;
      if (parentIdValue !== currentId) {
        differs = true;
      }
    }
    if (missingParent) {
      throw new SecretSyncError('remote-incomplete', 'Log traversal reached a missing parent commit.');
    }
    if (!differs) {
      continue;
    }
    const entry: LogEntry = {
      commitId: commit.logicalId,
      parents: [...commit.parents].sort(),
      timestamp: commit.timestamp,
      operationId: commit.operationId,
      operationKind: commit.operationKind,
      branch: commit.branch,
      deleted: current === undefined,
      isHead: headSet.has(commit.logicalId),
    };
    if (current !== undefined) {
      entry.blobId = current.blobId;
      entry.sha256 = current.sha256;
      entry.byteLength = current.byteLength;
    }
    if (commit.message !== undefined) {
      entry.message = commit.message;
    }
    events.push(entry);
  }
  events.sort((left, right) => {
    if (left.timestamp !== right.timestamp) {
      return right.timestamp - left.timestamp;
    }
    return left.commitId < right.commitId ? -1 : left.commitId > right.commitId ? 1 : 0;
  });
  const total = events.length;
  const sliced = events.slice(0, limit);
  return {
    branch,
    path,
    heads: headIds,
    diverged: headIds.length > 1,
    entries: sliced,
    total,
    limit,
    truncated: total > sliced.length,
  };
}
