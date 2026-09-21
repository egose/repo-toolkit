import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseFlags } from '@repo-toolkit/publish-package';
import { assertCommandFlags } from '../src/cli-options';
import { validateSecretSyncCommandOptions } from '../src/config';
import { publishSnapshot } from '../src/history-store';
import { INTERACTIVE_CURRENT_REVISION, resolveInteractiveShowTarget, type ShowPicker } from '../src/show-interactive';
import { runSecretSync, showFile } from '../src/index';
import { MemoryFakeStore } from './helpers';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const ENV = { OP_CONNECT_HOST: 'https://connect.example', OP_CONNECT_TOKEN: 'test-token' };
const IDENTITY = {
  type: 'onepassword-connect',
  endpoint: 'https://connect.example',
  vaultId: 'vault-show',
  projectId: PROJECT_ID,
} as const;

function testUuid(tag: number): string {
  const tail = tag.toString(16).padStart(12, '0');
  return `bbbbbbbb-bbbb-4bbb-8bbb-${tail}`;
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

function scriptPicker(script: { file?: string; revision?: string; branch?: string }, calls: string[]): ShowPicker {
  return {
    selectFile: async (files) => {
      calls.push(`file:${files.join(',')}`);
      return script.file;
    },
    selectRevision: async (file, revisions) => {
      calls.push(`revision:${file}:${revisions.map((entry) => entry.blobId).join(',')}`);
      return script.revision;
    },
    selectBranch: async (branches, initial) => {
      calls.push(`branch:${branches.join(',')}:${initial}`);
      return script.branch;
    },
  };
}

describe('interactive show target resolution', () => {
  it('walks file, revision, then branch and shows the resolved bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-showi-'));
    const store = new MemoryFakeStore();
    try {
      await writeConfig(dir);
      await publish(store, 'main', [], [{ path: 'b.env', bytes: Buffer.from('B=1\n') }], 51);
      await publish(store, 'main', [testUuid(519)], [{ path: 'a.env', bytes: Buffer.from('A=1\n') }], 52);
      const calls: string[] = [];
      const target = await resolveInteractiveShowTarget({
        store,
        identity: { ...IDENTITY },
        branch: 'main',
        picker: scriptPicker({ file: 'a.env', revision: INTERACTIVE_CURRENT_REVISION, branch: 'main' }, calls),
      });
      expect(target).toEqual({ path: 'a.env', branch: 'main' });
      expect(calls[0]).toBe('file:a.env,b.env');
      expect(calls[1]).toMatch(/^revision:a\.env:/);
      expect(calls[2]).toMatch(/^branch:main:main$/);
      const shown = await showFile({
        store,
        identity: { ...IDENTITY },
        branch: target.branch,
        path: target.path,
      });
      expect(Buffer.from(shown.bytes).toString('utf8')).toBe('A=1\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves a historical revision and skips pre-answered steps', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-showi-'));
    const store = new MemoryFakeStore();
    try {
      await writeConfig(dir);
      await publish(store, 'main', [], [{ path: 'a.env', bytes: Buffer.from('A=1\n') }], 61);
      await publish(store, 'main', [testUuid(619)], [{ path: 'a.env', bytes: Buffer.from('A=2\n') }], 62);
      const calls: string[] = [];
      const target = await resolveInteractiveShowTarget({
        store,
        identity: { ...IDENTITY },
        branch: 'main',
        path: 'a.env',
        picker: scriptPicker({ revision: testUuid(612), branch: 'main' }, calls),
      });
      expect(target).toEqual({ path: 'a.env', revision: testUuid(612), branch: 'main' });
      expect(calls.some((call) => call.startsWith('file:'))).toBe(false);
      const shown = await showFile({
        store,
        identity: { ...IDENTITY },
        branch: target.branch,
        path: target.path,
        revision: target.revision,
      });
      expect(Buffer.from(shown.bytes).toString('utf8')).toBe('A=1\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('aborts cleanly on cancel at each step and on empty history', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-showi-'));
    const store = new MemoryFakeStore();
    try {
      await writeConfig(dir);
      await publish(store, 'main', [], [{ path: 'a.env', bytes: Buffer.from('A=1\n') }], 71);
      for (const script of [{}, { file: 'a.env' }, { file: 'a.env', revision: 'current' }]) {
        await expect(
          resolveInteractiveShowTarget({
            store,
            identity: { ...IDENTITY },
            branch: 'main',
            picker: scriptPicker(script, []),
          }),
        ).rejects.toMatchObject({ code: 'aborted' });
      }
      const empty = new MemoryFakeStore();
      await expect(
        resolveInteractiveShowTarget({
          store: empty,
          identity: { ...IDENTITY },
          branch: 'main',
          picker: scriptPicker({ file: 'a.env', revision: 'current', branch: 'main' }, []),
        }),
      ).rejects.toThrow('No tracked files');
      await expect(
        resolveInteractiveShowTarget({
          store,
          identity: { ...IDENTITY },
          branch: 'main',
          path: 'absent.env',
          picker: scriptPicker({ revision: 'current', branch: 'main' }, []),
        }),
      ).rejects.toThrow('not tracked');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('interactive show wiring', () => {
  it('requires a TTY without an injected picker and restricts the flag to show', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'secsync-showi-'));
    try {
      const config = await writeConfig(dir);
      await expect(
        runSecretSync({ cwd: dir, config, command: 'show', interactive: true, store: new MemoryFakeStore(), env: ENV }),
      ).rejects.toThrow('interactive terminal');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    expect(() => validateSecretSyncCommandOptions('status', { interactive: true }, 'list')).toThrow('--interactive');
    expect(() => validateSecretSyncCommandOptions('show', { interactive: true }, 'list')).not.toThrow();
    const specs = [
      { name: 'config' },
      { name: 'cwd' },
      { name: 'interactive', boolean: true },
      { name: 'file', repeatable: true },
    ] as const;
    const ok = parseFlags(['--interactive'], [...specs]);
    if (ok === null) {
      throw new Error('expected flags');
    }
    expect(() => assertCommandFlags(ok, 'show', undefined)).not.toThrow();
    expect(() => assertCommandFlags(ok, 'status', undefined)).toThrow('--interactive');
  });
});
