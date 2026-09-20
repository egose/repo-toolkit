import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SecretSyncError } from '../src/errors';
import { pushSecrets } from '../src/push';
import { pullSecrets } from '../src/pull';
import { restoreFile } from '../src/restore';
import { rollbackFile } from '../src/rollback';
import { switchBranch } from '../src/branches';
import { resolveFork } from '../src/resolve';
import { createBranch } from '../src/branches';
import {
  assertIdentityMatches,
  identitiesMatch,
  initState,
  loadState,
  normalizeOperationIdentity,
  readStateIfPresent,
  resolveStatePaths,
  saveState,
  setBaseline,
  setObservedHeads,
  validateRemoteIdentity,
} from '../src/state';
import { appendJournalEntry, loadJournal, recoverJournal } from '../src/journal';
import { MemoryFakeStore } from './helpers';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const PROJECT_OTHER = 'b64208df-4a95-4516-b8c7-e00621a7820c';
const ENDPOINT = 'https://connect.example';
const ENDPOINT_OTHER = 'https://other.example';
const BLOB_ID = '11111111-1111-4111-8111-000000000001';
const COMMIT_ID = '22222222-2222-4222-8222-000000000002';
const LOCAL_KEY = 'ab'.repeat(32);

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'secsync-id04-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function connectIdentity(endpoint = ENDPOINT, vaultId = 'vault-1', projectId = PROJECT_ID) {
  return { type: 'onepassword-connect' as const, endpoint, vaultId, projectId };
}

function sdkIdentity(vaultId = 'vault-1', projectId = PROJECT_ID) {
  return { type: 'onepassword-sdk' as const, vaultId, projectId };
}

function v1File(endpoint = ENDPOINT, vaultId = 'vault-1', projectId = PROJECT_ID) {
  return {
    schemaVersion: 1,
    projectId,
    remote: { endpoint, vaultId },
    activeBranch: 'main',
    materializedBranch: 'main',
    localKey: LOCAL_KEY,
    baselines: {
      '.env': {
        state: 'present',
        hmac: 'cd'.repeat(32),
        byteLength: 5,
        blobId: BLOB_ID,
        commitId: COMMIT_ID,
      },
    },
    heads: { main: [COMMIT_ID] },
    journalSeq: 0,
  };
}

async function writeV1(dir: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const paths = resolveStatePaths(dir);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(paths.dir, { recursive: true, mode: 0o700 });
  const payload = { ...v1File(), ...overrides };
  const raw = `${JSON.stringify(payload)}\n`;
  await writeFile(paths.stateFile, raw, { mode: 0o600 });
  return raw;
}

function expectCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(SecretSyncError);
  expect((error as SecretSyncError).code).toBe(code);
}

describe('legacy v1 state', () => {
  it('reads v1 as Connect with its exact endpoint binding', async () => {
    await withTempDir(async (dir) => {
      await writeV1(dir);
      const state = await loadState(dir, { endpoint: ENDPOINT, vaultId: 'vault-1', projectId: PROJECT_ID });
      expect(state.schemaVersion).toBe(2);
      expect(state.remote).toEqual({ type: 'onepassword-connect', endpoint: ENDPOINT, vaultId: 'vault-1' });
      expect(state.projectId).toBe(PROJECT_ID);
      let changed: unknown;
      try {
        await loadState(dir, { endpoint: ENDPOINT_OTHER, vaultId: 'vault-1', projectId: PROJECT_ID });
      } catch (error) {
        changed = error;
      }
      expectCode(changed, 'identity-mismatch');
    });
  });

  it('never rewrites v1 on read-only loads', async () => {
    await withTempDir(async (dir) => {
      const before = await writeV1(dir);
      await loadState(dir);
      await readStateIfPresent(dir);
      const paths = resolveStatePaths(dir);
      expect(await readFile(paths.stateFile, 'utf8')).toBe(before);
      expect(JSON.parse(before).schemaVersion).toBe(1);
    });
  });

  it('never migrates on dry runs', async () => {
    await withTempDir(async (dir) => {
      const before = await writeV1(dir);
      const store = new MemoryFakeStore();
      await writeFile(join(dir, '.env'), 'hello');
      await pushSecrets({
        store,
        rootAbsolute: dir,
        endpoint: ENDPOINT,
        vaultId: 'vault-1',
        projectId: PROJECT_ID,
        branch: 'main',
        dryRun: true,
      });
      const paths = resolveStatePaths(dir);
      expect(await readFile(paths.stateFile, 'utf8')).toBe(before);
    });
  });

  it('migrates atomically on successful state write preserving data', async () => {
    await withTempDir(async (dir) => {
      await writeV1(dir);
      await writeFile(join(dir, '.env'), 'hello');
      const store = new MemoryFakeStore();
      const pushed = await pushSecrets({
        store,
        rootAbsolute: dir,
        endpoint: ENDPOINT,
        vaultId: 'vault-1',
        projectId: PROJECT_ID,
        branch: 'main',
      });
      expect(pushed.published).toBe(true);
      const paths = resolveStatePaths(dir);
      const raw = await readFile(paths.stateFile, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed.schemaVersion).toBe(2);
      expect(parsed.remote).toEqual({ type: 'onepassword-connect', endpoint: ENDPOINT, vaultId: 'vault-1' });
      expect(parsed.localKey).toBe(LOCAL_KEY);
      expect((parsed.heads as Record<string, unknown>).main).toBeDefined();
      expect((parsed.baselines as Record<string, unknown>)['.env']).toBeDefined();
      const reloaded = await loadState(dir, connectIdentity());
      expect(reloaded.localKey).toBe(LOCAL_KEY);
      expect(reloaded.activeBranch).toBe('main');
      expect(reloaded.materializedBranch).toBe('main');
    });
  });

  it('recovers journals across an interrupted migration', async () => {
    await withTempDir(async (dir) => {
      const before = await writeV1(dir);
      const state = await loadState(dir);
      await appendJournalEntry(dir, {
        opId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
        path: '.env',
        kind: 'remove',
        timestamp: 1,
      });
      const journalsBefore = await loadJournal(dir);
      expect(journalsBefore).toHaveLength(1);
      let failed: unknown;
      try {
        await saveState(dir, state, {
          hooks: {
            beforeRename: () => {
              throw new Error('injected-before-rename');
            },
          },
        });
      } catch (error) {
        failed = error;
      }
      expect((failed as Error).message).toBe('injected-before-rename');
      const paths = resolveStatePaths(dir);
      expect(await readFile(paths.stateFile, 'utf8')).toBe(before);
      const recovered = await recoverJournal(dir, LOCAL_KEY);
      expect(recovered.pending).toHaveLength(1);
      expect(await loadJournal(dir)).toHaveLength(1);
      await saveState(dir, state);
      const after = JSON.parse(await readFile(paths.stateFile, 'utf8')) as Record<string, unknown>;
      expect(after.schemaVersion).toBe(2);
      expect(await loadJournal(dir)).toHaveLength(1);
    });
  });

  it('keeps migrated bytes after an after-rename failure', async () => {
    await withTempDir(async (dir) => {
      await writeV1(dir);
      const state = await loadState(dir);
      let failed: unknown;
      try {
        await saveState(dir, state, {
          hooks: {
            afterRename: () => {
              throw new Error('injected-after-rename');
            },
          },
        });
      } catch (error) {
        failed = error;
      }
      expect((failed as Error).message).toBe('injected-after-rename');
      const reloaded = await loadState(dir, connectIdentity());
      expect(reloaded.schemaVersion).toBe(2);
      expect(reloaded.baselines['.env']).toMatchObject({ state: 'present', blobId: BLOB_ID });
      expect(reloaded.heads.main).toEqual([COMMIT_ID]);
    });
  });
});

describe('sdk binding', () => {
  it('holds no endpoint token or session material', async () => {
    await withTempDir(async (dir) => {
      const state = await initState(dir, sdkIdentity());
      expect(state.remote).toEqual({ type: 'onepassword-sdk', vaultId: 'vault-1' });
      const paths = resolveStatePaths(dir);
      const raw = await readFile(paths.stateFile, 'utf8');
      expect(raw).not.toContain('endpoint');
      expect(raw).not.toContain('token');
      expect(raw).not.toContain('session');
      expect(raw).not.toContain('http');
    });
  });

  it('treats both auth modes as the same vault project binding', async () => {
    await withTempDir(async (dir) => {
      const first = await initState(dir, sdkIdentity());
      setBaseline(first, 'a.env', { state: 'absent' });
      setObservedHeads(first, 'main', [COMMIT_ID]);
      await saveState(dir, first);
      const viaRemote = normalizeOperationIdentity({
        remote: { type: 'onepassword-sdk', vaultId: 'vault-1' },
        projectId: PROJECT_ID,
      });
      const again = await initState(dir, viaRemote);
      expect(again.localKey).toBe(first.localKey);
      expect(again.baselines['a.env']).toEqual({ state: 'absent' });
      expect(again.heads.main).toEqual([COMMIT_ID]);
      expect(identitiesMatch(viaRemote, again)).toBe(true);
      expect(identitiesMatch(sdkIdentity(), again)).toBe(true);
    });
  });

  it('rejects provider vault and project changes', async () => {
    await withTempDir(async (dir) => {
      await initState(dir, sdkIdentity());
      for (const candidate of [
        connectIdentity(ENDPOINT, 'vault-1', PROJECT_ID),
        sdkIdentity('vault-2', PROJECT_ID),
        sdkIdentity('vault-1', PROJECT_OTHER),
      ]) {
        let caught: unknown;
        try {
          await loadState(dir, candidate);
        } catch (error) {
          caught = error;
        }
        expectCode(caught, 'identity-mismatch');
      }
    });
  });

  it('never fuzzy-matches vault names', async () => {
    await withTempDir(async (dir) => {
      await initState(dir, sdkIdentity('vault-1', PROJECT_ID));
      for (const vault of ['vault-10', 'vault-', 'Vault-1', 'vault-1 ']) {
        let caught: unknown;
        try {
          await loadState(dir, sdkIdentity(vault, PROJECT_ID));
        } catch (error) {
          caught = error;
        }
        expectCode(caught, 'identity-mismatch');
      }
    });
  });

  it('rejects sdk identities carrying connect fields', () => {
    expect(() =>
      validateRemoteIdentity({ type: 'onepassword-sdk', vaultId: 'v', projectId: PROJECT_ID, endpoint: ENDPOINT }),
    ).toThrow();
    expect(() =>
      validateRemoteIdentity({ type: 'onepassword-sdk', vaultId: 'v', projectId: PROJECT_ID, auth: {} }),
    ).toThrow();
    expect(() => validateRemoteIdentity({ type: 'onepassword-sdk', vaultId: 'v' })).toThrow();
  });
});

describe('pre-write mismatch', () => {
  it('fails push before remote or file writes', async () => {
    await withTempDir(async (dir) => {
      const store = new MemoryFakeStore();
      await writeFile(join(dir, '.env'), 'v1');
      await pushSecrets({
        store,
        rootAbsolute: dir,
        endpoint: ENDPOINT,
        vaultId: 'vault-1',
        projectId: PROJECT_ID,
        branch: 'main',
      });
      const createsBefore = store.counts.creates;
      await writeFile(join(dir, '.env'), 'v2');
      let caught: unknown;
      try {
        await pushSecrets({
          store,
          rootAbsolute: dir,
          endpoint: ENDPOINT,
          vaultId: 'vault-2',
          projectId: PROJECT_ID,
          branch: 'main',
        });
      } catch (error) {
        caught = error;
      }
      expectCode(caught, 'identity-mismatch');
      expect(store.counts.creates).toBe(createsBefore);
      expect(await readFile(join(dir, '.env'), 'utf8')).toBe('v2');
      let providerCaught: unknown;
      try {
        await pushSecrets({ store, rootAbsolute: dir, identity: sdkIdentity('vault-1', PROJECT_ID), branch: 'main' });
      } catch (error) {
        providerCaught = error;
      }
      expectCode(providerCaught, 'identity-mismatch');
      expect(store.counts.creates).toBe(createsBefore);
    });
  });

  it('fails pull restore rollback and switch before writes', async () => {
    await withTempDir(async (dir) => {
      const store = new MemoryFakeStore();
      await writeFile(join(dir, '.env'), 'v1');
      await pushSecrets({
        store,
        rootAbsolute: dir,
        endpoint: ENDPOINT,
        vaultId: 'vault-1',
        projectId: PROJECT_ID,
        branch: 'main',
      });
      const wrong = { endpoint: ENDPOINT, vaultId: 'vault-2', projectId: PROJECT_ID };
      let pullCaught: unknown;
      try {
        await pullSecrets({ store, rootAbsolute: dir, branch: 'main', ...wrong });
      } catch (error) {
        pullCaught = error;
      }
      expectCode(pullCaught, 'identity-mismatch');
      let restoreCaught: unknown;
      try {
        await restoreFile({ store, rootAbsolute: dir, branch: 'main', path: '.env', fromBranch: 'main', ...wrong });
      } catch (error) {
        restoreCaught = error;
      }
      expectCode(restoreCaught, 'identity-mismatch');
      let rollbackCaught: unknown;
      try {
        await rollbackFile({ store, rootAbsolute: dir, branch: 'main', path: '.env', revision: BLOB_ID, ...wrong });
      } catch (error) {
        rollbackCaught = error;
      }
      expectCode(rollbackCaught, 'identity-mismatch');
      let switchCaught: unknown;
      try {
        await switchBranch({ store, rootAbsolute: dir, targetBranch: 'main', ...wrong });
      } catch (error) {
        switchCaught = error;
      }
      expectCode(switchCaught, 'identity-mismatch');
    });
  });

  it('guides config-only provider changes to a fresh worktree without deleting journals', async () => {
    await withTempDir(async (dir) => {
      const store = new MemoryFakeStore();
      await writeFile(join(dir, '.env'), 'v1');
      await pushSecrets({
        store,
        rootAbsolute: dir,
        endpoint: ENDPOINT,
        vaultId: 'vault-1',
        projectId: PROJECT_ID,
        branch: 'main',
      });
      await appendJournalEntry(dir, {
        opId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
        path: '.env',
        kind: 'remove',
        timestamp: 2,
      });
      let caught: unknown;
      try {
        await pushSecrets({ store, rootAbsolute: dir, identity: sdkIdentity('vault-1', PROJECT_ID), branch: 'main' });
      } catch (error) {
        caught = error;
      }
      expectCode(caught, 'identity-mismatch');
      expect((caught as SecretSyncError).message).toMatch(/fresh worktree/);
      expect((caught as SecretSyncError).message).toMatch(/unbased-conflict/);
      expect(await loadJournal(dir)).toHaveLength(1);
      expect(await readFile(join(dir, '.env'), 'utf8')).toBe('v1');
    });
  });
});

describe('ambiguous identity forms', () => {
  it('rejects mixed old and new operation inputs', async () => {
    await withTempDir(async (dir) => {
      const store = new MemoryFakeStore();
      const base = { store, rootAbsolute: dir, branch: 'main' };
      for (const extra of [
        { endpoint: ENDPOINT, vaultId: 'vault-1', projectId: PROJECT_ID, identity: sdkIdentity() },
        { endpoint: ENDPOINT, remote: { type: 'onepassword-sdk', vaultId: 'vault-1' }, projectId: PROJECT_ID },
        { vaultId: 'vault-1', remote: { type: 'onepassword-sdk', vaultId: 'vault-1' }, projectId: PROJECT_ID },
        { identity: sdkIdentity(), projectId: PROJECT_ID },
        { remote: { type: 'onepassword-sdk', vaultId: 'vault-1' } },
      ]) {
        let caught: unknown;
        try {
          await pushSecrets({ ...base, ...(extra as Record<string, unknown>) });
        } catch (error) {
          caught = error;
        }
        expectCode(caught, 'validation');
      }
      let branchCaught: unknown;
      try {
        await createBranch({ store, rootAbsolute: dir, projectId: PROJECT_ID, name: 'next', identity: sdkIdentity() });
      } catch (error) {
        branchCaught = error;
      }
      expectCode(branchCaught, 'validation');
      let resolveCaught: unknown;
      try {
        await resolveFork({
          store,
          rootAbsolute: dir,
          projectId: PROJECT_ID,
          branch: 'main',
          heads: [COMMIT_ID, BLOB_ID],
          take: COMMIT_ID,
          identity: sdkIdentity(),
        });
      } catch (error) {
        resolveCaught = error;
      }
      expectCode(resolveCaught, 'validation');
    });
  });

  it('accepts each unambiguous form', async () => {
    await withTempDir(async (dir) => {
      const store = new MemoryFakeStore();
      await writeFile(join(dir, '.env'), 'v1');
      const legacy = await pushSecrets({
        store,
        rootAbsolute: dir,
        endpoint: ENDPOINT,
        vaultId: 'vault-1',
        projectId: PROJECT_ID,
        branch: 'main',
      });
      expect(legacy.published).toBe(true);
      const viaIdentity = normalizeOperationIdentity({ identity: connectIdentity() });
      expect(viaIdentity).toEqual(connectIdentity());
      const viaRemote = normalizeOperationIdentity({
        remote: { type: 'onepassword-connect', endpoint: ENDPOINT, vaultId: 'vault-1' },
        projectId: PROJECT_ID,
      });
      expect(viaRemote).toEqual(connectIdentity());
      const sdkViaIdentity = normalizeOperationIdentity({ identity: sdkIdentity() });
      expect(sdkViaIdentity).toEqual(sdkIdentity());
    });
  });

  it('preserves legacy connect entrypoints through the normalization boundary', async () => {
    const legacy = validateRemoteIdentity({ endpoint: ENDPOINT, vaultId: 'vault-1', projectId: PROJECT_ID });
    expect(legacy).toEqual(connectIdentity());
    await withTempDir(async (dir) => {
      const state = await initState(dir, { endpoint: ENDPOINT, vaultId: 'vault-1', projectId: PROJECT_ID });
      expect(state.remote).toEqual({ type: 'onepassword-connect', endpoint: ENDPOINT, vaultId: 'vault-1' });
      const reloaded = await loadState(dir, { endpoint: ENDPOINT, vaultId: 'vault-1', projectId: PROJECT_ID });
      expect(reloaded.localKey).toBe(state.localKey);
      assertIdentityMatches(connectIdentity(), reloaded);
    });
  });
});
