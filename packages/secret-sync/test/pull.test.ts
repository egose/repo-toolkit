import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SecretSyncError } from '../src/errors';
import { loadJournal } from '../src/journal';
import { pushSecrets } from '../src/push';
import { pullSecrets } from '../src/pull';
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

class CountingFakeStore implements SecretStore {
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
  const dir = await mkdtemp(join(tmpdir(), 'secsync-pull-'));
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

function identity() {
  return { endpoint: ENDPOINT, vaultId: VAULT, projectId: PROJECT_ID };
}

function pullOptions(store: SecretStore, dir: string, extra: Record<string, unknown> = {}) {
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

describe('fresh-clone pull', () => {
  it('materializes empty, binary, and CRLF files with exact bytes', async () => {
    await withTempDir(async (cloneA) => {
      await withTempDir(async (cloneB) => {
        const store = new CountingFakeStore();
        const empty = new Uint8Array(0);
        const binary = new Uint8Array(256);
        for (let index = 0; index < 256; index += 1) {
          binary[index] = 255 - index;
        }
        const crlf = Buffer.from('alpha\r\nbeta\r\ngamma\r\n', 'utf8');
        await writeBytes(cloneA, '.env', empty);
        await writeBytes(cloneA, 'data.bin', binary);
        await writeBytes(cloneA, 'lines.txt', crlf);
        const pushed = await pushSecrets({
          store,
          rootAbsolute: cloneA,
          projectId: PROJECT_ID,
          branch: 'main',
          endpoint: ENDPOINT,
          vaultId: VAULT,
        });
        expect(pushed.published).toBe(true);
        const pulled = await pullSecrets(pullOptions(store, cloneB));
        expect(pulled.noop).toBe(false);
        expect(pulled.downloaded).toEqual(['.env', 'data.bin', 'lines.txt']);
        expect(pulled.stateSaved).toBe(true);
        expect(Buffer.from(await readBytes(cloneB, '.env')).equals(Buffer.from(empty))).toBe(true);
        expect(Buffer.from(await readBytes(cloneB, 'data.bin')).equals(Buffer.from(binary))).toBe(true);
        expect(Buffer.from(await readBytes(cloneB, 'lines.txt')).equals(Buffer.from(crlf))).toBe(true);
      });
    });
  });
});

describe('partial pull', () => {
  it('preserves local-only changes and unrelated baselines', async () => {
    await withTempDir(async (cloneA) => {
      await withTempDir(async (cloneB) => {
        const store = new CountingFakeStore();
        await writeBytes(cloneA, 'shared.env', Buffer.from('shared-v1', 'utf8'));
        await writeBytes(cloneA, 'other.env', Buffer.from('other-v1', 'utf8'));
        await pushSecrets({
          store,
          rootAbsolute: cloneA,
          projectId: PROJECT_ID,
          branch: 'main',
          endpoint: ENDPOINT,
          vaultId: VAULT,
        });
        const initial = await pullSecrets(pullOptions(store, cloneB));
        expect(initial.downloaded).toEqual(['other.env', 'shared.env']);
        await writeBytes(cloneA, 'shared.env', Buffer.from('shared-v2', 'utf8'));
        await pushSecrets({
          store,
          rootAbsolute: cloneA,
          projectId: PROJECT_ID,
          branch: 'main',
          endpoint: ENDPOINT,
          vaultId: VAULT,
        });
        await writeBytes(cloneB, 'other.env', Buffer.from('other-local-edit', 'utf8'));
        const stateBefore = await loadState(cloneB, identity());
        const otherBefore = JSON.stringify(getBaseline(stateBefore, 'other.env'));
        const partial = await pullSecrets(pullOptions(store, cloneB, { selection: ['shared.env'] }));
        expect(partial.downloaded).toEqual(['shared.env']);
        expect(Buffer.from(await readBytes(cloneB, 'shared.env')).toString('utf8')).toBe('shared-v2');
        expect(Buffer.from(await readBytes(cloneB, 'other.env')).toString('utf8')).toBe('other-local-edit');
        const stateAfter = await loadState(cloneB, identity());
        expect(JSON.stringify(getBaseline(stateAfter, 'other.env'))).toBe(otherBefore);
      });
    });
  });
});

describe('pull deletions', () => {
  it('requires the explicit delete flag before materializing tombstones', async () => {
    await withTempDir(async (cloneA) => {
      await withTempDir(async (cloneB) => {
        const store = new CountingFakeStore();
        await writeBytes(cloneA, '.env', Buffer.from('tombstone-target', 'utf8'));
        await pushSecrets({
          store,
          rootAbsolute: cloneA,
          projectId: PROJECT_ID,
          branch: 'main',
          endpoint: ENDPOINT,
          vaultId: VAULT,
        });
        await pullSecrets(pullOptions(store, cloneB));
        await rm(join(cloneA, '.env'));
        await pushSecrets({
          store,
          rootAbsolute: cloneA,
          projectId: PROJECT_ID,
          branch: 'main',
          endpoint: ENDPOINT,
          vaultId: VAULT,
          allowDelete: true,
        });
        const pending = await pullSecrets(pullOptions(store, cloneB));
        expect(pending.noop).toBe(true);
        expect(pending.pendingDeletions).toEqual([
          { path: '.env', requiredFlag: '--delete', current: 'remote-deleted' },
        ]);
        expect(Buffer.from(await readBytes(cloneB, '.env')).toString('utf8')).toBe('tombstone-target');
        const authorized = await pullSecrets(pullOptions(store, cloneB, { allowDelete: true }));
        expect(authorized.removedLocal).toEqual(['.env']);
        await expect(readBytes(cloneB, '.env')).rejects.toThrow();
        const state = await loadState(cloneB, identity());
        expect(getBaseline(state, '.env')).toEqual({ state: 'absent' });
      });
    });
  });
});

describe('pull concurrency guards', () => {
  it('refuses to overwrite an unexpected concurrent local edit', async () => {
    await withTempDir(async (cloneA) => {
      await withTempDir(async (cloneB) => {
        const store = new CountingFakeStore();
        await writeBytes(cloneA, '.env', Buffer.from('remote-v1', 'utf8'));
        await pushSecrets({
          store,
          rootAbsolute: cloneA,
          projectId: PROJECT_ID,
          branch: 'main',
          endpoint: ENDPOINT,
          vaultId: VAULT,
        });
        await pullSecrets(pullOptions(store, cloneB));
        await writeBytes(cloneA, '.env', Buffer.from('remote-v2', 'utf8'));
        await pushSecrets({
          store,
          rootAbsolute: cloneA,
          projectId: PROJECT_ID,
          branch: 'main',
          endpoint: ENDPOINT,
          vaultId: VAULT,
        });
        await expect(
          pullSecrets(
            pullOptions(store, cloneB, {
              hooks: {
                beforeFile: async (path: string) => {
                  if (path === '.env') {
                    await writeBytes(cloneB, '.env', Buffer.from('concurrent-edit', 'utf8'));
                  }
                },
              },
            }),
          ),
        ).rejects.toMatchObject({ code: 'local-changed' });
        expect(Buffer.from(await readBytes(cloneB, '.env')).toString('utf8')).toBe('concurrent-edit');
      });
    });
  });
});

describe('interrupted pull', () => {
  it('resumes journaled writes without treating them as unrelated edits', async () => {
    await withTempDir(async (cloneA) => {
      await withTempDir(async (cloneB) => {
        const store = new CountingFakeStore();
        await writeBytes(cloneA, 'a.env', Buffer.from('content-a', 'utf8'));
        await writeBytes(cloneA, 'b.env', Buffer.from('content-b', 'utf8'));
        await writeBytes(cloneA, 'c.env', Buffer.from('content-c', 'utf8'));
        await pushSecrets({
          store,
          rootAbsolute: cloneA,
          projectId: PROJECT_ID,
          branch: 'main',
          endpoint: ENDPOINT,
          vaultId: VAULT,
        });
        await expect(
          pullSecrets(
            pullOptions(store, cloneB, {
              hooks: {
                beforeFile: async (path: string) => {
                  if (path === 'b.env') {
                    throw new Error('Simulated pull interruption.');
                  }
                },
              },
            }),
          ),
        ).rejects.toThrow('Simulated pull interruption.');
        expect(Buffer.from(await readBytes(cloneB, 'a.env')).toString('utf8')).toBe('content-a');
        const journal = await loadJournal(cloneB);
        expect(journal.length).toBeGreaterThan(0);
        const resumed = await pullSecrets(pullOptions(store, cloneB));
        expect(resumed.resumedFromJournal).toBe(true);
        expect(resumed.downloaded).toEqual(['b.env', 'c.env']);
        expect(Buffer.from(await readBytes(cloneB, 'a.env')).toString('utf8')).toBe('content-a');
        expect(Buffer.from(await readBytes(cloneB, 'b.env')).toString('utf8')).toBe('content-b');
        expect(Buffer.from(await readBytes(cloneB, 'c.env')).toString('utf8')).toBe('content-c');
        expect(await loadJournal(cloneB)).toEqual([]);
        const state = await loadState(cloneB, identity());
        expect(getBaseline(state, 'a.env')).toMatchObject({ state: 'present' });
        expect(getBaseline(state, 'b.env')).toMatchObject({ state: 'present' });
        expect(getBaseline(state, 'c.env')).toMatchObject({ state: 'present' });
      });
    });
  });
});

describe('pull result metadata', () => {
  it('avoids global durability claims and exposes no secret bytes', async () => {
    await withTempDir(async (cloneA) => {
      await withTempDir(async (cloneB) => {
        const store = new CountingFakeStore();
        const canary = 'pull-canary-bytes-4m8q-secret';
        await writeBytes(cloneA, '.env', Buffer.from(canary, 'utf8'));
        await pushSecrets({
          store,
          rootAbsolute: cloneA,
          projectId: PROJECT_ID,
          branch: 'main',
          endpoint: ENDPOINT,
          vaultId: VAULT,
        });
        const pulled = await pullSecrets(pullOptions(store, cloneB));
        expect(pulled.note).toContain('configured root');
        expect(pulled.note).not.toMatch(/globally durable|every server has/i);
        expect(JSON.stringify(pulled)).not.toContain(canary);
      });
    });
  });
});
