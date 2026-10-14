import { redactSensitiveValues } from '@repo-toolkit/publish-package';

const MAX_DIAGNOSTIC_CHARS = 4096;
const ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError', 'TimeoutError']);

export function readProperty(value: unknown, key: string): unknown {
  try {
    return value !== null && (typeof value === 'object' || typeof value === 'function')
      ? (value as Record<string, unknown>)[key]
      : undefined;
  } catch {
    return undefined;
  }
}

export function knownCredentialSecrets(explicit: unknown, envName: unknown): string[] {
  const values = [explicit, process.env.GITHUB_TOKEN];
  if (typeof envName === 'string') {
    values.push(process.env[envName]);
  }
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

export function redactText(text: string, secrets: ReadonlyArray<string | undefined>): string {
  const values = new Set<string>();
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) {
      values.add(secret);
      try {
        const encoded = encodeURIComponent(secret);
        values.add(encoded);
        values.add(encoded.replace(/%[0-9A-F]{2}/g, (part) => part.toLowerCase()));
        values.add(JSON.stringify(secret).slice(1, -1));
      } catch {
        continue;
      }
    }
  }
  return redactSensitiveValues(
    text,
    [...values].sort((left, right) => right.length - left.length),
  );
}

export function diagnosticText(
  text: string,
  secrets: ReadonlyArray<string | undefined>,
  limit = MAX_DIAGNOSTIC_CHARS,
): string {
  const safe = redactText(text, secrets);
  return safe.length <= limit ? safe : `${safe.slice(0, limit)}...[truncated]`;
}

export function safeError(error: unknown, secrets: ReadonlyArray<string | undefined> = []): Error {
  const message = typeof error === 'string' ? error : readProperty(error, 'message');
  const name = readProperty(error, 'name');
  const safe = new Error(
    diagnosticText(
      typeof message === 'string' ? message : 'Release tag operation failed with an unrecognized error',
      secrets,
    ),
  );
  if (typeof name === 'string' && ERROR_NAMES.has(name)) {
    safe.name = name;
  }
  if (safe.stack !== undefined) {
    safe.stack = diagnosticText(safe.stack, secrets, MAX_DIAGNOSTIC_CHARS * 2);
  }
  return safe;
}

export function safeMetadata<T extends object>(value: T, secrets: ReadonlyArray<string | undefined>): T {
  const result = { ...value };
  for (const key of Object.keys(result) as Array<keyof T>) {
    const entry = result[key];
    if (typeof entry === 'string') {
      result[key] = redactText(entry, secrets) as T[keyof T];
    }
  }
  return result;
}
