import { MAX_SCAN_RECORDS } from './config';
import { SecretSyncError } from './errors';
import { canonicalJson, type CommitEnvelope } from './records';

export const MAX_GRAPH_NODES = MAX_SCAN_RECORDS;

export type BranchGraphStatus =
  | { status: 'empty'; branch: string; commits: number }
  | { status: 'single'; branch: string; head: CommitEnvelope }
  | { status: 'diverged'; branch: string; heads: CommitEnvelope[] }
  | { status: 'incomplete'; branch: string; missing: string[] }
  | { status: 'corrupt'; branch: string; reason: string };

function toCommitList(commits: ReadonlyArray<CommitEnvelope> | ReadonlyMap<string, CommitEnvelope>): CommitEnvelope[] {
  if (Array.isArray(commits)) {
    return [...commits];
  }
  return [...commits.values()];
}

export function indexCommitsById(commits: ReadonlyArray<CommitEnvelope>): Map<string, CommitEnvelope> {
  if (commits.length > MAX_GRAPH_NODES) {
    throw new SecretSyncError('too-large', 'Commit graph exceeds the bounded traversal limit.');
  }
  const byId = new Map<string, CommitEnvelope>();
  const seenCanonical = new Map<string, string>();
  for (const commit of commits) {
    const canonical = canonicalJson(commit);
    const previous = seenCanonical.get(commit.logicalId);
    if (previous !== undefined && previous !== canonical) {
      throw new SecretSyncError('remote-corrupt', 'Conflicting duplicate commit ids are corruption.');
    }
    if (previous !== undefined) {
      continue;
    }
    seenCanonical.set(commit.logicalId, canonical);
    byId.set(commit.logicalId, commit);
  }
  return byId;
}

export function collectAncestors(
  startId: string,
  byId: ReadonlyMap<string, CommitEnvelope>,
  maxNodes: number = MAX_GRAPH_NODES,
): Set<string> {
  const ancestors = new Set<string>();
  const stack: string[] = [startId];
  const visiting = new Set<string>([startId]);
  const visited = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (visited.has(current)) {
      visiting.delete(current);
      continue;
    }
    visited.add(current);
    if (visited.size > maxNodes) {
      throw new SecretSyncError('too-large', 'Commit graph traversal exceeds the bounded limit.');
    }
    const node = byId.get(current);
    if (node === undefined) {
      continue;
    }
    for (const parent of node.parents) {
      if (visiting.has(parent) && !visited.has(parent)) {
        const cycleCheck = new Set<string>([...visiting, parent]);
        void cycleCheck;
        throw new SecretSyncError('remote-corrupt', 'Commit graph contains a cycle.');
      }
      if (parent === startId && current !== startId) {
        throw new SecretSyncError('remote-corrupt', 'Commit graph contains a cycle.');
      }
      if (!ancestors.has(parent) && parent !== startId) {
        ancestors.add(parent);
      }
      if (!visited.has(parent)) {
        visiting.add(parent);
        stack.push(parent);
      }
    }
    if (current !== startId) {
      visiting.delete(current);
    } else if (stack.length === 0) {
      visiting.delete(current);
    }
  }
  ancestors.delete(startId);
  const startNode = byId.get(startId);
  if (startNode !== undefined && ancestors.has(startId)) {
    throw new SecretSyncError('remote-corrupt', 'Commit graph contains a cycle.');
  }
  return ancestors;
}

function detectCycle(byId: ReadonlyMap<string, CommitEnvelope>): string | undefined {
  const state = new Map<string, number>();
  const visit = (id: string, path: string[]): string | undefined => {
    const current = state.get(id);
    if (current === 2) {
      return undefined;
    }
    if (current === 1) {
      return id;
    }
    state.set(id, 1);
    const node = byId.get(id);
    if (node !== undefined) {
      if (path.length > MAX_GRAPH_NODES) {
        throw new SecretSyncError('too-large', 'Commit graph traversal exceeds the bounded limit.');
      }
      for (const parent of node.parents) {
        if (state.get(parent) === 1) {
          return parent;
        }
        const found = visit(parent, [...path, id]);
        if (found !== undefined) {
          return found;
        }
      }
    }
    state.set(id, 2);
    return undefined;
  };
  if (byId.size > MAX_GRAPH_NODES) {
    throw new SecretSyncError('too-large', 'Commit graph exceeds the bounded traversal limit.');
  }
  for (const id of byId.keys()) {
    const found = visit(id, []);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

export function isAncestor(
  ancestorId: string,
  descendantId: string,
  byId: ReadonlyMap<string, CommitEnvelope>,
): boolean {
  if (ancestorId === descendantId) {
    return false;
  }
  const ancestors = collectAncestors(descendantId, byId);
  return ancestors.has(ancestorId);
}

function isCommitList(
  value: ReadonlyArray<CommitEnvelope> | ReadonlyMap<string, CommitEnvelope>,
): value is ReadonlyArray<CommitEnvelope> {
  return Array.isArray(value);
}

export function deriveBranchHeads(
  commits: ReadonlyArray<CommitEnvelope> | ReadonlyMap<string, CommitEnvelope>,
  branch: string,
): CommitEnvelope[] {
  const list = toCommitList(commits);
  const byId: ReadonlyMap<string, CommitEnvelope> = isCommitList(commits) ? indexCommitsById(list) : commits;
  const cycle = detectCycle(byId);
  if (cycle !== undefined) {
    throw new SecretSyncError('remote-corrupt', 'Commit graph contains a cycle.');
  }
  const scoped = list.filter((commit) => commit.branch === branch);
  const ancestorCache = new Map<string, Set<string>>();
  const ancestorsOf = (id: string): Set<string> => {
    const cached = ancestorCache.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const computed = collectAncestors(id, byId);
    ancestorCache.set(id, computed);
    return computed;
  };
  const heads: CommitEnvelope[] = [];
  for (const candidate of scoped) {
    let dominated = false;
    for (const other of scoped) {
      if (other.logicalId === candidate.logicalId) {
        continue;
      }
      if (ancestorsOf(other.logicalId).has(candidate.logicalId)) {
        dominated = true;
        break;
      }
    }
    if (!dominated) {
      heads.push(candidate);
    }
  }
  heads.sort((a, b) => (a.logicalId < b.logicalId ? -1 : a.logicalId > b.logicalId ? 1 : 0));
  return heads;
}

export function findMissingParents(byId: ReadonlyMap<string, CommitEnvelope>): string[] {
  if (byId.size > MAX_GRAPH_NODES) {
    throw new SecretSyncError('too-large', 'Commit graph exceeds the bounded traversal limit.');
  }
  const missing = new Set<string>();
  for (const commit of byId.values()) {
    for (const parent of commit.parents) {
      if (!byId.has(parent)) {
        missing.add(parent);
      }
    }
  }
  return [...missing].sort();
}

export function classifyBranchState(
  commits: ReadonlyArray<CommitEnvelope> | ReadonlyMap<string, CommitEnvelope>,
  branch: string,
): BranchGraphStatus {
  const list = toCommitList(commits);
  let byId: Map<string, CommitEnvelope>;
  try {
    byId = isCommitList(commits) ? indexCommitsById(list) : new Map(commits);
  } catch (error) {
    if (error instanceof SecretSyncError && error.code === 'remote-corrupt') {
      return { status: 'corrupt', branch, reason: error.message };
    }
    throw error;
  }
  const projects = new Set<string>();
  for (const commit of byId.values()) {
    projects.add(commit.projectId);
  }
  if (projects.size > 1) {
    return { status: 'corrupt', branch, reason: 'Commit graph mixes multiple projects.' };
  }
  let cycle: string | undefined;
  try {
    cycle = detectCycle(byId);
  } catch (error) {
    if (error instanceof SecretSyncError && error.code === 'too-large') {
      throw error;
    }
    return { status: 'corrupt', branch, reason: error instanceof Error ? error.message : 'Invalid graph.' };
  }
  if (cycle !== undefined) {
    return { status: 'corrupt', branch, reason: 'Commit graph contains a cycle.' };
  }
  const missing = findMissingParents(byId);
  if (missing.length > 0) {
    return { status: 'incomplete', branch, missing };
  }
  const scoped = list.filter((commit) => commit.branch === branch);
  if (scoped.length === 0) {
    return { status: 'empty', branch, commits: byId.size };
  }
  const heads = deriveBranchHeads(byId, branch);
  if (heads.length === 0) {
    return { status: 'corrupt', branch, reason: 'Branch head derivation produced no heads.' };
  }
  if (heads.length === 1) {
    return { status: 'single', branch, head: heads[0] as CommitEnvelope };
  }
  return { status: 'diverged', branch, heads };
}

export function requireSingleHead(
  commits: ReadonlyArray<CommitEnvelope> | ReadonlyMap<string, CommitEnvelope>,
  branch: string,
): CommitEnvelope {
  const state = classifyBranchState(commits, branch);
  if (state.status === 'single') {
    return state.head;
  }
  if (state.status === 'empty') {
    throw new SecretSyncError('remote-empty', `Branch ${JSON.stringify(branch)} has no commits.`);
  }
  if (state.status === 'diverged') {
    throw new SecretSyncError('remote-diverged', `Branch ${JSON.stringify(branch)} has multiple heads.`);
  }
  if (state.status === 'incomplete') {
    throw new SecretSyncError('remote-incomplete', `Branch ${JSON.stringify(branch)} references missing parents.`);
  }
  throw new SecretSyncError('remote-corrupt', `Branch ${JSON.stringify(branch)} history is corrupt.`);
}

export function collectReachableCommits(
  headIds: ReadonlyArray<string>,
  byId: ReadonlyMap<string, CommitEnvelope>,
  limit: number,
): CommitEnvelope[] {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new SecretSyncError('validation', 'Traversal limit must be a positive safe integer.');
  }
  const bounded = Math.min(limit, MAX_GRAPH_NODES);
  const seen = new Set<string>();
  const queue: string[] = [...headIds];
  const result: CommitEnvelope[] = [];
  while (queue.length > 0) {
    queue.sort();
    const current = queue.shift() as string;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (seen.size > bounded) {
      throw new SecretSyncError('too-large', 'Bounded ancestry traversal exceeded its limit.');
    }
    const node = byId.get(current);
    if (node === undefined) {
      throw new SecretSyncError('remote-incomplete', 'Traversal reached a missing parent commit.');
    }
    result.push(node);
    for (const parent of node.parents) {
      if (!seen.has(parent)) {
        queue.push(parent);
      }
    }
  }
  result.sort((a, b) => (a.logicalId < b.logicalId ? -1 : a.logicalId > b.logicalId ? 1 : 0));
  return result;
}
