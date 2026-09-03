import { execFileSync, spawn } from 'node:child_process';

export interface ProcessRunOptions {
  /** Working directory for the spawned process. */
  cwd: string;
  /**
   * Inherit stdio from the parent process. Defaults to `true`, matching the
   * behavior of {@link defaultProcessRunner}. When `stdio` is provided it takes
   * precedence.
   */
  stdio?: 'inherit' | 'pipe' | 'ignore';
  /**
   * Extra environment variables merged on top of `process.env` for the spawn.
   * Used to pass secrets (e.g. the npm OTP) out of argv.
   */
  env?: Record<string, string>;
}

export interface ProcessRunner {
  /**
   * Run an executable with an explicit argument list. Never invokes a shell,
   * so it is safe for arbitrary values.
   */
  run(executable: string, args: ReadonlyArray<string>, options: ProcessRunOptions): void;
  /**
   * Run a shell command via `bash -c`. The minimum supported platform contract
   * is Node 20 with `bash` available on `PATH`; the runner makes this explicit
   * rather than routing structured commands through a shell implicitly.
   */
  runShell(command: string, options: ProcessRunOptions): void;
}

export interface ProcessCaptureOptions extends ProcessRunOptions {
  /** Optional timeout; on expiry the child is killed and the result carries an `ETIMEDOUT` error. */
  timeoutMs?: number;
}

export interface ProcessCaptureResult {
  /** Captured standard output (may be empty). */
  stdout: string;
  /** Captured standard error (may be empty). */
  stderr: string;
  /** Exit code, or `null` when the process was terminated by a signal or failed to spawn. */
  code: number | null;
  /** Spawn failure (e.g. `ENOENT` when the executable is missing) or timeout error, when applicable. */
  error?: Error;
}

/**
 * Optional companion capability for {@link ProcessRunner} implementations that
 * can capture child-process output instead of inheriting stdio. Existing
 * `ProcessRunner` implementations remain valid; consumers that need output
 * (e.g. `npm view --json`) require this capability and can detect it with
 * {@link isCapturingProcessRunner}.
 */
export interface CapturingProcessRunner extends ProcessRunner {
  /**
   * Run an executable with an explicit argument list (never through a shell)
   * and resolve with its captured stdout/stderr/exit code. Must not throw for
   * non-zero exit codes; spawn failures and timeouts are reported via
   * `ProcessCaptureResult.error`.
   */
  capture(
    executable: string,
    args: ReadonlyArray<string>,
    options: ProcessCaptureOptions,
  ): Promise<ProcessCaptureResult>;
}

export function isCapturingProcessRunner(runner: ProcessRunner): runner is CapturingProcessRunner {
  const candidate = runner as Partial<CapturingProcessRunner>;
  return typeof candidate.capture === 'function';
}

function captureProcess(
  executable: string,
  args: ReadonlyArray<string>,
  options: ProcessCaptureOptions,
): Promise<ProcessCaptureResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });

    let stdout = '';
    let stderr = '';
    let failure: Error | undefined;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (err) => {
      failure = err;
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs !== undefined) {
      const timeoutMs = options.timeoutMs;
      timer = setTimeout(() => {
        const timeoutError = new Error(`process timed out after ${timeoutMs}ms`);
        (timeoutError as NodeJS.ErrnoException).code = 'ETIMEDOUT';
        failure = timeoutError;
        child.kill('SIGTERM');
      }, timeoutMs);
    }

    child.on('close', (code) => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resolvePromise({ stdout, stderr, code, error: failure });
    });
  });
}

export const defaultProcessRunner: CapturingProcessRunner = {
  run(executable, args, options) {
    execFileSync(executable, [...args], {
      cwd: options.cwd,
      stdio: options.stdio ?? 'inherit',
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
  },
  runShell(command, options) {
    execFileSync('bash', ['-c', command], {
      cwd: options.cwd,
      stdio: options.stdio ?? 'inherit',
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
  },
  capture: captureProcess,
};
