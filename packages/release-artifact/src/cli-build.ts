import {
  parseFlags,
  type FlagSpec,
  INTERACTIVE_FLAG,
  promptForRequiredValue,
  resolveCliOptions,
} from '@repo-toolkit/publish-package';
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
  { name: 'node-modules' },
  { name: 'skip-node-modules', boolean: true },
  { name: 'production-node-modules', boolean: true, negatable: true },
  { name: 'node-command' },
  { name: 'exclude', list: true },
  { name: 'run-timeout-ms' },
  INTERACTIVE_FLAG,
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
  --version-files <f>[,<f>]      Root file(s) copied into artifact root, preserving subpath (default: VERSION). Missing files fail.
  --root-files <f>[,<f>]         Additional root files copied into artifact root, preserving subpath. Missing files fail.
  --packages-dir <path>          Directory under workspace root holding packages (default: packages)
  --dist-dir <path>              Directory under workspace root where tarball is written (default: dist)
  --node-modules <mode>          Resolved node-modules mode: 'production' (default), 'copy', or 'none'
  --skip-node-modules            Compatibility alias for --node-modules none
  --production-node-modules      Compatibility alias for --node-modules production (default: on)
  --no-production-node-modules   Compatibility alias for --node-modules copy (or 'none' if --skip-node-modules)
  --node-command <name>          Node interpreter used in bash wrappers (default: node)
  --exclude <glob>[,<glob>]      Glob patterns excluded from each copied package (replaces defaults)
  --run-timeout-ms <ms>          Per-process timeout for external commands (default: 60000)
  -i, --interactive              Prompt for missing required values interactively
  -h, --help                     Show this help message
`);
}

function buildOptions(result: ReturnType<typeof parseFlags>): Partial<BuildArtifactOptions> {
  if (!result) {
    return {};
  }

  const { values, repeat } = result;
  const options: Partial<BuildArtifactOptions> = {};

  if (values.cwd) options.cwd = values.cwd;
  if (values.version) options.version = values.version;
  if (values['tool-name']) options.toolName = values['tool-name'];
  if (values['packages-dir']) options.packagesDir = values['packages-dir'];
  if (values['dist-dir']) options.distDir = values['dist-dir'];
  if (values['node-command']) options.nodeCommand = values['node-command'];
  if (values['node-modules']) options.nodeModulesMode = values['node-modules'] as 'production' | 'copy' | 'none';
  if (values['skip-node-modules'] !== undefined) options.includeNodeModules = false;
  if (values['production-node-modules'] === 'true') options.productionNodeModules = true;
  if (values['production-node-modules'] === 'false') options.productionNodeModules = false;
  if (values['run-timeout-ms']) {
    const parsed = Number(values['run-timeout-ms']);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`--run-timeout-ms must be a positive finite number: ${values['run-timeout-ms']}`);
    }
    options.runTimeoutMs = parsed;
  }

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

  const interactive = result.values.interactive === 'true';
  const merged = await resolveCliOptions<BuildArtifactOptions>({
    result,
    buildOptions,
  });

  merged.version = await promptForRequiredValue({
    value: merged.version,
    interactive,
    message: 'Target version:',
    missingMessage: 'version is required. Pass --version <version> or set version in the config file.',
    validate: (v) => (v.length === 0 ? 'Version is required' : undefined),
  });

  const plan = buildReleaseArtifact(merged);
  console.log(`release artifact: ${plan.artifactPath}`);
  console.log(`commands: ${plan.commands.map((command) => command.name).join(', ')}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
