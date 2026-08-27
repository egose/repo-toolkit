import {
  parseFlags,
  type FlagSpec,
  INTERACTIVE_FLAG,
  promptForRequiredValue,
  resolveCliOptions,
} from '@repo-toolkit/publish-package';
import { buildReleaseArtifact, type BuildArtifactOptions } from './index';
import { verifyReleaseArtifact, type VerifyArtifactOptions } from './index';
import { installReleaseArtifact, type InstallArtifactOptions } from './index';

const BUILD_SPECS: FlagSpec[] = [
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

const VERIFY_SPECS: FlagSpec[] = [
  { name: 'config' },
  { name: 'cwd' },
  { name: 'version', aliases: ['tag'] },
  { name: 'tool-name' },
  { name: 'dist-dir' },
  { name: 'artifact-path' },
  { name: 'help-flag' },
  { name: 'skip-exec', boolean: true },
  { name: 'run-timeout-ms' },
  { name: 'max-archive-member-count' },
  INTERACTIVE_FLAG,
];

const INSTALL_SPECS: FlagSpec[] = [
  { name: 'config' },
  { name: 'archive-path' },
  { name: 'install-path' },
  { name: 'version', aliases: ['tag'] },
  { name: 'tool-name' },
  { name: 'help-flag' },
  { name: 'skip-exec', boolean: true },
  { name: 'force', boolean: true },
  { name: 'run-timeout-ms' },
  { name: 'max-archive-member-count' },
  INTERACTIVE_FLAG,
];

function printHelp(): void {
  console.log(`repo-toolkit-release-artifact

Usage:
  repo-toolkit-release-artifact build --version <version> [options]
  repo-toolkit-release-artifact verify --version <version> [options]
  repo-toolkit-release-artifact install --archive-path <tarball> --install-path <dir> --version <version> [options]

Commands:
  build    Assemble the release artifact tarball
  verify   Verify the release artifact tarball
  install  Install the release artifact tarball

Options:
  -h, --help  Show this help message or command-specific help

Run 'repo-toolkit-release-artifact <command> --help' for command-specific options.
`);
}

function printBuildHelp(): void {
  console.log(`repo-toolkit-release-artifact build

Usage:
  repo-toolkit-release-artifact build --version <version> [options]
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

function printVerifyHelp(): void {
  console.log(`repo-toolkit-release-artifact verify

Usage:
  repo-toolkit-release-artifact verify --version <version> [options]
  repo-toolkit-verify-artifact --version <version> [options]

Options:
  --config <path>                Config file (JSON, .mjs, or .cjs default export)
  --cwd <path>                   Workspace root directory (default: process.cwd())
  --version <version>            Target version used to locate the tarball (required). A leading "v" is stripped.
  --tag <version>                Alias for --version
  --tool-name <name>             Tool name used to locate the tarball (default: repo-toolkit)
  --dist-dir <path>              Directory under workspace root holding the tarball (default: dist)
  --artifact-path <path>         Explicit tarball path; overrides cwd/tool-name/dist-dir resolution
  --help-flag <flag>             Flag passed to each wrapper to confirm it boots (default: --help)
  --skip-exec                    Skip executing wrappers; only check manifest, files, and 'bash -n'
  --run-timeout-ms <ms>          Per-process timeout for external commands (default: 60000)
  --max-archive-member-count <n> Maximum number of archive members before validation rejects the artifact (default: 20000)
  -i, --interactive              Prompt for missing required values interactively
  -h, --help                     Show this help message
`);
}

function printInstallHelp(): void {
  console.log(`repo-toolkit-release-artifact install

Usage:
  repo-toolkit-release-artifact install --archive-path <tarball> --install-path <dir> --version <version> [options]
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
  --max-archive-member-count <n> Maximum number of archive members before validation rejects the artifact (default: 20000)
  -i, --interactive              Prompt for missing required values interactively
  -h, --help                     Show this help message
`);
}

function buildBuildOptions(result: ReturnType<typeof parseFlags>): Partial<BuildArtifactOptions> {
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

function buildVerifyOptions(values: Record<string, string>): Partial<VerifyArtifactOptions> {
  const options: Partial<VerifyArtifactOptions> = {};

  if (values.cwd) options.cwd = values.cwd;
  if (values.version) options.version = values.version;
  if (values['tool-name']) options.toolName = values['tool-name'];
  if (values['dist-dir']) options.distDir = values['dist-dir'];
  if (values['artifact-path']) options.artifactPath = values['artifact-path'];
  if (values['help-flag']) options.helpFlag = values['help-flag'];
  if (values['skip-exec'] !== undefined) options.skipExec = true;
  if (values['run-timeout-ms']) {
    const parsed = Number(values['run-timeout-ms']);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`--run-timeout-ms must be a positive finite number: ${values['run-timeout-ms']}`);
    }
    options.runTimeoutMs = parsed;
  }
  if (values['max-archive-member-count']) {
    const parsed = Number(values['max-archive-member-count']);
    if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
      throw new Error(
        `--max-archive-member-count must be a positive finite integer: ${values['max-archive-member-count']}`,
      );
    }
    options.maxArchiveMemberCount = parsed;
  }

  return options;
}

function buildInstallOptions(values: Record<string, string>): Partial<InstallArtifactOptions> {
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
  if (values['max-archive-member-count']) {
    const parsed = Number(values['max-archive-member-count']);
    if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
      throw new Error(
        `--max-archive-member-count must be a positive finite integer: ${values['max-archive-member-count']}`,
      );
    }
    options.maxArchiveMemberCount = parsed;
  }

  return options;
}

async function runBuild(args: ReadonlyArray<string>): Promise<void> {
  const result = parseFlags([...args], BUILD_SPECS);
  if (!result) {
    printBuildHelp();
    return;
  }

  const interactive = result.values.interactive === 'true';
  const merged = await resolveCliOptions<BuildArtifactOptions>({
    result,
    buildOptions: buildBuildOptions,
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

async function runVerify(args: ReadonlyArray<string>): Promise<void> {
  const result = parseFlags([...args], VERIFY_SPECS);
  if (!result) {
    printVerifyHelp();
    return;
  }

  const interactive = result.values.interactive === 'true';
  const merged = await resolveCliOptions<VerifyArtifactOptions>({
    result,
    buildOptions: (flags) => buildVerifyOptions(flags.values),
  });

  if (!merged.version && !merged.artifactPath) {
    merged.version = await promptForRequiredValue({
      value: merged.version,
      interactive,
      message: 'Target version:',
      missingMessage: 'version is required. Pass --version <version> or set version in the config file.',
      validate: (v) => (v.length === 0 ? 'Version is required' : undefined),
    });
  }

  verifyReleaseArtifact(merged);
  console.log('release artifact verified successfully.');
}

async function runInstall(args: ReadonlyArray<string>): Promise<void> {
  const result = parseFlags([...args], INSTALL_SPECS);
  if (!result) {
    printInstallHelp();
    return;
  }

  const interactive = result.values.interactive === 'true';
  const merged = await resolveCliOptions<InstallArtifactOptions>({
    result,
    buildOptions: (flags) => buildInstallOptions(flags.values),
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

async function main(): Promise<void> {
  let argv = process.argv.slice(2);
  if (argv[0] === '--') argv = argv.slice(1);
  if (argv.length === 0) {
    printHelp();
    return;
  }
  if (argv[0] === '-h' || argv[0] === '--help') {
    printHelp();
    return;
  }
  const command = argv[0];
  const rest = argv.slice(1);
  if (command === 'build') {
    await runBuild(rest);
    return;
  }
  if (command === 'verify') {
    await runVerify(rest);
    return;
  }
  if (command === 'install') {
    await runInstall(rest);
    return;
  }
  if (command.startsWith('-')) {
    throw new Error(
      `Unknown command: ${command}. Expected 'build', 'verify', or 'install'. Run with --help for usage.`,
    );
  }
  throw new Error(`Unknown command: ${command}. Expected 'build', 'verify', or 'install'. Run with --help for usage.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
