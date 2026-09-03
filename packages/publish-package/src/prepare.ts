import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, relative as pathRelative, basename as pathBasename } from 'node:path';

import { isPlainObject } from './helpers';
import { applyManifestOverlay, createPublishPackageJson, type PackageJson } from './manifest';
import {
  type PackageArtifactContext,
  type PackageArtifactManifestOverlay,
  type PreparedPackageArtifact,
  type PublishPackagePlan,
  type ResolvedPackageArtifact,
  assertPathWithinRoot,
  ensurePathWithinRoot,
  resolveArtifactContext,
  toRootMetadata,
} from './plan';
import { isCapturingProcessRunner } from './runner';
import { redactSensitiveValues } from './version';

const PACKAGE_JSON = 'package.json';

export interface PreparedArtifactEntry {
  artifact: ResolvedPackageArtifact;
  result: PreparedPackageArtifact;
  /** Directory whose contents are published (manifest root) for this artifact. */
  publishRoot: string;
  /** True for the implicit legacy artifact: the manifest name is rewritten per plan.packageNames at publish time. */
  sequenceNames: boolean;
  /** Base generated manifest (without per-name override) for sequenceNames entries. */
  manifestData?: PackageJson;
}

export interface PrepareSession {
  plan: PublishPackagePlan;
  entries: PreparedArtifactEntry[];
  results: PreparedPackageArtifact[];
  /** Removes temporary internal staging. Never removes recipe stage dirs, retained tarballs, or the original publish dir. */
  cleanup(): void;
}

/**
 * Runs the full preparation phase for every artifact in the plan: build hook,
 * staging, package/root file copies, manifest generation, manifest overlay,
 * validation, and (when the recipe requires it) exact tarball packing. No npm
 * publish is invoked here; callers publish only after every artifact succeeds.
 */
export async function prepareArtifacts(plan: PublishPackagePlan): Promise<PrepareSession> {
  const packageRoot = realpathSync(plan.cwd);
  const temporaryStaging: string[] = [];
  let entries: PreparedArtifactEntry[];
  try {
    entries = plan.hasExplicitRecipes
      ? await prepareRecipeArtifacts(plan, packageRoot)
      : [prepareImplicitArtifact(plan, packageRoot, temporaryStaging)];
  } catch (error) {
    cleanupTemporaryStaging(temporaryStaging);
    throw error;
  }

  return {
    plan,
    entries,
    results: entries.map((entry) => entry.result),
    cleanup() {
      if (plan.prepareOnly) {
        return;
      }
      cleanupTemporaryStaging(temporaryStaging);
    },
  };
}

function prepareImplicitArtifact(
  plan: PublishPackagePlan,
  packageRoot: string,
  temporaryStaging: string[],
): PreparedArtifactEntry {
  const artifact = plan.artifacts[0];

  ensurePathWithinRoot(packageRoot, plan.resolvedPublishDir, 'publish directory');

  if (!plan.skipBuild) {
    wrapRunnerErrors('build', () => {
      plan.runner.runShell(plan.buildCommand, { cwd: plan.cwd });
    });
    ensurePathWithinRoot(packageRoot, plan.resolvedPublishDir, 'publish directory');
    if (!existsSync(plan.resolvedPublishDir)) {
      throw new Error(`Missing publish directory after build: ${plan.resolvedPublishDir}`);
    }
  }

  const manifestData = createPublishPackageJson(plan.sourcePackageJson, {
    version: plan.version,
    internalPackageNames: plan.internalPackageNames,
    rootMetadata: toRootMetadata(plan.rootPackageJson, pathRelative(plan.rootDir, plan.cwd)),
    rewrite: {
      versionPlaceholder: plan.versionPlaceholder,
      publishDir: plan.publishDir,
      preservePublishDir: plan.preservePublishDir,
    },
    publishAccess: plan.publishAccess,
  });

  if (!plan.preservePublishDir) {
    ensurePathWithinRoot(packageRoot, plan.resolvedPublishDir, 'publish directory');
    mkdirSync(plan.resolvedPublishDir, { recursive: true });
    detectCopyCollisions([...plan.packageFiles, ...plan.rootFiles]);
    copyFilesFromDirectory(plan.cwd, plan.resolvedPublishDir, plan.packageFiles);
    copyFilesFromDirectory(plan.rootDir, plan.resolvedPublishDir, plan.rootFiles);

    return {
      artifact,
      publishRoot: plan.resolvedPublishDir,
      sequenceNames: true,
      manifestData,
      result: {
        id: artifact.id,
        packageName: artifact.packageName,
        version: plan.version,
        stageDir: plan.resolvedPublishDir,
      },
    };
  }

  const stagingRoot = mkdtempSync(join(tmpdir(), 'repo-toolkit-publish-'));
  temporaryStaging.push(stagingRoot);
  const stagedPublishDir = resolve(stagingRoot, plan.publishDir);
  ensurePathWithinRoot(packageRoot, plan.resolvedPublishDir, 'publish directory');
  mkdirSync(stagedPublishDir, { recursive: true });
  copyBuildOutputRecursively(plan.resolvedPublishDir, stagedPublishDir, packageRoot);
  detectCopyCollisions([...plan.packageFiles, ...plan.rootFiles]);
  copyFilesFromDirectory(plan.cwd, stagingRoot, plan.packageFiles);
  copyFilesFromDirectory(plan.rootDir, stagingRoot, plan.rootFiles);

  return {
    artifact,
    publishRoot: stagingRoot,
    sequenceNames: true,
    manifestData,
    result: {
      id: artifact.id,
      packageName: artifact.packageName,
      version: plan.version,
      stageDir: stagingRoot,
    },
  };
}

async function prepareRecipeArtifacts(plan: PublishPackagePlan, packageRoot: string): Promise<PreparedArtifactEntry[]> {
  const entries: PreparedArtifactEntry[] = [];

  for (const artifact of plan.artifacts) {
    entries.push(await prepareRecipeArtifact(plan, packageRoot, artifact));
  }

  return entries;
}

async function prepareRecipeArtifact(
  plan: PublishPackagePlan,
  packageRoot: string,
  artifact: ResolvedPackageArtifact,
): Promise<PreparedArtifactEntry> {
  const context = resolveArtifactContext(plan, artifact);

  try {
    ensurePathWithinRoot(packageRoot, artifact.stageDir, 'artifact stageDir');
    if (existsSync(artifact.stageDir)) {
      if (!lstatSync(artifact.stageDir).isDirectory() || readdirSync(artifact.stageDir).length > 0) {
        throw new Error(`artifact stage directory must be empty or absent: ${artifact.stageDir}`);
      }
    } else {
      mkdirSync(artifact.stageDir, { recursive: true });
    }
  } catch (error) {
    throw artifactPhaseError(artifact, 'staging', error);
  }

  if (artifact.build) {
    try {
      await artifact.build(context);
    } catch (error) {
      throw artifactPhaseError(artifact, 'build', error);
    }
    try {
      ensurePathWithinRoot(packageRoot, artifact.stageDir, 'artifact stageDir');
      assertStageSymlinksContained(packageRoot, artifact.stageDir);
    } catch (error) {
      throw artifactPhaseError(artifact, 'build', error);
    }
  }

  try {
    detectCopyCollisions([...plan.packageFiles, ...plan.rootFiles]);
    copyFilesFromDirectory(plan.cwd, artifact.stageDir, plan.packageFiles);
    copyFilesFromDirectory(plan.rootDir, artifact.stageDir, plan.rootFiles);
  } catch (error) {
    throw artifactPhaseError(artifact, 'copy', error);
  }

  try {
    let manifest = createPublishPackageJson(plan.sourcePackageJson, {
      version: plan.version,
      internalPackageNames: plan.internalPackageNames,
      rootMetadata: toRootMetadata(plan.rootPackageJson, pathRelative(plan.rootDir, plan.cwd)),
      rewrite: {
        versionPlaceholder: plan.versionPlaceholder,
        publishDir: plan.publishDir,
        preservePublishDir: false,
        preserveSourceFiles: artifact.preserveSourceFiles,
      },
      publishAccess: artifact.publishAccess ?? plan.publishAccess,
    });
    manifest.name = artifact.packageName;

    if (artifact.manifestOverlay !== undefined) {
      const overlay = await resolveManifestOverlay(artifact.manifestOverlay, context, artifact);
      manifest = applyManifestOverlay(manifest, overlay, {
        version: plan.version,
        packageName: artifact.packageName,
        internalPackageNames: plan.internalPackageNames,
        versionPlaceholder: plan.versionPlaceholder,
      });
    }

    writeJson(resolve(artifact.stageDir, PACKAGE_JSON), manifest);
  } catch (error) {
    throw artifactPhaseError(artifact, 'manifest', error);
  }

  if (artifact.validate) {
    try {
      await artifact.validate(context);
    } catch (error) {
      throw artifactPhaseError(artifact, 'validate', error);
    }
  }

  let tarballPath: string | undefined;
  if (artifact.requireTarball) {
    try {
      tarballPath = await packArtifact(plan, artifact);
    } catch (error) {
      throw artifactPhaseError(artifact, 'pack', error);
    }
  }

  return {
    artifact,
    publishRoot: artifact.stageDir,
    sequenceNames: false,
    result: {
      id: artifact.id,
      packageName: artifact.packageName,
      version: plan.version,
      stageDir: artifact.stageDir,
      ...(tarballPath !== undefined ? { tarballPath } : {}),
    },
  };
}

function cleanupTemporaryStaging(temporaryStaging: ReadonlyArray<string>): void {
  for (const dir of temporaryStaging) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function assertStageSymlinksContained(packageRoot: string, stageDir: string): void {
  const stageRoot = realpathSync(stageDir);
  for (const entry of readdirSync(stageRoot, { withFileTypes: true })) {
    const entryPath = resolve(stageRoot, entry.name);
    const stat = lstatSync(entryPath);
    if (stat.isSymbolicLink()) {
      const targetPath = realpathSync(entryPath);
      assertPathWithinRoot(packageRoot, targetPath, 'artifact stage symlink');
      assertPathWithinRoot(stageRoot, targetPath, 'artifact stage symlink');
      continue;
    }
    if (stat.isDirectory()) {
      assertStageSymlinksContained(packageRoot, entryPath);
    }
  }
}

/**
 * Resolves a recipe manifest overlay to a plain object. Field-level policy
 * (protected-field deny-list, exports/files shape validation, dependency
 * rewriting, and final manifest re-validation) lives in
 * `applyManifestOverlay` in `manifest.ts` — this seam only guarantees the
 * overlay value itself is a plain object before that policy is applied.
 */
async function resolveManifestOverlay(
  overlay: PackageArtifactManifestOverlay,
  context: PackageArtifactContext,
  artifact: ResolvedPackageArtifact,
): Promise<Record<string, unknown>> {
  const value = typeof overlay === 'function' ? await overlay(context) : overlay;
  if (!isPlainObject(value)) {
    throw new Error(`artifact manifest overlay must resolve to a plain object: ${artifact.id}`);
  }
  return value as Record<string, unknown>;
}

async function packArtifact(plan: PublishPackagePlan, artifact: ResolvedPackageArtifact): Promise<string> {
  const runner = plan.runner;
  if (!isCapturingProcessRunner(runner)) {
    throw new Error(
      `artifact ${artifact.id}: npm pack requires a runner implementing the CapturingProcessRunner capability`,
    );
  }

  const destinationDir = dirname(artifact.stageDir);
  const result = await runner.capture(
    'npm',
    ['pack', '--json', '--ignore-scripts', '--pack-destination', destinationDir],
    {
      cwd: artifact.stageDir,
    },
  );

  if (result.error) {
    const wrapped = new Error(
      `npm pack failed: ${redactSensitiveValues(result.error.message, [plan.registry])}`,
    ) as Error & {
      cause?: unknown;
    };
    wrapped.cause = result.error;
    throw wrapped;
  }

  if (result.code !== 0) {
    throw new Error(
      `npm pack exited with code ${String(result.code)}: ${redactSensitiveValues(result.stderr, [plan.registry])}`,
    );
  }

  return resolvePackTarball(plan, artifact, result.stdout, destinationDir);
}

function resolvePackTarball(
  plan: PublishPackagePlan,
  artifact: ResolvedPackageArtifact,
  stdout: string,
  destinationDir: string,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`npm pack returned malformed JSON for artifact ${artifact.id}`);
  }

  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error(`npm pack must return a JSON array with exactly one entry for artifact ${artifact.id}`);
  }

  const entry: unknown = parsed[0];
  if (!isPlainObject(entry)) {
    throw new Error(`npm pack entry must be an object for artifact ${artifact.id}`);
  }

  const filename = (entry as Record<string, unknown>).filename;
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error(`npm pack entry is missing a filename for artifact ${artifact.id}`);
  }

  if (isAbsolute(filename) || filename !== pathBasename(filename) || filename.includes('..')) {
    throw new Error(`npm pack returned an unsafe filename for artifact ${artifact.id}: ${filename}`);
  }

  const expectedFilename = `${artifact.packageName.replace(/^@/, '').replace(/\//g, '-')}-${plan.version}.tgz`;
  if (filename !== expectedFilename) {
    throw new Error(
      `npm pack returned an unexpected filename for artifact ${artifact.id}: ${filename} (expected ${expectedFilename})`,
    );
  }

  const tarballPath = resolve(destinationDir, filename);
  assertPathWithinRoot(realpathSync(destinationDir), tarballPath, 'npm pack tarball');

  if (!existsSync(tarballPath) || !lstatSync(tarballPath).isFile()) {
    throw new Error(`npm pack tarball does not exist for artifact ${artifact.id}: ${tarballPath}`);
  }

  return tarballPath;
}

export function artifactPhaseError(artifact: ResolvedPackageArtifact, phase: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = new Error(
    `artifact "${artifact.id}" (${artifact.packageName}) ${phase} phase failed: ${message}`,
  ) as Error & {
    cause?: unknown;
  };
  wrapped.cause = error;
  return wrapped;
}

export function wrapRunnerErrors(label: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) {
      const redacted = redactSensitive(error.message);
      if (redacted !== error.message) {
        const wrapped = new Error(`${label}: ${redacted}`) as Error & { cause?: unknown };
        wrapped.cause = error;
        throw wrapped;
      }
    }
    throw error;
  }
}

function redactSensitive(message: string): string {
  return message.replace(/(otp[= :]+)([^\s]+)/gi, '$1[redacted]');
}

export function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * Copies files from `sourceDir` into `publishDir`.
 *
 * Subpaths are flattened: `--package-files docs/llms.txt` copies to
 * `dist/llms.txt`, not `dist/docs/llms.txt`. This matches npm's publish
 * directory semantics where the publish dir is the root of the tarball.
 */
function copyFilesFromDirectory(sourceDir: string, publishDir: string, fileNames: ReadonlyArray<string>): void {
  const sourceRoot = realpathSync(sourceDir);

  for (const fileName of fileNames) {
    assertSafeRelativeCopySource(fileName);
    const sourcePath = resolve(sourceDir, fileName);
    if (!existsSync(sourcePath)) {
      continue;
    }

    const resolvedSourcePath = realpathSync(sourcePath);
    assertPathWithinRoot(sourceRoot, resolvedSourcePath, `copy source ${fileName}`);

    if (!lstatSync(resolvedSourcePath).isFile()) {
      throw new Error(`Copy source must be a regular file: ${fileName}`);
    }

    copyFileSync(resolvedSourcePath, resolve(publishDir, pathBasename(fileName)));
  }
}

function assertSafeRelativeCopySource(fileName: string): void {
  if (isAbsolute(fileName)) {
    throw new Error(`Copy source must be relative: ${fileName}`);
  }

  const normalized = fileName.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) {
    throw new Error(`Copy source must not contain parent-directory segments: ${fileName}`);
  }
}

export function detectCopyCollisions(allFiles: ReadonlyArray<string>): void {
  const seen = new Map<string, string>();

  for (const fileName of allFiles) {
    const dest = pathBasename(fileName);
    const existingSource = seen.get(dest);
    if (existingSource !== undefined) {
      if (existingSource === fileName) {
        throw new Error(`Duplicate copy entry: ${fileName} listed more than once`);
      }
      throw new Error(`Copy destination collision: ${existingSource} and ${fileName} both copy to ${dest}`);
    }
    seen.set(dest, fileName);
  }
}

function isPathWithinRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = pathRelative(rootPath, targetPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
}

function copyBuildOutputRecursively(srcDir: string, destDir: string, packageRoot: string): void {
  const srcReal = realpathSync(srcDir);
  const entries = readdirSync(srcReal, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = resolve(srcReal, entry.name);
    const destPath = resolve(destDir, entry.name);
    const lstat = lstatSync(srcPath);
    if (lstat.isSymbolicLink()) {
      const linkTarget = readlinkSync(srcPath);
      const resolvedTarget = resolve(dirname(srcPath), linkTarget);
      let targetCheckPath: string;
      try {
        targetCheckPath = realpathSync(resolvedTarget);
      } catch {
        targetCheckPath = resolvedTarget;
      }
      if (!isPathWithinRoot(packageRoot, targetCheckPath) || !isPathWithinRoot(srcReal, targetCheckPath)) {
        continue;
      }
      symlinkSync(linkTarget, destPath);
      continue;
    }
    if (lstat.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      try {
        chmodSync(destPath, lstat.mode);
      } catch (_error) {
        void _error;
      }
      copyBuildOutputRecursively(srcPath, destPath, packageRoot);
      continue;
    }
    if (lstat.isFile()) {
      copyFileSync(srcPath, destPath);
      try {
        chmodSync(destPath, lstat.mode);
      } catch (_error) {
        void _error;
      }
      continue;
    }
  }
}
