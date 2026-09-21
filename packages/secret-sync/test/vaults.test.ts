import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseFlags } from '@repo-toolkit/publish-package';
import { extractCommand } from '../src/cli';
import { assertCommandFlags } from '../src/cli-options';
import { validateSecretSyncCommandOptions } from '../src/config';
import { SecretSyncError } from '../src/errors';
import { formatJsonResult, formatTextResult } from '../src/format';
import { createConnectStore, type FetchResponseLike } from '../src/connect';
import { createSdkStore, type SdkClientFactory, type SdkClientLike } from '../src/sdk';
import { listVaults } from '../src/vaults';
import { runSecretSync } from '../src/index';
import { MemoryFakeStore } from './helpers';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const VAULT_ID = 'vault-list-1';
const TOKEN_ENV = 'OP_SERVICE_ACCOUNT_TOKEN';

function sdkClientWithVaults(vaults: Array<Record<string, unknown>>): SdkClientLike {
  return {
    items: {
      async list() {
        return [];
      },
      async get() {
        throw new Error('not used');
      },
      async create() {
        throw new Error('not used');
      },
    },
    vaults: {
      async list() {
        return vaults.map((entry) => ({ ...entry }));
      },
    },
  };
}

function headersFor(map: Record<string, string> = {}) {
  const lower: Record<string, string> = {};
  for (const key of Object.keys(map)) {
    lower[key.toLowerCase()] = map[key] as string;
  }
  return {
    get(name: string): string | null {
      const hit = lower[name.toLowerCase()];
      return hit === undefined ? null : hit;
    },
  };
}

function jsonResponse(status: number, body: unknown): FetchResponseLike {
  return { status, headers: headersFor({}), text: async () => JSON.stringify(body), body: undefined };
}

async function writeSdkConfig(dir: string): Promise<string> {
  const config = {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    root: '.',
    remote: { type: 'onepassword-sdk', vaultId: VAULT_ID, auth: { type: 'service-account', tokenEnv: TOKEN_ENV } },
    branch: 'main',
    files: ['.env'],
    ignore: [],
    limits: { maxFileBytes: 32768, maxFiles: 100, concurrency: 4 },
  };
  const path = join(dir, 'secret-sync.config.json');
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}

describe('sdk vault listing', () => {
  it('lists vaults for service-account and desktop auth with sorted neutral DTOs', async () => {
    for (const auth of [
      { type: 'service-account', tokenEnv: TOKEN_ENV } as const,
      { type: 'desktop', account: 'user@example.com' } as const,
    ]) {
      const factory: SdkClientFactory = async () =>
        sdkClientWithVaults([
          { id: 'v-b', title: 'Beta', vaultType: 'UserCreated', activeItemCount: 3 },
          { id: 'v-a', title: 'Alpha' },
        ]);
      const store = createSdkStore({
        vaultId: VAULT_ID,
        auth: { ...auth },
        env: { [TOKEN_ENV]: 'token-ok' },
        clientFactory: factory,
        sleep: () => Promise.resolve(),
      });
      const result = await listVaults({ store });
      expect(result.count).toBe(2);
      expect(result.vaults.map((entry) => entry.id)).toEqual(['v-a', 'v-b']);
      expect(result.vaults[1]).toMatchObject({ title: 'Beta', vaultType: 'UserCreated', activeItemCount: 3 });
      expect(JSON.stringify(result)).not.toContain('token-ok');
    }
  });

  it('fails clearly when the client has no vault listing and when the token is missing', async () => {
    const noVaults: SdkClientFactory = async () => ({
      items: {
        async list() {
          return [];
        },
        async get() {
          throw new Error('not used');
        },
        async create() {
          throw new Error('not used');
        },
      },
    });
    const missing = createSdkStore({
      vaultId: VAULT_ID,
      auth: { type: 'service-account', tokenEnv: TOKEN_ENV },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: noVaults,
      sleep: () => Promise.resolve(),
    });
    await expect(listVaults({ store: missing })).rejects.toMatchObject({ code: 'server' });
    const untokened = createSdkStore({
      vaultId: VAULT_ID,
      auth: { type: 'service-account', tokenEnv: TOKEN_ENV },
      env: {},
      clientFactory: async () => sdkClientWithVaults([]),
      sleep: () => Promise.resolve(),
    });
    const failure = await listVaults({ store: untokened }).then(
      () => {
        throw new Error('expected auth failure');
      },
      (error: unknown) => error as SecretSyncError,
    );
    expect(failure).toBeInstanceOf(SecretSyncError);
    expect(failure.code).toBe('auth');
    expect(failure.message).toContain(TOKEN_ENV);
  });
});

describe('connect vault listing', () => {
  it('maps vault names to titles and surfaces auth failures', async () => {
    const seen: string[] = [];
    const store = createConnectStore({
      vaultId: VAULT_ID,
      env: { OP_CONNECT_HOST: 'http://127.0.0.1:8080', OP_CONNECT_TOKEN: 'token-ok' },
      fetchImpl: async (url) => {
        seen.push(url);
        if (url.endsWith('/v1/vaults')) {
          return jsonResponse(200, [
            { id: 'v-2', name: 'Beta' },
            { id: 'v-1', name: 'Alpha', type: 'USER_CREATED' },
          ]);
        }
        return jsonResponse(404, { error: 'not found' });
      },
      sleep: () => Promise.resolve(),
    });
    const result = await listVaults({ store });
    expect(result.count).toBe(2);
    expect(result.vaults.map((entry) => entry.id)).toEqual(['v-1', 'v-2']);
    expect(result.vaults[1]).toMatchObject({ title: 'Beta' });
    expect(seen.some((url) => url.endsWith('/v1/vaults'))).toBe(true);
    const denied = createConnectStore({
      vaultId: VAULT_ID,
      env: { OP_CONNECT_HOST: 'http://127.0.0.1:8080', OP_CONNECT_TOKEN: 'bad' },
      fetchImpl: async () => jsonResponse(401, { error: 'unauthorized' }),
      sleep: () => Promise.resolve(),
    });
    await expect(listVaults({ store: denied })).rejects.toMatchObject({ code: 'auth' });
  });
});

describe('vault list command wiring', () => {
  it('runs through runSecretSync without Connect variables and leaves no state behind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-vault-'));
    try {
      const config = await writeSdkConfig(dir);
      const store = new MemoryFakeStore([
        { id: 'v-b', title: 'Beta' },
        { id: 'v-a', title: 'Alpha' },
      ]);
      const outcome = await runSecretSync({
        cwd: dir,
        config,
        command: 'vault',
        vaultSubcommand: 'list',
        store,
        env: {},
      });
      expect(outcome.command).toBe('vault');
      if (outcome.command !== 'vault') {
        throw new Error('expected vault result');
      }
      expect(outcome.result.subcommand).toBe('list');
      expect(outcome.result.vaults.map((entry) => entry.id)).toEqual(['v-a', 'v-b']);
      expect(store.counts.creates).toBe(0);
      const dry = await runSecretSync({
        cwd: dir,
        config,
        command: 'vault',
        vaultSubcommand: 'list',
        store,
        dryRun: true,
        env: {},
      });
      if (dry.command !== 'vault') {
        throw new Error('expected vault result');
      }
      expect(dry.result.dryRun).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects stores without vault listing support', async () => {
    const bare = {
      async listItems() {
        return [];
      },
      async getItem() {
        throw new SecretSyncError('not-found', 'missing');
      },
      async createItem() {
        return { status: 'uncertain', attempts: 1 } as const;
      },
    };
    await expect(listVaults({ store: bare })).rejects.toMatchObject({ code: 'validation' });
  });

  it('parses vault list in the CLI and rejects unrelated flags and bad subcommands', () => {
    expect(extractCommand(['vault', 'list'])).toMatchObject({ command: 'vault', vaultSubcommand: 'list' });
    expect(() => extractCommand(['vault', 'remove'])).toThrow('Unknown vault subcommand');
    const parsed = parseFlags(
      ['--file', '.env'],
      [
        { name: 'config' },
        { name: 'cwd' },
        { name: 'file', repeatable: true },
        { name: 'dry-run', boolean: true },
        { name: 'json', boolean: true },
      ],
    );
    if (parsed === null) {
      throw new Error('expected flags');
    }
    expect(() => assertCommandFlags(parsed, 'vault', undefined, 'list')).toThrow('--file');
    expect(() => validateSecretSyncCommandOptions('vault', { files: ['.env'] }, 'list')).toThrow(
      'vault list takes no selection',
    );
    expect(() => validateSecretSyncCommandOptions('vault', { message: 'hi' }, 'list')).toThrow(
      'vault list takes no selection',
    );
  });

  it('formats vault results as text and schema-versioned JSON without secrets', () => {
    const text = formatTextResult('vault', {
      vaults: [
        { id: 'v-1', title: 'Alpha' },
        { id: 'v-2', title: 'Beta', vaultType: 'USER_CREATED', activeItemCount: 4 },
      ],
    });
    expect(text).toContain('v-1 Alpha');
    expect(text).toContain('v-2 Beta');
    expect(formatTextResult('vault', { vaults: [] })).toBe('no vaults');
    const json = formatJsonResult('vault', { subcommand: 'list', vaults: [{ id: 'v-1', title: 'Alpha' }], count: 1 });
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed).toMatchObject({ schemaVersion: 1, command: 'vault', status: 'ok' });
  });
});
