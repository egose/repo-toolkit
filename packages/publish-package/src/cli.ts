import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseFlags,
  type FlagSpec,
  INTERACTIVE_FLAG,
  VersionResolutionError,
  canPrompt,
  DEFAULT_VERSION_PLACEHOLDER,
  isPlainObject,
  isVersionBump,
  promptForRequiredValue,
  resolveCliOptions,
} from './index';
import { publishPackage, type PublishPackageOptions } from './index';

const SPECS: FlagSpec[] = [
  { name: 'config' },
  { name: 'cwd' },
  { name: 'root-dir' },
  { name: 'package-json' },
  { name: 'version', aliases: ['tag'] },
  { name: 'bump' },
  { name: 'npm-tag' },
  { name: 'publish-dir' },
  { name: 'preserve-publish-dir', boolean: true },
  { name: 'version-placeholder' },
  { name: 'package-files', list: true },
  { name: 'include-package-file', repeatable: true },
  { name: 'no-default-package-files', boolean: true },
  { name: 'root-files', list: true },
  { name: 'include-root-file', repeatable: true },
  { name: 'no-default-root-files', boolean: true },
  { name: 'build-command' },
  { name: 'skip-build', boolean: true },
  { name: 'access' },
  { name: 'registry' },
  { name: 'otp' },
  { name: 'provenance', boolean: true },
  { name: 'dry-run', boolean: true },
  { name: 'publish-access' },
  { name: 'prepare-only', boolean: true },
  { name: 'allow-private-template', boolean: true },
  INTERACTIVE_FLAG,
];

export { SPECS };

export function printHelp(): void {
  console.log(`repo-toolkit-publish-package

Usage:
  repo-toolkit-publish-package [options]

Options:
  --config <path>                Config file (JSON, .mjs, or .cjs default export)
  --cwd <path>                   Package root directory (default: process.cwd())
  --root-dir <path>              Directory to source rootFiles from (default: cwd)
  --package-json <path>          Source package.json path (default: package.json)
  --version <version>            Target version (default: package.json.version)
  --tag <version>                Alias for --version
  --bump <major|minor|patch>     Derive the version from the npm registry (mutually exclusive with --version)
  --npm-tag <dist-tag>           npm dist-tag (defaults to prerelease preid)
  --publish-dir <path>           Publish directory inside package root (default: dist)
  --preserve-publish-dir         Keep publishDir inside the npm package (default: flattened to package root)
  --version-placeholder <text>   Placeholder rewritten to target version (default: 0.0.0-PLACEHOLDER)
  --package-files <f>[,<f>]      Files copied from package root (replaces defaults)
  --include-package-file <path>  Additional file copied from package root (repeatable)
  --no-default-package-files     Skip copying default package files
  --root-files <f>[,<f>]         Files copied from rootDir (replaces defaults)
  --include-root-file <path>     Additional file copied from rootDir (repeatable)
  --no-default-root-files        Skip copying default root files
  --build-command <command>      Command used to build publish dir (default: pnpm build)
  --skip-build                   Skip the build step
  --access <level>               npm publish access level (default: public)
  --registry <url>               npm registry URL
  --otp <code>                   npm OTP code
  --provenance                   Request npm provenance attestation
  --dry-run                      Forward --dry-run to npm publish (still calls npm publish)
  --publish-access <level>       Inject publishConfig.access into generated manifests
  --prepare-only                 Prepare and pack artifacts WITHOUT calling npm publish
  --allow-private-template       Opt-in: allow a private source manifest as a non-publishable template
  -i, --interactive              Prompt for missing required values interactively
  -h, --help                     Show this help message
`);
}

export function buildOptions(result: ReturnType<typeof parseFlags>): Partial<PublishPackageOptions> {
  if (!result) {
    return {};
  }

  const { values, repeat } = result;
  const options: Partial<PublishPackageOptions> = {};

  if (values.cwd) options.cwd = values.cwd;
  if (values['root-dir']) options.rootDir = values['root-dir'];
  if (values['package-json']) options.packageJsonPath = values['package-json'];
  if (values.version) options.version = values.version;
  if (values.bump) options.bump = values.bump as PublishPackageOptions['bump'];
  if (values['npm-tag']) options.npmTag = values['npm-tag'];
  if (values['publish-dir']) options.publishDir = values['publish-dir'];
  if (values['preserve-publish-dir'] !== undefined) options.preservePublishDir = true;
  if (values['version-placeholder']) options.versionPlaceholder = values['version-placeholder'];
  if (values['build-command']) options.buildCommand = values['build-command'];
  if (values['no-default-package-files'] !== undefined) options.noDefaultPackageFiles = true;
  if (values['no-default-root-files'] !== undefined) options.noDefaultRootFiles = true;
  if (values['skip-build'] !== undefined) options.skipBuild = true;
  if (values.access) options.access = values.access;
  if (values.registry) options.registry = values.registry;
  if (values.otp) options.otp = values.otp;
  if (values.provenance !== undefined) options.provenance = true;
  if (values['dry-run'] !== undefined) options.dryRun = true;
  if (values['publish-access']) options.publishAccess = values['publish-access'];
  if (values['prepare-only'] !== undefined) options.prepareOnly = true;
  if (values['allow-private-template'] !== undefined) options.allowPrivateTemplate = true;

  if (repeat['package-files']) options.packageFiles = repeat['package-files'];
  if (repeat['include-package-file']) options.includePackageFiles = repeat['include-package-file'];
  if (repeat['root-files']) options.rootFiles = repeat['root-files'];
  if (repeat['include-root-file']) options.includeRootFiles = repeat['include-root-file'];

  return options;
}

/**
 * Fails fast on an invalid version selection before any prompt or subprocess
 * runs. `version` and `bump` are mutually exclusive regardless of whether they
 * came from the CLI or the config file; an invalid `bump` value is rejected
 * here as well.
 */
export function assertVersionSelection(options: PublishPackageOptions): void {
  if (options.bump === undefined) {
    return;
  }

  if (options.version !== undefined) {
    throw new VersionResolutionError(
      'ambiguous-selection',
      '--version and --bump are mutually exclusive (config and CLI sources included)',
    );
  }

  if (!isVersionBump(options.bump)) {
    throw new VersionResolutionError(
      'invalid-version',
      `--bump must be one of "major", "minor", or "patch": ${String(options.bump)}`,
    );
  }
}

/**
 * JSON config files cannot express executable recipe hooks. A JSON config may
 * only use the declarative recipe fields (id, packageName, stageDir,
 * requireTarball, preserveSourceFiles, publishAccess, static manifestOverlay).
 * Hook fields, or a non-object manifestOverlay, fail with an explanatory
 * message directing the user to a JavaScript config.
 */
export function assertJsonConfigRecipesDeclarative(options: PublishPackageOptions, configPath: string): void {
  if (!configPath.endsWith('.json')) {
    return;
  }

  const artifacts = options.artifacts;

  if (!Array.isArray(artifacts)) {
    return;
  }

  for (const artifact of artifacts) {
    if (!isPlainObject(artifact)) {
      continue;
    }

    for (const hook of ['build', 'validate'] as const) {
      if (artifact[hook] !== undefined) {
        throw new Error(
          `artifact recipe hook "${hook}" is a function and cannot be expressed in a JSON config (${configPath}); use a JavaScript config file (.mjs/.cjs) with an artifacts array instead`,
        );
      }
    }

    const overlay = artifact.manifestOverlay;

    if (overlay !== undefined && !isPlainObject(overlay)) {
      throw new Error(
        `artifact recipe "manifestOverlay" must be a plain object in a JSON config (${configPath}); use a JavaScript config file (.mjs/.cjs) to supply an overlay callback`,
      );
    }
  }
}

function sourceVersionNeedsPrompt(merged: PublishPackageOptions): boolean {
  const cwd = merged.cwd ?? process.cwd();
  const packageJsonPath = resolve(cwd, merged.packageJsonPath ?? 'package.json');
  const versionPlaceholder = merged.versionPlaceholder ?? DEFAULT_VERSION_PLACEHOLDER;

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
    const pkgVersion = pkg.version;

    return typeof pkgVersion !== 'string' || pkgVersion.length === 0 || pkgVersion === versionPlaceholder;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const result = parseFlags(process.argv.slice(2), SPECS);

  if (!result) {
    printHelp();
    return;
  }

  const interactive = result.values.interactive === 'true';
  const merged = await resolveCliOptions<PublishPackageOptions>({
    result,
    buildOptions,
  });

  assertVersionSelection(merged);

  if (result.values.config) {
    assertJsonConfigRecipesDeclarative(merged, result.values.config);
  }

  if (interactive && !merged.version && sourceVersionNeedsPrompt(merged)) {
    merged.version = await promptForRequiredValue({
      message: 'Target version:',
      value: merged.version,
      interactive,
      canPromptNow: canPrompt(),
      missingMessage: 'version is required. Pass --version <version> or set version in the config file.',
      validate: (v) => (v.length === 0 ? 'Version is required' : undefined),
    });
  }

  await publishPackage(merged);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
