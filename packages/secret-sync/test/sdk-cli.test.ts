import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  assertCommandFlags,
  createSdkStore,
  createSecretStoreForPlan,
  initSecrets,
  resolveIdentityForPlan,
  resolveSecretSyncPlan,
  runSecretSync,
  validateSecretSyncCommandOptions,
  type SdkClientFactory,
  type SecretSyncResult,
} from '../src/index';
import { publishSnapshot } from '../src/history-store';
import { parseFlags } from '@repo-toolkit/publish-package';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const VAULT_ID = 'vault-direct-05';
const TOKEN_ENV = 'OP_SERVICE_ACCOUNT_TOKEN';
const ACCOUNT = 'test-account-05';
const packageRoot = resolve(import.meta.dirname, '..');
const cli = join(packageRoot, 'dist', 'cli.js');

type AuthVariant = 'service-account' | 'desktop';

interface FakeField {
  id: string;
  title: string;
  sectionId?: string;
  fieldType: string;
  value: string;
}

interface FakeItem {
  id: string;
  title: string;
  vaultId: string;
  tags: string[];
  fields: FakeField[];
}

interface FakeCalls {
  factories: number;
  authKinds: string[];
  lists: number;
  gets: number;
  creates: number;
  listVaults: string[];
}

function testUuid(tag: number): string {
  const tail = tag.toString(16).padStart(12, '0');
  return `eeeeeeee-eeee-4eee-8eee-${tail}`;
}

function createFakeSdk(): { factory: SdkClientFactory; calls: FakeCalls } {
  const items = new Map<string, FakeItem>();
  let counter = 0;
  const calls: FakeCalls = { factories: 0, authKinds: [], lists: 0, gets: 0, creates: 0, listVaults: [] };
  const factory: SdkClientFactory = async (config) => {
    calls.factories += 1;
    calls.authKinds.push(config.auth.kind);
    return {
      items: {
        async list(vaultId: string) {
          calls.lists += 1;
          calls.listVaults.push(vaultId);
          return [...items.values()]
            .filter((item) => item.vaultId === vaultId)
            .map((item) => ({
              id: item.id,
              title: item.title,
              category: 'SecureNote',
              vaultId: item.vaultId,
              tags: [...item.tags],
              state: 'active',
            }));
        },
        async get(vaultId: string, itemId: string) {
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
        async create(params: { title: string; vaultId: string; tags: string[]; fields: FakeField[] }) {
          calls.creates += 1;
          counter += 1;
          const id = `sdk-item-${counter}`;
          const stored: FakeItem = {
            id,
            title: params.title,
            vaultId: params.vaultId,
            tags: [...params.tags],
            fields: params.fields.map((field) => ({ ...field })),
          };
          items.set(id, stored);
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
  };
  return { factory, calls };
}

function envFor(variant: AuthVariant): Record<string, string | undefined> {
  if (variant === 'service-account') {
    return { [TOKEN_ENV]: `sdk-token-${variant}` };
  }
  return {};
}

function remoteFor(variant: AuthVariant): Record<string, unknown> {
  if (variant === 'service-account') {
    return { type: 'onepassword-sdk', vaultId: VAULT_ID, auth: { type: 'service-account', tokenEnv: TOKEN_ENV } };
  }
  return { type: 'onepassword-sdk', vaultId: VAULT_ID, auth: { type: 'desktop', account: ACCOUNT } };
}

async function writeSdkConfig(dir: string, variant: AuthVariant): Promise<string> {
  const path = join(dir, 'secret-sync.config.json');
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      projectId: PROJECT_ID,
      root: '.',
      remote: remoteFor(variant),
      branch: 'main',
      files: ['.env'],
      ignore: [],
      limits: { maxFileBytes: 32768, maxFiles: 100, concurrency: 4 },
    }),
  );
  return path;
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'secsync-sdk05-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key === 'OP_CONNECT_HOST' || key === 'OP_CONNECT_TOKEN' || key === 'OP_SERVICE_ACCOUNT_TOKEN') {
      continue;
    }
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return { ...env, ...extra };
}

function runCli(
  args: ReadonlyArray<string>,
  cwd: string,
  env: Record<string, string>,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8', timeout: 60000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function statusOf(outcome: SecretSyncResult): asserts outcome is Extract<SecretSyncResult, { command: 'status' }> {
  if (outcome.command !== 'status') {
    throw new Error(`expected status, got ${outcome.command}`);
  }
}

describe.each([['service-account'], ['desktop']] as Array<[AuthVariant]>)('sdk dispatch (%s)', (variant) => {
  it('runs the full command set through a fake SDK without Connect variables', async () => {
    await withTempDir(async (dir) => {
      const config = await writeSdkConfig(dir, variant);
      const env = envFor(variant);
      const sdk = createFakeSdk();
      const base = { config, cwd: dir, env, sdkClientFactory: sdk.factory };
      await writeFile(join(dir, '.env'), 'V=1\n');
      const first = await runSecretSync({ ...base, command: 'push', message: 'first' });
      if (first.command !== 'push') throw new Error('expected push');
      expect(first.result.published).toBe(true);
      const clean = await runSecretSync({ ...base, command: 'status', check: true });
      statusOf(clean);
      expect(clean.result.checkFailed).toBe(false);
      expect(clean.result.clean).toBe(true);
      await writeFile(join(dir, '.env'), 'V=2\n');
      const second = await runSecretSync({ ...base, command: 'push', message: 'second' });
      if (second.command !== 'push') throw new Error('expected push');
      expect(second.result.published).toBe(true);
      const logged = await runSecretSync({ ...base, command: 'log', file: ['.env'] });
      if (logged.command !== 'log') throw new Error('expected log');
      const blobIds = [...new Set(logged.result.entries.map((entry) => entry.blobId).filter((id) => id !== undefined))];
      expect(blobIds.length).toBeGreaterThanOrEqual(2);
      const oldest = blobIds[blobIds.length - 1] as string;
      const rolled = await runSecretSync({
        ...base,
        command: 'rollback',
        file: ['.env'],
        revision: oldest,
        message: 'back',
      });
      if (rolled.command !== 'rollback') throw new Error('expected rollback');
      expect(rolled.result.published).toBe(true);
      const rolledHead = rolled.result.commitId;
      if (rolledHead === undefined) throw new Error('expected rollback commit');
      const recovered = await runSecretSync({ ...base, command: 'status', check: true });
      statusOf(recovered);
      expect(recovered.result.checkFailed).toBe(false);
      await writeFile(join(dir, '.env'), 'V=3\n');
      const drifted = await runSecretSync({ ...base, command: 'status', check: true });
      statusOf(drifted);
      expect(drifted.result.checkFailed).toBe(true);
      const diffed = await runSecretSync({ ...base, command: 'diff' });
      if (diffed.command !== 'diff') throw new Error('expected diff');
      expect(diffed.result.entries.length).toBeGreaterThan(0);
      const restored = await runSecretSync({
        ...base,
        command: 'restore',
        file: ['.env'],
        revision: oldest,
        overwrite: true,
      });
      if (restored.command !== 'restore') throw new Error('expected restore');
      expect(restored.result.overwritten).toBe(true);
      const cleanAgain = await runSecretSync({ ...base, command: 'status', check: true });
      statusOf(cleanAgain);
      expect(cleanAgain.result.checkFailed).toBe(false);
      const created = await runSecretSync({
        ...base,
        command: 'branch',
        branchSubcommand: 'create',
        name: 'feature/sdk',
        from: 'main',
      });
      if (created.command !== 'branch' || created.result.subcommand !== 'create')
        throw new Error('expected branch create');
      expect(created.result.created).toBe(true);
      const listed = await runSecretSync({ ...base, command: 'branch', branchSubcommand: 'list' });
      if (listed.command !== 'branch' || listed.result.subcommand !== 'list') throw new Error('expected branch list');
      expect(listed.result.branches.map((entry) => entry.branch)).toContain('feature/sdk');
      const moved = await runSecretSync({ ...base, command: 'switch', branch: 'feature/sdk' });
      if (moved.command !== 'switch') throw new Error('expected switch');
      expect(moved.result.switched).toBe(true);
      expect(moved.result.to).toBe('feature/sdk');
      const store = createSecretStoreForPlan(await resolveSecretSyncPlan({ config, cwd: dir }), {
        env,
        sdkClientFactory: sdk.factory,
      });
      const forkA = await publishSnapshot(store, {
        projectId: PROJECT_ID,
        branch: 'main',
        parents: [],
        files: [{ path: '.env', bytes: Buffer.from('fork-a', 'utf8') }],
        timestamp: 100,
        operationId: testUuid(501),
        operationKind: 'push',
        commitId: testUuid(502),
      });
      const forkB = await publishSnapshot(store, {
        projectId: PROJECT_ID,
        branch: 'main',
        parents: [],
        files: [{ path: '.env', bytes: Buffer.from('fork-b', 'utf8') }],
        timestamp: 200,
        operationId: testUuid(503),
        operationKind: 'push',
        commitId: testUuid(504),
      });
      void forkA;
      void forkB;
      const resolved = await runSecretSync({
        ...base,
        command: 'resolve',
        heads: [rolledHead, testUuid(502), testUuid(504)],
        take: testUuid(502),
      });
      if (resolved.command !== 'resolve') throw new Error('expected resolve');
      expect(resolved.result.published).toBe(true);
      expect(resolved.result.divergedAfter).toBe(false);
      const dryCreates = sdk.calls.creates;
      await writeFile(join(dir, '.env'), 'V=dry\n');
      const dry = await runSecretSync({ ...base, command: 'push', dryRun: true });
      if (dry.command !== 'push') throw new Error('expected push');
      expect(dry.result.published).toBe(false);
      expect(dry.result.dryRun).toBe(true);
      expect(sdk.calls.creates).toBe(dryCreates);
      expect(sdk.calls.listVaults.every((vault) => vault === VAULT_ID)).toBe(true);
    });
  });

  it('reports provider-aware doctor diagnostics without secrets or fabricated endpoints', async () => {
    await withTempDir(async (dir) => {
      const config = await writeSdkConfig(dir, variant);
      const canary = `sdk-canary-${variant}-${Date.now()}`;
      const env: Record<string, string | undefined> = variant === 'service-account' ? { [TOKEN_ENV]: canary } : {};
      const sdk = createFakeSdk();
      await writeFile(join(dir, '.env'), 'V=1\n');
      await runSecretSync({ config, cwd: dir, command: 'push', message: 'seed', env, sdkClientFactory: sdk.factory });
      const outcome = await runSecretSync({ config, cwd: dir, command: 'doctor', env, sdkClientFactory: sdk.factory });
      if (outcome.command !== 'doctor') throw new Error('expected doctor');
      expect(outcome.result.provider).toBe('onepassword-sdk');
      expect(outcome.result.authMode).toBe(variant);
      expect(outcome.result.endpointHost).toBeUndefined();
      expect(outcome.result.writeProbed).toBe(false);
      expect(outcome.result.checks.some((check) => check.name === 'backend')).toBe(true);
      expect(outcome.result.checks.some((check) => check.name === 'endpoint')).toBe(false);
      const bounds = outcome.result.checks
        .filter((check) => check.name === 'bounds')
        .map((check) => check.detail)
        .join('\n');
      expect(bounds).not.toContain('GET retries');
      const serialized = JSON.stringify(outcome.result);
      expect(serialized).not.toContain(canary);
      expect(serialized).not.toContain('https://');
      expect(serialized).not.toContain('http://');
    });
  });

  it('fails usefully when direct auth is missing', async () => {
    await withTempDir(async (dir) => {
      const config = await writeSdkConfig(dir, variant);
      const sdk = createFakeSdk();
      if (variant === 'service-account') {
        await expect(
          runSecretSync({ config, cwd: dir, command: 'status', env: {}, sdkClientFactory: sdk.factory }),
        ).rejects.toThrow(/OP_SERVICE_ACCOUNT_TOKEN/);
      } else {
        await expect(
          runSecretSync({
            config,
            cwd: dir,
            command: 'status',
            projectId: PROJECT_ID,
            remote: { type: 'onepassword-sdk', vaultId: VAULT_ID, auth: { type: 'desktop', account: '' } },
            env: {},
            sdkClientFactory: sdk.factory,
          }),
        ).rejects.toThrow(/account/);
      }
    });
  });
});

describe('sdk backend selection', () => {
  it('creates real SDK stores without Connect variables and never touches fetch', async () => {
    const plan = await resolveSecretSyncPlan({
      cwd: process.cwd(),
      projectId: PROJECT_ID,
      remote: remoteFor('service-account'),
      files: ['.env'],
    });
    const sdk = createFakeSdk();
    const store = createSecretStoreForPlan(plan, {
      env: { [TOKEN_ENV]: 'selection-token' },
      sdkClientFactory: sdk.factory,
      fetchImpl: () => {
        throw new Error('Connect fetch must not be used for SDK plans.');
      },
    });
    const identity = resolveIdentityForPlan(plan, {});
    expect(identity).toEqual({ type: 'onepassword-sdk', vaultId: VAULT_ID, projectId: PROJECT_ID });
    expect(await store.listItems()).toEqual([]);
    expect(sdk.calls.lists).toBe(1);
  });

  it('keeps injected SDK stores free of OP_CONNECT_HOST', async () => {
    await withTempDir(async (dir) => {
      const { MemoryFakeStore } = await import('./helpers');
      const config = await writeSdkConfig(dir, 'desktop');
      await writeFile(join(dir, '.env'), 'V=1\n');
      const store = new MemoryFakeStore();
      const pushed = await runSecretSync({ config, cwd: dir, command: 'push', message: 'injected', store, env: {} });
      if (pushed.command !== 'push') throw new Error('expected push');
      expect(pushed.result.published).toBe(true);
      expect(store.counts.creates).toBeGreaterThan(0);
    });
  });

  it('never initializes the SDK for Connect plans', async () => {
    const plan = await resolveSecretSyncPlan({
      cwd: process.cwd(),
      projectId: PROJECT_ID,
      remote: { type: 'onepassword-connect', vaultId: 'vault-1' },
      files: ['.env'],
    });
    let lists = 0;
    const store = createSecretStoreForPlan(plan, {
      env: { OP_CONNECT_HOST: 'https://connect.example', OP_CONNECT_TOKEN: 'token' },
      sdkClientFactory: () => {
        throw new Error('SDK must not initialize for Connect plans.');
      },
      fetchImpl: async () => {
        lists += 1;
        return { status: 200, headers: { get: () => null }, text: async () => '[]' };
      },
    });
    expect(await store.listItems()).toEqual([]);
    expect(lists).toBe(1);
    expect(resolveIdentityForPlan(plan, { OP_CONNECT_HOST: 'https://connect.example' })).toEqual({
      type: 'onepassword-connect',
      endpoint: 'https://connect.example',
      vaultId: 'vault-1',
      projectId: PROJECT_ID,
    });
  });

  it('rejects endpoint resolution for SDK plans instead of demanding a Connect URL', async () => {
    const { resolveEndpointForPlan } = await import('../src/index');
    const plan = await resolveSecretSyncPlan({
      cwd: process.cwd(),
      projectId: PROJECT_ID,
      remote: remoteFor('desktop'),
      files: ['.env'],
    });
    expect(() => resolveEndpointForPlan(plan, { OP_CONNECT_HOST: 'https://connect.example' })).toThrow(
      /Direct SDK backend/,
    );
  });

  it('enforces strict init-only flags', () => {
    const parsed = parseFlags(
      ['--provider', 'onepassword-sdk'],
      [{ name: 'provider' }, { name: 'check', boolean: true }],
    );
    if (!parsed) throw new Error('expected flags');
    expect(() => assertCommandFlags(parsed, 'status', undefined)).toThrow(/--provider/);
    expect(() => assertCommandFlags(parsed, 'init', undefined)).not.toThrow();
    expect(() => validateSecretSyncCommandOptions('status', { provider: 'onepassword-sdk' })).toThrow(/init command/);
    expect(() => validateSecretSyncCommandOptions('push', { vault: 'v' })).toThrow(/init command/);
    expect(() => validateSecretSyncCommandOptions('init', { provider: 'sdk' })).toThrow(/--provider/);
    expect(() => validateSecretSyncCommandOptions('init', { auth: 'token' })).toThrow(/--auth/);
    expect(() => validateSecretSyncCommandOptions('init', { auth: 'service-account', account: 'x' })).toThrow(
      /--account/,
    );
    expect(() => validateSecretSyncCommandOptions('init', { auth: 'desktop', tokenEnv: 'X' })).toThrow(/--token-env/);
    expect(() =>
      validateSecretSyncCommandOptions('init', {
        provider: 'onepassword-sdk',
        auth: 'service-account',
        tokenEnv: TOKEN_ENV,
      }),
    ).not.toThrow();
  });
});

describe('sdk init', () => {
  it('generates service-account and desktop configs without token values on disk', async () => {
    await withTempDir(async (dir) => {
      const service = await initSecrets({
        cwd: dir,
        vault: VAULT_ID,
        provider: 'onepassword-sdk',
        auth: 'service-account',
        env: {},
      });
      expect(service.createdConfig).toBe(true);
      expect(service.remoteInitialized).toBe(true);
      const serviceRaw = await readFile(service.configPath, 'utf8');
      expect(serviceRaw).toContain('onepassword-sdk');
      expect(serviceRaw).toContain(TOKEN_ENV);
      const parsed = JSON.parse(serviceRaw) as { remote: { auth: { tokenEnv: string } } };
      expect(parsed.remote.auth.tokenEnv).toBe(TOKEN_ENV);
    });
    await withTempDir(async (dir) => {
      const desktop = await initSecrets({
        cwd: dir,
        vault: VAULT_ID,
        provider: 'onepassword-sdk',
        auth: 'desktop',
        account: ACCOUNT,
        env: {},
      });
      expect(desktop.createdConfig).toBe(true);
      expect(desktop.remoteInitialized).toBe(true);
      const raw = await readFile(desktop.configPath, 'utf8');
      expect(raw).toContain(ACCOUNT);
    });
  });

  it('supports custom token env names and keeps Connect defaults', async () => {
    await withTempDir(async (dir) => {
      const result = await initSecrets({
        cwd: dir,
        vault: VAULT_ID,
        provider: 'onepassword-sdk',
        auth: 'service-account',
        tokenEnv: 'MY_SA_TOKEN',
        env: {},
      });
      const raw = JSON.parse(await readFile(result.configPath, 'utf8')) as {
        remote: { auth: { tokenEnv: string } };
      };
      expect(raw.remote.auth.tokenEnv).toBe('MY_SA_TOKEN');
    });
    await withTempDir(async (dir) => {
      const result = await initSecrets({ cwd: dir, vault: VAULT_ID, env: {} });
      const raw = JSON.parse(await readFile(result.configPath, 'utf8')) as {
        remote: { type: string; hostEnv: string; tokenEnv: string };
      };
      expect(raw.remote.type).toBe('onepassword-connect');
      expect(raw.remote.hostEnv).toBe('OP_CONNECT_HOST');
      expect(raw.remote.tokenEnv).toBe('OP_CONNECT_TOKEN');
    });
  });

  it('preserves existing configs and rejects incompatible flags', async () => {
    await withTempDir(async (dir) => {
      const first = await initSecrets({
        cwd: dir,
        vault: VAULT_ID,
        provider: 'onepassword-sdk',
        auth: 'service-account',
        env: {},
      });
      const before = await readFile(first.configPath, 'utf8');
      const second = await initSecrets({
        cwd: dir,
        vault: VAULT_ID,
        provider: 'onepassword-sdk',
        auth: 'service-account',
        env: {},
      });
      expect(second.createdConfig).toBe(false);
      expect(await readFile(second.configPath, 'utf8')).toBe(before);
      await expect(
        initSecrets({ cwd: dir, vault: VAULT_ID, provider: 'onepassword-connect', env: {} }),
      ).rejects.toThrow(/differs/);
      await expect(
        initSecrets({
          cwd: dir,
          vault: VAULT_ID,
          provider: 'onepassword-sdk',
          auth: 'desktop',
          account: ACCOUNT,
          env: {},
        }),
      ).rejects.toThrow(/differs/);
      await expect(initSecrets({ cwd: dir, vault: 'other-vault', env: {} })).rejects.toThrow(/differs/);
      await expect(
        initSecrets({ cwd: dir, vault: VAULT_ID, provider: 'onepassword-sdk', auth: 'desktop', env: {} }),
      ).rejects.toThrow(/differs|--account/);
    });
    await withTempDir(async (dir) => {
      await initSecrets({ cwd: dir, vault: VAULT_ID, env: {} });
      await expect(
        initSecrets({ cwd: dir, vault: VAULT_ID, provider: 'onepassword-sdk', auth: 'service-account', env: {} }),
      ).rejects.toThrow(/differs/);
      await expect(initSecrets({ cwd: dir, vault: VAULT_ID, auth: 'desktop', env: {} })).rejects.toThrow(
        /onepassword-sdk/,
      );
    });
  });

  it('requires explicit auth and account details for new SDK configs', async () => {
    await withTempDir(async (dir) => {
      await expect(initSecrets({ cwd: dir, vault: VAULT_ID, provider: 'onepassword-sdk', env: {} })).rejects.toThrow(
        /--auth/,
      );
      await expect(
        initSecrets({ cwd: dir, vault: VAULT_ID, provider: 'onepassword-sdk', auth: 'desktop', env: {} }),
      ).rejects.toThrow(/--account/);
      await expect(
        initSecrets({
          cwd: dir,
          vault: VAULT_ID,
          provider: 'onepassword-sdk',
          auth: 'service-account',
          account: ACCOUNT,
          env: {},
        }),
      ).rejects.toThrow(/--account/);
      await expect(
        initSecrets({
          cwd: dir,
          vault: VAULT_ID,
          provider: 'onepassword-sdk',
          auth: 'desktop',
          account: ACCOUNT,
          tokenEnv: TOKEN_ENV,
          env: {},
        }),
      ).rejects.toThrow(/--token-env/);
      await expect(
        initSecrets({
          cwd: dir,
          vault: VAULT_ID,
          provider: 'onepassword-sdk',
          auth: 'service-account',
          tokenEnv: 'bad-name!',
          env: {},
        }),
      ).rejects.toThrow(/--token-env/);
    });
  });
});

describe('built sdk cli', () => {
  it('keeps help available with all Connect variables unset', () => {
    const root = runCli(['--help'], packageRoot, cleanEnv());
    expect(root.status).toBe(0);
    expect(root.stdout).toContain('onepassword-sdk');
    expect(root.stdout).toContain('--token-env');
    const status = runCli(['status', '--help'], packageRoot, cleanEnv());
    expect(status.status).toBe(0);
    expect(status.stdout).toContain('repo-toolkit-secret-sync status');
  });

  it('rejects unknown and misplaced flags without touching any backend', () => {
    const unknown = runCli(['status', '--nope'], packageRoot, cleanEnv());
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('Unknown argument');
    const misplaced = runCli(['status', '--provider', 'onepassword-sdk'], packageRoot, cleanEnv());
    expect(misplaced.status).toBe(1);
    expect(misplaced.stderr).toContain('--provider');
  });

  it('creates SDK configs through init and preserves them on repeat runs', async () => {
    await withTempDir(async (dir) => {
      const created = runCli(
        ['init', '--provider', 'onepassword-sdk', '--auth', 'service-account', '--vault', VAULT_ID],
        dir,
        cleanEnv(),
      );
      expect(created.status).toBe(0);
      const raw = await readFile(join(dir, 'secret-sync.config.json'), 'utf8');
      expect(raw).toContain('onepassword-sdk');
      expect(raw).toContain(TOKEN_ENV);
      const repeated = runCli(
        ['init', '--provider', 'onepassword-sdk', '--auth', 'service-account', '--vault', VAULT_ID],
        dir,
        cleanEnv(),
      );
      expect(repeated.status).toBe(0);
      expect(await readFile(join(dir, 'secret-sync.config.json'), 'utf8')).toBe(raw);
      const mismatch = runCli(['init', '--provider', 'onepassword-connect', '--vault', VAULT_ID], dir, cleanEnv());
      expect(mismatch.status).toBe(1);
      expect(mismatch.stderr).toContain('differs');
    });
    await withTempDir(async (dir) => {
      const missingAccount = runCli(
        ['init', '--provider', 'onepassword-sdk', '--auth', 'desktop', '--vault', VAULT_ID],
        dir,
        cleanEnv(),
      );
      expect(missingAccount.status).toBe(1);
      expect(missingAccount.stderr).toContain('--account');
    });
  });

  it('reports a direct-auth error instead of demanding Connect', async () => {
    await withTempDir(async (dir) => {
      await writeSdkConfig(dir, 'service-account');
      const outcome = runCli(['status', '--config', join(dir, 'secret-sync.config.json')], dir, cleanEnv());
      expect(outcome.status).toBe(1);
      expect(outcome.stderr).toContain(TOKEN_ENV);
      expect(outcome.stderr).not.toContain('OP_CONNECT_HOST');
    });
  });

  it('emits provider-aware JSON diagnostics without secrets or fabricated endpoints', async () => {
    await withTempDir(async (dir) => {
      const canary = `spawn-canary-${Date.now()}`;
      await writeSdkConfig(dir, 'desktop');
      const outcome = runCli(['doctor', '--config', join(dir, 'secret-sync.config.json'), '--json'], dir, cleanEnv());
      expect(outcome.status).toBe(0);
      const parsed = JSON.parse(outcome.stdout) as {
        status: string;
        command: string;
        provider: string;
        authMode: string;
        endpointHost?: string;
        account: string;
        checks: Array<{ name: string; detail: string }>;
      };
      expect(parsed.status).toBe('ok');
      expect(parsed.provider).toBe('onepassword-sdk');
      expect(parsed.authMode).toBe('desktop');
      expect(parsed.endpointHost).toBeUndefined();
      expect(parsed.account).toBe(ACCOUNT);
      expect(outcome.stdout).not.toContain(canary);
      expect(outcome.stdout).not.toContain('https://');
      const bounds = parsed.checks
        .filter((check) => check.name === 'bounds')
        .map((check) => check.detail)
        .join('\n');
      expect(bounds).not.toContain('GET retries');
    });
  });

  it('drives status --check results that control the CLI exit code', async () => {
    await withTempDir(async (dir) => {
      const config = await writeSdkConfig(dir, 'desktop');
      const sdk = createFakeSdk();
      await writeFile(join(dir, '.env'), 'V=1\n');
      const store = createSdkStore({
        vaultId: VAULT_ID,
        auth: { type: 'desktop', account: ACCOUNT },
        clientFactory: sdk.factory,
        env: {},
      });
      await runSecretSync({ config, cwd: dir, command: 'push', message: 'seed', store, env: {} });
      await writeFile(join(dir, '.env'), 'V=2\n');
      const drifted = await runSecretSync({ config, cwd: dir, command: 'status', check: true, store, env: {} });
      statusOf(drifted);
      expect(drifted.result.checkFailed).toBe(true);
      await writeFile(join(dir, '.env'), 'V=1\n');
      const cleanAgain = await runSecretSync({ config, cwd: dir, command: 'status', check: true, store, env: {} });
      statusOf(cleanAgain);
      expect(cleanAgain.result.checkFailed).toBe(false);
    });
  });
});
