import { join } from 'node:path';

import { loadAndMergeComposeSandboxOptions } from './config';
import { isProcessSuccess, runProcess as defaultRunProcess, type Clock as ProcessClock } from './process';
import {
  runLifecycle,
  ComposeSandboxLifecycleError,
  type LifecyclePhase,
  type LifecycleHandlers,
  type Clock as LifecycleClock,
  type SignalTarget,
} from './lifecycle';
import {
  preflightCompose,
  prepareSandbox,
  getServiceState as defaultGetServiceState,
  getServiceSnapshot as defaultGetServiceSnapshot,
  startSandbox,
  type ComposeDeps,
} from './compose';
import {
  waitForReadiness,
  type TcpConnect,
  type HttpFetch,
  type GetServiceState,
  type GetServiceSnapshot,
  type RunCommandProbe,
} from './readiness';
import { createDefaultFs, ensurePathInsideRoot, resolveRealRoot, type SandboxFs } from './fs';
import { createDefaultClock, getScheduler, type Clock } from './clock';
import { collectSecrets, redactManifestObject, safeEmit } from './redact';
import type { Logger } from './redact';
import { runPhase } from './phase';
import { collectEvidence } from './evidence';
import { performCleanup } from './cleanup';

export { loadAndMergeComposeSandboxOptions, mergeComposeSandboxOptions } from './config';
export type { Logger } from './redact';

export interface RunDeps {
  readonly clock?: Clock;
  readonly signalTarget?: SignalTarget;
  readonly createAbortController?: () => AbortController;
  readonly runProcess?: typeof defaultRunProcess;
  readonly tcpConnect?: TcpConnect;
  readonly httpFetch?: HttpFetch;
  readonly getServiceState?: GetServiceState;
  readonly getServiceSnapshot?: GetServiceSnapshot;
  readonly runCommandProbe?: RunCommandProbe;
  readonly logger?: Logger;
  readonly fs?: SandboxFs;
}

export interface RunResult {
  readonly phase: LifecyclePhase;
  readonly outcome: 'success' | 'failure';
  readonly timings: Record<string, number | undefined>;
  readonly evidenceFiles: ReadonlyArray<string>;
  readonly manifestPath: string;
}

function defaultClock(): Clock {
  return createDefaultClock();
}

export async function runComposeSandbox(options: unknown = {}, deps: RunDeps = {}): Promise<RunResult> {
  const { plan } = await loadAndMergeComposeSandboxOptions(options);
  const logger = deps.logger;
  let composeVersion = '';

  const composeInvocation = [plan.compose.executable, ...plan.compose.prefixArgs].join(' ').trim();
  if (plan.dryRun) {
    safeEmit(
      `[compose-sandbox] dry-run cwd=${plan.cwd} files=${plan.compose.files.join(', ')} project=${plan.compose.projectName ?? '-'} compose=${composeInvocation}`,
      logger,
      plan,
    );
    return {
      phase: 'validate',
      outcome: 'success',
      timings: {},
      evidenceFiles: Object.freeze([]),
      manifestPath: join(plan.evidence.resolvedDirectory, 'result.json'),
    };
  }

  safeEmit(
    `[compose-sandbox] starting cwd=${plan.cwd} files=${plan.compose.files.join(', ')} project=${plan.compose.projectName ?? '-'} evidence=${plan.evidence.directory} compose=${composeInvocation}`,
    logger,
    plan,
  );

  const clock = deps.clock ?? defaultClock();
  const signalTarget = deps.signalTarget ?? (process as unknown as SignalTarget);
  const createAbortController = deps.createAbortController ?? (() => new AbortController());
  const runProcessFn = deps.runProcess ?? defaultRunProcess;
  const fs = deps.fs ?? createDefaultFs();
  const realRoot = await resolveRealRoot(plan.cwd, fs);

  const timings: Record<string, number> = {};
  const evidenceFiles: string[] = [];
  let evidenceError: Error | undefined;
  let cleanupError: Error | undefined;
  const totalStart = clock.now();
  let currentPhase: LifecyclePhase = 'validate';

  const composeDeps: ComposeDeps = {
    runProcess: runProcessFn,
    clock,
    fs,
  };

  const readinessDeps: {
    readonly clock: typeof clock;
    readonly tcpConnect?: TcpConnect;
    readonly httpFetch?: HttpFetch;
    readonly getServiceState?: GetServiceState;
    readonly getServiceSnapshot?: GetServiceSnapshot;
    readonly runCommandProbe?: RunCommandProbe;
  } = {
    clock,
    tcpConnect: deps.tcpConnect,
    httpFetch: deps.httpFetch,
    getServiceState:
      deps.getServiceState ??
      ((svc: string, opts?: { signal?: AbortSignal; timeoutMs?: number }) =>
        defaultGetServiceState(plan, svc, composeDeps, opts)),
    getServiceSnapshot:
      deps.getServiceSnapshot ??
      ((opts?: { signal?: AbortSignal; timeoutMs?: number }) => defaultGetServiceSnapshot(plan, composeDeps, opts)),
    runCommandProbe: deps.runCommandProbe,
  };

  const scheduler = getScheduler(clock as unknown as LifecycleClock & ProcessClock);
  let totalTimer: unknown | undefined;
  let lifecycleController: AbortController | undefined;
  const wrappedCreate = (): AbortController => {
    const c = createAbortController();
    lifecycleController = c;
    if (plan.timeouts.totalMs !== undefined) {
      totalTimer = scheduler.setTimeout(() => {
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

  function remainingTotalMs(): number | undefined {
    if (plan.timeouts.totalMs === undefined) return undefined;
    const elapsed = clock.now() - totalStart;
    const rem = plan.timeouts.totalMs - elapsed;
    return rem <= 0 ? 0 : rem;
  }

  function clampedTimeout(explicitMs: number): number {
    const rem = remainingTotalMs();
    if (rem === undefined) return explicitMs;
    if (rem <= 0) return explicitMs;
    return Math.min(explicitMs, rem);
  }

  const failedPhaseRef: { value: LifecyclePhase | undefined } = { value: undefined };

  const handlers: LifecycleHandlers = {
    validate: async (signal) => {
      currentPhase = 'validate';
      await runPhase('validate', clock, logger, plan, timings, failedPhaseRef, async () => {
        if (signal.aborted) throw signal.reason ?? new Error('aborted during validate');
        safeEmit(`[compose-sandbox] validate files=${plan.compose.files.join(', ')} cwd=${plan.cwd}`, logger, plan);
      });
    },
    prepare: async (signal) => {
      currentPhase = 'prepare';
      await runPhase('prepare', clock, logger, plan, timings, failedPhaseRef, async () => {
        safeEmit(
          `[compose-sandbox] prepare directories=${plan.prepare.directories.length} copies=${plan.prepare.copies.length}`,
          logger,
          plan,
        );
        await prepareSandbox(plan, composeDeps);
        if (signal.aborted) throw signal.reason ?? new Error('aborted during prepare');
      });
    },
    preflight: async (signal) => {
      currentPhase = 'preflight';
      await runPhase('preflight', clock, logger, plan, timings, failedPhaseRef, async () => {
        safeEmit(`[compose-sandbox] preflight ${composeInvocation} version`, logger, plan);
        const preflightBudget = clampedTimeout(plan.timeouts.cleanupMs);
        composeVersion = await preflightCompose(plan, composeDeps, { signal, timeoutMs: preflightBudget });
        safeEmit(`[compose-sandbox] preflight version: ${composeVersion}`, logger, plan);
        if (signal.aborted) throw signal.reason ?? new Error('aborted during preflight');
      });
    },
    start: async (signal) => {
      currentPhase = 'start';
      await runPhase('start', clock, logger, plan, timings, failedPhaseRef, async () => {
        safeEmit(
          `[compose-sandbox] start ${composeInvocation} up -d project=${plan.compose.projectName ?? '-'} build=${String(plan.compose.build)} pull=${String(plan.compose.pull)}`,
          logger,
          plan,
        );
        await startSandbox(plan, { ...composeDeps, signal });
        if (signal.aborted) throw signal.reason ?? new Error('aborted during start');
      });
    },
    readiness: async (signal) => {
      currentPhase = 'readiness';
      await runPhase('readiness', clock, logger, plan, timings, failedPhaseRef, async () => {
        const probeSummary =
          plan.readiness.length === 0
            ? 'none'
            : plan.readiness
                .map((p) => {
                  const rec = p as unknown as Record<string, unknown>;
                  if (p.type === 'tcp' && typeof rec.port === 'number') return `${p.type}:${String(rec.port)}`;
                  if (p.type === 'http' && typeof rec.url === 'string') return `${p.type}:${String(rec.url)}`;
                  if (
                    (p.type === 'service-running' || p.type === 'service-completed') &&
                    typeof rec.service === 'string'
                  )
                    return `${p.type}:${String(rec.service)}`;
                  if (p.type === 'command' && typeof rec.executable === 'string')
                    return `${p.type}:${String(rec.executable)}`;
                  return p.type;
                })
                .join(', ');
        safeEmit(`[compose-sandbox] readiness ${plan.readiness.length} probe(s): ${probeSummary}`, logger, plan);
        await waitForReadiness(plan, readinessDeps, signal);
        safeEmit(`[compose-sandbox] readiness all probes passed`, logger, plan);
      });
    },
    test: async (signal) => {
      currentPhase = 'test';
      await runPhase('test', clock, logger, plan, timings, failedPhaseRef, async () => {
        safeEmit(
          `[compose-sandbox] test ${plan.test.executable} ${plan.test.args.join(' ')} cwd=${plan.test.resolvedCwd ?? plan.cwd}`,
          logger,
          plan,
        );
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
          { clock },
        );
        if (result.timedOut) {
          const err = new Error(`test command timed out after ${plan.timeouts.testMs}ms`);
          (err as unknown as Record<string, unknown>).timedOut = true;
          (err as unknown as Record<string, unknown>).exitCode = result.exitCode;
          throw err;
        }
        if (!isProcessSuccess(result)) {
          const err = new Error(`test command failed with exitCode ${result.exitCode} signal ${result.signal}`);
          (err as unknown as Record<string, unknown>).exitCode = result.exitCode;
          (err as unknown as Record<string, unknown>).signal = result.signal;
          throw err;
        }
        if (signal.aborted) throw signal.reason ?? new Error('aborted during test');
        safeEmit(
          `[compose-sandbox] test exitCode=${result.exitCode} ${result.timedOut ? 'timedOut' : ''} duration=${timings.test ?? 0}ms`,
          logger,
          plan,
        );
      });
    },
    evidence: async (outcome, signal, primary) => {
      currentPhase = 'evidence';
      await runPhase('evidence', clock, logger, plan, timings, failedPhaseRef, async () => {
        const shouldCapture = plan.evidence.capture === 'always' || outcome === 'failure' || primary !== undefined;
        if (!shouldCapture) {
          safeEmit(`[compose-sandbox] evidence skip capture=${plan.evidence.capture} outcome=${outcome}`, logger, plan);
          return;
        }
        safeEmit(
          `[compose-sandbox] evidence capture=${plan.evidence.capture} outcome=${outcome} dir=${plan.evidence.directory} stripAnsi=${String(plan.evidence.stripAnsi)}`,
          logger,
          plan,
        );
        try {
          const evidenceBudget = clampedTimeout(plan.timeouts.cleanupMs);
          await collectEvidence(plan, { ...composeDeps, fs }, realRoot, logger, signal, evidenceBudget, evidenceFiles);
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          if (!evidenceError) evidenceError = e;
          throw e;
        }
      });
    },
    cleanup: async (signal) => {
      currentPhase = 'cleanup';
      await runPhase('cleanup', clock, logger, plan, timings, failedPhaseRef, async () => {
        try {
          const cleanupBudget = clampedTimeout(plan.timeouts.cleanupMs);
          await performCleanup(plan, { ...composeDeps, fs }, realRoot, logger, signal, cleanupBudget);
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          if (!cleanupError) cleanupError = e;
          throw e;
        }
      });
    },
  };

  // eslint-disable-next-line no-useless-assignment
  let lifecyclePhase: LifecyclePhase = currentPhase;
  let primaryError: Error | undefined;
  let secondaryError: Error | undefined;
  // eslint-disable-next-line no-useless-assignment
  let lifecycleSuccess = false;

  try {
    const result = await runLifecycle(handlers, {
      clock,
      signalTarget,
      createAbortController: lifecycleCreate,
      totalMs: plan.timeouts.totalMs,
      cleanupMs: plan.timeouts.cleanupMs,
      evidenceMs: plan.timeouts.cleanupMs,
      preflightMs: plan.timeouts.cleanupMs,
    });
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
      lifecyclePhase = failedPhaseRef.value ?? currentPhase;
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
      lifecyclePhase = failedPhaseRef.value ?? currentPhase;
    }
    if (primaryError && !secondaryError) {
      if (evidenceError && evidenceError !== primaryError) secondaryError = evidenceError;
      else if (cleanupError && cleanupError !== primaryError) secondaryError = cleanupError;
    }
    if (primaryError && secondaryError === undefined) {
      if (evidenceError && evidenceError !== primaryError) secondaryError = evidenceError;
    }
  }

  if (totalTimer) scheduler.clearTimeout(totalTimer);
  timings.total = clock.now() - totalStart;

  const manifestPhase: LifecyclePhase = primaryError ? lifecyclePhase : 'cleanup';
  const outcome: 'success' | 'failure' = primaryError ? 'failure' : 'success';

  const secrets = collectSecrets(plan);
  let manifestPathForLog = join(plan.evidence.resolvedDirectory, 'result.json');
  let manifestWritten: boolean;
  let finalEvidenceFiles: string[];
  let finalOutcome: 'success' | 'failure';
  let finalPhase: LifecyclePhase;

  try {
    await ensurePathInsideRoot(plan.evidence.resolvedDirectory, realRoot, fs);
    await fs.mkdir(plan.evidence.resolvedDirectory, { recursive: true });
    const manifestPath = join(plan.evidence.resolvedDirectory, 'result.json');
    await ensurePathInsideRoot(manifestPath, realRoot, fs);
    manifestPathForLog = manifestPath;
    const optimisticEvidenceFiles = [...evidenceFiles];
    if (!optimisticEvidenceFiles.includes('result.json')) optimisticEvidenceFiles.push('result.json');
    const rawManifest: Record<string, unknown> = {
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
      evidenceFiles: optimisticEvidenceFiles,
      errors: {
        primary: primaryError ? primaryError.message : undefined,
        secondary: secondaryError ? secondaryError.message : undefined,
      },
    };
    const redactedManifest = redactManifestObject(rawManifest, secrets);
    const manifestContent = JSON.stringify(redactedManifest, null, 2);
    await fs.writeFile(manifestPath, manifestContent, 'utf8');
    if (!evidenceFiles.includes('result.json')) evidenceFiles.push('result.json');
    finalEvidenceFiles = [...evidenceFiles];
    manifestWritten = true;
    finalOutcome = outcome;
    finalPhase = manifestPhase;
  } catch (err) {
    const me = err instanceof Error ? err : new Error(String(err));
    manifestWritten = false;
    finalEvidenceFiles = [...evidenceFiles];
    if (!primaryError) {
      primaryError = me;
      // eslint-disable-next-line no-useless-assignment
      lifecyclePhase = 'evidence';
      finalPhase = 'evidence';
      finalOutcome = 'failure';
    } else {
      if (!secondaryError) secondaryError = me;
      finalOutcome = 'failure';
      finalPhase = manifestPhase;
      if (outcome === 'success') finalPhase = 'evidence';
    }
  }

  const summaryIcon = finalOutcome === 'success' ? '✅' : '❌';
  safeEmit(
    `[compose-sandbox] ${summaryIcon} ${finalOutcome} phase=${finalPhase} total=${timings.total ?? 0}ms`,
    logger,
    plan,
  );
  if (composeVersion) safeEmit(`[compose-sandbox] version: ${composeVersion}`, logger, plan);
  safeEmit(
    `[compose-sandbox] timings validate=${timings.validate ?? 0}ms prepare=${timings.prepare ?? 0}ms preflight=${timings.preflight ?? 0}ms start=${timings.start ?? 0}ms readiness=${timings.readiness ?? 0}ms test=${timings.test ?? 0}ms evidence=${timings.evidence ?? 0}ms cleanup=${timings.cleanup ?? 0}ms`,
    logger,
    plan,
  );
  safeEmit(
    `[compose-sandbox] evidence dir=${plan.evidence.directory} files=${finalEvidenceFiles.join(', ')}`,
    logger,
    plan,
  );
  safeEmit(`[compose-sandbox] manifest ${manifestPathForLog}`, logger, plan);
  if (primaryError) safeEmit(`[compose-sandbox] primary error: ${primaryError.message}`, logger, plan);
  if (secondaryError) safeEmit(`[compose-sandbox] secondary error: ${secondaryError.message}`, logger, plan);

  if (primaryError) {
    if (secondaryError) {
      throw new ComposeSandboxLifecycleError(finalPhase, primaryError, secondaryError);
    }
    throw primaryError;
  }

  void lifecycleSuccess;
  void manifestWritten;
  const result: RunResult = {
    phase: finalPhase,
    outcome: finalOutcome,
    timings: { ...timings },
    evidenceFiles: Object.freeze([...finalEvidenceFiles]),
    manifestPath: manifestPathForLog,
  };
  return result;
}
