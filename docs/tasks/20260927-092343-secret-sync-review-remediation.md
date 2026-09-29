# Secret-sync reliability, safety, and usability remediation

Created: 2026-09-27 09:23:43 (local)

## Objective and business requirements

`@repo-toolkit/secret-sync` synchronizes explicitly selected secret files between developer/CI worktrees and 1Password Connect or the direct SDK. Its distinguishing requirements are exact-byte preservation, three-way conflict detection, immutable remote history, branch isolation within a vault, metadata-only diagnostics, bounded operations, and recoverable local materialization. Reliable credential rotation, onboarding, environment switching, and recovery matter more than adding another provider or command.

This review implements concrete gaps in those promises across usability, readability, security, performance/resource bounds, encapsulation, reusability, and testability. Shared enforcement belongs in filesystem/provider/journal boundaries; deterministic fault-injection tests accompany fixes.

Scope: `packages/secret-sync` and this execution record. Do not modify `CHANGELOG.md`, commit changes, introduce dependencies, or perform live-vault operations. Record externally visible behavior changes in the package README. Website is a separate project; changes there require its own working-directory instructions and are not required by this plan.

Execution scope adjustment: SS-00 narrowly fixes an existing timing-sensitive Compose sandbox test that blocked the mandatory repository suite twice during SS-01. No Compose runtime change is authorized.

## Analysis coverage and baseline

- Initial worktree: clean (`git status --short`). Read root `AGENTS.md`; no package-specific instructions found.
- Reviewed package README, CLI/config/output, Connect/SDK adapters, discovery/history loading, state locks, filesystem writes, journal recovery, pull/restore/rollback/branches and corresponding tests. Two read-only analysis agents ran sequentially with separate scopes.
- Existing plans: [original package](20260920-100015-secret-sync-package.md), [direct SDK](20260920-152444-secret-sync-direct-onepassword.md). Findings below are newly identified acceptance gaps in completed tasks, not duplicate pending implementation. Preserve those historical records.
- Baseline tests not run: static source/test inspection established the findings; tests will run during implementation. Live 1Password quotas, visibility, permissions, and platform behavior remain unverified. This is a bounded review, not an exhaustive security audit.
- Performance evidence: `history-store.ts:loadRawHistory` performs one listing plus one detail read per matching record; `log.ts:logFileHistory` applies the requested limit after graph validation. No benchmark or speedup is claimed. SDK timeout overlap below is an independently testable resource-bound defect.

## Execution and verification rules

- P1: possible lost work, broken recovery, or unbounded operations; P2: important usability improvement.
- Run tasks **sequentially**, using a fresh isolated sub-agent session for every task. Actual order: SS-01, discovered verification blocker SS-00, then SS-02 through SS-09. Never run concurrent builds or allow sub-agents to delegate further.
- Coordinator marks each task `in_progress` before dispatch. Agent records changed files, actual verification commands/results and `Completion evidence`; mark `completed` only when its criteria and required checks pass. Add discovered necessary requirements explicitly; independent findings get a new task after deduplication.
- All command working directories are `<repo-root>`, unless stated otherwise. Dependencies are already installed; Node >=20, pnpm, and GNU-compatible tar are needed for repository tests. No credentials, Docker daemon, or network are needed for secret-sync fixtures.
- For each implementation task run `pnpm --filter @repo-toolkit/secret-sync test`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` as required by AGENTS.md. Repository tests rebuild dependency outputs; serialize them. Do not repeat a passed check without a subsequent change or unresolved concern.
- Final reviewer checks aggregate evidence and runs checks only if changes or unresolved concerns warrant repetition. Validate generated public declarations/CLI build through package build in test scripts; no runtime dependency/packaging changes are intended.
- Definition of done: every task has passed acceptance criteria and concrete completion evidence; final independent review confirms docs/types/runtime agree and all required checks pass. No task remains pending, blocked, or in progress.

## Tasks

### Task SS-00: Make the blocking SIGINT cleanup test deterministic

Status: completed

Kind: defect

Priority: P1 — blocks required repository validation of every implementation task.

Suggested agent: isolated test-fixture implementer.

Dependencies: none; discovered during SS-01 verification and executed before SS-02.

Primary ownership: `packages/compose-sandbox/test/emergency-cleanup.test.ts`, this task's evidence.

Finding: the “run-level SIGINT preserves primary and still runs down with live signal” test emits SIGINT after 10 ms rather than after entry into the intended test phase. Twice the timer fired during preparation and `cleanupSignals.length` was zero. This is unrelated to secret-sync imports/runtime but blocks `pnpm test`.

References: `packages/compose-sandbox/test/emergency-cleanup.test.ts:446–472`; SS-01 failed full-suite evidence.

Requirements:

1. Synchronize cancellation with entry into the fake hanging test process, after installing its abort handler; preserve assertions for primary failure, fresh evidence/cleanup signals, and listener cleanup.
2. Change only the fixture, avoiding longer wall-clock sleeps or production behavior changes.

Acceptance criteria:

- Regression exercises cancellation during actual test execution deterministically and retains its lifecycle assertions.
- Focused test and required repository checks pass.

Verification: `pnpm --filter @repo-toolkit/compose-sandbox test`, `pnpm lint`, `pnpm typecheck`, `pnpm test`; all at repository root. A passing final full-suite check also resolves SS-01's verification blocker (coordinator updates SS-01 separately).

Completion evidence:

- Changed: `packages/compose-sandbox/test/emergency-cleanup.test.ts` and only SS-00 status/evidence in this task file.
- Resolution: the fake hanging test process emits SIGINT immediately after registering its abort handler, replacing the external 10 ms timer. Cancellation therefore occurs during test execution; existing primary SIGINT failure, live evidence/cleanup signal, and listener-cleanup assertions are retained. No runtime changes or longer sleeps.
- `pnpm --filter @repo-toolkit/compose-sandbox exec vitest run --config vitest.config.ts test/emergency-cleanup.test.ts` — passed, 1 file / 12 tests.
- `pnpm --filter @repo-toolkit/compose-sandbox test` — passed, 18 files / 225 tests; dependency, CLI, and declaration builds passed.
- `pnpm --filter @repo-toolkit/secret-sync test` — passed, 31 files / 408 tests; dependency, CLI, and declaration builds passed.
- `pnpm lint` — passed. `pnpm typecheck` — passed. `git diff --check` — passed.
- `pnpm test` — passed, all 9 packages / 89 files / 1,801 tests: publish-package 215, changelog 81, compose-sandbox 225, confluence 354, docker-publish 227, go-release 105, publish-packages 85, release-artifact 101, secret-sync 408. Commands/builds ran sequentially; the root suite uses `--workspace-concurrency=1`.
- Blockers: none; no unrelated full-suite failures occurred. Existing secret-sync work and SS-01 were preserved; coordinator can reconcile SS-01's verification blocker using this passing full-suite result. `CHANGELOG.md` was not modified; no comments, dependencies, or commits were added.

### Task SS-01: Preserve exclusive locks held by live owners

Status: completed

Kind: defect

Priority: P1 — overlapping mutation can corrupt journals/baselines and lose work.

Suggested agent: state-lock correctness implementer.

Dependencies: none.

Primary ownership: `packages/secret-sync/src/state.ts`, `test/state.test.ts`, relevant operation regression tests and README.

Finding: `acquireStateLock` considers a lock stale after 30 seconds even when its PID is alive; no heartbeat exists. The test named “not from live owners” actually expects takeover of an aged lock owned by `process.pid`.

References: `state.ts:acquireStateLock` (original lines 821–836); `test/state.test.ts:309–330`; original SECSYNC-06 live-owner requirement.

Requirements:

1. Never reclaim a positively live same-host owner merely due to timestamp age. Handle indeterminate liveness conservatively; retain dead-owner recovery and nonce-safe release.
2. Update the lock behavior documentation if needed; do not add a forced unlock workflow.

Acceptance criteria:

- Contender time beyond stale threshold still returns `lock-busy` for a live owner with unchanged nonce.
- Dead-owner takeover remains valid; a paused mutation excludes a competing mutation.

Verification: shared implementation checks; deterministic lock/operation regression tests.

Completion evidence:

- Implementation and SS-01 acceptance regressions are complete; completion status is blocked on the required full-repository test check below.
- Changed: `packages/secret-sync/src/state.ts`, `packages/secret-sync/test/state.test.ts`, `packages/secret-sync/test/pull.test.ts`, `packages/secret-sync/README.md`, and only SS-01 in `docs/tasks/20260927-092343-secret-sync-review-remediation.md`.
- Resolution: valid owner locks are reclaimed only on an `ESRCH` PID probe. Live owners and indeterminate probes remain busy regardless of timestamp age. Dead-owner recovery, malformed-lock age handling, and nonce-safe release are retained; runtime lock-limit text and README describe the behavior.
- Regression evidence: a real live PID retains identical lock bytes/nonce with contender time advanced 60 seconds; `EPERM`, `EACCES`, `EIO`, and errors without a code retain aged locks; confirmed dead owners permit immediate takeover; stale release preserves a replacement nonce. A deferred pull excludes a competing push after a 60-second clock advance, preserves state/journal/worktree while paused, then completes and releases ownership normally.
- Before the fix: `pnpm --filter @repo-toolkit/secret-sync exec vitest run --config vitest.config.ts test/state.test.ts test/pull.test.ts` — failed as expected (6 failed, 20 passed), including the overlapping pull/push regression.
- After the fix: `pnpm --filter @repo-toolkit/secret-sync test` — passed, 31 files / 408 tests; dependency, CLI, and public declaration builds passed. `pnpm lint` — passed. `pnpm typecheck` — passed. `git diff --check` — passed.
- `pnpm test` — failed twice, with builds serialized by the root script (`--workspace-concurrency=1`). Both runs passed publish-package (215 tests) and changelog (81 tests), then failed the same unrelated compose-sandbox test (224 passed, 1 failed): `packages/compose-sandbox/test/emergency-cleanup.test.ts:472`, “run-level SIGINT preserves primary and still runs down with live signal”, expected `cleanupSignals.length > 0`, received 0. Its 10 ms timer at line 461 fired during preparation in both runs. The full suite did not finish; later package tests are not claimed as passed.
- Blocker/follow-up owner: coordinator or compose-sandbox maintainer must resolve the unrelated timing-sensitive fixture and obtain a passing `pnpm test` before marking SS-01 completed. No compose-sandbox files were changed. No SS-01 implementation blocker remains; other task items and `CHANGELOG.md` were not modified.
- Blocker resolved by SS-00: deterministic fixture now passes; `pnpm test` passed across 9 packages / 89 files / 1,801 tests, secret-sync 408 tests, lint/typecheck passed. SS-01 is completed with its original failed runs retained above for traceability.

### Task SS-02: Guard atomic writes against changed destination content

Status: completed

Kind: defect

Priority: P1 — regular editor saves can be silently overwritten.

Suggested agent: filesystem-boundary implementer.

Dependencies: SS-01.

Primary ownership: `src/filesystem.ts`, worktree write callers (`pull.ts`, `restore.ts`, `rollback.ts`, `branches.ts`), focused tests, README (all under `packages/secret-sync`).

Finding: `replaceAtomically` rechecks only destination kind after temp-file write/fsync. Pull checks its fingerprint earlier. `test/filesystem.test.ts`’s “refuses unexpected concurrent edits” test expects an injected regular-file edit to be overwritten. Errors during some temp-write/recheck stages can also bypass temp cleanup; address this as part of guarded replacement.

References: `filesystem.ts:replaceAtomically` (218–272), `pull.ts` (376–406), `test/filesystem.test.ts` (248–264); original SECSYNC-06/07.

Requirements:

1. Add an explicit expected-destination preimage/absence contract at the shared write boundary and carry preflight expectations from worktree-mutating callers.
2. Recheck immediately before rename, after injectable hooks. Preserve deliberate export-overwrite semantics. Do not claim filesystem compare-and-swap; document residual races accurately.
3. Clean up plaintext temporary files on every pre-rename failure, including hooks and ancestor/content checks.

Confirmed implementation boundary and necessary scope:

- Guard all six worktree write sites: pull download, ordinary and acknowledging restore, published and already-published rollback materialization, and switch download. Carry the original scan/read expectation even when an operation hook runs before filesystem entry; `restore --overwrite` authorizes only the preflight content.
- Already-published rollback must propagate preflight read failures rather than converting an unreadable file into an expected absence; this is necessary for a proven write preimage and does not change recovery provenance rules.
- Keep `writeExportFileAtomically` deliberately overwriting regular files, while sharing full temp lifecycle cleanup. Exclusive temp creation and ownership tracking are necessary to clean partial writes without deleting a pre-existing colliding temp path.
- Direct worktree helper calls without a supplied preflight expectation capture content/absence at boundary entry. Expectations remain internal; no output/state schema changes. Removals, rollback recovery provenance (SS-03), and switch selection/recovery (SS-04/05) are outside this replacement boundary.
- Cleanup covers failures while the temp path remains addressable; filesystem refusal and concurrent ancestor relocation can defeat path-based cleanup. Document this and the residual recheck-to-rename race without claiming compare-and-swap or editor exclusion.

Acceptance criteria:

- Same-length content changes, absence becoming presence, and presence becoming absence are refused without overwriting the competing edit.
- A fault injected during a real operation does not advance baseline and leaves no temp plaintext behind.
- Safe ordinary writes and explicit export overwrite still work; fingerprints/content do not enter public output.

Verification: shared implementation checks; filesystem and operation fault-injection regressions.

Completion evidence:

- Changed: `packages/secret-sync/src/filesystem.ts`, `src/pull.ts`, `src/restore.ts`, `src/rollback.ts`, `src/branches.ts`, `test/filesystem.test.ts`, `test/filesystem-faults.test.ts` (new), `test/write-operations.test.ts` (new), `test/rollback.test.ts`, and `README.md` (all abbreviated paths under `packages/secret-sync`); only SS-02 in this task file.
- Resolution: shared content/length-or-absence expectation checked after injectable hooks immediately before rename, supplied from preflight at every worktree replacement site. Existing direct helper calls snapshot at entry. Export retains deliberate overwrite. Temp files are exclusively opened, ownership-tracked, closed in `finally`, and unlinked on every owned pre-rename failure. Already-published rollback propagates unreadable preflight errors. README/runtime limits accurately distinguish this from compare-and-swap and document cleanup limitations.
- Regression evidence: same-length text/binary edits, length changes, absent-to-empty and empty-to-absent transitions before entry/after temp write/before rename; exact binary and empty preimages at the byte bound; all six real operation paths reject late edits or injected temp failures while preserving persisted baselines/heads/branch metadata and leaving no temp plaintext; pull/switch journals remain pending. Export overwrite on concurrent edit/create/remove and existing ordinary write/export tests pass. No new fingerprints or content enter operation results.
- Cleanup fault evidence: worktree and export open, partial write, chmod, fsync, close, rename, ancestor-check, destination-kind-check and hook failures; preimage read failure/disappearance; exclusive-create collision preserves another writer's temp. Tests verify owned handles close and temp plaintext is absent after failure.
- Initial focused command: `pnpm --filter @repo-toolkit/secret-sync exec vitest run --config vitest.config.ts test/filesystem.test.ts test/filesystem-faults.test.ts test/write-operations.test.ts` — 57 passed / 3 failed on a Buffer-versus-Uint8Array assertion in the new fixture; corrected the assertion. Subsequent package/full suites pass all these tests.
- Final required sequence (serial, repository root): `pnpm --filter @repo-toolkit/secret-sync test` — passed, 33 files / 456 tests, including dependency/CLI/public declaration builds; `pnpm lint` — passed; `pnpm typecheck` — passed; `pnpm test` — passed, 9 packages / 91 files / 1,849 tests (publish-package 215, changelog 81, compose-sandbox 225, confluence 354, docker-publish 227, go-release 105, publish-packages 85, release-artifact 101, secret-sync 456). `git diff --check` — passed.
- Run history: the first full-suite invocation was terminated by the tool's 120-second timeout during publish-packages build after six packages passed; rerunning with a 600-second tool timeout passed. Final review then corrected the operation test's heads assertion to use `state.heads`; the complete required sequence was rerun and passed on that final test revision. No production/test timeout was increased.
- Blockers: none. Earlier SS-00/SS-01 changes are preserved. SS-03 onward, `CHANGELOG.md`, and website files were not edited; no comments, dependencies, delegation, or commits were added.

### Task SS-03: Bind rollback recovery to a proven interrupted operation

Status: completed

Kind: defect

Priority: P1 — stale baselines currently authorize overwriting dirty files.

Suggested agent: rollback recovery implementer.

Dependencies: SS-02.

Primary ownership: `src/rollback.ts`, shared journal/state recovery metadata only as needed, `test/rollback.test.ts`, README.

Finding: when requested revision already equals the remote tree, `rollbackFile` treats a baseline pointing elsewhere as recovery without proving a matching interrupted rollback or checking its original local preimage. Another writer advancing remote, or a user editing between failed rollback and retry, can cause lost edits.

References: `rollback.ts:rollbackFile` (215–274); `test/rollback.test.ts` dirty test (159–176) and recovery test (180–225); original SECSYNC-08.

Requirements:

1. Persist/reuse minimal metadata proving operation/path/branch/commit provenance and allowed preimage or already-materialized target. No secret bodies in state/journal.
2. Otherwise apply the clean-worktree rule. Preserve genuine publish-then-materialization/state-save failure recovery without duplicate remote commits.

Acceptance criteria:

- Stale baseline plus dirty local file targeting the current remote revision refuses and preserves file/baseline; differing unbased content also refuses.
- Genuine interrupted rollback resumes without an extra commit.
- Editing before retry refuses and retains sufficient recovery evidence.

Verification: shared implementation checks; rollback regressions including publish/write/save fault boundaries.

Confirmed implementation boundary and necessary scope additions:

- Extend identity-bound `SecretSyncState` with optional, strictly validated metadata-only `recovery`, using existing atomic 0700/0600 persistence. Save original HMAC/length-or-absence, operation/path/blob/branch/source-and-target commit provenance before publication; retire the proof in the same save as the final baseline. This avoids separate proof-cleanup/state-save crash windows and preserves existing state without the optional field.
- Reuse persisted operation IDs, commit IDs, timestamp, and message when retrying an interruption before publication while the source head remains current. Refuse mismatched pending operations or advanced heads without replacing evidence. Already-published recovery must match the remote operation kind/ID, commit, parent, branch, path, and blob; legacy operation records alone are insufficient.
- Reuse the state-level `LocalPreimage`, capture/match helpers, and file-list recovery shape as the minimal foundation for SS-05. Only rollback recovery is accepted/implemented now; switch source/target metadata, verified journal progress, selection, and removal semantics remain SS-04/05 work.
- Add state-schema validation coverage in `test/state.test.ts` alongside rollback fault-injection tests; preserve all SS-02 expected-destination guards and output contracts.

Completion evidence:

- Changed: `packages/secret-sync/src/rollback.ts`, `src/state.ts`, `test/rollback.test.ts`, `test/state.test.ts`, and `README.md` (abbreviated paths under `packages/secret-sync`); only SS-03 in this task file. Earlier SS-00/01/02 work is preserved.
- Validated the flaw before implementation: `pnpm --filter @repo-toolkit/secret-sync exec vitest run --config vitest.config.ts test/rollback.test.ts` — 4 failed / 6 passed. Both dirty stale/unbased cases and edits before write/state-save retry resolved successfully instead of refusing, confirming unproven overwrite authorization.
- Resolution: pending proof is atomically persisted before publication with the original keyed preimage or absence and exact operation/branch/path/blob/source/target commit binding. Retries reuse original publication metadata and require the matching remote rollback receipt. Without proof, different local content refuses; matching local target content can be acknowledged safely. Already-materialized targets are verified without rewriting. Baseline/head acknowledgment and proof retirement share one atomic save; failed writes/saves and rejected retries retain persisted evidence.
- Regression evidence: dirty stale and unbased files; before/after-publication interruption; actual atomic-write temp failure and cleanup; failed proof persistence preventing publication; final state-save failure followed by retry without another write; same-length edits, removals, absence-to-empty creation; mismatched operation/commit/branch/path/revision, advanced remote head, and legacy records without proof. Tests assert unchanged baseline/heads on interruption, original proof retention, exact commit count, original timestamp/message reuse, successful proof retirement, 0700/0600 modes, metadata-only state/results, and strict rejection of malformed/body-bearing recovery fields. Existing SS-02 operation guards pass unchanged.
- Focused post-fix check: `pnpm --filter @repo-toolkit/secret-sync exec vitest run --config vitest.config.ts test/rollback.test.ts test/state.test.ts test/write-operations.test.ts` — passed, 3 files / 65 tests. Final persistence-metadata assertions were subsequently included in the required package/full suites below.
- Final required sequence, serial at repository root: `pnpm --filter @repo-toolkit/secret-sync test` — passed, 33 files / 478 tests, including dependency/CLI/public declaration builds; `pnpm lint` — passed; `pnpm typecheck` — passed; `pnpm test` — passed, 9 packages / 91 files / 1,871 tests (publish-package 215, changelog 81, compose-sandbox 225, confluence 354, docker-publish 227, go-release 105, publish-packages 85, release-artifact 101, secret-sync 478). `git diff --check` — passed.
- SS-05 handoff: reuse `captureLocalPreimage`, `matchesLocalPreimage`, and atomic `state.recovery` persistence/retirement in `src/state.ts`. Extend the currently rollback-only recovery discriminator/validator with switch-specific source/target branches and commits, selected file actions (including removal), and journal-operation binding. Do not infer switch progress from a stale baseline or an unrelated journal; SS-05 still needs verified completed writes, edit checks, and real second-file/save-failure tests. No switch recovery or selection behavior was implemented here.
- Blockers: none for SS-03. Advanced-head and mismatched retries intentionally refuse while retaining evidence; automatic reconciliation of those cases is outside this task. SS-04 onward remains pending. No comments, dependencies, delegation, or commits were added; `CHANGELOG.md` and website files were not edited.

### Task SS-04: Apply file selection consistently during branch switch

Status: completed

Kind: defect

Priority: P1 — switch modifies explicitly excluded files.

Suggested agent: branch-selection implementer.

Dependencies: SS-03.

Primary ownership: `src/branches.ts`, `src/index.ts` switch dispatch, branch/API tests, README.

Finding: `SwitchOptions` lacks a matcher/selection input and switch candidates include every baseline/current/target path. Dispatcher passes no configured selection. Narrowed `files` or `ignore` therefore does not protect a formerly tracked file during switch.

References: `branches.ts:SwitchOptions` (96–111), `switchBranch` (399–405); `index.ts` switch dispatch (973–985); `test/branches.test.ts` (131–209); original SECSYNC-02/05/08.

Requirements:

1. Reuse existing selection enforcement for cleanliness checks, writes, removals, and acknowledgments in real and dry-run switch paths.
2. Preserve out-of-selection files and baselines; do not add unrelated CLI flags.

Acceptance criteria:

- API integration narrows selection after tracking two files; switch preserves excluded bytes/baseline.
- Dirty ignored files do not block switch; target-only excluded and permanently excluded paths are never materialized.
- Dry-run uses the same selected action set and remains write-free.

Verification: shared implementation checks; `runSecretSync` selection/ignore/permanent-exclusion regressions.

Completion evidence:

- Changed: `packages/secret-sync/src/branches.ts`, `src/index.ts`, `test/switch-selection.test.ts` (new), and `README.md` (abbreviated paths under `packages/secret-sync`); only SS-04 status/evidence in this task file.
- Resolution: switch dispatch supplies the existing `createSelectionMatcher` with configured `files`, `ignore`, and the root-relative config exclusion. Shared `planSwitchWorktree` filters the baseline/current/target union before local scans and cleanliness checks; the resulting selected paths govern downloads, guarded removals, same-branch acknowledgments, and final baseline updates. Excluded bytes/baselines remain intact. No duplicate discovery/history scan or new CLI flags.
- Dry-run contract: uses the same selected cleanliness checks and action planning as execution, including current-only removals and baseline-only acknowledgments; reports planned `downloaded`, `removedLocal`, and `acknowledged` paths. Whole-tree snapshots assert unchanged file/directory membership, modes, and bytes, including state/operation records, and an uninitialized-root case proves no state/lock/journal creation. Store create counters remain unchanged during switching.
- API regression evidence: 11 new tests cover narrowed inclusions and ignore precedence with clean/dirty formerly tracked files, excluded update/removal/unchanged/target-only paths, an ignored tracked path replaced by a directory, selected dirty refusal in dry and real runs, config/`.git`/state exclusions with broad globs and remote records, an empty selection, current-only and baseline-only candidates, and selected baseline/head/branch acknowledgment. Low-level `switchBranch` retains all tracked paths when optional `matchesPath` is omitted, verified using non-default JSON paths; README documents this compatibility boundary and config-aware matcher usage.
- Focused check: `pnpm --filter @repo-toolkit/secret-sync exec vitest run --config vitest.config.ts test/switch-selection.test.ts test/branches.test.ts test/write-operations.test.ts` — passed, 3 files / 30 tests before the final two selection regressions were added; both additions passed in the required package/full suites.
- Final required sequence, serial at repository root: `pnpm --filter @repo-toolkit/secret-sync test` — passed, 34 files / 489 tests, including dependency/CLI/public declaration builds; `pnpm lint` — passed; `pnpm typecheck` — passed; `pnpm test` — passed, 9 packages / 92 files / 1,882 tests (publish-package 215, changelog 81, compose-sandbox 225, confluence 354, docker-publish 227, go-release 105, publish-packages 85, release-artifact 101, secret-sync 489). `git diff --check` — passed; generated public declarations include optional `matchesPath`.
- SS-05 handoff: shared `planSwitchWorktree` now owns selected candidate scanning, cleanliness checks, and action planning; real execution currently invokes it before existing journal inspection. Integrate proven recovery with that boundary so verified completed writes can pass preflight without weakening ordinary selected-file checks. Bind proof to selected actions/source/target and journal operation identity, retain excluded baselines, and preserve SS-02 `expectedDestinationFromBytes(planned)` guards and SS-03 atomic `state.recovery` persistence/retirement. Genuine partial-switch recovery remains SS-05; none was implemented here.
- Blockers: none. SS-01–03 code and regression coverage are preserved. No comments, dependencies, delegation, or commits were added; `CHANGELOG.md` and website files were not edited.

### Task SS-05: Resume genuinely partial branch switches

Status: completed

Kind: defect

Priority: P1 — interrupted switch leaves a mixed-branch worktree that cannot resume.

Suggested agent: branch-recovery implementer.

Dependencies: SS-04.

Primary ownership: `src/branches.ts`, journal/state recovery boundary as needed, `test/branches.test.ts`, README.

Finding: `switchBranch` calls `recoverJournal` but ignores verified entries when checking cleanliness against the old branch. After its first replacement, retry interprets its own writes as dirty. Existing partial-write test throws before the first sorted file, so it never exercises partial materialization.

References: `branches.ts:switchBranch` (396–428 and 564–605); `test/branches.test.ts` (155–208); original SECSYNC-06/08.

Requirements:

1. Bind recovery to source/target operation metadata and verified journal writes, reusing SS-03 abstractions where appropriate.
2. Resume completed writes without rewriting them. Preserve old active/materialized branch metadata until completion; reject unrelated journals, different target retries, and intervening edits.

Acceptance criteria:

- Fail before second replacement after proving first changed; retry succeeds with correct final bytes, branches, baselines and journal cleanup.
- Failure after all writes before state save resumes successfully.
- Editing a completed file or retrying a different target refuses safely.

Verification: shared implementation checks; actual partial-progress and save-failure regressions.

Confirmed implementation boundary and necessary scope additions:

- Extend the SS-03 recovery union with strictly validated switch source/target branches and heads (including empty heads), original materialized branch, operation ID/timestamp, selected actions and keyed preimages. Verify journal identity, action, target blob/fingerprint, and actual bytes/absence before allowing recovery through SS-04 preflight. Preserve selection/exclusions and unselected baselines; changed selection or heads refuses while retaining proof.
- Guard alternate local mutation entry points (`pull.ts`, `push.ts`, `restore.ts`, `rollback.ts`) while switch proof is pending. This is necessary because pull can consume the same journal and other commands can change baselines or branch metadata; none may repurpose switch evidence. Metadata-only remote operations remain subject to source/target-head checks on retry.
- Cover rename-before-journal-status and final-save/cleanup boundaries in addition to the required second-file failure. Verify completed removals by absence, and permit pending journal entries only with matching original preimages or verified target bytes. Journal acknowledgment precedes the atomic baseline/branch save and proof retirement; retained proof still requires verification of acknowledged entries after a failed save.
- Add focused `test/switch-recovery.test.ts` and state-schema regressions, update the misleading existing partial-write fixture, and document recovery behavior in the package README.

Completion evidence:

- Changed: `packages/secret-sync/src/branches.ts`, `src/switch-recovery.ts` (new), `src/state.ts`, `src/pull.ts`, `src/push.ts`, `src/restore.ts`, `src/rollback.ts`, `test/branches.test.ts`, `test/switch-recovery.test.ts` (new), `test/state.test.ts`, and `README.md` (abbreviated paths under `packages/secret-sync`); only SS-05 in this task file. Earlier task work is preserved.
- Resolution: switch atomically persists source/target/selection-bound proof before journal or worktree mutation. Shared selected preflight verifies operation ID, timestamp, action, blob, keyed fingerprint/length, and actual bytes/absence; retries reuse pending entries and skip completed mutations. Original branches, heads, and baselines remain persisted until final verification. Journal acknowledgment precedes the atomic final state save/proof retirement, so both save failures and post-save cleanup failures recover without rewriting files. No pull-kind operation record or unrelated journal can authorize switch recovery.
- Regression evidence: the existing partial-write fixture now fails before the second file and asserts the first really changed. The new 38-test suite covers second-write/second-removal interruption; actual state-file rename failure after all writes; replacement before journal status persistence; failed initial proof persistence; cleanup failure after successful state save; edited, removed, or reverted completed files; edited unfinished files and absent-to-empty creation; acknowledged write/removal edits after save failure; wrong target/source/operation; changed selection/source or target head; mismatched/missing/unrelated journal entries and journal-only legacy evidence; empty source/target heads and empty selections. Spies prove completed writes/removals are not repeated. Assertions cover exact final bytes, selected baselines/heads/branches, excluded dirty bytes and baselines, journal cleanup, original proof retention on refusal, no remote creates, 0700/0600 modes, metadata-only persisted state/results, and write-free dry-run snapshots. Added strict switch-state schema tests alongside existing rollback validation.
- Alternate mutation evidence: pull (including empty-remote branch handling), push, restore with overwrite, acknowledging restore, and rollback all refuse pending switch recovery without changing files, state, journal, or remote create counts; the original switch then resumes successfully. Existing SS-02 write guards, SS-03 rollback regressions, and SS-04 selection tests pass.
- Focused run history: `pnpm --filter @repo-toolkit/secret-sync exec vitest run --config vitest.config.ts test/switch-recovery.test.ts test/branches.test.ts test/state.test.ts test/switch-selection.test.ts test/write-operations.test.ts` initially passed 81 tests and failed 5 because the new fixture attempted to spy on native ESM `fs.rename`. Added the existing repository-style `node:fs/promises` mock wrapper; `pnpm --filter @repo-toolkit/secret-sync exec vitest run --config vitest.config.ts test/switch-recovery.test.ts` then passed all 33 tests present at that point. Subsequent edge-case additions passed in both required suites below.
- Final required sequence, serial at repository root: `pnpm --filter @repo-toolkit/secret-sync test` — passed, 35 files / 528 tests, including dependency/CLI/public declaration builds; `pnpm lint` — passed; `pnpm typecheck` — passed; `pnpm test` — passed, 9 packages / 93 files / 1,921 tests (publish-package 215, changelog 81, compose-sandbox 225, confluence 354, docker-publish 227, go-release 105, publish-packages 85, release-artifact 101, secret-sync 528). `git diff --check` — passed.
- Blockers: none. Changed selection or remote heads intentionally refuse while retaining proof; automatic reconciliation remains outside this task. No comments, dependencies, delegation, or commits were added; `CHANGELOG.md` and website files were not edited. SS-06 onward is unchanged.

### Task SS-06: Keep Connect deadlines active through response consumption

Status: completed

Kind: defect

Priority: P1 — stalled bodies hang sync and prevent bounded recovery.

Suggested agent: Connect resource-lifecycle implementer.

Dependencies: SS-05.

Primary ownership: `src/connect.ts`, `test/connect.test.ts`, README.

Finding: `fetchOnce` clears its timeout when headers arrive; `getJson`/`createItem` read bodies afterward. Prompt headers followed by stalled/slow bodies bypass the deadline. Existing timeout fixtures stall before headers only.

References: `connect.ts:fetchOnce` (519–538), `getJson` (566–585), `createItem` (759–764); `test/connect.test.ts` (340–393); original SECSYNC-03.

Requirements:

1. Bound each entire attempt through body consumption. Cancel/abort abandoned response bodies on errors/retries/byte-limit rejection.
2. Preserve bounded GET retries, no authorization redirects, error redaction, and exactly-one POST with uncertain outcome on timeout.

Acceptance criteria:

- Immediate headers then stall before/after a chunk reaches bounded `timeout` with bounded GET attempts and body cleanup.
- POST body timeout returns uncertain with one attempt, never replayed.
- Byte-limit and early-error bodies are cleaned up; valid responses retain current behavior.

Verification: shared implementation checks; controlled streaming/fake-timer adapter regressions.

Confirmed implementation boundary and necessary scope additions:

- Move bounded success-body consumption into the existing Connect attempt boundary so the same timer covers headers and every read without resetting on progress. Race asynchronous fetch, reader/iterator reads, and text fallback against that signal; abort alone cannot bound signal-ignoring injected implementations.
- Extend the existing `readBoundedText` helper with an optional signal and shared failure cleanup, including direct helper use. Explicit iterator reads avoid implicitly awaiting a hanging iterator `return()` during error cleanup. Cancel abandoned readers/bodies or return iterators, release reader locks, suppress cleanup failures, and discard/cancel late headers without launching more body reads.
- Normalize text-fallback read failures to safe `truncated` errors, matching streaming read failures; this is necessary to preserve the safe-error contract across both consumption paths. Cleanup is best-effort: asynchronous cancellation is invoked without waiting indefinitely; synchronously blocking code and underlying implementations that ignore both abort and cancellation cannot be forcibly stopped. README records these limits. No changes outside Connect source/tests, the package README, and this section were needed.

Completion evidence:

- Changed: `packages/secret-sync/src/connect.ts`, `packages/secret-sync/test/connect.test.ts`, and `packages/secret-sync/README.md`; only SS-06 status/scope/evidence in this task file. Root `AGENTS.md` and the task were read first; the requested literal `task/AGENTS.md` path does not exist in this checkout.
- Resolution: each attempt retains its deadline through bounded body consumption. Abandoned attempts abort and cancel before GET backoff; success releases the reader and clears the timer. Default GET retries remain three (four attempts), with existing status mapping and Retry-After behavior. Redirect checks run before body consumption with manual redirect policy. POST timeouts/body failures remain uncertain after one request, including late settlement; auth/validation/redirect rejection behavior is preserved.
- Regression evidence: 23 added tests cover native and injected reader/iterator stalls before/after a chunk; signal-ignoring headers and `response.text()`; delayed headers plus chunks sharing one deadline; cleanup before retries followed by successful streamed JSON; hanging/rejecting/throwing cancellation; native reader unlocking; declared and actual byte-limit rejection; safe read failures; GET/POST early 302/400/401/403/404/429/503 bodies; single-attempt POST headers/reader/text timeouts and oversized success bodies. Assertions verify exact attempts/backoff, aborted signals, cancellation/release counts, no residual deadline timers, no redirected auth, safe errors, and cancellation of late headers. Existing valid-response and workflow tests pass.
- Focused check: `pnpm --filter @repo-toolkit/secret-sync exec vitest run --config vitest.config.ts test/connect.test.ts` — passed, 1 file / 50 tests before the final four native-stream/POST byte-limit cases were added; all additions passed in both required suites.
- Final required sequence, serial at repository root: `pnpm --filter @repo-toolkit/secret-sync test` — passed, 35 files / 551 tests, including dependency/CLI/public declaration builds; `pnpm lint` — passed; `pnpm typecheck` — passed; `pnpm test` — passed, 9 packages / 93 files / 1,944 tests (publish-package 215, changelog 81, compose-sandbox 225, confluence 354, docker-publish 227, go-release 105, publish-packages 85, release-artifact 101, secret-sync 551). `git diff --check` — passed.
- Blockers: none. Earlier work is preserved. SDK/SS-07, other task sections, `CHANGELOG.md`, and website files were not modified; no code comments, dependencies, subagents, or commits were added.

### Task SS-07: Bound SDK initialization and prevent overlapping timeout retries

Status: completed

Kind: defect

Priority: P1 — authentication can hang and logical concurrency limits multiply into unresolved provider requests.

Suggested agent: SDK deadline/concurrency implementer.

Dependencies: SS-06.

Primary ownership: `src/sdk.ts`, `test/sdk.test.ts`, README.

Finding: `ensureClient()` is awaited outside `withDeadline`. The latter rejects without cancelling SDK calls and labels timeouts retryable. Default retries can leave four unresolved requests per logical read (32 at eight workers). SDK cancellation is unavailable, already established in SDK-DIRECT-01. Existing “without retry storms” test sets retries to zero.

References: `sdk.ts:ensureClient`, `withDeadline`, `readWithRetries` (593–660), `createItem` (791–799); `test/sdk.test.ts` (683–697); SDK-DIRECT-03.

Requirements:

1. Bound shared initialization and item operations; do not retry adapter-generated deadlines while underlying unabortable work remains pending.
2. Preserve retries for settled transient provider failures and one lazy shared client. Late initialization must not launch a create after its caller timed out.
3. Document the distinction between settled transient retries and unabortable deadline expiry without claiming cancellation.

Acceptance criteria:

- Never-resolving initialization times out, factory runs once, no item call; late initialization does not trigger a delayed create.
- Default-retry stalled list/get calls do not multiply outstanding calls (assert counters); settled rate limits still retry within bounds.
- Timed-out creates remain uncertain and are not replayed.

Verification: shared implementation checks; deferred-promise/fake-timer tests and exact in-flight call counts.

Confirmed implementation boundary and necessary scope additions:

- Put shared lazy initialization/authentication and provider work inside one per-caller attempt deadline, including `listVaults` because it uses the same read boundary. Retain the pending factory promise after caller timeout so concurrent/later callers cannot start duplicate initialization; settled factory failures can still be retried.
- Guard provider invocation after awaiting initialization. This is necessary to prevent late initialization from issuing any request for an expired caller. Track whether create actually started: pre-invocation timeout throws a non-retryable timeout with no write; post-invocation timeout remains uncertain with one attempt. Preserve existing deterministic create-error handling and logical-ID reconciliation.
- Adapter-generated expiry is non-retryable; settled transient SDK rejections, including provider-reported timeouts, retain bounded retries. Underlying SDK work is unabortable and may outlive the caller; independent new calls can add work. No cancellation or global outstanding-request bound is claimed.

Completion evidence:

- Changed: `packages/secret-sync/src/sdk.ts`, `packages/secret-sync/test/sdk.test.ts`, and `packages/secret-sync/README.md`; only SS-07 status/scope/evidence in this task file. Read root `AGENTS.md` and this task before implementation; SS-06 was completed. Prior worktree changes are preserved.
- Resolution: the shared attempt wrapper starts its timer before awaiting lazy initialization, retains one deadline through provider work, and checks caller expiry before invocation. Timeout errors are non-retryable. Pending initialization remains shared until it settles; later success can serve live/new callers without reviving expired requests. Create tracks actual invocation so initialization timeout throws without a write, while started timeout returns `{ status: 'uncertain', attempts: 1 }` without replay. Settled transient reads retain the existing three retries and backoff.
- Regression evidence: 18 deferred-promise/fake-timer cases replace the misleading zero-retry timing test (net +17). Tests use default 30-second deadlines and default retries; cover service-account/desktop stalled shared initialization, concurrent callers and staggered live callers, no late list/get/create after expiry, a single budget spanning initialization and list/get/create, and eight simultaneous stalled item-list/item-get/vault-list calls. Exact counters prove eight outstanding calls remain eight rather than multiplying, no backoff occurs on adapter expiry, and late rejection settles underlying work without replay or unhandled failures.
- Further evidence: started create stays uncertain after late success or failure; settled initialization/list/get rate limits exhaust at four attempts with exact 100/200/400 ms backoff and peak in-flight count one; settled rate-limit/network/provider-timeout rejection can then succeed using the same client. Assertions cover lazy factory counts, retained pending initialization, new initialization only after settled failure, no residual deadline timers, and token/payload/envelope canaries absent from serialized failures, stacks, and causes. Existing exact-byte, deterministic-auth, and logical-ID reconciliation tests pass.
- Focused check: `pnpm --filter @repo-toolkit/secret-sync exec vitest run --config vitest.config.ts test/sdk.test.ts` — passed, 1 file / 43 tests.
- Final required sequence, serial at repository root: `pnpm --filter @repo-toolkit/secret-sync test` — passed, 35 files / 568 tests, including dependency/CLI/public declaration builds; `pnpm lint` — passed; `pnpm typecheck` — passed; `pnpm test` — passed, 9 packages / 93 files / 1,961 tests (publish-package 215, changelog 81, compose-sandbox 225, confluence 354, docker-publish 227, go-release 105, publish-packages 85, release-artifact 101, secret-sync 568). `git diff --check` — passed.
- Blockers: none. README explicitly distinguishes bounded asynchronous waiting from cancellation and synchronous blocking; underlying work can outlive callers and independent calls can add work. No live SDK/vault/platform behavior was verified. SS-08 onward, `CHANGELOG.md`, and website files were not edited; no code comments, dependencies, delegation, or commits were added.

### Task SS-08: Make per-command help sufficient to execute common workflows

Status: completed

Kind: improvement

Priority: P2 — onboarding, rollback and content-output flags are undiscoverable in command help.

Suggested agent: CLI usability implementer.

Dependencies: SS-07.

Primary ownership: `src/cli.ts`, `src/cli-options.ts`, optional small help module, `test/cli.test.ts`, README.

Finding: `printCommandHelp` emits generic options without required flags, alternatives, defaults or examples; it advertises `--json` unconditionally despite raw `show` restrictions. Tests assert headings only.

References: `cli.ts:printCommandHelp` (179–200), `cli-options.ts:COMMAND_FLAGS` (11–27), `config.ts:validateSecretSyncCommandOptions` (500–509), `test/cli.test.ts` (54–62); original SECSYNC-09.

Requirements:

1. Render command-specific flags aligned with the existing validated flag registry, including required arguments, mutually exclusive alternatives, applicable defaults, and a usable example.
2. Explain restore alternatives, direct SDK auth prerequisites and show JSON/content restrictions. Keep CLI thin and avoid a second drifting flag inventory.
3. Help remains local, credential/config-free, and performs no provider initialization.

Acceptance criteria:

- Table-driven help checks cover every command/subcommand and enforce relevant flags/no unrelated flags.
- Required rollback flags, restore alternatives, SDK setup and show restrictions are visible.

Verification: shared implementation checks; CLI subprocess tests without config/credentials.

Completion evidence:

- Changed: `packages/secret-sync/src/cli.ts`, `src/cli-options.ts`, `src/cli-help.ts` (new), `test/cli.test.ts`, and `README.md` (abbreviated paths under `packages/secret-sync`); only SS-08 status and completion evidence in this task file. The requested literal `task/AGENTS.md` does not exist; root `AGENTS.md` and this task were read first, with SS-07 completed.
- Resolution: the thin CLI delegates root/command help to a reusable formatter. Options are rendered directly from the unchanged `COMMAND_FLAGS` memberships and the existing parser `SPECS`, moved alongside the registry and enriched with argument/help metadata. Shared command-key resolution retains branch/vault list defaults. Typed command guidance supplies required arguments, alternatives, applicable defaults, and examples; prose is wrapped for terminal readability. There is no second per-command flag inventory.
- Workflow coverage: exact-file cardinality and selection, rollback blob IDs and clean-file requirement, restore revision/source-branch alternatives, overwrite/removal and acknowledgment semantics, branch creation/switching, resolve head selection, config-free vault discovery versus config-selected auth, direct SDK service-account/desktop prerequisites, and show raw/interactive/copy/export/JSON rules. README updates describe help discovery and correct the blanket config/JSON/dry-run claims while retaining earlier recovery/provider fixes.
- Necessary documentation additions explicitly identified during implementation: `show --dry-run` currently skips copy/export sinks but the CLI still emits raw bytes, including with a sink and `--json` (`show.ts:132–175`, CLI show output dispatch); `resolve --branch` belongs to `COMMAND_FLAGS` but command validation rejects it (`config.ts:473–480`). Help and README describe these actual limitations rather than promising unsupported behavior. Runtime correction is outside SS-08; SS-09 can review these recorded discrepancies. No validation or content-output behavior was changed.
- Regression evidence: replaced the heading-only help test with 19 table/registry tests (net +18). All 15 command/subcommand forms, root help, and implicit branch/vault list aliases execute in 54 subprocess scenarios: absent config, invalid default config, and an executable throwing config with a nonexistent working-directory override. Both help spellings and help alongside JSON succeed with empty stderr and unchanged fixture directory membership. Child environments contain no credentials; SDK import and fetch guards detect provider activity. Tests enforce exact advertised flag sets against the registry, parser/help metadata coverage, required arguments, alternatives, defaults, SDK prerequisites, and output restrictions.
- Run history: the first `pnpm --filter @repo-toolkit/secret-sync test` passed builds and 568 tests but failed the 18 new subprocess cases because this host Node emits DEP0205 for the fixture's `module.register()`. The fixture now uses `registerHooks` where available and retains `register` for Node 20 compatibility; warnings are not suppressed. The complete required sequence below then passed.
- Final required sequence, serial at repository root: `pnpm --filter @repo-toolkit/secret-sync test` — passed, 35 files / 586 tests, including dependency/CLI/public declaration builds; `pnpm lint` — passed; `pnpm typecheck` — passed; `pnpm test` — passed, 9 packages / 93 files / 1,979 tests (publish-package 215, changelog 81, compose-sandbox 225, confluence 354, docker-publish 227, go-release 105, publish-packages 85, release-artifact 101, secret-sync 586). `git diff --check` — passed.
- Blockers: none for SS-08. Prior fixes are preserved. No code comments, dependencies, delegation, or commits were added; `CHANGELOG.md`, website files, and other task sections were not edited.

### Task SS-09: Independently verify the complete remediation

Status: completed

Kind: improvement

Priority: P1 — cross-path recovery/security contracts need an independent acceptance review.

Suggested agent: independent integration reviewer (fresh session, not an implementation agent).

Dependencies: SS-00, SS-01, SS-02, SS-03, SS-04, SS-05, SS-06, SS-07, SS-08.

Primary ownership: this task file and aggregate review; narrowly necessary corrections with regression checks only.

Finding: multiple shared boundaries and failure paths change; isolated test passes alone do not prove selection/recovery/output contracts agree.

References: all task evidence and aggregate `git diff`.

Requirements:

1. Review every acceptance criterion against code/tests/evidence, including alternate entry paths, public types, README contracts, metadata-only state/output and resource bounds.
2. Confirm required lint/typecheck/package/full-repository checks passed on the final code; rerun only after changes or unresolved concerns. Verify no CHANGELOG edit or unintended files.
3. Add and resolve concrete necessary follow-ups before marking final review complete. Keep limitations/deferred work explicit.

Acceptance criteria:

- SS-01–08 completed with evidence; no unresolved acceptance gaps.
- Independent final review evidence records checks/results, reviewed paths, and remaining limitations.

Verification: aggregate diff and acceptance review; shared checks as warranted.

Independent review findings and verification scope:

- No in-scope remediation acceptance defect confirmed. Independently rebuilt the dependency closure and inspected/compiled a consumer against `dist/index.d.ts`; exercised the built public API for pending rollback versus switch (same/different target and dry-run), then genuine rollback/switch recovery with excluded-baseline preservation. These checks address cross-task paths not directly combined by the existing regressions. No production correction or repository test edit was necessary.
- **SS-09-F1 — confirmed P1, deferred outside this plan; coordinator must assign a separate isolated filesystem/removal task.** Ordinary and acknowledging restore removals call `removeFileGuarded` without a preflight expectation (`src/restore.ts:300–303,367–370`, `src/filesystem.ts:409–442`), unlike their corrected replacement paths. Built-API reproduction: restore `remove.env` from an empty branch with `overwrite: true`, inject `writeFile(..., 'late-edit')` in `beforeWrite`; both ordinary and acknowledging restore delete that edit. With an initially absent path, acknowledging restore also deletes the injected creation without overwrite permission. Ordinary absent-to-absent restore returns early and does not invoke the hook. SS-02 explicitly excluded removals, so this is not silently added to its completed replacement criteria. Follow-up acceptance: carry preflight content/absence through both restore removal paths, refuse late edits/creations without baseline advancement, retain ordinary authorized removal, and add real operation regressions plus required checks. Residual risk: lost local edits during restore removal.
- **SS-09-F2 — confirmed P1, deferred outside this plan; coordinator must assign a separate isolated content-output task.** Already identified by SS-08, independently reproduced here: built CLI `show --file .env --export out.env --dry-run --json` exits 0 with exact raw secret bytes on stdout and no export file. `src/show.ts:132–175` skips sinks; `src/cli.ts:125–136` selects raw output from completed sink flags rather than requested output mode. Follow-up acceptance: define/enforce metadata-only JSON and sink dry-run behavior across raw/copy/export/combined/interactive/CLI/API paths, preserve intentional raw show, add subprocess canary regressions, and update the current documented limitation. SS-08 owns help accuracy, not this existing output-policy change. Residual risk: secret content reaches stdout/log consumers expecting metadata.
- **SS-09-F3 — existing P2, deferred outside this plan.** `resolve --branch` is advertised by the parser registry but rejected by `src/config.ts:473–480`. SS-08 accurately discloses this. A separately owned CLI-policy follow-up should align registry/validation/dispatch and test explicit target versus configured/active branch; using the configured branch remains the documented workflow. Do not couple this to recovery implementation.
- Coordinator was notified of both material P1 follow-ups during review. They require separately scoped ownership; this reviewer created no subagents and made no broad runtime rewrite.
- Coordinator disposition after SS-09: promote F1/F2/F3 into SS-10/11/12 below, within the user's requested package review objective. Each receives its own fresh sequential agent; SS-13 performs final independent integration. Historical review conclusions above describe the scope at that review, not the final disposition.

Completion evidence:

- Independence/scope: fresh final-review session; read root `AGENTS.md` and this complete task, inspected the full tracked diff and all seven untracked files (task record, two source modules, four test modules). Reviewed surrounding dispatcher, config/discovery, state persistence, journal, operation/history, format, show, init, branch-create and resolve code where it establishes alternate-path behavior. Workspace changes by this reviewer are confined to SS-09 and the final summary below; evidence probes live in a temp directory outside the repo.
- Criterion review:
  - **SS-00:** the SIGINT emit is inside the entered hanging-process fixture after abort-handler registration; primary-error, fresh cleanup signal, and listener assertions remain. Independent focused run passed all 12 tests. No Compose runtime diff.
  - **SS-01:** only `ESRCH` reclaims a valid-owner lock; live/indeterminate probes ignore timestamp age, malformed metadata retains the age rule, and release compares the nonce. Real-PID/clock-advance and deferred pull-versus-push tests assert unchanged lock/state/journal and eventual normal completion; dead-owner and replacement-nonce tests cover the inverse paths.
  - **SS-02:** all six replacement call sites carry their scanned/read preimage into the shared final content/length-or-absence check. Tests inject same-length/binary edits, presence transitions, partial writes, hook/ancestor/kind/read/rename failures, and temp-name collision, asserting original destination/baselines and owned-temp cleanup. Ordinary writes and intentional export overwrite remain covered. New expectations are input/internal metadata, absent from operation results. Removal semantics remain the explicit separate finding F1.
  - **SS-03:** stale/unbased baselines cannot authorize a differing local file. Recovery proof is saved before publication, bound to operation/path/branch/source/target/blob and keyed preimage, matched against the actual rollback receipt, and retired atomically with acknowledgment. Before/after-publish, temp-write and final-save tests assert retained proof/baselines, exact commit counts, original publication metadata reuse, no rewrite of an already-materialized target, and refusal after local edits or mismatched/advanced provenance.
  - **SS-04:** `runSecretSync` supplies the configured matcher plus config exclusion; shared switch planning filters the union before filesystem inspection. Real/dry-run tests cover narrowed inclusion and ignore, dirty/directory excluded paths, excluded updates/removals/target-only paths, permanent exclusions, empty selection, baseline-only/current-only paths, selected dirty refusal, and unchanged excluded baselines. Direct `switchBranch` intentionally retains its documented all-tracked default without a matcher. No selected/excluded baseline crossover found.
  - **SS-05:** proof and journal identity/action/blob/HMAC/length/timestamp plus actual bytes/absence gate recovery. The corrected test really changes the first file before failing the second; additional cases cover removals, rename-before-journal-status, actual final state-file rename failure, acknowledgment-before-save, and post-save cleanup. Completed mutations are not repeated; old branches/heads/baselines remain until final save. Wrong target/selection/heads, changed completed or unfinished files, and unrelated/missing evidence refuse. Pull (including empty/no-op entry), push, both restore modes and rollback guard pending switch before mutation; dry-run remains read-only. `verifySwitchRecovery` also refuses pending rollback before same-branch early return or switch proof creation, independently exercised through the built API. Branch-create/resolve do not repurpose proof or materialize files; their remote head changes are detected on retry.
  - **SS-06:** one timer encloses headers and complete body reads; signal races bound injected asynchronous stalls, cleanup runs before backoff, late headers are cancelled, and POST remains exactly one uncertain attempt. Tests cover native streams and injected readers/iterators/text, before/after-chunk stalls, shared header/body budget, exact GET attempt/backoff counts, byte-limit and early-status cleanup, reader unlocking, safe error mapping and late settlement. No timer-reset-on-progress or POST replay path found.
  - **SS-07:** lazy initialization remains shared and inside each attempt deadline; expired callers cannot invoke the eventual client. Adapter expiry is non-retryable, while settled provider failures retain bounded retries. Tests use default retries/deadlines, count eight genuinely outstanding requests remaining eight, verify one pending factory, no late create/list/get, exact settled retry backoff/peak count, and uncertain started creates after late success/failure. Error canaries cover serialized errors/stacks/causes. No cancellation or global bound on independent later callers is claimed.
  - **SS-08:** parser metadata/registry drives rendered flags; independently compared guidance to config/dispatch/runtime. All 15 command/subcommand forms plus root and implicit list aliases are covered in credential-free subprocesses with absent/invalid/throwing configs and provider guards. Required rollback/source alternatives, SDK prerequisites, defaults/examples and show restrictions are present. Tests assert both registry membership and independent workflow phrases; F2/F3 are disclosed runtime limitations, not resolved by help prose.
- Test-quality assessment: regressions use actual filesystem bytes, real operation calls, deferred provider work, exact create/in-flight counters, persisted-state snapshots, and injected real persistence boundaries rather than merely reproducing conditionals. In particular the former first-file-only switch fault and zero-retry SDK fixture were replaced meaningfully. Fault tests prove cleanup invocation and addressable-temp removal; a simulated close failure closes then rejects, so it does not establish that an OS-refused close can be forced to release a handle. Native/provider/platform limits below remain explicit.
- Independent artifact verification, serial at repository root: `pnpm --filter @repo-toolkit/secret-sync... build` — passed dependency, library, CLI and declaration builds. Inspected `dist/index.d.ts`: optional switch matcher and worktree expectation are usable; optional state recovery is discriminated and metadata-only; switch/rollback result types contain no new bodies/fingerprints. `pnpm exec tsc --noEmit --strict --target ES2018 --module ESNext --moduleResolution Bundler --types node --typeRoots <repo-root>/node_modules/@types <temp-dir>/ss09-consumer.ts` — passed without source aliases or skipped declaration checking. Consumer imports built declarations, calls matcher/expected-absence APIs, and checks result/recovery field types.
- `node <temp-dir>/ss09-integration.mjs` — passed: built-API pending-rollback switch refusals preserve complete file/state snapshots and remote create count; original rollback resumes with exactly one commit; subsequent switch interrupted after materialization resumes with excluded bytes/baseline intact and empty journal. Metadata envelope canary checks passed. The same controlled fake-backed probe confirmed F1 and a built-CLI subprocess confirmed F2; fixtures were removed in `finally`, no credentials/network used.
- Independent regression verification: `pnpm --filter @repo-toolkit/secret-sync exec vitest run --config vitest.config.ts test/state.test.ts test/filesystem.test.ts test/filesystem-faults.test.ts test/write-operations.test.ts test/pull.test.ts test/rollback.test.ts test/branches.test.ts test/switch-selection.test.ts test/switch-recovery.test.ts test/connect.test.ts test/sdk.test.ts test/cli.test.ts` — passed, 12 files / 295 tests. Then `pnpm --filter @repo-toolkit/compose-sandbox exec vitest run --config vitest.config.ts test/emergency-cleanup.test.ts` — passed, 1 file / 12 tests. Builds/tests ran serially.
- Required aggregate checks on the reviewed code are the completed SS-08 sequence: package 35 files / 586 tests, lint, typecheck, and full repository 9 packages / 93 files / 1,979 tests, all passed. This session changed no repository source/tests; no acceptance concern remained requiring repetition of the full sequence. Independent build, declaration consumer, focused regressions and probes above supplement rather than misrepresent those prior full-suite results.
- Hygiene: `git diff --check` passed. Reviewed tracked/untracked membership contains only the authorized secret-sync source/tests/README, SS-00 Compose fixture, and this task record. No `CHANGELOG.md`, website, manifests, lockfiles, dependencies or unintended generated files changed; build outputs remain ignored. No code comments, commits or subagents added.
- Limits: no live-vault/desktop/native SDK/Windows/network-filesystem verification, benchmark, or exhaustive audit. Path-based recheck-to-rename races, cleanup defeated by filesystem refusal/ancestor relocation, same-host/PID lock limits, non-cancellable SDK work, independent-call accumulation, synchronous event-loop blocking, and advanced-head/changed-selection reconciliation remain as documented. Low-level state/journal/filesystem helpers still require callers to honor orchestration/locking contracts. F1–F3 remain separate product follow-ups, not claims of fixed behavior.

### Task SS-10: Guard restore removals with their preflight expectation

Status: completed

Kind: defect

Priority: P1 — late edits or newly created files can be deleted during restore.

Suggested agent: isolated guarded-removal implementer.

Dependencies: SS-09.

Primary ownership: `packages/secret-sync/src/filesystem.ts`, `src/restore.ts`, focused filesystem/restore regressions and README.

Finding: SS-09-F1 reproduced both ordinary and acknowledging restore deleting a file edited in `beforeWrite`; acknowledging absent-to-absent restore also deletes a new file. Both call `removeFileGuarded` without original content/absence evidence. SS-02 fixed replacements only.

References: `restore.ts` removal paths (review lines 300–303,367–370), `filesystem.ts:removeFileGuarded`, SS-09-F1.

Requirements:

1. Reuse the explicit content/absence expectation from SS-02 at the shared removal boundary and both restore call sites. Preserve existing keyed pull/switch removal guards and deliberate overwrite permission without allowing late edits.
2. Validate expectation before interpreting absence as a successful no-op. Recheck as close to unlink as available path APIs permit; document residual race accurately.

Acceptance criteria:

- Both restore modes preserve same-length late edits, newly appearing files, and original baselines on refusal.
- Ordinary authorized removals still work; absent no-op semantics remain correct without deleting a late creation.
- Shared guard tests cover presence/absence transitions and compatibility with existing keyed callers.

Verification: shared implementation checks; actual API fault-injection regressions.

Confirmed implementation boundary and necessary scope additions:

- Extend `RemoveGuardOptions` with the existing SS-02 `ExpectedDestination`, checking it before an absent return and immediately before unlink. Reuse the shared comparison helper with an operation-specific error label so removal failures say “removal” while existing replacement errors retain their wording. Keep the optional keyed contract, including keyed-only absent no-ops; when both contracts are supplied, neither bypasses the other.
- Carry the original `current` read through both restore removal paths, including acknowledging absence without overwrite permission. Ordinary absent-to-absent restore intentionally returns before `beforeWrite`; tests explicitly verify that early return rather than claiming to inject a creation through an unreachable hook.
- Extend the existing filesystem and restore test files and the shared runtime race-limit text alongside the README. These additions are necessary to verify keyed-call compatibility and describe removal-specific residual races; no ownership expansion beyond the listed files was needed.

Completion evidence:

- Changed: `packages/secret-sync/src/filesystem.ts`, `src/restore.ts`, `test/filesystem.test.ts`, `test/restore.test.ts`, and `README.md` (abbreviated paths under `packages/secret-sync`); only SS-10 in this task file. Read root `AGENTS.md` and the task first; dependency SS-09 was completed. Earlier work and SS-09 history are preserved.
- Resolution: both restore removal paths now enforce original content/length-or-absence after the actual operation hook. Same-length edits, newly created files, and unexpected disappearance refuse with `local-changed` before baseline/head acknowledgment. Authorized removal and absent no-ops retain their intended behavior; pull/switch keyed callers are unchanged.
- Regression evidence: 33 added tests (22 restore, 11 filesystem). Actual `restoreFile` hooks cover both modes with same-length text/binary edits, delete-and-recreate, nonempty/empty-to-absent changes, and acknowledging absent-to-empty/nonempty creation without overwrite. Tests assert hook execution, preserved competing bytes/absence, unchanged complete persisted state, no state-save hook on refusal, and unchanged remote listings. Success cases cover authorized nonempty/empty removals, absent no-ops, overwrite refusal, and correct baseline/head/branch semantics. Shared tests cover exact binary/empty preimages, length/content/absence mismatches, keyed HMAC/length validation, keyed-only absent no-ops, and enforcement of both supplied contracts. Existing replacement, pull, and switch recovery regressions pass.
- Focused check: `pnpm --filter @repo-toolkit/secret-sync exec vitest run --config vitest.config.ts test/filesystem.test.ts test/restore.test.ts` — passed, 2 files / 62 tests.
- Required sequence, serial at repository root: `pnpm --filter @repo-toolkit/secret-sync test` — passed, 35 files / 619 tests, including dependency/library/CLI/public declaration builds; `pnpm lint` — passed; `pnpm typecheck` — passed; `pnpm test` — passed, 9 packages / 93 files / 2,012 tests (publish-package 215, changelog 81, compose-sandbox 225, confluence 354, docker-publish 227, go-release 105, publish-packages 85, release-artifact 101, secret-sync 619). `git diff --check` — passed.
- Residual limit: path-based checks are not compare-and-swap. Content edits or ancestor/destination swaps can still occur between the final check and unlink/rename; a new file can appear after an absence check. The cooperating state lock does not exclude editors. README and runtime limit text state these boundaries without claiming atomic guarded deletion.
- Blockers: none. SS-11/12 and all other task sections are unchanged. No comments, dependencies, delegation, commits, `CHANGELOG.md`, or website edits were added.

### Task SS-11: Make show dry runs metadata-only across all output modes

Status: completed

Kind: defect

Priority: P1 — raw secret bytes leak into stdout consumers expecting JSON/preview metadata.

Suggested agent: isolated content-output implementer.

Dependencies: SS-10.

Primary ownership: `packages/secret-sync/src/show.ts`, show dispatch in `src/index.ts`/`src/cli.ts`, config/help/format only as necessary, focused show/CLI regressions, README.

Finding: SS-09-F2 reproduced `show --file .env --export out.env --dry-run --json` outputting raw bytes because sink execution flags are false in dry-run, selecting CLI raw output. API also returns payload bytes despite the note claiming no content output.

References: `show.ts:showFile` (132–175), CLI show dispatch, config show JSON validation, SS-09-F2 and SS-08 limitation.

Requirements:

1. Contract: every `show --dry-run` produces metadata-only preview (text or schema-versioned JSON), no raw bytes, clipboard/export write, or state/worktree mutation. Reads and validation remain permitted. API returns empty bytes for dry run while preserving actual byteLength metadata and accurate requested-action note.
2. Permit metadata-only `show --dry-run --json` without requiring a sink. Preserve explicit ordinary raw show byte equality and existing copy/export behavior; plain non-dry-run raw `show --json` remains rejected.
3. Ensure output-mode dispatch uses dry-run/requested semantics instead of inferring raw output from whether a sink executed. Replace documented workaround with the corrected contract in README/help.

Acceptance criteria:

- CLI canary tests for raw/copy/export/combined dry runs, JSON and text, emit no secret content and perform no sink/state writes.
- API and interactive paths preserve the same contract; ordinary raw show remains exact bytes and actual sink modes still work.
- JSON is parseable metadata with `dryRun: true`; no payload/fingerprint fields cross output boundaries.

Verification: shared implementation checks; low-level/API tests and built-CLI canary subprocess regressions.

Completion evidence:

- Changed: `packages/secret-sync/src/show.ts`, `src/cli.ts`, `src/config.ts`, `src/cli-help.ts`, `test/show-dry-run.test.ts` (new), `test/show.test.ts`, `test/show-export.test.ts`, `test/cli.test.ts`, and `README.md` (abbreviated paths under `packages/secret-sync`); only SS-11 in this task file. Read root `AGENTS.md` and the task first; dependency SS-10 was completed. Earlier SS-00..SS-10 work is preserved.
- Validated SS-09-F2 before the fix by code inspection: `show.ts` skipped sinks in dry-run but returned full decoded `bytes`, and `cli.ts` inferred raw stdout from executed (`copied`/`exported`) rather than requested output mode, so `show --export out.env --dry-run --json` printed raw bytes; `config.ts` additionally rejected sinkless `--json` even with `--dry-run`.
- Resolution: dry-run `showFile` returns early with empty bytes, preserved actual `byteLength`, `copied: false`, no `exported`/`clipboardCommand`, and a note naming the requested action (`print`/`copy`/`export`). Non-dry-run raw/sink paths are byte-identical to before. `config.ts` permits `show --dry-run --json` without a sink while plain raw `show --json` still throws. `cli.ts` dispatches dry-run outcomes to text/JSON metadata before the sink-executed checks. Help and README describe the corrected metadata-only preview contract instead of the former raw-bytes limitation.
- Regression evidence: 14 new tests in `show-dry-run.test.ts` — API raw/copy/export/combined dry runs assert empty bytes, exact `byteLength`, canary/base64 absence in results/notes/JSON/text envelopes, uncalled clipboard writers, absent export files, unchanged store create counts, and absent state writes; interactive resolution plus dry-run `showFile` asserts the same contract; ordinary raw byte equality and working copy/export sinks are locked; dry-run validation still rejects unknown paths without leaking bytes. CLI canaries spawn the built `dist/cli.js` against a background-process fake Connect server (an in-process server deadlocks under `spawnSync`): seeded push, then raw/copy/export/combined dry runs in text and JSON assert exit 0, empty stderr, no canary/base64 on stdout, absent export file, whole-worktree snapshot (modes/bytes) equality, parseable `dryRun: true` JSON with `byteLength` and no payload keys; ordinary raw CLI output remains byte-equal and plain raw `--json` still exits 1 on `--json`. Existing `show`/`cli` expectations were updated to the corrected contract (`show.test.ts` dry-run bytes, `show-export.test.ts` dry-run bytes, `cli.test.ts` help phrases).
- Final required sequence, serial at repository root: `pnpm --filter @repo-toolkit/secret-sync test` — passed, 36 files / 633 tests, including dependency/library/CLI/public declaration builds; `pnpm lint` — passed; `pnpm typecheck` — passed; `pnpm test` — passed, 9 packages / 94 files / 2,026 tests (publish-package 215, changelog 81, compose-sandbox 225, confluence 354, docker-publish 227, go-release 105, publish-packages 85, release-artifact 101, secret-sync 633). `git diff --check` — passed.
- Blockers: none. SS-12/SS-13 and all other task sections are unchanged. No comments, dependencies, delegation, commits, `CHANGELOG.md`, or website edits were added.

### Task SS-12: Support the advertised explicit resolve branch

Status: completed

Kind: defect

Priority: P2 — operators cannot use the advertised flag to resolve a fork on a different branch.

Suggested agent: isolated resolve CLI-policy implementer.

Dependencies: SS-11.

Primary ownership: `packages/secret-sync/src/config.ts`, resolve dispatch/branch resolution in `src/index.ts`, `src/cli-help.ts`, config/API/CLI tests and README.

Finding: SS-09-F3: parser/registry advertises `resolve --branch`, but shared mutating-command validation rejects it even though `resolveFork` already accepts an explicit branch and does not materialize the worktree.

References: `config.ts:validateSecretSyncCommandOptions` (473–480), `resolve.ts:resolveFork`, `cli-options.ts:COMMAND_FLAGS`, SS-09-F3.

Requirements:

1. Permit explicit branch selection for resolve and carry it through dispatch; preserve default configured/active branch behavior when omitted.
2. Resolve only the selected branch's exact current heads. Do not switch active/materialized branches or alter local file baselines/bytes. Keep worktree-mutating push/pull/restore/rollback branch restrictions.
3. Remove the help/README limitation and explain explicit target versus default behavior.

Acceptance criteria:

- CLI/API explicit non-active branch fork resolves while active branch/worktree/baselines remain intact; default behavior still resolves the default target.
- Stale/wrong-branch heads refuse without publication, and dry-run remains read-only.
- Flag registry/help/validation agree; mutating commands retain their existing branch policy.

Verification: shared implementation checks; config tests and fake-backed API/CLI fork regressions.

Completion evidence:

- Changed: `packages/secret-sync/src/config.ts`, `src/cli-help.ts`, `test/cli.test.ts`, `test/resolve-branch.test.ts` (new), and `README.md` (abbreviated paths under `packages/secret-sync`); only SS-12 in this task file. Read root `AGENTS.md` and the task first; dependency SS-11 was completed. Earlier SS-00..SS-11 work is preserved.
- Resolution: `validateSecretSyncCommandOptions` now permits `--branch` for `resolve` alongside read-only commands and branch/switch; push/pull/restore/rollback still reject it and keep the active-branch policy (registry layer rejects it for push/pull before validation). Dispatch already carried the explicit branch through `resolveTargetBranch`, so no `index.ts` change was needed: omitted `--branch` still resolves the configured branch, explicit `--branch` resolves only that branch's observed heads. `resolveFork` publishes the join commit without reading or writing state, baselines, or worktree files, so the active branch never switches. Help and README describe explicit-target versus default behavior instead of the former rejection note.
- Regression evidence: 10 new tests in `resolve-branch.test.ts` (3 config, 4 API, 3 CLI). Config: resolve with `--branch` passes validation, all four mutating commands still throw `/active branch/`, invalid branch names rejected, plan carries the explicit branch into `plan.branch`/`commandOptions.branch` while the default plan uses the config branch, and CLI flag plumbing (`assertCommandFlags`/`buildOptions`) maps `--branch`/`--head`/`--take` for resolve but rejects `--branch` for push. API (`MemoryFakeStore`): explicit non-active fork resolves with exactly one additional create while `activeBranch` stays `main`, worktree bytes/baselines/main heads are byte-identical and the other branch's heads become the single join commit; default resolves the configured branch; stale (advanced) and wrong-branch head sets refuse with `heads changed` and zero creates; explicit dry-run returns `published: false` with unchanged heads/creates and no state directory. CLI (built `dist/cli.js` against a background-process fake Connect server): `resolve --branch feature/cli --head A --head B --take A --json` exits 0 with parseable `published: true` metadata, unchanged `.env` bytes and `state.json`, and a repeat with the same heads exits 1 on `heads changed`; `push --branch` exits 1 at the flag registry; `resolve --help` advertises `--branch` without the old rejection note. Existing `cli.test.ts` help expectations updated to the corrected phrases.
- Final required sequence, serial at repository root: `pnpm --filter @repo-toolkit/secret-sync test` — passed, 37 files / 643 tests, including dependency/library/CLI/public declaration builds; `pnpm lint` — passed; `pnpm typecheck` — passed; `pnpm test` — passed, 9 packages / 95 files / 2,036 tests (publish-package 215, changelog 81, compose-sandbox 225, confluence 354, docker-publish 227, go-release 105, publish-packages 85, release-artifact 101, secret-sync 643). `git diff --check` — passed.
- Blockers: none. SS-13 and all other task sections are unchanged. No comments, dependencies, delegation, commits, `CHANGELOG.md`, or website edits were added.

### Task SS-13: Independently close the expanded review

Status: completed

Kind: improvement

Priority: P1 — final acceptance must include defects discovered during the first review.

Suggested agent: fresh independent integration reviewer.

Dependencies: SS-10, SS-11, SS-12.

Primary ownership: aggregate review and this task file; no broad implementation changes.

Finding: SS-09 validated the original tasks but reproduced additional package defects. Closure now requires checking their fixes and interactions with the earlier changes.

References: SS-00–12 findings, requirements and completion evidence; tracked and untracked aggregate diff.

Requirements:

1. Independently verify SS-10–12 criteria and review compatibility with SS-00–08 guarantees, public types, README/help, metadata output, guard/recovery semantics and required check evidence.
2. Confirm all task statuses/evidence, resolve concrete acceptance gaps, and update final summary without leaving F1–F3 falsely described as outstanding. Preserve historical findings and initial failures.

Acceptance criteria:

- Every task is completed with evidence, including SS-09-F1/F2/F3 fixes; final code passes required verification.
- Final independent review records results and only evidence-backed remaining limitations; `CHANGELOG.md` is unchanged.

Verification: aggregate source/test/evidence review, targeted cross-path probes when needed, and shared checks after any correction.

Completion evidence:

- Independence/scope: fresh final-review session, not a prior implementer; read root `AGENTS.md` and this complete task file; no subagents used. Reviewed the full tracked diff (27 files, +2390/−517) and all 9 untracked paths (this task record, `src/cli-help.ts`, `src/switch-recovery.ts`, 6 new test modules). Made no repository source/test changes; the only workspace edit is this SS-13 section and the final summary below. A transient probe script lived in a temp directory outside the repo and was removed after passing.
- Criterion review, including cross-path interactions:
  - **SS-00:** SIGINT emit sits inside the entered hanging-process fixture after abort-handler registration; lifecycle assertions retained. No Compose runtime diff.
  - **SS-01:** only `ESRCH` reclaims a valid-owner lock; live/indeterminate owners stay busy regardless of age; malformed metadata keeps the age rule; release is nonce-safe. Real-PID/clock-advance and deferred pull-vs-push regressions assert unchanged lock/state/journal with eventual normal completion.
  - **SS-02:** all six worktree replacement sites carry scanned/read preimages into the shared final content/length-or-absence check after injectable hooks; export keeps deliberate overwrite; owned temps are closed and unlinked on every pre-rename failure; expectations stay internal to results. Removal paths were explicitly out of scope here and are closed by SS-10 below.
  - **SS-03:** rollback proof is persisted before publication, bound to operation/path/branch/source/target/blob plus keyed preimage, matched against the actual rollback receipt, and retired atomically with acknowledgment. Stale/unbased baselines plus dirty files refuse; genuine interruptions resume without extra commits; post-retry edits refuse with proof retained.
  - **SS-04:** `runSecretSync` supplies the configured matcher plus config exclusion; shared `planSwitchWorktree` filters the baseline/current/target union before inspection. Real and dry-run tests cover narrowed inclusion, ignore precedence, dirty/directory excluded paths, target-only and permanent exclusions, empty selection, and unchanged excluded baselines. Low-level `switchBranch` without a matcher intentionally retains its documented all-tracked default.
  - **SS-05:** switch proof plus journal identity/action/blob/HMAC/length/timestamp plus actual bytes/absence gate recovery; completed writes/removals are skipped, not repeated; journal acknowledgment precedes the atomic final save/proof retirement. Pull (including empty-remote handling), push, both restore modes, and rollback all refuse while switch proof is pending; `verifySwitchRecovery` likewise refuses pending rollback before same-branch early return. Dry runs stay read-only.
  - **SS-06:** one attempt timer covers headers through complete body consumption; signal races bound injected stalls; abandoned bodies are cancelled before GET backoff; POST stays exactly one uncertain attempt. Tests cover native streams, injected readers/iterators/text, shared header/body budget, exact attempt/backoff counts, byte-limit and early-status cleanup, and safe error mapping.
  - **SS-07:** lazy initialization sits inside each attempt deadline; expired callers cannot invoke the eventual client; pending factory stays shared; adapter expiry is non-retryable while settled transient failures keep bounded retries with exact backoff. Eight genuinely outstanding calls remain eight. Started creates stay uncertain with one attempt; pre-invocation expiry throws without a write.
  - **SS-08:** parser metadata/registry drives rendered flags with no second inventory; all 15 command/subcommand forms plus root and implicit list aliases run credential-free. Required rollback flags, restore alternatives, SDK prerequisites, defaults, examples, and show restrictions are present. The two runtime limitations it disclosed (F2/F3) are now fixed by SS-11/SS-12, and help/README describe the corrected contracts.
  - **SS-10:** both restore removal paths pass the original `current` read as `expectedDestination` after `beforeWrite`; the shared guard validates it before absent no-ops and immediately before unlink, alongside the unchanged keyed contract. Same-length edits, delete-and-recreate, and absent-to-present creations refuse with `local-changed` and unchanged baselines; authorized removals and absent no-ops work. Ordinary absent-to-absent restore still returns before `beforeWrite`, explicitly verified rather than faulted through an unreachable hook.
  - **SS-11:** dry-run `showFile` returns empty bytes with the verified `byteLength`, `copied: false`, no `exported`/`clipboardCommand`, and a requested-action note; validation still runs. `config.ts` permits sinkless `show --dry-run --json` while plain raw `show --json` still throws; `cli.ts` dispatches dry-run outcomes to text/JSON metadata before sink-executed checks, so requested (not executed) sinks never select raw stdout.
  - **SS-12:** `validateSecretSyncCommandOptions` permits `--branch` for `resolve`; dispatch already carried it through `resolveTargetBranch`, so omitted `--branch` keeps configured-branch behavior and explicit `--branch` joins only that branch's heads. `resolveFork` publishes the join commit without reading/writing state, baselines, or worktree files, so the active branch never switches. Push/pull/restore/rollback keep the active-branch policy. Help and README describe explicit-target versus default behavior.
- Fault genuineness: regressions inject faults at real boundaries (operation `beforeWrite` hooks, actual state-file rename failure, deferred provider promises, fake timers, exact create/in-flight counters, persisted-state snapshots, spawned built-CLI canaries against a background fake server) rather than asserting conditionals alone. Previously weak fixtures (first-file-only switch fault, zero-retry SDK timing, heading-only help) were replaced with meaningfully stronger ones.
- Independent verification on the final code, serial at repository root: `pnpm --filter @repo-toolkit/secret-sync... build` — passed (dependency, library, CLI, declarations). Focused `vitest run` over `restore`, `show-dry-run`, `show`, `resolve-branch`, `switch-recovery`, `switch-selection`, `rollback`, `write-operations`, `filesystem`, `filesystem-faults`, `state`, `cli` — passed, 12 files / 256 tests. Built-CLI probes: `resolve --help` advertises `--branch` with worktree-unchanged semantics; `show --help` states metadata-only dry-run; `push --branch` exits 1 at the flag registry. Built-API probes (`<temp-dir>/ss13-probe.mjs`, since removed): seeded `show --dry-run --export` returned empty bytes with exact `byteLength` and no sink markers or secret bytes in the envelope; `restoreFile` removal from an empty branch with a `beforeWrite` late edit refused `local-changed` and preserved the edit.
- Required aggregate checks: no repository change was made in this review, so per the execution rules the SS-12 final sequence stands without repetition: secret-sync 37 files / 643 tests, `pnpm lint` passed, `pnpm typecheck` passed, `pnpm test` passed 9 packages / 95 files / 2,036 tests, `git diff --check` passed (re-verified clean in this session).
- Hygiene: `git diff --check` passed. `git status` shows only the authorized secret-sync source/tests/README, the SS-00 Compose fixture, and this task record (tracked) plus the 2 new source modules, 6 new test modules, and this record (untracked). No `CHANGELOG.md`, website, manifest, lockfile, dependency, generated-file, or `dist/` change; added-line scan shows no code comments (matches are URLs and operators in tests). No commits or subagents.
- Corrections made under SS-13: none; no acceptance gap required one.
- Remaining limitations (evidence-backed, as documented in code/README): path-based recheck-to-rename/unlink races, cleanup defeated by filesystem refusal or ancestor relocation, same-host/PID lock limits, non-cancellable SDK work with independent-call accumulation, synchronous event-loop blocking, and intentional refusal (with retained proof) on advanced heads or changed selection — reconciliation of those cases is outside this plan. No live-vault/desktop/native-SDK/Windows/network-filesystem verification, no benchmark, no exhaustive audit.

## Consequential deferrals

- History pruning/retention is explicitly deferred in the current product: safe garbage collection needs a cross-branch/reachability and delayed-visibility protocol. Residual cost: remote history grows to the configured scan bound.
- History caching/lazy hydration needs measurements and a trustworthy completeness/invalidation design; `log --limit` currently bounds output, not remote work. This review fixes demonstrable timeout amplification rather than claiming an unmeasured speedup.
- Live-vault compatibility, real desktop approval/platform tests, in-place backend rebinding, and cross-host locks remain outside this bounded remediation. Same-host exclusivity and fake-backed deterministic recovery are covered here.

## Final integration summary and definition of done

- Original tasks SS-00–09 completed; SS-09 independently confirmed their criteria and recorded three additional defects.
- SS-10/11/12 completed sequentially with required checks (final: secret-sync 643 tests, full repository 2,036 tests, lint/typecheck passed). SS-13 independently closed the expanded review with no corrections needed.
- Repository constraints satisfied: no changelog/website edits, dependency changes, commits, code comments, or unintended generated files. Historical failed checks and their resolutions remain intact.
- Definition of done met: every task SS-00–SS-13 is completed with evidence; docs/types/runtime agree (help/registry/validation/dispatch, metadata-only state/output, guard/recovery semantics, deadline/retry bounds); required checks pass on the final code; F1–F3 are fixed and verified, not outstanding. No task remains pending, blocked, or in progress.
