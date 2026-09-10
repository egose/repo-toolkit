import { spawnSync } from 'node:child_process';

import { isPlainObject, redactSensitiveValues } from '@repo-toolkit/publish-package';

const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_048_576;
const DEFAULT_KILL_SIGNAL: NodeJS.Signals = 'SIGKILL';
const ERROR_TAIL_MAX_CHARS = 2048;

export interface DockerRunOptions {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdio?: 'inherit' | 'pipe' | 'ignore';
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly killSignal?: NodeJS.Signals;
  readonly secrets?: ReadonlyArray<string | undefined>;
  readonly stdin?: string;
}

export interface DockerRunResult {
  readonly durationMs: number;
}

export interface DockerCaptureResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly outputBytes: number;
}

export interface DockerRunner {
  run(executable: string, args: ReadonlyArray<string>, options: DockerRunOptions): DockerRunResult;
  capture(executable: string, args: ReadonlyArray<string>, options: DockerRunOptions): DockerCaptureResult;
}

export const defaultDockerRunner: DockerRunner = {
  run(executable, args, options) {
    const validated = validateInvocation(executable, args, options);
    const secrets = collectSecrets(options);
    const out = options.stdio ?? 'inherit';
    const start = Date.now();
    const result = spawnSync(executable, validated.args, {
      cwd: options.cwd,
      env: mergeEnv(options.env),
      stdio: options.stdin !== undefined ? ['pipe', out, out] : out,
      encoding: 'utf8',
      timeout: validated.limits.timeoutMs,
      maxBuffer: validated.limits.maxOutputBytes,
      killSignal: validated.limits.killSignal,
      input: options.stdin,
    });
    const durationMs = Date.now() - start;
    assertSuccessful(executable, result, validated.limits, secrets, durationMs);
    return { durationMs };
  },
  capture(executable, args, options) {
    const validated = validateInvocation(executable, args, options);
    const secrets = collectSecrets(options);
    const start = Date.now();
    const result = spawnSync(executable, validated.args, {
      cwd: options.cwd,
      env: mergeEnv(options.env),
      stdio: options.stdin !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: validated.limits.timeoutMs,
      maxBuffer: validated.limits.maxOutputBytes,
      killSignal: validated.limits.killSignal,
      input: options.stdin,
    });
    const durationMs = Date.now() - start;
    assertSuccessful(executable, result, validated.limits, secrets, durationMs);
    const stdout = textOf(result.stdout);
    const stderr = textOf(result.stderr);
    const outputBytes = Buffer.byteLength(stdout, 'utf8') + Buffer.byteLength(stderr, 'utf8');
    if (outputBytes > validated.limits.maxOutputBytes) {
      throw outputOverflowError(executable, validated.limits.maxOutputBytes, secrets, durationMs, stdout, stderr);
    }
    return { stdout, stderr, durationMs, outputBytes };
  },
};

export function validateDockerRunner(value: unknown): asserts value is DockerRunner {
  if (typeof value !== 'object' || value === null) {
    throw new Error('runner must be a DockerRunner object');
  }
  const runner = value as Partial<DockerRunner>;
  if (typeof runner.run !== 'function' || typeof runner.capture !== 'function') {
    throw new Error('runner must implement run() and capture()');
  }
}

export function stripExtraKeys(options: object, extraKeys: ReadonlySet<string>): Record<string, unknown> {
  const stripped: Record<string, unknown> = {};
  for (const key of Object.keys(options)) {
    if (!extraKeys.has(key)) {
      stripped[key] = (options as Record<string, unknown>)[key];
    }
  }
  return stripped;
}

export function resolveDockerRunner(options: unknown, strict = false): DockerRunner {
  if (options === null || typeof options !== 'object') {
    if (strict) {
      throw new Error('options must be an object');
    }
    return defaultDockerRunner;
  }
  const runner = (options as { readonly runner?: unknown }).runner;
  if (runner === undefined) {
    return defaultDockerRunner;
  }
  validateDockerRunner(runner);
  return runner as DockerRunner;
}

export async function runWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Array.isArray(items)) {
    throw new Error('items must be an array');
  }
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('concurrency must be a positive safe integer');
  }
  if (typeof fn !== 'function') {
    throw new Error('fn must be a function');
  }
  const results = new Array<R>(items.length);
  if (items.length === 0) {
    return [];
  }
  let nextIndex = 0;
  let hasFailure = false;
  let firstError: unknown;
  const worker = async (): Promise<void> => {
    while (!hasFailure) {
      const index = nextIndex;
      if (index >= items.length) {
        return;
      }
      nextIndex += 1;
      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        if (!hasFailure) {
          hasFailure = true;
          firstError = error;
        }
      }
    }
  };
  const workerCount = Math.min(limit, items.length);
  const workers: Array<Promise<void>> = [];
  for (let count = 0; count < workerCount; count += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  if (hasFailure) {
    throw firstError;
  }
  return [...results];
}

interface ResolvedLimits {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly killSignal: NodeJS.Signals;
}

interface ValidatedInvocation {
  readonly args: string[];
  readonly limits: ResolvedLimits;
}

function validateInvocation(
  executable: string,
  args: ReadonlyArray<string>,
  options: DockerRunOptions,
): ValidatedInvocation {
  if (typeof executable !== 'string' || executable.length === 0) {
    throw new Error('executable must be a non-empty string');
  }
  if (executable.includes('\0')) {
    throw new Error('executable must not contain NUL bytes');
  }
  if (!Array.isArray(args)) {
    throw new Error('args must be an array of strings');
  }
  const copied: string[] = [];
  for (const entry of args) {
    if (typeof entry !== 'string') {
      throw new Error('args must be an array of strings');
    }
    if (entry.includes('\0')) {
      throw new Error('args must not contain NUL bytes');
    }
    copied.push(entry);
  }
  if (!isPlainObject(options)) {
    throw new Error('options must be an object');
  }
  if (typeof options.cwd !== 'string' || options.cwd.length === 0) {
    throw new Error('options.cwd must be a non-empty string');
  }
  if (options.cwd.includes('\0')) {
    throw new Error('options.cwd must not contain NUL bytes');
  }
  if (
    options.stdio !== undefined &&
    options.stdio !== 'inherit' &&
    options.stdio !== 'pipe' &&
    options.stdio !== 'ignore'
  ) {
    throw new Error("options.stdio must be 'inherit', 'pipe', or 'ignore'");
  }
  if (options.env !== undefined) {
    if (!isPlainObject(options.env)) {
      throw new Error('options.env must be a record of strings');
    }
    for (const key of Object.keys(options.env)) {
      if (typeof options.env[key] !== 'string') {
        throw new Error(`options.env[${JSON.stringify(key)}] must be a string`);
      }
    }
  }
  if (options.secrets !== undefined) {
    if (!Array.isArray(options.secrets)) {
      throw new Error('options.secrets must be an array of strings');
    }
    for (const secret of options.secrets) {
      if (secret !== undefined && typeof secret !== 'string') {
        throw new Error('options.secrets must be an array of strings');
      }
    }
  }
  if (options.stdin !== undefined && typeof options.stdin !== 'string') {
    throw new Error('options.stdin must be a string');
  }
  if (options.killSignal !== undefined && (typeof options.killSignal !== 'string' || options.killSignal.length === 0)) {
    throw new Error('options.killSignal must be a non-empty string');
  }
  return {
    args: copied,
    limits: {
      timeoutMs: options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : positiveInteger(options.timeoutMs, 'timeoutMs'),
      maxOutputBytes:
        options.maxOutputBytes === undefined
          ? DEFAULT_MAX_OUTPUT_BYTES
          : positiveInteger(options.maxOutputBytes, 'maxOutputBytes'),
      killSignal: options.killSignal ?? DEFAULT_KILL_SIGNAL,
    },
  };
}

function mergeEnv(overrides: Readonly<Record<string, string>> | undefined): Record<string, string | undefined> {
  if (overrides === undefined) {
    return { ...process.env };
  }
  return { ...process.env, ...overrides };
}

function collectSecrets(options: DockerRunOptions): string[] {
  const secrets: string[] = [];
  if (options.secrets !== undefined) {
    for (const secret of options.secrets) {
      if (typeof secret === 'string' && secret.length > 0 && secrets.indexOf(secret) < 0) {
        secrets.push(secret);
      }
    }
  }
  if (options.env !== undefined) {
    for (const key of Object.keys(options.env)) {
      const value = options.env[key];
      if (typeof value === 'string' && value.length > 0 && secrets.indexOf(value) < 0) {
        secrets.push(value);
      }
    }
  }
  if (typeof options.stdin === 'string' && options.stdin.length > 0 && secrets.indexOf(options.stdin) < 0) {
    secrets.push(options.stdin);
  }
  return secrets;
}

function positiveInteger(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function truncateTail(text: string): string {
  if (text.length <= ERROR_TAIL_MAX_CHARS) {
    return text;
  }
  return `...[truncated] ${text.slice(text.length - ERROR_TAIL_MAX_CHARS)}`;
}

function errorTail(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout.length > 0) {
    parts.push(`stdout: ${truncateTail(stdout)}`);
  }
  if (stderr.length > 0) {
    parts.push(`stderr: ${truncateTail(stderr)}`);
  }
  return parts.join('\n');
}

function withTail(message: string, stdout: string, stderr: string, secrets: ReadonlyArray<string>): string {
  const tail = errorTail(stdout, stderr);
  const full = tail.length > 0 ? `${message}: ${tail}` : message;
  return redactSensitiveValues(full, secrets);
}

function assertSuccessful(
  executable: string,
  result: ReturnType<typeof spawnSync>,
  limits: ResolvedLimits,
  secrets: ReadonlyArray<string>,
  durationMs: number,
): void {
  const label = JSON.stringify(executable);
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT') {
      throw new Error(
        redactSensitiveValues(
          `Executable ${label} timed out after ${limits.timeoutMs}ms (duration ${durationMs}ms)`,
          secrets,
        ),
      );
    }
    if (code === 'ENOBUFS') {
      throw outputOverflowError(
        executable,
        limits.maxOutputBytes,
        secrets,
        durationMs,
        textOf(result.stdout),
        textOf(result.stderr),
      );
    }
    throw new Error(
      redactSensitiveValues(
        `Executable ${label} failed to start (duration ${durationMs}ms): ${result.error.message}`,
        secrets,
      ),
    );
  }
  if (result.signal !== null) {
    throw new Error(
      withTail(
        `Executable ${label} was terminated by ${result.signal} (duration ${durationMs}ms)`,
        textOf(result.stdout),
        textOf(result.stderr),
        secrets,
      ),
    );
  }
  if (result.status !== 0) {
    throw new Error(
      withTail(
        `Executable ${label} exited with status ${result.status} (duration ${durationMs}ms)`,
        textOf(result.stdout),
        textOf(result.stderr),
        secrets,
      ),
    );
  }
}

function outputOverflowError(
  executable: string,
  maxOutputBytes: number,
  secrets: ReadonlyArray<string>,
  durationMs: number,
  stdout: string,
  stderr: string,
): Error {
  return new Error(
    withTail(
      `Executable ${JSON.stringify(executable)} exceeded the ${maxOutputBytes}-byte output limit (duration ${durationMs}ms)`,
      stdout,
      stderr,
      secrets,
    ),
  );
}
