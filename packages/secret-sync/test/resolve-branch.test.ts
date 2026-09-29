import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseFlags } from '@repo-toolkit/publish-package';

import { assertCommandFlags, createSecretStoreForPlan } from '../src/cli-options';
import { buildOptions } from '../src/cli';
import { publishSnapshot } from '../src/history-store';
import { resolveSecretSyncPlan, runSecretSync, validateSecretSyncCommandOptions } from '../src/index';
import { loadBranchHistory } from '../src/operations';
import { readStateIfPresent } from '../src/state';
import { MemoryFakeStore } from './helpers';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const ENV = { OP_CONNECT_HOST: 'https://connect.example', OP_CONNECT_TOKEN: 'test-token' };
const packageRoot = resolve(import.meta.dirname, '..');
const cli = join(packageRoot, 'dist', 'cli.js');

function testUuid(tag: number): string {
  const tail = tag.toString(16).padStart(12, '0');
  return `bbbbbbb2-bbbb-4bbb-8bbb-${tail}`;
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'secsync-resolve-branch-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeConfig(dir: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const path = join(dir, 'secret-sync.config.json');
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 1,
      projectId: PROJECT_ID,
      root: '.',
      remote: { type: 'onepassword-connect', vaultId: 'vault-1' },
      branch: 'main',
      files: ['.env'],
      ignore: [],
      limits: { maxFileBytes: 32768, maxFiles: 100, concurrency: 4 },
      ...overrides,
    }),
  );
  return path;
}

async function seedFork(
  store: MemoryFakeStore,
  branch: string,
  commitA: string,
  commitB: string,
  baseTag: number,
): Promise<void> {
  await publishSnapshot(store, {
    projectId: PROJECT_ID,
    branch,
    parents: [],
    files: [{ path: '.env', bytes: Buffer.from(`fork-a-${branch}`, 'utf8') }],
    timestamp: baseTag,
    operationId: testUuid(baseTag + 1),
    operationKind: 'push',
    commitId: commitA,
  });
  await publishSnapshot(store, {
    projectId: PROJECT_ID,
    branch,
    parents: [],
    files: [{ path: '.env', bytes: Buffer.from(`fork-b-${branch}`, 'utf8') }],
    timestamp: baseTag + 10,
    operationId: testUuid(baseTag + 2),
    operationKind: 'push',
    commitId: commitB,
  });
}

describe('resolve explicit branch config', () => {
  it('permits --branch for resolve while keeping worktree-mutating restrictions', () => {
    const heads = [testUuid(11), testUuid(12)];
    expect(() =>
      validateSecretSyncCommandOptions('resolve', { heads, take: heads[0] as string, branch: 'feature/x' }, 'list'),
    ).not.toThrow();
    expect(() => validateSecretSyncCommandOptions('push', { branch: 'other' })).toThrow(/active branch/);
    expect(() => validateSecretSyncCommandOptions('pull', { branch: 'other' })).toThrow(/active branch/);
    expect(() => validateSecretSyncCommandOptions('restore', { files: ['a'], revision: 'r', branch: 'other' })).toThrow(
      /active branch/,
    );
    expect(() =>
      validateSecretSyncCommandOptions('rollback', { files: ['a'], revision: 'r', branch: 'other' }),
    ).toThrow(/active branch/);
    expect(() =>
      validateSecretSyncCommandOptions('resolve', { heads, take: heads[0] as string, branch: '-bad' }, 'list'),
    ).toThrow();
  });

  it('carries the explicit branch through the plan and keeps the configured default', async () => {
    await withTempDir(async (dir) => {
      const config = await writeConfig(dir);
      const heads = [testUuid(21), testUuid(22)];
      const explicit = await resolveSecretSyncPlan({
        config,
        cwd: dir,
        command: 'resolve',
        branch: 'feature/x',
        heads,
        take: heads[0] as string,
      });
      expect(explicit.branch).toBe('feature/x');
      expect(explicit.commandOptions.branch).toBe('feature/x');
      const fallback = await resolveSecretSyncPlan({
        config,
        cwd: dir,
        command: 'resolve',
        heads,
        take: heads[1] as string,
      });
      expect(fallback.branch).toBe('main');
      expect(fallback.commandOptions.branch).toBeUndefined();
    });
  });

  it('keeps resolve branch in the CLI flag registry and option mapping', () => {
    const parsed = parseFlags(
      ['--branch', 'feature/x', '--head', testUuid(31), '--head', testUuid(32), '--take', testUuid(31)],
      [{ name: 'branch' }, { name: 'head', repeatable: true }, { name: 'take' }],
    );
    if (!parsed) throw new Error('expected flags');
    expect(() => assertCommandFlags(parsed, 'resolve', undefined)).not.toThrow();
    expect(() => assertCommandFlags(parsed, 'push', undefined)).toThrow(/--branch/);
    const options = buildOptions(parsed, 'resolve');
    expect(options.branch).toBe('feature/x');
    expect(options.heads).toEqual([testUuid(31), testUuid(32)]);
    expect(options.take).toBe(testUuid(31));
  });
});

describe('resolve explicit branch api', () => {
  it('resolves a non-active branch without touching active branch, worktree, or baselines', async () => {
    await withTempDir(async (dir) => {
      const config = await writeConfig(dir);
      const store = new MemoryFakeStore();
      await writeFile(join(dir, '.env'), 'MAIN=1\n');
      const pushed = await runSecretSync({ config, cwd: dir, command: 'push', message: 'base', store, env: ENV });
      if (pushed.command !== 'push') throw new Error('expected push');
      expect(pushed.result.published).toBe(true);
      const mainBefore = await loadBranchHistory(store, PROJECT_ID, 'main', 4);
      expect(mainBefore.headIds).toHaveLength(1);
      const commitA = testUuid(41);
      const commitB = testUuid(42);
      await seedFork(store, 'feature/fork', commitA, commitB, 100);
      const stateBefore = await readStateIfPresent(dir);
      if (!stateBefore) throw new Error('expected state');
      expect(stateBefore.activeBranch).toBe('main');
      const baselinesBefore = JSON.stringify(stateBefore.baselines);
      const bytesBefore = await readFile(join(dir, '.env'), 'utf8');
      const createsBefore = store.counts.creates;
      const resolved = await runSecretSync({
        config,
        cwd: dir,
        command: 'resolve',
        branch: 'feature/fork',
        heads: [commitA, commitB],
        take: commitA,
        store,
        env: ENV,
      });
      if (resolved.command !== 'resolve') throw new Error('expected resolve');
      expect(resolved.result.published).toBe(true);
      expect(resolved.result.headsBefore).toEqual([commitA, commitB].sort());
      expect(resolved.result.headsAfter).toHaveLength(1);
      expect(resolved.result.take).toBe(commitA);
      expect(store.counts.creates).toBe(createsBefore + 1);
      const stateAfter = await readStateIfPresent(dir);
      if (!stateAfter) throw new Error('expected state');
      expect(stateAfter.activeBranch).toBe('main');
      expect(JSON.stringify(stateAfter.baselines)).toBe(baselinesBefore);
      expect(await readFile(join(dir, '.env'), 'utf8')).toBe(bytesBefore);
      const mainAfter = await loadBranchHistory(store, PROJECT_ID, 'main', 4);
      expect(mainAfter.headIds).toEqual(mainBefore.headIds);
      const featureAfter = await loadBranchHistory(store, PROJECT_ID, 'feature/fork', 4);
      expect(featureAfter.headIds).toEqual(resolved.result.headsAfter);
    });
  });

  it('resolves the configured branch by default', async () => {
    await withTempDir(async (dir) => {
      const config = await writeConfig(dir);
      const store = new MemoryFakeStore();
      const commitA = testUuid(51);
      const commitB = testUuid(52);
      await seedFork(store, 'main', commitA, commitB, 200);
      const resolved = await runSecretSync({
        config,
        cwd: dir,
        command: 'resolve',
        heads: [commitA, commitB],
        take: commitB,
        store,
        env: ENV,
      });
      if (resolved.command !== 'resolve') throw new Error('expected resolve');
      expect(resolved.result.published).toBe(true);
      expect(resolved.result.take).toBe(commitB);
      expect(resolved.result.headsAfter).toHaveLength(1);
      const mainAfter = await loadBranchHistory(store, PROJECT_ID, 'main', 4);
      expect(mainAfter.headIds).toEqual(resolved.result.headsAfter);
    });
  });

  it('refuses stale and wrong-branch heads without publication', async () => {
    await withTempDir(async (dir) => {
      const config = await writeConfig(dir);
      const store = new MemoryFakeStore();
      const commitA = testUuid(61);
      const commitB = testUuid(62);
      await seedFork(store, 'feature/stale', commitA, commitB, 300);
      await publishSnapshot(store, {
        projectId: PROJECT_ID,
        branch: 'feature/stale',
        parents: [commitA],
        files: [{ path: '.env', bytes: Buffer.from('advanced', 'utf8') }],
        timestamp: 320,
        operationId: testUuid(323),
        operationKind: 'push',
        commitId: testUuid(63),
      });
      const otherA = testUuid(64);
      const otherB = testUuid(65);
      await seedFork(store, 'feature/other', otherA, otherB, 400);
      const createsBefore = store.counts.creates;
      await expect(
        runSecretSync({
          config,
          cwd: dir,
          command: 'resolve',
          branch: 'feature/stale',
          heads: [commitA, commitB],
          take: commitA,
          store,
          env: ENV,
        }),
      ).rejects.toThrow(/heads changed/);
      await expect(
        runSecretSync({
          config,
          cwd: dir,
          command: 'resolve',
          branch: 'feature/stale',
          heads: [otherA, otherB],
          take: otherA,
          store,
          env: ENV,
        }),
      ).rejects.toThrow(/heads changed/);
      expect(store.counts.creates).toBe(createsBefore);
    });
  });

  it('keeps explicit-branch dry runs read-only', async () => {
    await withTempDir(async (dir) => {
      const config = await writeConfig(dir);
      const store = new MemoryFakeStore();
      const commitA = testUuid(71);
      const commitB = testUuid(72);
      await seedFork(store, 'feature/dry', commitA, commitB, 500);
      const createsBefore = store.counts.creates;
      const resolved = await runSecretSync({
        config,
        cwd: dir,
        command: 'resolve',
        branch: 'feature/dry',
        heads: [commitA, commitB],
        take: commitA,
        dryRun: true,
        store,
        env: ENV,
      });
      if (resolved.command !== 'resolve') throw new Error('expected resolve');
      expect(resolved.result.published).toBe(false);
      expect(resolved.result.dryRun).toBe(true);
      expect(resolved.result.headsBefore).toEqual([commitA, commitB].sort());
      expect(resolved.result.headsAfter).toEqual([commitA, commitB].sort());
      expect(store.counts.creates).toBe(createsBefore);
      await expect(stat(join(dir, '.repo-toolkit-secret-sync'))).rejects.toThrow();
    });
  });
});

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
  const dir = await mkdtemp(join(tmpdir(), 'secsync-resolve-server-'));
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

describe('resolve explicit branch cli', () => {
  it('resolves a non-active branch fork through the built CLI without switching', async () => {
    const fake = await startFakeConnect();
    const dir = await mkdtemp(join(tmpdir(), 'secsync-resolve-cli-'));
    try {
      const config = await writeConfig(dir);
      const seedEnv = { OP_CONNECT_HOST: fake.url, OP_CONNECT_TOKEN: fake.token };
      await writeFile(join(dir, '.env'), 'CLI=1\n');
      const pushed = await runSecretSync({ cwd: dir, config, command: 'push', message: 'seed', env: seedEnv });
      if (pushed.command !== 'push') throw new Error('expected push');
      expect(pushed.result.published).toBe(true);
      const store = createSecretStoreForPlan(await resolveSecretSyncPlan({ config, cwd: dir }), { env: seedEnv });
      const commitA = testUuid(81);
      const commitB = testUuid(82);
      await publishSnapshot(store, {
        projectId: PROJECT_ID,
        branch: 'feature/cli',
        parents: [],
        files: [{ path: '.env', bytes: Buffer.from('cli-a', 'utf8') }],
        timestamp: 600,
        operationId: testUuid(601),
        operationKind: 'push',
        commitId: commitA,
      });
      await publishSnapshot(store, {
        projectId: PROJECT_ID,
        branch: 'feature/cli',
        parents: [],
        files: [{ path: '.env', bytes: Buffer.from('cli-b', 'utf8') }],
        timestamp: 610,
        operationId: testUuid(602),
        operationKind: 'push',
        commitId: commitB,
      });
      const bytesBefore = await readFile(join(dir, '.env'), 'utf8');
      const stateBefore = await readFile(join(dir, '.repo-toolkit-secret-sync', 'state.json'), 'utf8');
      const childEnv = scrubbedEnv(seedEnv);
      const result = spawnSync(
        process.execPath,
        [
          cli,
          'resolve',
          '--branch',
          'feature/cli',
          '--head',
          commitA,
          '--head',
          commitB,
          '--take',
          commitA,
          '--config',
          config,
          '--json',
        ],
        { cwd: dir, env: childEnv, encoding: 'utf8', timeout: 60000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(parsed).toMatchObject({ command: 'resolve', status: 'ok', published: true, take: commitA });
      expect(parsed['headsAfter']).toHaveLength(1);
      expect(await readFile(join(dir, '.env'), 'utf8')).toBe(bytesBefore);
      expect(await readFile(join(dir, '.repo-toolkit-secret-sync', 'state.json'), 'utf8')).toBe(stateBefore);
      const stale = spawnSync(
        process.execPath,
        [
          cli,
          'resolve',
          '--branch',
          'feature/cli',
          '--head',
          commitA,
          '--head',
          commitB,
          '--take',
          commitA,
          '--config',
          config,
        ],
        { cwd: dir, env: childEnv, encoding: 'utf8', timeout: 60000 },
      );
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain('heads changed');
    } finally {
      await rm(dir, { recursive: true, force: true });
      await stopFakeConnect(fake);
    }
  });

  it('keeps worktree-mutating commands rejecting --branch through the built CLI', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-resolve-cli-'));
    try {
      const config = await writeConfig(dir);
      const childEnv = scrubbedEnv({
        OP_CONNECT_HOST: 'https://connect.example',
        OP_CONNECT_TOKEN: 'cli-resolve-token',
      });
      const result = spawnSync(process.execPath, [cli, 'push', '--branch', 'other', '--config', config], {
        cwd: dir,
        env: childEnv,
        encoding: 'utf8',
        timeout: 60000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('not supported by the push command');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('lists --branch for resolve in the built help without the old rejection note', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-resolve-cli-'));
    try {
      const childEnv = scrubbedEnv({});
      const result = spawnSync(process.execPath, [cli, 'resolve', '--help'], {
        cwd: dir,
        env: childEnv,
        encoding: 'utf8',
        timeout: 60000,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('--branch');
      expect(result.stdout).toContain('Without --branch');
      expect(result.stdout).not.toContain('Currently rejected');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
