# Publish Package Release Safety

Created: 2026-08-04 14:19:59

## Objective

Prevent `@repo-toolkit/publish-package` from bypassing package privacy, escaping staging roots, copying unintended files, or emitting malformed release metadata. Preserve normal public-package behavior. Do not redesign the CLI or add runtime dependencies.

## Baseline

The review found a clean worktree. Package lint and typecheck passed; package tests were not run during this focused review because the current integration test invokes the host `npm`. Repository-wide checks had passed in the parallel architecture review.

Priority: P0 permits unintended publication or filesystem disclosure; P1 can create an incorrect release.

### Task PPSEC-01: Enforce package privacy and staging containment

Status: completed

Priority: P0

Suggested agent: filesystem and release-safety engineer

Dependencies: none

Primary ownership:

- `packages/publish-package/src/index.ts`
- `packages/publish-package/test/index.test.ts`

Finding:

Manifest generation drops `private` unconditionally (`src/index.ts:418-455`). Copy sources are joined without confinement (`692-700`), and lexical publish-directory checks do not prevent an existing symlink from redirecting writes outside the package root (`491-500`, `541-569`, `604-623`).

Implementation requirements:

1. Reject `private: true` before build, writes, or npm execution; add an opt-in only if a concrete consumer requires it.
2. Reject absolute, traversal, non-regular, and realpath-escaping copy sources while retaining optional missing defaults.
3. Prove the real publish destination remains below the real package root before destructive or write operations.

Acceptance criteria:

- Private packages and escaping source/destination symlinks fail before side effects.
- Nested regular files and normal nested publish directories still work.
- Regression tests preserve external marker files on every rejected case.

Completion evidence:

- Changed: `packages/publish-package/src/index.ts`, `packages/publish-package/test/index.test.ts`
- Verified: `pnpm --filter @repo-toolkit/publish-package test`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
- Result: publish planning now rejects `private: true`, copy sources must stay inside the real package/root directories, and publish-directory symlink escapes fail before build or writes.

### Task PPSEC-02: Validate and safely transform publish manifests

Status: completed

Priority: P1

Suggested agent: package-manifest contract engineer

Dependencies: PPSEC-01

Primary ownership:

- `packages/publish-package/src/index.ts`
- focused manifest tests

Finding:

JSON is cast directly to `PackageJson` and transformed without field validation (`383-385`, `418-451`, `756-815`). Array-form exports are left with stale `dist/` paths (`742-754`), `imports` is not handled, and prerelease tags are inferred with `split('-')[1]` (`387-399`), which mishandles build metadata and hyphenated identifiers.

Implementation requirements:

1. Validate plain-record manifests and every transformed field with path-aware errors.
2. Recursively rewrite supported export/import arrays and objects, or reject unsupported shapes explicitly.
3. Parse and validate semver-derived npm tags; reject unresolved `workspace:` ranges in final manifests unless explicitly allowed.
4. Detect distinct copy sources that flatten to the same destination; deduplicate identical pairs.

Acceptance criteria:

- Null, array, malformed dependency/bin/path fields fail during planning.
- Hyphenated prereleases, build metadata, nested conditional arrays, and copy collisions have regression tests.
- No invalid plan triggers build, staging, or npm execution.

Completion evidence:

- Changed: `packages/publish-package/src/index.ts`, `packages/publish-package/test/index.test.ts`
- Verified: `pnpm --filter @repo-toolkit/publish-package test` (64 tests pass), `pnpm lint`, `pnpm typecheck`, `pnpm test`
- Result: source/root manifests are now validated path-aware (name, version, dependencies, bin, main/module/types, exports/imports), `exports` and `imports` arrays are recursively rewritten for `dist/` paths, unsupported shapes throw explicit errors, `inferNpmTag` strips build metadata and leading `v`, unresolved `workspace:*`/`^`/`~` ranges in final manifests fail, and copy sources that share a basename or are duplicate entries are rejected before any file copy.

## Dependencies And Verification

Complete PPSEC-01 before PPSEC-02 because both modify staging validation. Verify each task with `pnpm --filter @repo-toolkit/publish-package test`; final integration requires `pnpm lint`, `pnpm typecheck`, `pnpm test`, and a controlled package-content smoke test with no real registry access.

## Definition Of Done

All acceptance criteria pass, external-path markers remain untouched, final manifests contain no unsupported unresolved paths/ranges, and a reviewer independently checks the privacy and containment boundaries.
