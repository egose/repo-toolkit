import { spawn as defaultSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createDefaultClock, type Clock } from './clock';
import { byteLengthUtf8, truncateUtf8ToBytes } from './output';

export { truncateUtf8ToBytes } from './output';

export interface ProcessOptions {
  readonly executable: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly captureOutput?: boolean;
  readonly maxOutputBytes?: number;
  readonly inheritStdio?: boolean;
}

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
  readonly truncatedBytes: number;
}

export type { Clock } from './clock';

export interface ProcessDeps {
  readonly spawn?: typeof defaultSpawn;
  readonly clock?: Clock;
  readonly kill?: (pid: number, signal: NodeJS.Signals) => void;
  readonly graceMs?: number;
}

const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const DEFAULT_GRACE_MS = 2000;

function defaultClock(): Clock {
  return createDefaultClock();
}

function byteLength(str: string): number {
  return byteLengthUtf8(str);
}

function truncateChunkToBytes(chunk: string, maxBytes: number): string {
  return truncateUtf8ToBytes(chunk, maxBytes);
}

export function isProcessSuccess(result: ProcessResult): boolean {
  return result.exitCode === 0 && result.signal === null && result.timedOut === false;
}

export function isSuccessfulProcessResult(result: ProcessResult): boolean {
  return isProcessSuccess(result);
}

export async function runProcess(options: ProcessOptions, deps: ProcessDeps = {}): Promise<ProcessResult> {
  if (typeof options.executable !== 'string' || options.executable.length === 0) {
    throw new Error('executable must be a non-empty string');
  }
  if (options.executable.includes('\0')) {
    throw new Error('executable must not contain NUL bytes');
  }
  const args = options.args ? [...options.args] : [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] as string;
    if (typeof a !== 'string') throw new Error(`args[${i}] must be a string`);
    if (a.includes('\0')) throw new Error(`args[${i}] must not contain NUL bytes`);
  }
  if (options.timeoutMs !== undefined) {
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
      throw new Error('timeoutMs must be a positive safe integer');
    }
  }
  if (options.maxOutputBytes !== undefined) {
    if (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes <= 0) {
      throw new Error('maxOutputBytes must be a positive safe integer');
    }
  }
  if (options.captureOutput === true && options.inheritStdio === true) {
    throw new Error('captureOutput and inheritStdio are mutually exclusive');
  }

  if (options.signal?.aborted) {
    const err = new Error(`process aborted before spawn: ${options.executable}`);
    (err as unknown as Record<string, unknown>).cause = options.signal.reason;
    throw err;
  }

  const spawnFn = deps.spawn ?? defaultSpawn;
  const clock = deps.clock ?? defaultClock();
  const killFn =
    deps.kill ??
    ((pid: number, sig: NodeJS.Signals) => {
      process.kill(pid, sig);
    });
  const graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
  const inheritStdio = options.inheritStdio ?? false;
  const shouldCapture = !inheritStdio && options.captureOutput !== false;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const startMs = clock.now();
  const useProcessGroup = process.platform !== 'win32';

  let timedOut = false;
  let stdout = '';
  let stderr = '';
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let truncatedBytes = 0;

  function appendStdout(chunk: string): void {
    if (!shouldCapture) {
      truncatedBytes += byteLength(chunk);
      return;
    }
    if (stdoutTruncated) {
      truncatedBytes += byteLength(chunk);
      return;
    }
    const len = byteLength(chunk);
    if (stdoutBytes + len > maxOutputBytes) {
      const remaining = maxOutputBytes - stdoutBytes;
      if (remaining > 0) {
        const safe = truncateChunkToBytes(chunk, remaining);
        const safeBytes = byteLength(safe);
        stdout += safe;
        stdoutBytes += safeBytes;
        truncatedBytes += len - safeBytes;
      } else {
        truncatedBytes += len;
      }
      stdoutTruncated = true;
    } else {
      stdout += chunk;
      stdoutBytes += len;
    }
  }

  function appendStderr(chunk: string): void {
    if (!shouldCapture) {
      truncatedBytes += byteLength(chunk);
      return;
    }
    if (stderrTruncated) {
      truncatedBytes += byteLength(chunk);
      return;
    }
    const len = byteLength(chunk);
    if (stderrBytes + len > maxOutputBytes) {
      const remaining = maxOutputBytes - stderrBytes;
      if (remaining > 0) {
        const safe = truncateChunkToBytes(chunk, remaining);
        const safeBytes = byteLength(safe);
        stderr += safe;
        stderrBytes += safeBytes;
        truncatedBytes += len - safeBytes;
      } else {
        truncatedBytes += len;
      }
      stderrTruncated = true;
    } else {
      stderr += chunk;
      stderrBytes += len;
    }
  }

  return new Promise<ProcessResult>((resolve, reject) => {
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    let child: ChildProcess | undefined;

    function cleanupTimers(): void {
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      if (killTimer !== undefined) clearTimeout(killTimer);
    }

    function terminate(sig: NodeJS.Signals): void {
      if (!child) return;
      const ec = (child as unknown as { exitCode: number | null }).exitCode;
      const sc = (child as unknown as { signalCode: NodeJS.Signals | null }).signalCode;
      if (ec !== null && ec !== undefined) return;
      if (sc !== null && sc !== undefined) return;
      const pid = child.pid;
      if (pid !== undefined) {
        if (useProcessGroup) {
          try {
            killFn(-pid, sig);
          } catch (_unused) {
            void _unused;
          }
        }
        try {
          killFn(pid, sig);
        } catch (_unused2) {
          void _unused2;
        }
      }
      try {
        child.kill(sig);
      } catch (_unused3) {
        void _unused3;
      }
    }

    function cleanupSignal(): void {
      if (abortHandler && options.signal) {
        try {
          options.signal.removeEventListener('abort', abortHandler);
        } catch (_unused) {
          void _unused;
        }
      }
    }

    function finalize(result: ProcessResult): void {
      if (settled) return;
      settled = true;
      cleanupTimers();
      cleanupSignal();
      resolve(result);
    }

    function fail(err: unknown): void {
      if (settled) return;
      settled = true;
      cleanupTimers();
      cleanupSignal();
      reject(err);
    }

    const abortHandler = options.signal
      ? () => {
          terminate('SIGTERM');
          killTimer = setTimeout(() => terminate('SIGKILL'), graceMs);
          if (typeof (killTimer as unknown as { unref?: () => void }).unref === 'function') {
            (killTimer as unknown as { unref: () => void }).unref();
          }
        }
      : undefined;

    if (options.signal && abortHandler) {
      options.signal.addEventListener('abort', abortHandler as EventListener, { once: true });
    }

    if (options.timeoutMs !== undefined) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminate('SIGTERM');
        graceTimer = setTimeout(() => terminate('SIGKILL'), graceMs);
        if (typeof (graceTimer as unknown as { unref?: () => void }).unref === 'function') {
          (graceTimer as unknown as { unref: () => void }).unref();
        }
      }, options.timeoutMs);
      if (typeof (timeoutTimer as unknown as { unref?: () => void }).unref === 'function') {
        (timeoutTimer as unknown as { unref: () => void }).unref();
      }
    }

    let spawnError: unknown;
    try {
      const spawnOpts: Record<string, unknown> = {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : undefined,
        stdio: inheritStdio ? 'inherit' : 'pipe',
        detached: useProcessGroup,
        shell: false,
      };
      child = spawnFn(options.executable, args, spawnOpts as never) as ChildProcess;
    } catch (err) {
      spawnError = err;
    }
    if (spawnError !== undefined) {
      fail(spawnError);
      return;
    }
    if (!child) {
      fail(new Error(`failed to spawn ${options.executable}`));
      return;
    }

    if (options.signal?.aborted) {
      terminate('SIGTERM');
      killTimer = setTimeout(() => terminate('SIGKILL'), graceMs);
      if (typeof (killTimer as unknown as { unref?: () => void }).unref === 'function') {
        (killTimer as unknown as { unref: () => void }).unref();
      }
    }

    if (shouldCapture) {
      const stdoutStream = (child as unknown as { stdout: NodeJS.ReadableStream | null }).stdout;
      const stderrStream = (child as unknown as { stderr: NodeJS.ReadableStream | null }).stderr;
      if (stdoutStream) {
        stdoutStream.on('data', (chunk: Buffer | string) => {
          const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
          appendStdout(s);
        });
      }
      if (stderrStream) {
        stderrStream.on('data', (chunk: Buffer | string) => {
          const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
          appendStderr(s);
        });
      }
    }

    child.on('error', (err: Error) => {
      fail(err);
    });

    child.on('close', (code: number | null, sig: NodeJS.Signals | null) => {
      const durationMs = clock.now() - startMs;
      const exitCode: number | null = code;
      if (options.signal?.aborted && !timedOut) {
        const err = new Error(`process aborted: ${options.executable}`);
        (err as unknown as Record<string, unknown>).cause = options.signal.reason;
        fail(err);
        return;
      }
      finalize({
        exitCode,
        signal: sig,
        stdout,
        stderr,
        durationMs,
        timedOut,
        stdoutTruncated,
        stderrTruncated,
        truncatedBytes,
      });
    });
  });
}
