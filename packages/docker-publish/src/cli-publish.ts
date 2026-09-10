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
  { name: 'registry', list: true },
  { name: 'concurrency' },
  { name: 'publish-concurrency' },
  { name: 'docker-executable' },
  { name: 'digest-manifest' },
  { name: 'skip-build', boolean: true },
  { name: 'verify', boolean: true },
  { name: 'dry-run', boolean: true },
  INTERACTIVE_FLAG,
];

function printHelp(): void {
  console.log(`repo-toolkit-publish-docker-publish

Usage:
  repo-toolkit-publish-docker-publish --config <path> [options]

Options:
  --config <path>           Config file (JSON, .mjs, or .cjs default export)
  --cwd <path>              Project root; overrides config cwd
  --image <name>[,...]      Publish only named configured images (repeatable)
  --registry <host>[,...]   Publish only to named registries (repeatable)
  --concurrency <count>     Maximum concurrent image builds; overrides config buildConcurrency
  --publish-concurrency <count> Maximum concurrent pushes; overrides config publishConcurrency
  --docker-executable <path> Docker executable; overrides config dockerExecutable
  --digest-manifest <path>  Write a sorted JSON digest manifest; overrides config digestManifestPath
  --skip-build              Publish prebuilt local images without building first
  --verify                  Verify published manifests after pushing
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
            registries: result.repeat.registry,
          },
          { interactive, prompter: clackPrompter },
        )
      : await resolveDockerPublishCliOptions(result, {
          images: result.repeat.image,
          registries: result.repeat.registry,
        });
    secrets = collectCliSecrets(resolved.plan, resolved.passthrough.auth);
    if (result.values['dry-run'] === 'true') {
      printSummary({
        ...planSummary('publish', resolved.plan, true),
        skipBuild: result.values['skip-build'] === 'true',
        verify: result.values.verify === 'true',
      });
      return;
    }

    const publishConcurrency = resolvePublishConcurrencyFlag(result, resolved.passthrough);
    const digestManifestPath = resolveDigestManifestFlag(result, resolved.passthrough);

    if (interactive) {
      const confirmed = await resolveInteractiveAuthAndConfirm(
        clackPrompter,
        resolved.plan,
        resolved.passthrough.auth,
        {
          operation: 'publish',
          requiresPush: true,
          dryRun: false,
        },
      );
      secrets = confirmed.secrets;
      await loginWithInteractiveAuth(defaultDockerRunner, resolved.plan, confirmed.auth, confirmed.authValues, secrets);
      const built = result.values['skip-build'] === 'true' ? undefined : await buildDockerImages(resolved.options);
      const published = await publishDockerImages({
        ...resolved.options,
        auth: {},
        ...(publishConcurrency === undefined ? {} : { publishConcurrency }),
        ...(digestManifestPath === undefined ? {} : { digestManifestPath }),
      });

      let verified: { verified: boolean; references: ReadonlyArray<object> } | undefined;
      if (result.values.verify === 'true') {
        const digests: Record<string, string> = {};
        for (const entry of published.publishes) {
          digests[entry.reference] = entry.digest;
        }
        const verification = await verifyDockerPublish({ ...resolved.options, expectedDigests: digests });
        verified = { verified: verification.verified, references: verification.references };
      }

      printSummary({
        ...planSummary('publish', resolved.plan, false),
        ...(built === undefined
          ? { skipBuild: true }
          : {
              built: built.images.map((entry) => ({
                image: entry.image,
                references: [...entry.references],
                platforms: [...entry.platforms],
                durationMs: entry.durationMs,
              })),
            }),
        publishes: published.publishes.map((entry) => ({
          reference: entry.reference,
          registry: entry.registry,
          tag: entry.tag,
          digest: entry.digest,
          durationMs: entry.durationMs,
        })),
        ...(digestManifestPath === undefined ? {} : { digestManifest: digestManifestPath }),
        ...(verified === undefined ? {} : { verified }),
      });
      return;
    }

    const built = result.values['skip-build'] === 'true' ? undefined : await buildDockerImages(resolved.options);
    const published = await publishDockerImages({
      ...resolved.options,
      auth: resolved.passthrough.auth,
      ...(publishConcurrency === undefined ? {} : { publishConcurrency }),
      ...(digestManifestPath === undefined ? {} : { digestManifestPath }),
    });

    let verified: { verified: boolean; references: ReadonlyArray<object> } | undefined;
    if (result.values.verify === 'true') {
      const digests: Record<string, string> = {};
      for (const entry of published.publishes) {
        digests[entry.reference] = entry.digest;
      }
      const verification = await verifyDockerPublish({ ...resolved.options, expectedDigests: digests });
      verified = { verified: verification.verified, references: verification.references };
    }

    printSummary({
      ...planSummary('publish', resolved.plan, false),
      ...(built === undefined
        ? { skipBuild: true }
        : {
            built: built.images.map((entry) => ({
              image: entry.image,
              references: [...entry.references],
              platforms: [...entry.platforms],
              durationMs: entry.durationMs,
            })),
          }),
      publishes: published.publishes.map((entry) => ({
        reference: entry.reference,
        registry: entry.registry,
        tag: entry.tag,
        digest: entry.digest,
        durationMs: entry.durationMs,
      })),
      ...(digestManifestPath === undefined ? {} : { digestManifest: digestManifestPath }),
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
