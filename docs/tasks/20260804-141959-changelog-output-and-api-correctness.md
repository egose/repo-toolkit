# Changelog Output And API Correctness

Created: 2026-08-04 14:19:59

## Objective

Prevent changelog data loss and align the public API with the pinned conventional-changelog contracts.

### Task CLSEC-01: Make changelog writes atomic and preserve existing content

Status: completed

Priority: P0

Suggested agent: Node stream and filesystem engineer

Dependencies: none

Primary ownership:

- `packages/changelog/src/index.ts:168-191`
- `packages/changelog/test/index.test.ts`

Finding:

The output stream opens in truncating mode even when `append` is requested (`index.ts:171`), and incremental prepend also never reads existing content. The destination is truncated before generator success, with incomplete cross-stream teardown.

Implementation requirements:

1. Define append, incremental prepend, and full-regeneration behavior explicitly.
2. Compose into a sibling temporary file, use coordinated stream teardown, and atomically rename only after success.
3. Normalize separators without accumulating blank lines.

Acceptance criteria:

- Existing `OLD` content is preserved in the correct order for append/prepend.
- Generator and destination failures leave the original unchanged and remove temporary files.
- Missing destinations and full regeneration remain supported.

Completion evidence:

- Changed: `packages/changelog/src/index.ts`, `packages/changelog/test/index.test.ts`
- Verified: `pnpm --filter @repo-toolkit/changelog test`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
- Result: atomic sibling temp-file writes now preserve existing changelog content for prepend and append modes, and regression tests cover generator failure cleanup.

### Task CLSEC-02: Route tag and first-release options correctly

Status: completed

Priority: P1

Suggested agent: conventional-changelog integration engineer

Dependencies: none

Primary ownership:

- `packages/changelog/src/index.ts:7-33,194-223`
- real temporary-Git tests

Finding:

`tagPrefix` and `skipUnstable` are sent to generator options rather than tag configuration (`209-223`). `firstRelease` is passed as an unknown option while `releaseCount` already defaults to all releases (`77-86`, `209-216`), so advertised behavior is ineffective.

Implementation requirements:

1. Put prefix and unstable filtering in the upstream tag config.
2. Decide whether normal mode defaults to one release or remove inert first-release behavior; document precedence with `releaseCount`.
3. Validate `releaseCount` as a canonical non-negative safe integer in CLI and config paths.

Acceptance criteria:

- Real Git fixtures prove prefix, prerelease filtering, release count, and first-release behavior.
- Resolved upstream options contain no unsupported fields.
- Invalid numeric CLI inputs exit nonzero with precise errors.

Completion evidence:

- Changed: `packages/changelog/src/index.ts`, `packages/changelog/src/cli.ts`, `packages/changelog/test/index.test.ts`, `packages/changelog/test/integration.test.ts`
- Verified: `pnpm --filter @repo-toolkit/changelog test`
- Result: tag prefix and unstable filtering now flow through generator tag options, `firstRelease` maps to full regeneration, and real Git fixtures cover tag-prefix, prerelease filtering, and release-count behavior.

### Task CLSEC-03: Align preset option types with the pinned dependency

Status: completed

Priority: P1

Suggested agent: TypeScript declaration engineer

Dependencies: CLSEC-02

Primary ownership:

- `packages/changelog/src/index.ts:34-86,194-223`
- `packages/changelog/src/conventional-changelog-conventionalcommits.d.ts`
- README and tests

Finding:

The package advertises formatter callbacks not consumed by conventionalcommits 9.3.1 and omits supported URL-format fields and `bumpStrict`. The ambient declaration is untyped and emits `Promise<any>` for `createPreset`.

Implementation requirements:

1. Replace the broad declaration with the narrow accepted config and preset result shapes.
2. Remove or adapt unsupported callback fields and expose supported URL formats and `bumpStrict`.
3. Update public docs and compile-time/runtime examples together.

Acceptance criteria:

- Generated declarations expose no `any` return for `createPreset`.
- Invalid preset shapes fail typecheck; every documented option affects a real preset fixture.
- `pnpm --filter @repo-toolkit/changelog test`, root lint/typecheck/test, build, and pack smoke pass.

Completion evidence:

- Changed: `packages/changelog/src/index.ts`, `packages/changelog/src/conventional-changelog-conventionalcommits.d.ts`, `packages/changelog/README.md`, `packages/changelog/test/index.test.ts`
- Verified: `pnpm --filter @repo-toolkit/changelog test`
- Result: preset typings now model the pinned `conventionalcommits` package, unsupported formatter callbacks were removed from the public options, and supported URL format plus `bumpStrict` options are documented and tested.

## Definition Of Done

An independent reviewer verifies failure-safe output, real Git tag behavior, and agreement among pinned dependency behavior, public types, tests, and README.
