# Publish Packages Release Correctness

Created: 2026-08-04 14:19:59

## Objective

Make monorepo release planning complete, deterministic, and safe before the first irreversible npm publication.

### Task MPSEC-01: Fix file defaults and reject unsafe workspace members

Status: completed

Priority: P0

Suggested agent: monorepo release engineer

Dependencies: PPSEC-01 in `20260804-141959-publish-package-release-safety.md`

Primary ownership:

- `packages/publish-packages/src/index.ts`
- `packages/publish-packages/test/index.test.ts`

Finding:

The wrapper materializes default file arrays before forwarding no-default flags (`src/index.ts:156-161`, `192-197`), so explicit suppression does not work. Discovery includes private packages and silently overwrites duplicate names (`96`, `215-230`).

Implementation requirements:

1. Preserve `undefined` for downstream default resolution or produce empty lists when no-default flags are set.
2. Reject private packages and duplicate package names during discovery with manifest paths.
3. Validate package records and names before graph construction.

Acceptance criteria:

- Both no-default flags suppress defaults while explicit include lists still work.
- Private, duplicate, null, array, and malformed-name manifests fail before commands run.
- Errors identify every conflicting package path.

Completion evidence:

- Changed: `packages/publish-packages/src/index.ts`, `packages/publish-packages/test/index.test.ts`
- Verified: `pnpm --filter @repo-toolkit/publish-packages test`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
- Result: monorepo plan resolution now preserves no-default file suppression and rejects invalid, private, and duplicate workspace members during discovery.

### Task MPSEC-02: Add full release preflight

Status: completed

Priority: P0

Suggested agent: release transaction engineer

Dependencies: MPSEC-01, PPSEC-02 in the publish-package safety file

Primary ownership:

- `packages/publish-packages/src/index.ts:176-208`
- controlled integration tests

Finding:

Each package is built, staged, and published before later packages are validated. A malformed later member can therefore leave a preventable partial release.

Implementation requirements:

1. Discover and validate the full release set, selectors, versions, paths, privacy, uniqueness, and downstream plans before npm invocation.
2. Separate pure preflight output from execution.
3. Document that npm publication remains non-atomic after a successful preflight.

Acceptance criteria:

- An invalid final package results in zero build/publish side effects where validation can be completed purely.
- Fake npm records no calls on all preflight failures.
- A later runtime publish failure reports the completed and pending package sets.

Completion evidence:

- Changed: `packages/publish-packages/src/index.ts`, `packages/publish-packages/test/index.test.ts`
- Verified: `pnpm --filter @repo-toolkit/publish-packages test`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
- Result: `publishPackages()` now resolves every downstream single-package plan before execution, so later invalid packages abort before the first publish side effect.

## Verification And Done

Run `pnpm --filter @repo-toolkit/publish-packages test`, then `pnpm lint`, `pnpm typecheck`, and `pnpm test`. Completion requires independent review of zero-side-effect preflight failures and controlled npm invocation evidence.
