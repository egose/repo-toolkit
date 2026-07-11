import { loadConfigFile, parseFlags, type FlagSpec } from '@repo-toolkit/publish-package';
import { generateChangelog, type GenerateChangelogOptions } from './index';

const SPECS: FlagSpec[] = [
  { name: 'config' },
  { name: 'cwd' },
  { name: 'output' },
  { name: 'tag-prefix' },
  { name: 'release-count' },
  { name: 'append', boolean: true, negatable: true },
  { name: 'first-release', boolean: true, negatable: true },
  { name: 'skip-unstable', boolean: true, negatable: true },
  { name: 'output-unreleased', boolean: true, negatable: true },
];

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

function parseNumber(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid numeric value for ${flag}: ${value}`);
  }

  return parsed;
}

function buildOptions(values: Record<string, string>): GenerateChangelogOptions {
  const options: GenerateChangelogOptions = {};

  if (values.cwd) options.cwd = values.cwd;
  if (values.output) options.outputFile = values.output;
  if (values['tag-prefix']) options.tagPrefix = values['tag-prefix'];
  if (values['release-count'] !== undefined)
    options.releaseCount = parseNumber(values['release-count'], '--release-count');
  if (values.append !== undefined) options.append = values.append === 'true';
  if (values['first-release'] !== undefined) options.firstRelease = values['first-release'] === 'true';
  if (values['skip-unstable'] !== undefined) options.skipUnstable = values['skip-unstable'] === 'true';
  if (values['output-unreleased'] !== undefined) options.outputUnreleased = values['output-unreleased'] === 'true';

  return options;
}

async function main() {
  const result = parseFlags(process.argv.slice(2), SPECS);

  if (!result) {
    printHelp();
    return;
  }

  const configPath = result.values.config;
  const options = buildOptions(result.values);

  const config = configPath ? await loadConfigFile<GenerateChangelogOptions>(configPath, options.cwd) : {};
  const merged = { ...config, ...options } as GenerateChangelogOptions;

  const outputPath = await generateChangelog(merged);
  console.log(`Changelog generated at ${outputPath}.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
