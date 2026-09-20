import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SecretSyncError } from '../src/errors';
import { loadValidatedHistory } from '../src/history-store';
import { pushSecrets } from '../src/push';
import { rollbackFile } from '../src/rollback';
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
  return `cccccccc-cccc-4ccc-8ccc-${tail}`;
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
  const dir = await mkdtemp(join(tmpdir(), 'secsync-rollback-'));
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

function baseOptions(store: SecretStore, dir: string, extra: Record<string, unknown> = {}) {
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

describe('single-file rollback', () => {
  it('publishes a new commit that replaces exactly one path', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await writeBytes(dir, '.env', Buffer.from('rollback-v1', 'utf8'));
      await writeBytes(dir, 'other.env', Buffer.from('other-stable', 'utf8'));
      const first = await pushSecrets(baseOptions(store, dir));
      expect(first.published).toBe(true);
      await writeBytes(dir, '.env', Buffer.from('rollback-v2', 'utf8'));
      const second = await pushSecrets(baseOptions(store, dir));
      expect(second.published).toBe(true);
      const before = await loadValidatedHistory(store, PROJECT_ID);
      const orderedBefore = [...before.commits.values()].sort((a, b) => a.timestamp - b.timestamp);
      const oldBlob = (
        (orderedBefore[0] as { tree: Array<{ path: string; blobId: string }> }).tree.find(
          (entry) => entry.path === '.env',
        ) as { blobId: string }
      ).blobId;
      const otherBlob = (
        (orderedBefore[1] as { tree: Array<{ path: string; blobId: string }> }).tree.find(
          (entry) => entry.path === 'other.env',
        ) as { blobId: string }
      ).blobId;
      const result = await rollbackFile({
        ...baseOptions(store, dir),
        path: '.env',
        revision: oldBlob,
        message: 'Revert rotation',
      });
      expect(result.published).toBe(true);
      expect(result.localRecoveryOk).toBe(true);
      expect(result.commitId).toBeDefined();
      expect(result.parents).toEqual([second.commitId as string]);
      const after = await loadValidatedHistory(store, PROJECT_ID);
      expect(after.commits.size).toBe(3);
      const rollback = after.commits.get(result.commitId as string);
      expect(rollback?.operationKind).toBe('rollback');
      expect(rollback?.parents).toEqual([second.commitId as string]);
      const tree = new Map((rollback?.tree ?? []).map((entry) => [entry.path, entry.blobId]));
      expect(tree.get('.env')).toBe(oldBlob);
      expect(tree.get('other.env')).toBe(otherBlob);
      expect(await readText(dir, '.env')).toBe('rollback-v1');
      expect(await readText(dir, 'other.env')).toBe('other-stable');
      const state = await loadState(dir, { endpoint: ENDPOINT, vaultId: VAULT, projectId: PROJECT_ID });
      expect(getBaseline(state, '.env')).toMatchObject({ state: 'present', blobId: oldBlob });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('rollback-v1');
    });
  });

  it('is a no-op when the requested revision equals the current file', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await writeBytes(dir, '.env', Buffer.from('steady', 'utf8'));
      await pushSecrets(baseOptions(store, dir));
      const history = await loadValidatedHistory(store, PROJECT_ID);
      const head = [...history.commits.values()][0] as { tree: Array<{ path: string; blobId: string }> };
      const current = (head.tree.find((entry) => entry.path === '.env') as { blobId: string }).blobId;
      const result = await rollbackFile({ ...baseOptions(store, dir), path: '.env', revision: current });
      expect(result.noop).toBe(true);
      expect(result.published).toBe(false);
      const after = await loadValidatedHistory(store, PROJECT_ID);
      expect(after.commits.size).toBe(1);
    });
  });

  it('refuses a dirty worktree and unknown revisions', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await writeBytes(dir, '.env', Buffer.from('clean-v1', 'utf8'));
      await pushSecrets(baseOptions(store, dir));
      await writeBytes(dir, '.env', Buffer.from('dirty-edit', 'utf8'));
      const history = await loadValidatedHistory(store, PROJECT_ID);
      const head = [...history.commits.values()][0] as { tree: Array<{ path: string; blobId: string }> };
      const current = (head.tree.find((entry) => entry.path === '.env') as { blobId: string }).blobId;
      await expect(rollbackFile({ ...baseOptions(store, dir), path: '.env', revision: current })).rejects.toMatchObject(
        {
          code: 'local-changed',
        },
      );
      await expect(
        rollbackFile({ ...baseOptions(store, dir), path: '.env', revision: testUuid(91) }),
      ).rejects.toMatchObject({ code: 'validation' });
    });
  });
});

describe('rollback recovery', () => {
  it('resumes after a materialization failure without a second commit', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await writeBytes(dir, '.env', Buffer.from('resume-v1', 'utf8'));
      await pushSecrets(baseOptions(store, dir));
      await writeBytes(dir, '.env', Buffer.from('resume-v2', 'utf8'));
      await pushSecrets(baseOptions(store, dir));
      const before = await loadValidatedHistory(store, PROJECT_ID);
      const oldest = [...before.commits.values()].sort((a, b) => a.timestamp - b.timestamp)[0] as {
        tree: Array<{ path: string; blobId: string }>;
      };
      const oldBlob = (oldest.tree.find((entry) => entry.path === '.env') as { blobId: string }).blobId;
      const operationId = testUuid(92);
      const commitId = testUuid(93);
      const failed = await rollbackFile({
        ...baseOptions(store, dir),
        path: '.env',
        revision: oldBlob,
        operationId,
        commitId,
        hooks: {
          beforeStateSave: async () => {
            throw new Error('Injected state-save failure.');
          },
        },
      });
      expect(failed.published).toBe(true);
      expect(failed.localRecoveryOk).toBe(false);
      expect(failed.commitId).toBe(commitId);
      expect(await readText(dir, '.env')).toBe('resume-v1');
      const resumed = await rollbackFile({
        ...baseOptions(store, dir),
        path: '.env',
        revision: oldBlob,
        operationId,
        commitId,
      });
      expect(resumed.published).toBe(false);
      expect(resumed.localRecoveryOk).toBe(true);
      expect(resumed.commitId).toBe(commitId);
      const after = await loadValidatedHistory(store, PROJECT_ID);
      expect(after.commits.size).toBe(3);
      expect(await readText(dir, '.env')).toBe('resume-v1');
      const state = await loadState(dir, { endpoint: ENDPOINT, vaultId: VAULT, projectId: PROJECT_ID });
      expect(getBaseline(state, '.env')).toMatchObject({ state: 'present', blobId: oldBlob, commitId });
    });
  });

  it('restores a file that was deleted from the current head', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await writeBytes(dir, '.env', Buffer.from('deleted-restore-v1', 'utf8'));
      await pushSecrets(baseOptions(store, dir));
      const before = await loadValidatedHistory(store, PROJECT_ID);
      const head = [...before.commits.values()][0] as { tree: Array<{ path: string; blobId: string }> };
      const oldBlob = (head.tree.find((entry) => entry.path === '.env') as { blobId: string }).blobId;
      await rm(join(dir, '.env'));
      await pushSecrets(baseOptions(store, dir, { allowDelete: true }));
      const result = await rollbackFile({ ...baseOptions(store, dir), path: '.env', revision: oldBlob });
      expect(result.published).toBe(true);
      expect(await readText(dir, '.env')).toBe('deleted-restore-v1');
      const after = await loadValidatedHistory(store, PROJECT_ID);
      const rollback = after.commits.get(result.commitId as string);
      expect(rollback?.tree.map((entry) => entry.path)).toEqual(['.env']);
    });
  });
});
