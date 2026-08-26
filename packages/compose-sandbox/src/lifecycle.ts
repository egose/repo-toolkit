import { createDefaultClock, getScheduler, type Clock } from './clock';

export type { Clock } from './clock';

export type LifecyclePhase =
  | 'validate'
  | 'prepare'
  | 'preflight'
  | 'start'
  | 'readiness'
  | 'test'
  | 'evidence'
  | 'cleanup';

export interface SignalTarget {
  on(event: 'SIGINT' | 'SIGTERM', handler: () => void): void;
  off?(event: 'SIGINT' | 'SIGTERM', handler: () => void): void;
  removeListener?(event: 'SIGINT' | 'SIGTERM', handler: () => void): void;
  listenerCount?(event: 'SIGINT' | 'SIGTERM'): number;
}

function defaultClock(): Clock {
  return createDefaultClock();
}

export class ComposeSandboxLifecycleError extends Error {
  public readonly phase: LifecyclePhase;
  public readonly primary: Error;
  public readonly secondary?: Error;

  constructor(phase: LifecyclePhase, primary: Error, secondary?: Error) {
    const msg = secondary ? `${primary.message}; secondary ${phase} failure: ${secondary.message}` : primary.message;
    super(msg);
    this.name = 'ComposeSandboxLifecycleError';
    this.phase = phase;
    this.primary = primary;
    this.secondary = secondary;
    if (secondary && (secondary as unknown as { stack?: string }).stack) {
      this.stack = `${primary.stack}\nCaused by secondary (${phase}): ${(secondary as Error).stack}`;
    } else {
      this.stack = primary.stack;
    }
  }
}

export interface LifecycleHandlers {
  validate?: (signal: AbortSignal) => Promise<void> | void;
  prepare?: (signal: AbortSignal) => Promise<void> | void;
  preflight?: (signal: AbortSignal) => Promise<void> | void;
  start?: (signal: AbortSignal) => Promise<void> | void;
  readiness?: (signal: AbortSignal) => Promise<void> | void;
  test?: (signal: AbortSignal) => Promise<void> | void;
  evidence?: (outcome: 'success' | 'failure', signal: AbortSignal, primary?: Error) => Promise<void> | void;
  cleanup?: (signal: AbortSignal) => Promise<void> | void;
}

export interface LifecycleDeps {
  clock?: Clock;
  signalTarget?: SignalTarget;
  createAbortController?: () => AbortController;
  totalMs?: number;
  cleanupMs?: number;
  evidenceMs?: number;
  preflightMs?: number;
}

export interface LifecycleResult {
  readonly outcome: 'success' | 'failure';
  readonly phase: LifecyclePhase;
  readonly durationMs: number;
  readonly primaryError?: Error;
  readonly secondaryError?: Error;
}

export async function runLifecycle(handlers: LifecycleHandlers, deps: LifecycleDeps = {}): Promise<LifecycleResult> {
  const clock = deps.clock ?? defaultClock();
  const signalTarget: SignalTarget = deps.signalTarget ?? (process as unknown as SignalTarget);
  const createAbortController = deps.createAbortController ?? (() => new AbortController());
  const scheduler = getScheduler(clock);

  const abortController = createAbortController();
  const startMs = clock.now();

  let primaryError: Error | undefined;
  let primaryPhase: LifecyclePhase | undefined;
  let secondaryError: Error | undefined;
  let secondaryPhase: LifecyclePhase | undefined;
  let currentPhase: LifecyclePhase = 'validate';
  let started = false;
  let cleanupAttempted = false;
  let signalReceived: NodeJS.Signals | undefined;
  const emergencyControllers: AbortController[] = [];
  const emergencyTimers: unknown[] = [];
  let totalTimer: unknown | undefined;
  if (deps.totalMs !== undefined) {
    totalTimer = scheduler.setTimeout(() => {
      const reason = new Error(`total timeout after ${deps.totalMs}ms`);
      if (!abortController.signal.aborted) {
        try {
          abortController.abort(reason);
        } catch (_unused) {
          void _unused;
        }
      }
      abortEmergencyControllers(reason);
    }, deps.totalMs);
    emergencyTimers.push(totalTimer);
  }

  function abortEmergencyControllers(reason: Error): void {
    for (const c of emergencyControllers) {
      if (!c.signal.aborted) {
        try {
          c.abort(reason);
        } catch (_unused) {
          void _unused;
        }
      }
    }
  }

  const sigIntHandler = (): void => {
    signalReceived = signalReceived ?? 'SIGINT';
    const reason = new Error(`terminated by ${signalReceived}`);
    if (!abortController.signal.aborted) {
      try {
        abortController.abort(reason);
      } catch (_unused) {
        void _unused;
      }
    }
    abortEmergencyControllers(reason);
  };

  const sigTermHandler = (): void => {
    signalReceived = signalReceived ?? 'SIGTERM';
    const reason = new Error(`terminated by ${signalReceived}`);
    if (!abortController.signal.aborted) {
      try {
        abortController.abort(reason);
      } catch (_unused) {
        void _unused;
      }
    }
    abortEmergencyControllers(reason);
  };

  const on = signalTarget.on.bind(signalTarget);
  const off = (signalTarget.off ?? signalTarget.removeListener ?? (() => {})) as (
    event: string,
    handler: () => void,
  ) => void;

  on('SIGINT', sigIntHandler);
  on('SIGTERM', sigTermHandler);

  function removeHandlers(): void {
    try {
      off.call(signalTarget, 'SIGINT', sigIntHandler);
    } catch (_unused) {
      void _unused;
    }
    try {
      off.call(signalTarget, 'SIGTERM', sigTermHandler);
    } catch (_unused2) {
      void _unused2;
    }
  }

  function clearEmergencyTimers(): void {
    for (const t of emergencyTimers) {
      try {
        scheduler.clearTimeout(t);
      } catch (_unused) {
        void _unused;
      }
    }
    emergencyTimers.length = 0;
  }

  function clampedBudget(explicitMs: number | undefined): number | undefined {
    if (explicitMs === undefined && deps.totalMs === undefined) return undefined;
    if (explicitMs === undefined && deps.totalMs !== undefined) {
      const remaining = deps.totalMs - (clock.now() - startMs);
      if (remaining <= 0) return undefined;
      return remaining;
    }
    if (explicitMs !== undefined && deps.totalMs === undefined) return explicitMs;
    if (explicitMs !== undefined && deps.totalMs !== undefined) {
      const remaining = deps.totalMs - (clock.now() - startMs);
      if (remaining <= 0) return explicitMs;
      return Math.min(explicitMs, remaining);
    }
    return undefined;
  }

  function createEmergencyContext(budgetMs: number | undefined): { signal: AbortSignal; dispose: () => void } {
    const ctrl = createAbortController();
    emergencyControllers.push(ctrl);
    let timer: unknown | undefined;
    const effective = clampedBudget(budgetMs);
    if (effective !== undefined) {
      timer = scheduler.setTimeout(() => {
        try {
          ctrl.abort(new Error(`emergency timeout after ${effective}ms`));
        } catch (_unused) {
          void _unused;
        }
      }, effective);
      emergencyTimers.push(timer);
    }
    const dispose = (): void => {
      if (timer !== undefined) {
        try {
          scheduler.clearTimeout(timer);
        } catch (_unused) {
          void _unused;
        }
        const idx = emergencyTimers.indexOf(timer);
        if (idx >= 0) emergencyTimers.splice(idx, 1);
      }
    };
    return { signal: ctrl.signal, dispose };
  }

  async function attemptCleanupWithFresh(): Promise<void> {
    if (cleanupAttempted) return;
    if (!started) return;
    cleanupAttempted = true;
    currentPhase = 'cleanup';
    const budget = deps.cleanupMs;
    const ctx = createEmergencyContext(budget);
    try {
      await handlers.cleanup?.(ctx.signal);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (primaryError) {
        if (!secondaryError) {
          secondaryError = e;
          secondaryPhase = 'cleanup';
        }
      } else {
        primaryError = e;
        primaryPhase = 'cleanup';
      }
    } finally {
      ctx.dispose();
    }
  }

  async function attemptEvidenceWithFresh(outcome: 'success' | 'failure', primary?: Error): Promise<void> {
    currentPhase = 'evidence';
    const budget = deps.evidenceMs ?? deps.cleanupMs;
    const ctx = createEmergencyContext(budget);
    try {
      await handlers.evidence?.(outcome, ctx.signal, primary);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (outcome === 'success') {
        if (!primaryError) {
          primaryError = e;
          primaryPhase = 'evidence';
        } else if (!secondaryError) {
          secondaryError = e;
          secondaryPhase = 'evidence';
        }
      } else {
        if (!primaryError) {
          primaryError = e;
          primaryPhase = 'evidence';
        } else if (!secondaryError) {
          secondaryError = e;
          secondaryPhase = 'evidence';
        }
      }
      throw e;
    } finally {
      ctx.dispose();
    }
  }

  try {
    currentPhase = 'validate';
    await handlers.validate?.(abortController.signal);
    if (abortController.signal.aborted) throw abortController.signal.reason ?? new Error('aborted during validate');

    currentPhase = 'prepare';
    await handlers.prepare?.(abortController.signal);
    if (abortController.signal.aborted) throw abortController.signal.reason ?? new Error('aborted during prepare');

    currentPhase = 'preflight';
    {
      const budget = deps.preflightMs ?? deps.cleanupMs;
      const effective = clampedBudget(budget);
      if (effective !== undefined) {
        let timeoutTimer: unknown | undefined;
        let aborted = false;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutTimer = scheduler.setTimeout(() => {
            aborted = true;
            try {
              abortController.abort(new Error(`preflight timeout after ${effective}ms`));
            } catch (_unused) {
              void _unused;
            }
            reject(new Error(`preflight timeout after ${effective}ms`));
          }, effective);
        });
        const handlerPromise = (async () => {
          await handlers.preflight?.(abortController.signal);
        })();
        let raceError: unknown;
        try {
          await Promise.race([handlerPromise, timeoutPromise]);
        } catch (err) {
          raceError = err;
        } finally {
          if (timeoutTimer !== undefined) {
            try {
              scheduler.clearTimeout(timeoutTimer);
            } catch (_unused) {
              void _unused;
            }
          }
        }
        if (aborted && !primaryError) {
          primaryError = new Error(`preflight timeout after ${effective}ms`);
          primaryPhase = 'preflight';
          throw primaryError;
        }
        if (raceError) throw raceError;
      } else {
        await handlers.preflight?.(abortController.signal);
      }
    }
    if (abortController.signal.aborted) throw abortController.signal.reason ?? new Error('aborted during preflight');

    started = true;
    currentPhase = 'start';
    await handlers.start?.(abortController.signal);
    if (abortController.signal.aborted) throw abortController.signal.reason ?? new Error('aborted during start');

    currentPhase = 'readiness';
    await handlers.readiness?.(abortController.signal);
    if (abortController.signal.aborted) throw abortController.signal.reason ?? new Error('aborted during readiness');

    currentPhase = 'test';
    await handlers.test?.(abortController.signal);
    if (abortController.signal.aborted) throw abortController.signal.reason ?? new Error('aborted during test');

    currentPhase = 'evidence';
    try {
      await attemptEvidenceWithFresh('success');
    } catch (_unused) {
      void _unused;
    }

    if (signalReceived && !primaryError) {
      primaryError = new Error(`terminated by ${signalReceived}`);
      primaryPhase = currentPhase;
    }

    if (primaryError) {
      // fallthrough to finally cleanup and then throw
    } else {
      await attemptCleanupWithFresh();
      if (primaryError) {
        // cleanup failed after success path; fallthrough to failure handling
      } else {
        const durationMs = clock.now() - startMs;
        clearEmergencyTimers();
        removeHandlers();
        if (signalReceived) {
          const err = primaryError ?? new Error(`terminated by ${signalReceived}`);
          throw new ComposeSandboxLifecycleError(primaryPhase ?? currentPhase, err, secondaryError);
        }
        return { outcome: 'success', phase: 'cleanup', durationMs };
      }
    }
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    if (!primaryError) {
      primaryError = e;
      primaryPhase = currentPhase;
    }
    currentPhase = 'evidence';
    try {
      await attemptEvidenceWithFresh('failure', primaryError);
    } catch (evErr) {
      const ev = evErr instanceof Error ? evErr : new Error(String(evErr));
      if (!secondaryError) {
        secondaryError = ev;
        secondaryPhase = 'evidence';
      }
    }
  } finally {
    await attemptCleanupWithFresh();
    clearEmergencyTimers();
    removeHandlers();
  }

  const durationMs = clock.now() - startMs;
  if (primaryError) {
    if (secondaryError) {
      throw new ComposeSandboxLifecycleError(primaryPhase ?? currentPhase, primaryError, secondaryError);
    }
    if (secondaryPhase !== undefined) {
      throw new ComposeSandboxLifecycleError(primaryPhase ?? currentPhase, primaryError);
    }
    throw primaryError;
  }
  if (secondaryError) {
    throw new ComposeSandboxLifecycleError(secondaryPhase ?? 'evidence', secondaryError);
  }
  if (signalReceived) {
    throw new Error(`terminated by ${signalReceived}`);
  }
  return { outcome: 'failure', phase: primaryPhase ?? currentPhase, durationMs, primaryError, secondaryError };
}
