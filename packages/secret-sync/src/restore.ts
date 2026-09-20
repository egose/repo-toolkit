import { normalizeProjectRelPath, validateBranchName } from './config';
import { SecretSyncError } from './errors';
import {
  assertAncestorDirsSafe,
  assertNoCaseCollision,
  checkDestinationKind,
  readFileBounded,
  removeFileGuarded,
  resolveSafeDestination,
  writeFileAtomically,
} from './filesystem';
import { deriveBranchHeads } from './graph';
import { loadValidatedHistory, type LoadedHistory } from './history-store';
import { sha256Hex, type BlobEnvelope } from './records';
import { acquireStateLock, computeFileHmac, initState, saveState, setBaseline, setObservedHeads } from './state';
import type { SecretStore } from './store';
import { loadBranchHistory, resolveOperationConcurrency } from './operations';

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface RestoreHooks {
  beforeWrite?: (path: string) => void | Promise<void>;
  beforeStateSave?: () => void | Promise<void>;
}

export interface RestoreOptions {
  store: SecretStore;
  rootAbsolute: string;
  projectId: string;
  branch: string;
  path: string;
  revision?: string;
  fromBranch?: string;
  overwrite?: boolean;
  acknowledgeRemote?: boolean;
  dryRun?: boolean;
  maxFileBytes?: number;
  concurrency?: number;
  endpoint: string;
  vaultId: string;
  hooks?: RestoreHooks;
}

export interface RestoreResult {
  path: string;
  blobId?: string;
  removed: boolean;
  noop: boolean;
  overwritten: boolean;
  acknowledged: boolean;
  branch: string;
  sourceBranch?: string;
  sourceCommitId?: string;
  heads: string[];
  dryRun: boolean;
  note: string;
}

function assertProjectId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SecretSyncError('validation', 'Restore project id must be a non-empty string.');
  }
  return value;
}

function assertRevision(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new SecretSyncError('validation', 'Restore revision must be a blob id UUID string.');
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

function findPathAssociation(history: LoadedHistory, path: string, blobId: string): string | undefined {
  const matches: string[] = [];
  for (const commit of history.commits.values()) {
    for (const entry of commit.tree) {
      if (entry.path === path && entry.blobId === blobId) {
        matches.push(commit.logicalId);
      }
    }
  }
  matches.sort();
  return matches.length === 0 ? undefined : matches[0];
}

interface RestoreTarget {
  bytes?: Uint8Array;
  blobId?: string;
  sourceCommitId?: string;
  sourceBranch?: string;
}

async function resolveRevisionTarget(history: LoadedHistory, path: string, revision: string): Promise<RestoreTarget> {
  const blob = history.blobs.get(revision);
  if (blob === undefined) {
    throw new SecretSyncError(
      'validation',
      `Revision ${JSON.stringify(revision)} is not reachable for ${JSON.stringify(path)} in this project.`,
    );
  }
  const sourceCommitId = findPathAssociation(history, path, revision);
  if (sourceCommitId === undefined) {
    throw new SecretSyncError(
      'validation',
      `Revision ${JSON.stringify(revision)} was never associated with ${JSON.stringify(path)} in this project.`,
    );
  }
  return { bytes: decodeBlobBytes(blob), blobId: blob.logicalId, sourceCommitId };
}

async function resolveFromBranchTarget(
  store: SecretStore,
  projectId: string,
  history: LoadedHistory,
  path: string,
  fromBranch: string,
  concurrency?: number,
): Promise<RestoreTarget> {
  const resolved = validateBranchName(fromBranch);
  const heads = deriveBranchHeads(history.commits, resolved);
  if (heads.length > 1) {
    throw new SecretSyncError(
      'remote-diverged',
      `Branch ${JSON.stringify(resolved)} has multiple heads; resolve the fork before promoting a file.`,
    );
  }
  const head = heads[0];
  if (head === undefined) {
    return { sourceBranch: resolved };
  }
  const entry = head.tree.find((candidate) => candidate.path === path);
  if (entry === undefined) {
    return { sourceBranch: resolved, sourceCommitId: head.logicalId };
  }
  const blob = history.blobs.get(entry.blobId);
  if (blob === undefined) {
    throw new SecretSyncError('remote-incomplete', 'Branch head references a missing blob.');
  }
  void store;
  void projectId;
  void concurrency;
  return {
    bytes: decodeBlobBytes(blob),
    blobId: blob.logicalId,
    sourceCommitId: head.logicalId,
    sourceBranch: resolved,
  };
}

function bytesEqual(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (left === undefined && right === undefined) {
    return true;
  }
  if (left === undefined || right === undefined) {
    return false;
  }
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  return sha256Hex(left) === sha256Hex(right);
}

export async function restoreFile(options: RestoreOptions): Promise<RestoreResult> {
  const branch = validateBranchName(options.branch);
  const projectId = assertProjectId(options.projectId);
  const path = normalizeProjectRelPath(options.path, '--file');
  const overwrite = options.overwrite === true;
  const acknowledgeRemote = options.acknowledgeRemote === true;
  const dryRun = options.dryRun === true;
  const concurrency = resolveOperationConcurrency(options.concurrency);
  if (options.revision !== undefined && options.fromBranch !== undefined) {
    throw new SecretSyncError('validation', 'Restore accepts either --revision or --from-branch, not both.');
  }
  if (options.revision === undefined && options.fromBranch === undefined) {
    throw new SecretSyncError('validation', 'Restore requires --revision <blob-id> or --from-branch <name>.');
  }
  const revision = options.revision === undefined ? undefined : assertRevision(options.revision);

  const history = await loadValidatedHistory(options.store, projectId, { concurrency });
  const target: RestoreTarget =
    revision !== undefined
      ? await resolveRevisionTarget(history, path, revision)
      : await resolveFromBranchTarget(
          options.store,
          projectId,
          history,
          path,
          options.fromBranch as string,
          concurrency,
        );
  const loaded = await loadBranchHistory(options.store, projectId, branch, concurrency);

  if (dryRun) {
    const current = await readFileBounded(options.rootAbsolute, path, { maxFileBytes: options.maxFileBytes });
    const same = bytesEqual(current, target.bytes);
    if (acknowledgeRemote) {
      if (loaded.heads.length > 1) {
        throw new SecretSyncError('remote-diverged', `Branch ${JSON.stringify(branch)} has multiple heads.`);
      }
      const head = loaded.heads[0];
      const remoteEntry = head === undefined ? undefined : head.tree.find((entry) => entry.path === path);
      const remoteBlob = remoteEntry === undefined ? undefined : remoteEntry.blobId;
      if (remoteBlob !== target.blobId) {
        throw new SecretSyncError(
          'validation',
          'The acknowledge-remote flag requires restoring the current remote revision.',
        );
      }
    }
    return {
      path,
      ...(target.blobId === undefined ? {} : { blobId: target.blobId }),
      removed: target.bytes === undefined,
      noop: same,
      overwritten: !same && current !== undefined && target.bytes !== undefined,
      acknowledged: false,
      branch,
      ...(target.sourceBranch === undefined ? {} : { sourceBranch: target.sourceBranch }),
      ...(target.sourceCommitId === undefined ? {} : { sourceCommitId: target.sourceCommitId }),
      heads: loaded.headIds,
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
    const current = await readFileBounded(options.rootAbsolute, path, { maxFileBytes: options.maxFileBytes });
    if (current !== undefined && !bytesEqual(current, target.bytes)) {
      if (!overwrite) {
        throw new SecretSyncError(
          'local-changed',
          `Refusing restore over divergent local bytes at ${JSON.stringify(path)} without --overwrite.`,
        );
      }
    } else if (bytesEqual(current, target.bytes)) {
      if (!acknowledgeRemote) {
        return {
          path,
          ...(target.blobId === undefined ? {} : { blobId: target.blobId }),
          removed: target.bytes === undefined,
          noop: true,
          overwritten: false,
          acknowledged: false,
          branch,
          ...(target.sourceBranch === undefined ? {} : { sourceBranch: target.sourceBranch }),
          ...(target.sourceCommitId === undefined ? {} : { sourceCommitId: target.sourceCommitId }),
          heads: loaded.headIds,
          dryRun: false,
          note: `Restore of ${JSON.stringify(path)} is already at the requested revision; no write performed.`,
        };
      }
    }

    let acknowledged = false;
    if (acknowledgeRemote) {
      if (loaded.heads.length > 1) {
        throw new SecretSyncError('remote-diverged', `Branch ${JSON.stringify(branch)} has multiple heads.`);
      }
      const head = loaded.heads[0];
      const remoteEntry = head === undefined ? undefined : head.tree.find((entry) => entry.path === path);
      const remoteBlob = remoteEntry === undefined ? undefined : remoteEntry.blobId;
      if (remoteBlob !== target.blobId) {
        throw new SecretSyncError(
          'validation',
          'The acknowledge-remote flag requires restoring the current remote revision.',
        );
      }
      if (options.hooks?.beforeWrite !== undefined) {
        await options.hooks.beforeWrite(path);
      }
      if (target.bytes === undefined) {
        resolveSafeDestination(options.rootAbsolute, path);
        await assertAncestorDirsSafe(options.rootAbsolute, path);
        await removeFileGuarded(options.rootAbsolute, path);
      } else {
        const bytes = target.bytes;
        resolveSafeDestination(options.rootAbsolute, path);
        await assertAncestorDirsSafe(options.rootAbsolute, path);
        assertNoCaseCollision([path]);
        const kind = await checkDestinationKind(resolveSafeDestination(options.rootAbsolute, path));
        if (kind === 'symlink' || kind === 'special') {
          throw new SecretSyncError(
            'unsafe-path',
            `Refusing restore over a symlink or special file at ${JSON.stringify(path)}.`,
          );
        }
        if (kind === 'directory') {
          throw new SecretSyncError('unsafe-path', `Refusing restore over a directory at ${JSON.stringify(path)}.`);
        }
        await writeFileAtomically(options.rootAbsolute, path, bytes, { maxFileBytes: options.maxFileBytes });
        const verify = await readFileBounded(options.rootAbsolute, path, { maxFileBytes: options.maxFileBytes });
        if (!bytesEqual(verify, bytes)) {
          throw new SecretSyncError('local-changed', `Restore verification failed for ${JSON.stringify(path)}.`);
        }
        if (head !== undefined && remoteEntry !== undefined) {
          setBaseline(state, path, {
            state: 'present',
            hmac: computeFileHmac(bytes, state.localKey),
            byteLength: bytes.byteLength,
            blobId: remoteEntry.blobId,
            commitId: head.logicalId,
          });
        }
      }
      if (target.bytes === undefined) {
        setBaseline(state, path, { state: 'absent' });
      }
      const fresh = await loadBranchHistory(options.store, projectId, branch, concurrency);
      setObservedHeads(state, branch, fresh.headIds);
      if (options.hooks?.beforeStateSave !== undefined) {
        await saveState(options.rootAbsolute, state, { hooks: { beforeRename: options.hooks.beforeStateSave } });
      } else {
        await saveState(options.rootAbsolute, state);
      }
      acknowledged = true;
      return {
        path,
        ...(target.blobId === undefined ? {} : { blobId: target.blobId }),
        removed: target.bytes === undefined,
        noop: false,
        overwritten: overwrite && current !== undefined,
        acknowledged,
        branch,
        ...(target.sourceBranch === undefined ? {} : { sourceBranch: target.sourceBranch }),
        ...(target.sourceCommitId === undefined ? {} : { sourceCommitId: target.sourceCommitId }),
        heads: fresh.headIds,
        dryRun: false,
        note: `Restored ${JSON.stringify(path)} locally and acknowledged the current remote revision without changing the active branch.`,
      };
    }

    if (options.hooks?.beforeWrite !== undefined) {
      await options.hooks.beforeWrite(path);
    }
    if (target.bytes === undefined) {
      resolveSafeDestination(options.rootAbsolute, path);
      await assertAncestorDirsSafe(options.rootAbsolute, path);
      await removeFileGuarded(options.rootAbsolute, path);
    } else {
      const bytes = target.bytes;
      resolveSafeDestination(options.rootAbsolute, path);
      await assertAncestorDirsSafe(options.rootAbsolute, path);
      assertNoCaseCollision([path]);
      const kind = await checkDestinationKind(resolveSafeDestination(options.rootAbsolute, path));
      if (kind === 'symlink' || kind === 'special') {
        throw new SecretSyncError(
          'unsafe-path',
          `Refusing restore over a symlink or special file at ${JSON.stringify(path)}.`,
        );
      }
      if (kind === 'directory') {
        throw new SecretSyncError('unsafe-path', `Refusing restore over a directory at ${JSON.stringify(path)}.`);
      }
      await writeFileAtomically(options.rootAbsolute, path, bytes, { maxFileBytes: options.maxFileBytes });
      const verify = await readFileBounded(options.rootAbsolute, path, { maxFileBytes: options.maxFileBytes });
      if (!bytesEqual(verify, bytes)) {
        throw new SecretSyncError('local-changed', `Restore verification failed for ${JSON.stringify(path)}.`);
      }
    }
    return {
      path,
      ...(target.blobId === undefined ? {} : { blobId: target.blobId }),
      removed: target.bytes === undefined,
      noop: false,
      overwritten: overwrite && current !== undefined,
      acknowledged: false,
      branch,
      ...(target.sourceBranch === undefined ? {} : { sourceBranch: target.sourceBranch }),
      ...(target.sourceCommitId === undefined ? {} : { sourceCommitId: target.sourceCommitId }),
      heads: loaded.headIds,
      dryRun: false,
      note: `Restored ${JSON.stringify(path)} locally only; baselines and the active branch are unchanged.`,
    };
  } finally {
    await lock.release();
  }
}
