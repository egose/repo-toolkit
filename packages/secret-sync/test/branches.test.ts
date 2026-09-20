import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createBranch, listBranches, switchBranch } from '../src/branches';
import { SecretSyncError } from '../src/errors';
import { loadValidatedHistory } from '../src/history-store';
import { pushSecrets } from '../src/push';
import { loadState } from '../src/state';
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
  const dir = await mkdtemp(join(tmpdir(), 'secsync-branches-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeBytes(dir: string, rel: string, bytes: Uint8Array): Promise<void> {
  await writeFile(join(dir, ...rel.split('/')), Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

async function readText(dir: string, rel: string): Promise<string> {
  return (await readFile(join(dir, ...rel.split('/')))).toString('utf8');
}

function pushBase(store: SecretStore, dir: string, extra: Record<string, unknown> = {}) {
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

describe('branch creation', () => {
  it('creates metadata-only branches that leave the source head unchanged', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await writeBytes(dir, '.env', Buffer.from('branch-bytes', 'utf8'));
      const pushed = await pushSecrets(pushBase(store, dir));
      expect(pushed.published).toBe(true);
      const before = await loadValidatedHistory(store, PROJECT_ID);
      expect(before.blobs.size).toBe(1);
      const created = await createBranch({
        store,
        rootAbsolute: dir,
        projectId: PROJECT_ID,
        name: 'feature/demo',
        from: 'main',
      });
      expect(created.branch).toBe('feature/demo');
      expect(created.sourceBranch).toBe('main');
      expect(created.commitId).toBeDefined();
      expect(created.parents).toEqual([pushed.commitId as string]);
      const after = await loadValidatedHistory(store, PROJECT_ID);
      expect(after.blobs.size).toBe(1);
      expect(after.commits.size).toBe(2);
      const listed = await listBranches(store, PROJECT_ID);
      expect(listed.branches.map((entry) => entry.branch).sort()).toEqual(['feature/demo', 'main']);
      const main = listed.branches.find((entry) => entry.branch === 'main') as { heads: string[]; state: string };
      const feature = listed.branches.find((entry) => entry.branch === 'feature/demo') as {
        heads: string[];
        state: string;
      };
      expect(main.heads).toEqual([pushed.commitId as string]);
      expect(main.state).toBe('single');
      expect(feature.heads).toEqual([created.commitId as string]);
      const featureCommit = after.commits.get(created.commitId as string);
      const sourceCommit = after.commits.get(pushed.commitId as string);
      expect(featureCommit?.tree).toEqual(sourceCommit?.tree);
      await expect(
        createBranch({ store, rootAbsolute: dir, projectId: PROJECT_ID, name: 'feature/demo', from: 'main' }),
      ).rejects.toMatchObject({ code: 'validation' });
    });
  });
});

describe('guarded switching', () => {
  it('refuses local drift and leaves the active branch unchanged', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await writeBytes(dir, '.env', Buffer.from('main-bytes', 'utf8'));
      await pushSecrets(pushBase(store, dir));
      await createBranch({ store, rootAbsolute: dir, projectId: PROJECT_ID, name: 'feature/demo', from: 'main' });
      await writeBytes(dir, '.env', Buffer.from('uncommitted-drift', 'utf8'));
      await expect(
        switchBranch({
          store,
          rootAbsolute: dir,
          projectId: PROJECT_ID,
          targetBranch: 'feature/demo',
          endpoint: ENDPOINT,
          vaultId: VAULT,
        }),
      ).rejects.toMatchObject({ code: 'local-changed' });
      const state = await loadState(dir, { endpoint: ENDPOINT, vaultId: VAULT, projectId: PROJECT_ID });
      expect(state.activeBranch).toBe('main');
      expect(await readText(dir, '.env')).toBe('uncommitted-drift');
    });
  });

  it('recovers partial writes and persists the branch only after completion', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await writeBytes(dir, '.env', Buffer.from('shared-main-env', 'utf8'));
      await writeBytes(dir, 'a.env', Buffer.from('shared-main-a', 'utf8'));
      await pushSecrets(pushBase(store, dir));
      await createBranch({ store, rootAbsolute: dir, projectId: PROJECT_ID, name: 'feature/demo', from: 'main' });
      const moved = await switchBranch({
        store,
        rootAbsolute: dir,
        projectId: PROJECT_ID,
        targetBranch: 'feature/demo',
        endpoint: ENDPOINT,
        vaultId: VAULT,
      });
      expect(moved.switched).toBe(true);
      await writeBytes(dir, '.env', Buffer.from('feature-env', 'utf8'));
      await writeBytes(dir, 'a.env', Buffer.from('feature-a', 'utf8'));
      await pushSecrets(pushBase(store, dir, { branch: 'feature/demo' }));
      await expect(
        switchBranch({
          store,
          rootAbsolute: dir,
          projectId: PROJECT_ID,
          targetBranch: 'main',
          endpoint: ENDPOINT,
          vaultId: VAULT,
          hooks: {
            beforeFile: async (path) => {
              if (path === '.env') {
                throw new Error('Injected switch failure.');
              }
            },
          },
        }),
      ).rejects.toThrow('Injected switch failure.');
      const partial = await loadState(dir, { endpoint: ENDPOINT, vaultId: VAULT, projectId: PROJECT_ID });
      expect(partial.activeBranch).toBe('feature/demo');
      const resumed = await switchBranch({
        store,
        rootAbsolute: dir,
        projectId: PROJECT_ID,
        targetBranch: 'main',
        endpoint: ENDPOINT,
        vaultId: VAULT,
      });
      expect(resumed.switched).toBe(true);
      expect(resumed.downloaded.sort()).toEqual(['.env', 'a.env']);
      expect(await readText(dir, '.env')).toBe('shared-main-env');
      expect(await readText(dir, 'a.env')).toBe('shared-main-a');
      const done = await loadState(dir, { endpoint: ENDPOINT, vaultId: VAULT, projectId: PROJECT_ID });
      expect(done.activeBranch).toBe('main');
      expect(done.materializedBranch).toBe('main');
    });
  });
});
