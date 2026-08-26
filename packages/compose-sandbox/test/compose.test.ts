import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  buildComposeArgs,
  parseComposePsOutput,
  preflightCompose,
  prepareSandbox,
  getServiceState,
} from '../src/compose';
import { resolveComposeSandboxPlan } from '../src/plan';

function basePlan(overrides: Record<string, unknown> = {}) {
  return resolveComposeSandboxPlan({
    cwd: '.',
    compose: {
      files: ['sandbox/docker-compose.yml'],
      projectName: 'testproj',
      ...((overrides.compose as Record<string, unknown>) ?? {}),
    },
    test: { executable: 'echo', args: ['hello'] },
    ...overrides,
  } as unknown as Record<string, unknown>);
}

describe('buildComposeArgs', () => {
  it('constructs stable args with files, envFile, project, profiles', () => {
    const plan = resolveComposeSandboxPlan({
      cwd: '.',
      compose: {
        files: ['sandbox/docker-compose.yml', 'sandbox/docker-compose-ci.yml'],
        envFile: 'sandbox/.env.test',
        projectName: 'dbtools',
        profiles: ['ci'],
      },
      test: { executable: 'echo' },
    } as unknown as Record<string, unknown>);
    const { executable, args } = buildComposeArgs(plan, 'up', ['-d', '--build']);
    expect(executable).toBe('docker');
    expect(args[0]).toBe('compose');
    expect(args).toContain('-f');
    expect(args).toContain(resolve('sandbox/docker-compose.yml'));
    expect(args).toContain(resolve('sandbox/docker-compose-ci.yml'));
    expect(args).toContain('--env-file');
    expect(args).toContain(resolve('sandbox/.env.test'));
    expect(args).toContain('-p');
    expect(args).toContain('dbtools');
    expect(args).toContain('--profile');
    expect(args).toContain('ci');
    expect(args.slice(-3)).toEqual(['up', '-d', '--build']);
  });

  it('uses resolvedFiles and handles array subcommand', () => {
    const plan = basePlan();
    const { args } = buildComposeArgs(plan, ['ps', '-a'], ['--format', 'json']);
    expect(args).toContain('ps');
    expect(args).toContain('-a');
    expect(args).toContain('--format');
    expect(args).toContain('json');
  });

  it('defaults executable to docker and allows custom executable', () => {
    const planDefault = basePlan();
    expect(buildComposeArgs(planDefault, 'version').executable).toBe('docker');
    const planCustom = resolveComposeSandboxPlan({
      compose: { files: ['a.yml'], executable: 'podman' },
      test: { executable: 'echo' },
    } as unknown as Record<string, unknown>);
    expect(buildComposeArgs(planCustom, 'version').executable).toBe('podman');
  });

  it('orders files, envFile, project, profiles stably', () => {
    const plan = resolveComposeSandboxPlan({
      compose: { files: ['b.yml', 'a.yml'], envFile: 'env', projectName: 'proj', profiles: ['p1', 'p2'] },
      test: { executable: 'echo' },
    } as unknown as Record<string, unknown>);
    const { args } = buildComposeArgs(plan, 'config');
    const fIdx = args.indexOf('-f');
    const envIdx = args.indexOf('--env-file');
    const pIdx = args.indexOf('-p');
    const profileIdx = args.indexOf('--profile');
    expect(fIdx).toBeLessThan(envIdx);
    expect(envIdx).toBeLessThan(pIdx);
    expect(pIdx).toBeLessThan(profileIdx);
    expect(args[args.length - 1]).toBe('config');
  });

  it('throws on NUL bytes in executable or args', () => {
    const plan = basePlan();
    const badPlan = { ...plan, compose: { ...plan.compose, executable: 'dock\0er' } } as unknown as typeof plan;
    expect(() => buildComposeArgs(badPlan, 'version')).toThrow(/NUL/);
    expect(() => buildComposeArgs(plan, 'vers\0ion')).toThrow(/NUL/);
    expect(() => buildComposeArgs(plan, 'version', ['a\0'])).toThrow(/NUL/);
  });
});

describe('preflightCompose', () => {
  it('succeeds when docker compose version returns version string', async () => {
    const plan = basePlan();
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
    expect(runProcess).toHaveBeenCalledTimes(1);
    const call = runProcess.mock.calls[0][0] as { executable: string; args: string[] };
    expect(call.executable).toBe('docker');
    expect(call.args).toContain('compose');
    expect(call.args).toContain('version');
  });

  it('fails when version command exits non-zero', async () => {
    const plan = basePlan();
    const runProcess = vi.fn(async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'error: not found',
      signal: null,
      durationMs: 10,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      truncatedBytes: 0,
    }));
    await expect(preflightCompose(plan, { runProcess: runProcess as never })).rejects.toThrow(/exitCode 1/);
  });

  it('fails when output lacks version', async () => {
    const plan = basePlan();
    const runProcess = vi.fn(async () => ({
      exitCode: 0,
      stdout: 'hello',
      stderr: 'hello',
      signal: null,
      durationMs: 10,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      truncatedBytes: 0,
    }));
    await expect(preflightCompose(plan, { runProcess: runProcess as never })).rejects.toThrow(
      /did not contain version/,
    );
  });

  it('wraps spawn errors with actionable message', async () => {
    const plan = basePlan();
    const runProcess = vi.fn(async () => {
      throw new Error('ENOENT');
    });
    await expect(preflightCompose(plan, { runProcess: runProcess as never })).rejects.toThrow(/preflight failed/);
  });
});

describe('prepareSandbox', () => {
  it('creates directories and copies files after validating sources', async () => {
    const cwd = resolve('.');
    const plan = resolveComposeSandboxPlan({
      cwd: '.',
      compose: { files: ['a.yml'] },
      prepare: {
        directories: ['sandbox/mnt/postgres', 'sandbox/mnt/mongodb'],
        copies: [{ from: 'env.example', to: 'env.test' }],
      },
      test: { executable: 'echo' },
    } as unknown as Record<string, unknown>);

    const mkdir = vi.fn(async () => {});
    const copyFile = vi.fn(async () => {});
    const access = vi.fn(async () => {});

    await prepareSandbox(plan, { fs: { mkdir, copyFile, access } as never });

    expect(mkdir).toHaveBeenCalled();
    expect(copyFile).toHaveBeenCalledTimes(1);
    expect(copyFile.mock.calls[0][0]).toBe(resolve(cwd, 'env.example'));
    expect(copyFile.mock.calls[0][1]).toBe(resolve(cwd, 'env.test'));
    expect(access).toHaveBeenCalledWith(resolve(cwd, 'env.example'));
  });

  it('validates all sources before mutating destinations (no mkdir/copy if source missing)', async () => {
    const plan = resolveComposeSandboxPlan({
      compose: { files: ['a.yml'] },
      prepare: {
        directories: ['out/data'],
        copies: [
          { from: 'missing.src', to: 'out/dest' },
          { from: 'also.missing', to: 'out/dest2' },
        ],
      },
      test: { executable: 'echo' },
    } as unknown as Record<string, unknown>);
    const mkdir = vi.fn(async () => {});
    const copyFile = vi.fn(async () => {});
    const access = vi.fn(async (p: string) => {
      if (p.endsWith('missing.src')) throw new Error('no file');
      if (p.endsWith('also.missing')) throw new Error('no file');
    });
    await expect(prepareSandbox(plan, { fs: { mkdir, copyFile, access } as never })).rejects.toThrow(
      /source does not exist: missing\.src/,
    );
    expect(mkdir).not.toHaveBeenCalled();
    expect(copyFile).not.toHaveBeenCalled();
  });

  it('throws actionable error when source does not exist', async () => {
    const plan = resolveComposeSandboxPlan({
      compose: { files: ['a.yml'] },
      prepare: { copies: [{ from: 'nope.txt', to: 'out.txt' }] },
      test: { executable: 'echo' },
    } as unknown as Record<string, unknown>);
    const mkdir = vi.fn(async () => {});
    const copyFile = vi.fn(async () => {});
    const access = vi.fn(async () => {
      throw new Error('ENOENT');
    });
    await expect(prepareSandbox(plan, { fs: { mkdir, copyFile, access } as never })).rejects.toThrow(
      /prepare copy source does not exist/,
    );
  });

  it('creates parent directories for copies', async () => {
    const cwd = resolve('.');
    const plan = resolveComposeSandboxPlan({
      compose: { files: ['a.yml'] },
      prepare: { copies: [{ from: 'a.txt', to: 'nested/dir/out.txt' }] },
      test: { executable: 'echo' },
    } as unknown as Record<string, unknown>);
    const mkdir = vi.fn(async () => {});
    const copyFile = vi.fn(async () => {});
    const access = vi.fn(async () => {});
    await prepareSandbox(plan, { fs: { mkdir, copyFile, access } as never });
    expect(mkdir).toHaveBeenCalledWith(resolve(cwd, 'nested/dir'), { recursive: true });
  });
});

describe('parseComposePsOutput', () => {
  it('parses array JSON', () => {
    const json = JSON.stringify([
      { Service: 'postgres', State: 'running', Status: 'Up 5 seconds' },
      { Service: 'minio-init', State: 'exited', Status: 'Exited (0) 2 seconds ago', ExitCode: 0 },
    ]);
    const res = parseComposePsOutput(json);
    expect(res).toHaveLength(2);
    expect(res[0]).toMatchObject({ service: 'postgres', state: 'running' });
    expect(res[1]).toMatchObject({ service: 'minio-init', state: 'exited', exitCode: 0 });
  });

  it('parses NDJSON lines', () => {
    const ndjson = [
      JSON.stringify({ Service: 'api', State: 'running', Status: 'Up' }),
      JSON.stringify({ Service: 'frontend', State: 'running', Status: 'Up' }),
    ].join('\n');
    const res = parseComposePsOutput(ndjson);
    expect(res).toHaveLength(2);
    expect(res[0].service).toBe('api');
  });

  it('returns empty for empty output', () => {
    expect(parseComposePsOutput('')).toEqual([]);
    expect(parseComposePsOutput('   \n  ')).toEqual([]);
  });

  it('throws actionable error on malformed JSON', () => {
    expect(() => parseComposePsOutput('[not json')).toThrow(/failed to parse compose ps/);
    expect(() => parseComposePsOutput('{"Service": "a", "State":')).toThrow(/failed to parse compose ps output line/);
  });

  it('throws when Service missing', () => {
    const json = JSON.stringify([{ State: 'running', Status: 'Up' }]);
    expect(() => parseComposePsOutput(json)).toThrow(/missing Service/);
  });

  it('extracts exitCode from Status string', () => {
    const json = JSON.stringify([{ Service: 'init', State: 'exited', Status: 'Exited (1) 5 seconds ago' }]);
    const res = parseComposePsOutput(json);
    expect(res[0].exitCode).toBe(1);
  });
});

describe('getServiceState', () => {
  it('returns state for found service via array output', async () => {
    const plan = basePlan();
    const runProcess = vi.fn(async () => ({
      exitCode: 0,
      stdout: JSON.stringify([{ Service: 'myservice', State: 'running', Status: 'Up' }]),
      stderr: '',
      signal: null,
      durationMs: 10,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      truncatedBytes: 0,
    }));
    const state = await getServiceState(plan, 'myservice', { runProcess: runProcess as never });
    expect(state.service).toBe('myservice');
    expect(state.state).toBe('running');
    expect(state.exists).toBe(true);
    expect(runProcess).toHaveBeenCalled();
    const call = runProcess.mock.calls[0][0] as { args: string[] };
    expect(call.args).toContain('ps');
    expect(call.args).toContain('--format');
    expect(call.args).toContain('json');
  });

  it('throws actionable error when service not found', async () => {
    const plan = basePlan();
    const runProcess = vi.fn(async () => ({
      exitCode: 0,
      stdout: JSON.stringify([{ Service: 'other', State: 'running', Status: 'Up' }]),
      stderr: '',
      signal: null,
      durationMs: 10,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      truncatedBytes: 0,
    }));
    await expect(getServiceState(plan, 'missing', { runProcess: runProcess as never })).rejects.toThrow(
      /not found.*available: other/,
    );
  });

  it('throws when compose ps fails exitCode', async () => {
    const plan = basePlan();
    const runProcess = vi.fn(async () => ({
      exitCode: 2,
      stdout: '',
      stderr: 'error',
      signal: null,
      durationMs: 10,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      truncatedBytes: 0,
    }));
    await expect(getServiceState(plan, 'svc', { runProcess: runProcess as never })).rejects.toThrow(
      /docker compose ps failed/,
    );
  });

  it('isolates parsing errors with actionable message', async () => {
    const plan = basePlan();
    const runProcess = vi.fn(async () => ({
      exitCode: 0,
      stdout: 'not-json',
      stderr: '',
      signal: null,
      durationMs: 10,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      truncatedBytes: 0,
    }));
    await expect(getServiceState(plan, 'svc', { runProcess: runProcess as never })).rejects.toThrow(
      /failed to inspect service svc/,
    );
  });

  it('produces never-created guidance when empty output', async () => {
    const plan = basePlan();
    const runProcess = vi.fn(async () => ({
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
    await expect(getServiceState(plan, 'minio-init', { runProcess: runProcess as never })).rejects.toThrow(
      /never been created/,
    );
  });
});

describe('runCompose integration', () => {
  it('passes stable args to runProcess', async () => {
    const plan = resolveComposeSandboxPlan({
      compose: { files: ['a.yml', 'b.yml'], envFile: 'env', projectName: 'proj', profiles: ['x'] },
      test: { executable: 'echo' },
    } as unknown as Record<string, unknown>);
    const runProcess = vi.fn(async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
      signal: null,
      durationMs: 1,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      truncatedBytes: 0,
    }));
    const { runCompose } = await import('../src/compose');
    await runCompose(plan, 'ps', ['-a'], {}, { runProcess: runProcess as never });
    const args = (runProcess.mock.calls[0][0] as { args: string[] }).args;
    expect(args[0]).toBe('compose');
    expect(args).toContain('-f');
    expect(args).toContain('ps');
  });
});
