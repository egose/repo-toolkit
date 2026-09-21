import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseFlags } from '@repo-toolkit/publish-package';
import { assertCommandFlags } from '../src/cli-options';
import { validateSecretSyncCommandOptions } from '../src/config';
import { formatJsonResult, formatTextResult } from '../src/format';
import { publishSnapshot } from '../src/history-store';
import { runSecretSync } from '../src/index';
import { MemoryFakeStore } from './helpers';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const ENV = { OP_CONNECT_HOST: 'https://connect.example', OP_CONNECT_TOKEN: 'test-token' };

function testUuid(tag: number): string {
  const tail = tag.toString(16).padStart(12, '0');
  return `dddddddd-dddd-4ddd-8ddd-${tail}`;
}

async function writeConfig(dir: string): Promise<string> {
  const config = {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    root: '.',
    remote: { type: 'onepassword-connect', vaultId: 'vault-show' },
    branch: 'main',
    files: ['**/*'],
    ignore: [],
    limits: { maxFileBytes: 32768, maxFiles: 100, concurrency: 4 },
  };
  const path = join(dir, 'secret-sync.config.json');
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}

async function seed(store: MemoryFakeStore, bytes: Uint8Array): Promise<void> {
  await publishSnapshot(store, {
    projectId: PROJECT_ID,
    branch: 'main',
    parents: [],
    files: [{ path: 'app.env', bytes }],
    timestamp: 101,
    operationId: testUuid(1011),
    operationKind: 'push',
    blobIds: { 'app.env': testUuid(1012) },
    commitId: testUuid(1019),
  });
}

describe('show --export', () => {
  it('writes exact bytes atomically with restricted permissions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-showexport-'));
    try {
      const config = await writeConfig(dir);
      const store = new MemoryFakeStore();
      const expected = Buffer.from([0, 1, 2, 255, 65, 13, 10]);
      await seed(store, expected);
      const target = join(dir, 'nested', 'out.env');
      const outcome = await runSecretSync({
        cwd: dir,
        config,
        command: 'show',
        file: ['app.env'],
        export: target,
        store,
        env: ENV,
      });
      expect(outcome.command).toBe('show');
      if (outcome.command !== 'show') {
        throw new Error('expected show result');
      }
      expect(Buffer.from(await readFile(target))).toEqual(expected);
      expect(outcome.result.exported).toBe(target);
      expect(outcome.result.copied).toBe(false);
      if (process.platform !== 'win32') {
        expect((await stat(target)).mode & 0o777).toBe(0o600);
      }
      const text = formatTextResult('show', outcome.result);
      expect(text).toContain(target);
      const json = JSON.parse(formatJsonResult('show', outcome.result)) as Record<string, unknown>;
      expect(json).toMatchObject({ command: 'show', status: 'ok', exported: target });
      expect(JSON.stringify(json)).not.toContain(expected.toString('base64'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves relative destinations against cwd, overwrites files, and honors dry runs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-showexport-'));
    try {
      const config = await writeConfig(dir);
      const store = new MemoryFakeStore();
      await seed(store, Buffer.from('V=1\n'));
      const before = await runSecretSync({
        cwd: dir,
        config,
        command: 'show',
        file: ['app.env'],
        export: 'rel/out.env',
        store,
        env: ENV,
      });
      if (before.command !== 'show') {
        throw new Error('expected show result');
      }
      expect(before.result.exported).toBe(join(dir, 'rel', 'out.env'));
      expect(await readFile(join(dir, 'rel', 'out.env'), 'utf8')).toBe('V=1\n');
      await writeFile(join(dir, 'rel', 'out.env'), 'STALE\n');
      await runSecretSync({
        cwd: dir,
        config,
        command: 'show',
        file: ['app.env'],
        export: 'rel/out.env',
        store,
        env: ENV,
      });
      expect(await readFile(join(dir, 'rel', 'out.env'), 'utf8')).toBe('V=1\n');
      const planned = await runSecretSync({
        cwd: dir,
        config,
        command: 'show',
        file: ['app.env'],
        export: 'rel/dry.env',
        dryRun: true,
        store,
        env: ENV,
      });
      if (planned.command !== 'show') {
        throw new Error('expected show result');
      }
      expect(planned.result.exported).toBeUndefined();
      await expect(stat(join(dir, 'rel', 'dry.env'))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses symlinks, directories, roots, and symlinked ancestors without leaking bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-showexport-'));
    const outside = await mkdtemp(join(tmpdir(), 'secsync-showexport-out-'));
    const canary = `export-canary-${Date.now()}`;
    try {
      const config = await writeConfig(dir);
      const store = new MemoryFakeStore();
      await seed(store, Buffer.from(canary, 'utf8'));
      await symlink(join(outside, 'real.env'), join(dir, 'link.env'));
      await expect(
        runSecretSync({
          cwd: dir,
          config,
          command: 'show',
          file: ['app.env'],
          export: join(dir, 'link.env'),
          store,
          env: ENV,
        }),
      ).rejects.toMatchObject({ code: 'unsafe-path' });
      await expect(
        runSecretSync({ cwd: dir, config, command: 'show', file: ['app.env'], export: dir, store, env: ENV }),
      ).rejects.toMatchObject({ code: 'unsafe-path' });
      await expect(
        runSecretSync({ cwd: dir, config, command: 'show', file: ['app.env'], export: '/', store, env: ENV }),
      ).rejects.toMatchObject({ code: 'unsafe-path' });
      await symlink(outside, join(dir, 'linked-dir'));
      const failure = await runSecretSync({
        cwd: dir,
        config,
        command: 'show',
        file: ['app.env'],
        export: join(dir, 'linked-dir', 'out.env'),
        store,
        env: ENV,
      }).then(
        () => {
          throw new Error('expected failure');
        },
        (error: unknown) => error as Error,
      );
      expect(failure).toMatchObject({ code: 'unsafe-path' });
      const serialized = `${failure.message} ${failure.stack ?? ''} ${JSON.stringify(failure)}`;
      expect(serialized).not.toContain(canary);
      expect(serialized).not.toContain(Buffer.from(canary, 'utf8').toString('base64'));
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('scopes --export to show and allows --json and --copy alongside it', async () => {
    expect(() => validateSecretSyncCommandOptions('status', { export: '/tmp/x' }, 'list')).toThrow('--export');
    expect(() => validateSecretSyncCommandOptions('show', { export: '' }, 'list')).toThrow('--export');
    expect(() =>
      validateSecretSyncCommandOptions('show', { files: ['a'], export: '/tmp/x', json: true }, 'list'),
    ).not.toThrow();
    const specs = [
      { name: 'config' },
      { name: 'cwd' },
      { name: 'export' },
      { name: 'copy', boolean: true },
      { name: 'file', repeatable: true },
    ] as const;
    const ok = parseFlags(['--export', '/tmp/x'], [...specs]);
    if (ok === null) {
      throw new Error('expected flags');
    }
    expect(() => assertCommandFlags(ok, 'show', undefined)).not.toThrow();
    expect(() => assertCommandFlags(ok, 'push', undefined)).toThrow('--export');
  });

  it('composes export with copy in one invocation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-showexport-'));
    try {
      const config = await writeConfig(dir);
      const store = new MemoryFakeStore();
      await seed(store, Buffer.from('BOTH=1\n'));
      const captured: Uint8Array[] = [];
      const outcome = await runSecretSync({
        cwd: dir,
        config,
        command: 'show',
        file: ['app.env'],
        copy: true,
        export: join(dir, 'both.env'),
        clipboard: {
          write: async (bytes) => {
            captured.push(bytes);
            return { command: 'test-clip' };
          },
        },
        store,
        env: ENV,
      });
      if (outcome.command !== 'show') {
        throw new Error('expected show result');
      }
      expect(captured).toHaveLength(1);
      expect(await readFile(join(dir, 'both.env'), 'utf8')).toBe('BOTH=1\n');
      expect(outcome.result.copied).toBe(true);
      expect(outcome.result.exported).toBe(join(dir, 'both.env'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
