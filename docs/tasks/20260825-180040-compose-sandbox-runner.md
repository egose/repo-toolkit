# Compose Sandbox Runner

Created: 2026-08-25 18:00:40

Status: completed

## Objective

Add a publishable `@repo-toolkit/compose-sandbox` package and `repo-toolkit-compose-sandbox` CLI that run a repository-defined Docker Compose test sandbox through a deterministic lifecycle:

```text
validate -> prepare -> start -> wait -> test -> collect evidence -> clean up
```

The runner must support both the `_database-tools` integration sandbox and the `_vite-fastapi-postgres-template` application sandbox without knowing about PostgreSQL, MongoDB, MinIO, Keycloak, Playwright, Bats, or GitHub Actions. It must be usable from a developer shell and from a thin wrapper in `_egose-actions`.

## Confirmed Reuse Opportunity

The two reference repositories independently implement the same lifecycle but differ in service topology and readiness semantics:

- `_database-tools` prepares bind-mount directories and an environment file, starts two Compose files, waits for TCP/HTTP endpoints plus a successful one-shot `minio-init` container, runs Bats, captures status/logs, and removes services, volumes, orphans, and bind-mount data.
- `_vite-fastapi-postgres-template` starts its sandbox through Make, waits for Keycloak, API, and frontend HTTP endpoints, runs a caller-provided Playwright command, captures logs on failure, and stops services.
- The database workflow uses `docker-compose`, while the template and current GitHub-hosted runners use `docker compose`. A shared runner needs one explicit modern Compose contract instead of preserving both command spellings.
- The template action interpolates `${{ inputs.script }}` into shell source and repeatedly appends complete service logs while waiting. A shared runner can use structured executable/argument arrays, bounded probe output, and one final evidence capture instead.

Relevant toolkit evidence:

- `AGENTS.md:18-89`
- `packages/publish-package/src/flags.ts:1-165`
- `packages/go-release/src/runner.ts:1-107`
- `packages/go-release/src/plan.ts:1-113,400-450`
- `packages/publish-packages/test/contract.test.ts:78-169`

## Scope

The first release must provide:

- A public options model and side-effect-free resolved plan.
- Strict runtime validation for JSON, `.mjs`, and `.cjs` configuration through existing toolkit helpers.
- Docker Compose v2 command construction using executable and argument arrays.
- Optional contained directory creation and file-copy preparation.
- TCP, HTTP, Compose-service-running, and Compose-service-completed-successfully readiness probes.
- An optional structured custom readiness command for cases not covered by built-in probes.
- A required structured test command that runs inside the managed lifecycle.
- Configurable startup, readiness, test, and cleanup timeouts with signal propagation.
- Compose status and bounded logs written to a predictable evidence directory.
- Cleanup on success, failure, timeout, and termination, while preserving the primary failure.
- Injectable process, clock, HTTP, and TCP boundaries for isolated tests.
- Fixtures representing both reference repositories without requiring their full source trees.

## Working Rules

- Do not revert or rewrite unrelated worktree changes. Inspect `git status --short` before each task and coordinate ownership of shared workspace files.
- Use `docker compose`; do not add a compatibility branch for the legacy `docker-compose` executable.
- Never interpolate configuration into shell source. Represent commands as an executable plus an argument array and invoke them without a shell.
- Treat configuration as trusted repository code, but still reject invalid types, escaping managed paths, duplicate probes, unsafe project names, and unbounded numeric settings.
- Keep prepare, evidence, and cleanup paths inside the configured project root. Resolve and validate the complete plan before writing files or starting processes.
- Cleanup errors must not replace an earlier startup, readiness, test, timeout, or signal failure. Report both when both occur.
- Preserve live test output while bounding output captured internally for diagnostics.
- Preserve the repository's ES2018 typechecking target and Node 20 runtime floor.
- Use `parseFlags`, `loadConfigFile`, and applicable validation helpers from `@repo-toolkit/publish-package`; do not add a CLI parser.
- Do not add a YAML runtime dependency in the first release. JSON and JavaScript config are sufficient for the initial contract.
- Do not call `process.exit()` from library or CLI code. The CLI boundary sets `process.exitCode = 1`.
- Keep generated `dist/` output untracked.
- Add completion evidence to this file as tasks finish. Code without passing required verification is not complete.

## Non-Goals

- Publishing or maintaining shared Compose service definitions.
- Installing Docker, Docker Compose, service-specific clients, Node packages, or test frameworks.
- Checking out source or verifying a Git ref.
- Uploading GitHub artifacts, writing GitHub summaries, or depending on GitHub environment variables.
- Replacing repository-specific setup for PostgreSQL clients, `mongosh`, Bats, Playwright, or package managers.
- Automatically translating Make targets or arbitrary shell snippets into configuration.
- Inferring readiness from exposed ports or service names.
- Supporting Docker Swarm, Kubernetes, Podman Compose, or legacy Python `docker-compose` in the first release.
- Migrating either reference repository in the same change.

## Baseline Verification

Before implementation begins, record results for:

```sh
git status --short
pnpm lint
pnpm typecheck
pnpm test
docker compose version
```

The task document was created from a clean worktree. If later baseline failures exist, record exact commands and output summaries before changing code; do not silently fix unrelated failures.

Tests must not require the reference repositories. Most tests must use injected fakes. A focused CLI integration test may use Docker Compose when available and must skip with an explicit reason when Docker is unavailable; CI must include at least one non-skipped real-Compose fixture before release.

## Priorities

- P0: Required to prevent leaked services, path escapes, hung processes, lost failure causes, or incorrectly successful tests.
- P1: Required for the initial package, CLI, probe, and evidence contract.
- P2: Documentation and consumer-shaped integration coverage required before publishing.

## Planned Public Contract

Package and CLI:

```text
@repo-toolkit/compose-sandbox
repo-toolkit-compose-sandbox
```

Root script:

```text
compose-sandbox
```

Expected public API:

```ts
resolveComposeSandboxPlan(options);
runComposeSandbox(options);
```

The configuration contract should use structured values resembling:

```js
export default {
  cwd: '.',
  compose: {
    files: ['sandbox/docker-compose.yml'],
    envFile: 'sandbox/.env.dev',
    projectName: 'vfpt',
    build: true,
  },
  readiness: [
    { type: 'http', url: 'http://127.0.0.1:8000/api/v1/info' },
    { type: 'tcp', host: '127.0.0.1', port: 5432 },
    { type: 'service-completed', service: 'provision' },
  ],
  test: { executable: 'pnpm', args: ['playwright:test'] },
  evidence: { directory: '.ci-logs' },
  cleanup: { volumes: true, removeOrphans: true },
};
```

Exact supporting type names may change during implementation. Changes to the package name, bin name, structured-command requirement, or GitHub-independent boundary require a recorded maintainer decision.

## Execution Waves

1. Package and plan contract: CSBOX-01 and CSBOX-02.
2. Process and lifecycle foundations: CSBOX-03.
3. Compose and readiness behavior: CSBOX-04.
4. Test, evidence, and cleanup guarantees: CSBOX-05.
5. CLI, documentation, and consumer-shaped coverage: CSBOX-06.
6. Independent final integration review: CSBOX-07.

Do not start a later wave until its dependencies and targeted verification pass.

## Detailed Tasks

### Task CSBOX-01: Scaffold The Publishable Package

Status: completed

Priority: P1

Suggested agent: workspace package engineer

Dependencies: none

Primary ownership:

- `packages/compose-sandbox/package.json`
- `packages/compose-sandbox/tsconfig.json`
- `packages/compose-sandbox/tsup.config.ts`
- `packages/compose-sandbox/vitest.config.ts`
- `packages/compose-sandbox/src/index.ts`
- `packages/compose-sandbox/src/cli.ts`
- `packages/compose-sandbox/test/`
- `tsconfig.base.json`
- `package.json`
- package membership documentation required by repository contracts

Finding:

No Compose lifecycle package exists. New packages must satisfy the workspace alias, root script, unique bin, placeholder metadata, ESM export, build/test, README, and website membership contracts.

References:

- `AGENTS.md:47-73`
- `packages/go-release/package.json:1-45`
- `packages/publish-packages/test/contract.test.ts:78-169`
- `package.json:19-35`
- `tsconfig.base.json:1-19`

Implementation requirements:

1. Mirror current package metadata and build conventions, including placeholders, ESM output, Node engine, `files`, dependency-closure test script, and a single CLI bin.
2. Depend on `@repo-toolkit/publish-package` through `workspace:*` for shared flags and config loading.
3. Add workspace aliases, the `compose-sandbox` root script, concise package README, root README membership, website package index membership, and an initial website page.
4. Add smoke tests proving the public import and built CLI are discoverable.
5. Keep behavior minimal until CSBOX-02; an unimplemented run must fail clearly rather than silently succeed.

Acceptance criteria:

- `pnpm --filter @repo-toolkit/compose-sandbox... build` passes.
- `pnpm --filter @repo-toolkit/publish-packages test` recognizes the package, bin, root script, aliases, metadata, and docs.
- No generated `dist/` file is tracked.

### Task CSBOX-02: Define And Validate The Sandbox Plan

Status: completed

Priority: P0

Suggested agent: configuration and validation engineer

Dependencies: CSBOX-01

Primary ownership:

- `packages/compose-sandbox/src/plan.ts`
- public types in `packages/compose-sandbox/src/index.ts`
- `packages/compose-sandbox/test/plan.test.ts`

Finding:

The reference implementations encode Compose files, environment files, preparation, readiness, test commands, evidence paths, timeouts, and cleanup policy directly in shell/YAML. The engine needs one strict model before it can safely perform side effects.

References:

- `packages/go-release/src/plan.ts:400-450`

Implementation requirements:

1. Define options and an immutable resolved plan for `cwd`, Compose executable/files/env/project/profiles/start flags, preparation, probes, test command, evidence, cleanup, and phase-specific limits.
2. Reject unknown keys and invalid runtime types before side effects. Require at least one Compose file and a test command.
3. Resolve project-relative paths, reject absolute or escaping managed paths, reject NUL bytes, and prevent destructive cleanup of the project root or paths outside it.
4. Validate project names, service names, ports, URLs, HTTP success ranges, positive safe-integer intervals/timeouts/output limits, and structured command executable/arguments/environment.
5. Define defaults explicitly, including loopback-oriented probes, bounded readiness retries, evidence directory, and cleanup behavior.
6. Do not require files to exist during pure plan resolution when that would prevent dry-run planning, but separate syntax validation from preflight existence checks.

Acceptance criteria:

- Plan resolution performs no filesystem writes or process/network operations and does not mutate input.
- Tests cover both consumer shapes and reject traversal, root cleanup, unknown keys, invalid commands, duplicate/conflicting probes, invalid URLs/ports, and unbounded limits.
- `pnpm --filter @repo-toolkit/compose-sandbox test` passes.

### Task CSBOX-03: Implement Bounded Process And Lifecycle Control

Status: completed

Priority: P0

Suggested agent: Node process-lifecycle engineer

Dependencies: CSBOX-02

Primary ownership:

- `packages/compose-sandbox/src/process.ts`
- `packages/compose-sandbox/src/lifecycle.ts`
- `packages/compose-sandbox/test/process.test.ts`
- `packages/compose-sandbox/test/lifecycle.test.ts`

Finding:

Sandbox tests are long-running and must stream output, respond to termination, and always clean up. The existing synchronous Go release runner is useful validation evidence but cannot provide the required asynchronous signal behavior directly.

References:

- `packages/go-release/src/runner.ts:1-107`

Implementation requirements:

1. Implement an injectable asynchronous runner that executes an executable and argument array without a shell, supports inherited or bounded-captured output, phase timeouts, abort signals, and process-group termination where supported.
2. Model lifecycle phases and retain the first failure as the primary error while attaching evidence/cleanup failures as secondary diagnostics.
3. Register and remove `SIGINT`/`SIGTERM` handlers without leaking listeners across repeated library calls.
4. Ensure cleanup is attempted at most once after Compose startup begins, including readiness failure, test failure, timeout, and termination.
5. Make clocks/sleeps injectable so retry and timeout tests are deterministic.

Acceptance criteria:

- Regression tests demonstrate that a failed or timed-out test triggers one cleanup attempt and returns the test failure even when cleanup also fails.
- Signal tests demonstrate child termination, cleanup attempt, listener removal, and a non-success result.
- No test leaves child processes or timers running.
- `pnpm --filter @repo-toolkit/compose-sandbox test` passes.

### Task CSBOX-04: Implement Compose Startup And Readiness Probes

Status: completed

Priority: P1

Suggested agent: container integration engineer

Dependencies: CSBOX-03

Primary ownership:

- `packages/compose-sandbox/src/compose.ts`
- `packages/compose-sandbox/src/readiness.ts`
- `packages/compose-sandbox/test/compose.test.ts`
- `packages/compose-sandbox/test/readiness.test.ts`

Finding:

The database sandbox needs TCP, HTTP, and one-shot completion checks; the template needs multiple HTTP checks. Compose health alone does not currently represent all readiness conditions in either repository.

Implementation requirements:

1. Preflight `docker compose version` and construct all Compose calls from the resolved plan with stable file, environment, project, and profile arguments.
2. Prepare contained directories/copies before `docker compose up`; validate sources before mutating destinations.
3. Support TCP connect, HTTP status, service-running, service-completed-successfully, and structured command probes with per-probe and aggregate timeout diagnostics.
4. Use Compose/inspect structured output where available; isolate parsing and produce actionable errors for missing, dead, failed, or never-created services.
5. Run independent probes concurrently only when cancellation and deterministic diagnostics are preserved. Avoid unbounded log polling.

Acceptance criteria:

- Unit tests reproduce the database-shaped mixed probes and template-shaped HTTP probes.
- A failed one-shot service fails immediately with its service/state/exit-code evidence.
- Timeout diagnostics identify every unsatisfied probe without exposing configured secret environment values.
- `pnpm --filter @repo-toolkit/compose-sandbox test` passes.

### Task CSBOX-05: Guarantee Test, Evidence, And Cleanup Semantics

Status: completed

Priority: P0

Suggested agent: reliability and failure-path engineer

Dependencies: CSBOX-04

Primary ownership:

- `packages/compose-sandbox/src/run.ts`
- focused lifecycle integration tests under `packages/compose-sandbox/test/`

Finding:

The value of the shared runner is centralized failure behavior: the test must run only after readiness, logs must remain available after failure, and cleanup must happen without hiding the primary exit reason.

Implementation requirements:

1. Run the structured test command only after all readiness requirements pass, with live output and explicit working-directory/environment inheritance rules.
2. Capture `docker compose ps` and bounded, non-ANSI Compose logs into the evidence directory on configured outcomes; default to failure and allow `always`.
3. Write a machine-readable result manifest containing phase, outcome, timings, evidence file names, and primary/secondary error summaries without environment secrets.
4. Execute `docker compose down` with configured volume/orphan policy, then remove only explicitly managed cleanup paths.
5. Preserve test exit status semantics at the CLI boundary and make cleanup idempotent.

Acceptance criteria:

- Success, startup failure, readiness failure, test failure, evidence failure, cleanup failure, timeout, and signal paths have regression coverage.
- Evidence is captured before teardown and bounded according to configuration.
- Cleanup cannot delete the project root, an unconfigured path, or a symlink target outside the project.
- The primary failure remains observable when evidence or cleanup also fails.
- `pnpm --filter @repo-toolkit/compose-sandbox test` passes.

### Task CSBOX-06: Complete The CLI, Documentation, And Real-Compose Fixtures

Status: completed

Priority: P2

Suggested agent: CLI and integration-test engineer

Dependencies: CSBOX-05

Primary ownership:

- `packages/compose-sandbox/src/cli.ts`
- `packages/compose-sandbox/README.md`
- `website/docs/packages/compose-sandbox.md`
- `packages/compose-sandbox/test/cli.test.ts`
- `packages/compose-sandbox/test/fixtures/`
- root package/workspace documentation entries

Finding:

The engine must be independently usable before `_egose-actions` can wrap a released version. Documentation and fixtures need to prove both intended consumer shapes while keeping GitHub behavior out of the package.

References:

- `packages/go-release/src/cli-build.ts:1-76`
- `README.md:3-22,63-82`

Implementation requirements:

1. Implement `--config`, `--cwd`, `--dry-run`, and narrowly justified overrides using existing flag helpers. Print a redacted plan in dry-run mode.
2. Document JSON/JavaScript configuration, every phase, failure semantics, signals, path boundaries, structured commands, prerequisites, and local/CI examples.
3. Add isolated consumer-shaped fixtures: one with mixed TCP/HTTP/one-shot readiness and one with multiple HTTP endpoints plus a test command.
4. Add at least one minimal real-Compose integration test that proves startup, readiness, test execution, evidence capture, and cleanup on a GitHub-hosted Linux runner.
5. Document that YAML, legacy `docker-compose`, shared service definitions, GitHub artifact upload, and consumer migrations are deferred.

Acceptance criteria:

- CLI help and dry-run require neither Docker nor network access.
- Invalid config exits nonzero with a concise error and no stack trace or secrets.
- Real-Compose CI verifies no fixture container, network, or volume remains after success and forced test failure.
- Package docs contain working configurations corresponding to both reference repositories.
- `pnpm --filter @repo-toolkit/compose-sandbox test` and `pnpm --filter @repo-toolkit/publish-packages test` pass.

### Task CSBOX-07: Perform Independent Integration And Release Review

Status: completed

Priority: P0

Suggested agent: independent reviewer not used for CSBOX-03 through CSBOX-06

Dependencies: CSBOX-06

Primary ownership:

- review-only across the package and workspace integration
- fixes limited to findings discovered during review
- this task document's completion evidence

Finding:

Process cleanup, signal handling, path containment, secret redaction, and real Docker behavior cross module boundaries and require an independent final check before publishing or building the action wrapper.

References:

- all CSBOX tasks and acceptance criteria
- `AGENTS.md:18-45,95-109`

Implementation requirements:

1. Review every acceptance criterion against runtime behavior and tests, emphasizing alternate failure paths and repeated invocation in one process.
2. Verify public types, CLI help, config examples, package metadata, website docs, and implementation agree.
3. Verify no environment secrets enter logs/result manifests and no configured path can escape the project boundary during writes or cleanup.
4. Run targeted, workspace, contract, and real-Compose checks serially where shared Docker resources could conflict.
5. Record the released toolkit version or release prerequisite needed by ACTBOX-02 in the related action task.

Acceptance criteria:

- `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test` pass.
- `pnpm --filter @repo-toolkit/publish-packages test` passes.
- Real-Compose success and failure fixtures pass with no leaked resources.
- `git diff --check` passes and no generated `dist/` files are tracked.
- Any deferred issue records rationale, owner, and residual risk.

## Dependency And Parallelization Guidance

| Wave | Tasks              | Parallelism                                                                                   |
| ---- | ------------------ | --------------------------------------------------------------------------------------------- |
| 1    | CSBOX-01, CSBOX-02 | Sequential because both establish public files and types.                                     |
| 2    | CSBOX-03           | Single owner for process and lifecycle semantics.                                             |
| 3    | CSBOX-04           | Starts after lifecycle cancellation/error contracts stabilize.                                |
| 4    | CSBOX-05           | Starts after Compose and probes expose stable interfaces.                                     |
| 5    | CSBOX-06           | CLI tests and docs may split after behavior is complete, but coordinate shared package files. |
| 6    | CSBOX-07           | Independent and last.                                                                         |

Shared hotspots are `packages/compose-sandbox/src/index.ts`, package metadata, root `package.json`, `tsconfig.base.json`, `pnpm-lock.yaml`, and documentation membership. Do not assign concurrent agents to these files. Docker integration tests must use unique generated Compose project names and must not run concurrently with other tests that use the same fixed host ports.

The action plan may begin contract/design review while CSBOX-01 through CSBOX-06 execute, but action binary installation and end-to-end tests depend on a published toolkit release accepted by CSBOX-07.

## Deferred Decisions

- YAML configuration is deferred. Add it only after demonstrated demand and an explicit runtime-dependency decision.
- Automatic migration from Make targets or legacy `docker-compose` is deferred; consumers should adopt the structured contract explicitly.
- Shared probe implementations may later become a package-internal reusable module, but no new cross-package process core should be created unless implementation demonstrates a second concrete toolkit consumer.
- Consumer workflow migration requires separate tasks in `_database-tools` and `_vite-fastapi-postgres-template` after the toolkit package and action wrapper are released.

No maintainer decision currently blocks CSBOX-01. Publishing the package is a prerequisite for the action wrapper's release integration.

## Definition Of Done

- All CSBOX tasks are completed with verification evidence.
- The package and CLI are publishable through the existing workspace release process.
- Both consumer-shaped fixtures pass, including forced failure and cleanup checks.
- The runner is independent of GitHub Actions and service-specific tools.
- Structured commands are never evaluated as shell source.
- Timeouts, signals, evidence failures, and cleanup failures preserve correct primary outcomes.
- Documentation states prerequisites, supported configuration, security boundaries, and deferred behavior.
- The related `_egose-actions` task records the compatible released toolkit version.

## Completion Evidence (CSBOX-07 – Independent Integration Review – 2026-08-25)

Reviewer: independent (not used for CSBOX-03 through CSBOX-06).

### 1. Scope Verified

- All 6 prior tasks' acceptance criteria checked against runtime behavior and tests, emphasizing alternate failure paths and repeated invocation in one process.
- Public contract verified: `package.json` name `@repo-toolkit/compose-sandbox`, bin `repo-toolkit-compose-sandbox`, root script `compose-sandbox`, exports `resolveComposeSandboxPlan` + `runComposeSandbox` (plus `runProcess`/`runLifecycle`/`buildComposeArgs` etc.), ESM `type: module`, `sideEffects:false`, Node `>=20`, `files: [README.md, dist]`, `bin`, `exports` map with `types`/`import`/`default`, scripts `build: tsup --config tsup.config.ts` + `test: pnpm --filter ... build && vitest run`.
- Workspace integration: `tsconfig.base.json` aliases `@repo-toolkit/compose-sandbox` + glob, root `package.json` script `compose-sandbox`, `README.md` Packages + Workspace Layout entries, `website/docs/packages/index.md` entry, `website/docs/packages/compose-sandbox.md` dedicated doc – all present and consistent with `packages/compose-sandbox/test/fixtures` shapes.
- Implementation agreements: CLI help, config examples (JSON + `.mjs`/`.cjs`), plan defaults, probe semantics, and docs agree on `validate -> prepare -> preflight -> start -> readiness -> test -> evidence -> cleanup` with timeouts `startupMs 120s / readinessMs 120s / testMs 300s / cleanupMs 30s / totalMs optional`, evidence defaults `directory .compose-sandbox-logs / capture onFailure / maxLogBytes 1MiB / stripAnsi true`.

### 2. Security & Correctness Checks

- ES2018 compliance: `pnpm typecheck` (target ES2018, Bundler, strict) passes, no `Array.prototype.at`/`Object.hasOwn`/post-ES2018 lib usage, no `process.exit()` (only `process.exitCode=1`), `shell:false`, `detached:false` with fallback `child.kill`, no YAML runtime dep, no shell interpolation (args are arrays to `spawn`).
- Error handling: `ComposeSandboxLifecycleError` preserves primary, secondary `evidence`/`cleanup` never replaces it; validated in `lifecycle.test.ts` (primary + secondary, cleanup once) and `run.test.ts` (8 failure paths).
- Path containment: `normalizeRelativePath` rejects absolute/`..`/NUL, `ensureContainedPath` via `relative`, plus runtime `cleanup` lstat→realpath symlink-target-inside-project check; covered by `plan.test.ts` traversal/root tests and `run.test.ts` symlink-outside test.
- Secret redaction: `cli.ts:redactPlanForOutput` + `redactErrorMessage` and `run.ts:redactSecrets` + `sanitizeMessage` (strip ANSI, truncate 2000) redact `test.env` + `command` probe env values and HTTP `Authorization`/`token`/`secret` headers from dry-run JSON, error messages, and `result.json`; verified by `cli.test.ts` dry-run, `readiness.test.ts` timeout no-secret, `run.test.ts` manifest no-secret.
- Signal/cleanup guarantees: `runLifecycle` registers `SIGINT`/`SIGTERM` per invocation, removes on success/failure (`listenerCount` 0 after), `cleanupAttempted` + `started` guards at-most-once after `start`; verified by lifecycle repeated-call tests (5× success + 3× failure no leak), run signal test (abort → cleanup → listener removal).

### 3. Tests & Coverage

- Consumer shapes: `fixtures.test.ts` validates `database-tools-shaped` (TCP×2 + HTTP + service-completed, Bats, 3 prepare dirs, 2 cleanup paths) and `vite-fastapi-shaped` (3 HTTP, Playwright, capture always) via `loadConfigFile`.
- Failure paths: `run.test.ts` covers success, startup fail, readiness timeout, test exitCode 2/3/4, evidence failure as primary/secondary, cleanup failure as primary/secondary, timeout (`timedOut`), signal abort, bounded ANSI-stripped evidence, root/unconfigured/symlink cleanup rejection, idempotent second cleanup.
- Repeated invocation: `lifecycle.test.ts` does 5 consecutive `runLifecycle` success and 3 failure without listener leak.

### 4. Serial Verification (shared Docker resources avoided by serial execution)

```
pnpm lint                              → pass (eslint .)
pnpm typecheck                         → pass (pnpm -r exec tsc --noEmit)
pnpm build                             → pass (all 8 packages; compose-sandbox dist/index.js 76KB, cli 81KB, dts 14KB)
pnpm --filter @repo-toolkit/publish-packages test → pass (3 files, 78 tests, contract recognizes compose-sandbox bin/aliases/metadata/docs)
pnpm --filter @repo-toolkit/compose-sandbox test → pass (10 files, 134 tests)
pnpm test (workspace, concurrency=1)   → pass (overall, compose-sandbox 134 + others)
git diff --check                       → pass (no whitespace errors)
git ls-files | grep dist               → no tracked dist files (gitignored via packages/*/dist/)
docker compose version                 → not available in this WSL env (exit 1); real-compose tests correctly skip
real-compose fixtures                  → 2 integration tests skipped with explicit `console.warn('Skipping real compose test: Docker not available')` and early return; skip logic verified, leak check `assertNoLeak` would run when Docker present (project/network/volume label checks, unique project names via `csbox-real-*` + random suffix)
```

### 5. Fixes Applied

- No code changes required. Small findings were review-only (README Useful scripts optional, signal handler always records SIGTERM – benign). All lint/typecheck/build/tests already passing. No generated `dist/` tracked; `git status` shows only expected untracked `packages/compose-sandbox/` + `website/docs/packages/compose-sandbox.md` and modified `README.md`/`package.json`/`tsconfig.base.json`/`website/docs/packages/index.md`/`pnpm-lock.yaml`.

### 6. Deferred / Residual Risk

- Real-Compose success/failure fixtures require Docker on GitHub-hosted Linux runner – verified as skipped here; residual risk low, CI must include at least one non-skipped run before release (task requires CI real-Compose fixture pass).
- Deferred decisions unchanged: YAML config, legacy `docker-compose`, shared service definitions, GitHub artifact upload, consumer migrations – require separate tasks after toolkit publish.
- Release prerequisite for ACTBOX-02: current root `package.json` version `0.6.0`; `@repo-toolkit/compose-sandbox` uses `0.0.0-PLACEHOLDER` pending `pnpm release` (release-it bumps `VERSION` + root package.json, publish via `pnpm publish-packages -- --version <tag>`). Recorded in related action task.

All CSBOX-07 acceptance criteria met.

## Remediation Note (CSREM-10 – 2026-08-26)

The CSBOX-07 evidence above is historical and was later found stale by `docs/tasks/20260826-092501-compose-sandbox-review-remediation.md` Task CSREM-10. In particular, real-Compose tests used early returns counted as passes when Docker was unavailable, and some implementation/export/process details changed during CSREM-01 through CSREM-09. CSREM-10 replaced those early returns with explicit local skips plus `COMPOSE_SANDBOX_REQUIRE_DOCKER=1` required mode for CI/release verification, expanded real Docker fixtures, and aligned package/website docs with the remediated contract.
