import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { isPlainObject } from '@repo-toolkit/publish-package';

const DEFAULT_BUILD_CONCURRENCY = 2;
const MAX_BUILD_CONCURRENCY = 64;
const DEFAULT_PROCESS_LIMITS = {
  timeoutMs: 600_000,
  maxOutputBytes: 1_048_576,
} as const;
const DEFAULT_DOCKER_EXECUTABLE = 'docker';
export const MAX_MAP_ENTRIES = 64;
export const MAX_MAP_KEY_LENGTH = 128;
export const MAX_MAP_VALUE_LENGTH = 4096;
export const SECRET_KEY_PATTERN = /TOKEN|SECRET|PASSWORD/u;

export const KNOWN_OS = new Set([
  'aix',
  'android',
  'darwin',
  'dragonfly',
  'freebsd',
  'illumos',
  'ios',
  'js',
  'linux',
  'netbsd',
  'openbsd',
  'plan9',
  'solaris',
  'windows',
]);

export const KNOWN_ARCH = new Set([
  '386',
  'amd64',
  'arm',
  'arm64',
  'loong64',
  'mips',
  'mips64',
  'mips64le',
  'mipsle',
  'ppc64',
  'ppc64le',
  'riscv64',
  's390x',
  'wasm',
]);

export interface DockerPublishImageOptions {
  readonly name: string;
  readonly contextDir: string;
  readonly dockerfile?: string;
  readonly target?: string;
  readonly buildArgs?: Readonly<Record<string, string>>;
  readonly labels?: Readonly<Record<string, string>>;
}

export interface DockerPublishRegistryOptions {
  readonly hostname: string;
  readonly repositoryPrefix?: string;
}

export interface DockerPublishProcessLimitsOptions {
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface DockerPublishVerificationOptions {
  readonly enabled?: boolean;
  readonly requireDigestMatch?: boolean;
}

export interface DockerPublishOptions {
  readonly cwd?: string;
  readonly images: ReadonlyArray<DockerPublishImageOptions>;
  readonly registries: ReadonlyArray<DockerPublishRegistryOptions>;
  readonly tags: ReadonlyArray<string>;
  readonly platforms: ReadonlyArray<string>;
  readonly buildArgs?: Readonly<Record<string, string>>;
  readonly labels?: Readonly<Record<string, string>>;
  readonly buildConcurrency?: number;
  readonly processLimits?: DockerPublishProcessLimitsOptions;
  readonly dockerExecutable?: string;
  readonly allowSecretsInBuildArgs?: boolean;
  readonly allowCustomPlatforms?: boolean;
  readonly verification?: DockerPublishVerificationOptions;
}

export interface DockerPublishImage {
  readonly name: string;
  readonly contextDir: string;
  readonly resolvedContextDir: string;
  readonly dockerfile: string;
  readonly resolvedDockerfile: string;
  readonly target?: string;
  readonly buildArgs: Readonly<Record<string, string>>;
  readonly labels: Readonly<Record<string, string>>;
  readonly references: ReadonlyArray<string>;
}

export interface DockerPublishRegistry {
  readonly hostname: string;
  readonly repositoryPrefix: string;
}

export interface DockerPublishPlatform {
  readonly os: string;
  readonly arch: string;
  readonly variant?: string;
  readonly name: string;
}

export interface DockerPublishProcessLimits {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface DockerPublishVerification {
  readonly enabled: boolean;
  readonly requireDigestMatch: boolean;
}

export interface DockerPublishPlan {
  readonly cwd: string;
  readonly images: ReadonlyArray<DockerPublishImage>;
  readonly registries: ReadonlyArray<DockerPublishRegistry>;
  readonly tags: ReadonlyArray<string>;
  readonly platforms: ReadonlyArray<DockerPublishPlatform>;
  readonly buildArgs: Readonly<Record<string, string>>;
  readonly labels: Readonly<Record<string, string>>;
  readonly buildConcurrency: number;
  readonly processLimits: DockerPublishProcessLimits;
  readonly dockerExecutable: string;
  readonly allowSecretsInBuildArgs: boolean;
  readonly allowCustomPlatforms: boolean;
  readonly verification: DockerPublishVerification;
  readonly references: ReadonlyArray<string>;
}

const OPTION_KEYS = new Set([
  'cwd',
  'images',
  'registries',
  'tags',
  'platforms',
  'buildArgs',
  'labels',
  'buildConcurrency',
  'processLimits',
  'dockerExecutable',
  'allowSecretsInBuildArgs',
  'allowCustomPlatforms',
  'verification',
]);

const IMAGE_KEYS = new Set(['name', 'contextDir', 'dockerfile', 'target', 'buildArgs', 'labels']);
const REGISTRY_KEYS = new Set(['hostname', 'repositoryPrefix']);
const PROCESS_LIMIT_KEYS = new Set(['timeoutMs', 'maxOutputBytes']);
const VERIFICATION_KEYS = new Set(['enabled', 'requireDigestMatch']);

export function formatImageReference(registry: string, repository: string, name: string, tag: string): string {
  if (typeof registry !== 'string' || registry.length === 0) {
    throw new Error('formatImageReference registry must be a non-empty string');
  }
  if (typeof repository !== 'string') {
    throw new Error('formatImageReference repository must be a string');
  }
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('formatImageReference name must be a non-empty string');
  }
  if (typeof tag !== 'string' || tag.length === 0) {
    throw new Error('formatImageReference tag must be a non-empty string');
  }
  for (const [label, part] of [
    ['registry', registry],
    ['repository', repository],
    ['name', name],
    ['tag', tag],
  ] as ReadonlyArray<readonly [string, string]>) {
    if (part.includes('\0')) {
      throw new Error(`formatImageReference ${label} must not contain NUL bytes`);
    }
    if (part.includes('{') || part.includes('}')) {
      throw new Error(`formatImageReference ${label} contains an unsupported template token: ${part}`);
    }
  }
  if (repository === '') {
    return `${registry}/${name}:${tag}`;
  }
  return `${registry}/${repository}/${name}:${tag}`;
}

export function resolveDockerPublishPlan(options: unknown): DockerPublishPlan {
  const input = validateOptions(options);
  const cwd = resolveProjectRoot(input.cwd);
  const allowSecrets = input.allowSecretsInBuildArgs ?? false;
  const allowCustomPlatforms = input.allowCustomPlatforms ?? false;
  const buildArgs = validateStringMap(input.buildArgs, 'buildArgs', allowSecrets);
  const labels = validateStringMap(input.labels, 'labels', allowSecrets);
  const registries = resolveRegistries(input.registries);
  const tags = resolveTags(input.tags);
  const platforms = resolvePlatforms(input.platforms, allowCustomPlatforms);
  const images = resolveImages(input.images, cwd, allowSecrets, registries, tags);

  const references: string[] = [];
  for (const image of images) {
    for (const reference of image.references) {
      references.push(reference);
    }
  }

  return {
    cwd,
    images,
    registries,
    tags,
    platforms,
    buildArgs,
    labels,
    buildConcurrency: resolveBuildConcurrency(input.buildConcurrency),
    processLimits: resolveProcessLimits(input.processLimits),
    dockerExecutable: validateNonEmptyString(input.dockerExecutable ?? DEFAULT_DOCKER_EXECUTABLE, 'dockerExecutable'),
    allowSecretsInBuildArgs: allowSecrets,
    allowCustomPlatforms,
    verification: resolveVerification(input.verification),
    references,
  };
}

export function assertResolvedImagePaths(plan: DockerPublishPlan, image: DockerPublishImage): void {
  const label = `image "${image.name}"`;
  const lexicalContextDir = resolve(plan.cwd, image.contextDir);
  ensureContainedPath(plan.cwd, lexicalContextDir, `${label}.contextDir`);
  const contextStats = lstatSync(lexicalContextDir, { throwIfNoEntry: false });
  if (!contextStats || !contextStats.isDirectory()) {
    throw new Error(`${label}.contextDir changed since plan resolution: ${image.contextDir}`);
  }
  if (realpathSync(lexicalContextDir) !== image.resolvedContextDir) {
    throw new Error(`${label}.contextDir changed since plan resolution: ${image.contextDir}`);
  }
  const lexicalDockerfile = resolve(plan.cwd, image.dockerfile);
  ensureContainedPath(plan.cwd, lexicalDockerfile, `${label}.dockerfile`);
  const dockerfileStats = lstatSync(lexicalDockerfile, { throwIfNoEntry: false });
  if (!dockerfileStats || !dockerfileStats.isFile()) {
    throw new Error(`${label}.dockerfile changed since plan resolution: ${image.dockerfile}`);
  }
  if (realpathSync(lexicalDockerfile) !== image.resolvedDockerfile) {
    throw new Error(`${label}.dockerfile changed since plan resolution: ${image.dockerfile}`);
  }
  if (!isPathWithin(image.resolvedContextDir, image.resolvedDockerfile)) {
    throw new Error(`${label}.dockerfile must resolve inside its image context: ${image.dockerfile}`);
  }
}

function validateOptions(value: unknown): DockerPublishOptions {
  const options = requireObject(value, 'options');
  rejectUnknownKeys(options, OPTION_KEYS, 'docker-publish option');
  validateOptionalString(options.cwd, 'cwd');
  validateRequiredArray(options.images, 'images');
  validateRequiredArray(options.registries, 'registries');
  validateRequiredArray(options.tags, 'tags');
  validateRequiredArray(options.platforms, 'platforms');
  if (options.buildArgs !== undefined) {
    requireObject(options.buildArgs, 'buildArgs');
  }
  if (options.labels !== undefined) {
    requireObject(options.labels, 'labels');
  }
  validateOptionalNumber(options.buildConcurrency, 'buildConcurrency');
  if (options.processLimits !== undefined) {
    requireObject(options.processLimits, 'processLimits');
  }
  validateOptionalString(options.dockerExecutable, 'dockerExecutable');
  validateOptionalBoolean(options.allowSecretsInBuildArgs, 'allowSecretsInBuildArgs');
  validateOptionalBoolean(options.allowCustomPlatforms, 'allowCustomPlatforms');
  if (options.verification !== undefined) {
    requireObject(options.verification, 'verification');
  }
  return options as unknown as DockerPublishOptions;
}

function resolveProjectRoot(value: string | undefined): string {
  const cwd = resolve(value ?? process.cwd());
  const stats = lstatSync(cwd, { throwIfNoEntry: false });
  if (!stats || !stats.isDirectory()) {
    throw new Error(`cwd must be an existing directory: ${cwd}`);
  }
  return realpathSync(cwd);
}

function resolveImages(
  value: ReadonlyArray<DockerPublishImageOptions>,
  cwd: string,
  allowSecrets: boolean,
  registries: ReadonlyArray<DockerPublishRegistry>,
  tags: ReadonlyArray<string>,
): ReadonlyArray<DockerPublishImage> {
  if (value.length === 0) {
    throw new Error('images must contain at least one entry');
  }
  const names = new Set<string>();
  const seenReferences = new Set<string>();
  return value.map((raw, index) => {
    const label = `images[${index}]`;
    const entry = requireObject(raw, label);
    rejectUnknownKeys(entry, IMAGE_KEYS, label);
    const name = validateImageName(entry.name, `${label}.name`);
    if (names.has(name)) {
      throw new Error(`Duplicate image name: ${name}`);
    }
    names.add(name);

    const contextDir = normalizeRelativePath(entry.contextDir, `${label}.contextDir`);
    const resolvedContextDir = resolve(cwd, contextDir);
    ensureContainedPath(cwd, resolvedContextDir, `${label}.contextDir`);
    const contextStats = lstatSync(resolvedContextDir, { throwIfNoEntry: false });
    if (!contextStats || !contextStats.isDirectory()) {
      throw new Error(`${label}.contextDir must be an existing directory: ${contextDir}`);
    }
    const realContextDir = realpathSync(resolvedContextDir);

    const dockerfileInput = entry.dockerfile ?? `${contextDir}/Dockerfile`;
    const dockerfile = normalizeRelativePath(dockerfileInput, `${label}.dockerfile`);
    const resolvedDockerfile = resolve(cwd, dockerfile);
    ensureContainedPath(cwd, resolvedDockerfile, `${label}.dockerfile`);
    const dockerfileStats = lstatSync(resolvedDockerfile, { throwIfNoEntry: false });
    if (!dockerfileStats || !dockerfileStats.isFile()) {
      throw new Error(`${label}.dockerfile must be an existing file: ${dockerfile}`);
    }
    const realDockerfile = realpathSync(resolvedDockerfile);
    if (!isPathWithin(realContextDir, realDockerfile)) {
      throw new Error(`${label}.dockerfile must resolve inside its image context: ${dockerfileInput}`);
    }

    validateOptionalString(entry.target, `${label}.target`);
    const target = entry.target === undefined ? undefined : validateTargetName(entry.target, `${label}.target`);
    const buildArgs = validateStringMap(entry.buildArgs, `${label}.buildArgs`, allowSecrets);
    const labels = validateStringMap(entry.labels, `${label}.labels`, allowSecrets);

    const references: string[] = [];
    for (const registry of registries) {
      for (const tag of tags) {
        const reference = formatImageReference(registry.hostname, registry.repositoryPrefix, name, tag);
        if (seenReferences.has(reference)) {
          throw new Error(`Duplicate image reference: ${reference}`);
        }
        seenReferences.add(reference);
        references.push(reference);
      }
    }

    return {
      name,
      contextDir,
      resolvedContextDir: realContextDir,
      dockerfile,
      resolvedDockerfile: realDockerfile,
      ...(target === undefined ? {} : { target }),
      buildArgs,
      labels,
      references,
    };
  });
}

function resolveRegistries(value: ReadonlyArray<DockerPublishRegistryOptions>): ReadonlyArray<DockerPublishRegistry> {
  if (value.length === 0) {
    throw new Error('registries must contain at least one entry');
  }
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const label = `registries[${index}]`;
    const entry = requireObject(raw, label);
    rejectUnknownKeys(entry, REGISTRY_KEYS, label);
    const hostname = validateRegistryHostname(entry.hostname, `${label}.hostname`);
    validateOptionalString(entry.repositoryPrefix, `${label}.repositoryPrefix`);
    const repositoryPrefix =
      entry.repositoryPrefix === undefined
        ? ''
        : validateRepositoryPrefix(entry.repositoryPrefix, `${label}.repositoryPrefix`);
    const key = `${hostname}/${repositoryPrefix}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate registry: ${hostname}${repositoryPrefix === '' ? '' : `/${repositoryPrefix}`}`);
    }
    seen.add(key);
    return { hostname, repositoryPrefix };
  });
}

function resolveTags(value: ReadonlyArray<string>): ReadonlyArray<string> {
  if (value.length === 0) {
    throw new Error('tags must contain at least one entry');
  }
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const tag = validateDockerTag(raw, `tags[${index}]`);
    if (seen.has(tag)) {
      throw new Error(`Duplicate tag: ${tag}`);
    }
    seen.add(tag);
    return tag;
  });
}

function resolvePlatforms(value: ReadonlyArray<string>, allowCustom: boolean): ReadonlyArray<DockerPublishPlatform> {
  if (value.length === 0) {
    throw new Error('platforms must contain at least one entry');
  }
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const label = `platforms[${index}]`;
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new Error(`${label} must be a non-empty string`);
    }
    if (raw.includes('\0')) {
      throw new Error(`${label} must not contain NUL bytes`);
    }
    const parts = raw.split('/');
    if (parts.length < 2 || parts.length > 3) {
      throw new Error(`${label} must use os/arch[/variant] form: ${raw}`);
    }
    const os = parts[0];
    const arch = parts[1];
    const variant = parts.length === 3 ? parts[2] : undefined;
    if (!/^[a-z0-9]+$/u.test(os)) {
      throw new Error(`${label} os must contain only lowercase ASCII letters and digits: ${raw}`);
    }
    if (!/^[a-z0-9]+$/u.test(arch)) {
      throw new Error(`${label} arch must contain only lowercase ASCII letters and digits: ${raw}`);
    }
    if (variant !== undefined && !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(variant)) {
      throw new Error(`${label} variant is not a valid platform variant: ${raw}`);
    }
    if (!allowCustom && !KNOWN_OS.has(os)) {
      throw new Error(
        `${label} uses unknown os '${os}'; expected one of ${[...KNOWN_OS].sort().join(', ')} or set allowCustomPlatforms to true`,
      );
    }
    if (!allowCustom && !KNOWN_ARCH.has(arch)) {
      throw new Error(
        `${label} uses unknown arch '${arch}'; expected one of ${[...KNOWN_ARCH].sort().join(', ')} or set allowCustomPlatforms to true`,
      );
    }
    const name = variant === undefined ? `${os}/${arch}` : `${os}/${arch}/${variant}`;
    if (seen.has(name)) {
      throw new Error(`Duplicate platform: ${name}`);
    }
    seen.add(name);
    return variant === undefined ? { os, arch, name } : { os, arch, variant, name };
  });
}

function resolveBuildConcurrency(value: number | undefined): number {
  const concurrency = value ?? DEFAULT_BUILD_CONCURRENCY;
  if (typeof concurrency !== 'number' || !Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error('buildConcurrency must be a positive safe integer');
  }
  if (concurrency > MAX_BUILD_CONCURRENCY) {
    throw new Error(`buildConcurrency must not exceed ${MAX_BUILD_CONCURRENCY}`);
  }
  return concurrency;
}

function resolveProcessLimits(value: DockerPublishProcessLimitsOptions | undefined): DockerPublishProcessLimits {
  if (value === undefined) {
    return { ...DEFAULT_PROCESS_LIMITS };
  }
  const entry = requireObject(value, 'processLimits');
  rejectUnknownKeys(entry, PROCESS_LIMIT_KEYS, 'processLimits');
  validateOptionalNumber(entry.timeoutMs, 'processLimits.timeoutMs');
  validateOptionalNumber(entry.maxOutputBytes, 'processLimits.maxOutputBytes');
  return {
    timeoutMs: validatePositiveInteger(entry.timeoutMs ?? DEFAULT_PROCESS_LIMITS.timeoutMs, 'processLimits.timeoutMs'),
    maxOutputBytes: validatePositiveInteger(
      entry.maxOutputBytes ?? DEFAULT_PROCESS_LIMITS.maxOutputBytes,
      'processLimits.maxOutputBytes',
    ),
  };
}

function resolveVerification(value: DockerPublishVerificationOptions | undefined): DockerPublishVerification {
  if (value === undefined) {
    return { enabled: true, requireDigestMatch: true };
  }
  const entry = requireObject(value, 'verification');
  rejectUnknownKeys(entry, VERIFICATION_KEYS, 'verification');
  validateOptionalBoolean(entry.enabled, 'verification.enabled');
  validateOptionalBoolean(entry.requireDigestMatch, 'verification.requireDigestMatch');
  return {
    enabled: entry.enabled === undefined ? true : validateBooleanValue(entry.enabled, 'verification.enabled'),
    requireDigestMatch:
      entry.requireDigestMatch === undefined
        ? true
        : validateBooleanValue(entry.requireDigestMatch, 'verification.requireDigestMatch'),
  };
}

function validateStringMap(value: unknown, label: string, allowSecrets: boolean): Readonly<Record<string, string>> {
  if (value === undefined) {
    return {};
  }
  const entry = requireObject(value, label);
  const keys = Object.keys(entry);
  if (keys.length > MAX_MAP_ENTRIES) {
    throw new Error(`${label} must not contain more than ${MAX_MAP_ENTRIES} entries`);
  }
  const result: Record<string, string> = {};
  for (const key of keys) {
    if (key.length === 0 || key.length > MAX_MAP_KEY_LENGTH) {
      throw new Error(`${label} keys must be 1-${MAX_MAP_KEY_LENGTH} characters long`);
    }
    if (/\s/u.test(key) || containsControlCharacter(key)) {
      throw new Error(`${label} key must not contain whitespace or control characters: ${key}`);
    }
    const mapValue = entry[key];
    if (typeof mapValue !== 'string') {
      throw new Error(`${label}.${key} must be a string`);
    }
    if (mapValue.includes('\0')) {
      throw new Error(`${label}.${key} must not contain NUL bytes`);
    }
    if (mapValue.length > MAX_MAP_VALUE_LENGTH) {
      throw new Error(`${label}.${key} must not exceed ${MAX_MAP_VALUE_LENGTH} characters`);
    }
    if (!allowSecrets && SECRET_KEY_PATTERN.test(key.toUpperCase())) {
      throw new Error(
        `${label}.${key} looks like a secret; refusing to embed it in build configuration unless allowSecretsInBuildArgs is true`,
      );
    }
    result[key] = mapValue;
  }
  return result;
}

function containsControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function validateImageName(value: unknown, label: string): string {
  const name = validateNonEmptyString(value, label);
  if (name.length > 255) {
    throw new Error(`${label} must not exceed 255 characters`);
  }
  if (!/^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*)(?:\/(?:[a-z0-9]+(?:[._-][a-z0-9]+)*))*$/u.test(name)) {
    throw new Error(`${label} must be a lowercase Docker repository name: ${name}`);
  }
  return name;
}

function validateRegistryHostname(value: unknown, label: string): string {
  const hostname = validateNonEmptyString(value, label);
  if (hostname.length > 255) {
    throw new Error(`${label} must not exceed 255 characters`);
  }
  if (hostname !== hostname.toLowerCase()) {
    throw new Error(`${label} must be lowercase: ${hostname}`);
  }
  if (hostname.includes('://')) {
    throw new Error(`${label} must be a hostname without a scheme: ${hostname}`);
  }
  if (hostname.includes('/')) {
    throw new Error(`${label} must be a hostname without a path: ${hostname}`);
  }
  if (hostname.includes('@')) {
    throw new Error(`${label} must be a hostname without userinfo: ${hostname}`);
  }
  if (/\s/u.test(hostname)) {
    throw new Error(`${label} must not contain whitespace: ${hostname}`);
  }
  const colonCount = hostname.split(':').length - 1;
  if (colonCount > 1) {
    throw new Error(`${label} must be a hostname with at most one port: ${hostname}`);
  }
  let host = hostname;
  if (colonCount === 1) {
    const portText = hostname.slice(hostname.lastIndexOf(':') + 1);
    host = hostname.slice(0, hostname.lastIndexOf(':'));
    if (!/^[0-9]+$/u.test(portText)) {
      throw new Error(`${label} port must be numeric: ${hostname}`);
    }
    const port = Number(portText);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
      throw new Error(`${label} port must be 1-65535: ${hostname}`);
    }
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/u.test(host)) {
    throw new Error(`${label} is not a valid registry hostname: ${hostname}`);
  }
  return hostname;
}

function validateRepositoryPrefix(value: unknown, label: string): string {
  const prefix = validateNonEmptyString(value, label);
  if (prefix.length > 255) {
    throw new Error(`${label} must not exceed 255 characters`);
  }
  if (prefix !== prefix.toLowerCase()) {
    throw new Error(`${label} must be lowercase: ${prefix}`);
  }
  if (prefix.includes('\0') || prefix.includes('{') || prefix.includes('}')) {
    throw new Error(`${label} contains unsupported characters: ${prefix}`);
  }
  for (const segment of prefix.split('/')) {
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(segment)) {
      throw new Error(`${label} must be a slash-separated lowercase repository path: ${prefix}`);
    }
  }
  return prefix;
}

function validateDockerTag(value: unknown, label: string): string {
  const tag = validateNonEmptyString(value, label);
  if (!/^[a-z0-9_][a-z0-9_.-]{0,127}$/u.test(tag)) {
    throw new Error(`${label} must match Docker tag rules [a-z0-9_][a-z0-9_.-]{0,127} (max 128 chars): ${tag}`);
  }
  return tag;
}

function validateTargetName(value: unknown, label: string): string {
  const target = validateNonEmptyString(value, label);
  if (target.length > 128) {
    throw new Error(`${label} must not exceed 128 characters`);
  }
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/u.test(target)) {
    throw new Error(`${label} is not a valid build stage name: ${target}`);
  }
  return target;
}

function normalizeRelativePath(value: unknown, label: string): string {
  const input = validateNonEmptyString(value, label);
  if (input.includes('\0')) {
    throw new Error(`${label} must not contain NUL bytes`);
  }
  const slashPath = input.replace(/\\/gu, '/');
  if (isAbsolute(input) || slashPath.startsWith('/') || /^[A-Za-z]:\//u.test(slashPath)) {
    throw new Error(`${label} must be relative: ${input}`);
  }
  const parts = slashPath.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.length === 0 || parts.indexOf('..') >= 0) {
    throw new Error(`${label} must be a non-root path without parent-directory segments: ${input}`);
  }
  return parts.join('/');
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

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function rejectUnknownKeys(value: Record<string, unknown>, keys: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) {
      throw new Error(`Unknown ${label}: ${key}`);
    }
  }
}

function validateRequiredArray(value: unknown, label: string): asserts value is ReadonlyArray<unknown> {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
}

function validateNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (value.includes('\0')) {
    throw new Error(`${label} must not contain NUL bytes`);
  }
  return value;
}

function validateOptionalString(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
}

function validateOptionalNumber(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'number') {
    throw new Error(`${label} must be a number`);
  }
}

function validateOptionalBoolean(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
}

function validateBooleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function validatePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}
