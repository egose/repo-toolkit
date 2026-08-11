import { execFileSync } from 'node:child_process';

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

export const defaultProcessRunner: ProcessRunner = {
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
};
