import { spawnSync } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_KILL_SIGNAL: NodeJS.Signals = 'SIGKILL';

export interface GoReleaseRunOptions {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdio?: 'inherit' | 'pipe' | 'ignore';
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly killSignal?: NodeJS.Signals;
}

export interface GoReleaseRunner {
  run(executable: string, args: ReadonlyArray<string>, options: GoReleaseRunOptions): void | Promise<void>;
  capture(executable: string, args: ReadonlyArray<string>, options: GoReleaseRunOptions): string;
}

export const defaultGoReleaseRunner: GoReleaseRunner = {
  run(executable, args, options) {
    const limits = resolveLimits(options);
    const result = spawnSync(executable, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: options.stdio ?? 'inherit',
      encoding: 'utf8',
      timeout: limits.timeoutMs,
      maxBuffer: limits.maxOutputBytes,
      killSignal: limits.killSignal,
    });
    assertSuccessful(executable, result, limits);
  },
  capture(executable, args, options) {
    const limits = resolveLimits(options);
    const result = spawnSync(executable, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: limits.timeoutMs,
      maxBuffer: limits.maxOutputBytes,
      killSignal: limits.killSignal,
    });
    assertSuccessful(executable, result, limits);
    const output = result.stdout ?? '';
    if (Buffer.byteLength(output, 'utf8') > limits.maxOutputBytes) {
      throw outputOverflowError(executable, limits.maxOutputBytes);
    }
    return output;
  },
};

export function validateGoReleaseRunner(value: unknown): asserts value is GoReleaseRunner {
  if (typeof value !== 'object' || value === null) {
    throw new Error('runner must be a GoReleaseRunner object');
  }
  const runner = value as Partial<GoReleaseRunner>;
  if (typeof runner.run !== 'function' || typeof runner.capture !== 'function') {
    throw new Error('runner must implement run() and capture()');
  }
}

interface ResolvedLimits {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly killSignal: NodeJS.Signals;
}

function resolveLimits(options: GoReleaseRunOptions): ResolvedLimits {
  return {
    timeoutMs: positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs'),
    maxOutputBytes: positiveInteger(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES, 'maxOutputBytes'),
    killSignal: options.killSignal ?? DEFAULT_KILL_SIGNAL,
  };
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function assertSuccessful(executable: string, result: ReturnType<typeof spawnSync>, limits: ResolvedLimits): void {
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT') {
      throw new Error(`Executable ${JSON.stringify(executable)} timed out after ${limits.timeoutMs}ms`);
    }
    if (code === 'ENOBUFS') {
      throw outputOverflowError(executable, limits.maxOutputBytes);
    }
    throw new Error(`Executable ${JSON.stringify(executable)} failed to start: ${code ?? result.error.message}`);
  }
  if (result.status !== 0) {
    if (result.signal !== null) {
      throw new Error(`Executable ${JSON.stringify(executable)} was terminated by ${result.signal}`);
    }
    throw new Error(`Executable ${JSON.stringify(executable)} exited with status ${result.status}`);
  }
}

function outputOverflowError(executable: string, maxOutputBytes: number): Error {
  return new Error(`Executable ${JSON.stringify(executable)} exceeded the ${maxOutputBytes}-byte output limit`);
}
