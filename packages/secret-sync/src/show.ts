import { systemClipboardWriter, type ClipboardWriter } from './clipboard';
import { normalizeProjectRelPath, validateBranchName } from './config';
import { SecretSyncError } from './errors';
import { loadValidatedHistory, type LoadedHistory } from './history-store';
import { sha256Hex, type BlobEnvelope } from './records';
import { normalizeOperationIdentity } from './state';
import type { SecretStore } from './store';
import { loadBranchHistory, resolveOperationConcurrency } from './operations';

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface ShowOptions {
  store: SecretStore;
  projectId?: string;
  branch: string;
  path: string;
  revision?: string;
  dryRun?: boolean;
  copy?: boolean;
  clipboard?: ClipboardWriter;
  concurrency?: number;
  endpoint?: string;
  vaultId?: string;
  remote?: unknown;
  identity?: unknown;
}

export interface ShowResult {
  path: string;
  branch: string;
  blobId: string;
  sourceCommitId: string;
  byteLength: number;
  dryRun: boolean;
  copied: boolean;
  clipboardCommand?: string;
  note: string;
}

function assertRevision(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new SecretSyncError('validation', 'Show revision must be a blob id UUID string.');
  }
  return value;
}

function decodeBlobBytes(blob: BlobEnvelope): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(blob.contentBase64, 'base64'));
  if (bytes.byteLength !== blob.byteLength || sha256Hex(bytes) !== blob.sha256) {
    throw new SecretSyncError('remote-corrupt', 'Shown blob bytes do not match the recorded digest.');
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

export async function showFile(options: ShowOptions): Promise<{ result: ShowResult; bytes: Uint8Array }> {
  const branch = validateBranchName(options.branch);
  const identity = normalizeOperationIdentity({
    endpoint: options.endpoint,
    vaultId: options.vaultId,
    projectId: options.projectId,
    remote: options.remote,
    identity: options.identity,
  });
  const projectId = identity.projectId;
  const path = normalizeProjectRelPath(options.path, '--file');
  const dryRun = options.dryRun === true;
  const concurrency = resolveOperationConcurrency(options.concurrency);
  const history = await loadValidatedHistory(options.store, projectId, { concurrency });
  let blob: BlobEnvelope;
  let sourceCommitId: string;
  if (options.revision !== undefined) {
    const revision = assertRevision(options.revision);
    const candidate = history.blobs.get(revision);
    if (candidate === undefined) {
      throw new SecretSyncError(
        'validation',
        `Revision ${JSON.stringify(revision)} is not reachable for ${JSON.stringify(path)} in this project.`,
      );
    }
    const associated = findPathAssociation(history, path, revision);
    if (associated === undefined) {
      throw new SecretSyncError(
        'validation',
        `Revision ${JSON.stringify(revision)} was never associated with ${JSON.stringify(path)} in this project.`,
      );
    }
    blob = candidate;
    sourceCommitId = associated;
  } else {
    const loaded = await loadBranchHistory(options.store, projectId, branch, concurrency);
    if (loaded.heads.length > 1) {
      throw new SecretSyncError(
        'remote-diverged',
        `Branch ${JSON.stringify(branch)} has multiple heads; resolve the fork or select --revision before showing a file.`,
      );
    }
    const head = loaded.heads[0];
    if (head === undefined) {
      throw new SecretSyncError('validation', `Branch ${JSON.stringify(branch)} has no history to show.`);
    }
    const entry = head.tree.find((candidate) => candidate.path === path);
    if (entry === undefined) {
      throw new SecretSyncError(
        'validation',
        `Path ${JSON.stringify(path)} is not tracked on branch ${JSON.stringify(branch)}.`,
      );
    }
    const candidate = history.blobs.get(entry.blobId);
    if (candidate === undefined) {
      throw new SecretSyncError('remote-incomplete', 'Branch head references a missing blob.');
    }
    blob = candidate;
    sourceCommitId = head.logicalId;
  }
  const bytes = decodeBlobBytes(blob);
  if (options.copy === true) {
    const writer = options.clipboard ?? systemClipboardWriter();
    const written = await writer.write(bytes);
    return {
      result: {
        path,
        branch,
        blobId: blob.logicalId,
        sourceCommitId,
        byteLength: bytes.byteLength,
        dryRun,
        copied: true,
        clipboardCommand: written.command,
        note: `Copied ${JSON.stringify(path)} (${bytes.byteLength} bytes) to the system clipboard via ${JSON.stringify(written.command)}; worktree, state, and baselines are unchanged.`,
      },
      bytes,
    };
  }
  return {
    result: {
      path,
      branch,
      blobId: blob.logicalId,
      sourceCommitId,
      byteLength: bytes.byteLength,
      dryRun,
      copied: false,
      note: `Showing ${JSON.stringify(path)} from ${JSON.stringify(sourceCommitId)} on branch ${JSON.stringify(branch)}; worktree, state, and baselines are unchanged.`,
    },
    bytes,
  };
}
