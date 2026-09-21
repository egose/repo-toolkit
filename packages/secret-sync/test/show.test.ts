import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseFlags } from '@repo-toolkit/publish-package';
import { extractCommand } from '../src/cli';
import { assertCommandFlags } from '../src/cli-options';
import { validateSecretSyncCommandOptions } from '../src/config';
import { publishSnapshot } from '../src/history-store';
import { runSecretSync } from '../src/index';
import { MemoryFakeStore } from './helpers';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const ENV = { OP_CONNECT_HOST: 'https://connect.example', OP_CONNECT_TOKEN: 'test-token' };

function testUuid(tag: number): string {
  const tail = tag.toString(16).padStart(12, '0');
  return `aaaaaaaa-aaaa-4aaa-8aaa-${tail}`;
}

async function writeConfig(dir: string, files: string[] = ['**/*']): Promise<string> {
  const config = {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    root: '.',
    remote: { type: 'onepassword-connect', vaultId: 'vault-show' },
    branch: 'main',
    files,
    ignore: [],
    limits: { maxFileBytes: 32768, maxFiles: 100, concurrency: 4 },
  };
  const path = join(dir, 'secret-sync.config.json');
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}

async function publish(
  store: MemoryFakeStore,
  branch: string,
  parents: string[],
  files: Array<{ path: string; bytes: Uint8Array }>,
  tag: number,
) {
  return publishSnapshot(store, {
    projectId: PROJECT_ID,
    branch,
    parents,
    files,
    timestamp: tag,
    operationId: testUuid(tag * 10 + 1),
    operationKind: 'push',
    blobIds: Object.fromEntries(files.map((file, index) => [file.path, testUuid(tag * 10 + 2 + index)])),
    commitId: testUuid(tag * 10 + 9),
  });
}

async function showCwd(): Promise<{ dir: string; config: string; store: MemoryFakeStore }> {
  const dir = await mkdtemp(join(tmpdir(), 'secsync-show-'));
  const config = await writeConfig(dir);
  return { dir, config, store: new MemoryFakeStore() };
}

describe('show current and historical content', () => {
  it('prints exact bytes for binary and CRLF files with metadata and no bytes in the result', async () => {
    const { dir, config, store } = await showCwd();
    try {
      const binary = new Uint8Array(Array.from({ length: 256 }, (_, i) => i));
      const text = Buffer.from('line1\r\nline2\r\n', 'utf8');
      await publish(
        store,
        'main',
        [],
        [
          { path: 'data.bin', bytes: binary },
          { path: 'crlf.txt', bytes: text },
        ],
        11,
      );
      for (const [path, expected] of [
        ['data.bin', binary],
        ['crlf.txt', text],
      ] as const) {
        const outcome = await runSecretSync({ cwd: dir, config, command: 'show', file: [path], store, env: ENV });
        expect(outcome.command).toBe('show');
        if (outcome.command !== 'show') {
          throw new Error('expected show result');
        }
        expect(Buffer.from(outcome.bytes)).toEqual(Buffer.from(expected));
        expect(outcome.result.path).toBe(path);
        expect(outcome.result.branch).toBe('main');
        expect(outcome.result.byteLength).toBe(expected.byteLength);
        expect(outcome.result.sourceCommitId).toBe(testUuid(119));
        expect(JSON.stringify(outcome.result)).not.toContain(Buffer.from(expected).toString('base64'));
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('shows a historical revision and rejects unknown paths, revisions, and foreign blobs', async () => {
    const { dir, config, store } = await showCwd();
    try {
      await publish(store, 'main', [], [{ path: 'app.env', bytes: Buffer.from('V=1\n') }], 21);
      await publish(store, 'main', [testUuid(219)], [{ path: 'app.env', bytes: Buffer.from('V=2\n') }], 22);
      await publish(store, 'main', [testUuid(229)], [{ path: 'other.env', bytes: Buffer.from('O=1\n') }], 23);
      const old = await runSecretSync({
        cwd: dir,
        config,
        command: 'show',
        file: ['app.env'],
        revision: testUuid(212),
        store,
        env: ENV,
      });
      if (old.command !== 'show') {
        throw new Error('expected show result');
      }
      expect(Buffer.from(old.bytes).toString('utf8')).toBe('V=1\n');
      expect(old.result.blobId).toBe(testUuid(212));
      await expect(
        runSecretSync({ cwd: dir, config, command: 'show', file: ['missing.env'], store, env: ENV }),
      ).rejects.toThrow('not tracked');
      await expect(
        runSecretSync({
          cwd: dir,
          config,
          command: 'show',
          file: ['app.env'],
          revision: testUuid(999),
          store,
          env: ENV,
        }),
      ).rejects.toThrow('not reachable');
      await expect(
        runSecretSync({
          cwd: dir,
          config,
          command: 'show',
          file: ['app.env'],
          revision: testUuid(232),
          store,
          env: ENV,
        }),
      ).rejects.toThrow('never associated');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses diverged heads for current content but serves explicit revisions and branch targets', async () => {
    const { dir, config, store } = await showCwd();
    try {
      await publish(store, 'main', [], [{ path: 'app.env', bytes: Buffer.from('A=1\n') }], 31);
      await publish(store, 'main', [], [{ path: 'app.env', bytes: Buffer.from('B=1\n') }], 32);
      await expect(
        runSecretSync({ cwd: dir, config, command: 'show', file: ['app.env'], store, env: ENV }),
      ).rejects.toMatchObject({ code: 'remote-diverged' });
      const pinned = await runSecretSync({
        cwd: dir,
        config,
        command: 'show',
        file: ['app.env'],
        revision: testUuid(312),
        store,
        env: ENV,
      });
      if (pinned.command !== 'show') {
        throw new Error('expected show result');
      }
      expect(Buffer.from(pinned.bytes).toString('utf8')).toBe('A=1\n');
      await publish(store, 'feature', [], [{ path: 'app.env', bytes: Buffer.from('F=1\n') }], 33);
      const other = await runSecretSync({
        cwd: dir,
        config,
        command: 'show',
        file: ['app.env'],
        branch: 'feature',
        store,
        env: ENV,
      });
      if (other.command !== 'show') {
        throw new Error('expected show result');
      }
      expect(Buffer.from(other.bytes).toString('utf8')).toBe('F=1\n');
      expect(other.result.branch).toBe('feature');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads without touching state and never leaks bytes into errors', async () => {
    const { dir, config, store } = await showCwd();
    const canary = `canary-bytes-${Date.now()}`;
    try {
      await publish(store, 'main', [], [{ path: 'app.env', bytes: Buffer.from(canary, 'utf8') }], 41);
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
      expect(Buffer.from(outcome.bytes).toString('utf8')).toBe(canary);
      await expect(stat(join(dir, '.repo-toolkit-secret-sync'))).rejects.toThrow();
      const failure = await runSecretSync({
        cwd: dir,
        config,
        command: 'show',
        file: ['absent.env'],
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

describe('show command wiring', () => {
  it('parses as a subcommand-free command with strict flags and no JSON content', () => {
    expect(extractCommand(['show'])).toMatchObject({ command: 'show', rest: [] });
    expect(extractCommand(['show', '--file', 'a.env'])).toMatchObject({ command: 'show' });
    const specs = [
      { name: 'config' },
      { name: 'cwd' },
      { name: 'branch' },
      { name: 'file', repeatable: true },
      { name: 'revision' },
      { name: 'message' },
      { name: 'dry-run', boolean: true },
      { name: 'json', boolean: true },
    ] as const;
    const bad = parseFlags(['--file', 'a.env', '--message', 'x'], [...specs]);
    if (bad === null) {
      throw new Error('expected flags');
    }
    expect(() => assertCommandFlags(bad, 'show', undefined)).toThrow('--message');
    expect(() => validateSecretSyncCommandOptions('show', {}, 'list')).toThrow('exactly one --file');
    expect(() => validateSecretSyncCommandOptions('show', { files: ['a', 'b'] }, 'list')).toThrow('exactly one --file');
    expect(() => validateSecretSyncCommandOptions('show', { files: ['a'], json: true }, 'list')).toThrow('--json');
    expect(() => validateSecretSyncCommandOptions('show', { files: ['a'], revision: 'r' }, 'list')).not.toThrow();
  });
});
