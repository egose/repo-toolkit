import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SecretSyncError } from '../src/errors';
import { deriveBranchHeads } from '../src/graph';
import { findCommitsByOperationId, loadValidatedHistory, publishBlob, publishCommit } from '../src/history-store';
import {
  createOperationId,
  headsEqual,
  loadBranchHistory,
  observeHeadsAfter,
  publishUploadsBounded,
  readOperationRecord,
  recheckHeads,
  resolveOperationConcurrency,
  sortedHeadIds,
  writeOperationRecord,
} from '../src/operations';
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
  return `99999999-9999-4999-8999-${tail}`;
}

class CountingFakeStore implements SecretStore {
  private counter = 0;
  private readonly visible = new Map<string, ConnectItemDetail>();
  private uncertainRemaining: number;

  constructor(options: { uncertainNext?: number } = {}) {
    this.uncertainRemaining = options.uncertainNext ?? 0;
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
    const uncertain = this.uncertainRemaining > 0;
    if (uncertain) {
      this.uncertainRemaining -= 1;
    }
    this.visible.set(id, detail);
    if (uncertain) {
      return { status: 'uncertain', attempts: 1 };
    }
    return { status: 'created', item: JSON.parse(JSON.stringify(detail)) as ConnectItemDetail };
  }
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'secsync-ops-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeBytes(dir: string, rel: string, bytes: Uint8Array): Promise<void> {
  await writeFile(join(dir, ...rel.split('/')), Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

describe('operation records', () => {
  it('persists operation ids with intended record ids for later reconcile', async () => {
    await withTempDir(async (dir) => {
      const operationId = testUuid(1);
      const blobId = testUuid(2);
      const commitId = testUuid(3);
      const missing = await readOperationRecord(dir, operationId);
      expect(missing).toBeUndefined();
      await writeOperationRecord(dir, {
        schemaVersion: 1,
        operationId,
        kind: 'push',
        branch: 'main',
        commitId,
        blobIds: { '.env': blobId },
        timestamp: 1000,
        message: 'rotate',
      });
      const reloaded = await readOperationRecord(dir, operationId);
      expect(reloaded).toMatchObject({ operationId, kind: 'push', branch: 'main', commitId, timestamp: 1000 });
      expect(reloaded?.blobIds).toEqual({ '.env': blobId });
      expect(createOperationId(operationId)).toBe(operationId);
      expect(createOperationId()).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});

describe('uncertain posts', () => {
  it('reconciles an accepted-but-unacknowledged blob to one logical record', async () => {
    const store = new CountingFakeStore({ uncertainNext: 1 });
    const bytes = Buffer.from('operation-blob-bytes', 'utf8');
    const published = await publishUploadsBounded(
      store,
      PROJECT_ID,
      [{ path: '.env', bytes }],
      { '.env': testUuid(11) },
      2,
    );
    const record = published.get('.env');
    expect(record?.reconciled).toBe(true);
    const history = await loadValidatedHistory(store, PROJECT_ID);
    expect(history.blobs.size).toBe(1);
  });

  it('finds commits by operation id after a reconciled publish', async () => {
    const store = new CountingFakeStore({ uncertainNext: 1 });
    const operationId = testUuid(21);
    const published = await publishCommit(
      store,
      PROJECT_ID,
      { branch: 'main', parents: [], tree: [], timestamp: 50, operationId, operationKind: 'push' },
      { logicalId: testUuid(22) },
    );
    expect(published.reconciled).toBe(true);
    const history = await loadValidatedHistory(store, PROJECT_ID);
    expect(findCommitsByOperationId(history, operationId).map((entry) => entry.logicalId)).toEqual([testUuid(22)]);
  });
});

describe('head checks', () => {
  it('refuses publication over a changed head set and reports forks afterwards', async () => {
    await withTempDir(async (dir) => {
      const store = new CountingFakeStore();
      await writeBytes(dir, '.env', Buffer.from('base-content', 'utf8'));
      const first = await pushSecrets({
        store,
        rootAbsolute: dir,
        projectId: PROJECT_ID,
        branch: 'main',
        endpoint: ENDPOINT,
        vaultId: VAULT,
      });
      expect(first.published).toBe(true);
      const planned = await loadBranchHistory(store, PROJECT_ID, 'main');
      expect(planned.headIds).toHaveLength(1);
      const forkBytes = Buffer.from('fork', 'utf8');
      const forkBlob = await publishBlob(store, PROJECT_ID, forkBytes, { logicalId: testUuid(31) });
      await publishCommit(
        store,
        PROJECT_ID,
        {
          branch: 'main',
          parents: [],
          tree: [
            {
              path: 'other.env',
              blobId: forkBlob.envelope.logicalId,
              sha256: forkBlob.envelope.sha256,
              byteLength: forkBlob.envelope.byteLength,
            },
          ],
          timestamp: 60,
          operationId: testUuid(32),
          operationKind: 'push',
        },
        { logicalId: testUuid(33) },
      );
      await expect(recheckHeads(store, PROJECT_ID, 'main', planned.headIds)).rejects.toMatchObject({
        code: 'remote-diverged',
      });
      const observed = await observeHeadsAfter(store, PROJECT_ID, 'main');
      expect(observed.diverged).toBe(true);
      expect(observed.headIds).toHaveLength(2);
      expect(headsEqual(observed.headIds, sortedHeadIds(observed.heads))).toBe(true);
      const history = await loadValidatedHistory(store, PROJECT_ID);
      expect(deriveBranchHeads(history.commits, 'main')).toHaveLength(2);
    });
  });
});

describe('publication versus local recovery', () => {
  it('reports the published commit when the state save fails and converges on retry', async () => {
    await withTempDir(async (dir) => {
      const store = new CountingFakeStore();
      await writeBytes(dir, '.env', Buffer.from('recovery-bytes', 'utf8'));
      const failed = await pushSecrets({
        store,
        rootAbsolute: dir,
        projectId: PROJECT_ID,
        branch: 'main',
        endpoint: ENDPOINT,
        vaultId: VAULT,
        hooks: {
          beforeStateSave: () => {
            throw new Error('Simulated state failure.');
          },
        },
      });
      expect(failed.published).toBe(true);
      expect(failed.commitId).toBeDefined();
      expect(failed.localRecoveryOk).toBe(false);
      expect(failed.localRecoveryError).toContain('Simulated state failure.');
      const history = await loadValidatedHistory(store, PROJECT_ID);
      expect(history.commits.size).toBe(1);
      const retry = await pushSecrets({
        store,
        rootAbsolute: dir,
        projectId: PROJECT_ID,
        branch: 'main',
        endpoint: ENDPOINT,
        vaultId: VAULT,
      });
      expect(retry.published).toBe(false);
      expect(retry.localRecoveryOk).toBe(true);
      const after = await loadValidatedHistory(store, PROJECT_ID);
      expect(after.commits.size).toBe(1);
      const state = await loadState(dir, { endpoint: ENDPOINT, vaultId: VAULT, projectId: PROJECT_ID });
      expect(getBaseline(state, '.env')).toMatchObject({ state: 'present' });
    });
  });
});

describe('bounded concurrency', () => {
  it('rejects out-of-range concurrency without claiming constant-time discovery', async () => {
    expect(resolveOperationConcurrency(4)).toBe(4);
    expect(resolveOperationConcurrency(undefined)).toBe(4);
    expect(() => resolveOperationConcurrency(0)).toThrowError(SecretSyncError);
    expect(() => resolveOperationConcurrency(9)).toThrowError(SecretSyncError);
  });
});

describe('result hygiene', () => {
  it('keeps operation results free of secret bytes', async () => {
    await withTempDir(async (dir) => {
      const store = new CountingFakeStore();
      const canary = 'operations-canary-bytes-2p5z-secret';
      await writeBytes(dir, '.env', Buffer.from(canary, 'utf8'));
      const result = await pushSecrets({
        store,
        rootAbsolute: dir,
        projectId: PROJECT_ID,
        branch: 'main',
        endpoint: ENDPOINT,
        vaultId: VAULT,
      });
      expect(JSON.stringify(result)).not.toContain(canary);
      const stateRaw = await readFile(join(dir, '.repo-toolkit-secret-sync', 'state.json'), 'utf8');
      expect(stateRaw).not.toContain(canary);
    });
  });
});
