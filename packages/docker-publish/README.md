# `@repo-toolkit/docker-publish`

Plan, build, publish, and verify Docker/OCI container images to target registries.

Requires Node.js 20 or newer and a Docker executable with `buildx` support for build, publish, and verify operations.

## Installation

```sh
pnpm add -D @repo-toolkit/docker-publish
```

## Configuration

Configuration is a JSON, `.mjs`, or `.cjs` file with `images`, `registries`, `tags`, and `platforms` (all required, at least one entry each). Configuration supplies defaults and explicit CLI flags override them: `--cwd`, `--docker-executable`, `--concurrency` (builds), `--publish-concurrency` (pushes), and `--digest-manifest` map onto their config keys, while `--image`, `--platform`, and `--registry` narrow the resolved plan. Unknown config keys fail validation. Defaults: `buildConcurrency` 2 (max 64), `publishConcurrency` 1 (max 64), `processLimits` 600s timeout with a 1MiB output cap, `dockerExecutable` set to `docker`, and verification enabled with digest matching required. The full option table, tag and digest contracts, and platform rules live in `website/docs/packages/docker-publish.md`.

## CLI

Put the image matrix in `docker-publish.json`, then run:

```sh
repo-toolkit-build-docker-publish --config docker-publish.json
repo-toolkit-publish-docker-publish --config docker-publish.json
# Unified entrypoint dispatches via explicit operation flags:
repo-toolkit-docker-publish --config docker-publish.json --build --push
```

Build options:

| Option                       | Purpose                                                       |
| ---------------------------- | ------------------------------------------------------------- |
| `--config <path>`            | Load JSON, `.mjs`, or `.cjs` configuration.                   |
| `--cwd <path>`               | Locate relative config and set the project root.              |
| `--image <name>[,...]`       | Build only named configured images; repeatable.               |
| `--platform <os/arch>[,...]` | Build only named configured platforms; repeatable.            |
| `--registry <host>[,...]`    | Build only references for named registries; repeatable.       |
| `--concurrency <count>`      | Override `buildConcurrency`.                                  |
| `--docker-executable <path>` | Override `dockerExecutable`.                                  |
| `--dry-run`                  | Validate and print the resolved plan without invoking Docker. |
| `--interactive`              | Prompt for missing required values interactively.             |
| `--help`                     | Show CLI help.                                                |

Publish options:

| Option                          | Purpose                                                       |
| ------------------------------- | ------------------------------------------------------------- |
| `--config <path>`               | Load JSON, `.mjs`, or `.cjs` configuration.                   |
| `--cwd <path>`                  | Locate relative config and set the project root.              |
| `--image <name>[,...]`          | Publish only named configured images; repeatable.             |
| `--registry <host>[,...]`       | Publish only to named registries; repeatable.                 |
| `--concurrency <count>`         | Override `buildConcurrency` for the build step.               |
| `--publish-concurrency <count>` | Override `publishConcurrency` for pushes.                     |
| `--docker-executable <path>`    | Override `dockerExecutable`.                                  |
| `--digest-manifest <path>`      | Override `digestManifestPath`.                                |
| `--skip-build`                  | Publish prebuilt local images without building first.         |
| `--verify`                      | Verify published manifests after pushing.                     |
| `--dry-run`                     | Validate and print the resolved plan without invoking Docker. |
| `--interactive`                 | Prompt for missing required values interactively.             |
| `--help`                        | Show CLI help.                                                |

Unified options:

| Option                          | Purpose                                                       |
| ------------------------------- | ------------------------------------------------------------- |
| `--config <path>`               | Load JSON, `.mjs`, or `.cjs` configuration.                   |
| `--cwd <path>`                  | Locate relative config and set the project root.              |
| `--image <name>[,...]`          | Operate only on named configured images; repeatable.          |
| `--platform <os/arch>[,...]`    | Operate only on named configured platforms; repeatable.       |
| `--registry <host>[,...]`       | Operate only on named registries; repeatable.                 |
| `--concurrency <count>`         | Override `buildConcurrency`.                                  |
| `--publish-concurrency <count>` | Override `publishConcurrency` for pushes.                     |
| `--docker-executable <path>`    | Override `dockerExecutable`.                                  |
| `--digest-manifest <path>`      | Override `digestManifestPath`.                                |
| `--build`                       | Build images without pushing.                                 |
| `--push`                        | Push resolved references to target registries.                |
| `--verify`                      | Verify published manifests against expected digests.          |
| `--dry-run`                     | Validate and print the resolved plan without invoking Docker. |
| `--interactive`                 | Prompt for missing required values interactively.             |
| `--help`                        | Show CLI help.                                                |

Configuration supplies defaults; explicitly supplied CLI flags override the corresponding values. Without an operation flag, the unified CLI runs build followed by push. `--verify` after a push reuses the returned digests; `--verify` without `--push` uses `expectedDigests` from configuration. The publish CLI builds first unless `--skip-build` is given. CLI configuration cannot inject a library `runner`. Registry credentials come from environment variables named by the config `auth` map and travel to `docker login` via `--password-stdin` only; `--dry-run` resolves and prints the plan without invoking Docker or requiring daemon access.

Pass `-i` / `--interactive` to answer staged prompts on a TTY instead of writing a config file: config values (when `--config` is given) become prompt defaults, explicit CLI flags still win, and `--dry-run` shapes the plan without auth prompts or confirmation. Registry hostnames are picked from a common-registry list with a custom-hostname entry last. Without a TTY, `-i` fails closed before any Docker invocation. Prompted registry passwords are masked, held in memory for this run's login only, and never saved to disk.

## Library

```ts
import {
  buildDockerImages,
  defaultDockerRunner,
  formatImageReference,
  publishDockerImages,
  resolveDockerPublishPlan,
  validateDockerRunner,
  verifyDockerPublish,
} from '@repo-toolkit/docker-publish';

const options = {
  images: [{ name: 'app', contextDir: 'services/app' }],
  registries: [{ hostname: 'registry.example.com', repositoryPrefix: 'team' }],
  tags: ['1.2.3'],
  platforms: ['linux/amd64', 'linux/arm64'],
};

const plan = resolveDockerPublishPlan(options);
await buildDockerImages(options);
const published = await publishDockerImages({ ...options, digestManifestPath: 'digests.json' });
await verifyDockerPublish({
  ...options,
  expectedDigests: Object.fromEntries(published.publishes.map((entry) => [entry.reference, entry.digest])),
});
```

`resolveDockerPublishPlan` validates without touching the filesystem beyond read-only checks, invoking processes, or reading credentials. `buildDockerImages` runs `docker buildx build` with no push flag and verifies loaded local tags. `publishDockerImages` pushes only planned references to allowlisted registries, captures lowercase digest values, and optionally writes a sorted atomic JSON digest manifest. `verifyDockerPublish` inspects registry manifests only (never pulls) and requires the platform set to equal the plan. Library callers may inject a `runner` with `run`/`capture` methods; CLI configuration rejects a `runner` key. `formatImageReference(registry, repositoryPrefix, name, tag)` is the single reference builder used by plan resolution — reuse it instead of concatenating references by hand. `defaultDockerRunner` spawns the configured Docker executable, and `validateDockerRunner` asserts that a custom runner implements `run()` and `capture()`.

Registry credentials come from environment variables named by the config `auth` map (`{ "<hostname>": { "usernameEnv", "passwordEnv" } }`) and travel to `docker login` via password-stdin only. Registries without an `auth` entry are pushed without a login step. Secrets never appear in argv, summaries, or error output.

Build contexts are trusted, immutable snapshots: plan resolution pins each context root and Dockerfile (lexical containment plus `lstat`/`realpath` checks, Dockerfile inside its context), symlinks inside the context tree are never enumerated and Docker follows them at build time, and the build step re-validates the pinned context and Dockerfile immediately before spawning Docker, failing closed if either changed. Keep contexts immutable between plan and build and never include untrusted symlinks or files.

## Examples

Tested `single-image` and `multi-image-multi-registry` configurations live in `test/fixtures/` and are mirrored byte-for-byte as parsed objects in `website/docs/packages/docker-publish.md`. `test/examples.test.ts` drives both through plan resolution, CLI dry-run, build, publish, and verify with injected fake runners.

## Non-Goals

Git tags and GitHub Releases, SBOMs, signatures, attestations, provenance payloads, Compose orchestration, daemon or builder provisioning, registry administration, and CVE scanning stay explicitly out of scope.
