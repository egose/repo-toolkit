import { describe, expect, it } from 'vitest';

import { SecretSyncError } from '../src/errors';
import { classifyBranchState, deriveBranchHeads } from '../src/graph';
import {
  findCommitsByOperationId,
  loadRawHistory,
  loadValidatedHistory,
  materializeTreeBytes,
  publishBlob,
  publishCommit,
  publishSnapshot,
  validateHistoryDependencies,
} from '../src/history-store';
import { createBlobRecord, createCommitRecord } from '../src/records';
import type {
  ConnectItemDetail,
  ConnectItemSummary,
  CreateConnectItemInput,
  CreateItemResult,
  SecretStore,
} from '../src/store';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';

function testUuid(tag: number): string {
  const tail = tag.toString(16).padStart(12, '0');
  return `33333333-3333-4333-8333-${tail}`;
}

function cloneDetail(detail: ConnectItemDetail): ConnectItemDetail {
  return JSON.parse(JSON.stringify(detail)) as ConnectItemDetail;
}

class FakeSecretStore implements SecretStore {
  private counter = 0;
  private readonly visible = new Map<string, ConnectItemDetail>();
  private readonly pending = new Map<string, ConnectItemDetail>();
  readonly createdOrder: string[] = [];
  delayed: boolean;
  private uncertainRemaining: number;

  constructor(options: { delayed?: boolean; uncertainNext?: number } = {}) {
    this.delayed = options.delayed ?? false;
    this.uncertainRemaining = options.uncertainNext ?? 0;
  }

  setUncertainNext(count: number): void {
    this.uncertainRemaining = count;
  }

  flush(): void {
    for (const [id, detail] of this.pending) {
      this.visible.set(id, detail);
    }
    this.pending.clear();
  }

  inject(detail: ConnectItemDetail): void {
    this.visible.set(detail.id, cloneDetail(detail));
  }

  visibleCount(): number {
    return this.visible.size;
  }

  async listItems(): Promise<ConnectItemSummary[]> {
    return [...this.visible.values()].map((detail) => ({
      id: detail.id,
      title: detail.title,
      tags: [...detail.tags],
      category: detail.category,
    }));
  }

  async getItem(id: string): Promise<ConnectItemDetail> {
    const hit = this.visible.get(id);
    if (hit === undefined) {
      throw new SecretSyncError('not-found', 'Fake item is not visible.');
    }
    return cloneDetail(hit);
  }

  async createItem(input: CreateConnectItemInput): Promise<CreateItemResult> {
    this.counter += 1;
    const id = `provider-${this.counter}`;
    const detail: ConnectItemDetail = {
      id,
      title: input.title,
      tags: [...input.tags],
      category: input.category,
      fields: input.fields.map((field) => ({ ...field })),
    };
    this.createdOrder.push(input.title);
    const uncertain = this.uncertainRemaining > 0;
    if (uncertain) {
      this.uncertainRemaining -= 1;
    }
    if (this.delayed) {
      this.pending.set(id, detail);
    } else {
      this.visible.set(id, detail);
    }
    if (uncertain) {
      return { status: 'uncertain', attempts: 1 };
    }
    return { status: 'created', item: cloneDetail(detail) };
  }
}

describe('publish ordering', () => {
  it('publishes blobs before the commit and refuses oversized files without a commit', async () => {
    const store = new FakeSecretStore();
    const result = await publishSnapshot(store, {
      projectId: PROJECT_ID,
      branch: 'main',
      parents: [],
      files: [
        { path: 'b.env', bytes: Buffer.from('b-bytes') },
        { path: 'a.env', bytes: Buffer.from('a-bytes') },
      ],
      timestamp: 1000,
      operationId: testUuid(1),
      operationKind: 'push',
      blobIds: { 'a.env': testUuid(2), 'b.env': testUuid(3) },
      commitId: testUuid(4),
    });
    expect(result.commit.tree.map((entry) => entry.path)).toEqual(['a.env', 'b.env']);
    expect(store.createdOrder).toHaveLength(3);
    const kinds = store.createdOrder.map((title) => title.split(' ')[2]);
    expect(kinds).toEqual(['blob', 'blob', 'commit']);
    await expect(
      publishSnapshot(store, {
        projectId: PROJECT_ID,
        branch: 'main',
        parents: [],
        files: [{ path: 'big.env', bytes: Buffer.alloc(32769, 1) }],
        timestamp: 1001,
        operationId: testUuid(5),
        operationKind: 'push',
      }),
    ).rejects.toMatchObject({ code: 'too-large' });
    const history = await loadValidatedHistory(store, PROJECT_ID);
    expect(history.commits.size).toBe(1);
  });
});

describe('concurrent writers', () => {
  it('keeps simultaneous first pushes as divergent heads', async () => {
    const store = new FakeSecretStore();
    const first = await publishSnapshot(store, {
      projectId: PROJECT_ID,
      branch: 'main',
      parents: [],
      files: [{ path: '.env', bytes: Buffer.from('first-writer') }],
      timestamp: 2000,
      operationId: testUuid(11),
      operationKind: 'push',
      commitId: testUuid(12),
    });
    const second = await publishSnapshot(store, {
      projectId: PROJECT_ID,
      branch: 'main',
      parents: [],
      files: [{ path: '.env', bytes: Buffer.from('second-writer') }],
      timestamp: 9999,
      operationId: testUuid(13),
      operationKind: 'push',
      commitId: testUuid(14),
    });
    expect(first.commit.logicalId).not.toBe(second.commit.logicalId);
    const history = await loadValidatedHistory(store, PROJECT_ID);
    const heads = deriveBranchHeads(history.commits, 'main');
    expect(heads).toHaveLength(2);
    expect(() => validateHistoryDependencies(history, PROJECT_ID)).not.toThrow();
  });

  it('preserves divergent heads for two writers sharing one parent', async () => {
    const store = new FakeSecretStore();
    const root = await publishSnapshot(store, {
      projectId: PROJECT_ID,
      branch: 'main',
      parents: [],
      files: [{ path: '.env', bytes: Buffer.from('root') }],
      timestamp: 100,
      operationId: testUuid(21),
      operationKind: 'push',
      commitId: testUuid(22),
    });
    const left = await publishCommit(
      store,
      PROJECT_ID,
      {
        branch: 'main',
        parents: [root.commit.logicalId],
        tree: root.commit.tree,
        timestamp: 200,
        operationId: testUuid(23),
        operationKind: 'push',
      },
      { logicalId: testUuid(24) },
    );
    const right = await publishCommit(
      store,
      PROJECT_ID,
      {
        branch: 'main',
        parents: [root.commit.logicalId],
        tree: root.commit.tree,
        timestamp: 300,
        operationId: testUuid(25),
        operationKind: 'push',
      },
      { logicalId: testUuid(26) },
    );
    const history = await loadValidatedHistory(store, PROJECT_ID);
    const heads = deriveBranchHeads(history.commits, 'main')
      .map((entry) => entry.logicalId)
      .sort();
    expect(heads).toEqual([left.envelope.logicalId, right.envelope.logicalId].sort());
  });

  it('resolves a fork by joining every observed head without erasing ancestry', async () => {
    const store = new FakeSecretStore();
    const root = await publishSnapshot(store, {
      projectId: PROJECT_ID,
      branch: 'main',
      parents: [],
      files: [{ path: '.env', bytes: Buffer.from('root') }],
      timestamp: 10,
      operationId: testUuid(31),
      operationKind: 'push',
      commitId: testUuid(32),
    });
    const left = await publishCommit(
      store,
      PROJECT_ID,
      {
        branch: 'main',
        parents: [root.commit.logicalId],
        tree: root.commit.tree,
        timestamp: 20,
        operationId: testUuid(33),
        operationKind: 'push',
      },
      { logicalId: testUuid(34) },
    );
    const right = await publishCommit(
      store,
      PROJECT_ID,
      {
        branch: 'main',
        parents: [root.commit.logicalId],
        tree: root.commit.tree,
        timestamp: 30,
        operationId: testUuid(35),
        operationKind: 'push',
      },
      { logicalId: testUuid(36) },
    );
    const before = await loadValidatedHistory(store, PROJECT_ID);
    expect(classifyBranchState(before.commits, 'main').status).toBe('diverged');
    const resolved = await publishCommit(
      store,
      PROJECT_ID,
      {
        branch: 'main',
        parents: [left.envelope.logicalId, right.envelope.logicalId],
        tree: left.envelope.tree,
        timestamp: 40,
        operationId: testUuid(37),
        operationKind: 'resolve',
      },
      { logicalId: testUuid(38) },
    );
    const after = await loadValidatedHistory(store, PROJECT_ID);
    expect(deriveBranchHeads(after.commits, 'main').map((entry) => entry.logicalId)).toEqual([
      resolved.envelope.logicalId,
    ]);
    const materialized = materializeTreeBytes(after, resolved.envelope.logicalId);
    expect([...materialized.keys()]).toEqual(['.env']);
  });
});

describe('branches', () => {
  it('keeps branch creation metadata-only with the source head unchanged', async () => {
    const store = new FakeSecretStore();
    const root = await publishSnapshot(store, {
      projectId: PROJECT_ID,
      branch: 'main',
      parents: [],
      files: [{ path: '.env', bytes: Buffer.from('v1') }],
      timestamp: 50,
      operationId: testUuid(41),
      operationKind: 'push',
      commitId: testUuid(42),
    });
    const before = await loadValidatedHistory(store, PROJECT_ID);
    const mainBefore = deriveBranchHeads(before.commits, 'main').map((entry) => entry.logicalId);
    const branched = await publishCommit(
      store,
      PROJECT_ID,
      {
        branch: 'feature/demo',
        parents: [root.commit.logicalId],
        tree: root.commit.tree,
        timestamp: 60,
        operationId: testUuid(43),
        operationKind: 'branch-create',
      },
      { logicalId: testUuid(44) },
    );
    expect(branched.envelope.tree).toEqual(root.commit.tree);
    const after = await loadValidatedHistory(store, PROJECT_ID);
    expect(deriveBranchHeads(after.commits, 'main').map((entry) => entry.logicalId)).toEqual(mainBefore);
    expect(deriveBranchHeads(after.commits, 'feature/demo').map((entry) => entry.logicalId)).toEqual([
      branched.envelope.logicalId,
    ]);
  });
});

describe('uncertain writes', () => {
  it('reconciles an accepted-but-unacknowledged commit to one logical record', async () => {
    const store = new FakeSecretStore({ uncertainNext: 1 });
    const published = await publishCommit(
      store,
      PROJECT_ID,
      {
        branch: 'main',
        parents: [],
        tree: [],
        timestamp: 70,
        operationId: testUuid(51),
        operationKind: 'push',
      },
      { logicalId: testUuid(52) },
    );
    expect(published.reconciled).toBe(true);
    const retry = await publishCommit(
      store,
      PROJECT_ID,
      {
        branch: 'main',
        parents: [],
        tree: [],
        timestamp: 70,
        operationId: testUuid(51),
        operationKind: 'push',
      },
      { logicalId: testUuid(52) },
    );
    expect(retry.envelope.logicalId).toBe(published.envelope.logicalId);
    const history = await loadValidatedHistory(store, PROJECT_ID);
    expect(history.commits.size).toBe(1);
    expect(findCommitsByOperationId(history, testUuid(51)).map((entry) => entry.logicalId)).toEqual([
      published.envelope.logicalId,
    ]);
  });

  it('retries the same operation after delayed visibility without forking logically', async () => {
    const store = new FakeSecretStore({ delayed: true, uncertainNext: 1 });
    await expect(
      publishCommit(
        store,
        PROJECT_ID,
        {
          branch: 'main',
          parents: [],
          tree: [],
          timestamp: 80,
          operationId: testUuid(61),
          operationKind: 'push',
        },
        { logicalId: testUuid(62) },
      ),
    ).rejects.toMatchObject({ code: 'uncertain-write' });
    store.flush();
    const retry = await publishCommit(
      store,
      PROJECT_ID,
      {
        branch: 'main',
        parents: [],
        tree: [],
        timestamp: 80,
        operationId: testUuid(61),
        operationKind: 'push',
      },
      { logicalId: testUuid(62) },
    );
    expect(retry.envelope.logicalId).toBe(testUuid(62));
    store.flush();
    const history = await loadValidatedHistory(store, PROJECT_ID);
    expect(history.commits.size).toBe(1);
  });

  it('collapses identical retried blobs to one logical blob', async () => {
    const store = new FakeSecretStore();
    const bytes = Buffer.from('retry-bytes');
    const first = await publishBlob(store, PROJECT_ID, bytes, { logicalId: testUuid(71) });
    const second = await publishBlob(store, PROJECT_ID, bytes, { logicalId: testUuid(71) });
    expect(second.envelope.logicalId).toBe(first.envelope.logicalId);
    const history = await loadRawHistory(store, PROJECT_ID);
    expect(history.blobs.size).toBe(1);
  });
});

describe('incomplete and corrupt remotes', () => {
  it('blocks materialization when blobs or parents are missing', async () => {
    const store = new FakeSecretStore();
    await publishCommit(
      store,
      PROJECT_ID,
      {
        branch: 'main',
        parents: [testUuid(999)],
        tree: [{ path: '.env', blobId: testUuid(998), sha256: 'a'.repeat(64), byteLength: 1 }],
        timestamp: 90,
        operationId: testUuid(81),
        operationKind: 'push',
      },
      { logicalId: testUuid(82) },
    );
    await expect(loadValidatedHistory(store, PROJECT_ID)).rejects.toMatchObject({ code: 'remote-incomplete' });
    const raw = await loadRawHistory(store, PROJECT_ID);
    expect(() => materializeTreeBytes(raw, testUuid(82))).toThrowError(
      expect.objectContaining({ code: 'remote-incomplete' }),
    );
  });

  it('rejects conflicting duplicate logical ids', async () => {
    const store = new FakeSecretStore();
    const first = createBlobRecord(PROJECT_ID, Buffer.from('alpha'), testUuid(91));
    const second = createBlobRecord(PROJECT_ID, Buffer.from('beta'), testUuid(91));
    const createdFirst = await store.createItem(first.input);
    const createdSecond = await store.createItem(second.input);
    expect(createdFirst.status).toBe('created');
    expect(createdSecond.status).toBe('created');
    await expect(loadRawHistory(store, PROJECT_ID)).rejects.toMatchObject({ code: 'remote-corrupt' });
  });

  it('rejects oversized scans at the 10000-record bound', async () => {
    const summaries: ConnectItemSummary[] = [];
    for (let index = 0; index < 10001; index += 1) {
      summaries.push({ id: `provider-${index}`, title: 'unrelated', tags: [] });
    }
    const stub: SecretStore = {
      listItems: async () => summaries,
      getItem: async () => {
        throw new SecretSyncError('not-found', 'Unreachable.');
      },
      createItem: async () => ({ status: 'uncertain' as const, attempts: 1 }),
    };
    await expect(loadRawHistory(stub, PROJECT_ID)).rejects.toMatchObject({ code: 'too-large' });
  });
});

describe('delayed visibility', () => {
  it('observes published snapshots only after the provider reveals them', async () => {
    const store = new FakeSecretStore({ delayed: true });
    const published = await publishSnapshot(store, {
      projectId: PROJECT_ID,
      branch: 'main',
      parents: [],
      files: [{ path: '.env', bytes: Buffer.from('delayed-bytes') }],
      timestamp: 110,
      operationId: testUuid(101),
      operationKind: 'push',
      commitId: testUuid(102),
    });
    expect(published.commit.logicalId).toBe(testUuid(102));
    const before = await loadRawHistory(store, PROJECT_ID);
    expect(before.commits.size).toBe(0);
    expect(classifyBranchState(before.commits, 'main').status).toBe('empty');
    store.flush();
    const after = await loadValidatedHistory(store, PROJECT_ID);
    expect(after.commits.size).toBe(1);
    const bytes = materializeTreeBytes(after, testUuid(102)).get('.env') as Uint8Array;
    expect(Buffer.from(bytes).toString()).toBe('delayed-bytes');
  });

  it('skips foreign projects without failing the load', async () => {
    const store = new FakeSecretStore();
    const foreign = createCommitRecord({
      projectId: 'b64208df-4a95-4516-b8c7-e00621a7820c',
      branch: 'main',
      parents: [],
      tree: [],
      timestamp: 1,
      operationId: testUuid(111),
      operationKind: 'push',
      logicalId: testUuid(112),
    });
    store.inject({
      id: 'provider-foreign',
      title: `repo-toolkit-secret-sync b64208df-4a95-4516-b8c7-e00621a7820c commit ${testUuid(112)}`,
      tags: ['repo-toolkit-secret-sync', 'b64208df-4a95-4516-b8c7-e00621a7820c', 'commit'],
      category: 'SECURE_NOTE',
      fields: [
        { type: 'STRING', label: 'notesPlain', value: '' },
        { type: 'CONCEALED', label: 'payload', value: foreign.serialized },
      ],
    });
    store.inject({
      id: 'provider-unrelated',
      title: 'Personal login',
      tags: ['personal'],
      category: 'LOGIN',
      fields: [{ type: 'STRING', label: 'username', value: 'someone' }],
    });
    await publishSnapshot(store, {
      projectId: PROJECT_ID,
      branch: 'main',
      parents: [],
      files: [{ path: '.env', bytes: Buffer.from('local') }],
      timestamp: 120,
      operationId: testUuid(113),
      operationKind: 'push',
      commitId: testUuid(114),
    });
    const history = await loadValidatedHistory(store, PROJECT_ID);
    expect(history.commits.size).toBe(1);
  });
});
