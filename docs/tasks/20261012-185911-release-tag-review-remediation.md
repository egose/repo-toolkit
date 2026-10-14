# Release Tag Review And Remediation

Created: 2026-10-12 18:59:11 (local timestamp)

Status: complete; RTR-01 through RTR-09 all completed with V-final green (coordinator final review passed; root CHANGELOG.md untouched)

## Objective And Product Requirements

Make `@repo-toolkit/release-tag` a dependable release-workflow coordinator for maintainers and CI: determine a stable version, prepare a release branch from the intended source, run an explicit release executable, and create/maintain the corresponding GitHub release-candidate PR. Successful automation must preserve repository work, identify what was actually released/merged, support recovery after partial failures, and provide bounded, secret-safe machine-readable output.

This is a new review phase following the completed implementation plan, [release-tag package](20261009-091644-release-tag-package.md). Its historical action-parity contracts explain several findings; the intentional contract corrections below supersede those portions of the original plan.

Scope: `packages/release-tag`, its package/website guides, focused release-workflow documentation, and this execution record. Reuse `@repo-toolkit/publish-package` types/helpers, but keep package-specific process and GitHub policies encapsulated in `release-tag`.

Non-goals: publishing or pushing this checkout; changing root `CHANGELOG.md`; importing signing keys; adding runtime dependencies; redesigning other packages; live GitHub/GHES or production credential tests; prerelease channels, arbitrary tag prefixes, or per-package monorepo versioning.

## Analysis Coverage And Baseline

- Inspected all ten release-tag source modules, all nine test files, package/build/test metadata, shared runner/version helpers, the Docker runner precedent, package README and website guide, `docs/release-tag-dispatch.md`, `.release-it.json`, and `.github/workflows/release-tag-changelog.yml`.
- Inspected the completed release-tag task file and searched existing task references. These are new post-implementation findings, not duplicate unfinished scaffold tasks.
- Initial `git status --short`: clean. Existing ignored checkout files are not review fixtures and must not be changed.
- Baseline actually run from `<repo-root>`: `TMPDIR=<repo-root>/_tmp-release-tag-review pnpm --filter @repo-toolkit/release-tag test`; **9 files / 218 tests passed** (including dependency builds).
- Safe built-library probes with injected runners/fetch confirmed: `releaseBranch: '--mirror'` is accepted; `releaseBranch === baseBranch === 'main'` emits `push origin --delete main`; directly invoking an unselected release stage performs eight captures; HTTP 200 `{ merged: false }` reports merged and deletes the branch; inspecting a wrapped network error exposes its raw token-bearing cause; library plan resolution ignores `GITHUB_API_URL`; invalid stage prefixes succeed in dry-run.
- Full workspace checks and packed-consumer verification were not run during analysis; RTR-09 owns them. No live network or real repository release was attempted. Memory/timeout concerns below follow inspected buffering code; no performance improvement is claimed without the bounded-stream/process tests required below.

## Working Rules, Priorities, And Verification

- Follow `AGENTS.md`, strict ES2018-compatible TypeScript, explicit argument arrays, shared `parseFlags`, no new code comments, and no commits.
- **Never modify root `CHANGELOG.md`.** Record externally visible changes in `docs/release-tag-review-notes.md` and the guides instead.
- Work only inside this repository. Scratch directories and real-Git fixture repositories must be beneath ignored `_tmp-release-tag-review/`; set `TMPDIR=<repo-root>/_tmp-release-tag-review` for tests/builds. Use repo-relative paths or `<repo-root>` in this file, never machine-specific absolute paths.
- Run **one fresh sub-agent per task, strictly sequentially** in the table below. Do not spawn nested agents or run builds concurrently. Preserve predecessors' changes. Each agent sets its task `in_progress` and only marks it `completed` after its required verification passes, appending `Completion evidence` with changed paths, commands, results, and any follow-up IDs.
- Shared hotspots (`plan.ts`, `index.ts`, `run.ts`, stage test fixtures) are intentionally sequenced. Extend existing seams rather than introducing cross-package frameworks. Tests should assert behavior and invariants rather than just reproduce command implementation.
- P1: confirmed release-integrity, confidentiality, or resource-control defect; address before release use. P2: concrete usability/business capability or maintainability improvement; finish before this objective is complete.
- **V-task** (repository root, after each implementation task): `pnpm lint`, `pnpm typecheck`, and `TMPDIR=<repo-root>/_tmp-release-tag-review pnpm --filter @repo-toolkit/release-tag test`. Use focused Vitest runs during development if useful, but final task evidence must include these checks.
- **V-docs** (repository root): `TMPDIR=<repo-root>/_tmp-release-tag-review pnpm --filter @repo-toolkit/publish-packages test` for documentation membership/contracts. Website is a separate project; run any site commands with `website/` as working directory, never install it from the workspace root.
- **V-final** (repository root, serial builds): `pnpm lint`, `pnpm typecheck`, `TMPDIR=<repo-root>/_tmp-release-tag-review pnpm build`, `TMPDIR=<repo-root>/_tmp-release-tag-review pnpm test`, `git diff --check`, plus RTR-09's offline packed ESM/types/bin smoke. Full `pnpm test` satisfies package and publish-packages checks for the final state.

## Sequential Agent Allocation

| Order | Task   | Isolated agent role            | Dependencies |
| ----- | ------ | ------------------------------ | ------------ |
| 1     | RTR-01 | ref-and-payload-validation     | none         |
| 2     | RTR-02 | safe-release-lifecycle         | RTR-01       |
| 3     | RTR-03 | bounded-process-execution      | RTR-02       |
| 4     | RTR-04 | credential-and-http-boundaries | RTR-03       |
| 5     | RTR-05 | recoverable-pr-lifecycle       | RTR-04       |
| 6     | RTR-06 | conventional-version-policy    | RTR-05       |
| 7     | RTR-07 | recovery-cli-and-composition   | RTR-06       |
| 8     | RTR-08 | user-guides-and-migration      | RTR-07       |
| 9     | RTR-09 | independent-integration-review | RTR-08       |

## Executable Tasks

### Task RTR-01: Validate Git Refs And Stage Payloads At Shared Boundaries

Status: completed

Kind: defect

Priority: P1 — malformed or aliased refs can reach destructive Git/API operations.

Suggested agent: ref-and-payload-validation

Dependencies: none

Primary ownership: `packages/release-tag/src/plan.ts`, a focused validation module, `src/release.ts`, `src/pull-request.ts`, and related validation tests.

Finding: release branches reject only whitespace/NUL/HEAD; base branches have a different partial guard; downstream determined/release objects are checked only for nonempty strings. A base-equivalent release branch can be deleted, option-shaped refs are accepted, and public stage calls can bypass plan-time checks. Version regexes accept unsafe integer components, although shared `bumpVersion` uses JavaScript numbers.

References: `src/plan.ts` (`resolveTag`, `resolveReleaseBranch`, `resolveGithubRepository`); `src/release.ts` (`resolveReleaseBranchName`, `assertBranchGuard`, `assertDetermined`, branch-reset calls); `src/pull-request.ts` (`assertDetermined`, `assertRelease`, `encodeBranchRef`); `packages/publish-package/src/version.ts` (`parseSemverCore`, `bumpVersion`). Paths without a package prefix in task references are relative to `packages/release-tag/`.

Requirements:

1. Introduce shared pure validation for short Git branch names: reject leading options, full `refs/*` aliases, invalid Git ref syntax/control characters, dot/path traversal components, and HEAD. Preserve ordinary nested and Unicode branch names. Validate explicit, environment-derived, generated, and direct-stage values before side effects.
2. Reject equal base/release branches. Respect `GITHUB_REF_TYPE=tag`/`GITHUB_REF=refs/tags/*` when inferring the base; retain actionable tag/detached-HEAD guidance.
3. Validate stable numeric version components within the safe-integer range and require `determined.tagVersion === 'v' + determined.version`; validate a supplied plan tag against the determined version. Consolidate overlapping stage validators.
4. Validate owner/repo components at both explicit and environment boundaries, rejecting dot segments/control/path-routing shapes rather than relying only on `split('/')`.

Acceptance criteria:

- Regression cases for `--mirror`, `-D`, `main:other`, `refs/heads/main`, `a/../b`, `a.lock`, `a@{b`, base/release equality, mismatched versions, and unsafe numeric components fail before mutation or fetch through both orchestration and direct-stage paths.
- Valid nested refs remain usable; dry-run uses pure validation without spawning processes; existing manual `v1.2.3` normalization remains valid.
- Tests/doc contract notes clearly identify the stricter validation rather than retaining unsafe aliases.

Verification: V-task.

Completion evidence:

- Changed: `packages/release-tag/src/validation.ts`, `packages/release-tag/src/plan.ts`, `packages/release-tag/src/release.ts`, and `packages/release-tag/src/pull-request.ts` centralize pure short-ref, distinct-branch, safe-integer stable-version, owner/repo, and stage-payload validation. Supplied plan/determined identities and PR payload refs must agree; nested/Unicode refs and manual `v1.2.3` normalization remain supported.
- Additional owned boundary wiring: `packages/release-tag/src/determine.ts` validates manual/latest-tag components and single-line tag output; `packages/release-tag/src/github.ts` shares owner/repo parsing; `packages/release-tag/src/preflight.ts` validates known identities before I/O; `packages/release-tag/src/run.ts` validates environment inputs in dry-run and resolves/validates generated and Git-inferred release refs before preflight, reusing that identity downstream.
- Regression coverage: `packages/release-tag/test/validation.test.ts`, `packages/release-tag/test/plan.test.ts`, `packages/release-tag/test/determine.test.ts`, `packages/release-tag/test/release.test.ts`, and `packages/release-tag/test/cli.test.ts`. Injected transports assert rejection before mutation/fetch across explicit, environment, generated, direct-stage, and dry-run paths. Spawned CLI tests cover dangerous equals-form flags; read-only Git checks independently confirm valid nested/Unicode syntax. Tests that accepted whitespace trimming or extra ref-output lines now require rejection.
- Contract notes: `packages/release-tag/README.md` and `docs/release-tag-review-notes.md` document stricter refs/repositories, tag-checkout inference, exact payload identity, and numeric limits.
- Verified from repository root: `TMPDIR="$PWD/_tmp-release-tag-review" pnpm lint`; `TMPDIR="$PWD/_tmp-release-tag-review" pnpm typecheck`; `TMPDIR="$PWD/_tmp-release-tag-review" pnpm --filter @repo-toolkit/release-tag test`. All passed; **10 files / 354 tests passed** (including dependency builds; baseline 218 tests). Fixtures stayed under `_tmp-release-tag-review/`.
- Follow-up: RTR-06 owns automatic bump overflow policy and validation of determination results themselves. Unsafe generated versions are already rejected at the downstream boundary before preflight/release. RTR-01 has no outstanding blocker; full-workspace verification remains assigned to RTR-09.

### Task RTR-02: Prepare Releases From A Verified Source Without Blind Deletion

Status: completed

Kind: defect

Priority: P1 — current operations can remove existing work or release the wrong checkout.

Suggested agent: safe-release-lifecycle

Dependencies: RTR-01

Primary ownership: `packages/release-tag/src/release.ts`, focused Git/release preparation helpers, additive `src/plan.ts`/`src/index.ts` contracts, release/orchestration tests and repository-local real-Git fixtures.

Finding: `checkout -b` uses the current HEAD regardless of `baseBranch`; there is no clean-worktree/source check. Both local and remote release branches are unconditionally deleted before command availability is known. A missing command silently leaves a pushed branch, and a directly invoked unselected release stage still mutates the repository. Existing tests explicitly assert this old sequence rather than preserving repository invariants.

References: `src/release.ts` (`runReleaseBranch`, lines 220–280 at review); `test/release.test.ts` (`branch reset`, `release availability`); `.release-it.json` (`addUntrackedFiles: true`); original plan RELTAG-03.

Requirements:

1. Before Git configuration or branch mutations, require a clean tracked/untracked worktree and verify that HEAD represents the selected local base branch's commit. Fail with checkout/cleanup guidance on a wrong branch, detached/tag checkout, missing base, or mismatch; do not silently switch or discard user work. Create the release branch from the verified source commit explicitly.
2. Check release-command availability before mutation when execution is selected. Missing/non-executable commands now fail with install/configuration guidance; deliberate `skipRelease` remains supported.
3. Default branch collisions must fail without deleting/overwriting refs. Add `resetReleaseBranch?: boolean` (default false) for intentional restart: use an explicit observed remote-ref lease, retain the remote branch instead of delete/recreate, and refuse a raced remote update. Never reset the selected base. Do not swallow unexpected Git failures.
4. Refuse to execute a new release when the target tag already exists locally or remotely; never overwrite release tags. Preserve the explicit skip-release path for composition/recovery with existing metadata.
5. A directly invoked stage excluded by `only` must return a skipped result with zero process/file/network operations, with the same explicit-base requirement as its no-I/O dry-run path. Preserve selected `skipRelease` branch preparation semantics.
6. Return the verified released head commit in an additive field usable for later PR merge checks. Keep prepared-source/ref operations in small testable helpers.
7. Validate the release executable's postconditions before final push/PR: it must leave the expected release branch checked out, a clean worktree, and the target tag resolving to the released head commit. A zero process exit alone is insufficient evidence of a completed release. This requirement was added at task start because RTR-05's head-pinned PR contract depends on a verified release identity.
8. Refuse symbolic branch-ref aliases during read validation, including locally and when advertised by the remote. A repo-local disposable Git probe confirmed that `checkout -B <release> <source>` follows an existing symbolic release ref and can move the base ref. Check dangling local aliases directly too: a real-Git regression confirmed that ordinary ref listings omit them while reset still follows them. This necessary scope clarification enforces requirement 3's never-reset-the-base invariant even when distinct short names alias the same stored ref.

Acceptance criteria:

- Real-Git tests using disposable local bare remotes prove dirty and wrong-base cases preserve work/refs, branch collisions preserve existing commits, safe reset requires explicit opt-in and a matching lease, and duplicate tags cannot be released again.
- Missing commands fail before any config/push/checkout; excluded/dry-run stages do zero I/O; normal and signed-release behavior still works.
- No unconditional `push --delete` or `branch -D` remains in branch preparation. Failures stop downstream stages and provide actionable diagnostics.
- A nominally successful executable that leaves the wrong branch, uncommitted work, or a missing/mismatched target tag is rejected before final push/PR.
- Symbolic release-ref aliases are refused before configuration or reset, preserving the selected base ref.

Verification: V-task; record real-Git invariant test names/results.

Completion evidence:

- Changed: `packages/release-tag/src/release-git.ts`, `packages/release-tag/src/release.ts`, `packages/release-tag/src/plan.ts`, and `packages/release-tag/src/validation.ts`. Preparation verifies the selected local base/HEAD and clean worktree before configuration, uses an explicit source commit, refuses unavailable commands/collisions/duplicate release tags, and permits intentional branch resets only with explicit remote leases. Direct symbolic-ref inspection also rejects dangling local aliases omitted by ordinary ref listings. Executed releases must satisfy branch/worktree/tag postconditions and return additive `releasedHead?: string`; final pushes pin that commit. Selected `skipRelease` retains preparation/metadata semantics without claiming a released head.
- Contracts: `packages/release-tag/README.md` and `docs/release-tag-review-notes.md` document defaults, `resetReleaseBranch`, `releasedHead`, no-I/O exclusions, immutable tags, and partial-failure limits. `packages/release-tag/src/cli.ts` updates existing help and plan summaries; new flags remain RTR-07's responsibility.
- Test support/updates: `packages/release-tag/test/git-fixture.ts`, `packages/release-tag/test/release-fixture.ts`, `packages/release-tag/test/release.test.ts`, `packages/release-tag/test/run.test.ts`, `packages/release-tag/test/cli.test.ts`, `packages/release-tag/test/plan.test.ts`, `packages/release-tag/test/validation.test.ts`, and `packages/release-tag/test/signed-tag.test.ts`. Behavior-based fixtures replace unsafe delete-sequence queues while preserving predecessor validation, signature, and SSH cases. Direct excluded/dry-run tests assert zero process, filesystem, and fetch calls.
- Real-Git evidence: **35 cases** in `packages/release-tag/test/release-lifecycle.test.ts`, with disposable checkouts/bare remotes beneath `_tmp-release-tag-review/`. Representative tests: `preserves tracked work, refs, index, and config on a dirty checkout`; `refuses a same-commit branch without switching or changing refs`; `restarts explicitly from the verified base with a matching observed remote lease and retained reflog`; `refuses a raced existing remote branch even after remote-tracking refs refresh`; `refuses a dangling local symbolic release alias before reset can move the base`; and `rejects zero-exit release with mismatched tag before final push or PR`. Additional cases cover staged/untracked work, missing/detached/tag bases, source movement, local/remote collisions and tags, remote aliases, command availability, executable-owned pushes, all other required postcondition failures, and final-push races. Base refs and raced remote work remain intact.
- Final verification, run serially from repository root: `TMPDIR="$PWD/_tmp-release-tag-review" pnpm lint`; `TMPDIR="$PWD/_tmp-release-tag-review" pnpm typecheck`; `TMPDIR="$PWD/_tmp-release-tag-review" pnpm --filter @repo-toolkit/release-tag test`. All passed; **11 files / 424 tests passed**, including dependency builds (RTR-01 predecessor: 354 tests).
- Final diff checks: `TMPDIR="$PWD/_tmp-release-tag-review" git diff --check` and `TMPDIR="$PWD/_tmp-release-tag-review" git diff --exit-code HEAD -- CHANGELOG.md` passed. The actual checkout branch was not changed, and existing ignored SSH keys were not touched/read; real Git mutations were confined to disposable fixtures.
- Follow-up: no outstanding RTR-02 blocker. Preparation remains nontransactional: an authorized local reset/initial upstream push can survive later failure, and postconditions cannot undo executable-owned side effects. These limits are documented. Bounded process/credential handling, PR recovery/head pinning, new CLI flags, and full-workspace verification remain with RTR-03/RTR-04/RTR-05/RTR-07/RTR-09 respectively.

### Task RTR-03: Enforce Process Deadlines And Output Bounds During Execution

Status: completed

Kind: defect

Priority: P1 — hung/noisy children can stall CI or exhaust memory; inherited release stdout breaks JSON output.

Suggested agent: bounded-process-execution

Dependencies: RTR-02

Primary ownership: a package-local process execution module; `src/determine.ts`, `src/preflight.ts`, release/Git helpers; process and spawned-CLI regression tests.

Finding: shared `captureProcess` accumulates unbounded strings, only determine checks size after completion, and the release command uses synchronous `runner.run` without timeout and inherits stdout. Several modules duplicate stderr truncation/failure formatting. Preflight's non-interactive environment is not applied consistently to later pushes/release children.

References: `packages/publish-package/src/runner.ts` (`captureProcess`, `defaultProcessRunner.run`); `src/determine.ts` (`assertOutputWithinLimit`); `src/release.ts` (`captureOrThrow`, release invocation); `src/preflight.ts` (`checkGitAuth`); `packages/docker-publish/src/runner.ts` (bounded runner precedent).

Requirements:

1. Encapsulate a bounded asynchronous default subprocess implementation inside release-tag, retaining compatibility with injected `CapturingProcessRunner` test doubles. Do not change shared runner behavior for other packages.
2. Enforce combined raw stdout/stderr byte limits while reading; stop excessive producers without buffering their entire output. Apply deadlines to Git, availability probes, and the release command; terminate and reap timed-out processes, escalating when SIGTERM is ignored and handling descendants that retain pipes on supported POSIX systems.
3. Route release execution through captured/bounded output so package-owned children never write uncontrolled stdout. Preserve useful bounded failure diagnostics and explicit argument arrays, including signing/release args. Remove duplicated process error/truncation code at this shared boundary.
4. Preserve custom `GIT_SSH_COMMAND`, `GIT_SSH`, and `core.sshCommand` identities; consistently disable Git terminal prompts for mutations and release children. Keep the existing real-Git SSH tests meaningful.
5. Defensively validate/check outputs from injected runners and document that custom transports own their actual execution/cancellation behavior.
6. Constrain configured deadlines to the timer-supported integer range so very large positive values cannot wrap into immediate timeouts. This is part of enforcing the advertised deadline contract, not a new timeout policy for other packages.

Acceptance criteria:

- Real Node child fixtures cover normal multibyte output, combined stdout/stderr overflow, stalled children, SIGTERM-resistant children, spawn errors, and nonzero exits with no orphaned fixture processes.
- Demonstrate the bound with bytes produced/retained or early termination observations, and a bounded wall-clock timeout test; do not claim an unmeasured speedup.
- A noisy release child cannot pollute final JSON stdout; all stage plumbing uses the shared execution boundary and V-task passes.

Verification: V-task; record resource-bound/timeout measurements or assertions.

Completion evidence:

- Changed execution boundary: `packages/release-tag/src/process.ts`, `packages/release-tag/src/determine.ts`, `packages/release-tag/src/preflight.ts`, `packages/release-tag/src/release-git.ts`, `packages/release-tag/src/release.ts`, and `packages/release-tag/src/plan.ts`. All package-owned subprocesses now use one captured execution/error boundary and a package-local asynchronous default transport. Combined raw-byte limits apply during streaming, deadlines include pipe closure, and POSIX process groups receive SIGTERM followed by SIGKILL after 250 ms, with a further 1 s cleanup allowance. Supported deadlines are integers from 1 through 2147483647. No shared-runner change was made.
- New resource/contract coverage: `packages/release-tag/test/process.test.ts` and `packages/release-tag/test/process-fixture.ts` provide **50 process-boundary cases**, including real Node multibyte/raw-byte capture, combined overflow, paced producers, hangs, SIGTERM resistance, parent-exited descendant-held pipes, cooperative child/grandchild reaping, spawn/nonzero errors, safe transport-error classification, custom-result validation, timer limits, and real default Git/probe/release deadlines. PID-recorded fixtures assert every recorded process has exited and have independent watchdog/finally cleanup; no process-fixture files remained after verification.
- Measured bounds asserted by passing tests: 20 stdout bytes plus 12 stderr bytes overflow a 31-byte combined cap while each stream fits individually; only 31 raw bytes are retained. A paced 64 MiB producer is stopped before producing 1 MiB and within 2.5 s, retaining exactly **65,537 raw bytes**; observed input is at most the cap plus one 65,536-byte read, and returned UTF-8 strings encode to at most 65,539 bytes including a split-character replacement. A 500 ms stalled-child deadline finishes within 2.5 s; resistant-child and descendant cases finish within 3 s, with 700 ms descendant deadlines remaining active after the direct parent exits. Default Git, availability, and release-stage 700 ms deadlines finish within 3.5 s and stop downstream work. Nonzero diagnostic text is below 2,400 bytes in the real-child test and below 3,000 bytes in spawned CLI stderr. These are bounded retention/termination assertions, not RSS measurements or a claimed speedup.
- Fixture and regression updates: `packages/release-tag/test/git-fixture.ts`, `packages/release-tag/test/release-fixture.ts`, `packages/release-tag/test/determine.test.ts`, `packages/release-tag/test/preflight.test.ts`, `packages/release-tag/test/release.test.ts`, `packages/release-tag/test/run.test.ts`, and `packages/release-tag/test/plan.test.ts`. Release fixtures now execute through capture; the **35 predecessor real-Git lifecycle cases** and signature assertions still pass. Every child receives `GIT_TERMINAL_PROMPT=0`; a full injected run probes SSH configuration once, and skip-preflight paths do not add that probe.
- Spawned/SSH evidence: `packages/release-tag/test/cli.test.ts` verifies a noisy real fake release against a disposable local bare remote: success emits exactly one schema-1 JSON object; nonzero failure leaves stdout empty, reports bounded stdout/stderr tails, and stops the final push. `packages/release-tag/test/ssh-auth.test.ts` retains the original three real-Git SSH identity cases, adds two empty-environment cases, and now exercises preflight, release execution, and pushes through the selected identity while preserving the base ref.
- Contract notes: `packages/release-tag/README.md` and `docs/release-tag-review-notes.md` document per-command defaults, captured release output, timer range, termination/cleanup limits, SSH behavior, and the custom-runner migration from `run` to `capture`. Custom transports own actual streaming, cancellation, environment merging, and cleanup; the boundary checks completed shapes, UTF-8 bytes, and elapsed time and cannot preempt arbitrary custom code/promises. Escaped process groups, OS-uninterruptible tasks, and non-POSIX process-tree cancellation are outside the built-in guarantee; adopted descendants rely on OS reaping. No outstanding RTR-03 blocker. The supplied-secret seam is ready for RTR-04's credential context; later tasks were not implemented.
- Final required verification, run serially from repository root: `TMPDIR="$PWD/_tmp-release-tag-review" pnpm lint`; `TMPDIR="$PWD/_tmp-release-tag-review" pnpm typecheck`; `TMPDIR="$PWD/_tmp-release-tag-review" pnpm --filter @repo-toolkit/release-tag test`. All passed, including dependency builds: **12 files / 479 tests passed** (55 more than the 424-test predecessor baseline; Vitest phase 12.02 s). Earlier focused runs also passed after fixture/typing adjustments. Full-workspace tests remain assigned to RTR-09.
- Final checks: `TMPDIR="$PWD/_tmp-release-tag-review" git diff --check` and `TMPDIR="$PWD/_tmp-release-tag-review" git diff --exit-code HEAD -- CHANGELOG.md packages/publish-package/src/runner.ts` passed. Predecessor changes were preserved. All new scratch/Git fixtures stayed beneath `_tmp-release-tag-review/`; no ignored checkout SSH credentials were inspected, and no commits, production release/push, or external GitHub calls were made. This task's status alone was changed to `completed`.

### Task RTR-04: Bound GitHub Transport And Keep Credentials Private Across Errors

Status: completed

Kind: defect

Priority: P1 — documented response bounds/redaction do not hold across body reads, raw causes, and token-file paths.

Suggested agent: credential-and-http-boundaries

Dependencies: RTR-03

Primary ownership: `src/github.ts`, focused credential/error/context helpers, `src/run.ts`, `src/plan.ts`, stage boundary wiring, GitHub/security regression tests.

Finding: `sendGitHubRequest` calls unbounded `response.text()` outside its catch, attaches raw token-bearing causes, and follows redirects by default. Token files are read without a size bound and resolved twice per full run; orchestration only collects explicit/env secrets. Plans also expose enumerable runtime runner objects. Library API URL resolution differs from CLI behavior.

References: `src/github.ts` (`resolveGitHubToken`, `sendGitHubRequest`); `src/run.ts` (`collectSecrets`, `redactError`, `runReleaseTag`); `src/plan.ts` (`resolveGithubApiUrl`, runner attachment); `src/cli.ts` (`GITHUB_API_URL` fallback); `test/pull-request.test.ts` (checks only top-level messages and already-buffered fake responses).

Requirements:

1. Stream GitHub response bodies with the existing `min(maxOutputBytes, 1MiB)` cap, cancel readers on overflow/failure, and keep the request deadline active through body consumption. Handle both AbortError and TimeoutError without leaking raw body/fetch errors or retaining unsafe causes.
2. Reject redirects for authenticated API requests. Centralize API URL construction, reject query/fragment/userinfo routing, and require HTTPS except explicit loopback HTTP for offline tests. Preserve GHES base paths. Apply `GITHUB_API_URL` fallback in plan resolution for CLI/library parity and validate it equally.
3. Bound token-file reads (document a fixed, practical cap), reject nonregular/empty/invalid-header token content, and preserve explicit > file > env precedence with no fallback on invalid files. Keep dry-run and skipped credential-consuming paths free of token-file reads.
4. Resolve active credentials once for a full orchestration, pass them through private execution context, and reuse them across preflight/PR/error handling. Keep secrets and runtime transport state out of serialized plans/results; avoid a global mutable execution registry.
5. Sanitize diagnostics at each exported boundary, including direct stage calls, thrown strings, nested causes/stacks, stream errors, file-token process errors, and success data that echoes known tokens. Do not redact only the final CLI message. Preserve the useful error classification/message while removing unsafe error object data.

Acceptance criteria:

- Streaming fake responses prove cancellation before full consumption, combined timeout/body-error handling, and no follow-up mutation after failed reads; redirect and unsafe URL cases perform no credential forwarding.
- Canary tests inspect error objects (not only `.message`), stdout/stderr, results/plans, and outgoing PR descriptions for explicit/env/file secrets, including runner failures and token-bearing response URLs.
- Token-file rotation after preflight does not change the active token mid-run; dry-run/unselected PR paths do not read invalid token files. Library and CLI resolve GHES consistently.

Verification: V-task; use fake transports/local fixtures only.

Completion evidence:

- Credential/HTTP boundaries: `packages/release-tag/src/credentials.ts`, `packages/release-tag/src/diagnostics.ts`, `packages/release-tag/src/github-url.ts`, `packages/release-tag/src/github.ts`, and `packages/release-tag/src/plan.ts`. A private per-orchestration lazy context pins one active credential; bounded regular-file reads preserve explicit > file > env precedence without invalid-file fallback. API construction validates origins/base paths and retains GHES prefixes. Responses stream into bounded storage with a deadline through body consumption, abort/cancel on failure, disabled authenticated redirects, and safe late-response cleanup. Errors have bounded sanitized messages/fresh stacks, without raw causes or caller transport properties. Operational plans retain writable, nonenumerable runtime dependencies and resolved-time safe JSON/inspection snapshots; returned orchestration plans contain sanitized data only.
- Stage wiring: `packages/release-tag/src/determine.ts`, `packages/release-tag/src/preflight.ts`, `packages/release-tag/src/release.ts`, `packages/release-tag/src/release-git.ts`, `packages/release-tag/src/pull-request.ts`, `packages/release-tag/src/process.ts`, and `packages/release-tag/src/run.ts`. Internal stage seams share the private context; direct determine/release inputs add optional `githubToken`. Process diagnostics reuse RTR-03's bounded capture and supplied-secret seam, omitting captured output while a configured file token remains unresolved. Determination and Git-inferred ref validation precede file resolution, preserving the lazy boundary for RTR-06. Stage-plan cloning explicitly retains injected runner/fetch dependencies. Git arguments, author configuration, source refs, and PR head/base identities remain operationally unchanged; reporting metadata and PR descriptions/titles are sanitized separately. `packages/release-tag/src/cli.ts` delegates `GITHUB_API_URL` fallback to the plan without implementing the later CLI split/flags work.
- New regression suites: `packages/release-tag/test/github.test.ts` (**75 tests**) and `packages/release-tag/test/credentials.test.ts` (**64 tests**), with `packages/release-tag/test/http-fixture.ts` and `packages/release-tag/test/security-fixture.ts`. Cases cover standard `Response`/`ReadableStream` bodies, cancellation/timeout/error paths, redirects and unsafe URLs through plan/direct/transport entrypoints, GHES routing, file type/size/growth/validation, explicit/env/file canaries, inspected errors/causes/stacks, transport cycles/getters, safe snapshots, unchanged operational values, pinned rotation, isolated overlapping orchestrations, and no-read skip/dry-run boundaries. Existing helpers in `packages/release-tag/test/preflight.test.ts`, `packages/release-tag/test/pull-request.test.ts`, and `packages/release-tag/test/run.test.ts` now use real responses. `packages/release-tag/test/cli.test.ts` adds **5 cases**, including spawned CLI file-token/env-token success and nonzero real-child output against disposable local Git fixtures with an offline fetch preload. Tag annotations, returned PR URLs, stdout/stderr, and outgoing PR descriptions stay canary-free; predecessor SSH/signing/process/lifecycle tests still pass.
- Bounds asserted by passing tests: HTTP producers with a theoretical 64 MiB body are cancelled after observing at most **cap plus one 65,536-byte chunk** (or one 31-byte chunk for the 31-byte test); configured limits of 31, 65,537, and 4 MiB exercise the effective **1 MiB ceiling**. Split multibyte bytes decode correctly at the exact raw cap. Stalled bodies, uncooperative fetches, and empty-chunk producers respect 25/40/70 ms test deadlines and return within **1 s**, including a never-settling cancellation promise. Token files accept exactly **65,536 raw bytes**, reject larger advertised sizes before content reads, and read exactly **65,537 bytes** before rejecting growth after stat. Directory/FIFO rejection completes within 1 s without fallback. These are consumption/byte/elapsed assertions, not RSS measurements or a speedup claim.
- Contract notes: `packages/release-tag/README.md` and `docs/release-tag-review-notes.md` record strict ASCII/header-token validation, explicitly empty-token rejection, the 64 KiB file cap, loopback-only HTTP exceptions, centralized environment fallback, truthful abort versus timeout errors, direct-stage token inputs, safe output snapshots, and custom-fetch responsibilities.
- Final required verification, run serially from repository root: `TMPDIR="$PWD/_tmp-release-tag-review" pnpm lint`; `TMPDIR="$PWD/_tmp-release-tag-review" pnpm typecheck`; `TMPDIR="$PWD/_tmp-release-tag-review" pnpm --filter @repo-toolkit/release-tag test`. All passed, including dependency builds: **14 files / 623 tests passed** (**144 more** than the 12-file/479-test predecessor baseline; final Vitest phase 14.99 s). `TMPDIR="$PWD/_tmp-release-tag-review" git diff --check` and `TMPDIR="$PWD/_tmp-release-tag-review" git diff --exit-code HEAD -- CHANGELOG.md packages/publish-package/src/runner.ts` passed. New credential/local-Git fixture directories were cleaned up beneath `_tmp-release-tag-review/`.
- Limitations/follow-up: no outstanding RTR-04 blocker. The HTTP cap excludes transport-owned buffering/current chunks and bounded decoding overhead; arbitrary injected transport forwarding, blocking JavaScript, and underlying resource cleanup cannot be forcibly controlled. Token-file enforcement bounds bytes/type, not OS filesystem latency; excluded files are never opened to discover otherwise unknown secrets. Existing read-only preflight still does not prove every endpoint's write permissions. PR reuse/merge semantics, no-change policy, CLI parse/flags, full guides, and full-workspace verification remain with RTR-05/RTR-06/RTR-07/RTR-08/RTR-09. Predecessor changes were preserved; no nested agents, new dependencies, commits, root changelog edits, production releases/pushes, external network requests, or reads of existing ignored SSH keys were performed.

### Task RTR-05: Make PR Recovery Idempotent And Verify Merge Outcomes

Status: completed

Kind: defect

Priority: P1 — HTTP success is not merge success, and retries after partial PR success currently fail as duplicates.

Suggested agent: recoverable-pr-lifecycle

Dependencies: RTR-04

Primary ownership: `src/pull-request.ts`, focused PR response/lifecycle helpers, additive plan/result types, PR and orchestration tests.

Finding: the stage always POSTs a new PR, then labels/merges/deletes; failure after creation cannot be resumed idempotently. Any 2xx merge response sets `merged = true` without inspecting `{ merged }`, allowing deletion after a refused merge. The request does not pin the expected head SHA and always uses merge commits, which excludes squash-only/rebase-only repositories.

References: `src/pull-request.ts` (`createReleasePullRequest`, lines 173–240 at review); `test/pull-request.test.ts` (`success paths`, `merge failure`); `.github/workflows/release-tag-changelog.yml` (immediate merge/delete use).

Requirements:

1. Discover and validate an exact matching release PR (repository/head/base), reuse/update it instead of duplicating it, and idempotently reapply labels. Expose whether the result reused an existing PR. Bound lookups; reject ambiguous or mismatched/fork records.
2. Recover a create conflict with at most one exact relookup; do not generically retry validation/authentication/mutation errors. Recognize a matching already-merged PR for cleanup recovery, and give explicit guidance for closed-unmerged PRs.
3. Parse merge responses and require `merged === true` before reporting success or considering deletion. Pin the merge to a validated head SHA, compare against the released head when available, and stop on stale/mismatched head state. Never delete the base ref; validate current release-ref identity before cleanup and document the REST cleanup race limitation.
4. Add `mergeMethod?: 'merge' | 'squash' | 'rebase'` (default merge) with validation. `autoMergePr` remains immediate REST merge, not queued auto-merge; branch protection errors remain actionable failures.
5. Include safe PR identity/stage recovery information in errors after partial success, without retaining unsafe raw responses. Reuse the credential/transport boundary from RTR-04.

Acceptance criteria:

- Tests cover first creation, reuse after label failure, one bounded create-conflict recovery, wrong fork/base/ambiguous records, closed-unmerged handling, and already-merged cleanup recovery.
- HTTP 200 with false/missing/malformed `merged` never deletes; true success uses the expected SHA and selected merge method; changed heads/ref identities are refused.
- Existing skip/dry-run behavior makes zero network calls, labels/template/signature stripping remain correct, and all diagnostics stay canary-free.

Verification: V-task.

Completion evidence:

- Lifecycle implementation: `packages/release-tag/src/pull-request.ts`, `packages/release-tag/src/pull-request-data.ts`, and `packages/release-tag/src/pull-request-lifecycle.ts`. The public stage retains shared validation, lazy per-operation credentials, internal `WithContext` composition, bounded/redirect-disabled HTTP, and safe result/error wrappers. Focused parsers distinguish real REST list records from detail responses; both returned repositories/IDs, head/base refs, PR numbers, and full head SHAs are checked on creation, discovery, detail reads, and updates. Repository names are compared case-insensitively; branch refs remain case-sensitive. Matching open PRs are updated and labels reapplied; ambiguous/fork/mismatched records fail, closed-unmerged records give reopen/new-identity guidance, and exact already-merged PRs support cleanup recovery.
- Bounds and merge decisions: discovery uses `state=all`, exact owner/head and base filters, `per_page=2`, and one page, refusing multiple records rather than selecting one or following pagination URLs. Only create 409/422 permits one identical relookup; no mutation is automatically retried. The complete conflict/merge/cleanup path is tested at **ten HTTP requests maximum**, including at most two list and two detail reads. Immediate merge performs a fresh identity/head check, sends the selected method and pinned SHA, compares supplied `releasedHead`, and requires literal `merged === true`; malformed/missing/false confirmations never trigger ref cleanup. Cleanup reads the singular GET-ref endpoint, verifies the exact release ref/commit SHA, and only then uses DELETE; a post-confirmation GET 404 supports already-deleted recovery, and DELETE requires 204.
- Additive contracts: `packages/release-tag/src/plan.ts`, `packages/release-tag/src/validation.ts`, and `packages/release-tag/src/index.ts` expose validated `mergeMethod?: 'merge' | 'squash' | 'rebase'` (default `merge`) and `ReleaseTagMergeMethod`; safe plan snapshots preserve the value. `PullRequestResult.reused` distinguishes existing/concurrent PR reuse from initial creation/skips. `packages/release-tag/src/cli.ts` reflects the resolved method in existing summaries and clarifies immediate merge/reuse help; new flags and PR-only CLI composition remain RTR-07. Runtime transports stay nonenumerable, stage cloning retains them, and safe snapshots/direct-stage credential boundaries remain intact.
- Regression coverage: new `packages/release-tag/test/pull-request-lifecycle.test.ts` exercises repeated stage calls, label/update/merge/deletion failure recovery, lost successful merge responses, create-conflict bounds, malformed/list/detail/create/update identities, ambiguity and fork/base mismatch, closed-unmerged handling, already-merged/already-deleted recovery, all merge methods, verified and legacy SHA pinning, stale/raced heads, guarded ref deletion, and inspected secret-safe partial errors with PR number/URL/stage guidance. Shared real-shaped response helpers in `packages/release-tag/test/http-fixture.ts` and updates to `test/pull-request.test.ts`, `test/plan.test.ts`, `test/credentials.test.ts`, `test/run.test.ts`, `test/cli.test.ts`, `test/validation.test.ts`, and `test/signed-tag.test.ts` follow lookup semantics while preserving signature/template/label, token rotation/redaction, full orchestration, spawned CLI, nested Unicode refs, and no-I/O skip assertions. The label-stream overflow fixture now uses a 1,024-byte cap and 1,025-byte chunk so valid expanded PR metadata reaches the intended failure stage.
- Contract notes: `packages/release-tag/README.md` and `docs/release-tag-review-notes.md` document PR reuse, direct-stage recovery, real list/detail fields, affirmative merge confirmation, methods/SHA checks, lookup/request bounds, safe diagnostics, and cleanup limits. `autoMergePr` still performs an immediate REST merge, without queueing or satisfying required reviews/checks.
- Final required verification, run serially from repository root: `TMPDIR="$PWD/_tmp-release-tag-review" pnpm lint`; `TMPDIR="$PWD/_tmp-release-tag-review" pnpm typecheck`; `TMPDIR="$PWD/_tmp-release-tag-review" pnpm --filter @repo-toolkit/release-tag test`. All passed, including dependency builds: **15 files / 808 tests passed**, **185 more** than the 14-file/623-test predecessor baseline (final Vitest phase 10.18 s). An earlier focused run passed 7 files / 435 tests. `TMPDIR="$PWD/_tmp-release-tag-review" git diff --check` and `TMPDIR="$PWD/_tmp-release-tag-review" git diff --exit-code HEAD -- CHANGELOG.md packages/publish-package/src/runner.ts` also passed.
- Limitations/follow-up: **REST GET-ref followed by DELETE is not atomic and has no SHA lease**; a concurrent update/recreation between those requests can still be deleted. A ref 404 also cannot independently distinguish absence from a simultaneous access-policy change. Both limits are explicit in the notes; CI/ref-writer serialization remains necessary. Without optional `releasedHead`, the PR stage pins the first validated API head rather than claiming verified stage-2 provenance. No independent RTR-05 finding or blocker remains. CLI flags/composition, full guides, and workspace/integration checks remain with RTR-07/RTR-08/RTR-09. Predecessor changes were preserved, all scratch/local-Git fixtures stayed under `_tmp-release-tag-review/`, and no subagents, new dependencies, comments, commits, root changelog edits, external GitHub/production releases/pushes, or reads of existing ignored SSH credentials were performed. Only RTR-05's task status was changed.

### Task RTR-06: Recognize Conventional Commit Boundaries And Avoid Empty Releases

Status: completed

Kind: improvement

Priority: P2 — predictable version policy and no-change runs are common CI release requirements.

Suggested agent: conventional-version-policy

Dependencies: RTR-05

Primary ownership: `src/determine.ts`, a pure commit-classification helper if useful, additive plan/result contracts, `src/run.ts`, determine/orchestration tests.

Finding: the action-parity regex scans concatenated commit bodies. A subject containing incidental `!:` or a body line starting `feat:` changes the bump, while the standard `BREAKING-CHANGE:` footer is missed. Empty history always creates a patch candidate. Existing tests explicitly preserve these quirks rather than Conventional Commit boundaries.

References: `src/determine.ts` (`MAJOR_BUMP_PATTERN`, `MINOR_BUMP_PATTERN`, `selectBump`, git log format); `test/determine.test.ts` (`bumps patch ... empty history`, `breaking indicators`); package README `Stage contracts`.

Requirements:

1. Preserve commit boundaries in Git output and classify conventional subjects and breaking footers independently: scoped/unscoped feat => minor, conventional type with breaking `!` or `BREAKING CHANGE:`/`BREAKING-CHANGE:` footer => major, otherwise patch. Incidental punctuation/body feature mentions must not count as headers. This intentionally corrects shell-parity behavior and must be recorded in migration notes.
2. Add an explicit `noChanges` result indicator and `allowEmptyRelease?: boolean` (default false). With no commits since the previous tag, return the current version, no bump, and a no-change result; orchestration must skip preflight/release/PR entirely. Manual versions remain explicit release requests. Opt-in empty release retains the old patch-bump behavior.
3. Validate the result of numeric bumps so overflow cannot yield rounded/scientific/non-version output. Preserve existing no-history guidance and explicit manual no-Git behavior.

Acceptance criteria:

- Unit tests distinguish multi-commit headers from bodies, breaking footer spellings, arbitrary conventional breaking types, incidental `!:` text, and bump precedence.
- Real or representative Git records prove an empty-message commit is different from no commits. No-change orchestration performs only determination reads, with no auth/network/mutation; opt-in/manual paths remain executable.
- Safe-integer boundary bumps either produce an exact stable version or fail before side effects; result/type/contract changes are explicit.

Verification: V-task.

Completion evidence:

- Changed: `packages/release-tag/src/conventional-commits.ts`, `packages/release-tag/src/determine.ts`, `packages/release-tag/src/plan.ts`, `packages/release-tag/src/run.ts`, and `packages/release-tag/src/validation.ts`. NUL-terminated full-ID/raw-message records preserve commit boundaries, including empty-message commits. Only the first raw line is a header; conventional `!` headers and uppercase column-zero breaking footers outrank feature headers, then patch. Raw messages avoid Git `%s` paragraph folding. Malformed records fail without message disclosure; bumped versions pass the shared safe-component validator before returning or entering downstream work.
- Result/option contract: required `DeterminedTag.noChanges: boolean` and resolved `allowEmptyRelease: boolean` (option default false). Zero records return the current version/tag, `bump: null`, `manual: false`, and `noChanges: true`; orchestration bypasses runtime identity inference, preflight, token-file resolution, release, and PR, returning null downstream results through the existing safe snapshot boundary. Manual versions remain explicit requests with zero determination Git reads; opt-in empty ranges increment patch. Internal `WithContext` seams and credential pinning remain in use.
- Tests: `packages/release-tag/test/determine.test.ts`, `packages/release-tag/test/determine-git.test.ts`, `packages/release-tag/test/run.test.ts`, `packages/release-tag/test/plan.test.ts`, and `packages/release-tag/test/validation.test.ts`. **13 real-Git cases** prove empty-message versus zero-commit behavior, first-line versus folded subjects, multiple-record precedence, body/header/footer distinctions, no-change preservation of a dirty detached checkout without origin/command/token file, and existing tag-selection/seed guidance. Injected counters assert only determination captures and zero file/auth/network/mutation work on no-change/overflow paths; manual/opt-in full runs resolve the token file once and execute release/PR. Numeric cases cover exact decimal carries, safe limits, lower-component resets, rounded input rejection, and major/minor/patch/empty-opt-in overflow.
- Fixture migration: `packages/release-tag/test/commit-fixture.ts` and `packages/release-tag/test/release-fixture.ts` emit explicit records. Required result fields were added to `packages/release-tag/test/release.test.ts`, `packages/release-tag/test/release-lifecycle.test.ts`, `packages/release-tag/test/pull-request.test.ts`, `packages/release-tag/test/process.test.ts`, `packages/release-tag/test/security-fixture.ts`, and `packages/release-tag/test/ssh-auth.test.ts`; predecessor validation, process, credential, signing/SSH, and PR lifecycle cases pass. `packages/release-tag/README.md` and `docs/release-tag-review-notes.md` document the intentional shell-policy corrections, runner/result migration, and no-change contract.
- Verified serially from repository root: `TMPDIR="$PWD/_tmp-release-tag-review" pnpm lint`; `TMPDIR="$PWD/_tmp-release-tag-review" pnpm typecheck`; `TMPDIR="$PWD/_tmp-release-tag-review" pnpm --filter @repo-toolkit/release-tag test`. All passed, including dependency builds: **16 files / 926 tests passed**, **118 more** than the 15-file/808-test predecessor baseline (Vitest phase 10.92 s). Earlier focused verification passed **5 files / 327 tests**. `TMPDIR="$PWD/_tmp-release-tag-review" git diff --check` and `TMPDIR="$PWD/_tmp-release-tag-review" git diff --exit-code HEAD -- CHANGELOG.md packages/publish-package/src/runner.ts` also passed. Scratch and real-Git fixtures used `_tmp-release-tag-review/`.
- Limitations/follow-up: no outstanding RTR-06 blocker or independent finding. Pure explicit-plan validation still applies to no-change calls; direct-stage composition must honor `determined.noChanges` before invoking downstream stages. Stable `vX.Y.Z` latest-tag requirements and no-history guidance remain the policy; unrelated-tag reinterpretation, prereleases, and tag prefixes stay deferred. RTR-07 owns the CLI allow-empty flag, no-change formatting, and schema decision; RTR-08 owns complete guides; full-workspace verification remains RTR-09's responsibility.

### Task RTR-07: Expose PR-Only Recovery And Keep The CLI Thin And Predictable

Status: completed

Kind: improvement

Priority: P2 — CI callers need usable recovery, configurable limits, and reliable JSON/validation behavior.

Suggested agent: recovery-cli-and-composition

Dependencies: RTR-06

Primary ownership: `src/cli.ts`, new focused `src/cli-options.ts`/`src/format.ts`, `src/run.ts`, read-only release metadata composition helper, CLI/orchestration tests.

Finding: PR-only CLI execution is forbidden even after a successful release, forcing a full release rerun. Library release args/timeouts/output limits have no CLI equivalents. `cli.ts` mixes parsing/formatting/execution and runs `main` when test helpers are imported. Prefix validation occurs after the dry-run return, and outer parser errors bypass redaction.

References: `src/run.ts` (`assertStagePrefix`, dry-run return); `src/cli.ts` (`SPECS`, `buildOptions`, formatter exports, `main().catch`); `test/cli.test.ts` (imports executable module, mostly dry-run subprocess coverage).

Requirements:

1. Support `--only pr --tag X.Y.Z --base-branch main` and the equivalent library options as a read-only recovery composition: validate/inspect existing release branch, tag annotation, and head identity, then run the idempotent PR stage. Never configure Git, create/reset/push refs, or run the release executable on this path. Require explicit identity inputs before I/O; other invalid stage combinations still fail consistently, including dry-run.
2. Expose `--release-arg` (repeatable raw values, preserving commas/dash-leading values via equals form), `--timeout-ms`, `--max-output-bytes`, `--reset-release-branch`, `--allow-empty-release`, and `--merge-method` using `parseFlags` and strict numeric/enum validation.
3. Extract import-safe option/format helpers and leave `cli.ts` as a thin entrypoint. Maintain schema-versioned JSON with no uncontrolled stdout, including successful noisy releases, no-change outcomes, and recovery. Reflect additive result fields consistently and explain any schema version decision.
4. Apply secret-safe handling to parse/build/runtime failures, including known inline/custom-env token values when parsing fails. Keep `process.exitCode` behavior and existing alias/negation semantics.
5. Preserve RTR-05's completed-cleanup recovery: an absent release branch is acceptable only when the local target tag supplies a verified head and the exact matching PR is already merged. Do not reconstruct or push missing refs. This clarification keeps CLI recovery consistent with the idempotent PR stage.

Acceptance criteria:

- Spawned CLI tests exercise real full release output with a fake executable/local repository, PR-only read paths with fakes, no-change output, raw repeated release args, valid/invalid limit and merge options, and redacted parse failures.
- JSON stdout parses as exactly one result object even when children are noisy; importing testable helper modules executes no CLI or Git/network code.
- Recovery requires a matching existing release identity, sends no mutation to Git, and preserves stage skip/null contracts; invalid combinations fail equally in dry-run and execution.

Verification: V-task.

Completion evidence:

- Reused and completed the interrupted attempt's composition: `packages/release-tag/src/recovery.ts` (frozen `VerifiedReleaseRecovery`, `assertRecoveryInputs`, `requiresMergedRecovery`, `readReleaseRecoveryWithContext`), `packages/release-tag/src/cli-options.ts` (import-safe `SPECS`/`buildOptions`/`collectCliSecrets`/`parseCliOptions`), `packages/release-tag/src/format.ts` (import-safe `RELEASE_TAG_CLI_SCHEMA_VERSION`/`planSummary`/JSON-text renderers/help), thin `packages/release-tag/src/cli.ts` (parse/execute/format plus `main().catch` with `process.exitCode`), and `packages/release-tag/src/run.ts` (prefix validation before dry-run, read-only PR-only path with skip-first composition). No predecessor architecture was changed: validation refs/payload identity, `release-git` safe helpers, bounded process capture, private lazy credentials, nonenumerable plan transports with `cloneStagePlan`/`snapshotReleaseTagPlan`, internal `WithContext` stages, bounded PR reuse/merge guards, and `noChanges`/`allowEmptyRelease` early return are preserved.
- Recovery contract: `only: ['pr']` requires explicit `tag` and `baseBranch` (CLI `--only pr --tag X.Y.Z --base-branch main`, including dry-run) and validates without I/O. It composes metadata read-only from the pinned local target tag object/commit (annotated annotation or lightweight commit message, signature-stripped), checks local and `origin` release refs, supports remote-only branches and fresh checkouts without a local base, preserves dirty/detached checkouts, and never runs config/checkout/reset/push/fetch/branch/tag/update-ref, creates refs, or runs the release command. An absent `origin` branch is accepted only with a verified local tag head and the exact already-merged PR at that commit; mismatches, missing tags, aliases, and non-commit tags fail before any write API. Unknown keys such as `allowMissingBranch` are ignored; verified absence is a frozen object-identity check, not a bypassable flag.
- CLI contract: `--release-arg` is repeatable raw (commas preserved; dash-leading requires `--release-arg=--flag`, space form reports missing value), `--timeout-ms` (`1..2147483647`) and `--max-output-bytes` (positive safe integers) use digits-only/no-leading-zeros/no-blank validation matching plan limits, plus `--reset-release-branch`/`--no-reset-release-branch`, `--allow-empty-release`/`--no-allow-empty-release`, and `--merge-method merge|squash|rebase`. Aliases (`--release-it-path`) and `--sign-commit` negation keep last-writer semantics. Parse/build failures redact every inline `--github-token` value (space/equals, including overridden repeats) plus `GITHUB_TOKEN` and referenced custom-env values.
- Result/schema decision: schema stays **1** because RTR-02 through RTR-07 only add optional/backward-compatible fields (`releasedHead`, `reused`, `noChanges`, `allowEmptyRelease`, `resetReleaseBranch`, `mergeMethod`, existing limit fields); no established field changed type or meaning. `--json` emits exactly one object with no uncontrolled child stdout for full/noisy, no-change, and recovery runs. PR-only results report `determined: null`/`release: null` for unselected stages with the idempotent PR result; text reports recovery mode, `noChanges`, `releasedHead`, `reused`, and skipped (no changes) coherently. Documented in `packages/release-tag/src/format.ts` help, `packages/release-tag/README.md`, and `docs/release-tag-review-notes.md` (`## RTR-07`); full website guides remain RTR-08.
- Tests: fixed the interrupted `already.*merged` regex in `packages/release-tag/test/recovery.test.ts`; extended `packages/release-tag/test/cli.test.ts` with unit flag/negation/numeric/enum/import-safety/redaction cases and spawned CLI cases using real Git fixtures, fake release executables, and offline contract-shaped HTTP hooks (`pullRequestListData`/`pullRequestData`) with `snapshotGitFixture` no-mutation assertions. New spawned coverage: full release with raw release-arg passthrough and limit reflection, no-change JSON/text purity without network, PR-only reuse/remote-only-create/already-merged-gone success, missing-tag/local-mismatch/remote-mismatch failures before HTTP, blank/invalid numeric/merge forms, repeated/custom-env parse redaction, and invalid stage-prefix consistency across dry-run/execution. Snapshot/secret tests confirm restored plans do not serialize raw secrets or runtime transports.
- Verified serially from repository root: `pnpm lint`; `pnpm typecheck`; `TMPDIR="$PWD/_tmp-release-tag-review" pnpm --filter @repo-toolkit/release-tag test`. All passed: **17 files / 1025 tests passed** (**99 more** than the 16-file/926-test RTR-06 baseline; interrupted attempt was 17 files / 955 passed with 1 regex failure). `git diff --check`, `git diff --exit-code HEAD -- CHANGELOG.md`, and `git diff --exit-code HEAD -- packages/publish-package/src/runner.ts` also passed. Fixtures stayed under `_tmp-release-tag-review/`.
- Limitations/follow-up: no independent RTR-07 blocker. Recovery still relies on RTR-05's non-atomic REST GET-ref/DELETE cleanup and cannot distinguish a post-confirmation 404 from a simultaneous access-policy change; serialize release jobs. Tag-move races are detected by re-reading the tag ref, but local/remote branch moves after inspection rely on later API head checks. Full guides remain RTR-08; full-workspace and packed-consumer verification remain RTR-09. Predecessor changes were preserved; no nested agents, comments, dependencies, commits, root changelog edits, SSH key reads, production releases/pushes, or external services were used. Only RTR-07's status was changed.

### Task RTR-08: Document Corrected Contracts And Real Release Recovery

Status: completed

Kind: improvement

Priority: P2 — users need accurate migration and operational guidance for the new behavior.

Suggested agent: user-guides-and-migration

Dependencies: RTR-07

Primary ownership: `packages/release-tag/README.md`, `website/docs/packages/release-tag.md` (website-scoped work), `docs/release-tag-dispatch.md`, new `docs/release-tag-review-notes.md`.

Finding: existing documentation describes destructive resets, missing-command success, whole-body response caps, and exact shell bump quirks. The website also predates the installation-token/SSH identity fixes and overstates what read-only preflight proves. Changed contracts and PR-only recovery need practical examples.

References: package README `Stage contracts`; website guide `Prerequisites`, `Branch naming`, `Release-command contract`, `Troubleshooting`; `docs/release-tag-dispatch.md`; tasks RTR-01–RTR-07.

Requirements:

1. Keep README concise and put detailed operation/migration guidance in the website guide. Cover clean source checkout, explicit collision reset with lease, immutable tags, no-change release policy, accurate Conventional Commits, configurable process/API bounds, merge methods/SHA checks, and idempotent PR-only recovery.
2. Provide business-flow examples for initial seed, automatic/no-change run, signed releases with externally prepared keys, squash-only repositories, and recovery after label/merge/deletion failure. Include serialized GitHub Actions release concurrency with no cancellation of an active release.
3. State preflight limitations accurately: read access/installation identity does not prove all endpoint write permissions or eliminate every later authentication failure. Preserve current SSH identity and built-in installation-token guidance; avoid destructive retry instructions.
4. Record external contract changes/release notes in `docs/release-tag-review-notes.md`, link them from the guides, and keep root `CHANGELOG.md` untouched. Document custom transport responsibilities and residual nontransactional Git/GitHub race limitations.

Acceptance criteria:

- Flags, defaults, public types, schema examples, stage behavior, and troubleshooting agree with the finished code; examples use no real secrets.
- Guides explain recovery without rerunning the release command or deleting a tag; migration notes explicitly identify each changed default/contract.
- V-docs passes; package help/examples are reviewed against actual CLI behavior, and website frontmatter/local links remain valid.

Verification: V-docs and help/contract evidence review. Run site checks only from `website/` when its prerequisites are already available; record limitations honestly.

Completion evidence:

- Docs-only task; no source, test, config, or website-config change was made. Changed: `website/docs/packages/release-tag.md` (full rewrite to finished behavior: truthful preflight limits, corrected Conventional Commit boundaries with the four-outcome `noChanges`/`allowEmptyRelease` table, verified-source preparation with leased reset and immutable tags, release availability-before-mutation plus postconditions, per-command `timeoutMs`/`maxOutputBytes` bounds with the `1..2147483647` timer range, PR reuse/merge-method/SHA-pin/`merged === true` lifecycle, read-only `--only pr` recovery, externally prepared signing keys, complete flag table with all nine new flags, actual dry-run/JSON shapes, business-flow examples including seed, no-change, squash-only, label/merge/delete recovery, and serialized Actions concurrency with `cancel-in-progress: false`, rewritten troubleshooting with exact messages, and migration sections linking every RTR-01..RTR-07 contract change); `packages/release-tag/README.md` (kept concise: corrected export list with `runPreflight`/`PreflightResult`/`ReleaseTagTokenSource`, serialized CI example, recovery pointer); `docs/release-tag-dispatch.md` (preserved SSH-identity/installation-token guidance, added fail-fast-only preflight limits, concurrency serialization snippet, and `--only pr` recovery without reruns or tag deletion); `docs/release-tag-review-notes.md` (new RTR-08 section consolidating the final CLI surface, schema-1 shapes, public exports, custom-transport responsibilities, residual races, and preflight limits; explicitly records zero RTR-08 code contract changes). Root `CHANGELOG.md` untouched.
- Contract review against finished code: built `packages/release-tag/dist/cli.js` and reviewed `--help` verbatim (flags, defaults, ranges, recovery semantics all match the guides); captured `--dry-run` text and `--dry-run --json` output and reproduced their shapes (sorted plan summary, `schemaVersion: 1` + `dryRun: true` envelope) in the guide; verified result types in `src/determine.ts`/`release.ts`/`pull-request.ts`/`run.ts`/`preflight.ts`, defaults in `src/plan.ts`, flag specs in `src/cli-options.ts`, release invocation/version-guard/collision/tag-immutability messages in `src/release.ts`/`release-git.ts`/`validation.ts`, merge gating (`autoMergePr && mergeConfirmed && deleteMergedBranch`) in `src/pull-request-lifecycle.ts`, and the real workflow's secrets/GPG/concurrency state in `.github/workflows/release-tag-changelog.yml`. Examples use only placeholder secrets (`ghp_example`, `octocat/hello`, `fake-token-for-tests`, `release-bot@example.com`); frontmatter unchanged; local anchors and GitHub-blob review-note links checked.
- Verified from repository root: `TMPDIR="$PWD/_tmp-release-tag-review" pnpm --filter @repo-toolkit/publish-packages test` passed (**3 files / 85 tests**, documentation membership/contracts); `TMPDIR="$PWD/_tmp-release-tag-review" pnpm lint` passed; from `website/` working directory with pre-existing prerequisites, `TMPDIR="$PWD/_tmp-release-tag-review" pnpm build` succeeded (Docusaurus production build validates frontmatter/MDX/local links; no install was run from the workspace root). `git diff --check` and `git diff --exit-code HEAD -- CHANGELOG.md` passed.
- Limitations/follow-up: no RTR-08 blocker. Full-workspace checks and the offline packed-consumer smoke remain RTR-09's responsibility. Predecessor changes were preserved; no nested agents, comments, dependencies, commits, root changelog edits, SSH key reads, production releases/pushes, or external services were used. Only RTR-08's status was changed.

### Task RTR-09: Independently Verify The Complete Release Workflow

Status: completed

Kind: investigation

Priority: P1 — final independent evidence is required before this remediation is complete.

Suggested agent: independent-integration-review (a new session, not an implementation agent)

Dependencies: RTR-08

Primary ownership: review of all scoped changes, this task's evidence, and disposable repo-local packed-consumer fixtures. Material newly discovered work requires a separately numbered task and a fresh sequential implementation agent.

Finding: earlier tests passed despite release-integrity and redaction gaps. Final review must verify behavior across CLI, direct stages, orchestration, and installed consumers rather than relying on task statuses alone.

References: all RTR tasks and their tests/evidence; `AGENTS.md`; package exports/bin/build metadata.

Requirements:

1. Review each task's acceptance criteria against source and runtime/test evidence; check boundary bypasses, Git ref preservation, PR identity/merge/delete behavior, credential serialization/errors, no-change behavior, and bounded input/output/cancellation.
2. Run V-final. Use serial workspace tests/builds and repo-local temporary files; do not run the production release command or contact external services.
3. Pack release-tag and its internal dependency into repo-local scratch; exercise an offline consumer's ESM import, TypeScript declaration consumption, installed bin help/dry-run/JSON, and CLI recovery/limit option recognition. Keep generated tarballs/builds ignored.
4. Verify documentation and exported contracts agree, all task statuses/evidence are accurate, `git diff --check` passes, no unintended file is modified, and root `CHANGELOG.md` has no diff.
5. Record blockers as blockers and route necessary follow-ups to the coordinator. Do not silently mark tasks complete or broaden the scope. After all findings are resolved, attest completion of the entire file.

Acceptance criteria:

- V-final and offline packed-consumer checks pass on the final code state; each preceding task has concrete completion evidence.
- No unresolved required task remains pending/in-progress/blocked, and independent review has no unresolved release-integrity, confidentiality, or contract finding in scope.
- Coordinator can confirm every task complete and summarize verification without relying on unrun live services.

Verification: V-final and the offline packed-consumer checks above.

Completion evidence:

- Independent review scope: fresh session; no RTR-01..RTR-08 implementation work performed here. Reviewed all 22 source modules and 17 test files under `packages/release-tag`, package README, website guide, dispatch doc, review notes, and every RTR completion-evidence block. No source, test, doc, or config file was modified by this review; the only edited file is this task record (RTR-09 status + this evidence).
- RTR-01 verified: pure short-ref validation (`src/validation.ts` `assertBranchName`/`assertBaseBranch`/`assertDistinctBranches`, safe-integer versions, owner/repo) wired through `plan.ts`, `determine.ts`, `release.ts`, `pull-request.ts`, `preflight.ts`, `github.ts`, `run.ts`. Runtime probes against built `dist/`: `--mirror`, `-D`, `main:other`, `refs/heads/main`, `a/../b`, `a.lock`, `a@{b`, base/release equality, `1.2.9007199254740992`, `mergeMethod: octopus`, `timeoutMs: 2147483648` all rejected; valid `v1.2.3` plan resolves `tag=1.2.3 branch=changelog/1.2.3 merge=merge timeout=60000 maxOut=1048576`. Dangerous-branch regression table present in `test/validation.test.ts`.
- RTR-02 verified: `src/release-git.ts` verifies checked-out local base/HEAD + clean worktree before config, uses explicit source commit, refuses collisions/tags by default, leases resets via `--force-with-lease`, refuses symbolic aliases (local dangling + remote), checks command availability before mutation, enforces branch/worktree/tag postconditions, returns additive `releasedHead`. Grep confirms no `push --delete`/`branch -D` remains in `src/`; only `process.exitCode = 1` (no `process.exit`). Runtime probe: directly invoked excluded stage returns `stage not selected` with zero process calls. `test/release-lifecycle.test.ts` real-Git suite present (35 cases claimed; file has 62 `it(`/`test(` matches including nested/parameterized forms).
- RTR-03 verified: package-local bounded transport (`src/process.ts`, shared runner untouched per `git diff --exit-code HEAD -- packages/publish-package/src/runner.ts`), combined streaming cap, deadlines with SIGTERM->SIGKILL escalation, captured release output, `GIT_TERMINAL_PROMPT=0` on every child, timer range 1..2147483647. Runtime probes: `timeoutMs` 0/-1/1.5/2147483648/2^53 and `maxOutputBytes` 0/-5/2.5 rejected, `timeoutMs: 1` accepted. `test/process.test.ts` + `test/process-fixture.ts` present; suite green.
- RTR-04 verified: `src/credentials.ts` (65,536-byte regular-file cap, explicit > file > env, pinned per-orchestration context), `src/github.ts` (streamed `min(maxOutputBytes,1MiB)` bodies, deadline through body reads, `redirect: 'error'`), `src/github-url.ts` (HTTPS except loopback, GHES prefixes, no userinfo/query/fragment), `src/diagnostics.ts` (sanitized errors, no raw causes). Runtime probes: 301 redirect rejected; token-bearing 500 body redacted from message+stack with no `cause`; `GITHUB_API_URL` with query rejected at plan time; `https://ghes.example.com/api/v3` preserved. `test/github.test.ts` + `test/credentials.test.ts` present; suite green.
- RTR-05 verified: `src/pull-request-lifecycle.ts` + `src/pull-request-data.ts` implement exact-reuse discovery (`per_page=2`, no pagination following), one create-conflict relookup, case-insensitive repos/case-sensitive refs, fork/ambiguity/mismatch refusal, closed-unmerged guidance, fresh pre-merge detail read, SHA pinning with `releasedHead` comparison, literal `merged === true` gate, guarded GET-ref/DELETE cleanup (204 required, post-confirmation 404 tolerated). Runtime probes with shaped fake fetch: HTTP 200 `merged:false` and missing `merged` both threw `did not confirm merged === true` with zero DELETE calls; `merged:true` proceeded to DELETE (fake then 204-mismatched as designed). Non-atomic GET/DELETE limitation documented in review notes §RTR-05, README, and website guide.
- RTR-06 verified: `src/conventional-commits.ts` NUL-record parsing (first-line header, `!` major, uppercase column-zero breaking footers, case-insensitive types, no allowlist), `noChanges`/`allowEmptyRelease` contract in `determine.ts`/`plan.ts`/`run.ts` (no-change bypasses preflight/identity/token/release/PR), safe-integer bump validation. Runtime probes: `feat:`->minor, body `feat:`->patch, `fix!:`->major, `fix: handle a!:b`->patch, `BREAKING CHANGE:` footer->major, indented footer->patch, `FEAT(api):`->minor; empty range returns `{version 1.2.3, bump null, noChanges true}`. `test/determine-git.test.ts` real-Git cases present; suite green.
- RTR-07 verified: `src/recovery.ts` read-only PR-only composition (explicit tag+base required before I/O incl. dry-run, pinned tag read, local+origin ref checks, absent-origin accepted only for verified already-merged identity, no config/checkout/reset/push/fetch/branch/tag/update-ref, no release execution), `src/cli-options.ts` import-safe SPECS (repeatable raw `--release-arg`, strict `--timeout-ms` 1..2147483647 / `--max-output-bytes` positive safe integer, `--reset-release-branch`/`--allow-empty-release` negatable, `--merge-method` enum), `src/format.ts` schema-1 JSON/text renderers, thin `src/cli.ts` (parse/execute/format + `main().catch` with `process.exitCode`). Runtime CLI probes: `--only pr --dry-run` without inputs fails; `--only pr --tag/--base-branch --dry-run` succeeds; `--dry-run --json` parses with `schemaVersion: 1`; all seven new flags reflected in dry-run output; `--timeout-ms 0` and `--merge-method octopus` rejected. Import-safety: helpers live outside executable `cli.ts`.
- RTR-08 verified: docs-only claim holds (no src/test change since RTR-07; suite still 17 files / 1025 tests). All 29 SPECS flags appear verbatim in built `--help`, package README flag table, and website guide (scripted cross-check, zero missing). Defaults agree everywhere (`release-it` path, `github-actions[bot]` identity, 60000 ms, 1048576 bytes, `merge`). Schema-1 shapes, result types (`DeterminedTag`/`ReleaseBranchResult`/`PullRequestResult` incl. `noChanges`/`releasedHead`/`reused`), public exports (7 functions + documented types), serialized-Actions `cancel-in-progress: false` example, placeholder-only secrets, and residual-race/preflight-limit statements match finished code. Root `CHANGELOG.md` untouched.
- V-final, run serially from repository root, all PASS: `pnpm lint` (9 s, clean); `pnpm typecheck` (10 s, clean); `TMPDIR="$PWD/_tmp-release-tag-review" pnpm build` (15 s, success); `TMPDIR="$PWD/_tmp-release-tag-review" pnpm test` (224 s, exit 0; **112 files / 3061 tests passed, 0 failed**: publish-package 8/215, changelog 3/81, compose-sandbox 18/225, confluence 7/354, docker-publish 9/227, go-release 9/105, publish-packages 3/85, release-artifact 1/101, release-tag 17/1025, secret-sync 37/643); `git diff --check` clean; `git diff --exit-code HEAD -- CHANGELOG.md`, package manifests/`pnpm-lock.yaml`, and `packages/publish-package/src/runner.ts` all empty. A second full `pnpm test` re-run for log capture also exited 0 with identical totals. Test-count chain matches evidence (RTR-07: 17/1025; RTR-08 docs-only). No production release command run; no external services contacted.
- Offline packed-consumer smoke (all under ignored `_tmp-release-tag-review/packed-consumer/`, tarballs kept in scratch): `pnpm pack` produced `repo-toolkit-publish-package-0.0.0-PLACEHOLDER.tgz` (41,704 B) and `repo-toolkit-release-tag-0.0.0-PLACEHOLDER.tgz` (60,442 B); tarball contains only `dist/cli.js`, `dist/index.js`, `dist/index.d.ts`, `package.json`, `README.md`, `LICENSE` (no src/test leakage); `workspace:*` rewritten to `0.0.0-PLACEHOLDER`. Consumer with manually placed packages + workspace-sourced `@clack/prompts` closure (offline substitute for registry install): ESM import resolves plan (`1.2.3`/`changelog/1.2.3`/`merge`/60000/1048576), all five stage functions callable, `formatPullRequestBody` renders, `runReleaseTag` dry-run returns `dryRun: true` with null stages; `tsc --noEmit --strict` on a `consumer.ts` exercising `ReleaseTagOptions`/`ReleaseTagPlan`/`ReleaseTagResult`/`DeterminedTag`/`ReleaseBranchResult`/`PullRequestResult`/`ReleaseTagMergeMethod` passes clean; installed bin `--help` (exit 0), `--dry-run` (exit 0), `--dry-run --json` (parses, `schemaVersion: 1`); `--only pr`/`--release-arg`/`--timeout-ms`/`--max-output-bytes`/`--reset-release-branch`/`--allow-empty-release`/`--merge-method` all recognized and reflected; `--only pr --dry-run` without tag/base fails with the documented recovery-input error. One self-inflicted extraction overwrite (both tarballs unpacked to the same `package/` dir) was detected via a self-import error and redone cleanly; packed bytes themselves were never at fault.
- Boundaries honored: no nested agents, commits, root `CHANGELOG.md` edits, code comments, new dependencies, production releases/pushes, external services, or reads of ignored SSH keys (`id_ed25519*` untouched). Scratch confined to ignored `_tmp-release-tag-review/` (`_tmp*` gitignore rule; also covers `*.tgz`). No absolute machine paths in this task file (pattern grep for home-dir, user-dir, and drive-letter prefixes returns no matches). Working tree contains only in-scope paths: `packages/release-tag/{src,test,README.md}`, `website/docs/packages/release-tag.md`, `docs/release-tag-dispatch.md`, `docs/release-tag-review-notes.md`, this task file, plus a one-line cross-reference link added to the prior task file `docs/tasks/20261009-091644-release-tag-package.md` (intentional history pointer, its evidence otherwise preserved).
- Findings: none blocking. No new defects discovered; no RTR-10+ follow-up proposed. Known documented limitations accepted as designed: non-atomic REST GET-ref/DELETE cleanup, tag/branch moves after inspection relying on later head checks, nontransactional preparation, custom-transport responsibilities, preflight fail-fast-only semantics, deferred prereleases/tag-prefixes/per-package versioning/auto-merge queueing.

Attestation: as the independent RTR-09 reviewer (new session, no implementation authorship in RTR-01..RTR-08), I verified each task's acceptance criteria against source, tests, built output, and fresh runtime probes; ran the full V-final serially with the totals above; completed the offline packed-consumer ESM/types/bin/flags smoke; confirmed docs/contracts/task-evidence accuracy with no unintended diffs; and found no unresolved release-integrity, confidentiality, or contract issue in scope. RTR-01 through RTR-09 are complete with completion evidence. Overall file status is left `in_progress` for the coordinator's final status/evidence/diff review per the Definition of Done.

## Consequential Deferrals And Limitations

- Prerelease channels, configurable tag prefixes, and per-package monorepo histories require version-policy/API design beyond the current stable single-version product. Current stable-tag selection remains explicit; unrelated/nonconforming latest tags still produce guidance rather than automatic reinterpretation.
- Queueing GitHub auto-merge, automatic retries/backoff for all API mutations, and a distributed release lock are not included. Immediate merge is retained; exact PR reuse, observed ref leases, head checks, and documented CI serialization address the concrete recovery risks here without promising a distributed transaction.
- Signing-key import and live GHES contracts remain the original plan's deferred concerns. Local real-Git and fake HTTP evidence cannot certify live organization policies or external endpoint availability.

## Definition Of Done

- RTR-01 through RTR-09 are `completed`, each with `Completion evidence`, and any necessary discovered follow-up is implemented and independently verified.
- Required package, workspace, documentation-contract, and offline consumer checks pass for the final state.
- Every implementation task was assigned to a fresh isolated sub-agent and executed sequentially; the final reviewer is independent.
- Product behavior, public types, CLI help, examples, and migration notes agree. No production release/push or external credential test was performed, no changes were committed, and root `CHANGELOG.md` remains unchanged.
- Coordinator performs a final status/evidence/diff review after the final sub-agent finishes and updates this document's overall status.
