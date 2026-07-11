import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve, relative as pathRelative, basename as pathBasename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

const PACKAGE_JSON = 'package.json';
export const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const;

const OMITTED_FIELDS = new Set([
  'additionalNames',
  'devDependencies',
  'files',
  'license',
  'packageManager',
  'private',
  'repository',
  'scripts',
]);

export const DEFAULT_VERSION_PLACEHOLDER = '0.0.0-PLACEHOLDER';
export const DEFAULT_PUBLISH_DIR = 'dist';
export const DEFAULT_PACKAGE_FILES = ['README.md', 'CHANGELOG.md', 'llms.txt'];
export const DEFAULT_ROOT_FILES = ['LICENSE'];
export const DEFAULT_BUILD_COMMAND = 'pnpm build';
export const DEFAULT_ACCESS = 'public';
export const DEFAULT_PUBLISH_FILES_FIELD = ['**/*', '!**/*.map'];

export type PackageJson = Record<string, unknown>;

export interface RootMetadata {
  author?: Record<string, unknown> | string;
  bugs?: Record<string, unknown> | string;
  engines?: Record<string, string>;
  license?: string;
  repository?: Record<string, unknown> | string;
}

export interface PublishRewriteOptions {
  versionPlaceholder?: string;
  publishDir?: string;
}

export interface CreatePublishPackageJsonOptions {
  version: string;
  internalPackageNames: Set<string>;
  rootMetadata?: RootMetadata;
  rewrite?: PublishRewriteOptions;
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
  /** npm dist-tag. Defaults to the prerelease `preid` inferred from `version`. */
  npmTag?: string;
  /** Forward `--dry-run` to `npm publish`. */
  dryRun?: boolean;
  /** npm access level. Defaults to `public`. */
  access?: string;
  /** npm registry URL. */
  registry?: string;
  /** npm OTP code. */
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
}

// ---------------------------------------------------------------------------
// Shared CLI helpers (exported for reuse by publish-packages CLI)
// ---------------------------------------------------------------------------

export interface FlagSpec {
  /** Canonical flag name (without the leading `--`). */
  name: string;
  /** Aliases accepted in place of the canonical name (without `--`). */
  aliases?: ReadonlyArray<string>;
  /** Boolean flag: consumes no value; `values[name]` becomes `'true'`. */
  boolean?: boolean;
  /** For boolean flags: accept `--no-<name>` to set `values[name]` to `'false'`. */
  negatable?: boolean;
  /** Comma-separated list: each occurrence splits on commas and appends to `repeat[name]`. */
  list?: boolean;
  /** Repeatable string: each occurrence appends one raw value to `repeat[name]`. */
  repeatable?: boolean;
}

export interface ParseFlagsResult {
  /** Map of flag name → last value seen (string, or `'true'`/`'false'` for booleans). */
  values: Record<string, string>;
  /** Map of list/repeatable flag name → accumulated values. */
  repeat: Record<string, string[]>;
  /** Unknown arguments collected when `strict` is `false`. */
  unknown: string[];
}

export interface ParseFlagsOptions {
  /** Throw on the first unknown argument (default: `true`). */
  strict?: boolean;
}

export function parseFlags(
  argv: string[],
  specs: ReadonlyArray<FlagSpec>,
  options: ParseFlagsOptions = {},
): ParseFlagsResult | null {
  const byKey: Record<string, FlagSpec> = {};

  for (const spec of specs) {
    byKey[spec.name] = spec;

    for (const alias of spec.aliases ?? []) {
      byKey[alias] = spec;
    }
  }

  const strict = options.strict ?? true;
  const values: Record<string, string> = {};
  const repeat: Record<string, string[]> = {};
  const unknown: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      return null;
    }

    if (!arg.startsWith('--')) {
      if (strict) {
        throw new Error(`Unknown argument: ${arg}`);
      }
      unknown.push(arg);
      continue;
    }

    const body = arg.slice(2);
    const equalsIndex = body.indexOf('=');
    const key = equalsIndex >= 0 ? body.slice(0, equalsIndex) : body;
    const inlineValue = equalsIndex >= 0 ? body.slice(equalsIndex + 1) : undefined;

    // Negation for negatable boolean flags (`--no-<name>`).
    if (key.startsWith('no-')) {
      const positiveKey = key.slice(3);
      const spec = byKey[positiveKey];

      if (spec && spec.boolean && spec.negatable) {
        if (inlineValue !== undefined) {
          throw new Error(`Boolean flag --no-${positiveKey} does not take a value.`);
        }
        values[spec.name] = 'false';
        continue;
      }
    }

    const spec = byKey[key];

    if (!spec) {
      if (strict) {
        throw new Error(`Unknown argument: ${arg}`);
      }
      unknown.push(arg);
      continue;
    }

    const flag = `--${spec.name}`;

    if (spec.boolean) {
      if (inlineValue !== undefined) {
        throw new Error(`Boolean flag ${flag} does not take a value.`);
      }
      values[spec.name] = 'true';
      continue;
    }

    const value = inlineValue !== undefined ? inlineValue : readValue(argv, index, flag);
    if (inlineValue === undefined) {
      index += 1;
    }

    if (spec.list) {
      (repeat[spec.name] ??= []).push(...splitListArg(value));
    } else if (spec.repeatable) {
      (repeat[spec.name] ??= []).push(value);
    } else {
      values[spec.name] = value;
    }
  }

  return { values, repeat, unknown };
}

export function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];

  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

export function splitListArg(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function resolveConfigPath(configPath: string, cwd?: string): string {
  if (isAbsolute(configPath)) {
    return configPath;
  }

  return resolve(cwd ?? process.cwd(), configPath);
}

export async function loadConfigFile<T>(configPath: string, cwd?: string): Promise<Partial<T>> {
  const resolvedPath = resolveConfigPath(configPath, cwd);

  if (resolvedPath.endsWith('.json')) {
    const contents = await readFile(resolvedPath, 'utf8');
    const parsed = JSON.parse(contents) as unknown;

    if (!isPlainObject(parsed)) {
      throw new Error(`Config file must export an object: ${resolvedPath}`);
    }

    return parsed as Partial<T>;
  }

  const loaded = (await import(pathToFileURL(resolvedPath).href)) as {
    default?: unknown;
  };
  const config = loaded.default ?? loaded;

  if (!isPlainObject(config)) {
    throw new Error(`Config file must export an object: ${resolvedPath}`);
  }

  return config as Partial<T>;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function inferNpmTag(version: string): string | undefined {
  if (typeof version !== 'string') {
    return undefined;
  }

  const prereleasePart = version.split('-')[1];
  if (!prereleasePart) {
    return undefined;
  }

  const [preid] = prereleasePart.split('.');
  return preid || undefined;
}

export function normalizeVersion(rawVersion: string): string {
  if (!rawVersion) {
    throw new Error('version not supplied');
  }

  return rawVersion.startsWith('v') ? rawVersion.slice(1) : rawVersion;
}

export function createPublishPackageJson(
  packageJson: PackageJson,
  options: CreatePublishPackageJsonOptions,
): PackageJson {
  const { version, internalPackageNames, rootMetadata = {}, rewrite = {} } = options;
  const versionPlaceholder = rewrite.versionPlaceholder ?? DEFAULT_VERSION_PLACEHOLDER;
  const publishDir = rewrite.publishDir ?? DEFAULT_PUBLISH_DIR;
  const publishPackageJson: PackageJson = {};

  for (const [key, value] of Object.entries(packageJson)) {
    if (OMITTED_FIELDS.has(key)) {
      continue;
    }

    if (key === 'version') {
      publishPackageJson.version = rewriteVersionValue(
        value as string,
        version,
        internalPackageNames,
        '',
        versionPlaceholder,
      );
      continue;
    }

    if ((DEPENDENCY_FIELDS as readonly string[]).includes(key)) {
      publishPackageJson[key] = rewriteDependencyMap(value, version, internalPackageNames, versionPlaceholder);
      continue;
    }

    if (key === 'main' || key === 'module' || key === 'types') {
      publishPackageJson[key] = rewriteDistPath(value as string, publishDir);
      continue;
    }

    if (key === 'bin') {
      publishPackageJson.bin = rewriteBin(value, publishDir);
      continue;
    }

    if (key === 'exports') {
      publishPackageJson.exports = rewriteExports(value, publishDir);
      continue;
    }

    publishPackageJson[key] = value;
  }

  // Inject a `files` field so npm doesn't accidentally include stray files
  // (e.g. .map files, temp artefacts) from the publish directory.
  publishPackageJson.files = [...DEFAULT_PUBLISH_FILES_FIELD];

  if (rootMetadata.author !== undefined) {
    publishPackageJson.author = rootMetadata.author;
  }

  if (rootMetadata.bugs !== undefined) {
    publishPackageJson.bugs = rootMetadata.bugs;
  }

  if (rootMetadata.engines !== undefined) {
    publishPackageJson.engines = rootMetadata.engines;
  }

  if (rootMetadata.license !== undefined) {
    publishPackageJson.license = rootMetadata.license;
  }

  if (rootMetadata.repository !== undefined) {
    publishPackageJson.repository = rootMetadata.repository;
  }

  return publishPackageJson;
}

export function resolvePublishPackagePlan(options: PublishPackageOptions = {}): PublishPackagePlan {
  const cwd = resolveDirectory(options.cwd, process.cwd());
  const rootDir = resolveDirectory(options.rootDir, cwd);
  const packageJsonPath = resolveInputPath(cwd, options.packageJsonPath ?? PACKAGE_JSON);
  const sourcePackageJson = readJson(packageJsonPath);
  const rootPackageJson = readJson(resolveInputPath(rootDir, PACKAGE_JSON));
  const versionPlaceholder = options.versionPlaceholder ?? DEFAULT_VERSION_PLACEHOLDER;
  const publishDir = normalizePublishDir(options.publishDir ?? DEFAULT_PUBLISH_DIR);
  const version = resolveVersion(options.version, sourcePackageJson.version, versionPlaceholder);
  const packageNames = resolvePackageNames(sourcePackageJson);

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
  };
}

export function publishPackage(options: PublishPackageOptions = {}): void {
  const plan = resolvePublishPackagePlan(options);

  console.log(`publishing package from ${plan.cwd}`);
  console.log(`package version ${plan.version}`);
  if (plan.npmTag) {
    console.log(`npm dist-tag ${plan.npmTag}`);
  }

  if (!plan.skipBuild) {
    runShellCommand(plan.buildCommand, plan.cwd);
    if (!existsSync(plan.resolvedPublishDir)) {
      throw new Error(`Missing publish directory after build: ${plan.resolvedPublishDir}`);
    }
  }

  mkdirSync(plan.resolvedPublishDir, { recursive: true });
  copyFilesFromDirectory(plan.cwd, plan.resolvedPublishDir, plan.packageFiles);
  copyFilesFromDirectory(plan.rootDir, plan.resolvedPublishDir, plan.rootFiles);

  const publishPackageData = createPublishPackageJson(plan.sourcePackageJson, {
    version: plan.version,
    internalPackageNames: plan.internalPackageNames,
    rootMetadata: {
      author: plan.rootPackageJson.author as RootMetadata['author'],
      bugs: plan.rootPackageJson.bugs as RootMetadata['bugs'],
      engines: plan.rootPackageJson.engines as Record<string, string> | undefined,
      license: plan.rootPackageJson.license as string | undefined,
      repository: mergeRepository(plan.rootPackageJson.repository, pathRelative(plan.rootDir, plan.cwd)),
    },
    rewrite: {
      versionPlaceholder: plan.versionPlaceholder,
      publishDir: plan.publishDir,
    },
  });

  const targetPackageJson = resolve(plan.resolvedPublishDir, PACKAGE_JSON);

  for (const name of plan.packageNames) {
    writeJson(targetPackageJson, {
      ...publishPackageData,
      name,
    });
    runNpmPublish(plan, name);
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

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

  const normalized = publishDir.replace(/\\/g, '/').replace(/\/$/, '').replace(/^\.\//, '');

  if (!normalized || normalized === '.') {
    throw new Error('publishDir must not be the package root');
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

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function runShellCommand(command: string, cwd: string): void {
  execFileSync('bash', ['-c', command], {
    cwd,
    stdio: 'inherit',
  });
}

/**
 * Copies files from `sourceDir` into `publishDir`.
 *
 * Subpaths are flattened: `--package-files docs/llms.txt` copies to
 * `dist/llms.txt`, not `dist/docs/llms.txt`. This matches npm's publish
 * directory semantics where the publish dir is the root of the tarball.
 */
function copyFilesFromDirectory(sourceDir: string, publishDir: string, fileNames: ReadonlyArray<string>): void {
  for (const fileName of fileNames) {
    const sourcePath = resolve(sourceDir, fileName);
    if (!existsSync(sourcePath)) {
      continue;
    }

    copyFileSync(sourcePath, resolve(publishDir, pathBasename(fileName)));
  }
}

function runNpmPublish(plan: PublishPackagePlan, packageName: string): void {
  const publishArgs = ['publish', '--access', plan.access];

  if (plan.npmTag) {
    publishArgs.push('--tag', plan.npmTag);
  }

  if (plan.registry) {
    publishArgs.push('--registry', plan.registry);
  }

  if (plan.otp) {
    publishArgs.push('--otp', plan.otp);
  }

  if (plan.provenance) {
    publishArgs.push('--provenance');
  }

  if (plan.dryRun) {
    publishArgs.push('--dry-run');
  }

  console.log(`publishing ${packageName} from ${plan.resolvedPublishDir}`);
  execFileSync('npm', publishArgs, {
    cwd: plan.resolvedPublishDir,
    stdio: 'inherit',
  });
}

/**
 * Rewrites `dist/foo` → `./foo` (and `./dist/foo` → `./foo`) using the
 * configured `publishDir` instead of a hardcoded `"dist"`.
 */
function rewriteDistPath(value: string, publishDir: string): string {
  const escaped = publishDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.replace(new RegExp(`^\\.\\/${escaped}/`), './').replace(new RegExp(`^${escaped}/`), './');
}

function rewriteExports(exportsField: unknown, publishDir: string): unknown {
  if (typeof exportsField === 'string') {
    return rewriteDistPath(exportsField, publishDir);
  }

  if (!isPlainObject(exportsField)) {
    return exportsField;
  }

  return Object.fromEntries(
    Object.entries(exportsField).map(([key, value]) => [key, rewriteExports(value, publishDir)]),
  );
}

function rewriteBin(binField: unknown, publishDir: string): unknown {
  if (typeof binField === 'string') {
    return rewriteDistPath(binField, publishDir);
  }

  if (!isPlainObject(binField)) {
    return binField;
  }

  return Object.fromEntries(
    Object.entries(binField).map(([key, value]) => [key, rewriteDistPath(value as string, publishDir)]),
  );
}

function rewriteVersionValue(
  value: string,
  version: string,
  internalPackageNames: Set<string>,
  packageName: string,
  versionPlaceholder: string,
): string {
  if (value === versionPlaceholder) {
    return version;
  }

  if (packageName && internalPackageNames.has(packageName) && value.startsWith('workspace:')) {
    const workspaceRange = value.slice('workspace:'.length);

    if (workspaceRange === '*' || workspaceRange === '') {
      return version;
    }

    if (workspaceRange === '^' || workspaceRange === '~') {
      return `${workspaceRange}${version}`;
    }

    return workspaceRange;
  }

  return value;
}

function rewriteDependencyMap(
  dependencies: unknown,
  version: string,
  internalPackageNames: Set<string>,
  versionPlaceholder: string,
): Record<string, string> | undefined {
  if (!isPlainObject(dependencies)) {
    return undefined;
  }

  const rewritten: Record<string, string> = {};

  for (const [name, range] of Object.entries(dependencies)) {
    rewritten[name] = rewriteVersionValue(range as string, version, internalPackageNames, name, versionPlaceholder);
  }

  return rewritten;
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
