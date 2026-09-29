import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { publishSnapshot } from '../src/history-store';
import { resolveInteractiveShowTarget, runSecretSync, showFile, validateSecretSyncCommandOptions } from '../src/index';
import { formatJsonResult, formatTextResult } from '../src/format';
import { MemoryFakeStore } from './helpers';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const ENV = { OP_CONNECT_HOST: 'https://connect.example', OP_CONNECT_TOKEN: 'test-token' };
const IDENTITY = {
  type: 'onepassword-connect',
  endpoint: 'https://connect.example',
  vaultId: 'vault-show',
  projectId: PROJECT_ID,
} as const;
const packageRoot = resolve(import.meta.dirname, '..');
const cli = join(packageRoot, 'dist', 'cli.js');

function testUuid(tag: number): string {
  const tail = tag.toString(16).padStart(12, '0');
  return `eeeeeee1-eeee-4eee-8eee-${tail}`;
}

async function writeApiConfig(dir: string): Promise<string> {
  const path = join(dir, 'secret-sync.config.json');
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      projectId: PROJECT_ID,
      root: '.',
      remote: { type: 'onepassword-connect', vaultId: 'vault-show' },
      branch: 'main',
      files: ['**/*'],
      ignore: [],
      limits: { maxFileBytes: 32768, maxFiles: 100, concurrency: 4 },
    }),
  );
  return path;
}

async function seedApi(store: MemoryFakeStore, bytes: Uint8Array, tag: number): Promise<void> {
  await publishSnapshot(store, {
    projectId: PROJECT_ID,
    branch: 'main',
    parents: [],
    files: [{ path: 'app.env', bytes }],
    timestamp: tag,
    operationId: testUuid(tag * 10 + 1),
    operationKind: 'push',
    blobIds: { 'app.env': testUuid(tag * 10 + 2) },
    commitId: testUuid(tag * 10 + 9),
  });
}

function scrubbedEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) {
      continue;
    }
    if (key === 'OP_CONNECT_HOST' || key === 'OP_CONNECT_TOKEN' || key === 'OP_SERVICE_ACCOUNT_TOKEN') {
      continue;
    }
    env[key] = value;
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

const SERVER_SOURCE = [
  `import { createServer } from 'node:http';`,
  `const token = process.argv[2];`,
  `const items = new Map();`,
  `let counter = 0;`,
  `const server = createServer((req, res) => {`,
  `  const auth = req.headers.authorization ?? '';`,
  `  if (auth !== 'Bearer ' + token) {`,
  `    res.writeHead(401, { 'content-type': 'application/json' });`,
  `    res.end(JSON.stringify({ error: 'unauthorized' }));`,
  `    return;`,
  `  }`,
  `  const url = new URL(req.url ?? '/', 'http://127.0.0.1');`,
  `  const listPattern = /^\\/v1\\/vaults\\/([^/]+)\\/items\\/?$/;`,
  `  const itemPattern = /^\\/v1\\/vaults\\/([^/]+)\\/items\\/([^/]+)\\/?$/;`,
  `  if (req.method === 'GET' && url.pathname === '/v1/vaults') {`,
  `    res.writeHead(200, { 'content-type': 'application/json' });`,
  `    res.end(JSON.stringify([{ id: 'vault-1', name: 'Example' }]));`,
  `    return;`,
  `  }`,
  `  if (req.method === 'GET' && listPattern.test(url.pathname)) {`,
  `    const summaries = [...items.values()].map((detail) => ({ id: detail.id, title: detail.title, tags: detail.tags, category: detail.category }));`,
  `    res.writeHead(200, { 'content-type': 'application/json' });`,
  `    res.end(JSON.stringify(summaries));`,
  `    return;`,
  `  }`,
  `  const itemMatch = url.pathname.match(itemPattern);`,
  `  if (req.method === 'GET' && itemMatch) {`,
  `    const detail = items.get(itemMatch[2]);`,
  `    if (!detail) {`,
  `      res.writeHead(404, { 'content-type': 'application/json' });`,
  `      res.end(JSON.stringify({ error: 'not found' }));`,
  `      return;`,
  `    }`,
  `    res.writeHead(200, { 'content-type': 'application/json' });`,
  `    res.end(JSON.stringify(detail));`,
  `    return;`,
  `  }`,
  `  if (req.method === 'POST' && listPattern.test(url.pathname)) {`,
  `    let body = '';`,
  `    req.on('data', (chunk) => { body += chunk; });`,
  `    req.on('end', () => {`,
  `      let parsed;`,
  `      try { parsed = JSON.parse(body); } catch {`,
  `        res.writeHead(400, { 'content-type': 'application/json' });`,
  `        res.end(JSON.stringify({ error: 'invalid json' }));`,
  `        return;`,
  `      }`,
  `      counter += 1;`,
  `      const detail = { id: 'fake-' + counter, title: String(parsed.title ?? ''), tags: Array.isArray(parsed.tags) ? parsed.tags : [], category: String(parsed.category ?? 'SECURE_NOTE'), fields: Array.isArray(parsed.fields) ? parsed.fields : [] };`,
  `      items.set(detail.id, detail);`,
  `      res.writeHead(201, { 'content-type': 'application/json' });`,
  `      res.end(JSON.stringify(detail));`,
  `    });`,
  `    return;`,
  `  }`,
  `  res.writeHead(404, { 'content-type': 'application/json' });`,
  `  res.end(JSON.stringify({ error: 'not found' }));`,
  `});`,
  `server.listen(0, '127.0.0.1', () => {`,
  `  const address = server.address();`,
  `  console.log('READY ' + address.port);`,
  `});`,
  ``,
].join('\n');

interface FakeConnect {
  child: ChildProcess;
  dir: string;
  url: string;
  token: string;
}

async function startFakeConnect(): Promise<FakeConnect> {
  const dir = await mkdtemp(join(tmpdir(), 'secsync-showdry-server-'));
  const serverFile = join(dir, 'fake-connect-server.mjs');
  await writeFile(serverFile, SERVER_SOURCE);
  const token = `fake-token-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
  const child = spawn(process.execPath, [serverFile, token], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr?.on('data', () => {});
  try {
    const url = await new Promise<string>((done, fail) => {
      const timer = setTimeout(() => {
        fail(new Error('fake Connect server did not start'));
      }, 15000);
      let out = '';
      child.stdout?.on('data', (chunk: unknown) => {
        out += String(chunk);
        const found = out.match(/READY (\d+)/);
        if (found) {
          clearTimeout(timer);
          done(`http://127.0.0.1:${found[1]}`);
        }
      });
      child.on('error', (error: Error) => {
        clearTimeout(timer);
        fail(error);
      });
      child.on('exit', (code: number | null) => {
        if (!out.includes('READY')) {
          clearTimeout(timer);
          fail(new Error(`fake Connect server exited with code ${code}`));
        }
      });
    });
    return { child, dir, url, token };
  } catch (error) {
    child.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

async function stopFakeConnect(fake: FakeConnect): Promise<void> {
  fake.child.kill('SIGTERM');
  await new Promise<void>((done) => {
    const timer = setTimeout(() => {
      fake.child.kill('SIGKILL');
      done();
    }, 5000);
    fake.child.on('exit', () => {
      clearTimeout(timer);
      done();
    });
  });
  await rm(fake.dir, { recursive: true, force: true });
}

async function snapshotWorktree(root: string): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    result[entry.name] = {
      mode: (await stat(path)).mode,
      content: entry.isDirectory() ? await snapshotWorktree(path) : (await readFile(path)).toString('hex'),
    };
  }
  return result;
}

async function writeCliConfig(dir: string, projectId: string): Promise<string> {
  const path = join(dir, 'secret-sync.config.json');
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      projectId,
      root: '.',
      remote: { type: 'onepassword-connect', vaultId: 'vault-1' },
      branch: 'main',
      files: ['.env'],
      ignore: [],
      limits: { maxFileBytes: 32768, maxFiles: 100, concurrency: 4 },
    }),
  );
  return path;
}

describe('show dry-run api contract', () => {
  it('returns empty bytes with full byteLength and a print note for raw dry runs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-showdry-'));
    try {
      const config = await writeApiConfig(dir);
      const store = new MemoryFakeStore();
      const canary = `dry-raw-${Date.now()}`;
      await seedApi(store, Buffer.from(canary, 'utf8'), 71);
      const createsBefore = store.counts.creates;
      const outcome = await runSecretSync({
        cwd: dir,
        config,
        command: 'show',
        file: ['app.env'],
        dryRun: true,
        store,
        env: ENV,
      });
      if (outcome.command !== 'show') {
        throw new Error('expected show result');
      }
      expect(outcome.result.dryRun).toBe(true);
      expect(outcome.bytes.byteLength).toBe(0);
      expect(outcome.result.byteLength).toBe(Buffer.from(canary, 'utf8').byteLength);
      expect(outcome.result.copied).toBe(false);
      expect(outcome.result.exported).toBeUndefined();
      expect(outcome.result.note).toContain('Dry run');
      expect(outcome.result.note).toContain('print');
      expect(outcome.result.note).not.toContain(canary);
      expect(store.counts.creates).toBe(createsBefore);
      await expect(stat(join(dir, '.repo-toolkit-secret-sync'))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('skips clipboard and export sinks while naming both requested actions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-showdry-'));
    try {
      const config = await writeApiConfig(dir);
      const store = new MemoryFakeStore();
      const canary = `dry-sink-${Date.now()}`;
      await seedApi(store, Buffer.from(canary, 'utf8'), 72);
      let writes = 0;
      const target = join(dir, 'planned.env');
      const outcome = await runSecretSync({
        cwd: dir,
        config,
        command: 'show',
        file: ['app.env'],
        dryRun: true,
        copy: true,
        export: target,
        clipboard: {
          write: async () => {
            writes += 1;
            return { command: 'must-not-run' };
          },
        },
        store,
        env: ENV,
      });
      if (outcome.command !== 'show') {
        throw new Error('expected show result');
      }
      expect(outcome.bytes.byteLength).toBe(0);
      expect(outcome.result.byteLength).toBe(Buffer.from(canary, 'utf8').byteLength);
      expect(outcome.result.copied).toBe(false);
      expect(outcome.result.exported).toBeUndefined();
      expect(outcome.result.note).toContain('copy to the system clipboard');
      expect(outcome.result.note).toContain(target);
      expect(writes).toBe(0);
      await expect(stat(target)).rejects.toThrow();
      await expect(stat(join(dir, '.repo-toolkit-secret-sync'))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps dry-run json metadata-only without a sink and rejects plain raw json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-showdry-'));
    try {
      const config = await writeApiConfig(dir);
      const store = new MemoryFakeStore();
      const canary = `dry-json-${Date.now()}`;
      await seedApi(store, Buffer.from(canary, 'utf8'), 73);
      expect(() =>
        validateSecretSyncCommandOptions('show', { files: ['app.env'], json: true, dryRun: true }, 'list'),
      ).not.toThrow();
      expect(() => validateSecretSyncCommandOptions('show', { files: ['app.env'], json: true }, 'list')).toThrow(
        '--json',
      );
      const outcome = await runSecretSync({
        cwd: dir,
        config,
        command: 'show',
        file: ['app.env'],
        dryRun: true,
        store,
        env: ENV,
      });
      if (outcome.command !== 'show') {
        throw new Error('expected show result');
      }
      const parsed = JSON.parse(formatJsonResult('show', outcome.result)) as Record<string, unknown>;
      expect(parsed).toMatchObject({ command: 'show', status: 'ok', dryRun: true });
      expect(parsed['byteLength']).toBe(Buffer.from(canary, 'utf8').byteLength);
      expect(parsed['bytes']).toBeUndefined();
      expect(parsed['contentBase64']).toBeUndefined();
      expect(parsed['content']).toBeUndefined();
      expect(parsed['sha256']).toBeUndefined();
      expect(parsed['hmac']).toBeUndefined();
      const serialized = JSON.stringify(parsed);
      expect(serialized).not.toContain(canary);
      expect(serialized).not.toContain(Buffer.from(canary, 'utf8').toString('base64'));
      const text = formatTextResult('show', outcome.result);
      expect(text).toContain('Dry run');
      expect(text).not.toContain(canary);
      expect(text).not.toContain(Buffer.from(canary, 'utf8').toString('base64'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves exact ordinary raw bytes and working copy/export sinks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-showdry-'));
    try {
      const config = await writeApiConfig(dir);
      const store = new MemoryFakeStore();
      const expected = Buffer.from([0, 1, 2, 255, 65, 13, 10, 68, 82, 89]);
      await seedApi(store, expected, 74);
      const raw = await runSecretSync({ cwd: dir, config, command: 'show', file: ['app.env'], store, env: ENV });
      if (raw.command !== 'show') {
        throw new Error('expected show result');
      }
      expect(Buffer.from(raw.bytes)).toEqual(expected);
      expect(raw.result.byteLength).toBe(expected.byteLength);
      expect(raw.result.dryRun).toBe(false);
      const captured: Uint8Array[] = [];
      const target = join(dir, 'actual.env');
      const sunk = await runSecretSync({
        cwd: dir,
        config,
        command: 'show',
        file: ['app.env'],
        copy: true,
        export: target,
        clipboard: {
          write: async (bytes) => {
            captured.push(bytes);
            return { command: 'test-clip' };
          },
        },
        store,
        env: ENV,
      });
      if (sunk.command !== 'show') {
        throw new Error('expected show result');
      }
      expect(captured).toHaveLength(1);
      expect(Buffer.from(captured[0] as Uint8Array)).toEqual(expected);
      expect(Buffer.from(await readFile(target))).toEqual(expected);
      expect(sunk.result.copied).toBe(true);
      expect(sunk.result.exported).toBe(target);
      expect(Buffer.from(sunk.bytes)).toEqual(expected);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps interactive dry runs metadata-only with empty bytes', async () => {
    const store = new MemoryFakeStore();
    const canary = `dry-interactive-${Date.now()}`;
    await seedApi(store, Buffer.from(canary, 'utf8'), 75);
    const target = await resolveInteractiveShowTarget({
      store,
      identity: { ...IDENTITY },
      branch: 'main',
      picker: {
        selectFile: async () => 'app.env',
        selectRevision: async () => 'current',
        selectBranch: async () => 'main',
      },
    });
    expect(target).toEqual({ path: 'app.env', branch: 'main' });
    const shown = await showFile({
      store,
      identity: { ...IDENTITY },
      branch: target.branch,
      path: target.path,
      dryRun: true,
    });
    expect(shown.bytes.byteLength).toBe(0);
    expect(shown.result.byteLength).toBe(Buffer.from(canary, 'utf8').byteLength);
    expect(shown.result.dryRun).toBe(true);
    expect(shown.result.copied).toBe(false);
    expect(JSON.stringify(shown.result)).not.toContain(canary);
    expect(JSON.stringify(shown.result)).not.toContain(Buffer.from(canary, 'utf8').toString('base64'));
  });

  it('still validates reads on dry runs without leaking bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-showdry-'));
    try {
      const config = await writeApiConfig(dir);
      const store = new MemoryFakeStore();
      const canary = `dry-validate-${Date.now()}`;
      await seedApi(store, Buffer.from(canary, 'utf8'), 76);
      const failure = await runSecretSync({
        cwd: dir,
        config,
        command: 'show',
        file: ['absent.env'],
        dryRun: true,
        store,
        env: ENV,
      }).then(
        () => {
          throw new Error('expected failure');
        },
        (error: unknown) => error as Error,
      );
      const serialized = `${failure.message} ${failure.stack ?? ''} ${JSON.stringify(failure)}`;
      expect(serialized).not.toContain(canary);
      expect(serialized).not.toContain(Buffer.from(canary, 'utf8').toString('base64'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('show dry-run cli canary', () => {
  it.each([
    { label: 'raw text', args: ['--dry-run'], json: false },
    { label: 'raw json', args: ['--dry-run', '--json'], json: true },
    { label: 'copy text', args: ['--copy', '--dry-run'], json: false },
    { label: 'copy json', args: ['--copy', '--dry-run', '--json'], json: true },
    { label: 'export text', args: ['--export', 'planned.env', '--dry-run'], json: false },
    { label: 'export json', args: ['--export', 'planned.env', '--dry-run', '--json'], json: true },
    {
      label: 'combined json',
      args: ['--copy', '--export', 'planned.env', '--dry-run', '--json'],
      json: true,
    },
  ])('dry-run $label emits metadata only without sink or state writes', async ({ args, json }) => {
    const fake = await startFakeConnect();
    const dir = await mkdtemp(join(tmpdir(), 'secsync-showcli-'));
    try {
      const canary = `cli-dry-${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
      const config = await writeCliConfig(dir, PROJECT_ID);
      const seedEnv = { OP_CONNECT_HOST: fake.url, OP_CONNECT_TOKEN: fake.token };
      await writeFile(join(dir, '.env'), canary);
      const pushed = await runSecretSync({ cwd: dir, config, command: 'push', message: 'seed', env: seedEnv });
      if (pushed.command !== 'push') {
        throw new Error('expected push');
      }
      expect(pushed.result.published).toBe(true);
      const before = await snapshotWorktree(dir);
      const childEnv = scrubbedEnv(seedEnv);
      const result = runCli(['show', '--file', '.env', '--config', config, ...args], dir, childEnv);
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).not.toContain(canary);
      expect(result.stdout).not.toContain(Buffer.from(canary, 'utf8').toString('base64'));
      await expect(stat(join(dir, 'planned.env'))).rejects.toThrow();
      expect(await snapshotWorktree(dir)).toEqual(before);
      if (json) {
        const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
        expect(parsed).toMatchObject({ command: 'show', status: 'ok', dryRun: true });
        expect(parsed['byteLength']).toBe(Buffer.from(canary, 'utf8').byteLength);
        expect(parsed['bytes']).toBeUndefined();
        expect(parsed['copied']).toBe(false);
        expect(parsed['exported']).toBeUndefined();
      } else {
        expect(result.stdout).toContain('Dry run');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
      await stopFakeConnect(fake);
    }
  });

  it('keeps ordinary raw show byte-equal while rejecting plain raw json', async () => {
    const fake = await startFakeConnect();
    const dir = await mkdtemp(join(tmpdir(), 'secsync-showcli-'));
    try {
      const canary = `cli-raw-${Date.now()}`;
      const config = await writeCliConfig(dir, PROJECT_ID);
      const seedEnv = { OP_CONNECT_HOST: fake.url, OP_CONNECT_TOKEN: fake.token };
      await writeFile(join(dir, '.env'), canary);
      const pushed = await runSecretSync({ cwd: dir, config, command: 'push', message: 'seed', env: seedEnv });
      if (pushed.command !== 'push') {
        throw new Error('expected push');
      }
      const childEnv = scrubbedEnv(seedEnv);
      const raw = runCli(['show', '--file', '.env', '--config', config], dir, childEnv);
      expect(raw.status).toBe(0);
      expect(raw.stdout).toBe(canary);
      const rejected = runCli(['show', '--file', '.env', '--config', config, '--json'], dir, childEnv);
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain('--json');
    } finally {
      await rm(dir, { recursive: true, force: true });
      await stopFakeConnect(fake);
    }
  });
});
