import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseFlags } from '@repo-toolkit/publish-package';
import { assertCommandFlags } from '../src/cli-options';
import { resolveClipboardCandidates, systemClipboardWriter, type ClipboardSpawn } from '../src/clipboard';
import { validateSecretSyncCommandOptions } from '../src/config';
import { formatJsonResult, formatTextResult } from '../src/format';
import { publishSnapshot } from '../src/history-store';
import { runSecretSync } from '../src/index';
import { MemoryFakeStore } from './helpers';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const ENV = { OP_CONNECT_HOST: 'https://connect.example', OP_CONNECT_TOKEN: 'test-token' };

function testUuid(tag: number): string {
  const tail = tag.toString(16).padStart(12, '0');
  return `cccccccc-cccc-4ccc-8ccc-${tail}`;
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

async function seed(store: MemoryFakeStore, bytes: Uint8Array, tag: number): Promise<void> {
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

describe('clipboard command resolution', () => {
  it('selects platform tools and requires a session on Linux', () => {
    expect(resolveClipboardCandidates('darwin', {}).map((entry) => entry.command)).toEqual(['pbcopy']);
    expect(resolveClipboardCandidates('win32', {}).map((entry) => entry.command)).toEqual(['clip']);
    expect(resolveClipboardCandidates('linux', { WAYLAND_DISPLAY: 'wayland-0' }).map((entry) => entry.command)).toEqual(
      ['wl-copy'],
    );
    expect(resolveClipboardCandidates('linux', { DISPLAY: ':0' }).map((entry) => entry.command)).toEqual([
      'xclip',
      'xsel',
    ]);
    expect(resolveClipboardCandidates('linux', {})).toEqual([]);
  });

  it('skips missing tools, reports failures, and rejects headless sessions', async () => {
    const seen: string[] = [];
    const spawn: ClipboardSpawn = (command) => {
      seen.push(command);
      if (command === 'xclip') {
        return { ok: false, missing: true };
      }
      return { ok: true, missing: false };
    };
    const writer = systemClipboardWriter(spawn, 'linux', { DISPLAY: ':0' });
    await expect(writer.write(new Uint8Array([1, 2, 3]))).resolves.toEqual({ command: 'xsel' });
    expect(seen).toEqual(['xclip', 'xsel']);
    const failing: ClipboardSpawn = () => ({ ok: false, missing: false });
    await expect(systemClipboardWriter(failing, 'darwin', {}).write(new Uint8Array([1]))).rejects.toMatchObject({
      code: 'server',
    });
    const absent: ClipboardSpawn = () => ({ ok: false, missing: true });
    await expect(systemClipboardWriter(absent, 'darwin', {}).write(new Uint8Array([1]))).rejects.toThrow('pbcopy');
    expect(() => systemClipboardWriter(absent, 'linux', {})).toThrow('graphical session');
  });
});

describe('show --copy', () => {
  it('copies exact bytes through the injected writer with metadata-only output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-showcopy-'));
    const canary = Buffer.from(`copy-bytes-${Date.now()}`);
    try {
      const config = await writeConfig(dir);
      const store = new MemoryFakeStore();
      await seed(store, canary, 91);
      const captured: Uint8Array[] = [];
      const outcome = await runSecretSync({
        cwd: dir,
        config,
        command: 'show',
        file: ['app.env'],
        copy: true,
        clipboard: {
          write: async (bytes) => {
            captured.push(bytes);
            return { command: 'test-clip' };
          },
        },
        store,
        env: ENV,
      });
      expect(outcome.command).toBe('show');
      if (outcome.command !== 'show') {
        throw new Error('expected show result');
      }
      expect(captured).toHaveLength(1);
      expect(Buffer.from(captured[0] as Uint8Array)).toEqual(canary);
      expect(outcome.result.copied).toBe(true);
      expect(outcome.result.clipboardCommand).toBe('test-clip');
      expect(Buffer.from(outcome.bytes)).toEqual(canary);
      const text = formatTextResult('show', outcome.result);
      expect(text).toContain('copied');
      expect(text).toContain('app.env');
      expect(text).not.toContain(canary.toString('base64'));
      const json = JSON.parse(formatJsonResult('show', outcome.result)) as Record<string, unknown>;
      expect(json).toMatchObject({ command: 'show', status: 'ok', copied: true });
      expect(JSON.stringify(json)).not.toContain(canary.toString('base64'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('allows --json only with --copy and scopes --copy to show', async () => {
    expect(() =>
      validateSecretSyncCommandOptions('show', { files: ['a'], copy: true, json: true }, 'list'),
    ).not.toThrow();
    expect(() => validateSecretSyncCommandOptions('show', { files: ['a'], json: true }, 'list')).toThrow('--json');
    expect(() => validateSecretSyncCommandOptions('status', { copy: true }, 'list')).toThrow('--copy');
    const specs = [
      { name: 'config' },
      { name: 'cwd' },
      { name: 'copy', boolean: true },
      { name: 'file', repeatable: true },
    ] as const;
    const ok = parseFlags(['--copy'], [...specs]);
    if (ok === null) {
      throw new Error('expected flags');
    }
    expect(() => assertCommandFlags(ok, 'show', undefined)).not.toThrow();
    expect(() => assertCommandFlags(ok, 'status', undefined)).toThrow('--copy');
  });

  it('keeps errors free of copied bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-showcopy-'));
    const canary = `copy-canary-${Date.now()}`;
    try {
      const config = await writeConfig(dir);
      const store = new MemoryFakeStore();
      await seed(store, Buffer.from(canary, 'utf8'), 92);
      const failure = await runSecretSync({
        cwd: dir,
        config,
        command: 'show',
        file: ['absent.env'],
        copy: true,
        clipboard: { write: async () => ({ command: 'test-clip' }) },
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
