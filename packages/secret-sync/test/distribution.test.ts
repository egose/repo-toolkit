import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  SDK_INTEGRATION_NAME,
  SDK_MAX_DETAIL_BYTES,
  SDK_MAX_GET_RETRIES,
  SDK_MAX_RECORDS,
  SDK_TIMEOUT_MS,
  SdkSecretStore,
  createSdkStore,
  defaultSdkClientFactory,
  type SdkClientFactory,
} from '../src/sdk';
import type { FetchLike } from '../src/connect';
import { SecretSyncError } from '../src/errors';
import { doctorSecrets } from '../src/doctor';
import { MemoryFakeStore } from './helpers';

const packageRoot = resolve(import.meta.dirname, '..');
const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const VAULT_ID = 'vault-dist-1';
const TOKEN_ENV = 'OP_SERVICE_ACCOUNT_TOKEN';

function scrubbedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === 'OP_CONNECT_HOST' || key === 'OP_CONNECT_TOKEN' || key === TOKEN_ENV) continue;
    env[key] = value;
  }
  return env;
}

async function writeSdkConfig(dir: string): Promise<string> {
  const configPath = join(dir, 'secret-sync.config.json');
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      projectId: PROJECT_ID,
      root: '.',
      remote: { type: 'onepassword-sdk', vaultId: VAULT_ID, auth: { type: 'service-account', tokenEnv: TOKEN_ENV } },
      branch: 'main',
      files: ['.env'],
      ignore: [],
    }),
  );
  return configPath;
}

describe('secret-sync distribution', () => {
  it('declares the exact pinned SDK runtime with a Node 20 floor', async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      engines: Record<string, string>;
    };
    expect(manifest.dependencies['@1password/sdk']).toBe('0.5.0');
    expect(manifest.dependencies['@repo-toolkit/publish-package']).toBe('workspace:*');
    expect(manifest.engines['node']).toBe('>=20');
  });

  it('keeps the SDK runtime external to the built bundle', async () => {
    const entries = await readdir(join(packageRoot, 'dist'));
    const scripts = entries.filter((entry) => entry.endsWith('.js'));
    expect(scripts.length).toBeGreaterThan(0);
    let bareImportFound = false;
    for (const entry of scripts) {
      const text = await readFile(join(packageRoot, 'dist', entry), 'utf8');
      expect(text).not.toContain('core_bg.wasm');
      if (text.includes('import("@1password/sdk")')) {
        bareImportFound = true;
      }
    }
    expect(bareImportFound).toBe(true);
  });

  it('exposes the direct SDK surface from the package entrypoint', () => {
    expect(typeof SdkSecretStore).toBe('function');
    expect(typeof createSdkStore).toBe('function');
    expect(typeof defaultSdkClientFactory).toBe('function');
    expect(SDK_TIMEOUT_MS).toBe(30000);
    expect(SDK_MAX_GET_RETRIES).toBe(3);
    expect(SDK_MAX_RECORDS).toBe(10000);
    expect(SDK_MAX_DETAIL_BYTES).toBe(256 * 1024);
    expect(SDK_INTEGRATION_NAME).toBe('repo-toolkit-secret-sync');
  });

  it('runs built CLI help with no credentials and no SDK initialization', () => {
    const result = spawnSync(process.execPath, [join(packageRoot, 'dist', 'cli.js'), '--help'], {
      encoding: 'utf8',
      env: scrubbedEnv(),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('repo-toolkit-secret-sync');
    expect(result.stdout).toContain('--provider onepassword-connect | onepassword-sdk');
  });

  it('runs Connect doctor from an injected store without SDK loading', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-dist-connect-'));
    try {
      const store = new MemoryFakeStore();
      const result = await doctorSecrets({
        store,
        rootAbsolute: dir,
        projectId: PROJECT_ID,
        branch: 'main',
        endpoint: 'https://connect.example',
        vaultId: VAULT_ID,
        files: ['.env'],
        ignore: [],
        maxFileBytes: 32768,
        maxFiles: 100,
        concurrency: 4,
      });
      expect(result.provider).toBe('onepassword-connect');
      expect(result.authMode).toBe('token');
      expect(typeof result.endpointHost).toBe('string');
      expect(result.checks.find((check) => check.name === 'read')?.status).toBe('pass');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reports a missing service-account token without initializing the SDK', async () => {
    let factoryCalls = 0;
    const store = createSdkStore({
      vaultId: VAULT_ID,
      auth: { type: 'service-account', tokenEnv: TOKEN_ENV },
      env: {},
      clientFactory: async () => {
        factoryCalls += 1;
        throw new Error('SDK must not initialize without a credential.');
      },
    });
    const failure = await store.listItems().then(
      () => null,
      (error: unknown) => error as SecretSyncError,
    );
    expect(failure).toBeInstanceOf(SecretSyncError);
    expect(failure?.code).toBe('auth');
    expect(failure?.message).toContain(TOKEN_ENV);
    expect(factoryCalls).toBe(0);
  });

  it('keeps SDK asset failures distinct from credential failures', async () => {
    const loaderStore = createSdkStore({
      vaultId: VAULT_ID,
      auth: { type: 'service-account', tokenEnv: TOKEN_ENV },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: async () => {
        throw new Error("Cannot find module '@1password/sdk-core/nodejs/core_bg.wasm'");
      },
      sleep: () => Promise.resolve(),
    });
    const loaderFailure = await loaderStore.listItems().then(
      () => null,
      (error: unknown) => error as SecretSyncError,
    );
    expect(loaderFailure?.code).toBe('server');
    expect(loaderFailure?.message).toMatch(/1Password SDK/);
    const deniedStore = createSdkStore({
      vaultId: VAULT_ID,
      auth: { type: 'service-account', tokenEnv: TOKEN_ENV },
      env: { [TOKEN_ENV]: 'token-ok' },
      clientFactory: async () => {
        throw Object.assign(new Error('invalid service account token'), { name: 'Error' });
      },
      sleep: () => Promise.resolve(),
    });
    const deniedFailure = await deniedStore.listItems().then(
      () => null,
      (error: unknown) => error as SecretSyncError,
    );
    expect(deniedFailure?.code).toBe('auth');
    expect(deniedFailure?.message).not.toMatch(/assets/);
  });

  it('rejects an SDK plan that would need Connect fetch', async () => {
    const { resolveSecretSyncPlan } = await import('../src/index');
    const { createSecretStoreForPlan } = await import('../src/cli-options');
    const dir = await mkdtemp(join(tmpdir(), 'secsync-dist-plan-'));
    try {
      const configPath = await writeSdkConfig(dir);
      const plan = await resolveSecretSyncPlan({ config: configPath, command: 'status' });
      expect(plan.remote.type).toBe('onepassword-sdk');
      const throwingFetch: FetchLike = (async () => {
        throw new Error('Connect fetch must not be used for SDK plans.');
      }) as FetchLike;
      const probingFactory: SdkClientFactory = async () => {
        throw Object.assign(new Error('probe reached the SDK boundary'), { name: 'Error' });
      };
      const store = createSecretStoreForPlan(plan, {
        fetchImpl: throwingFetch,
        sdkClientFactory: probingFactory,
        env: { [TOKEN_ENV]: 'token-ok' },
      });
      expect(store).toBeInstanceOf(SdkSecretStore);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps release-prepared manifests free of workspace refs with the exact SDK pin', async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as Record<string, unknown>;
    const rootManifest = JSON.parse(await readFile(join(packageRoot, '..', '..', 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(manifest.version).toBe('0.0.0-PLACEHOLDER');
    expect(manifest.license).toBe('PLACEHOLDER');
    expect(manifest.repository).toBe('PLACEHOLDER');
    const rewritten = rewriteManifestForRelease(manifest, rootManifest, '9.9.9-dist-test');
    const serialized = JSON.stringify(rewritten);
    expect(serialized).not.toContain('workspace:');
    expect(serialized).not.toContain('PLACEHOLDER');
    const dependencies = rewritten.dependencies as Record<string, string>;
    expect(dependencies['@1password/sdk']).toBe('0.5.0');
    expect(dependencies['@repo-toolkit/publish-package']).toBe('9.9.9-dist-test');
    expect(rewritten.version).toBe('9.9.9-dist-test');
    expect(rewritten.license).toBe(rootManifest.license);
    expect(rewritten.engines).toEqual({ node: '>=20' });
    expect(rewritten.files).toEqual(['README.md', 'dist']);
  });

  it('loads the real SDK core from an external cwd and reports invalid credentials as auth, not assets', async () => {
    const sdkPath = createRequire(join(packageRoot, 'package.json')).resolve('@1password/sdk');
    const dir = await mkdtemp(join(tmpdir(), 'secsync-dist-extcwd-'));
    try {
      const probePath = join(dir, 'sdk-external-probe.mjs');
      await writeFile(
        probePath,
        [
          `import { createClient } from ${JSON.stringify(sdkPath)};`,
          'try {',
          "  await createClient({ auth: 'invalid-token-for-probe-only', integrationName: 'probe', integrationVersion: '0' });",
          "  console.log('sdk-external-cwd-unexpected-success');",
          '} catch (error) {',
          '  const message = error instanceof Error ? error.message : String(error);',
          "  console.log(`sdk-external-cwd-auth token=${message.includes('token')} assets=${/asset|wasm/i.test(message)}`);",
          '}',
          '',
        ].join('\n'),
      );
      const result = spawnSync(process.execPath, [probePath], {
        cwd: dir,
        encoding: 'utf8',
        env: scrubbedEnv(),
        timeout: 60000,
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('sdk-external-cwd-auth token=true assets=false');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ships package types exposing the direct SDK surface', async () => {
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      exports: Record<string, Record<string, string>>;
    };
    expect(manifest.exports['.']).toMatchObject({
      types: './dist/index.d.ts',
      import: './dist/index.js',
    });
    const declaration = await readFile(join(packageRoot, 'dist', 'index.d.ts'), 'utf8');
    expect(declaration).toContain('SdkSecretStore');
    expect(declaration).toContain('createSdkStore');
    expect(declaration).toContain('defaultSdkClientFactory');
  });

  it('documents direct init flags in built CLI help without SDK initialization', () => {
    const result = spawnSync(process.execPath, [join(packageRoot, 'dist', 'cli.js'), '--help'], {
      encoding: 'utf8',
      env: scrubbedEnv(),
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--auth service-account | desktop');
    expect(result.stdout).toContain('--token-env <name>');
  });
});

function rewriteManifestForRelease(
  manifest: Record<string, unknown>,
  rootManifest: Record<string, unknown>,
  version: string,
): Record<string, unknown> {
  const rewritten: Record<string, unknown> = { ...manifest, version };
  for (const field of ['license', 'repository', 'author', 'bugs', 'engines'] as const) {
    if (rewritten[field] === undefined || rewritten[field] === 'PLACEHOLDER') {
      rewritten[field] = rootManifest[field];
    }
  }
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const) {
    const entries = rewritten[section];
    if (entries === undefined || entries === null || typeof entries !== 'object') {
      continue;
    }
    const next: Record<string, string> = {};
    for (const [name, range] of Object.entries(entries as Record<string, string>)) {
      next[name] = typeof range === 'string' && range.startsWith('workspace:') ? version : range;
    }
    rewritten[section] = next;
  }
  return rewritten;
}
