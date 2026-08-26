import { stripAnsi, truncateUtf8ToBytes } from './output';
import type { ComposeSandboxPlan } from './plan';

export function collectSecrets(plan: ComposeSandboxPlan): string[] {
  const raw: string[] = [];
  for (const v of Object.values(plan.test.env)) {
    if (typeof v === 'string' && v.length > 0) raw.push(v);
  }
  for (const probe of plan.readiness) {
    if (probe.type === 'command') {
      for (const v of Object.values(probe.env)) {
        if (typeof v === 'string' && v.length > 0) raw.push(v);
      }
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
        for (const val of u.searchParams.values()) {
          if (val.length > 0) raw.push(val);
        }
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

export function redactString(content: string, secrets: string[]): string {
  let out = content;
  for (const s of secrets) {
    if (s.length === 0) continue;
    out = out.split(s).join('[REDACTED]');
  }
  return out;
}

export function sanitizeLogMessage(raw: string, plan?: ComposeSandboxPlan): string {
  let out = raw;
  if (plan) out = redactString(out, collectSecrets(plan));
  out = stripAnsi(out);
  out = out.replace(/\r/gu, ' ').replace(/\n/gu, ' ');
  // eslint-disable-next-line no-control-regex
  out = out.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/gu, ' ');
  // eslint-disable-next-line no-control-regex
  out = out.replace(/\x1B/gu, ' ');
  if (out.trimStart().startsWith('::')) out = out.replace('::', ': :');
  return truncateUtf8ToBytes(out, 2000);
}

export function redactManifestObject<T>(value: T, secrets: string[]): T {
  if (typeof value === 'string') {
    let out = value as unknown as string;
    for (const s of secrets) if (s.length > 0) out = out.split(s).join('[REDACTED]');
    return out as unknown as T;
  }
  if (Array.isArray(value)) return (value as unknown[]).map((v) => redactManifestObject(v, secrets)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = redactManifestObject(v, secrets);
    return out as unknown as T;
  }
  return value;
}

export interface Logger {
  log(message: string): void;
}

export function safeEmit(message: string, logger: Logger | undefined, plan?: ComposeSandboxPlan): void {
  try {
    const sanitized = sanitizeLogMessage(message, plan);
    const fn = logger?.log ?? ((m: string) => console.error(m));
    fn(sanitized);
  } catch {
    void 0;
  }
}

export function logGroupStart(title: string, logger: Logger | undefined, plan?: ComposeSandboxPlan): void {
  safeEmit(`[compose-sandbox] ▶ ${title}`, logger, plan);
}

export function logGroupEnd(
  title: string,
  durationMs: number | undefined,
  logger: Logger | undefined,
  plan?: ComposeSandboxPlan,
): void {
  const suffix = typeof durationMs === 'number' ? ` • ${durationMs}ms` : '';
  safeEmit(`[compose-sandbox] ✓ ${title}${suffix}`, logger, plan);
}

export function logGroupFail(
  title: string,
  durationMs: number | undefined,
  err: unknown,
  logger: Logger | undefined,
  plan?: ComposeSandboxPlan,
): void {
  const suffix = typeof durationMs === 'number' ? ` • ${durationMs}ms` : '';
  const msg = err instanceof Error ? err.message : String(err);
  safeEmit(`[compose-sandbox] ✗ ${title} failed${suffix}: ${msg}`, logger, plan);
}
