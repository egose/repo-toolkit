# Docker Publish Interactive Prompts

Created: 2026-09-09 23:49:06

Status: completed

## Objective And Scope

Add opt-in interactive prompting (`-i` / `--interactive`) to all three `@repo-toolkit/docker-publish` CLIs (`repo-toolkit-docker-publish`, `repo-toolkit-build-docker-publish`, `repo-toolkit-publish-docker-publish`), reusing the `@clack/prompts` pattern already established in `@repo-toolkit/publish-package`.

Today the CLIs fail closed when `--config` is absent: `resolveDockerPublishCliOptions` loads `{}` and plan validation rejects it (`packages/docker-publish/src/cli-options.ts:40-52`). There is no prompt path — `docker-publish` imports only `parseFlags` and its `SPECS` tables contain no interactive flag. The reference pattern lives in `packages/publish-package/src/cli.ts:18-46,217-238` with primitives in `packages/publish-package/src/prompt.ts:43-105`.

Maintainer decisions (locked, from review):

1. Prompt everything, but when the config file exists and an option value exists, use that value as the prompt default. Explicit CLI flags still win over both (precedence: CLI flag > prompt answer > config default).
2. Fail without TTY: `-i` on a non-TTY errors immediately with a fail-closed message. Never hang CI.
3. Auth: when the password env var named by the config exists and is non-empty, prompt a choice — use the env value (default, recommended) or enter a new password. New password entry is masked and held in memory for this run's `--password-stdin` login only. No save feature: answers stay ephemeral, nothing is persisted to disk.

The work is successful when a TTY user can run any of the three CLIs with `-i`, with or without `--config`, answer staged prompts defaulted from config, and get the same validated plan/build/publish/verify behavior as the config-file path — while non-interactive behavior stays byte-identical and secrets never touch config files, argv, logs, summaries, or errors.

## Working Rules And Non-Goals

Working rules:

- Do not revert or rewrite unrelated worktree changes. Inspect `git status --short` before each task. In particular, do not touch `docs/tasks/20260902-102251-configurable-package-artifact-publishing.md` or any other task file except this one.
- Do NOT update `CHANGELOG.md` in any task.
- Reuse prompting through `@repo-toolkit/publish-package` (`workspace:*` import). Do not give `docker-publish` a direct `@clack/prompts` dependency unless INT-01 proves reuse impossible, with the concrete reason recorded here first.
- Non-interactive behavior must stay unchanged: same validation, same argv, same summaries when `-i` is absent.
- Preserve the ES2018 typechecking target. No `Array.prototype.at` / `Object.hasOwn`.
- Do not call `process.exit()` from library or CLI code; set `process.exitCode = 1`.
- Keep `dist/` out of commits.
- Wrap all prompt calls in an injectable seam so tests never need a TTY.
- Add completion evidence to this file as each task finishes. A task is not complete until its verification passes or a blocker is recorded.

Non-goals:

- Persisting answers to disk (`--save-config` explicitly rejected by maintainer).
- Changing plan validation rules, reference formatting, push boundaries, or digest semantics.
- Prompting for non-required fields beyond the agreed staged flow.
- CI-specific output files or registry mutation from prompts.
- Touching the completed `docs/tasks/20260909-220018-docker-publish-package.md` plan.

## Baseline Verification

Before implementation begins, the INT-01 owner records results for:

```sh
git status --short
pnpm lint
pnpm typecheck
pnpm --filter @repo-toolkit/docker-publish test
```

If baseline failures exist, record exact commands and output summaries in the baseline evidence section before changing code. Do not silently fix unrelated failures.

Baseline completion evidence:

- `git status --short` (before changes): pre-existing worktree modifications in `AGENTS.md`, `README.md`, `docs/tasks/20260902-102251-configurable-package-artifact-publishing.md`, `package.json`, `pnpm-lock.yaml`, `tsconfig.base.json`, `website/docs/packages/index.md`, plus untracked `docs/tasks/20260909-220018-docker-publish-package.md`, `docs/tasks/20260909-234906-docker-publish-interactive-prompts.md`, `packages/docker-publish/`, `website/docs/packages/docker-publish.md`. None touched by INT-01.
- `pnpm lint`: pass (exit 0).
- `pnpm typecheck`: pass (exit 0).
- `pnpm --filter @repo-toolkit/docker-publish test`: 8 files, 107 tests, all pass.

## Priority Definitions

- P0: Required to prevent hangs in CI, secret leaks, or behavior drift in the non-interactive path.
- P1: Required for the interactive contract (flags, prompts, docs).
- P2: Polish that can land after the contract works but before announcement.

## Planned Contract

Flag added to all three `SPECS` tables (same shape as the existing convention):

```ts
{ name: 'interactive', aliases: ['i'], boolean: true }
```

Help row (all three CLIs):

```text
-i, --interactive  Prompt for missing required values interactively
```

New shared helper (owned by INT-01, in `packages/publish-package/src/prompt.ts`):

```ts
promptPassword(options);
promptSelect(options);
```

New injectable seam (owned by INT-02, in `packages/docker-publish/src/`):

```ts
resolveInteractiveDockerPublishOptions(...);
```

Agents may refine supporting names but must not change the flag spelling, the TTY fail-closed rule, the CLI-flag-wins precedence, or the no-save rule without recording a maintainer decision in this file.

## Execution Waves

1. Shared primitives: INT-01.
2. Interactive core: INT-02, then INT-03 (auth + confirm build on INT-02's seam).
3. Wiring and docs: INT-04.

Do not start a later wave until dependencies are completed and their targeted verification passes.

## Detailed Tasks

### Task INT-01: Add Shared Password And Select Prompt Primitives

Status: completed

Completion evidence:

- `packages/publish-package/src/prompt.ts`: added `PromptPasswordOptions`, `promptPassword` (wraps `@clack/prompts` `password`, `message` + optional `validate` + `mask` passthrough, `isCancel` → throw `Operation cancelled.`), and generic `PromptSelectOption<T>` / `PromptSelectOptions<T>` / `promptSelect` (wraps `@clack/prompts` `select` with `{ value, label }` options + optional `initialValue`, same cancellation contract). `promptText`, `promptForRequiredValue`, `canPrompt`, `INTERACTIVE_FLAG` unchanged. No `process.exit`, no new runtime deps, ES2018 (lint + typecheck pass).
- `packages/publish-package/src/index.ts`: re-exports `promptPassword`, `promptSelect` and their option types next to existing prompt exports.
- `packages/publish-package/test/prompt.test.ts` (new): stubs `@clack/prompts` at the module boundary (no TTY); covers password value return + message/mask passthrough, validate passthrough/rejection, cancellation throws, select value return, `initialValue` preselect defaulting, select cancellation throws.
- Verification: `pnpm --filter @repo-toolkit/publish-package test` → 8 files, 215 tests, all pass; `pnpm lint` pass; `pnpm typecheck` pass; `git diff --check` clean. `CHANGELOG.md` untouched.

Priority: P1

Suggested agent: toolkit prompt engineer

Dependencies: none

Primary ownership:

- `packages/publish-package/src/prompt.ts`
- `packages/publish-package/src/index.ts` (re-exports only)
- `packages/publish-package/test/prompt.test.ts` (or existing prompt test file if present)

Finding:

`packages/publish-package/src/prompt.ts:43-105` exports `INTERACTIVE_FLAG`, `canPrompt`, `promptText`, and `promptForRequiredValue`, all built on `@clack/prompts` `text`. There is no masked-password or single-select primitive, so `docker-publish` cannot implement the agreed auth-choice and masked-entry flows without either duplicating `@clack/prompts` wiring (harming encapsulation) or taking a direct dependency (expanding the dep surface). The smallest shared enforcement point is two narrow wrappers next to `promptText`.

References:

- `packages/publish-package/src/prompt.ts:1-105`
- `packages/publish-package/src/cli.ts:217-238`
- `packages/publish-package/package.json:45-47`

Implementation requirements:

1. Add `promptPassword` wrapping `@clack/prompts` `password` with the same cancellation contract as `promptText` (`isCancel` → throw `Operation cancelled.`). Accept `message`, optional `validate`, and `mask` passthrough; return the typed string.
2. Add `promptSelect` wrapping `@clack/prompts` `select` with `{ value, label }` options, same cancellation contract, generic over the option-value type. Accept `message`, `options`, and optional `initialValue`.
3. Export both from `packages/publish-package/src/index.ts` next to the existing prompt exports.
4. Keep `promptText`, `promptForRequiredValue`, `canPrompt`, and `INTERACTIVE_FLAG` behavior unchanged.
5. Tests must cover: value return, validation rejection, cancellation throws `Operation cancelled.`, and (for select) initial-value defaulting. Tests must not require a TTY — stub `@clack/prompts` at the module boundary or inject its functions.
6. ES2018, no `process.exit`, no new runtime dependencies.

Acceptance criteria:

- `promptPassword` masks input and returns the typed value; cancel throws.
- `promptSelect` returns the selected value with default preselected; cancel throws.
- Existing `publish-package` tests still pass unchanged in behavior.
- `pnpm --filter @repo-toolkit/publish-package test` passes.

### Task INT-02: Interactive Resolver With Config-Defaulted Prompts

Status: completed

Completion evidence:

- `packages/docker-publish/src/interactive.ts` (new): `Prompter` interface (`text`/`password`/`select`/`confirm`) with `clackPrompter` default built only on `@repo-toolkit/publish-package` primitives (`promptText`, `promptPassword`, `promptSelect`; `confirm` is a Yes/No `promptSelect`, so `docker-publish` has no direct `@clack/prompts` import) plus exported `createScriptedPrompter` fake (answer queue, `SCRIPTED_CANCEL` sentinel throws `Operation cancelled.`, text/password emulate clack re-prompt via `validate`, exhausted queue throws a distinct error) with a `calls` log. `resolveInteractiveDockerPublishOptions(result, filters, { interactive, prompter, canPromptNow })` implements the staged flow: (a) config-path prompt when `--config` absent (empty skips, otherwise `loadConfigFile` with resolver-level re-prompt carrying the load error); (b) essentials defaulted from config (image loop and registry loop each with add-another confirm default No, tags comma input with Docker-tag validation, platforms comma `os/arch[/variant]` with known-table check plus `allowCustomPlatforms` confirm); (c) advanced group (allow-secrets confirm, buildArgs/labels `KEY=VALUE` with 64-entry/128-key/4096-value bounds plus secret-key guard, buildConcurrency ≤64, process timeout/max-output, dockerExecutable) behind a customize confirm default No. Field validators reuse `plan.ts` regexes and error strings verbatim; final resolution goes through `resolveDockerPublishPlan`. TTY gate throws `Interactive prompting is unavailable: no TTY detected. Pass --config or run in a TTY.` before any prompt. `interactive: false` (or absent) delegates to `resolveDockerPublishCliOptions` untouched. CLI-override (`cwd`, `--docker-executable`, `--concurrency`), name filters, and passthrough (`auth`, `digestManifestPath`, `publishConcurrency`, `expectedDigests`, `runner` guard) replicate `cli-options.ts` so the prompted plan matches the equivalent config file. ES2018, no `process.exit`, no `process.env` access. `src/index.ts` intentionally untouched (resolver is imported via `./interactive` by tests and, later, CLIs; keeps `test/index.test.ts` export assertion green).
- `packages/docker-publish/test/interactive.test.ts` (new, 20 tests): non-interactive delegation with zero calls (explicit and default), TTY fail-closed with zero calls, full-answer run deep-equals equivalent config-file resolution, defaults-accepted deep-equals config resolution, invalid tags/image-name re-prompt, cancellation at all six stages, custom-platform allow/deny+re-prompt, advanced customize values, secret-guard re-prompt, image and registry add-another loops, config-path prompt load, unreadable-path re-prompt.
- Verification: `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 127 tests, all pass; `pnpm lint` pass; `pnpm typecheck` pass; `git diff --check` clean. `CHANGELOG.md` untouched.

Priority: P0

Suggested agent: container CLI interaction engineer

Dependencies: INT-01

Primary ownership:

- `packages/docker-publish/src/interactive.ts` (new)
- `packages/docker-publish/src/index.ts` (narrow exports only, if needed)
- `packages/docker-publish/test/interactive.test.ts` (new)

Finding:

`resolveDockerPublishCliOptions` (`packages/docker-publish/src/cli-options.ts:36-53`) merges config file + CLI overrides and validates via `resolveDockerPublishPlan`, with no prompt stage. The agreed flow needs a prompt stage inserted between config load and plan resolution: for every required dimension (config path when `--config` absent, image name/contextDir/dockerfile/target, registry hostname/repositoryPrefix, tags, platforms, plus the advanced group behind a confirm), prompt with the config value as default and validate with the same rules `plan.ts` enforces. Without an injectable prompter seam, these tests would need a TTY and the non-interactive path risks drift.

References:

- `packages/docker-publish/src/cli-options.ts:36-53,191-212`
- `packages/docker-publish/src/plan.ts`
- `packages/publish-package/src/prompt.ts`

Implementation requirements:

1. Define a `Prompter` interface (`text`, `password`, `select`, `confirm`) with a `clackPrompter` default built on INT-01 primitives + `@clack/prompts` `confirm`/`isCancel`, and a scripted fake for tests. All prompt I/O in `docker-publish` goes through this seam; no direct `@clack/prompts` import in `docker-publish`.
2. Implement the staged flow: (a) config path prompt when `--config` absent (validate exists + parseable via `loadConfigFile`); (b) essentials with config defaults — image entries (loop with "add another?" confirm), registry entries (same loop), tags (comma input, Docker-rule validation), platforms (comma `os/arch`, known-table or `allowCustomPlatforms` confirm); (c) advanced group (buildArgs/labels as `KEY=VALUE` lines with bounds + secret-key guard, concurrencies, `dockerExecutable`) behind a "customize?" confirm defaulting to No.
3. TTY gate: when interactive is requested but `canPrompt()` is false (or injected `canPromptNow` false), throw a fail-closed error telling the user to pass `--config` or run in a TTY — before any prompt attempt. Never block on stdin in CI.
4. Cancellation at any prompt throws `Operation cancelled.` and the CLIs surface it with `process.exitCode = 1`.
5. Non-interactive input (`interactive: false`) must take the exact current code path — no prompt calls, zero behavior drift.
6. Do not wire the `-i` flag yet (INT-04 owns SPECS/help); expose the resolver for the CLIs to call.

Acceptance criteria:

- Scripted-prompter tests prove: full-answer run resolves the same plan as the equivalent config file; defaults-accepted run (empty answers) reproduces config; invalid input re-prompts with the plan error message.
- Non-TTY request fails before any prompt call with the fail-closed message.
- Cancellation at each stage throws `Operation cancelled.`
- With `interactive: false`, the prompter fake records zero calls and output matches the current resolver.
- `pnpm --filter @repo-toolkit/docker-publish test -- interactive.test.ts` passes.

### Task INT-03: Auth Choice Flow And Confirm-Before-Push

Status: completed

Completion evidence:

- `packages/docker-publish/src/interactive.ts` (auth + confirm sections appended; INT-02 resolver untouched): `promptInteractiveAuth(prompter, registries, configuredAuth)` implements the per-registry flow — env-var name prompts validated against `/^[A-Za-z_][A-Za-z0-9_]*$/` with config-auth defaults, username value uses `$VAR` as default when set else non-empty text entry, password value offers `select` (`Use $<VAR> from environment`, initial value, vs `Enter a new password`) when `process.env[passwordEnv]` is set and non-empty else straight to masked `password()` with non-empty validation. Entered values are returned in ephemeral `InteractiveAuthValues` (`{ hostname: { username, password } }`) for this run's login only; `process.env` is only read, never assigned, and no files are written. `collectInteractiveSecrets(plan, auth, authValues)` merges `collectCliSecrets` with the ephemeral values for redaction. `loginWithInteractiveAuth(runner, plan, auth, authValues, secrets)` performs `--password-stdin` login from the ephemeral values (env fallback only when no ephemeral entry) with redacted errors carrying `cause`. `confirmInteractiveProceed(prompter, { requiresPush })` asks `Proceed?` with `initialValue` Yes for build-only and No (explicit affirmative required) before any push; decline/cancel throws `Operation cancelled.` `resolveInteractiveAuthAndConfirm(prompter, plan, configuredAuth, { operation, requiresPush, dryRun, printSummaryFn })` prints the standard secrets-free `planSummary` and, on `dryRun: true`, returns before any auth prompt or confirm. ES2018, no `process.exit`, no direct `@clack/prompts` import.
- `packages/docker-publish/test/interactive.test.ts` (+12 tests, 139 total in package): env-set path defaults to use-env with login stdin equal to the env value; enter-new path logs in with the typed canary while the canary appears in no summary/config output and is redacted from errors including login failures; missing and empty env vars route to masked entry with zero `select` calls; invalid env-var names re-prompt; username default-accept vs unset re-prompt; build-only confirm defaults Yes, push confirm defaults No, decline/cancel throws; declined push confirm leaves the runner spy at zero calls; dry-run prints `planSummary(operation, plan, true)` with zero prompter calls; non-dry-run prints the secrets-free summary then confirms; `process.env` snapshots are byte-identical before/after.
- Verification: `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 139 tests, all pass; `pnpm lint` pass; `pnpm typecheck` pass; `git diff --check` clean. `CHANGELOG.md` untouched. Only `packages/docker-publish/src/interactive.ts`, `packages/docker-publish/test/interactive.test.ts`, and this task file touched.

Priority: P0

Suggested agent: container auth interaction engineer

Dependencies: INT-02

Primary ownership:

- `packages/docker-publish/src/interactive.ts` (auth + confirm sections)
- `packages/docker-publish/test/interactive.test.ts` (auth + confirm cases)

Finding:

Registry auth is the only secret-bearing prompt surface. The plan's `auth` map names env vars while values travel via `--password-stdin` (`packages/docker-publish/src/publish.ts`). An unconstrained prompt could invite pasting secrets into config-shaped answers or echo them. The agreed flow constrains this: per registry, prompt `usernameEnv`/`passwordEnv` names (defaulted from config), then if the named password env var is set and non-empty offer `select` (use env, default, vs enter new masked password); the entered value lives in memory for this run's login only. A final secrets-free summary + `confirm` gates any build/push.

References:

- `packages/docker-publish/src/publish.ts`
- `packages/docker-publish/src/cli-options.ts:82-117`
- `packages/docker-publish/src/interactive.ts` (from INT-02)

Implementation requirements:

1. Per registry: prompt env-var names with `/^[A-Za-z_][A-Za-z0-9_]*$/` validation, defaulted from config `auth`. Then resolve the password: if `process.env[passwordEnv]` is set and non-empty, `select` between `Use $<VAR> from environment` (initial value) and `Enter a new password`; if unset/empty, go straight to masked `password()` entry with non-empty validation.
2. The entered password is returned in an ephemeral `authValues` structure consumed by the publish call for this run only. It is never written to config-shaped output, never included in summaries, and covered by `collectCliSecrets` redaction in errors.
3. Username resolution mirrors this: use `$VAR` when set (default), else `text` prompt with default from env or config.
4. After plan resolution, print the standard secrets-free summary object and `confirm("Proceed?")` (default Yes for build-only, explicit Yes required before any push — implement as `confirm` with the push case requiring an explicit affirmative, not a default-accept). Decline/cancel throws `Operation cancelled.`
5. `--dry-run` prints the plan and returns before auth prompts and before the confirm (planning prompts still apply so dry-run can shape the plan).
6. No persistence: no file writes, no env mutation (`process.env` assignment is forbidden — hold values in memory).

Acceptance criteria:

- Tests prove: env-set path defaults to use-env and performs login via stdin with the env value; enter-new path uses the typed value for login only; typed value appears in no summary, error, or config output (redaction test with a canary secret).
- Missing/empty env var routes to masked entry, not to failure.
- Push path without explicit confirm never invokes the runner.
- `process.env` is byte-identical before/after (no mutation).
- `pnpm --filter @repo-toolkit/docker-publish test -- interactive.test.ts` passes.

### Task INT-04: Wire The Interactive Flag Into All Three CLIs Plus Docs

Status: completed

Completion evidence:

- `packages/docker-publish/src/cli.ts`, `src/cli-build.ts`, `src/cli-publish.ts`: added `INTERACTIVE_FLAG` (imported from `@repo-toolkit/publish-package`) to all three `SPECS` tables plus the `-i, --interactive  Prompt for missing required values interactively` help row in each `printHelp`. `cli-options.ts` untouched (flag threading needed no change: the interactive key never enters plan merging).
- Threading: each CLI reads `interactive = result.values.interactive === 'true'` and branches — non-interactive takes the exact previous `resolveDockerPublishCliOptions` path; interactive calls `resolveInteractiveDockerPublishOptions` with the real `clackPrompter`, then: build CLI prints the secrets-free plan and `confirmInteractiveProceed` (requiresPush false); publish CLI and push-path unified CLI run `resolveInteractiveAuthAndConfirm` (requiresPush true) + `loginWithInteractiveAuth` via `defaultDockerRunner`, then publish with `auth: {}` (login already done from ephemeral values, no `process.env` mutation); non-push unified paths print the plan with operations and confirm without auth. Dry-run returns after the plan print with zero auth prompts and zero confirm. Non-TTY `-i` throws the INT-02 fail-closed error via `reportCliError` + `process.exitCode = 1` before any Docker invocation. ES2018, no `process.exit`.
- `packages/docker-publish/README.md`: `--interactive` row in all three option tables + short interactive paragraph. `website/docs/packages/docker-publish.md`: full Interactive Mode section (staged flow, config-as-defaults, precedence CLI > prompt > config, TTY rule, auth ephemeral-only, confirm gate, no-save).
- `packages/docker-publish/test/cli.test.ts` (+4 tests, 143 total in package): help rows on all three bins; `-i` without TTY exits 1 with the fail-closed message, empty stdout, and zero runner calls (marker executable) for all three CLIs plus bare `-i` without `--config`; interactive ephemeral-password redaction via `promptInteractiveAuth` + `collectInteractiveSecrets` + `reportCliError` with env snapshot equality.
- Verification: `pnpm --filter @repo-toolkit/docker-publish test` → 9 files, 143 tests, all pass; `pnpm --filter @repo-toolkit/publish-packages test` → 3 files, 85 tests, all pass; `pnpm lint` pass; `pnpm typecheck` pass; `git diff --check` clean. `CHANGELOG.md` untouched.

Priority: P1

Suggested agent: CLI contract engineer

Dependencies: INT-02, INT-03

Primary ownership:

- `packages/docker-publish/src/cli.ts`
- `packages/docker-publish/src/cli-build.ts`
- `packages/docker-publish/src/cli-publish.ts`
- `packages/docker-publish/src/cli-options.ts` (flag threading only)
- `packages/docker-publish/test/cli.test.ts`
- `packages/docker-publish/README.md`
- `website/docs/packages/docker-publish.md`

Finding:

The resolver from INT-02/INT-03 is dead code until the CLIs expose `-i`/`--interactive`, route it through, and document it. The three `SPECS` tables (`src/cli.ts:16-30`, `src/cli-build.ts:12-21`, `src/cli-publish.ts:16-28`) need the identical `INTERACTIVE_FLAG` entry the `publish-package` CLI uses, help rows must match README tables (enforced by existing CLI tests), and the website guide needs an interactive section covering the staged flow, defaults, TTY rule, and auth contract.

References:

- `packages/publish-package/src/cli.ts:18-46,84`
- `packages/docker-publish/src/cli.ts:16-58`
- `packages/docker-publish/src/cli-build.ts:12-40`
- `packages/docker-publish/src/cli-publish.ts:16-50`
- `packages/docker-publish/test/cli.test.ts`

Implementation requirements:

1. Add `INTERACTIVE_FLAG` (imported from `@repo-toolkit/publish-package`, same as `publish-package` CLI) to all three `SPECS` tables and the `-i, --interactive` help row in each `printHelp`, matching the existing help-table wording.
2. Thread `interactive = result.values.interactive === 'true'` into the shared resolve path: non-interactive keeps the exact current behavior; interactive invokes the INT-02/INT-03 resolver with the real `clackPrompter`, then proceeds through the unchanged build/publish/verify pipeline.
3. Non-TTY `-i` fails with the INT-02 fail-closed error via `reportCliError` + `process.exitCode = 1`, before any Docker invocation.
4. Update `packages/docker-publish/README.md` option tables (all three) + a short interactive paragraph, and `website/docs/packages/docker-publish.md` with a full section (staged flow, config-as-defaults, precedence CLI > prompt > config, TTY rule, auth choice + ephemeral-only rule, confirm gate, no-save rule). Keep every help/README row agreement assertion green.
5. Tests: `-i --help` rows; non-interactive CLI tests unchanged in behavior; interactive-path CLI tests use scripted prompter injection or a spawned TTY-less run asserting the fail-closed error and zero runner calls; secret redaction test for the interactive auth path.

Acceptance criteria:

- All three `--help` outputs contain the interactive row and agree with README tables.
- Without `-i`, CLI behavior is unchanged (existing `cli.test.ts` passes unmodified in intent).
- `-i` without TTY exits nonzero with the fail-closed message and zero Docker invocations.
- `pnpm --filter @repo-toolkit/docker-publish test` passes (all files).
- `pnpm --filter @repo-toolkit/publish-packages test` passes (docs contract green).

## Dependency And Parallelization Guidance

| Wave | Task   | Agent focus         | Parallel guidance                                            |
| ---- | ------ | ------------------- | ------------------------------------------------------------ |
| 1    | INT-01 | shared primitives   | Run alone; owns `publish-package` prompt surface.            |
| 2    | INT-02 | interactive core    | Starts after INT-01.                                         |
| 2    | INT-03 | auth + confirm      | Starts after INT-02 (extends its seam, same files).          |
| 3    | INT-04 | CLI wiring and docs | Starts after INT-02 and INT-03. Runs alone; owns CLI + docs. |

Shared hotspots:

- `packages/publish-package/src/prompt.ts` + `src/index.ts`: INT-01 only.
- `packages/docker-publish/src/interactive.ts` + `test/interactive.test.ts`: INT-02 then INT-03, sequentially (same files, no parallel overlap).
- `packages/docker-publish/src/cli*.ts`, README, website page: INT-04 only.
- Do not run root `pnpm build` or `pnpm test` concurrently; package test scripts rebuild dependency closures over shared `dist/`.

## Wave Verification

After INT-01:

```sh
pnpm --filter @repo-toolkit/publish-package test
pnpm lint
pnpm typecheck
```

After INT-02 through INT-03:

```sh
pnpm --filter @repo-toolkit/docker-publish test
pnpm lint
pnpm typecheck
```

After INT-04:

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

## Deferred Follow-Up Decisions

1. Whether to offer guided repair (re-prompt a single invalid field) versus today's fail-and-reprompt loop — no scope change without a maintainer call.
2. Whether multi-line `buildArgs` editing deserves a dedicated editor prompt — deferred; `KEY=VALUE` lines stand.
3. Whether `publish-packages` or other CLIs should adopt the same staged prompter — separate task if wanted.

## Definition Of Done

- `-i` / `--interactive` works on all three bins with config values as defaults, CLI flags winning, TTY failure closed, masked ephemeral auth, and confirm gating pushes.
- Non-interactive behavior is unchanged in validation, argv, summaries, and exit codes.
- No secret appears in config output, summaries, logs, or errors; `process.env` is never mutated.
- No answers are persisted to disk.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test` pass from the repository root.
- `CHANGELOG.md` untouched.
