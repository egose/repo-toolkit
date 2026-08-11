import {
  parseFlags,
  type FlagSpec,
  INTERACTIVE_FLAG,
  promptForRequiredValue,
  resolveCliOptions,
} from '@repo-toolkit/publish-package';
import { installReleaseArtifact, type InstallArtifactOptions } from './index';

const SPECS: FlagSpec[] = [
  { name: 'config' },
  { name: 'archive-path' },
  { name: 'install-path' },
  { name: 'version', aliases: ['tag'] },
  { name: 'tool-name' },
  { name: 'help-flag' },
  { name: 'skip-exec', boolean: true },
  { name: 'force', boolean: true },
  { name: 'run-timeout-ms' },
  INTERACTIVE_FLAG,
];

function printHelp(): void {
  console.log(`repo-toolkit-install-artifact

Usage:
  repo-toolkit-install-artifact --archive-path <tarball> --install-path <dir> --version <version> [options]

Options:
  --config <path>                Config file (JSON, .mjs, or .cjs default export)
  --archive-path <path>          Release artifact tarball to install (required unless read from a config file)
  --install-path <path>          Final install destination directory (required)
  --version <version>            Target version (required). A leading "v" is stripped.
  --tag <version>                Alias for --version
  --tool-name <name>             Tool name (default: repo-toolkit)
  --help-flag <flag>             Flag passed to each wrapper to confirm it boots (default: --help)
  --skip-exec                    Skip executing wrappers; only check manifest, files, x_OK, and 'bash -n'
  --force                        Replace an existing non-empty install path
  --run-timeout-ms <ms>          Per-process timeout for external commands (default: 60000)
  -i, --interactive              Prompt for missing required values interactively
  -h, --help                     Show this help message
`);
}

function buildOptions(values: Record<string, string>): Partial<InstallArtifactOptions> {
  const options: Partial<InstallArtifactOptions> = {};

  if (values['archive-path']) options.archivePath = values['archive-path'];
  if (values['install-path']) options.installPath = values['install-path'];
  if (values.version) options.version = values.version;
  if (values['tool-name']) options.toolName = values['tool-name'];
  if (values['help-flag']) options.helpFlag = values['help-flag'];
  if (values['skip-exec'] !== undefined) options.skipExec = true;
  if (values.force !== undefined) options.force = true;
  if (values['run-timeout-ms']) {
    const parsed = Number(values['run-timeout-ms']);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`--run-timeout-ms must be a positive finite number: ${values['run-timeout-ms']}`);
    }
    options.runTimeoutMs = parsed;
  }

  return options;
}

async function main(): Promise<void> {
  const result = parseFlags(process.argv.slice(2), SPECS);

  if (!result) {
    printHelp();
    return;
  }

  const interactive = result.values.interactive === 'true';
  const merged = await resolveCliOptions<InstallArtifactOptions>({
    result,
    buildOptions: (flags) => buildOptions(flags.values),
  });

  merged.archivePath = await promptForRequiredValue({
    value: merged.archivePath,
    interactive,
    message: 'Archive tarball path:',
    missingMessage: 'archive-path is required. Pass --archive-path <path> or set archivePath in the config file.',
    validate: (v) => (v.length === 0 ? 'Path is required' : undefined),
  });

  merged.installPath = await promptForRequiredValue({
    value: merged.installPath,
    interactive,
    message: 'Install destination directory:',
    missingMessage: 'install-path is required. Pass --install-path <dir> or set installPath in the config file.',
    validate: (v) => (v.length === 0 ? 'Install path is required' : undefined),
  });

  merged.version = await promptForRequiredValue({
    value: merged.version,
    interactive,
    message: 'Target version:',
    missingMessage: 'version is required. Pass --version <version> or set version in the config file.',
    validate: (v) => (v.length === 0 ? 'Version is required' : undefined),
  });

  const { installPath, manifest } = installReleaseArtifact(merged);
  console.log(`installed ${manifest.toolName} v${manifest.version} to ${installPath}.`);
  console.log(`commands: ${manifest.commands.map((command) => command.name).join(', ')}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
