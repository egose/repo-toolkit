import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve, relative as pathRelative } from 'node:path';

import {
  DEFAULT_ACCESS,
  DEFAULT_BUILD_COMMAND,
  DEFAULT_PACKAGE_FILES,
  DEFAULT_PUBLISH_DIR,
  DEFAULT_ROOT_FILES,
  DEFAULT_VERSION_PLACEHOLDER,
  type PackageJson,
  type RootMetadata,
  validateRootManifest,
  validateSourceManifest,
} from './manifest';
import { inferNpmTag, isPlainObject, normalizeVersion } from './helpers';
import type { ProcessRunner } from './runner';
import { defaultProcessRunner } from './runner';

const PACKAGE_JSON = 'package.json';

export interface PublishPackageOptions {
  /** Package root directory. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Directory to source rootFiles from. Defaults to `cwd`. */
  rootDir?: string;
  /** Source package.json path. Relative paths resolve against `cwd`. */
  packageJsonPath?: string;
  /** Target package version. Defaults to `package.json.version`. */
  version?: string;
  /** npm dist-tag. Defaults to the prerelease `preid` inferred from `version`. */
  npmTag?: string;
  /** Forward `--dry-run` to `npm publish`. */
  dryRun?: boolean;
  /** npm access level. Defaults to `public`. */
  access?: string;
  /** npm registry URL. */
  registry?: string;
  /** npm OTP code. Forwarded to npm through its environment, never as a CLI argument. */
  otp?: string;
  /** Request npm provenance attestation. */
  provenance?: boolean;
  /** Files to copy from the package root into the publish directory. */
  packageFiles?: ReadonlyArray<string>;
  /** Additional files to copy from the package root (appended to `packageFiles`). */
  includePackageFiles?: ReadonlyArray<string>;
  /** Skip copying default package files. */
  noDefaultPackageFiles?: boolean;
  /** Files to copy from the rootDir into the publish directory. */
  rootFiles?: ReadonlyArray<string>;
  /** Additional files to copy from the rootDir (appended to `rootFiles`). */
  includeRootFiles?: ReadonlyArray<string>;
  /** Skip copying default root files. */
  noDefaultRootFiles?: boolean;
  /** Publish directory inside the package root. Defaults to `dist`. */
  publishDir?: string;
  /** Placeholder rewritten to the target version. Defaults to `0.0.0-PLACEHOLDER`. */
  versionPlaceholder?: string;
  /** Command used to build or prepare the publish directory. Defaults to `pnpm build`. */
  buildCommand?: string;
  /** Skip the build step. */
  skipBuild?: boolean;
  /** Names treated as internal workspace packages for dependency-range rewriting. */
  internalPackageNames?: ReadonlyArray<string> | Set<string>;
  /** Keep the configured publishDir inside the npm package instead of flattening it to the package root. Defaults to `false`. */
  preservePublishDir?: boolean;
  /**
   * Process runner used to execute the build command and `npm publish`.
   *
   * Defaults to {@link defaultProcessRunner}, which spawns child processes via
   * `execFileSync` and inherits stdio. Tests inject a fake runner to assert
   * exact invocations without contacting a real npm registry.
   */
  runner?: ProcessRunner;
}

export interface PublishPackagePlan {
  cwd: string;
  rootDir: string;
  packageJsonPath: string;
  publishDir: string;
  resolvedPublishDir: string;
  sourcePackageJson: PackageJson;
  rootPackageJson: PackageJson;
  packageNames: string[];
  version: string;
  npmTag?: string;
  versionPlaceholder: string;
  packageFiles: ReadonlyArray<string>;
  rootFiles: ReadonlyArray<string>;
  buildCommand: string;
  skipBuild: boolean;
  access: string;
  registry?: string;
  otp?: string;
  provenance: boolean;
  dryRun: boolean;
  internalPackageNames: Set<string>;
  preservePublishDir: boolean;
  runner: ProcessRunner;
}

export function resolvePublishPackagePlan(options: PublishPackageOptions = {}): PublishPackagePlan {
  const cwd = resolveDirectory(options.cwd, process.cwd());
  const rootDir = resolveDirectory(options.rootDir, cwd);
  const packageJsonPath = resolveInputPath(cwd, options.packageJsonPath ?? PACKAGE_JSON);
  const sourcePackageJson = readJson(packageJsonPath);
  validateSourceManifest(sourcePackageJson, packageJsonPath);
  const rootPackageJson = readJson(resolveInputPath(rootDir, PACKAGE_JSON));
  validateRootManifest(rootPackageJson, rootDir);
  const versionPlaceholder = options.versionPlaceholder ?? DEFAULT_VERSION_PLACEHOLDER;
  const publishDir = normalizePublishDir(options.publishDir ?? DEFAULT_PUBLISH_DIR);
  const version = resolveVersion(options.version, sourcePackageJson.version, versionPlaceholder);
  const packageNames = resolvePackageNames(sourcePackageJson);

  if (sourcePackageJson.private === true) {
    throw new Error(`Refusing to publish private package from ${packageJsonPath}`);
  }

  return {
    cwd,
    rootDir,
    packageJsonPath,
    publishDir,
    resolvedPublishDir: resolve(cwd, publishDir),
    sourcePackageJson,
    rootPackageJson,
    packageNames,
    version,
    npmTag: options.npmTag ?? inferNpmTag(version),
    versionPlaceholder,
    packageFiles: resolveFileList(
      options.packageFiles,
      options.includePackageFiles,
      options.noDefaultPackageFiles,
      DEFAULT_PACKAGE_FILES,
    ),
    rootFiles: resolveFileList(
      options.rootFiles,
      options.includeRootFiles,
      options.noDefaultRootFiles,
      DEFAULT_ROOT_FILES,
    ),
    buildCommand: options.buildCommand ?? DEFAULT_BUILD_COMMAND,
    skipBuild: options.skipBuild ?? false,
    access: options.access ?? DEFAULT_ACCESS,
    registry: options.registry,
    otp: options.otp,
    provenance: options.provenance ?? false,
    dryRun: options.dryRun ?? false,
    internalPackageNames: toStringSet(options.internalPackageNames),
    preservePublishDir: options.preservePublishDir ?? false,
    runner: options.runner ?? defaultProcessRunner,
  };
}

function resolveFileList(
  explicit: ReadonlyArray<string> | undefined,
  additional: ReadonlyArray<string> | undefined,
  noDefaults: boolean | undefined,
  defaults: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const base = noDefaults ? (explicit ?? []) : (explicit ?? defaults);
  const extra = additional ?? [];
  return [...base, ...extra];
}

function resolveDirectory(input: string | undefined, fallback: string): string {
  return resolve(input ?? fallback);
}

function resolveInputPath(baseDir: string, inputPath: string): string {
  if (isAbsolute(inputPath)) {
    return inputPath;
  }

  return resolve(baseDir, inputPath);
}

function normalizePublishDir(publishDir: string): string {
  if (isAbsolute(publishDir)) {
    throw new Error(`publishDir must be relative: ${publishDir}`);
  }

  const normalized = publishDir
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .replace(/^(?:\.\/)+/, '');

  if (!normalized || normalized === '.') {
    throw new Error('publishDir must not be the package root');
  }

  if (normalized.split('/').includes('..')) {
    throw new Error(`publishDir must not contain parent-directory segments: ${publishDir}`);
  }

  return normalized;
}

function resolveVersion(
  explicitVersion: string | undefined,
  packageJsonVersion: unknown,
  versionPlaceholder: string,
): string {
  if (explicitVersion) {
    return normalizeVersion(explicitVersion);
  }

  if (typeof packageJsonVersion !== 'string' || packageJsonVersion.length === 0) {
    throw new Error('package.json version missing and version not supplied');
  }

  if (packageJsonVersion === versionPlaceholder) {
    throw new Error('version is required when package.json.version uses the version placeholder');
  }

  return normalizeVersion(packageJsonVersion);
}

function resolvePackageNames(packageJson: PackageJson): string[] {
  const packageNames = [
    packageJson.name,
    ...(Array.isArray(packageJson.additionalNames) ? packageJson.additionalNames : []),
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  if (packageNames.length === 0) {
    throw new Error('No package names found in package.json');
  }

  return packageNames;
}

function toStringSet(value: ReadonlyArray<string> | Set<string> | undefined): Set<string> {
  if (!value) {
    return new Set<string>();
  }

  if (value instanceof Set) {
    return new Set(value);
  }

  return new Set(value);
}

function readJson(filePath: string): PackageJson {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

// ---------------------------------------------------------------------------
// Path-containment helpers (also used by the publish orchestration)
// ---------------------------------------------------------------------------

export function ensurePathWithinRoot(rootPath: string, targetPath: string, label: string): void {
  let candidatePath = resolve(targetPath);

  while (!existsSync(candidatePath)) {
    const parentPath = dirname(candidatePath);
    if (parentPath === candidatePath) {
      break;
    }
    candidatePath = parentPath;
  }

  assertPathWithinRoot(rootPath, realpathSync(candidatePath), label);
}

export function assertPathWithinRoot(rootPath: string, targetPath: string, label: string): void {
  const relativePath = pathRelative(rootPath, targetPath);

  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
    return;
  }

  throw new Error(`${label} escapes the package root: ${targetPath}`);
}

export function toRootMetadata(rootPackageJson: PackageJson, packageDirectory: string): RootMetadata {
  const repository = rootPackageJson.repository as RootMetadata['repository'];
  return {
    author: rootPackageJson.author as RootMetadata['author'],
    bugs: rootPackageJson.bugs as RootMetadata['bugs'],
    engines: rootPackageJson.engines as Record<string, string> | undefined,
    license: rootPackageJson.license as string | undefined,
    repository: repository === undefined ? undefined : mergeRepository(repository, packageDirectory),
  };
}

function mergeRepository(
  rootRepositoryValue: unknown,
  packageDirectory: string,
): Record<string, unknown> | string | undefined {
  if (typeof rootRepositoryValue === 'string') {
    return rootRepositoryValue;
  }

  if (!isPlainObject(rootRepositoryValue)) {
    return undefined;
  }

  if (!packageDirectory) {
    return { ...rootRepositoryValue };
  }

  return {
    ...rootRepositoryValue,
    directory: packageDirectory,
  };
}
