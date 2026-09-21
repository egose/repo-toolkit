import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createBranch, listBranches, switchBranch } from '../src/branches';
import { ConnectSecretStore, createConnectStore } from '../src/connect';
import { SecretSyncError } from '../src/errors';
import { loadValidatedHistory, publishSnapshot } from '../src/history-store';
import { loadJournal } from '../src/journal';
import { loadBranchHistory } from '../src/operations';
import { pullSecrets } from '../src/pull';
import { pushSecrets } from '../src/push';
import { decodeRecordEnvelope } from '../src/records';
import { resolveFork } from '../src/resolve';
import { rollbackFile } from '../src/rollback';
import { createSdkStore } from '../src/sdk';
import { getBaseline, loadState, readStateIfPresent } from '../src/state';
import type { ConnectItemDetail, CreateItemResult, SecretItemDetail, SecretStore } from '../src/store';
import type { FetchResponseLike } from '../src/connect';
import type { SdkClientFactory, SdkClientLike, SdkCreateParams, SdkItemLike, SdkOverviewLike } from '../src/sdk';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const SDK_VAULT = 'vault-workflow-sdk';
const CONNECT_VAULT = 'vault-workflow-connect';
const ENDPOINT = 'https://connect.example';
const TOKEN_ENV = 'OP_SERVICE_ACCOUNT_TOKEN';
const ACCOUNT = 'workflow-account';

type PushOpts = Parameters<typeof pushSecrets>[0];
type PullOpts = Parameters<typeof pullSecrets>[0];
type RollbackOpts = Parameters<typeof rollbackFile>[0];

function testUuid(tag: number): string {
  const tail = tag.toString(16).padStart(12, '0');
  return `bbbbbbbb-bbbb-4bbb-8bbb-${tail}`;
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'secsync-workflow-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeBytes(dir: string, rel: string, bytes: Uint8Array): Promise<void> {
  await writeFile(join(dir, ...rel.split('/')), Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
}

async function readBytes(dir: string, rel: string): Promise<Uint8Array> {
  const data = await readFile(join(dir, ...rel.split('/')));
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

interface SdkFakeItem {
  id: string;
  title: string;
  vaultId: string;
  tags: string[];
  fields: Array<{ id: string; title: string; sectionId?: string; fieldType: string; value: string }>;
}

interface SdkHarness {
  items: Map<string, SdkFakeItem>;
  calls: { lists: number; gets: number; creates: number; factories: number };
  factory: SdkClientFactory;
  uncertainRemaining: number;
  listError: unknown;
}

function createSdkHarness(): SdkHarness {
  const items = new Map<string, SdkFakeItem>();
  const calls = { lists: 0, gets: 0, creates: 0, factories: 0 };
  const harness: SdkHarness = {
    items,
    calls,
    uncertainRemaining: 0,
    listError: undefined,
    factory: async (config) => {
      calls.factories += 1;
      const client: SdkClientLike = {
        items: {
          async list(vaultId: string): Promise<SdkOverviewLike[]> {
            calls.lists += 1;
            if (harness.listError !== undefined) {
              throw harness.listError;
            }
            const result: SdkOverviewLike[] = [];
            for (const item of items.values()) {
              if (item.vaultId !== vaultId) {
                continue;
              }
              result.push({
                id: item.id,
                title: item.title,
                category: 'SecureNote',
                vaultId: item.vaultId,
                tags: [...item.tags],
                state: 'active',
              });
            }
            return result;
          },
          async get(vaultId: string, itemId: string): Promise<SdkItemLike> {
            calls.gets += 1;
            const hit = items.get(itemId);
            if (hit === undefined || hit.vaultId !== vaultId) {
              throw new Error(`item not found: ${itemId}`);
            }
            return {
              id: hit.id,
              title: hit.title,
              category: 'SecureNote',
              vaultId: hit.vaultId,
              tags: [...hit.tags],
              fields: hit.fields.map((field) => ({ ...field })),
            };
          },
          async create(params: SdkCreateParams): Promise<SdkItemLike> {
            calls.creates += 1;
            const id = `sdk-item-${calls.creates}`;
            const stored: SdkFakeItem = {
              id,
              title: params.title,
              vaultId: params.vaultId,
              tags: [...params.tags],
              fields: params.fields.map((field) => ({ ...field })),
            };
            items.set(id, stored);
            if (harness.uncertainRemaining > 0) {
              harness.uncertainRemaining -= 1;
              throw new Error('request timeout after commit');
            }
            return {
              id,
              title: stored.title,
              category: 'SecureNote',
              vaultId: stored.vaultId,
              tags: [...stored.tags],
              fields: stored.fields.map((field) => ({ ...field })),
            };
          },
        },
      };
      void config;
      return client;
    },
  };
  return harness;
}

interface ConnectHarness {
  items: Map<string, ConnectItemDetail>;
  counts: { fetches: number; lists: number; gets: number; creates: number };
  uncertainRemaining: number;
  listStatus: number;
  fetch: (url: string, init?: { method?: string; body?: string }) => Promise<FetchResponseLike>;
}

function headersStub(): { get: (name: string) => string | null } {
  return {
    get: () => null,
  };
}

function unescapeFilterValue(value: string): string {
  let out = '';
  let escaped = false;
  for (const ch of value) {
    if (escaped) {
      out += ch;
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
    } else {
      out += ch;
    }
  }
  return out;
}

function createConnectHarness(): ConnectHarness {
  const items = new Map<string, ConnectItemDetail>();
  const counts = { fetches: 0, lists: 0, gets: 0, creates: 0 };
  let counter = 0;
  const harness: ConnectHarness = {
    items,
    counts,
    uncertainRemaining: 0,
    listStatus: 200,
    fetch: async (url: string, init?: { method?: string; body?: string }) => {
      counts.fetches += 1;
      const parsed = new URL(url);
      const method = init?.method ?? 'GET';
      const segments = parsed.pathname.split('/').filter((part) => part.length > 0);
      const itemsIndex = segments.lastIndexOf('items');
      if (method === 'POST' && itemsIndex === segments.length - 1) {
        counts.creates += 1;
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          title: string;
          category: string;
          tags: string[];
          fields: ConnectItemDetail['fields'];
        };
        counter += 1;
        const id = `provider-c-${counter}`;
        const detail: ConnectItemDetail = {
          id,
          title: body.title,
          tags: [...body.tags],
          category: body.category,
          fields: body.fields.map((field) => ({ ...field })),
        };
        items.set(id, detail);
        if (harness.uncertainRemaining > 0) {
          harness.uncertainRemaining -= 1;
          return { status: 500, headers: headersStub(), text: async () => '{}' };
        }
        return { status: 201, headers: headersStub(), text: async () => JSON.stringify(detail) };
      }
      if (method === 'GET' && itemsIndex === segments.length - 1) {
        counts.lists += 1;
        if (harness.listStatus !== 200) {
          return { status: harness.listStatus, headers: headersStub(), text: async () => '{}' };
        }
        const filter = parsed.searchParams.get('filter');
        let summaries = [...items.values()].map((detail) => ({
          id: detail.id,
          title: detail.title,
          tags: [...detail.tags],
          category: detail.category,
        }));
        if (filter !== null && filter.startsWith('title eq "') && filter.endsWith('"')) {
          const wanted = unescapeFilterValue(filter.slice('title eq "'.length, -1));
          summaries = summaries.filter((entry) => entry.title === wanted);
        }
        return { status: 200, headers: headersStub(), text: async () => JSON.stringify(summaries) };
      }
      if (method === 'GET' && itemsIndex === segments.length - 2) {
        counts.gets += 1;
        const id = decodeURIComponent(segments[segments.length - 1] as string);
        const hit = items.get(id);
        if (hit === undefined) {
          return { status: 404, headers: headersStub(), text: async () => '{}' };
        }
        return { status: 200, headers: headersStub(), text: async () => JSON.stringify(hit) };
      }
      return { status: 400, headers: headersStub(), text: async () => '{}' };
    },
  };
  return harness;
}

interface Backend {
  store: SecretStore;
  creates: () => number;
  lists: () => number;
  gets: () => number;
  inits: () => number;
  useIdentity: () => boolean;
  pushOpts: (dir: string, extra?: Record<string, unknown>) => PushOpts;
  pullOpts: (dir: string, extra?: Record<string, unknown>) => PullOpts;
  rollbackOpts: (dir: string, path: string, revision: string, extra?: Record<string, unknown>) => RollbackOpts;
  projectId: () => string;
  stateRef: () => Record<string, unknown>;
  idem: () => Record<string, unknown>;
}

function makeSdkBackend(
  variant: 'service-account' | 'desktop',
  harness?: SdkHarness,
): Backend & { harness: SdkHarness } {
  const active = harness ?? createSdkHarness();
  const auth =
    variant === 'service-account'
      ? ({ type: 'service-account', tokenEnv: TOKEN_ENV } as const)
      : ({ type: 'desktop', account: ACCOUNT } as const);
  const env = variant === 'service-account' ? { [TOKEN_ENV]: 'workflow-token' } : {};
  const store = createSdkStore({
    vaultId: SDK_VAULT,
    auth: { ...auth },
    env,
    clientFactory: active.factory,
    sleep: () => Promise.resolve(),
  });
  const identity = { type: 'onepassword-sdk', vaultId: SDK_VAULT, projectId: PROJECT_ID };
  return {
    harness: active,
    store,
    creates: () => active.calls.creates,
    lists: () => active.calls.lists,
    gets: () => active.calls.gets,
    inits: () => active.calls.factories,
    useIdentity: () => true,
    projectId: () => PROJECT_ID,
    stateRef: () => ({ type: 'onepassword-sdk', vaultId: SDK_VAULT, projectId: PROJECT_ID }),
    idem: () => ({ identity: { type: 'onepassword-sdk', vaultId: SDK_VAULT, projectId: PROJECT_ID } }),
    pushOpts: (dir, extra = {}) =>
      ({ store, rootAbsolute: dir, branch: 'main', identity, ...extra }) as unknown as PushOpts,
    pullOpts: (dir, extra = {}) =>
      ({ store, rootAbsolute: dir, branch: 'main', identity, ...extra }) as unknown as PullOpts,
    rollbackOpts: (dir, path, revision, extra = {}) =>
      ({ store, rootAbsolute: dir, branch: 'main', path, revision, identity, ...extra }) as unknown as RollbackOpts,
  };
}

function makeConnectBackend(harness?: ConnectHarness): Backend & { harness: ConnectHarness } {
  const active = harness ?? createConnectHarness();
  const store = createConnectStore({
    vaultId: CONNECT_VAULT,
    env: { OP_CONNECT_HOST: ENDPOINT, OP_CONNECT_TOKEN: 'workflow-token' },
    fetchImpl: active.fetch as ConnectSecretStore extends never
      ? never
      : Parameters<typeof createConnectStore>[0]['fetchImpl'],
    sleep: () => Promise.resolve(),
  });
  return {
    harness: active,
    store,
    creates: () => active.counts.creates,
    lists: () => active.counts.lists,
    gets: () => active.counts.gets,
    inits: () => 0,
    useIdentity: () => false,
    projectId: () => PROJECT_ID,
    stateRef: () => ({ endpoint: ENDPOINT, vaultId: CONNECT_VAULT, projectId: PROJECT_ID }),
    idem: () => ({}),
    pushOpts: (dir, extra = {}) =>
      ({
        store,
        rootAbsolute: dir,
        branch: 'main',
        endpoint: ENDPOINT,
        vaultId: CONNECT_VAULT,
        projectId: PROJECT_ID,
        ...extra,
      }) as unknown as PushOpts,
    pullOpts: (dir, extra = {}) =>
      ({
        store,
        rootAbsolute: dir,
        branch: 'main',
        endpoint: ENDPOINT,
        vaultId: CONNECT_VAULT,
        projectId: PROJECT_ID,
        ...extra,
      }) as unknown as PullOpts,
    rollbackOpts: (dir, path, revision, extra = {}) =>
      ({
        store,
        rootAbsolute: dir,
        branch: 'main',
        path,
        revision,
        endpoint: ENDPOINT,
        vaultId: CONNECT_VAULT,
        projectId: PROJECT_ID,
        ...extra,
      }) as unknown as RollbackOpts,
  };
}

async function exportDetails(store: SecretStore): Promise<SecretItemDetail[]> {
  const summaries = await store.listItems();
  const details: SecretItemDetail[] = [];
  for (const summary of summaries) {
    details.push(await store.getItem(summary.id));
  }
  return details;
}

async function importDetails(store: SecretStore, details: SecretItemDetail[]): Promise<void> {
  const sorted = [...details].sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  for (const detail of sorted) {
    const result: CreateItemResult = await store.createItem({
      title: detail.title,
      category: detail.category,
      tags: [...detail.tags],
      fields: detail.fields.map((field) => ({ ...field })),
    });
    if (result.status !== 'created') {
      throw new Error('interop seeding must create every record');
    }
  }
}

function historySignature(details: SecretItemDetail[], projectId: string): string[] {
  const envelopes = details.map((detail) => decodeRecordEnvelope(detail, projectId));
  const parts = envelopes.map((envelope) => {
    if (envelope.kind === 'blob') {
      return `blob:${envelope.logicalId}:${envelope.sha256}:${envelope.byteLength}`;
    }
    const tree = envelope.tree.map((entry) => `${entry.path}=${entry.blobId}`).join(',');
    return `commit:${envelope.logicalId}:${envelope.branch}:${envelope.parents.slice().sort().join('+')}:${tree}`;
  });
  return parts.sort();
}

function defineWorkflowSuite(name: string, make: () => Backend): void {
  describe(`shared workflow (${name})`, () => {
    it('pushes and pulls empty, binary, and CRLF files with exact bytes', async () => {
      await withTempDir(async (cloneA) => {
        await withTempDir(async (cloneB) => {
          const backend = make();
          const empty = new Uint8Array(0);
          const binary = new Uint8Array(256);
          for (let index = 0; index < 256; index += 1) {
            binary[index] = index;
          }
          const crlf = Buffer.from('line-one\r\nline-two\r\nline-three\r\n', 'utf8');
          await writeBytes(cloneA, '.env', empty);
          await writeBytes(cloneA, 'data.bin', binary);
          await writeBytes(cloneA, 'lines.txt', crlf);
          const pushed = await pushSecrets(backend.pushOpts(cloneA));
          expect(pushed.published).toBe(true);
          expect(pushed.uploaded.sort()).toEqual(['.env', 'data.bin', 'lines.txt']);
          const pulled = await pullSecrets(backend.pullOpts(cloneB));
          expect(pulled.downloaded.sort()).toEqual(['.env', 'data.bin', 'lines.txt']);
          expect(Buffer.from(await readBytes(cloneB, '.env')).equals(Buffer.from(empty))).toBe(true);
          expect(Buffer.from(await readBytes(cloneB, 'data.bin')).equals(Buffer.from(binary))).toBe(true);
          expect(Buffer.from(await readBytes(cloneB, 'lines.txt')).equals(Buffer.from(crlf))).toBe(true);
        });
      });
    });

    it('counts bounded requests for one-file and no-op pushes and supports partial push', async () => {
      await withTempDir(async (dir) => {
        const backend = make();
        await writeBytes(dir, '.env', Buffer.from('one-file-bytes', 'utf8'));
        await writeBytes(dir, 'other.env', Buffer.from('other-content', 'utf8'));
        const before = { creates: backend.creates(), lists: backend.lists(), gets: backend.gets() };
        const first = await pushSecrets(backend.pushOpts(dir));
        expect(first.published).toBe(true);
        expect(backend.creates() - before.creates).toBe(3);
        const middle = { creates: backend.creates(), lists: backend.lists(), gets: backend.gets() };
        const second = await pushSecrets(backend.pushOpts(dir));
        expect(second.noop).toBe(true);
        expect(second.published).toBe(false);
        expect(backend.creates() - middle.creates).toBe(0);
        expect(backend.lists() - middle.lists).toBeLessThanOrEqual(2);
        await writeBytes(dir, '.env', Buffer.from('second-content', 'utf8'));
        const stateBefore = await loadState(dir, backend.stateRef() as unknown as Parameters<typeof loadState>[1]);
        const otherBefore = JSON.stringify(getBaseline(stateBefore, 'other.env'));
        const partial = await pushSecrets(backend.pushOpts(dir, { selection: ['.env'] }));
        expect(partial.uploaded).toEqual(['.env']);
        expect(partial.outOfSelectionPreserved).toEqual(['other.env']);
        const stateAfter = await loadState(dir, backend.stateRef() as unknown as Parameters<typeof loadState>[1]);
        expect(JSON.stringify(getBaseline(stateAfter, 'other.env'))).toBe(otherBefore);
        const history = await loadValidatedHistory(backend.store, backend.projectId());
        expect(history.commits.size).toBe(2);
      });
    });

    it('materializes a fresh pull and requires explicit flags for deletions', async () => {
      await withTempDir(async (cloneA) => {
        await withTempDir(async (cloneB) => {
          const backend = make();
          await writeBytes(cloneA, '.env', Buffer.from('tombstone-target', 'utf8'));
          await writeBytes(cloneA, 'keep.env', Buffer.from('keep-bytes', 'utf8'));
          await pushSecrets(backend.pushOpts(cloneA));
          const pulled = await pullSecrets(backend.pullOpts(cloneB));
          expect(pulled.downloaded.sort()).toEqual(['.env', 'keep.env']);
          await rm(join(cloneA, '.env'));
          const pending = await pushSecrets(backend.pushOpts(cloneA));
          expect(pending.noop).toBe(true);
          expect(pending.pendingDeletions).toEqual([
            { path: '.env', requiredFlag: '--delete', current: 'local-deleted' },
          ]);
          const authorized = await pushSecrets(backend.pushOpts(cloneA, { allowDelete: true }));
          expect(authorized.published).toBe(true);
          expect(authorized.removedRemote).toEqual(['.env']);
          const remotePending = await pullSecrets(backend.pullOpts(cloneB));
          expect(remotePending.noop).toBe(true);
          expect(remotePending.pendingDeletions).toEqual([
            { path: '.env', requiredFlag: '--delete', current: 'remote-deleted' },
          ]);
          const applied = await pullSecrets(backend.pullOpts(cloneB, { allowDelete: true }));
          expect(applied.removedLocal).toEqual(['.env']);
          await expect(readBytes(cloneB, '.env')).rejects.toThrow();
          expect(Buffer.from(await readBytes(cloneB, 'keep.env')).toString('utf8')).toBe('keep-bytes');
        });
      });
    });

    it('rolls back exactly one file and leaves the other baseline untouched', async () => {
      await withTempDir(async (dir) => {
        const backend = make();
        await writeBytes(dir, '.env', Buffer.from('rollback-v1', 'utf8'));
        await writeBytes(dir, 'other.env', Buffer.from('other-stable', 'utf8'));
        await pushSecrets(backend.pushOpts(dir));
        await writeBytes(dir, '.env', Buffer.from('rollback-v2', 'utf8'));
        const second = await pushSecrets(backend.pushOpts(dir));
        expect(second.published).toBe(true);
        const before = await loadValidatedHistory(backend.store, backend.projectId());
        const ordered = [...before.commits.values()].sort((a, b) => a.timestamp - b.timestamp);
        const firstTree = (ordered[0] as { tree: Array<{ path: string; blobId: string }> }).tree;
        const secondTree = (ordered[1] as { tree: Array<{ path: string; blobId: string }> }).tree;
        const oldBlob = (firstTree.find((entry) => entry.path === '.env') as { blobId: string }).blobId;
        const otherBlob = (secondTree.find((entry) => entry.path === 'other.env') as { blobId: string }).blobId;
        const result = await rollbackFile(backend.rollbackOpts(dir, '.env', oldBlob, { message: 'Revert rotation' }));
        expect(result.published).toBe(true);
        expect(result.parents).toEqual([second.commitId as string]);
        const after = await loadValidatedHistory(backend.store, backend.projectId());
        expect(after.commits.size).toBe(3);
        const tree = new Map(
          (after.commits.get(result.commitId as string) as { tree: Array<{ path: string; blobId: string }> }).tree.map(
            (entry) => [entry.path, entry.blobId],
          ),
        );
        expect(tree.get('.env')).toBe(oldBlob);
        expect(tree.get('other.env')).toBe(otherBlob);
        expect(Buffer.from(await readBytes(dir, '.env')).toString('utf8')).toBe('rollback-v1');
        expect(Buffer.from(await readBytes(dir, 'other.env')).toString('utf8')).toBe('other-stable');
        const state = await loadState(dir, backend.stateRef() as unknown as Parameters<typeof loadState>[1]);
        expect(getBaseline(state, '.env')).toMatchObject({ state: 'present', blobId: oldBlob });
      });
    });

    it('creates metadata-only branches and switches worktrees', async () => {
      await withTempDir(async (dir) => {
        const backend = make();
        await writeBytes(dir, '.env', Buffer.from('branch-bytes', 'utf8'));
        const pushed = await pushSecrets(backend.pushOpts(dir));
        expect(pushed.published).toBe(true);
        const before = await loadValidatedHistory(backend.store, backend.projectId());
        expect(before.blobs.size).toBe(1);
        const created = await createBranch(
          backend.useIdentity()
            ? { store: backend.store, rootAbsolute: dir, name: 'feature/demo', from: 'main', ...backend.idem() }
            : {
                store: backend.store,
                rootAbsolute: dir,
                name: 'feature/demo',
                from: 'main',
                projectId: backend.projectId(),
              },
        );
        expect(created.branch).toBe('feature/demo');
        expect(created.parents).toEqual([pushed.commitId as string]);
        const listed = await listBranches(backend.store, backend.projectId());
        expect(listed.branches.map((entry) => entry.branch).sort()).toEqual(['feature/demo', 'main']);
        const st = backend.stateRef() as { endpoint?: string; vaultId?: string; projectId?: string };
        const moved = await switchBranch(
          backend.useIdentity()
            ? { store: backend.store, rootAbsolute: dir, targetBranch: 'feature/demo', ...backend.idem() }
            : {
                store: backend.store,
                rootAbsolute: dir,
                targetBranch: 'feature/demo',
                endpoint: st.endpoint,
                vaultId: st.vaultId,
                projectId: st.projectId,
              },
        );
        expect(moved.switched).toBe(true);
      });
    });

    it('preserves concurrent writers as a fork and resolves it with the chosen snapshot', async () => {
      await withTempDir(async (dir) => {
        const backend = make();
        const snapshotA = await publishSnapshot(backend.store, {
          projectId: backend.projectId(),
          branch: 'main',
          parents: [],
          files: [{ path: 'a.env', bytes: Buffer.from('fork-a-bytes', 'utf8') }],
          timestamp: 100,
          operationId: testUuid(701),
          operationKind: 'push',
          commitId: testUuid(702),
        });
        void snapshotA;
        const snapshotB = await publishSnapshot(backend.store, {
          projectId: backend.projectId(),
          branch: 'main',
          parents: [],
          files: [{ path: 'b.env', bytes: Buffer.from('fork-b-bytes', 'utf8') }],
          timestamp: 200,
          operationId: testUuid(703),
          operationKind: 'push',
          commitId: testUuid(704),
        });
        void snapshotB;
        const observed = await loadBranchHistory(backend.store, backend.projectId(), 'main');
        expect(observed.headIds).toHaveLength(2);
        const history = await loadValidatedHistory(backend.store, backend.projectId());
        expect(history.commits.size).toBe(2);
        const resolved = await resolveFork(
          backend.useIdentity()
            ? {
                store: backend.store,
                rootAbsolute: dir,
                branch: 'main',
                heads: [testUuid(702), testUuid(704)],
                take: testUuid(702),
                commitId: testUuid(705),
                operationId: testUuid(706),
                ...backend.idem(),
              }
            : {
                store: backend.store,
                rootAbsolute: dir,
                branch: 'main',
                heads: [testUuid(702), testUuid(704)],
                take: testUuid(702),
                commitId: testUuid(705),
                operationId: testUuid(706),
                projectId: backend.projectId(),
              },
        );
        expect(resolved.published).toBe(true);
        expect(resolved.parents).toEqual([testUuid(702), testUuid(704)].sort());
        expect(resolved.divergedAfter).toBe(false);
      });
    });

    it('reconciles interrupted writes without a new logical revision and recovers local writes', async () => {
      await withTempDir(async (dir) => {
        const backend = make();
        await writeBytes(dir, '.env', Buffer.from('uncertain-bytes', 'utf8'));
        const harness = (backend as unknown as { harness?: SdkHarness | ConnectHarness }).harness;
        if (harness !== undefined && 'uncertainRemaining' in harness) {
          harness.uncertainRemaining = 2;
        }
        const operationId = testUuid(721);
        const blobId = testUuid(722);
        const commitId = testUuid(723);
        const result = await pushSecrets(backend.pushOpts(dir, { operationId, blobIds: { '.env': blobId }, commitId }));
        expect(result.published).toBe(true);
        expect(result.reconciled).toBe(true);
        expect(result.commitId).toBe(commitId);
        const history = await loadValidatedHistory(backend.store, backend.projectId());
        expect(history.commits.size).toBe(1);
        expect(history.blobs.size).toBe(1);
        expect([...history.commits.keys()]).toEqual([commitId]);
      });
      await withTempDir(async (cloneA) => {
        await withTempDir(async (cloneB) => {
          const backend = make();
          await writeBytes(cloneA, 'a.env', Buffer.from('content-a', 'utf8'));
          await writeBytes(cloneA, 'b.env', Buffer.from('content-b', 'utf8'));
          await writeBytes(cloneA, 'c.env', Buffer.from('content-c', 'utf8'));
          await pushSecrets(backend.pushOpts(cloneA));
          await expect(
            pullSecrets(
              backend.pullOpts(cloneB, {
                hooks: {
                  beforeFile: async (path: string) => {
                    if (path === 'b.env') {
                      throw new Error('Simulated pull interruption.');
                    }
                  },
                },
              }),
            ),
          ).rejects.toThrow('Simulated pull interruption.');
          expect((await loadJournal(cloneB)).length).toBeGreaterThan(0);
          const resumed = await pullSecrets(backend.pullOpts(cloneB));
          expect(resumed.resumedFromJournal).toBe(true);
          expect(Buffer.from(await readBytes(cloneB, 'b.env')).toString('utf8')).toBe('content-b');
          expect(Buffer.from(await readBytes(cloneB, 'c.env')).toString('utf8')).toBe('content-c');
          expect(await loadJournal(cloneB)).toEqual([]);
        });
      });
      await withTempDir(async (dir) => {
        const backend = make();
        await writeBytes(dir, '.env', Buffer.from('stable-v1', 'utf8'));
        await pushSecrets(backend.pushOpts(dir));
        await writeBytes(dir, '.env', Buffer.from('staged-v2', 'utf8'));
        await expect(
          pushSecrets(
            backend.pushOpts(dir, {
              hooks: {
                beforePublish: async () => {
                  await writeBytes(dir, '.env', Buffer.from('late-v3', 'utf8'));
                },
              },
            }),
          ),
        ).rejects.toMatchObject({ code: 'local-changed' });
        const retry = await pushSecrets(backend.pushOpts(dir));
        expect(retry.published).toBe(true);
        expect(retry.uploaded).toEqual(['.env']);
      });
    });

    it('keeps dry runs free of creates and state writes', async () => {
      await withTempDir(async (dir) => {
        const backend = make();
        await writeBytes(dir, '.env', Buffer.from('dry-bytes', 'utf8'));
        const before = backend.creates();
        const dry = await pushSecrets(backend.pushOpts(dir, { dryRun: true }));
        expect(dry.published).toBe(false);
        expect(dry.dryRun).toBe(true);
        expect(backend.creates() - before).toBe(0);
        expect(await readStateIfPresent(dir)).toBeUndefined();
      });
    });

    it('bounds concurrency with one client init and never reports errors as deletions', async () => {
      const backend = make();
      const initsBefore = backend.inits();
      await Promise.all([
        backend.store.listItems(),
        backend.store.listItems(),
        backend.store.listItems(),
        backend.store.listItems(),
      ]);
      expect(backend.inits() - initsBefore).toBeLessThanOrEqual(1);
      await withTempDir(async (dir) => {
        await writeBytes(dir, '.env', Buffer.from('guard-bytes', 'utf8'));
        await pushSecrets(backend.pushOpts(dir));
        const harness = (backend as unknown as { harness?: SdkHarness | ConnectHarness }).harness;
        if (harness !== undefined && 'listError' in harness) {
          (harness as SdkHarness).listError = new Error('quota exceeded for service account 429');
          const failure = await backend.store.listItems().then(
            () => undefined,
            (error: unknown) => error,
          );
          expect(failure).toBeInstanceOf(SecretSyncError);
          expect((failure as SecretSyncError).code).toBe('rate-limited');
          (harness as SdkHarness).listError = undefined;
        } else if (harness !== undefined && 'listStatus' in harness) {
          (harness as ConnectHarness).listStatus = 429;
          const failure = await backend.store.listItems().then(
            () => undefined,
            (error: unknown) => error,
          );
          expect(failure).toBeInstanceOf(SecretSyncError);
          expect((failure as SecretSyncError).code).toBe('rate-limited');
          (harness as ConnectHarness).listStatus = 200;
        }
        const history = await loadValidatedHistory(backend.store, backend.projectId());
        expect(history.commits.size).toBe(1);
      });
    });
  });
}

defineWorkflowSuite('sdk service-account', () => makeSdkBackend('service-account'));
defineWorkflowSuite('sdk desktop', () => makeSdkBackend('desktop'));
defineWorkflowSuite('connect', () => makeConnectBackend());

describe('record interoperability', () => {
  it('exchanges serialized records from the SDK adapter to Connect without losing IDs or tree entries', async () => {
    await withTempDir(async (cloneA) => {
      await withTempDir(async (cloneB) => {
        const sdk = makeSdkBackend('service-account');
        await writeBytes(cloneA, '.env', Buffer.from('interop-one', 'utf8'));
        await writeBytes(cloneA, 'data.bin', Uint8Array.from(Array.from({ length: 64 }, (_, index) => index)));
        const pushed = await pushSecrets(sdk.pushOpts(cloneA));
        expect(pushed.published).toBe(true);
        const source = await exportDetails(sdk.store);
        expect(source.length).toBeGreaterThan(0);
        for (const detail of source) {
          expect(detail.category).toBe('SECURE_NOTE');
          expect(detail.id.startsWith('sdk-item-')).toBe(true);
          const envelope = decodeRecordEnvelope(detail, PROJECT_ID);
          expect(envelope.logicalId).not.toBe(detail.id);
        }
        const connect = makeConnectBackend();
        await importDetails(connect.store, source);
        const target = await exportDetails(connect.store);
        expect(historySignature(target, PROJECT_ID)).toEqual(historySignature(source, PROJECT_ID));
        const pulled = await pullSecrets(connect.pullOpts(cloneB));
        expect(pulled.downloaded.sort()).toEqual(['.env', 'data.bin']);
        expect(Buffer.from(await readBytes(cloneB, '.env')).toString('utf8')).toBe('interop-one');
        expect([...(await readBytes(cloneB, 'data.bin'))].every((value, index) => value === index)).toBe(true);
        for (const detail of target) {
          expect(detail.id.startsWith('provider-c-')).toBe(true);
        }
      });
    });
  });

  it('exchanges serialized records from Connect to the SDK adapter without losing IDs or tree entries', async () => {
    await withTempDir(async (cloneA) => {
      await withTempDir(async (cloneB) => {
        const connect = makeConnectBackend();
        await writeBytes(cloneA, '.env', Buffer.from('', 'utf8'));
        await writeBytes(cloneA, 'lines.txt', Buffer.from('a\r\nb\r\nc\r\n', 'utf8'));
        const pushed = await pushSecrets(connect.pushOpts(cloneA));
        expect(pushed.published).toBe(true);
        const source = await exportDetails(connect.store);
        expect(source.length).toBeGreaterThan(0);
        const sdk = makeSdkBackend('desktop');
        await importDetails(sdk.store, source);
        const target = await exportDetails(sdk.store);
        expect(historySignature(target, PROJECT_ID)).toEqual(historySignature(source, PROJECT_ID));
        const pulled = await pullSecrets(sdk.pullOpts(cloneB));
        expect(pulled.downloaded.sort()).toEqual(['.env', 'lines.txt']);
        expect((await readBytes(cloneB, '.env')).byteLength).toBe(0);
        expect(Buffer.from(await readBytes(cloneB, 'lines.txt')).toString('utf8')).toBe('a\r\nb\r\nc\r\n');
      });
    });
  });

  it('preserves logical revisions across a round trip instead of SDK-native provider ids', async () => {
    const sdk = makeSdkBackend('service-account');
    const connect = makeConnectBackend();
    await withTempDir(async (dir) => {
      await writeBytes(dir, '.env', Buffer.from('revision-proof', 'utf8'));
      const pushed = await pushSecrets(sdk.pushOpts(dir));
      expect(pushed.published).toBe(true);
      expect(pushed.commitId).toBeDefined();
      const history = await loadValidatedHistory(sdk.store, PROJECT_ID);
      const commit = history.commits.get(pushed.commitId as string);
      expect(commit).toBeDefined();
      const providerForCommit = history.commitProviders.get(pushed.commitId as string);
      expect(providerForCommit).toBeDefined();
      expect(providerForCommit).not.toBe(pushed.commitId);
      await importDetails(connect.store, await exportDetails(sdk.store));
      const back = makeSdkBackend('desktop');
      await importDetails(back.store, await exportDetails(connect.store));
      const revived = await loadValidatedHistory(back.store, PROJECT_ID);
      expect([...revived.commits.keys()].sort()).toEqual([...history.commits.keys()].sort());
      expect([...revived.blobs.keys()].sort()).toEqual([...history.blobs.keys()].sort());
    });
  });
});
