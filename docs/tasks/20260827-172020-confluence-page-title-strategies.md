# Configurable Confluence Page Title Strategies

Created: 2026-08-27 17:20:20 -0700

## Objective

Add a configurable leaf-page title strategy to `@repo-toolkit/confluence` so repositories with repeated Markdown basenames can generate readable, space-unique Confluence titles without renaming source files. Preserve the current filename-without-extension behavior as the default.

The public option should be named `pageTitleStrategy` in the JavaScript API and config files, exposed as `--page-title-strategy` in the CLI, and available as `CONFLUENCE_PAGE_TITLE_STRATEGY` and `INPUT_PAGE-TITLE-STRATEGY` in environment/Action usage.

## Confirmed Current Behavior

- `titleFromSegment` removes the final extension and is the only leaf title formatter (`packages/confluence/src/files.ts:60-66`).
- `syncEntry` uses that formatter for Confluence lookup, creation, and update (`packages/confluence/src/index.ts:403-469`).
- Local hierarchy validation independently derives the same filename-stem title (`packages/confluence/src/index.ts:663-684`).
- Directory segments become synthetic parent-page titles unchanged (`packages/confluence/src/index.ts:476-485`). This feature must not change directory-page titles.
- CLI/config/environment resolution has no title strategy input (`packages/confluence/src/cli.ts:20-36,112-180,220-270`).
- Current file tests cover only extension removal (`packages/confluence/test/files.test.ts:8-21`), and sync tests assume filename-stem titles (`packages/confluence/test/index.test.ts:242-489`).
- Confluence lookup is title-under-parent, and changing a generated title changes which remote page the additive sync maps to (`packages/confluence/src/index.ts:488-561`). There is no persisted source-path-to-page-id mapping.

## Naming Contract

Implement these exact strategy values and outputs for `community-nodes/cdogs-document-generator/credentials.md`:

| Strategy value          | Behavior                                                                                      | Example output                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `filename-stem`         | Original filename without the final `.md` extension                                           | `credentials`                                                           |
| `filename`              | Original filename including extension                                                         | `credentials.md`                                                        |
| `sentence-case-parent`  | Sentence-case filename stem plus immediate parent folder                                      | `Credentials (cdogs-document-generator)`                                |
| `sentence-case-parents` | Sentence-case filename stem plus all parent folders                                           | `Credentials (community-nodes/cdogs-document-generator)`                |
| `sentence-case-path`    | Sentence-case filename stem plus all parent folders and original filename including extension | `Credentials (community-nodes/cdogs-document-generator/credentials.md)` |

Contract details:

- `filename-stem` is the default and must be byte-for-byte compatible with the existing title behavior.
- Sentence case is deterministic and dependency-free: remove only the final case-insensitive `.md`; replace each run of `-` and `_` with one space; trim; lowercase ASCII letters; uppercase the first ASCII letter. Preserve digits and other punctuation. Examples: `failed-deployment.md` becomes `Failed deployment`, `n8n_setup.md` becomes `N8n setup`, and `README.md` becomes `Readme`.
- Parent folders are the `DocEntry.segments` before the filename. Exclude the configured documentation root itself and preserve each folder segment exactly as stored; join multiple folders with `/` on every platform.
- For `sentence-case-parent` and `sentence-case-parents`, omit the parentheses when a file is directly under the documentation root because no parent segment exists. For example, root `overview.md` becomes `Overview`.
- For root files under `sentence-case-path`, the parenthesized path is the filename itself. Root `overview.md` becomes `Overview (overview.md)`.
- Preserve the original filename and extension casing in `filename` and inside `sentence-case-path`; for example, `Guide.MD` remains `Guide.MD` where the original filename is included.
- Apply the strategy only to Markdown leaf pages. Folder-generated parent pages retain their existing raw segment titles.
- Reject unknown, empty, or non-string runtime values with an error that names `pageTitleStrategy` and lists all five accepted values. Do not silently fall back to the default for malformed config or environment input.
- Do not truncate or hash generated titles. If Confluence imposes a remote title-length limit, retain the existing API error behavior and document that path-based strategies can produce longer titles.

## Scope And Working Rules

- Preserve the existing default for API, config, CLI, environment, and GitHub Action consumers.
- Compute a leaf title through one shared pure formatter and use that result consistently in local validation, dry-run output, remote lookup, create, and update paths.
- Keep the package's zero-new-runtime-dependency convention; implement sentence casing locally.
- Update tests, CLI help, package README, canonical website guide, Action fixture, and public declarations together.
- Do not alter Markdown heading/front-matter parsing. A document's Confluence page title remains path-derived rather than content-derived.
- Do not rename, move, delete, or automatically migrate existing Confluence pages. Sync remains additive and non-pruning.
- Do not change `ConfluenceClient` transport behavior or the title-under-parent lookup contract in this work.
- Do not edit generated `dist/` artifacts as source. Builds may regenerate ignored outputs for verification.
- Do not revert unrelated worktree changes. Inspect status before editing and before final integration.
- Run website commands from `website/`, not from the workspace root.

## Baseline Verification

Observed before task creation on branch `dev` with a clean `git status --short`:

```text
pnpm --filter @repo-toolkit/confluence test
Test Files  6 passed (6)
Tests       224 passed (224)
```

The package test command builds `@repo-toolkit/publish-package` and `@repo-toolkit/confluence` before running Vitest. The repository also requires `pnpm lint` and `pnpm typecheck` after code changes (`AGENTS.md:18-45`).

## Priority Definitions

- P0: Required to prevent incorrect remote page mapping or incompatible default behavior.
- P1: Required public input, integration coverage, and consumer documentation.
- P2: Independent final verification and release-readiness evidence.

## Wave 1: Core Naming Contract

### Task CFNAME-01: Implement And Test The Pure Title Strategy

Status: completed

Completion evidence:

- Changed: `packages/confluence/src/files.ts`, `packages/confluence/test/files.test.ts`, `packages/confluence/src/index.ts` (export additions only), `packages/confluence/test/index.test.ts` (explicit export allowlist additions).
- Exported API: `PageTitleStrategy` type, `PAGE_TITLE_STRATEGIES` const, `DEFAULT_PAGE_TITLE_STRATEGY` (`filename-stem`), `resolvePageTitleStrategy(value)` (defaults undefined/null; error names `pageTitleStrategy` and lists all five values), and pure `pageTitleFromSegments(segments, strategy)`. `titleFromSegment` unchanged; `filename-stem` delegates to it.
- All five Naming Contract outputs covered by tests, including root-file behavior, dots in stems, repeated hyphens/underscores, digits, and `Guide.MD` casing preservation.
- Verified: `pnpm --filter @repo-toolkit/confluence test` — 6 files / 236 tests passed (baseline 224 + 12 new); `pnpm typecheck` passed; `pnpm lint` passed.

Priority: P0

Suggested agent: TypeScript library contract engineer

Dependencies: none

Primary ownership:

- `packages/confluence/src/files.ts`
- `packages/confluence/test/files.test.ts`
- intentional type/helper exports in `packages/confluence/src/index.ts`

Finding:

The package currently receives only one path segment and strips its final extension. It cannot use parent context to disambiguate repeated names such as `credentials.md`, `architecture.md`, or `README.md` in separate subtrees.

References:

- `packages/confluence/src/files.ts:7-16`
- `packages/confluence/src/files.ts:55-66`
- `packages/confluence/test/files.test.ts:8-21`

Implementation requirements:

1. Define and export a string-union type for the five strategy values in the Naming Contract.
2. Add a pure formatter that accepts the complete relative path segments plus a validated strategy and returns the leaf Confluence page title.
3. Keep `titleFromSegment` behavior intact for external consumers and directory/title compatibility; delegate to it where useful rather than changing its public contract.
4. Implement sentence casing and `/`-normalized parent selection exactly as specified without a new runtime dependency or locale-sensitive casing.
5. Cover root files, one parent, multiple parents, dots in the stem, repeated hyphens/underscores, digits, uppercase filenames/extensions, and platform-independent `/` output.
6. Make the new type/helper intentional public API exports and update the runtime/d.ts surface assertions in `packages/confluence/test/index.test.ts` if the repository's explicit allowlist requires it.

Acceptance criteria:

- The formatter produces all five table outputs for `community-nodes/cdogs-document-generator/credentials.md`.
- `filename-stem` produces exactly the same title as current `titleFromSegment` behavior for the existing fixture corpus.
- Root-level behavior matches the Naming Contract for all five strategies.
- Sentence-case edge-case tests fail against the old implementation and pass after the formatter is added.
- `pnpm --filter @repo-toolkit/confluence test` passes.
- `pnpm typecheck` passes with the repository's ES2018 library target.

## Wave 2: Sync And Validation Integration

### Task CFNAME-02: Apply One Resolved Title Throughout Sync

Status: completed

Completion evidence:

- Changed: `packages/confluence/src/index.ts`, `packages/confluence/test/index.test.ts` (also fixed unconditional `expect(createdTitles).not.toContain` assertion that failed for `filename-stem`).
- Added optional `pageTitleStrategy` to `ConfluenceSyncOptions` and required validated `pageTitleStrategy` to `ConfluenceSyncPlan` via `resolvePageTitleStrategy` (defaults to `filename-stem`; rejects unknown/empty/non-string with `Invalid pageTitleStrategy` listing all five values before tree read or API calls).
- `validateLocalSync` resolves each leaf title once via `pageTitleFromSegments(entry.segments, strategy)` and stores on `LocalSyncEntryPlan.title`; `syncConfluenceToDocs` consumes that exact value for dry-run, lookup, create, and update; `validateLocalHierarchy` compares the generated leaf title.
- Folder parent pages retain raw directory segment titles for every strategy.
- Dry-run lines now log `would sync <path> as "<title>"` with the resolved title.
- Tests: strategy-matrix lookup/create validation for all five strategies, `updatePage` title proof, repeated-basename disambiguation (`sentence-case-parents` → `Credentials (a)` vs `Credentials (b)`), default-regression ordering check (`a, credentials, b, credentials` vs strategy-specific titles), two negative invalid-strategy tests (zero gateway calls, including dry-run), conflict detection via `sentence-case-parent` against sibling folder `Overview (guide)`, and dry-run generated-title assertion.
- Verified: `pnpm --filter @repo-toolkit/confluence test` — 6 files / 249 tests passed (baseline 224 + 12 CFNAME-01 + 13 new CFNAME-02); `pnpm typecheck` passed; `pnpm lint` passed.

Priority: P0

Suggested agent: Confluence synchronization engineer

Dependencies: CFNAME-01

Primary ownership:

- `packages/confluence/src/index.ts`
- `packages/confluence/test/index.test.ts`

Finding:

Leaf title generation currently occurs independently in sync traversal and hierarchy validation. Adding strategy handling to only one site could validate one title but look up/create/update another, causing duplicate pages or incorrect remote mapping.

References:

- `packages/confluence/src/index.ts:53-115`
- `packages/confluence/src/index.ts:270-329`
- `packages/confluence/src/index.ts:332-384`
- `packages/confluence/src/index.ts:387-485`
- `packages/confluence/src/index.ts:663-684`

Implementation requirements:

1. Add optional `pageTitleStrategy` to `ConfluenceSyncOptions` and required, validated `pageTitleStrategy` to `ConfluenceSyncPlan`; default it to `filename-stem`.
2. Validate runtime values in `resolveConfluenceSyncPlan`, including JavaScript callers and untyped config objects, before reading the doc tree or making API calls.
3. Resolve each leaf title once during local planning, store it on `LocalSyncEntryPlan`, and consume that exact value in hierarchy validation, dry-run logging, lookup, create, and update operations. If a smaller shared design is demonstrably cleaner, it must still prevent independent re-derivation.
4. Keep folder-generated parent-page titles unchanged for every strategy.
5. Update local same-parent file/folder conflict validation to compare the generated leaf title selected by the plan, not always the filename stem.
6. Include the generated title in every dry-run entry line so users can verify naming before remote mutation.
7. Preserve attachment handling, Mermaid handling, skip-unchanged behavior, `SyncMutationError` evidence, and create-with-final-body optimization.
8. Add fake-gateway integration tests asserting exact titles sent to `getPagesByTitle`, `createPage`, and `updatePage` for each strategy, including repeated basenames under different parents.
9. Add a regression test proving omitted strategy keeps all existing title calls and page mapping unchanged.
10. Add a negative test proving an invalid strategy causes zero gateway calls and zero remote mutations.

Acceptance criteria:

- API users can select each strategy and observe the exact title in lookup/create/update calls.
- The default remains `filename-stem`, and existing sync tests remain behaviorally unchanged.
- Folder pages retain raw directory names while only leaf pages use the selected strategy.
- Dry-run output includes both the relative source path and resolved Confluence title for every entry.
- Invalid strategy input fails before client construction or API calls with the documented accepted-values message.
- Local hierarchy conflict detection uses the selected strategy and fails before mutation when a generated leaf title conflicts with a sibling folder page.
- `pnpm --filter @repo-toolkit/confluence test` passes.
- `pnpm lint` and `pnpm typecheck` pass.

## Wave 3: Consumer Inputs And Documentation

### Task CFNAME-03: Expose The Strategy Across CLI, Environment, Action, And Docs

Status: completed

Completion evidence:

- Changed: `packages/confluence/src/cli.ts` (SPECS `page-title-strategy`, `StringOptionKey` `pageTitleStrategy`, `ENV_BINDINGS` for `CONFLUENCE_PAGE_TITLE_STRATEGY`/`INPUT_PAGE-TITLE-STRATEGY` with CLI>config>CONFLUENCE>INPUT>default precedence, special passthrough for empty strings so validator rejects them, `buildOptions` mapping, help text listing flag and five values with default and env var `CONFLUENCE_PAGE_TITLE_STRATEGY`), `packages/confluence/test/cli.test.ts` (extended `PRESERVED_ENV_KEYS` + new `describe('confluence cli page-title-strategy')` with 7 tests: CLI parsing, CONFLUENCE vs INPUT precedence, full CLI>config>CONFLUENCE>INPUT>default chain, default-to-filename-stem via plan, malformed CLI/config/env all throw `Invalid pageTitleStrategy` with five values, `--help` lists flag/default, dry-run emits `Page (sub)`/`Index`), `packages/confluence/action-fixture/action.yml` (added `page-title-strategy` input), `packages/confluence/action-fixture/smoke.mjs` (sets `INPUT_PAGE-TITLE-STRATEGY='sentence-case-parent'` and asserts dry-run stdout contains `Page (sub)` and `Index` + token-not-echoed), `packages/confluence/README.md` and `website/docs/packages/confluence.md` (new leaf title strategies table for `community-nodes/...` examples, root-file rules, sentence-case rules with `failed-deployment`/`n8n_setup`/`README` examples, migration/uniqueness notes, flag row, env table row, JS API example with optional `pageTitleStrategy`, exports list and action.yml example updated).
- Malformed CLI/config/env values all flow to `resolvePageTitleStrategy`/`resolveConfluenceSyncPlan` and throw `Invalid pageTitleStrategy: expected one of filename-stem, filename, sentence-case-parent, sentence-case-parents, sentence-case-path, got ...`.
- Verified: `pnpm --filter @repo-toolkit/confluence test` — 6 files / 256 tests passed (+7 CFNAME-03); `node packages/confluence/action-fixture/smoke.mjs` — PASS with `Page (sub)` / `Index` titles; `pnpm lint` passed; `pnpm typecheck` passed; `pnpm build` passed; `pnpm --filter website` typecheck/build passed from `website/`; `node packages/confluence/dist/cli.js --help` lists flag and `CONFLUENCE_PAGE_TITLE_STRATEGY`; `pnpm --filter @repo-toolkit/confluence pack` tarball contains `dist/index.d.ts` with `PAGE_TITLE_STRATEGIES` declaration.

Priority: P1

Suggested agent: CLI and package documentation engineer

Dependencies: CFNAME-02

Primary ownership:

- `packages/confluence/src/cli.ts`
- `packages/confluence/test/cli.test.ts`
- `packages/confluence/action-fixture/action.yml`
- `packages/confluence/action-fixture/smoke.mjs`
- `packages/confluence/README.md`
- `website/docs/packages/confluence.md`

Finding:

Consumers currently have no CLI, config, environment, or Action input for title selection. Documentation states that pages are keyed by title under parent but does not explain title migration when a path-derived strategy changes.

References:

- `packages/confluence/src/cli.ts:20-36`
- `packages/confluence/src/cli.ts:60-109`
- `packages/confluence/src/cli.ts:112-180`
- `packages/confluence/src/cli.ts:220-270`
- `packages/confluence/README.md:25-114,158-194,196-223`
- `website/docs/packages/confluence.md:31-106,267-290`
- `packages/confluence/action-fixture/action.yml:9-37`
- `packages/confluence/action-fixture/smoke.mjs:14-91`

Implementation requirements:

1. Add `--page-title-strategy <value>` to `SPECS`, option building, help output, and CLI tests.
2. Add `CONFLUENCE_PAGE_TITLE_STRATEGY` and `INPUT_PAGE-TITLE-STRATEGY` bindings with existing per-option precedence: CLI > config > `CONFLUENCE_*` > `INPUT_*` > default.
3. Ensure malformed CLI, config, and environment values reach the shared runtime validator and return the same accepted-values error.
4. Extend preserved/cleared environment lists in CLI tests so host environment values cannot leak into tests.
5. Add the input to the Action fixture and set a non-default strategy in the smoke test; assert dry-run output contains the expected generated title as proof that the input reached the sync plan.
6. Document the option, five values, default, exact examples, root-file behavior, and sentence-case rules in CLI help, package README, and canonical website guide.
7. Update the JavaScript API example/types documentation to show `pageTitleStrategy` as optional.
8. Add a prominent migration note: changing the strategy changes title-based identity; additive sync may create a new page and leave the old page untouched. Operators must rename/delete/archive old generated pages or migrate them manually before switching.
9. Document that path-based strategies reduce local basename collisions but cannot guarantee uniqueness against unrelated/manual pages already present in the target space.
10. Keep the Action integration in this repository limited to the package fixture. Record the downstream `egose/actions/confluence` input plumbing as a release follow-up if that repository does not automatically forward `INPUT_PAGE-TITLE-STRATEGY`.

Acceptance criteria:

- CLI flag, config key, both environment forms, and JavaScript API all select the same strategy and output.
- Precedence tests cover conflicting values from all input sources.
- `repo-toolkit-confluence --help`, package README, and website guide list the same five values and `filename-stem` default.
- Action smoke proves a non-default title strategy reaches dry-run output without network access.
- Documentation clearly states migration and non-pruning consequences before showing non-default examples.
- `pnpm --filter @repo-toolkit/confluence test` passes.
- `node packages/confluence/action-fixture/smoke.mjs` passes after the package build.
- `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass from the repository root.
- `pnpm --filter website typecheck` and `pnpm --filter website build` pass when run from `website/`.

## Wave 4: Independent Integration Review

### Task CFNAME-04: Verify The Published Contract And Migration Safety

Status: completed

Completion evidence:

- Independent verification (reviewer did not author CFNAME-01..03 implementation; re-ran all surfaces): `pageTitleFromSegments` API matches Naming Contract for 9 cases (community-nodes stack all five strategies + root behavior for filename-stem/sentence-case-parent/sentence-case-path + Guide.MD casing) — all PASS via `dist/index.js`; built CLI dry-runs: default `index.md` → `index` vs `--page-title-strategy sentence-case-parent` → `Index` and `sub/page.md` → `Page (sub)` (spawnSync with INPUT_PAGE-TITLE-STRATEGY also produced `Index`/`Page (sub)` — smoke fixture PASS).
- Default regression: `resolveConfluenceSyncPlan` without `pageTitleStrategy` returns `filename-stem` and existing sync tests retain ordering `a, credentials, b, credentials` (verified via CFNAME-02 regression test — no migration required when option omitted).
- Non-default consistency: fake-gateway matrix (CFNAME-02) proves same resolved title appears in `validateLocalHierarchy`, `[dry-run] … as "…"`, `getPagesByTitle`, `createPage`, and `updatePage` for each strategy; conflict validation still triggers for sibling `Overview (guide)` folder collision.
- Packed artifact: `pnpm --filter @repo-toolkit/confluence pack` → tarball contains `dist/cli.js`, `dist/index.js`, `dist/index.d.ts`, `package.json`, `README.md`, `LICENSE`; `dist/index.d.ts` exports `PageTitleStrategy`, `PAGE_TITLE_STRATEGIES`, `DEFAULT_PAGE_TITLE_STRATEGY`, `resolvePageTitleStrategy`, `pageTitleFromSegments` plus `ConfluenceSyncOptions.pageTitleStrategy?` / `ConfluenceSyncPlan.pageTitleStrategy`.
- Contract agreement: `node dist/cli.js --help` lists `--page-title-strategy <value>` with five values and default `filename-stem` and env `CONFLUENCE_PAGE_TITLE_STRATEGY`; `README.md` flags, env table, leaf title strategies section, JS API example, and `action.yml` example all list same five values/default; `website/docs/packages/confluence.md` flags/ env table/ leaf title strategies section/ exports/ action.yml example match; `action-fixture/action.yml` input and `smoke.mjs` non-default `sentence-case-parent` proof agree.
- Git diff clean: only `packages/confluence/src/{cli.ts,files.ts,index.ts}`, `packages/confluence/test/{cli.test.ts,files.test.ts,index.test.ts}`, `packages/confluence/{README.md,action-fixture/*}`, `website/docs/packages/confluence.md` changed; no `dist/` artifacts, no secrets, no unrelated worktree changes; `CHANGELOG.md` untouched.
- Commands: `pnpm --filter @repo-toolkit/confluence test` — 6 files / 256 tests passed; `pnpm lint` / `pnpm typecheck` / `pnpm build` (root) — all PASS; `node packages/confluence/action-fixture/smoke.mjs` — PASS (dry-run titles `Page (sub)`/`Index`); `pnpm typecheck` / `pnpm build` from `website/` — PASS (Docusaurus build success); migration demo with fake gateway (existing page `credentials` under parent `123` found by default strategy, missed by `sentence-case-parents` which seeks `Credentials (community-nodes/cdogs-document-generator)` and would create new page without deleting old — confirms additive non-pruning behavior).

Priority: P2

Suggested agent: Independent release reviewer who did not implement CFNAME-01 through CFNAME-03

Dependencies: CFNAME-01, CFNAME-02, CFNAME-03

Primary ownership:

- review-only across `packages/confluence/`, `website/docs/packages/confluence.md`, and packed artifacts
- task completion evidence in this file

Finding:

This feature crosses the pure path formatter, local preflight, remote mapping, four configuration surfaces, public declarations, and documentation. A partial implementation can silently retain old titles on one code path or create unexpected pages after a strategy change.

References:

- all files and acceptance criteria owned by CFNAME-01 through CFNAME-03
- `AGENTS.md:18-45,74-93,103-110`

Implementation requirements:

1. Review each strategy against the Naming Contract using API-level and built-CLI dry runs.
2. Verify the default produces no title behavior change and no migration is required for users who omit the option.
3. Verify a non-default strategy uses the same title for local conflict validation, dry-run, lookup, create, and update.
4. Inspect the packed package for the intended runtime files and public declaration type; do not commit generated `dist/` output.
5. Confirm CLI help, README, website, Action fixture, and public types agree on names, defaults, accepted values, and migration behavior.
6. Check `git diff` for unrelated changes and verify no generated or secret files are included.
7. Append completion evidence to each completed task rather than rewriting the original findings.

Acceptance criteria:

- Independent review finds no mismatch among formatter, plan, sync, CLI, environment, Action, API type, or docs.
- `pnpm --filter @repo-toolkit/confluence test` passes.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass from the repository root.
- `pnpm --filter @repo-toolkit/confluence pack` succeeds and the tarball exposes the intended `pageTitleStrategy` declaration and built CLI behavior.
- `node packages/confluence/action-fixture/smoke.mjs` passes.
- Website typecheck/build pass from `website/`.
- Migration behavior is manually demonstrated with a fake gateway: default finds the old filename-stem page, while a changed strategy seeks the new title and does not rename/delete the old page.

## Dependency And Parallelization Guidance

- Execute CFNAME-01 before CFNAME-02 because the sync must consume one stable formatter contract.
- Execute CFNAME-02 before CFNAME-03 because CLI/docs examples must reflect verified runtime behavior and dry-run output.
- Do not run CFNAME-01 and CFNAME-02 in parallel; both modify `packages/confluence/src/index.ts` exports and related tests.
- Documentation work inside CFNAME-03 may begin after the option names and formatter outputs are fixed, but merge it only after CFNAME-02 tests establish runtime behavior.
- Run root builds/tests serially with website builds. They are separate projects, and `AGENTS.md` requires website commands to run from `website/`.
- Reserve CFNAME-04 for an independent reviewer after all implementation tasks are complete.

## Deferred Decisions And Follow-Ups

- Downstream Action release: this repository can support `INPUT_PAGE-TITLE-STRATEGY` and update its fixture, but the separately versioned `egose/actions/confluence` composite action may need a matching declared input and environment forwarding change. Confirm and track that in the Action repository before advertising end-to-end availability there.
- Existing Confluence pages: no automatic page rename or source-path/page-id migration is included. Operators selecting a new strategy own the one-time remote migration described in the docs.
- Global remote uniqueness: these strategies reduce predictable local collisions but do not query or reserve every title in a Confluence space during local preflight. Existing unrelated pages can still cause Confluence API conflicts.

None of these decisions blocks implementation of the package option as specified.

## Definition Of Done

- All five strategies match the Naming Contract through the JavaScript API and built CLI.
- `filename-stem` remains the default and preserves existing behavior.
- One resolved leaf title is used consistently in preflight, dry-run, lookup, create, update, and conflict validation.
- CLI, config, environment, Action fixture, public types, README, and website documentation agree.
- Migration and additive/non-pruning consequences are documented.
- Targeted, root, Action smoke, package artifact, and website verification commands pass.
- An independent reviewer records completion evidence and confirms no unrelated work or generated artifacts are included.
