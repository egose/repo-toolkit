import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isPlainObject, publishAll, type PublishAllOptions } from './index';

interface ParsedArgs {
  configPath?: string;
  /**
   * Only keys explicitly supplied on the command line are present here; absent
   * keys fall through to the config file. This is what makes the
   * `{ ...config, ...options }` merge in `main()` give "CLI overrides config"
   * semantics without per-key footguns.
   */
  options: Partial<PublishAllOptions>;
}

function printHelp(): void {
  console.log(`repo-toolkit-publish-all

Usage:
  repo-toolkit-publish-all --tag <version> [options]

Options:
  --config <path>               Config file with publish options (JSON, .mjs, or .cjs default export)
  --cwd <path>                  Monorepo root directory (default: process.cwd())
  --tag <version>               Target version (required). A leading "v" is stripped.
  --npm-tag <dist-tag>          npm dist-tag (defaults to the prerelease preid)
  --filter <name>[,<name>]      Only publish matching packages (by name or directory)
  --from <name>                 Start publishing from the first matching package (applied after --filter)
  --root-files <file>[,<file>]  Files to copy from root into each publish dir (default: LICENSE)
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

async function loadConfig(configPath: string, cwd?: string): Promise<Partial<PublishAllOptions>> {
  const resolvedPath = resolveConfigPath(configPath, cwd);

  if (resolvedPath.endsWith('.json')) {
    const contents = await readFile(resolvedPath, 'utf8');
    const parsed = JSON.parse(contents) as unknown;

    if (!isPlainObject(parsed)) {
      throw new Error(`Config file must export an object: ${resolvedPath}`);
    }

    return parsed as Partial<PublishAllOptions>;
  }

  // `.mjs` default exports land on `loaded.default`; `.cjs` `module.exports`
  // is exposed as `loaded.default` via Node's cjs-interop shim.
  const loaded = (await import(pathToFileURL(resolvedPath).href)) as {
    default?: unknown;
  };
  const config = loaded.default ?? loaded;

  if (!isPlainObject(config)) {
    throw new Error(`Config file must export an object: ${resolvedPath}`);
  }

  return config as Partial<PublishAllOptions>;
}

function parseArgs(argv: string[]): ParsedArgs | null {
  const options: Partial<PublishAllOptions> = {};
  let configPath: string | undefined;

  // Local accumulators so `options.filters`/`options.rootFiles` are only set
  // when the CLI actually produced values, preserving config-fallback semantics.
  const filters: string[] = [];
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

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--tag') {
      options.tag = readValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--tag=')) {
      options.tag = arg.slice('--tag='.length);
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

    if (arg === '--npm-tag') {
      options.npmTag = readValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith('--npm-tag=')) {
      options.npmTag = arg.slice('--npm-tag='.length);
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

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (filters.length > 0) {
    options.filters = filters;
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
  } as PublishAllOptions;

  if (!options.tag) {
    throw new Error('`tag` is required. Pass --tag <version> or set `tag` in the config file.');
  }

  publishAll(options);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
