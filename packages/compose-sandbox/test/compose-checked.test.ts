import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';

import { preflightCompose, getServiceState, startSandbox } from '../src/compose';
import { resolveComposeSandboxPlan } from '../src/plan';
import { runComposeSandbox } from '../src/run';
import type { Clock, SignalTarget } from '../src/lifecycle';
import { EventEmitter } from 'node:events';

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

function fakeResult(
  overrides: Partial<{
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
  }>,
) {
  return {
    exitCode: overrides.exitCode !== undefined ? overrides.exitCode : 0,
    signal: overrides.signal !== undefined ? overrides.signal : null,
    stdout: overrides.stdout ?? '',
    stderr: overrides.stderr ?? '',
    durationMs: 10,
    timedOut: overrides.timedOut ?? false,
    stdoutTruncated: false,
    stderrTruncated: false,
    truncatedBytes: 0,
  };
}

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
  return mkdtemp(join(tmpdir(), 'compose-checked-'));
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

describe('CSREM-03 preflight boundary', () => {
  it('fails on nonzero exitCode', async () => {
    const plan = basePlan();
    const runProcess = vi.fn(async () =>
      fakeResult({ exitCode: 1, stderr: 'fail diag', signal: null, timedOut: false }),
    );
    await expect(preflightCompose(plan, { runProcess: runProcess as never })).rejects.toThrow(/exitCode.*1/i);
    await expect(preflightCompose(plan, { runProcess: runProcess as never })).rejects.toThrow(
      /docker compose.*version/i,
    );
    const err = await preflightCompose(plan, { runProcess: runProcess as never }).catch((e: Error) => e);
    expect(err.message).toMatch(/signal.*null/i);
    expect(err.message).toMatch(/timedOut.*false/i);
  });
  it('fails on signal termination', async () => {
    const plan = basePlan();
    const runProcess = vi.fn(async () =>
      fakeResult({ exitCode: null, signal: 'SIGTERM', timedOut: false, stdout: 'Docker Compose version v2.27.0' }),
    );
    await expect(preflightCompose(plan, { runProcess: runProcess as never })).rejects.toThrow(/signal.*SIGTERM/i);
    await expect(preflightCompose(plan, { runProcess: runProcess as never })).rejects.toThrow(/exitCode.*null/i);
  });
  it('fails on timeout', async () => {
    const plan = basePlan();
    const runProcess = vi.fn(async () => fakeResult({ exitCode: null, signal: null, timedOut: true }));
    await expect(preflightCompose(plan, { runProcess: runProcess as never })).rejects.toThrow(/timedOut.*true/i);
    await expect(preflightCompose(plan, { runProcess: runProcess as never })).rejects.toThrow(
      /docker compose.*version/i,
    );
  });
  it('bounds diagnostics to <=500 chars', async () => {
    const plan = basePlan();
    const big = 'x'.repeat(1000);
    const runProcess = vi.fn(async () => fakeResult({ exitCode: 1, stderr: big, signal: null, timedOut: false }));
    const err = await preflightCompose(plan, { runProcess: runProcess as never }).catch((e: Error) => e);
    expect(err.message.length).toBeLessThan(1200);
    // diagnostics portion bounded
    const diagPart = err.message.split(':').slice(-1)[0] ?? '';
    expect(Buffer.byteLength(diagPart, 'utf8')).toBeLessThanOrEqual(600);
  });
});

describe('CSREM-03 startup boundary', () => {
  it('fails on nonzero exitCode', async () => {
    const plan = basePlan();
    const runProcess = vi.fn(async () => fakeResult({ exitCode: 2, stderr: 'up fail', signal: null, timedOut: false }));
    await expect(startSandbox(plan, { runProcess: runProcess as never })).rejects.toThrow(/exitCode.*2/i);
    await expect(startSandbox(plan, { runProcess: runProcess as never })).rejects.toThrow(/docker compose.*up/i);
  });
  it('fails on signal', async () => {
    const plan = basePlan();
    const runProcess = vi.fn(async () => fakeResult({ exitCode: null, signal: 'SIGKILL', timedOut: false }));
    await expect(startSandbox(plan, { runProcess: runProcess as never })).rejects.toThrow(/signal.*SIGKILL/i);
  });
  it('fails on timeout', async () => {
    const plan = basePlan();
    const runProcess = vi.fn(async () => fakeResult({ exitCode: null, signal: null, timedOut: true }));
    await expect(startSandbox(plan, { runProcess: runProcess as never })).rejects.toThrow(/timedOut.*true/i);
  });
});

describe('CSREM-03 service inspection boundary', () => {
  it('fails on nonzero exitCode', async () => {
    const plan = basePlan();
    const runProcess = vi.fn(async () => fakeResult({ exitCode: 3, stderr: 'ps fail', signal: null, timedOut: false }));
    await expect(getServiceState(plan, 'svc', { runProcess: runProcess as never })).rejects.toThrow(/exitCode.*3/i);
  });
  it('fails on signal', async () => {
    const plan = basePlan();
    const runProcess = vi.fn(async () => fakeResult({ exitCode: null, signal: 'SIGTERM', timedOut: false }));
    await expect(getServiceState(plan, 'svc', { runProcess: runProcess as never })).rejects.toThrow(/signal.*SIGTERM/i);
  });
  it('fails on timeout', async () => {
    const plan = basePlan();
    const runProcess = vi.fn(async () => fakeResult({ exitCode: null, signal: null, timedOut: true }));
    await expect(getServiceState(plan, 'svc', { runProcess: runProcess as never })).rejects.toThrow(/timedOut.*true/i);
  });
});

describe('CSREM-03 evidence and cleanup boundaries via run', () => {
  it('evidence ps nonzero does not write ps.json but preserves logs.txt', async () => {
    const root = await makeTempRoot();
    try {
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const runProcess = vi.fn(async (opts: { args: ReadonlyArray<string> }) => {
        const s = opts.args.join(' ');
        if (s.includes('version')) return fakeResult({ exitCode: 0, stdout: 'Docker Compose version v2.27.0' });
        if (s.includes('up')) return fakeResult({ exitCode: 0 });
        if (s.includes('ps')) return fakeResult({ exitCode: 1, stderr: 'ps fail', signal: null, timedOut: false });
        if (s.includes('logs')) return fakeResult({ exitCode: 0, stdout: 'log ok' });
        if (s.includes('down')) return fakeResult({ exitCode: 0 });
        return fakeResult({ exitCode: 0 });
      });
      const options = baseOptions(root, { evidence: { directory: 'evidence', capture: 'always' } });
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      // ps.json should NOT exist
      await expect(readFile(join(root, 'evidence', 'ps.json'), 'utf8')).rejects.toThrow();
      // logs.txt SHOULD exist
      const logs = await readFile(join(root, 'evidence', 'logs.txt'), 'utf8');
      expect(logs).toContain('log ok');
      const manifest = JSON.parse(await readFile(join(root, 'evidence', 'result.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      const files = manifest.evidenceFiles as string[];
      expect(files).toContain('logs.txt');
      expect(files).not.toContain('ps.json');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('evidence ps signal does not write ps.json but preserves logs.txt', async () => {
    const root = await makeTempRoot();
    try {
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const runProcess = vi.fn(async (opts: { args: ReadonlyArray<string> }) => {
        const s = opts.args.join(' ');
        if (s.includes('version')) return fakeResult({ exitCode: 0, stdout: 'Docker Compose version v2.27.0' });
        if (s.includes('up')) return fakeResult({ exitCode: 0 });
        if (s.includes('ps'))
          return fakeResult({ exitCode: null, signal: 'SIGTERM', timedOut: false, stderr: 'signaled' });
        if (s.includes('logs')) return fakeResult({ exitCode: 0, stdout: 'log ok sig' });
        if (s.includes('down')) return fakeResult({ exitCode: 0 });
        return fakeResult({ exitCode: 0 });
      });
      const options = baseOptions(root, { evidence: { directory: 'evidence', capture: 'always' } });
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(String((thrown as Error).message)).toMatch(/SIGTERM|signal/i);
      await expect(readFile(join(root, 'evidence', 'ps.json'), 'utf8')).rejects.toThrow();
      const logs = await readFile(join(root, 'evidence', 'logs.txt'), 'utf8');
      expect(logs).toContain('log ok sig');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('evidence ps timeout does not write ps.json but preserves logs.txt', async () => {
    const root = await makeTempRoot();
    try {
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const runProcess = vi.fn(async (opts: { args: ReadonlyArray<string> }) => {
        const s = opts.args.join(' ');
        if (s.includes('version')) return fakeResult({ exitCode: 0, stdout: 'Docker Compose version v2.27.0' });
        if (s.includes('up')) return fakeResult({ exitCode: 0 });
        if (s.includes('ps')) return fakeResult({ exitCode: null, signal: null, timedOut: true });
        if (s.includes('logs')) return fakeResult({ exitCode: 0, stdout: 'log ok timeout' });
        if (s.includes('down')) return fakeResult({ exitCode: 0 });
        return fakeResult({ exitCode: 0 });
      });
      const options = baseOptions(root, { evidence: { directory: 'evidence', capture: 'always' } });
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(String((thrown as Error).message)).toMatch(/timedOut/i);
      await expect(readFile(join(root, 'evidence', 'ps.json'), 'utf8')).rejects.toThrow();
      const logs = await readFile(join(root, 'evidence', 'logs.txt'), 'utf8');
      expect(logs).toContain('log ok timeout');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('evidence logs nonzero does not write logs.txt but preserves ps.json', async () => {
    const root = await makeTempRoot();
    try {
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const runProcess = vi.fn(async (opts: { args: ReadonlyArray<string> }) => {
        const s = opts.args.join(' ');
        if (s.includes('version')) return fakeResult({ exitCode: 0, stdout: 'Docker Compose version v2.27.0' });
        if (s.includes('up')) return fakeResult({ exitCode: 0 });
        if (s.includes('ps'))
          return fakeResult({
            exitCode: 0,
            stdout: JSON.stringify([{ Service: 'a', State: 'running', Status: 'Up' }]),
          });
        if (s.includes('logs')) return fakeResult({ exitCode: 5, stderr: 'logs fail', signal: null, timedOut: false });
        if (s.includes('down')) return fakeResult({ exitCode: 0 });
        return fakeResult({ exitCode: 0 });
      });
      const options = baseOptions(root, { evidence: { directory: 'evidence', capture: 'always' } });
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      await expect(readFile(join(root, 'evidence', 'logs.txt'), 'utf8')).rejects.toThrow();
      const ps = await readFile(join(root, 'evidence', 'ps.json'), 'utf8');
      expect(ps).toContain('a');
      const manifest = JSON.parse(await readFile(join(root, 'evidence', 'result.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect(manifest.evidenceFiles as string[]).toContain('ps.json');
      expect(manifest.evidenceFiles as string[]).not.toContain('logs.txt');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('evidence logs signal does not write logs.txt but preserves ps.json', async () => {
    const root = await makeTempRoot();
    try {
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const runProcess = vi.fn(async (opts: { args: ReadonlyArray<string> }) => {
        const s = opts.args.join(' ');
        if (s.includes('version')) return fakeResult({ exitCode: 0, stdout: 'Docker Compose version v2.27.0' });
        if (s.includes('up')) return fakeResult({ exitCode: 0 });
        if (s.includes('ps')) return fakeResult({ exitCode: 0, stdout: 'ps ok' });
        if (s.includes('logs')) return fakeResult({ exitCode: null, signal: 'SIGTERM', timedOut: false });
        if (s.includes('down')) return fakeResult({ exitCode: 0 });
        return fakeResult({ exitCode: 0 });
      });
      const options = baseOptions(root, { evidence: { directory: 'evidence', capture: 'always' } });
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(String((thrown as Error).message)).toMatch(/SIGTERM/i);
      await expect(readFile(join(root, 'evidence', 'logs.txt'), 'utf8')).rejects.toThrow();
      expect(await readFile(join(root, 'evidence', 'ps.json'), 'utf8')).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('evidence logs timeout does not write logs.txt but preserves ps.json', async () => {
    const root = await makeTempRoot();
    try {
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const runProcess = vi.fn(async (opts: { args: ReadonlyArray<string> }) => {
        const s = opts.args.join(' ');
        if (s.includes('version')) return fakeResult({ exitCode: 0, stdout: 'Docker Compose version v2.27.0' });
        if (s.includes('up')) return fakeResult({ exitCode: 0 });
        if (s.includes('ps')) return fakeResult({ exitCode: 0, stdout: 'ps ok timeout' });
        if (s.includes('logs')) return fakeResult({ exitCode: null, signal: null, timedOut: true });
        if (s.includes('down')) return fakeResult({ exitCode: 0 });
        return fakeResult({ exitCode: 0 });
      });
      const options = baseOptions(root, { evidence: { directory: 'evidence', capture: 'always' } });
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(String((thrown as Error).message)).toMatch(/timedOut/i);
      await expect(readFile(join(root, 'evidence', 'logs.txt'), 'utf8')).rejects.toThrow();
      expect(await readFile(join(root, 'evidence', 'ps.json'), 'utf8')).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cleanup down nonzero prevents success manifest and is primary after success', async () => {
    const root = await makeTempRoot();
    try {
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const runProcess = vi.fn(async (opts: { args: ReadonlyArray<string> }) => {
        const s = opts.args.join(' ');
        if (s.includes('version')) return fakeResult({ exitCode: 0, stdout: 'Docker Compose version v2.27.0' });
        if (s.includes('up')) return fakeResult({ exitCode: 0 });
        if (s.includes('ps')) return fakeResult({ exitCode: 0, stdout: 'ps ok' });
        if (s.includes('logs')) return fakeResult({ exitCode: 0, stdout: 'logs ok' });
        if (s.includes('down')) return fakeResult({ exitCode: 1, stderr: 'down fail', signal: null, timedOut: false });
        return fakeResult({ exitCode: 0 });
      });
      const options = baseOptions(root, { evidence: { directory: 'evidence', capture: 'always' } });
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      expect(String((thrown as Error).message)).toMatch(/down fail|exitCode 1/i);
      const manifest = JSON.parse(await readFile(join(root, 'evidence', 'result.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect(manifest.outcome).toBe('failure');
      expect(String((manifest.errors as Record<string, unknown>).primary)).toMatch(/down fail|exitCode 1/i);
      expect(manifest.phase).toBe('cleanup');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cleanup down signal prevents success', async () => {
    const root = await makeTempRoot();
    try {
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const runProcess = vi.fn(async (opts: { args: ReadonlyArray<string> }) => {
        const s = opts.args.join(' ');
        if (s.includes('version')) return fakeResult({ exitCode: 0, stdout: 'Docker Compose version v2.27.0' });
        if (s.includes('up')) return fakeResult({ exitCode: 0 });
        if (s.includes('ps')) return fakeResult({ exitCode: 0, stdout: 'ps ok' });
        if (s.includes('logs')) return fakeResult({ exitCode: 0, stdout: 'logs ok' });
        if (s.includes('down')) return fakeResult({ exitCode: null, signal: 'SIGTERM', timedOut: false });
        return fakeResult({ exitCode: 0 });
      });
      const options = baseOptions(root, {});
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(String((thrown as Error).message)).toMatch(/SIGTERM/i);
      const manifest = JSON.parse(await readFile(join(root, 'evidence', 'result.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect(manifest.outcome).toBe('failure');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cleanup down timeout prevents success', async () => {
    const root = await makeTempRoot();
    try {
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const runProcess = vi.fn(async (opts: { args: ReadonlyArray<string> }) => {
        const s = opts.args.join(' ');
        if (s.includes('version')) return fakeResult({ exitCode: 0, stdout: 'Docker Compose version v2.27.0' });
        if (s.includes('up')) return fakeResult({ exitCode: 0 });
        if (s.includes('ps')) return fakeResult({ exitCode: 0, stdout: 'ps ok' });
        if (s.includes('logs')) return fakeResult({ exitCode: 0, stdout: 'logs ok' });
        if (s.includes('down')) return fakeResult({ exitCode: null, signal: null, timedOut: true });
        return fakeResult({ exitCode: 0 });
      });
      const options = baseOptions(root, {});
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(String((thrown as Error).message)).toMatch(/timedOut/i);
      const manifest = JSON.parse(await readFile(join(root, 'evidence', 'result.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect(manifest.outcome).toBe('failure');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('earlier test failure remains primary when evidence and cleanup also fail', async () => {
    const root = await makeTempRoot();
    try {
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const runProcess = vi.fn(async (opts: { args: ReadonlyArray<string> }) => {
        const s = opts.args.join(' ');
        if (s.includes('version')) return fakeResult({ exitCode: 0, stdout: 'Docker Compose version v2.27.0' });
        if (s.includes('up')) return fakeResult({ exitCode: 0 });
        if (s.includes('ps'))
          return fakeResult({ exitCode: 1, stderr: 'ps fail secondary', signal: null, timedOut: false });
        if (s.includes('logs'))
          return fakeResult({ exitCode: 1, stderr: 'logs fail secondary', signal: null, timedOut: false });
        if (s.includes('down'))
          return fakeResult({ exitCode: 1, stderr: 'down fail secondary', signal: null, timedOut: false });
        // test command failure
        return fakeResult({ exitCode: 7, signal: null, timedOut: false });
      });
      const options = baseOptions(root, { evidence: { directory: 'evidence', capture: 'always' } });
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      const msg = String((thrown as Error).message);
      expect(msg).toMatch(/exitCode 7/i);
      // secondary should be present but primary is test
      const manifest = JSON.parse(await readFile(join(root, 'evidence', 'result.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect(String((manifest.errors as Record<string, unknown>).primary)).toMatch(/exitCode 7/i);
      expect((manifest.errors as Record<string, unknown>).secondary).toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('partial successful evidence retained accurately when one fails', async () => {
    const root = await makeTempRoot();
    try {
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const runProcess = vi.fn(async (opts: { args: ReadonlyArray<string> }) => {
        const s = opts.args.join(' ');
        if (s.includes('version')) return fakeResult({ exitCode: 0, stdout: 'Docker Compose version v2.27.0' });
        if (s.includes('up')) return fakeResult({ exitCode: 0 });
        if (s.includes('ps')) return fakeResult({ exitCode: 0, stdout: 'ps success content' });
        if (s.includes('logs')) return fakeResult({ exitCode: 1, stderr: 'logs fail', signal: null, timedOut: false });
        if (s.includes('down')) return fakeResult({ exitCode: 0 });
        return fakeResult({ exitCode: 0 });
      });
      const options = baseOptions(root, { evidence: { directory: 'evidence', capture: 'always' } });
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      const ps = await readFile(join(root, 'evidence', 'ps.json'), 'utf8');
      expect(ps).toContain('ps success content');
      await expect(readFile(join(root, 'evidence', 'logs.txt'), 'utf8')).rejects.toThrow();
      const manifest = JSON.parse(await readFile(join(root, 'evidence', 'result.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      const files = manifest.evidenceFiles as string[];
      expect(files).toContain('ps.json');
      expect(files).not.toContain('logs.txt');
      expect(files).toContain('result.json');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('never emits success when compose operation fails', async () => {
    const root = await makeTempRoot();
    try {
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const runProcess = vi.fn(async (opts: { args: ReadonlyArray<string> }) => {
        const s = opts.args.join(' ');
        if (s.includes('version')) return fakeResult({ exitCode: 1, stderr: 'version fail' });
        return fakeResult({ exitCode: 0 });
      });
      const options = baseOptions(root, {});
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      const manifest = JSON.parse(await readFile(join(root, 'evidence', 'result.json'), 'utf8')) as Record<
        string,
        unknown
      >;
      expect(manifest.outcome).not.toBe('success');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
