import {
  isPlainObject,
  loadConfigFile,
  parseFlags,
  type FlagSpec,
  type ParseFlagsResult,
} from '@repo-toolkit/publish-package';

import { resolveComposeSandboxPlan, type ComposeSandboxPlan } from './plan';
import { runComposeSandbox } from './run';

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

export function redactPlanForOutput(plan: ComposeSandboxPlan): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(plan)) as Record<string, unknown>;
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
  const readiness = clone.readiness as unknown as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(readiness)) {
    for (const probe of readiness) {
      if (probe.type === 'command' && probe.env && typeof probe.env === 'object') {
        redactEnv(probe.env as Record<string, unknown>);
      }
      if (probe.type === 'http' && probe.headers && typeof probe.headers === 'object') {
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

export async function resolveComposeSandboxCliOptions(
  result: ParseFlagsResult,
): Promise<{ options: Record<string, unknown>; plan: ComposeSandboxPlan }> {
  const configPath = result.values.config;
  const cwdHint = result.values.cwd;
  const loaded: Record<string, unknown> = configPath
    ? await loadConfigFile<Record<string, unknown>>(configPath, cwdHint)
    : {};
  if (Object.prototype.hasOwnProperty.call(loaded, 'config')) {
    throw new Error('config key is not allowed inside config file');
  }
  const cliOverrides = buildOptions(result);
  const dryRun = cliOverrides.dryRun === true;
  const merged: Record<string, unknown> = { ...loaded };

  if (cliOverrides.cwd !== undefined) merged.cwd = cliOverrides.cwd;
  if (dryRun) merged.dryRun = true;

  if (cliOverrides.compose !== undefined) {
    const baseCompose = isPlainObject(merged.compose) ? (merged.compose as Record<string, unknown>) : {};
    const overrideCompose = cliOverrides.compose as Record<string, unknown>;
    merged.compose = { ...baseCompose, ...overrideCompose };
  }
  if (cliOverrides.evidence !== undefined) {
    const baseEvidence = isPlainObject(merged.evidence) ? (merged.evidence as Record<string, unknown>) : {};
    const overrideEvidence = cliOverrides.evidence as Record<string, unknown>;
    merged.evidence = { ...baseEvidence, ...overrideEvidence };
  }

  const plan = resolveComposeSandboxPlan(merged);
  const options: Record<string, unknown> = { ...merged };
  if (dryRun) options.dryRun = true;
  return { options, plan };
}

function redactErrorMessage(message: string, plan?: ComposeSandboxPlan): string {
  if (!plan) return message;
  let out = message;
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
  secrets.sort((a, b) => b.length - a.length);
  for (const s of secrets) {
    if (s.length === 0) continue;
    out = out.split(s).join('[REDACTED]');
  }
  return out;
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
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
