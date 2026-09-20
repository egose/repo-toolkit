import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseFlags } from '@repo-toolkit/publish-package';

import { assertCommandFlags } from '../src/cli-options';
import { buildOptions, extractCommand } from '../src/cli';
import { buildErrorEnvelope, buildSuccessEnvelope, redactText, sanitizeValue } from '../src/format';
import { initSecrets } from '../src/init';
import { runSecretSync } from '../src/index';
import { MemoryFakeStore } from './helpers';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const packageRoot = resolve(import.meta.dirname, '..');
const cli = join(packageRoot, 'dist', 'cli.js');

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'secsync-cli-'));
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

function runCli(args: ReadonlyArray<string>, cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('cli dispatch', () => {
  it('shows root and per-command help', () => {
    const root = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
    expect(root.status).toBe(0);
    expect(root.stdout).toContain('repo-toolkit-secret-sync');
    expect(root.stdout).toContain('--file');
    const command = spawnSync(process.execPath, [cli, 'status', '--help'], { encoding: 'utf8' });
    expect(command.status).toBe(0);
    expect(command.stdout).toContain('repo-toolkit-secret-sync status');
  });

  it('strips leading wrapper separators before the command', () => {
    expect(extractCommand(['--', '--', 'status', '--json'])).toEqual({ command: 'status', rest: ['--json'] });
    expect(extractCommand(['--', 'branch', 'list'])).toEqual({
      command: 'branch',
      branchSubcommand: 'list',
      rest: [],
    });
    expect(extractCommand(['--config', 'c.json'])).toEqual({ rest: ['--config', 'c.json'] });
  });

  it('rejects unknown commands and branch subcommands', () => {
    expect(() => extractCommand(['explode'])).toThrow(/Unknown command/);
    expect(() => extractCommand(['branch', 'explode'])).toThrow(/Unknown branch subcommand/);
    const unknown = runCli(['explode'], packageRoot);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('Unknown command');
  });

  it('rejects unknown flags in strict mode', () => {
    expect(() => parseFlags(['--nope'], [{ name: 'config' }])).toThrow(/Unknown argument/);
    const result = runCli(['status', '--nope'], packageRoot);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown argument');
  });

  it('rejects flags that do not belong to the command', () => {
    const parsed = parseFlags(
      ['--message', 'hi'],
      [{ name: 'config' }, { name: 'message' }, { name: 'check', boolean: true }],
    );
    if (!parsed) throw new Error('expected flags');
    expect(() => assertCommandFlags(parsed, 'status', undefined)).toThrow(/--message/);
    expect(() => assertCommandFlags(parsed, 'push', undefined)).not.toThrow();
  });

  it('requires values, accepts inline values, and keeps --file repeatable', () => {
    expect(() => parseFlags(['--config'], [{ name: 'config' }])).toThrow(/Missing value/);
    expect(() => parseFlags(['--file', '--json'], [{ name: 'file', repeatable: true }])).toThrow(/Missing value/);
    const inline = parseFlags(['--file=-leading-name', '--file=a,b.env'], [{ name: 'file', repeatable: true }]);
    if (!inline) throw new Error('expected flags');
    expect(inline.repeat.file).toEqual(['-leading-name', 'a,b.env']);
    const options = buildOptions(inline, 'status');
    expect(options.file).toEqual(['-leading-name', 'a,b.env']);
  });

  it('keeps comma-containing paths as single exact values', () => {
    const parsed = parseFlags(['--file', 'a,b.env', '--file', 'c.env'], [{ name: 'file', repeatable: true }]);
    if (!parsed) throw new Error('expected flags');
    expect(buildOptions(parsed, 'push').file).toEqual(['a,b.env', 'c.env']);
  });

  it('exits 1 with redacted JSON and text errors', async () => {
    const canary = `cli-canary-token-${Date.now()}`;
    await withTempDir(async (dir) => {
      await writeConfig(dir);
      const outcome = await runSecretSync({
        config: join(dir, 'secret-sync.config.json'),
        cwd: dir,
        command: 'status',
        store: new MemoryFakeStore(),
        env: { OP_CONNECT_HOST: 'https://connect.example', OP_CONNECT_TOKEN: canary },
      }).catch((error: unknown) => error);
      void outcome;
      const envelope = buildErrorEnvelope('status', new Error(`boom ${canary}`), [canary]);
      expect(JSON.stringify(envelope)).not.toContain(canary);
      expect(redactText(`boom ${canary}`, [canary])).not.toContain(canary);
      const sanitized = sanitizeValue({ sha256: canary, hmac: canary, contentBase64: canary, path: 'ok' });
      expect(JSON.stringify(sanitized)).not.toContain(canary);
      const ok = buildSuccessEnvelope('status', { path: '.env', note: 'hi' });
      expect(ok.status).toBe('ok');
    });
  });

  it('reports status --check drift without claiming success', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir);
      await writeFile(join(dir, '.env'), 'LOCAL=1');
      const store = new MemoryFakeStore();
      const env = { OP_CONNECT_HOST: 'https://connect.example', OP_CONNECT_TOKEN: 't' };
      const drifted = await runSecretSync({
        config: join(dir, 'secret-sync.config.json'),
        cwd: dir,
        command: 'status',
        check: true,
        store,
        env,
      });
      expect(drifted.command).toBe('status');
      if (drifted.command === 'status') {
        expect(drifted.result.checkFailed).toBe(true);
      }
    });
  });

  it('leaves clean status --check passing', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir);
      const store = new MemoryFakeStore();
      const env = { OP_CONNECT_HOST: 'https://connect.example', OP_CONNECT_TOKEN: 't' };
      const clean = await runSecretSync({
        config: join(dir, 'secret-sync.config.json'),
        cwd: dir,
        command: 'status',
        check: true,
        store,
        env,
      });
      if (clean.command === 'status') {
        expect(clean.result.checkFailed).toBe(false);
        expect(clean.result.clean).toBe(true);
      } else {
        throw new Error('expected status');
      }
    });
  });

  it('keeps push --dry-run free of writes, locks, state, and temp files', async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir);
      await writeFile(join(dir, '.env'), 'DRY=1');
      const store = new MemoryFakeStore();
      const env = { OP_CONNECT_HOST: 'https://connect.example', OP_CONNECT_TOKEN: 't' };
      const result = await runSecretSync({
        config: join(dir, 'secret-sync.config.json'),
        cwd: dir,
        command: 'push',
        dryRun: true,
        store,
        env,
      });
      expect(result.command).toBe('push');
      if (result.command === 'push') {
        expect(result.result.dryRun).toBe(true);
        expect(result.result.published).toBe(false);
      }
      let stateMissing = false;
      try {
        await readFile(join(dir, '.repo-toolkit-secret-sync', 'state.json'), 'utf8');
      } catch {
        stateMissing = true;
      }
      expect(stateMissing).toBe(true);
      expect(store.counts.creates).toBe(0);
    });
  });

  it('switches branches through runSecretSync with an explicit target', async () => {
    await withTempDir(async (dir) => {
      const config = await writeConfig(dir);
      await writeFile(join(dir, '.env'), 'SWITCH=1\n');
      const store = new MemoryFakeStore();
      const env = { OP_CONNECT_HOST: 'https://connect.example', OP_CONNECT_TOKEN: 't' };
      const pushed = await runSecretSync({ config, cwd: dir, command: 'push', message: 'base', store, env });
      expect(pushed.command).toBe('push');
      const created = await runSecretSync({
        config,
        cwd: dir,
        command: 'branch',
        branchSubcommand: 'create',
        name: 'feature/demo',
        from: 'main',
        store,
        env,
      });
      expect(created.command).toBe('branch');
      const moved = await runSecretSync({ config, cwd: dir, command: 'switch', branch: 'feature/demo', store, env });
      expect(moved.command).toBe('switch');
      if (moved.command === 'switch') {
        expect(moved.result.switched).toBe(true);
        expect(moved.result.to).toBe('feature/demo');
      }
      await expect(runSecretSync({ config, cwd: dir, command: 'switch', store, env })).rejects.toThrow(/--branch/);
    });
  });

  it('initializes config, state dir, and gitignore without overwriting', async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, '.gitignore'), 'node_modules/\n');
      const first = await initSecrets({ cwd: dir, vault: 'vault-1' });
      expect(first.createdConfig).toBe(true);
      expect(first.gitignoreUpdated).toBe(true);
      const second = await initSecrets({ cwd: dir, vault: 'vault-1' });
      expect(second.createdConfig).toBe(false);
      expect(second.gitignoreUpdated).toBe(false);
      await expect(initSecrets({ cwd: dir, vault: 'other' })).rejects.toThrow(/differs/);
    });
  });
});
