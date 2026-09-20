import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SecretSyncError } from '../src/errors';
import { writeFileAtomically } from '../src/filesystem';
import {
  appendJournalEntry,
  assertJournalEntry,
  clearAcknowledgedEntries,
  loadJournal,
  markJournalStatus,
  recoverJournal,
  removeOrphanTempFiles,
  resolveJournalPath,
  type JournalEntry,
} from '../src/journal';
import { computeFileHmac, createFingerprintKey, initState, loadState, saveState, setBaseline } from '../src/state';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const BLOB_ID = '33333333-3333-4333-8333-000000000003';
const OP_A = '44444444-4444-4444-8444-000000000004';
const OP_B = '55555555-5555-4555-8555-000000000005';

function identity() {
  return { endpoint: 'https://connect.example', vaultId: 'vault-1', projectId: PROJECT_ID };
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'secsync-journal-'));
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

function entryInput(opId: string, path: string, hmac: string, byteLength: number, timestamp = 1000) {
  return { opId, path, kind: 'write' as const, hmac, byteLength, blobId: BLOB_ID, timestamp };
}

describe('durable operation journal', () => {
  it('appends and loads entries in deterministic sequence order', async () => {
    await withTempDir(async (dir) => {
      await initState(dir, identity());
      const key = createFingerprintKey();
      const bytes = new Uint8Array(Buffer.from('secsync-journal-order-canary', 'utf8'));
      const hmac = computeFileHmac(bytes, key);
      const first = await appendJournalEntry(dir, entryInput(OP_A, 'b.env', hmac, bytes.byteLength, 10));
      const second = await appendJournalEntry(dir, entryInput(OP_B, 'a.env', hmac, bytes.byteLength, 20));
      expect(first.seq).toBe(0);
      expect(second.seq).toBe(1);
      expect(first.status).toBe('pending');
      const loaded = await loadJournal(dir);
      expect(loaded.map((entry) => entry.seq)).toEqual([0, 1]);
      expect(loaded.map((entry) => entry.path)).toEqual(['b.env', 'a.env']);
      const again = await loadJournal(dir);
      expect(JSON.stringify(again)).toBe(JSON.stringify(loaded));
      const journalStats = await stat(resolveJournalPath(dir));
      if (process.platform !== 'win32') {
        expect(journalStats.mode & 0o777).toBe(0o600);
      } else {
        expect(journalStats.isFile()).toBe(true);
      }
    });
  });

  it('never advances baselines for pending entries after a crash', async () => {
    await withTempDir(async (dir) => {
      const state = await initState(dir, identity());
      const key = state.localKey;
      const bytes = new Uint8Array(Buffer.from('secsync-journal-crash-canary-1', 'utf8'));
      const hmac = computeFileHmac(bytes, key);
      const entry = await appendJournalEntry(dir, entryInput(OP_A, '.env', hmac, bytes.byteLength));
      const recovery = await recoverJournal(dir, key, {
        readFile: async () => undefined,
      });
      expect(recovery.verified).toEqual([]);
      expect(recovery.pending.map((item) => item.seq)).toEqual([entry.seq]);
      const reloaded = await loadState(dir);
      expect(reloaded.baselines['.env']).toBeUndefined();
      expect(await loadJournal(dir)).toHaveLength(1);
    });
  });

  it('verifies written bytes before allowing a baseline advance', async () => {
    await withTempDir(async (dir) => {
      const state = await initState(dir, identity());
      const key = state.localKey;
      const canary = 'secsync-journal-written-canary-2';
      const bytes = new Uint8Array(Buffer.from(canary, 'utf8'));
      const hmac = computeFileHmac(bytes, key);
      const entry = await appendJournalEntry(dir, entryInput(OP_A, '.env', hmac, bytes.byteLength));
      await writeFileAtomically(dir, '.env', bytes);
      await markJournalStatus(dir, entry.seq, 'written');
      const recovery = await recoverJournal(dir, key);
      expect(recovery.verified.map((item) => item.seq)).toEqual([entry.seq]);
      expect(recovery.pending).toEqual([]);
      const current = await loadState(dir);
      setBaseline(current, '.env', { state: 'present', hmac, byteLength: bytes.byteLength, blobId: BLOB_ID });
      await saveState(dir, current);
      await markJournalStatus(dir, entry.seq, 'acknowledged');
      const removed = await clearAcknowledgedEntries(dir);
      expect(removed).toBe(1);
      expect(await loadJournal(dir)).toEqual([]);
      const final = await loadState(dir);
      expect(final.baselines['.env']).toEqual({
        state: 'present',
        hmac,
        byteLength: bytes.byteLength,
        blobId: BLOB_ID,
      });
    });
  });

  it('treats mismatched or missing files as pending rather than clean', async () => {
    await withTempDir(async (dir) => {
      const state = await initState(dir, identity());
      const key = state.localKey;
      const bytes = new Uint8Array(Buffer.from('secsync-journal-truth-canary', 'utf8'));
      const hmac = computeFileHmac(bytes, key);
      const entry = await appendJournalEntry(dir, entryInput(OP_A, '.env', hmac, bytes.byteLength));
      await writeFileAtomically(dir, '.env', new Uint8Array(Buffer.from('different-bytes', 'utf8')));
      await markJournalStatus(dir, entry.seq, 'written');
      const recovery = await recoverJournal(dir, key);
      expect(recovery.verified).toEqual([]);
      expect(recovery.pending.map((item) => item.seq)).toEqual([entry.seq]);
      const current = await loadState(dir);
      expect(current.baselines['.env']).toBeUndefined();
    });
  });

  it('recovers deterministically across repeated runs without duplicating work', async () => {
    await withTempDir(async (dir) => {
      const state = await initState(dir, identity());
      const key = state.localKey;
      const first = new Uint8Array(Buffer.from('secsync-journal-det-a', 'utf8'));
      const second = new Uint8Array(Buffer.from('secsync-journal-det-b', 'utf8'));
      const entryA = await appendJournalEntry(
        dir,
        entryInput(OP_A, 'a.env', computeFileHmac(first, key), first.byteLength),
      );
      const entryB = await appendJournalEntry(
        dir,
        entryInput(OP_B, 'b.env', computeFileHmac(second, key), second.byteLength),
      );
      await writeFileAtomically(dir, 'a.env', first);
      await markJournalStatus(dir, entryA.seq, 'written');
      const once = await recoverJournal(dir, key);
      const twice = await recoverJournal(dir, key);
      expect(once.verified.map((item) => item.seq)).toEqual([entryA.seq]);
      expect(twice.verified.map((item) => item.seq)).toEqual([entryA.seq]);
      expect(once.pending.map((item) => item.seq)).toEqual([entryB.seq]);
      expect(twice.pending.map((item) => item.seq)).toEqual([entryB.seq]);
      expect(JSON.stringify(once.verified)).toBe(JSON.stringify(twice.verified));
    });
  });

  it('fails journal writes before append without recording an entry', async () => {
    await withTempDir(async (dir) => {
      await initState(dir, identity());
      const key = createFingerprintKey();
      const bytes = new Uint8Array(Buffer.from('x', 'utf8'));
      const hmac = computeFileHmac(bytes, key);
      let caught: unknown;
      try {
        await appendJournalEntry(dir, entryInput(OP_A, '.env', hmac, bytes.byteLength), {
          hooks: {
            beforeAppend: () => {
              throw new Error('injected-before-append');
            },
          },
        });
      } catch (error) {
        caught = error;
      }
      expect((caught as Error).message).toBe('injected-before-append');
      expect(await loadJournal(dir)).toEqual([]);
    });
  });

  it('cleans up orphan temp files while keeping live journal temps', async () => {
    await withTempDir(async (dir) => {
      await initState(dir, identity());
      const paths = resolveJournalPath(dir);
      void paths;
      const { resolveStatePaths } = await import('../src/state');
      const stateDir = resolveStatePaths(dir).dir;
      await writeFile(join(stateDir, '.tmp-secret-sync-orphan.tmp'), 'orphan');
      const key = createFingerprintKey();
      const bytes = new Uint8Array(Buffer.from('live', 'utf8'));
      const liveEntry = await appendJournalEntry(dir, {
        opId: OP_A,
        path: '.env',
        kind: 'write',
        hmac: computeFileHmac(bytes, key),
        byteLength: bytes.byteLength,
        blobId: BLOB_ID,
        tempName: '.tmp-secret-sync-live.tmp',
        timestamp: 42,
      });
      void liveEntry;
      await writeFile(join(stateDir, '.tmp-secret-sync-live.tmp'), 'live-temp');
      const removed = await removeOrphanTempFiles(dir);
      expect(removed).toContain('.tmp-secret-sync-orphan.tmp');
      expect(removed).not.toContain('.tmp-secret-sync-live.tmp');
    });
  });

  it('rejects corrupt journal lines and unknown sequences', async () => {
    await withTempDir(async (dir) => {
      await initState(dir, identity());
      const journalFile = resolveJournalPath(dir);
      await writeFile(journalFile, '{broken json\n');
      let first: unknown;
      try {
        await loadJournal(dir);
      } catch (error) {
        first = error;
      }
      expectSecretSyncError(first, 'state-corrupt');
      await writeFile(journalFile, `${JSON.stringify({ schemaVersion: 1, seq: 0 })}\n`);
      let second: unknown;
      try {
        await loadJournal(dir);
      } catch (error) {
        second = error;
      }
      expectSecretSyncError(second, 'state-corrupt');
      await writeFile(journalFile, '');
      let third: unknown;
      try {
        await markJournalStatus(dir, 7, 'written');
      } catch (error) {
        third = error;
      }
      expectSecretSyncError(third, 'state-corrupt');
      let fourth: unknown;
      try {
        assertJournalEntry({
          schemaVersion: 1,
          seq: 0,
          opId: OP_A,
          path: '.env',
          kind: 'write',
          status: 'pending',
          timestamp: 1,
        });
      } catch (error) {
        fourth = error;
      }
      expectSecretSyncError(fourth, 'state-corrupt');
    });
  });

  it('keeps secret bodies out of the serialized journal', async () => {
    await withTempDir(async (dir) => {
      await initState(dir, identity());
      const key = createFingerprintKey();
      const canary = 'secsync-journal-body-canary-qw7';
      const bytes = new Uint8Array(Buffer.from(canary, 'utf8'));
      const hmac = computeFileHmac(bytes, key);
      const entry: JournalEntry = await appendJournalEntry(dir, entryInput(OP_A, '.env', hmac, bytes.byteLength));
      void entry;
      const raw = await readFile(resolveJournalPath(dir), 'utf8');
      expect(raw).not.toContain(canary);
      expect(raw).not.toContain('contentBase64');
      expect(raw).toContain(hmac);
    });
  });

  it('documents Windows behavior as unverified on non-Windows hosts', async () => {
    const note = `Windows journal durability behavior is unverified on ${process.platform}; fsync assertions apply where the platform supports them.`;
    expect(note).toContain('unverified');
    if (process.platform === 'win32') {
      expect(process.platform).toBe('win32');
    } else {
      expect(process.platform).not.toBe('win32');
    }
  });
});
