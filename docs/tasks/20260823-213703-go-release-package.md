# Go Release Package

Created: 2026-08-23 21:37:03

Status: completed

## Objective

Add a publishable `@repo-toolkit/go-release` package that safely plans, builds, archives, checksums, and verifies deterministic cross-platform Go binary releases. The package must replace duplicated release mechanics found in `_database-tools`, `_aiproxy`, and `_s3proxy` without absorbing application-specific integration tests, deployment policy, or arbitrary CI command orchestration.

The package is successful when one configuration model supports both single-binary releases such as `aiproxy` and `s3proxy` and multi-binary releases such as `database-tools`, while preserving atomic output, reproducible archives, strict archive validation, and testability without network access or a host Go installation.

## Confirmed Reuse Opportunity

All three reference repositories implement the same release concepts independently:

- Cross-compilation with `CGO_ENABLED=0`, `GOOS`, `GOARCH`, `-trimpath`, `-buildvcs=false`, and linker-injected versions.
- A common 13-target release matrix across `_aiproxy` and `_s3proxy`; `_database-tools` extends it with additional targets and a second binary.
- One deterministic `tar.gz` archive per platform using sorted entries, fixed timestamps, numeric ownership, and gzip timestamp suppression.
- Archive member validation and SHA-256 manifests.
- Temporary staging or atomic replacement to prevent failed builds from publishing partial output.
- Release verification that feeds GitHub Release SBOM and provenance steps.

Primary evidence:

- `/home/jahn/projects/_aiproxy/Makefile:9-122`
- `/home/jahn/projects/_aiproxy/scripts/check-reproducible-archives.sh:1-19`
- `/home/jahn/projects/_aiproxy/scripts/validate-build-atomicity.sh:1-74`
- `/home/jahn/projects/_database-tools/Makefile:6-115`
- `/home/jahn/projects/_database-tools/.github/workflows/release.yml:65-100`
- `/home/jahn/projects/_s3proxy/Makefile:11-100`
- `/home/jahn/projects/_s3proxy/.github/workflows/release.yml:41-74`

The existing `@repo-toolkit/release-artifact` package is not the implementation home for this work. It discovers npm package bins, generates Node wrappers, installs pnpm production dependencies, and creates one Node application archive. Its bounded runner, path containment, archive safety, manifest validation, and atomic installation patterns are relevant, but Go-specific branching must not be added to its Node-oriented build pipeline.

Relevant toolkit evidence:

- `packages/release-artifact/src/index.ts:36-103`
- `packages/release-artifact/src/index.ts:608-678`
- `packages/release-artifact/src/index.ts:843-895`
- `packages/release-artifact/src/index.ts:998-1199`
- `packages/release-artifact/src/index.ts:1431-1511`
- `packages/publish-package/src/flags.ts:1-165`
- `packages/publish-package/src/prompt.ts:9-105`
- `packages/publish-packages/test/contract.test.ts:78-349`

## Scope

The first release must provide:

- A public plan API for one or more Go binaries and an explicit target matrix.
- Runtime validation for JSON or JavaScript configuration loaded through existing toolkit helpers.
- Structured, bounded, injectable external process execution.
- Atomic per-target and full-release build staging.
- Deterministic per-platform `tar.gz` archives with configurable additional regular files.
- A deterministic SHA-256 manifest.
- Strict pre-extraction and post-extraction archive verification.
- Optional host-compatible binary version-command verification.
- Independent rebuild and byte-for-byte reproducibility verification.
- Build and verify CLIs that follow repository conventions.
- Isolated tests using temporary repositories and controlled fake executables/runners.

## Working Rules

- Treat `/home/jahn/projects/_database-tools`, `/home/jahn/projects/_aiproxy`, and `/home/jahn/projects/_s3proxy` as read-only reference repositories. Consumer migrations require separate maintainer approval and are not part of this task file.
- Do not revert or rewrite unrelated worktree changes. Inspect `git status --short` before each task and coordinate if another agent owns a shared file.
- Do not add a runtime dependency unless the standard library and existing toolkit dependencies cannot implement the requirement safely. Record the concrete reason before adding one.
- Use structured executable and argument arrays. Do not interpolate repository configuration into shell commands.
- Keep all configured and generated output paths inside the resolved release output directory.
- Resolve and validate the complete plan before deleting, replacing, or creating release output.
- Preserve the repository's ES2018 typechecking target. Do not use post-ES2018 library APIs such as `Array.prototype.at` or `Object.hasOwn`.
- Do not call `process.exit()` from library or CLI code. CLI boundaries set `process.exitCode = 1`.
- Use `parseFlags`, `loadConfigFile`, and applicable value helpers from `@repo-toolkit/publish-package`; do not add a CLI parsing library.
- Use `apply_patch` for manual edits and keep generated `dist/` content out of commits.
- Add completion evidence to this file as each task is finished. A task is not complete until its required verification passes or a blocker is recorded.

## Non-Goals

- Creating or pushing Git tags.
- Creating GitHub Releases or uploading assets.
- Generating SBOMs, signatures, or attestations; workflows can consume verified output from this package.
- Building or publishing container images.
- Running arbitrary test, lint, integration, Compose, or deployment command pipelines.
- Parsing application configuration such as HCL.
- Generating or installing asdf plugin scripts.
- Centralizing release-tag, SHA, `VERSION`, or `package.json` consistency; that belongs in a later language-neutral release-context package.
- Adding `govulncheck`, coverage, source scanning, or vulnerability exception policy.
- Migrating the three reference repositories in the same change.
- Generalizing `@repo-toolkit/release-artifact` or creating a new shared archive-core package unless implementation proves package-local reuse impossible.

## Baseline Verification

Before implementation begins, record results for:

```sh
git status --short
pnpm lint
pnpm typecheck
pnpm test
```

If baseline failures exist, record exact commands and output summaries here before changing code. Do not silently fix unrelated failures as part of this package.

The toolkit currently has no pinned Go toolchain in `.tool-versions`. Unit and CLI tests must therefore run without a real Go installation by using injected runners, temporary fixtures, or fake executables. A real-Go integration test is deferred until CI explicitly installs Go.

Baseline completion evidence:

- Working tree: `git status --short` reported only this untracked task document.
- Verified: `pnpm lint` passed.
- Verified: `pnpm typecheck` passed.
- Verified: `pnpm test` passed across the existing five tested workspace packages (584 tests total: 110 publish-package, 81 changelog, 215 confluence, 78 publish-packages, and 100 release-artifact).

## Priorities

- P0: Required to prevent unsafe paths, partial release output, unbounded execution, or incorrectly verified artifacts.
- P1: Required for the initial public package and CLI contract.
- P2: Documentation, consumer examples, and integration hardening required before publishing but not needed to unblock core implementation.

## Planned Public Contract

Package name:

```text
@repo-toolkit/go-release
```

CLI bins:

```text
repo-toolkit-build-go-release
repo-toolkit-verify-go-release
```

Root scripts derived by the repository contract:

```text
build-go-release
verify-go-release
```

Expected public API names:

```ts
resolveGoReleasePlan(options);
buildGoRelease(options);
verifyGoRelease(options);
writeGoReleaseChecksums(options);
verifyGoReleaseReproducibility(options);
```

Agents may refine supporting type names, but must not change package scope, bin count, or the plan/build/verify split without recording a maintainer decision in this file.

## Execution Waves

1. Package contract and plan model: GOREL-01 and GOREL-02.
2. Process and build foundations: GOREL-03 and GOREL-04.
3. Artifact production and verification: GOREL-05 and GOREL-06.
4. Reproducibility and CLI behavior: GOREL-07 and GOREL-08.
5. Documentation and independent integration: GOREL-09 and GOREL-10.

Do not start a later wave until all dependencies are completed and their targeted verification passes.

## Detailed Tasks

### Task GOREL-01: Scaffold The Publishable Package Contract

Status: completed

Priority: P1

Suggested agent: workspace package engineer

Dependencies: none

Primary ownership:

- `packages/go-release/package.json`
- `packages/go-release/tsconfig.json`
- `packages/go-release/tsup.config.ts`
- `packages/go-release/vitest.config.ts`
- `packages/go-release/src/index.ts`
- `packages/go-release/src/cli-build.ts`
- `packages/go-release/src/cli-verify.ts`
- `packages/go-release/test/`
- `tsconfig.base.json`
- `package.json`
- initial package membership entries required by repository contract tests

Finding:

No Go-specific package exists. Every workspace package must satisfy aliases, root-script, unique-bin, placeholder manifest, ESM export, build/test script, local README, and website documentation contracts enforced by `packages/publish-packages/test/contract.test.ts:78-349`.

References:

- `AGENTS.md:44-65`
- `packages/release-artifact/package.json:1-47`
- `packages/release-artifact/tsup.config.ts`
- `packages/publish-packages/test/contract.test.ts:78-349`
- `package.json:19-33`
- `tsconfig.base.json:4-15`

Implementation requirements:

1. Mirror existing package metadata and shared config conventions exactly, including placeholders, ESM output, `files`, Node engine, build script, and dependency-closure test script.
2. Declare the two planned bins and matching root scripts. Build each CLI separately with a Node shebang and no declaration output.
3. Depend on `@repo-toolkit/publish-package` through `workspace:*` for shared CLI and configuration helpers.
4. Add path and glob aliases to `tsconfig.base.json`.
5. Add minimal accurate package README, root README membership, website package index membership, and dedicated website package documentation so repository contract tests remain green. GOREL-09 will complete user-facing guidance after behavior stabilizes.
6. Export placeholder CLI entrypoints that print useful help or a clear not-yet-implemented error without calling `process.exit()`; do not silently succeed for unimplemented operations.
7. Add a package smoke test proving imports and CLI bundles are discoverable after build.

Acceptance criteria:

- `pnpm --filter @repo-toolkit/go-release... build` succeeds.
- The repository contract recognizes both bins, both root scripts, aliases, metadata, and docs membership.
- `pnpm --filter @repo-toolkit/publish-packages test` passes.
- No generated `dist/` files are tracked.

Completion evidence:

- Changed: scaffolded `packages/go-release/`, added workspace aliases and scripts, refreshed `pnpm-lock.yaml`, and added required root and website documentation membership.
- Verified: `pnpm --filter @repo-toolkit/go-release... build` passed.
- Verified: `pnpm --filter @repo-toolkit/go-release test` passed (2 tests).
- Verified: `pnpm --filter @repo-toolkit/publish-packages test` passed (78 tests), including repository contracts.
- Verified: `pnpm lint`, `pnpm typecheck`, and `git diff --check` passed; `git ls-files "packages/go-release/dist/**"` returned no tracked files.

### Task GOREL-02: Define And Validate The Complete Release Plan

Status: completed

Priority: P0

Suggested agent: release API and validation engineer

Dependencies: GOREL-01

Primary ownership:

- `packages/go-release/src/plan.ts`
- public types exported by `packages/go-release/src/index.ts`
- `packages/go-release/test/plan.test.ts`

Finding:

The reference repositories hardcode binary names, main packages, linker symbols, target matrices, archive names, version display formats, and extra files in Make and shell. A shared engine needs one validated configuration that supports both one binary per archive and multiple binaries plus files without accepting ambiguous or escaping output.

References:

- `/home/jahn/projects/_aiproxy/Makefile:9-34`
- `/home/jahn/projects/_database-tools/Makefile:12-58,94-105`
- `/home/jahn/projects/_s3proxy/Makefile:11-35`
- `packages/publish-package/src/plan.ts:100-195,246-272`
- `packages/publish-packages/src/index.ts:374-436`

Implementation requirements:

1. Define options and a readonly resolved plan for `cwd`, tool name, version, output directory, binaries, targets, build flags, linker values, archive naming, additional files, source-date epoch, process limits, and optional version commands.
2. Validate unknown keys and all runtime value types from config files before plan resolution. Do not rely on TypeScript casts for executable configuration.
3. Require at least one binary and one target. Reject duplicate binary names, duplicate targets, duplicate generated archive names, invalid Go OS/architecture tokens, empty package paths, and Windows suffix collisions.
4. Normalize relative paths and reject absolute paths, `..` traversal, NUL bytes, reserved output collisions, and output roots that resolve to the repository root.
5. Require additional archive files to resolve to existing regular files inside the configured project root. Define explicit archive destinations and reject collisions with binaries and other files.
6. Make version formatting explicit. Support fixed tokens for version, OS, and architecture without evaluating code or shell syntax. Reject unsupported tokens and values that cannot be represented safely in Go linker arguments.
7. Keep the target matrix and binary package paths repository-owned; do not ship product-specific defaults.
8. Resolve the full plan without creating directories, deleting output, or invoking external processes.

Acceptance criteria:

- One fixture models `aiproxy` or `s3proxy` as a single binary across multiple targets.
- One fixture models `database-tools` as two binaries plus `LICENSE` in each platform archive.
- Invalid paths, duplicate outputs, unknown config keys, malformed targets, unsupported template tokens, missing files, directories, and archive collisions fail during planning.
- Plan resolution leaves the temporary fixture byte-for-byte unchanged.
- `pnpm --filter @repo-toolkit/go-release test -- plan.test.ts` passes.

Completion evidence:

- Changed: `packages/go-release/src/plan.ts`, `packages/go-release/src/index.ts`, and `packages/go-release/test/plan.test.ts`.
- Verified: `pnpm --filter @repo-toolkit/go-release test -- plan.test.ts` passed (2 files, 30 tests; 28 focused plan tests).
- Verified: `pnpm lint`, `pnpm typecheck`, and `git diff --check` passed.
- Verified: plan tests cover single- and multi-binary fixtures, strict runtime/nested-key validation, path and collision failures, safe templates, and byte-for-byte fixture non-mutation; no `packages/go-release/dist/**` files are tracked.

### Task GOREL-03: Add Bounded Injectable Process Execution

Status: completed

Priority: P0

Suggested agent: process-control engineer

Dependencies: GOREL-01

Primary ownership:

- `packages/go-release/src/runner.ts`
- `packages/go-release/test/runner.test.ts`

Finding:

Go builds and tar inspection require external processes. The shared `ProcessRunner` lacks capture, timeout, and output bounds, while `release-artifact` has a stronger but package-owned `ArtifactRunner`. Depending on the Node artifact package solely for its runner would invert package ownership.

References:

- `packages/publish-package/src/runner.ts:3-48`
- `packages/release-artifact/src/index.ts:36-103`
- `docs/tasks/20260804-141959-release-artifact-build-reproducibility.md:101-130`

Implementation requirements:

1. Define a package-local injectable runner with structured `run` and `capture` methods, explicit cwd/environment handling, timeout, kill signal, and maximum captured-output bytes.
2. Do not provide a general shell-string execution method.
3. Ensure environment overrides merge with the parent environment without mutating `process.env`.
4. Terminate timed-out processes and output-overflow processes with clear errors that identify the executable without exposing sensitive environment values.
5. Preserve executable arguments exactly, including paths containing spaces and linker argument strings.
6. Make runner and process limits injectable through public options but exclude runner objects from serializable config validation.
7. Use controlled Node fixture processes; tests must not require Go, tar, network access, or global package manager state.

Acceptance criteria:

- Tests cover successful execution, nonzero exit, timeout, output overflow, environment merging, cwd handling, and space-containing arguments.
- A hanging child is terminated and does not survive the test.
- No library path invokes `bash -c`, `sh -c`, or equivalent.
- `pnpm --filter @repo-toolkit/go-release test -- runner.test.ts` passes.

Completion evidence:

- Changed: `packages/go-release/src/runner.ts`, `packages/go-release/src/plan.ts`, `packages/go-release/src/index.ts`, `packages/go-release/test/runner.test.ts`, and `packages/go-release/test/index.test.ts`.
- Verified: `pnpm --filter @repo-toolkit/go-release test -- runner.test.ts` passed (3 files, 38 tests; 8 focused runner tests).
- Verified: `pnpm --filter @repo-toolkit/go-release exec vitest run --config vitest.config.ts runner.test.ts` passed (1 file, 8 tests).
- Verified: `pnpm lint`, `pnpm typecheck`, and `git diff --check` passed; source inspection found no shell-string execution path.

### Task GOREL-04: Build The Matrix Atomically

Status: completed

Priority: P0

Suggested agent: Go build orchestration engineer

Dependencies: GOREL-02, GOREL-03

Primary ownership:

- `packages/go-release/src/build.ts`
- `packages/go-release/test/build.test.ts`

Finding:

The reference repositories implement related but inconsistent atomicity boundaries. `_aiproxy` stages each target and has dedicated fault-injection tests; `_s3proxy` stages the complete matrix; `_database-tools` verifies nonempty outputs after parallel builds. The shared contract must not expose stale or partial release output when any target fails.

References:

- `/home/jahn/projects/_aiproxy/Makefile:49-74`
- `/home/jahn/projects/_aiproxy/scripts/validate-build-atomicity.sh:1-74`
- `/home/jahn/projects/_database-tools/Makefile:28-58`
- `/home/jahn/projects/_s3proxy/Makefile:63-84`

Implementation requirements:

1. Build every binary for every target through the injected runner using `go build` with explicit argv and target-specific environment.
2. Set `CGO_ENABLED`, `GOOS`, and `GOARCH` from the resolved plan without mutating global environment.
3. Apply configured build flags and deterministic linker values exactly once. Avoid duplicate `-X` assignments such as the current `_aiproxy` behavior.
4. Stage the complete managed release tree in a temporary sibling directory. Replace the managed output only after every build succeeds and every expected binary is a nonempty regular file.
5. Clean temporary staging in `finally`. A failed build must preserve any preexisting successful output and must not leave later targets or partial files visible.
6. Support bounded build concurrency with a deterministic default and explicit positive limit. Stop scheduling new work after the first failure and await/clean already-started work.
7. Set executable permissions consistently for non-Windows outputs and use `.exe` only for Windows targets.
8. Return a structured build result describing outputs; do not infer success solely from process exit status.

Acceptance criteria:

- Recording-runner tests assert exact executable, argv, cwd, and environment for single- and multi-binary plans.
- Failure in an intermediate target preserves prior managed output, does not publish staging, and cleans temporary files.
- Missing, empty, directory, symlink, and incorrectly named runner outputs are rejected before replacement.
- Concurrency tests prove the configured bound is not exceeded and no new target starts after a known failure.
- Windows and non-Windows names are correct.
- `pnpm --filter @repo-toolkit/go-release test -- build.test.ts` passes.

Completion evidence:

- Changed: added `packages/go-release/src/build.ts` and `packages/go-release/test/build.test.ts`; added narrow build exports, async-runner typing, and scaffold CLI/test integration.
- Verified: `pnpm --filter @repo-toolkit/go-release test -- build.test.ts` passed (4 files, 47 tests; 9 focused build tests).
- Verified: `pnpm lint`, `pnpm typecheck`, and `git diff --check` passed.
- Result: exact structured Go invocations, complete-tree staging and validation, bounded target concurrency, failure cleanup, output preservation, platform naming, permissions, and structured results are covered without invoking host Go.
- Blockers: none.

### Task GOREL-05: Create Deterministic Archives And Checksums

Status: completed

Priority: P0

Suggested agent: reproducible artifact engineer

Dependencies: GOREL-02, GOREL-03

Primary ownership:

- `packages/go-release/src/archive.ts`
- `packages/go-release/test/archive.test.ts`

Finding:

All reference repositories create deterministic gzip-compressed tar archives, but archive layouts differ: one executable for the proxy projects and two executables plus `LICENSE` for `_database-tools`. Checksum filenames also differ. Creation needs one explicit, testable contract.

References:

- `/home/jahn/projects/_aiproxy/Makefile:76-93`
- `/home/jahn/projects/_database-tools/Makefile:94-105`
- `/home/jahn/projects/_s3proxy/Makefile:86-100`
- `/home/jahn/projects/_s3proxy/.github/workflows/release.yml:48-57`

Implementation requirements:

1. Create one archive per target from the completed managed build tree, containing exactly the configured binaries and additional files at their planned archive paths.
2. Normalize archive ordering, modification time, uid, gid, owner/group names, and gzip metadata. Document the required external tar capabilities and fail clearly when unavailable.
3. Never pass configured filenames as shell fragments. Use structured arguments and a controlled staging directory for archive contents.
4. Write each archive to a temporary sibling and rename only after successful creation and nonempty output validation.
5. Generate a sorted SHA-256 manifest with stable lowercase hex and a documented two-space filename separator. Use Node cryptography rather than a platform-specific checksum executable.
6. Write the checksum manifest atomically and reject filenames containing newline or other characters that make the manifest ambiguous.
7. Preserve completed build outputs if archive or checksum generation fails; clean only package-owned temporary content.
8. Return a structured artifact result containing target, archive path, size, and checksum.

Acceptance criteria:

- Single-binary and multi-binary fixture archives contain exactly their configured members.
- Repeated archive creation from identical fixture inputs yields identical bytes and checksums.
- Changed content changes the relevant checksum.
- Archive and checksum failures preserve previously published artifacts and leave no temporary siblings.
- Manifest ordering is independent of target configuration order and filesystem enumeration.
- `pnpm --filter @repo-toolkit/go-release test -- archive.test.ts` passes.

Completion evidence:

- Changed: added `packages/go-release/src/archive.ts` and `packages/go-release/test/archive.test.ts`; added the required tar executable plan option and narrow archive/checksum exports.
- Verified: `pnpm --filter @repo-toolkit/go-release test -- archive.test.ts` passed (5 files, 53 tests; 6 focused archive tests).
- Verified: `pnpm --filter @repo-toolkit/go-release exec vitest run --config vitest.config.ts archive.test.ts` passed (1 file, 6 tests).
- Verified: `pnpm lint`, `pnpm typecheck`, and `git diff --check` passed.
- Result: deterministic staged archives, atomic per-archive and sorted SHA-256 manifest writes, failure cleanup/preservation, exact member sets, and structured artifact results are covered without host Go, host tar, or network access.
- Blockers: none.

### Task GOREL-06: Verify Archives Before And After Extraction

Status: completed

Priority: P0

Suggested agent: archive security engineer

Dependencies: GOREL-03, GOREL-05

Primary ownership:

- `packages/go-release/src/verify.ts`
- `packages/go-release/test/verify.test.ts`

Finding:

The consumer repositories validate expected member names and regular files with varying strictness. `@repo-toolkit/release-artifact` additionally bounds member count, path length, expanded bytes, duplicate paths, top-level layout, and link targets. A new release package must not reintroduce weaker traversal or resource-exhaustion behavior.

References:

- `/home/jahn/projects/_aiproxy/Makefile:95-116`
- `/home/jahn/projects/_database-tools/bin/install:15-76`
- `/home/jahn/projects/_s3proxy/bin/install:15-48`
- `packages/release-artifact/src/index.ts:998-1089`
- `packages/release-artifact/src/index.ts:1266-1306`
- `packages/release-artifact/src/index.ts:1431-1511`

Implementation requirements:

1. Validate archive headers before extraction with configurable conservative limits for member count, path length, and total expanded bytes.
2. Reject empty archives, absolute paths, traversal, normalized duplicate paths, NUL bytes, unsupported member types, devices, FIFOs, sparse files, symlinks, and hard links.
3. Require the archive member set to equal the resolved plan exactly; no missing or additional files are permitted.
4. Extract only into a temporary package-owned directory after header validation, then revalidate filesystem types, containment, member sizes, expected permissions, and nonempty binaries.
5. Verify the checksum manifest parser fails on duplicate entries, malformed hashes, unsafe filenames, unknown files, missing expected archives, and digest mismatches.
6. Optionally run a configured version command only for a target compatible with the host platform. Compare output using an explicit exact or anchored policy from the plan; never execute incompatible artifacts.
7. Bound extraction and version-command execution through the injected runner and always clean extraction directories in `finally`.
8. If archive validation logic is copied from `release-artifact`, preserve equivalent tests and document why neutral extraction was deferred. Do not weaken `release-artifact` to share code.

Acceptance criteria:

- Malicious fixtures cover traversal, absolute paths, links, duplicate normalized paths, special files, oversized metadata, too many members, and unexpected files.
- Every malicious fixture fails before writing outside the extraction directory.
- Valid one-binary and two-binary archives verify successfully.
- Checksum mismatches and ambiguous manifests fail closed.
- Version checks run only for compatible targets and reject incorrect output.
- Temporary extraction trees are removed after success and every forced failure.
- `pnpm --filter @repo-toolkit/go-release test -- verify.test.ts` passes.

Completion evidence:

- Changed: added `packages/go-release/src/verify.ts` and `packages/go-release/test/verify.test.ts`; added narrow verification result, option, and archive-limit exports in `packages/go-release/src/index.ts`; kept the deferred verify CLI explicitly unimplemented in `packages/go-release/src/cli-verify.ts` pending GOREL-08.
- Verified: `pnpm --filter @repo-toolkit/go-release test -- verify.test.ts` passed (6 files, 80 tests; 27 focused verifier tests).
- Verified: `pnpm --filter @repo-toolkit/go-release exec vitest run --config vitest.config.ts verify.test.ts` passed (1 file, 27 tests).
- Verified: `pnpm lint`, `pnpm typecheck`, and `git diff --check` passed.
- Security coverage: checksum manifests fail closed for malformed hashes/separators, duplicate/unsafe/unknown/missing entries, missing archives, and digest mismatches; immutable package-owned archive snapshots close replacement races before extraction.
- Security coverage: strict bounded ustar parsing rejects traversal, absolute and non-normalized paths, embedded NUL data, normalized duplicates, links, devices, FIFOs, sparse and other unsupported types, unexpected members, excessive paths/member counts/expanded sizes, invalid checksums, modes, truncation, and trailing data before the extraction runner is called.
- Security coverage: post-extraction checks enforce the exact planned file/directory tree, realpath containment, regular non-symlink types, header-matched sizes and permissions, and nonempty binaries; bounded structured extraction and compatible-host-only exact/anchored version checks run through the injected runner, with temporary trees removed after success and forced failures.
- Design note: verification remains package-local rather than weakening or coupling the Node-oriented `release-artifact`; neutral archive-core extraction remains the existing deferred decision.
- Blockers: none.

### Task GOREL-07: Verify Independent Build Reproducibility

Status: completed

Priority: P1

Suggested agent: reproducible-build test engineer

Dependencies: GOREL-04, GOREL-05, GOREL-06

Primary ownership:

- `packages/go-release/src/reproducibility.ts`
- `packages/go-release/test/reproducibility.test.ts`

Finding:

`_aiproxy` and `_database-tools` independently rebuild archives and compare checksums; `_s3proxy` creates deterministic archives but has no independent rebuild comparison. Reproducibility must be an explicit verification operation rather than an assumption based on tar flags.

References:

- `/home/jahn/projects/_aiproxy/scripts/check-reproducible-archives.sh:1-19`
- `/home/jahn/projects/_database-tools/Makefile:107-115`
- `/home/jahn/projects/_s3proxy/Makefile:86-100`

Implementation requirements:

1. Build and archive the same resolved plan twice in independent temporary roots.
2. Compare the exact expected archive set, file sizes, and SHA-256 digests; report missing, additional, and differing artifacts clearly.
3. Do not overwrite the caller's normal release output during reproducibility verification.
4. Support an explicit target subset for local efficiency while making full-plan verification the release-safe default.
5. Clean both independent roots in `finally`, including failures during the first build.
6. Return structured comparison evidence suitable for CLI reporting and future CI summaries.

Acceptance criteria:

- Identical fake build output passes reproducibility verification.
- A fake compiler that injects changing bytes causes a deterministic failure naming the affected archive.
- Missing and additional archive cases are reported distinctly.
- The configured normal output directory remains unchanged.
- No temporary trees remain after success or failure.
- `pnpm --filter @repo-toolkit/go-release test -- reproducibility.test.ts` passes.

Completion evidence:

- Changed: added `packages/go-release/src/reproducibility.ts` and `packages/go-release/test/reproducibility.test.ts`; replaced the placeholder with narrow reproducibility exports in `packages/go-release/src/index.ts`.
- Verified: `pnpm --filter @repo-toolkit/go-release test -- reproducibility.test.ts` passed (7 files, 86 tests; 6 focused reproducibility tests).
- Verified: `pnpm lint`, `pnpm typecheck`, and `git diff --check` passed.
- Result: two independently built, archived, and verified temporary release roots are compared by exact archive set, size, and SHA-256; full-plan and explicit subset runs return structured evidence, distinguish missing/additional/different artifacts, preserve normal output, and clean temporary roots on success and failure without host Go, host tar, or network access.
- Blockers: none.

### Task GOREL-08: Implement Build And Verify CLIs

Status: completed

Priority: P1

Suggested agent: CLI contract engineer

Dependencies: GOREL-02, GOREL-04, GOREL-05, GOREL-06, GOREL-07

Primary ownership:

- `packages/go-release/src/cli-build.ts`
- `packages/go-release/src/cli-verify.ts`
- CLI-related exports only when needed for tests
- `packages/go-release/test/cli.test.ts`

Finding:

The package needs stable automation entrypoints that compose existing config helpers and expose package behavior without embedding GitHub Actions semantics. Existing repository conventions require `FlagSpec[]`, strict parsing, config-first/CLI-second precedence, help on `null`, and `process.exitCode` at error boundaries.

References:

- `AGENTS.md:69-80`
- `packages/publish-package/src/flags.ts:1-165`
- `packages/publish-package/src/prompt.ts:9-105`
- `packages/release-artifact/src/cli-build.ts`
- `packages/release-artifact/src/cli-verify.ts`

Implementation requirements:

1. Use `parseFlags` and `loadConfigFile`; validate loaded config with GOREL-02 before execution.
2. Make CLI precedence explicit: config supplies defaults and explicit CLI flags override them.
3. Build CLI behavior must support plan display/dry-run, build plus archive/checksum creation, target filtering, and bounded concurrency without inventing positional subcommands.
4. Verify CLI behavior must support existing-output verification and optional independent reproducibility verification.
5. Dry-run must resolve and print the full plan without creating output or invoking Go/tar.
6. Print secrets-free deterministic summaries. Do not dump complete inherited environments or runner objects.
7. End both CLIs with `main().catch(...)`, print a concise error, and set `process.exitCode = 1`.
8. Keep GitHub-specific output files and release mutation outside the CLI.
9. Test help, unknown flags, missing values, config precedence, invalid config, dry-run non-mutation, success, process failure, and exit-code behavior.
10. Add packed-package smoke coverage proving both bins retain shebangs, import ESM correctly, and run help from an unpacked npm tarball.

Acceptance criteria:

- CLI help and README option tables agree.
- Dry-run invokes no external process and leaves fixtures unchanged.
- Invalid config fails before any runner call.
- Both packed bins execute `--help` under Node 20-compatible semantics.
- Error paths set a nonzero exit code without calling `process.exit()`.
- `pnpm --filter @repo-toolkit/go-release test -- cli.test.ts` passes.

Completion evidence:

- Changed: implemented both bins in `packages/go-release/src/cli-build.ts` and `packages/go-release/src/cli-verify.ts`, with shared strict config/override, target selection, limit validation, and deterministic summary handling in `packages/go-release/src/cli-options.ts`.
- Changed: added focused CLI and packed-package coverage in `packages/go-release/test/cli.test.ts`, aligned scaffold expectations in `packages/go-release/test/index.test.ts`, and minimally aligned package README option tables with both help outputs.
- Integration fix: added the missing structured `--create` argument to the existing GNU tar archive invocation in `packages/go-release/src/archive.ts` and updated its exact-argv assertion; without it, the build CLI could not complete archive creation with the default tar executable.
- Verified: `pnpm --filter @repo-toolkit/go-release test -- cli.test.ts` passed (8 files, 95 tests; 9 focused CLI tests).
- Verified: `pnpm --filter @repo-toolkit/go-release exec vitest run --config vitest.config.ts cli.test.ts` passed (1 file, 9 tests).
- Verified: `pnpm lint`, `pnpm typecheck`, and `git diff --check` passed.
- Packed-bin evidence: the focused CLI suite ran `pnpm pack`, extracted the npm tarball, confirmed both `dist/cli-build.js` and `dist/cli-verify.js` begin with `#!/usr/bin/env node`, and executed both unpacked bins with `--help` successfully through their shebangs and ESM imports.
- Result: build dry-runs are process-free and non-mutating; normal builds filter targets and produce binaries, deterministic archives, and checksums; verification checks existing output and optionally performs independent reproducibility builds; config defaults and CLI overrides are explicit; summaries omit runner, inherited environment, and executable paths; all tested failures exit nonzero through `main().catch` without `process.exit()`.
- Blockers: none.

### Task GOREL-09: Complete Documentation And Consumer Examples

Status: completed

Priority: P2

Suggested agent: release tooling documentation engineer

Dependencies: GOREL-08

Primary ownership:

- `packages/go-release/README.md`
- `website/docs/packages/go-release.md`
- `website/docs/packages/index.md`
- `README.md`
- `AGENTS.md`
- example configuration fixtures under `packages/go-release/test/fixtures/` if retained as tested examples

Finding:

The package contract is not usable unless maintainers can map the three established release shapes to configuration and understand which existing workflow responsibilities remain outside the package. Repository contract tests also require package membership documentation.

References:

- `README.md:5-20`
- `AGENTS.md:5-65`
- `website/docs/packages/index.md`
- `/home/jahn/projects/_aiproxy/Makefile:9-122`
- `/home/jahn/projects/_database-tools/Makefile:6-115`
- `/home/jahn/projects/_s3proxy/Makefile:11-100`

Implementation requirements:

1. Document library API, both CLIs, config precedence, defaults, external tool requirements, deterministic archive contract, checksum format, output atomicity, process limits, and dry-run behavior.
2. Include one tested single-binary configuration and one tested multi-binary-plus-license configuration.
3. Show thin Make targets and GitHub Actions steps that consume the CLI without claiming the package creates tags, SBOMs, provenance, images, or GitHub Releases.
4. Document supported host assumptions for archive creation and verification, including required tar capabilities.
5. Document migration caveats for existing version display differences, archive names, checksum filenames, and managed output directories.
6. Update `AGENTS.md` package layout and commands so future agents discover the package and required verification.
7. Keep detailed guides in website docs and the package README concise.

Acceptance criteria:

- A maintainer can model all three reference repository release layouts from the documented options.
- Every documented command and flag is exercised by CLI tests or generated from the same source as help.
- Root README, package README, website index, dedicated website page, and `AGENTS.md` agree on package and bin names.
- `pnpm --filter @repo-toolkit/publish-packages test` passes repository documentation contracts.

Completion evidence:

- Changed: completed package guidance in `packages/go-release/README.md`, detailed configuration/API/CLI/contract/migration/non-goal guidance in `website/docs/packages/go-release.md`, and package command discovery in `README.md` and `AGENTS.md`.
- Changed: added canonical single-binary and multi-binary-plus-license examples under `packages/go-release/test/fixtures/` and `packages/go-release/test/examples.test.ts`; the test requires the website JSON blocks to equal those fixtures and drives both examples through build dry-run, build/archive/checksum creation, and verification.
- Verified: `pnpm --filter @repo-toolkit/go-release exec vitest run --config vitest.config.ts examples.test.ts` passed (1 file, 4 tests) using GNU tar 1.35 and a controlled fake Go executable.
- Verified: `pnpm --filter @repo-toolkit/go-release test` passed (9 files, 99 tests), including CLI help/README agreement, packed bins, and both documented examples.
- Verified: `pnpm --filter @repo-toolkit/publish-packages test` passed (3 files, 78 tests), including repository package and documentation contracts.
- Verified: `pnpm test` passed across all six tested workspace packages (683 tests total: 110 publish-package, 81 changelog, 215 confluence, 78 publish-packages, 100 release-artifact, and 99 go-release).
- Verified: `pnpm lint`, `pnpm typecheck`, and `git diff --check` passed.
- Result: documentation now states GNU-compatible tar requirements, managed-output and per-file atomicity boundaries, process and archive limits, deterministic archive/checksum contracts, config precedence/defaults, dry-run and reproducibility behavior, reference-repository migration caveats, and explicit non-goals, with thin Make and GitHub Actions consumers.
- Blockers: none.

### Task GOREL-10: Perform Independent Integration And Security Review

Status: completed

Priority: P0

Suggested agent: independent release security reviewer who did not implement GOREL-02 through GOREL-08

Dependencies: GOREL-01 through GOREL-09

Primary ownership:

- review of all `packages/go-release/` files
- focused corrective changes discovered during review
- completion evidence in this task document

Finding:

The package controls executable invocation, output replacement, archive construction, and archive extraction. Independent review is required before publication because a path, process, or atomicity defect could overwrite repository content, execute unintended input, or accept unsafe release artifacts.

References:

- all GOREL task acceptance criteria
- `packages/release-artifact/src/index.ts:998-1199,1266-1306,1431-1511`
- `packages/publish-packages/test/contract.test.ts:78-349`

Implementation requirements:

1. Review every configured path from parse through filesystem use and prove containment at the final mutation boundary.
2. Review every external process invocation for structured arguments, bounded execution, controlled environment, and clear failure propagation.
3. Exercise negative archive fixtures and confirm no extraction occurs before header validation.
4. Force failures during build, archive creation, checksum writing, extraction, version execution, and reproducibility comparison; verify preexisting output survives and temporary content is cleaned.
5. Compare public types, runtime config validation, CLI help, package README, and website documentation for one contract.
6. Pack the package and run both bins from the packed artifact with controlled fake tools.
7. Run package-level and full-repository verification serially because package tests rebuild dependency outputs.
8. Record any deferred issue with owner, rationale, and residual risk. Do not mark the task complete while a P0 or P1 acceptance criterion is unresolved.

Acceptance criteria:

- Every prior task's acceptance criteria is confirmed against runtime behavior, not only code inspection.
- No configured path can escape project or managed output boundaries.
- No archive fixture can write outside extraction staging or introduce links/special files.
- Failed operations preserve prior output and leave no temporary trees.
- Packed library exports, declarations, and both bins work.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test` pass.
- The reviewer records commands, test counts, relevant artifact checks, and any residual risk in completion evidence.

Completion evidence:

- Independent review covered every file under `packages/go-release/`, traced configured project/output/package/additional/archive/checksum paths to each filesystem mutation, inspected every process call and limit, compared exported declarations with runtime validation and both documentation surfaces, and re-exercised every GOREL-01 through GOREL-09 acceptance criterion.
- Corrected P0/P1 findings: package paths now reject symlink-ancestor escapes; archive member file/directory prefix collisions and checksum/target-directory collisions fail during planning; all package Go/tar invocations use bounded piped output; the default timeout uses `SIGKILL`; tar creation/extraction clear ambient `TAR_OPTIONS`; CLI config cannot inject a library runner; verifier input manifests and compressed archives are bounded before reading/copying; verification rejects unlisted `.tar.gz` output and nonzero tar padding; public operation declarations no longer claim unsupported no-argument calls.
- Added runtime regressions for output, package, and additional-file symlink containment; archive-prefix and reserved-output collisions; ignored-`SIGTERM` timeout termination; piped-output overflow; tar environment control; malformed/nonzero padding; oversized archive and checksum inputs before extraction; unknown output archives; extraction failure cleanup; CLI runner rejection; packed declarations/imports; and operational execution of both packed bins with controlled fake Go and GNU tar.
- Failure injection confirms prior output and package-owned cleanup behavior across intermediate build failure and malformed compiler output, tar/archive failure, checksum write failure, pre-extraction rejection, extraction failure, version mismatch, first reproducibility build failure, and reproducibility set/content differences. Malicious traversal, absolute path, normalized duplicate, link, device, FIFO, sparse, embedded-NUL, oversized, malformed-header, wrong-mode, and unexpected-member fixtures make zero extraction calls.
- Focused verification: `pnpm --filter @repo-toolkit/go-release test` passed 9 files and 105 tests; `TAR_OPTIONS=--definitely-invalid pnpm --filter @repo-toolkit/go-release exec vitest run --config vitest.config.ts examples.test.ts` passed 1 file and 4 tests; `pnpm --filter @repo-toolkit/publish-packages test` passed 3 files and 78 tests.
- Packed artifact: `pnpm pack --pack-destination /tmp/opencode/gorel-review-pack` produced `repo-toolkit-go-release-0.0.0-PLACEHOLDER.tgz`, SHA-256 `86578d93d77d0e89d8ea65d9e8304edd64eb920b50505fd458409d816b0192ff`; listing contained `dist/index.js`, `dist/index.d.ts`, both CLI bundles, package metadata, README, and license. The package suite verified both bin shebangs and help, imported packed ESM exports, then built and verified a release through the unpacked bins using controlled tools.
- Final serial verification passed in required order: `pnpm lint`; `pnpm typecheck`; `pnpm build`; `pnpm test`. The full test run passed 24 files and 689 tests: 110 publish-package, 81 changelog, 215 confluence, 105 go-release, 78 publish-packages, and 100 release-artifact.
- Integration correction: the first exact `pnpm test` run exposed concurrent dependency rebuilds racing over `packages/publish-package/dist`; root `test` now sets `--workspace-concurrency=1`, after which the required command passed serially.
- Residual risks: no unresolved P0/P1 findings or blockers. Existing documented boundaries remain: JavaScript config and configured executables are trusted code, archive/checksum replacement is atomic per file rather than one transaction for the whole set, crash consistency is outside operation-level rollback, and a real pinned-Go CI fixture remains deferred to the repository maintainers because the repository has no pinned Go toolchain.

## Dependency And Parallelization Guidance

Recommended allocation:

| Wave | Task     | Agent focus               | Parallel guidance                                                               |
| ---- | -------- | ------------------------- | ------------------------------------------------------------------------------- |
| 1    | GOREL-01 | package scaffolding       | Run alone; owns root metadata and initial docs membership.                      |
| 1    | GOREL-02 | plan and validation       | Starts after GOREL-01.                                                          |
| 2    | GOREL-03 | process runner            | May run in parallel with GOREL-02 after GOREL-01 because ownership is separate. |
| 2    | GOREL-04 | Go build engine           | Starts after GOREL-02 and GOREL-03.                                             |
| 3    | GOREL-05 | archive/checksum creation | May run in parallel with GOREL-04 after GOREL-02 and GOREL-03.                  |
| 3    | GOREL-06 | verification              | Starts after GOREL-05. Coordinate shared fixture formats.                       |
| 4    | GOREL-07 | reproducibility           | Starts after build, archive, and verify contracts stabilize.                    |
| 4    | GOREL-08 | CLIs                      | Starts after all library operations stabilize.                                  |
| 5    | GOREL-09 | final docs                | Runs after CLI names, flags, and config are stable.                             |
| 5    | GOREL-10 | independent review        | Runs alone after all implementation tasks.                                      |

Shared hotspots:

- `packages/go-release/src/index.ts` is export-only after scaffolding. Each implementation agent adds exports narrowly and coordinates before editing.
- `packages/go-release/test/fixtures/` must have one owner at a time. Prefer task-local fixture builders to avoid concurrent edits.
- Root `package.json`, `tsconfig.base.json`, root README, website index, and `AGENTS.md` are owned by GOREL-01 or GOREL-09 only.
- Do not run root `pnpm build` or `pnpm test` concurrently because package test scripts rebuild dependency closures and share `dist/` outputs.

## Wave Verification

After Wave 1:

```sh
pnpm --filter @repo-toolkit/go-release... build
pnpm --filter @repo-toolkit/go-release test
pnpm --filter @repo-toolkit/publish-packages test
```

After Waves 2 through 4:

```sh
pnpm --filter @repo-toolkit/go-release test
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

1. Whether generic runner and archive-security primitives should later move from package-local implementations into a neutral shared package.
2. Whether to add a language-neutral `@repo-toolkit/release-context` package for SemVer, tag/SHA identity, version-file synchronization, and OCI metadata derivation.
3. Whether to add `@repo-toolkit/asdf-plugin` after artifact names and checksum contracts stabilize.
4. Whether to extract `_database-tools`' `govulncheck` exception gate into a separate package.
5. Whether CI should install a pinned Go toolchain and run a real-Go end-to-end fixture in addition to fake-runner tests.
6. Which reference repository should receive the first migration task. `_aiproxy` is the recommended first adopter because its current fault-injection and reproducibility tests provide the strongest comparison oracle.
7. Whether the package should support ZIP archives for conventional Windows distribution. The initial contract is `tar.gz` only because all three reference repositories currently publish that format.

## Definition Of Done

- `@repo-toolkit/go-release` is publishable under repository contracts and exposes the planned library API and two bins.
- Single- and multi-binary release configurations resolve, build, archive, checksum, verify, and reproduce successfully in isolated tests.
- All path, process, archive, and output mutations are bounded, fail closed, and preserve prior successful output on failure.
- Unit and CLI tests require no network and no host Go installation.
- Package README, website docs, root README, and `AGENTS.md` accurately describe the same behavior.
- An independent reviewer completes GOREL-10 and records verification evidence.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test` pass from the repository root.
- Consumer migration, release-context, asdf, vulnerability policy, and deployment work remain explicitly deferred rather than hidden in the implementation.

## Final Completion Evidence

- Final review confirmed GOREL-01 through GOREL-10 are all `completed`, each task has command and result evidence, and every Definition of Done item is represented by implementation, tests, documentation, or an explicitly retained deferred decision.
- Reviewed the package manifest, build configuration, public exports, process execution boundary, build replacement boundary, archive/checksum writes, reproducibility isolation, task evidence, and package documentation. No additional unresolved findings were identified after the independent GOREL-10 corrections.
- Verified again in serial order from the repository root: `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test` all passed. The final test run passed 24 files and 689 tests, including 105 `@repo-toolkit/go-release` tests.
- Verified: `git diff --check` passed during GOREL-10; generated `dist/` files remain ignored and untracked; `CHANGELOG.md` has no diff and was not updated.
- Result: the task document and implementation are complete with no unresolved P0/P1 items or blockers. The documented residual boundaries and deferred follow-up decisions remain unchanged.
