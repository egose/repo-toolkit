import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import {
  ComposeSandboxLifecycleError,
  runLifecycle,
  type Clock,
  type LifecycleHandlers,
  type SignalTarget,
} from '../src/lifecycle';

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

describe('runLifecycle', () => {
  it('preserves primary test failure when cleanup also fails and calls cleanup once', async () => {
    const clock = fakeClock();
    const signalTarget = fakeSignalTarget();
    let cleanupCount = 0;
    const handlers: LifecycleHandlers = {
      start: async () => {},
      test: async () => {
        throw new Error('test failed');
      },
      cleanup: async () => {
        cleanupCount += 1;
        throw new Error('cleanup failed');
      },
    };
    await expect(runLifecycle(handlers, { clock, signalTarget })).rejects.toThrow('test failed');
    try {
      await runLifecycle(handlers, { clock, signalTarget: fakeSignalTarget() });
    } catch (err) {
      expect(err).toBeInstanceOf(ComposeSandboxLifecycleError);
      const e = err as ComposeSandboxLifecycleError;
      expect(e.primary.message).toBe('test failed');
      expect(e.secondary?.message).toBe('cleanup failed');
      expect(e.phase).toBe('test');
    }
    expect(cleanupCount).toBe(2);
    const singleHandlers: LifecycleHandlers = {
      start: async () => {},
      test: async () => {
        throw new Error('primary');
      },
      cleanup: async () => {
        cleanupCount += 1;
        throw new Error('secondary');
      },
    };
    let singleRunCleanup = 0;
    singleHandlers.cleanup = async () => {
      singleRunCleanup += 1;
      throw new Error('cleanup also fails');
    };
    singleHandlers.test = async () => {
      throw new Error('failed test');
    };
    try {
      await runLifecycle(singleHandlers, { clock, signalTarget: fakeSignalTarget() });
    } catch (err) {
      const ce = err as ComposeSandboxLifecycleError;
      expect(ce.primary.message).toBe('failed test');
      expect(ce.secondary?.message).toBe('cleanup also fails');
    }
    expect(singleRunCleanup).toBe(1);
  });

  it('timed-out test still triggers cleanup and preserves timeout as primary', async () => {
    const clock = fakeClock();
    const signalTarget = fakeSignalTarget();
    let cleanupCount = 0;
    const handlers: LifecycleHandlers = {
      start: async () => {},
      test: async () => {
        const err = new Error('test timed out after 30ms');
        (err as unknown as Record<string, unknown>).code = 'ETIMEDOUT';
        throw err;
      },
      cleanup: async () => {
        cleanupCount += 1;
        throw new Error('cleanup fail');
      },
    };
    try {
      await runLifecycle(handlers, { clock, signalTarget });
      expect.fail('should throw');
    } catch (err) {
      const e = err as ComposeSandboxLifecycleError;
      expect(e.primary.message).toMatch(/timed out/);
      expect(e.secondary?.message).toBe('cleanup fail');
    }
    expect(cleanupCount).toBe(1);
  });

  it('does not call cleanup before start begins', async () => {
    const clock = fakeClock();
    const signalTarget = fakeSignalTarget();
    let cleanupCount = 0;
    const handlers: LifecycleHandlers = {
      validate: async () => {
        throw new Error('validate fail');
      },
      cleanup: async () => {
        cleanupCount += 1;
      },
    };
    await expect(runLifecycle(handlers, { clock, signalTarget })).rejects.toThrow('validate fail');
    expect(cleanupCount).toBe(0);
  });

  it('cleanup attempted exactly once even when readiness fails', async () => {
    const clock = fakeClock();
    const signalTarget = fakeSignalTarget();
    let cleanupCount = 0;
    const handlers: LifecycleHandlers = {
      start: async () => {},
      readiness: async () => {
        throw new Error('readiness fail');
      },
      cleanup: async () => {
        cleanupCount += 1;
      },
    };
    await expect(runLifecycle(handlers, { clock, signalTarget })).rejects.toThrow('readiness fail');
    expect(cleanupCount).toBe(1);
  });

  it('signal triggers abort, cleanup, listener removal, non-success result', async () => {
    const clock = fakeClock();
    const signalTarget = fakeSignalTarget();
    const beforeInt = signalTarget.listenerCount('SIGINT');
    const beforeTerm = signalTarget.listenerCount('SIGTERM');
    let cleanupCount = 0;
    let testAborted = false;
    const handlers: LifecycleHandlers = {
      start: async (signal) => {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => resolve(), 1000);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(t);
              testAborted = true;
              reject(new Error('aborted by signal'));
            },
            { once: true },
          );
          setTimeout(() => signalTarget.emit('SIGINT'), 10);
        });
      },
      cleanup: async () => {
        cleanupCount += 1;
      },
    };
    await expect(runLifecycle(handlers, { clock, signalTarget })).rejects.toThrow(/aborted|terminated/i);
    expect(cleanupCount).toBe(1);
    expect(testAborted).toBe(true);
    expect(signalTarget.listenerCount('SIGINT')).toBe(beforeInt);
    expect(signalTarget.listenerCount('SIGTERM')).toBe(beforeTerm);
  });

  it('removes listeners on success without leaking', async () => {
    const clock = fakeClock();
    const signalTarget = fakeSignalTarget();
    const beforeInt = signalTarget.listenerCount('SIGINT');
    const handlers: LifecycleHandlers = {
      start: async () => {},
      test: async () => {},
      cleanup: async () => {},
    };
    const result = await runLifecycle(handlers, { clock, signalTarget });
    expect(result.outcome).toBe('success');
    expect(signalTarget.listenerCount('SIGINT')).toBe(beforeInt);
    expect(signalTarget.listenerCount('SIGTERM')).toBe(0);
  });

  it('does not leak listeners across repeated calls', async () => {
    const clock = fakeClock();
    const signalTarget = fakeSignalTarget();
    for (let i = 0; i < 5; i += 1) {
      await runLifecycle({ start: async () => {}, cleanup: async () => {} }, { clock, signalTarget });
    }
    expect(signalTarget.listenerCount('SIGINT')).toBe(0);
    expect(signalTarget.listenerCount('SIGTERM')).toBe(0);
    let count = 0;
    const handlers: LifecycleHandlers = {
      start: async () => {},
      test: async () => {
        throw new Error('fail');
      },
      cleanup: async () => {
        count += 1;
      },
    };
    for (let i = 0; i < 3; i += 1) {
      try {
        await runLifecycle(handlers, { clock, signalTarget });
      } catch (_unused) {
        void _unused;
      }
    }
    expect(signalTarget.listenerCount('SIGINT')).toBe(0);
    expect(count).toBe(3);
  });

  it('ensure cleanup at most once even when signal arrives during cleanup', async () => {
    const clock = fakeClock();
    const signalTarget = fakeSignalTarget();
    let cleanupCount = 0;
    const handlers: LifecycleHandlers = {
      start: async () => {},
      test: async () => {
        throw new Error('test fail');
      },
      cleanup: async () => {
        cleanupCount += 1;
        signalTarget.emit('SIGTERM');
        await new Promise<void>((r) => setTimeout(r, 5));
      },
    };
    try {
      await runLifecycle(handlers, { clock, signalTarget });
    } catch (_unused) {
      void _unused;
    }
    expect(cleanupCount).toBe(1);
  });

  it('evidence failure without primary throws evidence error', async () => {
    const clock = fakeClock();
    const signalTarget = fakeSignalTarget();
    const handlers: LifecycleHandlers = {
      start: async () => {},
      test: async () => {},
      evidence: async (outcome) => {
        if (outcome === 'success') throw new Error('evidence fail');
      },
      cleanup: async () => {},
    };
    await expect(runLifecycle(handlers, { clock, signalTarget })).rejects.toThrow('evidence fail');
  });

  it('no dangling timers after lifecycle', async () => {
    const clock = fakeClock();
    const signalTarget = fakeSignalTarget();
    const handlers: LifecycleHandlers = {
      start: async (signal) => {
        await clock.sleep(10);
        if (signal.aborted) throw new Error('aborted');
      },
      readiness: async () => {
        await clock.sleep(5);
      },
      test: async () => {
        await clock.sleep(5);
      },
      cleanup: async () => {
        await clock.sleep(5);
      },
    };
    await runLifecycle(handlers, { clock, signalTarget });
    await new Promise<void>((r) => setTimeout(r, 20));
    expect(signalTarget.listenerCount('SIGINT')).toBe(0);
  });

  it('injectable clock makes timeout deterministic', async () => {
    let nowMs = 0;
    const clock: Clock = {
      now: () => nowMs,
      sleep: async (ms: number) => {
        nowMs += ms;
      },
    };
    const signalTarget = fakeSignalTarget();
    const durations: number[] = [];
    const handlers: LifecycleHandlers = {
      start: async () => {
        await clock.sleep(100);
      },
      test: async () => {
        await clock.sleep(50);
      },
      cleanup: async () => {
        await clock.sleep(10);
      },
    };
    const r1 = await runLifecycle(handlers, { clock, signalTarget });
    durations.push(r1.durationMs);
    nowMs = 0;
    const r2 = await runLifecycle(handlers, { clock, signalTarget: fakeSignalTarget() });
    durations.push(r2.durationMs);
    expect(durations[0]).toBe(durations[1]);
    expect(durations[0]).toBe(160);
  });

  it('primary retained when evidence fails after test failure', async () => {
    const clock = fakeClock();
    const signalTarget = fakeSignalTarget();
    const handlers: LifecycleHandlers = {
      start: async () => {},
      test: async () => {
        throw new Error('test primary');
      },
      evidence: async (outcome) => {
        if (outcome === 'failure') throw new Error('evidence secondary');
      },
      cleanup: async () => {},
    };
    try {
      await runLifecycle(handlers, { clock, signalTarget });
      expect.fail('should throw');
    } catch (err) {
      const e = err as ComposeSandboxLifecycleError;
      expect(e.primary.message).toBe('test primary');
      expect(e.secondary?.message).toBe('evidence secondary');
    }
  });
});
