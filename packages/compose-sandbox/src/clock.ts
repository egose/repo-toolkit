export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
  setTimeout?(callback: () => void, ms: number): unknown;
  clearTimeout?(handle: unknown): void;
}

export interface Scheduler {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export function createDefaultClock(): Clock {
  return {
    now: () => Date.now(),
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
    setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
    clearTimeout: (h: unknown) => clearTimeout(h as NodeJS.Timeout),
  };
}

export function getScheduler(clock: Clock): Scheduler {
  const maybeSet = (clock as unknown as { setTimeout?: (cb: () => void, ms: number) => unknown }).setTimeout;
  const maybeClear = (clock as unknown as { clearTimeout?: (h: unknown) => void }).clearTimeout;
  if (typeof maybeSet === 'function' && typeof maybeClear === 'function') {
    return {
      setTimeout: maybeSet.bind(clock) as (cb: () => void, ms: number) => unknown,
      clearTimeout: maybeClear.bind(clock) as (handle: unknown) => void,
    };
  }
  return {
    setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
    clearTimeout: (h: unknown) => clearTimeout(h as NodeJS.Timeout),
  };
}
