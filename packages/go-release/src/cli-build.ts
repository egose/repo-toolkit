import { parseFlags, type FlagSpec } from '@repo-toolkit/publish-package';
import { createGoReleaseArchives, buildGoRelease } from './index';
import { planSummary, printSummary, resolveGoReleaseCliOptions } from './cli-options';

const SPECS: FlagSpec[] = [
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

function printHelp(): void {
  console.log(`repo-toolkit-build-go-release

Usage:
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

async function main(): Promise<void> {
  const result = parseFlags(process.argv.slice(2), SPECS);
  if (!result) {
    printHelp();
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
