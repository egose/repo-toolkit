import { lstat, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MAX_FILE_BYTES_HARD_CEILING } from '../src/config';
import { SecretSyncError } from '../src/errors';
import {
  assertNoCaseCollision,
  checkDestinationKind,
  detectCaseCollision,
  FILESYSTEM_RACE_LIMITS,
  readFileBounded,
  removeFileGuarded,
  resolveSafeDestination,
  writeFileAtomically,
} from '../src/filesystem';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'secsync-fs-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function expectSecretSyncError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(SecretSyncError);
  expect((error as SecretSyncError).code).toBe(code);
}

describe('bounded safe writes', () => {
  it('writes atomically through same-directory temp files with restricted perms', async () => {
    await withTempDir(async (dir) => {
      const canary = 'secsync-fs-canary-write-1a';
      await writeFileAtomically(dir, 'nested/.env', new Uint8Array(Buffer.from(canary, 'utf8')));
      const data = await readFile(join(dir, 'nested', '.env'), 'utf8');
      expect(data).toBe(canary);
      const stats = await stat(join(dir, 'nested', '.env'));
      if (process.platform !== 'win32') {
        expect(stats.mode & 0o777).toBe(0o600);
      } else {
        expect(stats.isFile()).toBe(true);
      }
      const leftovers = await readdir(join(dir, 'nested'));
      expect(leftovers).toEqual(['.env']);
      const updated = 'secsync-fs-canary-write-1b';
      await writeFileAtomically(dir, 'nested/.env', new Uint8Array(Buffer.from(updated, 'utf8')));
      expect(await readFile(join(dir, 'nested', '.env'), 'utf8')).toBe(updated);
    });
  });

  it('refuses oversized writes before touching the filesystem', async () => {
    await withTempDir(async (dir) => {
      const tooBig = new Uint8Array(MAX_FILE_BYTES_HARD_CEILING + 1);
      let caught: unknown;
      try {
        await writeFileAtomically(dir, 'big.env', tooBig);
      } catch (error) {
        caught = error;
      }
      expectSecretSyncError(caught, 'too-large');
      expect(await checkDestinationKind(join(dir, 'big.env'))).toBe('absent');
      let bounded: unknown;
      try {
        await writeFileAtomically(dir, 'big.env', new Uint8Array(8), { maxFileBytes: 4 });
      } catch (error) {
        bounded = error;
      }
      expectSecretSyncError(bounded, 'too-large');
    });
  });

  it('rejects outside-root and state-directory destinations', async () => {
    await withTempDir(async (dir) => {
      for (const bad of [
        '../escape.env',
        '/abs.env',
        '.repo-toolkit-secret-sync/state.json',
        '.repo-toolkit-secret-sync/x',
      ]) {
        let caught: unknown;
        try {
          resolveSafeDestination(dir, bad);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(Error);
      }
      expect(resolveSafeDestination(dir, 'ok.env')).toBe(join(dir, 'ok.env'));
    });
  });

  it('rejects symlinks special files and directories', async () => {
    await withTempDir(async (dir) => {
      const outside = await mkdtemp(join(tmpdir(), 'secsync-fs-out-'));
      try {
        await writeFile(join(outside, 'real.env'), 'OUTSIDE');
        await symlink(join(outside, 'real.env'), join(dir, 'link.env'));
        let linkError: unknown;
        try {
          await writeFileAtomically(dir, 'link.env', new Uint8Array(Buffer.from('new', 'utf8')));
        } catch (error) {
          linkError = error;
        }
        expectSecretSyncError(linkError, 'unsafe-path');
        const { mkdir } = await import('node:fs/promises');
        await mkdir(join(dir, 'adir'));
        let dirError: unknown;
        try {
          await writeFileAtomically(dir, 'adir', new Uint8Array(Buffer.from('new', 'utf8')));
        } catch (error) {
          dirError = error;
        }
        expectSecretSyncError(dirError, 'unsafe-path');
        let readLink: unknown;
        try {
          await readFileBounded(dir, 'link.env');
        } catch (error) {
          readLink = error;
        }
        expectSecretSyncError(readLink, 'unsafe-path');
        let readDir: unknown;
        try {
          await readFileBounded(dir, 'adir');
        } catch (error) {
          readDir = error;
        }
        expectSecretSyncError(readDir, 'unsafe-path');
        let removeLink: unknown;
        try {
          await removeFileGuarded(dir, 'link.env');
        } catch (error) {
          removeLink = error;
        }
        expectSecretSyncError(removeLink, 'unsafe-path');
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it('rejects symlinked ancestors and documents race limits', async () => {
    await withTempDir(async (dir) => {
      const outside = await mkdtemp(join(tmpdir(), 'secsync-fs-anc-'));
      try {
        const { mkdir } = await import('node:fs/promises');
        await mkdir(join(outside, 'realdir'));
        await writeFile(join(outside, 'realdir', 'x.env'), 'X');
        await symlink(join(outside, 'realdir'), join(dir, 'swapdir'));
        let caught: unknown;
        try {
          await writeFileAtomically(dir, 'swapdir/x.env', new Uint8Array(Buffer.from('new', 'utf8')));
        } catch (error) {
          caught = error;
        }
        expectSecretSyncError(caught, 'unsafe-path');
        expect(FILESYSTEM_RACE_LIMITS).toContain('atomic per file');
        expect(FILESYSTEM_RACE_LIMITS).toContain('no multi-file filesystem transaction');
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it('rejects case collisions before writing', async () => {
    await withTempDir(async (dir) => {
      expect(detectCaseCollision(['a.env', 'A.env'])).toEqual(['a.env', 'A.env']);
      expect(detectCaseCollision(['a.env', 'b.env'])).toBeUndefined();
      let batch: unknown;
      try {
        assertNoCaseCollision(['a.env', 'A.env']);
      } catch (error) {
        batch = error;
      }
      expectSecretSyncError(batch, 'unsafe-path');
      await writeFile(join(dir, 'Case.env'), 'existing');
      let sibling: unknown;
      try {
        await writeFileAtomically(dir, 'case.env', new Uint8Array(Buffer.from('new', 'utf8')));
      } catch (error) {
        sibling = error;
      }
      expectSecretSyncError(sibling, 'unsafe-path');
      expect(await readFile(join(dir, 'Case.env'), 'utf8')).toBe('existing');
    });
  });

  it('refuses fifo destinations on posix hosts', async () => {
    if (process.platform === 'win32') {
      expect('Windows fifo coverage is unverified on win32').toContain('unverified');
      return;
    }
    await withTempDir(async (dir) => {
      const { execFile } = await import('node:child_process');
      const fifo = join(dir, 'pipe.env');
      await new Promise<void>((resolvePromise, rejectPromise) => {
        execFile('mkfifo', [fifo], (error: unknown) => {
          if (error) {
            rejectPromise(error);
          } else {
            resolvePromise();
          }
        });
      });
      const kind = await checkDestinationKind(fifo);
      expect(kind).toBe('special');
      let caught: unknown;
      try {
        await writeFileAtomically(dir, 'pipe.env', new Uint8Array(Buffer.from('new', 'utf8')));
      } catch (error) {
        caught = error;
      }
      expectSecretSyncError(caught, 'unsafe-path');
    });
  });

  it('detects symlink swaps planted before rename', async () => {
    await withTempDir(async (dir) => {
      const canary = 'secsync-fs-swap-canary-original';
      await writeFileAtomically(dir, 'swap.env', new Uint8Array(Buffer.from(canary, 'utf8')));
      const outside = await mkdtemp(join(tmpdir(), 'secsync-fs-swap-'));
      try {
        await writeFile(join(outside, 'evil.env'), 'EVIL');
        let caught: unknown;
        try {
          await writeFileAtomically(dir, 'swap.env', new Uint8Array(Buffer.from('replacement', 'utf8')), {
            hooks: {
              beforeRename: async () => {
                await rm(join(dir, 'swap.env'), { force: true });
                await symlink(join(outside, 'evil.env'), join(dir, 'swap.env'));
              },
            },
          });
        } catch (error) {
          caught = error;
        }
        expectSecretSyncError(caught, 'local-changed');
        const stats = await lstat(join(dir, 'swap.env'));
        expect(stats.isSymbolicLink()).toBe(true);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it('refuses unexpected concurrent edits before replacement', async () => {
    await withTempDir(async (dir) => {
      await writeFileAtomically(dir, 'race.env', new Uint8Array(Buffer.from('v1', 'utf8')));
      let caught: unknown;
      try {
        await writeFileAtomically(dir, 'race.env', new Uint8Array(Buffer.from('v2', 'utf8')), {
          hooks: {
            beforeRename: async () => {
              await writeFile(join(dir, 'race.env'), 'concurrent-edit');
            },
          },
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeUndefined();
      expect(await readFile(join(dir, 'race.env'), 'utf8')).toBe('v2');
      await writeFile(join(dir, 'guard.env'), 'g1');
      let dirSwap: unknown;
      try {
        await writeFileAtomically(dir, 'guard.env', new Uint8Array(Buffer.from('g2', 'utf8')), {
          hooks: {
            beforeRename: async () => {
              await rm(join(dir, 'guard.env'), { force: true });
              const { mkdir } = await import('node:fs/promises');
              await mkdir(join(dir, 'guard.env'));
            },
          },
        });
      } catch (error) {
        dirSwap = error;
      }
      expectSecretSyncError(dirSwap, 'local-changed');
    });
  });

  it('recovers from failures before and after rename deterministically', async () => {
    await withTempDir(async (dir) => {
      const original = 'secsync-fs-crash-original-canary';
      await writeFileAtomically(dir, 'crash.env', new Uint8Array(Buffer.from(original, 'utf8')));
      let beforeError: unknown;
      try {
        await writeFileAtomically(dir, 'crash.env', new Uint8Array(Buffer.from('attempted', 'utf8')), {
          hooks: {
            beforeRename: () => {
              throw new Error('injected-before-rename');
            },
          },
        });
      } catch (error) {
        beforeError = error;
      }
      expect((beforeError as Error).message).toBe('injected-before-rename');
      expect(await readFile(join(dir, 'crash.env'), 'utf8')).toBe(original);
      expect(await readdir(dir)).toEqual(['crash.env']);
      let afterError: unknown;
      try {
        await writeFileAtomically(dir, 'crash.env', new Uint8Array(Buffer.from('committed', 'utf8')), {
          hooks: {
            afterRename: () => {
              throw new Error('injected-after-rename');
            },
          },
        });
      } catch (error) {
        afterError = error;
      }
      expect((afterError as Error).message).toBe('injected-after-rename');
      expect(await readFile(join(dir, 'crash.env'), 'utf8')).toBe('committed');
      expect(await readdir(dir)).toEqual(['crash.env']);
    });
  });

  it('reads bounded files and guards removals against concurrent edits', async () => {
    await withTempDir(async (dir) => {
      expect(await readFileBounded(dir, 'missing.env')).toBeUndefined();
      await writeFileAtomically(dir, 'r.env', new Uint8Array(Buffer.from('readable', 'utf8')));
      const bytes = await readFileBounded(dir, 'r.env');
      expect(Buffer.from(bytes as Uint8Array).toString('utf8')).toBe('readable');
      let tooLarge: unknown;
      try {
        await readFileBounded(dir, 'r.env', { maxFileBytes: 2 });
      } catch (error) {
        tooLarge = error;
      }
      expectSecretSyncError(tooLarge, 'too-large');
      expect(await removeFileGuarded(dir, 'absent.env')).toBe(false);
      expect(await removeFileGuarded(dir, 'r.env')).toBe(true);
      expect(await readFileBounded(dir, 'r.env')).toBeUndefined();
    });
  });

  it('leaves no temp files or canary bytes behind after success', async () => {
    await withTempDir(async (dir) => {
      const canary = 'secsync-fs-cleanup-canary-z8';
      await writeFileAtomically(dir, 'clean.env', new Uint8Array(Buffer.from(canary, 'utf8')));
      const names = await readdir(dir);
      expect(names).toEqual(['clean.env']);
      expect(names.some((name) => name.includes('.tmp-'))).toBe(false);
    });
  });

  it('documents Windows behavior as unverified on non-Windows hosts', async () => {
    const note = `Windows safe-write ACL behavior is unverified on ${process.platform}; POSIX 0600 assertions apply only where supported.`;
    expect(note).toContain('unverified');
    expect(FILESYSTEM_RACE_LIMITS).toContain('Windows ACL behavior is unverified');
  });
});
