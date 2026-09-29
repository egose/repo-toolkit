import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createBranch } from '../src/branches';
import { SecretSyncError } from '../src/errors';
import { readFileBounded } from '../src/filesystem';
import { loadValidatedHistory } from '../src/history-store';
import { publishSnapshot } from '../src/history-store';
import { pushSecrets } from '../src/push';
import { restoreFile } from '../src/restore';
import { getBaseline, loadState } from '../src/state';
import type {
  ConnectItemDetail,
  ConnectItemSummary,
  CreateConnectItemInput,
  CreateItemResult,
  SecretStore,
} from '../src/store';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const FOREIGN_PROJECT = 'b75319e0-5b06-4627-c8d8-f11732b8931d';
const ENDPOINT = 'https://connect.example';
const VAULT = 'vault-1';

function testUuid(tag: number): string {
  const tail = tag.toString(16).padStart(12, '0');
  return `bbbbbbbb-bbbb-4bbb-8bbb-${tail}`;
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
  const dir = await mkdtemp(join(tmpdir(), 'secsync-restore-'));
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

function baseOptions(store: SecretStore, dir: string) {
  return {
    store,
    rootAbsolute: dir,
    projectId: PROJECT_ID,
    branch: 'main',
    endpoint: ENDPOINT,
    vaultId: VAULT,
  };
}

async function blobForCommit(store: SecretStore, commitTag: string, path: string): Promise<string> {
  const history = await loadValidatedHistory(store, PROJECT_ID);
  const commit = history.commits.get(commitTag);
  if (commit === undefined) {
    throw new Error('Test setup is missing its commit.');
  }
  const entry = commit.tree.find((candidate) => candidate.path === path);
  if (entry === undefined) {
    throw new Error('Test setup is missing its tree entry.');
  }
  return entry.blobId;
}

async function prepareRemoval(store: SecretStore, dir: string, current: Uint8Array | undefined) {
  await writeFile(join(dir, '.env'), 'baseline');
  await pushSecrets(baseOptions(store, dir));
  const state = await loadState(dir);
  await publishSnapshot(store, {
    projectId: PROJECT_ID,
    branch: 'main',
    parents: state.heads.main,
    files: [],
    timestamp: Date.now(),
    operationId: testUuid(81),
    operationKind: 'push',
    commitId: testUuid(82),
  });
  if (current === undefined) {
    await rm(join(dir, '.env'));
  } else {
    await writeFile(join(dir, '.env'), current);
  }
  return state;
}

describe('restore removal preflight guards', () => {
  for (const acknowledgeRemote of [false, true]) {
    describe(acknowledgeRemote ? 'acknowledging restore' : 'ordinary restore', () => {
      it.each(['edit', 'binary-edit', 'recreate', 'remove', 'remove-empty'] as const)(
        'refuses a late %s from the actual restore hook without advancing state',
        async (change) => {
          await withTempDir(async (dir) => {
            const store = new ImmediateFakeStore();
            const before =
              change === 'remove-empty'
                ? Buffer.alloc(0)
                : change === 'binary-edit'
                  ? Buffer.from([0, 255])
                  : Buffer.from('original');
            const after =
              change === 'remove' || change === 'remove-empty'
                ? undefined
                : change === 'binary-edit'
                  ? Buffer.from([255, 0])
                  : Buffer.from('lateedit');
            const state = await prepareRemoval(store, dir, before);
            const remote = await store.listItems();
            const beforeStateSave = vi.fn();
            const beforeWrite = vi.fn(async (path: string) => {
              expect(path).toBe('.env');
              expect(await readFile(join(dir, path))).toEqual(before);
              if (change === 'recreate' || after === undefined) {
                await rm(join(dir, path));
              }
              if (after !== undefined) {
                expect(after.byteLength).toBe(before.byteLength);
                await writeFile(join(dir, path), after);
              }
            });
            await expect(
              restoreFile({
                ...baseOptions(store, dir),
                path: '.env',
                fromBranch: 'main',
                overwrite: true,
                acknowledgeRemote,
                hooks: { beforeWrite, beforeStateSave },
              }),
            ).rejects.toMatchObject({ code: 'local-changed' });
            expect(beforeWrite).toHaveBeenCalledOnce();
            expect(beforeStateSave).not.toHaveBeenCalled();
            expect(await readFileBounded(dir, '.env')).toEqual(after === undefined ? undefined : new Uint8Array(after));
            expect(await loadState(dir)).toEqual(state);
            expect(await store.listItems()).toEqual(remote);
          });
        },
      );

      it.each([Buffer.alloc(0), Buffer.from('created')])(
        'preserves absence semantics when a write hook would create %j',
        async (created) => {
          await withTempDir(async (dir) => {
            const store = new ImmediateFakeStore();
            const state = await prepareRemoval(store, dir, undefined);
            const beforeWrite = vi.fn(async () => {
              await writeFile(join(dir, '.env'), created);
            });
            const beforeStateSave = vi.fn();
            const operation = restoreFile({
              ...baseOptions(store, dir),
              path: '.env',
              fromBranch: 'main',
              acknowledgeRemote,
              hooks: { beforeWrite, beforeStateSave },
            });
            if (acknowledgeRemote) {
              await expect(operation).rejects.toMatchObject({ code: 'local-changed' });
              expect(beforeWrite).toHaveBeenCalledOnce();
              expect(await readFile(join(dir, '.env'))).toEqual(created);
            } else {
              await expect(operation).resolves.toMatchObject({ noop: true, removed: true, acknowledged: false });
              expect(beforeWrite).not.toHaveBeenCalled();
              expect(await readFileBounded(dir, '.env')).toBeUndefined();
            }
            expect(beforeStateSave).not.toHaveBeenCalled();
            expect(await loadState(dir)).toEqual(state);
          });
        },
      );

      it.each([undefined, Buffer.alloc(0), Buffer.from('authorized')])(
        'allows intentional removal or absent no-op for %j',
        async (current) => {
          await withTempDir(async (dir) => {
            const store = new ImmediateFakeStore();
            const state = await prepareRemoval(store, dir, current);
            const remote = await store.listItems();
            const result = await restoreFile({
              ...baseOptions(store, dir),
              path: '.env',
              fromBranch: 'main',
              overwrite: current !== undefined,
              acknowledgeRemote,
            });
            expect(result).toMatchObject({
              removed: true,
              acknowledged: acknowledgeRemote,
              noop: current === undefined && !acknowledgeRemote,
            });
            expect(await readFileBounded(dir, '.env')).toBeUndefined();
            const after = await loadState(dir);
            if (acknowledgeRemote) {
              expect(getBaseline(after, '.env')).toEqual({ state: 'absent' });
              expect(after.heads.main).toEqual([testUuid(82)]);
              expect(after.activeBranch).toBe(state.activeBranch);
              expect(after.materializedBranch).toBe(state.materializedBranch);
            } else {
              expect(after).toEqual(state);
            }
            expect(await store.listItems()).toEqual(remote);
          });
        },
      );

      it('requires overwrite permission to remove preflight content', async () => {
        await withTempDir(async (dir) => {
          const store = new ImmediateFakeStore();
          const state = await prepareRemoval(store, dir, Buffer.from('kept'));
          const beforeWrite = vi.fn();
          await expect(
            restoreFile({
              ...baseOptions(store, dir),
              path: '.env',
              fromBranch: 'main',
              acknowledgeRemote,
              hooks: { beforeWrite },
            }),
          ).rejects.toMatchObject({ code: 'local-changed' });
          expect(beforeWrite).not.toHaveBeenCalled();
          expect(await readFile(join(dir, '.env'), 'utf8')).toBe('kept');
          expect(await loadState(dir)).toEqual(state);
        });
      });
    });
  }
});

describe('historical restore', () => {
  it('materializes one revision locally without touching baselines', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await writeBytes(dir, '.env', Buffer.from('restore-v1', 'utf8'));
      await pushSecrets({ ...baseOptions(store, dir) });
      await writeBytes(dir, '.env', Buffer.from('restore-v2', 'utf8'));
      await pushSecrets({ ...baseOptions(store, dir) });
      const history = await loadValidatedHistory(store, PROJECT_ID);
      const oldest = [...history.commits.values()].sort((a, b) => a.timestamp - b.timestamp)[0] as {
        logicalId: string;
      };
      const blobV1 = await blobForCommit(store, oldest.logicalId, '.env');
      const stateBefore = await loadState(dir, { endpoint: ENDPOINT, vaultId: VAULT, projectId: PROJECT_ID });
      const baselineBefore = JSON.stringify(getBaseline(stateBefore, '.env'));
      await writeBytes(dir, '.env', Buffer.from('divergent-local', 'utf8'));
      const result = await restoreFile({
        ...baseOptions(store, dir),
        path: '.env',
        revision: blobV1,
        overwrite: true,
      });
      expect(result.noop).toBe(false);
      expect(result.removed).toBe(false);
      expect(result.blobId).toBe(blobV1);
      expect(result.acknowledged).toBe(false);
      expect(Buffer.from(await readBytes(dir, '.env')).toString('utf8')).toBe('restore-v1');
      const stateAfter = await loadState(dir, { endpoint: ENDPOINT, vaultId: VAULT, projectId: PROJECT_ID });
      expect(JSON.stringify(getBaseline(stateAfter, '.env'))).toBe(baselineBefore);
    });
  });

  it('refuses divergent bytes without overwrite and no-ops when equal', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await writeBytes(dir, '.env', Buffer.from('same-bytes', 'utf8'));
      await pushSecrets({ ...baseOptions(store, dir) });
      const history = await loadValidatedHistory(store, PROJECT_ID);
      const head = [...history.commits.values()][0] as { tree: Array<{ path: string; blobId: string }> };
      const current = (head.tree.find((entry) => entry.path === '.env') as { blobId: string }).blobId;
      const noop = await restoreFile({ ...baseOptions(store, dir), path: '.env', revision: current });
      expect(noop.noop).toBe(true);
      await writeBytes(dir, '.env', Buffer.from('drifted-bytes', 'utf8'));
      await expect(restoreFile({ ...baseOptions(store, dir), path: '.env', revision: current })).rejects.toMatchObject({
        code: 'local-changed',
      });
    });
  });

  it('recreates a deleted file and supports dry runs', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await writeBytes(dir, '.env', Buffer.from('deleted-v1', 'utf8'));
      await pushSecrets({ ...baseOptions(store, dir) });
      const history = await loadValidatedHistory(store, PROJECT_ID);
      const head = [...history.commits.values()][0] as { tree: Array<{ path: string; blobId: string }> };
      const blob = (head.tree.find((entry) => entry.path === '.env') as { blobId: string }).blobId;
      await rm(join(dir, '.env'));
      const planned = await restoreFile({ ...baseOptions(store, dir), path: '.env', revision: blob, dryRun: true });
      expect(planned.noop).toBe(false);
      expect(planned.dryRun).toBe(true);
      await expect(readBytes(dir, '.env')).rejects.toThrow();
      const result = await restoreFile({ ...baseOptions(store, dir), path: '.env', revision: blob });
      expect(result.noop).toBe(false);
      expect(Buffer.from(await readBytes(dir, '.env')).toString('utf8')).toBe('deleted-v1');
    });
  });

  it('rejects foreign and unrelated revisions', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await writeBytes(dir, '.env', Buffer.from('guarded', 'utf8'));
      await writeBytes(dir, 'other.env', Buffer.from('other', 'utf8'));
      await pushSecrets({ ...baseOptions(store, dir) });
      const history = await loadValidatedHistory(store, PROJECT_ID);
      const head = [...history.commits.values()][0] as { tree: Array<{ path: string; blobId: string }> };
      const otherBlob = (head.tree.find((entry) => entry.path === 'other.env') as { blobId: string }).blobId;
      await expect(
        restoreFile({ ...baseOptions(store, dir), path: '.env', revision: otherBlob, overwrite: true }),
      ).rejects.toMatchObject({ code: 'validation' });
      await expect(
        restoreFile({ ...baseOptions(store, dir), path: '.env', revision: testUuid(71), overwrite: true }),
      ).rejects.toMatchObject({ code: 'validation' });
      await publishSnapshot(store, {
        projectId: FOREIGN_PROJECT,
        branch: 'main',
        parents: [],
        files: [{ path: '.env', bytes: Buffer.from('foreign', 'utf8') }],
        timestamp: 5,
        operationId: testUuid(72),
        operationKind: 'push',
        commitId: testUuid(73),
      });
      const foreignHistory = await loadValidatedHistory(store, FOREIGN_PROJECT);
      const foreignCommit = [...foreignHistory.commits.values()][0] as { tree: Array<{ blobId: string }> };
      const foreignBlob = (foreignCommit.tree[0] as { blobId: string }).blobId;
      await expect(
        restoreFile({ ...baseOptions(store, dir), path: '.env', revision: foreignBlob, overwrite: true }),
      ).rejects.toMatchObject({ code: 'validation' });
    });
  });

  it('acknowledges only the current remote revision', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await writeBytes(dir, '.env', Buffer.from('ack-v1', 'utf8'));
      await pushSecrets({ ...baseOptions(store, dir) });
      await writeBytes(dir, '.env', Buffer.from('ack-v2', 'utf8'));
      await pushSecrets({ ...baseOptions(store, dir) });
      const history = await loadValidatedHistory(store, PROJECT_ID);
      const ordered = [...history.commits.values()].sort((a, b) => a.timestamp - b.timestamp);
      const oldBlob = (
        (ordered[0] as { tree: Array<{ path: string; blobId: string }> }).tree.find(
          (entry) => entry.path === '.env',
        ) as { blobId: string }
      ).blobId;
      const currentBlob = (
        (ordered[1] as { tree: Array<{ path: string; blobId: string }> }).tree.find(
          (entry) => entry.path === '.env',
        ) as { blobId: string }
      ).blobId;
      await expect(
        restoreFile({
          ...baseOptions(store, dir),
          path: '.env',
          revision: oldBlob,
          overwrite: true,
          acknowledgeRemote: true,
        }),
      ).rejects.toMatchObject({ code: 'validation' });
      const result = await restoreFile({
        ...baseOptions(store, dir),
        path: '.env',
        revision: currentBlob,
        acknowledgeRemote: true,
      });
      expect(result.acknowledged).toBe(true);
      const state = await loadState(dir, { endpoint: ENDPOINT, vaultId: VAULT, projectId: PROJECT_ID });
      expect(getBaseline(state, '.env')).toMatchObject({ state: 'present', blobId: currentBlob });
    });
  });

  it('promotes a branch file without changing the active branch', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await writeBytes(dir, '.env', Buffer.from('main-bytes', 'utf8'));
      await pushSecrets({ ...baseOptions(store, dir) });
      await createBranch({ store, rootAbsolute: dir, projectId: PROJECT_ID, name: 'feature/demo', from: 'main' });
      await writeBytes(dir, '.env', Buffer.from('feature-bytes', 'utf8'));
      await pushSecrets({ ...baseOptions(store, dir), branch: 'feature/demo' });
      await writeBytes(dir, '.env', Buffer.from('main-bytes', 'utf8'));
      const result = await restoreFile({
        ...baseOptions(store, dir),
        path: '.env',
        fromBranch: 'feature/demo',
        overwrite: true,
      });
      expect(result.sourceBranch).toBe('feature/demo');
      expect(Buffer.from(await readBytes(dir, '.env')).toString('utf8')).toBe('feature-bytes');
      const state = await loadState(dir, { endpoint: ENDPOINT, vaultId: VAULT, projectId: PROJECT_ID });
      expect(state.activeBranch).toBe('main');
    });
  });
});
