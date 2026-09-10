import { INTERACTIVE_FLAG, parseFlags, type FlagSpec } from '@repo-toolkit/publish-package';

import { buildDockerImages } from './build';
import {
  collectCliSecrets,
  planSummary,
  printSummary,
  reportCliError,
  resolveDigestManifestFlag,
  resolveDockerPublishCliOptions,
  resolvePublishConcurrencyFlag,
} from './cli-options';
import {
  clackPrompter,
  confirmInteractiveProceed,
  loginWithInteractiveAuth,
  resolveInteractiveAuthAndConfirm,
  resolveInteractiveDockerPublishOptions,
} from './interactive';
import { publishDockerImages } from './publish';
import { defaultDockerRunner } from './runner';
import { verifyDockerPublish } from './verify';

const SPECS: FlagSpec[] = [
  { name: 'config' },
  { name: 'cwd' },
  { name: 'image', list: true },
  { name: 'platform', list: true },
  { name: 'registry', list: true },
  { name: 'concurrency' },
  { name: 'publish-concurrency' },
  { name: 'docker-executable' },
  { name: 'digest-manifest' },
  { name: 'build', boolean: true },
  { name: 'push', boolean: true },
  { name: 'verify', boolean: true },
  { name: 'dry-run', boolean: true },
  INTERACTIVE_FLAG,
];

function printHelp(): void {
  console.log(`repo-toolkit-docker-publish

Usage:
  repo-toolkit-docker-publish --config <path> [options]

Operations (explicit flags; no positional subcommands):
  --build   Build images without pushing
  --push    Push resolved references to target registries
  --verify  Verify published manifests against expected digests

  Without an operation flag, runs build followed by push.

Options:
  --config <path>           Config file (JSON, .mjs, or .cjs default export)
  --cwd <path>              Project root; overrides config cwd
  --image <name>[,...]      Operate only on named configured images (repeatable)
  --platform <os/arch>[,...] Operate only on named configured platforms (repeatable)
  --registry <host>[,...]   Operate only on named registries (repeatable)
  --concurrency <count>     Maximum concurrent image builds; overrides config buildConcurrency
  --publish-concurrency <count> Maximum concurrent pushes; overrides config publishConcurrency
  --docker-executable <path> Docker executable; overrides config dockerExecutable
  --digest-manifest <path>  Write a sorted JSON digest manifest; overrides config digestManifestPath
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

    const selected = {
      build: result.values.build === 'true',
      push: result.values.push === 'true',
      verify: result.values.verify === 'true',
    };
    const operations =
      selected.build || selected.push || selected.verify ? { ...selected } : { build: true, push: true, verify: false };

    if (result.values['dry-run'] === 'true') {
      printSummary({ ...planSummary('docker-publish', resolved.plan, true), operations });
      return;
    }

    const publishConcurrency = resolvePublishConcurrencyFlag(result, resolved.passthrough);
    const digestManifestPath = resolveDigestManifestFlag(result, resolved.passthrough);

    let publishAuth = resolved.passthrough.auth;
    if (interactive) {
      if (operations.push) {
        const confirmed = await resolveInteractiveAuthAndConfirm(
          clackPrompter,
          resolved.plan,
          resolved.passthrough.auth,
          {
            operation: 'docker-publish',
            requiresPush: true,
            dryRun: false,
          },
        );
        secrets = confirmed.secrets;
        await loginWithInteractiveAuth(
          defaultDockerRunner,
          resolved.plan,
          confirmed.auth,
          confirmed.authValues,
          secrets,
        );
        publishAuth = {};
      } else {
        printSummary({ ...planSummary('docker-publish', resolved.plan, false), operations });
        await confirmInteractiveProceed(clackPrompter, { requiresPush: false });
      }
    }

    const built = operations.build ? await buildDockerImages(resolved.options) : undefined;
    const published = operations.push
      ? await publishDockerImages({
          ...resolved.options,
          auth: publishAuth,
          ...(publishConcurrency === undefined ? {} : { publishConcurrency }),
          ...(digestManifestPath === undefined ? {} : { digestManifestPath }),
        })
      : undefined;

    let verified: { verified: boolean; references: ReadonlyArray<object> } | undefined;
    if (operations.verify) {
      const digests: Record<string, string> = {};
      if (published !== undefined) {
        for (const entry of published.publishes) {
          digests[entry.reference] = entry.digest;
        }
      } else if (resolved.passthrough.expectedDigests !== undefined) {
        for (const reference of resolved.plan.references) {
          const digest = resolved.passthrough.expectedDigests[reference];
          if (digest !== undefined) {
            digests[reference] = digest;
          }
        }
      }
      const verification = await verifyDockerPublish({ ...resolved.options, expectedDigests: digests });
      verified = { verified: verification.verified, references: verification.references };
    }

    printSummary({
      ...planSummary('docker-publish', resolved.plan, false),
      operations,
      ...(built === undefined
        ? {}
        : {
            built: built.images.map((entry) => ({
              image: entry.image,
              references: [...entry.references],
              platforms: [...entry.platforms],
              durationMs: entry.durationMs,
            })),
          }),
      ...(published === undefined
        ? {}
        : {
            publishes: published.publishes.map((entry) => ({
              reference: entry.reference,
              registry: entry.registry,
              tag: entry.tag,
              digest: entry.digest,
              durationMs: entry.durationMs,
            })),
          }),
      ...(digestManifestPath === undefined || published === undefined ? {} : { digestManifest: digestManifestPath }),
      ...(verified === undefined ? {} : { verified }),
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
