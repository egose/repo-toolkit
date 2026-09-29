import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { switchBranch } from '../src/branches';
import { publishSnapshot } from '../src/history-store';
import { runSecretSync, type SecretSyncOptions } from '../src/index';
import { loadState, saveState, setBaseline } from '../src/state';
import { MemoryFakeStore } from './helpers';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const IDENTITY = { endpoint: 'https://connect.example', vaultId: 'vault-1', projectId: PROJECT_ID };
const CONFIG = 'secret-sync.config.json';
const INITIAL = {
  'selected/update.json': 'main-selected',
  'selected/remove.json': 'main-remove',
  'selected/same.json': 'same-selected',
  'excluded/update.json': 'main-excluded',
  'excluded/remove.json': 'excluded-remove',
  'excluded/same.json': 'same-excluded',
};
const TARGET = {
  'selected/update.json': 'target-selected',
  'selected/new.json': 'new-selected',
  'selected/same.json': 'same-selected',
  'excluded/update.json': 'target-excluded',
  'excluded/new.json': 'new-excluded',
  'excluded/same.json': 'same-excluded',
};
const SELECTED = ['selected/new.json', 'selected/remove.json', 'selected/same.json', 'selected/update.json'];

async function write(root: string, path: string, contents: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), contents);
}

async function snapshot(root: string): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    result[entry.name] = {
      mode: (await stat(path)).mode,
      content: entry.isDirectory() ? await snapshot(path) : (await readFile(path)).toString('hex'),
    };
  }
  return result;
}

async function withFixture(
  test: (fixture: {
    root: string;
    store: MemoryFakeStore;
    configure: (files: string[], ignore?: string[]) => Promise<void>;
    run: (options: SecretSyncOptions) => ReturnType<typeof runSecretSync>;
    publishTarget: (extra?: Record<string, string>) => ReturnType<typeof publishSnapshot>;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'secret-sync-selection-'));
  try {
    const store = new MemoryFakeStore();
    const configure = async (files: string[], ignore: string[] = []) => {
      await write(
        root,
        CONFIG,
        JSON.stringify({
          schemaVersion: 1,
          projectId: PROJECT_ID,
          remote: { type: 'onepassword-connect', vaultId: IDENTITY.vaultId },
          files,
          ignore,
        }),
      );
    };
    const run = (options: SecretSyncOptions) =>
      runSecretSync({
        cwd: root,
        config: CONFIG,
        store,
        env: { OP_CONNECT_HOST: IDENTITY.endpoint, OP_CONNECT_TOKEN: 'fake-token' },
        ...options,
      });
    await configure(['**']);
    for (const [path, contents] of Object.entries(INITIAL)) {
      await write(root, path, contents);
    }
    const pushed = await run({ command: 'push' });
    if (pushed.command !== 'push' || pushed.result.commitId === undefined) {
      throw new Error('Fixture push did not publish.');
    }
    const parent = pushed.result.commitId;
    const publishTarget = (extra: Record<string, string> = {}) =>
      publishSnapshot(store, {
        projectId: PROJECT_ID,
        branch: 'feature',
        parents: [parent],
        files: Object.entries({ ...TARGET, ...extra }).map(([path, contents]) => ({
          path,
          bytes: Buffer.from(contents),
        })),
        timestamp: Date.now(),
        operationId: randomUUID(),
        operationKind: 'push',
      });
    await test({ root, store, configure, run, publishTarget });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('runSecretSync switch selection', () => {
  for (const selection of ['files', 'ignore'] as const) {
    for (const dirty of [false, true]) {
      it(`preserves ${dirty ? 'dirty' : 'clean'} excluded files and baselines after narrowing ${selection}`, async () => {
        await withFixture(async ({ root, store, configure, run, publishTarget }) => {
          const target = await publishTarget();
          await configure(
            selection === 'files' ? ['selected/**'] : ['**'],
            selection === 'ignore' ? ['excluded/**'] : [],
          );
          if (dirty) {
            for (const path of Object.keys(INITIAL).filter((path) => path.startsWith('excluded/'))) {
              await write(root, path, `dirty-${path}`);
            }
          }
          const before = await loadState(root, IDENTITY);
          const creates = store.counts.creates;
          const sameBranch = await run({ command: 'switch', branch: 'main' });
          expect(sameBranch).toMatchObject({
            command: 'switch',
            result: {
              noop: true,
              downloaded: [],
              removedLocal: [],
              acknowledged: SELECTED.filter((path) => path !== 'selected/new.json'),
            },
          });
          const unchanged = await snapshot(root);
          const preview = await run({ command: 'switch', branch: 'feature', dryRun: true });
          expect(preview).toMatchObject({
            command: 'switch',
            result: {
              downloaded: ['selected/new.json', 'selected/update.json'],
              removedLocal: ['selected/remove.json'],
              acknowledged: SELECTED,
              dryRun: true,
            },
          });
          expect(await snapshot(root)).toEqual(unchanged);
          const switched = await run({ command: 'switch', branch: 'feature' });
          if (switched.command !== 'switch' || preview.command !== 'switch') {
            throw new Error('Expected switch results.');
          }
          expect(switched.result).toMatchObject({
            switched: true,
            downloaded: preview.result.downloaded,
            removedLocal: preview.result.removedLocal,
            acknowledged: preview.result.acknowledged,
          });
          const after = await loadState(root, IDENTITY);
          expect(after.activeBranch).toBe('feature');
          expect(after.materializedBranch).toBe('feature');
          expect(after.heads.feature).toEqual([target.commit.logicalId]);
          for (const path of Object.keys(INITIAL).filter((path) => path.startsWith('excluded/'))) {
            expect(await readFile(join(root, path), 'utf8')).toBe(
              dirty ? `dirty-${path}` : INITIAL[path as keyof typeof INITIAL],
            );
            expect(after.baselines[path]).toEqual(before.baselines[path]);
          }
          await expect(readFile(join(root, 'excluded/new.json'))).rejects.toMatchObject({ code: 'ENOENT' });
          expect(after.baselines['excluded/new.json']).toBeUndefined();
          for (const path of ['selected/update.json', 'selected/new.json', 'selected/same.json'] as const) {
            expect(await readFile(join(root, path), 'utf8')).toBe(TARGET[path]);
            expect(after.baselines[path]).toMatchObject({ state: 'present', commitId: target.commit.logicalId });
          }
          await expect(readFile(join(root, 'selected/remove.json'))).rejects.toMatchObject({ code: 'ENOENT' });
          expect(after.baselines['selected/remove.json']).toEqual({ state: 'absent' });
          expect(store.counts.creates).toBe(creates);
        });
      });
    }
  }

  it('refuses selected local drift in both planning and execution without changing state or bytes', async () => {
    await withFixture(async ({ root, configure, run, publishTarget }) => {
      await publishTarget();
      await configure(['selected/**']);
      await write(root, 'selected/update.json', 'dirty-selected');
      const before = await snapshot(root);
      for (const dryRun of [true, false]) {
        await expect(run({ command: 'switch', branch: 'feature', dryRun })).rejects.toMatchObject({
          code: 'local-changed',
        });
        expect(await snapshot(root)).toEqual(before);
      }
    });
  });

  it('does not inspect an ignored tracked path that has become a directory', async () => {
    await withFixture(async ({ root, configure, run, publishTarget }) => {
      await publishTarget();
      await configure(['**'], ['excluded/**']);
      await rm(join(root, 'excluded/update.json'));
      await write(root, 'excluded/update.json/local-file', 'keep-directory-contents');
      const baseline = (await loadState(root, IDENTITY)).baselines['excluded/update.json'];
      const excluded = await snapshot(join(root, 'excluded'));
      for (const dryRun of [true, false]) {
        await run({ command: 'switch', branch: 'feature', dryRun });
        expect(await snapshot(join(root, 'excluded'))).toEqual(excluded);
        expect((await loadState(root, IDENTITY)).baselines['excluded/update.json']).toEqual(baseline);
      }
    });
  });

  it('excludes config, git and state paths even when the target tree and configured globs include them', async () => {
    await withFixture(async ({ root, store, run, publishTarget }) => {
      const protectedFiles = {
        '.git/HEAD': 'local-git-head',
        '.repo-toolkit-secret-sync/keep.json': 'local-state-file',
      };
      for (const [path, contents] of Object.entries(protectedFiles)) {
        await write(root, path, contents);
      }
      const config = await readFile(join(root, CONFIG), 'utf8');
      const forbidden = [CONFIG, ...Object.keys(protectedFiles), '.git/new-file', '.repo-toolkit-secret-sync/new-file'];
      await publishTarget(Object.fromEntries(forbidden.map((path) => [path, 'remote-protected-bytes'])));
      const before = await snapshot(root);
      const creates = store.counts.creates;
      for (const dryRun of [true, false]) {
        const result = await run({ command: 'switch', branch: 'feature', dryRun });
        if (result.command !== 'switch') {
          throw new Error('Expected switch result.');
        }
        for (const path of forbidden) {
          expect([
            ...result.result.downloaded,
            ...result.result.removedLocal,
            ...result.result.acknowledged,
          ]).not.toContain(path);
          expect((await loadState(root, IDENTITY)).baselines[path]).toBeUndefined();
        }
        if (dryRun) {
          expect(await snapshot(root)).toEqual(before);
        }
      }
      expect(await readFile(join(root, CONFIG), 'utf8')).toBe(config);
      for (const [path, contents] of Object.entries(protectedFiles)) {
        expect(await readFile(join(root, path), 'utf8')).toBe(contents);
      }
      for (const path of ['.git/new-file', '.repo-toolkit-secret-sync/new-file']) {
        await expect(readFile(join(root, path))).rejects.toMatchObject({ code: 'ENOENT' });
      }
      expect(store.counts.creates).toBe(creates);
    });
  });

  it('keeps an empty match set empty while persisting the new branch', async () => {
    await withFixture(async ({ root, configure, run, publishTarget }) => {
      await publishTarget();
      await configure(['unmatched/**']);
      await write(root, 'selected/update.json', 'dirty-unselected');
      const before = await loadState(root, IDENTITY);
      const files = await snapshot(root);
      for (const dryRun of [true, false]) {
        expect(await run({ command: 'switch', branch: 'feature', dryRun })).toMatchObject({
          command: 'switch',
          result: { downloaded: [], removedLocal: [], acknowledged: [] },
        });
        expect((await loadState(root, IDENTITY)).baselines).toEqual(before.baselines);
        if (dryRun) {
          expect(await snapshot(root)).toEqual(files);
        }
      }
      expect((await loadState(root, IDENTITY)).activeBranch).toBe('feature');
      expect(await readFile(join(root, 'selected/update.json'), 'utf8')).toBe('dirty-unselected');
    });
  });

  it('plans selected current-only removals and baseline-only acknowledgments identically to execution', async () => {
    await withFixture(async ({ root, configure, run, publishTarget }) => {
      await publishTarget();
      await configure(['selected/**']);
      const state = await loadState(root, IDENTITY);
      delete state.baselines['selected/remove.json'];
      setBaseline(state, 'selected/baseline-only.json', { state: 'absent' });
      await saveState(root, state);
      for (const dryRun of [true, false]) {
        expect(await run({ command: 'switch', branch: 'feature', dryRun })).toMatchObject({
          command: 'switch',
          result: {
            removedLocal: ['selected/remove.json'],
            acknowledged: ['selected/baseline-only.json', ...SELECTED],
          },
        });
      }
    });
  });

  it('keeps dry-run selection write-free in an uninitialized worktree', async () => {
    await withFixture(async ({ root, configure, run, publishTarget }) => {
      await publishTarget();
      await configure(['unmatched/**']);
      await mkdir(join(root, 'fresh'));
      const before = await snapshot(root);
      expect(await run({ command: 'switch', branch: 'feature', root: 'fresh', dryRun: true })).toMatchObject({
        command: 'switch',
        result: { from: '(uninitialized)', downloaded: [], removedLocal: [], acknowledged: [] },
      });
      expect(await snapshot(root)).toEqual(before);
    });
  });
});

describe('low-level switch compatibility', () => {
  it('selects all tracked paths by default without applying CLI inclusion defaults', async () => {
    await withFixture(async ({ root, store, publishTarget }) => {
      await publishTarget();
      for (const dryRun of [true, false]) {
        const result = await switchBranch({ store, rootAbsolute: root, ...IDENTITY, targetBranch: 'feature', dryRun });
        expect(result.downloaded).toEqual([
          'excluded/new.json',
          'excluded/update.json',
          'selected/new.json',
          'selected/update.json',
        ]);
        expect(result.removedLocal).toEqual(['excluded/remove.json', 'selected/remove.json']);
        expect(result.acknowledged).toHaveLength(8);
      }
      expect(await readFile(join(root, 'excluded/update.json'), 'utf8')).toBe('target-excluded');
      expect(await readFile(join(root, 'selected/update.json'), 'utf8')).toBe('target-selected');
    });
  });
});
