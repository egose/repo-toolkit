import { mkdir as fsMkdir, access as fsAccess, copyFile as fsCopyFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { ComposeSandboxPlan } from './plan';
import { runProcess, type Clock as ProcessClock, type ProcessResult } from './process';

export interface ComposeArgs {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface ComposeDeps {
  readonly runProcess?: typeof runProcess;
  readonly clock?: Clock | ProcessClock;
  readonly fs?: {
    mkdir(path: string, opts: { recursive: boolean }): Promise<void>;
    copyFile(src: string, dst: string): Promise<void>;
    access(path: string): Promise<void>;
  };
}

function defaultClock(): Clock {
  return {
    now: () => Date.now(),
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
  };
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

  const args: string[] = ['compose'];

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
    deps as never,
  );
}

export async function preflightCompose(plan: ComposeSandboxPlan, deps: ComposeDeps = {}): Promise<void> {
  const runner = deps.runProcess ?? runProcess;
  const { executable, args } = buildComposeArgs(plan, 'version', []);
  let result: ProcessResult;
  try {
    result = await runner(
      { executable, args: [...args], cwd: plan.cwd, captureOutput: true, maxOutputBytes: 65536 },
      deps as never,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`docker compose preflight failed: ${msg}`);
  }
  if (result.exitCode !== 0) {
    const out = (result.stderr || result.stdout || '').trim().slice(0, 500);
    throw new Error(`docker compose version failed with exitCode ${result.exitCode}${out ? `: ${out}` : ''}`);
  }
  const out = `${result.stdout} ${result.stderr}`.toLowerCase();
  if (!out.includes('version')) {
    throw new Error('docker compose version output did not contain version');
  }
}

export async function prepareSandbox(plan: ComposeSandboxPlan, deps: ComposeDeps = {}): Promise<void> {
  const fs = deps.fs ?? { mkdir: fsMkdir, copyFile: fsCopyFile, access: fsAccess };

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

  for (const dir of plan.prepare.resolvedDirectories ?? []) {
    await fs.mkdir(dir, { recursive: true });
  }

  for (const c of plan.prepare.copies ?? []) {
    const parent = dirname(c.resolvedTo);
    await fs.mkdir(parent, { recursive: true });
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

export async function getServiceState(
  plan: ComposeSandboxPlan,
  service: string,
  deps: ComposeDeps = {},
): Promise<{ service: string; state: string; status: string; exitCode?: number; exists: boolean }> {
  const result = await runCompose(
    plan,
    'ps',
    ['-a', '--format', 'json'],
    { captureOutput: true, maxOutputBytes: 1_048_576 },
    deps,
  );
  if (result.exitCode !== 0) {
    const out = (result.stderr || result.stdout || '').trim().slice(0, 1000);
    throw new Error(
      `docker compose ps failed for service ${service} with exitCode ${result.exitCode}${out ? `: ${out}` : ''}`,
    );
  }
  let entries: Array<{ service: string; state: string; status: string; exitCode?: number }>;
  try {
    entries = parseComposePsOutput(result.stdout);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`failed to inspect service ${service}: ${msg}`);
  }
  const found = entries.find((e) => e.service === service);
  if (!found) {
    const available = entries.map((e) => e.service).join(', ');
    throw new Error(
      `service ${service} not found in compose ps output${available ? `; available: ${available}` : '; no services found'}; service may have never been created`,
    );
  }
  return {
    service: found.service,
    state: found.state,
    status: found.status,
    ...(found.exitCode !== undefined ? { exitCode: found.exitCode } : {}),
    exists: true,
  };
}

export async function startSandbox(
  plan: ComposeSandboxPlan,
  deps: ComposeDeps & { signal?: AbortSignal } = {},
): Promise<void> {
  const extra: string[] = ['up', '-d'];
  if (plan.compose.build) extra.push('--build');
  if (plan.compose.pull) extra.push('--pull', 'always');
  extra.push('--remove-orphans');
  const result = await runCompose(
    plan,
    extra,
    [],
    { timeoutMs: plan.timeouts.startupMs, signal: deps.signal, captureOutput: true },
    deps,
  );
  if (result.exitCode !== 0) {
    const out = (result.stderr || result.stdout || '').trim().slice(0, 2000);
    throw new Error(`docker compose up failed with exitCode ${result.exitCode}${out ? `: ${out}` : ''}`);
  }
}

export function _internal() {
  return { defaultClock };
}
