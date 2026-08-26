# Compose Sandbox Review Remediation

Created: 2026-08-26 09:25:01

Status: completed

Completion evidence:

- CSREM-01 through CSREM-11 are all marked `completed` and each task section includes command output or test-count evidence.
- Final independent review verified `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm --filter @repo-toolkit/publish-packages test`, `git diff --check`, packed-consumer CLI/API smoke tests, and required real-Docker Compose tests.
- `CHANGELOG.md` was not edited.

Related task: `docs/tasks/20260825-180040-compose-sandbox-runner.md`

## Objective

Remediate confirmed correctness, security, lifecycle, and testability gaps in `@repo-toolkit/compose-sandbox`, then reduce the package's architectural and public-contract burden without changing behavior accidentally.

The current unit suite is green, but review and direct reproductions found paths that can escape the project through symlinked ancestors, killed processes that appear successful, cleanup that can be skipped or falsely reported successful, lifecycle deadlines that are not hard bounds, and diagnostics that can disclose configured secrets. These findings invalidate parts of the completion evidence in the related task and must be resolved before publishing the package.

## Scope

- Process exit, timeout, cancellation, and descendant-termination semantics.
- Compose operation result checking and failure preservation.
- Configurable shell-free Compose invocation, defaulting to `docker compose` while supporting standalone or version-managed binaries.
- Emergency evidence and cleanup after timeout or signal cancellation.
- Runtime filesystem containment for prepare, evidence, and cleanup operations.
- Readiness deadlines, service completion semantics, and probe efficiency.
- Secret-safe, failure-isolated logging and valid result manifests.
- CLI/library option consistency, exit status behavior, and public API boundaries.
- Internal encapsulation, reusable dependencies, byte-bounded output, and orchestration readability.
- Real Docker Compose release verification and documentation alignment.

## Working Rules

- Inspect `git status --short` before each task. The review began with concurrent edits in `packages/compose-sandbox/src/compose.ts`, `src/index.ts`, and `src/run.ts`; do not revert or overwrite unrelated changes.
- Add a regression test that fails against the reviewed behavior before changing each confirmed defect.
- Preserve structured executable/argument invocation with `shell: false`.
- Treat filesystem paths as untrusted at the point of each write, copy, directory creation, or recursive deletion. Lexical plan validation is necessary but not sufficient.
- Treat a process as successful only when it exited normally with code 0, was not signaled, and did not time out.
- Preserve the first lifecycle failure. Evidence and cleanup failures remain secondary diagnostics.
- Logging and telemetry must never control whether cleanup runs.
- Do not broaden compatibility or add runtime dependencies without a recorded maintainer decision.
- Keep generated `dist/` output untracked.
- Update this file as tasks start, complete, block, or discover independent follow-up work.

## Non-Goals

- Supporting Podman Compose, Swarm, or Kubernetes semantics. A compatible standalone `docker-compose` executable is in scope only through the generic command-prefix contract.
- Adding YAML configuration.
- Installing Docker or consumer-specific test tools.
- Replacing repository-specific Compose definitions.
- Creating a cross-package process framework before a second concrete consumer exists.
- Eliminating every filesystem TOCTOU race on every platform. The confirmed symlink-ancestor escapes must be fixed, and any residual race must be documented accurately.

## Baseline Verification

Review verification on 2026-08-26:

```sh
pnpm --filter @repo-toolkit/compose-sandbox test
pnpm lint
pnpm typecheck
git diff --check -- packages/compose-sandbox docs/tasks/20260825-180040-compose-sandbox-runner.md
docker compose version
```

Observed results:

- Package tests passed: 10 files, 134 tests.
- Lint and typecheck passed.
- Diff check passed.
- Docker Compose was unavailable in the review environment, so both real-Compose tests returned early and were counted as passed rather than reported as skipped.
- Worktree changes existed in `src/compose.ts`, `src/index.ts`, and `src/run.ts`; they were reviewed in place and not modified by this review.

Before implementation, rerun the targeted package tests and record any changed baseline. Do not treat the green baseline as evidence that the failure paths below are covered.

## Priorities

- P0: Can escape the project boundary, leak services/processes, hang despite configured limits, disclose secrets, or report a failed operation as successful.
- P1: Public contract, dependency boundary, or test gap likely to cause incorrect consumer behavior or unsafe future changes.
- P2: Maintainability, performance, and documentation improvements after behavior is locked by tests.

## Execution Waves

1. Process and path safety: CSREM-01 and CSREM-02 may run in parallel.
2. Compose and lifecycle reliability: CSREM-03, then CSREM-04.
3. Readiness and diagnostics: CSREM-05 and CSREM-06 may run in parallel after their dependencies.
4. Compose invocation and public contract: CSREM-07, then CSREM-08.
5. Architecture, Docker release evidence, and final review: CSREM-09, CSREM-10, then CSREM-11.

## Detailed Tasks

### Task CSREM-01: Make Process Outcomes And Tree Termination Unambiguous

Status: completed

Completion evidence:

- Updated `packages/compose-sandbox/src/process.ts`: changed `ProcessResult.exitCode` to `number | null`, added `isProcessSuccess`/`isSuccessfulProcessResult` predicate requiring `exitCode===0 && signal===null && !timedOut`, implemented `truncateUtf8ToBytes` byte-safe helper that truncates at UTF-8 character boundaries and never exceeds `maxOutputBytes`, enforced pre-aborted check before spawn (rejects with `process aborted before spawn`), closed check/spawn race by terminating if abort arrives during setup, set `detached: true` on POSIX (`process.platform !== 'win32'`) and group-kill via `kill(-pid)` with fallback to `kill(pid)` + `child.kill`, gave `captureOutput`/`inheritStdio` a single documented contract (`captureOutput && inheritStdio` throws; `inheritStdio` => `stdio:'inherit'` and no capture; otherwise `stdio:'pipe'` and capture unless `captureOutput===false`), preserved cleanup of `timeoutTimer`/`graceTimer`/`killTimer` and `abort` listener on every path, kept `shell:false`.
- Exported new helpers via `packages/compose-sandbox/src/index.ts`: `isProcessSuccess`, `isSuccessfulProcessResult`, `truncateUtf8ToBytes`.
- Updated `packages/compose-sandbox/test/process.test.ts`: fixed `detached` expectation to be platform-aware, added 10 regression tests covering signal-terminated non-success, timeout null-code non-success, pre-aborted no-spawn, close-race abort, UTF-8 truncation for ASCII/emoji/CJK (byteLength <= max), `truncateUtf8ToBytes` boundary, mutual-exclusion of stdio flags, inherited stdio contract, real POSIX grandchild killed on timeout/abort (marker file not created), and timer/listener before/after counts.
- Verified regression before fix: 8 failing tests (exitCode null, timeout null, pre-aborted spawn invoked, UTF-8 overflow 7>5 and 3>2, grandchild marker survived, missing predicate, stdio conflict not rejected).
- After fix: `pnpm --filter @repo-toolkit/compose-sandbox test` passes (10 files, 144 tests), `pnpm lint` passes, `pnpm typecheck` passes, no `Array.prototype.at`/`Object.hasOwn` violations.

Priority: P0

Suggested agent: Node.js process-lifecycle engineer

Dependencies: none

Primary ownership:

- `packages/compose-sandbox/src/process.ts`
- `packages/compose-sandbox/test/process.test.ts`
- process types exported from `packages/compose-sandbox/src/index.ts`

Finding:

`runProcess` converts a `null` close code to exit code 0. Signal-terminated and timed-out children can therefore look successful to callers. A pre-aborted signal invokes termination before the child exists and still spawns the command. The runner also sends a negative-PID signal while spawning with `detached: false`, so the child does not normally own the process group and grandchildren can survive cancellation.

`captureOutput` is exposed but ignored, and UTF-8 truncation can exceed its byte limit after splitting a multibyte sequence.

References:

- `packages/compose-sandbox/src/process.ts:16-26`
- `packages/compose-sandbox/src/process.ts:102-141`
- `packages/compose-sandbox/src/process.ts:157-171`
- `packages/compose-sandbox/src/process.ts:202-218`
- `packages/compose-sandbox/src/process.ts:234-243`
- `packages/compose-sandbox/src/process.ts:277-296`
- `packages/compose-sandbox/test/process.test.ts:194-269`
- `packages/compose-sandbox/test/process.test.ts:304-348`
- `packages/compose-sandbox/README.md:104-106`

Implementation requirements:

1. Preserve normal exit, signal termination, timeout, and abort as distinct outcomes. Prefer `exitCode: number | null` and a shared success predicate requiring code 0, no signal, and no timeout.
2. Reject a pre-aborted signal before calling `spawn`; close the check/spawn race by terminating immediately if cancellation arrives during setup.
3. On supported POSIX systems, create a dedicated child process group and terminate the entire group with TERM/KILL escalation. Define and test a safe platform-specific fallback.
4. Give `captureOutput`, `inheritStdio`, and stdio selection one documented, non-conflicting contract.
5. Implement byte-safe UTF-8 truncation that never exceeds `maxOutputBytes` and reuse it where practical in later tasks.
6. Preserve listener and timer cleanup on every spawn, error, close, timeout, and abort path.

Acceptance criteria:

- A child that terminates itself with `SIGTERM` cannot satisfy the process success predicate.
- A timed-out process cannot be represented as successful even if its close code is `null`.
- A pre-aborted call does not invoke the injected spawn function or perform a filesystem side effect.
- A real POSIX regression process starts a grandchild; timeout and abort prevent the grandchild from performing a delayed side effect.
- UTF-8 boundary tests prove `Buffer.byteLength(output, 'utf8') <= maxOutputBytes` for ASCII, emoji, and CJK input.
- Timer/listener tests compare before and after counts rather than only asserting a count exists.
- `pnpm --filter @repo-toolkit/compose-sandbox test` passes.

### Task CSREM-02: Enforce Runtime Filesystem Containment And A Complete FS Contract

Status: completed

Completion evidence:

- Created `packages/compose-sandbox/src/fs.ts`: defines `SandboxFs`/`PrepareFs`/`EvidenceFs`/`CleanupFs` with all required ops typed (`mkdir`, `writeFile`, `copyFile`, `access`, `lstat`, `realpath`, `rm`) and no optional fields; `isEnoent` checks `code === 'ENOENT'` only, `resolveRealRoot`/`ensurePathInsideRoot` resolve real root and validate every existing ancestor via `lstat`/`realpath`, fail closed on `EACCES`/`EIO` etc., climb on `ENOENT` to nearest existing ancestor, check `realpath` containment via `relative`, join suffix for non-existing final component, document residual TOCTOU check-then-use risk.
- Updated `packages/compose-sandbox/src/compose.ts`: `ComposeDeps.fs` now `PrepareFs`, `prepareSandbox` resolves real root and calls `ensurePathInsideRoot` before each `mkdir` and `copyFile`; fixed `runCompose`/`preflightCompose` to forward `clock` without `as never`; `startSandbox` destructures signal correctly.
- Updated `packages/compose-sandbox/src/run.ts`: `RunDeps.fs` now `SandboxFs` (required ops), `createDefaultFs`/`resolveRealRoot`/`ensurePathInsideRoot`/`isEnoent` used; `realRoot = await resolveRealRoot(plan.cwd, fs)` computed once; evidence handler validates `resolvedDirectory` and each `ps.json`/`logs.txt` path before `mkdir`/`writeFile`; manifest section validates `resolvedDirectory` and `result.json` before `mkdir`/`writeFile`; cleanup loop validates each `resolvedPath` via `ensurePathInsideRoot` then `fs.rm` with `isEnoent` idempotence, removed `stat` fallback and `unlink` fallback and message-text matching, fails closed on metadata errors.
- Updated `packages/compose-sandbox/test/compose.test.ts`: prepare tests now provide fully typed `fs` (`mkdir`, `copyFile`, `access`, `lstat`, `realpath`) without `as never` casts.
- Added `packages/compose-sandbox/test/fs-containment.test.ts`: 9 regression tests covering symlinked ancestors for prepare directories, copy destinations, evidence directories, cleanup paths, manifest writes, and non-existing final component, each proves outside file unchanged; `EACCES`/`EIO` fail closed without invoking `mkdir`/`copyFile`/`writeFile`/`rm`; typed `ENOENT` idempotent for cleanup of missing path; fully typed injected `SandboxFs` executes `prepareSandbox` and `runComposeSandbox` without casts; compile-time check via `// @ts-expect-error` verifies omitting `rm`/`lstat` is type error.
- Updated `packages/compose-sandbox/test/run.test.ts`: relaxed cleanup symlink error expectation to `/escapes|outside/i` to match centralized message.
- Verified before fix: new containment tests failed (wrote outside or silently succeeded); after fix outside files preserved and containment errors thrown.
- After fix: `pnpm --filter @repo-toolkit/compose-sandbox test` passes (11 files, 154 tests), `pnpm lint` passes, `pnpm typecheck` passes, no `Array.prototype.at`/`Object.hasOwn` violations.

Priority: P0

Suggested agent: filesystem security engineer

Dependencies: none

Primary ownership:

- path safety helpers under `packages/compose-sandbox/src/`
- `packages/compose-sandbox/src/compose.ts` preparation paths
- filesystem and cleanup sections of `packages/compose-sandbox/src/run.ts`
- focused tests in `packages/compose-sandbox/test/compose.test.ts` and `test/run.test.ts`

Finding:

Plan containment is lexical. Runtime cleanup checks the final path only, so a symlinked ancestor can redirect recursive deletion outside `cwd`. Preparation and evidence writes have no runtime realpath/ancestor containment check. A reviewed reproduction deleted an outside directory through `cleanup.paths: ['alias/victim']`, where `alias` was a symlink, and another wrote `result.json` outside the project through a symlinked evidence directory.

`RunDeps.fs` does not expose `access` or `copyFile`, even though preparation uses them, and replaces the default filesystem wholesale through casts. Cleanup makes safety operations optional, can follow symlinks through a `stat` fallback, silently ignores unexpected metadata errors, and can silently skip deletion when neither `rm` nor `unlink` is provided.

References:

- `packages/compose-sandbox/src/plan.ts:884-913`
- `packages/compose-sandbox/src/compose.ts:17-25`
- `packages/compose-sandbox/src/compose.ts:143-171`
- `packages/compose-sandbox/src/run.ts:40-59`
- `packages/compose-sandbox/src/run.ts:163-178`
- `packages/compose-sandbox/src/run.ts:363-406`
- `packages/compose-sandbox/src/run.ts:453-543`
- `packages/compose-sandbox/test/run.test.ts:533-596`

Implementation requirements:

1. Create one internal filesystem capability contract, or explicit prepare/evidence/cleanup contracts, with every required operation typed and no `as never` dependency bridge.
2. Resolve the real project root and validate every existing ancestor immediately before directory creation, copy destination writes, evidence writes, and cleanup deletion.
3. Reject ancestor chains that resolve outside the real root. Preserve outside files and directories on rejection.
4. Require `lstat` for symlink-sensitive checks. Fail closed on every metadata error except a typed `ENOENT`; do not match error-message text.
5. Define behavior for non-existing final path components while validating the nearest existing ancestor.
6. Keep lexical validation in plan resolution for side-effect-free early rejection, but centralize runtime enforcement in the smallest shared filesystem boundary.
7. Document residual check-then-use risk if platform APIs cannot make the complete operation atomic.

Acceptance criteria:

- Regression tests cover symlinked ancestors for prepare directories, copy destinations, evidence directories, cleanup paths, and manifest writes.
- Every test proves the outside target remains unchanged.
- `EACCES` and `EIO` during safety checks fail the lifecycle and do not invoke write, copy, or delete; typed `ENOENT` remains idempotent where appropriate.
- A fully typed injected filesystem can execute preparation, evidence, and cleanup tests without casts.
- Omitting a required filesystem operation is a compile-time error rather than a silent runtime no-op.
- `pnpm --filter @repo-toolkit/compose-sandbox test` passes.

### Task CSREM-03: Check Every Compose Operation Result Through One Boundary

Status: completed

Completion evidence:

- Added `assertComposeSuccess`/`ensureComposeSuccess` in `packages/compose-sandbox/src/compose.ts:39-51` that requires `isProcessSuccess` (exitCode===0 && signal===null && !timedOut) and throws `docker compose <subcommand> failed: exitCode <code> signal <sig> timedOut <bool>: <bounded 500B diagnostics>` using `truncateUtf8ToBytes`. Reused for `preflightCompose` (`version`), `startSandbox` (`up ...`), `getServiceState` (`ps`).
- Updated `packages/compose-sandbox/src/run.ts` evidence handler to `assertComposeSuccess(psResult,'ps')` / `assertComposeSuccess(logsResult,'logs')` before write; failed evidence not written or listed, successful peer files preserved (manifest `evidenceFiles` reflects actual writes). Cleanup `down` now `assertComposeSuccess(downResult,'down')` with error bubbled to `cleanupError`; via `runLifecycle` failed down is primary after success and secondary after earlier failure, prevents `outcome: success` manifest/summary. `shell:false` preserved via `runProcess`.
- Added `packages/compose-sandbox/test/compose-checked.test.ts` with 22 regression tests covering nonzero/signal/timeout for 6 operation types (preflight, startup, service inspection, evidence ps, evidence logs, cleanup down), bounded diagnostics <=500B, failed down prevents success manifest, earlier failure remains primary when evidence/cleanup also fail, partial evidence retained accurately, success never emitted for failed compose. Verified before fix 18 failing, after fix 12 files 176 tests passing.
- Verified `pnpm --filter @repo-toolkit/compose-sandbox test` passes (12 files, 176 tests), `pnpm lint` passes, `pnpm typecheck` passes. Preserved concurrent edits in `compose.ts`/`run.ts`/`index.ts` and FS containment (CSREM-02).

Priority: P0

Suggested agent: Compose reliability engineer

Dependencies: CSREM-01

Primary ownership:

- `packages/compose-sandbox/src/compose.ts`
- Compose invocation portions of `packages/compose-sandbox/src/run.ts`
- `packages/compose-sandbox/test/compose.test.ts`
- focused `packages/compose-sandbox/test/run.test.ts` cases

Finding:

Startup, preflight, and service inspection usually inspect only `exitCode`; evidence and cleanup do not inspect the returned result at all. A nonzero, signaled, or timed-out `docker compose down` is logged as successful, and the whole run can resolve with `outcome: success`. Failed `ps` and `logs` output can be written and advertised as valid evidence.

References:

- `packages/compose-sandbox/src/compose.ts:85-140`
- `packages/compose-sandbox/src/compose.ts:245-305`
- `packages/compose-sandbox/src/run.ts:370-419`
- `packages/compose-sandbox/src/run.ts:438-451`
- `packages/compose-sandbox/test/run.test.ts:359-456`

Implementation requirements:

1. Introduce one checked Compose-operation boundary that requires the CSREM-01 success predicate and reports subcommand, exit code, signal, timeout, and bounded diagnostics.
2. Use it consistently for version, up, ps, logs, and down operations.
3. Do not write or list an evidence file for a failed Compose command, but preserve files from other successful evidence commands.
4. Treat failed cleanup as primary after an otherwise successful run and secondary after an earlier failure.
5. Never emit a success message for a nonzero, signaled, or timed-out operation.
6. Preserve Compose argument construction and shell-free invocation.

Acceptance criteria:

- Nonzero, signal, and timeout results are independently tested for preflight, startup, service inspection, evidence ps, evidence logs, and cleanup down.
- A failed `down` prevents a success manifest and a success summary.
- An earlier test failure remains primary when evidence or cleanup also returns an unsuccessful result.
- Partial successful evidence is retained and listed accurately.
- `pnpm --filter @repo-toolkit/compose-sandbox test` passes.

### Task CSREM-04: Give Emergency Evidence And Cleanup Fresh Bounded Cancellation Contexts

Status: completed

Completion evidence:

- Updated `packages/compose-sandbox/src/lifecycle.ts`: extended `Clock` with optional `setTimeout`/`clearTimeout` via `getScheduler`, default clock now wraps global timers, split `SIGINT`/`SIGTERM` into distinct handlers preserving actual signal name (`signalReceived ?? 'SIGINT'/'SIGTERM'`), added emergency-context support: `emergencyControllers`/`emergencyTimers` plus `abortEmergencyControllers`, `clampedBudget` (explicit budget clamped to remaining `totalMs` or fallback to explicit after total exceeded), `createEmergencyContext` scheduling abort via scheduler, `attemptEvidenceWithFresh`/`attemptCleanupWithFresh` using fresh controllers bounded by `evidenceMs`/`cleanupMs`/`preflightMs` and disposed via scheduler, total timeout via scheduler aborting both active and emergency controllers, preflight bounded via `Promise.race` with scheduler timeout and proper cleanup without `throw` in `finally`, removed global `setTimeout` usage, ensured `removeHandlers` clears both signals and `clearEmergencyTimers` runs on every path, preserved primary signal/timeout even when evidence/cleanup fails as secondary.
- Updated `packages/compose-sandbox/src/compose.ts`: `preflightCompose` now accepts `{ signal, timeoutMs }` and forwards to `runProcess` with `timeoutMs`/`signal` for bounded preflight.
- Updated `packages/compose-sandbox/src/run.ts`: added `getScheduler` helper and `defaultClock` with `setTimeout`/`clearTimeout`, routed total timeout via scheduler (`scheduler.setTimeout`/`clearTimeout` with `unref`), added `remainingTotalMs`/`clampedTimeout` helpers clamping to remaining total (returning explicit when already exceeded), bounded `preflightCompose` by `clampedTimeout(cleanupMs)`, bounded evidence `ps`/`logs` by `evidenceBudget = clampedTimeout(cleanupMs)` with `timeoutMs`, bounded `down` by `cleanupBudget = clampedTimeout(cleanupMs)`, passed `totalMs`/`cleanupMs`/`evidenceMs`/`preflightMs` to `runLifecycle`, preserved primary timeout/signal and secondary handling, removed global `setTimeout`/`clearTimeout` direct usage.
- Added `packages/compose-sandbox/test/emergency-cleanup.test.ts` with 12 regression tests (all failing before fix): fake runner rejecting pre-aborted proves evidence/down receive live signals after SIGINT, SIGTERM, total timeout; hung down terminated within cleanupMs and reported secondary; preflight/evidence budgets enforced within tolerance (≈40-60ms budgets, measured elapsed 52-63ms); no listener/timer leaks after repeated success/failure; distinguishes SIGINT vs SIGTERM; routes timers through injectable scheduler (global not called); second SIGTERM aborts emergency evidence; run-level SIGINT preserves primary and runs down with live signal; run-level hung down bounded to cleanupMs (103ms for 80ms budget).
- Verified before fix: lifecycle signal handlers aliased to SIGTERM, evidence/cleanup received aborted signal and threw pre-aborted, total timeout used global timer, preflight unbounded, cleanupMs not enforced for hung down, listener leak possible.
- After fix: `pnpm --filter @repo-toolkit/compose-sandbox test` passes (13 files, 188 tests), `pnpm lint` passes, `pnpm typecheck` passes, no `Array.prototype.at`/`Object.hasOwn` violations, preserved CSREM-01/02/03 behavior.

Priority: P0

Suggested agent: lifecycle cancellation engineer

Dependencies: CSREM-01, CSREM-03

Primary ownership:

- `packages/compose-sandbox/src/lifecycle.ts`
- lifecycle and timeout orchestration in `packages/compose-sandbox/src/run.ts`
- `packages/compose-sandbox/test/lifecycle.test.ts`
- focused signal/timeout cases in `packages/compose-sandbox/test/run.test.ts`

Finding:

The same abort signal that cancels the active phase is passed to failure evidence and cleanup. Once CSREM-01 correctly rejects pre-aborted subprocesses, emergency `ps`, `logs`, and `down` cannot start. Current signal tests only prove a fake received a down call before rejecting the aborted signal; they do not prove teardown completed.

The total timeout uses global `setTimeout` instead of the injected clock, preflight is unbounded, and evidence commands have no explicit phase budget. Signal diagnostics also record both `SIGINT` and `SIGTERM` as `SIGTERM`.

References:

- `packages/compose-sandbox/src/lifecycle.ts:93-113`
- `packages/compose-sandbox/src/lifecycle.ts:128-147`
- `packages/compose-sandbox/src/lifecycle.ts:210-228`
- `packages/compose-sandbox/src/run.ts:188-207`
- `packages/compose-sandbox/src/run.ts:243-259`
- `packages/compose-sandbox/src/run.ts:351-451`
- `packages/compose-sandbox/test/run.test.ts:484-506`

Implementation requirements:

1. Cancel the active phase with its lifecycle signal, then create fresh evidence and cleanup contexts that are not already aborted.
2. Bound cleanup by `cleanupMs` and define an explicit evidence/preflight budget or clamp them to the remaining total deadline.
3. Preserve timeout or received signal as primary even if evidence or cleanup fails.
4. Support a second termination request or emergency-context timeout without leaving subprocesses alive.
5. Route all timers and abortable sleeps through an injectable scheduler/clock contract.
6. Record the actual signal name and remove all handlers/timers on every result path.

Acceptance criteria:

- A fake runner that rejects every pre-aborted signal proves evidence and down receive live signals after `SIGINT`, `SIGTERM`, and total timeout.
- Emergency cleanup completes once within `cleanupMs`; a hung down command is terminated and reported as secondary when an earlier failure exists.
- Preflight and evidence cannot exceed their documented budget by more than a small real-time tolerance.
- Repeated invocation does not leak signal listeners or timers.
- Tests distinguish `SIGINT` from `SIGTERM` in diagnostics.
- `pnpm --filter @repo-toolkit/compose-sandbox test` passes.

### Task CSREM-05: Enforce Hard Readiness Deadlines And Correct Service Completion

Status: completed

Completion evidence:

- Updated `packages/compose-sandbox/src/readiness.ts`: added `Clock.setTimeout/clearTimeout` support via `getScheduler`, expanded `GetServiceState`/`RunCommandProbe` to accept `{signal, timeoutMs}`, added `GetServiceSnapshot`, implemented `sleepWithAbort` (abort-aware via `clock.sleep` race) and `raceWithBudgetAndSignal` (clamped timeout + abort race), clamped every probe attempt timeout to `remaining = deadline - clock.now()` and retry sleep to `min(interval, remaining)`, required explicit `exitCode===0` for `service-completed` (missing/malformed returns false), implemented shared snapshot per polling cycle via `getSnapshot` (TTL 5ms, single `getServiceSnapshot` or batch `getServiceState` for distinct services, one snapshot per cycle), preserved deterministic fatal-error selection (ordered due probes, first `ServiceProbeError`/`ReadinessProbeError` wins, aborts inner controller), and secret-safe `ReadinessTimeoutError` diagnostics via `describeProbe`.
- Updated `packages/compose-sandbox/src/compose.ts`: added `getServiceSnapshot` (single `ps -a --format json` with `signal`/`timeoutMs`, asserts success, parses to `Map`), refactored `getServiceState` to delegate to `getServiceSnapshot` with signal/timeout forwarding and proper `failed to inspect` wrapping; exported via `src/index.ts`.
- Updated `packages/compose-sandbox/src/run.ts`: `RunDeps` now includes `getServiceSnapshot`; `readinessDeps` forwards `signal`/`timeoutMs` to `defaultGetServiceState`/`defaultGetServiceSnapshot` with clamped budgets and documents that injected fakes must respect `signal`/`timeoutMs` or be raced against remaining deadline.
- Added `packages/compose-sandbox/test/readiness-hard.test.ts` with 11 regression tests (all failing before fix): hanging command/service probes canceled within 350ms for 80ms deadline via `Promise.race` hang detection; abort during sleep (interval 500ms) rejects in 33ms with 1 attempt; probe `timeoutMs` 5000 clamped to 40/45; missing exitCode and malformed status do not pass (timeout), explicit and status-derived 0 pass, nonzero fails immediately; multiple service probes with `getServiceSnapshot` bounded to 8-20 calls for 150ms/10ms (proves one ps per cycle vs 2×). Verified before fix 7 failures (hang-detected, 5000 not clamped, missing resolved instead of timeout), after fix 11 passed.
- Fixed `packages/compose-sandbox/test/readiness.test.ts` expectation for `getServiceState` to include `{signal, timeoutMs}` second arg.
- Fixed `packages/compose-sandbox/src/readiness.ts` lint (removed unused helper) and preserved `pnpm lint`/`pnpm typecheck`/`pnpm --filter @repo-toolkit/compose-sandbox test` (14 files, 199 tests) passing; no `Array.prototype.at`/`Object.hasOwn` violations.
- Verified hard bound for default deps (TCP/HTTP respect signal/timeout, service snapshot via single ps, command via `runProcess` with signal/timeout); non-cooperative fakes are raced against remaining budget and documented.
- Preserved signal/timeout handling, FS containment, and secret-safe diagnostics.

Priority: P0

Priority: P0

Suggested agent: asynchronous readiness engineer

Dependencies: CSREM-01, CSREM-03, CSREM-04

Primary ownership:

- `packages/compose-sandbox/src/readiness.ts`
- service inspection API in `packages/compose-sandbox/src/compose.ts`
- `packages/compose-sandbox/test/readiness.test.ts`
- focused `packages/compose-sandbox/test/compose.test.ts` cases

Finding:

`readinessMs` is checked only between awaited operations. Service inspection receives no signal or timeout, command probes receive no outer signal, retry sleep is not abort-aware, and `Promise.allSettled` can wait forever for non-cooperative probes. A command probe exceeding a 50 ms aggregate deadline was observed to complete after roughly 339 ms.

An exited service with no parsed exit code defaults to code 0 and is accepted as successfully completed.

Each service probe also runs a full `docker compose ps -a --format json` independently on every polling cycle, multiplying subprocess work when several service probes exist.

References:

- `packages/compose-sandbox/src/readiness.ts:32-51`
- `packages/compose-sandbox/src/readiness.ts:262-369`
- `packages/compose-sandbox/src/readiness.ts:394-539`
- `packages/compose-sandbox/src/compose.ts:245-285`
- `packages/compose-sandbox/test/readiness.test.ts:142-205`
- `packages/compose-sandbox/test/readiness.test.ts:477-516`

Implementation requirements:

1. Pass a signal and remaining deadline into every TCP, HTTP, service, and command probe boundary.
2. Clamp each attempt timeout and retry sleep to the aggregate remaining time; make sleep abort-aware.
3. Ensure the public/default dependencies cannot hold `waitForReadiness` past its hard aggregate bound. Clearly document expectations for injected non-cooperative fakes.
4. Require explicit parsed exit code 0 for `service-completed`; unknown or malformed exit status must not pass.
5. Preserve deterministic fatal-error selection and secret-safe unsatisfied diagnostics.
6. Investigate and, if behavior remains clear, share one Compose service snapshot per polling cycle rather than launching one ps process per service probe.

Acceptance criteria:

- Hanging command and service probes are canceled at `readinessMs` within a small real-time tolerance.
- Abort during retry sleep rejects immediately without another probe attempt.
- `probe.timeoutMs > readinessMs` is clamped to the aggregate deadline.
- Missing and malformed service exit codes do not pass; explicit and status-derived code 0 pass; nonzero codes fail immediately.
- A test with multiple service probes verifies the selected snapshot strategy and bounds Compose ps invocations.
- `pnpm --filter @repo-toolkit/compose-sandbox test` passes.

### Task CSREM-06: Make Diagnostics Secret-Safe, Structured, And Failure-Isolated

Status: completed

Completion evidence:

- Updated `packages/compose-sandbox/src/run.ts`: replaced `stripAnsi`/`sanitizeMessage`/`redactSecrets`/`emitLog`/`logGroup*` with centralized `collectSecrets` (test env + command env + sensitive http headers + URL username/password/query values, deduped longest-first), `redactString`, `sanitizeLogMessage` (redact → stripAnsi → CR/LF→space → other C0/DEL/ESC→space → workflow `::` escape → truncate 2000B), `safeEmit` (single best-effort boundary catching logger throws) and `redactManifestObject` (recursive structured redaction before JSON.stringify); removed `GITHUB_ACTIONS` grouping, updated all phase handlers to use `safeEmit`/`logGroup*` with `plan`, fixed manifest persistence to compute `finalOutcome`/`finalPhase`/`finalEvidenceFiles` after write (optimistic `result.json` included only on success, failure sets `finalOutcome=failure`, `finalPhase=evidence`, no `result.json` advertised, summary icon based on final outcome, thrown phase uses `finalPhase`), preserved bounded diagnostics and `shell:false`.
- Updated `packages/compose-sandbox/src/cli.ts`: added `collectSecretsForCli`/`redactStringForCli`/`sanitizeErrorForCli` (same secret sources longest-first + CR/LF/control/ANSI/workflow normalization + 2000B bound), updated `redactPlanForOutput` to also redact `test.args`, `command` probe `args`, `http` `url` and non-sensitive header values via `redactString`, updated `redactErrorMessage` to delegate to `sanitizeErrorForCli`.
- Added `packages/compose-sandbox/test/diagnostics-secret.test.ts` with 4 regression tests (all failing before fix): logger throwing on every call still runs exactly one `down` and preserves primary `exitCode 5` (before: `logger boom`), logs/manifests redact `1`, `success`, quotes, backslashes, newlines, overlapping values, auth header, URL user/pass/query (before: logs contained `success` and `http://myuser:mypass123...`, manifest string-replacement corrupted JSON), workflow/newline injection via `evil\n::error::...` no longer creates extra lines or `::` commands (before: log contained `\n::error::`), manifest-write failure via failing `fs.writeFile` changes outcome to failure, no `result.json` advertised, no `✅ success` summary (before: advertised `result.json` with `✅ success`).
- Verified before fix: `pnpm --filter @repo-toolkit/compose-sandbox test` 4 failing (logger replacement, secret leak, newline injection, result.json advertised); after fix: `pnpm --filter @repo-toolkit/compose-sandbox test` passes (15 files, 203 tests), `pnpm lint` passes, `pnpm typecheck` passes, no `Array.prototype.at`/`Object.hasOwn` violations, preserved CSREM-02/03/04/05 FS containment/checked compose/emergency contexts/hard readiness.

Priority: P0

Suggested agent: secure diagnostics engineer

Dependencies: CSREM-02, CSREM-03, CSREM-04

Primary ownership:

- logging, redaction, evidence, and manifest sections of `packages/compose-sandbox/src/run.ts`
- shared redaction support used by `packages/compose-sandbox/src/cli.ts`
- focused `packages/compose-sandbox/test/run.test.ts` and `test/cli.test.ts` cases

Finding:

Logger calls are unguarded and some group-start calls occur before phase try blocks. An injected logger that throws can replace the real failure and prevent cleanup. Lifecycle logs use only ANSI stripping and truncation, so configured environment values can appear in logs. Newlines and terminal controls are retained, enabling forged log lines and potentially CI workflow commands.

Manifest redaction mutates serialized JSON through raw string replacement. Common or short secrets can corrupt unrelated fields and numeric timings; escaped quotes, backslashes, or newlines may evade matching. Manifest state is computed before the final write, so a write failure can still emit a success summary and advertise `result.json`.

References:

- `packages/compose-sandbox/src/run.ts:79-135`
- `packages/compose-sandbox/src/run.ts:209-354`
- `packages/compose-sandbox/src/run.ts:603-657`
- `packages/compose-sandbox/src/cli.ts:38-78`
- `packages/compose-sandbox/src/cli.ts:138-157`
- `packages/compose-sandbox/test/run.test.ts:612-666`

Implementation requirements:

1. Make logging best-effort and non-throwing at one shared emission boundary. Logger failures must never alter lifecycle control flow.
2. Centralize plan-aware secret collection and longest-first redaction for CLI errors, runtime logs, manifest errors, URLs, arguments, and sensitive HTTP header values.
3. Normalize CR, LF, ANSI, other terminal controls, and GitHub workflow-command prefixes before diagnostic emission, or remove GitHub-specific grouping entirely per the maintainer decision.
4. Redact structured manifest fields before `JSON.stringify`; never mutate serialized JSON text.
5. Compute final outcome, phase, and evidence file list after manifest persistence. List `result.json` only when it exists.
6. Preserve bounded useful diagnostics without logging complete configured environment maps.

Acceptance criteria:

- A logger that throws on every call cannot prevent exactly one cleanup attempt or replace the primary error.
- Logs, CLI errors, and valid parseable manifests redact secrets including `1`, `success`, quotes, backslashes, newlines, overlapping values, authorization headers, and URL credentials/query secrets according to the documented policy.
- Logged values cannot create additional lines or emit a GitHub workflow command.
- A final manifest-write failure changes the final outcome to failure, does not advertise `result.json`, and never emits a success summary.
- `pnpm --filter @repo-toolkit/compose-sandbox test` passes.

### Task CSREM-07: Support Configurable Compose Executables And Prefix Arguments

Status: completed

Completion evidence:

- Updated `packages/compose-sandbox/src/plan.ts`: added `DEFAULT_COMPOSE_PREFIX_ARGS = ['compose']`, new `compose.prefixArgs` option and plan field, `COMPOSE_KEYS` now includes `prefixArgs`, implemented `validateComposePrefixArgs` requiring array of non-empty NUL-free strings (empty/non-string/NUL fail at plan resolution), default remains `{ executable: 'docker', prefixArgs: ['compose'] }`, standalone `{ executable: 'docker-compose', prefixArgs: [] }` validated distinct.
- Updated `packages/compose-sandbox/src/compose.ts`: `buildComposeArgs` now resolves `plan.compose.prefixArgs ?? ['compose']`, validates each entry strictly, constructs `args = [...prefixArgs, -f ..., --env-file ..., -p ..., --profile ..., subArgs, extraArgs]` with `shell:false` preserved via `runProcess`; every preflight (`version`), startup (`up -d`), ps (`ps -a --format json`), logs (`logs --no-color`), service-inspection (`getServiceSnapshot`/`getServiceState`), and down now share the same resolved prefix before operation args; no PATH search/symlink/PATH mutation/inference.
- Updated `packages/compose-sandbox/src/run.ts`: added `composeInvocation = [executable, ...prefixArgs].join(' ')` for structured dry-run and lifecycle logs (`dry-run cwd=... compose=...`, `starting ... compose=...`, `preflight ... version`, `start ... up -d`); preserves bounded diagnostics and `shell:false`.
- Updated `packages/compose-sandbox/README.md` and `website/docs/packages/compose-sandbox.md`: document default `docker compose` vs standalone `docker-compose` via `compose.executable`/`compose.prefixArgs`, wrapper example with exact argv prefix (`--context`, spaces, quotes) without shell splitting, dry-run log/JSON showing both forms, phases using `<compose>` placeholder, structured-commands section explicitly states `shell:false` exact argv and no inference, `prefixArgs` type in config reference.
- Added `packages/compose-sandbox/test/compose-prefix.test.ts` with 8 regression tests (all failing before fix): default plan produces `docker compose version/up/ps/logs/down` unchanged and identical across `preflightCompose`/`getServiceState`/`runCompose`; standalone `docker-compose` produces no `compose` token for all 5 subcommands; custom executable `/opt/my wrapper/docker` with multi-arg `['--context','my context with spaces','compose','--x="y z"']` passed as exact argv without shell parsing; empty/non-string/NUL and non-array prefixArgs fail at plan resolution; dry-run plan JSON shows both forms distinctly; every operation uses same prefix before `-f`/subcommand; dry-run logger output contains `docker compose` vs `docker-compose` without `docker-compose compose`; docs contain both forms and `prefixArgs`. Verified before fix 6 failing (Unknown prefixArgs, undefined vs ['compose'], NUL not rejected), after fix 16 files 211 tests passing.
- Verified `pnpm --filter @repo-toolkit/compose-sandbox test` passes (16 files, 211 tests), `pnpm lint` passes, `pnpm typecheck` passes, no `Array.prototype.at`/`Object.hasOwn` violations, preserved CSREM-01..06 signal/FS/checked-compose/emergency/readiness/diagnostics behavior.
- CLI: no new flags added; `compose.executable`/`prefixArgs` remain config-file-only as no concrete CLI use case exists, preserving narrow override principle.

Priority: P1

Priority: P1

Suggested agent: CLI and command-contract engineer

Dependencies: CSREM-03

Primary ownership:

- Compose command options and plan types in `packages/compose-sandbox/src/plan.ts`
- command construction in `packages/compose-sandbox/src/compose.ts`
- applicable CLI overrides in `packages/compose-sandbox/src/cli.ts`
- `packages/compose-sandbox/test/plan.test.ts`
- `packages/compose-sandbox/test/compose.test.ts`
- package and website configuration documentation

Finding:

`compose.executable` appears configurable, but `buildComposeArgs` always inserts the literal `compose` argument. Configuring an asdf-managed standalone binary such as `docker-compose` therefore produces `docker-compose compose ...`, which is invalid. The same limitation prevents wrappers or alternative executable locations from selecting their required fixed prefix while retaining shell-free invocation.

The required default remains Docker Compose v2 through `docker compose`. Flexibility is needed for version-managed project contexts where creating a `docker` CLI plugin symlink for every selected asdf version is impractical.

References:

- `packages/compose-sandbox/src/plan.ts:43-63`
- `packages/compose-sandbox/src/plan.ts:348-420`
- `packages/compose-sandbox/src/compose.ts:37-83`
- `packages/compose-sandbox/README.md:37-63`
- `docs/tasks/20260825-180040-compose-sandbox-runner.md:53-56`

Implementation requirements:

1. Model Compose invocation as a structured executable plus fixed prefix-argument array, without accepting shell source or a whitespace-split command string.
2. Preserve the zero-configuration default `{ executable: 'docker', prefixArgs: ['compose'] }` so existing configurations continue to invoke `docker compose`.
3. Support a standalone configuration equivalent to `{ executable: 'docker-compose', prefixArgs: [] }` and arbitrary executable paths or compatible wrappers with explicit fixed prefix arguments.
4. Choose and document the final option name, preferably `compose.prefixArgs`, and validate every entry as a non-empty NUL-free string.
5. Ensure every preflight, startup, ps, logs, service-inspection, and down call uses the same resolved invocation prefix before operation-specific arguments.
6. Keep `shell: false`; do not search for binaries, create symlinks, mutate `PATH`, or infer invocation style from executable names.
7. Add a narrowly scoped CLI override only if a concrete command-line use case exists; configuration-file support is required.

Acceptance criteria:

- The default resolved plan and command tests produce `docker compose version`, `docker compose up`, and other existing calls unchanged.
- A standalone configuration produces `docker-compose version`, `docker-compose up`, `docker-compose ps`, `docker-compose logs`, and `docker-compose down` with no inserted `compose` token.
- A custom executable and multi-argument prefix are passed as exact argv elements without shell parsing.
- Empty, non-string, and NUL-containing prefix arguments fail during side-effect-free plan resolution.
- Dry-run output and documentation show both the default plugin form and the asdf-managed standalone form.
- `pnpm --filter @repo-toolkit/compose-sandbox test` passes.

### Task CSREM-08: Align Library, CLI, And Public API Contracts

Status: completed

Completion evidence:

- Created `packages/compose-sandbox/src/config.ts`: exports `mergeComposeSandboxOptions` (shallow top-level plus one-level shallow merge for `compose` and `evidence`, other keys replace; documented) and `loadAndMergeComposeSandboxOptions` (side-effect-free, loads config via `loadConfigFile`, rejects `config` inside config file at both boundaries, then merges via `mergeComposeSandboxOptions` and resolves plan). Single function used by CLI and library.
- Updated `packages/compose-sandbox/src/run.ts`: removed inline `isPlainObject`/`loadConfigFile` shallow merge, now `await loadAndMergeComposeSandboxOptions(options)`; changed signature to `Promise<RunResult>` and returns `{ phase, outcome, timings, evidenceFiles, manifestPath }` on success (including `dryRun` synthetic `RunResult`); preserves primary `exitCode` on test failures for CLI mapping; re-exports `loadAndMergeComposeSandboxOptions`/`mergeComposeSandboxOptions`.
- Updated `packages/compose-sandbox/src/cli.ts`: removed hand-rolled `loadConfigFile` deep-merge, now builds `cliOverrides` via `buildOptions` then `await loadAndMergeComposeSandboxOptions({ ...cliOverrides, ...(configPath?{config:configPath}:{}) })`; added exported `getCliExitCode(error)` that returns `exitCode` (1–255) from error or `primary` of `ComposeSandboxLifecycleError`, otherwise `1` for validation/infra/signal/evidence/cleanup; `main()` and `main().catch` now set `process.exitCode = getCliExitCode(error)`; preserves compose `prefixArgs` invocation via unified plan.
- Updated `packages/compose-sandbox/src/index.ts`: reduced root surface to deliberate contracts — `resolveComposeSandboxPlan` + plan types, `runComposeSandbox`/`RunDeps`/`RunResult`/`Logger`, `ComposeSandboxLifecycleError`/`LifecyclePhase`, `loadAndMergeComposeSandboxOptions`/`mergeComposeSandboxOptions`; removed `runProcess`/`isProcessSuccess`/`runLifecycle`/`buildComposeArgs`/`waitForReadiness` etc from root (still importable via package-internal paths for tests); `tsup` build now emits `dist/index.d.ts` with `Promise<RunResult>`.
- Updated `packages/compose-sandbox/README.md`: documented supported export list and merge semantics (`compose`/`evidence` shallow-merged, others replace, `config` recursion rejected, test exit codes 1–255 preserved).
- Updated `packages/compose-sandbox/test/index.test.ts`: scaffold test now asserts reduced export set (`resolveComposeSandboxPlan`, `runComposeSandbox`, `ComposeSandboxLifecycleError`, `loadAndMerge*`) and that low-level names are absent.
- Updated `packages/compose-sandbox/test/fs-containment.test.ts`: `typed ENOENT is idempotent` now expects `RunResult` with `outcome:'success'` instead of `undefined` to match new `Promise<RunResult>` contract.
- Added `packages/compose-sandbox/test/csrem08-regression.test.ts` with 7 regression tests (all failing before fix): equivalent config+overrides same plan via CLI/library, nested compose/evidence overrides preserve unrelated keys, config-inside-config rejected at both boundaries, CLI preserves exitCode 5/7 via `getCliExitCode` while proving cleanup `down` still called, `RunResult` vs `Promise<void>` mismatch fixed (dts check + runtime `RunResult` on success), supported export list contract (`README` + `dist/index.js` keys), built `dist` runtime import and `dist/index.d.ts`/`dist/cli.js --help` declaration consumer, and built CLI integration via fake docker shim (`node shim.js` as `compose.executable`+`prefixArgs`) proving exit code 42 preserved while `down` marker written and `result.json` present.
- Verified before fix: 6 failures (shallow vs deep merge, config-inside-config accepted by library, exitCode always 1, `Promise<void>` vs `RunResult`, export surface included `runProcess` etc, declaration consumer `tsc` error); after fix: `pnpm --filter @repo-toolkit/compose-sandbox test` passes (17 files, 218 tests), `pnpm --filter @repo-toolkit/publish-packages test` passes (3 files, 78 tests), `pnpm lint` passes, `pnpm typecheck` passes, no `Array.prototype.at`/`Object.hasOwn` violations; preserved CSREM-07 `prefixArgs`/`shell:false`/FS containment/logging.

Priority: P1

Suggested agent: TypeScript library API engineer

Dependencies: CSREM-01 through CSREM-07

Primary ownership:

- `packages/compose-sandbox/src/index.ts`
- option loading/merging in `packages/compose-sandbox/src/run.ts` and `src/cli.ts`
- `packages/compose-sandbox/test/index.test.ts`
- `packages/compose-sandbox/test/cli.test.ts`
- built declaration consumer tests

Finding:

The library shallow-merges loaded config and overrides, while the CLI deep-merges `compose` and `evidence`; equivalent input can resolve to different plans. The CLI rejects a nested `config` key but the library accepts and ignores it. All CLI runtime errors exit 1 despite the planned requirement to preserve test exit status.

`RunResult` is exported but `runComposeSandbox` returns `Promise<void>`. The package root also exports low-level process, lifecycle, Compose, readiness, dependency, and error internals even though the planned public API named only plan resolution and execution. This creates a large semver and support surface before release.

References:

- `packages/compose-sandbox/src/run.ts:61-67`
- `packages/compose-sandbox/src/run.ts:137-149`
- `packages/compose-sandbox/src/cli.ts:103-135`
- `packages/compose-sandbox/src/cli.ts:167-182`
- `packages/compose-sandbox/src/index.ts:1-78`
- `packages/compose-sandbox/README.md:136-156`
- `docs/tasks/20260825-180040-compose-sandbox-runner.md:116-121`
- `docs/tasks/20260825-180040-compose-sandbox-runner.md:343-357`

Implementation requirements:

1. Create one side-effect-free load-and-merge function used by CLI and library execution, with documented nested merge or replace semantics.
2. Reject config recursion consistently at both boundaries.
3. Preserve valid test process exit codes at the CLI boundary; use 1 for validation, infrastructure, signal, evidence, and cleanup failures unless a more specific documented code is chosen.
4. Resolve the `RunResult` mismatch by either returning a documented result or removing the unused exported type.
5. Reduce the root export surface to deliberate supported contracts. Use package-internal modules or explicit subpath exports only when a concrete consumer needs low-level APIs.
6. Add declaration-level consumer tests against built output so runtime, types, README examples, and exports stay aligned.

Acceptance criteria:

- Equivalent config plus overrides produce the same plan through CLI and library paths.
- Nested compose/evidence overrides and config-inside-config behavior have regression coverage.
- Built CLI integration tests preserve representative test exit codes while still proving cleanup occurred.
- `RunResult` and `runComposeSandbox` declarations no longer contradict each other.
- The supported export list is documented and protected by a contract test.
- `pnpm --filter @repo-toolkit/compose-sandbox test` and `pnpm --filter @repo-toolkit/publish-packages test` pass.

### Task CSREM-09: Simplify Orchestration And Validation After Behavior Stabilizes

Status: completed

Completion evidence:

- Initial required baseline `pnpm --filter @repo-toolkit/compose-sandbox test` failed before CSREM-09 edits completed because prior extraction had left `run.ts` referencing unimported moved helpers (`logGroupStart`/`logGroupFail`/`logGroupEnd`, `stripAnsi`, `truncateToBytes`, `isEnoent`). The refactor resolved this by using the extracted services rather than restoring duplicate inline logic.
- Updated `packages/compose-sandbox/src/run.ts`: lifecycle handlers now use `runPhase` for shared timing/logging/error preservation, evidence capture routes through `collectEvidence`, cleanup routes through `performCleanup`, and the `getServiceSnapshot` dependency adapter no longer uses an unsafe cast. This reduced orchestration duplication while preserving primary/secondary error behavior, manifest handling, service snapshot optimization, shell-free Compose invocation, and public API from CSREM-08.
- Updated `packages/compose-sandbox/src/evidence.ts` and `src/cleanup.ts`: dependency contracts now use explicit composable runner/clock plus phase-specific filesystem interfaces instead of unsafely extending `ComposeDeps` with incompatible `fs` capabilities; Compose calls receive only the runner/clock subset they require. Evidence setup failures throw through the phase boundary instead of resolving an `Error` value.
- Updated `packages/compose-sandbox/src/phase.ts`: phase names are typed as `LifecyclePhase` so failed-phase tracking does not widen to arbitrary strings.
- Updated `packages/compose-sandbox/src/readiness.ts`: removed the remaining `as never` bridge for default service-state dependencies. The CSREM-05 service snapshot optimization remains covered by `packages/compose-sandbox/test/readiness-hard.test.ts` (`multiple service probes bounds ps invocations via snapshot`, expected 8-20 snapshot calls instead of per-service multiplication).
- Updated `packages/compose-sandbox/src/plan.ts`: removed an unused validation helper and retained existing documented/tested HTTP two-element array range semantics. No maintainer decision was present for changing the ambiguous public `expectedStatus` contract, so the ambiguity is deferred: `[200, 204]` still means inclusive range rather than two discrete statuses; residual risk is accidental consumer confusion until maintainers choose between retaining this behavior, requiring explicit `{ min, max }`, or adding a discrete-status option.
- Added `packages/compose-sandbox/test/internal-services.test.ts`: focused tests exercise `runPhase`, `collectEvidence`, and `performCleanup` independently without invoking the full lifecycle.
- Verified commands: initial `pnpm --filter @repo-toolkit/compose-sandbox test` failed as noted above; after refactor `pnpm --filter @repo-toolkit/compose-sandbox test` passes (18 files, 221 tests); `pnpm lint` passes; `pnpm typecheck` passes; final `pnpm --filter @repo-toolkit/compose-sandbox test` passes (18 files, 221 tests).

Priority: P2

Suggested agent: maintainability and performance engineer

Dependencies: CSREM-05, CSREM-06, CSREM-08

Primary ownership:

- `packages/compose-sandbox/src/run.ts`
- `packages/compose-sandbox/src/plan.ts`
- shared internal clock/output/path helpers under `packages/compose-sandbox/src/`
- focused unit tests

Finding:

`runComposeSandbox` is approximately 530 lines of orchestration inside a 667-line module, with repeated phase timing, logging, and failure wrappers. Clock interfaces and default implementations are duplicated across process, lifecycle, Compose, readiness, and run modules. `plan.ts` is 964 lines and repeats object, key, string, path, and bounded-number validation.

HTTP `expectedStatus` also has an ambiguous contract: any two-element array is treated as an inclusive range, so `[200, 204]` cannot mean two discrete statuses.

References:

- `packages/compose-sandbox/src/run.ts:69-77`
- `packages/compose-sandbox/src/run.ts:137-667`
- `packages/compose-sandbox/src/plan.ts:291-329`
- `packages/compose-sandbox/src/plan.ts:348-708`
- `packages/compose-sandbox/src/plan.ts:766-797`
- `packages/compose-sandbox/src/readiness.ts:114-128`

Implementation requirements:

1. Refactor only after prior regression tests pass; do not mix contract changes with mechanical extraction.
2. Extract a small internal phase executor for timing/logging/error preservation, and separate evidence and cleanup services where this materially reduces shared state.
3. Consolidate scheduler/clock, process-success, byte-truncation, path-safety, and redaction helpers where multiple modules now require identical semantics.
4. Replace unsafe casts between dependency interfaces with explicit composable interfaces.
5. Reduce plan-validation duplication with small schema-oriented helpers while preserving exact error quality and ES2018 compatibility.
6. Implement the maintainer-approved HTTP status model and provide release notes if it changes the external config contract.
7. Measure service-probe subprocess counts before and after CSREM-05; retain optimizations only with observable improvement and no diagnostic regression.

Acceptance criteria:

- No public behavior changes beyond explicitly approved contract decisions.
- Focused tests prove extracted phase/evidence/cleanup services independently without invoking the full lifecycle.
- Duplicate clock and output-bound implementations are removed or justified by distinct contracts.
- Service readiness with multiple service probes performs a bounded, documented number of Compose ps calls.
- `pnpm lint`, `pnpm typecheck`, and `pnpm --filter @repo-toolkit/compose-sandbox test` pass.

### Task CSREM-10: Align Documentation And Require Real Docker Verification

Status: completed

Completion evidence:

- Updated `packages/compose-sandbox/test/real-compose.test.ts`: Docker Compose availability is checked once at suite definition; when unavailable locally, real tests are `it.skip` with an explicit reason in the test name; when `COMPOSE_SANDBOX_REQUIRE_DOCKER=1` is set, Docker unavailability throws and fails instead of skipping.
- Expanded real Docker fixtures from 2 to 5 tests with unique Compose project names: success/evidence/cleanup-path removal, forced test failure with evidence, test timeout with process-tree marker check and managed-path cleanup, injected `SIGTERM` cleanup with listener removal and failure manifest, and symlinked cleanup path boundary preserving an outside sentinel.
- Added `assertFinallyClean` leak checks in `finally`: checks labeled containers through `docker compose -p <project> ps`, labeled networks, labeled volumes, and managed directories before emergency `docker compose down --volumes --remove-orphans` and temp-root removal. Leak-check failures are thrown independently of fixture assertions.
- Wired required real Docker mode in workflows: `.github/workflows/test.yml` runs `pnpm test` with `COMPOSE_SANDBOX_REQUIRE_DOCKER=1`; `.github/workflows/release.yml` runs `pnpm --filter @repo-toolkit/compose-sandbox test` with the same env before artifact verification.
- Updated `packages/compose-sandbox/README.md` and `website/docs/packages/compose-sandbox.md`: documented required-mode env var, real Docker fixture coverage, exact dependency-injection keys (`createAbortController`, `getServiceSnapshot`, `runCommandProbe`, `logger`), `RunResult`/throw behavior, runtime path re-checks and residual filesystem race, Node `PATH` behavior for bare executables, and that captured `logs.txt` is bounded/ANSI-stripped but not secret-scanned.
- Appended a dated CSREM-10 remediation note to `docs/tasks/20260825-180040-compose-sandbox-runner.md` instead of rewriting historical CSBOX-07 evidence.
- Verification: `pnpm --filter @repo-toolkit/compose-sandbox test` passes (18 files, 224 tests) with Docker available; `pnpm --filter @repo-toolkit/publish-packages test` passes (3 files, 78 tests); `pnpm lint` passes; `pnpm typecheck` passes; `COMPOSE_SANDBOX_REQUIRE_DOCKER=1 pnpm --filter @repo-toolkit/compose-sandbox test` passes (18 files, 224 tests).

Priority: P1

Suggested agent: integration and documentation engineer

Dependencies: CSREM-08, CSREM-09

Primary ownership:

- `packages/compose-sandbox/README.md`
- `website/docs/packages/compose-sandbox.md`
- `packages/compose-sandbox/test/real-compose.test.ts`
- relevant CI workflow files
- completion notes in the related and current task documents

Finding:

Real-Compose tests return early when Docker is unavailable, so Vitest counts them as passed. The previous final review recorded Docker as unavailable while still marking all acceptance criteria complete. Documentation claims descendant process-group termination and runtime log redaction that the reviewed implementation does not provide. It also contains lifecycle/API mismatches and states GitHub environment-variable independence while current `run.ts` reads `GITHUB_ACTIONS`.

References:

- `packages/compose-sandbox/test/real-compose.test.ts:69-74`
- `packages/compose-sandbox/test/real-compose.test.ts:128-132`
- `packages/compose-sandbox/README.md:3-10`
- `packages/compose-sandbox/README.md:104-115`
- `packages/compose-sandbox/README.md:155-160`
- `docs/tasks/20260825-180040-compose-sandbox-runner.md:479-529`

Implementation requirements:

1. Report Docker-unavailable tests as explicit skips for local development.
2. Add a CI/release-required mode that fails, rather than skips, when Docker Compose is unavailable.
3. Run success, forced test failure, signal/timeout cleanup, evidence, and path-boundary fixtures with unique Compose project names.
4. Verify no labeled container, network, volume, child process, or managed directory remains after each fixture.
5. Update package and website docs to match actual lifecycle, signal, timeout, redaction, path, dependency injection, return, and export contracts.
6. Correct stale completion evidence in the related task with a linked remediation note rather than rewriting history.

Acceptance criteria:

- Local Docker absence appears as an explicit skipped test with a reason.
- The required CI lane fails when Docker is unavailable and passes both success and forced-failure fixtures when available.
- Leak checks run in `finally` and fail independently of the primary fixture result.
- README and website examples compile or resolve through consumer-shaped tests.
- Documentation no longer claims behavior not demonstrated by tests.
- `pnpm --filter @repo-toolkit/compose-sandbox test` and `pnpm --filter @repo-toolkit/publish-packages test` pass.

### Task CSREM-11: Perform Independent Security And Release Review

Status: completed

Completion evidence:

- Initial worktree check: `git status --short` showed existing modified compose-sandbox, workflow, docs files plus untracked CSREM task/support files; all existing changes were preserved and `CHANGELOG.md` was not edited.
- Reviewed the full current task file, all CSREM-01 through CSREM-10 completion evidence, and `docs/tasks/20260825-180040-compose-sandbox-runner.md` remediation note. Independently inspected implementation and tests for process outcomes, runtime filesystem containment, checked Compose operations, emergency cancellation contexts, hard readiness deadlines, secret-safe diagnostics, configurable Compose prefixes, API/CLI contract, orchestration extraction, documentation, and real Docker required mode.
- Finding fixed during review: `runComposeSandbox` treated the test process as successful using `exitCode !== 0` only. Added `packages/compose-sandbox/test/run.test.ts` regression `signaled test result cannot be reported as success` and updated `packages/compose-sandbox/src/run.ts` to use `isProcessSuccess` for test results, so signaled/timedOut/nonzero outcomes cannot be successful even under direct library dependency injection.
- Targeted regression verification: `pnpm --filter @repo-toolkit/compose-sandbox test` passed after the fix: 18 files, 225 tests.
- Required Docker verification: `docker compose version` returned `Docker Compose version v5.4.0`; `COMPOSE_SANDBOX_REQUIRE_DOCKER=1 pnpm --filter @repo-toolkit/compose-sandbox test` passed: 18 files, 225 tests. This verifies required real-Compose success, forced-failure, timeout/process-tree cleanup, SIGTERM cleanup, symlink path-boundary, and leak-check fixtures with Docker available.
- Workspace verification: `pnpm lint` passed; `pnpm typecheck` passed; `pnpm build` passed for all workspace packages; `pnpm test` passed serially with workspace concurrency 1, including compose-sandbox 18 files/225 tests and publish-packages 3 files/78 tests; `pnpm --filter @repo-toolkit/publish-packages test` passed independently: 3 files, 78 tests.
- Diff/package hygiene: `git diff --check` passed with no output; `git ls-files "packages/*/dist"` returned no tracked generated dist files.
- Packed-artifact consumer verification: packed `@repo-toolkit/publish-package` and `@repo-toolkit/compose-sandbox` to `/tmp/opencode`. A temp consumer installed the compose-sandbox tarball with a local `pnpm-workspace.yaml` override for the sibling placeholder dependency, imported documented APIs (`resolveComposeSandboxPlan`, `runComposeSandbox`, `ComposeSandboxLifecycleError`, `loadAndMergeComposeSandboxOptions`, `mergeComposeSandboxOptions`), executed `repo-toolkit-compose-sandbox --help`, and executed `repo-toolkit-compose-sandbox --config <config> --dry-run`; dry-run output redacted `test.env.SECRET` as `[REDACTED]`.
- Acceptance mapping reviewed: CSREM-01 process/signal/timeout/tree/UTF-8/stdout contracts covered by `process.test.ts`; CSREM-02 real-root containment, nested symlink ancestors, metadata errors, typed FS contract covered by `fs-containment.test.ts`; CSREM-03 checked Compose version/up/ps/logs/down nonzero/signal/timeout covered by `compose-checked.test.ts`; CSREM-04 SIGINT/SIGTERM/timeout emergency contexts and repeated invocation covered by `emergency-cleanup.test.ts`; CSREM-05 hard readiness budgets/service completion/snapshot optimization covered by `readiness-hard.test.ts`; CSREM-06 CLI/logger/manifest/control-character redaction boundaries covered by `diagnostics-secret.test.ts`; CSREM-07 default/standalone/wrapper prefix argv and docs covered by `compose-prefix.test.ts`; CSREM-08 declarations/exports/CLI/library merge/exit codes covered by `csrem08-regression.test.ts`; CSREM-09 extracted phase/evidence/cleanup services covered by `internal-services.test.ts`; CSREM-10 required real-Docker fixtures covered by `real-compose.test.ts` in required mode.
- Residual/deferred work: raw `pnpm pack` tarballs before release still contain placeholder internal dependency metadata, so local consumer installation required a sibling-tarball override. Maintainer decision/rationale: publish/release flow intentionally rewrites placeholders and `workspace:*` dependencies via `@repo-toolkit/publish-packages`; no package-local compatibility shim added before release. Owner: release maintainer. Risk: low for actual published packages because `publish-packages` contract tests pass, but raw pre-release tarballs are not standalone-installable without overrides.
- Residual/deferred work: stronger race-resistant filesystem operations using directory handles/openat remains deferred. Maintainer decision/rationale: current portable check-then-use runtime realpath ancestor validation closes the confirmed symlink-ancestor escapes and documents TOCTOU risk; platform-specific hardening needs separate design. Owner: future filesystem hardening task. Risk: low for trusted repository workspaces, higher if an untrusted concurrent local actor can mutate managed paths during operation.
- Residual/deferred work: HTTP `expectedStatus` two-element arrays remain inclusive ranges. Maintainer decision/rationale: no approved contract change during CSREM-09; changing before release could surprise existing examples/tests. Owner: maintainer API decision. Risk: low-to-medium consumer confusion until an explicit status model is chosen.

Priority: P0

Suggested agent: independent reviewer not assigned to CSREM-01 through CSREM-10

Dependencies: CSREM-10

Primary ownership:

- review-only across `packages/compose-sandbox`, package documentation, and CI integration
- fixes limited to findings discovered during review
- completion evidence in this task document

Finding:

The confirmed defects cross process, filesystem, lifecycle, diagnostics, public API, and real-Docker boundaries. Unit tests and the previous completion review did not expose them, so an independent reviewer must verify runtime behavior rather than infer correctness from green mocks.

References:

- all CSREM tasks and acceptance criteria
- `docs/tasks/20260825-180040-compose-sandbox-runner.md:479-529`

Implementation requirements:

1. Reproduce or inspect a regression test for every confirmed finding before accepting its fix.
2. Verify alternate entry paths: direct library use, CLI use, timeout, `SIGINT`, `SIGTERM`, startup failure, readiness failure, test failure, evidence failure, cleanup failure, and repeated invocation.
3. Verify every managed filesystem operation remains inside the real project root under nested symlink ancestors and metadata errors.
4. Verify configured secrets and control characters do not cross CLI, logger, manifest, or evidence boundaries unexpectedly.
5. Verify public declarations, exports, README, website docs, CLI help, and runtime behavior agree.
6. Run targeted, package, workspace, packed-artifact, and Docker-required checks serially where shared resources can conflict.

Acceptance criteria:

- Every CSREM acceptance criterion has recorded runtime or test evidence.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm test` pass.
- `pnpm --filter @repo-toolkit/publish-packages test` passes.
- A packed package consumer can import the documented API and execute CLI help/dry-run.
- Required real-Compose success/failure/signal fixtures pass with no leaked resources.
- `git diff --check` passes and no generated `dist/` file is tracked.
- Deferred work records a maintainer decision, rationale, owner, and residual risk.

## Dependency And Parallelization Guidance

| Wave | Tasks                        | Parallelism                                                                                                  |
| ---- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1    | CSREM-01, CSREM-02           | Parallel; process and filesystem primary ownership are separate, but coordinate public types.                |
| 2    | CSREM-03, CSREM-04           | Sequential; CSREM-04 depends on checked process/Compose cancellation semantics.                              |
| 3    | CSREM-05, CSREM-06           | Parallel after CSREM-04; partition `run.ts` ownership and avoid concurrent edits there.                      |
| 4    | CSREM-07, CSREM-08           | Sequential; settle Compose invocation before finalizing the public contract.                                 |
| 5    | CSREM-09, CSREM-10, CSREM-11 | Sequential; refactor after contracts stabilize, then produce integration evidence before independent review. |

`packages/compose-sandbox/src/run.ts` is the main shared hotspot. CSREM-02, CSREM-03, CSREM-04, CSREM-06, CSREM-08, and CSREM-09 must not edit it concurrently. Assign a single integration owner or serialize those changes. CSREM-07 shares `plan.ts`, `compose.ts`, and documentation with later tasks and must finish before CSREM-08.

`packages/compose-sandbox/src/index.ts`, `package.json`, root workspace metadata, `pnpm-lock.yaml`, README files, and CI workflow files are also shared hotspots. Docker tests must use generated project names and must not run concurrently when they share fixed host ports.

## Maintainer Decisions

These decisions do not block CSREM-01 through CSREM-07. Record answers before CSREM-08 or CSREM-09 starts.

1. Public exports: keep only `resolveComposeSandboxPlan` and `runComposeSandbox` at the root, or support low-level process/lifecycle/Compose/readiness APIs as stable contracts?
2. Run result: return the existing `RunResult` on success, define failure result access, or remove the unused type?
3. GitHub behavior: remove automatic `GITHUB_ACTIONS` grouping to preserve platform independence, or document and secure it as supported behavior?
4. HTTP statuses: retain the ambiguous two-element array range, introduce an explicit `{ min, max }` range, or add a discrete `expectedStatuses` option?
5. Process trees on Windows: document best-effort direct-child termination, use a platform facility, or scope the process-tree guarantee to POSIX?
6. Evidence timeout: add a separate public `evidenceMs` setting or bound evidence by `cleanupMs`/remaining `totalMs` without expanding configuration?

## Deferred Improvements

- A cross-package process/scheduler package remains deferred until another toolkit package needs the same asynchronous process-tree behavior.
- Stronger race-resistant filesystem operations using platform-specific directory handles may be investigated after the confirmed ancestor-symlink escapes are closed. Record the remaining TOCTOU risk.
- YAML, automatic legacy-command detection, consumer migrations, and service-specific readiness remain outside this remediation.

## Definition Of Done

- CSREM-01 through CSREM-11 are completed with command output or test-count evidence.
- Signal, timeout, and nonzero process outcomes cannot be reported as successful.
- Evidence and cleanup run with usable bounded cancellation contexts and preserve the primary failure.
- Prepare, evidence, and cleanup operations reject nested symlink escapes and fail closed on unverifiable metadata.
- Logs and manifests remain valid, bounded, control-safe, and free of configured secrets.
- Readiness obeys hard aggregate deadlines and requires explicit successful service completion.
- Compose invocation defaults to `docker compose` and supports explicitly configured standalone or wrapped binaries without shell parsing or symlink management.
- CLI, library, declarations, exports, and documentation expose one coherent contract.
- Real Docker Compose verification is required in release CI and proves no resource leaks.
- Refactoring leaves smaller independently testable orchestration components without broadening the public API accidentally.
