# Docker Publish Review Remediation

Created: 2026-09-10 00:30:30

Status: completed

## Objective And Scope

Remediate the findings of a two-agent review (correctness/security + readability/architecture) of the new `packages/docker-publish/` package, covering readability, accuracy, security, performance, and architectural health (encapsulation, reusability, testability).

Every finding below was verified in source before this file was written; line references were re-checked against the current tree. A second, load-bearing check (exact argv behavior, symlink-redirect write, per-image map loss, duplicated blocks, serial verify loop, type-only runner exports) was confirmed by direct reads of `src/build.ts`, `src/runner.ts`, `src/interactive.ts:180-499`, `src/publish.ts:90-169,540-629`, `src/verify.ts:60-139`, and `src/index.ts`.

Related plans (all `completed`, do not reopen them):

- `docs/tasks/20260909-220018-docker-publish-package.md` — core package.
- `docs/tasks/20260909-234906-docker-publish-interactive-prompts.md` — interactive mode.

The work is successful when secret build values can no longer leak through the build path, interactive runs preserve configured per-image maps, the runner/concurrency/filter/login primitives exist exactly once, the manifest write resists sibling redirection, CLI auth fails fast, the CLI resolves the plan once, verification is bounded-parallel without a temp roundtrip, consumers can import the formatter and runner values, tests share one fixture helper — and the full suite proves non-interactive behavior unchanged.

## Working Rules And Non-Goals

Working rules:

- Do not revert or rewrite unrelated worktree changes. Inspect `git status --short` before each task and never touch other task files.
- Do not hand-edit `CHANGELOG.md`; release tooling owns it.
- Do not add a runtime dependency; reuse `@repo-toolkit/publish-package` helpers or the standard library and record the reason if reuse proves impossible.
- Non-interactive behavior (validation messages, argv, summaries, exit codes) must stay unchanged unless the task explicitly declares a contract change with tests + docs updated together.
- Preserve the ES2018 target (`tsc --noEmit` catches `Array.prototype.at` and friends). No `process.exit()`; set `process.exitCode = 1`.
- Keep `dist/` out of commits. Prefer the smallest shared enforcement point (plan boundary, runner boundary, single formatter, single login helper).
- Add completion evidence to this file as each task finishes. A task is not complete until its verification passes or a blocker is recorded.

Non-goals:

- Changing push/digest/verify semantics, tag charset rules, registry allowlist policy, or the serial-publish default (tag case is a deferred maintainer decision below).
- Real-daemon or Windows-machine probes (hypotheses stay deferred with rationale).
- Migrating any consumer repository or rewriting `go-release` to share the new helpers (note the duplication for a later proposal instead).

## Baseline Verification

Before implementation begins, the REV-01 owner records results for:

```sh
git status --short
pnpm lint
pnpm typecheck
pnpm --filter @repo-toolkit/docker-publish test
```

If baseline failures exist, record exact commands and output summaries here before changing code. Do not silently fix unrelated failures.

Baseline completion evidence:

- Recorded by REV-01 owner on 2026-09-10 before any code change.
- `git status --short`: tracked tree had pre-existing modifications (AGENTS.md, README.md, docs/tasks/20260902-102251-configurable-package-artifact-publishing.md, package.json, packages/publish-package/src/index.ts, packages/publish-package/src/prompt.ts, pnpm-lock.yaml, tsconfig.base.json, website/docs/packages/index.md) plus untracked additions (docs/tasks/20260909-\*.md, docs/tasks/20260910-003030-docker-publish-review-remediation.md, packages/docker-publish/, packages/publish-package/test/prompt.test.ts, website/docs/packages/docker-publish.md). No baseline failures attributable to REV-01 scope; unrelated changes left alone.
- `pnpm lint`: pass (exit 0).
- `pnpm typecheck`: pass (exit 0, `pnpm -r exec tsc --noEmit`).
- `pnpm --filter @repo-toolkit/docker-publish test`: 9 files, 143 tests, all passed.

## Priority Definitions

- P0: Confirmed secret leak, silent data loss, or integrity bypass. Fix first.
- P1: Confirmed architectural defect (triplication, split-brain paths) or hardening gap with a concrete exploit/accuracy scenario.
- P2: Performance, reusability, or test-maintenance improvement with no correctness risk.

## Execution Waves

1. Confirmed defects: REV-01 (secret leak), REV-02 (map loss).
2. Encapsulation: REV-03 (runner unification) → REV-04 (concurrency helper) → REV-05 (filter/validation dedup) → REV-06 (login unification). Strictly in this order; all four touch overlapping files.
3. Hardening and trust: REV-07 (manifest sibling), REV-08 (context trust investigation), REV-09 (early auth validation).
4. Performance and surface: REV-10 (plan-once + parallel verify), REV-11 (public exports), REV-12 (test helpers).
5. Final review: REV-13.

Do not start a later wave until dependencies are completed and their targeted verification passes.

## Detailed Tasks

### Task REV-01: Redact Secret Build-Arg And Label Values In The Build Path

Status: completed

Completion evidence:

- Changed files: `packages/docker-publish/src/build.ts`, `packages/docker-publish/test/build.test.ts` only (plus this task-file status/evidence update; `CHANGELOG.md` untouched).
- `src/build.ts`: added `collectBuildSecrets(plan, image)` which reuses the existing `SECRET_KEY_PATTERN` gate over the merged `buildArgs`/`labels` (same `mergedMap` merge + bounds validation, so the `allowSecretsInBuildArgs` plan contract is unchanged); `runOptions`/`captureOptions` now take `secrets` and forward them as `DockerRunOptions.secrets` on every runner call (build, verify-capture, untag-rmi); `buildOneImage` computes the per-image secret set once and threads it through `runBuild`, `verifyLocalImages`, `untagImage`, and `buildError`; `buildError` redacts the daemon tail via `redactSensitiveValues` before wrapping. Non-secret argv order and the failure message shape are unchanged.
- `test/build.test.ts`: new `secret build-arg and label redaction` block (3 tests): (1) failing build with `NPM_TOKEN`/label/`GLOBAL_SECRET` canaries asserts `options.secrets` carries all three merged values, the thrown message contains no canary, and the recorded argv scrubbed with the passed secrets contains no canary; (2) capture failure asserts `captureOptions` secrets carry the canary and the wrapped error is redacted; (3) non-secret failure asserts the exact prior message string, exact prior argv, and empty secrets.
- Sensitivity: with `secrets` removed from `runOptions` (old behavior), the new runOptions test fails (`options.secrets` empty, `toContain(canary)` fails); with the fix restored, `test/build.test.ts` passes 16/16.
- Verification: `pnpm --filter @repo-toolkit/docker-publish exec vitest run --config vitest.config.ts test/build.test.ts` → 16 passed; `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 146 tests passed; `pnpm lint` → pass; `pnpm typecheck` → pass; `git diff --check` → clean.

Priority: P0

Suggested agent: container security engineer

Dependencies: none

Primary ownership:

- `packages/docker-publish/src/build.ts`
- `packages/docker-publish/test/build.test.ts`

Finding:

When `allowSecretsInBuildArgs: true`, secret values are embedded verbatim in the `docker buildx build` argv (`src/build.ts:218-222`: `argv.push('--build-arg', \`${key}=${buildArgs[key]}\`)`and the same for`--label`), which is visible via `ps`and`/proc/<pid>/cmdline`. `runOptions`/`captureOptions` (`src/build.ts:231-246`) never pass the runner's `secrets`field even though`DockerRunOptions.secrets`exists and`collectSecrets` redacts it on every error path (`src/runner.ts:17,187-208,239-243`). `buildError` (`src/build.ts:328-331`) interpolates the raw daemon tail with no redaction, so a failing build whose output echoes the arg leaks the secret into CLI stderr and CI logs. Registry passwords do not have this problem (covered by `test/publish.test.ts` redaction tests); nothing covers build secrets.

References:

- `packages/docker-publish/src/build.ts:218-222,231-246,328-331`
- `packages/docker-publish/src/runner.ts:17,187-208,239-243`

Implementation requirements:

1. Collect every value whose key matches the secret pattern (reuse the existing `SECRET_KEY_PATTERN` gate) from the merged buildArgs/labels and pass those values as `secrets` in both `runOptions` and `captureOptions`.
2. Redact `buildError` output through `redactSensitiveValues` with the same secret set before wrapping.
3. Keep non-secret behavior byte-identical (same argv order, same messages for non-secret failures).
4. Do not change the `allowSecretsInBuildArgs` plan contract.

Acceptance criteria:

- A failing build with `buildArgs: { NPM_TOKEN: <canary> }` exits nonzero and the canary appears in no argv recording, no error message, no summary, and no stderr under a redaction test.
- A failing build with non-secret args still reports the exact prior message shape.
- The new test fails on the old implementation (no `secrets` passed, raw tail interpolated) and passes after the fix.
- `pnpm --filter @repo-toolkit/docker-publish test -- build.test.ts` passes.

### Task REV-02: Preserve Per-Image Build Args And Labels Through Interactive Resolution

Status: completed

Completion evidence:

- Changed files: `packages/docker-publish/src/interactive.ts`, `packages/docker-publish/test/interactive.test.ts` only (plus this task-file status/evidence update; `CHANGELOG.md` untouched).
- `src/interactive.ts`: `ImageDefault` now carries `buildArgs`/`labels`; `readImageDefaults` copies each loaded image's maps (presence-tracked via `isPlainObject`, string entries via the existing `readStringMapDefault`) matched by entry order like `name`/`contextDir` defaults; `promptImageEntries` spreads copies of the fallback maps into each rebuilt entry so `configured.images = images` no longer drops them. Advanced flow untouched: declining "customize advanced?" still carries global maps via the existing `ADVANCED_KEYS` copy, and customizing still replaces globals via `promptKeyValueMap`.
- `test/interactive.test.ts`: two new round-trip tests — (1) per-image `buildArgs`/`labels` plus global maps resolve `toEqual` the non-interactive plan for the same file when all defaults are accepted and advanced customize is declined; (2) global `buildArgs`/`labels` alone survive a declined advanced customize with full `toEqual` equality. On the old implementation both fail (rebuilt entries omit the maps, so `plan.images[0].buildArgs` is `{}` vs `{ LOG_LEVEL: 'info' }`); after the fix they pass.
- Verification: `pnpm --filter @repo-toolkit/docker-publish exec vitest run --config vitest.config.ts test/interactive.test.ts` → 34 passed; `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 148 tests passed; `pnpm lint` → pass; `pnpm typecheck` → pass; `git diff --check` → clean.

Priority: P0

Suggested agent: container CLI interaction engineer

Dependencies: none

Primary ownership:

- `packages/docker-publish/src/interactive.ts`
- `packages/docker-publish/test/interactive.test.ts`

Finding:

`readImageDefaults` keeps only `name/contextDir/dockerfile/target` (`src/interactive.ts:322-338`), `promptImageEntries` never prompts for or restores `buildArgs`/`labels` (`src/interactive.ts:444-493`), and the rebuilt array overwrites the loaded config (`src/interactive.ts:267`: `configured.images = images`). A config with `images[0].buildArgs: { LOG_LEVEL: info }` run with `-i` therefore builds without that arg — a silent behavior change versus the non-interactive run of the same file. No interactive test covers round-trip preservation of image-level maps.

References:

- `packages/docker-publish/src/interactive.ts:252,267,322-338,444-493`

Implementation requirements:

1. Carry forward each loaded image's `buildArgs`/`labels` (matched by entry order, the same way `name`/`contextDir` defaults are matched) into the rebuilt entries, unless the advanced group explicitly replaces them.
2. If the advanced flow already replaces global maps, keep that behavior; only stop the silent drop of per-image maps.
3. As part of acceptance, also prove the global `buildArgs`/`labels` survive when the "customize advanced?" confirm is declined.

Acceptance criteria:

- An interactive run over a config with per-image `buildArgs`/`labels` resolves a plan whose image maps equal the non-interactive plan for the same file.
- Declining advanced customization preserves the loaded global maps.
- New round-trip tests fail on the old implementation (maps dropped) and pass after the fix.
- `pnpm --filter @repo-toolkit/docker-publish test -- interactive.test.ts` passes.

### Task REV-03: Unify The Three Runner Interfaces And Strip/Resolve Helpers

Status: completed

Completion evidence:

- Changed files: `packages/docker-publish/src/runner.ts`, `packages/docker-publish/src/build.ts`, `packages/docker-publish/src/publish.ts`, `packages/docker-publish/src/verify.ts` only (plus this task-file status/evidence update; `CHANGELOG.md` untouched). No test files touched (existing `DockerBuildRunner`/`DockerPublishRunner`/`DockerVerifyRunner` imports keep compiling as `export type` aliases of `DockerRunner`; `src/index.ts` re-exports untouched).
- Grep before the change confirmed no imports of the three operation runner types outside `packages/docker-publish` (only `src/index.ts` re-exports, in-package tests, and docs), so no deprecated-free alias surface was added beyond `export type XRunner = DockerRunner` compat aliases in each operation module.
- `src/runner.ts`: added the single shared helper pair `stripExtraKeys(options, extraKeys)` + `resolveDockerRunner(options, strict = false)` next to `DockerRunner` (the only remaining `Runner` interface declaration). `resolveDockerRunner` preserves both validation behaviors exactly: lenient (default, returns `defaultDockerRunner` on null/non-object or missing runner) for build/verify, strict (`strict = true` throws `options must be an object` on null/non-object) for publish; invalid runners still throw the exact `validateDockerRunner` messages.
- `src/build.ts`: `DockerBuildRunner` interface replaced with `export type DockerBuildRunner = DockerRunner`; new `BUILD_EXTRA_KEYS = new Set(['runner'])`; local `stripRunner`/`resolveRunner` deleted in favor of shared helpers; internal signatures (`buildOneImage`, `runBuild`, `verifyLocalImages`, `untagImage`) now take `DockerRunner`.
- `src/publish.ts`: `DockerPublishRunner` interface replaced with `export type DockerPublishRunner = DockerRunner`; local `stripPublishExtras`/`resolveRunner` deleted; call site uses `resolveDockerRunner(options, true)` + `stripExtraKeys(options, PUBLISH_EXTRA_KEYS)`; internal signatures (`loginRegistries`, `publishOneReference`, `capturePush`, `captureInspect`) now take `DockerRunner`. `PUBLISH_EXTRA_KEYS` set unchanged.
- `src/verify.ts`: `DockerVerifyRunner` interface replaced with `export type DockerVerifyRunner = DockerRunner`; local `stripVerifyExtras`/`resolveRunner` deleted; call site uses shared helpers with unchanged `VERIFY_EXTRA_KEYS`; `verifyOneReference`/`captureRawManifest` now take `DockerRunner`.
- A single fake runner object typechecks against all three option types since all three `runner?` fields are now `DockerRunner` (verified via the untouched `test/examples.test.ts` intersection `DockerBuildRunner & DockerPublishRunner & DockerVerifyRunner` compiling and passing).
- Verification: `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 148 tests passed; `pnpm lint` → pass; `pnpm typecheck` → pass; `git diff --check` → clean.

Priority: P1

Suggested agent: encapsulation engineer

Dependencies: none

Primary ownership:

- `packages/docker-publish/src/runner.ts`
- `packages/docker-publish/src/build.ts`
- `packages/docker-publish/src/publish.ts`
- `packages/docker-publish/src/verify.ts`
- runner-related tests

Finding:

`DockerBuildRunner` (`src/build.ts:15-33`), `DockerPublishRunner` (`src/publish.ts:20-38`), and `DockerVerifyRunner` (`src/verify.ts:17-35`) are structurally identical to `DockerRunner` (`src/runner.ts:32-35`), and each operation duplicates its own `strip*Extras` + `resolveRunner` (`src/build.ts:94-114`, `src/publish.ts:142-162`, `src/verify.ts:93-113`). Fakes are not interchangeable by type and the extra-key sets can drift. (`go-release` instead embeds one runner type in its plan.)

References:

- `packages/docker-publish/src/runner.ts:32-35`
- `packages/docker-publish/src/build.ts:15-37,94-114`
- `packages/docker-publish/src/publish.ts:20-38,142-162`
- `packages/docker-publish/src/verify.ts:17-35,93-113`

Implementation requirements:

1. Keep the single `DockerRunner` in `runner.ts` as the only runner interface; re-export it from the operation modules as deprecated-free aliases only if external imports exist (check with grep first — none are expected outside tests).
2. Add one shared `stripExtraKeys(options, keep: Set<string>)`/`resolveDockerRunner(options)` helper pair in `runner.ts` and use it from all three operations.
3. Preserve current validation behavior exactly (same error messages for missing/invalid runners, same extra-key stripping per operation).

Acceptance criteria:

- Exactly one `Runner` interface declaration remains; grep finds a single `resolveDockerRunner` implementation.
- A fake runner object typechecks against all three operation option types.
- All existing runner/build/publish/verify tests pass unmodified in intent.
- `pnpm --filter @repo-toolkit/docker-publish test` passes.

### Task REV-04: Extract A Shared Bounded-Concurrency Helper

Status: completed

Completion evidence:

- Changed files: `packages/docker-publish/src/runner.ts`, `packages/docker-publish/src/build.ts`, `packages/docker-publish/src/publish.ts`, `packages/docker-publish/test/runner.test.ts` only (plus this task-file status/evidence update; `CHANGELOG.md` untouched).
- `src/runner.ts`: added exported `runWithConcurrency(items, limit, fn)` — validates `limit` as a positive safe integer (`concurrency must be a positive safe integer`), caps workers at `min(limit, items.length)`, returns `[]` without calling `fn` on empty input, claims the next index synchronously before each `await` so at most `limit` `fn` calls are in flight, stops scheduling once `hasFailure` is set (boolean flag, so even a thrown `undefined` stops scheduling), awaits all started workers via `Promise.all`, rethrows the first observed error, and returns a copy in input order.
- `src/build.ts`: `buildDockerImages` now calls `runWithConcurrency(plan.images, Math.min(plan.buildConcurrency, plan.images.length), (image) => buildOneImage(plan, image, runner))` and keeps the exact prior `Docker build completed without a result for every planned image` guard; no `nextImage`/`failure`/`workerCount` loop remains.
- `src/publish.ts`: `publishDockerImages` now calls `runWithConcurrency(requested, Math.min(publishConcurrency, Math.max(requested.length, 1)), (reference) => publishOneReference(plan, reference, secrets, runner))` and keeps the exact prior `Docker publish completed without a result for every requested reference` guard plus sorted publishes + manifest write; no `nextReference`/`failure`/`workerCount` loop remains.
- `test/runner.test.ts`: new `runWithConcurrency` block (6 tests): limit validation (0/-1/1.5/NaN), empty input, deferred-runner bound (peak <= 2 across 4 items, ordered results), out-of-order delay order preservation, serial no-new-start-after-failure with error identity (`rejects.toBe`), first-observed-error propagation (slow vs fast reject).
- Verification: `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 154 tests passed (148 pre-existing + 6 new); `pnpm lint` → pass; `pnpm typecheck` → pass; `git diff --check` → clean. Grep: `nextImage|nextReference` no matches in `src/`; `runWithConcurrency` defined once in `runner.ts`, used in `build.ts`/`publish.ts`. Existing `bounded concurrency` / `publish concurrency` tests pass unmodified.

Priority: P1

Suggested agent: reusability engineer

Dependencies: REV-03

Primary ownership:

- `packages/docker-publish/src/runner.ts`
- `packages/docker-publish/src/build.ts`
- `packages/docker-publish/src/publish.ts`
- `packages/docker-publish/test/runner.test.ts`

Finding:

`src/build.ts:54-80` and `src/publish.ts:97-123` duplicate the same `nextIndex/failure/workerCount/Promise.all` worker pool (a third copy lives in `go-release`). A fix to early-exit or error aggregation today needs parallel edits; workers only check `failure === undefined` at loop top so in-flight tasks run to completion. Concurrency behavior is locked by `test/build.test.ts` and `test/publish.test.ts` but not the helper shape.

References:

- `packages/docker-publish/src/build.ts:51-92`
- `packages/docker-publish/src/publish.ts:97-140`

Implementation requirements:

1. Add `runWithConcurrency(items, limit, fn)` to `runner.ts`: positive-integer limit, stop scheduling after the first failure, await started work, rethrow the first error, preserve input order in results.
2. Reimplement both pools on top of it with zero behavior change (same defaults: build `min(buildConcurrency, images.length)`, publish `min(publishConcurrency, max(len, 1))`).
3. Unit-test the helper directly (bound honored, no new start after failure, order preserved, first-error propagation).

Acceptance criteria:

- No inline worker-pool loops remain in `build.ts`/`publish.ts` (grep for `nextImage`/`nextReference` finds only the helper).
- Existing concurrency tests pass unmodified.
- New helper tests fail if the bound is exceeded or a post-failure item starts.
- `pnpm --filter @repo-toolkit/docker-publish test` passes.

### Task REV-05: Deduplicate The CLI Filter Pipeline And Validation Constants

Status: completed

Completion evidence:

- Clone boundaries confirmed with grep before the change: `selectNamed`/`selectRegistries`/`positiveInteger(string)` defined in both `cli-options.ts` (191-304) and `interactive.ts` (988-1104); `CLI_ONLY_KEYS` in both files; `KNOWN_OS`/`KNOWN_ARCH`/`MAX_MAP_*`/`SECRET_KEY_PATTERN` in `plan.ts`, `build.ts` (9-12), and `interactive.ts` (194-234); `readPassthrough`/`readAuth`/`mergeOverrides` vs `readInteractivePassthrough`/`readInteractiveAuth`/`applyCliOverrides` plus identical `optionsFromPlan`/`applyFilters` bodies.
- Changed files: `packages/docker-publish/src/cli-filter.ts` (new), `packages/docker-publish/src/cli-options.ts`, `packages/docker-publish/src/interactive.ts`, `packages/docker-publish/src/plan.ts` (added `export` to the six canonical tables only), `packages/docker-publish/src/build.ts` (import swap only) — plus this task-file status/evidence update; `CHANGELOG.md` untouched.
- `src/cli-filter.ts`: single owner of `CLI_ONLY_KEYS`, `DockerPublishCliFilters`/`DockerPublishCliPassthrough` (moved from `cli-options.ts`, re-exported there as types so existing import paths keep working), `positiveInteger`, `readCliPassthrough` (+ private `readAuth`), `mergeOverrides`, `applyCliOverrides`, `applyCliFilters` (unified `optionsFromPlan`/`applyFilters` body), `selectNamed`, `selectRegistries`. All bodies copied verbatim; error messages byte-identical. Both resolvers (`resolveDockerPublishCliOptions`, `resolveInteractiveDockerPublishOptions`) now call the shared functions.
- `src/plan.ts`: `MAX_MAP_ENTRIES`, `MAX_MAP_KEY_LENGTH`, `MAX_MAP_VALUE_LENGTH`, `SECRET_KEY_PATTERN`, `KNOWN_OS`, `KNOWN_ARCH` now exported; no logic change. `src/build.ts` deletes its four constant copies and imports them (defense-in-depth `mergedMap`/`assertStringMapBounds` re-validation in `buildArgv` unchanged, now via the shared tables). `src/interactive.ts` deletes its constant/table copies plus the cloned pipeline functions and imports them; prompt-style validators (return-`string|undefined` contract, unlike plan's throw-style) intentionally remain as call sites, now reading the canonical tables.
- Grep single-definition proof: `selectNamed` once (`cli-filter.ts`), `selectRegistries` once (`cli-filter.ts`), `KNOWN_OS`/`KNOWN_ARCH`/`SECRET_KEY_PATTERN`/`MAX_MAP_ENTRIES` once each (`plan.ts`), `CLI_ONLY_KEYS` once (`cli-filter.ts`, re-exported from `cli-options.ts`). (`runner.ts:285` has a pre-existing unrelated `positiveInteger(value: number, ...)` number-typed helper, out of scope.)
- Verification: `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 154 tests passed (no message updates); `pnpm lint` → pass; `pnpm typecheck` → pass; `git diff --check` → clean. Tracked-tree `git status` unchanged vs baseline (only pre-existing unrelated modifications).

Priority: P1

Suggested agent: readability engineer

Dependencies: REV-02, REV-03

Primary ownership:

- `packages/docker-publish/src/cli-options.ts`
- `packages/docker-publish/src/interactive.ts`
- `packages/docker-publish/src/plan.ts` (validator exports only)
- `packages/docker-publish/src/build.ts` (import swap only)

Finding:

The filter/override pipeline exists twice: `cli-options.ts` (`optionsFromPlan`, `selectNamed`, `selectRegistries`, `positiveInteger`, `readPassthrough`, `mergeOverrides`, keyed by `CLI_ONLY_KEYS`) and a clone in `interactive.ts` (`applyCliOverrides`, `applyFilters`, same selectors, same `CLI_ONLY_KEYS` set at `src/interactive.ts:182`). Validation tables are triplicated too: `KNOWN_OS`/`KNOWN_ARCH` (`src/interactive.ts:194-226`), `MAX_MAP_*` + `SECRET_KEY_PATTERN` (`src/build.ts:9-12`, `src/interactive.ts:228-234`, and the plan-side tables), tag/hostname/prefix regexes repeated across `plan.ts` and `interactive.ts` validators. Any filter or message change needs parallel edits and will drift.

References:

- `packages/docker-publish/src/cli-options.ts:34-53,191-304`
- `packages/docker-publish/src/interactive.ts:182-234,982-1098`
- `packages/docker-publish/src/plan.ts:164`
- `packages/docker-publish/src/build.ts:9-12,160-202`

Implementation requirements:

1. Confirm clone boundaries with grep, then extract one shared module (e.g. `cli-filter.ts`) owning `CLI_ONLY_KEYS`, `selectNamed`, `selectRegistries`, `positiveInteger`, passthrough reading, and override merging; both resolvers use it.
2. Export the canonical validators/tables from `plan.ts` (tag, hostname, platform tables, map bounds + secret pattern) and replace the copies in `build.ts` and `interactive.ts` with imports. `buildArgv` keeps its defense-in-depth re-validation call, now through the shared validator.
3. Error messages stay byte-identical (tests lock several of them).

Acceptance criteria:

- Grep finds a single definition each of `selectNamed`, `selectRegistries`, `KNOWN_OS`/`KNOWN_ARCH`, `SECRET_KEY_PATTERN`, and `MAX_MAP_ENTRIES`.
- All CLI/interactive/plan/build tests pass with no message updates.
- `pnpm --filter @repo-toolkit/docker-publish test` passes.

### Task REV-06: Unify The Dual Registry Login Paths

Status: completed

Completion evidence:

- Changed files: `packages/docker-publish/src/publish.ts`, `packages/docker-publish/src/interactive.ts`, `packages/docker-publish/src/cli.ts` only (plus this task-file status/evidence update; `CHANGELOG.md` untouched). `src/cli-publish.ts` needed no change: it never carried the `skipPublishLogin` symbol (its interactive branch already logs in explicitly then passes the literal `auth: {}`), and its behavior is unchanged.
- `src/publish.ts`: `loginRegistries` is now `export async function loginRegistries(runner, plan, credentials, secrets)` — runner-first, no `requested` param (the `void requested` is gone), and `readCredentials` lost its unused `plan` param (the `void plan` is gone). New exported `DockerRegistryCredentials` ({ hostname, username, password }) replaces the private `ResolvedCredentials`; new exported `DockerLoginRunner` (`run()` returning `DockerRunResult | Promise<...>` so both `DockerRunner` and run-only fakes satisfy it). Argv (`login --username … --password-stdin <host>`, password via `stdin` only) and redaction (`loginError` message shape) unchanged; `loginError` now also sets `.cause` (previously only the interactive copy did; `reportCliError` prints only `.message`, so CLI output is unchanged). Internal `publishDockerImages` call site updated to the new order.
- `src/interactive.ts`: `InteractiveRunner` is now `export type InteractiveRunner = DockerLoginRunner` (existing test imports keep compiling; run-only fakes still satisfy it). `loginWithInteractiveAuth` keeps its signature and credential-resolution logic (ephemeral `authValues` preferred, env fallback, identical `Missing username/password for registry … in environment variable …` messages, sorted hostnames, combined secrets) but delegates the actual logins to `loginRegistries(runner, plan, credentials, combined)`; its private argv builder and error wrapper are deleted. Unused `redactSensitiveValues` / `DockerRunOptions` imports removed.
- `src/cli.ts`: `let skipPublishLogin` flag deleted; a single `let publishAuth = resolved.passthrough.auth` flows into the one `auth: publishAuth` property of the `publishDockerImages` call (set to `{}` after the explicit interactive login, since those ephemeral credentials are not in `process.env`). No behavior change on either path.
- Grep single-definition proof: `--password-stdin` argv builder once (`publish.ts:309`, plus one doc-comment mention); `skipPublishLogin` zero matches in `src/`; `void plan`/`void requested` zero matches in `src/`.
- Verification: `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 154 tests passed (unchanged count, no test edits needed); `pnpm lint` → pass; `pnpm typecheck` → pass; `git diff --check` → clean.

Priority: P1

Suggested agent: encapsulation engineer

Dependencies: REV-05

Primary ownership:

- `packages/docker-publish/src/publish.ts`
- `packages/docker-publish/src/interactive.ts`
- `packages/docker-publish/src/cli.ts`
- `packages/docker-publish/src/cli-publish.ts`
- `packages/docker-publish/test/publish.test.ts`

Finding:

Two login implementations exist: `loginRegistries` (`src/publish.ts:354`) and `loginWithInteractiveAuth` (`src/interactive.ts:1232`), both assembling `['login', '--username', …, '--password-stdin', host]`. The CLIs bridge them with a fragile skip protocol: `cli.ts:115,129,136` sets `skipPublishLogin` and passes `auth: {}` at `cli.ts:147`; `cli-publish.ts:97-118` always passes `auth: {}` in interactive mode. Dead parameters (`void plan`, `void requested` in `publish.ts`) confirm the boundary confusion. A credential or redaction fix must land twice, and the skip flag can silently double-login or skip.

References:

- `packages/docker-publish/src/publish.ts:326,354-377`
- `packages/docker-publish/src/interactive.ts:1232-1289`
- `packages/docker-publish/src/cli.ts:115-147`
- `packages/docker-publish/src/cli-publish.ts:15,97-118`

Implementation requirements:

1. Expose one `loginRegistries(runner, plan, credentials, secrets)` from `publish.ts` (or a shared auth module) and implement `loginWithInteractiveAuth` as a thin adapter that resolves ephemeral/static credentials then delegates to it.
2. Remove the `skipPublishLogin` protocol and the dead `void` parameters; the CLIs pass credentials through exactly one path.
3. Preserve argv shape (`--password-stdin`, stdin-only password) and redaction behavior exactly.

Acceptance criteria:

- One `docker login` argv construction site remains (grep `password-stdin` finds one builder plus tests).
- No `skipPublishLogin` symbol remains in `src/`.
- Existing login/publish CLI tests pass unmodified in intent.
- `pnpm --filter @repo-toolkit/docker-publish test` passes.

### Task REV-07: Harden The Digest-Manifest Atomic Write Against Sibling Redirection

Status: completed

Completion evidence:

- Changed files: `packages/docker-publish/src/publish.ts`, `packages/docker-publish/test/publish.test.ts` only (plus this task-file status/evidence update; `CHANGELOG.md` untouched).
- `src/publish.ts`: added `randomBytes` import from `node:crypto` (stdlib, no new runtime dep); temp path is now `${manifestPath}.tmp-${process.pid}-${randomBytes(16).toString('hex')}` (unpredictable 128-bit suffix, not just pid); `lstatSync(sibling, { throwIfNoEntry: false })` fails closed on pre-existing entry before writing; `writeFileSync(sibling, content, { encoding: 'utf8', flag: 'wx' })` creates exclusively (`O_CREAT|O_EXCL`, fails with `EEXIST` on a planted symlink instead of following it); atomic `renameSync` + best-effort `rmSync` cleanup and sorted pretty-printed JSON with trailing newline plus redacted failure wrapping are unchanged.
- `test/publish.test.ts`: two new `digest manifest` tests — (1) `never follows a pre-planted symlink at the legacy predictable temp path` plants `${manifestPath}.tmp-${process.pid}` as a symlink to an outside canary file, publishes, then asserts the outside file still reads `OUTSIDE-CANARY`, the manifest bytes equal the exact `JSON.stringify(entries, null, 2) + '\n'` string, the legacy path is still a symlink, and `artifacts/` contains only `digests.json` plus the untouched legacy symlink (no random-temp leftover); (2) `writes byte-identical manifest content for the success path` asserts raw bytes equal the exact expected string and no temp leftover remains.
- Sensitivity: the old implementation (`writeFileSync(sibling, content, 'utf8')` on the predictable path) follows the planted symlink — confirmed with a standalone probe (`writeFileSync` through a symlink overwrote `CANARY` with `PWNED`) — so the new symlink test fails on the old code (outside canary overwritten) and passes after the fix.
- Verification: `pnpm --filter @repo-toolkit/docker-publish exec vitest run --config vitest.config.ts test/publish.test.ts` → 24 passed; `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 156 tests passed; `pnpm lint` → pass; `pnpm typecheck` → pass; `git diff --check` → clean.

Priority: P1

Suggested agent: artifact security engineer

Dependencies: REV-06

Primary ownership:

- `packages/docker-publish/src/publish.ts`
- `packages/docker-publish/test/publish.test.ts`

Finding:

`writeDigestManifest` (`src/publish.ts:576-603`) derives a predictable sibling path (`${manifestPath}.tmp-${process.pid}`, line 589) and writes it with non-exclusive `writeFileSync`, which follows symlinks, with no `lstat` check. A local writer that can plant `digests.json.tmp-<pid>` as a symlink (pid is guessable) gets the manifest content written through the link before `renameSync` moves the link itself. Existing tests cover `..` escapes and symlinked parent dirs but not the sibling-tmp race.

References:

- `packages/docker-publish/src/publish.ts:576-603`

Implementation requirements:

1. Create the temp file exclusively (`O_CREAT | O_EXCL`) with an unpredictable suffix (random component, not just pid), `lstat` it before writing, and keep the atomic rename + best-effort cleanup.
2. Keep the sorted pretty-printed JSON shape, trailing newline, and redacted failure wrapping unchanged.

Acceptance criteria:

- A pre-planted symlink at the old predictable sibling path is never followed; publish either uses its own exclusive temp or fails closed with no outside write.
- Manifest bytes for the success path are unchanged.
- New regression tests fail on the old implementation and pass after the fix.
- `pnpm --filter @repo-toolkit/docker-publish test -- publish.test.ts` passes.

### Task REV-08: Close The Plan-To-Spawn Context Trust Gap (Investigation)

Status: completed

Completion evidence:

- Changed files: `packages/docker-publish/src/plan.ts`, `packages/docker-publish/src/build.ts`, `packages/docker-publish/test/plan.test.ts`, `packages/docker-publish/test/build.test.ts`, `packages/docker-publish/README.md`, `website/docs/packages/docker-publish.md` only (plus this task-file status/evidence update; `CHANGELOG.md` untouched).
- Probe verdicts (controlled fixtures, real code, recorded 2026-09-10):
  - (a) Context component swapped for a symlink between plan and build: VULNERABLE (TOCTOU). A stored plan's `resolvedContextDir`/`resolvedDockerfile` strings are trusted verbatim — `src/build.ts` consumed them with no re-resolution before `spawnSync`. Demonstrated: resolve plan for `services/app`, replace `services/app` (or its parent `services/`) with a symlink to an outside dir — the in-memory resolved path no longer equals the live `realpathSync`, yet the old build path would have spawned Docker with the stale string. (A fresh re-resolve does fail closed, so the window is concurrent mutation between resolution and spawn, not a stale-options call — `buildDockerImages` re-resolves internally.)
  - (b) Escaping symlink shipped inside the context tree: VULNERABLE BY DESIGN, residual risk accepted. Fixture `services/app/data -> <parent>/secret.txt` (and a dir symlink to the parent) passes `resolveDockerPublishPlan` and the new re-validator — in-tree entries are never enumerated — while Docker follows such links at build time. A per-build recursive scan was judged disproportionate: it adds I/O to the hot path yet stays racy (the tree can change after the scan), so the boundary is a documented trust contract instead.
- Fix: `src/plan.ts` exports `assertResolvedImagePaths(plan, image)` which replays the plan-time checks against the live filesystem (lexical `ensureContainedPath`, `lstatSync` directory/file kind, `realpathSync` equality with the stored resolved path, Dockerfile-within-context) and throws on any change, disappearance, or containment escape. `src/build.ts` `runBuild` calls it immediately before `buildArgv`/spawn — the single build-spawn site. The fs logic lives in `plan.ts`, so the `build.ts` "no `node:fs`" source assertion still holds; existing containment checks are untouched (plan-time order preserved: containment first, then change detection).
- Trust contract: `packages/docker-publish/README.md` and `website/docs/packages/docker-publish.md` (new "Context Trust" website section) state that build contexts are trusted, immutable snapshots, that in-tree symlinks are not enumerated and are followed by Docker, and that the build step re-validates the pinned paths pre-spawn. Locked by a docs-consistency test asserting both files contain `trusted, immutable snapshots`.
- Tests: `test/plan.test.ts` — verifier passes on a fresh plan; fails closed on context-dir swap, parent-component swap, and Dockerfile replacement (each matches `/changed since plan resolution|escapes the project root/`); passes on an in-tree escaping symlink (locks the documented residual risk); docs-consistency assertion. `test/build.test.ts` — TOCTOU regression: two-image `buildConcurrency: 2` run where the fake runner swaps `services/img1` for an outside symlink during the first spawn; the second image fails closed with `"img1"` + fail-closed message, exactly one `buildx` call is recorded, no argv contains the stale context, and the outside canary is byte-identical.
- Sensitivity: with the `runBuild` call neutralized (old behavior), the new build TOCTOU test fails (build succeeds, `expected the build to fail`); the plan verifier tests target the new export, which does not exist in old code. Restored afterwards.
- Verification: `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 163 tests passed (156 pre-existing + 7 new); `pnpm lint` → pass; `pnpm typecheck` → pass; `git diff --check` → clean. Tracked-tree `git status` unchanged vs baseline (only pre-existing unrelated modifications).

Priority: P1

Suggested agent: container security engineer

Dependencies: REV-05

Primary ownership:

- `packages/docker-publish/src/plan.ts`
- `packages/docker-publish/src/build.ts`
- `packages/docker-publish/test/plan.test.ts`
- `packages/docker-publish/test/build.test.ts`

Finding:

All symlink/realpath checks run once in `resolveDockerPublishPlan` (`src/plan.ts:291-311`: context `lstatSync` → `realpathSync`, Dockerfile `realpathSync` → containment), and only the Dockerfile path itself is checked — symlinks _inside_ the context tree are never enumerated. Nothing re-resolves immediately before `spawnSync` (`src/build.ts:211,227,254` consumes `resolvedContextDir`/`resolvedDockerfile` as stored). Two scenarios need a runtime verdict, not speculation: (a) a context component swapped for a symlink between plan and build; (b) an escaping symlink shipped inside the context (`services/app/data -> ../../secret`), which Docker follows at build time although the plan passed. Current tests cover only the Dockerfile-through-symlink case (`test/plan.test.ts:281-294`).

References:

- `packages/docker-publish/src/plan.ts:260-267,291-311,638-651`
- `packages/docker-publish/src/build.ts:204-229,248-255`
- `packages/docker-publish/test/plan.test.ts:232-294`

Implementation requirements:

1. Probe both scenarios against the real code with controlled fixtures and record the verdict in this file.
2. Implement the minimal closing fix the probe justifies: re-`lstat`/`realpath` the resolved paths in `build` immediately before spawn and fail closed on change, and either scan context trees for escaping symlinks or — if scanning is disproportionate — document that contexts must be trusted immutable snapshots (README + website, tested by a docs-consistency assertion if one exists).
3. Do not weaken any existing containment check.

Acceptance criteria:

- The probe verdict (vulnerable / not vulnerable per scenario) is recorded as completion evidence with fixture descriptions.
- For each confirmed gap: a regression test fails before and passes after, or the documented trust contract states the residual risk explicitly.
- `pnpm --filter @repo-toolkit/docker-publish test` passes.

### Task REV-09: Validate CLI Auth Shapes Early

Status: completed

Completion evidence:

- Changed files: `packages/docker-publish/src/publish.ts`, `packages/docker-publish/src/cli-filter.ts`, `packages/docker-publish/src/interactive.ts`, `packages/docker-publish/test/cli.test.ts` only (plus this task-file status/evidence update; `CHANGELOG.md` untouched).
- `src/publish.ts`: the strict `resolveAuthMap` body (auth-shape, exactly-`usernameEnv`+`passwordEnv`, per-host shape, env-name pattern, byte-identical messages) extracted verbatim into exported `validateDockerPublishAuthMap(value)`; `resolveAuthMap` now delegates to it, so publish-time behavior/messages are unchanged. No hostname-shape check was added: `resolveAuthMap` never validated hostname shape, and extra auth entries for unlisted registries are ignored at publish time (`readCredentials` only resolves requested references), so adding one would change valid-auth behavior against the task contract. The hostname allowlist remains enforced where it always was — `resolveRequestedReferences` refuses unlisted/off-plan pushes with zero runner calls.
- `src/cli-filter.ts`: private loose `readAuth` (only `isPlainObject`-checked) now delegates to `validateDockerPublishAuthMap`. This is the single `readAuth` definition (REV-05 unified both resolvers), so both the non-interactive (`resolveDockerPublishCliOptions`) and interactive (`resolveInteractiveDockerPublishOptions`) paths reject malformed `auth` during resolution — before `collectCliSecrets`, before any dry-run summary, and before any runner call.
- `src/interactive.ts`: `resolveInteractiveAuthAndConfirm` and `promptInteractiveAuth` validate `configuredAuth` via the shared validator before printing, prompting, or running anything, so the pre-confirm summary (dry-run and non-dry-run) rejects malformed auth with zero runner calls. Ephemeral `authValues` prompts already enforce the env-name pattern via `validateEnvVarNameValue`.
- `test/cli.test.ts`: new `CLI auth shape validation (REV-09)` block (4 tests): (1) `--dry-run` subprocess with `auth: { "registry.example.com": { "usernameEnv": "A-BAD" } }` exits 1 with `must define exactly usernameEnv and passwordEnv`, empty stdout, and no marker-docker invocation; (2) unit table over bad env name / non-object entry / missing key via `resolveDockerPublishCliOptions`, each with its exact strict message; (3) valid auth `--dry-run` still exits 0 with `dryRun: true`; (4) `resolveInteractiveAuthAndConfirm` with `dryRun: true` and malformed auth rejects before the print callback runs (0 prints).
- Sensitivity: with `readAuth` temporarily restored to the loose implementation, the new `--dry-run` test fails (dry-run exits 0, no validation error); the interactive pre-confirm test targets the new upfront validation call, which does not exist in old code. Restored afterwards.
- Verification: `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 167 tests passed (163 pre-existing + 4 new); `test/cli.test.ts` → 19 passed; `pnpm lint` → pass; `pnpm typecheck` → pass; `git diff --check` → clean. Tracked-tree `git status` unchanged vs baseline (only pre-existing unrelated modifications).

Priority: P2

Suggested agent: CLI contract engineer

Dependencies: REV-05

Primary ownership:

- `packages/docker-publish/src/cli-options.ts`
- `packages/docker-publish/src/interactive.ts`
- `packages/docker-publish/test/cli.test.ts`

Finding:

`readAuth` (`src/cli-options.ts:181-189`) and its interactive counterpart only `isPlainObject`-check, versus the strict validator in `src/publish.ts:266-299` (env-name pattern, exactly `usernameEnv` + `passwordEnv`, per-host shape). Malformed `auth` (bad env names, missing keys, non-object entries, unlisted hostnames) passes plan resolution, `--dry-run`, and the interactive confirm, then fails inside `publishDockerImages` after builds may already have run. `collectCliSecrets` also indexes `entry.usernameEnv` unchecked, silently yielding `undefined` for malformed entries. Publish-time tests cover missing env, but no test covers CLI-layer rejection.

References:

- `packages/docker-publish/src/cli-options.ts:82-117,181-189`
- `packages/docker-publish/src/publish.ts:266-299`
- `packages/docker-publish/test/publish.test.ts:709-726`

Implementation requirements:

1. Reuse the `publish.ts` auth-shape/env-name/hostname-allowlist validation in both `readAuth` paths (extract it if REV-05 has not already done so; coordinate, do not duplicate).
2. `--dry-run` and the pre-confirm plan summary must reject malformed `auth` before any runner call.
3. Keep the valid-auth behavior and messages unchanged.

Acceptance criteria:

- A config with `auth: { "registry.example.com": { "usernameEnv": "A-BAD" } }` fails `--dry-run` with a validation error and zero runner calls.
- Valid auth configs behave exactly as before.
- New tests fail on the old implementation (dry-run green, failure only at push) and pass after.
- `pnpm --filter @repo-toolkit/docker-publish test` passes.

### Task REV-10: Resolve The Plan Once And Verify In Bounded Parallel Without Temp Files

Status: completed

Completion evidence:

- Changed files: `packages/docker-publish/src/cli-filter.ts` (new `deriveFilteredPlan`), `packages/docker-publish/src/cli-options.ts`, `packages/docker-publish/src/interactive.ts` (resolve path only), `packages/docker-publish/src/verify.ts`, `packages/docker-publish/test/verify.test.ts` only (plus this task-file status/evidence update; `CHANGELOG.md` untouched).
- `src/cli-filter.ts`: new exported `deriveFilteredPlan(fullPlan, filters)` reuses `selectNamed`/`selectRegistries` (byte-identical duplicate/unknown-filter messages), filters images/registries/platforms in memory, recomputes per-image references with `formatImageReference` (registry-outer/tag-inner order, same as `resolveImages`), preserves the plan-time non-empty guards (`images/registries/platforms must contain at least one entry`), and performs zero filesystem calls.
- `src/cli-options.ts` + `src/interactive.ts`: both resolvers now run `resolveDockerPublishPlan(merged)` once, keep `applyCliFilters` output as `options` unchanged (downstream build/publish/verify re-resolution unaffected), and derive `plan` via `deriveFilteredPlan(fullPlan, filters)` with no second stat pass.
- `src/verify.ts`: `verifyDockerPublish` runs references through `runWithConcurrency` (REV-04 helper) with `Math.min(DEFAULT_VERIFY_CONCURRENCY, max(len, 1))`; new exported `DEFAULT_VERIFY_CONCURRENCY = 4` documents the manifest-only bound (`buildx imagetools inspect --raw`, zero pulls/pushes/logins). `verifyOneReference` parses `JSON.parse(stdout)` directly; `mkdtempSync`/`writeFileSync`/`readFileSync`/`rmSync` and the project-root `.docker-publish-verify-*` dir are gone. Evidence re-sorted by reference as before.
- `test/verify.test.ts`: `vi.mock('../src/plan')` counting wrapper proves one `resolveDockerPublishPlan` call per non-interactive CLI run (multi-image fixture with image filter; old code calls twice) and per interactive run (scripted defaults); derived plan asserts `toEqual(resolveDockerPublishPlan(resolved.options))` (containment identical). Parallel block: 4-reference run with reversed input order asserts byte-identical sorted evidence, `peak === min(DEFAULT_VERIFY_CONCURRENCY, 4)`, manifest-only argv, and empty `listVerificationDirs` both in-flight (inside `capture`) and after; 8-reference run asserts `peak <= DEFAULT_VERIFY_CONCURRENCY` and `peak > 1`. Old serial code yields peak 1 and a live temp dir, so the new tests fail before and pass after.
- Verification: `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 171 tests passed (167 pre-existing + 4 new); `pnpm lint` → pass; `pnpm typecheck` → pass; `git diff --check` → clean.

Priority: P2

Suggested agent: performance engineer

Dependencies: REV-05

Primary ownership:

- `packages/docker-publish/src/cli-options.ts`
- `packages/docker-publish/src/interactive.ts`
- `packages/docker-publish/src/verify.ts`
- `packages/docker-publish/test/verify.test.ts`

Finding:

Three confirmed inefficiencies, none affecting correctness: (a) every CLI invocation resolves the full plan twice — `resolveDockerPublishPlan(merged)` then `resolveDockerPublishPlan(options)` (`src/cli-options.ts:49,51`) and the same pair in `interactive.ts:276,278` — doubling `lstatSync`/`realpathSync`/containment walks per image; (b) `verifyDockerPublish` inspects references strictly serially (`src/verify.ts:68-83`) while build is parallel and publish has its own bound; (c) each verification does a pointless temp roundtrip, `writeFileSync(snapshotPath, stdout)` then `readFileSync` back only to parse what `stdout` already holds (`src/verify.ts:238-239`), plus `mkdtempSync(join(plan.cwd, …))` briefly pollutes the project root (line 68).

References:

- `packages/docker-publish/src/cli-options.ts:49-51`
- `packages/docker-publish/src/interactive.ts:276-278`
- `packages/docker-publish/src/verify.ts:60-91,237-239`
- `packages/docker-publish/src/plan.ts:260-267,292-310`

Implementation requirements:

1. Resolve once per CLI run: derive the filtered plan without re-statting, or memoize `realpath` within the run. Root containment results must be identical to today.
2. Verify references with the REV-04 concurrency helper (default bound documented; manifest-only semantics unchanged, still zero pulls/pushes).
3. Parse `JSON.parse(stdout)` directly; remove the snapshot write/read and the project-root temp dir (keep a `finally`-cleaned temp only if a code path genuinely needs a file).
4. Evidence ordering in results stays sorted as today.

Acceptance criteria:

- A syscall-counting test (or `realpathSync` spy) proves one resolution pass per CLI run for a multi-image fixture.
- Multi-reference verification completes with bounded parallelism and byte-identical evidence content.
- No `.docker-publish-verify-*` directory appears in the project root during verification.
- `pnpm --filter @repo-toolkit/docker-publish test` passes.

### Task REV-11: Export The Formatter And Runner Values From The Package Index

Status: completed

Completion evidence:

- Changed files: `packages/docker-publish/src/index.ts`, `packages/docker-publish/test/index.test.ts`, `packages/docker-publish/README.md` only (plus this task-file status/evidence update; `CHANGELOG.md` untouched).
- `src/index.ts`: added `formatImageReference` (value) to the `./plan` re-export; changed the `./runner` re-export from `export type` to `export` carrying `defaultDockerRunner` + `validateDockerRunner` (values) alongside the existing `DockerCaptureResult`/`DockerRunner`/`DockerRunOptions`/`DockerRunResult` types. No other export surface changed.
- `test/index.test.ts`: smoke test now asserts the seven runtime exports (`buildDockerImages`, `defaultDockerRunner`, `formatImageReference`, `publishDockerImages`, `resolveDockerPublishPlan`, `validateDockerRunner`, `verifyDockerPublish`) from built `dist/index.js` plus a runtime `typeof` check (`function,object,function`) and a `formatImageReference` call result; new test asserts the source-level values are callable (`formatImageReference` with/without repository prefix, `defaultDockerRunner.run`/`capture` functions, `validateDockerRunner` accept/reject).
- `README.md` (Library section): import example extended with the three new values; new sentence documents `formatImageReference` as the single reference builder, `defaultDockerRunner`, and `validateDockerRunner`. Additive contract change only.
- Verification: `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 172 tests passed (171 pre-existing + 1 new); `pnpm lint` → pass; `pnpm typecheck` → pass; `git diff --check` → clean. Runtime acceptance: `import { formatImageReference, defaultDockerRunner, validateDockerRunner } from './packages/docker-publish/dist/index.js'` yields `function object function`, `formatImageReference('registry.example.com','team','app','1.2.3')` returns `registry.example.com/team/app:1.2.3`, and `validateDockerRunner(defaultDockerRunner)` does not throw.

Priority: P2

Suggested agent: API engineer

Dependencies: REV-03

Primary ownership:

- `packages/docker-publish/src/index.ts`
- `packages/docker-publish/test/index.test.ts`

Finding:

`formatImageReference` is defined and exported in `plan.ts:164` and is the mandated single reference builder, yet `src/index.ts:1-14` does not re-export it, so consumers re-implement concatenation — the exact failure mode DOCK-02 was created to prevent. Likewise `defaultDockerRunner`/`validateDockerRunner` are exported from `index.ts:16-21` as `export type` only, which erases at runtime, so library callers cannot obtain the default runner or validator (contrast `go-release/src/index.ts:28-33`, which exports both values). `test/index.test.ts:16-21` locks only four exports, so the change is unblocked.

References:

- `packages/docker-publish/src/index.ts:1-46`
- `packages/docker-publish/src/plan.ts:164`
- `packages/docker-publish/src/runner.ts:37,83`
- `packages/go-release/src/index.ts:28-33`

Implementation requirements:

1. Re-export `formatImageReference` (value) and `defaultDockerRunner` + `validateDockerRunner` (values) plus their types from `src/index.ts`.
2. Update `test/index.test.ts` to assert the widened surface (values importable and callable).
3. This is an additive contract change: document the new exports in the package README API section.

Acceptance criteria:

- `import { formatImageReference, defaultDockerRunner, validateDockerRunner } from '@repo-toolkit/docker-publish'` works at runtime from the built `dist/index.js`.
- The smoke test asserts the new exports alongside the existing four.
- `pnpm --filter @repo-toolkit/docker-publish test -- index.test.ts` passes.

### Task REV-12: Share One Test Fixture Helper Across The Suite

Status: completed

Completion evidence:

- Changed files: `packages/docker-publish/test/helpers.ts` (new), `packages/docker-publish/test/build.test.ts`, `packages/docker-publish/test/publish.test.ts`, `packages/docker-publish/test/verify.test.ts`, `packages/docker-publish/test/cli.test.ts`, `packages/docker-publish/test/plan.test.ts` only (plus this task-file status/evidence update; `CHANGELOG.md` untouched; no production-code changes).
- `test/helpers.ts`: single owner of `RecordedCall`, `withProject(prefix, run)` (prefix-first so the 79 existing one-line call sites keep their exact temp prefixes with no body re-indentation; sync/async callback handling and `rmSync` cleanup copied verbatim), `writeImageContext(root, dir, dockerfileName = 'Dockerfile')` (`FROM scratch\n`, covers the 2-arg and 3-arg call shapes), generic `createRecordedRunner({ onRun, onCapture })` (records `{ kind, executable, args, options }` before delegating, matching the old push-first order), and `DIGEST_A`/`DIGEST_B`. File-specific items stay local: `fixture()` (cli deferred-cleanup discipline), `REFERENCE`/`EXTRA_REFERENCE`, auth env consts, `snapshotTree`, `packageRoot`, `trackingRunner`/inline peak runners.
- Migration: all five files import the canonical helpers; the three specialized factories (`createSyncRunner`, `createRecordingRunner`, `createVerifyRunner`) are now thin wrappers over `createRecordedRunner` with byte-identical behavior branches; now-unused `DockerRunOptions`/`mkdirSync`/`mkdtempSync`/`rmSync`/`tmpdir` imports pruned (lint-clean).
- Grep single-definition proof: `function withProject|function writeImageContext|interface RecordedCall|const DIGEST_A|const DIGEST_B` → zero matches in the five migrated files, one definition each in `helpers.ts` (`examples.test.ts` keeps its own out-of-scope `RecordedCall`).
- Verification: `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 172 tests passed (identical to the pre-change baseline count recorded before this task); `pnpm lint` → pass; `pnpm typecheck` → pass; `git diff --check` → clean. Extra strict test-inclusive `tsc` probe (not part of repo verification, which covers `src/` only) reports the same 5 pre-existing body errors before and after (async fakes, cli auth shape; confirmed identical on the stashed pristine tree) — `helpers.ts` and the wrappers add zero new type errors.

Priority: P2

Suggested agent: test health engineer

Dependencies: none

Primary ownership:

- `packages/docker-publish/test/helpers.ts` (new)
- `packages/docker-publish/test/build.test.ts`
- `packages/docker-publish/test/publish.test.ts`
- `packages/docker-publish/test/verify.test.ts`
- `packages/docker-publish/test/cli.test.ts`
- `packages/docker-publish/test/plan.test.ts`

Finding:

`withProject` + `writeImageContext` + `RecordedCall` fakes are copy-pasted across `test/build.test.ts:16-53`, `test/publish.test.ts:24-53`, `test/verify.test.ts:19-45+`, `test/cli.test.ts:45+`, and `test/plan.test.ts:11-20`. A cleanup-semantics change (e.g. `rmSync` options, symlink handling in fixtures) must land in five places.

References:

- `packages/docker-publish/test/build.test.ts:16-53`
- `packages/docker-publish/test/publish.test.ts:24-53`
- `packages/docker-publish/test/verify.test.ts:19-45`
- `packages/docker-publish/test/cli.test.ts:45-80`
- `packages/docker-publish/test/plan.test.ts:11-20`

Implementation requirements:

1. Add `test/helpers.ts` with the canonical `withProject`, `writeImageContext`, recorded-runner fake, and digest/canary constants; migrate all five files to import it.
2. Keep fixture behavior identical (same temp prefixes, same cleanup discipline, same Dockerfile contents).
3. No production-code changes in this task.

Acceptance criteria:

- No local `withProject`/`writeImageContext`/`RecordedCall` definitions remain in the migrated files (grep proves one definition each, in `helpers.ts`).
- Test count is unchanged and the full package suite passes.
- `pnpm --filter @repo-toolkit/docker-publish test` passes.

### Task REV-13: Perform Independent Final Integration Review

Status: completed

Completion evidence:

- Changed files: this task file only (status/evidence update). No `src/` or `test/` corrections were needed: every runtime probe passed on the as-found tree, so there was no P0/P1 regression to fix within `packages/docker-publish` (or `prompt.ts`). `CHANGELOG.md` untouched.
- Worktree note: the REV-01..REV-12 `src/` work is already contained in commit `b4ac8e5`; the worktree adds only the REV-11/REV-12 evidence text, the five test-file helper migrations, and untracked `packages/docker-publish/test/helpers.ts`. An unrelated `.tool-versions` drift (`docker-compose 5.5.0` -> `5.5.1`) appeared during the review session; it was not made by this task and was left untouched per working rules.
- REV-01 (runtime probe `/tmp/opencode/rev13-probe.mjs` vs built `dist/index.js`): failing build with `NPM_TOKEN` + secret-label canaries threw; `options.secrets` carried the canary; the thrown message contained no canary; argv scrubbed with the passed secrets contained no canary; non-secret failure message kept the exact prior shape (`Failed to build Docker image "app" ... plain daemon tail`, no `[REDACTED]`). Targeted suite `test/build.test.ts -t "secret"` 3 passed. PASS.
- REV-02: `test/interactive.test.ts -t "preserves"` 2 passed (per-image maps round-trip `toEqual` non-interactive plan; declined advanced customize preserves globals). PASS.
- REV-03/REV-04 greps: one `DockerRunner` interface plus the intentional narrow `DockerLoginRunner` run-only subset introduced by REV-06 (not a duplicate runner); one `runWithConcurrency` def (`runner.ts:118`); `nextImage|nextReference` zero matches; `process.exit` zero matches (only `exitCode`); no post-ES2018 `.at(` in `src/`. PASS.
- REV-05/REV-06 greps: `selectNamed`/`selectRegistries` one def each (`cli-filter.ts`); `SECRET_KEY_PATTERN`/`KNOWN_OS`/`KNOWN_ARCH`/`MAX_MAP_*` defined once (`plan.ts`), imported elsewhere; `CLI_ONLY_KEYS` defined once (`cli-filter.ts`, re-exported); `--password-stdin` argv builder once (`publish.ts:316` + doc comment); `skipPublishLogin` zero matches in `src/`. PASS.
- REV-07 (runtime probe): pre-planted symlink at legacy `${manifestPath}.tmp-${process.pid}` pointing at an outside canary file was never followed — outside bytes `OUTSIDE-CANARY` intact, legacy path still a symlink, manifest written via the exclusive random-suffix temp. Targeted suite `test/publish.test.ts -t "symlink"` 2 passed. PASS.
- REV-08: TOCTOU/context-trust tests pass inside the full suite (7 new tests from REV-08 included in the 172); `prompt.ts` re-checked — it only re-exports the clack password prompt, no secret handling, no action. Residual risk stays as documented (in-tree symlinks followed by Docker by design). PASS.
- REV-09 (independent subprocess vs built `dist/cli.js`): config with `auth: { "registry.example.com": { "usernameEnv": "A-BAD" } }` + `--dry-run` exited 1 with `must define exactly usernameEnv and passwordEnv` on stderr, empty stdout, marker docker executable never invoked. Targeted suite `test/cli.test.ts -t "auth shape"` 4 passed. PASS.
- REV-10: `test/verify.test.ts -t "single plan resolution"` 2 passed (one `resolveDockerPublishPlan` call per CLI/interactive run); `-t "bounded parallelism"` and `-t "documented bound"` passed (peak `<= DEFAULT_VERIFY_CONCURRENCY`, `> 1` at scale, byte-identical sorted evidence); no `.docker-publish-verify-*` litter in project root after the runs (`ls` confirms absent). PASS.
- REV-11/packed artifact: `npm pack` tarball `/tmp/opencode/rev13-pack/repo-toolkit-docker-publish-0.0.0-PLACEHOLDER.tgz`, SHA256 `5fde5bfe9d8132cf362322ce4864aa43ae9a02ff57f23bc413411fd26a4e5bac`, unpacked to `/tmp/opencode/rev13-unpack` (workspace `publish-package` linked for resolution); `dist/cli.js`, `dist/cli-build.js`, `dist/cli-publish.js --help` each exit 0 with correct usage banners; runtime import from packed `dist/index.js` yields `function object function`, `formatImageReference('registry.example.com','team','app','1.2.3')` returns `registry.example.com/team/app:1.2.3`, `validateDockerRunner(defaultDockerRunner)` does not throw. PASS.
- Non-interactive byte-identity: full package suite passes with no message/argv/summary updates (172/172), plus the probe-3 exact-shape check above; only declared delta is the REV-11 additive export surface. PASS.
- Serial root verification: `pnpm lint` pass (exit 0); `pnpm typecheck` pass (exit 0); `pnpm build` pass (exit 0); `pnpm test` pass — 8 packages, 0 failures: 215 + 81 + 225 + 343 + 172 (docker-publish, 9 files) + 105 + 85 + 100 = 1326 tests. `git diff --check` clean.
- File-integrity: `CHANGELOG.md` and `docs/tasks/20260902-102251-configurable-package-artifact-publishing.md` unmodified (no status/diff entries).
- Residual risks (all deferred, none blocking): the five plan-level deferred items stand (lowercase-only tag charset, Windows path semantics, `maxManifestBytes` ordering, `go-release` concurrency sharing, real-daemon e2e); `DockerLoginRunner` intentionally coexists with `DockerRunner` as a run-only subset (REV-06); in-tree context symlinks remain trusted-by-contract per REV-08; `.tool-versions` docker-compose drift is environment-owned, not this plan's.

Priority: P0

Suggested agent: independent reviewer who did not implement REV-01 through REV-12

Dependencies: REV-01 through REV-12

Primary ownership:

- review of all `packages/docker-publish/` and `packages/publish-package/src/prompt.ts` changes
- focused corrective changes discovered during review
- completion evidence in this task document

Finding:

This plan touches secret handling, interactive resolution, runner boundaries, login paths, and manifest writes. Independent review is required because a redaction, precedence, or atomicity regression would silently weaken the guarantees the first two task files established.

References:

- all REV task acceptance criteria
- `packages/publish-packages/test/contract.test.ts:78-349`

Implementation requirements:

1. Re-run every prior task's acceptance criteria against runtime behavior (canary-secret build failure, interactive round-trip, single-runner/single-pool/single-filter/single-login greps, symlink-sibling probe, malformed-auth dry-run, single-resolution proof, parallel-verify evidence equality, packed-import of new exports).
2. Confirm non-interactive CLI behavior is byte-identical to the pre-plan baseline (same argv, messages, summaries, exit codes) apart from explicitly declared changes (REV-11 additive exports).
3. Pack the package to `/tmp`, run all three bins `--help` from the unpacked tarball, and import the new runtime exports from packed `dist/index.js`.
4. Run serially: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` (root `test` already serializes with `--workspace-concurrency=1`).
5. Record any deferred issue with owner, rationale, and residual risk. Do not complete while a P0/P1 criterion is unresolved.

Acceptance criteria:

- Every REV-01 through REV-12 criterion confirmed against runtime behavior, not inspection alone.
- No secret value appears in argv, logs, summaries, or errors on any path.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test` pass from the repository root.
- Reviewer records commands, test counts, artifact checks, and residual risk in completion evidence.

## Dependency And Parallelization Guidance

| Wave | Tasks                             | Agent focus          | Parallel guidance                                                                                                                         |
| ---- | --------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | REV-01, REV-02                    | confirmed defects    | May run in parallel: disjoint files (`build.ts` vs `interactive.ts`).                                                                     |
| 2    | REV-03 → REV-04 → REV-05 → REV-06 | encapsulation chain  | Strictly sequential: overlapping ownership (`runner.ts`, `build.ts`, `interactive.ts`, `cli-options.ts`).                                 |
| 3    | REV-07, REV-08, REV-09            | hardening and trust  | REV-07 and REV-08 may run in parallel (manifest write vs context validation); REV-09 after REV-05 (wave 2) for the shared auth validator. |
| 4    | REV-10, REV-11, REV-12            | perf, surface, tests | REV-10 and REV-12 may run in parallel (production vs test-only files); REV-11 after REV-03.                                               |
| 5    | REV-13                            | independent review   | Runs alone after all implementation tasks.                                                                                                |

Shared hotspots (sequence, never parallel):

- `src/runner.ts` + `src/index.ts`: REV-03 → REV-04 → REV-11.
- `src/interactive.ts`: REV-02 → REV-05 → REV-06.
- `src/publish.ts`: REV-03 (types) → REV-06 (login) → REV-07 (manifest).
- `src/cli-options.ts`: REV-05 → REV-09 → REV-10.
- Root `package.json`, `tsconfig.base.json`, root README: no task owns them; do not touch.
- Never run root `pnpm build`/`pnpm test` concurrently; package test scripts rebuild dependency closures over shared `dist/`.

## Wave Verification

After Wave 1:

```sh
pnpm --filter @repo-toolkit/docker-publish test -- build.test.ts interactive.test.ts
pnpm lint
pnpm typecheck
```

After Waves 2 and 3:

```sh
pnpm --filter @repo-toolkit/docker-publish test
pnpm lint
pnpm typecheck
```

After Wave 4:

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

## Deferred Follow-Up Decisions

These do not block this plan and must not be silently absorbed into it:

1. Lowercase-only tags (`src/plan.ts` tag regex rejects `Latest`/`V1` that Docker accepts; locked by `test/plan.test.ts:405-419`): document the restriction in README/website or relax to Docker's charset. Needs a maintainer call; proposed owner: package maintainer.
2. Windows path semantics (`normalizeRelativePath`, drive-relative `C:foo`, ADS streams, case-insensitive `relative()`): no Windows probe exists anywhere in the suite. Proposed: real-Windows CI probe task when CI offers it.
3. `maxManifestBytes` vs `maxOutputBytes` error ordering in `verify.ts:207-220`: likely benign (runner cap still bounds memory); confirm only if a confusing report arrives.
4. Whether `go-release` should adopt the shared `runWithConcurrency` helper: separate proposal; this plan must not rewrite `go-release`.
5. Real-daemon end-to-end fixture against an ephemeral local registry: already deferred in the parent plan; unchanged.

## Definition Of Done

- REV-01 through REV-12 are `completed`, each with command and result evidence; REV-13 independently confirms them.
- No secret value is observable in argv, logs, summaries, or errors on any path; interactive runs preserve configured maps.
- Exactly one runner interface, one concurrency helper, one filter pipeline, one login builder, one validator set.
- Manifest writes resist sibling redirection; auth fails fast at dry-run; plan resolves once; verify is bounded-parallel with no project-root temp litter.
- Consumers can import the formatter and runner values; tests share one helper.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test` pass from the repository root.
- Deferred items above remain explicitly deferred with rationale, not hidden in implementation.
