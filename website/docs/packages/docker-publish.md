---
sidebar_label: Docker Publish
sidebar_position: 7
---

# `@repo-toolkit/docker-publish`

`@repo-toolkit/docker-publish` plans, builds, publishes, and verifies Docker/OCI container images to target registries.

One validated configuration model supports single-image and multi-image repositories. Each image is built for an explicit platform matrix, tagged deterministically, pushed only to allowlisted registries, pinned by content digest, and verified against the published manifest. Builds never implicitly publish: the build path uses `docker buildx build` without `--push`, and publishing is an explicit `docker push` step with digest capture.

## Requirements

- Node.js 20 or newer.
- A Docker executable with `buildx` support for build, publish, and verify operations. Check with `docker buildx version`.
- A filesystem where temporary files can be renamed within the output directory (digest manifests are written atomically via a sibling temp file plus rename).

The package does not install Docker, provision BuildKit builders, administer registries, scan images for CVEs, or generate SBOMs, signatures, attestations, or provenance payloads. Downstream workflows may consume the digests this package returns.

## Install

```sh
pnpm add -D @repo-toolkit/docker-publish
```

## Tested Configurations

The JSON examples below are compared as parsed objects with fixtures in the package test suite (`test/examples.test.ts`), then resolved, dry-run through the build CLI, built, published, and verified with injected fake runners — no daemon or network access required.

### Single Image

One image pushed to one registry for two platforms under a single version tag. This is the smallest layout that exercises the full plan, build, publish, and verify pipeline.

<!-- example:single-image -->

```json
{
  "images": [
    {
      "name": "app",
      "contextDir": "services/app"
    }
  ],
  "registries": [
    {
      "hostname": "registry.example.com",
      "repositoryPrefix": "team"
    }
  ],
  "tags": ["1.2.3"],
  "platforms": ["linux/amd64", "linux/arm64"]
}
```

The plan resolves one reference, `registry.example.com/team/app:1.2.3`, built for `linux/amd64` and `linux/arm64`. Because the build is multi-platform, no `--load` flag is passed and no local image ID verification runs; the digest is captured at publish time instead.

### Multiple Images And Registries

Two images pushed to two registries with distinct tags, build arguments, and labels. Each image inherits the global matrix and may add its own `buildArgs` and `labels`.

<!-- example:multi-image-multi-registry -->

```json
{
  "images": [
    {
      "name": "app",
      "contextDir": "services/app"
    },
    {
      "name": "worker",
      "contextDir": "services/worker",
      "buildArgs": {
        "WORKER_CONCURRENCY": "4"
      },
      "labels": {
        "org.opencontainers.image.title": "worker"
      }
    }
  ],
  "registries": [
    {
      "hostname": "registry.example.com",
      "repositoryPrefix": "team"
    },
    {
      "hostname": "localhost:5000"
    }
  ],
  "tags": ["1.2.3", "latest"],
  "platforms": ["linux/amd64", "linux/arm64"],
  "buildConcurrency": 2
}
```

The plan resolves eight references: two images × two registries × two tags. A registry without `repositoryPrefix` produces references such as `localhost:5000/worker:1.2.3`. Per-image `buildArgs` merge over global `buildArgs`; per-image `labels` merge over global `labels`.

## Configuration Reference

Configuration is a JSON, `.mjs`, or `.cjs` (default export) file loaded with the shared `loadConfigFile` helper. Unknown keys fail validation at every level (options, image, registry, `processLimits`, `verification`).

| Option                    | Type         | Default                                          | Notes                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cwd`                     | string       | current working directory                        | Project root. Resolved to its real path; every context, Dockerfile, and manifest path must stay inside it.                                                                                                                                                             |
| `images`                  | array        | required, at least one                           | Each entry: `name`, `contextDir`, optional `dockerfile` (defaults to `<contextDir>/Dockerfile`), optional `target` build stage, optional per-image `buildArgs`/`labels`. Names must be unique.                                                                         |
| `registries`              | array        | required, at least one                           | Each entry: `hostname`, optional `repositoryPrefix` (defaults to `""`). Hostnames are lowercase with no scheme, path, userinfo, or port abuse. No implicit Docker Hub default.                                                                                         |
| `tags`                    | string array | required, at least one                           | Docker tag rules: lowercase, `[a-z0-9_][a-z0-9_.-]{0,127}`, max 128 characters. No duplicates.                                                                                                                                                                         |
| `platforms`               | string array | required, at least one                           | Explicit `os/arch[/variant]` list. A known-OS/arch table covers the common pairs; anything else requires `allowCustomPlatforms: true`.                                                                                                                                 |
| `buildArgs`               | string map   | `{}`                                             | Passed as separate `--build-arg KEY=VALUE` argv entries. Max 64 entries, 128-char keys, 4096-char values; no whitespace or control characters in keys. Keys containing `TOKEN`, `SECRET`, or `PASSWORD` are rejected unless `allowSecretsInBuildArgs: true`.           |
| `labels`                  | string map   | `{}`                                             | Passed as separate `--label KEY=VALUE` argv entries. Same bounds and secret-key guard as `buildArgs`.                                                                                                                                                                  |
| `buildConcurrency`        | number       | `2`                                              | Max concurrent image builds. Positive safe integer, max 64.                                                                                                                                                                                                            |
| `publishConcurrency`      | number       | `1`                                              | Max concurrent pushes. Serial by default to avoid registry rate limits. Positive safe integer, max 64. Library-only for `publishDockerImages`; the CLIs also accept `--publish-concurrency`.                                                                           |
| `processLimits`           | object       | `{ timeoutMs: 600000, maxOutputBytes: 1048576 }` | Timeout and captured-output cap applied at the runner boundary to every Docker invocation.                                                                                                                                                                             |
| `dockerExecutable`        | string       | `"docker"`                                       | Docker binary name or path used for every invocation.                                                                                                                                                                                                                  |
| `allowSecretsInBuildArgs` | boolean      | `false`                                          | Opt in to secret-looking `buildArgs`/`labels` keys. Prefer build secrets or runtime env over baking credentials into layers.                                                                                                                                           |
| `allowCustomPlatforms`    | boolean      | `false`                                          | Opt in to `os/arch` pairs outside the known table.                                                                                                                                                                                                                     |
| `verification`            | object       | `{ enabled: true, requireDigestMatch: true }`    | Plan-level verification policy consumed by `verifyDockerPublish`. `enabled: false` makes verification refuse to run instead of reporting unverified results; `requireDigestMatch: false` still reports per-reference `match` flags without failing on digest mismatch. |
| `auth`                    | map          | `{}`                                             | Registry auth env contract (see below). Passed through by the CLIs; only `runner` is rejected as a CLI config key because custom runners are available solely to library callers.                                                                                      |
| `digestManifestPath`      | string       | unset                                            | Caller-owned relative path for the sorted JSON digest manifest. Must stay inside the project root.                                                                                                                                                                     |
| `expectedDigests`         | map          | unset                                            | Reference-to-digest map consumed by `verifyDockerPublish` and the unified CLI `--verify`-without-`--push` path.                                                                                                                                                        |

## Config Precedence And CLI Overrides

Configuration supplies defaults and explicit CLI flags override them:

- `--cwd` overrides `cwd`; `--docker-executable` overrides `dockerExecutable`; `--concurrency` overrides `buildConcurrency`; `--publish-concurrency` overrides `publishConcurrency`; `--digest-manifest` overrides `digestManifestPath`.
- `--image`, `--platform`, and `--registry` are repeatable (comma-split) filters that narrow the resolved plan to named entries. Unknown or duplicate filter values fail before any Docker process runs.
- The publish and unified CLIs pass `auth`, `digestManifestPath`, `publishConcurrency`, and `expectedDigests` through without revalidating them as plan keys.
- A `runner` key in CLI configuration is rejected: custom runners are available only to library callers.

## CLI

All CLIs use explicit flags; there are no positional subcommands. `parseFlags` runs in strict mode: unknown flags and missing values fail, and `-h`/`--help` prints help.

```sh
repo-toolkit-build-docker-publish --config docker-publish.json --dry-run
repo-toolkit-build-docker-publish --config docker-publish.json --image app --platform linux/amd64
repo-toolkit-publish-docker-publish --config docker-publish.json --skip-build --digest-manifest digests.json --verify
repo-toolkit-docker-publish --config docker-publish.json --build --push
repo-toolkit-docker-publish --config docker-publish.json --push --verify
repo-toolkit-docker-publish --config docker-publish.json --verify
```

- The build CLI builds every planned image and prints image IDs (single-platform `--load` builds), references, platforms, and durations.
- The publish CLI builds first unless `--skip-build` is given (publish prebuilt local images), pushes only planned references, optionally writes the digest manifest, and optionally verifies with `--verify` using the just-published digests.
- The unified CLI dispatches via `--build`/`--push`/`--verify`. Without an operation flag it runs build followed by push. `--verify` after a push reuses the returned digests; `--verify` without `--push` uses `expectedDigests` from configuration.
- `--dry-run` resolves and prints the full plan (images, references, platforms) without invoking Docker and without requiring daemon access. Invalid configuration fails before any runner call.

Summaries are deterministic JSON and secrets-free: they contain references, digests, durations, and concurrency, never build-arg values, environments, runner objects, or executable paths beyond the configured Docker binary name.

## Interactive Mode

All three CLIs accept `-i` / `--interactive` to prompt for required values on a TTY instead of requiring a config file up front:

```sh
repo-toolkit-build-docker-publish --interactive
repo-toolkit-publish-docker-publish --config docker-publish.json --interactive
repo-toolkit-docker-publish --interactive --build --push
```

The staged flow is: config-file path (offered only when `--config` is absent; empty input configures without a file), essentials (image entries, registry entries, tags, platforms, each looped with an add-another confirm where applicable), then an advanced group (build args, labels, concurrencies, process limits, Docker executable) behind a customize confirm that defaults to No. Every prompt defaults to the loaded config value when one exists, so accepting all defaults reproduces the equivalent config file.

Precedence is CLI flag > prompt answer > config default: explicit flags such as `--cwd`, `--docker-executable`, `--concurrency`, and the `--image` / `--platform` / `--registry` filters always win over prompted and configured values.

TTY rule: `-i` without a TTY fails closed before any prompt or Docker invocation with an error telling the user to pass `--config` or run in a TTY. CI never hangs on stdin.

Auth is ephemeral-only: per registry the CLI prompts the `usernameEnv` / `passwordEnv` names, then — when the named password variable is set and non-empty — offers a choice between using the environment value (default, recommended) and entering a new masked password; otherwise it goes straight to masked entry. Entered passwords live in memory for this run's `--password-stdin` login only. Nothing is written to disk, `process.env` is never mutated, and typed secrets appear in no summary, config output, log, or error (they are covered by the shared redaction helper).

Confirm gate: after plan resolution the CLI prints the standard secrets-free summary and asks `Proceed?` — defaulting to Yes for build-only runs and requiring an explicit Yes before any push. Declining or cancelling aborts with `Operation cancelled.` before any Docker invocation. `--dry-run` prints the plan and returns before auth prompts and before the confirm (planning prompts still apply so dry-run can shape the plan). There is no save feature: answers are never persisted.

## Tag And Reference Contract

Exactly one helper formats references — `formatImageReference(registry, repository, name, tag)` — and no caller concatenates references by hand:

- With a repository prefix: `registry.example.com/team/app:1.2.3`.
- Without one: `localhost:5000/worker:1.2.3`.
- Any `{`/`}` in a part is rejected; there are no template tokens and no shell or code evaluation.

Tags are caller-owned: the package derives nothing from Git, `VERSION` files, or `package.json`. `latest` has no special status — it is pushed only when listed in `tags`, and omitted otherwise. Duplicate fully-qualified references across images, registries, or tags fail during planning.

## Digest Format

Digests are lowercase `sha256:<64-hex>` strings. On push, the digest is parsed from `docker push` output (`digest: sha256:...`) and cross-checked against a `docker buildx imagetools inspect --format {{json .Manifest}}` follow-up: when both are present they must agree, the inspect digest is the fallback when push output carries none, and absence of both fails closed. Malformed or ambiguous digests fail closed.

## Push Boundaries

- Only references produced by the resolved plan are pushed. Off-plan, duplicate, or unlisted-registry references fail before any runner call, even if the daemon holds them locally.
- The registry allowlist is enforced at publish time even when the plan was constructed programmatically (defense in depth).
- Pushes run through a worker pool bounded by `publishConcurrency` (default serial). The first failure stops new pushes from starting while already-started pushes are awaited.
- `dryRun: true` (library) returns an empty publish list after plan validation with zero runner calls, zero credential reads, and zero manifest writes.

## Process Limits

Every Docker invocation runs as a structured argv array through the injected runner — never a shell string — bounded by `processLimits.timeoutMs` (default 600000ms) and `processLimits.maxOutputBytes` (default 1048576 bytes). Timed-out and output-overflow processes are terminated (`SIGKILL` by default) with errors that identify the executable without exposing secret values. Daemon output tails in errors are truncated to 2048 characters. `capture` records wall-clock duration and truncated output size without retaining unbounded buffers.

## Registry Auth Contract

Credentials are sourced from environment variables named by the config `auth` map and travel to `docker login` via `--password-stdin` only:

```json
{
  "auth": {
    "registry.example.com": {
      "usernameEnv": "REGISTRY_EXAMPLE_COM_USER",
      "passwordEnv": "REGISTRY_EXAMPLE_COM_PASS"
    }
  }
}
```

```sh
export REGISTRY_EXAMPLE_COM_USER="example-user"
export REGISTRY_EXAMPLE_COM_PASS="example-pass"
repo-toolkit-publish-docker-publish --config docker-publish.json
```

- Env names must match `/^[A-Za-z_][A-Za-z0-9_]*$/`. Missing or empty env credentials fail closed before any push.
- Plaintext passwords never appear in config files, argv (there is no `--password` flag path), logs, summaries, or error messages. Secrets are redacted from tails via the shared redaction helper, including `://user:pass@` URLs.
- Logins run once per needed registry up front as `docker login --username <user> --password-stdin <hostname>` with the password on stdin.
- A registry without an `auth` entry is pushed without a login step (public or pre-authenticated registries).

## Allowlist Semantics

`registries` is the push allowlist: every pushed reference's hostname must match a configured registry exactly, checked both at plan resolution and again at the publish boundary. There is no wildcard, no suffix match, and no implicit Docker Hub fallback — an unconfigured hostname fails closed with `Refusing to push to unlisted registry`.

## Platform Support

Platforms are explicit `os/arch[/variant]` tokens validated against a known-OS table (`linux`, `darwin`, `windows`, and others) and known-arch table (`amd64`, `arm64`, `386`, `arm`, and others). Unknown pairs require `allowCustomPlatforms: true`. Verification requires the published manifest's platform set to equal the planned set exactly: missing platforms and unexpected platforms both fail.

## Latest Policy

`latest` is an ordinary tag. Include it in `tags` to publish and verify a floating reference alongside pinned version tags; omit it to keep every published reference immutable. The package never adds `latest` on its own.

## Load-Versus-Push Separation

- Build runs `docker buildx build --platform <join> -f <Dockerfile> [-t <reference>...] [--build-arg ...] [--label ...]` plus `--load` for single-platform images only. The build path never contains `--push` (asserted by tests at both the argv and module-source level).
- Single-platform `--load` builds are verified with `docker images --no-trunc --format ...`: empty, missing, unexpected, or conflicting entries fail closed. On failure the operation best-effort untags (`docker rmi`) what it created and reports image identity, platform set, and the output tail.
- Multi-platform builds produce no local image; their digests are captured at publish time.
- No build output files are written to the repository; only the Docker daemon receives image data.

## Context Trust

Build contexts are trusted, immutable snapshots.

Plan resolution pins each context root and Dockerfile through lexical containment plus `lstat`/`realpath` checks (the Dockerfile must resolve inside its context), but symlinks _inside_ the context tree are never enumerated and Docker follows them at build time. Scanning every tree on every build would stay racy (the tree can change after the scan) while adding I/O to a hot path, so the package instead treats contexts as trusted input: keep them immutable between plan and build and never include untrusted symlinks or files. As a backstop against swaps of the pinned paths themselves, the build step re-validates the resolved context directory and Dockerfile immediately before spawning Docker and fails closed when either changed, vanished, or no longer resolves to the planned real path.

## Digest Manifests

When `digestManifestPath` (or `--digest-manifest`) is set, publish writes a pretty-printed JSON map of reference to digest, sorted by reference with a trailing newline, atomically (temp sibling plus rename) inside the project root:

```json
{
  "registry.example.com/team/app:1.2.3": "sha256:<64-hex>"
}
```

Manifest write failures carry the underlying cause. Verification consumes the same shape through `expectedDigests`.

## Makefile And CI

Thin targets that consume the CLIs. The package creates no tags, SBOMs, provenance, image registries, or GitHub Releases — release tagging and artifact upload stay in the release workflow.

```make
DOCKER_PUBLISH_CONFIG ?= docker-publish.json

.PHONY: docker-plan docker-build docker-publish

docker-plan:
	pnpm docker-publish -- --config $(DOCKER_PUBLISH_CONFIG) --build --push --dry-run

docker-build:
	pnpm build-docker-publish -- --config $(DOCKER_PUBLISH_CONFIG)

docker-publish:
	pnpm publish-docker-publish -- --config $(DOCKER_PUBLISH_CONFIG) --digest-manifest digests.json --verify
```

Standalone `pnpm docker-publish -- --config $(DOCKER_PUBLISH_CONFIG) --verify` verifies without pushing and reads `expectedDigests` from configuration.

```yaml
# Consume the CLI from CI without claiming package-owned provenance.
# Registry credentials travel via environment; nothing secret is passed as argv.
steps:
  - uses: pnpm/action-setup@v4
  - run: pnpm install --frozen-lockfile
  - run: pnpm build-docker-publish -- --config docker-publish.json --dry-run
  - run: pnpm publish-docker-publish -- --config docker-publish.json --digest-manifest digests.json
    env:
      REGISTRY_EXAMPLE_COM_USER: ${{ secrets.REGISTRY_USER }}
      REGISTRY_EXAMPLE_COM_PASS: ${{ secrets.REGISTRY_PASS }}
```

## Migration Caveats

- **Tag naming:** tags must already satisfy Docker rules at plan time. Retagging an existing ad-hoc scheme means editing `tags`, not flags — there is no tag-rewrite option.
- **`latest` policy:** if a previous workflow pushed `latest` implicitly, add it to `tags` explicitly or previously floating consumers will stop receiving updates.
- **Load-versus-push separation:** scripts that relied on `docker build` pushing (or on a local image existing after a multi-platform build) must call the publish CLI explicitly; multi-platform builds intentionally leave no local image.
- **Managed digest manifests:** treat `digests.json` as a build output — commit it only if downstream pinning needs a checked-in record, and regenerate it on every publish rather than hand-editing digests.

## Library API

```ts
import {
  buildDockerImages,
  publishDockerImages,
  resolveDockerPublishPlan,
  verifyDockerPublish,
} from '@repo-toolkit/docker-publish';

const options = {
  cwd: 'my-app',
  images: [{ name: 'app', contextDir: 'services/app' }],
  registries: [{ hostname: 'registry.example.com', repositoryPrefix: 'team' }],
  tags: ['1.2.3'],
  platforms: ['linux/amd64', 'linux/arm64'],
};

const plan = resolveDockerPublishPlan(options);
const built = await buildDockerImages(options);
const published = await publishDockerImages({ ...options, digestManifestPath: 'digests.json' });
const expectedDigests = Object.fromEntries(published.publishes.map((entry) => [entry.reference, entry.digest]));
const verified = await verifyDockerPublish({ ...options, expectedDigests });
```

Library callers pass full option objects; `buildDockerImages`, `publishDockerImages`, and `verifyDockerPublish` each accept an injectable `runner` (`run`/`capture`) so tests can substitute fake runners with zero daemon or network access. `publishDockerImages` additionally accepts `runner`, `dryRun`, `publishConcurrency`, `references` (a subset of the plan, still allowlisted), `auth`, and `digestManifestPath`. `verifyDockerPublish` accepts `runner`, `references`, `expectedDigests`, and `maxManifestBytes`, and rejects `pull: true` — verification is manifest-only inspection and never pulls layers.

## What This Package Does Not Do

Creating or pushing Git tags or GitHub Releases, generating SBOMs, signatures, attestations, or provenance payloads, running Compose stacks or deployments, provisioning daemons or builders, administering registries, scanning for CVEs, installing asdf plugins, or centralizing release-tag, SHA, `VERSION`, or `package.json` consistency. Those stay explicitly deferred.
