import { randomUUID } from 'node:crypto';

import { validateBranchName } from './config';
import { SecretSyncError } from './errors';
import { deriveBranchHeads } from './graph';
import { loadValidatedHistory, publishCommit } from './history-store';
import type { SecretStore } from './store';
import {
  createOperationId,
  headsEqual,
  observeHeadsAfter,
  recheckHeads,
  resolveOperationConcurrency,
  resolveTimestamp,
  sortedHeadIds,
  writeOperationRecord,
} from './operations';

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface ResolveOptions {
  store: SecretStore;
  rootAbsolute: string;
  projectId: string;
  branch: string;
  heads: string[];
  take: string;
  message?: string;
  concurrency?: number;
  timestamp?: number;
  operationId?: string;
  commitId?: string;
  dryRun?: boolean;
}

export interface ResolveResult {
  noop: boolean;
  published: boolean;
  commitId?: string;
  parents: string[];
  headsBefore: string[];
  headsAfter: string[];
  divergedAfter: boolean;
  commitVisible: boolean;
  reconciled: boolean;
  take: string;
  dryRun: boolean;
  note: string;
}

function assertProjectId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SecretSyncError('validation', 'Resolve project id must be a non-empty string.');
  }
  return value;
}

function assertCommitIds(values: unknown): string[] {
  if (!Array.isArray(values) || values.length < 2) {
    throw new SecretSyncError('validation', 'Resolve requires at least two --head <commit-id> values.');
  }
  const resolved: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw new SecretSyncError('validation', 'Resolve head ids must be commit UUID strings.');
    }
    resolved.push(value);
  }
  return [...new Set(resolved)].sort();
}

export async function resolveFork(options: ResolveOptions): Promise<ResolveResult> {
  const branch = validateBranchName(options.branch);
  const projectId = assertProjectId(options.projectId);
  const providedHeads = assertCommitIds(options.heads);
  if (typeof options.take !== 'string' || !UUID_PATTERN.test(options.take)) {
    throw new SecretSyncError('validation', 'Resolve --take must be a commit UUID string.');
  }
  const take = options.take;
  if (!providedHeads.includes(take)) {
    throw new SecretSyncError('validation', 'Resolve --take must be one of the --head commit IDs.');
  }
  const concurrency = resolveOperationConcurrency(options.concurrency);
  const timestamp = resolveTimestamp(options.timestamp);
  const dryRun = options.dryRun === true;

  const history = await loadValidatedHistory(options.store, projectId, { concurrency });
  const observed = deriveBranchHeads(history.commits, branch);
  const observedIds = sortedHeadIds(observed);
  if (!headsEqual(providedHeads, observedIds)) {
    throw new SecretSyncError(
      'remote-diverged',
      `Branch ${JSON.stringify(branch)} heads changed; refusing to join a stale head set.`,
    );
  }
  const chosen = history.commits.get(take);
  if (chosen === undefined || chosen.branch !== branch) {
    throw new SecretSyncError('validation', 'Resolve --take is not an observed head of the target branch.');
  }
  if (observedIds.length < 2) {
    return {
      noop: true,
      published: false,
      parents: observedIds,
      headsBefore: observedIds,
      headsAfter: observedIds,
      divergedAfter: false,
      commitVisible: true,
      reconciled: false,
      take,
      dryRun,
      note: `Branch ${JSON.stringify(branch)} has a single head; no fork join is needed.`,
    };
  }
  const tree = chosen.tree.map((entry) => ({ ...entry }));

  if (dryRun) {
    return {
      noop: false,
      published: false,
      parents: observedIds,
      headsBefore: observedIds,
      headsAfter: observedIds,
      divergedAfter: true,
      commitVisible: false,
      reconciled: false,
      take,
      dryRun: true,
      note: 'Dry run: reads permitted; no remote or local writes were performed.',
    };
  }

  const operationId = createOperationId(options.operationId);
  const commitId = options.commitId === undefined ? randomUUID() : options.commitId;
  if (!UUID_PATTERN.test(commitId)) {
    throw new SecretSyncError('validation', 'Resolve commit id must be a UUID string.');
  }
  await writeOperationRecord(options.rootAbsolute, {
    schemaVersion: 1,
    operationId,
    kind: 'resolve',
    branch,
    commitId,
    blobIds: {},
    timestamp,
    ...(options.message === undefined ? {} : { message: options.message }),
  });
  await recheckHeads(options.store, projectId, branch, observedIds, concurrency);
  const published = await publishCommit(
    options.store,
    projectId,
    {
      branch,
      parents: observedIds,
      tree,
      timestamp,
      ...(options.message === undefined ? {} : { message: options.message }),
      operationId,
      operationKind: 'resolve',
    },
    { logicalId: commitId },
  );
  const after = await observeHeadsAfter(options.store, projectId, branch, concurrency);
  const commitVisible = after.history.commits.has(commitId);
  return {
    noop: false,
    published: true,
    commitId,
    parents: observedIds,
    headsBefore: observedIds,
    headsAfter: after.headIds,
    divergedAfter: after.diverged || !after.headIds.includes(commitId),
    commitVisible,
    reconciled: published.reconciled,
    take,
    dryRun: false,
    note:
      `Fork join commit ${commitId} takes the full snapshot of ${take} with every observed head as parent ` +
      `on the configured endpoint and vault; no history was erased and the unchosen heads remain reachable.`,
  };
}
