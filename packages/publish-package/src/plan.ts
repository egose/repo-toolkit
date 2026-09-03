import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, resolve, relative as pathRelative } from 'node:path';

import {
  DEFAULT_ACCESS,
  DEFAULT_BUILD_COMMAND,
  DEFAULT_PACKAGE_FILES,
  DEFAULT_PUBLISH_DIR,
  DEFAULT_ROOT_FILES,
  DEFAULT_VERSION_PLACEHOLDER,
  createPublishPackageJson,
  type PackageJson,
  type RootMetadata,
  validateRootManifest,
  validateSourceManifest,
} from './manifest';
import { inferNpmTag, isPlainObject } from './helpers';
import type { ProcessRunner } from './runner';
import { defaultProcessRunner } from './runner';
import {
  type VersionBump,
  VersionResolutionError,
  isVersionBump,
  normalizeReleaseVersion,
  resolveRegistryBumpVersion,
} from './version';

const PACKAGE_JSON = 'package.json';
const DEFAULT_ARTIFACT_ID = 'default';

/**
 * Constrained context passed to recipe hooks. Paths are absolute and the
 * publish stage is the recipe's isolated stage directory. Internal mutable
 * plan objects are never exposed to hooks.
 */
export interface PackageArtifactContext {
  /** Absolute package root directory. */
  cwd: string;
  /** Absolute root directory rootFiles are sourced from. */
  rootDir: string;
  /** Absolute isolated stage directory for this artifact. */
  stageDir: string;
  /** Target release version. */
  version: string;
  /** Artifact id from its recipe. */
  artifactId: string;
  /** Final published package name for this artifact. */
  packageName: string;
  /** Injectable process runner (shell-free for structured invocations). */
  runner: ProcessRunner;
}

export type PackageArtifactHook = (context: PackageArtifactContext) => void | Promise<void>;

/**
 * A manifest overlay merges plain-object fields into the generated publish
 * manifest after staging. May be a static object or a hook (ESM/CJS config
 * only; JSON config cannot express callback form). Release-safety fields such
 * as `private`, `scripts`, and `devDependencies` are never carried into the
 * generated manifest regardless of overlay content.
 */
export type PackageArtifactManifestOverlay =
  | Record<string, unknown>
  | ((context: PackageArtifactContext) => Record<string, unknown> | Promise<Record<string, unknown>>);

/**
 * Opt-in recipe describing one independently prepared artifact. When no
 * recipes are supplied, a single implicit artifact equivalent to today's
 * flattened output is used.
 */
export interface PackageArtifactRecipe {
  /** Stable artifact id. Must be unique and safe as a path segment. */
  id: string;
  /** Final published package name. */
  packageName: string;
  /**
   * Isolated stage directory, relative to the package root. Defaults to
   * `<publishDir>/.artifacts/<id>`. Must stay inside the package root.
   */
  stageDir?: string;
  /** Structured build/preparation work, executed inside the artifact stage. */
  build?: PackageArtifactHook;
  /** Generated manifest overlay applied after staging, before validation. */
  manifestOverlay?: PackageArtifactManifestOverlay;
  /** Post-manifest validation hook. Throwing rejects the artifact. */
  validate?: PackageArtifactHook;
  /** Require an exact tarball (`npm pack`) for this artifact. */
  requireTarball?: boolean;
  /**
   * Preserve the source manifest's `files` allow-list in this artifact's
   * generated manifest instead of the safe default files policy. The source
   * value must be an array of strings. Defaults to `false`.
   */
  preserveSourceFiles?: boolean;
  /**
   * Inject `publishConfig.access` into this artifact's generated manifest.
   * Metadata only; npm publication still receives `--access` explicitly.
   * Overrides the option-level `publishAccess` for this artifact.
   */
  publishAccess?: string;
}

/** A recipe resolved to absolute paths during plan resolution. */
export interface ResolvedPackageArtifact {
  id: string;
  packageName: string;
  stageDir: string;
  build?: PackageArtifactHook;
  manifestOverlay?: PackageArtifactManifestOverlay;
  validate?: PackageArtifactHook;
  requireTarball: boolean;
  preserveSourceFiles: boolean;
  publishAccess?: string;
}

/** Result of preparing (and optionally packing) one artifact. */
export interface PreparedPackageArtifact {
  id: string;
  packageName: string;
  version: string;
  stageDir: string;
  tarballPath?: string;
}

export interface PublishPackageOptions {
  /** Package root directory. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Directory to source rootFiles from. Defaults to `cwd`. */
  rootDir?: string;
  /** Source package.json path. Relative paths resolve against `cwd`. */
  packageJsonPath?: string;
  /** Target package version. Defaults to `package.json.version`. */
  version?: string;
  /**
   * Registry-derived version bump strategy (`major`, `minor`, or `patch`),
   * resolved via `npm view <name> version --json` against the base source
   * package name. Mutually exclusive with `version`; requires the async
   * {@link resolvePublishPackagePlanAsync} entry point.
   */
  bump?: VersionBump;
  /** npm dist-tag. Defaults to the prerelease `preid` inferred from `version`. */
  npmTag?: string;
  /** Forward `--dry-run` to `npm publish`. */
  dryRun?: boolean;
  /** npm access level. Defaults to `public`. */
  access?: string;
  /**
   * Inject `publishConfig.access` into generated manifests. Metadata only;
   * the npm `--access` argument remains the authorization mechanism.
   */
  publishAccess?: string;
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
  /**
   * Opt-in artifact recipes. When omitted, a single implicit artifact
   * equivalent to today's flattened output (with `additionalNames` sequencing)
   * is used. Cannot be combined with a source manifest `additionalNames` field.
   */
  artifacts?: ReadonlyArray<PackageArtifactRecipe>;
  /**
   * Prepare (and, if required, pack) every artifact without invoking
   * `npm publish`. Distinct from npm `--dry-run`. Defaults to `false`.
   */
  prepareOnly?: boolean;
  /**
   * Safety opt-in allowing a `private: true` source manifest to be used as a
   * non-publishable template. The generated release manifest still never
   * carries a `private` field. Defaults to `false`.
   */
  allowPrivateTemplate?: boolean;
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
  publishAccess?: string;
  registry?: string;
  otp?: string;
  provenance: boolean;
  dryRun: boolean;
  internalPackageNames: Set<string>;
  preservePublishDir: boolean;
  runner: ProcessRunner;
  prepareOnly: boolean;
  allowPrivateTemplate: boolean;
  artifacts: ReadonlyArray<ResolvedPackageArtifact>;
  /** True when `options.artifacts` supplied explicit recipes (versus the implicit default artifact). */
  hasExplicitRecipes: boolean;
}

export function resolvePublishPackagePlan(options: PublishPackageOptions = {}): PublishPackagePlan {
  if (options.bump !== undefined) {
    if (options.version !== undefined) {
      throw new VersionResolutionError('ambiguous-selection', 'version and bump are mutually exclusive');
    }

    if (!isVersionBump(options.bump)) {
      throw new VersionResolutionError(
        'invalid-version',
        `bump must be one of "major", "minor", or "patch": ${String(options.bump)}`,
      );
    }

    throw new VersionResolutionError(
      'unknown',
      'registry version bump requires the asynchronous resolvePublishPackagePlanAsync entry point',
    );
  }

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
  const allowPrivateTemplate = options.allowPrivateTemplate ?? false;

  if (sourcePackageJson.private === true && !allowPrivateTemplate) {
    throw new Error(`Refusing to publish private package from ${packageJsonPath}`);
  }

  const internalPackageNames = toStringSet(options.internalPackageNames);

  if (sourcePackageJson.private === true) {
    requirePublicGeneratedManifest(sourcePackageJson, packageJsonPath, version, {
      internalPackageNames,
      rootPackageJson,
      versionPlaceholder,
      publishDir,
      preservePublishDir: options.preservePublishDir ?? false,
    });
  }

  const artifacts = resolveArtifacts(options.artifacts, { cwd, publishDir, packageNames, sourcePackageJson });

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
    publishAccess: options.publishAccess,
    registry: options.registry,
    otp: options.otp,
    provenance: options.provenance ?? false,
    dryRun: options.dryRun ?? false,
    internalPackageNames,
    preservePublishDir: options.preservePublishDir ?? false,
    runner: options.runner ?? defaultProcessRunner,
    prepareOnly: options.prepareOnly ?? false,
    allowPrivateTemplate,
    artifacts,
    hasExplicitRecipes: options.artifacts !== undefined && options.artifacts.length > 0,
  };
}

function requirePublicGeneratedManifest(
  sourcePackageJson: PackageJson,
  packageJsonPath: string,
  version: string,
  settings: {
    internalPackageNames: Set<string>;
    rootPackageJson: PackageJson;
    versionPlaceholder: string;
    publishDir: string;
    preservePublishDir: boolean;
  },
): void {
  const generated = createPublishPackageJson(sourcePackageJson, {
    version,
    internalPackageNames: settings.internalPackageNames,
    rootMetadata: toRootMetadata(settings.rootPackageJson, ''),
    rewrite: {
      versionPlaceholder: settings.versionPlaceholder,
      publishDir: settings.publishDir,
      preservePublishDir: settings.preservePublishDir,
    },
  });

  if (Object.prototype.hasOwnProperty.call(generated, 'private')) {
    throw new Error(`Generated publish manifest from ${packageJsonPath} must not contain "private"`);
  }
}

function resolveArtifacts(
  recipes: ReadonlyArray<PackageArtifactRecipe> | undefined,
  context: {
    cwd: string;
    publishDir: string;
    packageNames: string[];
    sourcePackageJson: PackageJson;
  },
): ReadonlyArray<ResolvedPackageArtifact> {
  if (!recipes || recipes.length === 0) {
    return [
      {
        id: DEFAULT_ARTIFACT_ID,
        packageName: context.packageNames[0],
        stageDir: resolve(context.cwd, context.publishDir),
        requireTarball: false,
        preserveSourceFiles: false,
      },
    ];
  }

  if (
    Array.isArray(context.sourcePackageJson.additionalNames) &&
    context.sourcePackageJson.additionalNames.length > 0
  ) {
    throw new Error('artifacts cannot be combined with source manifest additionalNames');
  }

  const cwd = context.cwd;
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const seenStages = new Set<string>();

  return recipes.map((recipe) => {
    const id = recipe.id;
    const packageName = recipe.packageName;

    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('artifact id must be a non-empty string');
    }

    if (id.includes('/') || id.includes('\\') || id.includes('..')) {
      throw new Error(`artifact id must be a safe path segment: ${id}`);
    }

    if (typeof packageName !== 'string' || packageName.length === 0) {
      throw new Error(`artifact packageName must be a non-empty string: ${id}`);
    }

    if (
      recipe.publishAccess !== undefined &&
      (typeof recipe.publishAccess !== 'string' || recipe.publishAccess.length === 0)
    ) {
      throw new Error(`artifact publishAccess must be a non-empty string: ${id}`);
    }

    if (seenIds.has(id)) {
      throw new Error(`duplicate artifact id: ${id}`);
    }

    if (seenNames.has(packageName)) {
      throw new Error(`duplicate artifact package name: ${packageName}`);
    }

    const stageDir =
      recipe.stageDir === undefined
        ? resolve(cwd, context.publishDir, '.artifacts', id)
        : resolveStageDir(cwd, recipe.stageDir);

    if (seenStages.has(stageDir)) {
      throw new Error(`duplicate artifact stage directory: ${stageDir}`);
    }

    seenIds.add(id);
    seenNames.add(packageName);
    seenStages.add(stageDir);

    return {
      id,
      packageName,
      stageDir,
      build: recipe.build,
      manifestOverlay: recipe.manifestOverlay,
      validate: recipe.validate,
      requireTarball: recipe.requireTarball ?? false,
      preserveSourceFiles: recipe.preserveSourceFiles ?? false,
      publishAccess: recipe.publishAccess,
    };
  });
}

function resolveStageDir(cwd: string, stageDir: string): string {
  if (isAbsolute(stageDir)) {
    throw new Error(`artifact stageDir must be relative to the package root: ${stageDir}`);
  }

  const resolved = resolve(cwd, stageDir);
  ensurePathWithinRoot(cwd, resolved, 'artifact stageDir');
  return resolved;
}

/** Build the constrained hook context for a resolved artifact. */
export function resolveArtifactContext(
  plan: PublishPackagePlan,
  artifact: ResolvedPackageArtifact,
): PackageArtifactContext {
  return {
    cwd: plan.cwd,
    rootDir: plan.rootDir,
    stageDir: artifact.stageDir,
    version: plan.version,
    artifactId: artifact.id,
    packageName: artifact.packageName,
    runner: plan.runner,
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
    return normalizeReleaseVersion(explicitVersion, 'version');
  }

  if (typeof packageJsonVersion !== 'string' || packageJsonVersion.length === 0) {
    throw new Error('package.json version missing and version not supplied');
  }

  if (packageJsonVersion === versionPlaceholder) {
    throw new Error('version is required when package.json.version uses the version placeholder');
  }

  return normalizeReleaseVersion(packageJsonVersion, 'package.json version');
}

/**
 * Asynchronous plan resolution supporting registry-derived versions. When
 * `options.bump` is set, the prior version is looked up via
 * `npm view <name> version --json` for the base source package name and the
 * bump is applied; otherwise this behaves exactly like
 * {@link resolvePublishPackagePlan}. Throws {@link VersionResolutionError}
 * with a classified `kind` for every registry failure; only a confirmed
 * package-absence response starts from `0.0.0`.
 */
export async function resolvePublishPackagePlanAsync(options: PublishPackageOptions = {}): Promise<PublishPackagePlan> {
  if (options.bump === undefined) {
    return resolvePublishPackagePlan(options);
  }

  if (options.version !== undefined) {
    throw new VersionResolutionError('ambiguous-selection', 'version and bump are mutually exclusive');
  }

  if (!isVersionBump(options.bump)) {
    throw new VersionResolutionError(
      'invalid-version',
      `bump must be one of "major", "minor", or "patch": ${String(options.bump)}`,
    );
  }

  const bump = options.bump;
  const cwd = resolveDirectory(options.cwd, process.cwd());
  const packageJsonPath = resolveInputPath(cwd, options.packageJsonPath ?? PACKAGE_JSON);
  const sourcePackageJson = readJson(packageJsonPath);
  const packageName = sourcePackageJson.name;

  if (typeof packageName !== 'string' || packageName.length === 0) {
    throw new Error('package.json name missing; required for registry version resolution');
  }

  const version = await resolveRegistryBumpVersion({
    packageName,
    bump,
    registry: options.registry,
    cwd,
    runner: options.runner ?? defaultProcessRunner,
  });

  return resolvePublishPackagePlan({ ...options, bump: undefined, version });
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
