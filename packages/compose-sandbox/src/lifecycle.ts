export type LifecyclePhase =
  | 'validate'
  | 'prepare'
  | 'preflight'
  | 'start'
  | 'readiness'
  | 'test'
  | 'evidence'
  | 'cleanup';

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface SignalTarget {
  on(event: 'SIGINT' | 'SIGTERM', handler: () => void): void;
  off?(event: 'SIGINT' | 'SIGTERM', handler: () => void): void;
  removeListener?(event: 'SIGINT' | 'SIGTERM', handler: () => void): void;
  listenerCount?(event: 'SIGINT' | 'SIGTERM'): number;
}

function defaultClock(): Clock {
  return {
    now: () => Date.now(),
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
  };
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

  const sigHandler = () => {
    signalReceived = signalReceived ?? 'SIGTERM';
    if (!abortController.signal.aborted) {
      try {
        abortController.abort(new Error(`terminated by ${signalReceived}`));
      } catch (_unused) {
        void _unused;
      }
    }
  };

  const on = signalTarget.on.bind(signalTarget);
  const off = (signalTarget.off ?? signalTarget.removeListener ?? (() => {})) as (
    event: string,
    handler: () => void,
  ) => void;

  on('SIGINT', sigHandler);
  on('SIGTERM', sigHandler);

  function removeHandlers(): void {
    try {
      off.call(signalTarget, 'SIGINT', sigHandler);
    } catch (_unused) {
      void _unused;
    }
    try {
      off.call(signalTarget, 'SIGTERM', sigHandler);
    } catch (_unused2) {
      void _unused2;
    }
  }

  async function attemptCleanup(signal: AbortSignal): Promise<void> {
    if (cleanupAttempted) return;
    if (!started) return;
    cleanupAttempted = true;
    currentPhase = 'cleanup';
    try {
      await handlers.cleanup?.(signal);
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
    await handlers.preflight?.(abortController.signal);
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
      await handlers.evidence?.('success', abortController.signal);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (!primaryError) {
        primaryError = e;
        primaryPhase = 'evidence';
      } else if (!secondaryError) {
        secondaryError = e;
        secondaryPhase = 'evidence';
      }
    }

    if (signalReceived && !primaryError) {
      primaryError = new Error(`terminated by ${signalReceived}`);
      primaryPhase = currentPhase;
    }

    if (primaryError) {
      // fallthrough to finally cleanup and then throw
    } else {
      await attemptCleanup(abortController.signal);
      if (primaryError) {
        // cleanup failed after success path; fallthrough to failure handling
      } else {
        const durationMs = clock.now() - startMs;
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
      await handlers.evidence?.('failure', abortController.signal, primaryError);
    } catch (evErr) {
      const ev = evErr instanceof Error ? evErr : new Error(String(evErr));
      if (!secondaryError) {
        secondaryError = ev;
        secondaryPhase = 'evidence';
      }
    }
  } finally {
    await attemptCleanup(abortController.signal);
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
