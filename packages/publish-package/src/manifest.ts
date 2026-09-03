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
  preservePublishDir?: boolean;
  /**
   * Preserve the source manifest's `files` allow-list instead of injecting
   * the safe default ({@link DEFAULT_PUBLISH_FILES_FIELD}). The source value
   * must be an array of strings; anything else is rejected.
   */
  preserveSourceFiles?: boolean;
}

export interface CreatePublishPackageJsonOptions {
  version: string;
  internalPackageNames: Set<string>;
  rootMetadata?: RootMetadata;
  rewrite?: PublishRewriteOptions;
  /**
   * Inject `publishConfig.access` into the generated manifest. This is
   * metadata only; npm publication still passes `--access` explicitly.
   */
  publishAccess?: string;
}

export function createPublishPackageJson(
  packageJson: PackageJson,
  options: CreatePublishPackageJsonOptions,
): PackageJson {
  const { version, internalPackageNames, rootMetadata = {}, rewrite = {} } = options;
  const versionPlaceholder = rewrite.versionPlaceholder ?? DEFAULT_VERSION_PLACEHOLDER;
  const metadataPlaceholder = rewrite.metadataPlaceholder ?? DEFAULT_METADATA_PLACEHOLDER;
  const publishDir = rewrite.publishDir ?? DEFAULT_PUBLISH_DIR;
  const preservePublishDir = rewrite.preservePublishDir ?? false;
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
      publishPackageJson[key] = rewriteDistPath(value as string, publishDir, preservePublishDir);
      continue;
    }

    if (key === 'bin') {
      publishPackageJson.bin = rewriteBin(value, publishDir, preservePublishDir);
      continue;
    }

    if (key === 'exports') {
      publishPackageJson.exports = rewriteExports(value, publishDir, 'exports', preservePublishDir);
      continue;
    }

    if (key === 'imports') {
      publishPackageJson.imports = rewriteImports(value, publishDir, preservePublishDir);
      continue;
    }

    publishPackageJson[key] = value;
  }

  validatePublishManifestFields(publishPackageJson);

  // Inject a `files` field so npm doesn't accidentally include stray files
  // (e.g. .map files, temp artefacts) from the publish directory. A recipe
  // may opt into preserving a validated source allow-list instead.
  publishPackageJson.files = resolvePublishFiles(packageJson.files, rewrite.preserveSourceFiles === true);

  const resolvedAuthor = resolvePlaceholderField(packageJson.author, rootMetadata.author, metadataPlaceholder);
  if (resolvedAuthor !== undefined) {
    publishPackageJson.author = resolvedAuthor;
  } else {
    delete publishPackageJson.author;
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

  if (options.publishAccess !== undefined) {
    publishPackageJson.publishConfig = mergePublishConfigAccess(
      publishPackageJson.publishConfig,
      options.publishAccess,
    );
  }

  return publishPackageJson;
}

function resolvePublishFiles(sourceFiles: unknown, preserveSourceFiles: boolean): string[] {
  if (!preserveSourceFiles) {
    return [...DEFAULT_PUBLISH_FILES_FIELD];
  }

  if (!Array.isArray(sourceFiles) || sourceFiles.some((entry) => typeof entry !== 'string')) {
    throw new Error('preserveSourceFiles requires the source manifest "files" field to be an array of strings');
  }

  return [...sourceFiles];
}

function mergePublishConfigAccess(existingPublishConfig: unknown, access: string): Record<string, unknown> {
  if (existingPublishConfig === undefined) {
    return { access };
  }

  if (!isPlainObject(existingPublishConfig)) {
    throw new Error('Invalid publishConfig: expected an object');
  }

  return { ...existingPublishConfig, access };
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
function rewriteDistPath(value: string, publishDir: string, preservePublishDir: boolean): string {
  if (preservePublishDir) {
    return value;
  }
  const escaped = publishDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.replace(new RegExp(`^\\.\\/${escaped}/`), './').replace(new RegExp(`^${escaped}/`), './');
}

function rewriteExports(
  exportsField: unknown,
  publishDir: string,
  label: string,
  preservePublishDir: boolean,
): unknown {
  if (typeof exportsField === 'string') {
    return rewriteDistPath(exportsField, publishDir, preservePublishDir);
  }

  if (Array.isArray(exportsField)) {
    return exportsField.map((entry, i) => {
      if (typeof entry === 'string') {
        return rewriteDistPath(entry, publishDir, preservePublishDir);
      }
      if (isPlainObject(entry) || Array.isArray(entry)) {
        return rewriteExports(entry, publishDir, `${label}[${i}]`, preservePublishDir);
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
        return [key, rewriteExports(value, publishDir, `${label}.${key}`, preservePublishDir)];
      }
      return [key, rewriteExports(value, publishDir, `${label}.${key}`, preservePublishDir)];
    }),
  );
}

function rewriteImports(importsField: unknown, publishDir: string, preservePublishDir: boolean): unknown {
  if (!isPlainObject(importsField)) {
    throw new Error(`Unsupported imports type: ${typeof importsField}`);
  }

  return Object.fromEntries(
    Object.entries(importsField).map(([key, value]) => [
      key,
      rewriteExports(value, publishDir, `imports.${key}`, preservePublishDir),
    ]),
  );
}

function rewriteBin(binField: unknown, publishDir: string, preservePublishDir: boolean): unknown {
  if (typeof binField === 'string') {
    return rewriteDistPath(binField, publishDir, preservePublishDir);
  }

  if (!isPlainObject(binField)) {
    throw new Error(`Unsupported bin type: ${typeof binField}`);
  }

  const rewritten: Record<string, string> = {};
  for (const [key, value] of Object.entries(binField)) {
    if (typeof value !== 'string') {
      throw new Error(`Unsupported bin.${key} type: ${typeof value}`);
    }
    rewritten[key] = rewriteDistPath(value, publishDir, preservePublishDir);
  }
  return rewritten;
}

/**
 * Release-safety fields an artifact manifest overlay may never set. These are
 * either stripped from source manifests for release safety (`scripts`,
 * `devDependencies`, `packageManager`, `private`) or fixed by the plan.
 */
export const OVERLAY_DENIED_FIELDS = ['private', 'scripts', 'devDependencies', 'packageManager'] as const;

export interface ManifestOverlayPolicyContext {
  /** Target release version from the plan. */
  version: string;
  /** Final package name of the artifact receiving the overlay. */
  packageName: string;
  internalPackageNames: Set<string>;
  versionPlaceholder: string;
}

/**
 * Applies a per-artifact manifest overlay to a generated publish manifest
 * and re-finalizes the result.
 *
 * Overlay policy (ARTIFACT-04 decision): a protected-field DENY-LIST, not a
 * strict allow-list. Rationale: the consumer's public manifest surface spans
 * open-ended fields (description, keywords, exports, publishConfig, files,
 * dependency-map adjustments) that a closed allow-list would have to
 * enumerate and maintain; the release-safety boundary is instead a small,
 * stable set of protected fields. The overlay therefore may set any field
 * except:
 *
 * - `private`, `scripts`, `devDependencies`, `packageManager` — always
 *   rejected (release-safety fields stripped by manifest generation).
 * - `version` — rejected when it conflicts with the plan release version.
 * - `name` — rejected when it conflicts with the artifact's package name.
 *
 * Shape constraints: `exports` is validated with the same shape validation
 * the source manifest receives, `files` must be an array of strings, and
 * dependency fields must be objects of string ranges.
 *
 * After merging, dependency/version-placeholder rewriting is re-applied and
 * the final manifest is re-validated, so an overlay cannot smuggle
 * unresolved `workspace:` ranges or placeholder versions into the output.
 */
export function applyManifestOverlay(
  manifest: PackageJson,
  overlay: Record<string, unknown>,
  context: ManifestOverlayPolicyContext,
): PackageJson {
  for (const field of OVERLAY_DENIED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(overlay, field)) {
      throw new Error(`artifact manifest overlay must not set "${field}"`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(overlay, 'version') && overlay.version !== context.version) {
    throw new Error(`artifact manifest overlay version conflicts with the release version: ${String(overlay.version)}`);
  }

  if (Object.prototype.hasOwnProperty.call(overlay, 'name') && overlay.name !== context.packageName) {
    throw new Error(`artifact manifest overlay name conflicts with the artifact package name: ${String(overlay.name)}`);
  }

  if (overlay.exports !== undefined) {
    const shape = validateExportsShape(overlay.exports, 'exports');
    if (!shape.valid) {
      throw new Error(`artifact manifest overlay has an invalid exports field: ${shape.reason ?? 'invalid shape'}`);
    }
  }

  if (
    overlay.files !== undefined &&
    (!Array.isArray(overlay.files) || overlay.files.some((e) => typeof e !== 'string'))
  ) {
    throw new Error('artifact manifest overlay files must be an array of strings');
  }

  for (const field of DEPENDENCY_FIELDS) {
    const value = overlay[field];
    if (value === undefined) {
      continue;
    }
    if (!isPlainObject(value)) {
      throw new Error(`artifact manifest overlay ${field} must be an object`);
    }
    for (const [depName, range] of Object.entries(value)) {
      if (typeof range !== 'string') {
        throw new Error(`artifact manifest overlay ${field}.${depName} must be a string range`);
      }
    }
  }

  const merged: PackageJson = { ...manifest, ...overlay };

  for (const field of DEPENDENCY_FIELDS) {
    if (merged[field] === undefined) {
      continue;
    }
    const rewritten = rewriteDependencyMap(
      merged[field],
      context.version,
      context.internalPackageNames,
      context.versionPlaceholder,
    );
    if (rewritten !== undefined) {
      merged[field] = rewritten;
    }
  }

  validatePublishManifestFields(merged);

  return merged;
}
