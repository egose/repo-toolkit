import { describe, expect, it } from 'vitest';

import { reconcileRecordByLogicalId } from '../src/history-store';
import { SecretSyncError } from '../src/errors';
import { createBlobRecord, decodeRecordEnvelope } from '../src/records';
import {
  SdkSecretStore,
  createSdkStore,
  defaultSdkClientFactory,
  type SdkClientFactory,
  type SdkClientLike,
  type SdkCreateParams,
  type SdkFactoryConfig,
  type SdkItemLike,
  type SdkListFilter,
  type SdkOverviewLike,
} from '../src/sdk';

const PROJECT_ID = 'b3e0c1a2-4a95-4516-b8c7-e00621a7820c';
const VAULT_ID = 'vault-direct-1';
const TOKEN_ENV = 'OP_SERVICE_ACCOUNT_TOKEN';

interface FakeField {
  id: string;
  title: string;
  sectionId?: string;
  fieldType: string;
  value: string;
}

interface FakeItemState {
  id: string;
  title: string;
  category: string;
  vaultId: string;
  tags: string[];
  fields: FakeField[];
  state: string;
}

interface FakeBehavior {
  vaultId: string;
  items?: FakeItemState[];
  listError?: unknown;
  getError?: unknown;
  createError?: unknown;
  listDelayMs?: number;
  createDelayMs?: number;
  failCreateReceipt?: boolean;
}

interface FakeCalls {
  lists: number;
  gets: number;
  creates: number;
  closed: number;
  listVaults: string[];
  listFilters: SdkListFilter[][];
  getVaults: string[];
  createParams: SdkCreateParams[];
}

interface FakeHarness {
  client: SdkClientLike;
  calls: FakeCalls;
}

function resolveHook(hook: unknown, arg: SdkCreateParams | string): unknown {
  if (typeof hook === 'function') {
    return (hook as (value: SdkCreateParams | string) => unknown)(arg);
  }
  return hook;
}

function delay(ms: number | undefined): Promise<void> {
  if (ms === undefined || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function makeFakeClient(behavior: FakeBehavior): FakeHarness {
  const calls: FakeCalls = {
    lists: 0,
    gets: 0,
    creates: 0,
    closed: 0,
    listVaults: [],
    listFilters: [],
    getVaults: [],
    createParams: [],
  };
  const stored = new Map<string, FakeItemState>();
  for (const item of behavior.items ?? []) {
    stored.set(item.id, { ...item, tags: [...item.tags], fields: item.fields.map((field) => ({ ...field })) });
  }
  let counter = stored.size;
  const client = {
    items: {
      async list(vaultId: string, ...filters: SdkListFilter[]): Promise<SdkOverviewLike[]> {
        calls.lists += 1;
        calls.listVaults.push(vaultId);
        calls.listFilters.push(filters);
        if (behavior.listError !== undefined) {
          throw behavior.listError;
        }
        await delay(behavior.listDelayMs);
        const result: SdkOverviewLike[] = [];
        for (const item of stored.values()) {
          result.push({
            id: item.id,
            title: item.title,
            category: item.category,
            vaultId: item.vaultId,
            tags: [...item.tags],
            state: item.state,
          });
        }
        return result;
      },
      async get(vaultId: string, itemId: string): Promise<SdkItemLike> {
        calls.gets += 1;
        calls.getVaults.push(vaultId);
        const hook = resolveHook(behavior.getError, itemId);
        if (hook !== undefined) {
          throw hook;
        }
        const hit = stored.get(itemId);
        if (hit === undefined || hit.vaultId !== vaultId) {
          throw new Error(`item not found: ${itemId}`);
        }
        return {
          id: hit.id,
          title: hit.title,
          category: hit.category,
          vaultId: hit.vaultId,
          tags: [...hit.tags],
          fields: hit.fields.map((field) => ({ ...field })),
        };
      },
      async create(params: SdkCreateParams): Promise<SdkItemLike> {
        calls.creates += 1;
        calls.createParams.push(params);
        const hook = resolveHook(behavior.createError, params);
        if (hook !== undefined) {
          throw hook;
        }
        await delay(behavior.createDelayMs);
        counter += 1;
        const id = `sdk-item-${counter}`;
        const item: FakeItemState = {
          id,
          title: params.title,
          category: params.category,
          vaultId: params.vaultId,
          tags: [...params.tags],
          fields: params.fields.map((field) => ({ ...field })),
          state: 'active',
        };
        stored.set(id, item);
        if (behavior.failCreateReceipt === true) {
          return {
            id,
            title: params.title,
            category: params.category,
            vaultId: 'foreign-vault',
            tags: [...params.tags],
            fields: params.fields.map((field) => ({ ...field })),
          };
        }
        return {
          id,
          title: params.title,
          category: params.category,
          vaultId: params.vaultId,
          tags: [...params.tags],
          fields: params.fields.map((field) => ({ ...field })),
        };
      },
    },
    async close(): Promise<void> {
      calls.closed += 1;
    },
  };
  return { client: client as SdkClientLike, calls };
}

function makeFactory(
  client: SdkClientLike,
  hooks: { seen?: SdkFactoryConfig[]; fail?: unknown; delayMs?: number; count?: { total: number } } = {},
): SdkClientFactory {
  return async (config: SdkFactoryConfig) => {
    if (hooks.count !== undefined) {
      hooks.count.total += 1;
    }
    if (hooks.seen !== undefined) {
      hooks.seen.push(config);
    }
    if (hooks.fail !== undefined) {
      throw hooks.fail;
    }
    await delay(hooks.delayMs);
    return client;
  };
}

function makeAuthFactory(
  client: SdkClientLike,
  policy: { validToken?: string; deniedAccounts?: string[]; expiredTokens?: string[] },
  count?: { total: number },
): SdkClientFactory {
  return async (config: SdkFactoryConfig) => {
    if (count !== undefined) {
      count.total += 1;
    }
    if (config.auth.kind === 'service-account') {
      if ((policy.expiredTokens ?? []).includes(config.auth.token)) {
        throw namedError('AuthExpiredError', 'service account session expired');
      }
      if (config.auth.token !== policy.validToken) {
        throw new Error('invalid service account token');
      }
      return client;
    }
    if ((policy.deniedAccounts ?? []).includes(config.auth.account)) {
      throw new Error('desktop access denied by user');
    }
    return client;
  };
}

async function captureFailure(task: Promise<unknown>): Promise<SecretSyncError> {
  try {
    await task;
  } catch (error) {
    expect(error).toBeInstanceOf(SecretSyncError);
    return error as SecretSyncError;
  }
  throw new Error('expected the operation to fail');
}

function serializeFailure(error: SecretSyncError): string {
  const parts: string[] = [error.message, error.stack ?? ''];
  try {
    parts.push(JSON.stringify(error));
  } catch {
    parts.push(String(error));
  }
  const cause = (error as { cause?: unknown }).cause;
  try {
    parts.push(JSON.stringify(cause));
  } catch {
    parts.push(String(cause));
  }
  return parts.join('\n');
}

function envelopeItem(id: string, vaultId: string, serialized: string, kind: string, logicalId: string): FakeItemState {
  return {
    id,
    title: `repo-toolkit-secret-sync ${PROJECT_ID} ${kind} ${logicalId}`,
    category: 'SecureNote',
    vaultId,
    tags: ['repo-toolkit-secret-sync', PROJECT_ID, kind],
    fields: [
      { id: 'notes-id', title: 'notesPlain', fieldType: 'Text', value: '' },
      { id: 'payload-id', title: 'payload', fieldType: 'Concealed', value: serialized },
    ],
    state: 'active',
  };
}

const SERVICE_AUTH = { type: 'service-account', tokenEnv: TOKEN_ENV } as const;
const DESKTOP_AUTH = { type: 'desktop', account: 'user@example.com' } as const;

describe('sdk store service-account mode', () => {
  it('lists, reads, and creates records with exact vault scoping', async () => {
    const record = createBlobRecord(PROJECT_ID, new TextEncoder().encode('hello-direct'));
    const harness = makeFakeClient({
      vaultId: VAULT_ID,
      items: [envelopeItem('sdk-1', VAULT_ID, record.serialized, 'blob', record.envelope.logicalId)],
    });
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(harness.client),
      sleep: () => Promise.resolve(),
    });
    const summaries = await store.listItems();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ id: 'sdk-1', category: 'SECURE_NOTE' });
    expect(harness.calls.listVaults).toEqual([VAULT_ID]);
    expect(harness.calls.listFilters).toEqual([[{ type: 'ByState', content: { active: true, archived: true } }]]);
    const detail = await store.getItem('sdk-1');
    expect(detail.category).toBe('SECURE_NOTE');
    expect(decodeRecordEnvelope(detail, PROJECT_ID)).toEqual(record.envelope);
    expect(harness.calls.getVaults).toEqual([VAULT_ID]);
    const created = createBlobRecord(PROJECT_ID, new TextEncoder().encode('second-file'));
    const result = await store.createItem(created.input);
    expect(result.status).toBe('created');
    if (result.status !== 'created') {
      throw new Error('expected created result');
    }
    expect(result.item.category).toBe('SECURE_NOTE');
    const sent = harness.calls.createParams[0] as SdkCreateParams;
    expect(sent.vaultId).toBe(VAULT_ID);
    expect(sent.category).toBe('SecureNote');
    expect(sent.fields.map((field) => field.fieldType).sort()).toEqual(['Concealed', 'Text']);
    expect(JSON.stringify(result.item)).not.toContain('SecureNote');
    expect(JSON.stringify(result.item)).not.toContain('fieldType');
    await store.close();
    expect(harness.calls.closed).toBe(1);
  });

  it('reads the token at execution time and never constructs a client during planning', async () => {
    const harness = makeFakeClient({ vaultId: VAULT_ID, items: [] });
    const seen: SdkFactoryConfig[] = [];
    const env: Record<string, string | undefined> = {};
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env,
      clientFactory: makeFactory(harness.client, { seen }),
    });
    expect(seen).toHaveLength(0);
    env[TOKEN_ENV] = 'late-token';
    await store.listItems();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ auth: { kind: 'service-account', token: 'late-token' } });
    expect(seen[0]?.integrationName).toBe('repo-toolkit-secret-sync');
  });

  it('shares one lazy client across concurrent calls', async () => {
    const harness = makeFakeClient({ vaultId: VAULT_ID, items: [] });
    const count = { total: 0 };
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(harness.client, { count, delayMs: 30 }),
      sleep: () => Promise.resolve(),
    });
    const results = await Promise.all([
      store.listItems(),
      store.listItems(),
      store.listItems(),
      store.listItems(),
      store.listItems(),
      store.listItems(),
    ]);
    expect(count.total).toBe(1);
    for (const result of results) {
      expect(result).toEqual([]);
    }
  });
});

describe('sdk store desktop mode', () => {
  it('lists, reads, and creates records with an explicit account selector', async () => {
    const record = createBlobRecord(PROJECT_ID, new TextEncoder().encode('desktop-file'));
    const harness = makeFakeClient({
      vaultId: VAULT_ID,
      items: [envelopeItem('sdk-9', VAULT_ID, record.serialized, 'blob', record.envelope.logicalId)],
    });
    const seen: SdkFactoryConfig[] = [];
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...DESKTOP_AUTH },
      env: {},
      clientFactory: makeFactory(harness.client, { seen }),
      sleep: () => Promise.resolve(),
    });
    const summaries = await store.listItems();
    expect(summaries).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ auth: { kind: 'desktop', account: 'user@example.com' } });
    const detail = await store.getItem('sdk-9');
    expect(decodeRecordEnvelope(detail, PROJECT_ID)).toEqual(record.envelope);
    const created = createBlobRecord(PROJECT_ID, new TextEncoder().encode('desktop-second'));
    const result = await store.createItem(created.input);
    expect(result.status).toBe('created');
  });

  it('maps a denied desktop prompt to an authentication error without falling back', async () => {
    const harness = makeFakeClient({ vaultId: VAULT_ID, items: [] });
    const factory = makeAuthFactory(harness.client, { validToken: 'token-ok', deniedAccounts: ['locked-user'] });
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { type: 'desktop', account: 'locked-user' },
      env: {},
      clientFactory: factory,
      sleep: () => Promise.resolve(),
    });
    const failure = await captureFailure(store.listItems());
    expect(failure.code).toBe('auth');
    expect(harness.calls.lists).toBe(0);
  });

  it('maps a cancelled desktop request to an authentication error', async () => {
    const harness = makeFakeClient({ vaultId: VAULT_ID, items: [], getError: new Error('request cancelled by user') });
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...DESKTOP_AUTH },
      env: {},
      clientFactory: makeFactory(harness.client),
      sleep: () => Promise.resolve(),
    });
    const failure = await captureFailure(store.getItem('sdk-1'));
    expect(failure.code).toBe('auth');
  });
});

describe('sdk envelopes', () => {
  const envelopeCases: Array<[string, Uint8Array]> = [
    ['empty', new Uint8Array(0)],
    ['binary', Uint8Array.from(Array.from({ length: 256 }, (_, index) => index))],
    ['max', new Uint8Array(32768).fill(7)],
  ];
  it.each(envelopeCases)('round-trips %s payloads without alteration', async (_label, bytes) => {
    const record = createBlobRecord(PROJECT_ID, bytes);
    const harness = makeFakeClient({ vaultId: VAULT_ID, items: [] });
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(harness.client),
      sleep: () => Promise.resolve(),
    });
    const created = await store.createItem(record.input);
    expect(created.status).toBe('created');
    if (created.status !== 'created') {
      throw new Error('expected created result');
    }
    expect(decodeRecordEnvelope(created.item, PROJECT_ID)).toEqual(record.envelope);
    const fetched = await store.getItem(created.item.id);
    expect(decodeRecordEnvelope(fetched, PROJECT_ID)).toEqual(record.envelope);
  });
});

describe('sdk list filtering', () => {
  it('skips unsupported categories and foreign vaults while keeping archived items', async () => {
    const record = createBlobRecord(PROJECT_ID, new TextEncoder().encode('kept'));
    const kept = envelopeItem('sdk-keep', VAULT_ID, record.serialized, 'blob', record.envelope.logicalId);
    const archived: FakeItemState = {
      ...envelopeItem('sdk-arch', VAULT_ID, record.serialized, 'blob', record.envelope.logicalId),
      state: 'archived',
    };
    const harness = makeFakeClient({
      vaultId: VAULT_ID,
      items: [
        kept,
        archived,
        { ...kept, id: 'sdk-login', category: 'Login' },
        { ...kept, id: 'sdk-unsupported', category: 'Unsupported' },
        { ...kept, id: 'sdk-foreign', vaultId: 'other-vault' },
      ],
    });
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(harness.client),
      sleep: () => Promise.resolve(),
    });
    const summaries = await store.listItems();
    expect(summaries.map((entry) => entry.id).sort()).toEqual(['sdk-arch', 'sdk-keep']);
  });

  it('emulates title filtering with exact matches', async () => {
    const first = createBlobRecord(PROJECT_ID, new TextEncoder().encode('a'));
    const second = createBlobRecord(PROJECT_ID, new TextEncoder().encode('b'));
    const harness = makeFakeClient({
      vaultId: VAULT_ID,
      items: [
        envelopeItem('sdk-a', VAULT_ID, first.serialized, 'blob', first.envelope.logicalId),
        envelopeItem('sdk-b', VAULT_ID, second.serialized, 'blob', second.envelope.logicalId),
      ],
    });
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(harness.client),
      sleep: () => Promise.resolve(),
    });
    const filtered = await store.listItems({
      titleFilter: `repo-toolkit-secret-sync ${PROJECT_ID} blob ${first.envelope.logicalId}`,
    });
    expect(filtered.map((entry) => entry.id)).toEqual(['sdk-a']);
  });

  it('keeps duplicate titles as distinct entries', async () => {
    const harness = makeFakeClient({
      vaultId: VAULT_ID,
      items: [
        {
          id: 'sdk-d1',
          title: 'dupe',
          category: 'SecureNote',
          vaultId: VAULT_ID,
          tags: ['x'],
          fields: [],
          state: 'active',
        },
        {
          id: 'sdk-d2',
          title: 'dupe',
          category: 'SecureNote',
          vaultId: VAULT_ID,
          tags: ['x'],
          fields: [],
          state: 'active',
        },
      ],
    });
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(harness.client),
      sleep: () => Promise.resolve(),
    });
    const summaries = await store.listItems();
    expect(summaries.map((entry) => entry.id).sort()).toEqual(['sdk-d1', 'sdk-d2']);
  });
});

describe('sdk failures', () => {
  it('maps a missing vault to not-found', async () => {
    const harness = makeFakeClient({
      vaultId: VAULT_ID,
      items: [],
      listError: new Error('vault not found: vault-direct-1'),
    });
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(harness.client),
      sleep: () => Promise.resolve(),
    });
    const failure = await captureFailure(store.listItems());
    expect(failure.code).toBe('not-found');
  });

  it('maps expired and invalid tokens to authentication errors', async () => {
    const harness = makeFakeClient({ vaultId: VAULT_ID, items: [] });
    const factory = makeAuthFactory(harness.client, { validToken: 'token-ok', expiredTokens: ['expired-token'] });
    const expired = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'expired-token' },
      clientFactory: factory,
      sleep: () => Promise.resolve(),
    });
    await expect(captureFailure(expired.listItems())).resolves.toMatchObject({ code: 'auth' });
    const invalid = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'wrong-token' },
      clientFactory: factory,
      sleep: () => Promise.resolve(),
    });
    await expect(captureFailure(invalid.getItem('sdk-1'))).resolves.toMatchObject({ code: 'auth' });
    const missing = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: {},
      clientFactory: factory,
      sleep: () => Promise.resolve(),
    });
    const failure = await captureFailure(missing.listItems());
    expect(failure.code).toBe('auth');
    expect(failure.message).toContain(TOKEN_ENV);
  });

  it('maps quotas to rate-limited with bounded retries instead of an empty list', async () => {
    const harness = makeFakeClient({
      vaultId: VAULT_ID,
      items: [],
      listError: namedError('RateLimitExceededError', 'quota exceeded for service account'),
    });
    let sleeps = 0;
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(harness.client),
      sleep: () => {
        sleeps += 1;
        return Promise.resolve();
      },
    });
    const failure = await captureFailure(store.listItems());
    expect(failure.code).toBe('rate-limited');
    expect(harness.calls.lists).toBe(4);
    expect(sleeps).toBe(3);
  });

  it('maps incomplete listings to remote-incomplete instead of an empty project', async () => {
    const harness = makeFakeClient({
      vaultId: VAULT_ID,
      items: [],
      listError: new Error('listing incomplete: results truncated before the final page'),
    });
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(harness.client),
      sleep: () => Promise.resolve(),
    });
    const failure = await captureFailure(store.listItems());
    expect(failure.code).toBe('remote-incomplete');
  });

  it('rejects oversized creates and details without truncation', async () => {
    const harness = makeFakeClient({ vaultId: VAULT_ID, items: [] });
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(harness.client),
      sleep: () => Promise.resolve(),
    });
    const oversized = await captureFailure(
      store.createItem({
        title: 'big',
        category: 'SECURE_NOTE',
        tags: [],
        fields: [{ type: 'CONCEALED', value: 'x'.repeat(70000) }],
      }),
    );
    expect(oversized.code).toBe('too-large');
    expect(harness.calls.creates).toBe(0);
    const record = createBlobRecord(PROJECT_ID, new TextEncoder().encode('small'));
    const tight = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(
        makeFakeClient({
          vaultId: VAULT_ID,
          items: [envelopeItem('sdk-big', VAULT_ID, record.serialized, 'blob', record.envelope.logicalId)],
        }).client,
      ),
      maxDetailBytes: 16,
      sleep: () => Promise.resolve(),
    });
    await expect(captureFailure(tight.getItem('sdk-big'))).resolves.toMatchObject({ code: 'too-large' });
  });

  it('rejects scans that exceed the record bound', async () => {
    const record = createBlobRecord(PROJECT_ID, new TextEncoder().encode('x'));
    const harness = makeFakeClient({
      vaultId: VAULT_ID,
      items: [
        envelopeItem('sdk-1', VAULT_ID, record.serialized, 'blob', record.envelope.logicalId),
        envelopeItem('sdk-2', VAULT_ID, record.serialized, 'blob', record.envelope.logicalId),
        envelopeItem('sdk-3', VAULT_ID, record.serialized, 'blob', record.envelope.logicalId),
      ],
    });
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(harness.client),
      maxRecords: 2,
      sleep: () => Promise.resolve(),
    });
    await expect(captureFailure(store.listItems())).resolves.toMatchObject({ code: 'too-large' });
  });

  it('applies the outer deadline to reads without retry storms', async () => {
    const harness = makeFakeClient({ vaultId: VAULT_ID, items: [], listDelayMs: 60 });
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(harness.client),
      timeoutMs: 10,
      maxRetries: 0,
      sleep: () => Promise.resolve(),
    });
    const failure = await captureFailure(store.listItems());
    expect(failure.code).toBe('timeout');
    expect(harness.calls.lists).toBe(1);
  });

  it('returns uncertain for late creates and reconciles by logical id', async () => {
    const harness = makeFakeClient({ vaultId: VAULT_ID, items: [], createDelayMs: 60 });
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(harness.client),
      timeoutMs: 10,
      sleep: () => Promise.resolve(),
    });
    const record = createBlobRecord(PROJECT_ID, new TextEncoder().encode('late-write'));
    const pending = await store.createItem({ ...record.input, title: record.input.title });
    expect(pending).toEqual({ status: 'uncertain', attempts: 1 });
    expect(harness.calls.creates).toBe(1);
    await delay(120);
    const reconciled = await reconcileRecordByLogicalId(
      store,
      PROJECT_ID,
      'blob',
      record.envelope.logicalId,
      record.envelope,
    );
    expect(reconciled?.title).toBe(record.input.title);
  });

  it('returns uncertain for quota and ambiguous create failures but throws auth deterministically', async () => {
    const limited = makeFakeClient({
      vaultId: VAULT_ID,
      items: [],
      createError: namedError('RateLimitExceededError', 'quota exceeded for service account'),
    });
    const limitedStore = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(limited.client),
      sleep: () => Promise.resolve(),
    });
    const record = createBlobRecord(PROJECT_ID, new TextEncoder().encode('q'));
    expect(await limitedStore.createItem(record.input)).toEqual({ status: 'uncertain', attempts: 1 });
    expect(limited.calls.creates).toBe(1);
    const denied = makeFakeClient({
      vaultId: VAULT_ID,
      items: [],
      createError: new Error('desktop approval denied by user'),
    });
    const deniedStore = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(denied.client),
      sleep: () => Promise.resolve(),
    });
    await expect(captureFailure(deniedStore.createItem(record.input))).resolves.toMatchObject({ code: 'auth' });
    const receipt = makeFakeClient({ vaultId: VAULT_ID, items: [], failCreateReceipt: true });
    const receiptStore = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(receipt.client),
      sleep: () => Promise.resolve(),
    });
    expect(await receiptStore.createItem(record.input)).toEqual({ status: 'uncertain', attempts: 1 });
  });

  it('surfaces client initialization failures without falling back to Connect', async () => {
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(
        {
          items: {
            list: async () => [],
            get: async () => ({}) as SdkItemLike,
            create: async () => ({}) as SdkItemLike,
          },
        },
        {
          fail: new Error("Cannot find module '@1password/sdk-core/nodejs/core_bg.wasm'"),
        },
      ),
      sleep: () => Promise.resolve(),
    });
    const failure = await captureFailure(store.listItems());
    expect(failure.code).toBe('server');
    expect(failure.message).toMatch(/1Password SDK/);
    expect(failure.message).not.toMatch(/Connect/);
  });

  it('keeps tokens and payload canaries out of errors, causes, and diagnostics', async () => {
    const token = 'CANARY-TOKEN-9f8e7d6c5b4a';
    const factory: SdkClientFactory = async (config) => {
      if (config.auth.kind === 'service-account') {
        throw new Error(`access denied for token=${config.auth.token}`);
      }
      throw new Error('unexpected auth kind');
    };
    const secretStore = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: token },
      clientFactory: factory,
      sleep: () => Promise.resolve(),
    });
    const authFailure = await captureFailure(secretStore.listItems());
    expect(authFailure.code).toBe('auth');
    expect(serializeFailure(authFailure)).not.toContain(token);
    const canary = 'CANARY-PAYLOAD-1a2b3c4d5e6f';
    const evil: SdkClientFactory = async () => {
      const inner = makeFakeClient({
        vaultId: VAULT_ID,
        items: [],
        createError: new Error(`desktop approval denied for payload ${canary}`),
      });
      return inner.client;
    };
    const evilStore = createSdkStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: evil,
      sleep: () => Promise.resolve(),
    });
    const writeFailure = await captureFailure(
      evilStore.createItem({
        title: 't',
        category: 'SECURE_NOTE',
        tags: [],
        fields: [{ type: 'CONCEALED', value: canary }],
      }),
    );
    expect(writeFailure.code).toBe('auth');
    expect(serializeFailure(writeFailure)).not.toContain(canary);
    expect(serializeFailure(writeFailure)).not.toContain(token);
  });

  it('works without Connect environment variables, network, or credentials', async () => {
    const record = createBlobRecord(PROJECT_ID, new TextEncoder().encode('no-connect'));
    const harness = makeFakeClient({
      vaultId: VAULT_ID,
      items: [envelopeItem('sdk-nc', VAULT_ID, record.serialized, 'blob', record.envelope.logicalId)],
    });
    const store = new SdkSecretStore({
      vaultId: VAULT_ID,
      auth: { ...SERVICE_AUTH },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: makeFactory(harness.client),
      sleep: () => Promise.resolve(),
    });
    expect(await store.listItems()).toHaveLength(1);
    expect(await store.getItem('sdk-nc')).toMatchObject({ id: 'sdk-nc' });
  });
});

describe('sdk store lifecycle', () => {
  it('rejects unusable client configurations before loading the runtime', async () => {
    await expect(
      captureFailure(
        defaultSdkClientFactory({
          auth: { kind: 'service-account', token: '' },
          integrationName: 'x',
          integrationVersion: 'y',
        }),
      ),
    ).resolves.toMatchObject({ code: 'auth' });
    await expect(
      captureFailure(
        defaultSdkClientFactory({
          auth: { kind: 'desktop', account: '' },
          integrationName: 'x',
          integrationVersion: 'y',
        }),
      ),
    ).resolves.toMatchObject({ code: 'auth' });
    await expect(
      captureFailure(
        defaultSdkClientFactory({
          auth: { kind: 'desktop', account: 'a' },
          integrationName: '',
          integrationVersion: 'y',
        }),
      ),
    ).resolves.toMatchObject({ code: 'validation' });
  });
  it('closes cleanly with and without a client', async () => {
    const harness = makeFakeClient({ vaultId: VAULT_ID, items: [] });
    const store = new SdkSecretStore({
      vaultId: VAULT_ID,
      auth: { ...DESKTOP_AUTH },
      env: {},
      clientFactory: makeFactory(harness.client),
      sleep: () => Promise.resolve(),
    });
    await store.close();
    expect(harness.calls.closed).toBe(0);
    await store.listItems();
    await store.close();
    expect(harness.calls.closed).toBe(1);
    await store.close();
    expect(harness.calls.closed).toBe(1);
  });
});
