import { randomUUID } from 'node:crypto';

import { normalizeProjectRelPath, validateBranchName } from './config';
import { SecretSyncError } from './errors';
import {
  assertAncestorDirsSafe,
  assertNoCaseCollision,
  checkDestinationKind,
  readFileBounded,
  resolveSafeDestination,
  writeFileAtomically,
} from './filesystem';
import { loadValidatedHistory, publishCommit, type LoadedHistory } from './history-store';
import { sha256Hex, type BlobEnvelope } from './records';
import { acquireStateLock, computeFileHmac, initState, saveState, setBaseline, setObservedHeads } from './state';
import { compareFile } from './status';
import type { SecretStore } from './store';
import {
  baselinesToSlots,
  createOperationId,
  loadBranchHistory,
  recheckHeads,
  requireSingleOperationHead,
  resolveOperationConcurrency,
  resolveTimestamp,
  writeOperationRecord,
} from './operations';

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface RollbackHooks {
  beforePublish?: () => void | Promise<void>;
  afterPublish?: (commitId: string) => void | Promise<void>;
  beforeFile?: (path: string) => void | Promise<void>;
  beforeStateSave?: () => void | Promise<void>;
}

export interface RollbackOptions {
  store: SecretStore;
  rootAbsolute: string;
  projectId: string;
  branch: string;
  path: string;
  revision: string;
  message?: string;
  concurrency?: number;
  timestamp?: number;
  operationId?: string;
  commitId?: string;
  dryRun?: boolean;
  maxFileBytes?: number;
  endpoint: string;
  vaultId: string;
  hooks?: RollbackHooks;
}

export interface RollbackResult {
  noop: boolean;
  published: boolean;
  commitId?: string;
  parents: string[];
  headsBefore: string[];
  headsAfter: string[];
  divergedAfter: boolean;
  commitVisible: boolean;
  reconciled: boolean;
  path: string;
  blobId: string;
  acknowledged: string[];
  localRecoveryOk: boolean;
  localRecoveryError?: string;
  dryRun: boolean;
  note: string;
}

function assertProjectId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SecretSyncError('validation', 'Rollback project id must be a non-empty string.');
  }
  return value;
}

function assertRevision(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new SecretSyncError('validation', 'Rollback revision must be a blob id UUID string.');
  }
  return value;
}

function assertCommitId(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new SecretSyncError('validation', 'Rollback commit id must be a UUID string.');
  }
  return value;
}

function decodeBlobBytes(blob: BlobEnvelope): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(blob.contentBase64, 'base64'));
  if (bytes.byteLength !== blob.byteLength || sha256Hex(bytes) !== blob.sha256) {
    throw new SecretSyncError('remote-corrupt', 'Historical blob bytes do not match the recorded digest.');
  }
  return bytes;
}

function requireReachableBlob(history: LoadedHistory, path: string, revision: string): BlobEnvelope {
  const blob = history.blobs.get(revision);
  if (blob === undefined) {
    throw new SecretSyncError(
      'validation',
      `Revision ${JSON.stringify(revision)} is not reachable for ${JSON.stringify(path)} in this project.`,
    );
  }
  let associated = false;
  for (const commit of history.commits.values()) {
    for (const entry of commit.tree) {
      if (entry.path === path && entry.blobId === revision) {
        associated = true;
      }
    }
  }
  if (!associated) {
    throw new SecretSyncError(
      'validation',
      `Revision ${JSON.stringify(revision)} was never associated with ${JSON.stringify(path)} in this project.`,
    );
  }
  return blob;
}

export async function rollbackFile(options: RollbackOptions): Promise<RollbackResult> {
  const branch = validateBranchName(options.branch);
  const projectId = assertProjectId(options.projectId);
  const path = normalizeProjectRelPath(options.path, '--file');
  const revision = assertRevision(options.revision);
  const concurrency = resolveOperationConcurrency(options.concurrency);
  const timestamp = resolveTimestamp(options.timestamp);
  const dryRun = options.dryRun === true;

  if (dryRun) {
    const history = await loadValidatedHistory(options.store, projectId, { concurrency });
    const loaded = await loadBranchHistory(options.store, projectId, branch, concurrency);
    const head = requireSingleOperationHead(loaded.heads, branch);
    if (head === undefined) {
      throw new SecretSyncError('remote-empty', `Branch ${JSON.stringify(branch)} has no commits to roll back.`);
    }
    const blob = requireReachableBlob(history, path, revision);
    const current = head.tree.find((entry) => entry.path === path);
    if (current !== undefined && current.blobId === revision) {
      return {
        noop: true,
        published: false,
        parents: [head.logicalId],
        headsBefore: loaded.headIds,
        headsAfter: loaded.headIds,
        divergedAfter: false,
        commitVisible: true,
        reconciled: false,
        path,
        blobId: revision,
        acknowledged: [],
        localRecoveryOk: true,
        dryRun: true,
        note: 'Dry run: reads permitted; no remote or local writes were performed.',
      };
    }
    void blob;
    return {
      noop: false,
      published: false,
      parents: [head.logicalId],
      headsBefore: loaded.headIds,
      headsAfter: loaded.headIds,
      divergedAfter: false,
      commitVisible: false,
      reconciled: false,
      path,
      blobId: revision,
      acknowledged: [],
      localRecoveryOk: true,
      dryRun: true,
      note: 'Dry run: reads permitted; no remote or local writes were performed.',
    };
  }

  const lock = await acquireStateLock(options.rootAbsolute);
  try {
    const state = await initState(
      options.rootAbsolute,
      { endpoint: options.endpoint, vaultId: options.vaultId, projectId },
      { branch },
    );
    const history = await loadValidatedHistory(options.store, projectId, { concurrency });
    const loaded = await loadBranchHistory(options.store, projectId, branch, concurrency);
    const head = requireSingleOperationHead(loaded.heads, branch);
    if (head === undefined) {
      throw new SecretSyncError('remote-empty', `Branch ${JSON.stringify(branch)} has no commits to roll back.`);
    }
    const headsBefore = loaded.headIds;
    const blob = requireReachableBlob(history, path, revision);
    const targetBytes = decodeBlobBytes(blob);
    const currentEntry = head.tree.find((entry) => entry.path === path);

    if (currentEntry !== undefined && currentEntry.blobId === revision) {
      let localCheck: Uint8Array | undefined;
      try {
        localCheck = await readFileBounded(options.rootAbsolute, path, { maxFileBytes: options.maxFileBytes });
      } catch {
        localCheck = undefined;
      }
      const baselinesConverge = baselinesToSlots(state.baselines, history.blobs);
      const baselineConverge = baselinesConverge.get(path);
      const baselineAtTarget =
        baselineConverge !== undefined &&
        baselineConverge.state === 'present' &&
        baselineConverge.fingerprint.blobId === revision;
      const localAtTarget =
        localCheck !== undefined && sha256Hex(localCheck) === blob.sha256 && localCheck.byteLength === blob.byteLength;
      if (localAtTarget && baselineAtTarget) {
        setObservedHeads(state, branch, headsBefore);
        await saveState(options.rootAbsolute, state);
        return {
          noop: true,
          published: false,
          commitId: head.logicalId,
          parents: [head.logicalId],
          headsBefore,
          headsAfter: headsBefore,
          divergedAfter: false,
          commitVisible: true,
          reconciled: false,
          path,
          blobId: revision,
          acknowledged: [path],
          localRecoveryOk: true,
          dryRun: false,
          note: `Rollback of ${JSON.stringify(path)} is already at the requested revision; no commit created.`,
        };
      }
      if (baselineAtTarget) {
        throw new SecretSyncError(
          'local-changed',
          `Rollback requires ${JSON.stringify(path)} to be clean at the current head; the worktree has uncommitted edits.`,
        );
      }
      if (options.hooks?.beforeFile !== undefined) {
        await options.hooks.beforeFile(path);
      }
      resolveSafeDestination(options.rootAbsolute, path);
      await assertAncestorDirsSafe(options.rootAbsolute, path);
      assertNoCaseCollision([path]);
      const convergeAbsolute = resolveSafeDestination(options.rootAbsolute, path);
      const convergeKind = await checkDestinationKind(convergeAbsolute);
      if (convergeKind === 'symlink' || convergeKind === 'special') {
        throw new SecretSyncError(
          'unsafe-path',
          `Refusing rollback over a symlink or special file at ${JSON.stringify(path)}.`,
        );
      }
      if (convergeKind === 'directory') {
        throw new SecretSyncError('unsafe-path', `Refusing rollback over a directory at ${JSON.stringify(path)}.`);
      }
      await writeFileAtomically(options.rootAbsolute, path, targetBytes, { maxFileBytes: options.maxFileBytes });
      const convergeVerify = await readFileBounded(options.rootAbsolute, path, { maxFileBytes: options.maxFileBytes });
      if (convergeVerify === undefined || sha256Hex(convergeVerify) !== blob.sha256) {
        throw new SecretSyncError('local-changed', `Rollback verification failed for ${JSON.stringify(path)}.`);
      }
      setBaseline(state, path, {
        state: 'present',
        hmac: computeFileHmac(targetBytes, state.localKey),
        byteLength: targetBytes.byteLength,
        blobId: blob.logicalId,
        commitId: head.logicalId,
      });
      setObservedHeads(state, branch, headsBefore);
      try {
        if (options.hooks?.beforeStateSave !== undefined) {
          await saveState(options.rootAbsolute, state, { hooks: { beforeRename: options.hooks.beforeStateSave } });
        } else {
          await saveState(options.rootAbsolute, state);
        }
      } catch (error) {
        return {
          noop: false,
          published: false,
          commitId: head.logicalId,
          parents: [head.logicalId],
          headsBefore,
          headsAfter: headsBefore,
          divergedAfter: false,
          commitVisible: true,
          reconciled: false,
          path,
          blobId: revision,
          acknowledged: [path],
          localRecoveryOk: false,
          localRecoveryError: error instanceof Error ? error.message : String(error),
          dryRun: false,
          note:
            `Rollback commit ${head.logicalId} is already published on the configured endpoint and vault but local state failed to save. ` +
            `Rerun rollback with the same revision to resume without publishing a second commit.`,
        };
      }
      return {
        noop: false,
        published: false,
        commitId: head.logicalId,
        parents: [head.logicalId],
        headsBefore,
        headsAfter: headsBefore,
        divergedAfter: false,
        commitVisible: true,
        reconciled: false,
        path,
        blobId: revision,
        acknowledged: [path],
        localRecoveryOk: true,
        dryRun: false,
        note:
          `Rollback commit ${head.logicalId} was already published on the configured endpoint and vault; ` +
          `local recovery completed without a second commit.`,
      };
    }

    const baselines = baselinesToSlots(state.baselines, history.blobs);
    const baseline = baselines.get(path) ?? { state: 'unknown' as const };
    let localBytes: Uint8Array | undefined;
    try {
      localBytes = await readFileBounded(options.rootAbsolute, path, { maxFileBytes: options.maxFileBytes });
    } catch (error) {
      if (error instanceof SecretSyncError) {
        throw new SecretSyncError(
          error.code,
          `Rollback refuses an unreadable worktree file at ${JSON.stringify(path)}: ${error.message}`,
        );
      }
      throw error;
    }
    const local =
      localBytes === undefined
        ? { state: 'absent' as const }
        : {
            state: 'present' as const,
            fingerprint: { sha256: sha256Hex(localBytes), byteLength: localBytes.byteLength },
          };
    const remoteEntry = head.tree.find((entry) => entry.path === path);
    const remote =
      remoteEntry === undefined
        ? { state: 'absent' as const }
        : {
            state: 'present' as const,
            fingerprint: { sha256: remoteEntry.sha256, byteLength: remoteEntry.byteLength, blobId: remoteEntry.blobId },
          };
    const status = compareFile(baseline, local, remote);
    if (status !== 'clean') {
      throw new SecretSyncError(
        'local-changed',
        `Rollback requires ${JSON.stringify(path)} to be clean at the current head; observed ${status}.`,
      );
    }

    const operationId = createOperationId(options.operationId);
    const commitId = options.commitId === undefined ? randomUUID() : assertCommitId(options.commitId);
    const tree = head.tree.map((entry) => ({ ...entry }));
    const replacement = { path, blobId: blob.logicalId, sha256: blob.sha256, byteLength: blob.byteLength };
    const index = tree.findIndex((entry) => entry.path === path);
    if (index === -1) {
      tree.push(replacement);
    } else {
      tree[index] = replacement;
    }
    tree.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

    await writeOperationRecord(options.rootAbsolute, {
      schemaVersion: 1,
      operationId,
      kind: 'rollback',
      branch,
      commitId,
      blobIds: { [path]: blob.logicalId },
      timestamp,
      ...(options.message === undefined ? {} : { message: options.message }),
    });

    await recheckHeads(options.store, projectId, branch, headsBefore, concurrency);
    if (options.hooks?.beforePublish !== undefined) {
      await options.hooks.beforePublish();
    }
    const published = await publishCommit(
      options.store,
      projectId,
      {
        branch,
        parents: [head.logicalId],
        tree,
        timestamp,
        ...(options.message === undefined ? {} : { message: options.message }),
        operationId,
        operationKind: 'rollback',
      },
      { logicalId: commitId },
    );

    const after = await loadBranchHistory(options.store, projectId, branch, concurrency);
    const commitVisible = after.history.commits.has(commitId);
    const headsAfter = after.headIds;
    const divergedAfter = headsAfter.length > 1 || !headsAfter.includes(commitId);

    if (options.hooks?.afterPublish !== undefined) {
      await options.hooks.afterPublish(commitId);
    }

    const materialize = async (): Promise<void> => {
      if (options.hooks?.beforeFile !== undefined) {
        await options.hooks.beforeFile(path);
      }
      resolveSafeDestination(options.rootAbsolute, path);
      await assertAncestorDirsSafe(options.rootAbsolute, path);
      assertNoCaseCollision([path]);
      const absolute = resolveSafeDestination(options.rootAbsolute, path);
      const kind = await checkDestinationKind(absolute);
      if (kind === 'symlink' || kind === 'special') {
        throw new SecretSyncError(
          'unsafe-path',
          `Refusing rollback over a symlink or special file at ${JSON.stringify(path)}.`,
        );
      }
      if (kind === 'directory') {
        throw new SecretSyncError('unsafe-path', `Refusing rollback over a directory at ${JSON.stringify(path)}.`);
      }
      await writeFileAtomically(options.rootAbsolute, path, targetBytes, { maxFileBytes: options.maxFileBytes });
      const verify = await readFileBounded(options.rootAbsolute, path, { maxFileBytes: options.maxFileBytes });
      if (verify === undefined || sha256Hex(verify) !== blob.sha256 || verify.byteLength !== blob.byteLength) {
        throw new SecretSyncError('local-changed', `Rollback verification failed for ${JSON.stringify(path)}.`);
      }
    };

    try {
      await materialize();
    } catch (error) {
      return {
        noop: false,
        published: true,
        commitId,
        parents: [head.logicalId],
        headsBefore,
        headsAfter,
        divergedAfter,
        commitVisible,
        reconciled: published.reconciled,
        path,
        blobId: revision,
        acknowledged: [],
        localRecoveryOk: false,
        localRecoveryError: error instanceof Error ? error.message : String(error),
        dryRun: false,
        note:
          `Rollback commit ${commitId} was published on the configured endpoint and vault but local materialization failed. ` +
          `Rerun rollback with the same operation and commit ids to resume without publishing a second commit.`,
      };
    }

    setBaseline(state, path, {
      state: 'present',
      hmac: computeFileHmac(targetBytes, state.localKey),
      byteLength: targetBytes.byteLength,
      blobId: blob.logicalId,
      commitId,
    });
    setObservedHeads(state, branch, headsAfter);
    try {
      if (options.hooks?.beforeStateSave !== undefined) {
        await saveState(options.rootAbsolute, state, { hooks: { beforeRename: options.hooks.beforeStateSave } });
      } else {
        await saveState(options.rootAbsolute, state);
      }
    } catch (error) {
      return {
        noop: false,
        published: true,
        commitId,
        parents: [head.logicalId],
        headsBefore,
        headsAfter,
        divergedAfter,
        commitVisible,
        reconciled: published.reconciled,
        path,
        blobId: revision,
        acknowledged: [path],
        localRecoveryOk: false,
        localRecoveryError: error instanceof Error ? error.message : String(error),
        dryRun: false,
        note:
          `Rollback commit ${commitId} was published on the configured endpoint and vault but local state failed to save. ` +
          `Rerun rollback with the same operation and commit ids to resume without publishing a second commit.`,
      };
    }

    return {
      noop: false,
      published: true,
      commitId,
      parents: [head.logicalId],
      headsBefore,
      headsAfter,
      divergedAfter,
      commitVisible,
      reconciled: published.reconciled,
      path,
      blobId: revision,
      acknowledged: [path],
      localRecoveryOk: true,
      dryRun: false,
      note: `Rollback commit ${commitId} replaced only ${JSON.stringify(path)} and preserved every other tree entry on the configured endpoint and vault.`,
    };
  } finally {
    await lock.release();
  }
}
