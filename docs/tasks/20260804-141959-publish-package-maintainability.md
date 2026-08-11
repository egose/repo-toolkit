# Publish Package Maintainability And Testability

Created: 2026-08-04 14:19:59

## Objective

Make command execution deterministic and the shared parser/API easier to audit without changing established CLI contracts unnecessarily.

## Baseline

`src/index.ts` is an 837-line module spanning flags, config, prompts, manifests, filesystem staging, build execution, and npm execution. Current integration coverage invokes the host npm client.

### Task PPARC-01: Harden the shared flag parser

Status: completed

Priority: P1

Suggested agent: TypeScript API engineer

Dependencies: none

Primary ownership:

- `packages/publish-package/src/index.ts:121-253`
- parser tests in `packages/publish-package/test/index.test.ts`

Finding:

Flag lookup uses a normal object, so inherited keys such as `constructor` and `toString` can be accepted as specs (`159-167`, `223-253`). Duplicate names and aliases are not rejected, and `--` resumes parsing rather than terminating it (`177-179`).

Implementation requirements:

1. Use a prototype-free lookup or `Map` for specs and result records.
2. Reject duplicate canonical names/aliases with actionable errors.
3. Decide and document standard `--` behavior; update tests and downstream consumers together if changed.

Acceptance criteria:

- Prototype keys are unknown unless deliberately registered.
- Duplicate registrations fail deterministically.
- Parser behavior is covered through all consuming package CLIs.

Completion evidence:

- Changed: `packages/publish-package/src/index.ts`, `packages/publish-package/test/index.test.ts`
- Verified: `pnpm --filter @repo-toolkit/publish-package test`, `pnpm --filter @repo-toolkit/publish-packages test`, `pnpm --filter @repo-toolkit/changelog test`
- Result: the shared parser now uses a `Map` plus prototype-free result records, rejects duplicate names and aliases, and treats `--` as a real parsing terminator instead of silently resuming flag parsing.

### Task PPARC-02: Isolate side effects and fake npm/build execution

Status: completed

Priority: P1

Suggested agent: testability refactor engineer

Dependencies: PPSEC-01 from the related safety task file

Primary ownership:

- `packages/publish-package/src/index.ts:539-730`
- `packages/publish-package/src/cli.ts`
- package tests

Finding:

Build and npm execution are hardcoded, build assumes `bash -c` (`678-683`), and tests execute installed npm (`test/index.test.ts:419-465`). This obscures exact arguments, exposes OTP in argv (`714-716`), and makes portability and failure testing difficult.

Implementation requirements:

1. Inject a narrow process runner while keeping public convenience APIs intact.
2. Test executable, args, cwd, environment, sequencing, and failure cleanup with fakes.
3. Make shell mode explicit or provide structured execution; document any Bash requirement.
4. Investigate a supported OTP channel that avoids argv and redact secrets from errors.

Acceptance criteria:

- Unit/integration tests never contact or depend on a configured registry.
- Dry-run, registry, access, tag, provenance, and failure paths assert exact invocations.
- The minimum supported platform contract is explicit and tested.

Completion evidence:

- Changed: `packages/publish-package/src/index.ts`, `packages/publish-package/src/runner.ts`, `packages/publish-package/src/plan.ts`, `packages/publish-package/src/publish.ts`, `packages/publish-package/test/index.test.ts`
- Verified: `pnpm --filter @repo-toolkit/publish-package test` (103 tests), `pnpm lint`, `pnpm typecheck`, `pnpm test`
- Result: a `ProcessRunner` interface (`{ run, runShell }`) plus `defaultProcessRunner` and `ProcessRunOptions` are exported from the package root. `PublishPackageOptions.runner?: ProcessRunner` threads through `resolvePublishPackagePlan` into the plan; `publishPackage` invokes the build via `runner.runShell` and `npm publish` via `runner.run` with exact argument arrays. The shell requirement is explicit: `runShell` documents that it spawns `bash -c` and the minimum platform contract is Node 20 with `bash` on `PATH`. The OTP is forwarded via `npm_config_otp` env (never `--otp` argv) and any OTP leaking into a runner error message is redacted via `wrapRunnerErrors`/`redactSensitive` (the original error is preserved via `cause` property mutation, matching the `publish-packages` pattern and avoiding the ES2022 `Error` constructor options under the ES2018 target). A `createFakeRunner` test helper records every invocation (executable, args, cwd, env) and supports a fail-after counter for failure sequencing; 10 new fake-runner tests assert build invocation shape, npm `--access`/`--tag`/`--registry`/`--provenance`/`--dry-run` invocations, OTP-via-env contract, multi-name publishing order, build-failure-skips-npm sequencing, first-npm-failure-stops-later-names sequencing, OTP redaction, and the default-runner contract. The previous integration test that contacted `registry.npmjs.org` was converted to use the fake runner; the publish-package test suite now makes zero npm network requests (verified: `pnpm --filter @repo-toolkit/publish-package test 2>&1 | grep -c registry.npmjs.org` → `0`). Suite duration dropped from ~1.0s to ~250ms.

### Task PPARC-03: Split internal responsibilities and document public helpers

Status: completed

Priority: P2

Suggested agent: library architecture engineer

Dependencies: PPARC-01, PPARC-02

Primary ownership:

- `packages/publish-package/src/`
- `packages/publish-package/README.md`
- package export metadata if subpaths are introduced

Finding:

The root entry combines unrelated utilities and side effects, while downstream packages rely on exported parser/config helpers that the README does not identify as supported API (`README.md:61-67`).

Implementation requirements:

1. Move implementation into focused internal modules with the smallest compatible export changes.
2. Document supported helper contracts or expose them through intentional subpaths.
3. Add CLI option/precedence/help/error tests and package tarball/import checks.

Acceptance criteria:

- Public declarations and documentation agree.
- CLI tests cover every spec and config precedence.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, build, and pack smoke checks pass.

Completion evidence:

- Changed: `packages/publish-package/src/index.ts`, `packages/publish-package/src/cli.ts`, `packages/publish-package/README.md`, `packages/publish-package/test/cli.test.ts`; added `packages/publish-package/src/{flags,prompt,runner,helpers,manifest,plan,publish}.ts`
- Verified: `pnpm --filter @repo-toolkit/publish-package test` (103 tests), `pnpm test` (440 tests across publish-package + changelog + publish-packages + release-artifact + confluence), `pnpm lint`, `pnpm typecheck`, `pnpm --filter @repo-toolkit/publish-package build`, pack smoke (in `test/cli.test.ts`)
- Result: the 1136-line `src/index.ts` is now a 77-line pure barrel that re-exports from seven focused internal modules — `flags.ts` (parser), `prompt.ts` (config loader + interactive prompts), `runner.ts` (injectable subprocess runner), `helpers.ts` (`isPlainObject`/`inferNpmTag`/`normalizeVersion`), `manifest.ts` (manifest rewrite/validation + defaults), `plan.ts` (`resolvePublishPackagePlan` + path-containment + `toRootMetadata`), `publish.ts` (`publishPackage` + runner wrappers + copy/collision helpers). The public API surface is preserved byte-for-byte: every named export the original `index.ts` had is re-exported (`parseFlags`, `readValue`, `splitListArg`, `loadConfigFile`, `resolveCliOptions`, `promptText`, `promptForRequiredValue`, `INTERACTIVE_FLAG`, `canPrompt`, `ProcessRunner`, `ProcessRunOptions`, `defaultProcessRunner`, `isPlainObject`, `inferNpmTag`, `normalizeVersion`, `PackageJson`, `RootMetadata`, `PublishRewriteOptions`, `CreatePublishPackageJsonOptions`, `DEPENDENCY_FIELDS`, `DEFAULT_*` constants, `createPublishPackageJson`, `validateSourceManifest`, `validateRootManifest`, `PublishPackageOptions`, `PublishPackagePlan`, `resolvePublishPackagePlan`, `ensurePathWithinRoot`, `assertPathWithinRoot`, `publishPackage`); `mergeRepository` stays private (now `toRootMetadata` in `plan.ts`). The README now documents every supported helper contract, the `ProcessRunner` mechanism, the new `runner` option, and the OTP-via-env channel — a `help README parity` test cross-references every README flag against `printHelp()` output, and a `SPECS entries` test verifies the spec table matches the canonical flag names. `SPECS`, `printHelp`, and `buildOptions` are exported from `src/cli.ts` to enable 29 new CLI tests (`test/cli.test.ts`) covering every spec, `--flag=value`/dash-leading-value forms, boolean negation, list/repeatable accumulation, `--` terminator (strict and non-strict), and three config-precedence cases (CLI overrides config, config fills gaps, relative config resolved against `--cwd`). A pack-smoke test runs `pnpm pack` and verifies the tarball contains `package.json`, `README.md`, `dist/index.js`, `dist/index.d.ts`, `dist/cli.js` and excludes `src/`, `test/`, `tsup.config.ts`, `vitest.config.ts`. No new package.json `exports` subpaths were introduced (consumers continue to import only from the package root, which re-exports everything).

## Definition Of Done

An independent reviewer verifies parser adversarial cases, subprocess isolation, public types/docs, and that no new runtime dependency or compatibility shim was introduced without justification.
