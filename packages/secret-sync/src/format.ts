import { redactSensitiveValues } from '@repo-toolkit/publish-package';

import { isSecretSyncError } from './errors';

export const CLI_SCHEMA_VERSION = 1;

const FORBIDDEN_KEYS = new Set([
  'sha256',
  'hmac',
  'contentBase64',
  'localKey',
  'token',
  'authorization',
  'bytes',
  'body',
  'content',
]);

export function collectEnvSecrets(env: Record<string, string | undefined>, names: ReadonlyArray<string>): string[] {
  const secrets: string[] = [];
  for (const name of names) {
    const value = env[name];
    if (typeof value === 'string' && value.length > 0 && secrets.indexOf(value) < 0) {
      secrets.push(value);
    }
  }
  return secrets;
}

export function redactText(text: string, secrets: ReadonlyArray<string> = []): string {
  if (secrets.length === 0) {
    return text;
  }
  return redactSensitiveValues(text, [...secrets]);
}

export function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      if (FORBIDDEN_KEYS.has(key)) {
        continue;
      }
      result[key] = sanitizeValue(record[key]);
    }
    return result;
  }
  return value;
}

export function getErrorCode(error: unknown): string {
  if (isSecretSyncError(error)) {
    return error.code;
  }
  if (error instanceof Error && /Unknown (command|argument|branch)/.test(error.message)) {
    return 'validation';
  }
  if (error instanceof Error && /Missing value/.test(error.message)) {
    return 'validation';
  }
  return 'unknown';
}

export function buildSuccessEnvelope(command: string, data: unknown): Record<string, unknown> {
  const sanitized = sanitizeValue(data) as Record<string, unknown>;
  return { schemaVersion: CLI_SCHEMA_VERSION, command, status: 'ok', ...sanitized };
}

export function buildErrorEnvelope(
  command: string | undefined,
  error: unknown,
  secrets: ReadonlyArray<string> = [],
): Record<string, unknown> {
  const message = redactText(error instanceof Error ? error.message : String(error), secrets);
  return {
    schemaVersion: CLI_SCHEMA_VERSION,
    ...(command === undefined ? {} : { command }),
    status: 'error',
    code: getErrorCode(error),
    message,
  };
}

function summarizeFiles(files: ReadonlyArray<{ path: string; status: string }>): string {
  if (files.length === 0) {
    return 'no selected files';
  }
  return files.map((entry) => `${entry.status} ${entry.path}`).join('\n');
}

export function formatTextResult(command: string, result: unknown): string {
  const data = (sanitizeValue(result) ?? {}) as Record<string, unknown>;
  switch (command) {
    case 'init': {
      return [
        `initialized ${String(data.configPath ?? '(config)')}`,
        `project ${String(data.projectId ?? '')} branch ${String(data.branch ?? '')}`,
        String(data.note ?? ''),
      ]
        .filter((line) => line.length > 0)
        .join('\n');
    }
    case 'doctor': {
      const checks = Array.isArray(data.checks)
        ? (data.checks as Array<{ name: string; status: string; detail: string }>)
        : [];
      const lines = [`doctor ${String(data.branch ?? '')}: ${String(data.note ?? '')}`];
      for (const check of checks) {
        lines.push(`${check.status} ${check.name}: ${check.detail}`);
      }
      return lines.join('\n');
    }
    case 'status': {
      const files = Array.isArray(data.files) ? (data.files as Array<{ path: string; status: string }>) : [];
      const heads = Array.isArray(data.heads) ? (data.heads as string[]) : [];
      const lines = [
        `branch ${String(data.branch ?? '')} heads(${String(data.headState ?? '')}): ${heads.length === 0 ? '(empty)' : heads.join(', ')}`,
        summarizeFiles(files),
      ];
      if (typeof data.note === 'string' && data.note.length > 0) {
        lines.push(data.note);
      }
      return lines.join('\n');
    }
    case 'diff': {
      const entries = Array.isArray(data.entries) ? (data.entries as Array<{ path: string; changed: boolean }>) : [];
      if (entries.length === 0) {
        return 'no differences';
      }
      return entries.map((entry) => `${entry.changed ? 'changed' : 'unchanged'} ${entry.path}`).join('\n');
    }
    case 'log': {
      const entries = Array.isArray(data.entries)
        ? (data.entries as Array<{ commitId: string; blobId?: string; message?: string; deleted: boolean }>)
        : [];
      if (entries.length === 0) {
        return 'no history';
      }
      return entries
        .map((entry) => {
          const base = `${entry.commitId} ${entry.deleted ? 'deleted' : (entry.blobId ?? 'present')}`;
          return entry.message === undefined ? base : `${base} ${entry.message}`;
        })
        .join('\n');
    }
    default: {
      if (typeof data.note === 'string' && data.note.length > 0) {
        return data.note;
      }
      return `${command}: ok`;
    }
  }
}

export function formatJsonResult(command: string, result: unknown): string {
  return `${JSON.stringify(buildSuccessEnvelope(command, result), null, 2)}\n`;
}

export function formatJsonError(
  command: string | undefined,
  error: unknown,
  secrets: ReadonlyArray<string> = [],
): string {
  return `${JSON.stringify(buildErrorEnvelope(command, error, secrets), null, 2)}\n`;
}
