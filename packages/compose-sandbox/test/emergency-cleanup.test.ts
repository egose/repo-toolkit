import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { describe, it, expect, vi } from 'vitest';

import {
  runLifecycle,
  ComposeSandboxLifecycleError,
  type Clock,
  type SignalTarget,
  type LifecycleHandlers,
} from '../src/lifecycle';
import { runComposeSandbox } from '../src/run';

function fakeClock(): Clock & { advance: (ms: number) => void } {
  let nowMs = 1000;
  return {
    now: () => nowMs,
    sleep: async (ms: number) => {
      nowMs += ms;
    },
    setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
    clearTimeout: (h: unknown) => clearTimeout(h as NodeJS.Timeout),
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

function fakeClockScheduler(): Clock & {
  advance: (ms: number) => void;
  timerCount: () => number;
} {
  let now = 1000;
  const timers = new Map<number, { cb: () => void; due: number }>();
  let nextId = 1;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    setTimeout: (cb: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { cb, due: now + ms });
      return id;
    },
    clearTimeout: (h: unknown) => {
      timers.delete(h as number);
    },
    advance: (ms: number) => {
      now += ms;
      const ready = [...timers.entries()].filter(([, t]) => t.due <= now);
      for (const [id, t] of ready) {
        timers.delete(id);
        t.cb();
      }
    },
    timerCount: () => timers.size,
  };
}

function fakeSignalTarget(): SignalTarget & EventEmitter {
  const ee = new EventEmitter() as SignalTarget & EventEmitter;
  ee.on = ee.on.bind(ee) as never;
  if (!ee.off) ee.off = ee.removeListener.bind(ee) as never;
  return ee;
}

async function makeTempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'compose-sandbox-emergency-'));
  return dir;
}

describe('emergency evidence/cleanup fresh contexts', () => {
  it('fake runner rejecting pre-aborted proves evidence/down receive live signals after SIGINT', async () => {
    const clock = fakeClock();
    const signalTarget = fakeSignalTarget();
    let evidenceAborted: boolean | undefined;
    let cleanupAborted: boolean | undefined;
    const handlers: LifecycleHandlers = {
      start: async (signal) => {
        await new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true });
          setTimeout(() => signalTarget.emit('SIGINT'), 10);
        });
      },
      evidence: async (_outcome, signal) => {
        if (signal.aborted) throw new Error('evidence signal pre-aborted');
        evidenceAborted = signal.aborted;
      },
      cleanup: async (signal) => {
        if (signal.aborted) throw new Error('cleanup signal pre-aborted');
        cleanupAborted = signal.aborted;
      },
    };
    await expect(runLifecycle(handlers, { clock, signalTarget })).rejects.toThrow(/terminated by SIGINT/i);
    expect(evidenceAborted).toBe(false);
    expect(cleanupAborted).toBe(false);
  });

  it('fake runner rejecting pre-aborted proves evidence/down receive live signals after SIGTERM', async () => {
    const clock = fakeClock();
    const signalTarget = fakeSignalTarget();
    let evidenceAborted: boolean | undefined;
    let cleanupAborted: boolean | undefined;
    const handlers: LifecycleHandlers = {
      start: async (signal) => {
        await new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true });
          setTimeout(() => signalTarget.emit('SIGTERM'), 10);
        });
      },
      evidence: async (_outcome, signal) => {
        if (signal.aborted) throw new Error('evidence pre-aborted');
        evidenceAborted = signal.aborted;
      },
      cleanup: async (signal) => {
        if (signal.aborted) throw new Error('down pre-aborted');
        cleanupAborted = signal.aborted;
      },
    };
    await expect(runLifecycle(handlers, { clock, signalTarget })).rejects.toThrow(/terminated by SIGTERM/i);
    expect(evidenceAborted).toBe(false);
    expect(cleanupAborted).toBe(false);
  });

  it('fake runner rejecting pre-aborted proves evidence/down receive live signals after total timeout', async () => {
    const clock = fakeClock();
    const signalTarget = fakeSignalTarget();
    let evidenceAborted: boolean | undefined;
    let cleanupAborted: boolean | undefined;
    const handlers: LifecycleHandlers = {
      test: async (signal) => {
        await new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true });
        });
      },
      evidence: async (_outcome, signal) => {
        if (signal.aborted) throw new Error('evidence pre-aborted after timeout');
        evidenceAborted = signal.aborted;
      },
      cleanup: async (signal) => {
        if (signal.aborted) throw new Error('cleanup pre-aborted after timeout');
        cleanupAborted = signal.aborted;
      },
    };
    const pending = runLifecycle(handlers, { clock, signalTarget, totalMs: 50, cleanupMs: 200, evidenceMs: 200 });
    await expect(pending).rejects.toThrow(/total timeout|terminated/i);
    expect(evidenceAborted).toBe(false);
    expect(cleanupAborted).toBe(false);
  });

  it('emergency cleanup completes within cleanupMs; hung down terminated and reported secondary', async () => {
    const clock: Clock = {
      now: () => Date.now(),
      sleep: async (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
      clearTimeout: (h: unknown) => clearTimeout(h as NodeJS.Timeout),
    };
    const signalTarget = fakeSignalTarget();
    let cleanupSignal: AbortSignal | undefined;
    const handlers: LifecycleHandlers = {
      test: async () => {
        throw new Error('primary failure');
      },
      cleanup: async (signal) => {
        cleanupSignal = signal;
        await new Promise<void>((_, reject) => {
          const onAbort = (): void => {
            reject(new Error('cleanup aborted by emergency timeout'));
          };
          signal.addEventListener('abort', onAbort, { once: true });
        });
      },
    };
    const start = Date.now();
    try {
      await runLifecycle(handlers, { clock, signalTarget, cleanupMs: 40 });
      expect.fail('should throw');
    } catch (err) {
      const e = err as ComposeSandboxLifecycleError;
      expect(e.primary.message).toBe('primary failure');
      expect(e.secondary?.message).toMatch(/emergency timeout|aborted/i);
      expect(cleanupSignal?.aborted).toBe(true);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(30);
      expect(elapsed).toBeLessThan(40 + 250);
    }
  });

  it('preflight cannot exceed budget beyond small tolerance', async () => {
    const clock: Clock = {
      now: () => Date.now(),
      sleep: async (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
      clearTimeout: (h: unknown) => clearTimeout(h as NodeJS.Timeout),
    };
    const signalTarget = fakeSignalTarget();
    const budget = 60;
    const start = Date.now();
    const handlers: LifecycleHandlers = {
      preflight: async (signal) => {
        await new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      },
    };
    await expect(runLifecycle(handlers, { clock, signalTarget, preflightMs: budget, cleanupMs: 1000 })).rejects.toThrow(
      /preflight timeout/i,
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(budget - 20);
    expect(elapsed).toBeLessThan(budget + 200);
  });

  it('evidence cannot exceed budget beyond small tolerance', async () => {
    const clock: Clock = {
      now: () => Date.now(),
      sleep: async (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
      clearTimeout: (h: unknown) => clearTimeout(h as NodeJS.Timeout),
    };
    const signalTarget = fakeSignalTarget();
    const budget = 60;
    const handlers: LifecycleHandlers = {
      test: async () => {
        throw new Error('primary');
      },
      evidence: async (_o, signal) => {
        await new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('evidence aborted')), { once: true });
        });
      },
      cleanup: async () => {},
    };
    const start = Date.now();
    try {
      await runLifecycle(handlers, { clock, signalTarget, evidenceMs: budget, cleanupMs: 1000 });
      expect.fail('should throw');
    } catch (err) {
      const e = err as ComposeSandboxLifecycleError;
      expect(e.primary.message).toBe('primary');
      expect(e.secondary?.message).toMatch(/emergency timeout|aborted/i);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(budget - 20);
      expect(elapsed).toBeLessThan(budget + 300);
    }
  });

  it('no listener/timer leaks after repeated invocation', async () => {
    const clock = fakeClockScheduler();
    const signalTarget = fakeSignalTarget();
    for (let i = 0; i < 5; i += 1) {
      await runLifecycle({ start: async () => {}, cleanup: async () => {} }, { clock, signalTarget });
      expect(signalTarget.listenerCount('SIGINT')).toBe(0);
      expect(signalTarget.listenerCount('SIGTERM')).toBe(0);
      expect(clock.timerCount()).toBe(0);
    }
    // failure path also leaks nothing
    for (let i = 0; i < 3; i += 1) {
      try {
        await runLifecycle(
          {
            test: async () => {
              throw new Error('fail');
            },
            cleanup: async () => {},
          },
          { clock, signalTarget, cleanupMs: 10 },
        );
      } catch (_unused) {
        void _unused;
      }
      expect(signalTarget.listenerCount('SIGINT')).toBe(0);
      expect(clock.timerCount()).toBe(0);
    }
  });

  it('distinguishes SIGINT vs SIGTERM in diagnostics', async () => {
    const clock = fakeClock();
    const intTarget = fakeSignalTarget();
    const termTarget = fakeSignalTarget();
    const makeHandlers = (): LifecycleHandlers => ({
      test: async (signal) => {
        await new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true });
        });
      },
    });
    const intPending = runLifecycle(makeHandlers(), { clock, signalTarget: intTarget });
    setTimeout(() => intTarget.emit('SIGINT'), 10);
    await expect(intPending).rejects.toThrow(/SIGINT/);
    const termPending = runLifecycle(makeHandlers(), { clock, signalTarget: termTarget });
    setTimeout(() => termTarget.emit('SIGTERM'), 10);
    await expect(termPending).rejects.toThrow(/SIGTERM/);
  });

  it('routes timers through injectable scheduler not global setTimeout', async () => {
    const clock = fakeClockScheduler();
    let globalSetTimeoutCalled = false;
    const origSetTimeout = globalThis.setTimeout;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).setTimeout = ((..._args: unknown[]) => {
      globalSetTimeoutCalled = true;
      return origSetTimeout(...(_args as [() => void, number]));
    }) as never;
    try {
      const signalTarget = fakeSignalTarget();
      const handlers: LifecycleHandlers = {
        test: async (signal) => {
          await new Promise<void>((_, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true });
          });
        },
        evidence: async () => {},
        cleanup: async () => {},
      };
      const pending = runLifecycle(handlers, { clock, signalTarget, totalMs: 50, cleanupMs: 50, evidenceMs: 50 });
      await Promise.resolve();
      expect(globalSetTimeoutCalled).toBe(false);
      expect(clock.timerCount()).toBeGreaterThan(0);
      clock.advance(60);
      await expect(pending).rejects.toThrow();
    } finally {
      globalThis.setTimeout = origSetTimeout;
    }
  });

  it('second termination request aborts emergency context', async () => {
    const clock = fakeClock();
    const signalTarget = fakeSignalTarget();
    let evidenceAbortedSecond = false;
    const handlers: LifecycleHandlers = {
      test: async (signal) => {
        await new Promise<void>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('first abort')), { once: true });
          setTimeout(() => signalTarget.emit('SIGINT'), 10);
        });
      },
      evidence: async (_o, signal) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => resolve(), 500);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              evidenceAbortedSecond = true;
              reject(new Error('evidence aborted by second signal'));
            },
            { once: true },
          );
          // second signal after 20ms
          setTimeout(() => signalTarget.emit('SIGTERM'), 20);
        });
      },
      cleanup: async () => {},
    };
    try {
      await runLifecycle(handlers, { clock, signalTarget, evidenceMs: 500, cleanupMs: 500 });
      expect.fail('should throw');
    } catch (err) {
      expect(evidenceAbortedSecond).toBe(true);
      const e = err as Error;
      expect(e.message).toMatch(/first abort|terminated/i);
    }
  });
});

describe('runComposeSandbox emergency integration', () => {
  it('run-level SIGINT preserves primary and still runs down with live signal', async () => {
    const root = await makeTempRoot();
    try {
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget();
      const evidenceSignals: boolean[] = [];
      const cleanupSignals: boolean[] = [];
      const fakeRun = vi.fn(async (opts: { args: ReadonlyArray<string>; signal?: AbortSignal }) => {
        if (opts.signal?.aborted) throw opts.signal.reason ?? new Error('pre-aborted');
        if (opts.args.join(' ').includes('ps') || opts.args.join(' ').includes('logs')) {
          evidenceSignals.push(opts.signal ? !opts.signal.aborted : true);
        }
        if (opts.args.join(' ').includes('down')) {
          cleanupSignals.push(opts.signal ? !opts.signal.aborted : true);
        }
        if (opts.args.includes('version'))
          return {
            exitCode: 0,
            stdout: 'Docker Compose version v2.27.0',
            stderr: '',
            signal: null,
            durationMs: 5,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            truncatedBytes: 0,
          };
        if (opts.args.includes('up'))
          return {
            exitCode: 0,
            stdout: '',
            stderr: '',
            signal: null,
            durationMs: 5,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            truncatedBytes: 0,
          };
        if (opts.args.includes('ps'))
          return {
            exitCode: 0,
            stdout: '[]',
            stderr: '',
            signal: null,
            durationMs: 5,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            truncatedBytes: 0,
          };
        if (opts.args.includes('logs'))
          return {
            exitCode: 0,
            stdout: 'logs',
            stderr: '',
            signal: null,
            durationMs: 5,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            truncatedBytes: 0,
          };
        if (opts.args.includes('down'))
          return {
            exitCode: 0,
            stdout: '',
            stderr: '',
            signal: null,
            durationMs: 5,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            truncatedBytes: 0,
          };
        // test hangs
        return new Promise((_, reject) => {
          opts.signal?.addEventListener('abort', () => reject(opts.signal?.reason ?? new Error('test aborted')), {
            once: true,
          });
        }) as never;
      });
      const options = {
        cwd: root,
        compose: { files: ['a.yml'] },
        test: { executable: process.execPath, args: ['-e', 'setTimeout(()=>{},10000)'] },
        evidence: { directory: 'evidence', capture: 'always' },
        timeouts: { startupMs: 5000, readinessMs: 5000, testMs: 5000, cleanupMs: 5000 },
      };
      const pending = runComposeSandbox(options, { clock, signalTarget, runProcess: fakeRun as never });
      setTimeout(() => signalTarget.emit('SIGINT'), 10);
      let thrown: unknown;
      try {
        await pending;
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      expect((thrown as Error).message).toMatch(/SIGINT/);
      expect(evidenceSignals.length).toBeGreaterThan(0);
      expect(evidenceSignals.every(Boolean)).toBe(true);
      expect(cleanupSignals.length).toBeGreaterThan(0);
      expect(cleanupSignals.every(Boolean)).toBe(true);
      expect(signalTarget.listenerCount('SIGINT')).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('hung down terminated within cleanupMs and reported secondary', async () => {
    const root = await makeTempRoot();
    try {
      const clock: Clock & { setTimeout: (cb: () => void, ms: number) => unknown; clearTimeout: (h: unknown) => void } =
        {
          now: () => Date.now(),
          sleep: async (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
          setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
          clearTimeout: (h: unknown) => clearTimeout(h as NodeJS.Timeout),
        };
      const signalTarget = fakeSignalTarget();
      const start = Date.now();
      const fakeRun = vi.fn(async (opts: { args: ReadonlyArray<string>; signal?: AbortSignal; timeoutMs?: number }) => {
        if (opts.args.includes('version'))
          return {
            exitCode: 0,
            stdout: 'Docker Compose version v2.27.0',
            stderr: '',
            signal: null,
            durationMs: 5,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            truncatedBytes: 0,
          };
        if (opts.args.includes('up'))
          return {
            exitCode: 0,
            stdout: '',
            stderr: '',
            signal: null,
            durationMs: 5,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            truncatedBytes: 0,
          };
        if (opts.args.includes('ps') || opts.args.includes('logs'))
          return {
            exitCode: 0,
            stdout: '[]',
            stderr: '',
            signal: null,
            durationMs: 5,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            truncatedBytes: 0,
          };
        if (opts.args.includes('down')) {
          // hang until abort or timeout
          return new Promise((_, reject) => {
            const onAbort = (): void => reject(new Error('down aborted'));
            opts.signal?.addEventListener('abort', onAbort, { once: true });
            if (opts.timeoutMs !== undefined) {
              setTimeout(() => reject(new Error('down timeout')), opts.timeoutMs + 10);
            }
          }) as never;
        }
        // test fails immediately to become primary
        return {
          exitCode: 1,
          stdout: '',
          stderr: '',
          signal: null,
          durationMs: 5,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          truncatedBytes: 0,
        };
      });
      // use runComposeSandbox with custom prepare that throws? Instead test command fails via exitCode then down hangs
      // For this integration, test failure primary is via exitCode 1; cleanup should hang and be bounded
      // But runComposeSandbox's test handler checks exitCode and throws; that is primary. Down hang should be secondary and bounded by cleanupMs=80
      const options = {
        cwd: root,
        compose: { files: ['a.yml'] },
        test: { executable: 'echo', args: ['hi'] },
        readiness: [],
        evidence: { directory: 'evidence', capture: 'always' },
        timeouts: { startupMs: 5000, readinessMs: 5000, testMs: 5000, cleanupMs: 80 },
      };
      // Need to make test fail: our fakeRun returns exitCode 1 for non-compose test? But our fake distinguishes by args includes 'down' etc else treat as test.
      // For test executable 'echo', args include 'hi' not 'down', so it will fall through to test branch which returns exitCode 1 -> primary
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: fakeRun as never });
      } catch (e) {
        thrown = e;
      }
      const elapsed = Date.now() - start;
      expect(thrown).toBeDefined();
      const err = thrown as ComposeSandboxLifecycleError;
      expect(err.primary.message).toMatch(/exitCode 1/);
      expect(err.secondary?.message).toMatch(/abort|timeout/i);
      expect(elapsed).toBeLessThan(80 + 300);
      expect(elapsed).toBeGreaterThanOrEqual(60);
      expect(signalTarget.listenerCount('SIGINT')).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
