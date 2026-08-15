import { isPlainObject } from './helpers';

export type PackageJson = Record<string, unknown>;

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
export const DEFAULT_METADATA_PLACEHOLDER = 'PLACEHOLDER';
export const DEFAULT_PUBLISH_DIR = 'dist';
export const DEFAULT_PACKAGE_FILES = ['README.md', 'CHANGELOG.md', 'llms.txt'];
export const DEFAULT_ROOT_FILES = ['LICENSE'];
export const DEFAULT_BUILD_COMMAND = 'pnpm build';
export const DEFAULT_ACCESS = 'public';
export const DEFAULT_PUBLISH_FILES_FIELD = ['**/*', '!**/*.map'];

export interface RootMetadata {
  author?: Record<string, unknown> | string;
  bugs?: Record<string, unknown> | string;
  engines?: Record<string, string>;
  license?: string;
  repository?: Record<string, unknown> | string;
}

export interface PublishRewriteOptions {
  versionPlaceholder?: string;
  metadataPlaceholder?: string;
  publishDir?: string;
}

export interface CreatePublishPackageJsonOptions {
  version: string;
  internalPackageNames: Set<string>;
  rootMetadata?: RootMetadata;
  rewrite?: PublishRewriteOptions;
}

export function createPublishPackageJson(
  packageJson: PackageJson,
  options: CreatePublishPackageJsonOptions,
): PackageJson {
  const { version, internalPackageNames, rootMetadata = {}, rewrite = {} } = options;
  const versionPlaceholder = rewrite.versionPlaceholder ?? DEFAULT_VERSION_PLACEHOLDER;
  const metadataPlaceholder = rewrite.metadataPlaceholder ?? DEFAULT_METADATA_PLACEHOLDER;
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
      publishPackageJson.exports = rewriteExports(value, publishDir, 'exports');
      continue;
    }

    if (key === 'imports') {
      publishPackageJson.imports = rewriteImports(value, publishDir);
      continue;
    }

    publishPackageJson[key] = value;
  }

  validatePublishManifestFields(publishPackageJson);

  // Inject a `files` field so npm doesn't accidentally include stray files
  // (e.g. .map files, temp artefacts) from the publish directory.
  publishPackageJson.files = [...DEFAULT_PUBLISH_FILES_FIELD];

  if (rootMetadata.author !== undefined && publishPackageJson.author === undefined) {
    publishPackageJson.author = rootMetadata.author;
  }

  if (rootMetadata.bugs !== undefined && publishPackageJson.bugs === undefined) {
    publishPackageJson.bugs = rootMetadata.bugs;
  }

  if (rootMetadata.engines !== undefined && publishPackageJson.engines === undefined) {
    publishPackageJson.engines = rootMetadata.engines;
  }

  publishPackageJson.license = resolvePlaceholderField(packageJson.license, rootMetadata.license, metadataPlaceholder);

  publishPackageJson.repository = resolvePlaceholderField(
    packageJson.repository,
    rootMetadata.repository,
    metadataPlaceholder,
  );

  return publishPackageJson;
}

function resolvePlaceholderField(sourceValue: unknown, rootValue: unknown, placeholder: string): unknown {
  if (sourceValue !== undefined && sourceValue !== placeholder) {
    return sourceValue;
  }
  return rootValue;
}

export function validateSourceManifest(manifest: PackageJson, manifestPath: string): void {
  if (!isPlainObject(manifest)) {
    throw new Error(`Invalid manifest at ${manifestPath}: expected an object`);
  }

  const name = manifest.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`Invalid manifest at ${manifestPath}: name must be a non-empty string`);
  }

  for (const extra of Array.isArray(manifest.additionalNames) ? manifest.additionalNames : []) {
    if (typeof extra !== 'string' || extra.length === 0) {
      throw new Error(`Invalid manifest at ${manifestPath}: additionalNames must be non-empty strings`);
    }
  }

  const version = manifest.version;
  if (version !== undefined && typeof version !== 'string') {
    throw new Error(`Invalid manifest at ${manifestPath}: version must be a string or undefined`);
  }

  for (const field of DEPENDENCY_FIELDS) {
    const value = manifest[field];
    if (value === undefined) {
      continue;
    }
    if (!isPlainObject(value)) {
      throw new Error(`Invalid manifest at ${manifestPath}: ${field} must be an object`);
    }
    for (const [depName, range] of Object.entries(value as Record<string, unknown>)) {
      if (typeof range !== 'string') {
        throw new Error(`Invalid manifest at ${manifestPath}: ${field}.${depName} must be a string range`);
      }
    }
  }

  if (manifest.bin !== undefined) {
    if (typeof manifest.bin !== 'string' && !isPlainObject(manifest.bin)) {
      throw new Error(`Invalid manifest at ${manifestPath}: bin must be a string or object`);
    }
  }

  for (const field of ['main', 'module', 'types'] as const) {
    const value = manifest[field];
    if (value !== undefined && typeof value !== 'string') {
      throw new Error(`Invalid manifest at ${manifestPath}: ${field} must be a string`);
    }
  }

  if (manifest.exports !== undefined) {
    const shape = validateExportsShape(manifest.exports, 'exports');
    if (!shape.valid) {
      throw new Error(`Invalid manifest at ${manifestPath}: ${shape.reason}`);
    }
  }

  if (manifest.imports !== undefined) {
    if (!isPlainObject(manifest.imports)) {
      throw new Error(`Invalid manifest at ${manifestPath}: imports must be an object`);
    }
    for (const [key, value] of Object.entries(manifest.imports as Record<string, unknown>)) {
      const shape = validateExportsShape(value, `imports.${key}`);
      if (!shape.valid) {
        throw new Error(`Invalid manifest at ${manifestPath}: ${shape.reason}`);
      }
    }
  }
}

export function validateRootManifest(manifest: PackageJson, rootDir: string): void {
  if (!isPlainObject(manifest)) {
    throw new Error(`Invalid root manifest at ${rootDir}: expected an object`);
  }
  if (manifest.engines !== undefined) {
    if (!isPlainObject(manifest.engines)) {
      throw new Error(`Invalid root manifest at ${rootDir}: engines must be an object`);
    }
    for (const [key, value] of Object.entries(manifest.engines as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        throw new Error(`Invalid root manifest at ${rootDir}: engines.${key} must be a string`);
      }
    }
  }
}

function validateExportsShape(value: unknown, label: string): { valid: boolean; reason?: string } {
  if (value === null) {
    return { valid: false, reason: `${label} must not be null` };
  }
  if (typeof value === 'string') {
    return { valid: true };
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const r = validateExportsShape(value[i], `${label}[${i}]`);
      if (!r.valid) {
        return r;
      }
    }
    return { valid: true };
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const r = validateExportsShape(child, `${label}.${key}`);
      if (!r.valid) {
        return r;
      }
    }
    return { valid: true };
  }
  return { valid: false, reason: `${label} must be a string, array, or object` };
}

function validatePublishManifestFields(publishPackageJson: PackageJson): void {
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
    const value = publishPackageJson[field];
    if (value === undefined) {
      continue;
    }
    if (!isPlainObject(value)) {
      throw new Error(`Invalid ${field}: expected an object`);
    }
    for (const [name, range] of Object.entries(value as Record<string, unknown>)) {
      if (typeof range !== 'string') {
        throw new Error(`Invalid ${field}.${name}: expected string range`);
      }
      if (range.startsWith('workspace:')) {
        const spec = range.slice('workspace:'.length);
        if (spec === '*' || spec === '^' || spec === '~' || spec === '') {
          throw new Error(
            `Unresolved workspace: range in ${field}.${name}: ${range}. Run publish-packages to resolve, or pass allowUnresolvedWorkspace to permit.`,
          );
        }
      }
    }
  }

  const main = publishPackageJson.main;
  if (main !== undefined && typeof main !== 'string') {
    throw new Error('Invalid main: expected a string');
  }
  const module = publishPackageJson.module;
  if (module !== undefined && typeof module !== 'string') {
    throw new Error('Invalid module: expected a string');
  }
  const types = publishPackageJson.types;
  if (types !== undefined && typeof types !== 'string') {
    throw new Error('Invalid types: expected a string');
  }
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

/**
 * Rewrites `dist/foo` → `./foo` (and `./dist/foo` → `./foo`) using the
 * configured `publishDir` instead of a hardcoded `"dist"`.
 */
function rewriteDistPath(value: string, publishDir: string): string {
  const escaped = publishDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.replace(new RegExp(`^\\.\\/${escaped}/`), './').replace(new RegExp(`^${escaped}/`), './');
}

function rewriteExports(exportsField: unknown, publishDir: string, label: string): unknown {
  if (typeof exportsField === 'string') {
    return rewriteDistPath(exportsField, publishDir);
  }

  if (Array.isArray(exportsField)) {
    return exportsField.map((entry, i) => {
      if (typeof entry === 'string') {
        return rewriteDistPath(entry, publishDir);
      }
      if (isPlainObject(entry) || Array.isArray(entry)) {
        return rewriteExports(entry, publishDir, `${label}[${i}]`);
      }
      throw new Error(`Unsupported ${label}[${i}] type: ${typeof entry}`);
    });
  }

  if (!isPlainObject(exportsField)) {
    throw new Error(`Unsupported ${label} type: ${typeof exportsField}`);
  }

  return Object.fromEntries(
    Object.entries(exportsField).map(([key, value]) => {
      if (key === 'require' || key === 'import' || key === 'default' || key === 'types' || key === 'node') {
        return [key, rewriteExports(value, publishDir, `${label}.${key}`)];
      }
      return [key, rewriteExports(value, publishDir, `${label}.${key}`)];
    }),
  );
}

function rewriteImports(importsField: unknown, publishDir: string): unknown {
  if (!isPlainObject(importsField)) {
    throw new Error(`Unsupported imports type: ${typeof importsField}`);
  }

  return Object.fromEntries(
    Object.entries(importsField).map(([key, value]) => [key, rewriteExports(value, publishDir, `imports.${key}`)]),
  );
}

function rewriteBin(binField: unknown, publishDir: string): unknown {
  if (typeof binField === 'string') {
    return rewriteDistPath(binField, publishDir);
  }

  if (!isPlainObject(binField)) {
    throw new Error(`Unsupported bin type: ${typeof binField}`);
  }

  const rewritten: Record<string, string> = {};
  for (const [key, value] of Object.entries(binField)) {
    if (typeof value !== 'string') {
      throw new Error(`Unsupported bin.${key} type: ${typeof value}`);
    }
    rewritten[key] = rewriteDistPath(value, publishDir);
  }
  return rewritten;
}
