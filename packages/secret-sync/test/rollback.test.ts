import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import * as filesystem from '../src/filesystem';
import * as stateModule from '../src/state';
import { SecretSyncError } from '../src/errors';
import { loadValidatedHistory, publishCommit } from '../src/history-store';
import { pushSecrets } from '../src/push';
import { rollbackFile } from '../src/rollback';
import { captureLocalPreimage, getBaseline, loadState, resolveStatePaths, saveState } from '../src/state';
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
  it.each(['before-publish', 'after-publish', 'write', 'state-save'] as const)(
    'retries a genuine %s failure with durable original provenance',
    async (stage) => {
      await withTempDir(async (dir) => {
        const store = new ImmediateFakeStore();
        await writeFile(join(dir, '.env'), 'original-secret');
        await pushSecrets(baseOptions(store, dir));
        const original = await loadState(dir);
        const revision = (getBaseline(original, '.env') as { blobId: string }).blobId;
        await writeFile(join(dir, '.env'), 'rotated-secret');
        const pushed = await pushSecrets(baseOptions(store, dir));
        const before = await loadState(dir);
        const failure = new Error('injected interruption');
        const fail = () => {
          throw failure;
        };
        const writeAtomically = filesystem.writeFileAtomically;
        const spy = vi.spyOn(filesystem, 'writeFileAtomically');
        if (stage === 'write') {
          spy.mockImplementation((root, path, bytes, options) =>
            writeAtomically(root, path, bytes, {
              ...options,
              hooks: { afterTempWrite: fail },
            }),
          );
        }
        const options = {
          ...baseOptions(store, dir),
          path: '.env',
          revision,
          operationId: testUuid(110),
          commitId: testUuid(111),
          timestamp: 100,
          message: 'original operation',
        };
        try {
          const run = rollbackFile({
            ...options,
            hooks:
              stage === 'before-publish'
                ? { beforePublish: fail }
                : stage === 'after-publish'
                  ? { afterPublish: fail }
                  : stage === 'state-save'
                    ? { beforeStateSave: fail }
                    : {},
          });
          if (stage === 'before-publish' || stage === 'after-publish') {
            await expect(run).rejects.toBe(failure);
          } else {
            expect(await run).toMatchObject({ published: true, localRecoveryOk: false });
          }
          const interrupted = await loadState(dir);
          expect(interrupted.baselines).toEqual(before.baselines);
          expect(interrupted.heads).toEqual(before.heads);
          expect(interrupted.recovery).toEqual({
            kind: 'rollback',
            operationId: options.operationId,
            branch: 'main',
            sourceCommitId: pushed.commitId,
            commitId: options.commitId,
            files: [
              {
                path: '.env',
                blobId: revision,
                preimage: captureLocalPreimage(Buffer.from('rotated-secret'), before.localKey),
              },
            ],
          });
          const paths = resolveStatePaths(dir);
          const raw = await readFile(paths.stateFile, 'utf8');
          expect(raw).not.toMatch(/original-secret|rotated-secret|sha256|contentBase64/);
          if (process.platform !== 'win32') {
            expect((await stat(paths.dir)).mode & 0o777).toBe(0o700);
            expect((await stat(paths.stateFile)).mode & 0o777).toBe(0o600);
          }
          expect((await readdir(dir)).filter((name) => name.startsWith(filesystem.SAFE_WRITE_TEMP_PREFIX))).toEqual([]);
          spy.mockRestore();
          const retrySpy = vi.spyOn(filesystem, 'writeFileAtomically');
          try {
            const resumed = await rollbackFile({
              ...baseOptions(store, dir),
              path: '.env',
              revision,
              timestamp: 999,
              message: 'retry',
            });
            expect(resumed).toMatchObject({
              localRecoveryOk: true,
              commitId: options.commitId,
              published: stage === 'before-publish',
            });
            expect(retrySpy).toHaveBeenCalledTimes(stage === 'state-save' ? 0 : 1);
            expect(JSON.stringify(resumed)).not.toMatch(/original-secret|rotated-secret|sha256|hmac/);
          } finally {
            retrySpy.mockRestore();
          }
          const after = await loadState(dir);
          expect(after.recovery).toBeUndefined();
          expect(after.baselines['.env']).toMatchObject({ blobId: revision, commitId: options.commitId });
          expect(await readText(dir, '.env')).toBe('original-secret');
          const history = await loadValidatedHistory(store, PROJECT_ID);
          expect(history.commits.size).toBe(3);
          expect(history.commits.get(options.commitId)).toMatchObject({
            timestamp: 100,
            message: 'original operation',
          });
        } finally {
          spy.mockRestore();
        }
      });
    },
  );

  it('does not publish or write when recovery evidence cannot be saved', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await writeFile(join(dir, '.env'), 'original');
      await pushSecrets(baseOptions(store, dir));
      const original = await loadState(dir);
      const revision = (getBaseline(original, '.env') as { blobId: string }).blobId;
      await writeFile(join(dir, '.env'), 'rotated');
      await pushSecrets(baseOptions(store, dir));
      const before = await loadState(dir);
      const failure = new Error('cannot persist recovery');
      const persistState = stateModule.saveState;
      const spy = vi.spyOn(stateModule, 'saveState').mockImplementation((root, state) =>
        persistState(root, state, {
          hooks: {
            beforeRename: () => {
              throw failure;
            },
          },
        }),
      );
      try {
        await expect(rollbackFile({ ...baseOptions(store, dir), path: '.env', revision })).rejects.toBe(failure);
        expect(await loadState(dir)).toEqual(before);
        expect(await readText(dir, '.env')).toBe('rotated');
        expect((await loadValidatedHistory(store, PROJECT_ID)).commits.size).toBe(2);
      } finally {
        spy.mockRestore();
      }
    });
  });

  it.each(['operation', 'commit', 'branch', 'path', 'revision', 'advanced-head', 'missing-proof'] as const)(
    'refuses unrelated %s recovery and retains evidence',
    async (mismatch) => {
      await withTempDir(async (dir) => {
        const store = new ImmediateFakeStore();
        await writeFile(join(dir, '.env'), 'original');
        await writeFile(join(dir, 'other.env'), 'other');
        await pushSecrets(baseOptions(store, dir));
        const original = await loadState(dir);
        const revision = (getBaseline(original, '.env') as { blobId: string }).blobId;
        await writeFile(join(dir, '.env'), 'rotated');
        await pushSecrets(baseOptions(store, dir));
        const rotated = await loadState(dir);
        const failed = await rollbackFile({
          ...baseOptions(store, dir),
          path: '.env',
          revision,
          hooks: {
            beforeFile: () => {
              throw new Error('interrupted');
            },
          },
        });
        expect(failed.localRecoveryOk).toBe(false);
        if (mismatch === 'missing-proof') {
          const state = await loadState(dir);
          delete state.recovery;
          await saveState(dir, state);
        }
        if (mismatch === 'advanced-head' || mismatch === 'branch') {
          const history = await loadValidatedHistory(store, PROJECT_ID);
          const head = history.commits.get(failed.commitId as string)!;
          await publishCommit(store, PROJECT_ID, {
            branch: mismatch === 'branch' ? 'other' : 'main',
            parents: [head.logicalId],
            tree: head.tree,
            timestamp: Date.now(),
            operationId: testUuid(122),
            operationKind: 'push',
          });
        }
        const interrupted = await loadState(dir);
        const count = (await loadValidatedHistory(store, PROJECT_ID)).commits.size;
        await expect(
          rollbackFile({
            ...baseOptions(store, dir),
            path: mismatch === 'path' ? 'other.env' : '.env',
            branch: mismatch === 'branch' ? 'other' : 'main',
            revision:
              mismatch === 'revision'
                ? (getBaseline(rotated, '.env') as { blobId: string }).blobId
                : mismatch === 'path'
                  ? (getBaseline(original, 'other.env') as { blobId: string }).blobId
                  : revision,
            ...(mismatch === 'operation' ? { operationId: testUuid(120) } : {}),
            ...(mismatch === 'commit' ? { commitId: testUuid(121) } : {}),
          }),
        ).rejects.toMatchObject({ code: 'local-changed' });
        expect(await loadState(dir)).toEqual(interrupted);
        expect(await readText(dir, '.env')).toBe('rotated');
        expect((await loadValidatedHistory(store, PROJECT_ID)).commits.size).toBe(count);
      });
    },
  );

  it.each(['stale', 'unbased'] as const)(
    'refuses dirty %s content when another writer already published the revision',
    async (baseline) => {
      await withTempDir(async (dir) => {
        const store = new ImmediateFakeStore();
        await writeFile(join(dir, '.env'), 'original');
        await pushSecrets(baseOptions(store, dir));
        const stale = await loadState(dir);
        await writeFile(join(dir, '.env'), 'remote-current');
        await pushSecrets(baseOptions(store, dir));
        const current = await loadState(dir);
        const revision = (getBaseline(current, '.env') as { blobId: string }).blobId;
        if (baseline === 'unbased') stale.baselines = {};
        await saveState(dir, stale);
        await writeFile(join(dir, '.env'), 'uncommitted-edit');
        await expect(rollbackFile({ ...baseOptions(store, dir), path: '.env', revision })).rejects.toMatchObject({
          code: 'local-changed',
        });
        expect(await readText(dir, '.env')).toBe('uncommitted-edit');
        expect(await loadState(dir)).toEqual(stale);
        expect((await loadValidatedHistory(store, PROJECT_ID)).commits.size).toBe(2);
      });
    },
  );

  it.each([
    ['write', 'edit-before-retry'],
    ['write', 'edited!'],
    ['write', undefined],
    ['state-save', 'edit-before-retry'],
    ['state-save', 'edited!!'],
    ['state-save', undefined],
  ] as const)('preserves edits made before retry after a %s failure (%s)', async (stage, edit) => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await writeFile(join(dir, '.env'), 'original');
      await pushSecrets(baseOptions(store, dir));
      const original = await loadState(dir);
      const revision = (getBaseline(original, '.env') as { blobId: string }).blobId;
      await writeFile(join(dir, '.env'), 'rotated');
      await pushSecrets(baseOptions(store, dir));
      const fail = () => {
        throw new Error('injected interruption');
      };
      const failed = await rollbackFile({
        ...baseOptions(store, dir),
        path: '.env',
        revision,
        hooks: stage === 'write' ? { beforeFile: fail } : { beforeStateSave: fail },
      });
      expect(failed).toMatchObject({ published: true, localRecoveryOk: false });
      const interrupted = await loadState(dir);
      if (edit === undefined) await rm(join(dir, '.env'));
      else await writeFile(join(dir, '.env'), edit);
      await expect(rollbackFile({ ...baseOptions(store, dir), path: '.env', revision })).rejects.toMatchObject({
        code: 'local-changed',
      });
      if (edit === undefined) await expect(readText(dir, '.env')).rejects.toMatchObject({ code: 'ENOENT' });
      else expect(await readText(dir, '.env')).toBe(edit);
      expect(await loadState(dir)).toEqual(interrupted);
      expect((await loadValidatedHistory(store, PROJECT_ID)).commits.size).toBe(3);
    });
  });

  it('persists absence as the original preimage and refuses a newly created file before retry', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await writeFile(join(dir, '.env'), 'original');
      await pushSecrets(baseOptions(store, dir));
      const original = await loadState(dir);
      const revision = (getBaseline(original, '.env') as { blobId: string }).blobId;
      await rm(join(dir, '.env'));
      await pushSecrets(baseOptions(store, dir, { allowDelete: true }));
      const result = await rollbackFile({
        ...baseOptions(store, dir),
        path: '.env',
        revision,
        hooks: {
          beforeFile: () => {
            throw new Error('interrupted');
          },
        },
      });
      expect(result.localRecoveryOk).toBe(false);
      const interrupted = await loadState(dir);
      expect(interrupted.recovery?.files[0].preimage).toEqual({ state: 'absent' });
      await writeFile(join(dir, '.env'), '');
      await expect(rollbackFile({ ...baseOptions(store, dir), path: '.env', revision })).rejects.toMatchObject({
        code: 'local-changed',
      });
      expect(await readText(dir, '.env')).toBe('');
      expect(await loadState(dir)).toEqual(interrupted);
      await rm(join(dir, '.env'));
      const resumed = await rollbackFile({ ...baseOptions(store, dir), path: '.env', revision });
      expect(resumed).toMatchObject({ published: false, localRecoveryOk: true });
      expect(await readText(dir, '.env')).toBe('original');
      expect((await loadState(dir)).recovery).toBeUndefined();
      expect((await loadValidatedHistory(store, PROJECT_ID)).commits.size).toBe(3);
    });
  });

  it('does not treat an unreadable preflight file as absent during already-published materialization', async () => {
    await withTempDir(async (dir) => {
      const store = new ImmediateFakeStore();
      await writeBytes(dir, '.env', Buffer.from('a'));
      const first = await pushSecrets(baseOptions(store, dir));
      const history = await loadValidatedHistory(store, PROJECT_ID);
      const oldBlob = history.commits.get(first.commitId as string)!.tree[0].blobId;
      await writeBytes(dir, '.env', Buffer.from('new-value'));
      await pushSecrets(baseOptions(store, dir));
      const before = await loadState(dir, { endpoint: ENDPOINT, vaultId: VAULT, projectId: PROJECT_ID });
      const interrupted = await rollbackFile({
        ...baseOptions(store, dir),
        path: '.env',
        revision: oldBlob,
        hooks: {
          beforeFile: () => {
            throw new Error('injected-before-materialization');
          },
        },
      });
      expect(interrupted.localRecoveryOk).toBe(false);
      expect(interrupted.published).toBe(true);
      await expect(
        rollbackFile({
          ...baseOptions(store, dir),
          path: '.env',
          revision: oldBlob,
          maxFileBytes: 1,
        }),
      ).rejects.toMatchObject({ code: 'too-large' });
      expect(await readText(dir, '.env')).toBe('new-value');
      const after = await loadState(dir, { endpoint: ENDPOINT, vaultId: VAULT, projectId: PROJECT_ID });
      expect(after.baselines).toEqual(before.baselines);
      expect((await loadValidatedHistory(store, PROJECT_ID)).commits.size).toBe(3);
    });
  });

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
