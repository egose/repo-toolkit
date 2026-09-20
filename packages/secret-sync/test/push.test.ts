import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SecretSyncError } from '../src/errors';
import { deriveBranchHeads } from '../src/graph';
import { loadValidatedHistory } from '../src/history-store';
import { loadBranchHistory, observeHeadsAfter } from '../src/operations';
import { pullSecrets } from '../src/pull';
import { pushSecrets } from '../src/push';
import { getBaseline, loadState } from '../src/state';
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
  return `77777777-7777-4777-8777-${tail}`;
}

class CountingFakeStore implements SecretStore {
  private counter = 0;
  private readonly visible = new Map<string, ConnectItemDetail>();
  private readonly pending = new Map<string, ConnectItemDetail>();
  delayed: boolean;
  private uncertainRemaining: number;
  private failCreatesRemaining: number;
  readonly counts = { lists: 0, gets: 0, creates: 0 };

  constructor(options: { delayed?: boolean; uncertainNext?: number; failCreates?: number } = {}) {
    this.delayed = options.delayed ?? false;
    this.uncertainRemaining = options.uncertainNext ?? 0;
    this.failCreatesRemaining = options.failCreates ?? 0;
  }

  flush(): void {
    for (const [id, detail] of this.pending) {
      this.visible.set(id, detail);
    }
    this.pending.clear();
  }

  async listItems(): Promise<ConnectItemSummary[]> {
    this.counts.lists += 1;
    return [...this.visible.values()].map((detail) => ({
      id: detail.id,
      title: detail.title,
      tags: [...detail.tags],
      category: detail.category,
    }));
  }

  async getItem(id: string): Promise<ConnectItemDetail> {
    this.counts.gets += 1;
    const hit = this.visible.get(id);
    if (hit === undefined) {
      throw new SecretSyncError('not-found', 'Fake item is not visible.');
    }
    return JSON.parse(JSON.stringify(hit)) as ConnectItemDetail;
  }

  async createItem(input: CreateConnectItemInput): Promise<CreateItemResult> {
    this.counts.creates += 1;
    if (this.failCreatesRemaining > 0) {
      this.failCreatesRemaining -= 1;
      throw new SecretSyncError('network', 'Fake create interrupted.');
    }
    this.counter += 1;
    const id = `provider-${this.counter}`;
    const detail: ConnectItemDetail = {
      id,
      title: input.title,
      tags: [...input.tags],
      category: input.category,
      fields: input.fields.map((field) => ({ ...field })),
    };
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
    return { status: 'created', item: JSON.parse(JSON.stringify(detail)) as ConnectItemDetail };
  }
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'secsync-push-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeBytes(dir: string, rel: string, bytes: Uint8Array): Promise<void> {
  await writeFile(join(dir, ...rel.split('/')), Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

async function readBytes(dir: string, rel: string): Promise<Uint8Array> {
  const data = await readFile(join(dir, ...rel.split('/')));
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function pushOptions(store: SecretStore, dir: string, extra: Record<string, unknown> = {}) {
  return {
    store,
    rootAbsolute: dir,
    projectId: PROJECT_ID,
    branch: 'main',
    endpoint: ENDPOINT,
    vaultId: VAULT,
    ...extra,
  };
}

describe('two-clone round trip', () => {
  it('pushes and pulls empty, binary, and CRLF files with exact bytes', async () => {
    await withTempDir(async (cloneA) => {
      await withTempDir(async (cloneB) => {
        const store = new CountingFakeStore();
        const empty = new Uint8Array(0);
        const binary = new Uint8Array(256);
        for (let index = 0; index < 256; index += 1) {
          binary[index] = index;
        }
        const crlf = Buffer.from('line-one\r\nline-two\r\nline-three\r\n', 'utf8');
        await writeBytes(cloneA, '.env', empty);
        await writeBytes(cloneA, 'data.bin', binary);
        await writeBytes(cloneA, 'lines.txt', crlf);
        const pushed = await pushSecrets(pushOptions(store, cloneA));
        expect(pushed.published).toBe(true);
        expect(pushed.uploaded).toEqual(['.env', 'data.bin', 'lines.txt']);
        expect(pushed.localRecoveryOk).toBe(true);
        const pulled = await pullSecrets({
          store,
          rootAbsolute: cloneB,
          projectId: PROJECT_ID,
          branch: 'main',
          endpoint: ENDPOINT,
          vaultId: VAULT,
        });
        expect(pulled.downloaded).toEqual(['.env', 'data.bin', 'lines.txt']);
        expect(Buffer.from(await readBytes(cloneB, '.env')).equals(Buffer.from(empty))).toBe(true);
        expect(Buffer.from(await readBytes(cloneB, 'data.bin')).equals(Buffer.from(binary))).toBe(true);
        expect(Buffer.from(await readBytes(cloneB, 'lines.txt')).equals(Buffer.from(crlf))).toBe(true);
        const stateB = await loadState(cloneB, { endpoint: ENDPOINT, vaultId: VAULT, projectId: PROJECT_ID });
        expect(getBaseline(stateB, '.env')).toMatchObject({ state: 'present' });
        expect(getBaseline(stateB, 'data.bin')).toMatchObject({ state: 'present' });
        expect(getBaseline(stateB, 'lines.txt')).toMatchObject({ state: 'present' });
      });
    });
  });
});

describe('bounded requests and blob reuse', () => {
  it('records request counts for one-file and no-op pushes', async () => {
    await withTempDir(async (dir) => {
      const store = new CountingFakeStore();
      await writeBytes(dir, '.env', Buffer.from('one-file-bytes', 'utf8'));
      const before = { ...store.counts };
      const first = await pushSecrets(pushOptions(store, dir));
      expect(first.published).toBe(true);
      const firstDelta = {
        lists: store.counts.lists - before.lists,
        gets: store.counts.gets - before.gets,
        creates: store.counts.creates - before.creates,
      };
      expect(firstDelta.creates).toBe(2);
      expect(firstDelta.lists).toBe(3);
      expect(firstDelta.gets).toBe(3);
      const middle = { ...store.counts };
      const second = await pushSecrets(pushOptions(store, dir));
      expect(second.noop).toBe(true);
      expect(second.published).toBe(false);
      expect(second.commitId).toBeUndefined();
      expect(store.counts.creates - middle.creates).toBe(0);
      expect(store.counts.lists - middle.lists).toBe(1);
      expect(store.counts.gets - middle.gets).toBe(2);
      const history = await loadValidatedHistory(store, PROJECT_ID);
      expect(history.commits.size).toBe(1);
      expect(history.blobs.size).toBe(1);
    });
  });
});

describe('partial push', () => {
  it('leaves unrelated baselines and remote entries untouched', async () => {
    await withTempDir(async (dir) => {
      const store = new CountingFakeStore();
      await writeBytes(dir, '.env', Buffer.from('first-content', 'utf8'));
      await writeBytes(dir, 'other.env', Buffer.from('other-content', 'utf8'));
      const first = await pushSecrets(pushOptions(store, dir));
      expect(first.published).toBe(true);
      const stateBefore = await loadState(dir, { endpoint: ENDPOINT, vaultId: VAULT, projectId: PROJECT_ID });
      const otherBefore = JSON.stringify(getBaseline(stateBefore, 'other.env'));
      await writeBytes(dir, '.env', Buffer.from('second-content', 'utf8'));
      const partial = await pushSecrets(pushOptions(store, dir, { selection: ['.env'] }));
      expect(partial.uploaded).toEqual(['.env']);
      expect(partial.outOfSelectionPreserved).toEqual(['other.env']);
      const stateAfter = await loadState(dir, { endpoint: ENDPOINT, vaultId: VAULT, projectId: PROJECT_ID });
      expect(JSON.stringify(getBaseline(stateAfter, 'other.env'))).toBe(otherBefore);
      const history = await loadValidatedHistory(store, PROJECT_ID);
      expect(history.commits.size).toBe(2);
      const heads = deriveBranchHeads(history.commits, 'main');
      expect(heads).toHaveLength(1);
      const tree = (heads[0] as { tree: Array<{ path: string }> }).tree.map((entry) => entry.path).sort();
      expect(tree).toEqual(['.env', 'other.env']);
    });
  });
});

describe('push deletions', () => {
  it('requires the explicit delete flag before publishing removals', async () => {
    await withTempDir(async (dir) => {
      const store = new CountingFakeStore();
      await writeBytes(dir, '.env', Buffer.from('doomed-content', 'utf8'));
      await pushSecrets(pushOptions(store, dir));
      await rm(join(dir, '.env'));
      const pending = await pushSecrets(pushOptions(store, dir));
      expect(pending.noop).toBe(true);
      expect(pending.published).toBe(false);
      expect(pending.pendingDeletions).toEqual([{ path: '.env', requiredFlag: '--delete', current: 'local-deleted' }]);
      const before = await loadValidatedHistory(store, PROJECT_ID);
      expect(before.commits.size).toBe(1);
      const authorized = await pushSecrets(pushOptions(store, dir, { allowDelete: true }));
      expect(authorized.published).toBe(true);
      expect(authorized.removedRemote).toEqual(['.env']);
      const after = await loadValidatedHistory(store, PROJECT_ID);
      expect(after.commits.size).toBe(2);
      const heads = deriveBranchHeads(after.commits, 'main');
      expect((heads[0] as { tree: unknown[] }).tree).toEqual([]);
    });
  });
});

describe('concurrent local edits', () => {
  it('refuses publication after an edit between scan and commit', async () => {
    await withTempDir(async (dir) => {
      const store = new CountingFakeStore();
      await writeBytes(dir, '.env', Buffer.from('stable-v1', 'utf8'));
      await pushSecrets(pushOptions(store, dir));
      await writeBytes(dir, '.env', Buffer.from('staged-v2', 'utf8'));
      await expect(
        pushSecrets(
          pushOptions(store, dir, {
            hooks: {
              beforePublish: async () => {
                await writeBytes(dir, '.env', Buffer.from('late-v3', 'utf8'));
              },
            },
          }),
        ),
      ).rejects.toMatchObject({ code: 'local-changed' });
      const history = await loadValidatedHistory(store, PROJECT_ID);
      expect(history.commits.size).toBe(1);
      const retry = await pushSecrets(pushOptions(store, dir));
      expect(retry.published).toBe(true);
      expect(retry.uploaded).toEqual(['.env']);
      const after = await loadValidatedHistory(store, PROJECT_ID);
      expect(after.commits.size).toBe(2);
    });
  });
});

describe('interrupted and uncertain writes', () => {
  it('keeps an interrupted blob upload out of visible history', async () => {
    await withTempDir(async (dir) => {
      const store = new CountingFakeStore({ failCreates: 1 });
      await writeBytes(dir, '.env', Buffer.from('interrupted-bytes', 'utf8'));
      const operationId = testUuid(901);
      const blobId = testUuid(902);
      const commitId = testUuid(903);
      await expect(
        pushSecrets(pushOptions(store, dir, { operationId, blobIds: { '.env': blobId }, commitId })),
      ).rejects.toMatchObject({ code: 'network' });
      const history = await loadValidatedHistory(store, PROJECT_ID);
      expect(history.commits.size).toBe(0);
      const retry = await pushSecrets(pushOptions(store, dir, { operationId, blobIds: { '.env': blobId }, commitId }));
      expect(retry.published).toBe(true);
      expect(retry.commitId).toBe(commitId);
      const after = await loadValidatedHistory(store, PROJECT_ID);
      expect(after.commits.size).toBe(1);
      expect(after.blobs.size).toBe(1);
    });
  });

  it('reconciles a response-lost commit to one logical record', async () => {
    await withTempDir(async (dir) => {
      const store = new CountingFakeStore({ uncertainNext: 2 });
      await writeBytes(dir, '.env', Buffer.from('uncertain-bytes', 'utf8'));
      const result = await pushSecrets(pushOptions(store, dir, { operationId: testUuid(911) }));
      expect(result.published).toBe(true);
      expect(result.reconciled).toBe(true);
      const history = await loadValidatedHistory(store, PROJECT_ID);
      expect(history.commits.size).toBe(1);
      expect(history.blobs.size).toBe(1);
    });
  });
});

describe('late forks', () => {
  it('reports divergence without discarding either writer', async () => {
    await withTempDir(async (cloneA) => {
      await withTempDir(async (cloneB) => {
        const store = new CountingFakeStore({ delayed: true });
        await writeBytes(cloneA, 'a.env', Buffer.from('writer-a', 'utf8'));
        await writeBytes(cloneB, 'b.env', Buffer.from('writer-b', 'utf8'));
        const pushedA = await pushSecrets(pushOptions(store, cloneA));
        const pushedB = await pushSecrets(pushOptions(store, cloneB));
        expect(pushedA.published).toBe(true);
        expect(pushedB.published).toBe(true);
        expect(pushedA.commitVisible).toBe(false);
        store.flush();
        const observed = await observeHeadsAfter(store, PROJECT_ID, 'main');
        expect(observed.diverged).toBe(true);
        expect(observed.headIds).toHaveLength(2);
        const history = await loadValidatedHistory(store, PROJECT_ID);
        expect(history.commits.size).toBe(2);
        const reloaded = await loadBranchHistory(store, PROJECT_ID, 'main');
        expect(reloaded.headIds).toHaveLength(2);
      });
    });
  });
});

describe('result metadata', () => {
  it('avoids global durability claims and exposes no secret bytes', async () => {
    await withTempDir(async (dir) => {
      const store = new CountingFakeStore();
      const canary = 'push-canary-bytes-7q2x-secret';
      await writeBytes(dir, '.env', Buffer.from(canary, 'utf8'));
      const result = await pushSecrets(pushOptions(store, dir, { message: 'rotate' }));
      expect(result.note).toContain('configured endpoint');
      expect(result.note).not.toMatch(/globally durable|every server has/i);
      expect(JSON.stringify(result)).not.toContain(canary);
    });
  });
});
