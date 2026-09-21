import { normalizeProjectRelPath, validateBranchName } from './config';
import { SecretSyncError } from './errors';
import { listBranches } from './branches';
import { loadValidatedHistory, type LoadedHistory } from './history-store';
import { normalizeOperationIdentity } from './state';
import type { SecretStore } from './store';
import { resolveOperationConcurrency } from './operations';

export const INTERACTIVE_CURRENT_REVISION = 'current';

export interface InteractiveRevisionEntry {
  blobId: string;
  label: string;
  hint: string;
}

export interface ShowPicker {
  selectFile(files: string[], initial?: string): Promise<string | undefined>;
  selectRevision(file: string, revisions: InteractiveRevisionEntry[]): Promise<string | undefined>;
  selectBranch(branches: string[], initial: string): Promise<string | undefined>;
}

export interface ResolveInteractiveShowTargetOptions {
  store: SecretStore;
  projectId?: string;
  branch: string;
  path?: string;
  revision?: string;
  concurrency?: number;
  endpoint?: string;
  vaultId?: string;
  remote?: unknown;
  identity?: unknown;
  picker?: ShowPicker;
  isTty?: boolean;
}

export interface InteractiveShowTarget {
  path: string;
  revision?: string;
  branch: string;
}

function listTrackedPaths(history: LoadedHistory): string[] {
  const paths = new Set<string>();
  for (const commit of history.commits.values()) {
    for (const entry of commit.tree) {
      paths.add(entry.path);
    }
  }
  return [...paths].sort();
}

function shortId(value: string): string {
  return value.slice(0, 8);
}

function truncateMessage(message: string | undefined): string {
  if (message === undefined || message.length === 0) {
    return '(no message)';
  }
  return message.length > 60 ? `${message.slice(0, 57)}...` : message;
}

function listPathRevisions(history: LoadedHistory, path: string): InteractiveRevisionEntry[] {
  const newest = new Map<string, { commitId: string; timestamp: number; message?: string }>();
  for (const commit of history.commits.values()) {
    for (const entry of commit.tree) {
      if (entry.path !== path) {
        continue;
      }
      const known = newest.get(entry.blobId);
      if (known === undefined || commit.timestamp > known.timestamp) {
        newest.set(entry.blobId, { commitId: commit.logicalId, timestamp: commit.timestamp, message: commit.message });
      }
    }
  }
  return [...newest]
    .sort((left, right) => right[1].timestamp - left[1].timestamp || (left[0] < right[0] ? -1 : 1))
    .map(([blobId, found]) => ({
      blobId,
      label: truncateMessage(found.message),
      hint: `blob ${shortId(blobId)} · commit ${shortId(found.commitId)}`,
    }));
}

async function clackPicker(): Promise<ShowPicker> {
  const prompts = (await import('@clack/prompts')) as {
    select: (args: {
      message: string;
      options: Array<{ value: string; label?: string; hint?: string }>;
      initialValue?: string;
    }) => Promise<string | symbol>;
    isCancel: (value: unknown) => boolean;
  };
  const pick = async (
    message: string,
    options: Array<{ value: string; label?: string; hint?: string }>,
    initial?: string,
  ): Promise<string | undefined> => {
    const value = await prompts.select({
      message,
      options,
      ...(initial === undefined ? {} : { initialValue: initial }),
    });
    if (prompts.isCancel(value) || typeof value !== 'string') {
      return undefined;
    }
    return value;
  };
  return {
    selectFile: (files, initial) =>
      pick(
        'Select a tracked file to show',
        files.map((file) => ({ value: file, label: file })),
        initial,
      ),
    selectRevision: (file, revisions) =>
      pick(`Select a revision of ${file}`, [
        { value: INTERACTIVE_CURRENT_REVISION, label: 'Current version', hint: 'latest committed bytes' },
        ...revisions.map((entry) => ({ value: entry.blobId, label: entry.label, hint: entry.hint })),
      ]),
    selectBranch: (branches, initial) =>
      pick(
        'Select a branch for the current version',
        branches.map((branch) => ({ value: branch, label: branch })),
        initial,
      ),
  };
}

function abortSelection(): never {
  throw new SecretSyncError('aborted', 'Interactive selection cancelled; nothing was shown.');
}

export async function resolveInteractiveShowTarget(
  options: ResolveInteractiveShowTargetOptions,
): Promise<InteractiveShowTarget> {
  const branch = validateBranchName(options.branch);
  const identity = normalizeOperationIdentity({
    endpoint: options.endpoint,
    vaultId: options.vaultId,
    projectId: options.projectId,
    remote: options.remote,
    identity: options.identity,
  });
  const picker =
    options.picker ??
    (await (async () => {
      const tty = options.isTty ?? process.stdin?.isTTY ?? false;
      if (!tty) {
        throw new SecretSyncError('validation', 'show --interactive requires an interactive terminal (TTY).');
      }
      return clackPicker();
    })());
  const concurrency = resolveOperationConcurrency(options.concurrency);
  const history = await loadValidatedHistory(options.store, identity.projectId, { concurrency });
  const files = listTrackedPaths(history);
  if (files.length === 0) {
    throw new SecretSyncError('validation', 'No tracked files to show in this project yet.');
  }
  let path: string;
  if (options.path !== undefined) {
    path = normalizeProjectRelPath(options.path, '--file');
    if (!files.includes(path)) {
      throw new SecretSyncError('validation', `Path ${JSON.stringify(path)} is not tracked in this project.`);
    }
  } else {
    const selected = await picker.selectFile(files);
    if (selected === undefined) {
      abortSelection();
    }
    path = selected;
  }
  let revision = options.revision;
  if (revision === undefined) {
    const entries = listPathRevisions(history, path);
    const selected = await picker.selectRevision(path, entries);
    if (selected === undefined) {
      abortSelection();
    }
    revision = selected === INTERACTIVE_CURRENT_REVISION ? undefined : selected;
  }
  const listed = await listBranches(options.store, identity.projectId, concurrency);
  const branches = listed.branches.map((entry) => entry.branch).sort();
  const selectedBranch = await picker.selectBranch(branches.length === 0 ? [branch] : branches, branch);
  if (selectedBranch === undefined) {
    abortSelection();
  }
  return { path, ...(revision === undefined ? {} : { revision }), branch: selectedBranch };
}
