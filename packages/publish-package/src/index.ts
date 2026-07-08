import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PACKAGE_JSON = 'package.json';
const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];
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

export type PackageJson = Record<string, unknown>;

export interface RootMetadata {
  author?: unknown;
  bugs?: unknown;
  engines?: unknown;
  license?: unknown;
  repository?: unknown;
}

export interface PublishRewriteOptions {
  versionPlaceholder?: string;
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
  /** Files to copy from the rootDir into the publish directory. */
  rootFiles?: ReadonlyArray<string>;
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

export function createPublishPackageJson(
  packageJson: PackageJson,
  version: string,
  internalPackageNames: Set<string>,
  rootMetadata: RootMetadata,
  rewriteOptions: PublishRewriteOptions = {},
): PackageJson {
  const publishPackageJson: PackageJson = {};
  const versionPlaceholder = rewriteOptions.versionPlaceholder ?? DEFAULT_VERSION_PLACEHOLDER;

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

    if (DEPENDENCY_FIELDS.includes(key)) {
      publishPackageJson[key] = rewriteDependencyMap(value, version, internalPackageNames, versionPlaceholder);
      continue;
    }

    if (key === 'main' || key === 'module' || key === 'types') {
      publishPackageJson[key] = rewriteDistPath(value as string);
      continue;
    }

    if (key === 'bin') {
      publishPackageJson.bin = rewriteBin(value);
      continue;
    }

    if (key === 'exports') {
      publishPackageJson.exports = rewriteExports(value);
      continue;
    }

    publishPackageJson[key] = value;
  }

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
    resolvedPublishDir: path.join(cwd, publishDir),
    sourcePackageJson,
    rootPackageJson,
    packageNames,
    version,
    npmTag: options.npmTag ?? inferNpmTag(version),
    versionPlaceholder,
    packageFiles: options.packageFiles ?? DEFAULT_PACKAGE_FILES,
    rootFiles: options.rootFiles ?? DEFAULT_ROOT_FILES,
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

  const publishPackageData = createPublishPackageJson(
    plan.sourcePackageJson,
    plan.version,
    plan.internalPackageNames,
    {
      author: plan.rootPackageJson.author,
      bugs: plan.rootPackageJson.bugs,
      engines: plan.rootPackageJson.engines,
      license: plan.rootPackageJson.license,
      repository: mergeRepository(plan.rootPackageJson.repository, path.relative(plan.rootDir, plan.cwd)),
    },
    {
      versionPlaceholder: plan.versionPlaceholder,
    },
  );

  const targetPackageJson = path.join(plan.resolvedPublishDir, PACKAGE_JSON);

  for (const name of plan.packageNames) {
    writeJson(targetPackageJson, {
      ...publishPackageData,
      name,
    });
    runNpmPublish(plan, name);
  }
}

function resolveDirectory(input: string | undefined, fallback: string): string {
  return path.resolve(input ?? fallback);
}

function resolveInputPath(baseDir: string, inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }

  return path.resolve(baseDir, inputPath);
}

function normalizePublishDir(publishDir: string): string {
  if (path.isAbsolute(publishDir)) {
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

function normalizeVersion(rawVersion: string): string {
  if (!rawVersion) {
    throw new Error('version not supplied');
  }

  return rawVersion.startsWith('v') ? rawVersion.slice(1) : rawVersion;
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
  execFileSync('bash', ['-lc', command], {
    cwd,
    stdio: 'inherit',
  });
}

function copyFilesFromDirectory(sourceDir: string, publishDir: string, fileNames: ReadonlyArray<string>): void {
  for (const fileName of fileNames) {
    const sourcePath = path.join(sourceDir, fileName);
    if (!existsSync(sourcePath)) {
      continue;
    }

    copyFileSync(sourcePath, path.join(publishDir, path.basename(fileName)));
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

function rewriteDistPath(value: string): string {
  return value.replace(/^\.\/dist\//, './').replace(/^dist\//, './');
}

function rewriteExports(exportsField: unknown): unknown {
  if (typeof exportsField === 'string') {
    return rewriteDistPath(exportsField);
  }

  if (!isPlainObject(exportsField)) {
    return exportsField;
  }

  return Object.fromEntries(Object.entries(exportsField).map(([key, value]) => [key, rewriteExports(value)]));
}

function rewriteBin(binField: unknown): unknown {
  if (typeof binField === 'string') {
    return rewriteDistPath(binField);
  }

  if (!isPlainObject(binField)) {
    return binField;
  }

  return Object.fromEntries(Object.entries(binField).map(([key, value]) => [key, rewriteDistPath(value as string)]));
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

function mergeRepository(rootRepositoryValue: unknown, packageDirectory: string): Record<string, unknown> | undefined {
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
