import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DEFAULT_VERSION_PLACEHOLDER = '0.0.0-PLACEHOLDER';
const DEFAULT_PUBLISH_DIR = 'dist';
const PACKAGE_JSON = 'package.json';
const COPY_PACKAGE_FILES = ['README.md', 'llms.txt'];
const DEFAULT_ROOT_FILES = ['LICENSE'];
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

export type PackageJson = Record<string, unknown>;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface PackageEntry {
  dir: string;
  packageJson: PackageJson;
}

export interface RootMetadata {
  author?: unknown;
  bugs?: unknown;
  engines?: unknown;
  license?: unknown;
  repository?: unknown;
}

export interface PublishAllOptions {
  /** Target version. A leading `v` is stripped. */
  tag: string;
  /** Monorepo root directory. Defaults to `process.cwd()`. */
  cwd?: string;
  /** npm dist-tag. Defaults to the prerelease `preid` inferred from the version. */
  npmTag?: string;
  /** Forward `--dry-run` to `npm publish`. */
  dryRun?: boolean;
  /** Only publish packages matching any of these name/directory selectors. */
  filters?: ReadonlyArray<string>;
  /** Start publishing from the first package matching this selector. */
  from?: string;
  /** Files to copy from the monorepo root into each publish directory. Defaults to `['LICENSE']`. */
  rootFiles?: ReadonlyArray<string>;
  /** Publish directory inside each package. Defaults to `dist`. */
  publishDir?: string;
  /** Version placeholder that should be replaced with the target version. Defaults to `0.0.0-PLACEHOLDER`. */
  versionPlaceholder?: string;
}

export interface PublishPlan {
  rootDir: string;
  version: string;
  npmTag?: string;
  /** Root `package.json` contents; shared metadata is sourced from here. */
  rootPackageJson: PackageJson;
  /** Resolved list of files to copy from root into each publish dir. */
  rootFiles: ReadonlyArray<string>;
  /** Resolved publish directory inside each package. */
  publishDir: string;
  /** Resolved version placeholder to rewrite. */
  versionPlaceholder: string;
  /** Names of every package discovered under `packages/*` (independent of filtering). */
  internalPackageNames: Set<string>;
  /** Packages selected for publish, in dependency order. */
  packages: PackageEntry[];
}

export interface PublishRewriteOptions {
  versionPlaceholder?: string;
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

export function sortPackagesByInternalDependencies(
  packages: ReadonlyArray<PackageEntry>,
  internalPackageNames: Set<string>,
): PackageEntry[] {
  const packagesByName = new Map(packages.map((pkg) => [pkg.packageJson.name as string, pkg]));
  const visited = new Set<string>();
  const visiting: string[] = [];
  const ordered: PackageEntry[] = [];

  for (const pkg of packages) {
    visit(pkg);
  }

  return ordered;

  function visit(pkg: PackageEntry): void {
    const packageName = pkg.packageJson.name as string;
    if (visited.has(packageName)) {
      return;
    }

    if (visiting.includes(packageName)) {
      const cycle = [...visiting, packageName].join(' -> ');
      throw new Error(`Circular internal dependency detected: ${cycle}`);
    }

    visiting.push(packageName);

    for (const dependencyName of getInternalDependencies(pkg.packageJson, internalPackageNames)) {
      const dependencyPackage = packagesByName.get(dependencyName);
      if (dependencyPackage) {
        visit(dependencyPackage);
      }
    }

    visiting.pop();
    visited.add(packageName);
    ordered.push(pkg);
  }
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

export function resolvePublishPlan(options: PublishAllOptions): PublishPlan {
  const version = normalizeTag(options.tag);
  const rootDir = resolveRootDir(options.cwd);
  const rootPackageJson = readJson(path.join(rootDir, PACKAGE_JSON));
  const packages = discoverPackages(rootDir);
  const internalPackageNames = new Set(packages.map((pkg) => pkg.packageJson.name as string));
  const orderedPackages = selectPackages(
    sortPackagesByInternalDependencies(packages, internalPackageNames),
    options.filters,
    options.from,
  );

  if (orderedPackages.length === 0) {
    throw new Error('No packages matched the current selection');
  }

  return {
    rootDir,
    version,
    npmTag: options.npmTag ?? inferNpmTag(version),
    rootPackageJson,
    rootFiles: options.rootFiles ?? DEFAULT_ROOT_FILES,
    publishDir: options.publishDir ?? DEFAULT_PUBLISH_DIR,
    versionPlaceholder: options.versionPlaceholder ?? DEFAULT_VERSION_PLACEHOLDER,
    internalPackageNames,
    packages: orderedPackages,
  };
}

export function publishAll(options: PublishAllOptions): void {
  const plan = resolvePublishPlan(options);
  const { rootDir, version, npmTag, rootPackageJson, rootFiles, internalPackageNames, publishDir, versionPlaceholder } =
    plan;

  console.log(`target tag ${version}`);
  if (npmTag) {
    console.log(`npm dist-tag ${npmTag}`);
  }

  for (const pkg of plan.packages) {
    console.log(`processing ${pkg.dir}`);
    runCommand('pnpm', ['build'], pkg.dir);

    const resolvedPublishDir = path.join(pkg.dir, publishDir);
    if (!existsSync(resolvedPublishDir)) {
      throw new Error(`Missing publish directory: ${resolvedPublishDir}`);
    }

    copyPackageFiles(pkg.dir, resolvedPublishDir);
    copyRootFiles(rootDir, resolvedPublishDir, rootFiles);

    const publishPackageData = createPublishPackageJson(
      pkg.packageJson,
      version,
      internalPackageNames,
      {
        author: rootPackageJson.author,
        bugs: rootPackageJson.bugs,
        engines: rootPackageJson.engines,
        license: rootPackageJson.license,
        repository: mergeRepository(rootPackageJson.repository, path.relative(rootDir, pkg.dir)),
      },
      {
        versionPlaceholder,
      },
    );

    const names = [
      publishPackageData.name,
      ...(Array.isArray(pkg.packageJson.additionalNames) ? (pkg.packageJson.additionalNames as string[]) : []),
    ];
    const targetPackageJson = path.join(resolvedPublishDir, PACKAGE_JSON);

    for (const name of names) {
      const packageJson = {
        ...publishPackageData,
        name,
      };

      writeJson(targetPackageJson, packageJson);

      const publishArgs = ['publish', '--access', 'public'];
      if (npmTag) {
        publishArgs.push('--tag', npmTag);
      }

      if (options.dryRun) {
        publishArgs.push('--dry-run');
      }

      runCommand('npm', publishArgs, resolvedPublishDir);
    }
  }
}

function normalizeTag(rawTag: string): string {
  if (!rawTag) {
    throw new Error('tag not supplied');
  }

  return rawTag.startsWith('v') ? rawTag.slice(1) : rawTag;
}

function resolveRootDir(cwd: string | undefined): string {
  return path.resolve(cwd ?? process.cwd());
}

function readJson(filePath: string): PackageJson {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function runCommand(command: string, args: ReadonlyArray<string>, cwd: string): void {
  execFileSync(command, [...args], {
    cwd,
    stdio: 'inherit',
  });
}

function copyPackageFiles(packageDir: string, publishDir: string): void {
  mkdirSync(publishDir, { recursive: true });

  for (const fileName of COPY_PACKAGE_FILES) {
    const sourcePath = path.join(packageDir, fileName);
    if (!existsSync(sourcePath)) {
      continue;
    }

    copyFileSync(sourcePath, path.join(publishDir, fileName));
  }
}

function copyRootFiles(rootDir: string, publishDir: string, rootFiles: ReadonlyArray<string>): void {
  for (const fileName of rootFiles) {
    const sourcePath = path.join(rootDir, fileName);
    if (!existsSync(sourcePath)) {
      continue;
    }

    copyFileSync(sourcePath, path.join(publishDir, fileName));
  }
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

function getInternalDependencies(packageJson: PackageJson, internalPackageNames: Set<string>): Set<string> {
  const dependencyNames = new Set<string>();

  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = packageJson[field];
    if (!isPlainObject(dependencies)) {
      continue;
    }

    for (const dependencyName of Object.keys(dependencies)) {
      if (internalPackageNames.has(dependencyName)) {
        dependencyNames.add(dependencyName);
      }
    }
  }

  return dependencyNames;
}

function discoverPackages(rootDir: string): PackageEntry[] {
  const packageRoot = path.join(rootDir, 'packages');
  const packageDirs = readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packageRoot, entry.name))
    .filter((dir) => existsSync(path.join(dir, PACKAGE_JSON)));

  return packageDirs.map((dir) => {
    const packageJson = readJson(path.join(dir, PACKAGE_JSON));

    if (!packageJson.name) {
      throw new Error(`Package name missing in ${path.join(dir, PACKAGE_JSON)}`);
    }

    return { dir, packageJson };
  });
}

function matchesSelector(pkg: PackageEntry, selector: string): boolean {
  if (typeof selector !== 'string' || selector.length === 0) {
    return false;
  }

  const packageName = pkg.packageJson.name as string;
  const directoryName = path.basename(pkg.dir);

  return packageName === selector || directoryName === selector;
}

function matchesAnySelector(pkg: PackageEntry, selectors: ReadonlyArray<string>): boolean {
  return selectors.some((selector) => matchesSelector(pkg, selector));
}

function selectPackages(
  packages: ReadonlyArray<PackageEntry>,
  filters: ReadonlyArray<string> | undefined,
  from: string | undefined,
): PackageEntry[] {
  let selectedPackages = [...packages];

  if (filters && filters.length > 0) {
    selectedPackages = selectedPackages.filter((pkg) => matchesAnySelector(pkg, filters));
  }

  if (from) {
    const startIndex = selectedPackages.findIndex((pkg) => matchesSelector(pkg, from));
    if (startIndex === -1) {
      throw new Error(`No package matched --from ${from}`);
    }

    selectedPackages = selectedPackages.slice(startIndex);
  }

  return selectedPackages;
}
