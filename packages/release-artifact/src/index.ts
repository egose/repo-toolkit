import { execFileSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join, posix as pathPosix, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { isPlainObject, normalizeVersion } from '@repo-toolkit/publish-package';

const DEFAULT_TOOL_NAME = 'repo-toolkit';
const DEFAULT_VERSION_FILE = 'VERSION';
const DEFAULT_PACKAGES_DIR = 'packages';
const DEFAULT_DIST_DIR = 'dist';
const DEFAULT_NODE_COMMAND = 'node';
const DEFAULT_HELP_FLAG = '--help';
const ARTIFACT_MANIFEST_SCHEMA_VERSION = 1;
const MAX_ARCHIVE_MEMBER_COUNT = 20_000;
const MAX_ARCHIVE_PATH_LENGTH = 512;
const MAX_ARCHIVE_EXPANDED_BYTES = 512 * 1024 * 1024;
const SAFE_FILENAME_COMPONENT_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u;
const SAFE_COMMAND_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/**
 * Default exclude patterns applied to each copied package directory so the
 * artifact only ships runtime-relevant files (built output, manifests) and
 * not sources/tests/sourcemaps/transient build metadata.
 */
const DEFAULT_PACKAGE_EXCLUDES: ReadonlyArray<string> = [
  '/src',
  '/test',
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
  schemaVersion: number;
  toolName: string;
  version: string;
  artifactDirName: string;
  archiveFileName: string;
  commands: ArtifactCommand[];
  requiredFiles: string[];
}

interface ParsedArchiveEntry {
  type: string;
  size: number;
  path: string;
  linkTarget?: string;
}

interface ValidatedArchive {
  artifactPath: string;
  archiveFileName: string;
  topLevelDirName: string;
}

interface ParseArtifactManifestOptions {
  archiveFileName?: string;
  artifactDirName?: string;
  expectedVersion?: string;
  expectedToolName?: string;
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
  const defaultNode = shellSingleQuote(nodeCommand);
  const quotedTargetPath = shellSingleQuote(targetPath);

  return [
    '#!/usr/bin/env bash',
    'set -eo pipefail',
    'script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    `default_node=${defaultNode}`,
    `target_path=${quotedTargetPath}`,
    'node_bin="${REPO_TOOLKIT_NODE_BIN:-${ASDF_NODEJS_BIN:-}}"',
    'if [ -n "$node_bin" ]; then',
    '  [ -d "$node_bin" ] && node_bin="${node_bin}/${default_node}"',
    'else',
    '  node_bin="$default_node"',
    'fi',
    'exec "$node_bin" "${script_dir}/../${target_path}" "$@"',
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
  const seenCommandNames = new Set<string>();

  for (const packageDirName of packageDirNames) {
    const packageJsonPath = join(packagesRoot, packageDirName, 'package.json');
    const packageDir = join(packagesRoot, packageDirName);
    const packageDirReal = realpathSync(packageDir);

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

      if (!SAFE_COMMAND_NAME_RE.test(commandName)) {
        throw new Error(`Invalid command name in ${packageJsonPath}: ${commandName}`);
      }

      if (seenCommandNames.has(commandName)) {
        throw new Error(`Duplicate artifact command name found: ${commandName}`);
      }

      const normalizedEntry = normalizeRelativePosixPath(entry, `bin entry for ${commandName}`);
      const entryPath = resolve(packageDir, normalizedEntry);

      if (!existsSync(entryPath) || !lstatSync(entryPath).isFile()) {
        throw new Error(`Bin entry must be an existing regular file in ${packageJsonPath}: ${entry}`);
      }

      assertPathWithinRoot(packageDirReal, realpathSync(entryPath), `bin entry for ${commandName}`);
      seenCommandNames.add(commandName);
      commands.push({ name: commandName, packageDir: packageDirName, entry: normalizedEntry });
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
  toolName: string,
  version: string,
  artifactDirName: string,
  archiveFileName: string,
  commands: ReadonlyArray<ArtifactCommand>,
  requiredFiles: ReadonlyArray<string>,
): ArtifactManifest {
  const sortedCommands = [...commands].sort(
    (left, right) => left.name.localeCompare(right.name) || left.packageDir.localeCompare(right.packageDir),
  );

  return {
    schemaVersion: ARTIFACT_MANIFEST_SCHEMA_VERSION,
    toolName,
    version,
    artifactDirName,
    archiveFileName,
    commands: sortedCommands,
    requiredFiles: [...requiredFiles].sort(),
  };
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

  // A leading slash anchors the pattern to the copy root (e.g. `/src`
  // matches only a top-level `src` directory, not nested `src` segments).
  if (pattern.startsWith('/')) {
    const body = pattern
      .slice(1)
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '__DBLSTAR__')
      .replace(/\*/g, '[^/]*')
      .replace(/__DBLSTAR__/g, '.*');
    return new RegExp(`^${body}$`);
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
  const toolName = validateFilenameComponent(options.toolName ?? DEFAULT_TOOL_NAME, 'toolName');
  const repoRoot = resolve(options.cwd ?? process.cwd());
  const packagesDir = options.packagesDir ?? DEFAULT_PACKAGES_DIR;
  const distDir = options.distDir ?? DEFAULT_DIST_DIR;
  const packagesRoot = resolve(repoRoot, packagesDir);
  const distRoot = resolve(repoRoot, distDir);
  const artifactDirName = `${toolName}-${validateFilenameComponent(version, 'version')}`;
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

  assertPathWithinRoot(realpathSync(repoRoot), distRoot, 'dist directory');
  assertPathWithinRoot(distRoot, artifactRoot, 'artifact directory');
  assertPathWithinRoot(distRoot, artifactPath, 'artifact archive');

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
  const manifest = createArtifactManifest(
    plan.toolName,
    plan.version,
    plan.artifactDirName,
    basename(plan.artifactPath),
    plan.commands,
    requiredFiles,
  );

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

  const validatedArchive = validateReleaseArchive(artifactPath);

  const extractRoot = mkdtempSync(join(tmpdir(), 'repo-toolkit-artifact-'));
  const helpFlag = options.helpFlag ?? DEFAULT_HELP_FLAG;
  const skipExec = options.skipExec ?? false;

  try {
    execFileSync('tar', ['-xzf', artifactPath, '-C', extractRoot], { stdio: 'inherit' });

    const installRoot = resolveInstallRoot(extractRoot, validatedArchive.topLevelDirName, options);
    const manifestPath = join(installRoot, 'artifact-manifest.json');

    verifySymlinks(installRoot);

    if (!existsSync(manifestPath)) {
      throw new Error('Release artifact is missing artifact-manifest.json.');
    }

    const manifest = parseArtifactManifest(readFileSync(manifestPath, 'utf8'), {
      archiveFileName: validatedArchive.archiveFileName,
      artifactDirName: validatedArchive.topLevelDirName,
      expectedVersion: options.version ? normalizeVersion(options.version) : undefined,
      expectedToolName: options.toolName ?? (options.artifactPath ? undefined : DEFAULT_TOOL_NAME),
    });

    for (const relativePath of manifest.requiredFiles) {
      const absolutePath = resolveContainedPath(installRoot, relativePath, 'required file');
      if (!existsSync(absolutePath)) {
        throw new Error(`Release artifact is missing ${relativePath}.`);
      }
    }

    for (const command of manifest.commands) {
      const wrapperPath = resolveContainedPath(installRoot, `bin/${command.name}`, 'command wrapper');
      accessSync(wrapperPath, constants.X_OK);
      execFileSync('bash', ['-n', wrapperPath], { stdio: 'inherit' });
      if (!skipExec) {
        execFileSync(wrapperPath, [helpFlag], { stdio: 'ignore' });
      }
    }
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

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolveInstallRoot(extractRoot: string, expectedDirName: string, options: VerifyArtifactOptions): string {
  const entries = readdirSync(extractRoot, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());

  if (directories.length !== 1) {
    throw new Error(`Release artifact must extract to a single top-level directory (found ${directories.length}).`);
  }

  if (entries.some((entry) => !entry.isDirectory())) {
    throw new Error('Release artifact must not extract top-level files.');
  }

  const installDirName = directories[0].name;

  if (installDirName !== expectedDirName) {
    throw new Error(
      `Release artifact extracted to unexpected directory: ${installDirName} (expected ${expectedDirName})`,
    );
  }

  if (options.version) {
    const versionDirName = `${options.toolName ?? DEFAULT_TOOL_NAME}-${normalizeVersion(options.version)}`;

    if (installDirName !== versionDirName) {
      throw new Error(
        `Release artifact extracted to unexpected directory: ${installDirName} (expected ${versionDirName})`,
      );
    }
  }

  return join(extractRoot, installDirName);
}

function validateFilenameComponent(value: string, label: string): string {
  if (!SAFE_FILENAME_COMPONENT_RE.test(value) || value === '.' || value === '..') {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return value;
}

function normalizeRelativePosixPath(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }

  if (
    value.includes('\\') ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    /^[A-Za-z]:/u.test(value) ||
    value.startsWith('/')
  ) {
    throw new Error(`${label} must be a normalized relative POSIX path: ${value}`);
  }

  const normalized = pathPosix.normalize(value).replace(/^\.\//u, '');

  if (normalized.length === 0 || normalized === '.' || normalized.split('/').includes('..')) {
    throw new Error(`${label} must be a normalized relative POSIX path: ${value}`);
  }

  return normalized;
}

function assertPathWithinRoot(rootPath: string, targetPath: string, label: string): void {
  const relativePath = relative(rootPath, targetPath);

  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
    return;
  }

  throw new Error(`${label} escapes its allowed root: ${targetPath}`);
}

function resolveContainedPath(rootPath: string, relativePath: string, label: string): string {
  const normalizedPath = normalizeRelativePosixPath(relativePath, label);
  const absolutePath = resolve(rootPath, normalizedPath);
  assertPathWithinRoot(rootPath, absolutePath, label);
  return absolutePath;
}

function parseArtifactManifest(contents: string, options: ParseArtifactManifestOptions = {}): ArtifactManifest {
  const parsed = JSON.parse(contents) as unknown;

  if (!isPlainObject(parsed)) {
    throw new Error('artifact-manifest.json must be an object.');
  }

  if (parsed.schemaVersion !== ARTIFACT_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`artifact-manifest.json schemaVersion must be ${ARTIFACT_MANIFEST_SCHEMA_VERSION}.`);
  }

  if (typeof parsed.toolName !== 'string' || !SAFE_FILENAME_COMPONENT_RE.test(parsed.toolName)) {
    throw new Error('artifact-manifest.json must contain a valid toolName.');
  }

  if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
    throw new Error('artifact-manifest.json must contain version.');
  }

  if (typeof parsed.artifactDirName !== 'string' || parsed.artifactDirName.length === 0) {
    throw new Error('artifact-manifest.json must contain artifactDirName.');
  }

  if (typeof parsed.archiveFileName !== 'string' || parsed.archiveFileName.length === 0) {
    throw new Error('artifact-manifest.json must contain archiveFileName.');
  }

  if (!Array.isArray(parsed.commands) || parsed.commands.length === 0) {
    throw new Error('artifact-manifest.json must contain at least one command.');
  }

  if (!Array.isArray(parsed.requiredFiles)) {
    throw new Error('artifact-manifest.json must contain requiredFiles.');
  }

  const commands = parsed.commands.map((command) => validateArtifactCommand(command));
  const requiredFiles = validateUniquePathList(parsed.requiredFiles, 'requiredFiles');
  const commandNames = new Set<string>();

  for (const command of commands) {
    if (commandNames.has(command.name)) {
      throw new Error(`artifact-manifest.json contains duplicate command: ${command.name}`);
    }
    commandNames.add(command.name);
  }

  if (options.expectedToolName && parsed.toolName !== options.expectedToolName) {
    throw new Error(
      `artifact-manifest.json toolName mismatch: ${parsed.toolName} (expected ${options.expectedToolName})`,
    );
  }

  if (options.expectedVersion && parsed.version !== options.expectedVersion) {
    throw new Error(`artifact-manifest.json version mismatch: ${parsed.version} (expected ${options.expectedVersion})`);
  }

  if (options.artifactDirName && parsed.artifactDirName !== options.artifactDirName) {
    throw new Error(
      `artifact-manifest.json artifactDirName mismatch: ${parsed.artifactDirName} (expected ${options.artifactDirName})`,
    );
  }

  if (options.archiveFileName && parsed.archiveFileName !== options.archiveFileName) {
    throw new Error(
      `artifact-manifest.json archiveFileName mismatch: ${parsed.archiveFileName} (expected ${options.archiveFileName})`,
    );
  }

  return {
    schemaVersion: parsed.schemaVersion,
    toolName: parsed.toolName,
    version: parsed.version,
    artifactDirName: parsed.artifactDirName,
    archiveFileName: parsed.archiveFileName,
    commands,
    requiredFiles,
  };
}

function validateArtifactCommand(value: unknown): ArtifactCommand {
  if (!isPlainObject(value)) {
    throw new Error('artifact-manifest.json commands must contain objects.');
  }

  const name = value.name;
  if (typeof name !== 'string' || !SAFE_COMMAND_NAME_RE.test(name)) {
    throw new Error('artifact-manifest.json commands must contain safe command names.');
  }

  if (typeof value.packageDir !== 'string') {
    throw new Error(`artifact-manifest.json command packageDir must be a string for ${name}`);
  }

  if (typeof value.entry !== 'string') {
    throw new Error(`artifact-manifest.json command entry must be a string for ${name}`);
  }

  const packageDir = normalizeRelativePosixPath(value.packageDir, `command packageDir for ${name}`);
  const entry = normalizeRelativePosixPath(value.entry, `command entry for ${name}`);

  return { name, packageDir, entry };
}

function validateUniquePathList(values: unknown[], label: string): string[] {
  const seen = new Set<string>();
  const normalizedValues: string[] = [];

  for (const value of values) {
    if (typeof value !== 'string') {
      throw new Error(`artifact-manifest.json ${label} entries must be strings.`);
    }

    const normalized = normalizeRelativePosixPath(value, label);
    if (seen.has(normalized)) {
      throw new Error(`artifact-manifest.json contains duplicate ${label} entry: ${normalized}`);
    }
    seen.add(normalized);
    normalizedValues.push(normalized);
  }

  return normalizedValues;
}

function validateReleaseArchive(artifactPath: string): ValidatedArchive {
  const archiveFileName = basename(artifactPath);
  const entries = listArchiveEntries(artifactPath);

  if (entries.length === 0) {
    throw new Error(`Release artifact is empty: ${artifactPath}`);
  }

  if (entries.length > MAX_ARCHIVE_MEMBER_COUNT) {
    throw new Error(`Release artifact exceeds the member limit: ${entries.length}`);
  }

  let expandedBytes = 0;
  const seenPaths = new Set<string>();
  const topLevelNames = new Set<string>();

  for (const entry of entries) {
    if (entry.path.length > MAX_ARCHIVE_PATH_LENGTH) {
      throw new Error(`Release artifact member path is too long: ${entry.path}`);
    }

    expandedBytes += entry.size;
    if (expandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
      throw new Error(`Release artifact exceeds the expanded size limit: ${artifactPath}`);
    }

    const normalizedPath = normalizeRelativePosixPath(entry.path, 'archive member');
    if (seenPaths.has(normalizedPath)) {
      throw new Error(`Release artifact contains duplicate member paths: ${normalizedPath}`);
    }
    seenPaths.add(normalizedPath);

    const topLevelName = normalizedPath.split('/')[0] ?? normalizedPath;
    topLevelNames.add(topLevelName);
    if (topLevelNames.size > 1) {
      throw new Error('Release artifact must contain exactly one top-level directory.');
    }

    if (!isSupportedArchiveType(entry.type)) {
      throw new Error(`Release artifact contains unsupported archive member type for ${normalizedPath}`);
    }

    if (!normalizedPath.includes('/') && entry.type !== 'd') {
      throw new Error(`Release artifact contains a top-level file: ${normalizedPath}`);
    }

    if (entry.type === 'l' || entry.type === 'h') {
      const target = entry.linkTarget;
      if (!target) {
        throw new Error(`Release artifact contains a link without a target: ${normalizedPath}`);
      }

      if (target.startsWith('/') || target.includes('\\') || /^[A-Za-z]:/u.test(target)) {
        throw new Error(`Release artifact contains an escaping link: ${normalizedPath} -> ${target}`);
      }

      const resolvedTarget = pathPosix.normalize(pathPosix.join(pathPosix.dirname(normalizedPath), target));
      if (
        resolvedTarget === '.' ||
        (resolvedTarget !== topLevelName && !resolvedTarget.startsWith(`${topLevelName}/`))
      ) {
        throw new Error(`Release artifact contains an escaping link: ${normalizedPath} -> ${target}`);
      }
    }
  }

  const [topLevelDirName] = [...topLevelNames];
  if (!topLevelDirName) {
    throw new Error(`Release artifact is missing a top-level directory: ${artifactPath}`);
  }

  return {
    artifactPath,
    archiveFileName,
    topLevelDirName,
  };
}

function listArchiveEntries(artifactPath: string): ParsedArchiveEntry[] {
  const output = execFileSync('tar', ['-tvzf', artifactPath, '--full-time', '--numeric-owner'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => parseArchiveEntry(line));
}

function parseArchiveEntry(line: string): ParsedArchiveEntry {
  const match = /^([A-Za-z-])\S*\s+\d+\/\d+\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+(.*)$/u.exec(
    line,
  );

  if (!match) {
    throw new Error(`Unable to parse tar listing entry: ${line}`);
  }

  const [, type, size, rest] = match;

  if (type === 'l') {
    const linkMatch = /^(.*) -> (.*)$/u.exec(rest);
    if (!linkMatch) {
      throw new Error(`Unable to parse symlink tar entry: ${line}`);
    }
    return { type, size: Number(size), path: stripTrailingSlash(linkMatch[1]), linkTarget: linkMatch[2] };
  }

  if (type === 'h') {
    const linkMatch = /^(.*) link to (.*)$/u.exec(rest);
    if (!linkMatch) {
      throw new Error(`Unable to parse hardlink tar entry: ${line}`);
    }
    return { type, size: Number(size), path: stripTrailingSlash(linkMatch[1]), linkTarget: linkMatch[2] };
  }

  return { type, size: Number(size), path: stripTrailingSlash(rest) };
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function isSupportedArchiveType(type: string): boolean {
  return type === '-' || type === 'd' || type === 'l' || type === 'h' || type === 'x' || type === 'g';
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
  const excludeMatchers = excludes.map((pattern) => globToRegex(pattern));

  cpSync(sourceRoot, destinationRoot, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (source: string) => {
      const relPath = relative(sourceRoot, source).replace(/\\/g, '/');
      if (relPath === '') {
        return true;
      }
      return !excludeMatchers.some((matcher) => matcher.test(relPath));
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
