import { describe, expect, it } from 'vitest';

import { SecretSyncError } from '../src/errors';
import {
  classifyBranchState,
  collectAncestors,
  collectReachableCommits,
  deriveBranchHeads,
  findMissingParents,
  indexCommitsById,
  isAncestor,
  requireSingleHead,
} from '../src/graph';
import type { CommitEnvelope } from '../src/records';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const OTHER_PROJECT = 'b64208df-4a95-4516-b8c7-e00621a7820c';

function testUuid(tag: number): string {
  const tail = tag.toString(16).padStart(12, '0');
  return `22222222-2222-4222-8222-${tail}`;
}

function makeCommit(overrides: Partial<CommitEnvelope> & { logicalId: string; branch: string }): CommitEnvelope {
  return {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    kind: 'commit',
    logicalId: overrides.logicalId,
    branch: overrides.branch,
    parents: overrides.parents ?? [],
    tree: overrides.tree ?? [],
    timestamp: overrides.timestamp ?? 1000,
    operationId: overrides.operationId ?? testUuid(9001),
    operationKind: overrides.operationKind ?? 'push',
    ...(overrides.message === undefined ? {} : { message: overrides.message }),
  };
}

describe('branch heads', () => {
  it('preserves two writers sharing one parent as divergent heads', () => {
    const root = makeCommit({ logicalId: testUuid(1), branch: 'main', timestamp: 100 });
    const left = makeCommit({ logicalId: testUuid(2), branch: 'main', parents: [root.logicalId], timestamp: 200 });
    const right = makeCommit({ logicalId: testUuid(3), branch: 'main', parents: [root.logicalId], timestamp: 300 });
    const heads = deriveBranchHeads([root, left, right], 'main');
    expect(heads.map((entry) => entry.logicalId).sort()).toEqual([left.logicalId, right.logicalId].sort());
    expect(() => requireSingleHead([root, left, right], 'main')).toThrowError(
      expect.objectContaining({ code: 'remote-diverged' }),
    );
  });

  it('leaves the source head unchanged when creating another branch', () => {
    const root = makeCommit({ logicalId: testUuid(11), branch: 'main', timestamp: 10 });
    const mainTip = makeCommit({ logicalId: testUuid(12), branch: 'main', parents: [root.logicalId], timestamp: 20 });
    const featureTip = makeCommit({
      logicalId: testUuid(13),
      branch: 'feature/demo',
      parents: [root.logicalId],
      timestamp: 30,
    });
    expect(deriveBranchHeads([root, mainTip, featureTip], 'main').map((entry) => entry.logicalId)).toEqual([
      mainTip.logicalId,
    ]);
    expect(deriveBranchHeads([root, mainTip, featureTip], 'feature/demo').map((entry) => entry.logicalId)).toEqual([
      featureTip.logicalId,
    ]);
  });

  it('never lets timestamps choose the winner', () => {
    const root = makeCommit({ logicalId: testUuid(21), branch: 'main', timestamp: 1000 });
    const olderId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const newerId = 'zzzzzzzz-1111-4111-8111-aaaaaaaaaaaa'.replace(/z/g, 'f');
    const olderLargeTime = makeCommit({ logicalId: olderId, branch: 'main', parents: [root.logicalId], timestamp: 1 });
    const newerSmallTime = makeCommit({
      logicalId: newerId,
      branch: 'main',
      parents: [root.logicalId],
      timestamp: 999999,
    });
    const heads = deriveBranchHeads([root, olderLargeTime, newerSmallTime], 'main');
    expect(heads).toHaveLength(2);
    expect(heads.map((entry) => entry.logicalId)).toEqual([olderId, newerId].sort());
    const reversed = deriveBranchHeads([newerSmallTime, olderLargeTime, root], 'main');
    expect(reversed.map((entry) => entry.logicalId)).toEqual(heads.map((entry) => entry.logicalId));
  });

  it('joins forks after resolution while preserving the losing ancestry', () => {
    const root = makeCommit({ logicalId: testUuid(31), branch: 'main' });
    const left = makeCommit({ logicalId: testUuid(32), branch: 'main', parents: [root.logicalId] });
    const right = makeCommit({ logicalId: testUuid(33), branch: 'main', parents: [root.logicalId] });
    const resolved = makeCommit({
      logicalId: testUuid(34),
      branch: 'main',
      parents: [left.logicalId, right.logicalId],
    });
    const all = [root, left, right, resolved];
    expect(deriveBranchHeads(all, 'main').map((entry) => entry.logicalId)).toEqual([resolved.logicalId]);
    const byId = indexCommitsById(all);
    expect(isAncestor(left.logicalId, resolved.logicalId, byId)).toBe(true);
    expect(isAncestor(right.logicalId, resolved.logicalId, byId)).toBe(true);
    expect(collectAncestors(resolved.logicalId, byId).has(root.logicalId)).toBe(true);
  });

  it('tracks cross-branch ancestry without merging head sets', () => {
    const root = makeCommit({ logicalId: testUuid(41), branch: 'main' });
    const mainTip = makeCommit({ logicalId: testUuid(42), branch: 'main', parents: [root.logicalId] });
    const feature = makeCommit({ logicalId: testUuid(43), branch: 'feature/x', parents: [mainTip.logicalId] });
    const byId = indexCommitsById([root, mainTip, feature]);
    expect(isAncestor(mainTip.logicalId, feature.logicalId, byId)).toBe(true);
    expect(isAncestor(feature.logicalId, mainTip.logicalId, byId)).toBe(false);
    expect(deriveBranchHeads([root, mainTip, feature], 'main').map((entry) => entry.logicalId)).toEqual([
      mainTip.logicalId,
    ]);
    expect(deriveBranchHeads([root, mainTip, feature], 'feature/x').map((entry) => entry.logicalId)).toEqual([
      feature.logicalId,
    ]);
  });
});

describe('remote state distinctions', () => {
  it('distinguishes empty diverged incomplete and corrupt states', () => {
    expect(classifyBranchState([], 'main')).toEqual({ status: 'empty', branch: 'main', commits: 0 });
    const root = makeCommit({ logicalId: testUuid(51), branch: 'main' });
    const single = classifyBranchState([root], 'main');
    expect(single.status).toBe('single');
    const left = makeCommit({ logicalId: testUuid(52), branch: 'main', parents: [root.logicalId] });
    const right = makeCommit({ logicalId: testUuid(53), branch: 'main', parents: [root.logicalId] });
    expect(classifyBranchState([root, left, right], 'main').status).toBe('diverged');
    const orphan = makeCommit({ logicalId: testUuid(54), branch: 'main', parents: [testUuid(999)] });
    const incomplete = classifyBranchState([orphan], 'main');
    expect(incomplete.status).toBe('incomplete');
    expect(findMissingParents(indexCommitsById([orphan]))).toEqual([testUuid(999)]);
    const cycleA = makeCommit({ logicalId: testUuid(55), branch: 'main', parents: [testUuid(56)] });
    const cycleB = makeCommit({ logicalId: testUuid(56), branch: 'main', parents: [testUuid(55)] });
    expect(classifyBranchState([cycleA, cycleB], 'main').status).toBe('corrupt');
    const foreign = { ...makeCommit({ logicalId: testUuid(57), branch: 'main' }), projectId: OTHER_PROJECT };
    expect(classifyBranchState([root, foreign], 'main').status).toBe('corrupt');
  });

  it('maps states to distinct errors for single-head consumers', () => {
    expect(() => requireSingleHead([], 'main')).toThrowError(expect.objectContaining({ code: 'remote-empty' }));
    const orphan = makeCommit({ logicalId: testUuid(61), branch: 'main', parents: [testUuid(62)] });
    expect(() => requireSingleHead([orphan], 'main')).toThrowError(
      expect.objectContaining({ code: 'remote-incomplete' }),
    );
    const cycleA = makeCommit({ logicalId: testUuid(63), branch: 'main', parents: [testUuid(64)] });
    const cycleB = makeCommit({ logicalId: testUuid(64), branch: 'main', parents: [testUuid(63)] });
    let caught: unknown;
    try {
      requireSingleHead([cycleA, cycleB], 'main');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SecretSyncError);
    expect((caught as SecretSyncError).code).toBe('remote-corrupt');
  });
});

describe('bounded traversal', () => {
  it('bounds ancestor walks and history pages', () => {
    const root = makeCommit({ logicalId: testUuid(71), branch: 'main' });
    const child = makeCommit({ logicalId: testUuid(72), branch: 'main', parents: [root.logicalId] });
    const byId = indexCommitsById([root, child]);
    expect(() => collectAncestors(child.logicalId, byId, 1)).toThrowError(
      expect.objectContaining({ code: 'too-large' }),
    );
    expect(() => collectReachableCommits([child.logicalId], byId, 1)).toThrowError(
      expect.objectContaining({ code: 'too-large' }),
    );
    expect(() => collectReachableCommits([testUuid(999)], byId, 10)).toThrowError(
      expect.objectContaining({ code: 'remote-incomplete' }),
    );
    expect(
      collectReachableCommits([child.logicalId], byId, 10)
        .map((entry) => entry.logicalId)
        .sort(),
    ).toEqual([root.logicalId, child.logicalId].sort());
  });
});
