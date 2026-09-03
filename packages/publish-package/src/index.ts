// Public API surface for `@repo-toolkit/publish-package`.
//
// The implementation lives in focused internal modules:
//   - `./flags`    : CLI flag parser (`parseFlags`, `FlagSpec`, ...)
//   - `./prompt`   : interactive prompts + config-file loader (`promptText`,
//                    `promptForRequiredValue`, `loadConfigFile`, `resolveCliOptions`, ...)
//   - `./runner`   : injectable subprocess runner (`ProcessRunner`,
//                    `CapturingProcessRunner`, `defaultProcessRunner`, ...)
//   - `./version`  : strict semver validation and registry-derived version
//                    bumps (`resolveRegistryBumpVersion`, `VersionResolutionError`)
//   - `./helpers`  : pure utilities (`isPlainObject`, `inferNpmTag`, `normalizeVersion`)
//   - `./manifest` : publish-manifest rewrite and validation
//                    (`createPublishPackageJson`, `validateSourceManifest`, ...)
//   - `./plan`     : publish plan resolution and path-containment helpers
//                    (`resolvePublishPackagePlan`, `PublishPackagePlan`,
//                    `PublishPackageOptions`, `ensurePathWithinRoot`)
//   - `./publish`  : the build/copy/npm-publish pipeline (`publishPackage`)
//
// Nothing is implemented in this file. It is a pure re-export so the package's
// external API stays in one auditable place while the implementation is split
// by responsibility. See README.md for the supported helper contracts.

export {
  type FlagSpec,
  type ParseFlagsResult,
  type ParseFlagsOptions,
  parseFlags,
  readValue,
  splitListArg,
} from './flags';

export {
  resolveConfigPath,
  loadConfigFile,
  INTERACTIVE_FLAG,
  canPrompt,
  promptText,
  resolveCliOptions,
  promptForRequiredValue,
  type PromptTextOptions,
  type ResolveCliOptionsArgs,
  type PromptForRequiredValueOptions,
} from './prompt';

export {
  type ProcessRunner,
  type ProcessRunOptions,
  type ProcessCaptureOptions,
  type ProcessCaptureResult,
  type CapturingProcessRunner,
  isCapturingProcessRunner,
  defaultProcessRunner,
} from './runner';

export {
  type VersionBump,
  type VersionFailureKind,
  type RegistryVersionQuery,
  VersionResolutionError,
  isValidSemver,
  isVersionBump,
  normalizeReleaseVersion,
  bumpVersion,
  resolveRegistryBumpVersion,
  redactSensitiveValues,
} from './version';

export { isPlainObject, inferNpmTag, normalizeVersion } from './helpers';

export {
  type PackageJson,
  type RootMetadata,
  type PublishRewriteOptions,
  type CreatePublishPackageJsonOptions,
  DEPENDENCY_FIELDS,
  DEFAULT_VERSION_PLACEHOLDER,
  DEFAULT_PUBLISH_DIR,
  DEFAULT_PACKAGE_FILES,
  DEFAULT_ROOT_FILES,
  DEFAULT_BUILD_COMMAND,
  DEFAULT_ACCESS,
  DEFAULT_PUBLISH_FILES_FIELD,
  OVERLAY_DENIED_FIELDS,
  createPublishPackageJson,
  applyManifestOverlay,
  validateSourceManifest,
  validateRootManifest,
  type ManifestOverlayPolicyContext,
} from './manifest';

export {
  type PublishPackageOptions,
  type PublishPackagePlan,
  type PackageArtifactRecipe,
  type PackageArtifactContext,
  type PackageArtifactHook,
  type PackageArtifactManifestOverlay,
  type ResolvedPackageArtifact,
  type PreparedPackageArtifact,
  resolvePublishPackagePlan,
  resolvePublishPackagePlanAsync,
  resolveArtifactContext,
  ensurePathWithinRoot,
  assertPathWithinRoot,
} from './plan';

export { publishPackage, preparePackageArtifacts } from './publish';
