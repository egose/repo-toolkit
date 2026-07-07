import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateChangelog, type GenerateChangelogOptions } from './index';

interface ParsedArgs {
  configPath?: string;
  options: GenerateChangelogOptions;
}

function printHelp() {
  console.log(`repo-toolkit-changelog

Usage:
  repo-toolkit-changelog [options]

Options:
  --config <path>               Config file with changelog options such as custom types
  --cwd <path>                  Working directory to read package and git metadata from
  --output <path>               Output file path (default: CHANGELOG.md)
  --tag-prefix <prefix>         Tag prefix to match (default: v)
  --release-count <number>      Number of releases to include (default: 0)
  --append                      Append to the output instead of prepending
  --first-release               Include all commits when no prior release tag exists
  --no-skip-unstable            Include unstable releases
  --no-output-unreleased        Omit the unreleased section
  -h, --help                    Show this help message
`);
}

function readValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];

  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

function parseNumber(value: string, flag: string) {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric value for ${flag}: ${value}`);
  }

  return parsed;
}

function resolveConfigPath(configPath: string, cwd?: string) {
  if (isAbsolute(configPath)) {
    return configPath;
  }

  return resolve(cwd ?? process.cwd(), configPath);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadConfig(configPath: string, cwd?: string): Promise<GenerateChangelogOptions> {
  const resolvedPath = resolveConfigPath(configPath, cwd);

  if (resolvedPath.endsWith('.json')) {
    const contents = await readFile(resolvedPath, 'utf8');
    const parsed = JSON.parse(contents) as unknown;

    if (!isObject(parsed)) {
      throw new Error(`Config file must export an object: ${resolvedPath}`);
    }

    return parsed as GenerateChangelogOptions;
  }

  const loaded = (await import(pathToFileURL(resolvedPath).href)) as {
    default?: unknown;
  };
  const config = loaded.default ?? loaded;

  if (!isObject(config)) {
    throw new Error(`Config file must export an object: ${resolvedPath}`);
  }

  return config as GenerateChangelogOptions;
}

function parseArgs(argv: string[]) {
  const parsedArgs: ParsedArgs = {
    options: {},
  };

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
      parsedArgs.configPath = readValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--config=')) {
      parsedArgs.configPath = arg.slice('--config='.length);
      continue;
    }

    if (arg === '--cwd') {
      parsedArgs.options.cwd = readValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--cwd=')) {
      parsedArgs.options.cwd = arg.slice('--cwd='.length);
      continue;
    }

    if (arg === '--output') {
      parsedArgs.options.outputFile = readValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--output=')) {
      parsedArgs.options.outputFile = arg.slice('--output='.length);
      continue;
    }

    if (arg === '--tag-prefix') {
      parsedArgs.options.tagPrefix = readValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--tag-prefix=')) {
      parsedArgs.options.tagPrefix = arg.slice('--tag-prefix='.length);
      continue;
    }

    if (arg === '--release-count') {
      parsedArgs.options.releaseCount = parseNumber(readValue(argv, index, arg), arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--release-count=')) {
      parsedArgs.options.releaseCount = parseNumber(arg.slice('--release-count='.length), '--release-count');
      continue;
    }

    if (arg === '--append') {
      parsedArgs.options.append = true;
      continue;
    }

    if (arg === '--no-append') {
      parsedArgs.options.append = false;
      continue;
    }

    if (arg === '--first-release') {
      parsedArgs.options.firstRelease = true;
      continue;
    }

    if (arg === '--no-first-release') {
      parsedArgs.options.firstRelease = false;
      continue;
    }

    if (arg === '--skip-unstable') {
      parsedArgs.options.skipUnstable = true;
      continue;
    }

    if (arg === '--no-skip-unstable') {
      parsedArgs.options.skipUnstable = false;
      continue;
    }

    if (arg === '--output-unreleased') {
      parsedArgs.options.outputUnreleased = true;
      continue;
    }

    if (arg === '--no-output-unreleased') {
      parsedArgs.options.outputUnreleased = false;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsedArgs;
}

async function main() {
  const parsedArgs = parseArgs(process.argv.slice(2));

  if (!parsedArgs) {
    return;
  }

  const config = parsedArgs.configPath ? await loadConfig(parsedArgs.configPath, parsedArgs.options.cwd) : {};
  const options = {
    ...config,
    ...parsedArgs.options,
  };

  const outputPath = await generateChangelog(options);
  console.log(`Changelog generated at ${outputPath}.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
