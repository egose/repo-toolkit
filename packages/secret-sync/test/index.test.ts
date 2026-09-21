import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildOptions, extractCommand } from '../src/cli';
import {
  DEFAULT_SDK_TOKEN_ENV,
  createSelectionMatcher,
  discoverLocalFiles,
  isConnectRemote,
  isSdkRemote,
  resolveSecretSyncPlan,
  runSecretSync,
  selectExactFiles,
  validateBranchName,
  validateGlobPatterns,
  validateRemoteConfig,
  validateSecretItemDetail,
  validateSecretItemSummary,
  validateSecretSyncCommandOptions,
  validateSecretSyncConfig,
} from '../src/index';
import { mapWithConcurrency as mapWithConcurrencyNeutral } from '../src/concurrency';
import { mapWithConcurrency as mapWithConcurrencyCompat } from '../src/connect';
import { parseFlags } from '@repo-toolkit/publish-package';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'secret-sync-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeFixtureFile(root: string, rel: string, contents = 'secret'): Promise<void> {
  const parts = rel.split('/');
  await mkdir(join(root, ...parts.slice(0, -1)), { recursive: true });
  await writeFile(join(root, ...parts), contents);
}

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    remote: { type: 'onepassword-connect', vaultId: 'vault-1' },
    ...overrides,
  };
}

describe('validateSecretSyncConfig', () => {
  it('rejects unknown schema versions', () => {
    expect(() => validateSecretSyncConfig(baseConfig({ schemaVersion: 2 }))).toThrow(/schemaVersion/);
    expect(() => validateSecretSyncConfig(baseConfig({ schemaVersion: 0 }))).toThrow(/schemaVersion/);
    const { schemaVersion: _dropped, ...without } = baseConfig();
    void _dropped;
    expect(() => validateSecretSyncConfig(without)).toThrow(/schemaVersion/);
  });

  it('rejects unknown top-level fields', () => {
    expect(() => validateSecretSyncConfig(baseConfig({ backend: 'sdk' }))).toThrow(/Unknown config field/);
  });

  it('rejects a non-UUID projectId', () => {
    expect(() => validateSecretSyncConfig(baseConfig({ projectId: 'not-a-uuid' }))).toThrow(/projectId/);
    expect(() => validateSecretSyncConfig(baseConfig({ projectId: 42 }))).toThrow(/projectId/);
  });

  it('rejects unknown remote types and bad env names', () => {
    expect(() => validateSecretSyncConfig(baseConfig({ remote: { type: 'sdk', vaultId: 'v' } }))).toThrow(
      /remote\.type/,
    );
    expect(() =>
      validateSecretSyncConfig(baseConfig({ remote: { type: 'onepassword-connect', vaultId: '' } })),
    ).toThrow(/vaultId/);
    expect(() =>
      validateSecretSyncConfig(
        baseConfig({ remote: { type: 'onepassword-connect', vaultId: 'v', tokenEnv: 'has-dash' } }),
      ),
    ).toThrow(/tokenEnv/);
  });

  it('enforces limit hard ceilings but allows lowering them', () => {
    expect(() => validateSecretSyncConfig(baseConfig({ limits: { maxFileBytes: 32769 } }))).toThrow(/hard ceiling/);
    expect(() => validateSecretSyncConfig(baseConfig({ limits: { maxFiles: 101 } }))).toThrow(/hard ceiling/);
    expect(() => validateSecretSyncConfig(baseConfig({ limits: { concurrency: 9 } }))).toThrow(/hard ceiling/);
    expect(() => validateSecretSyncConfig(baseConfig({ limits: { concurrency: 0 } }))).toThrow(/positive/);
    const lowered = validateSecretSyncConfig(
      baseConfig({ limits: { maxFileBytes: 1024, maxFiles: 10, concurrency: 2 } }),
    );
    expect(lowered.limits).toEqual({ maxFileBytes: 1024, maxFiles: 10, concurrency: 2 });
  });

  it('rejects leading !, RegExp, regex-objects, absolute, traversal, and invalid patterns', () => {
    expect(() => validateGlobPatterns(['!keep'], 'files')).toThrow(/ignore/);
    expect(() => validateGlobPatterns([/\.env/ as unknown as string], 'files')).toThrow(/RegExp/);
    expect(() => validateGlobPatterns([{ source: 'x' } as unknown as string], 'files')).toThrow(/regex-looking/);
    expect(() => validateGlobPatterns(['/abs/path'], 'files')).toThrow(/project-relative/);
    expect(() => validateGlobPatterns(['../escape'], 'files')).toThrow(/traversal/);
    expect(() => validateGlobPatterns([''], 'files')).toThrow(/non-empty/);
    expect(() => validateGlobPatterns(['a{'], 'files')).toThrow(/never match/);
  });
});

describe('validateBranchName', () => {
  it('accepts the default and nested names', () => {
    expect(validateBranchName('main')).toBe('main');
    expect(validateBranchName('feature/demo-1.0')).toBe('feature/demo-1.0');
  });

  it('rejects empty, dot, and overlong names', () => {
    expect(() => validateBranchName('')).toThrow();
    expect(() => validateBranchName('.')).toThrow();
    expect(() => validateBranchName('..')).toThrow();
    expect(() => validateBranchName('a/./b')).toThrow();
    expect(() => validateBranchName('a/../b')).toThrow();
    expect(() => validateBranchName('a//b')).toThrow();
    expect(() => validateBranchName(`a${'b'.repeat(128)}`)).toThrow();
    expect(() => validateBranchName('-leading')).toThrow();
  });
});

describe('validateSecretSyncCommandOptions', () => {
  it('rejects mutually exclusive and misplaced options', () => {
    expect(() => validateSecretSyncCommandOptions('status', { remove: true })).toThrow(/--delete/);
    expect(() => validateSecretSyncCommandOptions('push', { check: true })).toThrow(/--check/);
    expect(() => validateSecretSyncCommandOptions('pull', { message: 'x' })).toThrow(/--message/);
    expect(() => validateSecretSyncCommandOptions('push', { revision: 'r' })).toThrow(/--revision/);
    expect(() =>
      validateSecretSyncCommandOptions('restore', { files: ['a'], revision: 'r', fromBranch: 'main' }),
    ).toThrow(/mutually exclusive/);
    expect(() => validateSecretSyncCommandOptions('push', { branch: 'other' })).toThrow(/active branch/);
    expect(() =>
      validateSecretSyncCommandOptions('restore', { files: ['a'], revision: 'r', overwrite: false, limit: 3 }),
    ).toThrow(/--limit/);
    expect(() => validateSecretSyncCommandOptions('status', { heads: ['a', 'b'], take: 'a' })).toThrow(/--head/);
    expect(() => validateSecretSyncCommandOptions('resolve', { heads: ['a'], take: 'a' })).toThrow(/at least two/);
    expect(() => validateSecretSyncCommandOptions('resolve', { heads: ['a', 'b'], take: 'c' })).toThrow(
      /one of the --head/,
    );
    expect(() => validateSecretSyncCommandOptions('branch', {}, 'create')).toThrow(/--name/);
  });
});

describe('resolveSecretSyncPlan', () => {
  it('resolves inline options without a config file and keeps token values out', async () => {
    const canary = `canary-token-${Date.now()}`;
    process.env.SECRETSYNC_TEST_TOKEN_ENV = canary;
    try {
      const plan = await resolveSecretSyncPlan({
        cwd: process.cwd(),
        projectId: PROJECT_ID,
        remote: { type: 'onepassword-connect', vaultId: 'vault-1', tokenEnv: 'SECRETSYNC_TEST_TOKEN_ENV' },
        files: ['.env'],
      });
      expect(plan.projectId).toBe(PROJECT_ID);
      expect(plan.branch).toBe('main');
      expect(plan.remote.tokenEnv).toBe('SECRETSYNC_TEST_TOKEN_ENV');
      expect(JSON.stringify(plan)).not.toContain(canary);
    } finally {
      delete process.env.SECRETSYNC_TEST_TOKEN_ENV;
    }
  });

  it('rejects unknown commands instead of returning stub success', async () => {
    await expect(
      resolveSecretSyncPlan({ cwd: process.cwd(), command: 'explode', projectId: PROJECT_ID }),
    ).rejects.toThrow(/Unknown command/);
  });

  it('runSecretSync executes status with an injected store', async () => {
    const { MemoryFakeStore } = await import('./helpers');
    const store = new MemoryFakeStore();
    const outcome = await runSecretSync({
      cwd: process.cwd(),
      command: 'status',
      projectId: PROJECT_ID,
      remote: { type: 'onepassword-connect', vaultId: 'vault-1' },
      store,
      env: { OP_CONNECT_HOST: 'https://connect.example', OP_CONNECT_TOKEN: 'test-token' },
    });
    expect(outcome.command).toBe('status');
  });
});

describe('discovery', () => {
  it('matches dotfiles with dot enabled', async () => {
    await withTempDir(async (dir) => {
      await writeFixtureFile(dir, '.env', 'A=1');
      await writeFixtureFile(dir, 'README.md', 'docs');
      const result = await discoverLocalFiles({ root: dir, files: ['.env*'], ignore: [] });
      expect(result.paths).toEqual(['.env']);
    });
  });

  it('matches braces across nested directories', async () => {
    await withTempDir(async (dir) => {
      await writeFixtureFile(dir, 'secrets/app/creds.json', '{}');
      await writeFixtureFile(dir, 'secrets/tls/cert.pem', 'pem');
      await writeFixtureFile(dir, 'secrets/notes.txt', 'nope');
      const result = await discoverLocalFiles({ root: dir, files: ['secrets/**/*.{json,pem,key}'], ignore: [] });
      expect(result.paths).toEqual(['secrets/app/creds.json', 'secrets/tls/cert.pem']);
    });
  });

  it('lets ignore win over files and always excludes state internals', async () => {
    await withTempDir(async (dir) => {
      await writeFixtureFile(dir, '.env', 'A=1');
      await writeFixtureFile(dir, '.env.example', 'SAMPLE=1');
      await writeFixtureFile(dir, '.git/HEAD', 'ref');
      await writeFixtureFile(dir, '.repo-toolkit-secret-sync/state.json', '{}');
      const result = await discoverLocalFiles({ root: dir, files: ['.env*'], ignore: ['**/.env.example'] });
      expect(result.paths).toEqual(['.env']);
    });
  });

  it('prunes directories matching /**-suffixed ignores without counting their contents', async () => {
    await withTempDir(async (dir) => {
      await writeFixtureFile(dir, 'keep.json', '{}');
      for (let i = 0; i < 25; i += 1) {
        await writeFixtureFile(dir, `node_modules/pkg/f${i}.json`, '{}');
      }
      const pruned = await discoverLocalFiles({ root: dir, files: ['**/*.json'], ignore: ['**/node_modules/**'] });
      expect(pruned.paths).toEqual(['keep.json']);
      expect(pruned.scanned).toBe(2);
      const full = await discoverLocalFiles({ root: dir, files: ['**/*.json'], ignore: [] });
      expect(full.paths).toHaveLength(26);
      expect(full.scanned).toBe(28);
    });
  });

  it('does not prune directories on exact-file ignores', async () => {
    await withTempDir(async (dir) => {
      await writeFixtureFile(dir, 'data/inner.json', '{}');
      const result = await discoverLocalFiles({ root: dir, files: ['**/*.json'], ignore: ['data'] });
      expect(result.paths).toEqual(['data/inner.json']);
    });
  });

  it('matches remote paths even with zero local matches', async () => {
    await withTempDir(async (dir) => {
      const local = await discoverLocalFiles({ root: dir, files: ['apps/**/.env*'], ignore: [] });
      expect(local.paths).toEqual([]);
      const matches = createSelectionMatcher({ files: ['apps/**/.env*'], ignore: [] });
      expect(matches('apps/web/.env.production')).toBe(true);
      expect(matches('apps/web/config.json')).toBe(false);
    });
  });

  it('treats repeated exact paths with commas literally without splitting', async () => {
    await withTempDir(async (dir) => {
      await writeFixtureFile(dir, 'a,b.env', 'A=1');
      const selected = await selectExactFiles(['a,b.env'], { root: dir, files: ['*.env'], ignore: [] });
      expect(selected).toEqual(['a,b.env']);
    });
  });

  it('skips symlinks without following them', async () => {
    await withTempDir(async (dir) => {
      const outside = await mkdtemp(join(tmpdir(), 'secret-sync-outside-'));
      try {
        await writeFixtureFile(outside, 'secret.env', 'OUT=1');
        await writeFixtureFile(dir, 'real.env', 'IN=1');
        await symlink(join(outside, 'secret.env'), join(dir, 'link.env'));
        const result = await discoverLocalFiles({ root: dir, files: ['*.env'], ignore: [] });
        expect(result.paths).toEqual(['real.env']);
        expect(result.skippedSymlinks).toEqual(['link.env']);
        await expect(selectExactFiles(['link.env'], { root: dir, files: ['*.env'], ignore: [] })).rejects.toThrow(
          /symlink/,
        );
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it('rejects outside-root paths', async () => {
    await withTempDir(async (dir) => {
      await expect(selectExactFiles(['../escape.env'], { root: dir, files: ['**'], ignore: [] })).rejects.toThrow();
      await expect(selectExactFiles(['/abs.env'], { root: dir, files: ['**'], ignore: [] })).rejects.toThrow();
    });
  });

  it('never lets --file override excludes', async () => {
    await withTempDir(async (dir) => {
      await writeFixtureFile(dir, '.env.example', 'SAMPLE=1');
      await expect(
        selectExactFiles(['.env.example'], { root: dir, files: ['.env*'], ignore: ['**/.env.example'] }),
      ).rejects.toThrow(/never overrides excludes/);
    });
  });

  it('bounds the directory walk', async () => {
    await withTempDir(async (dir) => {
      await writeFixtureFile(dir, 'a.env', 'A=1');
      await writeFixtureFile(dir, 'b.env', 'B=1');
      await expect(discoverLocalFiles({ root: dir, files: ['*.env'], ignore: [], maxRecords: 1 })).rejects.toThrow(
        /more than 1/,
      );
    });
  });
});

describe('cli dispatch', () => {
  it('strips leading wrapper separators and extracts branch subcommands', () => {
    expect(extractCommand(['--', '--', 'status', '--json'])).toEqual({ command: 'status', rest: ['--json'] });
    expect(extractCommand(['branch', 'create', '--name', 'x'])).toEqual({
      command: 'branch',
      branchSubcommand: 'create',
      rest: ['--name', 'x'],
    });
    expect(extractCommand(['--config', 'c.json'])).toEqual({ rest: ['--config', 'c.json'] });
    expect(() => extractCommand(['explode'])).toThrow(/Unknown command/);
  });

  it('keeps --file repeatable without comma splitting', () => {
    const parsed = parseFlags(['--file', 'a,b.env', '--file', 'c.env'], [{ name: 'file', repeatable: true }]);
    if (!parsed) throw new Error('expected flags');
    expect(buildOptions(parsed, 'status').file).toEqual(['a,b.env', 'c.env']);
  });
});

describe('provider-neutral remote contracts', () => {
  it('validates both documented SDK remotes', () => {
    const service = validateRemoteConfig({
      type: 'onepassword-sdk',
      vaultId: 'vault-1',
      auth: { type: 'service-account', tokenEnv: 'OP_SERVICE_ACCOUNT_TOKEN' },
    });
    expect(service).toEqual({
      type: 'onepassword-sdk',
      vaultId: 'vault-1',
      auth: { type: 'service-account', tokenEnv: 'OP_SERVICE_ACCOUNT_TOKEN' },
    });
    const desktop = validateRemoteConfig({
      type: 'onepassword-sdk',
      vaultId: 'vault-1',
      auth: { type: 'desktop', account: 'my-account' },
    });
    expect(desktop).toEqual({
      type: 'onepassword-sdk',
      vaultId: 'vault-1',
      auth: { type: 'desktop', account: 'my-account' },
    });
    if (service.type !== 'onepassword-sdk' || desktop.type !== 'onepassword-sdk') {
      throw new Error('expected SDK remotes');
    }
    expect(isSdkRemote(service)).toBe(true);
    expect(isSdkRemote(desktop)).toBe(true);
    expect(isConnectRemote(service)).toBe(false);
  });

  it('keeps the Connect default when type is omitted', () => {
    const remote = validateRemoteConfig({ vaultId: 'vault-1' });
    expect(remote).toEqual({
      type: 'onepassword-connect',
      vaultId: 'vault-1',
      hostEnv: 'OP_CONNECT_HOST',
      tokenEnv: 'OP_CONNECT_TOKEN',
    });
    expect(isConnectRemote(remote)).toBe(true);
    expect(isSdkRemote(remote)).toBe(false);
  });

  it('applies deterministic SDK service-account defaults', () => {
    expect(DEFAULT_SDK_TOKEN_ENV).toBe('OP_SERVICE_ACCOUNT_TOKEN');
    const first = validateRemoteConfig({
      type: 'onepassword-sdk',
      vaultId: 'vault-1',
      auth: { type: 'service-account' },
    });
    const second = validateRemoteConfig({
      type: 'onepassword-sdk',
      vaultId: 'vault-1',
      auth: { type: 'service-account' },
    });
    expect(first).toEqual(second);
    expect(first).toEqual({
      type: 'onepassword-sdk',
      vaultId: 'vault-1',
      auth: { type: 'service-account', tokenEnv: 'OP_SERVICE_ACCOUNT_TOKEN' },
    });
  });

  it('rejects unknown, mixed, raw-token, and incompatible auth fields', () => {
    expect(() => validateRemoteConfig({ type: 'sdk', vaultId: 'v' })).toThrow(/remote\.type/);
    expect(() => validateRemoteConfig({ type: 'onepassword-sdk', vaultId: 'v', hostEnv: 'OP_CONNECT_HOST' })).toThrow(
      /Unknown remote field/,
    );
    expect(() => validateRemoteConfig({ type: 'onepassword-sdk', vaultId: 'v', tokenEnv: 'OP_CONNECT_TOKEN' })).toThrow(
      /Unknown remote field/,
    );
    expect(() =>
      validateRemoteConfig({ type: 'onepassword-connect', vaultId: 'v', auth: { type: 'desktop' } }),
    ).toThrow(/Unknown remote field/);
    expect(() => validateRemoteConfig({ type: 'onepassword-connect', vaultId: 'v', token: 'raw-secret' })).toThrow(
      /raw token/,
    );
    expect(() =>
      validateRemoteConfig({
        type: 'onepassword-sdk',
        vaultId: 'v',
        auth: { type: 'service-account', token: 'raw-secret' },
      }),
    ).toThrow(/raw token/);
    expect(() => validateRemoteConfig({ type: 'onepassword-sdk', vaultId: 'v' })).toThrow(/remote\.auth/);
    expect(() => validateRemoteConfig({ type: 'onepassword-sdk', vaultId: 'v', auth: {} })).toThrow(
      /remote\.auth\.type/,
    );
    expect(() =>
      validateRemoteConfig({
        type: 'onepassword-sdk',
        vaultId: 'v',
        auth: { type: 'service-account', account: 'extra' },
      }),
    ).toThrow(/Unknown remote\.auth field/);
    expect(() =>
      validateRemoteConfig({
        type: 'onepassword-sdk',
        vaultId: 'v',
        auth: { type: 'desktop', tokenEnv: 'OP_SERVICE_ACCOUNT_TOKEN' },
      }),
    ).toThrow(/Unknown remote\.auth field/);
    expect(() =>
      validateRemoteConfig({ type: 'onepassword-sdk', vaultId: 'v', auth: { type: 'desktop', account: '' } }),
    ).toThrow(/account/);
  });

  it('plans SDK configs without Connect environment variables', async () => {
    const savedHost = process.env.OP_CONNECT_HOST;
    const savedToken = process.env.OP_CONNECT_TOKEN;
    delete process.env.OP_CONNECT_HOST;
    delete process.env.OP_CONNECT_TOKEN;
    try {
      const plan = await resolveSecretSyncPlan({
        cwd: process.cwd(),
        projectId: PROJECT_ID,
        remote: {
          type: 'onepassword-sdk',
          vaultId: 'vault-1',
          auth: { type: 'service-account', tokenEnv: 'OP_SERVICE_ACCOUNT_TOKEN' },
        },
        files: ['.env'],
      });
      expect(plan.remote.type).toBe('onepassword-sdk');
      expect(plan.remote.vaultId).toBe('vault-1');
      expect(JSON.stringify(plan)).not.toContain('OP_CONNECT_HOST');
    } finally {
      if (savedHost !== undefined) process.env.OP_CONNECT_HOST = savedHost;
      if (savedToken !== undefined) process.env.OP_CONNECT_TOKEN = savedToken;
    }
  });

  it('returns injected stores for SDK plans without Connect environment', async () => {
    const { MemoryFakeStore } = await import('./helpers');
    const { createSecretStoreForPlan, resolveEndpointForPlan } = await import('../src/cli-options');
    const store = new MemoryFakeStore();
    const plan = await resolveSecretSyncPlan({
      cwd: process.cwd(),
      projectId: PROJECT_ID,
      remote: {
        type: 'onepassword-sdk',
        vaultId: 'vault-1',
        auth: { type: 'desktop', account: 'my-account' },
      },
      files: ['.env'],
    });
    const savedHost = process.env.OP_CONNECT_HOST;
    const savedToken = process.env.OP_CONNECT_TOKEN;
    delete process.env.OP_CONNECT_HOST;
    delete process.env.OP_CONNECT_TOKEN;
    try {
      expect(createSecretStoreForPlan(plan, { store })).toBe(store);
      expect(() => resolveEndpointForPlan(plan, {})).toThrow(/Direct SDK backend/);
    } finally {
      if (savedHost !== undefined) process.env.OP_CONNECT_HOST = savedHost;
      if (savedToken !== undefined) process.env.OP_CONNECT_TOKEN = savedToken;
    }
  });

  it('normalizes provider-neutral item DTOs through both validator names', async () => {
    const { validateConnectItemDetail, validateConnectItemSummary } = await import('../src/index');
    const summary = { id: 'item-1', title: 'title-1', tags: ['a'], category: 'SECURE_NOTE' };
    expect(validateSecretItemSummary(summary)).toEqual(validateConnectItemSummary(summary));
    const detail = {
      id: 'item-1',
      title: 'title-1',
      tags: ['a'],
      category: 'SECURE_NOTE',
      fields: [{ type: 'CONCEALED', label: 'payload', value: '{}' }],
    };
    expect(validateSecretItemDetail(detail)).toEqual(validateConnectItemDetail(detail));
  });

  it('shares one concurrency implementation between neutral and Connect entrypoints', async () => {
    const items = [1, 2, 3, 4, 5];
    const expected = await mapWithConcurrencyNeutral(items, async (item) => item * 2, 2);
    const actual = await mapWithConcurrencyCompat(items, async (item) => item * 2, 2);
    expect(actual).toEqual(expected);
    expect(actual).toEqual([2, 4, 6, 8, 10]);
  });
});
