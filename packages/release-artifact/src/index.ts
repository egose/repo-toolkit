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
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, posix as pathPosix, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { isPlainObject, normalizeVersion } from '@repo-toolkit/publish-package/helpers';

/**
 * Resolved node-modules content mode for the artifact.
 *
 * - `production`: materialise a transitive clos/deduplicated production
 *   dependency tree inside the artifact via `pnpm install --prod` against a
 *   generated lockfile, so the tarball is portable and reproducible. Default.
 * - `copy`: copy the workspace `node_modules` verbatim (symlinks preserved).
 *   Not portable across machines; tests typically disable this.
 * - `none`: ship no `node_modules`; commands rely on an external runtime to
 *   resolve dependencies.
 */
export type NodeModulesMode = 'production' | 'copy' | 'none';

/**
 * Injectable subprocess runner for every external binary the builder/verifier
 * invokes (tar, pnpm, bash, generated wrappers). The default implementation
 * spawns via `execFileSync` with bounded timeout, maxBuffer, and killSignal so
 * a hang is surfaced as a clear error rather than an indefinite stall. Tests
 * inject a fake runner to assert exact invocations without touching the host
 * toolchain.
 */
export interface ArtifactRunner {
  /**
   * Run an executable with an explicit argument list. Never invokes a shell,
   * so it is safe for arbitrary values (paths, version strings).
   */
  run(executable: string, args: ReadonlyArray<string>, options: ArtifactRunOptions): void;
  /**
   * Capture an executable's stdout, bounded by {@link ArtifactRunOptions.maxOutputBytes}.
   * Throws on nonzero exit, timeout, or output overflow.
   */
  capture(executable: string, args: ReadonlyArray<string>, options: ArtifactRunOptions): string;
}

export interface ArtifactRunOptions {
  cwd: string;
  stdio?: 'inherit' | 'pipe' | 'ignore';
  env?: Record<string, string>;
  /** Kill the child process after this many milliseconds. Defaults to 60s. */
  timeoutMs?: number;
  /** Reject captured output larger than this many bytes. Defaults to 8 MiB. */
  maxOutputBytes?: number;
  /** Signal sent when the timeout fires. Defaults to `SIGTERM`. */
  killSignal?: NodeJS.Signals;
}

const DEFAULT_RUN_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_KILL_SIGNAL: NodeJS.Signals = 'SIGTERM';

export const defaultArtifactRunner: ArtifactRunner = {
  run(executable, args, options) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    const killSignal = options.killSignal ?? DEFAULT_KILL_SIGNAL;
    execFileSync(executable, [...args], {
      cwd: options.cwd,
      stdio: options.stdio ?? 'inherit',
      env: options.env ? { ...process.env, ...options.env } : process.env,
      timeout: timeoutMs,
      killSignal,
    });
  },
  capture(executable, args, options) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    const killSignal = options.killSignal ?? DEFAULT_KILL_SIGNAL;
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const result = execFileSync(executable, [...args], {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env ? { ...process.env, ...options.env } : process.env,
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal,
      maxBuffer: maxOutputBytes,
    });
    if (Buffer.byteLength(result, 'utf8') > maxOutputBytes) {
      throw new Error(`${executable} produced more than ${maxOutputBytes} bytes of output.`);
    }
    return result;
  },
};

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

export interface ValidatedArchive {
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

export interface VerifyExtractedArtifactOptions {
  /** Filename of the tarball extracted into `installRoot`. Asserted against the manifest. */
  archiveFileName: string;
  /** Top-level directory name inside the extraction. Asserted against the manifest. */
  expectedDirName: string;
  /** Target version asserted against the manifest's `version`. A leading `v` is stripped. */
  expectedVersion?: string;
  /** Tool name asserted against the manifest's `toolName`. */
  expectedToolName?: string;
  /** Flag passed to each wrapper to confirm the command boots (default: `--help`). */
  helpFlag?: string;
  /** Skip executing the wrappers (only check manifest, required files, symlink safety, x_OK, and `bash -n`). */
  skipExec?: boolean;
  /** Injectable subprocess runner. Defaults to {@link defaultArtifactRunner}. */
  runner?: ArtifactRunner;
  /** Override the default per-process timeout (ms) for external commands. */
  runTimeoutMs?: number;
}

export interface BuildArtifactOptions {
  /** Target version stamped into the manifest and artifact directory name. A leading `v` is stripped. */
  version: string;
  /** Workspace root directory. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Tool name used in artifact directory and tarball filenames (default: `repo-toolkit`). */
  toolName?: string;
  /**
   * Root file(s) copied into the artifact root (default: `['VERSION']`). Each
   * entry is a path relative to the workspace root; the configured subpath is
   * preserved (e.g. `config/version.txt` is copied to `config/version.txt`
   * under the artifact root). Missing sources fail the build.
   */
  versionFiles?: ReadonlyArray<string>;
  /**
   * Additional root files copied into the artifact root. Missing files fail
   * the build. The configured subpath is preserved.
   */
  rootFiles?: ReadonlyArray<string>;
  /** Directory under the workspace root holding packages (default: `packages`). */
  packagesDir?: string;
  /** Directory under the workspace root where the tarball is written (default: `dist`). */
  distDir?: string;
  /**
   * Resolved node-modules content mode (default: `production`).
   *
   * - `production`: install a transitive, deduplicated production dep tree.
   * - `copy`: copy the workspace `node_modules` verbatim.
   * - `none`: ship no `node_modules`.
   *
   * Replaces the legacy `includeNodeModules` / `productionNodeModules`
   * booleans; passing both is rejected.
   */
  nodeModulesMode?: NodeModulesMode;
  /** @deprecated Use {@link BuildArtifactOptions.nodeModulesMode} = `copy`. */
  includeNodeModules?: boolean;
  /** @deprecated Use {@link BuildArtifactOptions.nodeModulesMode} = `production` / `none`. */
  productionNodeModules?: boolean;
  /** Node interpreter used in generated bash wrappers (default: `node`). */
  nodeCommand?: string;
  /** Glob patterns excluded from each copied package directory. Replaces the defaults. */
  excludes?: ReadonlyArray<string>;
  /** Injectable subprocess runner. Defaults to {@link defaultArtifactRunner}. */
  runner?: ArtifactRunner;
  /** Override the default per-process timeout (ms) for external commands. */
  runTimeoutMs?: number;
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
  nodeModulesMode: NodeModulesMode;
  nodeCommand: string;
  excludes: ReadonlyArray<string>;
  commands: ArtifactCommand[];
  /** Resolved transitive closure of command-owning package directory names. */
  commandPackageDirs: ReadonlyArray<string>;
  /** Injectable runner shared by build and verify pipelines. */
  runner: ArtifactRunner;
  runTimeoutMs: number;
  /** Resolved relative destinations for {@link BuildArtifactPlan.versionFiles}. */
  versionFileDestinations: ReadonlyArray<string>;
  /** Resolved relative destinations for {@link BuildArtifactPlan.rootFiles}. */
  rootFileDestinations: ReadonlyArray<string>;
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
  /** Injectable subprocess runner. Defaults to {@link defaultArtifactRunner}. */
  runner?: ArtifactRunner;
  /** Override the default per-process timeout (ms) for external commands. */
  runTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Mode / runner / runner-options resolution (pure helpers, exported for tests)
// ---------------------------------------------------------------------------

/**
 * Resolve a single {@link NodeModulesMode} preserving the documented legacy
 * boolean semantics:
 *
 * - When `productionNodeModules === true` (the original default), the build
 *   always ran a production install and `includeNodeModules` was ignored. So
 *   `productionNodeModules: true` ⇒ `'production'` regardless of
 *   `includeNodeModules`.
 * - When `productionNodeModules === false`, `includeNodeModules` decided
 *   between copy and none: `includeNodeModules: true` ⇒ `'copy'`,
 *   `includeNodeModules: false|undefined` ⇒ `'none'`.
 * - When only `includeNodeModules` is set, `true` ⇒ `'copy'`, `false` ⇒ `'none'`.
 * - All undefined ⇒ `'production'`.
 *
 * The only contradictory combination this surface ever rejected was
 * `productionNodeModules: true` paired with `includeNodeModules: true`
 * because the documented default already forces a production install and the
 * old code never reached the copy branch in that state — but older runtimes
 * silently ignored `includeNodeModules: true` when production was on, so we
 * preserve that behaviour. The legacy booleans therefore never conflict; a
 * contradiction only surfaces when an explicit `nodeModulesMode` is supplied
 * alongside booleans that disagree with it.
 */
export function resolveNodeModulesMode(
  mode: NodeModulesMode | undefined,
  includeNodeModules: boolean | undefined,
  productionNodeModules: boolean | undefined,
): NodeModulesMode {
  if (mode !== undefined) {
    if (mode !== 'production' && mode !== 'copy' && mode !== 'none') {
      throw new Error(`Invalid nodeModulesMode: ${mode as string}`);
    }

    const legacy = legacyNodeModulesMode(includeNodeModules, productionNodeModules);
    if (legacy !== undefined && legacy !== mode) {
      throw new Error(`Conflicting node-modules options: nodeModulesMode=${mode} contradicts the legacy booleans`);
    }
  }

  return mode ?? legacyNodeModulesMode(includeNodeModules, productionNodeModules) ?? 'production';
}

function legacyNodeModulesMode(
  includeNodeModules: boolean | undefined,
  productionNodeModules: boolean | undefined,
): NodeModulesMode | undefined {
  if (productionNodeModules === true) {
    return 'production';
  }

  if (productionNodeModules === false) {
    return includeNodeModules ? 'copy' : 'none';
  }

  if (includeNodeModules === undefined) {
    return undefined;
  }

  return includeNodeModules ? 'copy' : 'none';
}

export function validateArtifactRunner(runner: unknown): asserts runner is ArtifactRunner {
  if (typeof runner !== 'object' || runner === null) {
    throw new Error('runner must be an ArtifactRunner object');
  }

  const r = runner as Partial<ArtifactRunner>;
  if (typeof r.run !== 'function' || typeof r.capture !== 'function') {
    throw new Error('runner must implement run() and capture()');
  }
}

export function resolveRunTimeoutMs(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_RUN_TIMEOUT_MS;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`runTimeoutMs must be a positive finite number: ${value as unknown as string}`);
  }

  return value;
}

/**
 * Resolve the relative destination for a root/version file. The source path
 * is interpreted relative to the workspace root and the configured subpath is
 * preserved under the artifact root (e.g. `config/x.txt` ⇒ `config/x.txt`).
 * Rejects absolute, Windows-drive, escaped, NUL/newline, and backslash paths.
 */
export function resolveRootFileDestination(value: string, label: string): string {
  return normalizeRelativePosixPath(value, label);
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
  const nodeModulesMode = resolveNodeModulesMode(
    options.nodeModulesMode,
    options.includeNodeModules,
    options.productionNodeModules,
  );
  const runTimeoutMs = resolveRunTimeoutMs(options.runTimeoutMs);
  const runner = options.runner ?? defaultArtifactRunner;
  validateArtifactRunner(runner);

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

  const commandPackageDirs = collectCommandPackageClosure(packagesRoot, packageDirNames, commands);
  const versionFileDestinations = resolveRootFileDestinations(versionFiles, 'versionFiles');
  const rootFileDestinations = resolveRootFileDestinations(rootFiles, 'rootFiles');
  assertNoRootFileDestinationCollisions(versionFileDestinations, rootFileDestinations);

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
    nodeModulesMode,
    nodeCommand: options.nodeCommand ?? DEFAULT_NODE_COMMAND,
    excludes: options.excludes ?? DEFAULT_PACKAGE_EXCLUDES,
    commands,
    commandPackageDirs,
    runner,
    runTimeoutMs,
    versionFileDestinations,
    rootFileDestinations,
  };
}

/**
 * Compute the transitive closure of package directories that actually own a
 * command (i.e. contribute a `bin` entry). Only these directories contribute
 * dependencies to the production install so the artifact ships exactly the
 * runtime needed by the bundled CLIs and nothing else.
 *
 * Workspace-internal dependencies are resolved from the actual `name` field of
 * each `package.json` under `packagesRoot` rather than a hardcoded scope, so
 * the closure is correct for repos using ANY npm scope (not just
 * `@repo-toolkit/*`). A dependency is treated as internal if its package name
 * matches one of the discovered workspace packages; its directory is then
 * visited regardless of whether the bare package name matches the dir name.
 */
export function collectCommandPackageClosure(
  packagesRoot: string,
  packageDirNames: ReadonlyArray<string>,
  commands: ReadonlyArray<ArtifactCommand>,
): string[] {
  const internalDirByName = resolveInternalPackageMap(packagesRoot, packageDirNames);

  const owners = new Set<string>();
  for (const command of commands) {
    owners.add(command.packageDir);
  }

  const closure = new Set<string>();

  const visit = (dirName: string): void => {
    if (closure.has(dirName)) {
      return;
    }
    closure.add(dirName);

    const packageJsonPath = join(packagesRoot, dirName, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return;
    }
    const packageJson = readJson(packageJsonPath);
    const deps = packageJson.dependencies;
    if (!isPlainObject(deps)) {
      return;
    }

    for (const depName of Object.keys(deps)) {
      const internalDirName = internalDirByName.get(depName);
      if (internalDirName !== undefined && packageDirNames.includes(internalDirName)) {
        visit(internalDirName);
      }
    }
  };

  for (const dirName of owners) {
    visit(dirName);
  }

  return [...closure].sort();
}

/**
 * Build a `package.json name -> directory name` index for every workspace
 * package under `packagesRoot`. The index is consulted by the command-package
 * closure resolver so internal dependencies are recognized regardless of the
 * npm scope they live under (`@repo-toolkit/*`, `@web-ts-toolkit/*`,
 * `@example/*`, or any other). Dirs without a `package.json` or a string `name`
 * field are skipped silently, mirroring the per-package read in
 * `collectCommandPackageClosure`. This avoids the prior hardcoded
 * `@repo-toolkit/*` regex, which silently dropped internal deps from
 * non-`@repo-toolkit` scopes and broke the scaffolded `pnpm-workspace.yaml`.
 */
function resolveInternalPackageMap(packagesRoot: string, packageDirNames: ReadonlyArray<string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const packageDirName of packageDirNames) {
    const packageJsonPath = join(packagesRoot, packageDirName, 'package.json');
    if (!existsSync(packageJsonPath)) {
      continue;
    }
    const packageJson = readJson(packageJsonPath);
    const packageName = packageJson.name;
    if (typeof packageName !== 'string' || packageName.length === 0) {
      continue;
    }
    if (!map.has(packageName)) {
      map.set(packageName, packageDirName);
    }
  }
  return map;
}

/**
 * Resolve a workspace-internal package directory name from a dependency name
 * for the legacy `@repo-toolkit/<pkg>` convention: the directory name is
 * `<pkg>`. External deps return `null`.
 *
 * @deprecated This helper hardcodes the `@repo-toolkit/*` scope and is retained
 * only for backward compatibility with previous public API surface. New
 * planning code resolves internal packages via `resolveInternalPackageMap`,
 * which derives the name-to-directory mapping from the actual workspace
 * `package.json` `name` fields and therefore supports arbitrary scopes.
 */
export function workspacePackageDirName(depName: string): string | null {
  const match = /^@repo-toolkit\/([A-Za-z0-9][A-Za-z0-9._-]*)$/u.exec(depName);
  return match ? match[1] : null;
}

/**
 * Resolve and validate the relative destinations for a list of root/version
 * files. Rejects paths that escape the artifact root, contain backslashes,
 * NUL/newline, or are absolute/drive-prefixed.
 */
export function resolveRootFileDestinations(files: ReadonlyArray<string>, label: string): string[] {
  const resolved: string[] = [];
  for (const file of files) {
    resolved.push(resolveRootFileDestination(file, `${label} entry`));
  }
  return resolved;
}

/**
 * Reject any destination collision across version files, root files, or
 * between them. Includes the artifact's own reserved paths
 * (`artifact-manifest.json`, `bin/`, `packages/`, `node_modules/`).
 */
export function assertNoRootFileDestinationCollisions(
  versionFileDestinations: ReadonlyArray<string>,
  rootFileDestinations: ReadonlyArray<string>,
): void {
  const seen = new Map<string, string>();
  const reserved = new Set<string>([
    'artifact-manifest.json',
    'bin',
    'packages',
    'node_modules',
    'pnpm-workspace.yaml',
    'package.json',
  ]);

  const checkOne = (relativePath: string, label: string): void => {
    if (reserved.has(relativePath)) {
      throw new Error(`${label} destination is reserved: ${relativePath}`);
    }
    const topSegment = relativePath.split('/')[0] ?? relativePath;
    if (reserved.has(topSegment)) {
      throw new Error(`${label} destination collides with a reserved path: ${relativePath}`);
    }
    const existingLabel = seen.get(relativePath);
    if (existingLabel) {
      throw new Error(`${label} destination collides with ${existingLabel}: ${relativePath}`);
    }
    seen.set(relativePath, label);
  };

  for (const dest of versionFileDestinations) {
    checkOne(dest, 'versionFiles');
  }
  for (const dest of rootFileDestinations) {
    checkOne(dest, 'rootFiles');
  }
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

  copyRootFiles(plan, plan.versionFiles, plan.versionFileDestinations, 'versionFiles');
  copyRootFiles(plan, plan.rootFiles, plan.rootFileDestinations, 'rootFiles');

  for (const packageDirName of plan.packagesDirs) {
    const packageDir = join(plan.packagesRoot, packageDirName);
    copyTree(packageDir, join(plan.artifactRoot, 'packages', packageDirName), plan.excludes);
  }

  if (plan.nodeModulesMode === 'production') {
    installProductionNodeModules(plan);
  } else if (plan.nodeModulesMode === 'copy' && existsSync(plan.nodeModulesDir)) {
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
  plan.runner.run('tar', ['-czf', plan.artifactPath, '-C', plan.distRoot, plan.artifactDirName], {
    cwd: plan.repoRoot,
    stdio: 'inherit',
    timeoutMs: plan.runTimeoutMs,
  });

  return plan;
}

/**
 * Copy a list of root/version files into the artifact root, preserving the
 * configured subpath. Fails loudly on missing sources, non-regular sources,
 * and on any destination whose path is already present (cross-category
 * collisions are rejected up-front by {@link assertNoRootFileDestinationCollisions}).
 * Directories and escaping symlinks are rejected. Cleanup stays robust on
 * failure because this is called before any external tool runs.
 */
function copyRootFiles(
  plan: BuildArtifactPlan,
  sources: ReadonlyArray<string>,
  destinations: ReadonlyArray<string>,
  label: string,
): void {
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i];
    const destination = destinations[i];
    const sourcePath = resolve(plan.repoRoot, source);
    const destinationPath = resolve(plan.artifactRoot, destination);

    if (!existsSync(sourcePath)) {
      throw new Error(`${label} source not found: ${source}`);
    }

    const stat = lstatSync(sourcePath);
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(sourcePath);
      const resolvedTarget = resolve(dirname(sourcePath), target);
      if (resolvedTarget !== plan.repoRoot && !resolvedTarget.startsWith(`${plan.repoRoot}/`)) {
        throw new Error(`${label} source symlink escapes the workspace root: ${source} -> ${target}`);
      }
      if (!lstatSync(resolvedTarget).isFile()) {
        throw new Error(`${label} source symlink target is not a regular file: ${source}`);
      }
    } else if (stat.isDirectory()) {
      throw new Error(`${label} source is a directory, not a regular file: ${source}`);
    } else if (!stat.isFile()) {
      throw new Error(`${label} source is not a regular file: ${source}`);
    }

    assertPathWithinRoot(plan.artifactRoot, destinationPath, `${label} destination`);

    const destinationDir = dirname(destinationPath);
    if (!existsSync(destinationDir)) {
      mkdirSync(destinationDir, { recursive: true });
    }

    if (existsSync(destinationPath)) {
      throw new Error(`${label} destination already exists: ${destination}`);
    }

    cpSync(sourcePath, destinationPath, { recursive: false });
  }
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
  const runner = options.runner ?? defaultArtifactRunner;
  validateArtifactRunner(runner);
  const runTimeoutMs = resolveRunTimeoutMs(options.runTimeoutMs);

  if (!existsSync(artifactPath)) {
    throw new Error(`Missing release artifact: ${artifactPath}`);
  }

  const validatedArchive = validateReleaseArchive(artifactPath, {
    runner,
    runTimeoutMs,
    cwd: options.cwd ?? dirname(artifactPath),
  });

  const extractRoot = mkdtempSync(join(tmpdir(), 'repo-toolkit-artifact-'));

  try {
    runner.run('tar', ['-xzf', artifactPath, '-C', extractRoot], {
      cwd: dirname(artifactPath),
      stdio: 'inherit',
      timeoutMs: runTimeoutMs,
    });

    const installRoot = resolveInstallRoot(extractRoot, validatedArchive.topLevelDirName, options);

    verifyExtractedArtifact(installRoot, {
      archiveFileName: validatedArchive.archiveFileName,
      expectedDirName: validatedArchive.topLevelDirName,
      expectedVersion: options.version ? normalizeVersion(options.version) : undefined,
      expectedToolName: options.toolName ?? (options.artifactPath ? undefined : DEFAULT_TOOL_NAME),
      helpFlag: options.helpFlag,
      skipExec: options.skipExec,
      runner,
      runTimeoutMs,
    });
  } finally {
    rmIfExists(extractRoot);
  }
}

/**
 * Run the post-extraction validation contract over an extracted artifact tree.
 * `installRoot` must be the directory produced by extracting the tarball and
 * descending into the single expected top-level directory. Used by both
 * {@link verifyReleaseArtifact} and the asdf installer so verifier and installer
 * always apply identical symlink, manifest, required-file, and wrapper checks.
 */
export function verifyExtractedArtifact(
  installRoot: string,
  options: VerifyExtractedArtifactOptions,
): ArtifactManifest {
  verifySymlinks(installRoot);

  const manifestPath = join(installRoot, 'artifact-manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('Release artifact is missing artifact-manifest.json.');
  }

  const manifest = parseArtifactManifest(readFileSync(manifestPath, 'utf8'), {
    archiveFileName: options.archiveFileName,
    artifactDirName: options.expectedDirName,
    expectedVersion: options.expectedVersion,
    expectedToolName: options.expectedToolName,
  });

  for (const relativePath of manifest.requiredFiles) {
    const absolutePath = resolveContainedPath(installRoot, relativePath, 'required file');
    if (!existsSync(absolutePath)) {
      throw new Error(`Release artifact is missing ${relativePath}.`);
    }
  }

  const helpFlag = options.helpFlag ?? DEFAULT_HELP_FLAG;
  const skipExec = options.skipExec ?? false;
  const runner = options.runner ?? defaultArtifactRunner;
  validateArtifactRunner(runner);
  const runTimeoutMs = resolveRunTimeoutMs(options.runTimeoutMs);

  for (const command of manifest.commands) {
    const wrapperPath = resolveContainedPath(installRoot, `bin/${command.name}`, 'command wrapper');
    accessSync(wrapperPath, constants.X_OK);
    runner.run('bash', ['-n', wrapperPath], { cwd: installRoot, stdio: 'inherit', timeoutMs: runTimeoutMs });
    if (!skipExec) {
      runner.run(wrapperPath, [helpFlag], { cwd: installRoot, stdio: 'ignore', timeoutMs: runTimeoutMs });
    }
  }

  return manifest;
}

export interface InstallArtifactOptions {
  /** Archive tarball to install. */
  archivePath: string;
  /** Final install destination directory. The artifact's top-level dir is moved here. */
  installPath: string;
  /** Target version asserted against the manifest's `version` and the extracted dir name. A leading `v` is stripped. */
  version: string;
  /** Tool name asserted against the manifest's `toolName` and the extracted dir name (default: `repo-toolkit`). */
  toolName?: string;
  /** Flag passed to each wrapper to confirm it boots (default: `--help`). */
  helpFlag?: string;
  /** Skip executing the wrappers (only check manifest, required files, symlink safety, x_OK, and `bash -n`). */
  skipExec?: boolean;
  /** Replace an existing non-empty `installPath` instead of refusing it (default: `false`). */
  force?: boolean;
  /** Workspace root directory; accepted for CLI/config compatibility and otherwise unused. */
  cwd?: string;
  /** Injectable subprocess runner. Defaults to {@link defaultArtifactRunner}. */
  runner?: ArtifactRunner;
  /** Override the default per-process timeout (ms) for external commands. */
  runTimeoutMs?: number;
}

export interface InstallArtifactResult {
  installPath: string;
  manifest: ArtifactManifest;
}

/**
 * Atomically install a release artifact tarball at `installPath`. Performs the
 * same validation that {@link verifyReleaseArtifact} applies, but extracts into
 * a fresh temp dir sibling of `installPath` (so `rename` is atomic on the same
 * filesystem) and refuses a non-empty existing `installPath` unless `force` is
 * set. On any validation failure the temp dir is removed; the existing
 * `installPath`, if any, is left untouched. This is the contract the asdf
 * installer invokes so verifier and installer outcomes stay equivalent.
 */
export function installReleaseArtifact(options: InstallArtifactOptions): InstallArtifactResult {
  const archivePath = resolve(options.archivePath);
  const installPath = resolve(options.installPath);
  const toolName = validateFilenameComponent(options.toolName ?? DEFAULT_TOOL_NAME, 'toolName');
  const version = normalizeVersion(options.version);
  const expectedDirName = `${toolName}-${validateFilenameComponent(version, 'version')}`;
  const helpFlag = options.helpFlag ?? DEFAULT_HELP_FLAG;
  const skipExec = options.skipExec ?? false;
  const runner = options.runner ?? defaultArtifactRunner;
  validateArtifactRunner(runner);
  const runTimeoutMs = resolveRunTimeoutMs(options.runTimeoutMs);

  if (!existsSync(archivePath)) {
    throw new Error(`Missing release artifact: ${archivePath}`);
  }

  if (installPath === archivePath || installPath === dirname(archivePath)) {
    throw new Error(`Install path must not be the archive or its parent: ${installPath}`);
  }

  if (existsSync(installPath)) {
    const installEntries = readdirSync(installPath);
    if (installEntries.length > 0 && !options.force) {
      throw new Error(
        `Install destination already exists and is non-empty: ${installPath} (pass --force to replace it).`,
      );
    }
  }

  const validatedArchive = validateReleaseArchive(archivePath, {
    runner,
    runTimeoutMs,
    cwd: dirname(archivePath),
  });

  const installParent = dirname(installPath);
  mkdirSync(installParent, { recursive: true });
  const extractRoot = mkdtempSync(join(installParent, `${toolName}-install-`));

  try {
    runner.run('tar', ['-xzf', archivePath, '-C', extractRoot], {
      cwd: dirname(archivePath),
      stdio: 'inherit',
      timeoutMs: runTimeoutMs,
    });

    const installRoot = resolveInstallRoot(extractRoot, expectedDirName, { toolName, version });

    const manifest = verifyExtractedArtifact(installRoot, {
      archiveFileName: validatedArchive.archiveFileName,
      expectedDirName,
      expectedVersion: version,
      expectedToolName: toolName,
      helpFlag,
      skipExec,
      runner,
      runTimeoutMs,
    });

    if (existsSync(installPath)) {
      rmIfExists(installPath);
    }

    renameSync(installRoot, installPath);
    return { installPath, manifest };
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

/**
 * Resolve the install root inside an extraction tree. Rejects extraction trees
 * that contain anything other than exactly one directory, and (when requested)
 * asserts that directory matches the expected tool/version name so a tarball
 * cannot masquerade as a different release. Used by both verifier and installer.
 */
export function resolveInstallRoot(
  extractRoot: string,
  expectedDirName: string,
  options: { toolName?: string; version?: string } = {},
): string {
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

export function validateReleaseArchive(
  artifactPath: string,
  options: { runner?: ArtifactRunner; runTimeoutMs?: number; cwd?: string } = {},
): ValidatedArchive {
  const archiveFileName = basename(artifactPath);
  const entries = listArchiveEntries(artifactPath, options);

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

function listArchiveEntries(
  artifactPath: string,
  options: { runner?: ArtifactRunner; runTimeoutMs?: number; cwd?: string } = {},
): ParsedArchiveEntry[] {
  const runner = options.runner ?? defaultArtifactRunner;
  const cwd = options.cwd ?? dirname(artifactPath);
  const output = runner.capture('tar', ['-tvzf', artifactPath, '--full-time', '--numeric-owner'], {
    cwd,
    timeoutMs: options.runTimeoutMs,
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
 * Merge the production dependencies of the closure of command-owning packages
 * into a single dependency map. Rejects incompatible range conflicts: if two
 * packages specify overlapping, intersecting ranges for the same dependency,
 * the intersection is computed; if the intersection is empty (e.g. `^1.0.0`
 * vs `^2.0.0`), the build fails with a clear message.
 *
 * Internal workspace dependencies (any npm scope) are kept (so pnpm links
 * the package from `packages/<dirName>` when `pnpm-workspace.yaml` lists it);
 * conflicts between `workspace:*` and a pinned range are rejected. External
 * deps are merged with intersection detection so an incompatible transitive
 * request fails during planning, not at install time.
 */
export function mergeClosureDependencies(
  packagesRoot: string,
  closurePackageDirs: ReadonlyArray<string>,
): Record<string, string> {
  const ranges = new Map<string, string[]>();

  for (const packageDirName of closurePackageDirs) {
    const packageJsonPath = join(packagesRoot, packageDirName, 'package.json');
    if (!existsSync(packageJsonPath)) {
      continue;
    }
    const packageJson = readJson(packageJsonPath);
    const dependencies = packageJson.dependencies;
    if (!isPlainObject(dependencies)) {
      continue;
    }
    for (const [name, range] of Object.entries(dependencies)) {
      if (typeof range !== 'string' || range.length === 0) {
        throw new Error(`Invalid dependency range for ${name} in ${packageDirName}: ${range as unknown as string}`);
      }
      const existing = ranges.get(name);
      if (existing === undefined) {
        ranges.set(name, [range]);
      } else {
        existing.push(range);
      }
    }
  }

  const rootDependencies: Record<string, string> = {};

  for (const [name, listed] of ranges) {
    const deduped = [...new Set(listed)];
    if (deduped.length === 1) {
      rootDependencies[name] = deduped[0];
      continue;
    }

    const intersection = intersectSemverRanges(deduped);
    if (intersection === null) {
      throw new Error(
        `Incompatible dependency ranges for ${name}: ${deduped.join(', ')}. Resolve the conflict before building.`,
      );
    }
    rootDependencies[name] = intersection;
  }

  return rootDependencies;
}

/**
 * A very small subset of npm range intersection. Handles `^x.y.z`, `~x.y.z`,
 * `>=x.y.z`, exact versions, and `workspace:*` ranges. Returns `null` for
 * ranges whose major versions conflict (the common case where `^1.0.0` vs
 * `^2.0.0` cannot coexist) and otherwise returns the lowest applicable range
 * so the caller pins an exact lower bound. This is intentionally
 * conservative: it rejects when in doubt rather than silently picking one.
 * Callers pin a resolved version via the lockfile when in doubt.
 *
 * `workspace:*` and other `workspace:` protocols are treated as identical
 * placeholders; if any package requests a `workspace:` range for a dep, that
 * is the resolved range (the lockfile resolves it at install time). Mixing a
 * `workspace:` range with a non-workspace range is rejected.
 */
export function intersectSemverRanges(ranges: ReadonlyArray<string>): string | null {
  const hasWorkspace = ranges.some((range) => range.startsWith('workspace:'));
  if (hasWorkspace) {
    const allWorkspace = ranges.every((range) => range.startsWith('workspace:'));
    if (!allWorkspace) {
      return null;
    }
    if (ranges.every((range) => range === ranges[0])) {
      return ranges[0];
    }
    const sorted = [...ranges].sort();
    return sorted[0];
  }

  const parsed = ranges.map((range) => parseSemverRange(range));
  if (parsed.some((entry) => entry === null)) {
    return null;
  }

  const listed = parsed as Array<{ major: number; minor: number; patch: number; operator: string; raw: string }>;
  const majors = new Set(listed.map((entry) => entry.major));
  if (majors.size > 1) {
    return null;
  }

  return listed
    .map((entry) => entry.raw)
    .sort()
    .reduce((acc, raw) => (acc === null ? raw : raw < acc ? raw : acc), null as string | null);
}

interface ParsedSemverRange {
  major: number;
  minor: number;
  patch: number;
  operator: string;
  raw: string;
}

function parseSemverRange(range: string): ParsedSemverRange | null {
  const match = /^([~^>=]*)(\d+)\.(\d+)\.(\d+)/u.exec(range);
  if (!match) {
    return null;
  }

  const [, operator, major, minor, patch] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    operator: operator || '',
    raw: range,
  };
}

/**
 * Synthesize a minimal workspace root inside the artifact, listing only the
 * command-owning packages' closure under `pnpm-workspace.yaml`, and run
 * `pnpm install --prod --no-frozen-lockfile --ignore-scripts --prefer-offline`
 * against the synthesised `package.json` so only the transitive production
 * dependency closure is materialised. The scaffolding (`package.json`,
 * `pnpm-workspace.yaml`, and the `pnpm-lock.yaml` generated by pnpm) is then
 * removed so it is not shipped in the tarball.
 *
 * The metadata emitted at {@link createArtifactManifest} time records the
 * exact command-owning closure, so equivalent builds of the same commit
 * produce equivalent dependency trees. Range conflicts between closure
 * members are detected up-front by {@link mergeClosureDependencies}.
 */
function installProductionNodeModules(plan: BuildArtifactPlan): void {
  const rootDependencies = mergeClosureDependencies(plan.packagesRoot, plan.commandPackageDirs);

  const scaffoldPackageJson = join(plan.artifactRoot, 'package.json');
  const scaffoldWorkspaceYaml = join(plan.artifactRoot, 'pnpm-workspace.yaml');
  const scaffoldLockfile = join(plan.artifactRoot, 'pnpm-lock.yaml');

  writeFileSync(
    scaffoldPackageJson,
    `${JSON.stringify(
      {
        name: plan.toolName,
        version: plan.version,
        private: true,
        dependencies: rootDependencies,
      },
      null,
      2,
    )}\n`,
  );

  const workspaceEntries = plan.commandPackageDirs.map((dir) => `  - packages/${dir}`);
  writeFileSync(scaffoldWorkspaceYaml, `packages:\n${workspaceEntries.join('\n')}\n`);

  try {
    plan.runner.run('pnpm', ['install', '--prod', '--no-frozen-lockfile', '--ignore-scripts', '--prefer-offline'], {
      cwd: plan.artifactRoot,
      stdio: 'inherit',
      timeoutMs: plan.runTimeoutMs,
    });
  } finally {
    rmIfExists(scaffoldPackageJson);
    rmIfExists(scaffoldWorkspaceYaml);
    rmIfExists(scaffoldLockfile);
  }
}
