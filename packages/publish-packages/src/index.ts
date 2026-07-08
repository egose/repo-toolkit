import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_ACCESS,
  DEFAULT_BUILD_COMMAND,
  DEFAULT_PACKAGE_FILES,
  DEFAULT_PUBLISH_DIR,
  DEFAULT_ROOT_FILES,
  DEFAULT_VERSION_PLACEHOLDER,
  DEPENDENCY_FIELDS,
  inferNpmTag,
  isPlainObject,
  normalizeVersion,
  publishPackage,
  type PackageJson,
  type PublishPackageOptions,
} from '@repo-toolkit/publish-package';

export { inferNpmTag, isPlainObject, normalizeVersion };

export interface PackageEntry {
  dir: string;
  packageJson: PackageJson;
}

export interface PublishPackagesOptions {
  /** Target version for every selected package. A leading `v` is stripped. */
  version: string;
  /** Workspace root directory. Defaults to `process.cwd()`. */
  cwd?: string;
  /** npm dist-tag. Defaults to the prerelease `preid` inferred from `version`. */
  npmTag?: string;
  /** Forward `--dry-run` to `npm publish`. */
  dryRun?: boolean;
  /** Only publish packages matching any of these name/directory selectors. */
  filters?: ReadonlyArray<string>;
  /** Start publishing from the first package matching this selector. */
  from?: string;
  /** Files to copy from the package root into each publish directory. */
  packageFiles?: ReadonlyArray<string>;
  /** Additional files to copy from each package root (appended to `packageFiles`). */
  includePackageFiles?: ReadonlyArray<string>;
  /** Skip copying default package files. */
  noDefaultPackageFiles?: boolean;
  /** Files to copy from the workspace root into each publish directory. */
  rootFiles?: ReadonlyArray<string>;
  /** Additional files to copy from the workspace root (appended to `rootFiles`). */
  includeRootFiles?: ReadonlyArray<string>;
  /** Skip copying default root files. */
  noDefaultRootFiles?: boolean;
  /** Publish directory inside each package. Defaults to `dist`. */
  publishDir?: string;
  /** Placeholder rewritten to the target version. Defaults to `0.0.0-PLACEHOLDER`. */
  versionPlaceholder?: string;
  /** Command used to build the publish directory. Defaults to `pnpm build`. */
  buildCommand?: string;
  /** Skip the build step. */
  skipBuild?: boolean;
  /** npm access level. Defaults to `public`. */
  access?: string;
  /** npm registry URL. */
  registry?: string;
  /** npm OTP code. */
  otp?: string;
  /** Request npm provenance attestation. */
  provenance?: boolean;
}

export interface PublishPackagesPlan {
  rootDir: string;
  version: string;
  npmTag?: string;
  packageFiles: ReadonlyArray<string>;
  includePackageFiles: ReadonlyArray<string>;
  noDefaultPackageFiles: boolean;
  rootFiles: ReadonlyArray<string>;
  includeRootFiles: ReadonlyArray<string>;
  noDefaultRootFiles: boolean;
  publishDir: string;
  versionPlaceholder: string;
  buildCommand: string;
  skipBuild: boolean;
  access: string;
  registry?: string;
  otp?: string;
  provenance: boolean;
  dryRun: boolean;
  internalPackageNames: Set<string>;
  packages: PackageEntry[];
}

export function sortPackagesByInternalDependencies(
  packages: ReadonlyArray<PackageEntry>,
  internalPackageNames: Set<string>,
): PackageEntry[] {
  const packagesByName = new Map(packages.map((pkg) => [pkg.packageJson.name as string, pkg]));
  const visited = new Set<string>();
  const visitingSet = new Set<string>();
  const visitingOrder: string[] = [];
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

    if (visitingSet.has(packageName)) {
      const cycleStart = visitingOrder.indexOf(packageName);
      const cycle = [...visitingOrder.slice(cycleStart), packageName].join(' -> ');
      throw new Error(`Circular internal dependency detected: ${cycle}`);
    }

    visitingSet.add(packageName);
    visitingOrder.push(packageName);

    for (const dependencyName of getInternalDependencies(pkg.packageJson, internalPackageNames)) {
      const dependencyPackage = packagesByName.get(dependencyName);
      if (dependencyPackage) {
        visit(dependencyPackage);
      }
    }

    visitingOrder.pop();
    visitingSet.delete(packageName);
    visited.add(packageName);
    ordered.push(pkg);
  }
}

export function resolvePublishPackagesPlan(options: PublishPackagesOptions): PublishPackagesPlan {
  const version = normalizeVersion(options.version);
  const rootDir = path.resolve(options.cwd ?? process.cwd());
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
    packageFiles: options.packageFiles ?? DEFAULT_PACKAGE_FILES,
    includePackageFiles: options.includePackageFiles ?? [],
    noDefaultPackageFiles: options.noDefaultPackageFiles ?? false,
    rootFiles: options.rootFiles ?? DEFAULT_ROOT_FILES,
    includeRootFiles: options.includeRootFiles ?? [],
    noDefaultRootFiles: options.noDefaultRootFiles ?? false,
    publishDir: options.publishDir ?? DEFAULT_PUBLISH_DIR,
    versionPlaceholder: options.versionPlaceholder ?? DEFAULT_VERSION_PLACEHOLDER,
    buildCommand: options.buildCommand ?? DEFAULT_BUILD_COMMAND,
    skipBuild: options.skipBuild ?? false,
    access: options.access ?? DEFAULT_ACCESS,
    registry: options.registry,
    otp: options.otp,
    provenance: options.provenance ?? false,
    dryRun: options.dryRun ?? false,
    internalPackageNames,
    packages: orderedPackages,
  };
}

export function publishPackages(options: PublishPackagesOptions): void {
  const plan = resolvePublishPackagesPlan(options);

  console.log(`target version ${plan.version}`);
  if (plan.npmTag) {
    console.log(`npm dist-tag ${plan.npmTag}`);
  }

  for (const pkg of plan.packages) {
    console.log(`processing ${pkg.dir}`);
    publishPackage({
      cwd: pkg.dir,
      rootDir: plan.rootDir,
      version: plan.version,
      npmTag: plan.npmTag,
      dryRun: plan.dryRun,
      packageFiles: plan.packageFiles,
      includePackageFiles: plan.includePackageFiles,
      noDefaultPackageFiles: plan.noDefaultPackageFiles,
      rootFiles: plan.rootFiles,
      includeRootFiles: plan.includeRootFiles,
      noDefaultRootFiles: plan.noDefaultRootFiles,
      publishDir: plan.publishDir,
      versionPlaceholder: plan.versionPlaceholder,
      buildCommand: plan.buildCommand,
      skipBuild: plan.skipBuild,
      access: plan.access,
      registry: plan.registry,
      otp: plan.otp,
      provenance: plan.provenance,
      internalPackageNames: plan.internalPackageNames,
    } satisfies PublishPackageOptions);
  }
}

function readJson(filePath: string): PackageJson {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function discoverPackages(rootDir: string): PackageEntry[] {
  const packageRoot = path.join(rootDir, 'packages');
  const packageDirs = readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packageRoot, entry.name))
    .filter((dir) => existsSync(path.join(dir, 'package.json')));

  return packageDirs.map((dir) => {
    const packageJson = readJson(path.join(dir, 'package.json'));

    if (!packageJson.name) {
      throw new Error(`Package name missing in ${path.join(dir, 'package.json')}`);
    }

    return { dir, packageJson };
  });
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
    const fromIndex = selectedPackages.findIndex((pkg) => matchesSelector(pkg, from));
    if (fromIndex === -1) {
      throw new Error(`No package matched --from ${from}`);
    }

    selectedPackages = selectedPackages.slice(fromIndex);
  }

  return selectedPackages;
}
