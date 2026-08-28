# Confluence Managed Page Labels, Parent Summary, Clean, And Pruning

Created: 2026-08-27 19:47:40 -0700

## Objective

Make the local documentation tree authoritative for pages created or adopted by `@repo-toolkit/confluence`, without deleting unrelated Confluence content.

Add an optional `clean` boolean to the JavaScript API and config (`clean`), CLI (`--clean`), environment (`CONFLUENCE_CLEAN`), and GitHub Action input (`INPUT_CLEAN`). It defaults to `false`. When enabled, a real sync first moves every page descendant of `parentPageId` to the Confluence trash, then recreates the local documentation hierarchy. The target page itself must never be deleted.

Every generated folder page and Markdown leaf page that the tool creates, updates, or otherwise maps as part of a successful sync must carry one fixed global Confluence label:

```text
repo-toolkit-confluence
```

On later real syncs with `clean: false`, remove remote descendants that carry that label but whose page ids were not mapped from the current local documentation tree. Never prune an unlabeled page. This changes the current sync contract from strictly additive to managed-page reconciliation while preserving manual/unlabeled content by default.

Add an optional `updateParentPage` boolean to the JavaScript API and config (`updateParentPage`), CLI (`--update-parent-page` / `--no-update-parent-page`), environment (`CONFLUENCE_UPDATE_PARENT_PAGE`), and GitHub Action input (`INPUT_UPDATE-PARENT-PAGE`). It defaults to `true`. After child-page sync and reconciliation succeed, update a tool-owned region in the target parent page with source provenance, deterministic documentation statistics, a linked tree of generated child pages, and concise ownership/reconciliation guidance while preserving unrelated parent-page content.

## Confirmed Current Behavior

- `ConfluenceSyncOptions` and `ConfluenceSyncPlan` contain no `clean` option (`packages/confluence/src/index.ts:67-137`).
- The sync returns before constructing a client when the local tree is empty, so an empty local directory cannot currently reconcile remote pages (`packages/confluence/src/index.ts:364-372`).
- Local validation runs before client construction and remote mutation; this safety boundary must remain ahead of clean, labeling, and pruning (`packages/confluence/src/index.ts:364-400`).
- Remote identity is currently title-under-parent. `PageTitleCache` records ids internally, but the complete set of generated folder and leaf page ids is not exposed to a reconciliation phase (`packages/confluence/src/index.ts:419-594`).
- `ConfluenceGateway` supports page lookup/create/update and attachments only. It cannot enumerate descendants, inspect/add labels, or delete pages (`packages/confluence/src/confluence-client.ts:32-67`).
- `ConfluenceClient` uses REST v2 for pages and REST v1 only for multipart attachment writes. It already has bounded, cross-origin-safe cursor pagination that new list methods should reuse (`packages/confluence/src/confluence-client.ts:203-238,276-305,399-505,681-697`).
- Current result/error evidence describes created, updated, and unchanged local entries only. It cannot identify label or deletion work and assumes every failure belongs to a local `DocEntry` (`packages/confluence/src/index.ts:249-298,403-416`).
- CLI boolean handling already supports defaults, config precedence, `CONFLUENCE_*`, and `INPUT_*`, but `clean` is absent from specs, boolean keys, environment bindings, help, and tests (`packages/confluence/src/cli.ts:20-59,61-113,152-210,231-264`).
- Documentation explicitly promises additive, non-pruning behavior and manual cleanup after a title-strategy change; those statements must change with the new contract (`packages/confluence/README.md:134-138,222-232`; `website/docs/packages/confluence.md:269-314`).
- The Action fixture has no `clean` or `update-parent-page` input (`packages/confluence/action-fixture/action.yml:9-44`).
- The target parent is currently only used as the root `parentId`. Sync never reads or updates its body, and no local plan records the complete path-to-page metadata needed for a linked parent-page tree (`packages/confluence/src/index.ts:364-417,419-594`).

## Atlassian API Contract

Use the currently documented Confluence Cloud contracts and pin them with transport tests:

- Enumerate the target subtree with paginated `GET /wiki/api/v2/pages/{id}/descendants`. Results are top-to-bottom and include `id`, `title`, `type`, `parentId`, and `depth`. Only `type: page` is eligible for page deletion.
- Read a page's labels with paginated `GET /wiki/api/v2/pages/{id}/labels`.
- Add the ownership marker without replacing existing labels with `POST /wiki/rest/api/content/{id}/label` and body `[{ "prefix": "global", "name": "repo-toolkit-confluence" }]`. This REST v1 operation adds labels and preserves existing labels.
- Move a current page to trash with `DELETE /wiki/api/v2/pages/{id}`. Do not request `purge=true`; this feature must remain recoverable through Confluence trash.
- Follow cursor pagination for descendants and labels through same-origin next links, with the same loop and maximum-page guards as existing list methods.

References:

- <https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-descendants/#api-pages-id-descendants-get>
- <https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-label/#api-pages-id-labels-get>
- <https://developer.atlassian.com/cloud/confluence/rest/v1/api-group-content-labels/#api-wiki-rest-api-content-id-label-post>
- <https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/#api-pages-id-delete>

## Behavioral Contract

### Ownership Label

- Export a single constant such as `CONFLUENCE_MANAGED_LABEL` with exact value `repo-toolkit-confluence`; do not make the marker configurable in this work.
- Use prefix `global`. Compare both name and prefix when deciding ownership; a personal label with the same name is not an ownership marker.
- Preserve every pre-existing label. Never replace or remove labels as part of sync.
- Ensure the marker exists on all generated folder pages and Markdown leaf pages mapped by a successful real sync, including newly created, updated, and body-unchanged pages. The target `parentPageId` is an external anchor and must not be labeled.
- Check existing labels before adding the marker so a repeated unchanged sync does not issue a redundant label POST.
- Existing pages found by title-under-parent become tool-managed once the sync maps them and successfully adds the marker. Document this adoption behavior prominently because removing the local source later makes those pages eligible for pruning.
- A page is not considered safely managed until the marker POST succeeds. A create/update followed by a label failure must surface structured partial-mutation evidence and must prevent the prune phase from running.

### Default Managed Pruning (`clean: false`)

- Run local preflight before any remote call. Run pruning only after every local page has synced and its ownership label has been verified or added successfully.
- Track the page ids actually mapped during this run, including synthetic folder pages and Markdown leaves. Do not infer the expected remote set from titles after mutation; page ids are the reconciliation key.
- Enumerate all descendants under `parentPageId`, but never include `parentPageId` itself as a deletion candidate.
- A remote page is stale only when it has the exact global ownership marker and its id is absent from the current mapped-id set.
- Delete stale pages deepest-first so children are handled before parents.
- Never delete an unlabeled page. If deleting a stale labeled ancestor could also remove an unlabeled, non-page, inaccessible, or otherwise retained descendant, preserve that ancestor and log/report it as blocked rather than risking collateral deletion. Safe stale siblings may still be deleted.
- A local tree with zero Markdown entries is valid for reconciliation: it deletes every safely deletable managed descendant and retains every manual/unlabeled descendant. Remove the current early return that prevents this behavior.
- If sync fails before pruning, perform no stale-page deletions. If pruning fails partway, stop and return structured evidence listing completed deletions, the failed page, and candidates not processed.

### Explicit Clean (`clean: true`)

- `clean` defaults to `false` through every input path. No destructive reset may occur when the option is omitted.
- After successful local preflight and before creating/updating pages, enumerate the target subtree and move every page descendant to trash, regardless of ownership label. Never delete `parentPageId`.
- Delete deepest-first. A page containing a non-page or otherwise retained descendant must not be deleted unless the Atlassian contract is proven to preserve that descendant; otherwise fail before the first deletion with a clear unsupported-tree/collateral-deletion error. Do not silently widen `clean` from pages to whiteboards, databases, embeds, folders, or inaccessible content.
- After clean succeeds, run the normal sync and label every recreated page. Do not run a redundant post-sync prune against the newly created mapped set.
- A local tree with zero Markdown entries plus `clean: true` still performs the clean and leaves the target page with no safely deletable page descendants.
- Label lookup is not required to select clean candidates; `clean` is deliberately stronger than managed pruning. Documentation and help must warn that manual page descendants are moved to trash.
- On a partial clean failure, abort before page creation and expose completed deletions, the failed deletion, and remaining work.

### Dry Run And Concurrency

- Preserve the existing `dryRun` guarantee of zero API calls and no credential requirement. `dryRun + clean` must perform local validation and log that a remote clean would be requested, but it cannot enumerate or name remote deletion candidates without credentials.
- Dry run must also state that managed stale-page pruning would run during a real sync. It must not claim a concrete remote deletion count.
- Continue to avoid automatic retries for label POSTs and DELETEs. They are writes, not safe methods.
- Concurrent sync/clean jobs against the same target are unsupported and dangerous. Document that callers must serialize deployments; do not add distributed locking in this work.

### Target Parent Page Summary (`updateParentPage: true`)

- `updateParentPage` defaults to `true` through every input path. API/config callers can set `false`; CLI users can use `--no-update-parent-page`.
- Update the target parent only after child-page sync, ownership labeling, and clean/prune reconciliation have completed successfully. If any earlier phase fails, leave the parent summary unchanged.
- Never apply the managed ownership label to `parentPageId`; the parent remains an external anchor even though one region of its body is maintained by the tool.
- Read the current parent page, preserve its title and every byte of body content outside one clearly identified tool-managed region, and update with `version.number = current + 1` under the existing optimistic-concurrency contract.
- Choose a Confluence storage-format marker/region that survives a real API read/write round trip. The region must be uniquely identifiable. If markers are malformed or duplicated, fail closed without rewriting the parent. Do not replace the complete parent body as a shortcut.
- On the first run, append the managed region without removing existing content. On later runs, replace that region in place. Setting `updateParentPage: false` leaves both existing managed and manual parent content untouched; it does not remove a previously generated region.
- Skip the parent PUT when the reconstructed body is byte-equal to the current body. Do not include a wall-clock timestamp, current page version, per-run created/updated/deleted counts, or other volatile values that would force an update on every identical deployment.
- Include a `Synced documentation` heading and a provenance statement equivalent to the footer on generated child pages. When `repositoryUrl` resolves to a source URL, link to it. When it is absent, state only that the subtree is maintained by `repo-toolkit-confluence`; never expose an absolute runner path.
- Include deterministic structural statistics derived from the validated local plan and final mapping: Markdown page count, generated directory-page count, total managed child-page count, maximum documentation depth, local attachment-reference count, and Mermaid-block count. Zero values must render explicitly for an empty tree.
- Include a nested, deterministic directory-style tree for every generated directory and Markdown page. Preserve local relative-path ordering, display the resolved Confluence title, distinguish directory pages from Markdown leaves, and link each item to its mapped Confluence page. Build links from returned page metadata/id rather than title-only search.
- Include concise stable guidance that generated descendants carry the `repo-toolkit-confluence` label, missing labeled pages are pruned after successful sync, unlabeled pages are preserved by default, and explicit clean moves all safely deletable page descendants to trash.
- Keep the summary compact and storage-format safe. Do not copy child-page bodies, headings, excerpts, attachment names, repository secrets, credentials, local absolute paths, or unbounded remote metadata into the parent.
- With an empty local tree, render the provenance/guidance, zero statistics, and an explicit `No managed child pages` tree state.
- `dryRun` must retain zero API calls. It may print the locally known parent-summary statistics/tree titles, but it cannot claim the parent would be unchanged or emit remote links because it has not fetched the parent or mapped remote ids.
- A parent GET/PUT failure occurs after child reconciliation and must return structured phase-specific partial-mutation evidence showing that child work succeeded but the parent summary did not.

## Scope And Working Rules

- Keep the implementation dependency-free and within the existing `ConfluenceGateway` boundary.
- Extend the gateway and fake clients structurally; do not reintroduce `unknown as` casts.
- Preserve local preflight before every remote mutation, attachment behavior, title strategies, optimistic page-version handling, secret redaction, and same-origin pagination checks.
- Do not delete attachments independently. Trashing a page naturally scopes its attachments to that page.
- Do not purge trash, delete the configured target page, delete by title alone, or treat a repository notice/body text as ownership metadata.
- Do not use a label-only space-wide query as the reconciliation source. Scope every decision to descendants of the configured `parentPageId`.
- Bound remote traversal using the existing pagination cap and add an explicit maximum descendant count if the API can return more than the current cap safely represents. Fail closed before deletion when the subtree cannot be inventoried completely.
- Do not edit generated `dist/` artifacts as source. Builds may regenerate ignored output for verification.
- Do not revert unrelated worktree changes. Inspect status before editing and final integration.
- Run website commands from `website/`, not from the workspace root.

## Baseline Verification

Observed at task creation with a clean `git status --short`:

```text
pnpm --filter @repo-toolkit/confluence test
Test Files  6 passed (6)
Tests       256 passed (256)
```

The package test builds `@repo-toolkit/publish-package` and `@repo-toolkit/confluence` before Vitest. `AGENTS.md` also requires `pnpm lint` and `pnpm typecheck` after code changes and `pnpm test` for changes under `src/` or `test/`.

## Priority Definitions

- P0: Destructive-operation safety, ownership correctness, complete pagination, and no-delete default compatibility.
- P1: Parent summary generation, public option plumbing, structured reconciliation evidence, documentation, and Action coverage.
- P2: Independent end-to-end and published-contract verification.

## Wave 1: Remote Ownership And Deletion Gateway

### Task CFPRUNE-01: Add Paginated Descendant, Label, And Trash Operations

Status: completed

Completion evidence:

- Changed: `packages/confluence/src/confluence-client.ts`, `packages/confluence/src/index.ts`, `packages/confluence/test/confluence-client.test.ts`, `packages/confluence/test/index.test.ts`
- Added `ConfluenceGateway` methods `getPageDescendants`, `getPageLabels`, `addManagedLabel` (v1 additive POST, exact global/`repo-toolkit-confluence` body), `deletePage` (v2 DELETE, no purge, 204 accepted); shared bounded same-origin pagination helper; exported `CONFLUENCE_MANAGED_LABEL`, `PageDescendant`, `PageLabel`
- Verified: `pnpm --filter @repo-toolkit/confluence test` (6 files, 271 passed incl. 13 new transport tests), `pnpm lint`, `pnpm typecheck`
- Follow-up: none; orchestration continues in CFPRUNE-02

Priority: P0

Suggested agent: Confluence API and transport engineer

Dependencies: none

Primary ownership:

- `packages/confluence/src/confluence-client.ts`
- `packages/confluence/test/confluence-client.test.ts`
- intentional exports in `packages/confluence/src/index.ts`

Finding:

The current gateway cannot inventory the target subtree, determine ownership, add a non-destructive label, or trash a page. Implementing pruning directly in the orchestrator would bypass the package's tested pagination, URL, retry, and error-handling boundary.

References:

- `packages/confluence/src/confluence-client.ts:32-67`
- `packages/confluence/src/confluence-client.ts:118-121,203-238,276-305`
- `packages/confluence/src/confluence-client.ts:399-505,681-697`
- Atlassian API Contract in this task

Implementation requirements:

1. Add public types for the minimal descendant and label records needed by reconciliation.
2. Extend `ConfluenceGateway` and `ConfluenceClient` with methods that enumerate all descendants, enumerate all labels for one page, add a global label without replacing existing labels, and move a current page to trash.
3. Use REST v2 descendants/labels/delete endpoints and the REST v1 add-label endpoint exactly as documented above.
4. Reuse one bounded pagination helper or the existing pagination invariants: all pages accumulated, same-origin next links only, loop detection, and maximum-page protection.
5. Treat descendants and label GETs as retryable safe calls under the existing policy. Never retry POST/DELETE automatically.
6. Accept a successful empty-body `204` delete response through `requestJson` without attempting JSON parsing.
7. Ensure ids are encoded, the label POST has `Content-Type: application/json`, and the body uses exact `global` prefix and marker name.
8. Add transport tests for endpoint, method, payload, pagination, cross-origin/loop rejection, 204 deletion, and non-2xx errors.
9. Update runtime and declaration export allowlists only for intentionally public types/constants; do not expose pagination internals.

Acceptance criteria:

- A two-page descendant response and a two-page label response return every item exactly once.
- Cross-origin, looping, malformed, or over-limit pagination fails before any delete call.
- Adding the marker sends the exact v1 additive-label payload and does not use an update contract that replaces labels.
- Deleting a page calls v2 `DELETE /pages/{id}` without `purge=true` and accepts status 204.
- GETs retain bounded retry behavior while label POST and DELETE make one attempt.
- `ConfluenceClient` still structurally implements `ConfluenceGateway`, and typed fakes compile without casts.
- `pnpm --filter @repo-toolkit/confluence test` passes.
- `pnpm lint` and `pnpm typecheck` pass.

## Wave 2: Ownership And Reconciliation Orchestration

### Task CFPRUNE-02: Label Every Mapped Page And Reconcile Stale Managed Pages

Status: completed

Completion evidence:

- Changed: `packages/confluence/src/index.ts`, `packages/confluence/test/index.test.ts`
- Added `clean` option (default false) on options/plan; `SyncResult` extended with `labelsAdded`/`cleanDeletions`/`pruneDeletions`/`blocked`; new `ReconciliationError` (phase, completed, failure, unprocessed); exported pure planners `planStalePruning`/`planCleanDeletions` (deepest-first, protect target/expected/unlabeled/non-page/retained descendants, fail closed on incomplete inventories)
- Orchestration: empty-tree early return removed; every mapped folder/leaf page labeled adoptively without redundant POSTs; default prune runs only after full sync+label success; `clean: true` trash-deletes all page descendants pre-sync and skips the second prune pass; dry run stays credential-free with clean/prune intent logs
- Verified: `pnpm --filter @repo-toolkit/confluence test` (6 files, 301 passed, +30), `pnpm lint`, `pnpm typecheck`

Priority: P0

Suggested agent: synchronization correctness engineer

Dependencies: CFPRUNE-01

Primary ownership:

- `packages/confluence/src/index.ts`
- `packages/confluence/test/index.test.ts`

Finding:

The sync currently records local leaf outcomes but not the complete set of remote ids reached through folder and leaf mapping. It also exits for an empty tree. Safe pruning needs a complete mapped-id set, successful ownership marking, a complete descendant inventory, and a deletion phase that cannot run after partial sync failure.

References:

- `packages/confluence/src/index.ts:249-298`
- `packages/confluence/src/index.ts:364-417`
- `packages/confluence/src/index.ts:419-594`
- `packages/confluence/src/index.ts:695-722`

Implementation requirements:

1. Export `CONFLUENCE_MANAGED_LABEL = 'repo-toolkit-confluence'` and use it as the only ownership marker.
2. Add optional `clean?: boolean` to `ConfluenceSyncOptions`, required `clean: boolean` to `ConfluenceSyncPlan`, and resolve the default as `false` for API/config callers.
3. Preserve local validation before client construction and before every clean/prune mutation. An invalid local file or hierarchy must cause zero remote calls, including zero descendant or label reads.
4. Refactor the empty-tree path so a real sync can clean/prune while dry run remains local-only. Preserve the informational no-Markdown log without returning before reconciliation.
5. Track every folder and leaf page id mapped from the local plan. Keep expected-id collection inside the title cache/sync traversal rather than re-querying by title after sync.
6. Before considering a mapped page complete, fetch its labels and add the global marker only when absent. Include pages whose body is unchanged and existing synthetic folder pages.
7. Preserve other labels and prevent redundant label POSTs across repeated unchanged syncs.
8. With `clean: false`, sync and label the complete local tree first; only then inventory descendants and prune exact-label stale pages bottom-up according to the Behavioral Contract.
9. With `clean: true`, inventory and safely trash page descendants bottom-up after local preflight and before sync; then sync and label the local tree without a second prune pass.
10. Build deletion candidates from page ids and parent/depth metadata. Add a pure, unit-tested planner that protects the target, expected ids, unlabeled pages, retained descendants, non-page content, and incomplete inventories.
11. Extend success and failure evidence to distinguish page create/update/unchanged, label additions, clean deletions, prune deletions, blocked ancestors, failure phase, failed remote page, and unprocessed work. Preserve the existing useful `SyncMutationError` contract for page/attachment failures or introduce a documented compatible reconciliation error shape rather than dropping evidence.
12. Log every label addition, clean deletion, prune deletion, and blocked stale ancestor without credentials or token material.
13. Add fake-gateway integration tests covering nested trees, pagination-normalized inventories, empty local trees, title-strategy migration, and each partial-failure boundary.

Acceptance criteria:

- Omitting `clean` resolves to `false` and performs no pre-sync deletion.
- Every generated folder and leaf page ends a successful real sync with the exact global marker; the target parent remains unlabeled.
- A second identical sync with all labels present performs no page PUT, label POST, attachment mutation, or delete.
- An existing unlabeled page mapped by title is adopted by adding the marker; documentation calls out that later local removal makes it prune-eligible.
- Removing one local Markdown file deletes its labeled remote page after all remaining pages sync successfully.
- Removing a local directory deletes its safely deletable labeled leaf/folder hierarchy deepest-first.
- An unlabeled manual sibling is never deleted by default pruning.
- A stale labeled ancestor containing an unlabeled/manual retained descendant is not deleted; the blocked result is observable.
- Changing `pageTitleStrategy` creates/maps the new labeled page and prunes the old page only if the old page already has the ownership marker.
- An empty local tree prunes all safely deletable labeled descendants but preserves unlabeled descendants.
- `clean: true` deletes labeled and unlabeled page descendants before creation, never deletes `parentPageId`, and recreates/labels the local hierarchy.
- `clean: true` with an empty local tree leaves no safely deletable page descendants.
- Any local validation error causes zero gateway calls. Any sync/label failure prevents pruning. Partial clean/prune failure reports completed, failed, and unprocessed operations.
- Tests prove deletion is by id, not by title, and is ordered deepest-first.
- `pnpm --filter @repo-toolkit/confluence test` passes.
- `pnpm lint` and `pnpm typecheck` pass.

## Wave 3: Target Parent Page Summary

### Task CFPARENT-01: Build And Maintain The Parent Documentation Dashboard

Status: completed

Completion evidence:

- Changed: `packages/confluence/src/index.ts`, `packages/confluence/src/parent-summary.ts` (new), `packages/confluence/test/index.test.ts`, `packages/confluence/test/parent-summary.test.ts` (new)
- Added `updateParentPage` option (default `true`) on options/plan; `SyncResult` extended with `parentStatus`; new `ParentSummaryError` (phase `parent-summary`); extended `SyncTraversalState` with `mappedRecords`; pure deterministic renderer `renderParentSummary` + merge `mergeParentSummaryBody` with `<!-- repo-toolkit-confluence:parent-summary:start/end -->` markers
- Orchestration: parent fetch/merge/PUT after child sync/label/prune success with version `current+1`, byte-equal skip, `parent-updated`/`parent-unchanged` logs, fail-closed on malformed/duplicate markers, zero parent calls when disabled or dryRun, dryRun local stats/title-tree logs without remote ids
- Verified: `pnpm --filter @repo-toolkit/confluence test` (7 files, 333 passed), `pnpm lint`, `pnpm typecheck`

Priority: P1

Suggested agent: Confluence storage-format and synchronization engineer

Dependencies: CFPRUNE-02

Primary ownership:

- `packages/confluence/src/index.ts`
- `packages/confluence/test/index.test.ts`
- focused parent-summary rendering helper/tests if separation is necessary

Finding:

The target parent page is only a hierarchy anchor today. The sync does not summarize the managed subtree or retain path-to-page metadata after traversal, so readers cannot identify the source, understand the generated structure, or navigate a directory-style overview from the parent. Updating the whole parent body would be unsafe because the option is default-on and existing parents may contain manual content.

References:

- `packages/confluence/src/index.ts:95-119,122-137`
- `packages/confluence/src/index.ts:364-417`
- `packages/confluence/src/index.ts:419-594`
- `packages/confluence/src/index.ts:608-641`
- Target Parent Page Summary Behavioral Contract in this task

Implementation requirements:

1. Add optional `updateParentPage?: boolean` to `ConfluenceSyncOptions`, required `updateParentPage: boolean` to `ConfluenceSyncPlan`, and resolve the default as `true` for JavaScript/config callers.
2. Extend the successful child mapping from CFPRUNE-02 with enough stable metadata to render each local relative path, entry kind, resolved title, remote page id/link, depth, attachment-reference count, and Mermaid count without re-querying by title.
3. Implement a pure deterministic parent-summary renderer covering provenance, statistics, linked directory tree, ownership/reconciliation guidance, and the exact empty-tree state in the Behavioral Contract.
4. Implement a pure managed-region merge function that appends one region when absent, replaces exactly one valid region, preserves all outside bytes, and rejects malformed, nested, or duplicate markers.
5. Validate the chosen marker representation against Confluence storage format. Add a fixture for a body returned by Confluence after round trip; before production rollout, complete the disposable-site verification listed in Deferred Decisions. If Confluence does not preserve the proposed markers, select a supported macro/representation rather than falling back to whole-body replacement.
6. Run the parent update after clean/sync/label/prune success. Fetch `parentPageId`, preserve its existing title, merge the generated region into its storage body, and PUT only when the body changed using `current.version.number + 1` and `plan.versionMessage`.
7. Never label, delete, rename, or change the parent page's hierarchy. `updateParentPage: false` must cause zero parent GET/PUT calls and leave an existing managed region untouched.
8. Keep summary inputs deterministic. Do not include timestamps, current versions, per-run outcome counts, local absolute paths, child bodies/excerpts, or credentials.
9. Extend success/error evidence and logs with `parent-updated` / `parent-unchanged` outcomes and a distinct parent-summary failure phase after successful child reconciliation.
10. Under dry run, render/log only local statistics and title tree without constructing a client, fetching the parent, or fabricating remote links.
11. Add unit and fake-gateway integration tests for existing manual parent content, first append, in-place replacement, malformed/duplicate markers, empty local tree, disabled option, unchanged second run, optimistic versioning, parent PUT failure, and each requested summary section.

Acceptance criteria:

- Omitting `updateParentPage` resolves to `true`; explicitly setting false performs no parent read or write.
- A parent with existing manual storage content retains that content byte-for-byte outside one generated region.
- The generated region visibly states the source/maintenance provenance, or a safe generic tool statement when `repositoryUrl` is absent.
- Statistics exactly match the validated local plan for Markdown pages, generated directory pages, total managed pages, maximum depth, local attachment references, and Mermaid blocks.
- The nested tree includes every mapped generated page exactly once, in deterministic local order, with the resolved title and an id-backed Confluence link.
- The summary includes stable label/prune/clean guidance and no secrets, absolute paths, copied child bodies, timestamps, versions, or per-run counters.
- An empty tree renders zero statistics and `No managed child pages`.
- A second identical deployment performs no parent PUT.
- Malformed or duplicate managed-region markers fail without changing the parent body.
- Any child sync/label/reconciliation failure produces no parent GET/PUT. A parent PUT failure reports that child reconciliation already completed.
- Parent updates preserve title, use `version.number = current + 1`, and surface Confluence 409 conflicts without write retries.
- Dry run makes zero gateway calls while exposing the locally known parent-summary plan.
- `pnpm --filter @repo-toolkit/confluence test` passes.
- `pnpm lint` and `pnpm typecheck` pass.

## Wave 4: CLI, Action, And Documentation Contract

### Task CFPRUNE-03: Expose Clean And Document Managed Ownership

Status: completed

Completion evidence:

- Changed: `packages/confluence/src/cli.ts`, `packages/confluence/test/cli.test.ts`, `packages/confluence/action-fixture/action.yml`, `packages/confluence/action-fixture/smoke.mjs`, `packages/confluence/README.md`, `website/docs/packages/confluence.md`
- Added `--clean` (default false, destructive warning) and negatable `--update-parent-page`/`--no-update-parent-page` (default true) with `CONFLUENCE_CLEAN`/`INPUT_CLEAN` and `CONFLUENCE_UPDATE_PARENT_PAGE`/`INPUT_UPDATE-PARENT-PAGE` bindings and CLI>config>CONFLUENCE*\*>INPUT*\*>default precedence
- Added Action inputs `clean` (`false`) and `update-parent-page` (`true`); smoke test proves both inputs reach dry-run planning network-free
- Replaced additive-sync claims with ownership/adoption/label-gated pruning/blocked-ancestor/trash-not-purge/clean contracts; documented parent summary, dry-run limits, permissions, and serialization
- Verified: `pnpm --filter @repo-toolkit/confluence test` (7 files, 343 passed), `node packages/confluence/action-fixture/smoke.mjs` (4 phases), `pnpm lint`, `pnpm typecheck`, `pnpm build` (root), `pnpm typecheck` + `pnpm build` (website)

Priority: P1

Suggested agent: CLI and consumer documentation engineer

Dependencies: CFPRUNE-02, CFPARENT-01

Primary ownership:

- `packages/confluence/src/cli.ts`
- `packages/confluence/test/cli.test.ts`
- `packages/confluence/action-fixture/action.yml`
- `packages/confluence/action-fixture/smoke.mjs`
- `packages/confluence/README.md`
- `website/docs/packages/confluence.md`

Finding:

Consumers have no clean or parent-summary inputs, and the package README/website promise that sync never deletes pages. The title-strategy migration guidance also assumes old generated pages always require manual cleanup, while the target parent is undocumented as a default-on generated dashboard surface.

References:

- `packages/confluence/src/cli.ts:20-59,61-113`
- `packages/confluence/src/cli.ts:152-210,231-264`
- `packages/confluence/README.md:65-116,134-180,198-232`
- `website/docs/packages/confluence.md:43-108,250-314,316-462`
- `packages/confluence/action-fixture/action.yml:9-44`

Implementation requirements:

1. Add boolean `--clean` to `SPECS`, `buildOptions`, help output, and tests. No `--no-clean` alias is required because the default is false, unless consistency with config overrides demonstrates a concrete need.
2. Add negatable `--update-parent-page` / `--no-update-parent-page` to `SPECS`, option building, help, and tests. The positive/default behavior is true; the negative form is the explicit CLI opt-out.
3. Add `CONFLUENCE_CLEAN` / `INPUT_CLEAN` and `CONFLUENCE_UPDATE_PARENT_PAGE` / `INPUT_UPDATE-PARENT-PAGE` to environment bindings and test cleanup lists with standard boolean parsing and per-option precedence: CLI > config > `CONFLUENCE_*` > `INPUT_*` > the respective built-in default.
4. Add Action inputs `clean` with default `'false'` and `update-parent-page` with default `'true'`. Keep the smoke test network-free and use dry-run to prove both inputs reach planning without remote mutation.
5. Update CLI help, README, website guide, JavaScript example, configuration table, environment table, Action example, and exported API description together.
6. Replace the additive-sync section with the exact ownership, adoption, default pruning, blocked-ancestor, trash-not-purge, and clean contracts.
7. Put a destructive warning next to `--clean`: all page descendants, including manual/unlabeled pages, are moved to trash before recreation; `parentPageId` is retained.
8. Explain that default pruning is label-gated and target-subtree-scoped, and that removing the marker opts a page out until a future sync maps/adopts it again.
9. Update title-strategy migration notes: previously labeled old-strategy pages are pruned after a successful sync; pre-feature/unlabeled pages remain and require manual cleanup.
10. Add a parent-page summary section documenting its default-on behavior, generated sections/statistics/tree, managed-region preservation, unchanged-write skipping, empty-tree behavior, failure ordering, and opt-out. State that the target parent itself remains unlabeled and is never deleted.
11. Explain dry-run limitations: zero API calls means it can show clean/prune and local parent-summary intent but cannot list/count remote deletion candidates, fetch parent content, or provide mapped remote links.
12. Document required Confluence permissions/scopes for descendant reads, labels, parent/child page updates, and page deletion, plus the requirement to serialize jobs for the same target.
13. Keep downstream `egose/actions/confluence` wiring for both new inputs as a named release follow-up if it requires separately declared inputs.

Acceptance criteria:

- API/config, CLI, `CONFLUENCE_CLEAN`, and `INPUT_CLEAN` all resolve the same boolean with default false and tested precedence.
- API/config, positive/negative CLI flags, `CONFLUENCE_UPDATE_PARENT_PAGE`, and `INPUT_UPDATE-PARENT-PAGE` resolve the same boolean with default true and tested precedence.
- Invalid environment booleans fail with the existing precise error format.
- `--help`, README, website, and Action example all state the same clean and parent-summary defaults, opt-out, and mutation behavior.
- Dry-run with clean makes zero API calls and logs intent without claiming a remote count.
- The old unconditional claims that sync never deletes pages are removed or qualified everywhere.
- Documentation distinguishes recoverable trash from permanent purge and clearly protects the target page.
- Documentation explains adoption and the marker-label opt-in boundary for existing pages.
- Documentation describes every stable parent-summary section, manual-content preservation, default-on behavior, and opt-out semantics.
- `pnpm --filter @repo-toolkit/confluence test` passes.
- `node packages/confluence/action-fixture/smoke.mjs` passes after build.
- `pnpm lint`, `pnpm typecheck`, and `pnpm build` pass from the repository root.
- Website `pnpm typecheck` and `pnpm build` pass when run from `website/`.

## Wave 5: Independent Destructive-Path And Parent-Summary Review

### Task CFPRUNE-04: Verify Reconciliation Safety And Published Contract

Status: completed

Completion evidence:

- Independent reviewer traced local preflight → clean (pre-sync) → sync/label → prune (label-gated, deepest-first, blocked) → parent merge (version current+1, byte-equal skip, fail-closed on malformed/duplicate) ordering; verified fail-closed on sync/label/prune/parent and partial-mutation evidence (`SyncMutationError`, `ReconciliationError`, `ParentSummaryError` with `SyncResult` fields `labelsAdded`/`cleanDeletions`/`pruneDeletions`/`blocked`/`parentStatus`)
- Verified pagination/shared `listAll` (same-origin, loop, maxPages) before deletions; deletions by id deepest-first via v2 `DELETE /pages/{id}` without purge, 204 accepted, never `parentPageId`; label POST additive `POST /rest/api/content/{id}/label` with exact `global`/`repo-toolkit-confluence` body, check-before-POST idempotent
- Exercised mixed tree (managed stale, manual unlabeled, stale ancestor with retained child, non-page `whiteboard`, title-strategy migration, empty tree) — only exact-label stale deleted, blocked preserved, clean refused on non-page before first delete, pagination beyond first page included
- Verified defaults/overrides API/config/CLI/`CONFLUENCE_*`/`INPUT_*` with `CLI > config > CONFLUENCE_* > INPUT_* > default` for `clean:false` and `updateParentPage:true`, negatable `--no-update-parent-page`, destructive help warning, invalid boolean format, Action `clean:'false'`/`update-parent-page:'true'` and 4-phase network-free smoke; second identical sync idempotent across page/label/delete/parent PUT
- Verified parent summary provenance, deterministic statistics, `ri:content-id` id-backed linked tree, stable guidance, empty-tree `No managed child pages`, marker `<!-- repo-toolkit-confluence:parent-summary:start/end -->` preserved round-trip, manual content byte-preserved, malformed/duplicate/409 fail without overwrite
- Inspected packed artifact `repo-toolkit-confluence-0.0.0-PLACEHOLDER.tgz` (5 entries `dist/cli.js`, `dist/index.js`, `dist/index.d.ts`, `package.json`, `README.md`) with declarations for `CONFLUENCE_MANAGED_LABEL`, gateway new methods, `clean`/`updateParentPage`, result/error types; docs/help/README/website/Action/runtime/types agree; fixed over-claimed `renderParentSummary` exports in `README`/`website` (now internal)
- Diff hygiene: 10 files + 2 new (`src/parent-summary.ts`, `test/parent-summary.test.ts`), no secrets/`dist`/whole-parent replacement/stale claims; no unrelated changes
- Verified: `pnpm --filter @repo-toolkit/confluence test` (7 files, 343 passed), `pnpm lint` (pass), `pnpm typecheck` (pass), `pnpm -r --if-present test` (all 8 projects pass), `pnpm build` (root pass), `pnpm --filter @repo-toolkit/confluence pack` (5 entries), `node packages/confluence/action-fixture/smoke.mjs` (4 phases PASS), `website: pnpm typecheck` (pass) + `pnpm build` (SUCCESS)
- Residual risks: real-site Confluence Cloud smoke deferred (disposable subtree), invisible descendants API limitation (fail-closed), concurrent same-target jobs unsupported (409 only), downstream `egose/actions/confluence` wiring as follow-up

Priority: P2

Suggested agent: Independent reviewer who did not implement CFPRUNE-01 through CFPRUNE-03 or CFPARENT-01

Dependencies: CFPRUNE-01, CFPRUNE-02, CFPARENT-01, CFPRUNE-03

Primary ownership:

- review-only across `packages/confluence/`, `website/docs/packages/confluence.md`, and packed artifacts
- completion evidence in this task file

Finding:

The feature introduces destructive remote operations and a default-on parent mutation across pagination, ownership metadata, hierarchy planning, empty-tree behavior, four input surfaces, custom gateways, managed storage-format regions, and published docs. A partial implementation could delete manual content, prune after an incomplete sync, overwrite the parent body, or silently skip descendants outside the first API page.

References:

- all requirements and acceptance criteria in CFPRUNE-01 through CFPRUNE-03 and CFPARENT-01
- `AGENTS.md:18-45,74-93,103-110`

Implementation requirements:

1. Independently trace local preflight, clean, sync/label, and prune ordering for successful and failing runs.
2. Verify complete cursor pagination and fail-closed behavior before destructive calls.
3. Exercise a mixed remote tree containing expected managed pages, stale managed pages, unlabeled manual pages, a stale managed ancestor with a retained child, and non-page descendants.
4. Verify omitted/default clean and parent-summary behavior plus explicit overrides through API, config, built CLI, environment, and Action fixture.
5. Verify every deletion targets a descendant id, occurs deepest-first, moves to trash without purge, and never targets `parentPageId`.
6. Verify label writes are additive/idempotent and preserve unrelated labels.
7. Verify parent summary provenance, all deterministic statistics, id-backed linked tree, stable guidance, empty-tree rendering, and byte-preservation outside the managed region.
8. Verify errors/results/logs contain enough evidence to recover from partial clean, label, prune, and parent-update failures without leaking credentials.
9. Inspect the packed package for runtime files and intended public declaration changes; do not commit generated `dist/` output.
10. Confirm CLI help, README, website, Action fixture, runtime behavior, and public types agree.
11. Check the final diff for unrelated changes, secrets, generated artifacts, stale additive-sync claims, or whole-parent replacement behavior.

Acceptance criteria:

- No code path can delete before local validation or after a failed/incomplete sync inventory.
- Default reconciliation deletes only exact-label stale descendants and preserves every unlabeled/manual page in the mixed-tree fixture.
- Explicit clean requires `clean: true`, never deletes the target page, and handles retained non-page descendants according to the fail-closed contract.
- Pagination tests prove candidates beyond the first page are included and malformed pagination produces zero deletions.
- Repeated unchanged sync is idempotent across page, attachment, label, and deletion calls.
- Default parent-summary behavior preserves manual content, produces every requested stable section, and skips its PUT on a repeated identical sync; the opt-out performs no parent calls.
- Malformed/duplicate parent-region markers and parent 409 responses fail without overwriting manual parent content and report child reconciliation as already complete.
- `pnpm --filter @repo-toolkit/confluence test` passes.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass from the repository root.
- `pnpm --filter @repo-toolkit/confluence pack` succeeds and the tarball exposes the intended `clean`, `updateParentPage`, gateway, label, and result/error declarations.
- `node packages/confluence/action-fixture/smoke.mjs` passes.
- Website typecheck/build pass from `website/`.
- Completion evidence records exact commands, results, changed files, and any residual risk.

## Dependency And Parallelization Guidance

- Execute CFPRUNE-01 before CFPRUNE-02 because orchestration and typed fakes require the final gateway contract.
- Execute CFPRUNE-02 before CFPARENT-01 because the parent tree consumes the final child mapping and reconciliation result.
- Execute CFPARENT-01 before CFPRUNE-03 so public inputs/docs describe tested parent-summary behavior and result/error shapes.
- Do not run CFPRUNE-01 and CFPRUNE-02 in parallel; both modify `src/index.ts` exports and public-surface tests.
- Do not run CFPRUNE-02 and CFPARENT-01 in parallel; both modify sync orchestration, result/error evidence, and `test/index.test.ts`.
- CLI test work in CFPRUNE-03 can begin after both option shapes are fixed, but documentation must wait for the destructive and parent-summary contracts to pass their tests.
- Run root package builds/tests serially with website builds. The website is a separate pnpm project and its commands must run from `website/`.
- Reserve CFPRUNE-04 for an independent reviewer after all implementation tasks complete.

## Deferred Decisions And Follow-Ups

- Downstream Action release: determine whether `egose/actions/confluence` automatically forwards `INPUT_CLEAN` and `INPUT_UPDATE-PARENT-PAGE`; if not, add its declared input/environment wiring in that repository before advertising Action-level support.
- Real-site smoke: unit tests can pin HTTP contracts, but a maintainer with a disposable Confluence Cloud subtree should verify label visibility, trash restoration, descendant type behavior, deletion effects on mixed content, managed parent-region round trips, and parent links before production rollout.
- Inaccessible descendants: Confluence list endpoints return only visible content. The implementation must document this residual visibility limitation and fail closed wherever the API signals incomplete traversal; it cannot prove the absence of content the API does not disclose.

These follow-ups do not block implementation. The Behavioral Contract already requires conservative handling when collateral deletion cannot be ruled out.

## Definition Of Done

- `clean` is available through API/config, CLI, both environment forms, and the Action fixture; it defaults to false everywhere.
- `updateParentPage` is available through API/config, positive/negative CLI forms, both environment forms, and the Action fixture; it defaults to true everywhere.
- Every mapped generated page carries the exact global `repo-toolkit-confluence` marker without losing unrelated labels.
- A successful default sync prunes only stale managed descendants, by id and deepest-first, while preserving manual/unlabeled or blocked content.
- Explicit clean moves safely deletable page descendants to trash before recreation and never deletes the target page.
- Empty local trees reconcile correctly; dry runs remain credential-free and make zero API calls.
- The target parent contains one replaceable generated region with provenance, deterministic statistics, linked directory tree, and reconciliation guidance while all unrelated content is preserved; identical runs skip the parent PUT.
- Local, sync, label, inventory, deletion, and parent-update failures have observable partial-mutation evidence, and unsafe/incomplete inventories or parent markers fail closed.
- Client transport, orchestrator, CLI, Action fixture, README, website, public declarations, and packed artifact agree.
- Targeted, root, Action smoke, package artifact, and website verification commands pass.
- An independent reviewer records completion evidence and confirms no unrelated work, generated artifacts, secrets, or stale non-pruning claims are included.
