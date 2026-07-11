import { loadConfigFile, parseFlags, type FlagSpec } from '@repo-toolkit/publish-package';
import { publishPackages, type PublishPackagesOptions } from './index';

const SPECS: FlagSpec[] = [
  { name: 'config' },
  { name: 'cwd' },
  { name: 'version', aliases: ['tag'] },
  { name: 'npm-tag' },
  { name: 'filter', list: true },
  { name: 'from' },
  { name: 'package-files', list: true },
  { name: 'include-package-file', repeatable: true },
  { name: 'no-default-package-files', boolean: true },
  { name: 'root-files', list: true },
  { name: 'include-root-file', repeatable: true },
  { name: 'no-default-root-files', boolean: true },
  { name: 'publish-dir' },
  { name: 'version-placeholder' },
  { name: 'build-command' },
  { name: 'skip-build', boolean: true },
  { name: 'access' },
  { name: 'registry' },
  { name: 'otp' },
  { name: 'provenance', boolean: true },
  { name: 'dry-run', boolean: true },
];

function printHelp(): void {
  console.log(`repo-toolkit-publish-packages

Usage:
  repo-toolkit-publish-packages --version <version> [options]

Options:
  --config <path>                Config file (JSON, .mjs, or .cjs default export)
  --cwd <path>                   Workspace root directory (default: process.cwd())
  --version <version>            Target version (required). A leading "v" is stripped.
  --tag <version>                Alias for --version
  --npm-tag <dist-tag>           npm dist-tag (defaults to prerelease preid)
  --filter <name>[,<name>]       Only publish matching packages (applied before --from)
  --from <name>                  Start publishing from first matching package
  --package-files <f>[,<f>]      Files copied from each package root (replaces defaults)
  --include-package-file <path>  Additional file copied from each package root (repeatable)
  --no-default-package-files     Skip copying default package files
  --root-files <f>[,<f>]         Files copied from workspace root (replaces defaults)
  --include-root-file <path>     Additional file copied from workspace root (repeatable)
  --no-default-root-files        Skip copying default root files
  --publish-dir <path>           Publish directory inside each package (default: dist)
  --version-placeholder <text>   Placeholder rewritten to target version (default: 0.0.0-PLACEHOLDER)
  --build-command <command>      Command used to build each publish dir (default: pnpm build)
  --skip-build                   Skip the build step
  --access <level>               npm publish access level (default: public)
  --registry <url>               npm registry URL
  --otp <code>                   npm OTP code
  --provenance                   Request npm provenance attestation
  --dry-run                      Forward --dry-run to npm publish
  -h, --help                     Show this help message
`);
}

function buildOptions(
  values: Record<string, string>,
  repeat: Record<string, string[]>,
): Partial<PublishPackagesOptions> {
  const options: Partial<PublishPackagesOptions> = {};

  if (values.cwd) options.cwd = values.cwd;
  if (values.version) options.version = values.version;
  if (values['npm-tag']) options.npmTag = values['npm-tag'];
  if (values.from) options.from = values.from;
  if (values['publish-dir']) options.publishDir = values['publish-dir'];
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

  if (repeat.filter) options.filters = repeat.filter;
  if (repeat['package-files']) options.packageFiles = repeat['package-files'];
  if (repeat['include-package-file']) options.includePackageFiles = repeat['include-package-file'];
  if (repeat['root-files']) options.rootFiles = repeat['root-files'];
  if (repeat['include-root-file']) options.includeRootFiles = repeat['include-root-file'];

  return options;
}

async function main(): Promise<void> {
  const result = parseFlags(process.argv.slice(2), SPECS);

  if (!result) {
    printHelp();
    return;
  }

  const configPath = result.values.config;
  const options = buildOptions(result.values, result.repeat);

  const config = configPath ? await loadConfigFile<PublishPackagesOptions>(configPath, options.cwd) : {};

  const merged = { ...config, ...options } as PublishPackagesOptions;

  if (!merged.version) {
    throw new Error('version is required. Pass --version <version> or set version in the config file.');
  }

  publishPackages(merged);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
