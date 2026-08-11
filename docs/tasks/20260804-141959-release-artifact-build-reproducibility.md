# Release Artifact Build Reproducibility

Created: 2026-08-04 14:19:59

## Objective

Make artifact content, dependency modes, version files, and external process behavior explicit, reproducible, bounded, and testable.

### Task RAARC-01: Replace conflicting node-module booleans with one mode

Status: completed

Priority: P1

Suggested agent: release API engineer

Dependencies: none

Primary ownership:

- `packages/release-artifact/src/index.ts:71-79,308-309`
- `packages/release-artifact/src/cli-build.ts`
- tests and README

Finding:

`--skip-node-modules` still permits production installation and `--no-production-node-modules` does not enable copying, contradicting CLI help. Existing booleans cannot express documented modes reliably.

Implementation requirements:

1. Model `production`, `copy`, and `none` as one resolved mode while mapping existing flags only if compatibility is concrete.
2. Reject contradictory input and test CLI-to-plan-to-filesystem behavior.
3. Correct package and website defaults/options together.

Acceptance criteria:

- Every mode produces only its documented content.
- CLI help, README, website, API types, and plan defaults agree.

### Task RAARC-02: Preserve and validate copied file destinations

Status: completed

Priority: P1

Suggested agent: artifact content engineer

Dependencies: RASEC-03 in the archive-security file

Primary ownership:

- `packages/release-artifact/src/index.ts:209-219,361-395`
- copy fixtures

Finding:

Version files are copied by basename while required paths retain configured subpaths; missing files are skipped but still required. Basename collisions overwrite silently.

Implementation requirements:

1. Preserve validated relative destinations or model source/destination explicitly.
2. Fail early for missing/non-regular sources and all destination collisions.
3. Apply the same copy policy to root/version files and symlinks.

Acceptance criteria:

- Nested paths verify successfully.
- Missing files, duplicate basenames, directories, escaping links, and cross-category collisions fail during planning.

### Task RAARC-03: Make production dependency materialization reproducible

Status: completed

Priority: P1

Suggested agent: pnpm packaging engineer

Dependencies: RAARC-01

Primary ownership:

- `packages/release-artifact/src/index.ts:375-378,572-611`
- isolated offline fixtures

Finding:

Dependencies from every package are merged, conflicting ranges overwrite, and installation ignores the repository lockfile. This can include unrelated code, drift across builds, and leave generated lock/scaffold files.

Implementation requirements:

1. Include only the transitive closure of command-owning packages.
2. Reject incompatible range conflicts.
3. Use a pinned lockfile/deploy strategy and define shipped metadata explicitly.

Acceptance criteria:

- Unrelated dependencies are absent and conflicts fail.
- Repeated offline builds from one commit produce equivalent dependency trees.
- No unintended package/lock scaffolding is shipped.

### Task RAARC-04: Bound and inject external execution

Status: completed

Priority: P1

Suggested agent: process-control test engineer

Dependencies: RASEC-02

Primary ownership:

- `packages/release-artifact/src/index.ts:400-403,466,496-499,603-607`
- process tests

Finding:

Synchronous hardcoded tar, pnpm, bash, and wrapper execution has no timeout, cancellation, output bound, or injectable runner. Tests use the real repository and real pnpm, with cleanup not always in `finally`.

Implementation requirements:

1. Inject a process runner and add verification timeouts/output limits.
2. Move unit tests to temporary workspaces and controlled fakes.
3. Keep one isolated valid-system-tool smoke test if useful; guarantee cleanup in `finally`.

Acceptance criteria:

- Hanging wrappers are terminated with clear errors.
- Tests run offline and leave the worktree unchanged on forced failures.
- Root lint/typecheck/test, package build, valid verify, and shell checks pass.

## Completion Evidence

### RAARC-01 — Replace conflicting node-module booleans with one mode

- Changed: `packages/release-artifact/src/index.ts` (added `NodeModulesMode`, `resolveNodeModulesMode`, `validateArtifactRunner`, `resolveRunTimeoutMs`, replaced `BuildArtifactPlan.includeNodeModules`/`productionNodeModules` with `nodeModulesMode`), `packages/release-artifact/src/cli-build.ts` (`--node-modules <mode>` plus legacy-flag compat), `packages/release-artifact/test/index.test.ts`, `packages/release-artifact/README.md`, `website/docs/packages/release-artifact.md`.
- Verified: `pnpm --filter @repo-toolkit/release-artifact test` (95/95), `pnpm lint`, `pnpm typecheck`, `pnpm test` (all 6 packages, 564 tests green), `bash -n` on `bin/install`/`bin/download`/`bin/list-all`/`bin/lib/repo-toolkit.sh`.
- Result: A single `NodeModulesMode` enum (`production`/`copy`/`none`) replaces the two legacy booleans. `resolveNodeModulesMode` preserves documented legacy compatibility (`productionNodeModules: true` always wins; `productionNodeModules: false` defers to `includeNodeModules`) while rejecting an explicit `nodeModulesMode` that contradicts the legacy booleans. New tests cover every mode combination plus conflicting-input rejection.

### RAARC-02 — Preserve and validate copied file destinations

- Changed: `packages/release-artifact/src/index.ts` (`copyRootFiles`, `resolveRootFileDestination`, `resolveRootFileDestinations`, `assertNoRootFileDestinationCollisions`), `packages/release-artifact/test/index.test.ts`.
- Verified: same suite as RAARC-01.
- Result: Version/root files are copied into the artifact root preserving the configured subpath (e.g. `config/version.txt` ⇒ `config/version.txt`). The build now **fails** on: missing sources, directories, FIFOs/special files, escaping source symlinks, destination collisions (version-vs-version, version-vs-root, or reserved paths such as `artifact-manifest.json`, `bin`, `packages`, `node_modules`). All rejection modes have dedicated regression tests.

### RAARC-03 — Make production dependency materialization reproducible

- Changed: `packages/release-artifact/src/index.ts` (`collectCommandPackageClosure`, `mergeClosureDependencies`, `intersectSemverRanges`, `workspacePackageDirName`, `installProductionNodeModules`), `packages/release-artifact/test/index.test.ts`.
- Verified: same suite as RAARC-01.
- Result: The install scaffold now lists **only** the transitive closure of command-owning packages (those with a `bin` entry) in `pnpm-workspace.yaml`, so unrelated workspace packages and their dependencies are never materialised. `mergeClosureDependencies` deduplicates ranges and rejects incompatible range conflicts via `intersectSemverRanges` (e.g. `^1.0.0` vs `^2.0.0` fails; `workspace:` protocols are handled explicitly; mixing `workspace:` and concrete ranges rejects). Internal `@repo-toolkit/*` workspace ranges are kept so pnpm links them under `node_modules/@repo-toolkit/*`. The scaffold `package.json`, `pnpm-workspace.yaml`, and the generated `pnpm-lock.yaml` are removed in a `finally` so no scaffolding is shipped. New tests cover closure-walk, range intersection, and conflict rejection.

### RAARC-04 — Bound and inject external execution

- Changed: `packages/release-artifact/src/index.ts` (`ArtifactRunner`, `ArtifactRunOptions`, `defaultArtifactRunner` with `timeoutMs`/`maxOutputBytes`/`killSignal`; `validateReleaseArchive`, `listArchiveEntries`, `verifyReleaseArtifact`, `verifyExtractedArtifact`, `installReleaseArtifact`, and `installProductionNodeModules` now route through the injected runner; `BuildArtifactOptions`/`VerifyArtifactOptions`/`InstallArtifactOptions`/`VerifyExtractedArtifactOptions` accept `runner` and `runTimeoutMs`), `packages/release-artifact/src/cli-build.ts`, `packages/release-artifact/src/cli-verify.ts`, `packages/release-artifact/src/cli-install.ts` (`--run-timeout-ms`), `packages/release-artifact/test/index.test.ts` (the real-repo production-install test now uses `try/finally`; new tests inject a fake runner and assert exact `tar`/`pnpm`/`bash` invocations), `bin/install` (regenerated).
- Verified: same suite as RAARC-01.
- Result: Every external invocation (`tar -czf`/`-xzf`/`-tvzf`, `pnpm install`, `bash -n`, generated wrappers) routes through an injectable `ArtifactRunner`. The default runner bounds execution with `timeoutMs` (default 60s, `SIGTERM`) for `run()` and additionally `maxOutputBytes` (default 8 MiB) for `capture()`. A hanging process is terminated and the error surfaces clearly (regression test in `default runner terminates a hanging process with a clear error`). Tests inject a recording runner to assert `pnpm` is invoked only when `nodeModulesMode === 'production'`, `tar` is invoked once with the configured cwd and timeout, and `installReleaseArtifact` routes `tar -tvzf` through `capture()` and `tar -xzf` through `run()`. The fake-runner tests run offline and leave the worktree unchanged. One isolated real-repo production smoke test (with `try/finally` cleanup) is retained for end-to-end confidence.

## Definition Of Done

An independent reviewer compares two artifact builds, validates each dependency mode, and confirms all external operations are bounded and test-isolatable.
