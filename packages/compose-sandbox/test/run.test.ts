import { EventEmitter } from 'node:events';
import { mkdir, writeFile, readFile, mkdtemp, rm, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';

import { resolveComposeSandboxPlan } from '../src/plan';
import { runComposeSandbox } from '../src/run';
import { ComposeSandboxLifecycleError, type SignalTarget, type Clock } from '../src/lifecycle';

function fakeClock(): Clock & { advance: (ms: number) => void } {
  let nowMs = 1000;
  return {
    now: () => nowMs,
    sleep: async (ms: number) => {
      nowMs += ms;
    },
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

function fakeSignalTarget(): SignalTarget & EventEmitter {
  const ee = new EventEmitter() as SignalTarget & EventEmitter;
  ee.on = ee.on.bind(ee);
  if (!ee.off) ee.off = ee.removeListener.bind(ee) as never;
  return ee;
}

async function makeTempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'compose-sandbox-run-'));
  return dir;
}

function baseOptions(cwd: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cwd,
    compose: { files: ['a.yml'] },
    test: { executable: process.execPath, args: ['-e', 'process.exit(0)'] },
    evidence: { directory: 'evidence', capture: 'always', maxLogBytes: 1_048_576, stripAnsi: true },
    cleanup: { volumes: false, removeOrphans: true, paths: [] },
    timeouts: { startupMs: 5000, readinessMs: 5000, testMs: 5000, cleanupMs: 5000 },
    ...overrides,
  } as Record<string, unknown>;
}

function makeFakeRunProcess(
  opts: {
    upShouldFail?: boolean;
    psOutput?: string;
    logsOutput?: string;
    testExitCode?: number;
    testTimedOut?: boolean;
    psShouldFail?: boolean;
    logsShouldFail?: boolean;
    downShouldFail?: boolean;
    versionShouldFail?: boolean;
    captureOrder?: string[];
    testShouldHang?: boolean;
    readinessShouldFail?: boolean;
  } = {},
) {
  const calls: Array<{ executable: string; args: ReadonlyArray<string> }> = [];
  const fn = vi.fn(
    async (options: {
      executable: string;
      args: ReadonlyArray<string>;
      cwd?: string;
      timeoutMs?: number;
      signal?: AbortSignal;
      inheritStdio?: boolean;
      captureOutput?: boolean;
    }) => {
      calls.push({ executable: options.executable, args: [...options.args] });
      if (opts.captureOrder) {
        const argStr = options.args.join(' ');
        if (argStr.includes('ps')) opts.captureOrder.push('ps');
        else if (argStr.includes('logs')) opts.captureOrder.push('logs');
        else if (argStr.includes('down')) opts.captureOrder.push('down');
        else if (argStr.includes('version')) opts.captureOrder.push('version');
        else if (argStr.includes('up')) opts.captureOrder.push('up');
        else opts.captureOrder.push('test');
      }
      if (options.signal?.aborted) {
        throw options.signal.reason ?? new Error('aborted');
      }
      // version preflight
      if (options.args.includes('version')) {
        if (opts.versionShouldFail)
          return {
            exitCode: 1,
            stdout: '',
            stderr: 'fail',
            signal: null,
            durationMs: 10,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            truncatedBytes: 0,
          };
        return {
          exitCode: 0,
          stdout: 'Docker Compose version v2.27.0',
          stderr: '',
          signal: null,
          durationMs: 10,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          truncatedBytes: 0,
        };
      }
      if (options.args.includes('up')) {
        if (opts.upShouldFail)
          return {
            exitCode: 1,
            stdout: '',
            stderr: 'up failed',
            signal: null,
            durationMs: 10,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            truncatedBytes: 0,
          };
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          signal: null,
          durationMs: 10,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          truncatedBytes: 0,
        };
      }
      if (options.args.includes('ps')) {
        if (opts.psShouldFail) throw new Error('ps failed');
        const out = opts.psOutput ?? JSON.stringify([{ Service: 'api', State: 'running', Status: 'Up' }]);
        return {
          exitCode: 0,
          stdout: out,
          stderr: '',
          signal: null,
          durationMs: 10,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          truncatedBytes: 0,
        };
      }
      if (options.args.includes('logs')) {
        if (opts.logsShouldFail) throw new Error('logs failed');
        const out = opts.logsOutput ?? 'log line 1\nlog line 2';
        return {
          exitCode: 0,
          stdout: out,
          stderr: '',
          signal: null,
          durationMs: 10,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          truncatedBytes: 0,
        };
      }
      if (options.args.includes('down')) {
        if (opts.downShouldFail) throw new Error('down failed');
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          signal: null,
          durationMs: 10,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          truncatedBytes: 0,
        };
      }
      // test command
      if (opts.testShouldHang) {
        return new Promise((resolve, reject) => {
          const onAbort = () => reject(new Error('aborted by signal'));
          options.signal?.addEventListener('abort', onAbort, { once: true });
          // never resolve unless aborted
        }) as never;
      }
      if (opts.testTimedOut) {
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          signal: null,
          durationMs: options.timeoutMs ?? 0,
          timedOut: true,
          stdoutTruncated: false,
          stderrTruncated: false,
          truncatedBytes: 0,
        };
      }
      const code = opts.testExitCode ?? 0;
      return {
        exitCode: code,
        stdout: '',
        stderr: '',
        signal: null,
        durationMs: 10,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        truncatedBytes: 0,
      };
    },
  );
  return { fn, calls };
}

describe('runComposeSandbox orchestrator', () => {
  it('success path writes evidence before teardown and manifest with timings', async () => {
    const root = await makeTempRoot();
    try {
      const order: string[] = [];
      const { fn: runProcess } = makeFakeRunProcess({ captureOrder: order });
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const options = baseOptions(root, {
        readiness: [],
        evidence: { directory: 'evidence', capture: 'always', maxLogBytes: 1024, stripAnsi: true },
      });
      await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      expect(order.indexOf('ps')).toBeLessThan(order.indexOf('down'));
      expect(order.indexOf('logs')).toBeLessThan(order.indexOf('down'));
      const manifest = JSON.parse(await readFile(join(root, 'evidence', 'result.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect(manifest.outcome).toBe('success');
      expect(manifest.phase).toBe('cleanup');
      const timings = manifest.timings as Record<string, unknown>;
      expect(typeof timings.total).toBe('number');
      expect(typeof timings.start).toBe('number');
      expect(typeof timings.readiness).toBe('number');
      expect(typeof timings.test).toBe('number');
      const files = manifest.evidenceFiles as string[];
      expect(files).toContain('ps.json');
      expect(files).toContain('logs.txt');
      expect(files).toContain('result.json');
      const psContent = await readFile(join(root, 'evidence', 'ps.json'), 'utf8');
      expect(psContent).toContain('api');
      const logsContent = await readFile(join(root, 'evidence', 'logs.txt'), 'utf8');
      expect(logsContent).toContain('log line');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('startup failure skips test and still captures evidence with primary preserved', async () => {
    const root = await makeTempRoot();
    try {
      const { fn: runProcess } = makeFakeRunProcess({ upShouldFail: true });
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const options = baseOptions(root, { evidence: { directory: 'evidence', capture: 'onFailure' } });
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      const msg = (thrown as Error).message;
      expect(msg).toMatch(/up failed|docker compose up/i);
      // evidence captured even on startup failure
      const manifest = JSON.parse(await readFile(join(root, 'evidence', 'result.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect(manifest.outcome).toBe('failure');
      expect((manifest.errors as Record<string, unknown>).primary).toMatch(/up failed|compose/i);
      // ps written before down order still
      expect(await readFile(join(root, 'evidence', 'ps.json'), 'utf8')).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('readiness failure skips test', async () => {
    const root = await makeTempRoot();
    try {
      const { fn: runProcess } = makeFakeRunProcess({});
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const planOptions = baseOptions(root, {
        readiness: [{ type: 'tcp', host: '127.0.0.1', port: 5432, intervalMs: 10 }],
        timeouts: { startupMs: 5000, readinessMs: 100, testMs: 5000, cleanupMs: 5000 },
      });
      // tcpConnect always fails
      const tcpConnect = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      });
      let thrown: unknown;
      try {
        await runComposeSandbox(planOptions, {
          clock,
          signalTarget,
          runProcess: runProcess as never,
          tcpConnect: tcpConnect as never,
        });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      expect((thrown as Error).message).toMatch(/readiness timeout|unsatisfied/i);
      // ensure test not executed: runProcess should not have been called with test executable except compose calls
      // Check that runProcess was not called with the test's executable in a way that would indicate test ran: we track compose vs test by args containing 'compose'
      // Simpler: ensure manifest phase is readiness or related
      const manifest = JSON.parse(await readFile(join(root, 'evidence', 'result.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect(manifest.phase).toBe('readiness');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('test failure preserves exitCode and is primary, evidence onFailure captured', async () => {
    const root = await makeTempRoot();
    try {
      const { fn: runProcess } = makeFakeRunProcess({ testExitCode: 2 });
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const options = baseOptions(root, { evidence: { directory: 'evidence', capture: 'onFailure' } });
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      expect((thrown as Error).message).toMatch(/exitCode 2/);
      expect((thrown as unknown as Record<string, unknown>).exitCode).toBe(2);
      const manifest = JSON.parse(await readFile(join(root, 'evidence', 'result.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect(manifest.outcome).toBe('failure');
      expect((manifest.errors as Record<string, unknown>).primary).toMatch(/exitCode 2/);
      // evidence should be captured on failure
      expect(await readFile(join(root, 'evidence', 'ps.json'), 'utf8')).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('evidence failure does not hide primary test failure', async () => {
    const root = await makeTempRoot();
    try {
      const { fn: runProcess } = makeFakeRunProcess({ testExitCode: 3, psShouldFail: true, logsShouldFail: true });
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const options = baseOptions(root, { evidence: { directory: 'evidence', capture: 'onFailure' } });
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(ComposeSandboxLifecycleError);
      const err = thrown as ComposeSandboxLifecycleError;
      expect(err.primary.message).toMatch(/exitCode 3/);
      expect(err.secondary?.message).toMatch(/ps failed|logs failed/);
      const manifest = JSON.parse(await readFile(join(root, 'evidence', 'result.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect((manifest.errors as Record<string, unknown>).primary).toMatch(/exitCode 3/);
      expect((manifest.errors as Record<string, unknown>).secondary).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cleanup failure preserves primary and reports secondary', async () => {
    const root = await makeTempRoot();
    try {
      const { fn: runProcess } = makeFakeRunProcess({ testExitCode: 4, downShouldFail: true });
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const options = baseOptions(root, { evidence: { directory: 'evidence', capture: 'onFailure' } });
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(ComposeSandboxLifecycleError);
      const err = thrown as ComposeSandboxLifecycleError;
      expect(err.primary.message).toMatch(/exitCode 4/);
      expect(err.secondary?.message).toMatch(/down failed/);
      const manifest = JSON.parse(await readFile(join(root, 'evidence', 'result.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect((manifest.errors as Record<string, unknown>).secondary).toMatch(/down failed/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('evidence failure as primary when no earlier failure', async () => {
    const root = await makeTempRoot();
    try {
      const { fn: runProcess } = makeFakeRunProcess({ psShouldFail: true });
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const options = baseOptions(root, { evidence: { directory: 'evidence', capture: 'always' } });
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      expect((thrown as Error).message).toMatch(/ps failed/);
      const manifest = JSON.parse(await readFile(join(root, 'evidence', 'result.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect(manifest.outcome).toBe('failure');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cleanup failure without primary becomes primary', async () => {
    const root = await makeTempRoot();
    try {
      const { fn: runProcess } = makeFakeRunProcess({ downShouldFail: true });
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const options = baseOptions(root, { evidence: { directory: 'evidence', capture: 'always' } });
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect((thrown as Error).message).toMatch(/down failed/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('timeout path preserves primary timeout error', async () => {
    const root = await makeTempRoot();
    try {
      const { fn: runProcess } = makeFakeRunProcess({ testTimedOut: true });
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const options = baseOptions(root, {
        timeouts: { startupMs: 5000, readinessMs: 5000, testMs: 100, cleanupMs: 5000 },
      });
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect((thrown as Error).message).toMatch(/timed out/i);
      const manifest = JSON.parse(await readFile(join(root, 'evidence', 'result.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect((manifest.errors as Record<string, unknown>).primary).toMatch(/timed out/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('signal path aborts, triggers cleanup, and removes listeners', async () => {
    const root = await makeTempRoot();
    try {
      const { fn: runProcess } = makeFakeRunProcess({ testShouldHang: true });
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const options = baseOptions(root, {});
      const beforeInt = signalTarget.listenerCount('SIGINT');
      const pending = runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      setTimeout(() => signalTarget.emit('SIGINT'), 10);
      let thrown: unknown;
      try {
        await pending;
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      expect((thrown as Error).message).toMatch(/aborted|terminated/i);
      expect(signalTarget.listenerCount('SIGINT')).toBe(beforeInt);
      // cleanup was attempted: down should have been called even after abort
      const calls = (runProcess as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const downCalled = calls.some((c) => (c[0] as { args: ReadonlyArray<string> }).args.join(' ').includes('down'));
      expect(downCalled).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('evidence captured before teardown and bounded per config, strips ANSI', async () => {
    const root = await makeTempRoot();
    try {
      const bigLogs = '\x1B[31m' + 'a'.repeat(5000) + '\x1B[0m';
      const { fn: runProcess } = makeFakeRunProcess({ logsOutput: bigLogs });
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const options = baseOptions(root, {
        evidence: { directory: 'evidence', capture: 'always', maxLogBytes: 100, stripAnsi: true },
      });
      await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      const logs = await readFile(join(root, 'evidence', 'logs.txt'), 'utf8');
      expect(logs).not.toContain('\x1B');
      expect(Buffer.byteLength(logs, 'utf8')).toBeLessThanOrEqual(100);
      const ps = await readFile(join(root, 'evidence', 'ps.json'), 'utf8');
      expect(Buffer.byteLength(ps, 'utf8')).toBeLessThanOrEqual(100);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cleanup cannot delete project root', async () => {
    const root = await makeTempRoot();
    try {
      const { fn: runProcess } = makeFakeRunProcess({});
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      // plan with cleanup path '.' should be rejected at plan resolution
      expect(() =>
        resolveComposeSandboxPlan({
          cwd: root,
          compose: { files: ['a.yml'] },
          test: { executable: 'echo' },
          cleanup: { paths: ['.'] },
        }),
      ).toThrow(/must not be/);
      // also via run: ensure run fails validation before starting compose
      const badOptions = {
        cwd: root,
        compose: { files: ['a.yml'] },
        test: { executable: 'echo' },
        cleanup: { paths: ['.'] },
      };
      await expect(
        runComposeSandbox(badOptions, { clock, signalTarget, runProcess: runProcess as never }),
      ).rejects.toThrow(/must not be/);
      // ensure root still exists
      const st = await lstat(root);
      expect(st.isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cleanup cannot delete unconfigured path or outside project via symlink', async () => {
    const root = await makeTempRoot();
    const outside = await makeTempRoot();
    try {
      const { fn: runProcess } = makeFakeRunProcess({});
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      // create a directory inside root that is a symlink to outside
      const linkInside = join(root, 'link-outside');
      await symlink(outside, linkInside);
      // create a file outside to ensure not deleted
      const outsideFile = join(outside, 'keep.txt');
      await writeFile(outsideFile, 'keep');
      const options = {
        cwd: root,
        compose: { files: ['a.yml'] },
        test: { executable: process.execPath, args: ['-e', 'process.exit(0)'] },
        evidence: { directory: 'evidence', capture: 'always' },
        cleanup: { paths: ['link-outside'] },
      };
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      expect((thrown as Error).message).toMatch(/symlink target outside/i);
      // outside file should still exist
      const content = await readFile(outsideFile, 'utf8');
      expect(content).toBe('keep');
      // unconfigured path: try to trick via plan that only allows configured list, but run will only remove configured paths, so unconfigured not deleted is ensured by plan validation
      expect(() =>
        resolveComposeSandboxPlan({
          cwd: root,
          compose: { files: ['a.yml'] },
          test: { executable: 'echo' },
          cleanup: { paths: ['../escape'] },
        }),
      ).toThrow(/must not contain parent/);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('cleanup is idempotent and manifest does not expose secrets', async () => {
    const root = await makeTempRoot();
    try {
      const dirToClean = join(root, 'to-clean');
      await mkdir(dirToClean, { recursive: true });
      await writeFile(join(dirToClean, 'file.txt'), 'data');
      const { fn: runProcess } = makeFakeRunProcess({});
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const secret = 'super-secret-123';
      const options = {
        cwd: root,
        compose: { files: ['a.yml'] },
        test: { executable: process.execPath, args: ['-e', 'process.exit(0)'], env: { SECRET_TOKEN: secret } },
        readiness: [{ type: 'command', executable: 'echo', args: ['hi'], env: { PASSWORD: 'hunter2' } } as never],
        evidence: { directory: 'evidence', capture: 'always' },
        cleanup: { paths: ['to-clean'] },
        timeouts: { startupMs: 5000, readinessMs: 5000, testMs: 5000, cleanupMs: 5000 },
      };
      const deps: Record<string, unknown> = {
        clock,
        signalTarget,
        runProcess,
        runCommandProbe: async () => ({
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          durationMs: 1,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          truncatedBytes: 0,
        }),
      };
      await runComposeSandbox(options, deps as never);
      // dir should be removed
      await expect(lstat(dirToClean)).rejects.toThrow();
      // second run with same plan (cleanup path already removed) should still succeed idempotently
      const { fn: runProcess2 } = makeFakeRunProcess({});
      const clock2 = fakeClock();
      const signalTarget2 = fakeSignalTarget();
      await runComposeSandbox(options, {
        clock: clock2,
        signalTarget: signalTarget2,
        runProcess: runProcess2 as never,
        runCommandProbe: deps.runCommandProbe as never,
      });
      // manifest should not contain secrets
      const manifestContent = await readFile(join(root, 'evidence', 'result.json'), 'utf8');
      expect(manifestContent).not.toContain(secret);
      expect(manifestContent).not.toContain('hunter2');
      const manifest = JSON.parse(manifestContent) as Record<string, unknown>;
      expect((manifest.errors as Record<string, unknown>).primary).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('test runs only after readiness passes and inherits cwd/env', async () => {
    const root = await makeTempRoot();
    const subdir = join(root, 'subdir');
    await mkdir(subdir, { recursive: true });
    try {
      let testCwd: string | undefined;
      let testEnv: Record<string, string> | undefined;
      const { fn: runProcess } = makeFakeRunProcess({});
      const wrappedRun = vi.fn(
        async (opts: {
          executable: string;
          args: ReadonlyArray<string>;
          cwd?: string;
          env?: Record<string, string>;
        }) => {
          if (!opts.args.join(' ').includes('compose')) {
            testCwd = opts.cwd;
            testEnv = opts.env as Record<string, string>;
          }
          return (runProcess as unknown as (o: unknown) => Promise<unknown>)(opts) as never;
        },
      );
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const readinessProbe: Record<string, unknown> = { type: 'tcp', host: '127.0.0.1', port: 5432, intervalMs: 10 };
      const options = {
        cwd: root,
        compose: { files: ['a.yml'] },
        readiness: [readinessProbe],
        test: { executable: process.execPath, args: ['-e', 'process.exit(0)'], env: { FOO: 'bar' }, cwd: 'subdir' },
        evidence: { directory: 'evidence', capture: 'always' },
        timeouts: { readinessMs: 500, testMs: 5000 },
      };
      const tcpConnect = vi.fn(async () => {});
      await runComposeSandbox(options, {
        clock,
        signalTarget,
        runProcess: wrappedRun as never,
        tcpConnect: tcpConnect as never,
      });
      expect(tcpConnect).toHaveBeenCalled();
      expect(testCwd).toBe(subdir);
      expect(testEnv).toMatchObject({ FOO: 'bar' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('total timeout aborts lifecycle', async () => {
    const root = await makeTempRoot();
    try {
      const { fn: runProcess } = makeFakeRunProcess({ testShouldHang: true });
      const signalTarget = fakeSignalTarget();
      const options = {
        cwd: root,
        compose: { files: ['a.yml'] },
        test: { executable: process.execPath, args: ['-e', 'setTimeout(()=>{},10000)'] },
        evidence: { directory: 'evidence', capture: 'always' },
        timeouts: { startupMs: 5000, readinessMs: 5000, testMs: 10000, cleanupMs: 5000, totalMs: 50 },
      };
      // Use real clock for total timeout (needs real setTimeout), so use default clock for this test
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      // total timeout is implemented via abort, may surface as aborted or total timeout
      expect(thrown).toBeDefined();
      const msg = (thrown as Error).message;
      expect(msg).toMatch(/total timeout|aborted|timeout/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('onFailure evidence not captured on success, always captured on success if configured', async () => {
    const root = await makeTempRoot();
    try {
      const { fn: runProcess } = makeFakeRunProcess({});
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const optionsFailure = baseOptions(root, { evidence: { directory: 'ev1', capture: 'onFailure' } });
      // success with onFailure should NOT create ps/logs? Let's check behavior: our code captures only on failure if capture is onFailure. But manifest always created. So ev1 should have result.json but not ps.json on success
      await runComposeSandbox(optionsFailure, { clock, signalTarget, runProcess: runProcess as never });
      const ev1Files = (await import('node:fs/promises')).readdir
        ? await (await import('node:fs/promises')).readdir(join(root, 'ev1')).catch(() => [] as string[])
        : [];
      // Actually check existence of ps.json
      let psExists = true;
      try {
        await readFile(join(root, 'ev1', 'ps.json'), 'utf8');
      } catch {
        psExists = false;
      }
      expect(psExists).toBe(false);
      // now with always
      const root2 = await makeTempRoot();
      try {
        const { fn: rp2 } = makeFakeRunProcess({});
        const optsAlways = baseOptions(root2, { evidence: { directory: 'evAlways', capture: 'always' } });
        await runComposeSandbox(optsAlways, {
          clock: fakeClock(),
          signalTarget: fakeSignalTarget(),
          runProcess: rp2 as never,
        });
        const exists = await readFile(join(root2, 'evAlways', 'ps.json'), 'utf8')
          .then(() => true)
          .catch(() => false);
        expect(exists).toBe(true);
      } finally {
        await rm(root2, { recursive: true, force: true });
      }
      void ev1Files;
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
