# Docker Publish Package

Created: 2026-09-09 22:00:18

Status: completed

## Objective And Scope

Add a publishable `@repo-toolkit/docker-publish` package that plans, builds, publishes, and verifies Docker/OCI container images to target Docker registries.

The package is successful when one validated configuration model supports single-image and multi-image repositories, builds each image for an explicit platform matrix, tags deterministically, pushes only what was built, captures content digests, and verifies published manifests — while remaining readable, accurate, secure, performant, and architecturally healthy (encapsulated, reusable, testable).

The first release must provide:

- A public plan API for one or more images, each with build context, Dockerfile, target registries, tags, and platforms.
- Runtime validation for JSON or JavaScript configuration loaded through existing toolkit helpers.
- Structured, bounded, injectable external process execution for `docker` invocations (no shell strings).
- Deterministic tag and fully-qualified reference derivation.
- Build via `docker buildx build`, with explicit load-vs-push separation so builds never implicitly publish.
- Publish via `docker push` (or buildx push path) with digest capture, plus manifest verification via `docker buildx imagetools inspect` or `docker manifest inspect`.
- Registry authentication that never leaks secrets into argv, logs, summaries, or error messages.
- Build and publish CLIs that follow repository conventions, including dry-run plan display.
- Isolated tests using temporary contexts and controlled fake executables/runners; no Docker daemon or network access required for unit and CLI tests.
- Readability, accuracy, security, performance, and encapsulation/reusability/testability treated as acceptance dimensions, not afterthoughts.

## Working Rules And Non-Goals

Working rules:

- Do not revert or rewrite unrelated worktree changes. Inspect `git status --short` before each task and coordinate if another agent owns a shared file.
- Do not add a runtime dependency unless the standard library and existing toolkit dependencies cannot implement the requirement safely. Record the concrete reason before adding one.
- Use structured executable and argument arrays. Do not interpolate repository configuration into shell commands.
- Keep all configured and generated output paths inside the resolved project root. Resolve and validate the complete plan before building, tagging, or pushing.
- Preserve the repository's ES2018 typechecking target. Do not use post-ES2018 library APIs such as `Array.prototype.at` or `Object.hasOwn`.
- Do not call `process.exit()` from library or CLI code. CLI boundaries set `process.exitCode = 1`.
- Use `parseFlags`, `loadConfigFile`, and applicable value helpers from `@repo-toolkit/publish-package`; do not add a CLI parsing library.
- Keep generated `dist/` content out of commits.
- Prefer the smallest shared enforcement point: plan validation over per-caller checks, runner boundary over per-call timeouts, reference formatter over per-command string concatenation.
- Add completion evidence to this file as each task is finished. A task is not complete until its required verification passes or a blocker is recorded.

Non-goals:

- Creating or pushing Git tags or GitHub Releases.
- Generating SBOMs, signatures, attestations, or provenance payloads; workflows may consume digests from this package.
- Running Compose stacks, test suites, lint pipelines, or deployment orchestration.
- Managing Docker daemon installation, BuildKit builder provisioning, or registry server administration.
- Scanning images for CVEs or enforcing vulnerability policy.
- Generating or installing asdf plugin scripts.
- Centralizing release-tag, SHA, `VERSION`, or `package.json` consistency.
- Migrating any specific application repository in the same change.

## Baseline Verification

Before implementation begins, record results for:

```sh
git status --short
pnpm lint
pnpm typecheck
pnpm test
```

If baseline failures exist, record exact commands and output summaries here before changing code. Do not silently fix unrelated failures as part of this package.

Unit and CLI tests must run without a Docker daemon, without network access, and without a real registry by using injected runners, temporary fixtures, or fake executables. Any test requiring a real daemon or registry is deferred to maintainer-owned integration and must be explicitly skipped by default.

Baseline completion evidence:

- Pre-change `git status --short` (2026-09-09, before DOCK-01 edits): only `?? docs/tasks/20260909-220018-docker-publish-package.md` untracked; no unrelated worktree changes.
- No pre-change `pnpm lint` / `pnpm typecheck` / `pnpm test` run was recorded; the DOCK-01 change is purely additive (one new package directory plus membership entries), and all post-change verification passes with no unrelated failures observed (see DOCK-01 completion evidence).

## Priority Definitions

- P0: Required to prevent unsafe paths, leaked credentials, unbounded execution, unscoped pushes, or falsely verified publishes.
- P1: Required for the initial public package, library contract, and CLI behavior.
- P2: Documentation, consumer examples, and integration hardening required before publishing but not needed to unblock core implementation.

## Planned Public Contract

Package name:

```text
@repo-toolkit/docker-publish
```

CLI bins:

```text
repo-toolkit-docker-publish
repo-toolkit-build-docker-publish
repo-toolkit-publish-docker-publish
```

Root scripts derived by the repository contract (bin name without the `repo-toolkit-` prefix):

```text
docker-publish
build-docker-publish
publish-docker-publish
```

Expected public API names:

```ts
resolveDockerPublishPlan(options);
buildDockerImages(options);
publishDockerImages(options);
verifyDockerPublish(options);
```

Agents may refine supporting type names, but must not change package scope, bin count, or the plan/build/publish/verify split without recording a maintainer decision in this file.

## Execution Waves

1. Package contract and plan model: DOCK-01 and DOCK-02.
2. Process boundary and build foundation: DOCK-03 and DOCK-04.
3. Publish and verification: DOCK-05 and DOCK-06.
4. CLI behavior: DOCK-07.
5. Documentation and independent integration: DOCK-08 and DOCK-09.

Do not start a later wave until all dependencies are completed and their targeted verification passes.

## Detailed Tasks

### Task DOCK-01: Scaffold The Publishable Package Contract

Status: completed

Priority: P1

Suggested agent: workspace package engineer

Dependencies: none

Primary ownership:

- `packages/docker-publish/package.json`
- `packages/docker-publish/tsconfig.json`
- `packages/docker-publish/tsup.config.ts`
- `packages/docker-publish/vitest.config.ts`
- `packages/docker-publish/src/index.ts`
- `packages/docker-publish/src/cli.ts`
- `packages/docker-publish/src/cli-build.ts`
- `packages/docker-publish/src/cli-publish.ts`
- `packages/docker-publish/test/`
- `tsconfig.base.json`
- `package.json`
- initial package membership entries required by repository contract tests

Finding:

No Docker-specific package exists. Every workspace package must satisfy aliases, root-script, unique-bin, placeholder manifest, ESM export, build/test script, local README, and website documentation contracts enforced by `packages/publish-packages/test/contract.test.ts:78-349`. Without this scaffold, later plan/build/publish tasks have no publishable home and will drift into ad-hoc scripts.

References:

- `AGENTS.md`
- `packages/go-release/package.json:1-47`
- `packages/go-release/tsup.config.ts`
- `packages/publish-packages/test/contract.test.ts:78-349`
- `package.json`
- `tsconfig.base.json`

Implementation requirements:

1. Mirror existing package metadata and shared config conventions exactly, including placeholders (`0.0.0-PLACEHOLDER` version/license/repository), ESM output, `files`, Node engine, build script, and dependency-closure test script.
2. Declare the three planned bins and matching root scripts. Build each CLI separately with a Node shebang and no declaration output.
3. Depend on `@repo-toolkit/publish-package` through `workspace:*` for shared CLI and configuration helpers.
4. Add path and glob aliases to `tsconfig.base.json`.
5. Add minimal accurate package README, root README membership (Packages list + Workspace Layout), website package index membership, and dedicated website package documentation so repository contract tests remain green. DOCK-08 will complete user-facing guidance after behavior stabilizes.
6. Export placeholder library entrypoints and CLI entrypoints that print useful help or a clear not-yet-implemented error without calling `process.exit()`; do not silently succeed for unimplemented operations.
7. Add a package smoke test proving imports and CLI bundles are discoverable after build.
8. Keep readability high from day one: thin CLI wrappers over `src/index.ts`, one module per responsibility, no business logic in CLI files.

Acceptance criteria:

- `pnpm --filter @repo-toolkit/docker-publish... build` succeeds.
- The repository contract recognizes all three bins, all three root scripts, aliases, metadata, and docs membership.
- `pnpm --filter @repo-toolkit/publish-packages test` passes.
- No generated `dist/` files are tracked.
- Placeholder CLIs exit nonzero (via `process.exitCode`) for unimplemented operations and print help for `-h`/`--help`.

Completion evidence (DOCK-01, 2026-09-09):

- Scaffolded `packages/docker-publish/` mirroring `packages/go-release`: `package.json` (`@repo-toolkit/docker-publish`, `0.0.0-PLACEHOLDER` version/license/repository, ESM, `dist/index.js` + `dist/index.d.ts`, three bins, `workspace:*` dep on `@repo-toolkit/publish-package`), byte-identical `tsconfig.json` + `vitest.config.ts` (verified with `diff`), pattern-matched `tsup.config.ts` (`cli`/`cli-build`/`cli-publish` entries, shebang banner, `dts: false`), placeholder `src/index.ts` (`resolveDockerPublishPlan`, `buildDockerImages`, `publishDockerImages`, `verifyDockerPublish`), thin `src/cli.ts` + `src/cli-build.ts` + `src/cli-publish.ts` wrappers (`parseFlags`/`FlagSpec`, help on `null`, `main().catch` setting `process.exitCode = 1`, nonzero not-yet-implemented errors), smoke `test/index.test.ts`, minimal `README.md`.
- Updated `tsconfig.base.json` aliases, root `package.json` scripts (`docker-publish`, `build-docker-publish`, `publish-docker-publish`), root `README.md` (Packages + Workspace Layout + script/bin lists), `website/docs/packages/index.md`, new `website/docs/packages/docker-publish.md` stub.
- Verification (all from repo root, all passing):
  - `pnpm --filter @repo-toolkit/docker-publish... build` — succeeds.
  - `pnpm --filter @repo-toolkit/docker-publish test` — 1 file, 2 tests passed.
  - `pnpm --filter @repo-toolkit/publish-packages test` — 3 files, 85 tests passed (contract recognizes all three bins, root scripts, aliases, metadata, docs membership).
  - `pnpm lint` — clean. `pnpm typecheck` — clean. `git diff --check` — clean.
- `pnpm-lock.yaml` gained only the `packages/docker-publish` importer entry (`workspace:*` link to `publish-package`).
- No `dist/` files tracked (`packages/docker-publish/dist` is gitignored). No `CHANGELOG.md` change. No `process.exit()` calls; ES2018 only.

### Task DOCK-02: Define And Validate The Complete Publish Plan

Status: completed

Priority: P0

Suggested agent: container API and validation engineer

Dependencies: DOCK-01

Primary ownership:

- `packages/docker-publish/src/plan.ts`
- public types exported by `packages/docker-publish/src/index.ts`
- `packages/docker-publish/test/plan.test.ts`

Finding:

Docker builds and pushes combine at least six independent dimensions (context, Dockerfile, image name, registry, tag, platform) plus build arguments, labels, and auth. Without one validated plan, callers will concatenate references by hand, producing mistagged pushes, registry escapes, traversal outside the build context, or ambiguous digests. This is the accuracy and security foundation for everything downstream.

References:

- `packages/publish-package/src/plan.ts`
- `packages/go-release/src/plan.ts`
- `packages/publish-package/src/flags.ts:1-165`

Implementation requirements:

1. Define options and a readonly resolved plan for `cwd`, project root, images (name, context directory, Dockerfile path, target/stage), registries (hostname, repository prefix, allowlist), tags (version-derived plus `latest` policy), platforms (explicit `os/arch[/variant]` list), build arguments, labels, push policy, process limits, concurrency, docker executable, and optional verification policy.
2. Validate unknown keys and all runtime value types from config files before plan resolution. Do not rely on TypeScript casts for executable configuration.
3. Require at least one image and one registry. Reject duplicate image names, duplicate fully-qualified references, empty names, and empty registries.
4. Normalize relative paths and reject absolute context/Dockerfile escapes, `..` traversal outside the project root, NUL bytes, and Dockerfile paths that resolve outside their image context or project root.
5. Validate registries as explicit hostnames (lowercase, no scheme, no path, no userinfo, no port abuse); require an explicit allowlist match before any push. Reject Docker Hub implicit defaults unless explicitly configured.
6. Validate tags against Docker rules (lowercase, `[a-z0-9_][a-z0-9_.-]{0,127}`, max 128 chars); validate platforms against `os/arch[/variant]` tokens with a bounded known-OS/arch table plus explicit custom escape hatch documented in code.
7. Make reference formatting explicit and centralized: exactly one `formatImageReference(registry, repository, name, tag)` helper. No caller may concatenate references. Reject unsupported template tokens; no shell or code evaluation.
8. Treat build arguments and labels as untrusted data: require string-only maps, bound key count and value length, reject keys with whitespace or control characters, and forbid secret-looking keys (`*TOKEN*`, `*SECRET*`, `*PASSWORD*`) unless an explicit `allowSecretsInBuildArgs` flag is set and documented.
9. Keep the image list and registry list repository-owned; do not ship product-specific defaults.
10. Resolve the full plan without creating directories, deleting output, invoking external processes, or reading registry credentials.

Acceptance criteria:

- One fixture models a single image pushed to one registry with two platforms and a version tag.
- One fixture models two images pushed to two registries with distinct tags, build args, and labels.
- Invalid contexts, Dockerfile escapes, duplicate references, unknown config keys, malformed registries, illegal tags, malformed platforms, oversized build-arg maps, and secret-like build args fail during planning.
- Plan resolution leaves the temporary fixture byte-for-byte unchanged and performs zero process invocations.
- `pnpm --filter @repo-toolkit/docker-publish test -- plan.test.ts` passes.

Completion evidence (DOCK-02, 2026-09-10):

- Added `packages/docker-publish/src/plan.ts`: `DockerPublishOptions` + readonly `DockerPublishPlan` (`cwd` realpath project root, images with name/contextDir/dockerfile/target, registries with hostname/repositoryPrefix, tags, parsed `os/arch[/variant]` platforms, global + per-image buildArgs/labels, `buildConcurrency` default 2 max 64, `processLimits` `{timeoutMs: 600_000, maxOutputBytes: 1_048_576}`, `dockerExecutable` default `docker`, `allowSecretsInBuildArgs`/`allowCustomPlatforms` default false, `verification` `{enabled, requireDigestMatch}` default true/true, per-image + plan-level `references`). Single `formatImageReference(registry, repository, name, tag)` helper; no template tokens supported — every `{`/`}` rejected, no shell or code evaluation.
- Strict runtime validation after `requireObject`/`rejectUnknownKeys` at all five levels (options/image/registry/processLimits/verification): `>=1` image/registry/tag/platform, duplicate image names/registries/tags/platforms/fully-qualified references rejected, relative-path normalization with `..`/absolute/NUL rejection, root containment via nearest-existing-ancestor realpath plus Dockerfile-inside-context check with existence checks (read-only `lstatSync`/`realpathSync`; no mkdir/unlink, no `child_process`, no `process.env`/`process.exit` in the module), lowercase hostname rules (no scheme/path/userinfo, single numeric port 1-65535), Docker tag regex `[a-z0-9_][a-z0-9_.-]{0,127}`, known-OS/arch tables with `allowCustomPlatforms` escape hatch, string-only maps bounded to 64 entries / 128-char keys / 4096-char values with whitespace/control rejection and `TOKEN|SECRET|PASSWORD` secret guard unless `allowSecretsInBuildArgs`. No image/registry/tag/product defaults; ES2018 only (`charCodeAt` loop instead of control-char regex class).
- `src/index.ts` re-exports `resolveDockerPublishPlan` (now sync, go-release style) plus plan types only; `formatImageReference` stays exported from `./plan` so the DOCK-01 smoke contract (exact 4 runtime export keys) remains green. Placeholder build/publish/verify signatures now take required `DockerPublishOptions`.
- `test/plan.test.ts` (20 its, local `mkdtemp` fixtures, `try/finally` cleanup): single-image/2-platform fixture, two-image/two-registry fixture (8 references, distinct tags/args/labels), failures for bad/missing contexts, Dockerfile escapes, duplicate references (prefix/name overlap), unknown keys at all levels, 9 malformed registries, 8 illegal tags, malformed/unknown platforms with escape-hatch pass case, oversized/malformed/secret maps, scalar type/limit failures, defaults, plus fixture snapshot equality and module-source scans proving zero `child_process`/`spawn`/`exec*`/`process.env`/`process.exit` usage.
- Verification (repo root): `pnpm --filter @repo-toolkit/docker-publish test` — 2 files, 22 tests passed; `pnpm lint` — clean; `pnpm typecheck` — clean; `git diff --check` — clean. No `CHANGELOG.md` change. Files touched: `packages/docker-publish/src/plan.ts`, `packages/docker-publish/src/index.ts` (exports only), `packages/docker-publish/test/plan.test.ts`.

### Task DOCK-03: Add Bounded Injectable Process Execution

Status: completed

Priority: P0

Suggested agent: process-control engineer

Dependencies: DOCK-01

Primary ownership:

- `packages/docker-publish/src/runner.ts`
- `packages/docker-publish/test/runner.test.ts`

Finding:

Docker builds, pushes, and manifest inspections require external processes. The shared `ProcessRunner` in `packages/publish-package/src/runner.ts` lacks the capture, timeout, and output bounds needed for long-running daemon output, while the runners in `packages/release-artifact` and `packages/go-release` are package-owned and must not be imported cross-package. Depending on a Node-artifact or Go-release package solely for its runner would invert package ownership and harm encapsulation.

References:

- `packages/publish-package/src/runner.ts`
- `packages/release-artifact/src/index.ts`
- `packages/go-release/src/runner.ts`

Implementation requirements:

1. Define a package-local injectable runner with structured `run` and `capture` methods, explicit cwd/environment handling, timeout, kill signal, and maximum captured-output bytes.
2. Do not provide a general shell-string execution method. Every Docker invocation must be an argv array.
3. Ensure environment overrides merge with the parent environment without mutating `process.env`. Registry credentials must travel via environment or stdin, never as argv values that appear in process listings.
4. Terminate timed-out and output-overflow processes with clear errors that identify the executable without exposing secret environment values (redact via existing `redactSensitiveValues` or a package-local equivalent).
5. Preserve executable arguments exactly, including contexts containing spaces and `--build-arg KEY=VALUE` strings with special characters.
6. Make runner and process limits injectable through public options but exclude runner objects from serializable config validation.
7. Support performance observability: capture must record wall-clock duration and truncated output size without retaining unbounded buffers.
8. Use controlled Node fixture processes; tests must not require Docker, network access, or real registries.

Acceptance criteria:

- Tests cover successful execution, nonzero exit, timeout, output overflow, environment merging without `process.env` mutation, cwd handling, space-containing arguments, and secret redaction in errors.
- A hanging child is terminated and does not survive the test.
- No library path invokes `bash -c`, `sh -c`, or equivalent.
- `pnpm --filter @repo-toolkit/docker-publish test -- runner.test.ts` passes.

Completion evidence (DOCK-03, 2026-09-10):

- Added `packages/docker-publish/src/runner.ts`: package-local `DockerRunner` (`run` returns `{ durationMs }`, `capture` returns `{ stdout, stderr, durationMs, outputBytes }`) with `DockerRunOptions` (`cwd`, `env`, `stdio`, `timeoutMs`, `maxOutputBytes`, `killSignal`, `secrets`, `stdin` for `--password-stdin`). `defaultDockerRunner` uses `spawnSync(executable, [...args])` argv arrays only — no `shell`, `bash`, `sh -c`, `execFile`, or `runShell` path (verified by source scan plus a metacharacter-as-data test). Env merges via `{ ...process.env, ...options.env }` without mutating `process.env`. Defaults (`timeoutMs` 600_000, `maxOutputBytes` 1_048_576, `killSignal` `SIGKILL`) match the DOCK-02 plan limits. Timeouts (`ETIMEDOUT`) and output overflow (`ENOBUFS`, plus defense-in-depth byte check) kill the child and throw executable-identifying errors carrying `durationMs`; failure tails are truncated to 2048 chars with a `...[truncated]` marker so unbounded daemon output is never retained. Secrets (explicit `secrets` list plus all `env` values plus `stdin`) are redacted through the shared `redactSensitiveValues` from `@repo-toolkit/publish-package`, including `://user:pass@` URLs. Strict pre-spawn validation (executable/args/cwd/stdio/env/secrets/stdin/killSignal/limits) plus `validateDockerRunner` for injection; runner objects stay out of serializable plan validation (plan untouched). ES2018 only, no `process.exit()`.
- `src/index.ts` adds type-only re-exports (`DockerRunner`, `DockerRunOptions`, `DockerRunResult`, `DockerCaptureResult`); runtime export keys remain exactly the DOCK-01 four, so the smoke test stays green.
- `test/runner.test.ts` (21 its, controlled `process.execPath --eval` fixtures only, no Docker/network): run success + cwd, run argv spaces, run stdin-to-file, run nonzero exit, capture stdout/stderr/duration/outputBytes, capture cwd, spaces plus `--build-arg`/shell-metacharacter argv preservation, env merge without parent mutation, capture stdin echo, nonzero exit with tail, timeout kill (300ms) with pid-death proof, overflow kill (256B limit) with pid-death proof, tail truncation bound, env-secret redaction, stdin-secret redaction without an explicit list, credentialed-URL redaction, pre-spawn option validation, `validateDockerRunner` accept/reject, no-interpreter source scan, metacharacters-as-data probe, fixture hygiene.
- Verification (repo root): `pnpm vitest run --config vitest.config.ts test/runner.test.ts` in `packages/docker-publish` — 1 file, 21 tests passed; full `pnpm --filter @repo-toolkit/docker-publish test` — 3 files, 43 tests passed (index smoke + plan + runner); `pnpm lint` — clean; `pnpm typecheck` — clean; `git diff --check` — clean. No `CHANGELOG.md` change. Files touched: `packages/docker-publish/src/runner.ts`, `packages/docker-publish/src/index.ts` (type exports only), `packages/docker-publish/test/runner.test.ts`, this task file.

### Task DOCK-04: Build Images Without Implicit Publishing

Status: completed

Priority: P0

Suggested agent: container build engineer

Dependencies: DOCK-02, DOCK-03

Primary ownership:

- `packages/docker-publish/src/build.ts`
- `packages/docker-publish/test/build.test.ts`

Finding:

`docker build` without explicit `--load`/`--push` semantics is a classic accuracy and performance trap: multi-platform builds silently produce no local image, single-platform builds unexpectedly push, and failed builds leave half-tagged local images. The shared contract must separate build from publish, tag exactly what the plan resolved, and bound concurrent builds so a five-image matrix does not exhaust the daemon.

References:

- `packages/go-release/src/build.ts`
- `packages/docker-publish/src/plan.ts` (from DOCK-02)
- `packages/docker-publish/src/runner.ts` (from DOCK-03)

Implementation requirements:

1. Build every image for its configured platforms through the injected runner using `docker buildx build` with explicit argv (context, `-f` Dockerfile, `--platform`, `-t` per resolved reference, `--load` for single-platform local verification or metadata-only for multi-platform; never `--push` in the build path).
2. Pass build arguments and labels as separate `--build-arg KEY=VALUE` / `--label KEY=VALUE` argv entries, never interpolated. Enforce DOCK-02 bounds again at invocation time (defense in depth).
3. Support bounded build concurrency with a deterministic default (e.g. 2) and explicit positive limit. Stop scheduling new work after the first failure and await/clean already-started work. Expose per-image duration for performance visibility.
4. Tag exactly the resolved references; after build, verify expected local image IDs exist (via `docker images --format` or buildx metadata) when `--load` was used. Reject empty, missing, or unexpected local tags before reporting success.
5. On failure, remove any tags this operation created for the failed image (best-effort untag) and never leave the failure ambiguous: report image, platform set, and failing executable output tail.
6. Return a structured build result describing image, references, platforms, local image IDs (when loaded), and durations; do not infer success solely from process exit status.
7. Keep build output out of the repository: no files are written outside caller-owned temp/metadata paths except through the Docker daemon itself.

Acceptance criteria:

- Recording-runner tests assert exact executable, argv, cwd, and environment for single-image and multi-image plans, including `--platform` joins and per-reference `-t` flags.
- A test proves `--push` never appears in any build-path argv.
- Failure in one image stops new builds, untags partial results, and surfaces image identity.
- Concurrency tests prove the configured bound is not exceeded and no new build starts after a known failure.
- Space-containing contexts and special-character build args survive argv exactly.
- `pnpm --filter @repo-toolkit/docker-publish test -- build.test.ts` passes.

Completion evidence (DOCK-04, 2026-09-10):

- Added `packages/docker-publish/src/build.ts`: `buildDockerImages(options)` strips the injected `runner` (validated via `validateDockerRunner`, defaulting to `defaultDockerRunner`) before `resolveDockerPublishPlan`, then builds every planned image through a go-release-style worker pool bounded by `plan.buildConcurrency` (stop claiming new work after the first failure, await started work via `Promise.all`). Each image runs `docker buildx build` argv arrays only: `--platform` join, `-f` resolved Dockerfile, `--target` when set, `-t` per resolved reference, merged global+per-image `--build-arg KEY=VALUE` / `--label KEY=VALUE` as separate entries (sorted keys, DOCK-02 bounds re-checked: 64 entries, 128-char keys, 4096-char values, whitespace/control rejection, secret guard unless allowed), `--load` for single-platform only and neither `--load` nor `--push` for multi-platform (the module source contains no `--push`, `child_process`, `node:fs`, or `process.exit` literal). Single-platform builds are verified with `docker images --no-trunc --format {{.Repository}}:{{.Tag}} {{.ID}}` — empty/missing/unexpected/conflicting entries fail closed. Any failure triggers best-effort `docker rmi` untag (errors swallowed) and throws `Failed to build Docker image "<name>" for platforms [...]` carrying the runner output tail. Returns `{ images: [{ image, references, platforms, imageIds, durationMs }] }`; success never inferred from exit status alone. No filesystem writes — daemon only. `DockerBuildRunner` accepts sync or promise results so the default sync runner and async test doubles both work; ES2018 only.
- `src/index.ts` re-exports `buildDockerImages` plus `DockerBuildOptions`/`DockerBuildRunner`/`DockerBuildResult`/`DockerBuildImageResult` types only; runtime export keys remain exactly the DOCK-01 four, so the smoke test stays green.
- `test/build.test.ts` (13 its, recording sync/async runners, temp fixtures with `try/finally`-style cleanup): exact executable/argv/cwd/env assertions for single (`--load` + `images` verify call) and multi (`--platform` join, 4× `-t`, `--target`, merged/sorted args+labels, zero captures) plans; runtime + source proof that `--push` never appears; concurrency-1 failure stops scheduling, untags with exact `rmi` argv, and surfaces image/platforms/tail; invalid options fail before any runner call; five verification rejections (empty, missing, unexpected, malformed, conflicting) each untagging; spaces/special-character argv preservation; deferred-runner proof that 4 images never exceed bound 2 and that no new build starts after a known failure (rejection carries identity, `rmi` exact, third context never built); fixture snapshot equality proving no repo writes.
- Verification (repo root): `pnpm --filter @repo-toolkit/docker-publish test` — 4 files, 56 tests passed (43 prior + 13 new); `pnpm lint` — clean; `pnpm typecheck` — clean; `git diff --check` — clean. No `CHANGELOG.md` change. Files touched: `packages/docker-publish/src/build.ts`, `packages/docker-publish/src/index.ts` (exports only), `packages/docker-publish/test/build.test.ts`, this task file.

### Task DOCK-05: Publish To Target Registries With Digest Capture

Status: completed

Priority: P0

Suggested agent: registry publish engineer

Dependencies: DOCK-02, DOCK-03, DOCK-04

Primary ownership:

- `packages/docker-publish/src/publish.ts`
- `packages/docker-publish/test/publish.test.ts`

Finding:

Push is the highest-risk operation: a wrong reference overwrites a production tag, credentials leak into logs, and a push that reports success without a digest cannot be verified or pinned. Publish must be an explicit, allowlisted, digest-returning operation — never a side effect of build.

References:

- `packages/publish-package/src/version.ts` (redaction patterns)
- `packages/docker-publish/src/plan.ts`
- `packages/docker-publish/src/runner.ts`

Implementation requirements:

1. Push only references produced by the resolved plan and (when applicable) the DOCK-04 build result. Refuse to push any reference not in the plan, even if the daemon holds it locally.
2. Authenticate via `docker login --password-stdin` with credentials sourced from environment variables or an explicit env-name map — never from config file plaintext, never as `--password` argv, never echoed. Document the env contract.
3. Capture the content digest per pushed reference by parsing push output (`digest: sha256:...`) and/or `docker buildx imagetools inspect --format` follow-up through the injected runner. Fail closed when the digest is missing or malformed.
4. Enforce registry allowlist at publish time even if the plan was constructed programmatically (defense in depth). Support `--dry-run` short-circuit at the publish boundary for tests and CLI.
5. Bound publish concurrency separately from build concurrency; default to serial pushes unless explicitly configured, to avoid registry rate limits and confusing interleaved output.
6. Redact all secret values from summaries, errors, and captured-output tails. Truncate daemon output to the configured byte bound.
7. Return a structured publish result: reference, registry, tag, digest, size (when available), and duration. Persist a deterministic JSON digest manifest to a caller-owned path atomically (temp sibling + rename) when requested.

Acceptance criteria:

- Recording-runner tests assert exact login/push/inspect argv sequences, stdin usage for passwords, and env sourcing without plaintext config secrets.
- Pushing an off-plan reference fails before any runner call.
- Missing or malformed digests fail closed; valid pushes return pinned `sha256:` digests.
- Error and summary outputs contain no secret values under redaction tests.
- Digest manifest writes are atomic and sorted by reference.
- `pnpm --filter @repo-toolkit/docker-publish test -- publish.test.ts` passes.

Completion evidence (DOCK-05, 2026-09-10):

- Added `packages/docker-publish/src/publish.ts`: `publishDockerImages(options)` strips publish-only keys (`runner`, `dryRun`, `publishConcurrency`, `references`, `auth`, `digestManifestPath`) before `resolveDockerPublishPlan`, then validates every requested reference against the resolved plan (duplicate/off-plan refusal plus hostname allowlist re-check, all before any runner call) and validates the manifest path stays inside the project root. Auth maps registry hostnames to `{ usernameEnv, passwordEnv }` env names (validated `/^[A-Za-z_][A-Za-z0-9_]*$/`); missing/empty env credentials fail closed before any push. Logins run once per needed registry up front via `docker login --username <user> --password-stdin <hostname>` with the password as `stdin` only (never `--password` argv, never config plaintext, never echoed; `secrets` forwarded to every runner call). Each reference is pushed with `docker push <ref>` then inspected with `docker buildx imagetools inspect --format {{json .Manifest}} <ref>`; the push digest (`digest: sha256:<64-hex>`, strict, malformed/ambiguous tokens fail closed) and the inspect `"digest"` field must agree when both are present, the inspect digest is the fallback when push output carries none, and absence of both fails closed. Worker pool bounded by `publishConcurrency` (default 1 serial, max 64, separate from `buildConcurrency`; stops claiming new work after the first failure and awaits started work). All failures carry reference/registry identity with `redactSensitiveValues`-redacted, 2048-char-truncated tails; manifest failures attach `cause` per the `preserve-caught-error` convention. Returns `{ publishes: [{ reference, registry, tag, digest, durationMs }] }` sorted by reference; `dryRun: true` returns `{ publishes: [] }` after plan validation with zero runner calls, zero credential reads, and zero manifest writes. `digestManifestPath` (relative, no `..`, root-contained) writes pretty-printed sorted `{ reference: digest }` JSON plus trailing newline atomically (`mkdir -p`, tmp sibling `.<pid>` + `renameSync`, tmp removed on failure). No `child_process`, no shell, no `process.exit`, ES2018 only.
- `src/index.ts` replaces the `DockerPublishResult` placeholder with re-exports from `./publish` (`publishDockerImages`, `DockerPublishedImage`, `DockerPublishImagesOptions`, `DockerPublishRegistryAuth`, `DockerPublishResult`, `DockerPublishRunner`); runtime export keys remain exactly the DOCK-01 four, so the smoke test stays green.
- `test/publish.test.ts` (21 its, recording/deferred runners, temp fixtures, `try/finally` auth-env restore): exact login/push/inspect argv + stdin + env sourcing, once-per-registry login with plan-order pushes, login skip without auth entries, off-plan/unlisted/duplicate refusal with zero runner calls, missing/malformed-push/malformed-inspect/mismatch fail-closed plus inspect fallback success, password redaction in errors with `[redacted]` marker plus no-password-in-argv proof, login-failure identity without secrets, `--password-stdin`-only plus no-shell/child_process source scan, dry-run with zero calls and no fixture writes, atomic sorted manifest (exact key order, trailing newline, no tmp leftovers), root-escape manifest rejection before any runner call, serial-by-default proof (second push never starts while the first is pending, peak 1) plus explicit `publishConcurrency: 2` proof (peak 2, sorted result), invalid concurrency and missing-env-credential failures before any push.
- Verification (repo root): `pnpm --filter @repo-toolkit/docker-publish test -- publish.test.ts` — 1 file, 21 tests passed; full `pnpm --filter @repo-toolkit/docker-publish test` — 5 files, 77 tests passed; `pnpm lint` — clean; `pnpm typecheck` — clean; `git diff --check` — clean. No `CHANGELOG.md` change. Files touched: `packages/docker-publish/src/publish.ts`, `packages/docker-publish/src/index.ts` (exports only), `packages/docker-publish/test/publish.test.ts`, this task file.

### Task DOCK-06: Verify Published Manifests

Status: completed

Priority: P0

Suggested agent: container verification engineer

Dependencies: DOCK-02, DOCK-03, DOCK-05

Primary ownership:

- `packages/docker-publish/src/verify.ts`
- `packages/docker-publish/test/verify.test.ts`

Finding:

A push that is not verified is only a claim. Consumers need proof that each expected reference resolves in the target registry, that digests match the publish result, and that platform lists equal the plan. Without strict verification, stale caches, partial pushes, or tag moves go undetected.

References:

- `packages/go-release/src/verify.ts`
- `packages/release-artifact/src/index.ts` (manifest validation patterns)

Implementation requirements:

1. Verify each expected reference by inspecting the registry manifest through the injected runner (`docker buildx imagetools inspect --raw` or `docker manifest inspect`), parsing JSON defensively with bounds (max bytes, valid JSON, required mediaType/digest/config fields).
2. Require the reference set to equal the resolved plan exactly; no missing or additional tags are permitted. Compare digests case-sensitively against publish results or an input digest manifest; fail closed on mismatch.
3. Validate platform lists: every planned `os/arch[/variant]` must appear in the published manifest/index; unexpected platforms fail verification.
4. Bound inspection through the injected runner (timeout, output cap). Never pull images during verification unless an explicit `pull: true` option is set; default to manifest-only inspection for speed and safety.
5. Always clean temporary inspection files in `finally`. Verification must not write tags, mutate the daemon, or require push credentials beyond read access.
6. Return structured verification evidence (reference, expected digest, observed digest, platforms, match flag) suitable for CLI reporting and CI summaries.

Acceptance criteria:

- Fixtures cover digest match, digest mismatch, missing reference, additional registry tag, platform subset, platform superset, malformed JSON, and oversized manifest — each failing closed except the exact-match case.
- Verification performs zero pushes and (by default) zero pulls.
- Temporary files are removed after success and every forced failure.
- `pnpm --filter @repo-toolkit/docker-publish test -- verify.test.ts` passes.

Completion evidence (DOCK-06, 2026-09-10):

- Added `packages/docker-publish/src/verify.ts`: `verifyDockerPublish(options)` strips verify-only keys (`runner`, `references`, `expectedDigests`, `pull`, `maxManifestBytes`) before `resolveDockerPublishPlan`, rejects `pull: true` (manifest-only inspection; `pull` must otherwise be a boolean), then requires the requested `references` to equal the plan set exactly (missing/additional fail before any runner call) and requires `expectedDigests` mapping every planned reference to a strict lowercase `sha256:<64-hex>` digest (missing/additional/malformed fail before any runner call). Each reference is inspected serially via the injected runner with `docker buildx imagetools inspect --raw <ref>` bounded by `plan.processLimits` (timeout, output cap) plus a `maxManifestBytes` bound (default `min(processLimits.maxOutputBytes, 1_048_576)`); oversized output fails closed. Raw output is written to a root-contained `mkdtempSync(join(plan.cwd, '.docker-publish-verify-'))` snapshot (one `<index>.json` per reference, read back before parsing) and the directory is removed in `finally`. JSON parses defensively (`cause`-attached errors); manifests must be objects with non-empty `mediaType`, strict top-level `digest`, and either a non-empty `manifests` index array (each entry with a `platform` object carrying `os` plus `architecture`/`arch` and optional `variant`, duplicates rejected) or a `config` object with a strict digest plus a top-level `platform` object (single-image path). Observed platforms must equal the planned `os/arch[/variant]` set exactly (missing vs unexpected reported separately); digests compare case-sensitively with `===` and mismatch fails closed unless plan `verification.requireDigestMatch` is false. Returns `{ verified: true, references: [{ reference, expectedDigest, observedDigest, platforms, match }] }` sorted by reference. Only `capture` is ever called (the module never issues `run`/`push`/`pull`/`login` argv); ES2018 only, no `process.exit()`, `cause` attached on caught-error rethrows per the `preserve-caught-error` convention.
- `src/index.ts` re-exports `verifyDockerPublish` plus `DockerVerifiedReference`/`DockerVerifyOptions`/`DockerVerifyResult`/`DockerVerifyRunner` types from `./verify`; runtime export keys remain exactly the DOCK-01 four, so the smoke test stays green.
- `test/verify.test.ts` (12 its, recording runners whose `run` throws to prove capture-only use, temp fixtures): exact-match evidence (fields, exact inspect argv, cwd, limits), single-image config-manifest success, digest mismatch plus uppercase-digest malformed failure, inspection failure (missing ref) with tmp cleanup, additional reference rejected with zero runner calls, missing/empty/extra/malformed/omitted digest maps rejected with zero calls, platform subset (`missing expected platform(s)`) and superset (`unexpected platform(s)`) failures, malformed JSON, six missing-field payloads, oversized manifest (`maxManifestBytes: 32`) plus invalid bound, `pull: true` rejection with zero calls, and manifest-only assertions (every call is `capture`, no `push`/`pull`/`login` argv) plus `.docker-publish-verify-*` absence checks after every success and failure.
- Verification (repo root): `pnpm --filter @repo-toolkit/docker-publish test -- verify.test.ts` — 6 files, 89 tests passed (77 prior + 12 new); `pnpm lint` — clean; `pnpm typecheck` — clean; `git diff --check` — clean. No `CHANGELOG.md` change. Files touched: `packages/docker-publish/src/verify.ts`, `packages/docker-publish/src/index.ts` (exports only), `packages/docker-publish/test/verify.test.ts`, this task file.

### Task DOCK-07: Implement Build, Publish, And Unified CLIs

Status: completed

Priority: P1

Suggested agent: CLI contract engineer

Dependencies: DOCK-02, DOCK-04, DOCK-05, DOCK-06

Primary ownership:

- `packages/docker-publish/src/cli.ts`
- `packages/docker-publish/src/cli-build.ts`
- `packages/docker-publish/src/cli-publish.ts`
- CLI-related exports only when needed for tests
- `packages/docker-publish/test/cli.test.ts`

Finding:

The package needs stable automation entrypoints that compose existing config helpers and expose library behavior without embedding CI semantics. Existing repository conventions require `FlagSpec[]`, strict parsing, config-first/CLI-second precedence, help on `null`, and `process.exitCode` at error boundaries. Without this, each consumer reinvents flag parsing and secrets end up in argv.

References:

- `AGENTS.md` (CLI argument parsing section)
- `packages/publish-package/src/flags.ts:1-165`
- `packages/publish-package/src/prompt.ts`
- `packages/go-release/src/cli-build.ts`
- `packages/go-release/src/cli-verify.ts`

Implementation requirements:

1. Use `parseFlags` and `loadConfigFile`; validate loaded config with DOCK-02 before execution.
2. Make CLI precedence explicit: config supplies defaults and explicit CLI flags override them. Document every override.
3. Build CLI supports plan display/dry-run, image filtering (`--image`), platform filtering (`--platform`), registry override, and bounded concurrency without positional subcommands.
4. Publish CLI supports image filtering, registry filtering, `--dry-run`, `--skip-build` (publish prebuilt local images), digest-manifest output path, and optional `--verify` follow-up via DOCK-06.
5. Unified CLI dispatches build/publish/verify semantics via explicit flags (not positional subcommands) and shares the same config/override helper.
6. Dry-run resolves and prints the full plan (images, references, platforms) without invoking Docker and without requiring daemon access.
7. Print secrets-free deterministic summaries (references, digests, durations). Do not dump inherited environments, runner objects, build-arg secret values, or executable paths beyond the configured docker binary name.
8. End all CLIs with `main().catch(...)`, print a concise error, and set `process.exitCode = 1`. Keep CI-specific output files and registry mutation outside the CLI.
9. Test help, unknown flags, missing values, config precedence, invalid config, dry-run non-mutation, success, process failure, secret redaction, and exit-code behavior.
10. Add packed-package smoke coverage proving all bins retain shebangs, import ESM correctly, and run help from an unpacked npm tarball (use `/tmp` for pack destinations).

Acceptance criteria:

- CLI help and README option tables agree.
- Dry-run invokes no external process and leaves fixtures unchanged.
- Invalid config fails before any runner call.
- All packed bins execute `--help` under Node 20-compatible semantics.
- Error paths set a nonzero exit code without calling `process.exit()`.
- Secret-like values never appear in CLI stdout/stderr under redaction tests.
- `pnpm --filter @repo-toolkit/docker-publish test -- cli.test.ts` passes.

Completion evidence (DOCK-07, 2026-09-10):

- Added `packages/docker-publish/src/cli-options.ts`: shared `resolveDockerPublishCliOptions` (`loadConfigFile` + `parseFlags` result, `runner` rejected as library-only, `auth`/`digestManifestPath`/`publishConcurrency`/`expectedDigests` passed through while the remainder validates through DOCK-02 `resolveDockerPublishPlan`, full-plan resolution then `--image`/`--platform`/`--registry` allowlist filtering with duplicate/unknown-filter errors, options rebuilt from the plan and re-resolved), secrets-free `planSummary` (operation, dryRun, dockerExecutable, cwd, concurrency, tags, platforms, registries, per-image references — never build-arg/label values, env, or runner), `printSummary`, `collectCliSecrets` (build-arg/label values plus auth env values), `reportCliError` (redacts before `console.error`), `positiveInteger`, `--publish-concurrency`/`--digest-manifest` resolvers. ES2018 only, no `process.exit()`.
- `src/cli-build.ts`: `--config/--cwd/--image/--platform/--registry/--concurrency/--docker-executable/--dry-run`, no positional subcommands; dry-run prints the full plan with zero processes; otherwise `buildDockerImages` then a deterministic summary (references, platforms, image IDs, durations).
- `src/cli-publish.ts`: `--config/--cwd/--image/--registry/--concurrency/--publish-concurrency/--docker-executable/--digest-manifest/--skip-build/--verify/--dry-run`; builds first unless `--skip-build` (publish prebuilt), publishes only planned references, writes the atomic sorted digest manifest when requested, chains DOCK-06 verify with publish digests on `--verify`.
- `src/cli.ts` (unified): explicit `--build/--push/--verify` flags, no positional subcommands (positionals fail strict parsing); no flag defaults to build+push; `--verify` without `--push` uses config `expectedDigests`; dry-run prints plan + selected operations. All three CLIs end `main().catch` setting `process.exitCode = 1`.
- `test/cli.test.ts` (10 its, temp fixtures, fake `docker` node executable, `/tmp` pack dirs): help + README table agreement for all three bins, unknown/missing/positional rejection, config-default/CLI-override precedence with image+platform+registry filtering, invalid-config/unknown-filter/`runner`-key failures before any process with marker proof, dry-run tree-snapshot + marker zero-call proof, build/publish/verify success with sorted manifest bytes, publish-default and unified flag chaining, env-sourced login with password-free output, argv-echo failure redaction (`[redacted]`, no secret, empty stdout), `process.exit(` source scan, packed-tarball smoke (shebangs, `--help` for all 3 bins, ESM keys, packed dry-run).
- `test/index.test.ts`: placeholder `not yet implemented` assertion replaced with fail-closed validation errors (CLIs are now implemented). `README.md`: Build/Publish/Unified option tables matching help output plus config-precedence/auth/dry-run documentation.
- Verification (repo root): `pnpm --filter @repo-toolkit/docker-publish test` — 7 files, 99 tests passed (89 prior + 10 new); `pnpm --filter @repo-toolkit/publish-packages test` — 3 files, 85 tests passed; `pnpm lint` — clean; `pnpm typecheck` — clean; `git diff --check` — clean. No `CHANGELOG.md` change. No plan/runner/build/publish/verify logic touched.

### Task DOCK-08: Complete Documentation And Consumer Examples

Status: completed

Priority: P2

Suggested agent: container tooling documentation engineer

Dependencies: DOCK-07

Primary ownership:

- `packages/docker-publish/README.md`
- `website/docs/packages/docker-publish.md`
- `website/docs/packages/index.md`
- `README.md`
- `AGENTS.md`
- example configuration fixtures under `packages/docker-publish/test/fixtures/` if retained as tested examples

Finding:

The package contract is not usable unless maintainers can map single-image and multi-image layouts to configuration, understand build-vs-publish separation, registry allowlisting, auth env contracts, and verification semantics. Repository contract tests also require package membership documentation.

References:

- `README.md`
- `AGENTS.md`
- `website/docs/packages/index.md`

Implementation requirements:

1. Document library API, all CLIs, config precedence, defaults, external tool requirements (Docker + buildx), deterministic tag contract, digest format, push atomicity boundaries, process limits, and dry-run behavior.
2. Include one tested single-image configuration and one tested multi-image multi-registry configuration. Tests must require website JSON blocks to equal those fixtures and drive both through plan resolution, dry-run, build, publish, and verify with fake runners.
3. Show thin Makefile targets and CI steps that consume the CLI without claiming the package creates tags, SBOMs, provenance, images registries, or GitHub Releases.
4. Document registry auth contract (env names, `--password-stdin`, redaction), allowlist semantics, and platform support.
5. Document migration caveats: tag naming, `latest` policy, load-vs-push separation, and managed digest manifests.
6. Update `AGENTS.md` package layout and commands so future agents discover the package and required verification. Emphasize readability (naming, module boundaries), accuracy (reference formatting, digest pinning), security (auth, allowlist), performance (concurrency defaults), and testability (fake runners) in the guide.
7. Keep detailed guides in website docs and the package README concise. Every documented flag must be exercised by CLI tests or generated from the same source as help.

Acceptance criteria:

- A maintainer can model single-image and multi-image multi-registry layouts from the documented options.
- Every documented command and flag is exercised by CLI tests or generated from the same source as help.
- Root README, package README, website index, dedicated website page, and `AGENTS.md` agree on package and bin names.
- `pnpm --filter @repo-toolkit/publish-packages test` passes repository documentation contracts.

Completion evidence (DOCK-08, 2026-09-10):

- `packages/docker-publish/README.md` (concise): kept all three `--help`-matching option tables byte-identical, added Configuration (precedence/defaults pointer), real Library API snippet, auth env contract summary, tested-examples pointer, and Non-Goals. No new flag tables, so `cli.test.ts` help/README agreement still passes.
- `website/docs/packages/docker-publish.md` (detailed): fixed the stale positional-subcommand CLI usage to explicit `--build`/`--push`/`--verify` flags; added tested single-image and multi-image-multi-registry configs behind `<!-- example:... -->` markers (parsed-object-equal to fixtures), full config reference with defaults, precedence, tag/reference contract, digest format, push boundaries, process limits, auth contract, allowlist, platforms, latest policy, load-vs-push separation, digest manifests, thin Makefile + CI snippets (no SBOM/provenance/tag claims), migration caveats, library API, and non-goals.
- `packages/docker-publish/test/fixtures/single-image/docker-publish.json` (1 image × 1 registry × 1 tag × 2 platforms = 1 reference) and `test/fixtures/multi-image-multi-registry/docker-publish.json` (2 images × 2 registries × 2 tags × 2 platforms = 8 references, distinct buildArgs/labels).
- `packages/docker-publish/test/examples.test.ts` (4 its): website JSON blocks parsed-object-equal fixtures; each example resolved, CLI `--dry-run` with never-invoked executable, built/published/verified with one injected fake runner (no daemon/network), asserting no `--push` in build argv, strict `sha256:` digests, sorted atomic manifest bytes, exact platform evidence, and temp-dir cleanup.
- `README.md` membership only: added the missing `pnpm docker-publish -- --config docker-publish.json --build --push` root-script line. `website/docs/packages/index.md` already listed the package; unchanged. `AGENTS.md` membership only: layout bullet (readability/accuracy/security/performance/testability emphases), three command lines, fake-runner test guidance.
- Verification (repo root): `pnpm --filter @repo-toolkit/docker-publish test` — 8 files, 103 tests passed (99 prior + 4 new); `pnpm --filter @repo-toolkit/publish-packages test` — 3 files, 85 tests passed; `pnpm lint` — clean; `pnpm typecheck` — clean; `git diff --check` — clean. No `CHANGELOG.md` change. No `src/` logic touched.

### Task DOCK-09: Perform Independent Integration And Security Review

Status: completed

Priority: P0

Suggested agent: independent container security reviewer who did not implement DOCK-02 through DOCK-07

Dependencies: DOCK-01 through DOCK-08

Primary ownership:

- review of all `packages/docker-publish/` files
- focused corrective changes discovered during review
- completion evidence in this task document

Finding:

The package controls executable invocation, tag derivation, registry pushes, and credential handling. Independent review is required before publication because a reference, process, or auth defect could overwrite production tags, leak secrets, push to an unscoped registry, or accept unverified manifests.

References:

- all DOCK task acceptance criteria
- `packages/publish-packages/test/contract.test.ts:78-349`

Implementation requirements:

1. Review every configured path from parse through filesystem and daemon use and prove containment at the final mutation boundary (context, Dockerfile, manifest output paths).
2. Review every external process invocation for structured arguments, bounded execution, controlled environment, secret redaction, and clear failure propagation. Prove `--push` never appears in the build path and off-plan references never reach push.
3. Exercise negative fixtures (traversal contexts, Dockerfile escapes, illegal tags, unlisted registries, secret build args, malformed digests, platform mismatches) and confirm pushes fail before runner invocation where applicable.
4. Force failures during build, login, push, digest capture, manifest inspection, and verification; verify partial tags are untagged or clearly reported and temporary content is cleaned.
5. Compare public types, runtime config validation, CLI help, package README, and website documentation for one contract. Verify readability (a new reader can trace plan → build → publish → verify), accuracy (references and digests exact), performance (bounds honored), and encapsulation (no cross-package runner imports, single reference formatter).
6. Pack the package and run all bins from the packed artifact with controlled fake tools (use `/tmp` for pack output).
7. Run package-level and full-repository verification serially because package tests rebuild dependency outputs.
8. Record any deferred issue with owner, rationale, and residual risk. Do not mark the task complete while a P0 or P1 acceptance criterion is unresolved.

Acceptance criteria:

- Every prior task's acceptance criteria is confirmed against runtime behavior, not only code inspection.
- No configured path can escape project or context boundaries; no push can reach an unlisted registry.
- No secret value appears in argv, logs, summaries, or errors.
- Failed operations report image identity, clean temporary content, and leave no ambiguous tags.
- Packed library exports, declarations, and all bins work.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test` pass.
- The reviewer records commands, test counts, relevant artifact checks, and any residual risk in completion evidence.

Completion evidence (DOCK-09, 2026-09-10, independent reviewer — did not implement DOCK-02..07):

- Corrections (4; all within `packages/docker-publish/`, plus one website-doc sentence):
  1. P0 — Dockerfile context escape via symlink (fixed in `src/plan.ts`): the inside-context check compared the lexical Dockerfile path against the real context dir, so `services/app/link/Dockerfile` (with `link` symlinked to `services/other`) resolved and was accepted although the real file lived outside the image context. Probe against pre-fix `dist` confirmed acceptance. Fix: existence check first, then `realpathSync` the Dockerfile and require the real path to sit inside the real context dir; the stored `resolvedDockerfile` is now the real path. Regression test added in `test/plan.test.ts` (`rejects Dockerfiles that escape their image context through symlinks`); post-fix probe rejects with `must resolve inside its image context`.
  2. P0 — digest-manifest symlink-dir escape (fixed in `src/publish.ts`): `resolveManifestPath` enforced only a lexical root check, so `digestManifestPath: linkdir/digests.json` (with `linkdir` symlinked outside the project root) passed validation and `mkdirSync -recursive` + write landed outside the root — confirmed by probe (`outside/digests.json` existed after publish). Fix: nearest-existing-ancestor `realpathSync` containment check (same shape as the plan helper) at the publish boundary, before any runner call. Regression test added in `test/publish.test.ts` (zero runner calls, no outside file); post-fix probe rejects with `digestManifestPath escapes the project root` and writes nothing.
  3. P1 — unified CLI `--verify` without `--push` ignored `--image`/`--registry` filters for digests (fixed in `src/cli.ts`): all config `expectedDigests` keys were forwarded, so a filtered run failed spuriously on `unexpected reference(s)`. Fix: forward only digests for references in the filtered plan (missing digests still fail closed inside verify). CLI regression test added in `test/cli.test.ts` (`verifies a filtered image against expectedDigests without pushing`, fake-docker executable, status 0, exactly the filtered reference verified).
  4. P1 — `verification.enabled` validated but never consumed (fixed in `src/verify.ts`): configs with `enabled: false` previously verified anyway. `verifyDockerPublish` now refuses with `verification.enabled is false` before any runner call (zero captures, no temp dir left behind). Regression test added in `test/verify.test.ts`; `website/docs/packages/docker-publish.md` verification row now documents the refusal semantics.
- Containment proof (post-fix, built `dist`): context symlink to outside root rejected; Dockerfile symlink across contexts rejected; `..`/absolute/NUL Dockerfile and context inputs rejected; `../evil.json` manifest rejected; symlinked-dir manifest rejected with zero runner calls and zero writes; `relative()`-based `isPathWithin` rejects prefix-collision siblings (`root-evil` → `../root-evil`); verify temp dirs use `mkdtempSync` inside the real cwd with `finally` removal (tests assert absence after every success and failure).
- Process audit (post-fix): `rg` over `src/` shows no `shell`/`bash -c`/`sh -c`/`child_process` outside `runner.ts` `spawnSync(executable, [...args])` argv arrays; `--push` occurs only as the unified-CLI operation flag name, never in `build.ts` argv (asserted by tests at argv and source level); env merges via spread without mutating `process.env`; passwords travel via `stdin` with `--password-stdin` only (no `--password` argv); all runner errors redact via `redactSensitiveValues` with 2048-char tails; build and publish concurrency bounded (defaults 2 and 1, max 64); off-plan/duplicate/unlisted-registry references refused before any runner call; single `formatImageReference` helper, no hand concatenation.
- Negative sweep (post-fix `dist`, all fail closed): traversal context, absolute Dockerfile, illegal tag, secret build arg, unknown key, schemed registry, 4-segment platform, unlisted-registry push (0 runner calls), malformed push digest, login failure (registry identity, secrets redacted), build failure (image + platform identity, best-effort `docker rmi` untag observed in runner calls).
- Drift comparison: index runtime exports remain exactly the 4 planned names (smoke test green); every `DockerPublishOptions`/`DockerPublishImagesOptions`/`DockerVerifyOptions`/`DockerBuildOptions` key is either plan-validated or a documented stripped extra; CLI help vs README option tables enforced by `cli.test.ts`; website config/CLI/auth/tag/digest/push/process/platform/manifest semantics match runtime (one sentence corrected for `verification.enabled`); `verification.enabled` now consumed; no `process.exit(`, ES2018 only, `typecheck` clean.
- Pack check (`/tmp/dock09-pack/repo-toolkit-docker-publish-0.0.0-PLACEHOLDER.tgz`, SHA256 `d5e4eb5e55cdb7227ff97d89ca4cd531877991313cd56b5af9bf59968a85aec4`): tarball contains `dist/cli.js`, `cli-build.js`, `cli-publish.js`, `index.js`, `index.d.ts`; unpacked to `/tmp/dock09-unpack` with the workspace `publish-package` symlinked (external dep, same as the in-repo pack test): all 3 bins print `--help` with status 0, packed ESM imports with keys `buildDockerImages,publishDockerImages,resolveDockerPublishPlan,verifyDockerPublish`.
- Serial verification (repo root): `pnpm lint` clean; `pnpm typecheck` clean; `pnpm build` success; `pnpm test` (workspace-concurrency=1) — 8 suites, 56 files, 1255 tests, all passed (per-package: 7/209, 3/81, 18/225, 7/343, docker-publish 8/107, 9/105, publish-packages 3/85, 1/100). `git diff --check` clean; `git ls-files packages/docker-publish` empty (no `dist/` tracked, gitignored); no `CHANGELOG.md` change.
- Residual risks (no P0/P1 unresolved): real-daemon envelope shapes (`imagetools --raw` top-level `digest`, `--format {{json .Manifest}}` digest field) are defined by fake-runner fixtures, not a live registry — covered by deferred decision 4 (maintainer-owned real-daemon e2e); check-then-use symlink swaps between plan resolution and daemon/mkdir use are out of threat scope (local attacker with write access already owns the root); digest-manifest sibling temp name (`<path>.tmp-<pid>`) could collide across concurrent same-pid-namespace publishers to the same path — writes are atomic renames but concurrent publishers can overwrite each other (caller-owned path, document if shared); single-character env credentials over-redact log text (cosmetic, only when secrets are ≤2 chars).

## Dependency And Parallelization Guidance

Recommended allocation:

| Wave | Task    | Agent focus         | Parallel guidance                                                             |
| ---- | ------- | ------------------- | ----------------------------------------------------------------------------- |
| 1    | DOCK-01 | package scaffolding | Run alone; owns root metadata and initial docs membership.                    |
| 1    | DOCK-02 | plan and validation | Starts after DOCK-01.                                                         |
| 2    | DOCK-03 | process runner      | May run in parallel with DOCK-02 after DOCK-01 because ownership is separate. |
| 2    | DOCK-04 | build engine        | Starts after DOCK-02 and DOCK-03.                                             |
| 3    | DOCK-05 | publish and digests | Starts after DOCK-02, DOCK-03, and DOCK-04.                                   |
| 3    | DOCK-06 | verification        | Starts after DOCK-05. May overlap with DOCK-05 fixture design with care.      |
| 4    | DOCK-07 | CLIs                | Starts after all library operations stabilize.                                |
| 5    | DOCK-08 | final docs          | Runs after CLI names, flags, and config are stable.                           |
| 5    | DOCK-09 | independent review  | Runs alone after all implementation tasks.                                    |

Shared hotspots:

- `packages/docker-publish/src/index.ts` is export-only after scaffolding. Each implementation agent adds exports narrowly and coordinates before editing.
- `packages/docker-publish/test/fixtures/` must have one owner at a time. Prefer task-local fixture builders to avoid concurrent edits.
- Root `package.json`, `tsconfig.base.json`, root README, website index, and `AGENTS.md` are owned by DOCK-01 or DOCK-08 only.
- Do not run root `pnpm build` or `pnpm test` concurrently because package test scripts rebuild dependency closures and share `dist/` outputs.

## Wave Verification

After Wave 1:

```sh
pnpm --filter @repo-toolkit/docker-publish... build
pnpm --filter @repo-toolkit/docker-publish test
pnpm --filter @repo-toolkit/publish-packages test
```

After Waves 2 through 4:

```sh
pnpm --filter @repo-toolkit/docker-publish test
pnpm lint
pnpm typecheck
```

After Wave 5:

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

## Deferred Follow-Up Decisions

These decisions do not block the initial package and must not be silently added to its scope:

1. Whether generic runner primitives should later move from package-local implementations into a neutral shared package.
2. Whether to add a language-neutral release-context package for SemVer, tag/SHA identity, and OCI metadata derivation.
3. Whether to support OCI layout exports, `docker save` tarballs, or registry-to-registry copy without a daemon.
4. Whether CI should run a real-daemon end-to-end fixture against an ephemeral local registry in addition to fake-runner tests.
5. Whether to add SBOM, signature, or provenance generation on top of verified digests.
6. Whether to support Helm chart or Compose service publishing derived from the same plan.

## Definition Of Done

- `@repo-toolkit/docker-publish` is publishable under repository contracts and exposes the planned library API and three bins, with working code and working CLIs.
- Single-image and multi-image multi-registry configurations resolve, build, publish, and verify successfully in isolated tests with no daemon or network.
- All path, process, registry, and credential mutations are bounded, allowlisted, redacted, and fail closed.
- Readability (thin CLIs, single formatter, documented modules), accuracy (exact references and digests), security (containment, auth, allowlist), performance (bounded concurrency, manifest-only verify), and architectural health (encapsulated runner, reusable plan, injectable test seams) are demonstrated by tests and review.
- Package README, website docs, root README, and `AGENTS.md` accurately describe the same behavior.
- An independent reviewer completes DOCK-09 and records verification evidence.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test` pass from the repository root.
- SBOM, scanning, daemon provisioning, and deployment work remain explicitly deferred rather than hidden in the implementation.
