import { parseFlags, type FlagSpec } from '@repo-toolkit/publish-package';
import { verifyGoRelease, verifyGoReleaseReproducibility } from './index';
import { mergeArchiveLimits, planSummary, printSummary, resolveGoReleaseCliOptions } from './cli-options';

const SPECS: FlagSpec[] = [
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
  console.log(`repo-toolkit-verify-go-release

Usage:
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

async function main(): Promise<void> {
  const result = parseFlags(process.argv.slice(2), SPECS);
  if (!result) {
    printHelp();
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
