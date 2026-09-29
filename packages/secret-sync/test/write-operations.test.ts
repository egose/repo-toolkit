import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createBranch, switchBranch } from '../src/branches';
import * as filesystem from '../src/filesystem';
import { loadValidatedHistory } from '../src/history-store';
import { loadJournal } from '../src/journal';
import { pullSecrets } from '../src/pull';
import { pushSecrets } from '../src/push';
import { restoreFile } from '../src/restore';
import { rollbackFile } from '../src/rollback';
import { loadState } from '../src/state';
import { MemoryFakeStore } from './helpers';

const identity = {
  projectId: 'a64208df-4a95-4516-b8c7-e00621a7820c',
  endpoint: 'https://connect.example',
  vaultId: 'vault-1',
};

describe('worktree write preimages across operations', () => {
  for (const operation of [
    'pull',
    'restore',
    'restore-acknowledge',
    'rollback',
    'rollback-converge',
    'switch',
  ] as const) {
    it.each(['before-entry', 'before-rename', 'temp-failure'] as const)(
      `${operation} preserves local state on %s`,
      async (stage) => {
        const root = await mkdtemp(join(tmpdir(), 'secsync-write-operations-'));
        let spy: ReturnType<typeof vi.spyOn> | undefined;
        try {
          const writer = join(root, 'writer');
          const worktree = join(root, 'worktree');
          await mkdir(writer);
          await mkdir(worktree);
          const store = new MemoryFakeStore();
          const writerOptions = { ...identity, store, rootAbsolute: writer, branch: 'main' };
          const options = { ...identity, store, rootAbsolute: worktree, branch: 'main' };
          await writeFile(join(writer, '.env'), 'old-value');
          const first = await pushSecrets(writerOptions);
          const history = await loadValidatedHistory(store, identity.projectId);
          const oldBlob = history.commits.get(first.commitId as string)!.tree[0].blobId;
          await createBranch({ ...writerOptions, name: 'old', from: 'main' });
          await pullSecrets(options);
          await writeFile(join(writer, '.env'), 'new-value');
          const second = await pushSecrets(writerOptions);
          const newer = await loadValidatedHistory(store, identity.projectId);
          const newBlob = newer.commits.get(second.commitId as string)!.tree[0].blobId;
          if (operation !== 'pull') {
            await pullSecrets(options);
          }
          if (operation === 'restore-acknowledge') {
            await writeFile(join(worktree, '.env'), 'old-value');
          }
          if (operation === 'rollback-converge') {
            const interrupted = await rollbackFile({
              ...options,
              path: '.env',
              revision: oldBlob,
              hooks: {
                beforeFile: () => {
                  throw new Error('interrupted-materialization');
                },
              },
            });
            expect(interrupted.published).toBe(true);
            expect(interrupted.localRecoveryOk).toBe(false);
          }
          const before = await loadState(worktree, identity);
          const original = await readFile(join(worktree, '.env'), 'utf8');
          const failure = new Error('injected-temp-failure');
          const writeAtomically = filesystem.writeFileAtomically;
          let injected = 0;
          spy = vi
            .spyOn(filesystem, 'writeFileAtomically')
            .mockImplementation(async (rootAbsolute, path, bytes, writeOptions) => {
              injected += 1;
              const edit = async () => {
                await writeFile(join(rootAbsolute, path), 'edit-save');
              };
              if (stage === 'before-entry') {
                await edit();
              }
              return writeAtomically(rootAbsolute, path, bytes, {
                ...writeOptions,
                hooks: {
                  afterTempWrite: async () => {
                    const temps = (await readdir(rootAbsolute)).filter((name) =>
                      name.startsWith(filesystem.SAFE_WRITE_TEMP_PREFIX),
                    );
                    expect(temps).toHaveLength(1);
                    expect(await readFile(join(rootAbsolute, temps[0]))).toEqual(Buffer.from(bytes));
                    if (stage === 'temp-failure') {
                      throw failure;
                    }
                  },
                  ...(stage === 'before-rename' ? { beforeRename: edit } : {}),
                },
              });
            });
          const run = () => {
            switch (operation) {
              case 'pull':
                return pullSecrets(options);
              case 'restore':
                return restoreFile({ ...options, path: '.env', revision: oldBlob, overwrite: true });
              case 'restore-acknowledge':
                return restoreFile({
                  ...options,
                  path: '.env',
                  revision: newBlob,
                  overwrite: true,
                  acknowledgeRemote: true,
                });
              case 'rollback':
              case 'rollback-converge':
                return rollbackFile({ ...options, path: '.env', revision: oldBlob });
              case 'switch':
                return switchBranch({ ...options, targetBranch: 'old' });
            }
          };
          if (operation === 'rollback') {
            const result = await run();
            expect(result).toMatchObject({ published: true, localRecoveryOk: false, acknowledged: [] });
            expect(JSON.stringify(result)).not.toMatch(/edit-save|new-value|old-value|sha256|hmac/);
          } else if (stage === 'temp-failure') {
            await expect(run()).rejects.toBe(failure);
          } else {
            await expect(run()).rejects.toMatchObject({ code: 'local-changed' });
          }
          expect(injected).toBe(1);
          expect(await readFile(join(worktree, '.env'), 'utf8')).toBe(
            stage === 'temp-failure' ? original : 'edit-save',
          );
          const after = await loadState(worktree, identity);
          expect(after.baselines).toEqual(before.baselines);
          expect(after.activeBranch).toBe(before.activeBranch);
          expect(after.materializedBranch).toBe(before.materializedBranch);
          expect(after.heads).toEqual(before.heads);
          expect(
            (await readdir(worktree)).filter((name) => name.startsWith(filesystem.SAFE_WRITE_TEMP_PREFIX)),
          ).toEqual([]);
          if (operation === 'pull' || operation === 'switch') {
            expect(await loadJournal(worktree)).toEqual([expect.objectContaining({ path: '.env', status: 'pending' })]);
          }
        } finally {
          spy?.mockRestore();
          await rm(root, { recursive: true, force: true });
        }
      },
    );
  }
});
