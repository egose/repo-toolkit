import { describe, expect, it } from 'vitest';

import { SecretSyncError } from '../src/errors';
import { isNoopPlan, planSync, requireSingleBranchHead, type PlanSnapshots, type SyncEffects } from '../src/plan';
import { createCommitRecord, sha256Hex, type CommitEnvelope } from '../src/records';
import type { BaselineSlot, LocalSlot } from '../src/status';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';

function testUuid(tag: number): string {
  const tail = tag.toString(16).padStart(12, '0');
  return `55555555-5555-4555-8555-${tail}`;
}

const CONTENT_A = 'plan-content-alpha-canary-p1';
const CONTENT_B = 'plan-content-beta-canary-p2';
const CONTENT_C = 'plan-content-gamma-canary-p3';

function digest(content: string): { sha256: string; byteLength: number } {
  const bytes = Buffer.from(content, 'utf8');
  return { sha256: sha256Hex(bytes), byteLength: bytes.byteLength };
}

function commitFor(
  branch: string,
  files: Array<{ path: string; content: string; blobTag: number }>,
  tag: number,
  parents: string[] = [],
): CommitEnvelope {
  return createCommitRecord({
    projectId: PROJECT_ID,
    branch,
    parents,
    tree: files.map((file) => ({ path: file.path, blobId: testUuid(file.blobTag), ...digest(file.content) })),
    timestamp: 1000 + tag,
    operationId: testUuid(700 + tag),
    operationKind: 'push',
    logicalId: testUuid(tag),
  }).envelope;
}

function baselinePresent(content: string, blobTag: number): BaselineSlot {
  return { state: 'present', fingerprint: { ...digest(content), blobId: testUuid(blobTag) } };
}

function localPresent(content: string): LocalSlot {
  return { state: 'present', fingerprint: { ...digest(content) } };
}

function createEffectsRecorder(): SyncEffects & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    writeRemote: (path: string) => {
      calls.push(`writeRemote:${path}`);
    },
    writeLocal: (path: string) => {
      calls.push(`writeLocal:${path}`);
    },
    lock: (scope: string) => {
      calls.push(`lock:${scope}`);
    },
    updateState: (path: string) => {
      calls.push(`updateState:${path}`);
    },
  };
}

describe('push planning', () => {
  it('uploads local additions and marks the commit needed', () => {
    const head = commitFor('main', [], 1);
    const snapshots: PlanSnapshots = {
      baselines: new Map(),
      locals: new Map<string, LocalSlot>([['.env', localPresent(CONTENT_A)]]),
      heads: [head],
    };
    const plan = planSync(snapshots, { direction: 'push', branch: 'main' });
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0]).toMatchObject({ kind: 'upload', path: '.env' });
    expect(plan.commitNeeded).toBe(true);
    expect(plan.noop).toBe(false);
    expect(isNoopPlan(plan)).toBe(false);
    expect(plan.parents).toEqual([head.logicalId]);
    expect(plan.resultingTree.map((entry) => entry.path)).toEqual(['.env']);
  });

  it('treats a fully clean selection as a no-op with no commit', () => {
    const head = commitFor('main', [{ path: '.env', content: CONTENT_A, blobTag: 21 }], 2);
    const snapshots: PlanSnapshots = {
      baselines: new Map<string, BaselineSlot>([['.env', baselinePresent(CONTENT_A, 21)]]),
      locals: new Map<string, LocalSlot>([['.env', localPresent(CONTENT_A)]]),
      heads: [head],
    };
    const plan = planSync(snapshots, { direction: 'push', branch: 'main' });
    expect(plan.actions).toEqual([]);
    expect(plan.pendingDeletions).toEqual([]);
    expect(plan.commitNeeded).toBe(false);
    expect(plan.noop).toBe(true);
    expect(isNoopPlan(plan)).toBe(true);
  });

  it('preserves out-of-selection remote changes in the resulting tree', () => {
    const head = commitFor(
      'main',
      [
        { path: '.env', content: CONTENT_A, blobTag: 31 },
        { path: 'other.env', content: CONTENT_B, blobTag: 32 },
      ],
      3,
    );
    const snapshots: PlanSnapshots = {
      baselines: new Map<string, BaselineSlot>([
        ['.env', baselinePresent(CONTENT_A, 31)],
        ['other.env', baselinePresent(CONTENT_A, 32)],
      ]),
      locals: new Map<string, LocalSlot>([
        ['.env', localPresent(CONTENT_B)],
        ['other.env', localPresent(CONTENT_A)],
      ]),
      heads: [head],
    };
    const plan = planSync(snapshots, { direction: 'push', branch: 'main', selection: ['.env'] });
    expect(plan.selected).toEqual(['.env']);
    expect(plan.actions).toHaveLength(1);
    expect(plan.outOfSelectionPreserved).toEqual(['other.env']);
    const other = plan.resultingTree.find((entry) => entry.path === 'other.env');
    expect(other?.blobId).toBe(testUuid(32));
    expect(other?.source).toBe('preserved');
  });

  it('keeps local deletions pending without --delete and authorizes them with --delete', () => {
    const head = commitFor('main', [{ path: '.env', content: CONTENT_A, blobTag: 41 }], 4);
    const snapshots = (): PlanSnapshots => ({
      baselines: new Map<string, BaselineSlot>([['.env', baselinePresent(CONTENT_A, 41)]]),
      locals: new Map<string, LocalSlot>([['.env', { state: 'absent' }]]),
      heads: [head],
    });
    const pending = planSync(snapshots(), { direction: 'push', branch: 'main' });
    expect(pending.actions).toEqual([]);
    expect(pending.pendingDeletions).toEqual([
      { path: '.env', direction: 'push', requiredFlag: '--delete', current: 'local-deleted' },
    ]);
    expect(pending.commitNeeded).toBe(false);
    expect(pending.noop).toBe(true);
    expect(pending.resultingTree.map((entry) => entry.path)).toEqual(['.env']);
    const authorized = planSync(snapshots(), { direction: 'push', branch: 'main', allowDelete: true });
    expect(authorized.actions).toEqual([{ kind: 'delete-remote', path: '.env' }]);
    expect(authorized.pendingDeletions).toEqual([]);
    expect(authorized.commitNeeded).toBe(true);
    expect(authorized.resultingTree).toEqual([]);
  });

  it('plans a first push from an empty remote with no parents', () => {
    const snapshots: PlanSnapshots = {
      baselines: new Map(),
      locals: new Map<string, LocalSlot>([['.env', localPresent(CONTENT_A)]]),
      heads: [],
    };
    const plan = planSync(snapshots, { direction: 'push', branch: 'main' });
    expect(plan.parents).toEqual([]);
    expect(plan.heads).toEqual([]);
    expect(plan.commitNeeded).toBe(true);
  });

  it('ignores heads from other branches', () => {
    const mainHead = commitFor('main', [{ path: '.env', content: CONTENT_A, blobTag: 51 }], 5);
    const featureHead = commitFor('feature/demo', [{ path: '.env', content: CONTENT_B, blobTag: 52 }], 6);
    const snapshots: PlanSnapshots = {
      baselines: new Map<string, BaselineSlot>([['.env', baselinePresent(CONTENT_A, 51)]]),
      locals: new Map<string, LocalSlot>([['.env', localPresent(CONTENT_A)]]),
      heads: [mainHead, featureHead],
    };
    const plan = planSync(snapshots, { direction: 'push', branch: 'main' });
    expect(plan.noop).toBe(true);
    expect(plan.parents).toEqual([mainHead.logicalId]);
  });
});

describe('pull planning', () => {
  it('downloads remote additions for a fresh clone', () => {
    const head = commitFor(
      'main',
      [
        { path: '.env', content: CONTENT_A, blobTag: 61 },
        { path: 'secrets/app.json', content: CONTENT_B, blobTag: 62 },
      ],
      7,
    );
    const snapshots: PlanSnapshots = {
      baselines: new Map(),
      locals: new Map(),
      heads: [head],
    };
    const plan = planSync(snapshots, { direction: 'pull', branch: 'main' });
    expect(plan.actions).toEqual([
      { kind: 'download', path: '.env', blobId: testUuid(61), ...digest(CONTENT_A) },
      { kind: 'download', path: 'secrets/app.json', blobId: testUuid(62), ...digest(CONTENT_B) },
    ]);
    expect(plan.commitNeeded).toBe(false);
    expect(plan.noop).toBe(false);
  });

  it('preserves local-only changes instead of overwriting them', () => {
    const head = commitFor('main', [{ path: '.env', content: CONTENT_A, blobTag: 71 }], 8);
    const snapshots: PlanSnapshots = {
      baselines: new Map<string, BaselineSlot>([['.env', baselinePresent(CONTENT_A, 71)]]),
      locals: new Map<string, LocalSlot>([['.env', localPresent(CONTENT_B)]]),
      heads: [head],
    };
    const plan = planSync(snapshots, { direction: 'pull', branch: 'main' });
    expect(plan.actions).toEqual([]);
    expect(plan.noop).toBe(true);
  });

  it('holds remote deletions pending without --delete', () => {
    const head = commitFor('main', [], 9);
    const snapshots: PlanSnapshots = {
      baselines: new Map<string, BaselineSlot>([['.env', baselinePresent(CONTENT_A, 81)]]),
      locals: new Map<string, LocalSlot>([['.env', localPresent(CONTENT_A)]]),
      heads: [head],
    };
    const pending = planSync(snapshots, { direction: 'pull', branch: 'main' });
    expect(pending.actions).toEqual([]);
    expect(pending.pendingDeletions).toEqual([
      { path: '.env', direction: 'pull', requiredFlag: '--delete', current: 'remote-deleted' },
    ]);
    const authorized = planSync(snapshots, { direction: 'pull', branch: 'main', allowDelete: true });
    expect(authorized.actions).toEqual([{ kind: 'delete-local', path: '.env' }]);
  });

  it('reports zero matches as a no-op pull', () => {
    const plan = planSync(
      { baselines: new Map(), locals: new Map(), heads: [] },
      {
        direction: 'pull',
        branch: 'main',
        selection: [],
      },
    );
    expect(plan.actions).toEqual([]);
    expect(plan.noop).toBe(true);
    expect(plan.resultingTree).toEqual([]);
  });
});

describe('preflight refusal', () => {
  it('stops push preflight on conflicts without a partial plan', () => {
    const head = commitFor('main', [{ path: '.env', content: CONTENT_C, blobTag: 91 }], 10);
    const snapshots: PlanSnapshots = {
      baselines: new Map<string, BaselineSlot>([['.env', baselinePresent(CONTENT_A, 92)]]),
      locals: new Map<string, LocalSlot>([['.env', localPresent(CONTENT_B)]]),
      heads: [head],
    };
    expect(() => planSync(snapshots, { direction: 'push', branch: 'main' })).toThrowError(
      /selected paths include conflicts: \.env/,
    );
  });

  it('stops pull preflight on unbased conflicts', () => {
    const head = commitFor('main', [{ path: '.env', content: CONTENT_B, blobTag: 101 }], 11);
    const snapshots: PlanSnapshots = {
      baselines: new Map(),
      locals: new Map<string, LocalSlot>([['.env', localPresent(CONTENT_A)]]),
      heads: [head],
    };
    expect(() => planSync(snapshots, { direction: 'pull', branch: 'main' })).toThrowError(/unbased|conflicts/);
  });

  it('refuses diverged heads instead of picking a winner', () => {
    const first = commitFor('main', [{ path: '.env', content: CONTENT_A, blobTag: 111 }], 12);
    const second = commitFor('main', [{ path: '.env', content: CONTENT_B, blobTag: 112 }], 13, [first.logicalId]);
    const snapshots: PlanSnapshots = {
      baselines: new Map(),
      locals: new Map(),
      heads: [first, second],
    };
    expect(() => planSync(snapshots, { direction: 'push', branch: 'main' })).toThrowError(SecretSyncError);
    expect(() => requireSingleBranchHead([first, second], 'main')).toThrowError(/multiple heads/);
  });

  it('never turns a transport error into an empty tree', () => {
    const failure = new SecretSyncError('auth', 'Connect denied the list request.');
    const snapshots: PlanSnapshots = {
      baselines: new Map(),
      locals: new Map(),
      heads: [],
      remoteError: failure,
    };
    let caught: unknown;
    try {
      planSync(snapshots, { direction: 'pull', branch: 'main' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
  });

  it('propagates permission errors from snapshot slots', () => {
    const head = commitFor('main', [], 14);
    const snapshots: PlanSnapshots = {
      baselines: new Map(),
      locals: new Map<string, LocalSlot>([['.env', { state: 'error', code: 'auth', message: 'Denied.' }]]),
      heads: [head],
    };
    expect(() => planSync(snapshots, { direction: 'push', branch: 'main' })).toThrowError(SecretSyncError);
  });

  it('leaves selection-limited baselines intact when selection changes', () => {
    const head = commitFor(
      'main',
      [
        { path: '.env', content: CONTENT_A, blobTag: 121 },
        { path: 'other.env', content: CONTENT_A, blobTag: 122 },
      ],
      15,
    );
    const snapshots: PlanSnapshots = {
      baselines: new Map<string, BaselineSlot>([
        ['.env', baselinePresent(CONTENT_A, 121)],
        ['other.env', baselinePresent(CONTENT_A, 122)],
      ]),
      locals: new Map<string, LocalSlot>([
        ['.env', localPresent(CONTENT_B)],
        ['other.env', localPresent(CONTENT_B)],
      ]),
      heads: [head],
    };
    const plan = planSync(snapshots, { direction: 'push', branch: 'main', selection: ['.env'] });
    expect(plan.selected).toEqual(['.env']);
    expect(plan.actions.map((action) => action.path)).toEqual(['.env']);
    expect(plan.outOfSelectionPreserved).toEqual(['other.env']);
  });
});

describe('dry runs', () => {
  it('never invokes write lock or state methods', () => {
    const head = commitFor('main', [{ path: '.env', content: CONTENT_A, blobTag: 131 }], 16);
    const snapshots = (): PlanSnapshots => ({
      baselines: new Map<string, BaselineSlot>([['.env', baselinePresent(CONTENT_A, 131)]]),
      locals: new Map<string, LocalSlot>([['.env', localPresent(CONTENT_B)]]),
      heads: [head],
    });
    const dryEffects = createEffectsRecorder();
    const dryPlan = planSync(snapshots(), { direction: 'push', branch: 'main', dryRun: true }, dryEffects);
    expect(dryPlan.dryRun).toBe(true);
    expect(dryPlan.actions).toHaveLength(1);
    expect(dryEffects.calls).toEqual([]);
    const wetEffects = createEffectsRecorder();
    planSync(snapshots(), { direction: 'push', branch: 'main' }, wetEffects);
    expect(wetEffects.calls).toEqual([]);
  });

  it('keeps planned results free of plaintext bytes', () => {
    const head = commitFor('main', [{ path: '.env', content: CONTENT_A, blobTag: 141 }], 17);
    const snapshots: PlanSnapshots = {
      baselines: new Map(),
      locals: new Map(),
      heads: [head],
    };
    const plan = planSync(snapshots, { direction: 'pull', branch: 'main', dryRun: true });
    const serialized = JSON.stringify(plan);
    expect(serialized).not.toContain(CONTENT_A);
    expect(serialized).not.toContain(CONTENT_B);
    expect(serialized).toContain(testUuid(141));
  });
});
