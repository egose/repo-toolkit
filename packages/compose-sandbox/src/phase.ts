import type { Clock } from './clock';
import type { ComposeSandboxPlan } from './plan';
import type { LifecyclePhase } from './lifecycle';
import type { Logger } from './redact';
import { logGroupStart, logGroupEnd, logGroupFail } from './redact';

export async function runPhase(
  name: LifecyclePhase,
  clock: Clock,
  logger: Logger | undefined,
  plan: ComposeSandboxPlan,
  timings: Record<string, number>,
  failedPhaseRef: { value: LifecyclePhase | undefined },
  fn: () => Promise<void>,
): Promise<void> {
  const start = clock.now();
  logGroupStart(name, logger, plan);
  try {
    await fn();
  } catch (err) {
    if (!failedPhaseRef.value) failedPhaseRef.value = name;
    logGroupFail(name, clock.now() - start, err, logger, plan);
    throw err;
  } finally {
    timings[name] = clock.now() - start;
    if (!failedPhaseRef.value || failedPhaseRef.value !== name) logGroupEnd(name, timings[name], logger, plan);
  }
}
