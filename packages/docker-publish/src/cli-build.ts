import { INTERACTIVE_FLAG, parseFlags, type FlagSpec } from '@repo-toolkit/publish-package';

import { buildDockerImages } from './build';
import {
  collectCliSecrets,
  planSummary,
  printSummary,
  reportCliError,
  resolveDockerPublishCliOptions,
} from './cli-options';
import { clackPrompter, confirmInteractiveProceed, resolveInteractiveDockerPublishOptions } from './interactive';

const SPECS: FlagSpec[] = [
  { name: 'config' },
  { name: 'cwd' },
  { name: 'image', list: true },
  { name: 'platform', list: true },
  { name: 'registry', list: true },
  { name: 'concurrency' },
  { name: 'docker-executable' },
  { name: 'oci-export-dir' },
  { name: 'dry-run', boolean: true },
  INTERACTIVE_FLAG,
];

function printHelp(): void {
  console.log(`repo-toolkit-build-docker-publish

Usage:
  repo-toolkit-build-docker-publish --config <path> [options]

Options:
  --config <path>           Config file (JSON, .mjs, or .cjs default export)
  --cwd <path>              Project root; overrides config cwd
  --image <name>[,...]      Build only named configured images (repeatable)
  --platform <os/arch>[,...] Build only named configured platforms (repeatable)
  --registry <host>[,...]   Build only references for named registries (repeatable)
  --concurrency <count>     Maximum concurrent image builds; overrides config buildConcurrency
  --docker-executable <path> Docker executable; overrides config dockerExecutable
  --oci-export-dir <path>   Write per-image OCI layouts; overrides config ociExportDir
  --dry-run                 Resolve and print the plan without invoking Docker
  -i, --interactive         Prompt for missing required values interactively
  -h, --help                Show this help message
`);
}

async function main(): Promise<void> {
  const result = parseFlags(process.argv.slice(2), SPECS);
  if (!result) {
    printHelp();
    return;
  }

  let secrets: string[] = [];
  try {
    const interactive = result.values.interactive === 'true';
    const resolved = interactive
      ? await resolveInteractiveDockerPublishOptions(
          result,
          {
            images: result.repeat.image,
            platforms: result.repeat.platform,
            registries: result.repeat.registry,
          },
          { interactive, prompter: clackPrompter },
        )
      : await resolveDockerPublishCliOptions(result, {
          images: result.repeat.image,
          platforms: result.repeat.platform,
          registries: result.repeat.registry,
        });
    secrets = collectCliSecrets(resolved.plan, resolved.passthrough.auth);
    if (result.values['dry-run'] === 'true') {
      printSummary(planSummary('build', resolved.plan, true));
      return;
    }
    if (interactive) {
      printSummary(planSummary('build', resolved.plan, false));
      await confirmInteractiveProceed(clackPrompter, { requiresPush: false });
    }
    const built = await buildDockerImages(resolved.options);
    printSummary({
      ...planSummary('build', resolved.plan, false),
      images: built.images.map((entry) => ({
        image: entry.image,
        references: [...entry.references],
        platforms: [...entry.platforms],
        imageIds: { ...entry.imageIds },
        durationMs: entry.durationMs,
      })),
    });
  } catch (error) {
    reportCliError(error, secrets);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  reportCliError(error);
  process.exitCode = 1;
});
