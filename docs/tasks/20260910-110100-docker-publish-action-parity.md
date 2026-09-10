# Docker Publish Action Parity (Annotations, Cache, OCI Export)

Created: 2026-09-10 11:01:00

Status: completed

## Objective And Scope

Close the three in-scope gaps between the composite `docker-build-push` GitHub Action and `@repo-toolkit/docker-publish` that fit the package's boundaries: OCI manifest/index **annotations**, build **cache** configuration, and **OCI-layout export**. Everything else from that comparison (metadata tag templating, gated scan-before-push workflows, pre-push hooks, Trivy/SBOM/attestations, step summaries/bake files, builder provisioning, plaintext password inputs) stays out per Non-goals.

Related plans (all `completed`, do not reopen):

- `docs/tasks/20260909-220018-docker-publish-package.md` — core package.
- `docs/tasks/20260909-234906-docker-publish-interactive-prompts.md` — interactive mode.
- `docs/tasks/20260910-003030-docker-publish-review-remediation.md` — hardening (its unifications — single runner, shared concurrency, `cli-filter.ts`, single login — are the foundation this plan builds on).

Success: a config can carry `annotations`, `cacheFrom`/`cacheTo`, and `ociExportDir`; builds pass them to `docker buildx build` as structured argv with the same bounds/redaction discipline as `buildArgs`/`labels`; OCI layouts land atomically with a reported index digest; CLIs, interactive prompts, docs, and examples cover all three; the suite proves non-interactive behavior otherwise unchanged.

## Working Rules And Non-Goals

Working rules:

- Do not revert or rewrite unrelated worktree changes. Inspect `git status --short` before each task and never touch other task files.
- Do not hand-edit `CHANGELOG.md`.
- Do not add a runtime dependency; standard library plus `@repo-toolkit/publish-package` only.
- No shell-string execution anywhere; every new Docker flag travels as argv entries.
- Secret-bearing values use the runner `secrets` channel and `redactSensitiveValues` (the REV-01 pattern). Summaries stay secrets-free: no new value-bearing fields in `planSummary` or result summaries.
- Preserve the ES2018 target. No `process.exit()`; set `process.exitCode = 1`.
- Keep `dist/` out of commits. Reuse the shared validators/tables exported from `plan.ts` and helpers in `runner.ts`/`cli-filter.ts`; do not re-clone them.
- Add completion evidence to this file per task. A task is not complete until its verification passes or a blocker is recorded.

Non-goals:

- Tag/label/annotation _generation_ (semver/sha/ref templating in the docker/metadata-action style). Values remain caller-owned literals.
- Gated scan-before-push workflows, pre-push command hooks, Trivy/CVE scanning, SBOM generation, provenance/SBOM attestations, step summaries, bake files, version derivation.
- Builder provisioning (`setup-buildx`, driver-opts). Bring-your-own Docker + buildx stays a prerequisite.
- Plaintext `password` input in config. Passwords stay env-only (`passwordEnv` → `--password-stdin`) by design.
- Pushing OCI-exported layouts. Export is an export-only mode (see PAR-03 boundaries).

## Baseline Verification

Before implementation begins, the PAR-01 owner records results for:

```sh
git status --short
pnpm lint
pnpm typecheck
pnpm --filter @repo-toolkit/docker-publish test
```

If baseline failures exist, record exact commands and output summaries here before changing code. Do not silently fix unrelated failures.

Baseline completion evidence:

- `git status --short` → only `?? docs/tasks/20260910-110100-docker-publish-action-parity.md` (this plan file, untracked); no other worktree changes.
- `pnpm lint` → pass, no findings.
- `pnpm typecheck` → pass across all packages.
- `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 187 tests, all pass.

## Priority Definitions

- P0: Final review gate. Nothing else carries P0; no known secret leak or integrity bypass is in scope.
- P1: The three features, CLI/interactive wiring, and docs — all required for the plan's objective.
- P2: None currently; use sparingly if follow-ups surface.

## Planned Contract (Additive Only)

```ts
// plan (global and per-image, mirroring buildArgs/labels)
annotations?: Record<string, string>;
// plan (global only)
cacheFrom?: string[];
cacheTo?: string[];
ociExportDir?: string; // project-root-relative; export-only mode
```

```ts
// build result, additive fields
exportDir?: string; // resolved layout dir for the image
exportDigest?: string; // sha256 of the exported index.json
```

New CLI flag (build + unified CLIs, mirroring `--digest-manifest`):

```text
--oci-export-dir <path>  Write per-image OCI layouts; overrides config ociExportDir
```

Agents may refine names but must not change the export-only incompatibility with push, the no-new-summary-values rule, or the structured-argv-only rule without recording a maintainer decision here.

## Execution Waves

1. Build-input features: PAR-01 (annotations) → PAR-02 (cache). Strictly sequential; both reshape `plan.ts` validation and `buildArgv`.
2. Export mode: PAR-03 (OCI export). After wave 1 (touches the same build path).
3. Surface: PAR-04 (CLI flag, interactive advanced prompts, docs, tested example). After all library behavior stabilizes.
4. Review: PAR-05 (independent final review). Alone, last.

## Detailed Tasks

### Task PAR-01: OCI Manifest/Index Annotations

Status: completed

Priority: P1

Suggested agent: container build engineer

Dependencies: none

Primary ownership:

- `packages/docker-publish/src/plan.ts` (types + validation only)
- `packages/docker-publish/src/build.ts` (argv + secrets only)
- `packages/docker-publish/test/plan.test.ts`
- `packages/docker-publish/test/build.test.ts`

Finding:

The action accepts `metadata-annotations` / `metadata-labels-annotations` and forwards them to `build-push-action` `annotations`, which become OCI manifest/index annotations via `docker buildx build --annotation`. `docker-publish` has `buildArgs`/`labels` but no annotations concept, so there is no way to stamp `org.opencontainers.image.*` (or custom) annotations onto published manifests. Grep `buildArgv` in `src/build.ts` and the map validators in `src/plan.ts` for the exact patterns to mirror.

References:

- `packages/docker-publish/src/build.ts` (`buildArgv`, `mergedMap`, secret collection from REV-01)
- `packages/docker-publish/src/plan.ts` (map bounds + secret-guard tables, `IMAGE_KEYS`, `OPTION_KEYS`)
- Action inputs `metadata-annotations`, `metadata-labels-annotations` (external reference; behavior described above)

Implementation requirements:

1. Add `annotations` as a global and per-image string map mirroring `buildArgs`/`labels` exactly: same 64-entry / 128-char-key / 4096-char-value bounds, same secret-key guard (`TOKEN|SECRET|PASSWORD` unless `allowSecretsInBuildArgs`), same per-image-over-global merge, same unknown-key rejection (`IMAGE_KEYS`, `OPTION_KEYS`).
2. Pass as sorted `--annotation KEY=VALUE` argv entries (buildx qualifier prefixes such as `manifest:` flow through as ordinary key characters, subject to the same key rules).
3. Treat secret-pattern values exactly like REV-01 build secrets: into the runner `secrets` channel and redacted from `buildError`.
4. Do not add annotation values to any summary object.
5. Combined `labels`-plus-`annotations` input (the action's `metadata-labels-annotations`) stays a caller-side concern: document that callers put the same entries in both maps.

Acceptance criteria:

- Recording-runner tests assert exact sorted `--annotation` argv, merge precedence (per-image over global), and bound/secret-guard rejections matching `buildArgs` behavior.
- A canary secret annotation value appears in no argv recording, error, or summary.
- New tests fail on the old implementation (unknown `annotations` key rejected at plan time).
- `pnpm --filter @repo-toolkit/docker-publish test -- build.test.ts plan.test.ts` passes.

Completion evidence:

- `annotations` added as a global and per-image string map in `src/plan.ts` (types, `OPTION_KEYS`/`IMAGE_KEYS`, same 64-entry / 128-char-key / 4096-char-value bounds and `TOKEN|SECRET|PASSWORD` guard via `validateStringMap`).
- `src/build.ts` merges per-image over global via `mergedMap`, emits sorted `--annotation KEY=VALUE` argv after `--label` entries, feeds secret-pattern values into the runner `secrets` channel with `buildError` redaction; no summary changes. Combined labels-plus-annotations documented as caller-side concern in a code-adjacent comment.
- Tests: `test/plan.test.ts` +5 (defaults, known-key acceptance incl. `manifest:` qualifier, bounds parity, secret guard, unknown-key rejection); `test/build.test.ts` +6 (exact sorted argv with per-image precedence, qualifier passthrough, merged-overflow failure before any process, plan-time secret rejection, canary redaction via secrets channel, no annotation values in build result).
- Failing-before check: with `src/` changes stashed, all 11 new tests fail while the 187 pre-existing tests pass; with the fix, 198/198 pass.
- `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 198 tests pass. `pnpm lint`, `pnpm typecheck`, `git diff --check` → clean.
- Files changed: `packages/docker-publish/src/plan.ts`, `src/build.ts`, `test/plan.test.ts`, `test/build.test.ts`. `CHANGELOG.md` untouched.

### Task PAR-02: Build Cache From/To Flags

Status: completed

Priority: P1

Suggested agent: container build engineer

Dependencies: PAR-01

Primary ownership:

- `packages/docker-publish/src/plan.ts` (types + validation only)
- `packages/docker-publish/src/build.ts` (argv only)
- `packages/docker-publish/test/plan.test.ts`
- `packages/docker-publish/test/build.test.ts`

Finding:

The action wires `cache-from: type=local,…` / `cache-to: type=local,…` plus an actions/cache layer directory into every build. `docker-publish` passes no `--cache-from`/`--cache-to` flags, so every build is cold and there is no way to reuse layers across CI runs. `buildArgv` in `src/build.ts` is the single enforcement point.

References:

- `packages/docker-publish/src/build.ts` (`buildArgv`)
- `packages/docker-publish/src/plan.ts` (option validation)
- Action `cache-from`/`cache-to` layer caching (external reference; behavior described above)

Implementation requirements:

1. Add global-only `cacheFrom?: string[]` and `cacheTo?: string[]`. Each entry: non-empty string, max 4096 chars, no NUL bytes, max 16 entries per list. Non-array values fail with a clear message.
2. Pass through as repeated `--cache-from <spec>` / `--cache-to <spec>` argv entries in fixed positions (after annotations, before `--load`/context).
3. Preserve user order exactly — do NOT sort (cache-from order is priority order).
4. Do not scan specs for secrets (keys/URLs cannot be classified reliably); document that cache specs must not embed secrets and that values never appear in summaries.
5. No summary changes.

Acceptance criteria:

- Tests assert exact argv order across multiple `--cache-from`/`--cache-to` entries and that reordered input produces reordered argv.
- Bounds violations (empty entry, oversize entry, >16 entries, non-array) fail during planning.
- New tests fail on the old implementation (unknown keys rejected).
- `pnpm --filter @repo-toolkit/docker-publish test -- build.test.ts plan.test.ts` passes.

Completion evidence:

- `cacheFrom`/`cacheTo` added as global-only string lists in `src/plan.ts` (types, `OPTION_KEYS`, `validateCacheSpecs`: non-empty, max 4096 chars, no NUL, max 16 entries per list, non-array fails with `must be an array of cache spec strings`); per-image `cacheFrom`/`cacheTo` rejected as unknown image keys.
- `src/build.ts` `buildArgv` emits repeated `--cache-from <spec>` / `--cache-to <spec>` after `--annotation` entries and before `--load`/context, preserving user order exactly (never sorted); no secret scanning on specs with a code comment documenting no-secrets-in-cache-specs guidance and no-summary-values (PAR-04 owns user docs); no summary or result-shape changes.
- Tests: `test/plan.test.ts` +6 (defaults, ordered acceptance, entry bounds, >16 rejection, non-array rejection, global-only per-image rejection); `test/build.test.ts` +5 (exact argv incl. annotation-relative position, order preservation incl. reordered-input check, no flags when unconfigured, plan-time failure before any process, no cache values in build result).
- Failing-before check: with `src/` changes stashed, 20 tests fail (all 11 PAR-01 plus 9 of 11 PAR-02 — every cache test that configures cache fails with `Unknown docker-publish option: cacheFrom`; the 2 vacuous negatives, no-flags-when-unconfigured and per-image unknown-key rejection, pass on old code as expected); with the fix, 209/209 pass.
- `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 209 tests pass. `pnpm lint`, `pnpm typecheck`, `git diff --check` → clean.
- Files changed: `packages/docker-publish/src/plan.ts`, `src/build.ts`, `test/plan.test.ts`, `test/build.test.ts`. `CHANGELOG.md` untouched.

### Task PAR-03: OCI-Layout Export Mode

Status: completed

Priority: P1

Suggested agent: artifact engineer

Dependencies: PAR-02

Primary ownership:

- `packages/docker-publish/src/plan.ts` (option + validation only)
- `packages/docker-publish/src/build.ts` (output argv, atomic write, digest capture, push guard)
- `packages/docker-publish/test/plan.test.ts`
- `packages/docker-publish/test/build.test.ts`

Finding:

The action's `docker-outputs` allows exporting build results outside the daemon (e.g. OCI/tar layouts for offline handling). `docker-publish` builds only into the daemon (`--load`) or metadata-only, so air-gapped or layout-consuming workflows have no equivalent. This task adds a bounded export-only mode, not a general `--output` passthrough (which would break the verification story).

References:

- `packages/docker-publish/src/build.ts` (`buildArgv`, `--load` handling, local verification, untag, result types)
- `packages/docker-publish/src/publish.ts` (push entry — guard location)

Implementation requirements:

1. Add global-only `ociExportDir?: string`: must be relative, dot-only means the project root, no `..` segments, must stay inside `cwd` (reuse the `digestManifestPath`-style validation already in the package). Per-image layout dir is `<ociExportDir>/<image-name>/`.
2. When set, build passes `--output type=oci,dest=<temp-sibling-dir>` per image (buildx writes the layout there) instead of `--load`; create the temp dir exclusively, rename atomically onto the final dir on success, clean up on failure. No `dist/` writes; only caller-owned export paths plus the daemon.
3. Skip local tag verification and untag for exported images (no local tags exist); instead read `<dest>/index.json`, require a non-empty `manifests` array, and report `exportDigest` as `sha256:` over the raw `index.json` bytes plus `exportDir` in the build result (additive fields only).
4. Fail closed in `publishDockerImages` when the resolved plan carries `ociExportDir` (exported images have no local tags to push): throw a clear error directing the caller to rebuild without it. Malformed `index.json` (unparsable, empty manifests) fails the build with a clear error.
5. Multi-platform images export all platforms into the one layout; `--push` never appears in the build path (existing invariant, re-assert for the export argv).
6. Document that registry `verify` does not cover exported layouts (verify stays manifest-only against registries) and that export + push in one plan is rejected.

Acceptance criteria:

- A fake-runner test emulating buildx layout output proves: layout dir contents, `exportDigest` equals `sha256(index.json bytes)`, atomic rename (no partial dir visible on injected failure), and temp cleanup.
- Publishing a plan with `ociExportDir` fails before any push with the explicit error.
- Path escapes (`..`, absolute) fail during planning.
- New tests fail on the old implementation (unknown key rejected).
- `pnpm --filter @repo-toolkit/docker-publish test -- build.test.ts plan.test.ts` passes.

Completion evidence:

- `ociExportDir` added as a global-only option in `src/plan.ts` (types, `OPTION_KEYS`, `resolveOciExportDir`: non-empty relative string, dot-only resolves to the project root, no `..` segments, `ensureContainedPath` containment in `cwd` mirroring the `digestManifestPath` validation; per-image `ociExportDir` rejected as an unknown image key). Resolved value is the absolute export root; per-image layout dir is `<ociExportDir>/<image-name>/`.
- `src/build.ts` emits `--output type=oci,dest=<exclusive-temp-sibling>` instead of `--load` whenever the plan carries `ociExportDir` (all platform counts; multi-platform exports land in the one layout), creates the temp dir exclusively (`wx`-style existence check), renames atomically onto the final dir on success (`rm` + `renameSync`, temp removed on any failure), skips local tag verification and untag for exported images, reads `<dest>/index.json`, rejects unparsable content and empty `manifests` arrays, and reports additive-only `exportDir` + `exportDigest` (`sha256:` over the raw `index.json` bytes via `node:crypto createHash`, matching the repo's existing checksum pattern). `--push` never appears in the build path (re-asserted in argv tests and module source). Code comment documents that registry `verify` stays manifest-only against registries and that export + push is rejected (PAR-04 owns user docs). No summary changes.
- `src/publish.ts` fails closed at the top of `publishDockerImages` when the resolved plan carries `ociExportDir` (before any runner call) with an explicit rebuild-without-it error.
- Tests: `test/plan.test.ts` +5 (default undefined, relative acceptance with per-image dest check, dot-only root, absolute/`..`/NUL/empty/non-string rejections, global-only per-image rejection); `test/build.test.ts` +7 (layout contents + `exportDigest` equality + `--output`-not-`--load` argv with temp-sibling shape, multi-platform single-layout export, malformed-layout failures with no untag and temp cleanup, build-failure atomicity with no partial dir, publish guard with zero runner calls, plan-time path failure with zero processes, `--push`-never re-assertion). The pre-existing `node:fs`-absence source assertion was updated since `build.ts` now legitimately uses `node:fs` for atomic layout writes.
- Failing-before check: with `src/` changes stashed, 3 of 5 new plan tests fail with `Unknown docker-publish option: ociExportDir` (the 2 vacuous negatives, defaults-undefined and per-image unknown-key rejection, pass on old code as expected); with the fix, 221/221 pass.
- `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 221 tests pass. `pnpm lint`, `pnpm typecheck`, `git diff --check` → clean.
- Files changed: `packages/docker-publish/src/plan.ts`, `src/build.ts`, `src/publish.ts` (guard only), `test/plan.test.ts`, `test/build.test.ts`. `CHANGELOG.md` untouched.

### Task PAR-04: CLI Flag, Interactive Prompts, Docs, And Tested Example

Status: completed

Priority: P1

Suggested agent: CLI contract engineer

Dependencies: PAR-01, PAR-02, PAR-03

Primary ownership:

- `packages/docker-publish/src/cli.ts`
- `packages/docker-publish/src/cli-build.ts`
- `packages/docker-publish/src/interactive.ts`
- `packages/docker-publish/test/cli.test.ts`
- `packages/docker-publish/test/examples.test.ts` + `test/fixtures/`
- `packages/docker-publish/README.md`
- `website/docs/packages/docker-publish.md`

Finding:

PAR-01 through PAR-03 are library-only until the CLIs, interactive prompts, docs, and examples expose them. Existing conventions: `--digest-manifest` shows the flag-override pattern to mirror; `promptAdvanced` owns the build-args/labels/concurrency prompts; website JSON blocks must equal tested fixtures (DOCK-08 rule).

References:

- `packages/docker-publish/src/cli.ts`, `src/cli-build.ts` (SPECS tables, help text)
- `packages/docker-publish/src/interactive.ts` (`promptAdvanced`)
- `packages/docker-publish/test/cli.test.ts` (help/README agreement tests)

Implementation requirements:

1. Add `--oci-export-dir <path>` to the build and unified CLIs (config override, same shape as `--digest-manifest`); annotations/cache stay config-file-only like `buildArgs`/`labels` (no new flags for them).
2. Extend `promptAdvanced` with: annotations as `KEY=VALUE` lines (same shape/validation as buildArgs), cacheFrom/cacheTo as one spec per line (never comma-split — specs legitimately contain commas), ociExportDir as an optional path. Declining customize still preserves loaded values for all three (REV-02 rule).
3. Update all three CLI help tables, package README tables + API section, and website docs with `Annotations`, `Build cache`, and `OCI export` sections (contracts, argv mapping, secrecy rules, export-only incompatibility with push, no-summary-values rule).
4. Add a third tested example config exercising annotations + cache (+ ociExport via the fake tooling that emulates layout output) with website JSON blocks required equal to fixtures. Keep the two existing examples green.
5. Keep every help/README agreement assertion green; `publish-packages` contract tests must pass.

Acceptance criteria:

- `--oci-export-dir` appears in build + unified `--help` and README tables; invalid values fail before any runner call.
- Interactive advanced flow round-trips all three new values (accept-defaults reproduces config).
- New example fixture drives plan → dry-run → build → publish(+ oci export emulation) → verify with injected fakes and no daemon/network.
- `pnpm --filter @repo-toolkit/docker-publish test` and `pnpm --filter @repo-toolkit/publish-packages test` pass.

Completion evidence:

- `src/cli.ts` + `src/cli-build.ts`: `--oci-export-dir <path>` SPECS entry plus help line (`Write per-image OCI layouts; overrides config ociExportDir`, mirroring `--digest-manifest`); publish CLI untouched (export + push stays refused). Annotations/cache intentionally have no flags (config-file-only like `buildArgs`/`labels`; `--annotation`/`--cache-from`/`--cache-to` rejected as unknown arguments).
- `src/cli-filter.ts`: `applyCliOverrides` maps `--oci-export-dir` onto `ociExportDir` so invalid values fail during plan resolution before any runner call; `applyCliFilters` threads `annotations`/`cacheFrom`/`cacheTo` from the resolved plan plus raw `ociExportDir` from merged config (plan holds it absolute and re-resolution rejects absolutes), so CLI builds no longer drop PAR-01–03 values.
- `src/cli-options.ts`: `collectCliSecrets` covers global and per-image annotation values (same breadth as `buildArgs`/`labels`); cache specs excluded per the no-secret-scanning rule; no `planSummary` changes (no-summary-values rule).
- `src/interactive.ts` (`promptAdvanced` only, plus one-line per-image annotation preservation in `promptImageEntries`/`readImageDefaults` mirroring `buildArgs`/`labels` so interactive runs do not silently drop them): `ADVANCED_KEYS` gains `annotations`/`cacheFrom`/`cacheTo`/`ociExportDir` (declining customize preserves loaded values per REV-02); customize flow appends annotations via `promptKeyValueMap` (same shape/validation as buildArgs, shared secret guard), `cacheFrom`/`cacheTo` via new `promptCacheSpecs` (one spec per line, never comma-split, `MAX_CACHE_SPECS`/`MAX_CACHE_SPEC_LENGTH` bounds), and optional `ociExportDir` via `promptOptionalLine` with plan-mirroring relative-path validation (dot-only means project root; empty omits the key).
- Tests: `test/cli.test.ts` +3 (help surface incl. publish-CLI absence and config-file-only rejection; flag-overrides-config via emulated OCI-layout fake docker; invalid/missing values fail before any marker-executable invocation on both CLIs). `test/interactive.test.ts` +3 with 2 sequence updates for the appended prompts (round-trip with per-image annotations on decline, customized answers incl. comma-bearing cache spec staying one entry, absolute-path re-prompt). `test/examples.test.ts`: third `annotations-cache-export` fixture through the full plan → dry-run → build → publish → verify pipeline with sorted-`--annotation`/ordered-cache argv assertions, plus an OCI-export emulation test (fake runner writes `index.json` to the `--output` dest; asserts layout contents, `exportDigest` equality, temp cleanup, no `--load`/`--push`, and publish refusal with zero runner calls).
- Docs: README build + unified tables gain `--oci-export-dir`; website gains the `annotations-cache-export` JSON block (asserted equal to the fixture), `annotations`/`cacheFrom`/`cacheTo`/`ociExportDir` config-reference rows, precedence/CLI/interactive/argv notes, and `Annotations`, `Build cache`, `OCI export` sections (contracts, argv mapping, secrecy, export-only vs push, no-summary-values). `CHANGELOG.md` untouched.
- Verification: `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 231 tests pass; `pnpm --filter @repo-toolkit/publish-packages test` → 3 files, 85 tests pass; `pnpm lint`, `pnpm typecheck`, `git diff --check` → clean.
- Files changed: `packages/docker-publish/src/cli.ts`, `src/cli-build.ts`, `src/cli-filter.ts`, `src/cli-options.ts`, `src/interactive.ts`, `test/cli.test.ts`, `test/interactive.test.ts` (appended-prompt sequences only), `test/examples.test.ts`, `test/fixtures/annotations-cache-export/docker-publish.json`, `README.md`, `website/docs/packages/docker-publish.md`. `CHANGELOG.md` untouched.

### Task PAR-05: Independent Final Integration Review

Status: completed

Priority: P0

Suggested agent: independent reviewer who did not implement PAR-01 through PAR-04

Dependencies: PAR-01 through PAR-04

Primary ownership:

- review of all `packages/docker-publish/` changes
- focused corrective changes discovered during review
- completion evidence in this task document

Finding:

This plan touches plan validation, build argv, secret handling, atomic filesystem writes, and the publish entry guard. Independent review is required because an argv, redaction, or atomicity regression would weaken prior guarantees.

References:

- all PAR task acceptance criteria
- `packages/publish-packages/test/contract.test.ts:78-349`

Implementation requirements:

1. Re-verify every prior criterion against runtime behavior: annotation argv + secret redaction with canaries, cache order preservation, OCI layout bytes + digest + atomicity + push refusal, interactive round-trips, single-definition greps (one `--annotation` builder, one cache builder, one OCI guard).
2. Pack to `/tmp`, run all three bins `--help` from the unpacked tarball, import the built ESM.
3. Run serially: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`.
4. Record deferred issues with owner, rationale, residual risk. Do not complete with unresolved P0/P1.

Acceptance criteria:

- Every PAR-01 through PAR-04 criterion confirmed at runtime.
- No secret in argv, summaries, logs, or errors on any new path.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` pass from the root.
- Commands, counts, artifact checks, and residual risk recorded in completion evidence.

Completion evidence:

- Reviewer independence: PAR-05 executed without reusing PAR-01..PAR-04 implementation notes; every criterion below was re-proven by executing code, not by reading it. No P0/P1 regression found, so no corrective code changes were made (no new regression tests needed; the existing suite already pins the behavior).
- Built-dist runtime probe (`/tmp/par05-probe.mjs`, against `packages/docker-publish/dist/index.js` after a fresh `pnpm build`): 33/33 checks pass —
  - PAR-01: exact sorted `--annotation` argv with per-image-over-global precedence (`a-key=override` beats global), `manifest:` qualifier passthrough, no `--push` in build argv, no canary in plan summary; canary `par05-canary-token-9f31ab` redacted from build error while present in the runner `secrets` channel and absent from the success-path build result; secret-like `API_TOKEN` key rejected at plan time with zero processes.
  - PAR-02: multi-entry `--cache-from`/`--cache-to` order preserved exactly, positioned after `--annotation` and before `--load`; reversed input produces reversed argv; empty/oversize/`>16`/non-array specs and per-image `cacheFrom` all rejected at plan time.
  - PAR-03: emulated-buildx export asserts `--output` (not `--load`), no `--push`, `exportDir` reported, `exportDigest` equals `sha256:` over the raw `index.json` bytes, layout bytes present, zero `.tmp-*` leftovers after success; injected build failure leaves no partial final dir and no temp dir; empty-`manifests` `index.json` fails clearly; `publishDockerImages` with `ociExportDir` refused with the export-only error and zero runner calls; `../outside`, `/absolute/path`, `..` all rejected at plan time.
- CLI bins (built `dist/`, marker-executable probe): `--oci-export-dir` present in build + unified `--help` (1 match each), absent from publish `--help`; `--annotation`/`--cache-from` rejected with `Unknown argument` (exit 1); invalid `--oci-export-dir ../escape` fails on both build and unified CLIs (exit 1) with the marker file absent (no runner call); missing value reports `Missing value for --oci-export-dir`.
- Interactive (runtime, via suite): `test/interactive.test.ts` decline-preserves + customize-applies + absolute-path re-prompt tests for annotations/cacheFrom/cacheTo/ociExportDir pass inside the full run; comma-bearing cache spec stays one entry.
- Single-definition greps: one `--annotation` push (`src/build.ts:288`), one `--cache-from` + one `--cache-to` push (`src/build.ts:295,298`), one OCI publish guard (`src/publish.ts:85`), zero `--push` occurrences in `src/build.ts`; `process.exit(` absent (only `process.exitCode = 1`); no post-ES2018 `.at(`/`Object.hasOwn` in `src/`.
- Pack: `pnpm --filter @repo-toolkit/docker-publish exec pnpm pack --pack-destination /tmp/par05-pack` → `repo-toolkit-docker-publish-0.0.0-PLACEHOLDER.tgz`, SHA256 `dbc706fd30c499248ab72a48b354c32fae0c55e3a9d3d1aa43e1fe54973cb48d` (informational; tarballs embed timestamps). Unpacked tarball (with a `node_modules` symlink for the external `@repo-toolkit/publish-package` dep, which is not bundled by design): unified + build bins show `--oci-export-dir`, publish bin does not; tarball ESM imports and resolves a plan carrying `annotations`, `cacheFrom`, and absolute `ociExportDir`.
- Serial root runs, in order, all pass: `pnpm lint` (clean), `pnpm typecheck` (clean), `pnpm build` (clean), `pnpm test` (exit 0) — 58 files / 1385 tests: publish-package 8/215, changelog 3/81, compose-sandbox 18/225, confluence 7/343, docker-publish 9/231, go-release 9/105, publish-packages 3/85, release-artifact 1/100.
- Worktree: `git status --short` shows only plan-owned paths — modified `packages/docker-publish/{src,test,README.md}` + `website/docs/packages/docker-publish.md`, untracked `docs/tasks/20260910-110100-docker-publish-action-parity.md` + `packages/docker-publish/test/fixtures/annotations-cache-export/`; `CHANGELOG.md` untouched (zero changelog paths in `git diff --name-only`); no unrelated tracked files modified.
- Corrections made: none. Residual risks: the four Deferred Follow-Up Decisions stand unchanged (cache-spec secret scanning, non-OCI export types, push-from-layout verification, cross-package helper sharing); probe/tarball artifacts live under `/tmp` and are not part of the repo.

## Dependency And Parallelization Guidance

| Wave | Tasks           | Agent focus  | Parallel guidance                                                          |
| ---- | --------------- | ------------ | -------------------------------------------------------------------------- |
| 1    | PAR-01 → PAR-02 | build inputs | Strictly sequential; both reshape `plan.ts` validation and `buildArgv`.    |
| 2    | PAR-03          | export mode  | After wave 1; owns the same build path plus publish guard.                 |
| 3    | PAR-04          | surface      | After all library behavior stabilizes; owns CLIs, prompts, docs, examples. |
| 4    | PAR-05          | review       | Alone, last.                                                               |

Shared hotspots (sequence, never parallel):

- `src/plan.ts`, `src/build.ts`: PAR-01 → PAR-02 → PAR-03.
- `src/interactive.ts`, CLI files, docs: PAR-04 only.
- Root manifests, `tsconfig.base.json`: no task owns them; do not touch.
- Never run root `pnpm build`/`pnpm test` concurrently; package tests rebuild shared `dist/`.

## Wave Verification

After waves 1–2:

```sh
pnpm --filter @repo-toolkit/docker-publish test
pnpm lint
pnpm typecheck
```

After wave 3:

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

## Deferred Follow-Up Decisions

1. Whether `cacheFrom`/`cacheTo` deserve secret scanning (registry credentials in cache specs) — deferred; documented guidance stands until a concrete leak scenario appears.
2. Whether to support `type=docker`/tarball or `type=local` exports alongside OCI layouts — separate proposal; this plan is OCI-layout only.
3. Whether exported layouts should feed registry verification (push-from-layout flows) — deferred; export stays export-only.
4. Whether `go-release` or other packages should share any new helper — separate proposal; no cross-package rewrites here.

## Definition Of Done

- Annotations, cache flags, and OCI export resolve, build, and behave per the contracts above with tests failing-before/passing-after.
- No secret appears in argv, summaries, logs, or errors on any new path; summaries carry no new value-bearing fields.
- `--push` still never appears in any build-path argv; export + push is explicitly refused.
- Help, README, website, examples, and implementation agree; `publish-packages` contracts green.
- PAR-05 independently confirms all of it.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` pass from the root.
- Deferred items remain explicitly deferred.
