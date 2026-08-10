# Publish Packages Graph And Contracts

Created: 2026-08-04 14:19:59

## Objective

Make workspace ordering reproducible, clarify package ownership boundaries, and replace live-repository/host-npm assumptions with isolated tests.

### Task MPARC-01: Build a deterministic complete dependency graph

Status: completed

Priority: P1

Suggested agent: graph algorithm engineer

Dependencies: MPSEC-01 in the related correctness file

Primary ownership:

- `packages/publish-packages/src/index.ts:92-135,211-285`
- graph fixtures

Finding:

Build ordering reuses publish-manifest dependency fields and omits internal `devDependencies` (`123-127`). Unrelated order follows unsorted filesystem enumeration (`217-220`), making `--from` platform-dependent.

Implementation requirements:

1. Define build-order dependency fields locally, including `devDependencies`.
2. Apply a documented lexical tie-breaker to discovery and topological ordering.
3. Prefer an iterative algorithm if it also simplifies cycle reporting and removes recursion-depth risk.

Acceptance criteria:

- Every permutation of the same graph yields the same order.
- Internal development dependencies precede dependents.
- Cycle, independent-package, selector, and `--from` cases use isolated fixtures.

Completion evidence:

- Changed: `packages/publish-packages/src/index.ts`, `packages/publish-packages/test/index.test.ts`
- Verified: `pnpm --filter @repo-toolkit/publish-packages test`
- Result: publish ordering now sorts packages and dependency edges lexically for determinism and includes internal `devDependencies` in the build-order graph.

### Task MPARC-02: Centralize downstream option adaptation and validate config

Status: completed

Priority: P1

Suggested agent: API boundary engineer

Dependencies: MPSEC-01

Primary ownership:

- `packages/publish-packages/src/index.ts:137-207`
- `packages/publish-packages/src/cli.ts`

Finding:

Shared options are duplicated across types, planning, and execution, which caused the default-file defect. Executable config values are cast without runtime schema validation (`cli.ts:110-124`).

Implementation requirements:

1. Add one pure, exhaustively tested adapter from monorepo plan/package to `PublishPackageOptions`.
2. Validate config keys and value types before plan resolution.
3. Expose resolved plans as readonly values or defensive copies.

Acceptance criteria:

- Table-driven tests cover every forwarded option exactly once.
- Wrong types, unknown keys, empty selectors, and invalid array members fail clearly.
- Public plan consumers cannot mutate shared defaults.

Completion evidence:

- Changed: `packages/publish-packages/src/index.ts`, `packages/publish-packages/test/index.test.ts`
- Verified: `pnpm --filter @repo-toolkit/publish-packages test`
- Result: publish-package option adaptation is centralized, plan arrays are defensive frozen copies, and runtime validation now rejects unknown config keys plus invalid selector/file-list values.

### Task MPARC-03: Add workspace contract and isolated CLI/package tests

Status: pending

Priority: P2

Suggested agent: repository test engineer

Dependencies: MPARC-01, MPARC-02

Primary ownership:

- `packages/publish-packages/test/`
- root metadata contract test
- `packages/publish-packages/README.md`

Finding:

Plan tests depend on this repository's current packages, CLI behavior is untested, and no contract checks workspace aliases, root scripts, unique bins, internal ranges, or docs membership. README flags are incomplete and explicit `workspace:` behavior is misstated.

Implementation requirements:

1. Move plan/selection tests to temporary workspaces and fake npm execution.
2. Add a repository contract test owned here for package metadata synchronization.
3. Cover CLI help, lists, no-default flags, config precedence, errors, and packed ESM/bin/type contracts.
4. Correct README options and workspace-range wording.

Acceptance criteria:

- Package tests do not depend on live workspace members or host npm configuration.
- Removing a required alias/script/docs entry makes the contract fixture fail.
- Package test, root lint/typecheck/test, build, and pack smoke checks pass.

## Definition Of Done

An independent reviewer checks deterministic graph behavior, complete option forwarding, package metadata synchronization, and documentation against runtime output.
