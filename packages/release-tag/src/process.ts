import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

import {
  type CapturingProcessRunner,
  type ProcessCaptureOptions,
  type ProcessCaptureResult,
} from '@repo-toolkit/publish-package';

import { redactText } from './diagnostics';
import type { ReleaseTagPlan } from './plan';

export const MAX_PROCESS_TIMEOUT_MS = 2147483647;

const TERMINATION_GRACE_MS = 250;
const REAP_GRACE_MS = 1000;
const OUTPUT_BLOCK_BYTES = 16384;
const DIAGNOSTIC_BYTES = 2048;
const SAFE_ERROR_CODES = new Set([
  'ENOENT',
  'EACCES',
  'EAGAIN',
  'EMFILE',
  'ENFILE',
  'ENOMEM',
  'EIO',
  'EPIPE',
  'ETIMEDOUT',
  'ENOBUFS',
]);

export interface BoundedProcessOptions extends ProcessCaptureOptions {
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface BoundedProcessResult extends ProcessCaptureResult {
  durationMs: number;
  outputBytes: number;
  retainedBytes: number;
  signal: NodeJS.Signals | null;
  cleanupIncomplete: boolean;
}

export interface CommandDiagnostics {
  secrets?: ReadonlyArray<string | undefined>;
  includeOutput?: boolean;
}

interface CommandOptions extends CommandDiagnostics {
  label: string;
  failureMessage?: string;
  acceptedExitCodes?: ReadonlyArray<number>;
  timeoutMs?: number;
  env?: Record<string, string>;
  includeStdout?: boolean;
}

export function assertProcessLimits(limits: { timeoutMs: number; maxOutputBytes: number }): void {
  if (!Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs < 1 || limits.timeoutMs > MAX_PROCESS_TIMEOUT_MS) {
    throw new Error(`timeoutMs must be an integer from 1 through ${MAX_PROCESS_TIMEOUT_MS}`);
  }
  if (!Number.isSafeInteger(limits.maxOutputBytes) || limits.maxOutputBytes < 1) {
    throw new Error('maxOutputBytes must be a positive safe integer');
  }
}

function assertInvocation(executable: string, args: ReadonlyArray<string>, options: BoundedProcessOptions): void {
  assertProcessLimits(options);
  if (typeof executable !== 'string' || executable.length === 0 || executable.includes('\0')) {
    throw new Error('process executable must be a non-empty string without NUL bytes');
  }
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new Error('process args must be an array of strings without NUL bytes');
  }
  if (typeof options.cwd !== 'string' || options.cwd.length === 0 || options.cwd.includes('\0')) {
    throw new Error('process cwd must be a non-empty string without NUL bytes');
  }
}

function processError(code: string, message: string): Error {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

function safeTransportError(error: unknown): Error {
  let code: unknown;
  try {
    code = (error as NodeJS.ErrnoException | undefined)?.code;
  } catch {
    code = undefined;
  }
  const safeCode = typeof code === 'string' && SAFE_ERROR_CODES.has(code) ? code : 'EPROCESS';
  return processError(safeCode, `process transport failed (${safeCode})`);
}

class OutputBuffer {
  private blocks: Buffer[] = [];
  private used = 0;
  size = 0;

  append(chunk: Buffer, count: number, limit: number): void {
    let offset = 0;
    while (offset < count) {
      let block = this.blocks[this.blocks.length - 1];
      if (block === undefined || this.used === block.length) {
        block = Buffer.allocUnsafe(Math.min(OUTPUT_BLOCK_BYTES, limit - this.size));
        this.blocks.push(block);
        this.used = 0;
      }
      const copied = chunk.copy(block, this.used, offset, offset + Math.min(count - offset, block.length - this.used));
      this.used += copied;
      this.size += copied;
      offset += copied;
    }
  }

  text(): string {
    const last = this.blocks.length - 1;
    if (last >= 0) {
      this.blocks[last] = this.blocks[last].subarray(0, this.used);
    }
    const text = Buffer.concat(this.blocks, this.size).toString('utf8');
    this.blocks = [];
    return text;
  }
}

function childEnvironment(overrides: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides, GIT_TERMINAL_PROMPT: '0' };
  for (const key of ['GIT_SSH_COMMAND', 'GIT_SSH']) {
    if (env[key] === '') {
      delete env[key];
    }
  }
  return env;
}

export async function captureProcess(
  executable: string,
  args: ReadonlyArray<string>,
  options: BoundedProcessOptions,
): Promise<BoundedProcessResult> {
  assertInvocation(executable, args, options);
  const started = performance.now();
  return new Promise((resolvePromise) => {
    const stdout = new OutputBuffer();
    const stderr = new OutputBuffer();
    const grouped = process.platform !== 'win32';
    let outputBytes = 0;
    let retainedBytes = 0;
    let failure: Error | undefined;
    let code: number | null = null;
    let signal: NodeJS.Signals | null = null;
    let closed = false;
    let exited = false;
    let settled = false;
    let terminating = false;
    let escalated = false;
    let overflowing = false;
    let cleanupIncomplete = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let reapDeadline: ReturnType<typeof setTimeout> | undefined;

    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      clearTimeout(escalation);
      clearTimeout(reapDeadline);
      resolvePromise({
        stdout: stdout.text(),
        stderr: stderr.text(),
        code,
        ...(failure === undefined ? {} : { error: failure }),
        signal,
        durationMs: Math.ceil(performance.now() - started),
        outputBytes,
        retainedBytes,
        cleanupIncomplete,
      });
    };

    const deadline = setTimeout(
      () => {
        failure ??= processError('ETIMEDOUT', `process timed out after ${options.timeoutMs}ms (ETIMEDOUT)`);
        terminate();
      },
      Math.max(1, Math.ceil(options.timeoutMs - (performance.now() - started))),
    );

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(executable, [...args], {
        cwd: options.cwd,
        env: childEnvironment(options.env),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: grouped,
        windowsHide: true,
      });
    } catch (error) {
      failure = safeTransportError(error);
      finish();
      return;
    }

    const groupExists = (): boolean => {
      if (!grouped || child.pid === undefined) {
        return false;
      }
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH';
      }
    };

    const sendSignal = (value: NodeJS.Signals): void => {
      try {
        if (grouped && child.pid !== undefined) {
          process.kill(-child.pid, value);
        } else {
          child.kill(value);
        }
      } catch {
        try {
          child.kill(value);
        } catch {
          cleanupIncomplete = true;
        }
      }
    };

    const finishIfClosed = (): void => {
      if (closed && (!terminating || escalated || !groupExists())) {
        finish();
      }
    };

    const terminate = (): void => {
      if (terminating || settled) {
        return;
      }
      terminating = true;
      clearTimeout(deadline);
      sendSignal('SIGTERM');
      escalation = setTimeout(() => {
        escalated = true;
        sendSignal('SIGKILL');
        finishIfClosed();
      }, TERMINATION_GRACE_MS);
      reapDeadline = setTimeout(() => {
        sendSignal('SIGKILL');
        child.stdout?.destroy();
        child.stderr?.destroy();
        if (!exited) {
          cleanupIncomplete = true;
          failure ??= processError('EPROCESS', 'process termination could not be confirmed');
          child.unref();
          finish();
        }
      }, TERMINATION_GRACE_MS + REAP_GRACE_MS);
      finishIfClosed();
    };

    const collect = (target: OutputBuffer, chunk: Buffer): void => {
      if (settled || overflowing) {
        return;
      }
      outputBytes += chunk.length;
      const count = Math.min(chunk.length, options.maxOutputBytes - retainedBytes);
      target.append(chunk, count, options.maxOutputBytes);
      retainedBytes += count;
      if (outputBytes > options.maxOutputBytes) {
        overflowing = true;
        failure ??= processError('ENOBUFS', `process exceeded the ${options.maxOutputBytes}-byte output limit`);
        terminate();
        child.stdout?.destroy();
        child.stderr?.destroy();
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr?.on('data', (chunk: Buffer) => collect(stderr, chunk));
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('error', () => {
        failure ??= processError('EIO', 'process output stream failed (EIO)');
        terminate();
      });
    }
    child.on('error', (error) => {
      failure ??= safeTransportError(error);
      if (child.pid !== undefined) {
        terminate();
      }
    });
    child.on('exit', (exitCode, exitSignal) => {
      exited = true;
      code = exitCode;
      signal = exitSignal;
      if (exitCode !== 0 || exitSignal !== null) {
        terminate();
      }
    });
    child.on('close', () => {
      closed = true;
      finishIfClosed();
    });
  });
}

export function resolveProcessRunner(
  plan: ReleaseTagPlan,
  override?: CapturingProcessRunner,
): CapturingProcessRunner | undefined {
  const runner = override ?? plan.runner;
  if (runner !== undefined && (runner === null || typeof runner.capture !== 'function')) {
    throw new Error('runner must be a CapturingProcessRunner with a capture function');
  }
  return runner;
}

function checkedResult(value: unknown): ProcessCaptureResult {
  try {
    const result = value as ProcessCaptureResult;
    const { stdout, stderr, code, error } = result;
    if (
      typeof stdout === 'string' &&
      typeof stderr === 'string' &&
      (code === null || Number.isSafeInteger(code)) &&
      (error === undefined || error instanceof Error)
    ) {
      return { stdout, stderr, code, ...(error === undefined ? {} : { error: safeTransportError(error) }) };
    }
  } catch {
    throw new Error('runner.capture returned an invalid process result');
  }
  throw new Error('runner.capture must return stdout/stderr strings, an integer or null code, and an optional Error');
}

function truncateTail(text: string, bytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= bytes) {
    return text;
  }
  const buffer = Buffer.from(text, 'utf8');
  let start = buffer.length - bytes;
  while ((buffer[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return `...[truncated] ${buffer.toString('utf8', start)}`;
}

function commandFailure(
  result: BoundedProcessResult,
  options: CommandOptions,
  secrets: ReadonlyArray<string | undefined>,
): Error {
  const safe = (text: string, bytes: number): string => truncateTail(redactText(text, secrets), bytes);
  const details = [
    result.error?.message ??
      (result.signal === null ? `exit code ${String(result.code)}` : `terminated by ${result.signal}`),
    `duration ${result.durationMs}ms`,
  ];
  if (result.cleanupIncomplete) {
    details.push('process cleanup could not be confirmed');
  }
  const outputBudget =
    options.includeStdout && result.stdout.length > 0 && result.stderr.length > 0
      ? DIAGNOSTIC_BYTES / 2
      : DIAGNOSTIC_BYTES;
  if (options.includeOutput !== false && options.includeStdout && result.stdout.trim().length > 0) {
    details.push(`stdout: ${safe(result.stdout.trim(), outputBudget)}`);
  }
  if (options.includeOutput !== false && result.stderr.trim().length > 0) {
    details.push(`stderr: ${safe(result.stderr.trim(), outputBudget)}`);
  }
  if (options.includeOutput === false && (result.stdout.length > 0 || result.stderr.length > 0)) {
    details.push('output omitted while file credential is unresolved');
  }
  return new Error(`${safe(options.failureMessage ?? `${options.label} failed`, 1024)} (${details.join('; ')})`);
}

export async function captureCommand(
  runner: CapturingProcessRunner | undefined,
  plan: ReleaseTagPlan,
  executable: string,
  args: ReadonlyArray<string>,
  options: CommandOptions,
): Promise<ProcessCaptureResult> {
  assertProcessLimits(plan);
  const invocation: BoundedProcessOptions = {
    cwd: plan.cwd,
    timeoutMs: options.timeoutMs ?? plan.timeoutMs,
    maxOutputBytes: plan.maxOutputBytes,
    stdio: 'pipe',
    env: { ...options.env, GIT_TERMINAL_PROMPT: '0' },
  };
  assertInvocation(executable, args, invocation);
  const secrets = [...(options.secrets ?? []), process.env[plan.githubTokenEnv]];
  let result: BoundedProcessResult;
  if (runner === undefined) {
    result = await captureProcess(executable, args, invocation);
  } else {
    const started = performance.now();
    let raw: unknown;
    try {
      raw = await runner.capture(executable, [...args], invocation);
    } catch (error) {
      raw = { stdout: '', stderr: '', code: null, error: safeTransportError(error) };
    }
    let captured: ProcessCaptureResult;
    try {
      captured = checkedResult(raw);
    } catch {
      captured = {
        stdout: '',
        stderr: '',
        code: null,
        error: processError('EPROCESS', 'runner.capture returned an invalid process result'),
      };
    }
    const bytes = Buffer.byteLength(captured.stdout, 'utf8') + Buffer.byteLength(captured.stderr, 'utf8');
    result = {
      ...captured,
      durationMs: Math.ceil(performance.now() - started),
      outputBytes: bytes,
      retainedBytes: bytes,
      signal: null,
      cleanupIncomplete: false,
    };
    if (bytes > invocation.maxOutputBytes) {
      result.stdout = '';
      result.stderr = '';
      result.error = processError(
        'ENOBUFS',
        `runner.capture produced ${bytes} bytes, exceeding the ${invocation.maxOutputBytes}-byte output limit`,
      );
    } else if (result.durationMs > invocation.timeoutMs) {
      result.error = processError(
        'ETIMEDOUT',
        `runner.capture exceeded the ${invocation.timeoutMs}ms deadline (ETIMEDOUT); custom runners own cancellation`,
      );
    }
  }
  if (result.error || result.code === null || !(options.acceptedExitCodes ?? [0]).includes(result.code)) {
    throw commandFailure(result, options, secrets);
  }
  return { stdout: result.stdout, stderr: result.stderr, code: result.code };
}
