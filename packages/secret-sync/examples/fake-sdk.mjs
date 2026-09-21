#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VAULT_ID = 'vault-example';
const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';

export function createFakeSdkClient() {
  const items = new Map();
  let counter = 0;
  return {
    items: {
      async list(vaultId, ...filters) {
        void filters;
        if (vaultId !== VAULT_ID) {
          throw Object.assign(new Error(`vault ${vaultId} not found`), { name: 'Error' });
        }
        return [...items.values()].map((item) => ({
          id: item.id,
          title: item.title,
          category: 'SecureNote',
          vaultId,
          tags: item.tags,
          state: 'Active',
        }));
      },
      async get(vaultId, itemId) {
        const item = items.get(itemId);
        if (vaultId !== VAULT_ID || item === undefined) {
          throw Object.assign(new Error('item not found'), { name: 'Error' });
        }
        return { ...item, fields: item.fields.map((field) => ({ ...field })) };
      },
      async create(params) {
        if (params.vaultId !== VAULT_ID) {
          throw Object.assign(new Error(`vault ${params.vaultId} not found`), { name: 'Error' });
        }
        counter += 1;
        const item = {
          id: `sdk-example-${counter}`,
          title: params.title,
          category: 'SecureNote',
          vaultId: params.vaultId,
          tags: [...params.tags],
          fields: params.fields.map((field) => ({ ...field })),
        };
        items.set(item.id, item);
        return { ...item, fields: item.fields.map((field) => ({ ...field })) };
      },
    },
  };
}

export function createFakeSdkClientFactory(seen) {
  const client = createFakeSdkClient();
  return async (config) => {
    seen.push(config.auth.kind);
    return client;
  };
}

async function writeConfig(dir, auth) {
  const config = {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    root: '.',
    remote: { type: 'onepassword-sdk', vaultId: VAULT_ID, auth },
    branch: 'main',
    files: ['.env'],
    ignore: ['**/.env.example'],
    limits: { maxFileBytes: 32768, maxFiles: 100, concurrency: 4 },
  };
  await writeFile(join(dir, 'secret-sync.config.json'), `${JSON.stringify(config, null, 2)}\n`);
}

async function roundTrip(auth, label) {
  const seen = [];
  const factory = createFakeSdkClientFactory(seen);
  const lib = await import('../dist/index.js');
  const work = await mkdtemp(join(tmpdir(), 'secsync-sdk-a-'));
  const clone = await mkdtemp(join(tmpdir(), 'secsync-sdk-b-'));
  try {
    await writeConfig(work, auth);
    await writeFile(join(work, '.env'), 'DEMO=1\n');
    const env = auth.type === 'service-account' ? { OP_SERVICE_ACCOUNT_TOKEN: 'fake-sdk-token-for-examples-only' } : {};
    const push = await lib.runSecretSync({
      cwd: work,
      config: join(work, 'secret-sync.config.json'),
      command: 'push',
      message: 'demo',
      sdkClientFactory: factory,
      env,
    });
    const status = await lib.runSecretSync({
      cwd: work,
      config: join(work, 'secret-sync.config.json'),
      command: 'status',
      sdkClientFactory: factory,
      env,
    });
    await writeConfig(clone, auth);
    const pull = await lib.runSecretSync({
      cwd: clone,
      config: join(clone, 'secret-sync.config.json'),
      command: 'pull',
      sdkClientFactory: factory,
      env,
    });
    const pulled = await readFile(join(clone, '.env'), 'utf8');
    if (pulled !== 'DEMO=1\n') {
      throw new Error(`${label} round trip mismatch`);
    }
    return { published: push.result.published, clean: status.result.clean, downloaded: pull.result.downloaded, authKinds: seen };
  } finally {
    await rm(work, { recursive: true, force: true });
    await rm(clone, { recursive: true, force: true });
  }
}

async function main() {
  const serviceAccount = await roundTrip({ type: 'service-account', tokenEnv: 'OP_SERVICE_ACCOUNT_TOKEN' }, 'service-account');
  const desktop = await roundTrip({ type: 'desktop', account: 'example-account' }, 'desktop');
  console.log(JSON.stringify({ serviceAccount, desktop }));
  console.log('fake-sdk round trip ok: init-free push, status, and pull agree on exact bytes without a real vault');
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith('fake-sdk.mjs');
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
