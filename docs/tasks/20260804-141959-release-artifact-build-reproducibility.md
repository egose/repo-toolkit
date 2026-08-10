# Release Artifact Build Reproducibility

Created: 2026-08-04 14:19:59

## Objective

Make artifact content, dependency modes, version files, and external process behavior explicit, reproducible, bounded, and testable.

### Task RAARC-01: Replace conflicting node-module booleans with one mode

Status: pending

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

Status: pending

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

Status: pending

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

Status: pending

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

## Definition Of Done

An independent reviewer compares two artifact builds, validates each dependency mode, and confirms all external operations are bounded and test-isolatable.
