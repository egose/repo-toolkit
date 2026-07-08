import { loadConfigFile, publishPackage, readValue, splitListArg, type PublishPackageOptions } from './index';

interface ParsedArgs {
  configPath?: string;
  options: Partial<PublishPackageOptions>;
}

function printHelp(): void {
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
  --npm-tag <dist-tag>           npm dist-tag (defaults to prerelease preid)
  --publish-dir <path>           Publish directory inside package root (default: dist)
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
  --dry-run                      Forward --dry-run to npm publish
  -h, --help                     Show this help message
`);
}

function parseArgs(argv: string[]): ParsedArgs | null {
  const options: Partial<PublishPackageOptions> = {};
  let configPath: string | undefined;
  const packageFiles: string[] = [];
  const rootFiles: string[] = [];
  const includePackageFiles: string[] = [];
  const includeRootFiles: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      continue;
    }

    if (arg === '-h' || arg === '--help') {
      printHelp();
      return null;
    }

    if (arg === '--config') {
      configPath = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--config=')) {
      configPath = arg.slice('--config='.length);
      continue;
    }

    if (arg === '--cwd') {
      options.cwd = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--cwd=')) {
      options.cwd = arg.slice('--cwd='.length);
      continue;
    }

    if (arg === '--root-dir') {
      options.rootDir = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--root-dir=')) {
      options.rootDir = arg.slice('--root-dir='.length);
      continue;
    }

    if (arg === '--package-json') {
      options.packageJsonPath = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--package-json=')) {
      options.packageJsonPath = arg.slice('--package-json='.length);
      continue;
    }

    if (arg === '--version' || arg === '--tag') {
      options.version = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--version=')) {
      options.version = arg.slice('--version='.length);
      continue;
    }
    if (arg.startsWith('--tag=')) {
      options.version = arg.slice('--tag='.length);
      continue;
    }

    if (arg === '--npm-tag') {
      options.npmTag = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--npm-tag=')) {
      options.npmTag = arg.slice('--npm-tag='.length);
      continue;
    }

    if (arg === '--publish-dir') {
      options.publishDir = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--publish-dir=')) {
      options.publishDir = arg.slice('--publish-dir='.length);
      continue;
    }

    if (arg === '--version-placeholder') {
      options.versionPlaceholder = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--version-placeholder=')) {
      options.versionPlaceholder = arg.slice('--version-placeholder='.length);
      continue;
    }

    if (arg === '--package-files') {
      packageFiles.push(...splitListArg(readValue(argv, index, arg)));
      index += 1;
      continue;
    }
    if (arg.startsWith('--package-files=')) {
      packageFiles.push(...splitListArg(arg.slice('--package-files='.length)));
      continue;
    }

    if (arg === '--include-package-file') {
      includePackageFiles.push(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith('--include-package-file=')) {
      includePackageFiles.push(arg.slice('--include-package-file='.length));
      continue;
    }

    if (arg === '--no-default-package-files') {
      options.noDefaultPackageFiles = true;
      continue;
    }

    if (arg === '--root-files') {
      rootFiles.push(...splitListArg(readValue(argv, index, arg)));
      index += 1;
      continue;
    }
    if (arg.startsWith('--root-files=')) {
      rootFiles.push(...splitListArg(arg.slice('--root-files='.length)));
      continue;
    }

    if (arg === '--include-root-file') {
      includeRootFiles.push(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith('--include-root-file=')) {
      includeRootFiles.push(arg.slice('--include-root-file='.length));
      continue;
    }

    if (arg === '--no-default-root-files') {
      options.noDefaultRootFiles = true;
      continue;
    }

    if (arg === '--build-command') {
      options.buildCommand = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--build-command=')) {
      options.buildCommand = arg.slice('--build-command='.length);
      continue;
    }

    if (arg === '--skip-build') {
      options.skipBuild = true;
      continue;
    }

    if (arg === '--access') {
      options.access = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--access=')) {
      options.access = arg.slice('--access='.length);
      continue;
    }

    if (arg === '--registry') {
      options.registry = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--registry=')) {
      options.registry = arg.slice('--registry='.length);
      continue;
    }

    if (arg === '--otp') {
      options.otp = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--otp=')) {
      options.otp = arg.slice('--otp='.length);
      continue;
    }

    if (arg === '--provenance') {
      options.provenance = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (packageFiles.length > 0) {
    options.packageFiles = packageFiles;
  }
  if (includePackageFiles.length > 0) {
    options.includePackageFiles = includePackageFiles;
  }
  if (rootFiles.length > 0) {
    options.rootFiles = rootFiles;
  }
  if (includeRootFiles.length > 0) {
    options.includeRootFiles = includeRootFiles;
  }

  return { configPath, options };
}

async function main(): Promise<void> {
  const parsedArgs = parseArgs(process.argv.slice(2));

  if (!parsedArgs) {
    return;
  }

  const config = parsedArgs.configPath
    ? await loadConfigFile<PublishPackageOptions>(parsedArgs.configPath, parsedArgs.options.cwd)
    : {};
  const options = {
    ...config,
    ...parsedArgs.options,
  } as PublishPackageOptions;

  publishPackage(options);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
