import { parseFlags, type FlagSpec, type ParseFlagsResult } from '@repo-toolkit/publish-package';

import { type ComposeSandboxPlan } from './plan';
import { loadAndMergeComposeSandboxOptions } from './config';
import { runComposeSandbox } from './run';
import { ComposeSandboxLifecycleError } from './lifecycle';

export const SPECS: FlagSpec[] = [
  { name: 'config' },
  { name: 'cwd' },
  { name: 'compose-file', repeatable: true },
  { name: 'project-name' },
  { name: 'evidence-dir' },
  { name: 'dry-run', boolean: true },
];

export function printHelp(): void {
  console.log(`repo-toolkit-compose-sandbox

Usage:
  repo-toolkit-compose-sandbox [options]

Options:
  --config <path>          Config file (JSON, .mjs, or .cjs default export)
  --cwd <path>             Project root; overrides config cwd
  --compose-file <path>    Compose file relative to cwd (repeatable; overrides config compose.files)
  --project-name <name>    Compose project name; overrides config compose.projectName
  --evidence-dir <path>    Evidence directory relative to cwd; overrides config evidence.directory
  --dry-run                Resolve and print the redacted plan without running Docker Compose
  -h, --help               Show this help message
`);
}

function collectSecretsForCli(plan: ComposeSandboxPlan): string[] {
  const raw: string[] = [];
  for (const v of Object.values(plan.test.env)) if (typeof v === 'string' && v.length > 0) raw.push(v);
  for (const probe of plan.readiness) {
    if (probe.type === 'command') {
      for (const v of Object.values(probe.env)) if (typeof v === 'string' && v.length > 0) raw.push(v);
    } else if (probe.type === 'http') {
      for (const [k, v] of Object.entries(probe.headers)) {
        const lower = k.toLowerCase();
        if (lower === 'authorization' || lower === 'cookie' || lower.includes('token') || lower.includes('secret')) {
          if (typeof v === 'string' && v.length > 0) raw.push(v);
        }
      }
      try {
        const u = new URL(probe.url);
        if (u.username) raw.push(u.username);
        if (u.password) raw.push(u.password);
        for (const val of u.searchParams.values()) if (val.length > 0) raw.push(val);
      } catch {
        void 0;
      }
    }
  }
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const s of raw)
    if (!seen.has(s)) {
      seen.add(s);
      uniq.push(s);
    }
  uniq.sort((a, b) => b.length - a.length);
  return uniq;
}

function redactStringForCli(content: string, secrets: string[]): string {
  let out = content;
  for (const s of secrets) if (s.length > 0) out = out.split(s).join('[REDACTED]');
  return out;
}

function sanitizeErrorForCli(raw: string, plan?: ComposeSandboxPlan): string {
  let out = raw;
  if (plan) out = redactStringForCli(out, collectSecretsForCli(plan));
  out = out.replace(/\r/gu, ' ').replace(/\n/gu, ' ');
  // eslint-disable-next-line no-control-regex
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/gu, ' ');
  // eslint-disable-next-line no-control-regex
  out = out.replace(/\x1B\[[0-9;]*m/gu, ' ');
  // eslint-disable-next-line no-control-regex
  out = out.replace(/\x1B/gu, ' ');
  if (out.trimStart().startsWith('::')) out = out.replace('::', ': :');
  if (Buffer.byteLength(out, 'utf8') > 2000) out = Buffer.from(out, 'utf8').subarray(0, 2000).toString('utf8');
  return out;
}

export function redactPlanForOutput(plan: ComposeSandboxPlan): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(plan)) as Record<string, unknown>;
  const secrets = collectSecretsForCli(plan);
  const redactEnv = (env: Record<string, unknown> | undefined) => {
    if (!env || typeof env !== 'object') return;
    for (const key of Object.keys(env)) {
      const v = env[key];
      if (typeof v === 'string' && v.length > 0) {
        env[key] = '[REDACTED]';
      }
    }
  };
  const test = (clone.test ?? {}) as Record<string, unknown>;
  if (test.env && typeof test.env === 'object') {
    redactEnv(test.env as Record<string, unknown>);
  }
  if (Array.isArray(test.args)) {
    clone.test = {
      ...(clone.test as Record<string, unknown>),
      args: (test.args as string[]).map((a) => (typeof a === 'string' ? redactStringForCli(a, secrets) : a)),
    };
  }
  const readiness = clone.readiness as unknown as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(readiness)) {
    for (const probe of readiness) {
      if (probe.type === 'command' && probe.env && typeof probe.env === 'object') {
        redactEnv(probe.env as Record<string, unknown>);
      }
      if (probe.type === 'command' && Array.isArray(probe.args)) {
        probe.args = (probe.args as string[]).map((a) => (typeof a === 'string' ? redactStringForCli(a, secrets) : a));
      }
      if (probe.type === 'http') {
        if (typeof probe.url === 'string') probe.url = redactStringForCli(probe.url as string, secrets);
        if (probe.headers && typeof probe.headers === 'object') {
          const headers = probe.headers as Record<string, unknown>;
          for (const hk of Object.keys(headers)) {
            const hv = headers[hk];
            if (typeof hv === 'string' && hv.length > 0) {
              const lower = hk.toLowerCase();
              if (
                lower === 'authorization' ||
                lower === 'cookie' ||
                lower.includes('token') ||
                lower.includes('secret')
              ) {
                headers[hk] = '[REDACTED]';
              } else {
                headers[hk] = redactStringForCli(hv as string, secrets);
              }
            }
          }
        }
      }
    }
  }
  return clone;
}

export function buildOptions(result: ParseFlagsResult): Record<string, unknown> {
  const opts: Record<string, unknown> = {};
  if (result.values.cwd) opts.cwd = result.values.cwd;
  if (result.repeat['compose-file'] && result.repeat['compose-file'].length > 0) {
    opts.compose = { files: [...result.repeat['compose-file']] };
  }
  if (result.values['project-name']) {
    const compose = (opts.compose ?? {}) as Record<string, unknown>;
    compose.projectName = result.values['project-name'];
    opts.compose = compose;
  }
  if (result.values['evidence-dir']) {
    const evidence = (opts.evidence ?? {}) as Record<string, unknown>;
    evidence.directory = result.values['evidence-dir'];
    opts.evidence = evidence;
  }
  if (result.values['dry-run'] === 'true') {
    opts.dryRun = true;
  }
  return opts;
}

export function getCliExitCode(error: unknown): number {
  const extract = (err: unknown): number | undefined => {
    if (err !== null && typeof err === 'object') {
      const rec = err as Record<string, unknown>;
      const code = rec.exitCode;
      if (typeof code === 'number' && Number.isInteger(code) && code >= 1 && code <= 255) return code;
      const status = rec.status;
      if (typeof status === 'number' && Number.isInteger(status) && status >= 1 && status <= 255) return status;
    }
    return undefined;
  };
  if (error instanceof ComposeSandboxLifecycleError) {
    const primaryCode = extract(error.primary);
    if (primaryCode !== undefined) return primaryCode;
    const secondaryCode = error.secondary ? extract(error.secondary) : undefined;
    if (secondaryCode !== undefined && error.primary.message.includes('exitCode')) return secondaryCode;
  }
  const direct = extract(error);
  if (direct !== undefined) return direct;
  // signal, validation, infra, evidence, cleanup default to 1
  return 1;
}

export async function resolveComposeSandboxCliOptions(
  result: ParseFlagsResult,
): Promise<{ options: Record<string, unknown>; plan: ComposeSandboxPlan }> {
  const configPath = result.values.config;
  const cliOverrides = buildOptions(result);
  const combined: Record<string, unknown> = { ...cliOverrides };
  if (configPath) combined.config = configPath as string;
  const { merged, plan } = await loadAndMergeComposeSandboxOptions(combined);
  const options: Record<string, unknown> = { ...merged };
  return { options, plan };
}

function redactErrorMessage(message: string, plan?: ComposeSandboxPlan): string {
  if (!plan) return sanitizeErrorForCli(message, undefined);
  return sanitizeErrorForCli(message, plan);
}

async function main(): Promise<void> {
  const result = parseFlags(process.argv.slice(2), SPECS);
  if (!result) {
    printHelp();
    return;
  }

  let planForRedaction: ComposeSandboxPlan | undefined;
  try {
    const { options, plan } = await resolveComposeSandboxCliOptions(result);
    planForRedaction = plan;
    if (result.values['dry-run'] === 'true') {
      const redacted = redactPlanForOutput(plan);
      console.log(JSON.stringify(redacted, null, 2));
      return;
    }
    await runComposeSandbox(options);
  } catch (error: unknown) {
    const raw = error instanceof Error ? error.message : String(error);
    const redacted = redactErrorMessage(raw, planForRedaction);
    console.error(redacted);
    process.exitCode = getCliExitCode(error);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = getCliExitCode(error);
});
