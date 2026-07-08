import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isPlainObject, publishPackages, type PublishPackagesOptions } from './index';

interface ParsedArgs {
  configPath?: string;
  options: Partial<PublishPackagesOptions>;
}

function printHelp(): void {
  console.log(`repo-toolkit-publish-packages

Usage:
  repo-toolkit-publish-packages --version <version> [options]

Options:
  --config <path>               Config file with publish options (JSON, .mjs, or .cjs default export)
  --cwd <path>                  Workspace root directory (default: process.cwd())
  --version <version>           Target version (required). A leading "v" is stripped.
  --tag <version>               Alias for --version (for compatibility)
  --npm-tag <dist-tag>          npm dist-tag (defaults to the prerelease preid)
  --filter <name>[,<name>]      Only publish matching packages (by name or directory)
  --from <name>                 Start publishing from the first matching package (applied after --filter)
  --package-files <file>[,<file>]  Files copied from each package root into the publish dir
  --root-files <file>[,<file>]  Files copied from the workspace root into each publish dir
  --publish-dir <path>          Publish directory inside each package (default: dist)
  --version-placeholder <text>  Placeholder rewritten to the target version (default: 0.0.0-PLACEHOLDER)
  --build-command <command>     Command used to build each publish dir (default: pnpm build)
  --skip-build                  Skip the build step
  --access <level>              npm publish access level (default: public)
  --registry <url>              npm registry URL
  --otp <code>                  npm OTP code
  --provenance                  Request npm provenance attestation
  --dry-run                     Forward --dry-run to npm publish
  -h, --help                    Show this help message
`);
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];

  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

function splitListArg(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function resolveConfigPath(configPath: string, cwd?: string): string {
  if (isAbsolute(configPath)) {
    return configPath;
  }

  return resolve(cwd ?? process.cwd(), configPath);
}

async function loadConfig(configPath: string, cwd?: string): Promise<Partial<PublishPackagesOptions>> {
  const resolvedPath = resolveConfigPath(configPath, cwd);

  if (resolvedPath.endsWith('.json')) {
    const contents = await readFile(resolvedPath, 'utf8');
    const parsed = JSON.parse(contents) as unknown;

    if (!isPlainObject(parsed)) {
      throw new Error(`Config file must export an object: ${resolvedPath}`);
    }

    return parsed as Partial<PublishPackagesOptions>;
  }

  const loaded = (await import(pathToFileURL(resolvedPath).href)) as {
    default?: unknown;
  };
  const config = loaded.default ?? loaded;

  if (!isPlainObject(config)) {
    throw new Error(`Config file must export an object: ${resolvedPath}`);
  }

  return config as Partial<PublishPackagesOptions>;
}

function parseArgs(argv: string[]): ParsedArgs | null {
  const options: Partial<PublishPackagesOptions> = {};
  let configPath: string | undefined;
  const filters: string[] = [];
  const packageFiles: string[] = [];
  const rootFiles: string[] = [];

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

    if (arg === '--filter') {
      filters.push(...splitListArg(readValue(argv, index, arg)));
      index += 1;
      continue;
    }

    if (arg.startsWith('--filter=')) {
      filters.push(...splitListArg(arg.slice('--filter='.length)));
      continue;
    }

    if (arg === '--from') {
      options.from = readValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--from=')) {
      options.from = arg.slice('--from='.length);
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

    if (arg === '--root-files') {
      rootFiles.push(...splitListArg(readValue(argv, index, arg)));
      index += 1;
      continue;
    }

    if (arg.startsWith('--root-files=')) {
      rootFiles.push(...splitListArg(arg.slice('--root-files='.length)));
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

  if (filters.length > 0) {
    options.filters = filters;
  }

  if (packageFiles.length > 0) {
    options.packageFiles = packageFiles;
  }

  if (rootFiles.length > 0) {
    options.rootFiles = rootFiles;
  }

  return { configPath, options };
}

async function main(): Promise<void> {
  const parsedArgs = parseArgs(process.argv.slice(2));

  if (!parsedArgs) {
    return;
  }

  const config = parsedArgs.configPath ? await loadConfig(parsedArgs.configPath, parsedArgs.options.cwd) : {};
  const options = {
    ...config,
    ...parsedArgs.options,
  } as PublishPackagesOptions;

  if (!options.version) {
    throw new Error('version is required. Pass --version <version> or set version in the config file.');
  }

  publishPackages(options);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
