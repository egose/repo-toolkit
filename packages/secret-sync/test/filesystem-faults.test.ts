import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  expectedDestinationFromBytes,
  SAFE_WRITE_TEMP_PREFIX,
  writeExportFileAtomically,
  writeFileAtomically,
} from '../src/filesystem';

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
}));

describe('atomic replacement fault cleanup', () => {
  for (const mode of ['worktree', 'export'] as const) {
    it.each(['open', 'writeFile', 'chmod', 'sync', 'close', 'rename', 'ancestor', 'kind'] as const)(
      `${mode} cleans up on %s failure`,
      async (stage) => {
        const dir = await fs.mkdtemp(join(tmpdir(), 'secsync-write-fault-'));
        try {
          const parent = join(dir, 'nested');
          await fs.mkdir(parent);
          const path = join(parent, 'kept.env');
          await fs.writeFile(path, 'original');
          const failure = new Error(`injected-${stage}`);
          const realOpen = fs.open;
          let injected = 0;
          const closes: Array<ReturnType<typeof vi.spyOn>> = [];
          vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
            if (!basename(String(args[0])).startsWith(SAFE_WRITE_TEMP_PREFIX)) {
              return realOpen(...args);
            }
            if (stage === 'open') {
              injected += 1;
              throw failure;
            }
            const handle = await realOpen(...args);
            const close = handle.close.bind(handle);
            closes.push(
              vi.spyOn(handle, 'close').mockImplementation(async () => {
                await close();
                if (stage === 'close') {
                  injected += 1;
                  throw failure;
                }
              }),
            );
            if (stage === 'writeFile') {
              const write = handle.writeFile.bind(handle);
              vi.spyOn(handle, 'writeFile').mockImplementation(async () => {
                await write(Buffer.from('partial-plaintext'));
                injected += 1;
                throw failure;
              });
            } else if (stage === 'chmod' || stage === 'sync') {
              vi.spyOn(handle, stage).mockImplementation(async () => {
                injected += 1;
                throw failure;
              });
            }
            return handle;
          });
          const options = {
            hooks: {
              afterTempWrite: async () => {
                expect(
                  (await fs.readdir(parent)).filter((name) => name.startsWith(SAFE_WRITE_TEMP_PREFIX)),
                ).toHaveLength(1);
                if (stage === 'rename') {
                  vi.spyOn(fs, 'rename').mockImplementation(async () => {
                    injected += 1;
                    throw failure;
                  });
                } else if (stage === 'ancestor' || stage === 'kind') {
                  const realLstat = fs.lstat;
                  vi.spyOn(fs, 'lstat').mockImplementation((...args) => {
                    if (String(args[0]) === (stage === 'ancestor' ? parent : path)) {
                      injected += 1;
                      throw failure;
                    }
                    return realLstat(...args);
                  });
                }
              },
            },
          };
          const result =
            mode === 'worktree'
              ? writeFileAtomically(dir, 'nested/kept.env', Buffer.from('secret'), options)
              : writeExportFileAtomically(path, Buffer.from('secret'), options);
          await expect(result).rejects.toBe(failure);
          expect(injected).toBe(1);
          for (const close of closes) {
            expect(close).toHaveBeenCalledOnce();
          }
          expect(await fs.readFile(path, 'utf8')).toBe('original');
          expect(await fs.readdir(parent)).toEqual(['kept.env']);
        } finally {
          vi.restoreAllMocks();
          await fs.rm(dir, { recursive: true, force: true });
        }
      },
    );
  }

  it.each(['read-error', 'disappears-during-read'] as const)('cleans plaintext on preimage %s', async (stage) => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'secsync-preimage-fault-'));
    try {
      const path = join(dir, 'kept.env');
      await fs.writeFile(path, 'original');
      const failure = Object.assign(new Error('injected-content-read'), {
        code: stage === 'read-error' ? 'EIO' : 'ENOENT',
      });
      const read = fs.readFile;
      await expect(
        writeFileAtomically(dir, 'kept.env', Buffer.from('secret'), {
          expectedDestination: expectedDestinationFromBytes(Buffer.from('original')),
          hooks: {
            afterTempWrite: async () => {
              if (stage === 'disappears-during-read') {
                vi.spyOn(fs, 'readFile').mockImplementation(async () => {
                  await fs.rm(path);
                  throw failure;
                });
              } else {
                vi.spyOn(fs, 'readFile').mockRejectedValue(failure);
              }
            },
          },
        }),
      ).rejects.toMatchObject({ code: stage === 'read-error' ? 'EIO' : 'local-changed' });
      expect(await fs.readdir(dir)).toEqual(stage === 'read-error' ? ['kept.env'] : []);
      if (stage === 'read-error') {
        expect(await read(path, 'utf8')).toBe('original');
      }
    } finally {
      vi.restoreAllMocks();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('does not truncate or clean up a temp file owned by another writer', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'secsync-temp-collision-'));
    try {
      vi.spyOn(Date, 'now').mockReturnValue(123);
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const name = `${SAFE_WRITE_TEMP_PREFIX}${process.pid}-123-0.tmp`;
      await fs.writeFile(join(dir, name), 'other-writer');
      await expect(writeFileAtomically(dir, 'new.env', Buffer.from('secret'))).rejects.toMatchObject({
        code: 'EEXIST',
      });
      expect(await fs.readdir(dir)).toEqual([name]);
      expect(await fs.readFile(join(dir, name), 'utf8')).toBe('other-writer');
    } finally {
      vi.restoreAllMocks();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
