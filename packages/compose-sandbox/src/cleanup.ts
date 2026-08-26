import type { ComposeSandboxPlan } from './plan';
import type { ComposeDeps } from './compose';
import { assertComposeSuccess, runCompose } from './compose';
import { ensurePathInsideRoot, isEnoent, type CleanupFs } from './fs';
import { safeEmit, type Logger } from './redact';

export interface CleanupServiceDeps extends Pick<ComposeDeps, 'runProcess' | 'clock'> {
  readonly fs: CleanupFs;
}

export async function performCleanup(
  plan: ComposeSandboxPlan,
  deps: CleanupServiceDeps,
  realRoot: string,
  logger: Logger | undefined,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  const downArgs: string[] = [];
  if (plan.cleanup.volumes) downArgs.push('--volumes');
  if (plan.cleanup.removeOrphans) downArgs.push('--remove-orphans');
  safeEmit(
    `[compose-sandbox] cleanup down ${downArgs.join(' ') || '(no extra flags)'} paths=${plan.cleanup.paths.join(', ') || 'none'}`,
    logger,
    plan,
  );
  const composeDeps: Pick<ComposeDeps, 'runProcess' | 'clock'> = {
    runProcess: deps.runProcess,
    clock: deps.clock,
  };
  try {
    const downResult = await runCompose(
      plan,
      'down',
      downArgs,
      { timeoutMs, signal, captureOutput: true, maxOutputBytes: 65536 },
      composeDeps,
    );
    assertComposeSuccess(downResult, 'down');
    safeEmit(`[compose-sandbox] cleanup compose down ok`, logger, plan);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    throw e;
  }

  for (let i = 0; i < plan.cleanup.paths.length; i += 1) {
    const rel = plan.cleanup.paths[i] as string;
    const resolved = plan.cleanup.resolvedPaths[i] as string;
    if (resolved === plan.cwd) {
      throw new Error(`cleanup path resolves to project root: ${rel}`);
    }
    await ensurePathInsideRoot(resolved, realRoot, deps.fs);
    try {
      await deps.fs.rm(resolved, { recursive: true, force: true });
    } catch (err) {
      if (isEnoent(err)) continue;
      const e = err instanceof Error ? err : new Error(String(err));
      throw e;
    }
  }
}
