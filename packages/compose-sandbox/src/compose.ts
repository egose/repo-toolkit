import { dirname } from 'node:path';

import type { ComposeSandboxPlan } from './plan';
import { runProcess, type Clock as ProcessClock, type ProcessResult, isProcessSuccess } from './process';
import { truncateUtf8ToBytes } from './output';
import { createDefaultClock, type Clock } from './clock';
import { createDefaultFs, ensurePathInsideRoot, resolveRealRoot, type PrepareFs } from './fs';

export interface ComposeArgs {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
}

export type { Clock } from './clock';

export interface ComposeDeps {
  readonly runProcess?: typeof runProcess;
  readonly clock?: Clock | ProcessClock;
  readonly fs?: PrepareFs;
}

function defaultClock(): Clock {
  return createDefaultClock();
}

export function assertComposeSuccess(result: ProcessResult, subcommand: string | ReadonlyArray<string>): void {
  if (isProcessSuccess(result)) return;
  const cmd = Array.isArray(subcommand) ? subcommand.join(' ') : subcommand;
  const raw = (result.stderr || result.stdout || '').trim();
  const bounded = raw ? truncateUtf8ToBytes(raw, 500) : '';
  throw new Error(
    `docker compose ${cmd} failed: exitCode ${String(result.exitCode)} signal ${String(result.signal)} timedOut ${String(result.timedOut)}${bounded ? `: ${bounded}` : ''}`,
  );
}

export function ensureComposeSuccess(result: ProcessResult, subcommand: string | ReadonlyArray<string>): void {
  assertComposeSuccess(result, subcommand);
}

export function buildComposeArgs(
  plan: ComposeSandboxPlan,
  subcommand: string | ReadonlyArray<string>,
  extraArgs: ReadonlyArray<string> = [],
): ComposeArgs {
  if (!plan || !plan.compose) {
    throw new Error('plan.compose is required');
  }
  const executable = plan.compose.executable;
  if (typeof executable !== 'string' || executable.length === 0) {
    throw new Error('compose.executable must be a non-empty string');
  }
  if (executable.includes('\0')) {
    throw new Error('compose.executable must not contain NUL bytes');
  }
  const subArgs: string[] = Array.isArray(subcommand) ? [...subcommand] : [subcommand];
  if (subArgs.length === 0 || subArgs.some((s) => typeof s !== 'string' || s.length === 0)) {
    throw new Error('subcommand must be a non-empty string or array');
  }
  for (let i = 0; i < subArgs.length; i += 1) {
    const s = subArgs[i] as string;
    if (s.includes('\0')) throw new Error(`subcommand[${i}] must not contain NUL bytes`);
  }
  for (let i = 0; i < extraArgs.length; i += 1) {
    const a = extraArgs[i] as string;
    if (typeof a !== 'string') throw new Error(`extraArgs[${i}] must be a string`);
    if (a.includes('\0')) throw new Error(`extraArgs[${i}] must not contain NUL bytes`);
  }

  const rawPrefix = (plan.compose as unknown as { prefixArgs?: ReadonlyArray<string> }).prefixArgs;
  const prefixArgs: ReadonlyArray<string> = rawPrefix ?? (['compose'] as const);
  for (let i = 0; i < prefixArgs.length; i += 1) {
    const entry = prefixArgs[i] as string;
    if (typeof entry !== 'string') throw new Error(`compose.prefixArgs[${i}] must be a string`);
    if (entry.length === 0) throw new Error(`compose.prefixArgs[${i}] must be non-empty`);
    if (entry.includes('\0')) throw new Error(`compose.prefixArgs[${i}] must not contain NUL bytes`);
  }
  const args: string[] = [...prefixArgs];

  for (const f of plan.compose.resolvedFiles ?? plan.compose.files) {
    args.push('-f', f);
  }
  if (plan.compose.resolvedEnvFile ?? plan.compose.envFile) {
    args.push('--env-file', (plan.compose.resolvedEnvFile ?? plan.compose.envFile) as string);
  }
  if (plan.compose.projectName) {
    args.push('-p', plan.compose.projectName);
  }
  for (const p of plan.compose.profiles ?? []) {
    args.push('--profile', p);
  }

  args.push(...subArgs, ...extraArgs);
  return { executable, args: Object.freeze([...args]) };
}

export async function runCompose(
  plan: ComposeSandboxPlan,
  subcommand: string | ReadonlyArray<string>,
  extraArgs: ReadonlyArray<string> = [],
  options: {
    cwd?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    captureOutput?: boolean;
    maxOutputBytes?: number;
    env?: Readonly<Record<string, string>>;
  } = {},
  deps: ComposeDeps = {},
): Promise<ProcessResult> {
  const { executable, args } = buildComposeArgs(plan, subcommand, extraArgs);
  const runner = deps.runProcess ?? runProcess;
  const processDeps = deps.clock ? { clock: deps.clock as ProcessClock } : undefined;
  return runner(
    {
      executable,
      args: [...args],
      cwd: options.cwd ?? plan.cwd,
      env: options.env,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      captureOutput: options.captureOutput,
      maxOutputBytes: options.maxOutputBytes,
    },
    processDeps,
  );
}

export async function preflightCompose(
  plan: ComposeSandboxPlan,
  deps: ComposeDeps = {},
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  const runner = deps.runProcess ?? runProcess;
  const { executable, args } = buildComposeArgs(plan, 'version', []);
  let result: ProcessResult;
  try {
    const processDeps = deps.clock ? { clock: deps.clock as ProcessClock } : undefined;
    result = await runner(
      {
        executable,
        args: [...args],
        cwd: plan.cwd,
        captureOutput: true,
        maxOutputBytes: 65536,
        signal: opts.signal,
        timeoutMs: opts.timeoutMs,
      },
      processDeps,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`docker compose preflight failed: ${msg}`);
  }
  assertComposeSuccess(result, 'version');
  const combined = `${result.stdout} ${result.stderr}`.trim();
  const outLower = combined.toLowerCase();
  if (!outLower.includes('version')) {
    throw new Error('docker compose version output did not contain version');
  }
  const line = combined.split('\n').find((l) => l.toLowerCase().includes('version')) ?? combined;
  return line.trim().slice(0, 500);
}

export async function prepareSandbox(plan: ComposeSandboxPlan, deps: ComposeDeps = {}): Promise<void> {
  const fs = deps.fs ?? createDefaultFs();

  for (const dir of plan.prepare.resolvedDirectories ?? []) {
    if (dir.includes('\0')) throw new Error(`prepare directory must not contain NUL bytes: ${dir}`);
  }
  for (const c of plan.prepare.copies ?? []) {
    if (c.resolvedFrom.includes('\0') || c.resolvedTo.includes('\0')) {
      throw new Error('prepare copy path must not contain NUL bytes');
    }
  }

  for (const c of plan.prepare.copies ?? []) {
    try {
      await fs.access(c.resolvedFrom);
    } catch {
      throw new Error(`prepare copy source does not exist: ${c.from}`);
    }
  }

  const realRoot = await resolveRealRoot(plan.cwd, fs);

  for (const dir of plan.prepare.resolvedDirectories ?? []) {
    await ensurePathInsideRoot(dir, realRoot, fs);
    await fs.mkdir(dir, { recursive: true });
  }

  for (const c of plan.prepare.copies ?? []) {
    const parent = dirname(c.resolvedTo);
    await ensurePathInsideRoot(parent, realRoot, fs);
    await fs.mkdir(parent, { recursive: true });
    await ensurePathInsideRoot(c.resolvedTo, realRoot, fs);
    await fs.copyFile(c.resolvedFrom, c.resolvedTo);
  }
}

export function parseComposePsOutput(
  output: string,
): Array<{ service: string; state: string; status: string; exitCode?: number }> {
  const trimmed = output.trim();
  if (trimmed.length === 0) return [];
  const entries: Array<{ service: string; state: string; status: string; exitCode?: number }> = [];
  let parsedArray: unknown;
  if (trimmed.startsWith('[')) {
    try {
      parsedArray = JSON.parse(trimmed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`failed to parse compose ps output: ${msg}`);
    }
    if (!Array.isArray(parsedArray)) {
      throw new Error('failed to parse compose ps output: expected array');
    }
    for (let i = 0; i < (parsedArray as unknown[]).length; i += 1) {
      const item = (parsedArray as Record<string, unknown>[])[i] as Record<string, unknown>;
      entries.push(normalizePsEntry(item, i));
    }
    return entries;
  }

  const lines = trimmed.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim();
    if (!line) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line) as Record<string, unknown>;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`failed to parse compose ps output line ${i}: ${msg}`);
    }
    entries.push(normalizePsEntry(obj, i));
  }
  return entries;
}

function normalizePsEntry(
  item: Record<string, unknown>,
  idx: number,
): { service: string; state: string; status: string; exitCode?: number } {
  if (!item || typeof item !== 'object') {
    throw new Error(`failed to parse compose ps output entry ${idx}: not an object`);
  }
  const service = item.Service ?? item.service;
  if (typeof service !== 'string' || service.length === 0) {
    throw new Error(`failed to parse compose ps output entry ${idx}: missing Service`);
  }
  const stateRaw = item.State ?? item.state ?? item.Status ?? '';
  const statusRaw = item.Status ?? item.status ?? '';
  const state = typeof stateRaw === 'string' ? stateRaw : String(stateRaw);
  const status = typeof statusRaw === 'string' ? statusRaw : String(statusRaw);
  let exitCode: number | undefined;
  const ec = item.ExitCode ?? item.exitCode;
  if (typeof ec === 'number' && Number.isSafeInteger(ec)) {
    exitCode = ec;
  } else if (typeof status === 'string') {
    const m = status.match(/Exited \((-?\d+)\)/u);
    if (m && m[1] !== undefined) {
      const n = Number(m[1]);
      if (Number.isSafeInteger(n)) exitCode = n;
    }
  }
  return { service, state: state.toLowerCase(), status, ...(exitCode !== undefined ? { exitCode } : {}) };
}

export async function getServiceSnapshot(
  plan: ComposeSandboxPlan,
  deps: ComposeDeps = {},
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Map<string, { service: string; state: string; status: string; exitCode?: number; exists: boolean }>> {
  const result = await runCompose(
    plan,
    'ps',
    ['-a', '--format', 'json'],
    { captureOutput: true, maxOutputBytes: 1_048_576, signal: opts.signal, timeoutMs: opts.timeoutMs },
    deps,
  );
  assertComposeSuccess(result, 'ps');
  let entries: Array<{ service: string; state: string; status: string; exitCode?: number }>;
  try {
    entries = parseComposePsOutput(result.stdout);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`failed to parse compose ps output: ${msg}`);
  }
  const map = new Map<string, { service: string; state: string; status: string; exitCode?: number; exists: boolean }>();
  for (const e of entries) {
    map.set(e.service, {
      service: e.service,
      state: e.state,
      status: e.status,
      ...(e.exitCode !== undefined ? { exitCode: e.exitCode } : {}),
      exists: true,
    });
  }
  return map;
}

export async function getServiceState(
  plan: ComposeSandboxPlan,
  service: string,
  deps: ComposeDeps = {},
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ service: string; state: string; status: string; exitCode?: number; exists: boolean }> {
  let snapshot: Map<string, { service: string; state: string; status: string; exitCode?: number; exists: boolean }>;
  try {
    snapshot = await getServiceSnapshot(plan, deps, opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('failed to parse')) {
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`failed to inspect service ${service}: ${msg}`);
    }
    throw err;
  }
  const found = snapshot.get(service);
  if (found) return found;
  const available = [...snapshot.keys()].join(', ');
  throw new Error(
    `service ${service} not found in compose ps output${available ? `; available: ${available}` : '; no services found'}; service may have never been created`,
  );
}

export async function startSandbox(
  plan: ComposeSandboxPlan,
  deps: ComposeDeps & { signal?: AbortSignal } = {},
): Promise<void> {
  const extra: string[] = ['up', '-d'];
  if (plan.compose.build) extra.push('--build');
  if (plan.compose.pull) extra.push('--pull', 'always');
  extra.push('--remove-orphans');
  const { signal, ...composeDeps } = deps;
  const result = await runCompose(
    plan,
    extra,
    [],
    { timeoutMs: plan.timeouts.startupMs, signal, captureOutput: true },
    composeDeps,
  );
  assertComposeSuccess(result, extra);
}

export function _internal() {
  return { defaultClock };
}
