import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { buildComposeArgs, preflightCompose, getServiceState, startSandbox, runCompose } from '../src/compose';
import { resolveComposeSandboxPlan } from '../src/plan';

function basePlan(overrides: Record<string, unknown> = {}) {
  return resolveComposeSandboxPlan({
    cwd: '.',
    compose: { files: ['sandbox/docker-compose.yml'], ...(overrides.compose as Record<string, unknown> | undefined) },
    test: { executable: 'echo' },
    ...(overrides as Record<string, unknown>),
  } as unknown as Record<string, unknown>);
}

describe('CSREM-07 compose prefixArgs regression', () => {
  it('default plan produces docker compose version/up/ps/logs/down unchanged', async () => {
    const plan = basePlan();
    expect(plan.compose.executable).toBe('docker');
    expect(plan.compose.prefixArgs).toEqual(['compose']);
    const { executable, args } = buildComposeArgs(plan, 'version');
    expect(executable).toBe('docker');
    expect(args[0]).toBe('compose');
    expect(args).toContain('version');

    const up = buildComposeArgs(plan, ['up', '-d']);
    expect(up.args[0]).toBe('compose');
    expect(up.args).toContain('up');

    const ps = buildComposeArgs(plan, 'ps', ['-a', '--format', 'json']);
    expect(ps.args[0]).toBe('compose');
    expect(ps.args).toContain('ps');

    const logs = buildComposeArgs(plan, 'logs', ['--no-color']);
    expect(logs.args[0]).toBe('compose');
    expect(logs.args).toContain('logs');

    const down = buildComposeArgs(plan, 'down', ['--volumes']);
    expect(down.args[0]).toBe('compose');
    expect(down.args).toContain('down');

    // via preflight/startSandbox/getServiceState/runCompose all use same prefix via buildComposeArgs boundary
    const runProcess = vi.fn(async () => ({
      exitCode: 0,
      stdout: 'Docker Compose version v2.27.0',
      stderr: '',
      signal: null,
      durationMs: 10,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      truncatedBytes: 0,
    }));
    await preflightCompose(plan, { runProcess: runProcess as never });
    const call = runProcess.mock.calls[0][0] as { executable: string; args: string[] };
    expect(call.executable).toBe('docker');
    expect(call.args[0]).toBe('compose');
    expect(call.args).toContain('version');

    const run2 = vi.fn(async () => ({
      exitCode: 0,
      stdout: '[]',
      stderr: '',
      signal: null,
      durationMs: 10,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      truncatedBytes: 0,
    }));
    await getServiceState(plan, 'svc', { runProcess: run2 as never }).catch(() => {});
    const call2 = run2.mock.calls[0][0] as { args: string[] };
    expect(call2.args[0]).toBe('compose');

    const run3 = vi.fn(async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      signal: null,
      durationMs: 10,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      truncatedBytes: 0,
    }));
    await runCompose(plan, 'down', [], {}, { runProcess: run3 as never });
    expect((run3.mock.calls[0][0] as { args: string[] }).args[0]).toBe('compose');
  });

  it('standalone config produces docker-compose version/up/ps/logs/down with no inserted compose token', async () => {
    const plan = resolveComposeSandboxPlan({
      compose: { files: ['a.yml'], executable: 'docker-compose', prefixArgs: [] },
      test: { executable: 'echo' },
    } as unknown as Record<string, unknown>);
    expect(plan.compose.executable).toBe('docker-compose');
    expect(plan.compose.prefixArgs).toEqual([]);
    for (const sub of ['version', 'up', 'ps', 'logs', 'down'] as const) {
      const { executable, args } = buildComposeArgs(plan, sub);
      expect(executable).toBe('docker-compose');
      expect(args).not.toContain('compose');
      // first arg should be file flag or subcommand, never 'compose'
      expect(args[0]).not.toBe('compose');
      expect(args).toContain(sub);
    }
    const runProcess = vi.fn(async () => ({
      exitCode: 0,
      stdout: 'Docker Compose version v2.27.0',
      stderr: '',
      signal: null,
      durationMs: 10,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      truncatedBytes: 0,
    }));
    await preflightCompose(plan, { runProcess: runProcess as never });
    const call = runProcess.mock.calls[0][0] as { args: string[] };
    expect(call.args).not.toContain('compose');
    expect(call.args).toContain('version');
  });

  it('custom executable and multi-arg prefix passed as exact argv without shell parsing', () => {
    const plan = resolveComposeSandboxPlan({
      compose: {
        files: ['a.yml'],
        executable: '/opt/my wrapper/docker',
        prefixArgs: ['--context', 'my context with spaces', 'compose', '--x="y z"'],
      },
      test: { executable: 'echo' },
    } as unknown as Record<string, unknown>);
    const { executable, args } = buildComposeArgs(plan, 'version');
    expect(executable).toBe('/opt/my wrapper/docker');
    // prefixArgs must be passed as exact argv elements, not shell-split
    expect(args[0]).toBe('--context');
    expect(args[1]).toBe('my context with spaces');
    expect(args[2]).toBe('compose');
    expect(args[3]).toBe('--x="y z"');
    // ensure not split on spaces or quotes
    const flattened = args.join(' | ');
    expect(flattened).toContain('my context with spaces');
    expect(flattened).toContain('--x="y z"');
    // count: prefix (4) + file flag (2) + subcommand (1)
    expect(args.slice(0, 4)).toEqual(['--context', 'my context with spaces', 'compose', '--x="y z"']);
    expect(args).toContain(resolve('a.yml'));
  });

  it('empty, non-string, and NUL prefix args fail at plan resolution', () => {
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'], prefixArgs: [''] },
        test: { executable: 'echo' },
      } as unknown as Record<string, unknown>),
    ).toThrow(/prefixArgs.*non-empty|string|NUL/i);

    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'], prefixArgs: ['valid', ''] },
        test: { executable: 'echo' },
      } as unknown as Record<string, unknown>),
    ).toThrow(/prefixArgs/);

    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'], prefixArgs: [123 as unknown as string] },
        test: { executable: 'echo' },
      } as unknown as Record<string, unknown>),
    ).toThrow(/prefixArgs/);

    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'], prefixArgs: ['ok', 123 as unknown as string] },
        test: { executable: 'echo' },
      } as unknown as Record<string, unknown>),
    ).toThrow(/prefixArgs/);

    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'], prefixArgs: ['a\0b'] },
        test: { executable: 'echo' },
      } as unknown as Record<string, unknown>),
    ).toThrow(/NUL/);

    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'], prefixArgs: 'compose' as unknown as string[] },
        test: { executable: 'echo' },
      } as unknown as Record<string, unknown>),
    ).toThrow(/prefixArgs must be an array/);
  });

  it('dry-run plan shows both default and standalone forms', () => {
    const defaultPlan = resolveComposeSandboxPlan({
      compose: { files: ['a.yml'] },
      test: { executable: 'echo' },
    } as unknown as Record<string, unknown>);
    expect(defaultPlan.compose.executable).toBe('docker');
    expect(defaultPlan.compose.prefixArgs).toEqual(['compose']);

    const standalonePlan = resolveComposeSandboxPlan({
      compose: { files: ['a.yml'], executable: 'docker-compose', prefixArgs: [] },
      test: { executable: 'echo' },
    } as unknown as Record<string, unknown>);
    expect(standalonePlan.compose.executable).toBe('docker-compose');
    expect(standalonePlan.compose.prefixArgs).toEqual([]);

    // ensure JSON serialization shows both forms distinctly
    const defaultJson = JSON.stringify(defaultPlan);
    const standaloneJson = JSON.stringify(standalonePlan);
    expect(defaultJson).toContain('"executable":"docker"');
    expect(defaultJson).toContain('"prefixArgs":["compose"]');
    expect(standaloneJson).toContain('"executable":"docker-compose"');
    expect(standaloneJson).toContain('"prefixArgs":[]');
  });

  it('every compose operation uses same resolved prefix before operation args', async () => {
    const plan = resolveComposeSandboxPlan({
      compose: { files: ['a.yml'], executable: '/usr/local/bin/docker', prefixArgs: ['compose', '--xx'] },
      test: { executable: 'echo' },
    } as unknown as Record<string, unknown>);
    const subs: Array<[string, string[]]> = [
      ['version', []],
      ['up', ['-d']],
      ['ps', ['-a', '--format', 'json']],
      ['logs', ['--no-color']],
      ['down', ['--volumes']],
    ];
    for (const [sub, extra] of subs) {
      const { args } = buildComposeArgs(plan, sub, extra);
      expect(args[0]).toBe('compose');
      expect(args[1]).toBe('--xx');
      expect(args).toContain(sub);
      for (const e of extra) expect(args).toContain(e);
      // prefix must be before -f and before subcommand
      const fIdx = args.indexOf('-f');
      const subIdx = args.indexOf(sub);
      expect(fIdx).toBeGreaterThan(1);
      expect(subIdx).toBeGreaterThan(fIdx);
    }

    // also verify startSandbox respects prefix (it builds up -d etc via runCompose)
    const run = vi.fn(async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      signal: null,
      durationMs: 10,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      truncatedBytes: 0,
    }));
    await startSandbox(plan, { runProcess: run as never });
    const startArgs = (run.mock.calls[0][0] as { args: string[] }).args;
    expect(startArgs[0]).toBe('compose');
    expect(startArgs[1]).toBe('--xx');
    expect(startArgs).toContain('up');
  });

  it('dry-run output shows both default and standalone compose invocations', async () => {
    const { runComposeSandbox } = await import('../src/run');
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = await mkdtemp(join(tmpdir(), 'cs-prefix-dry-'));
    try {
      const defaultLogs: string[] = [];
      const logger = { log: (m: string) => defaultLogs.push(m) };
      await runComposeSandbox(
        {
          cwd: root,
          compose: { files: ['a.yml'] },
          test: { executable: 'echo' },
          dryRun: true,
        } as unknown as Record<string, unknown>,
        {
          logger: logger as never,
          clock: {
            now: () => 0,
            sleep: async () => {},
            setTimeout: (cb: () => void) => setTimeout(cb as never, 0),
            clearTimeout: (handle: unknown) => {
              void handle;
            },
          } as never,
          signalTarget: new (await import('node:events')).EventEmitter() as never,
        },
      );
      expect(defaultLogs.join('\n')).toContain('docker compose');
      expect(defaultLogs.join('\n')).toContain('compose=');
      // plan JSON part validated elsewhere, but logger line shows invocation
      const standaloneLogs: string[] = [];
      const logger2 = { log: (m: string) => standaloneLogs.push(m) };
      await runComposeSandbox(
        {
          cwd: root,
          compose: { files: ['a.yml'], executable: 'docker-compose', prefixArgs: [] },
          test: { executable: 'echo' },
          dryRun: true,
        } as unknown as Record<string, unknown>,
        {
          logger: logger2 as never,
          clock: {
            now: () => 0,
            sleep: async () => {},
            setTimeout: (cb: () => void) => setTimeout(cb as never, 0),
            clearTimeout: (handle: unknown) => {
              void handle;
            },
          } as never,
          signalTarget: new (await import('node:events')).EventEmitter() as never,
        },
      );
      expect(standaloneLogs.join('\n')).toContain('docker-compose');
      expect(standaloneLogs.join('\n')).not.toContain('docker-compose compose');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('docs show both default plugin form and asdf-managed standalone form', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const readme = await readFile(resolve(import.meta.dirname, '../README.md'), 'utf8');
    expect(readme).toContain('docker compose');
    expect(readme).toContain('docker-compose');
    expect(readme).toContain('prefixArgs');
    expect(readme).toContain('["compose"]');
    expect(readme).toContain('prefixArgs: []');
    const website = await readFile(
      resolve(import.meta.dirname, '../../../website/docs/packages/compose-sandbox.md'),
      'utf8',
    );
    expect(website).toContain('docker compose');
    expect(website).toContain('docker-compose');
    expect(website).toContain('prefixArgs');
  });
});
