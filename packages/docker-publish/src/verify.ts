import { isPlainObject } from '@repo-toolkit/publish-package';

import { resolveDockerPublishPlan, type DockerPublishOptions, type DockerPublishPlan } from './plan';
import {
  resolveDockerRunner,
  runWithConcurrency,
  stripExtraKeys,
  type DockerRunner,
  type DockerRunOptions,
} from './runner';

const DEFAULT_MAX_MANIFEST_BYTES = 1_048_576;
const STRICT_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const VERIFY_EXTRA_KEYS = new Set(['runner', 'references', 'expectedDigests', 'pull', 'maxManifestBytes']);

/**
 * Default bound for concurrent manifest inspections.
 *
 * Verification is manifest-only (`buildx imagetools inspect --raw`, zero
 * pulls/pushes/logins); the bound limits concurrent registry reads while
 * evidence stays byte-identical to a serial run (results re-sorted by
 * reference before return).
 */
export const DEFAULT_VERIFY_CONCURRENCY = 4;

export type DockerVerifyRunner = DockerRunner;

export interface DockerVerifyOptions extends DockerPublishOptions {
  readonly runner?: DockerVerifyRunner;
  readonly references?: ReadonlyArray<string>;
  readonly expectedDigests?: Readonly<Record<string, string>>;
  readonly pull?: boolean;
  readonly maxManifestBytes?: number;
}

export interface DockerVerifiedReference {
  readonly reference: string;
  readonly expectedDigest: string;
  readonly observedDigest: string;
  readonly platforms: ReadonlyArray<string>;
  readonly match: boolean;
}

export interface DockerVerifyResult {
  readonly verified: boolean;
  readonly references: ReadonlyArray<DockerVerifiedReference>;
}

export async function verifyDockerPublish(options: DockerVerifyOptions): Promise<DockerVerifyResult> {
  const runner = resolveDockerRunner(options);
  const plan = resolveDockerPublishPlan(stripExtraKeys(options, VERIFY_EXTRA_KEYS) as unknown as DockerPublishOptions);
  rejectPullRequest(options);
  if (plan.verification.enabled === false) {
    throw new Error('verifyDockerPublish is disabled by plan policy (verification.enabled is false)');
  }
  const expected = resolveExpectedReferences(options, plan);
  const digests = resolveExpectedDigests(options, expected);
  const maxManifestBytes = resolveMaxManifestBytes(options, plan);
  const evidence = await runWithConcurrency(
    expected,
    Math.min(DEFAULT_VERIFY_CONCURRENCY, Math.max(expected.length, 1)),
    (reference) => verifyOneReference(plan, reference, digests[reference], maxManifestBytes, runner),
  );
  evidence.sort((left, right) => (left.reference < right.reference ? -1 : left.reference > right.reference ? 1 : 0));
  return { verified: true, references: evidence };
}

function rejectPullRequest(options: DockerVerifyOptions): void {
  if (options === null || typeof options !== 'object') {
    return;
  }
  const pull = (options as { readonly pull?: unknown }).pull;
  if (pull === undefined || pull === false) {
    return;
  }
  if (pull !== true) {
    throw new Error('pull must be a boolean');
  }
  throw new Error(
    'verifyDockerPublish performs manifest-only inspection and never retrieves image layers: pull: true is rejected',
  );
}

function resolveExpectedReferences(options: DockerVerifyOptions, plan: DockerPublishPlan): string[] {
  if (options === null || typeof options !== 'object') {
    return [...plan.references];
  }
  const value = (options as { readonly references?: unknown }).references;
  if (value === undefined) {
    return [...plan.references];
  }
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
  const planned = new Set<string>(plan.references);
  const requested = new Set<string>(entries);
  if (requested.size !== entries.length) {
    throw new Error('Duplicate verification reference');
  }
  const missing = plan.references.filter((reference) => !requested.has(reference));
  if (missing.length > 0) {
    throw new Error(`Verification reference set is missing expected reference(s): ${missing.join(', ')}`);
  }
  const additional = entries.filter((reference) => !planned.has(reference));
  if (additional.length > 0) {
    throw new Error(`Verification reference set includes unexpected reference(s): ${additional.join(', ')}`);
  }
  return [...entries];
}

function resolveExpectedDigests(options: DockerVerifyOptions, expected: ReadonlyArray<string>): Record<string, string> {
  if (options === null || typeof options !== 'object') {
    throw new Error('expectedDigests is required: provide publish digests mapping every planned reference');
  }
  const value = (options as { readonly expectedDigests?: unknown }).expectedDigests;
  if (value === undefined) {
    throw new Error('expectedDigests is required: provide publish digests mapping every planned reference');
  }
  if (!isPlainObject(value)) {
    throw new Error('expectedDigests must be a record of reference to digest');
  }
  const record = value as Record<string, unknown>;
  const expectedSet = new Set<string>(expected);
  const keys = Object.keys(record);
  const missing = expected.filter((reference) => keys.indexOf(reference) < 0);
  if (missing.length > 0) {
    throw new Error(`expectedDigests is missing expected reference(s): ${missing.join(', ')}`);
  }
  const additional = keys.filter((reference) => !expectedSet.has(reference));
  if (additional.length > 0) {
    throw new Error(`expectedDigests includes unexpected reference(s): ${additional.join(', ')}`);
  }
  const digests: Record<string, string> = {};
  for (const reference of expected) {
    const digest = record[reference];
    if (typeof digest !== 'string' || !STRICT_DIGEST_PATTERN.test(digest)) {
      throw new Error(
        `expectedDigests[${JSON.stringify(reference)}] must be a strict lowercase sha256 digest (sha256:<64 hex>)`,
      );
    }
    digests[reference] = digest;
  }
  return digests;
}

function resolveMaxManifestBytes(options: DockerVerifyOptions, plan: DockerPublishPlan): number {
  const fallback = Math.min(plan.processLimits.maxOutputBytes, DEFAULT_MAX_MANIFEST_BYTES);
  if (options === null || typeof options !== 'object') {
    return fallback;
  }
  const value = (options as { readonly maxManifestBytes?: unknown }).maxManifestBytes;
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('maxManifestBytes must be a positive safe integer');
  }
  return value;
}

async function verifyOneReference(
  plan: DockerPublishPlan,
  reference: string,
  expectedDigest: string,
  maxManifestBytes: number,
  runner: DockerRunner,
): Promise<DockerVerifiedReference> {
  const stdout = await captureRawManifest(plan, reference, runner);
  if (Buffer.byteLength(stdout, 'utf8') > maxManifestBytes) {
    throw new Error(
      `Verification failed for Docker reference "${reference}": manifest exceeds the ${maxManifestBytes}-byte bound`,
    );
  }
  const manifest = parseManifest(reference, stdout);
  const observedDigest = readObservedDigest(reference, manifest);
  const observed = readObservedPlatforms(reference, manifest);
  assertExactPlatformSet(
    reference,
    observed,
    plan.platforms.map((platform) => platform.name),
  );
  const digestEqual = observedDigest === expectedDigest;
  if (!digestEqual && plan.verification.requireDigestMatch) {
    throw new Error(
      `Verification failed for Docker reference "${reference}": digest mismatch: expected ${expectedDigest}, observed ${observedDigest}`,
    );
  }
  const platforms = [...observed].sort();
  return { reference, expectedDigest, observedDigest, platforms, match: digestEqual };
}

async function captureRawManifest(plan: DockerPublishPlan, reference: string, runner: DockerRunner): Promise<string> {
  const options: DockerRunOptions = {
    cwd: plan.cwd,
    timeoutMs: plan.processLimits.timeoutMs,
    maxOutputBytes: plan.processLimits.maxOutputBytes,
  };
  try {
    const output = await runner.capture(
      plan.dockerExecutable,
      ['buildx', 'imagetools', 'inspect', '--raw', reference],
      options,
    );
    return output.stdout;
  } catch (error) {
    const wrapped = new Error(
      `Verification failed for Docker reference "${reference}": manifest inspection failed: ${errorText(error)}`,
    ) as Error & { cause?: unknown };
    wrapped.cause = error;
    throw wrapped;
  }
}

function parseManifest(reference: string, text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(
      `Verification failed for Docker reference "${reference}": manifest is not valid JSON: ${detail}`,
    ) as Error & { cause?: unknown };
    wrapped.cause = error;
    throw wrapped;
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Verification failed for Docker reference "${reference}": manifest must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function readObservedDigest(reference: string, manifest: Record<string, unknown>): string {
  const mediaType = manifest['mediaType'];
  if (typeof mediaType !== 'string' || mediaType.length === 0 || mediaType.includes('\0')) {
    throw new Error(`Verification failed for Docker reference "${reference}": manifest is missing its mediaType`);
  }
  const digest = manifest['digest'];
  if (typeof digest !== 'string' || !STRICT_DIGEST_PATTERN.test(digest)) {
    throw new Error(`Verification failed for Docker reference "${reference}": malformed content digest in manifest`);
  }
  return digest;
}

function readObservedPlatforms(reference: string, manifest: Record<string, unknown>): string[] {
  const rawManifests = manifest['manifests'];
  if (rawManifests !== undefined) {
    if (!Array.isArray(rawManifests) || rawManifests.length === 0) {
      throw new Error(`Verification failed for Docker reference "${reference}": manifests must be a non-empty array`);
    }
    const names: string[] = [];
    for (let position = 0; position < rawManifests.length; position += 1) {
      const entry = rawManifests[position];
      if (!isPlainObject(entry)) {
        throw new Error(
          `Verification failed for Docker reference "${reference}": manifests[${position}] must be an object`,
        );
      }
      const rawPlatform = (entry as Record<string, unknown>)['platform'];
      if (!isPlainObject(rawPlatform)) {
        throw new Error(
          `Verification failed for Docker reference "${reference}": manifests[${position}].platform must be an object`,
        );
      }
      const name = platformName(reference, rawPlatform as Record<string, unknown>, `manifests[${position}].platform`);
      if (names.indexOf(name) >= 0) {
        throw new Error(`Verification failed for Docker reference "${reference}": duplicate platform entry: ${name}`);
      }
      names.push(name);
    }
    return names;
  }
  const rawConfig = manifest['config'];
  if (!isPlainObject(rawConfig)) {
    throw new Error(
      `Verification failed for Docker reference "${reference}": manifest must contain either a non-empty manifests array or a config object`,
    );
  }
  const configDigest = (rawConfig as Record<string, unknown>)['digest'];
  if (typeof configDigest !== 'string' || !STRICT_DIGEST_PATTERN.test(configDigest)) {
    throw new Error(`Verification failed for Docker reference "${reference}": malformed config digest in manifest`);
  }
  const rawPlatform = manifest['platform'];
  if (!isPlainObject(rawPlatform)) {
    throw new Error(
      `Verification failed for Docker reference "${reference}": single-image manifest must declare its platform object`,
    );
  }
  return [platformName(reference, rawPlatform as Record<string, unknown>, 'platform')];
}

function platformName(reference: string, platform: Record<string, unknown>, label: string): string {
  const os = platform['os'];
  const arch = platform['architecture'] === undefined ? platform['arch'] : platform['architecture'];
  const variant = platform['variant'];
  if (typeof os !== 'string' || os.length === 0 || os.includes('\0') || /\s/u.test(os)) {
    throw new Error(`Verification failed for Docker reference "${reference}": ${label}.os must be a non-empty token`);
  }
  if (typeof arch !== 'string' || arch.length === 0 || arch.includes('\0') || /\s/u.test(arch)) {
    throw new Error(`Verification failed for Docker reference "${reference}": ${label}.arch must be a non-empty token`);
  }
  if (variant !== undefined) {
    if (typeof variant !== 'string' || variant.length === 0 || variant.includes('\0') || /\s/u.test(variant)) {
      throw new Error(
        `Verification failed for Docker reference "${reference}": ${label}.variant must be a non-empty token`,
      );
    }
    return `${os}/${arch}/${variant}`;
  }
  return `${os}/${arch}`;
}

function assertExactPlatformSet(
  reference: string,
  observed: ReadonlyArray<string>,
  planned: ReadonlyArray<string>,
): void {
  const observedSet = new Set<string>(observed);
  const plannedSet = new Set<string>(planned);
  const missing = planned.filter((name) => !observedSet.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Verification failed for Docker reference "${reference}": missing expected platform(s): ${missing.join(', ')}`,
    );
  }
  const unexpected = observed.filter((name) => !plannedSet.has(name));
  if (unexpected.length > 0) {
    throw new Error(
      `Verification failed for Docker reference "${reference}": unexpected platform(s): ${unexpected.join(', ')}`,
    );
  }
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
