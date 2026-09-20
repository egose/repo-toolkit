import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createBranch } from '../src/branches';
import { SecretSyncError } from '../src/errors';
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
