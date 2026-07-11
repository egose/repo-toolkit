import { loadConfigFile, parseFlags, type FlagSpec } from '@repo-toolkit/publish-package';
import { buildReleaseArtifact, type BuildArtifactOptions } from './index';

const SPECS: FlagSpec[] = [
  { name: 'config' },
  { name: 'cwd' },
  { name: 'version', aliases: ['tag'] },
  { name: 'tool-name' },
  { name: 'version-files', list: true },
  { name: 'root-files', list: true },
  { name: 'packages-dir' },
  { name: 'dist-dir' },
  { name: 'skip-node-modules', boolean: true },
  { name: 'production-node-modules', boolean: true, negatable: true },
  { name: 'node-command' },
  { name: 'exclude', list: true },
];

function printHelp(): void {
  console.log(`repo-toolkit-build-artifact

Usage:
  repo-toolkit-build-artifact --version <version> [options]

Options:
  --config <path>                Config file (JSON, .mjs, or .cjs default export)
  --cwd <path>                   Workspace root directory (default: process.cwd())
  --version <version>            Target version (required). A leading "v" is stripped.
  --tag <version>                Alias for --version
  --tool-name <name>             Tool name used in artifact filenames (default: repo-toolkit)
  --version-files <f>[,<f>]      Root file(s) copied into artifact root (default: VERSION)
  --root-files <f>[,<f>]         Additional root files copied into artifact root
  --packages-dir <path>          Directory under workspace root holding packages (default: packages)
  --dist-dir <path>              Directory under workspace root where tarball is written (default: dist)
  --skip-node-modules            Do not include node_modules in the artifact
  --production-node-modules      Install only production deps via 'pnpm install --prod' (default: on; requires pnpm)
  --no-production-node-modules   Copy the workspace node_modules verbatim (not portable across machines)
  --node-command <name>          Node interpreter used in bash wrappers (default: node)
  --exclude <glob>[,<glob>]      Glob patterns excluded from each copied package (replaces defaults)
  -h, --help                     Show this help message
`);
}

function buildOptions(values: Record<string, string>, repeat: Record<string, string[]>): Partial<BuildArtifactOptions> {
  const options: Partial<BuildArtifactOptions> = {};

  if (values.cwd) options.cwd = values.cwd;
  if (values.version) options.version = values.version;
  if (values['tool-name']) options.toolName = values['tool-name'];
  if (values['packages-dir']) options.packagesDir = values['packages-dir'];
  if (values['dist-dir']) options.distDir = values['dist-dir'];
  if (values['node-command']) options.nodeCommand = values['node-command'];
  if (values['skip-node-modules'] !== undefined) options.includeNodeModules = false;
  if (values['production-node-modules'] === 'true') options.productionNodeModules = true;
  if (values['production-node-modules'] === 'false') options.productionNodeModules = false;

  if (repeat['version-files']) options.versionFiles = repeat['version-files'];
  if (repeat['root-files']) options.rootFiles = repeat['root-files'];
  if (repeat.exclude) options.excludes = repeat.exclude;

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

  const config = configPath ? await loadConfigFile<BuildArtifactOptions>(configPath, options.cwd) : {};

  const merged = { ...config, ...options } as BuildArtifactOptions;

  if (!merged.version) {
    throw new Error('version is required. Pass --version <version> or set version in the config file.');
  }

  const plan = buildReleaseArtifact(merged);
  console.log(`release artifact: ${plan.artifactPath}`);
  console.log(`commands: ${plan.commands.map((command) => command.name).join(', ')}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
