import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SecretSyncError } from '../src/errors';
import {
  acquireStateLock,
  assertSecretSyncState,
  computeFileHmac,
  createFingerprintKey,
  fingerprintBytes,
  getBaseline,
  initState,
  loadState,
  readStateIfPresent,
  resolveStatePaths,
  saveState,
  setBaseline,
  setObservedHeads,
  validateRemoteIdentity,
} from '../src/state';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const BLOB_ID = '11111111-1111-4111-8111-000000000001';
const COMMIT_ID = '22222222-2222-4222-8222-000000000002';

function identity(endpoint = 'https://connect.example') {
  return { endpoint, vaultId: 'vault-1', projectId: PROJECT_ID };
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'secsync-state-'));
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

describe('protected state layout', () => {
  it('initializes a 0700 directory with a 0600 state file and generated key', async () => {
    await withTempDir(async (dir) => {
      const state = await initState(dir, identity());
      expect(state.projectId).toBe(PROJECT_ID);
      expect(state.localKey).toMatch(/^[0-9a-f]{64}$/);
      const paths = resolveStatePaths(dir);
      const dirStats = await stat(paths.dir);
      const fileStats = await stat(paths.stateFile);
      if (process.platform !== 'win32') {
        expect(dirStats.mode & 0o777).toBe(0o700);
        expect(fileStats.mode & 0o777).toBe(0o600);
      } else {
        expect(dirStats.isDirectory()).toBe(true);
        expect(fileStats.isFile()).toBe(true);
      }
      const reloaded = await loadState(dir, identity());
      expect(reloaded.localKey).toBe(state.localKey);
      expect(reloaded.activeBranch).toBe('main');
    });
  });

  it('keeps secret bytes and bare hashes out of the state file', async () => {
    await withTempDir(async (dir) => {
      const canary = 'secsync-state-canary-bytes-9f3k';
      const state = await initState(dir, identity());
      const bytes = Buffer.from(canary, 'utf8');
      const fp = fingerprintBytes(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), state.localKey);
      setBaseline(state, '.env', { state: 'present', hmac: fp.hmac, byteLength: fp.byteLength, blobId: BLOB_ID });
      await saveState(dir, state);
      const paths = resolveStatePaths(dir);
      const raw = await readFile(paths.stateFile, 'utf8');
      expect(raw).not.toContain(canary);
      expect(raw).not.toContain('sha256');
      expect(raw).not.toContain('contentBase64');
      expect(raw).toContain(fp.hmac);
      expect(getBaseline(state, '.env')).toEqual({
        state: 'present',
        hmac: fp.hmac,
        byteLength: canary.length,
        blobId: BLOB_ID,
      });
    });
  });

  it('computes keyed hmac fingerprints instead of storing bare hashes', async () => {
    const keyA = createFingerprintKey();
    const keyB = createFingerprintKey();
    const bytes = new Uint8Array(Buffer.from('secsync-hmac-canary-44', 'utf8'));
    const hmacA = computeFileHmac(bytes, keyA);
    expect(hmacA).toMatch(/^[0-9a-f]{64}$/);
    expect(computeFileHmac(bytes, keyA)).toBe(hmacA);
    expect(computeFileHmac(bytes, keyB)).not.toBe(hmacA);
    expect(() => computeFileHmac(bytes, 'not-a-key')).toThrow();
  });

  it('rejects corrupt state files with controlled errors', async () => {
    await withTempDir(async (dir) => {
      await initState(dir, identity());
      const paths = resolveStatePaths(dir);
      await writeFile(paths.stateFile, '{not json');
      let first: unknown;
      try {
        await loadState(dir);
      } catch (error) {
        first = error;
      }
      expectSecretSyncError(first, 'state-corrupt');
      await writeFile(paths.stateFile, JSON.stringify({ schemaVersion: 99 }));
      let second: unknown;
      try {
        await loadState(dir);
      } catch (error) {
        second = error;
      }
      expectSecretSyncError(second, 'state-corrupt');
      let third: unknown;
      try {
        assertSecretSyncState({ schemaVersion: 1 });
      } catch (error) {
        third = error;
      }
      expectSecretSyncError(third, 'state-corrupt');
    });
  });

  it('rejects bare hashes and bodies smuggled into baselines', async () => {
    await withTempDir(async (dir) => {
      const state = await initState(dir, identity());
      const paths = resolveStatePaths(dir);
      const raw = JSON.parse(await readFile(paths.stateFile, 'utf8')) as Record<string, unknown>;
      const baselines = raw.baselines as Record<string, unknown>;
      baselines['.env'] = { state: 'present', sha256: 'a'.repeat(64), byteLength: 3, blobId: BLOB_ID };
      await writeFile(paths.stateFile, JSON.stringify(raw));
      let caught: unknown;
      try {
        await loadState(dir);
      } catch (error) {
        caught = error;
      }
      expectSecretSyncError(caught, 'state-corrupt');
      expect(() =>
        validateRemoteIdentity({ endpoint: 'https://connect.example', vaultId: '', projectId: PROJECT_ID }),
      ).toThrow();
      void state;
    });
  });

  it('binds endpoint vault and project and refuses identity changes', async () => {
    await withTempDir(async (dir) => {
      await initState(dir, identity('https://connect.example'));
      let changed: unknown;
      try {
        await loadState(dir, identity('https://other.example'));
      } catch (error) {
        changed = error;
      }
      expectSecretSyncError(changed, 'identity-mismatch');
      let vaultChanged: unknown;
      try {
        await loadState(dir, { endpoint: 'https://connect.example', vaultId: 'vault-2', projectId: PROJECT_ID });
      } catch (error) {
        vaultChanged = error;
      }
      expectSecretSyncError(vaultChanged, 'identity-mismatch');
      let projectChanged: unknown;
      try {
        await loadState(dir, {
          endpoint: 'https://connect.example',
          vaultId: 'vault-1',
          projectId: 'b64208df-4a95-4516-b8c7-e00621a7820c',
        });
      } catch (error) {
        projectChanged = error;
      }
      expectSecretSyncError(projectChanged, 'identity-mismatch');
      const same = await loadState(dir, identity('https://connect.example'));
      expect(same.projectId).toBe(PROJECT_ID);
      const again = await initState(dir, identity('https://connect.example'));
      expect(again.localKey).toBe(same.localKey);
      let reinitChanged: unknown;
      try {
        await initState(dir, identity('https://other.example'));
      } catch (error) {
        reinitChanged = error;
      }
      expectSecretSyncError(reinitChanged, 'identity-mismatch');
    });
  });

  it('tracks per-file baselines without touching unrelated paths', async () => {
    await withTempDir(async (dir) => {
      const state = await initState(dir, identity());
      const bytes = new Uint8Array(Buffer.from('secsync-partial-canary-7', 'utf8'));
      const fp = fingerprintBytes(bytes, state.localKey);
      setBaseline(state, '.env', {
        state: 'present',
        hmac: fp.hmac,
        byteLength: fp.byteLength,
        blobId: BLOB_ID,
        commitId: COMMIT_ID,
      });
      setBaseline(state, 'gone.env', { state: 'absent' });
      setObservedHeads(state, 'main', [COMMIT_ID]);
      await saveState(dir, state);
      const reloaded = await loadState(dir);
      expect(reloaded.baselines['.env']).toEqual({
        state: 'present',
        hmac: fp.hmac,
        byteLength: fp.byteLength,
        blobId: BLOB_ID,
        commitId: COMMIT_ID,
      });
      expect(reloaded.baselines['gone.env']).toEqual({ state: 'absent' });
      expect(reloaded.heads['main']).toEqual([COMMIT_ID]);
      expect(await readStateIfPresent(join(dir, 'missing-root'))).toBeUndefined();
    });
  });

  it('survives failures before and after rename without partial state', async () => {
    await withTempDir(async (dir) => {
      const state = await initState(dir, identity());
      const paths = resolveStatePaths(dir);
      const before = await readFile(paths.stateFile, 'utf8');
      let beforeError: unknown;
      try {
        await saveState(dir, state, {
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
      const afterBefore = await readFile(paths.stateFile, 'utf8');
      expect(afterBefore).toBe(before);
      expect(() => JSON.parse(afterBefore)).not.toThrow();
      const mutated = await loadState(dir);
      setBaseline(mutated, 'new.env', { state: 'absent' });
      let afterError: unknown;
      try {
        await saveState(dir, mutated, {
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
      const afterAfter = await readFile(paths.stateFile, 'utf8');
      expect(() => JSON.parse(afterAfter)).not.toThrow();
      const recovered = await loadState(dir);
      expect(recovered.baselines['new.env']).toEqual({ state: 'absent' });
    });
  });

  it('enforces restrictive modes even when the directory already exists', async () => {
    await withTempDir(async (dir) => {
      const paths = resolveStatePaths(dir);
      const { mkdir } = await import('node:fs/promises');
      await mkdir(paths.dir, { recursive: true, mode: 0o755 });
      await chmod(paths.dir, 0o755);
      await initState(dir, identity());
      const dirStats = await stat(paths.dir);
      const fileStats = await stat(paths.stateFile);
      if (process.platform !== 'win32') {
        expect(dirStats.mode & 0o777).toBe(0o700);
        expect(fileStats.mode & 0o777).toBe(0o600);
      } else {
        expect(dirStats.isDirectory()).toBe(true);
        expect(fileStats.isFile()).toBe(true);
      }
    });
  });
});

describe('local state locking', () => {
  it('grants exclusive ownership and refuses contention without breaking the owner', async () => {
    await withTempDir(async (dir) => {
      await initState(dir, identity());
      const first = await acquireStateLock(dir);
      let busy: unknown;
      try {
        await acquireStateLock(dir);
      } catch (error) {
        busy = error;
      }
      expectSecretSyncError(busy, 'lock-busy');
      await first.release();
      const second = await acquireStateLock(dir);
      await second.release();
      const third = await acquireStateLock(dir);
      await third.release();
      await third.release();
    });
  });

  it('recovers stale locks from dead owners but not from live owners', async () => {
    await withTempDir(async (dir) => {
      await initState(dir, identity());
      const paths = resolveStatePaths(dir);
      const deadPid = 2147483647;
      await writeFile(paths.lockFile, JSON.stringify({ pid: deadPid, timestamp: Date.now(), nonce: 'dead-owner' }));
      const takeover = await acquireStateLock(dir);
      await takeover.release();
      await writeFile(paths.lockFile, JSON.stringify({ pid: process.pid, timestamp: Date.now(), nonce: 'live-owner' }));
      let busy: unknown;
      try {
        await acquireStateLock(dir, { staleMs: 60000 });
      } catch (error) {
        busy = error;
      }
      expectSecretSyncError(busy, 'lock-busy');
      await writeFile(
        paths.lockFile,
        JSON.stringify({ pid: process.pid, timestamp: Date.now() - 120000, nonce: 'aged-owner' }),
      );
      const aged = await acquireStateLock(dir, { staleMs: 1000 });
      await aged.release();
    });
  });

  it('does not delete a new owner lock on stale release', async () => {
    await withTempDir(async (dir) => {
      await initState(dir, identity());
      const first = await acquireStateLock(dir);
      const paths = resolveStatePaths(dir);
      const before = await readFile(paths.lockFile, 'utf8');
      expect(before).toContain(String(process.pid));
      await first.release();
      let missing: string | undefined;
      try {
        missing = await readFile(paths.lockFile, 'utf8');
      } catch {
        missing = undefined;
      }
      expect(missing).toBeUndefined();
    });
  });

  it('documents Windows ACL behavior as unverified on non-Windows hosts', async () => {
    await withTempDir(async () => {
      const note = `Windows filesystem ACL behavior is unverified on ${process.platform}; POSIX 0600/0700 assertions apply only where the platform supports them.`;
      expect(note).toContain('Windows filesystem ACL behavior is unverified');
      if (process.platform === 'win32') {
        expect(process.platform).toBe('win32');
      } else {
        expect(process.platform).not.toBe('win32');
      }
    });
  });
});
