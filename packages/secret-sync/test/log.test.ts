import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SecretSyncError } from '../src/errors';
import { publishSnapshot } from '../src/history-store';
import { logFileHistory } from '../src/log';
import { pushSecrets } from '../src/push';
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
  return `aaaaaaaa-aaaa-4aaa-8aaa-${tail}`;
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
  const dir = await mkdtemp(join(tmpdir(), 'secsync-log-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeBytes(dir: string, rel: string, bytes: Uint8Array): Promise<void> {
  await writeFile(join(dir, ...rel.split('/')), Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

function logOptions(store: SecretStore, extra: Record<string, unknown> = {}) {
  return {
    store,
    projectId: PROJECT_ID,
    branch: 'main',
    path: '.env',
    ...extra,
  };
}

describe('per-file history with deletion events', () => {
  it('lists added, modified, and deleted revisions with stable fork info', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      const base = {
        store,
        rootAbsolute: dir,
        projectId: PROJECT_ID,
        branch: 'main',
        endpoint: ENDPOINT,
        vaultId: VAULT,
      };
      await writeBytes(dir, '.env', Buffer.from('v1-bytes', 'utf8'));
      const first = await pushSecrets({ ...base, message: 'add env' });
      expect(first.published).toBe(true);
      await writeBytes(dir, '.env', Buffer.from('v2-bytes', 'utf8'));
      await writeBytes(dir, 'other.env', Buffer.from('other-bytes', 'utf8'));
      const second = await pushSecrets({ ...base, message: 'rotate env' });
      expect(second.published).toBe(true);
      await rm(join(dir, '.env'));
      const third = await pushSecrets({ ...base, allowDelete: true, message: 'drop env' });
      expect(third.published).toBe(true);

      const result = await logFileHistory(logOptions(store));
      expect(result.branch).toBe('main');
      expect(result.heads).toHaveLength(1);
      expect(result.diverged).toBe(false);
      expect(result.total).toBe(3);
      expect(result.truncated).toBe(false);
      expect(result.entries).toHaveLength(3);
      const [deleted, modified, added] = result.entries as [
        { deleted: boolean; blobId?: string; message?: string; parents: string[]; isHead: boolean; commitId: string },
        { deleted: boolean; blobId?: string; message?: string; parents: string[]; isHead: boolean; commitId: string },
        { deleted: boolean; blobId?: string; message?: string; parents: string[]; isHead: boolean; commitId: string },
      ];
      expect(deleted.deleted).toBe(true);
      expect(deleted.blobId).toBeUndefined();
      expect(deleted.message).toBe('drop env');
      expect(deleted.isHead).toBe(true);
      expect(modified.deleted).toBe(false);
      expect(modified.message).toBe('rotate env');
      expect(modified.blobId).toBeDefined();
      expect(modified.isHead).toBe(false);
      expect(added.deleted).toBe(false);
      expect(added.message).toBe('add env');
      expect(added.parents).toEqual([]);
      expect(added.isHead).toBe(false);
      expect(modified.parents).toEqual([added.commitId]);
      expect(deleted.parents).toEqual([modified.commitId]);

      const other = await logFileHistory(logOptions(store, { path: 'other.env' }));
      expect(other.total).toBe(1);
      expect(other.entries[0]?.deleted).toBe(false);

      const again = await logFileHistory(logOptions(store));
      expect(JSON.stringify(again)).toBe(JSON.stringify(result));
    });
  });
});

describe('log pagination', () => {
  it('applies the limit with a truncation flag', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      const base = {
        store,
        rootAbsolute: dir,
        projectId: PROJECT_ID,
        branch: 'main',
        endpoint: ENDPOINT,
        vaultId: VAULT,
      };
      await writeBytes(dir, '.env', Buffer.from('v1', 'utf8'));
      await pushSecrets(base);
      await writeBytes(dir, '.env', Buffer.from('v2', 'utf8'));
      await pushSecrets(base);
      await writeBytes(dir, '.env', Buffer.from('v3', 'utf8'));
      await pushSecrets(base);
      const limited = await logFileHistory(logOptions(store, { limit: 2 }));
      expect(limited.total).toBe(3);
      expect(limited.entries).toHaveLength(2);
      expect(limited.truncated).toBe(true);
      expect(limited.limit).toBe(2);
      const full = await logFileHistory(logOptions(store, { limit: 10 }));
      expect(full.entries).toHaveLength(3);
      expect(full.truncated).toBe(false);
      await expect(logFileHistory(logOptions(store, { limit: 0 }))).rejects.toMatchObject({ code: 'validation' });
    });
  });
});

describe('log over forks and empty branches', () => {
  it('reports heads without picking a winner', async () => {
    const store = new ImmediateFakeStore();
    await publishSnapshot(store, {
      projectId: PROJECT_ID,
      branch: 'main',
      parents: [],
      files: [{ path: 'x.env', bytes: Buffer.from('fork-a', 'utf8') }],
      timestamp: 100,
      operationId: testUuid(11),
      operationKind: 'push',
      commitId: testUuid(12),
    });
    await publishSnapshot(store, {
      projectId: PROJECT_ID,
      branch: 'main',
      parents: [],
      files: [{ path: 'y.env', bytes: Buffer.from('fork-b', 'utf8') }],
      timestamp: 200,
      operationId: testUuid(13),
      operationKind: 'push',
      commitId: testUuid(14),
    });
    const result = await logFileHistory(logOptions(store, { path: 'x.env' }));
    expect(result.diverged).toBe(true);
    expect(result.heads).toEqual([testUuid(12), testUuid(14)].sort());
    expect(result.total).toBe(1);
    expect(result.entries[0]?.commitId).toBe(testUuid(12));
    expect(result.entries[0]?.isHead).toBe(true);
    const missing = await logFileHistory(logOptions(store, { path: 'absent.env' }));
    expect(missing.total).toBe(0);
    expect(missing.entries).toEqual([]);
  });

  it('returns an empty history for a branch with no commits', async () => {
    const store = new ImmediateFakeStore();
    const result = await logFileHistory(logOptions(store));
    expect(result.heads).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.truncated).toBe(false);
  });
});
