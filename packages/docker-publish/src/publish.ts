import { lstatSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { isPlainObject, redactSensitiveValues } from '@repo-toolkit/publish-package';

import { resolveDockerPublishPlan, type DockerPublishOptions, type DockerPublishPlan } from './plan';
import {
  resolveDockerRunner,
  runWithConcurrency,
  stripExtraKeys,
  type DockerRunner,
  type DockerRunOptions,
  type DockerRunResult,
} from './runner';

const DEFAULT_PUBLISH_CONCURRENCY = 1;
const MAX_PUBLISH_CONCURRENCY = 64;
const ERROR_TAIL_MAX_CHARS = 2048;
const INSPECT_FORMAT = '{{json .Manifest}}';
const STRICT_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export type DockerPublishRunner = DockerRunner;

/**
 * Registry auth env contract.
 *
 * Credentials are sourced from environment variables named here and travel to
 * `docker login` via `--password-stdin` only. Plaintext passwords never appear
 * in config files, argv, logs, or error messages. A registry without an entry
 * in `auth` is pushed without a login step (public or pre-authenticated).
 */
export interface DockerPublishRegistryAuth {
  readonly username?: string;
  readonly usernameEnv?: string;
  readonly passwordEnv: string;
}

const USERNAME_MAX_LENGTH = 256;

export function validateDockerPublishUsername(value: string, label: string): string | undefined {
  if (value.length === 0 || value.length > USERNAME_MAX_LENGTH) {
    return `${label} must be 1-${USERNAME_MAX_LENGTH} characters long`;
  }
  if (/[\0-\x20\x7f]/u.test(value)) {
    return `${label} must not contain whitespace or control characters`;
  }
  return undefined;
}

export interface DockerPublishImagesOptions extends DockerPublishOptions {
  readonly runner?: DockerPublishRunner;
  readonly dryRun?: boolean;
  readonly publishConcurrency?: number;
  readonly references?: ReadonlyArray<string>;
  readonly auth?: Readonly<Record<string, DockerPublishRegistryAuth>>;
  readonly digestManifestPath?: string;
}

export interface DockerPublishedImage {
  readonly reference: string;
  readonly registry: string;
  readonly tag: string;
  readonly digest: string;
  readonly durationMs: number;
}

export interface DockerPublishResult {
  readonly publishes: ReadonlyArray<DockerPublishedImage>;
}

const PUBLISH_EXTRA_KEYS = new Set([
  'runner',
  'dryRun',
  'publishConcurrency',
  'references',
  'auth',
  'digestManifestPath',
]);

export async function publishDockerImages(options: DockerPublishImagesOptions): Promise<DockerPublishResult> {
  const runner = resolveDockerRunner(options, true);
  const plan = resolveDockerPublishPlan(stripExtraKeys(options, PUBLISH_EXTRA_KEYS) as unknown as DockerPublishOptions);
  if (plan.ociExportDir !== undefined) {
    throw new Error(
      `Cannot publish a plan with ociExportDir (${plan.ociExportDir}): OCI export is export-only with no local tags to push; rebuild without ociExportDir to publish`,
    );
  }
  const publishConcurrency = resolvePublishConcurrency(options);
  const requested = resolveRequestedReferences(options, plan);
  const manifestPath = resolveManifestPath(options, plan);
  if (readDryRun(options)) {
    return { publishes: [] };
  }
  const credentials = readCredentials(options, requested);
  const secrets = collectSecrets(credentials);

  await loginRegistries(runner, plan, credentials, secrets);

  const ordered = await runWithConcurrency(
    requested,
    Math.min(publishConcurrency, Math.max(requested.length, 1)),
    (reference) => publishOneReference(plan, reference, secrets, runner),
  );
  const publishes: DockerPublishedImage[] = [];
  for (const entry of ordered) {
    if (entry === undefined) {
      throw new Error('Docker publish completed without a result for every requested reference');
    }
    publishes.push(entry);
  }
  publishes.sort((left, right) => (left.reference < right.reference ? -1 : left.reference > right.reference ? 1 : 0));

  if (manifestPath !== undefined) {
    writeDigestManifest(manifestPath, publishes, secrets);
  }
  return { publishes };
}

function readDryRun(options: DockerPublishImagesOptions): boolean {
  if (options === null || typeof options !== 'object') {
    return false;
  }
  const dryRun = (options as { readonly dryRun?: unknown }).dryRun;
  if (dryRun === undefined) {
    return false;
  }
  if (dryRun !== false && dryRun !== true) {
    throw new Error('dryRun must be a boolean');
  }
  return dryRun;
}

function resolvePublishConcurrency(options: DockerPublishImagesOptions): number {
  if (options === null || typeof options !== 'object') {
    return DEFAULT_PUBLISH_CONCURRENCY;
  }
  const value = (options as { readonly publishConcurrency?: unknown }).publishConcurrency;
  if (value === undefined) {
    return DEFAULT_PUBLISH_CONCURRENCY;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('publishConcurrency must be a positive safe integer');
  }
  if (value > MAX_PUBLISH_CONCURRENCY) {
    throw new Error(`publishConcurrency must not exceed ${MAX_PUBLISH_CONCURRENCY}`);
  }
  return value;
}

function resolveRequestedReferences(
  options: DockerPublishImagesOptions,
  plan: DockerPublishPlan,
): ReadonlyArray<string> {
  const allowed = new Set<string>(plan.references);
  const allowlisted = new Set<string>(plan.registries.map((registry) => registry.hostname));
  let requested: ReadonlyArray<string>;
  if (options === null || typeof options !== 'object') {
    requested = plan.references;
  } else {
    const value = (options as { readonly references?: unknown }).references;
    if (value === undefined) {
      requested = plan.references;
    } else {
      if (!Array.isArray(value)) {
        throw new Error('references must be an array of strings');
      }
      const entries: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const entry = value[index];
        if (typeof entry !== 'string' || entry.length === 0) {
          throw new Error(`references[${index}] must be a non-empty string`);
        }
        if (entry.includes('\0')) {
          throw new Error(`references[${index}] must not contain NUL bytes`);
        }
        entries.push(entry);
      }
      requested = entries;
    }
  }
  const seen = new Set<string>();
  for (const reference of requested) {
    if (seen.has(reference)) {
      throw new Error(`Duplicate publish reference: ${reference}`);
    }
    seen.add(reference);
    const hostname = referenceHostname(reference);
    if (!allowlisted.has(hostname)) {
      throw new Error(`Refusing to push to unlisted registry: ${hostname}`);
    }
    if (!allowed.has(reference)) {
      throw new Error(`Refusing to push off-plan reference: ${reference}`);
    }
  }
  return [...requested];
}

function referenceHostname(reference: string): string {
  const slash = reference.indexOf('/');
  if (slash < 0) {
    throw new Error(`Refusing to push malformed reference without a registry: ${reference}`);
  }
  return reference.slice(0, slash);
}

function splitReference(reference: string): { registry: string; tag: string } {
  const registry = referenceHostname(reference);
  const colon = reference.lastIndexOf(':');
  if (colon < 0 || colon < reference.indexOf('/')) {
    throw new Error(`Refusing to push reference without a tag: ${reference}`);
  }
  return { registry, tag: reference.slice(colon + 1) };
}

export interface DockerRegistryCredentials {
  readonly hostname: string;
  readonly username: string;
  readonly password: string;
}

export interface DockerLoginRunner {
  run(
    executable: string,
    args: ReadonlyArray<string>,
    options: DockerRunOptions,
  ): DockerRunResult | Promise<DockerRunResult>;
}

export function validateDockerPublishAuthMap(value: unknown): Readonly<Record<string, DockerPublishRegistryAuth>> {
  if (value === undefined) {
    return {};
  }
  if (!isPlainObject(value)) {
    throw new Error('auth must be a record of registry hostnames to { usernameEnv, passwordEnv }');
  }
  const result: Record<string, DockerPublishRegistryAuth> = {};
  for (const hostname of Object.keys(value)) {
    const entry = (value as Record<string, unknown>)[hostname];
    if (!isPlainObject(entry)) {
      throw new Error(
        `auth[${JSON.stringify(hostname)}] must be an object with passwordEnv and exactly one of username or usernameEnv`,
      );
    }
    const record = entry as Record<string, unknown>;
    const keys = Object.keys(record);
    const hasUsername = keys.indexOf('username') >= 0;
    const hasUsernameEnv = keys.indexOf('usernameEnv') >= 0;
    const hasPasswordEnv = keys.indexOf('passwordEnv') >= 0;
    if (keys.length !== 2 || !hasPasswordEnv || hasUsername === hasUsernameEnv) {
      throw new Error(
        `auth[${JSON.stringify(hostname)}] must define passwordEnv and exactly one of username or usernameEnv`,
      );
    }
    const passwordEnv = record['passwordEnv'];
    if (typeof passwordEnv !== 'string' || !ENV_NAME_PATTERN.test(passwordEnv)) {
      throw new Error(`auth[${JSON.stringify(hostname)}].passwordEnv must be a valid environment variable name`);
    }
    if (hasUsername) {
      const username = record['username'];
      const problem =
        typeof username === 'string'
          ? validateDockerPublishUsername(username, `auth[${JSON.stringify(hostname)}].username`)
          : `auth[${JSON.stringify(hostname)}].username must be a non-empty string`;
      if (problem !== undefined) {
        throw new Error(problem);
      }
      result[hostname] = { username: username as string, passwordEnv };
      continue;
    }
    const usernameEnv = record['usernameEnv'];
    if (typeof usernameEnv !== 'string' || !ENV_NAME_PATTERN.test(usernameEnv)) {
      throw new Error(`auth[${JSON.stringify(hostname)}].usernameEnv must be a valid environment variable name`);
    }
    result[hostname] = { usernameEnv, passwordEnv };
  }
  return result;
}

function resolveAuthMap(options: DockerPublishImagesOptions): Readonly<Record<string, DockerPublishRegistryAuth>> {
  if (options === null || typeof options !== 'object') {
    return {};
  }
  return validateDockerPublishAuthMap((options as { readonly auth?: unknown }).auth);
}

function readCredentials(
  options: DockerPublishImagesOptions,
  requested: ReadonlyArray<string>,
): ReadonlyArray<DockerRegistryCredentials> {
  const auth = resolveAuthMap(options);
  const needed: string[] = [];
  for (const reference of requested) {
    const hostname = referenceHostname(reference);
    if (needed.indexOf(hostname) < 0 && Object.prototype.hasOwnProperty.call(auth, hostname)) {
      needed.push(hostname);
    }
  }
  needed.sort();
  const credentials: DockerRegistryCredentials[] = [];
  for (const hostname of needed) {
    const spec = auth[hostname];
    const password = process.env[spec.passwordEnv];
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error(`Missing password for registry ${hostname} in environment variable ${spec.passwordEnv}`);
    }
    if (spec.username !== undefined) {
      credentials.push({ hostname, username: spec.username, password });
      continue;
    }
    const username = spec.usernameEnv === undefined ? undefined : process.env[spec.usernameEnv];
    if (typeof username !== 'string' || username.length === 0) {
      throw new Error(`Missing username for registry ${hostname} in environment variable ${spec.usernameEnv}`);
    }
    credentials.push({ hostname, username, password });
  }
  return credentials;
}

function collectSecrets(credentials: ReadonlyArray<DockerRegistryCredentials>): string[] {
  const secrets: string[] = [];
  for (const credential of credentials) {
    if (secrets.indexOf(credential.username) < 0) {
      secrets.push(credential.username);
    }
    if (secrets.indexOf(credential.password) < 0) {
      secrets.push(credential.password);
    }
  }
  return secrets;
}

function baseOptions(plan: DockerPublishPlan, secrets: ReadonlyArray<string>): DockerRunOptions {
  return {
    cwd: plan.cwd,
    timeoutMs: plan.processLimits.timeoutMs,
    maxOutputBytes: plan.processLimits.maxOutputBytes,
    secrets,
  };
}

export async function loginRegistries(
  runner: DockerLoginRunner,
  plan: DockerPublishPlan,
  credentials: ReadonlyArray<DockerRegistryCredentials>,
  secrets: ReadonlyArray<string>,
): Promise<void> {
  for (const credential of credentials) {
    const options: DockerRunOptions = {
      ...baseOptions(plan, secrets),
      stdin: credential.password,
    };
    try {
      await runner.run(
        plan.dockerExecutable,
        ['login', '--username', credential.username, '--password-stdin', credential.hostname],
        options,
      );
    } catch (error) {
      throw loginError(credential.hostname, error, secrets);
    }
  }
}

async function publishOneReference(
  plan: DockerPublishPlan,
  reference: string,
  secrets: ReadonlyArray<string>,
  runner: DockerRunner,
): Promise<DockerPublishedImage> {
  const start = Date.now();
  const push = await capturePush(plan, reference, secrets, runner);
  const inspect = await captureInspect(plan, reference, secrets, runner);
  const digest = resolveDigest(reference, push, inspect, secrets);
  const parts = splitReference(reference);
  return {
    reference,
    registry: parts.registry,
    tag: parts.tag,
    digest,
    durationMs: Date.now() - start,
  };
}

async function capturePush(
  plan: DockerPublishPlan,
  reference: string,
  secrets: ReadonlyArray<string>,
  runner: DockerRunner,
): Promise<string> {
  try {
    const output = await runner.capture(plan.dockerExecutable, ['push', reference], baseOptions(plan, secrets));
    return output.stdout;
  } catch (error) {
    throw publishError(reference, 'push', error, secrets);
  }
}

async function captureInspect(
  plan: DockerPublishPlan,
  reference: string,
  secrets: ReadonlyArray<string>,
  runner: DockerRunner,
): Promise<string> {
  try {
    const output = await runner.capture(
      plan.dockerExecutable,
      ['buildx', 'imagetools', 'inspect', '--format', INSPECT_FORMAT, reference],
      baseOptions(plan, secrets),
    );
    return output.stdout;
  } catch (error) {
    throw publishError(reference, 'digest inspection', error, secrets);
  }
}

function resolveDigest(
  reference: string,
  pushOutput: string,
  inspectOutput: string,
  secrets: ReadonlyArray<string>,
): string {
  const pushDigests = parsePushDigests(reference, pushOutput, secrets);
  const inspectDigest = parseInspectDigest(reference, inspectOutput, secrets);
  if (pushDigests.length === 0 && inspectDigest === undefined) {
    throw new Error(
      redactSensitiveValues(
        `Failed to publish Docker reference "${reference}": missing content digest in push and inspect output: ${truncateTail(`${pushOutput}\n${inspectOutput}`)}`,
        secrets,
      ),
    );
  }
  if (pushDigests.length > 0 && inspectDigest !== undefined && pushDigests[0] !== inspectDigest) {
    throw new Error(
      redactSensitiveValues(
        `Failed to publish Docker reference "${reference}": push digest ${pushDigests[0]} does not match inspect digest ${inspectDigest}`,
        secrets,
      ),
    );
  }
  return pushDigests.length > 0 ? pushDigests[0] : (inspectDigest as string);
}

function stripToken(raw: string): string {
  let end = raw.length;
  while (end > 0 && [',', '.', ';', ')', ']', '"', "'"].indexOf(raw[end - 1]) >= 0) {
    end -= 1;
  }
  return raw.slice(0, end);
}

function parsePushDigests(reference: string, output: string, secrets: ReadonlyArray<string>): string[] {
  const found: string[] = [];
  const pattern = /digest:\s*([^\s]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output)) !== null) {
    const token = stripToken(match[1]);
    if (!STRICT_DIGEST_PATTERN.test(token)) {
      throw new Error(
        redactSensitiveValues(
          `Failed to publish Docker reference "${reference}": malformed content digest in push output: ${truncateTail(token)}`,
          secrets,
        ),
      );
    }
    if (found.indexOf(token) < 0) {
      found.push(token);
    }
  }
  if (found.length > 1) {
    throw new Error(
      redactSensitiveValues(
        `Failed to publish Docker reference "${reference}": ambiguous content digests in push output: ${found.join(', ')}`,
        secrets,
      ),
    );
  }
  return found;
}

function parseInspectDigest(reference: string, output: string, secrets: ReadonlyArray<string>): string | undefined {
  const topLevel = topLevelManifestDigest(output);
  if (topLevel !== undefined) {
    if (!STRICT_DIGEST_PATTERN.test(topLevel)) {
      throw new Error(
        redactSensitiveValues(
          `Failed to publish Docker reference "${reference}": malformed content digest in inspect output: ${truncateTail(topLevel)}`,
          secrets,
        ),
      );
    }
    return topLevel;
  }
  const found: string[] = [];
  const pattern = /"digest"\s*:\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output)) !== null) {
    const token = match[1];
    if (!STRICT_DIGEST_PATTERN.test(token)) {
      throw new Error(
        redactSensitiveValues(
          `Failed to publish Docker reference "${reference}": malformed content digest in inspect output: ${truncateTail(token)}`,
          secrets,
        ),
      );
    }
    if (found.indexOf(token) < 0) {
      found.push(token);
    }
  }
  if (found.length === 0) {
    return undefined;
  }
  if (found.length > 1) {
    throw new Error(
      redactSensitiveValues(
        `Failed to publish Docker reference "${reference}": ambiguous content digests in inspect output: ${found.join(', ')}`,
        secrets,
      ),
    );
  }
  return found[0];
}

function topLevelManifestDigest(output: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return undefined;
  }
  if (!isPlainObject(parsed)) {
    return undefined;
  }
  const digest = (parsed as Record<string, unknown>)['digest'];
  return typeof digest === 'string' ? digest : undefined;
}

function resolveManifestPath(options: DockerPublishImagesOptions, plan: DockerPublishPlan): string | undefined {
  if (options === null || typeof options !== 'object') {
    return undefined;
  }
  const value = (options as { readonly digestManifestPath?: unknown }).digestManifestPath;
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('digestManifestPath must be a non-empty string');
  }
  if (value.includes('\0')) {
    throw new Error('digestManifestPath must not contain NUL bytes');
  }
  if (isAbsolute(value)) {
    throw new Error(`digestManifestPath must be relative: ${value}`);
  }
  const parts = value
    .replace(/\\/gu, '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.');
  if (parts.length === 0 || parts.indexOf('..') >= 0) {
    throw new Error(`digestManifestPath must be a non-root path without parent-directory segments: ${value}`);
  }
  const resolved = resolve(plan.cwd, parts.join('/'));
  const path = relative(plan.cwd, resolved);
  if (path === '' || path.slice(0, 2) === '..' || isAbsolute(path)) {
    throw new Error(`digestManifestPath escapes the project root: ${value}`);
  }
  ensureContainedPath(plan.cwd, resolved, 'digestManifestPath');
  return resolved;
}

function ensureContainedPath(root: string, target: string, label: string): void {
  let existing = target;
  while (!lstatSync(existing, { throwIfNoEntry: false })) {
    const parent = dirname(existing);
    if (parent === existing) {
      break;
    }
    existing = parent;
  }
  const resolvedExisting = realpathSync(existing);
  if (!isPathWithin(root, resolvedExisting)) {
    throw new Error(`${label} escapes the project root: ${target}`);
  }
}

function isPathWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || (path.slice(0, 2) !== '..' && !isAbsolute(path));
}

function writeDigestManifest(
  manifestPath: string,
  publishes: ReadonlyArray<DockerPublishedImage>,
  secrets: ReadonlyArray<string>,
): void {
  const entries: Record<string, string> = {};
  const sorted = [...publishes].sort((left, right) =>
    left.reference < right.reference ? -1 : left.reference > right.reference ? 1 : 0,
  );
  for (const entry of sorted) {
    entries[entry.reference] = entry.digest;
  }
  const content = `${JSON.stringify(entries, null, 2)}\n`;
  const sibling = `${manifestPath}.tmp-${process.pid}-${randomBytes(16).toString('hex')}`;
  try {
    mkdirSync(dirname(manifestPath), { recursive: true });
    if (lstatSync(sibling, { throwIfNoEntry: false })) {
      throw new Error(`Digest manifest temp path already exists: ${sibling}`);
    }
    writeFileSync(sibling, content, { encoding: 'utf8', flag: 'wx' });
    renameSync(sibling, manifestPath);
  } catch (error) {
    rmSync(sibling, { recursive: true, force: true });
    const detail = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(redactSensitiveValues(`Failed to write digest manifest: ${detail}`, secrets)) as Error & {
      cause?: unknown;
    };
    wrapped.cause = error;
    throw wrapped;
  }
}

function truncateTail(text: string): string {
  if (text.length <= ERROR_TAIL_MAX_CHARS) {
    return text;
  }
  return `...[truncated] ${text.slice(text.length - ERROR_TAIL_MAX_CHARS)}`;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function loginError(hostname: string, cause: unknown, secrets: ReadonlyArray<string>): Error {
  const wrapped = new Error(
    redactSensitiveValues(`Failed to authenticate Docker registry "${hostname}": ${errorText(cause)}`, secrets),
  ) as Error & { cause?: unknown };
  wrapped.cause = cause;
  return wrapped;
}

function publishError(reference: string, operation: string, cause: unknown, secrets: ReadonlyArray<string>): Error {
  return new Error(
    redactSensitiveValues(
      `Failed to publish Docker reference "${reference}" during ${operation}: ${errorText(cause)}`,
      secrets,
    ),
  );
}
