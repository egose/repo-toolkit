import type { ProcessRunner } from './runner';
import { isCapturingProcessRunner } from './runner';

/**
 * Full semver 2.0.0 grammar (the official semver.org regular expression).
 * Accepts exactly what npm accepts: `major.minor.patch` with optional
 * dot-separated prerelease and build-metadata identifiers, no leading zeros
 * in numeric identifiers.
 */
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export type VersionBump = 'major' | 'minor' | 'patch';

const VERSION_BUMPS: ReadonlyArray<VersionBump> = ['major', 'minor', 'patch'];

export type VersionFailureKind =
  | 'npm-unavailable'
  | 'authentication'
  | 'timeout'
  | 'network'
  | 'registry'
  | 'package-absent'
  | 'malformed-response'
  | 'invalid-version'
  | 'ambiguous-selection'
  | 'unknown';

export class VersionResolutionError extends Error {
  readonly kind: VersionFailureKind;

  constructor(kind: VersionFailureKind, message: string) {
    super(message);
    this.name = 'VersionResolutionError';
    this.kind = kind;
  }
}

export function isValidSemver(version: string): boolean {
  return SEMVER_PATTERN.test(version);
}

/**
 * Validate a release version supplied explicitly or read from a manifest:
 * strip at most one leading `v`, then require strict semver 2.0.0.
 */
export function normalizeReleaseVersion(rawVersion: string, label: string): string {
  if (typeof rawVersion !== 'string' || rawVersion.length === 0) {
    throw new VersionResolutionError('invalid-version', `${label} must be a non-empty string`);
  }

  const version = rawVersion.startsWith('v') ? rawVersion.slice(1) : rawVersion;

  if (!SEMVER_PATTERN.test(version)) {
    throw new VersionResolutionError('invalid-version', `${label} is not a valid semver version: ${rawVersion}`);
  }

  return version;
}

function parseSemverCore(version: string): { major: number; minor: number; patch: number } {
  const match = SEMVER_PATTERN.exec(version);
  if (!match) {
    throw new VersionResolutionError('invalid-version', `not a valid semver version: ${version}`);
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Apply a bump to a valid semver version, dropping prerelease/build metadata. */
export function bumpVersion(version: string, bump: VersionBump): string {
  const { major, minor, patch } = parseSemverCore(version);
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}

export function isVersionBump(value: unknown): value is VersionBump {
  return VERSION_BUMPS.includes(value as VersionBump);
}

const AUTH_PATTERN = /\b(E401|E403|401|403|unauthorized|forbidden|authentication|authorization|credentials|sso|otp)\b/i;
const TIMEOUT_PATTERN = /\b(ETIMEDOUT|timed out|timeout)\b/i;
const NETWORK_PATTERN = /\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EPIPE|EHOSTUNREACH|ENETUNREACH|socket)\b/i;
const REGISTRY_PATTERN = /\b(E5\d\d|5\d\d)\b/;
const MISSING_PATTERN = /\bENOENT\b/;

export function redactSensitiveValues(text: string, secrets: ReadonlyArray<string | undefined>): string {
  let redacted = text;
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length > 0) {
      redacted = redacted.split(secret).join('[redacted]');
    }
  }
  return redacted.replace(/(:\/\/)\S+?@/g, '$1[redacted]@');
}

export interface RegistryVersionQuery {
  /** Base source package name to query (never per-artifact variants). */
  packageName: string;
  /** Bump strategy applied to the registry version. */
  bump: VersionBump;
  /** Working directory for the npm invocation. */
  cwd: string;
  /** Optional npm registry URL forwarded via `--registry`. */
  registry?: string;
  /** Process runner; must implement {@link import('./runner').CapturingProcessRunner}. */
  runner: ProcessRunner;
  /** Optional timeout for the `npm view` invocation. */
  timeoutMs?: number;
}

function classifyNpmFailure(output: string): VersionFailureKind {
  if (MISSING_PATTERN.test(output)) {
    return 'npm-unavailable';
  }
  if (/\bE404\b/.test(output)) {
    return AUTH_PATTERN.test(output) ? 'authentication' : 'package-absent';
  }
  if (AUTH_PATTERN.test(output)) {
    return 'authentication';
  }
  if (TIMEOUT_PATTERN.test(output)) {
    return 'timeout';
  }
  if (NETWORK_PATTERN.test(output)) {
    return 'network';
  }
  if (REGISTRY_PATTERN.test(output)) {
    return 'registry';
  }
  return 'unknown';
}

/**
 * Resolve the next version from the npm registry via
 * `npm view <package-name> version --json`. Only a confirmed package-absence
 * response (`E404` without authentication indicators) is treated as an
 * initial release with prior version `0.0.0`; every other failure is fatal
 * and classified on {@link VersionResolutionError.kind}.
 */
export async function resolveRegistryBumpVersion(query: RegistryVersionQuery): Promise<string> {
  if (!isCapturingProcessRunner(query.runner)) {
    throw new VersionResolutionError(
      'npm-unavailable',
      'registry version resolution requires a CapturingProcessRunner (process output capture)',
    );
  }

  const args = ['view', query.packageName, 'version', '--json'];
  if (query.registry) {
    args.push('--registry', query.registry);
  }

  const result = await query.runner.capture('npm', args, { cwd: query.cwd, timeoutMs: query.timeoutMs });
  const output = redactSensitiveValues(`${result.stdout}\n${result.stderr}`, [query.registry]);

  if (result.error) {
    const errorCode = (result.error as NodeJS.ErrnoException).code;
    if (errorCode === 'ENOENT') {
      throw new VersionResolutionError(
        'npm-unavailable',
        `npm executable not available: ${redactSensitiveValues(result.error.message, [query.registry])}`,
      );
    }
    if (errorCode === 'ETIMEDOUT') {
      throw new VersionResolutionError('timeout', `npm view timed out querying ${query.packageName}`);
    }
    const kind = classifyNpmFailure(output || result.error.message);
    throw new VersionResolutionError(
      kind,
      `npm view failed for ${query.packageName} (${kind}): ${redactSensitiveValues(result.error.message, [query.registry])}`,
    );
  }

  if (result.code !== 0) {
    const kind = classifyNpmFailure(output);
    if (kind === 'package-absent') {
      return bumpVersion('0.0.0', query.bump);
    }
    throw new VersionResolutionError(kind, `npm view failed for ${query.packageName} (${kind}): ${output.trim()}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new VersionResolutionError(
      'malformed-response',
      `npm view returned malformed JSON for ${query.packageName}: ${output.trim()}`,
    );
  }

  if (typeof parsed !== 'string') {
    throw new VersionResolutionError(
      'malformed-response',
      `npm view returned a non-string version for ${query.packageName}: ${output.trim()}`,
    );
  }

  const registryVersion = normalizeReleaseVersion(parsed, `registry version for ${query.packageName}`);
  return bumpVersion(registryVersion, query.bump);
}
