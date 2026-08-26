import { isAbsolute, relative, join } from 'node:path';
import {
  mkdir as fsMkdir,
  writeFile as fsWriteFile,
  lstat as fsLstat,
  realpath as fsRealpath,
  rm as fsRm,
} from 'node:fs/promises';
import { loadConfigFile, isPlainObject } from '@repo-toolkit/publish-package';

import { resolveComposeSandboxPlan, type ComposeSandboxPlan } from './plan';
import { runProcess as defaultRunProcess, type Clock as ProcessClock } from './process';
import {
  runLifecycle,
  ComposeSandboxLifecycleError,
  type LifecyclePhase,
  type LifecycleHandlers,
  type Clock as LifecycleClock,
  type SignalTarget,
} from './lifecycle';
import {
  runCompose,
  preflightCompose,
  prepareSandbox,
  getServiceState as defaultGetServiceState,
  startSandbox,
} from './compose';
import {
  waitForReadiness,
  type TcpConnect,
  type HttpFetch,
  type GetServiceState,
  type RunCommandProbe,
} from './readiness';

export interface RunDeps {
  readonly clock?: LifecycleClock & ProcessClock;
  readonly signalTarget?: SignalTarget;
  readonly createAbortController?: () => AbortController;
  readonly runProcess?: typeof defaultRunProcess;
  readonly tcpConnect?: TcpConnect;
  readonly httpFetch?: HttpFetch;
  readonly getServiceState?: GetServiceState;
  readonly runCommandProbe?: RunCommandProbe;
  readonly fs?: {
    mkdir(path: string, opts: { recursive: boolean }): Promise<void>;
    writeFile(path: string, data: string, encoding: string): Promise<void>;
    lstat?: (path: string) => Promise<{ isSymbolicLink(): boolean }>;
    stat?: (path: string) => Promise<{ isSymbolicLink(): boolean }>;
    realpath?: (path: string) => Promise<string>;
    rm?: (path: string, opts: { recursive: boolean; force: boolean }) => Promise<void>;
    unlink?: (path: string) => Promise<void>;
  };
}

export interface RunResult {
  readonly phase: LifecyclePhase;
  readonly outcome: 'success' | 'failure';
  readonly timings: Record<string, number | undefined>;
  readonly evidenceFiles: ReadonlyArray<string>;
  readonly manifestPath: string;
}

function defaultClock(): LifecycleClock & ProcessClock {
  return {
    now: () => Date.now(),
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
  };
}

function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1B\[[0-9;]*m/gu, '');
}

function truncateToBytes(text: string, maxBytes: number): string {
  const len = Buffer.byteLength(text, 'utf8');
  if (len <= maxBytes) return text;
  return Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
}

function sanitizeMessage(msg: string): string {
  return stripAnsi(msg).slice(0, 2000);
}

function redactSecrets(content: string, plan: ComposeSandboxPlan): string {
  let out = content;
  const secrets: string[] = [];
  for (const v of Object.values(plan.test.env)) {
    if (typeof v === 'string' && v.length > 0) secrets.push(v);
  }
  for (const probe of plan.readiness) {
    if (probe.type === 'command') {
      for (const v of Object.values(probe.env)) {
        if (typeof v === 'string' && v.length > 0) secrets.push(v);
      }
    }
  }
  for (const s of secrets) {
    if (s.length === 0) continue;
    out = out.split(s).join('[REDACTED]');
  }
  return out;
}

export async function runComposeSandbox(options: unknown = {}, deps: RunDeps = {}): Promise<void> {
  let mergedOptions: unknown = options;
  if (isPlainObject(options) && typeof (options as Record<string, unknown>).config === 'string') {
    const cfg = options as Record<string, unknown>;
    const configPath = cfg.config as string;
    const cwdHint = typeof cfg.cwd === 'string' ? (cfg.cwd as string) : undefined;
    const loaded = await loadConfigFile<Record<string, unknown>>(configPath, cwdHint);
    const withoutConfig = { ...cfg };
    delete withoutConfig.config;
    mergedOptions = { ...loaded, ...withoutConfig };
  }

  const plan = resolveComposeSandboxPlan(mergedOptions);

  if (plan.dryRun) {
    return;
  }

  const clock = deps.clock ?? defaultClock();
  const signalTarget = deps.signalTarget ?? (process as unknown as SignalTarget);
  const createAbortController = deps.createAbortController ?? (() => new AbortController());
  const runProcessFn = deps.runProcess ?? defaultRunProcess;
  const fs = deps.fs ?? { mkdir: fsMkdir, writeFile: fsWriteFile, lstat: fsLstat, realpath: fsRealpath, rm: fsRm };

  const timings: Record<string, number> = {};
  const evidenceFiles: string[] = [];
  let evidenceError: Error | undefined;
  let cleanupError: Error | undefined;
  const totalStart = clock.now();
  let currentPhase: LifecyclePhase = 'validate';
  let failedPhase: LifecyclePhase | undefined;

  const composeDeps = {
    runProcess: runProcessFn,
    clock,
    fs: fs as never,
  };

  const readinessDeps = {
    clock,
    tcpConnect: deps.tcpConnect,
    httpFetch: deps.httpFetch,
    getServiceState: deps.getServiceState ?? ((svc: string) => defaultGetServiceState(plan, svc, composeDeps)),
    runCommandProbe: deps.runCommandProbe,
  };

  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  let lifecycleController: AbortController | undefined;
  const wrappedCreate = (): AbortController => {
    const c = createAbortController();
    lifecycleController = c;
    if (plan.timeouts.totalMs !== undefined) {
      totalTimer = setTimeout(() => {
        try {
          c.abort(new Error(`total timeout after ${plan.timeouts.totalMs}ms`));
        } catch (_unused) {
          void _unused;
        }
      }, plan.timeouts.totalMs);
      const maybeUnref = totalTimer as unknown as { unref?: () => void };
      if (typeof maybeUnref.unref === 'function') maybeUnref.unref();
    }
    return c;
  };

  const lifecycleCreate = plan.timeouts.totalMs !== undefined ? wrappedCreate : createAbortController;

  const handlers: LifecycleHandlers = {
    validate: async (signal) => {
      currentPhase = 'validate';
      const s = clock.now();
      try {
        if (signal.aborted) throw signal.reason ?? new Error('aborted during validate');
      } catch (err) {
        if (!failedPhase) failedPhase = currentPhase;
        throw err;
      } finally {
        timings.validate = clock.now() - s;
      }
    },
    prepare: async (signal) => {
      currentPhase = 'prepare';
      const s = clock.now();
      try {
        await prepareSandbox(plan, { ...composeDeps, signal } as never);
        if (signal.aborted) throw signal.reason ?? new Error('aborted during prepare');
      } catch (err) {
        if (!failedPhase) failedPhase = currentPhase;
        throw err;
      } finally {
        timings.prepare = clock.now() - s;
      }
    },
    preflight: async (signal) => {
      currentPhase = 'preflight';
      const s = clock.now();
      try {
        await preflightCompose(plan, composeDeps);
        if (signal.aborted) throw signal.reason ?? new Error('aborted during preflight');
      } catch (err) {
        if (!failedPhase) failedPhase = currentPhase;
        throw err;
      } finally {
        timings.preflight = clock.now() - s;
      }
    },
    start: async (signal) => {
      currentPhase = 'start';
      const s = clock.now();
      try {
        await startSandbox(plan, { ...composeDeps, signal });
        if (signal.aborted) throw signal.reason ?? new Error('aborted during start');
      } catch (err) {
        if (!failedPhase) failedPhase = currentPhase;
        throw err;
      } finally {
        timings.start = clock.now() - s;
      }
    },
    readiness: async (signal) => {
      currentPhase = 'readiness';
      const s = clock.now();
      try {
        await waitForReadiness(plan, readinessDeps, signal);
      } catch (err) {
        if (!failedPhase) failedPhase = currentPhase;
        throw err;
      } finally {
        timings.readiness = clock.now() - s;
      }
    },
    test: async (signal) => {
      currentPhase = 'test';
      const s = clock.now();
      try {
        const result = await runProcessFn(
          {
            executable: plan.test.executable,
            args: [...plan.test.args],
            cwd: plan.test.resolvedCwd ?? plan.cwd,
            env: plan.test.env as Record<string, string>,
            timeoutMs: plan.timeouts.testMs,
            signal,
            inheritStdio: true,
            captureOutput: false,
          },
          { clock } as never,
        );
        if (result.timedOut) {
          const err = new Error(`test command timed out after ${plan.timeouts.testMs}ms`);
          (err as unknown as Record<string, unknown>).timedOut = true;
          (err as unknown as Record<string, unknown>).exitCode = result.exitCode;
          throw err;
        }
        if (result.exitCode !== 0) {
          const err = new Error(`test command failed with exitCode ${result.exitCode}`);
          (err as unknown as Record<string, unknown>).exitCode = result.exitCode;
          (err as unknown as Record<string, unknown>).signal = result.signal;
          throw err;
        }
        if (signal.aborted) throw signal.reason ?? new Error('aborted during test');
      } catch (err) {
        if (!failedPhase) failedPhase = currentPhase;
        throw err;
      } finally {
        timings.test = clock.now() - s;
      }
    },
    evidence: async (outcome, signal, primary) => {
      currentPhase = 'evidence';
      const s = clock.now();
      try {
        const shouldCapture = plan.evidence.capture === 'always' || outcome === 'failure' || primary !== undefined;
        if (!shouldCapture) return;
        try {
          await fs.mkdir(plan.evidence.resolvedDirectory, { recursive: true });
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          if (!evidenceError) evidenceError = e;
          throw e;
        }

        let psFailed: Error | undefined;
        try {
          const psResult = await runCompose(
            plan,
            'ps',
            ['-a', '--format', 'json'],
            { captureOutput: true, maxOutputBytes: plan.evidence.maxLogBytes, signal },
            composeDeps,
          );
          let psOutput = psResult.stdout ?? '';
          if (plan.evidence.stripAnsi) psOutput = stripAnsi(psOutput);
          psOutput = truncateToBytes(psOutput, plan.evidence.maxLogBytes);
          const psPath = join(plan.evidence.resolvedDirectory, 'ps.json');
          await fs.writeFile(psPath, psOutput, 'utf8');
          if (!evidenceFiles.includes('ps.json')) evidenceFiles.push('ps.json');
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          psFailed = e;
          if (!evidenceError) evidenceError = e;
        }

        let logsFailed: Error | undefined;
        try {
          const logsResult = await runCompose(
            plan,
            'logs',
            ['--no-color'],
            { captureOutput: true, maxOutputBytes: plan.evidence.maxLogBytes, signal },
            composeDeps,
          );
          let combined = logsResult.stdout ?? '';
          if (logsResult.stderr) combined += (combined ? '\n' : '') + logsResult.stderr;
          if (plan.evidence.stripAnsi) combined = stripAnsi(combined);
          combined = truncateToBytes(combined, plan.evidence.maxLogBytes);
          const logsPath = join(plan.evidence.resolvedDirectory, 'logs.txt');
          await fs.writeFile(logsPath, combined, 'utf8');
          if (!evidenceFiles.includes('logs.txt')) evidenceFiles.push('logs.txt');
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          logsFailed = e;
          if (!evidenceError) evidenceError = e;
        }

        if (psFailed || logsFailed) {
          const first = psFailed ?? (logsFailed as Error);
          throw first;
        }
      } catch (err) {
        if (!failedPhase) failedPhase = currentPhase;
        throw err;
      } finally {
        timings.evidence = clock.now() - s;
      }
    },
    cleanup: async (signal) => {
      currentPhase = 'cleanup';
      const s = clock.now();
      try {
        const downArgs: string[] = [];
        if (plan.cleanup.volumes) downArgs.push('--volumes');
        if (plan.cleanup.removeOrphans) downArgs.push('--remove-orphans');
        try {
          await runCompose(
            plan,
            'down',
            downArgs,
            { timeoutMs: plan.timeouts.cleanupMs, signal, captureOutput: true, maxOutputBytes: 65536 },
            composeDeps,
          );
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          if (!cleanupError) cleanupError = e;
          throw e;
        }

        for (let i = 0; i < plan.cleanup.paths.length; i += 1) {
          const rel = plan.cleanup.paths[i] as string;
          const resolved = plan.cleanup.resolvedPaths[i] as string;
          if (resolved === plan.cwd) {
            const e = new Error(`cleanup path resolves to project root: ${rel}`);
            if (!cleanupError) cleanupError = e;
            throw e;
          }
          const relToCwd = relative(plan.cwd, resolved);
          if (relToCwd.startsWith('..') || isAbsolute(relToCwd)) {
            const e = new Error(`cleanup path escapes project root: ${rel}`);
            if (!cleanupError) cleanupError = e;
            throw e;
          }
          try {
            const fsAny = fs as unknown as {
              lstat?: (p: string) => Promise<{ isSymbolicLink(): boolean }>;
              stat?: (p: string) => Promise<{ isSymbolicLink(): boolean }>;
            };
            const lstatFn = fsAny.lstat ?? fsAny.stat;
            if (lstatFn) {
              let st: { isSymbolicLink(): boolean } | undefined;
              try {
                st = await (lstatFn as (p: string) => Promise<{ isSymbolicLink(): boolean }>)(resolved);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes('ENOENT') || msg.toLowerCase().includes('no such file')) {
                  continue;
                }
                throw err;
              }
              if (st && typeof st.isSymbolicLink === 'function' && st.isSymbolicLink()) {
                const realpathFn = (fs as unknown as { realpath?: (p: string) => Promise<string> }).realpath;
                if (realpathFn) {
                  let target = '';
                  try {
                    target = await realpathFn(resolved);
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (msg.includes('ENOENT') || msg.toLowerCase().includes('no such file')) {
                      continue;
                    }
                    throw err;
                  }
                  const relTarget = relative(plan.cwd, target);
                  if (relTarget.startsWith('..') || isAbsolute(relTarget)) {
                    const e = new Error(`cleanup path symlink target outside project: ${rel} -> ${target}`);
                    if (!cleanupError) cleanupError = e;
                    throw e;
                  }
                } else {
                  const e = new Error(`cleanup path is symlink without realpath check: ${rel}`);
                  if (!cleanupError) cleanupError = e;
                  throw e;
                }
              }
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (
              msg.includes('symlink target outside') ||
              msg.includes('escapes') ||
              msg.includes('project root') ||
              msg.includes('without realpath')
            ) {
              throw err;
            }
            const isEnoent = msg.includes('ENOENT') || msg.toLowerCase().includes('no such file');
            if (isEnoent) continue;
          }

          try {
            const fsAny2 = fs as unknown as {
              rm?: (p: string, opts: { recursive: boolean; force: boolean }) => Promise<void>;
              unlink?: (p: string) => Promise<void>;
            };
            const rmFn = fsAny2.rm;
            if (rmFn) {
              await rmFn(resolved, { recursive: true, force: true });
            } else if (fsAny2.unlink) {
              await (fsAny2.unlink as (p: string) => Promise<void>)(resolved);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('ENOENT') || msg.toLowerCase().includes('no such file')) {
              continue;
            }
            const e = err instanceof Error ? err : new Error(String(err));
            if (!cleanupError) cleanupError = e;
            throw e;
          }
        }
      } catch (err) {
        if (!failedPhase) failedPhase = currentPhase;
        throw err;
      } finally {
        timings.cleanup = clock.now() - s;
      }
    },
  };

  // eslint-disable-next-line no-useless-assignment
  let lifecyclePhase: LifecyclePhase = currentPhase;
  let primaryError: Error | undefined;
  let secondaryError: Error | undefined;
  // eslint-disable-next-line no-useless-assignment
  let lifecycleSuccess = false;

  try {
    const result = await runLifecycle(handlers, { clock, signalTarget, createAbortController: lifecycleCreate });
    lifecycleSuccess = true;
    lifecyclePhase = result.phase;
  } catch (err) {
    lifecycleSuccess = false;
    if (err instanceof ComposeSandboxLifecycleError) {
      primaryError = err.primary;
      secondaryError = err.secondary;
      lifecyclePhase = err.phase;
    } else if (err instanceof Error) {
      primaryError = err;
      lifecyclePhase = failedPhase ?? currentPhase;
      if (evidenceError && !secondaryError && evidenceError !== primaryError) {
        secondaryError = evidenceError;
      } else if (cleanupError && !secondaryError && cleanupError !== primaryError) {
        secondaryError = cleanupError;
      } else if (lifecycleController?.signal.aborted && lifecycleController.signal.reason) {
        const reason = lifecycleController.signal.reason as Error;
        if (reason.message.includes('total timeout') && !primaryError) {
          primaryError = reason;
        }
      }
    } else {
      primaryError = new Error(String(err));
      lifecyclePhase = failedPhase ?? currentPhase;
    }
    if (primaryError && !secondaryError) {
      if (evidenceError && evidenceError !== primaryError) secondaryError = evidenceError;
      else if (cleanupError && cleanupError !== primaryError) secondaryError = cleanupError;
    }
    if (primaryError && secondaryError === undefined) {
      if (evidenceError && evidenceError !== primaryError) secondaryError = evidenceError;
    }
  }

  if (totalTimer) clearTimeout(totalTimer);
  timings.total = clock.now() - totalStart;

  const manifestPhase = primaryError ? lifecyclePhase : 'cleanup';
  const outcome: 'success' | 'failure' = primaryError ? 'failure' : 'success';

  const manifestEvidenceFiles = [...evidenceFiles];
  if (!manifestEvidenceFiles.includes('result.json')) manifestEvidenceFiles.push('result.json');

  const manifest: Record<string, unknown> = {
    phase: manifestPhase,
    outcome,
    timings: {
      total: timings.total,
      validate: timings.validate,
      prepare: timings.prepare,
      preflight: timings.preflight,
      start: timings.start,
      readiness: timings.readiness,
      test: timings.test,
      evidence: timings.evidence,
      cleanup: timings.cleanup,
    },
    evidenceFiles: manifestEvidenceFiles,
    errors: {
      primary: primaryError ? sanitizeMessage(primaryError.message) : undefined,
      secondary: secondaryError ? sanitizeMessage(secondaryError.message) : undefined,
    },
  };

  let manifestContent = JSON.stringify(manifest, null, 2);
  manifestContent = redactSecrets(manifestContent, plan);

  try {
    await fs.mkdir(plan.evidence.resolvedDirectory, { recursive: true });
    const manifestPath = join(plan.evidence.resolvedDirectory, 'result.json');
    await fs.writeFile(manifestPath, manifestContent, 'utf8');
    if (!evidenceFiles.includes('result.json')) evidenceFiles.push('result.json');
  } catch (err) {
    const me = err instanceof Error ? err : new Error(String(err));
    if (!primaryError) {
      primaryError = me;
      lifecyclePhase = 'evidence';
    } else if (!secondaryError) {
      secondaryError = me;
    }
  }

  if (primaryError) {
    if (secondaryError) {
      throw new ComposeSandboxLifecycleError(lifecyclePhase, primaryError, secondaryError);
    }
    throw primaryError;
  }

  void lifecycleSuccess;
}
