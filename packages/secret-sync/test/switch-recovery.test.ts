import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { switchBranch, type SwitchOptions } from '../src/branches';
import { createSelectionMatcher } from '../src/discovery';
import * as filesystem from '../src/filesystem';
import { publishSnapshot } from '../src/history-store';
import * as journal from '../src/journal';
import { pullSecrets } from '../src/pull';
import { pushSecrets } from '../src/push';
import { restoreFile } from '../src/restore';
import { rollbackFile } from '../src/rollback';
import { computeFileHmac, initState, loadState, resolveStatePaths, saveState } from '../src/state';
import { MemoryFakeStore } from './helpers';

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
}));

const identity = {
  projectId: 'a64208df-4a95-4516-b8c7-e00621a7820c',
  endpoint: 'https://connect.example',
  vaultId: 'vault-1',
};
const sourceFiles = {
  '.env': 'source-secret-A',
  'a.env': 'source-secret-B',
  'remove.env': 'remove-secret',
  'z-remove.env': 'remove-last',
  'keep.env': 'unchanged-secret',
  'ignored.env': 'excluded-secret',
};
const targetFiles = {
  '.env': 'target-secret-A',
  'a.env': 'target-secret-B',
  'new.env': '',
  'keep.env': 'unchanged-secret',
  'ignored.env': 'excluded-target',
  'ignored-new.env': 'never-materialize',
};

async function withFixture(
  test: (fixture: {
    root: string;
    store: MemoryFakeStore;
    options: SwitchOptions;
    source: Awaited<ReturnType<typeof publishSnapshot>>;
    target: Awaited<ReturnType<typeof publishSnapshot>>;
  }) => Promise<void>,
): Promise<void> {
  const root = await fs.mkdtemp(join(tmpdir(), 'secret-sync-switch-recovery-'));
  try {
    const store = new MemoryFakeStore();
    const publish = (branch: string, files: Record<string, string>, parents: string[]) =>
      publishSnapshot(store, {
        projectId: identity.projectId,
        branch,
        parents,
        timestamp: 123,
        operationId: randomUUID(),
        operationKind: 'push',
        files: Object.entries(files).map(([path, bytes]) => ({ path, bytes: Buffer.from(bytes) })),
      });
    const source = await publish('main', sourceFiles, []);
    await pullSecrets({ ...identity, rootAbsolute: root, store, branch: 'main' });
    const target = await publish('feature', targetFiles, [source.commit.logicalId]);
    const options: SwitchOptions = {
      ...identity,
      rootAbsolute: root,
      store,
      targetBranch: 'feature',
      matchesPath: createSelectionMatcher({ files: ['**'], ignore: ['ignored*.env'] }),
    };
    await fs.writeFile(join(root, 'ignored.env'), 'dirty-excluded');
    await test({ root, store, options, source, target });
  } finally {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function snapshot(root: string): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    result[entry.name] = {
      mode: (await fs.stat(path)).mode,
      content: entry.isDirectory() ? await snapshot(path) : (await fs.readFile(path)).toString('hex'),
    };
  }
  return result;
}

async function interrupt(options: SwitchOptions): Promise<void> {
  await expect(
    switchBranch({
      ...options,
      hooks: {
        beforeFile: async (path) => {
          if (path === 'a.env') {
            expect(await fs.readFile(join(options.rootAbsolute, '.env'), 'utf8')).toBe(targetFiles['.env']);
            throw new Error('second-write-failed');
          }
        },
      },
    }),
  ).rejects.toThrow('second-write-failed');
}

describe('operation-bound switch recovery', () => {
  it.each(['second-write', 'second-remove', 'state-save', 'journal-status'] as const)(
    'resumes %s without repeating completed mutations',
    async (boundary) => {
      await withFixture(async ({ root, options, store, source, target }) => {
        const before = await loadState(root, identity);
        const creates = store.counts.creates;
        const failure = new Error(`injected-${boundary}`);
        const writeSpy = vi.spyOn(filesystem, 'writeFileAtomically');
        const removeSpy = vi.spyOn(filesystem, 'removeFileGuarded');
        const rename = fs.rename;
        let stateRenames = 0;
        const renameSpy = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
          if (to === resolveStatePaths(root).stateFile && ++stateRenames === 2 && boundary === 'state-save') {
            throw failure;
          }
          return rename(from, to);
        });
        const mark = journal.markJournalStatus;
        const markSpy = vi.spyOn(journal, 'markJournalStatus').mockImplementation(async (dir, seq, status, opts) => {
          if (boundary === 'journal-status' && status === 'written') {
            throw failure;
          }
          return mark(dir, seq, status, opts);
        });
        await expect(
          switchBranch({
            ...options,
            hooks: {
              beforeFile: async (path) => {
                if (
                  (boundary === 'second-write' && path === 'a.env') ||
                  (boundary === 'second-remove' && path === 'z-remove.env')
                ) {
                  expect(await fs.readFile(join(root, '.env'), 'utf8')).toBe(targetFiles['.env']);
                  throw failure;
                }
              },
            },
          }),
        ).rejects.toBe(failure);
        renameSpy.mockRestore();
        markSpy.mockRestore();
        const partial = await loadState(root, identity);
        expect(partial).toMatchObject({
          activeBranch: before.activeBranch,
          materializedBranch: before.materializedBranch,
          baselines: before.baselines,
          heads: before.heads,
        });
        expect(partial.recovery).toMatchObject({
          kind: 'switch',
          sourceBranch: 'main',
          targetBranch: 'feature',
          sourceCommitId: source.commit.logicalId,
          targetCommitId: target.commit.logicalId,
        });
        expect(partial.recovery?.files.map((file) => file.path)).not.toContain('ignored.env');
        expect(await fs.readFile(join(root, '.env'), 'utf8')).toBe(targetFiles['.env']);
        if (boundary === 'second-write' || boundary === 'journal-status') {
          expect(await fs.readFile(join(root, 'a.env'), 'utf8')).toBe(sourceFiles['a.env']);
        }
        if (boundary === 'state-save') {
          expect(stateRenames).toBe(2);
          expect((await journal.loadJournal(root)).every((entry) => entry.status === 'acknowledged')).toBe(true);
        }
        const completedWrites = writeSpy.mock.calls.map((call) => call[1]);
        const completedRemovals = removeSpy.mock.calls.map((call) => call[1]);
        const unchanged = await snapshot(root);
        const preview = await switchBranch({ ...options, dryRun: true });
        expect(preview.resumedFromJournal).toBe(true);
        expect(preview.downloaded).toEqual(
          ['.env', 'a.env', 'new.env'].filter((path) => !completedWrites.includes(path)),
        );
        expect(await snapshot(root)).toEqual(unchanged);
        const serialized =
          (await fs.readFile(resolveStatePaths(root).stateFile, 'utf8')) +
          (await fs.readFile(resolveStatePaths(root).journalFile, 'utf8'));
        expect(serialized).not.toMatch(
          /source-secret|target-secret|remove-secret|unchanged-secret|sha256|contentBase64/,
        );
        expect((await fs.stat(resolveStatePaths(root).stateFile)).mode & 0o777).toBe(0o600);
        expect((await fs.stat(resolveStatePaths(root).journalFile)).mode & 0o777).toBe(0o600);
        expect((await fs.stat(resolveStatePaths(root).dir)).mode & 0o777).toBe(0o700);
        writeSpy.mockClear();
        removeSpy.mockClear();
        const resumed = await switchBranch(options);
        expect(resumed).toMatchObject({
          switched: true,
          resumedFromJournal: true,
          downloaded: ['.env', 'a.env', 'new.env'],
          removedLocal: ['remove.env', 'z-remove.env'],
        });
        expect(writeSpy.mock.calls.map((call) => call[1])).toEqual(
          ['.env', 'a.env', 'new.env'].filter((path) => !completedWrites.includes(path)),
        );
        expect(removeSpy.mock.calls.map((call) => call[1])).toEqual(
          ['remove.env', 'z-remove.env'].filter((path) => !completedRemovals.includes(path)),
        );
        for (const path of ['.env', 'a.env', 'new.env', 'keep.env'] as const) {
          expect(await fs.readFile(join(root, path), 'utf8')).toBe(targetFiles[path]);
        }
        for (const path of ['remove.env', 'z-remove.env', 'ignored-new.env']) {
          await expect(fs.readFile(join(root, path))).rejects.toMatchObject({ code: 'ENOENT' });
        }
        const done = await loadState(root, identity);
        expect(done.recovery).toBeUndefined();
        expect(done).toMatchObject({
          activeBranch: 'feature',
          materializedBranch: 'feature',
          heads: { feature: [target.commit.logicalId] },
        });
        expect(done.baselines['ignored.env']).toEqual(before.baselines['ignored.env']);
        expect(await fs.readFile(join(root, 'ignored.env'), 'utf8')).toBe('dirty-excluded');
        for (const entry of target.commit.tree.filter((entry) => !entry.path.startsWith('ignored'))) {
          expect(done.baselines[entry.path]).toMatchObject({
            state: 'present',
            blobId: entry.blobId,
            commitId: target.commit.logicalId,
            hmac: computeFileHmac(await fs.readFile(join(root, entry.path)), done.localKey),
          });
        }
        expect(done.baselines['remove.env']).toEqual({ state: 'absent' });
        expect(done.baselines['z-remove.env']).toEqual({ state: 'absent' });
        expect(await journal.loadJournal(root)).toEqual([]);
        expect(store.counts.creates).toBe(creates);
        expect(JSON.stringify(resumed)).not.toMatch(/hmac|sha256|source-secret|target-secret/);
      });
    },
  );

  it.each([
    'edit',
    'remove',
    'revert',
    'unfinished-edit',
    'new-empty',
    'wrong-target',
    'same-source',
    'wrong-operation',
    'selection',
    'source-head',
    'target-head',
  ] as const)('retains proof and files after %s', async (change) => {
    await withFixture(async ({ root, options, store, source, target }) => {
      await interrupt(options);
      const retry = { ...options };
      if (change === 'edit') await fs.writeFile(join(root, '.env'), 'edited-secret-A');
      if (change === 'remove') await fs.unlink(join(root, '.env'));
      if (change === 'revert') await fs.writeFile(join(root, '.env'), sourceFiles['.env']);
      if (change === 'unfinished-edit') await fs.writeFile(join(root, 'a.env'), 'edited-secret-B');
      if (change === 'new-empty') await fs.writeFile(join(root, 'new.env'), '');
      if (change === 'wrong-target') retry.targetBranch = 'other';
      if (change === 'same-source') retry.targetBranch = 'main';
      if (change === 'wrong-operation') retry.operationId = randomUUID();
      if (change === 'selection') retry.matchesPath = (path) => path === 'a.env';
      if (change === 'source-head' || change === 'target-head') {
        await publishSnapshot(store, {
          projectId: identity.projectId,
          branch: change === 'source-head' ? 'main' : 'feature',
          parents: [change === 'source-head' ? source.commit.logicalId : target.commit.logicalId],
          files: [],
          timestamp: 124,
          operationId: randomUUID(),
          operationKind: 'push',
        });
      }
      const before = await snapshot(root);
      for (const dryRun of [true, false]) {
        await expect(switchBranch({ ...retry, dryRun })).rejects.toMatchObject({ code: 'local-changed' });
        expect(await snapshot(root)).toEqual(before);
      }
    });
  });

  it.each(['operation', 'blob', 'hmac', 'length', 'timestamp', 'kind', 'missing', 'unrelated', 'no-proof'] as const)(
    'does not infer progress from %s journal evidence',
    async (change) => {
      await withFixture(async ({ root, options }) => {
        await interrupt(options);
        const entries = await journal.loadJournal(root);
        const first = entries[0];
        if (change === 'operation') first.opId = randomUUID();
        if (change === 'blob') first.blobId = randomUUID();
        if (change === 'hmac') first.hmac = '0'.repeat(64);
        if (change === 'length') first.byteLength = 999;
        if (change === 'timestamp') first.timestamp += 1;
        if (change === 'kind') first.kind = 'remove';
        if (change === 'missing') entries.shift();
        if (change === 'unrelated') entries.push({ ...first, seq: 99, opId: randomUUID(), path: 'ignored.env' });
        if (change === 'no-proof') {
          const state = await loadState(root, identity);
          delete state.recovery;
          await saveState(root, state);
        }
        await fs.writeFile(
          resolveStatePaths(root).journalFile,
          entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
        );
        const before = await snapshot(root);
        await expect(switchBranch(options)).rejects.toMatchObject({ code: 'local-changed' });
        expect(await snapshot(root)).toEqual(before);
      });
    },
  );

  it.each(['pull', 'pull-empty', 'push', 'restore', 'restore-acknowledge', 'rollback'] as const)(
    'blocks %s from consuming pending switch proof',
    async (operation) => {
      await withFixture(async ({ root, store, options, target }) => {
        await interrupt(options);
        const before = await snapshot(root);
        const creates = store.counts.creates;
        const base = { ...identity, rootAbsolute: root, store, branch: 'feature' };
        const revision = target.commit.tree.find((entry) => entry.path === '.env')!.blobId;
        const run = () => {
          switch (operation) {
            case 'pull':
              return pullSecrets(base);
            case 'pull-empty':
              return pullSecrets({ ...base, branch: 'empty' });
            case 'push':
              return pushSecrets(base);
            case 'restore':
              return restoreFile({ ...base, path: '.env', revision, overwrite: true });
            case 'restore-acknowledge':
              return restoreFile({ ...base, path: '.env', revision, overwrite: true, acknowledgeRemote: true });
            case 'rollback':
              return rollbackFile({ ...base, path: '.env', revision });
          }
        };
        await expect(run()).rejects.toMatchObject({ code: 'local-changed' });
        expect(await snapshot(root)).toEqual(before);
        expect(store.counts.creates).toBe(creates);
        expect((await switchBranch(options)).switched).toBe(true);
      });
    },
  );

  it.each(['.env', 'remove.env'])('refuses edited acknowledged %s after a failed state save', async (path) => {
    await withFixture(async ({ root, options }) => {
      await expect(
        switchBranch({
          ...options,
          hooks: {
            beforeStateSave: () => {
              throw new Error('save-failed');
            },
          },
        }),
      ).rejects.toThrow('save-failed');
      await fs.writeFile(join(root, path), '');
      const before = await snapshot(root);
      await expect(switchBranch(options)).rejects.toMatchObject({ code: 'local-changed' });
      expect(await snapshot(root)).toEqual(before);
    });
  });

  it('refuses an unrelated journal even when the original worktree is clean', async () => {
    await withFixture(async ({ root, options }) => {
      const state = await loadState(root, identity);
      const opId = randomUUID();
      const entry = await journal.appendJournalEntry(root, {
        opId,
        path: '.env',
        kind: 'write',
        byteLength: sourceFiles['.env'].length,
        hmac: computeFileHmac(Buffer.from(sourceFiles['.env']), state.localKey),
        timestamp: 123,
      });
      await journal.markJournalStatus(root, entry.seq, 'written');
      const before = await snapshot(root);
      await expect(switchBranch(options)).rejects.toMatchObject({ code: 'local-changed' });
      expect(await snapshot(root)).toEqual(before);
      await journal.markJournalStatus(root, entry.seq, 'acknowledged');
      const acknowledged = await snapshot(root);
      await expect(switchBranch({ ...options, operationId: opId })).rejects.toMatchObject({ code: 'local-changed' });
      expect(await snapshot(root)).toEqual(acknowledged);
    });
  });

  it.each(['empty-source', 'empty-target', 'empty-selection'] as const)(
    'recovers %s with no invented commit or file provenance',
    async (scenario) => {
      await withFixture(async ({ root, options, store, target }) => {
        let retry = options;
        if (scenario === 'empty-source') {
          const emptyRoot = join(root, 'empty');
          await fs.mkdir(emptyRoot);
          await initState(emptyRoot, identity, { branch: 'empty' });
          retry = { ...options, rootAbsolute: emptyRoot };
        }
        if (scenario === 'empty-target') retry = { ...options, targetBranch: 'empty' };
        if (scenario === 'empty-selection') retry = { ...options, matchesPath: () => false };
        const before = await loadState(retry.rootAbsolute, identity);
        const creates = store.counts.creates;
        await expect(
          switchBranch({
            ...retry,
            hooks: {
              beforeStateSave: () => {
                throw new Error('save-failed');
              },
            },
          }),
        ).rejects.toThrow('save-failed');
        const pending = await loadState(retry.rootAbsolute, identity);
        expect(pending.activeBranch).toBe(before.activeBranch);
        expect(pending.baselines).toEqual(before.baselines);
        expect(pending.recovery).toMatchObject({
          kind: 'switch',
          ...(scenario === 'empty-source' ? { sourceCommitId: null } : {}),
          targetCommitId: scenario === 'empty-target' ? null : target.commit.logicalId,
          ...(scenario === 'empty-selection' ? { files: [] } : {}),
        });
        const writeSpy = vi.spyOn(filesystem, 'writeFileAtomically');
        const removeSpy = vi.spyOn(filesystem, 'removeFileGuarded');
        expect(await switchBranch(retry)).toMatchObject({ switched: true, resumedFromJournal: true });
        expect(writeSpy).not.toHaveBeenCalled();
        expect(removeSpy).not.toHaveBeenCalled();
        const done = await loadState(retry.rootAbsolute, identity);
        expect(done.recovery).toBeUndefined();
        expect(done.activeBranch).toBe(retry.targetBranch);
        expect(done.materializedBranch).toBe(retry.targetBranch);
        if (scenario === 'empty-selection') expect(done.baselines).toEqual(before.baselines);
        expect(await journal.loadJournal(retry.rootAbsolute)).toEqual([]);
        expect(store.counts.creates).toBe(creates);
      });
    },
  );

  it('persists proof before any worktree or journal mutation', async () => {
    await withFixture(async ({ root, options }) => {
      const before = await loadState(root, identity);
      const beforeJournal = await journal.loadJournal(root);
      const rename = fs.rename;
      vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
        if (to === resolveStatePaths(root).stateFile) throw new Error('proof-save-failed');
        return rename(from, to);
      });
      await expect(switchBranch(options)).rejects.toThrow('proof-save-failed');
      expect(await loadState(root, identity)).toEqual(before);
      expect(await journal.loadJournal(root)).toEqual(beforeJournal);
      for (const [path, bytes] of Object.entries(sourceFiles)) {
        expect(await fs.readFile(join(root, path), 'utf8')).toBe(path === 'ignored.env' ? 'dirty-excluded' : bytes);
      }
    });
  });

  it('finishes journal cleanup after the branch and proof retirement were saved', async () => {
    await withFixture(async ({ root, options }) => {
      const cleanup = vi.spyOn(journal, 'clearAcknowledgedEntries').mockRejectedValueOnce(new Error('cleanup-failed'));
      await expect(switchBranch(options)).rejects.toThrow('cleanup-failed');
      cleanup.mockRestore();
      expect(await loadState(root, identity)).toMatchObject({ activeBranch: 'feature' });
      expect((await loadState(root, identity)).recovery).toBeUndefined();
      const writeSpy = vi.spyOn(filesystem, 'writeFileAtomically');
      expect(await switchBranch(options)).toMatchObject({ noop: true, resumedFromJournal: false });
      expect(writeSpy).not.toHaveBeenCalled();
      expect(await journal.loadJournal(root)).toEqual([]);
    });
  });
});
