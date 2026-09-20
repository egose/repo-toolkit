import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SecretSyncError } from '../src/errors';
import { publishSnapshot } from '../src/history-store';
import { resolveFork } from '../src/resolve';
import { restoreFile } from '../src/restore';
import type {
  ConnectItemDetail,
  ConnectItemSummary,
  CreateConnectItemInput,
  CreateItemResult,
  SecretStore,
} from '../src/store';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const ENDPOINT = 'https://connect.example';
const VAULT = 'vault-1';

function testUuid(tag: number): string {
  const tail = tag.toString(16).padStart(12, '0');
  return `dddddddd-dddd-4ddd-8ddd-${tail}`;
}

class ImmediateFakeStore implements SecretStore {
  private counter = 0;
  private readonly visible = new Map<string, ConnectItemDetail>();

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
    return JSON.parse(JSON.stringify(hit)) as ConnectItemDetail;
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
    this.visible.set(id, detail);
    return { status: 'created', item: JSON.parse(JSON.stringify(detail)) as ConnectItemDetail };
  }
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'secsync-resolve-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const COMMIT_A = testUuid(101);
const COMMIT_B = testUuid(102);

async function seedFork(store: ImmediateFakeStore): Promise<{ blobA: string; blobB: string }> {
  const snapshotA = await publishSnapshot(store, {
    projectId: PROJECT_ID,
    branch: 'main',
    parents: [],
    files: [{ path: 'a.env', bytes: Buffer.from('fork-a-bytes', 'utf8') }],
    timestamp: 100,
    operationId: testUuid(103),
    operationKind: 'push',
    commitId: COMMIT_A,
  });
  const snapshotB = await publishSnapshot(store, {
    projectId: PROJECT_ID,
    branch: 'main',
    parents: [],
    files: [{ path: 'b.env', bytes: Buffer.from('fork-b-bytes', 'utf8') }],
    timestamp: 200,
    operationId: testUuid(104),
    operationKind: 'push',
    commitId: COMMIT_B,
  });
  const blobA = [...snapshotA.blobs.values()][0] as { logicalId: string };
  const blobB = [...snapshotB.blobs.values()][0] as { logicalId: string };
  return { blobA: blobA.logicalId, blobB: blobB.logicalId };
}

function resolveBase(store: ImmediateFakeStore, dir: string, extra: Record<string, unknown> = {}) {
  return {
    store,
    rootAbsolute: dir,
    projectId: PROJECT_ID,
    branch: 'main',
    ...extra,
  };
}

describe('explicit fork join', () => {
  it('joins every observed head with the chosen full snapshot', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await seedFork(store);
      const result = await resolveFork(
        resolveBase(store, dir, {
          heads: [COMMIT_A, COMMIT_B],
          take: COMMIT_A,
          commitId: testUuid(105),
          operationId: testUuid(106),
        }),
      );
      expect(result.published).toBe(true);
      expect(result.commitId).toBe(testUuid(105));
      expect(result.parents).toEqual([COMMIT_A, COMMIT_B].sort());
      expect(result.headsBefore).toEqual([COMMIT_A, COMMIT_B].sort());
      expect(result.headsAfter).toEqual([testUuid(105)]);
      expect(result.divergedAfter).toBe(false);
      expect(result.commitVisible).toBe(true);
      expect(result.take).toBe(COMMIT_A);
    });
  });

  it('rejects a changed head set instead of joining stale heads', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await seedFork(store);
      await publishSnapshot(store, {
        projectId: PROJECT_ID,
        branch: 'main',
        parents: [COMMIT_A],
        files: [{ path: 'a.env', bytes: Buffer.from('fork-a-bytes', 'utf8') }],
        timestamp: 300,
        operationId: testUuid(107),
        operationKind: 'push',
        commitId: testUuid(108),
      });
      await expect(
        resolveFork(resolveBase(store, dir, { heads: [COMMIT_A, COMMIT_B], take: COMMIT_A })),
      ).rejects.toMatchObject({ code: 'remote-diverged' });
    });
  });

  it('keeps the losing fork restorable after the join', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      const seeded = await seedFork(store);
      const joined = await resolveFork(
        resolveBase(store, dir, {
          heads: [COMMIT_A, COMMIT_B],
          take: COMMIT_A,
          commitId: testUuid(109),
          operationId: testUuid(110),
        }),
      );
      expect(joined.headsAfter).toEqual([testUuid(109)]);
      const restored = await restoreFile({
        store,
        rootAbsolute: dir,
        projectId: PROJECT_ID,
        branch: 'main',
        path: 'b.env',
        revision: seeded.blobB,
        endpoint: ENDPOINT,
        vaultId: VAULT,
      });
      expect(restored.blobId).toBe(seeded.blobB);
      expect(restored.noop).toBe(false);
      const data = await readFile(join(dir, 'b.env'));
      expect(data.toString('utf8')).toBe('fork-b-bytes');
    });
  });
});
