import { execFileSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { isPlainObject, normalizeVersion } from '@repo-toolkit/publish-package';

const DEFAULT_TOOL_NAME = 'repo-toolkit';
const DEFAULT_VERSION_FILE = 'VERSION';
const DEFAULT_PACKAGES_DIR = 'packages';
const DEFAULT_DIST_DIR = 'dist';
const DEFAULT_NODE_COMMAND = 'node';
const DEFAULT_HELP_FLAG = '--help';

/**
 * Default exclude patterns applied to each copied package directory so the
 * artifact only ships runtime-relevant files (built output, manifests) and
 * not sources/tests/sourcemaps/transient build metadata.
 */
const DEFAULT_PACKAGE_EXCLUDES: ReadonlyArray<string> = [
  'src',
  'test',
  'node_modules',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.map',
  '**/tsconfig.tsbuildinfo',
];

export type PackageJson = Record<string, unknown>;

export interface ArtifactCommand {
  name: string;
  packageDir: string;
  entry: string;
}

export interface ArtifactManifest {
  version: string;
  commands: ArtifactCommand[];
  requiredFiles: string[];
}

export interface BuildArtifactOptions {
  /** Target version stamped into the manifest and artifact directory name. A leading `v` is stripped. */
  version: string;
  /** Workspace root directory. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Tool name used in artifact directory and tarball filenames (default: `repo-toolkit`). */
  toolName?: string;
  /** Root file(s) copied into the artifact root (default: `['VERSION']`). Missing files are skipped. */
  versionFiles?: ReadonlyArray<string>;
  /** Additional root files copied into the artifact root. */
  rootFiles?: ReadonlyArray<string>;
  /** Directory under the workspace root holding packages (default: `packages`). */
  packagesDir?: string;
  /** Directory under the workspace root where the tarball is written (default: `dist`). */
  distDir?: string;
  /** Copy `node_modules` into the artifact so commands run without an install (default: `false`). */
  includeNodeModules?: boolean;
  /**
   * Install only production dependencies into the artifact via `pnpm install --prod`
   * instead of copying the workspace `node_modules` verbatim (default: `true`).
   * Requires `pnpm` on PATH at build time. Produces a portable tarball whose
   * internal workspace symlinks stay inside the artifact root.
   */
  productionNodeModules?: boolean;
  /** Node interpreter used in generated bash wrappers (default: `node`). */
  nodeCommand?: string;
  /** Glob patterns excluded from each copied package directory. Replaces the defaults. */
  excludes?: ReadonlyArray<string>;
}

export interface BuildArtifactPlan {
  repoRoot: string;
  toolName: string;
  version: string;
  packagesRoot: string;
  distRoot: string;
  artifactDirName: string;
  artifactRoot: string;
  artifactPath: string;
  versionFiles: ReadonlyArray<string>;
  rootFiles: ReadonlyArray<string>;
  packagesDirs: string[];
  nodeModulesDir: string;
  includeNodeModules: boolean;
  productionNodeModules: boolean;
  nodeCommand: string;
  excludes: ReadonlyArray<string>;
  commands: ArtifactCommand[];
}

export interface VerifyArtifactOptions {
  /** Target version used to locate the artifact tarball. A leading `v` is stripped. */
  version: string;
  /** Workspace root directory. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Tool name used to locate the artifact tarball (default: `repo-toolkit`). */
  toolName?: string;
  /** Directory under the workspace root holding the tarball (default: `dist`). */
  distDir?: string;
  /** Explicit artifact tarball path; overrides `cwd`/`toolName`/`distDir` resolution. */
  artifactPath?: string;
  /** Flag passed to each wrapper to confirm the command boots (default: `--help`). */
  helpFlag?: string;
  /** Skip executing the wrappers (only check manifest, required files, symlink safety, and `bash -n`). */
  skipExec?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testability and reuse)
// ---------------------------------------------------------------------------

/**
 * Generate a bash wrapper that `exec`s the node interpreter against the
 * artifact's own entry file. The node binary is resolved at runtime from
 * `REPO_TOOLKIT_NODE_BIN` / `ASDF_NODEJS_BIN` (which may be a directory) and
 * falls back to the build-time `nodeCommand` (default `node` on PATH), so a
 * tampered PATH cannot substitute a malicious node without also controlling
 * those environment variables.
 */
export function buildWrapperScript(targetPath: string, nodeCommand: string = DEFAULT_NODE_COMMAND): string {
  return [
    '#!/usr/bin/env bash',
    'set -eo pipefail',
    'script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'node_bin="${REPO_TOOLKIT_NODE_BIN:-${ASDF_NODEJS_BIN:-}}"',
    'if [ -n "$node_bin" ]; then',
    '  [ -d "$node_bin" ] && node_bin="${node_bin}/' + nodeCommand + '"',
    'else',
    `  node_bin="${nodeCommand}"`,
    'fi',
    'exec "$node_bin" "${script_dir}/../' + targetPath + '" "$@"',
    '',
  ].join('\n');
}

export function toBinEntries(binField: unknown, packageName: string): Array<[string, string]> {
  if (!binField) {
    return [];
  }

  if (typeof binField === 'string') {
    const segments = packageName.split('/');
    const defaultBinName = packageName.includes('/') ? segments[segments.length - 1] : packageName;
    return [[defaultBinName, binField]];
  }

  if (isPlainObject(binField)) {
    return Object.entries(binField).map(([name, entry]) => [name, entry as string]);
  }

  return [];
}

export function discoverPackageDirNames(packagesRoot: string): string[] {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function collectCommands(packagesRoot: string, packageDirNames: ReadonlyArray<string>): ArtifactCommand[] {
  const commands: ArtifactCommand[] = [];

  for (const packageDirName of packageDirNames) {
    const packageJsonPath = join(packagesRoot, packageDirName, 'package.json');

    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = readJson(packageJsonPath);
    const packageName = packageJson.name;

    if (typeof packageName !== 'string' || packageName.length === 0) {
      throw new Error(`Package name missing in ${packageJsonPath}`);
    }

    for (const [commandName, entry] of toBinEntries(packageJson.bin, packageName)) {
      if (!commandName || !entry) {
        continue;
      }
      commands.push({ name: commandName, packageDir: packageDirName, entry });
    }
  }

  return commands;
}

export function buildRequiredFiles(
  commands: ReadonlyArray<ArtifactCommand>,
  versionFiles: ReadonlyArray<string>,
): string[] {
  const requiredFiles = new Set<string>([...versionFiles, 'artifact-manifest.json']);

  for (const command of commands) {
    requiredFiles.add(`bin/${command.name}`);
    requiredFiles.add(`packages/${command.packageDir}/package.json`);
    requiredFiles.add(`packages/${command.packageDir}/${command.entry}`);
  }

  return [...requiredFiles].sort();
}

export function createArtifactManifest(
  version: string,
  commands: ReadonlyArray<ArtifactCommand>,
  requiredFiles: ReadonlyArray<string>,
): ArtifactManifest {
  const sortedCommands = [...commands].sort(
    (left, right) => left.name.localeCompare(right.name) || left.packageDir.localeCompare(right.packageDir),
  );

  return { version, commands: sortedCommands, requiredFiles: [...requiredFiles].sort() };
}

/**
 * Convert a glob pattern (supporting `*` and `**`) into a RegExp anchored to a
 * path segment boundary. Used by the per-package copy filter to exclude
 * sources/tests/sourcemaps/transient files from the artifact.
 */
export function globToRegex(pattern: string): RegExp {
  if (pattern === '**') {
    return new RegExp('^.*$');
  }

  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '__DBLSTAR__')
    .replace(/\*/g, '[^/]*')
    .replace(/__DBLSTAR__/g, '.*');

  // A bare name with no slashes or wildcards matches that basename anywhere
  // (e.g. `test`, `node_modules`). Everything else is anchored to the full path.
  if (!pattern.includes('/') && !pattern.includes('*')) {
    return new RegExp(`(^|/)${escaped}$`);
  }

  if (pattern.startsWith('**/')) {
    return new RegExp(
      `^(?:.*/)?${pattern
        .slice(3)
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')}$`,
    );
  }

  return new RegExp(`^${escaped}$`);
}

/**
 * Returns true if `relPath` (a forward-slash path relative to a copy root)
 * matches any of the glob `patterns`.
 */
export function matchesAnyGlob(relPath: string, patterns: ReadonlyArray<string>): boolean {
  return patterns.some((pattern) => globToRegex(pattern).test(relPath));
}

// ---------------------------------------------------------------------------
// Plan resolution
// ---------------------------------------------------------------------------

export function resolveBuildArtifactPlan(options: BuildArtifactOptions): BuildArtifactPlan {
  const version = normalizeVersion(options.version);
  const toolName = options.toolName ?? DEFAULT_TOOL_NAME;
  const repoRoot = resolve(options.cwd ?? process.cwd());
  const packagesDir = options.packagesDir ?? DEFAULT_PACKAGES_DIR;
  const distDir = options.distDir ?? DEFAULT_DIST_DIR;
  const packagesRoot = resolve(repoRoot, packagesDir);
  const distRoot = resolve(repoRoot, distDir);
  const artifactDirName = `${toolName}-${version}`;
  const artifactRoot = join(distRoot, artifactDirName);
  const artifactPath = `${artifactRoot}.tar.gz`;
  const versionFiles = options.versionFiles ?? [DEFAULT_VERSION_FILE];
  const rootFiles = options.rootFiles ?? [];
  const productionNodeModules = options.productionNodeModules ?? true;
  const includeNodeModules = productionNodeModules ? false : (options.includeNodeModules ?? false);

  if (!existsSync(packagesRoot)) {
    throw new Error(`packages directory not found: ${packagesRoot}`);
  }

  const packageDirNames = discoverPackageDirNames(packagesRoot);

  if (packageDirNames.length === 0) {
    throw new Error(`No package directories found under ${packagesRoot}`);
  }

  const commands = collectCommands(packagesRoot, packageDirNames);

  if (commands.length === 0) {
    throw new Error('No CLI package bin entries found under packages/.');
  }

  return {
    repoRoot,
    toolName,
    version,
    packagesRoot,
    distRoot,
    artifactDirName,
    artifactRoot,
    artifactPath,
    versionFiles,
    rootFiles,
    packagesDirs: packageDirNames,
    nodeModulesDir: resolve(repoRoot, 'node_modules'),
    includeNodeModules,
    productionNodeModules,
    nodeCommand: options.nodeCommand ?? DEFAULT_NODE_COMMAND,
    excludes: options.excludes ?? DEFAULT_PACKAGE_EXCLUDES,
    commands,
  };
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildReleaseArtifact(options: BuildArtifactOptions): BuildArtifactPlan {
  const plan = resolveBuildArtifactPlan(options);

  rmIfExists(plan.artifactRoot);
  rmIfExists(plan.artifactPath);

  mkdirSync(join(plan.artifactRoot, 'bin'), { recursive: true });
  mkdirSync(join(plan.artifactRoot, 'packages'), { recursive: true });

  for (const versionFile of plan.versionFiles) {
    const sourcePath = resolve(plan.repoRoot, versionFile);
    if (existsSync(sourcePath)) {
      cpSync(sourcePath, join(plan.artifactRoot, basename(versionFile)));
    }
  }

  for (const rootFile of plan.rootFiles) {
    const sourcePath = resolve(plan.repoRoot, rootFile);
    if (existsSync(sourcePath)) {
      cpSync(sourcePath, join(plan.artifactRoot, basename(rootFile)));
    }
  }

  for (const packageDirName of plan.packagesDirs) {
    const packageDir = join(plan.packagesRoot, packageDirName);
    copyTree(packageDir, join(plan.artifactRoot, 'packages', packageDirName), plan.excludes);
  }

  if (plan.productionNodeModules) {
    installProductionNodeModules(plan);
  } else if (plan.includeNodeModules && existsSync(plan.nodeModulesDir)) {
    cpSync(plan.nodeModulesDir, join(plan.artifactRoot, 'node_modules'), {
      recursive: true,
      verbatimSymlinks: true,
    });
  }

  for (const command of plan.commands) {
    const wrapperPath = join(plan.artifactRoot, 'bin', command.name);
    writeFileSync(wrapperPath, buildWrapperScript(`packages/${command.packageDir}/${command.entry}`, plan.nodeCommand));
    chmodSync(wrapperPath, 0o755);
  }

  const requiredFiles = buildRequiredFiles(plan.commands, plan.versionFiles);
  const manifest = createArtifactManifest(plan.version, plan.commands, requiredFiles);

  writeFileSync(join(plan.artifactRoot, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  mkdirSync(plan.distRoot, { recursive: true });
  execFileSync('tar', ['-czf', plan.artifactPath, '-C', plan.distRoot, plan.artifactDirName], {
    stdio: 'inherit',
  });

  return plan;
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export function resolveArtifactPath(options: VerifyArtifactOptions): string {
  if (options.artifactPath) {
    return resolve(options.artifactPath);
  }

  const version = normalizeVersion(options.version);
  const toolName = options.toolName ?? DEFAULT_TOOL_NAME;
  const distRoot = resolve(options.cwd ?? process.cwd(), options.distDir ?? DEFAULT_DIST_DIR);

  return join(distRoot, `${toolName}-${version}.tar.gz`);
}

export function verifySymlinks(rootPath: string, currentPath: string = rootPath): void {
  const normalizedRoot = resolve(rootPath);

  for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
    const entryPath = join(currentPath, entry.name);

    if (entry.isSymbolicLink()) {
      const targetPath = readlinkSync(entryPath);

      if (isAbsolute(targetPath)) {
        throw new Error(`Release artifact contains an absolute symlink: ${entryPath} -> ${targetPath}`);
      }

      const resolvedTarget = resolve(join(entryPath, '..'), targetPath);

      if (resolvedTarget !== normalizedRoot && !resolvedTarget.startsWith(`${normalizedRoot}/`)) {
        throw new Error(
          `Release artifact contains a symlink escaping the artifact root: ${entryPath} -> ${targetPath}`,
        );
      }

      continue;
    }

    if (entry.isDirectory()) {
      verifySymlinks(normalizedRoot, entryPath);
    }
  }
}

export function verifyReleaseArtifact(options: VerifyArtifactOptions): void {
  const artifactPath = resolveArtifactPath(options);

  if (!existsSync(artifactPath)) {
    throw new Error(`Missing release artifact: ${artifactPath}`);
  }

  const extractRoot = mkdtempSync(join(tmpdir(), 'repo-toolkit-artifact-'));
  const helpFlag = options.helpFlag ?? DEFAULT_HELP_FLAG;
  const skipExec = options.skipExec ?? false;

  try {
    execFileSync('tar', ['-xzf', artifactPath, '-C', extractRoot], { stdio: 'inherit' });

    const normalizedVersion = normalizeVersion(options.version);
    const toolName = options.toolName ?? DEFAULT_TOOL_NAME;
    const installRoot = join(extractRoot, `${toolName}-${normalizedVersion}`);
    const manifestPath = join(installRoot, 'artifact-manifest.json');

    if (!existsSync(manifestPath)) {
      throw new Error('Release artifact is missing artifact-manifest.json.');
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ArtifactManifest;

    if (!Array.isArray(manifest.requiredFiles)) {
      throw new Error('artifact-manifest.json must contain requiredFiles.');
    }

    if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) {
      throw new Error('artifact-manifest.json must contain at least one command.');
    }

    for (const relativePath of manifest.requiredFiles) {
      if (!existsSync(join(installRoot, relativePath))) {
        throw new Error(`Release artifact is missing ${relativePath}.`);
      }
    }

    for (const command of manifest.commands) {
      const wrapperPath = join(installRoot, 'bin', command.name);
      accessSync(wrapperPath, constants.X_OK);
      execFileSync('bash', ['-n', wrapperPath], { stdio: 'inherit' });
      if (!skipExec) {
        execFileSync(wrapperPath, [helpFlag], { stdio: 'ignore' });
      }
    }

    verifySymlinks(installRoot);
  } finally {
    rmIfExists(extractRoot);
  }
}

// ---------------------------------------------------------------------------
// Shared internal helpers
// ---------------------------------------------------------------------------

function rmIfExists(targetPath: string): void {
  if (existsSync(targetPath)) {
    rmSync(targetPath, { recursive: true, force: true });
  }
}

function readJson(filePath: string): PackageJson {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/**
 * Recursive copy that skips any source path whose path relative to `sourceRoot`
 * matches one of the glob `excludes`. Uses `cpSync`'s `filter` so excluded
 * directories are pruned wholesale (their children are never traversed).
 */
function copyTree(sourceRoot: string, destinationRoot: string, excludes: ReadonlyArray<string>): void {
  cpSync(sourceRoot, destinationRoot, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (source: string) => {
      const relPath = relative(sourceRoot, source).replace(/\\/g, '/');
      if (relPath === '') {
        return true;
      }
      return !matchesAnyGlob(relPath, excludes);
    },
  });
}

/**
 * Synthesize a minimal workspace root inside the artifact and run
 * `pnpm install --prod` so only production dependencies are materialised,
 * then remove the synthesized scaffolding so it is not shipped in the tarball.
 */
function installProductionNodeModules(plan: BuildArtifactPlan): void {
  const rootDependencies: Record<string, string> = {};

  for (const packageDirName of plan.packagesDirs) {
    const packageJsonPath = join(plan.packagesRoot, packageDirName, 'package.json');
    if (!existsSync(packageJsonPath)) {
      continue;
    }
    const packageJson = readJson(packageJsonPath);
    const dependencies = packageJson.dependencies;
    if (!isPlainObject(dependencies)) {
      continue;
    }
    for (const [name, range] of Object.entries(dependencies)) {
      rootDependencies[name] = range as string;
    }
  }

  const scaffoldPackageJson = join(plan.artifactRoot, 'package.json');
  const scaffoldWorkspaceYaml = join(plan.artifactRoot, 'pnpm-workspace.yaml');

  writeFileSync(
    scaffoldPackageJson,
    `${JSON.stringify(
      { name: plan.toolName, version: plan.version, private: true, dependencies: rootDependencies },
      null,
      2,
    )}\n`,
  );
  writeFileSync(scaffoldWorkspaceYaml, 'packages:\n- packages/*\n');

  try {
    execFileSync('pnpm', ['install', '--prod', '--no-frozen-lockfile', '--ignore-scripts', '--prefer-offline'], {
      cwd: plan.artifactRoot,
      stdio: 'inherit',
    });
  } finally {
    rmIfExists(scaffoldPackageJson);
    rmIfExists(scaffoldWorkspaceYaml);
  }
}
