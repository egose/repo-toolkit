import { SecretSyncError } from './errors';
import type { JournalEntry } from './journal';
import { computeFileHmac, matchesLocalPreimage, type SecretSyncState } from './state';

export function verifySwitchRecovery(input: {
  state: SecretSyncState | undefined;
  targetBranch: string;
  sourceCommitId: string | null;
  targetCommitId: string | null;
  operationId?: string;
  ordered: string[];
  targetBytes: Map<string, Uint8Array>;
  targetTree: Map<string, { blobId: string }>;
  localBytes: Map<string, Uint8Array>;
  journal: JournalEntry[];
}): Set<string> {
  const { state, journal } = input;
  const recovery = state?.recovery;
  const refuse = (): never => {
    throw new SecretSyncError(
      'local-changed',
      'Switch does not match pending recovery or its files changed; recovery evidence was retained.',
    );
  };
  const completed = new Set<string>();
  if (recovery === undefined || state === undefined) {
    if (journal.some((entry) => entry.status !== 'acknowledged' || entry.opId === input.operationId)) {
      refuse();
    }
    return completed;
  }
  if (recovery.kind !== 'switch') {
    return refuse();
  }
  if (
    recovery.sourceBranch !== state.activeBranch ||
    recovery.materializedBranch !== state.materializedBranch ||
    recovery.targetBranch !== input.targetBranch ||
    recovery.sourceCommitId !== input.sourceCommitId ||
    recovery.targetCommitId !== input.targetCommitId ||
    (input.operationId !== undefined && input.operationId !== recovery.operationId) ||
    recovery.files.length !== input.ordered.length ||
    recovery.files.some((file, index) => file.path !== input.ordered[index])
  ) {
    refuse();
  }
  const entries = new Map<string, JournalEntry>();
  const files = new Map(recovery.files.map((file) => [file.path, file]));
  for (const entry of journal) {
    if (entry.opId !== recovery.operationId) {
      if (entry.status !== 'acknowledged') {
        refuse();
      }
      continue;
    }
    const file = files.get(entry.path);
    const wanted = input.targetBytes.get(entry.path);
    if (
      file === undefined ||
      file.action === 'acknowledge' ||
      entry.kind !== file.action ||
      entry.timestamp !== recovery.timestamp ||
      entry.blobId !== file.blobId ||
      entries.has(entry.path) ||
      (wanted === undefined
        ? entry.hmac !== undefined || entry.byteLength !== undefined
        : entry.hmac !== computeFileHmac(wanted, state.localKey) || entry.byteLength !== wanted.byteLength)
    ) {
      refuse();
    }
    entries.set(entry.path, entry);
  }
  for (const file of recovery.files) {
    const wanted = input.targetBytes.get(file.path);
    const local = input.localBytes.get(file.path);
    const action = matchesLocalPreimage(file.preimage, wanted, state.localKey)
      ? 'acknowledge'
      : wanted === undefined
        ? 'remove'
        : 'write';
    if (file.blobId !== input.targetTree.get(file.path)?.blobId || file.action !== action) {
      refuse();
    }
    const entry = entries.get(file.path);
    const atTarget =
      wanted === undefined
        ? local === undefined
        : local !== undefined &&
          local.byteLength === wanted.byteLength &&
          computeFileHmac(local, state.localKey) === computeFileHmac(wanted, state.localKey);
    if (entry !== undefined && atTarget) {
      completed.add(file.path);
    } else if (
      (entry !== undefined && entry.status !== 'pending') ||
      !matchesLocalPreimage(file.preimage, local, state.localKey)
    ) {
      refuse();
    }
  }
  return completed;
}
