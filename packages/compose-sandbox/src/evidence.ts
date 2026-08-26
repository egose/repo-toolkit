import { join } from 'node:path';
import type { ComposeSandboxPlan } from './plan';
import type { ComposeDeps } from './compose';
import { assertComposeSuccess, runCompose } from './compose';
import { ensurePathInsideRoot, type EvidenceFs } from './fs';
import { stripAnsi, truncateUtf8ToBytes } from './output';
import { safeEmit, type Logger } from './redact';

export interface EvidenceServiceDeps extends Pick<ComposeDeps, 'runProcess' | 'clock'> {
  readonly fs: EvidenceFs;
}

export async function collectEvidence(
  plan: ComposeSandboxPlan,
  deps: EvidenceServiceDeps,
  realRoot: string,
  logger: Logger | undefined,
  signal: AbortSignal,
  timeoutMs: number,
  evidenceFiles: string[],
): Promise<void> {
  let evidenceError: Error | undefined;
  try {
    await ensurePathInsideRoot(plan.evidence.resolvedDirectory, realRoot, deps.fs);
    await deps.fs.mkdir(plan.evidence.resolvedDirectory, { recursive: true });
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    throw e;
  }

  let psFailed: Error | undefined;
  const composeDeps: Pick<ComposeDeps, 'runProcess' | 'clock'> = {
    runProcess: deps.runProcess,
    clock: deps.clock,
  };
  try {
    const psResult = await runCompose(
      plan,
      'ps',
      ['-a', '--format', 'json'],
      { captureOutput: true, maxOutputBytes: plan.evidence.maxLogBytes, signal, timeoutMs },
      composeDeps,
    );
    assertComposeSuccess(psResult, 'ps');
    let psOutput = psResult.stdout ?? '';
    if (plan.evidence.stripAnsi) psOutput = stripAnsi(psOutput);
    psOutput = truncateUtf8ToBytes(psOutput, plan.evidence.maxLogBytes);
    const psPath = join(plan.evidence.resolvedDirectory, 'ps.json');
    await ensurePathInsideRoot(psPath, realRoot, deps.fs);
    await deps.fs.writeFile(psPath, psOutput, 'utf8');
    if (!evidenceFiles.includes('ps.json')) evidenceFiles.push('ps.json');
    safeEmit(`[compose-sandbox] evidence ps.json ${Buffer.byteLength(psOutput, 'utf8')} bytes`, logger, plan);
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
      { captureOutput: true, maxOutputBytes: plan.evidence.maxLogBytes, signal, timeoutMs },
      composeDeps,
    );
    assertComposeSuccess(logsResult, 'logs');
    let combined = logsResult.stdout ?? '';
    if (logsResult.stderr) combined += (combined ? '\n' : '') + logsResult.stderr;
    if (plan.evidence.stripAnsi) combined = stripAnsi(combined);
    combined = truncateUtf8ToBytes(combined, plan.evidence.maxLogBytes);
    const logsPath = join(plan.evidence.resolvedDirectory, 'logs.txt');
    await ensurePathInsideRoot(logsPath, realRoot, deps.fs);
    await deps.fs.writeFile(logsPath, combined, 'utf8');
    if (!evidenceFiles.includes('logs.txt')) evidenceFiles.push('logs.txt');
    safeEmit(`[compose-sandbox] evidence logs.txt ${Buffer.byteLength(combined, 'utf8')} bytes`, logger, plan);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    logsFailed = e;
    if (!evidenceError) evidenceError = e;
  }

  if (psFailed || logsFailed) {
    const first = (psFailed ?? logsFailed) as Error;
    throw first;
  }
  safeEmit(`[compose-sandbox] evidence files: ${evidenceFiles.join(', ') || 'none'}`, logger, plan);
  void evidenceError;
}
