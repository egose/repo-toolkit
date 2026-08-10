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

Status: pending

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

### Task PPARC-03: Split internal responsibilities and document public helpers

Status: pending

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

## Definition Of Done

An independent reviewer verifies parser adversarial cases, subprocess isolation, public types/docs, and that no new runtime dependency or compatibility shim was introduced without justification.
