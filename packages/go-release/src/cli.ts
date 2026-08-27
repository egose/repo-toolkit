import { parseFlags, type FlagSpec } from '@repo-toolkit/publish-package';
import { buildGoRelease, createGoReleaseArchives, verifyGoRelease, verifyGoReleaseReproducibility } from './index';
import { mergeArchiveLimits, planSummary, printSummary, resolveGoReleaseCliOptions } from './cli-options';

const BUILD_SPECS: FlagSpec[] = [
  { name: 'config' },
  { name: 'cwd' },
  { name: 'tool-name' },
  { name: 'version' },
  { name: 'output-dir' },
  { name: 'go-executable' },
  { name: 'tar-executable' },
  { name: 'target', list: true },
  { name: 'concurrency' },
  { name: 'dry-run', boolean: true },
];

const VERIFY_SPECS: FlagSpec[] = [
  { name: 'config' },
  { name: 'cwd' },
  { name: 'tool-name' },
  { name: 'version' },
  { name: 'output-dir' },
  { name: 'go-executable' },
  { name: 'tar-executable' },
  { name: 'concurrency' },
  { name: 'max-member-count' },
  { name: 'max-path-length' },
  { name: 'max-expanded-bytes' },
  { name: 'reproducibility', boolean: true },
  { name: 'dry-run', boolean: true },
];

function printHelp(): void {
  console.log(`repo-toolkit-go-release

Usage:
  repo-toolkit-go-release build --config <path> [options]
  repo-toolkit-go-release verify --config <path> [options]

Commands:
  build   Build, archive, and checksum Go release artifacts
  verify  Verify existing release archives and checksums

Options:
  -h, --help  Show this help message or command-specific help

Run 'repo-toolkit-go-release <command> --help' for command-specific options.
`);
}

function printBuildHelp(): void {
  console.log(`repo-toolkit-go-release build

Usage:
  repo-toolkit-go-release build --config <path> [options]
  repo-toolkit-build-go-release --config <path> [options]

Options:
  --config <path>          Config file (JSON, .mjs, or .cjs default export)
  --cwd <path>             Project root; overrides config cwd
  --tool-name <name>       Release tool name; overrides config toolName
  --version <version>      Release version; overrides config version
  --output-dir <path>      Managed output directory; overrides config outputDir
  --go-executable <path>   Go executable; overrides config goExecutable
  --tar-executable <path>  Tar executable; overrides config tarExecutable
  --target <os-arch>[,...] Build only named configured targets (repeatable)
  --concurrency <count>    Maximum concurrent target builds
  --dry-run                Resolve and print the plan without writing or running tools
  -h, --help               Show this help message
`);
}

function printVerifyHelp(): void {
  console.log(`repo-toolkit-go-release verify

Usage:
  repo-toolkit-go-release verify --config <path> [options]
  repo-toolkit-verify-go-release --config <path> [options]

Options:
  --config <path>              Config file (JSON, .mjs, or .cjs default export)
  --cwd <path>                 Project root; overrides config cwd
  --tool-name <name>           Release tool name; overrides config toolName
  --version <version>          Release version; overrides config version
  --output-dir <path>          Existing output directory; overrides config outputDir
  --go-executable <path>       Go executable used for reproducibility checks
  --tar-executable <path>      Tar executable; overrides config tarExecutable
  --concurrency <count>        Maximum concurrent reproducibility builds
  --max-member-count <count>   Maximum members allowed in each archive
  --max-path-length <bytes>    Maximum archive member path length
  --max-expanded-bytes <bytes> Maximum expanded bytes allowed per archive
  --reproducibility            Also perform two independent rebuilds and compare archives
  --dry-run                    Resolve and print the plan without writing or running tools
  -h, --help                   Show this help message
`);
}

async function runBuild(args: ReadonlyArray<string>): Promise<void> {
  const result = parseFlags([...args], BUILD_SPECS);
  if (!result) {
    printBuildHelp();
    return;
  }

  const { options, plan } = await resolveGoReleaseCliOptions(result, result.repeat.target);
  if (result.values['dry-run'] === 'true') {
    printSummary(planSummary('build', plan, true));
    return;
  }

  const build = await buildGoRelease(options);
  const archives = await createGoReleaseArchives(options);
  printSummary({
    operation: 'build',
    dryRun: false,
    toolName: plan.toolName,
    version: plan.version,
    outputDir: plan.outputDir,
    targets: plan.targets.map((target) => target.name),
    binaries: build.outputs.map((output) => ({ target: output.target, name: output.outputName, size: output.size })),
    archives: archives.artifacts.map((artifact) => ({
      target: artifact.target,
      name: plan.targets.find((target) => target.name === artifact.target)?.archiveName,
      size: artifact.size,
      checksum: artifact.checksum,
    })),
    checksumFile: plan.checksumFile,
  });
}

async function runVerify(args: ReadonlyArray<string>): Promise<void> {
  const result = parseFlags([...args], VERIFY_SPECS);
  if (!result) {
    printVerifyHelp();
    return;
  }

  const resolved = await resolveGoReleaseCliOptions(result, undefined, true);
  const { options, plan } = resolved;
  const archiveLimits = mergeArchiveLimits(resolved.archiveLimits, result);
  if (result.values['dry-run'] === 'true') {
    printSummary({
      ...planSummary('verify', plan, true),
      reproducibility: result.values.reproducibility === 'true',
      archiveLimits,
    });
    return;
  }

  const verified = await verifyGoRelease({
    ...options,
    ...(Object.keys(archiveLimits).length === 0 ? {} : { archiveLimits }),
  });
  const reproducibility =
    result.values.reproducibility === 'true' ? await verifyGoReleaseReproducibility(options) : undefined;
  printSummary({
    operation: 'verify',
    dryRun: false,
    toolName: plan.toolName,
    version: plan.version,
    outputDir: plan.outputDir,
    artifacts: verified.artifacts.map((artifact) => ({
      target: artifact.target,
      name: plan.targets.find((target) => target.name === artifact.target)?.archiveName,
      size: artifact.size,
      checksum: artifact.checksum,
      versionChecks: artifact.versionChecks,
    })),
    checksumFile: plan.checksumFile,
    reproducibility: reproducibility
      ? { verified: reproducibility.reproducible, targets: reproducibility.targets }
      : { verified: false, skipped: true },
  });
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
  if (command.startsWith('-')) {
    throw new Error(`Unknown command: ${command}. Expected 'build' or 'verify'. Run with --help for usage.`);
  }
  throw new Error(`Unknown command: ${command}. Expected 'build' or 'verify'. Run with --help for usage.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
