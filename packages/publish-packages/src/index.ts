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
  resolvePublishPackagePlan,
  type PackageJson,
  type ProcessRunner,
  type PublishPackageOptions,
  defaultProcessRunner,
} from '@repo-toolkit/publish-package';

export { inferNpmTag, isPlainObject, normalizeVersion };

export type { ProcessRunner };

const PUBLISH_PACKAGES_OPTION_KEYS = new Set([
  'version',
  'cwd',
  'npmTag',
  'dryRun',
  'filters',
  'from',
  'packageFiles',
  'includePackageFiles',
  'noDefaultPackageFiles',
  'rootFiles',
  'includeRootFiles',
  'noDefaultRootFiles',
  'publishDir',
  'preservePublishDir',
  'versionPlaceholder',
  'buildCommand',
  'skipBuild',
  'access',
  'registry',
  'otp',
  'provenance',
  'runner',
]);

const BUILD_ORDER_DEPENDENCY_FIELDS = [...DEPENDENCY_FIELDS, 'devDependencies'] as const;

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
  /** Keep the configured publishDir inside the npm package instead of flattening it to the package root. Defaults to `false`. */
  preservePublishDir?: boolean;
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
  /**
   * Process runner used to execute build commands and `npm publish` for every
   * selected package. Defaults to {@link defaultProcessRunner}, which spawns
   * child processes via `execFileSync` and inherits stdio. Tests inject a fake
   * runner to assert exact invocations without contacting a real npm registry.
   */
  runner?: ProcessRunner;
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
  preservePublishDir: boolean;
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
  runner: ProcessRunner;
}

export function sortPackagesByInternalDependencies(
  packages: ReadonlyArray<PackageEntry>,
  internalPackageNames: Set<string>,
): PackageEntry[] {
  const sortedPackages = [...packages].sort((left, right) =>
    String(left.packageJson.name).localeCompare(String(right.packageJson.name)),
  );
  const packagesByName = new Map(sortedPackages.map((pkg) => [pkg.packageJson.name as string, pkg]));
  const visited = new Set<string>();
  const visitingSet = new Set<string>();
  const visitingOrder: string[] = [];
  const ordered: PackageEntry[] = [];

  for (const pkg of sortedPackages) {
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

    for (const dependencyName of [...getInternalDependencies(pkg.packageJson, internalPackageNames)].sort()) {
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
  validatePublishPackagesOptions(options);
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
    packageFiles: Object.freeze([
      ...(options.noDefaultPackageFiles
        ? (options.packageFiles ?? [])
        : (options.packageFiles ?? DEFAULT_PACKAGE_FILES)),
    ]),
    includePackageFiles: Object.freeze([...(options.includePackageFiles ?? [])]),
    noDefaultPackageFiles: options.noDefaultPackageFiles ?? false,
    rootFiles: Object.freeze([
      ...(options.noDefaultRootFiles ? (options.rootFiles ?? []) : (options.rootFiles ?? DEFAULT_ROOT_FILES)),
    ]),
    includeRootFiles: Object.freeze([...(options.includeRootFiles ?? [])]),
    noDefaultRootFiles: options.noDefaultRootFiles ?? false,
    publishDir: options.publishDir ?? DEFAULT_PUBLISH_DIR,
    preservePublishDir: options.preservePublishDir ?? false,
    versionPlaceholder: options.versionPlaceholder ?? DEFAULT_VERSION_PLACEHOLDER,
    buildCommand: options.buildCommand ?? DEFAULT_BUILD_COMMAND,
    skipBuild: options.skipBuild ?? false,
    access: options.access ?? DEFAULT_ACCESS,
    registry: options.registry,
    otp: options.otp,
    provenance: options.provenance ?? false,
    dryRun: options.dryRun ?? false,
    internalPackageNames: new Set(internalPackageNames),
    packages: orderedPackages.map((pkg) => ({ ...pkg, packageJson: { ...pkg.packageJson } })),
    runner: options.runner ?? defaultProcessRunner,
  };
}

export function publishPackages(options: PublishPackagesOptions): void {
  const plan = resolvePublishPackagesPlan(options);
  const publishOptionsByPackage = plan.packages.map((pkg) => ({
    pkg,
    publishOptions: toPublishPackageOptions(plan, pkg.dir),
  }));

  for (const entry of publishOptionsByPackage) {
    resolvePublishPackagePlan(entry.publishOptions);
  }

  console.log(`target version ${plan.version}`);
  if (plan.npmTag) {
    console.log(`npm dist-tag ${plan.npmTag}`);
  }

  const completed: string[] = [];

  for (let index = 0; index < publishOptionsByPackage.length; index += 1) {
    const entry = publishOptionsByPackage[index];
    console.log(`processing ${entry.pkg.dir}`);

    try {
      publishPackage(entry.publishOptions);
      completed.push(entry.pkg.packageJson.name as string);
    } catch (error) {
      const pending = publishOptionsByPackage
        .slice(index)
        .map((candidate) => candidate.pkg.packageJson.name as string)
        .filter((name) => !completed.includes(name));
      const wrappedError = new Error(
        `Publish failed after preflight. Completed packages: ${formatPackageList(completed)}. Pending packages: ${formatPackageList(
          pending,
        )}.`,
      ) as Error & { cause?: unknown };
      wrappedError.cause = error;
      throw wrappedError;
    }
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

  const packages = packageDirs.map((dir) => {
    const packageJsonPath = path.join(dir, 'package.json');
    const packageJson = readJson(packageJsonPath);

    if (!isPlainObject(packageJson)) {
      throw new Error(`Package manifest must be an object: ${packageJsonPath}`);
    }

    const name = packageJson.name;
    if (typeof name !== 'string' || !isValidPackageName(name)) {
      throw new Error(`Package name missing or invalid in ${packageJsonPath}`);
    }

    if (packageJson.private === true) {
      throw new Error(`Refusing to publish private workspace package: ${packageJsonPath}`);
    }

    return { dir, packageJson };
  });

  const packagePathsByName = new Map<string, string[]>();

  for (const pkg of packages) {
    const name = pkg.packageJson.name as string;
    const manifestPath = path.join(pkg.dir, 'package.json');
    const paths = packagePathsByName.get(name) ?? [];
    paths.push(manifestPath);
    packagePathsByName.set(name, paths);
  }

  const duplicates = [...packagePathsByName.entries()].filter(([, paths]) => paths.length > 1);
  if (duplicates.length > 0) {
    const details = duplicates.map(([name, paths]) => `${name}: ${paths.join(', ')}`).join('; ');
    throw new Error(`Duplicate workspace package names found: ${details}`);
  }

  return packages;
}

function getInternalDependencies(packageJson: PackageJson, internalPackageNames: Set<string>): Set<string> {
  const dependencyNames = new Set<string>();

  for (const field of BUILD_ORDER_DEPENDENCY_FIELDS) {
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

function validatePublishPackagesOptions(options: PublishPackagesOptions): void {
  for (const key of Object.keys(options)) {
    if (!PUBLISH_PACKAGES_OPTION_KEYS.has(key)) {
      throw new Error(`Unknown publish-packages option: ${key}`);
    }
  }

  validateOptionalStringArray(options.filters, 'filters');
  validateOptionalStringArray(options.packageFiles, 'packageFiles');
  validateOptionalStringArray(options.includePackageFiles, 'includePackageFiles');
  validateOptionalStringArray(options.rootFiles, 'rootFiles');
  validateOptionalStringArray(options.includeRootFiles, 'includeRootFiles');
  validateOptionalBoolean(options.noDefaultPackageFiles, 'noDefaultPackageFiles');
  validateOptionalBoolean(options.noDefaultRootFiles, 'noDefaultRootFiles');
  validateOptionalBoolean(options.skipBuild, 'skipBuild');
  validateOptionalBoolean(options.provenance, 'provenance');
  validateOptionalBoolean(options.dryRun, 'dryRun');
  validateOptionalBoolean(options.preservePublishDir, 'preservePublishDir');
  validateOptionalString(options.cwd, 'cwd');
  validateOptionalString(options.version, 'version');
  validateOptionalString(options.npmTag, 'npmTag');
  validateOptionalString(options.publishDir, 'publishDir');
  validateOptionalString(options.versionPlaceholder, 'versionPlaceholder');
  validateOptionalString(options.buildCommand, 'buildCommand');
  validateOptionalString(options.access, 'access');
  validateOptionalString(options.registry, 'registry');
  validateOptionalString(options.otp, 'otp');

  if (options.from !== undefined && (typeof options.from !== 'string' || options.from.length === 0)) {
    throw new Error('from must be a non-empty string');
  }

  if (options.runner !== undefined && (typeof options.runner !== 'object' || options.runner === null)) {
    throw new Error('runner must be a ProcessRunner object');
  }
}

function validateOptionalStringArray(value: ReadonlyArray<string> | undefined, label: string): void {
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }

  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Error(`${label} must be an array of non-empty strings`);
    }
  }
}

function validateOptionalBoolean(value: boolean | undefined, label: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
}

function validateOptionalString(value: string | undefined, label: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
}

function isValidPackageName(name: string): boolean {
  return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(name);
}

function toPublishPackageOptions(plan: PublishPackagesPlan, cwd: string): PublishPackageOptions {
  return {
    cwd,
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
    preservePublishDir: plan.preservePublishDir,
    versionPlaceholder: plan.versionPlaceholder,
    buildCommand: plan.buildCommand,
    skipBuild: plan.skipBuild,
    access: plan.access,
    registry: plan.registry,
    otp: plan.otp,
    provenance: plan.provenance,
    internalPackageNames: plan.internalPackageNames,
    runner: plan.runner,
  } satisfies PublishPackageOptions;
}

function formatPackageList(packageNames: ReadonlyArray<string>): string {
  return packageNames.length > 0 ? packageNames.join(', ') : '(none)';
}
