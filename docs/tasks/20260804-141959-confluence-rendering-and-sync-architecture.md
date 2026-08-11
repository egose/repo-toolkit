# Confluence Rendering And Sync Architecture

Created: 2026-08-04 14:19:59

## Objective

Make rendering correct and XML-safe, avoid unnecessary remote mutations, and introduce narrow testable boundaries without broad framework changes.

### Task CFARC-01: Replace regex-over-generated-markup inline rendering

Status: completed

Priority: P1

Suggested agent: Markdown parser engineer

Dependencies: none

Primary ownership:

- `packages/confluence/src/markdown.ts`
- `packages/confluence/test/markdown.test.ts`

Finding:

Images, links, emphasis, and code regexes run sequentially over one escaped/generated string (`211-239`, `293-301`), allowing later transforms to corrupt generated XML and process syntax inside code. URL filtering blocks only selected schemes (`19`, `221-239`).

Implementation requirements:

1. Tokenize/protect inline code before other syntax and emit escaped XML once; adopt an existing approved parser only after checking current dependencies.
2. Parse URLs and use a documented allowlist for links/images, rejecting controls and obfuscated unsafe schemes.
3. Define the supported Markdown subset or implement fixtures for claimed constructs.

Acceptance criteria:

- Code containing Markdown, complex URLs, nested emphasis/links, escaped punctuation, mixed lists, and fences render deterministically.
- Every generated storage body parses as XML.
- Unsafe/encoded/custom schemes are rejected according to documented policy.

Completion evidence:

- Changed: `packages/confluence/src/markdown.ts` (rewrote inline rendering as a single-pass character tokenizer that protects inline code first, parses links/images across balanced nested parentheses on the raw URL, validates URLs against an exported `isAllowedUrl` allowlist instead of the old `PROTOCOL_BLOCKLIST`, matches emphasis with CommonMark flanking rules supporting nested `**a *b* c**`, applies ASCII-punctuation backslash escapes, and escapes XML exactly once per committed text run; preserved every public export consumed by `attachments.ts`/`mermaid.ts`/`index.ts`/tests: `markdownToStorage`, `renderInline`, `renderCodeBlock`, `renderHtmlBlock`, `renderMermaidPlaceholder`, `mermaidPlaceholderRe`, `escapeHtml`, `escapeXmlAttribute`, `escapeAttachmentFilename`, `isRemoteUrl`, `LOCAL_IMAGE_PLACEHOLDER_RE`, `collectLocalImagePaths`, `resolveDocRelative`), `packages/confluence/src/index.ts` (added `isAllowedUrl` to the public re-exports so custom pipelines can validate against the same URL policy), `packages/confluence/test/markdown.test.ts` (added 75 tests across 7 new describe blocks), `website/docs/packages/confluence.md` (rewrote the "Raw HTML and security" inline-URL paragraph as an allowlist policy; expanded the "Supported Markdown" list to state the inline-code-protected-first, CommonMark flanking, intraword `*` vs non-intraword `_`, nested emphasis, backslash-escape, and balanced-nested-paren URL contracts; added `isAllowedUrl` to the Exports list), `packages/confluence/README.md` (added a Notes bullet describing the single-pass tokenizer, allowlist, control-char/percent-encoded-scheme rejection, and CommonMark emphasis semantics).
- Verified: `pnpm --filter @repo-toolkit/confluence test` (184 passed: 109 existing + 75 new), `pnpm lint`, `pnpm typecheck`, `pnpm test` (all packages green: changelog 80, publish-package 64, publish-packages 15, release-artifact 33, confluence 184), `pnpm build`, `pnpm --filter @repo-toolkit/confluence pack` (tarball contains only `dist/cli.js`, `dist/index.js`, `dist/index.d.ts`, `package.json`, `README.md`, `LICENSE`; `dist/index.d.ts` exports `isAllowedUrl`), `node packages/confluence/action-fixture/smoke.mjs` (`PASS: confluence action smoke fixture`), `pnpm --filter website typecheck` (`tsc` clean) and `pnpm --filter website build` (Docusaurus build succeeded with `onBrokenMarkdownLinks: 'throw'`). Website commands run from `website/` only.
- Result:
  - Inline code is tokenized **first**: a backtick run of length N opens a code span and a same-length run closes it (CommonMark run-length matching), with the optional one-space-trim of a single leading/trailing space. The raw code content is emitted as `<code>` + `escapeHtml(content)` and is never seen by emphasis/link/image parsing, so `` `*not italic*` ``, `` `[not a link](url)` ``, and `` `a & b < c` `` render as literal code. Unmatched backticks stay literal text.
  - Emphasis uses CommonMark flanking rules: `*` allows intraword emphasis (`a*b*c`); `_` requires the other side to be punctuation or whitespace (so `snake_case_name` is literal, not `snake<em>case</em>name`). Nested emphasis works recursively: `**a *b* c** → <strong>a <em>b</em> c</strong>`. Backslash escapes disarm ASCII-punctuation markers: `\*` → `*`, `\_` → `_`, `\[` → `[`.
  - Links `[text](url)` and images `![alt](src)` parse the URL across balanced nested parentheses on the **raw** URL before escaping, so `[wiki](https://en.wikipedia.org/wiki/Foo_(bar))` works. The label is recursively rendered (nested emphasis/code/links inside link text). `&` in a URL attribute is escaped to `&` so the generated `href`/`ri:value` remains XML-valid.
  - URL policy is now an **allowlist** (`isAllowedUrl`, exported): only `http`/`https`/`mailto`/`tel` schemes plus scheme-less protocol-relative (`//host`), server-relative (`/path`), and pure-relative (`path`, `#frag`, `?query`) URLs render as links/images. Blocked schemes — `javascript:`/`data:`/`file:`/`vbscript:` and any other custom/non-allowlisted scheme (`myapp:`, `blob:`, `intent:`, …) — collapse to their label/alt text. C0/DEL control characters (NUL/TAB/CR/LF/BEL/DEL …) anywhere in the URL are rejected, defeating `java\tscript:`/`java\u0001script:` obfuscation. Percent-encoded blocked schemes (`java%73cript:`) are decoded before the scheme check and rejected. Existing exact-output assertions (`[evil](javascript:alert(1))` → `evil`, `[x](https://example.com)` → `<a href="https://example.com">x</a>`, `![a](data:...)` → `a`) continue to pass.
  - Every generated storage body parses as XML: a 20-input corpus (headings, raw `<script>` in body, fenced code with `]]>`, `html` blocks, lists, blockquotes with mixed inline, local/remote/blocked images, mermaid blocks, hard line breaks, frontmatter variants, mixed inline + emphasis + links, complex/nested-paren URLs) is run through `markdownToStorage` with both `renderHtmlBlocks: true` and `: false` (40 cases), and each output is asserted well-formed via a structural XHTML validator (balanced tag nesting, no stray `<`/`&` in text, no unclosed tags). The dedicated `]]>` CDATA-neutralization test and the `<script>`-escapes-in-body test continue to pass.
  - No new runtime dependency was introduced: the repo has no `marked`/`micromark`/`markdown-it`/`remark` installed and AGENTS.md forbids adding runtime deps without checking, so the tokenizer is hand-written within the zero-runtime-dep constraint.
- Follow-up: CFARC-02 is now completed (see its completion evidence); CFARC-03/CFARC-04 remain pending, and CFARC-03 now has both prerequisites (CFARC-01, CFARC-02) met.

### Task CFARC-02: Make attachment naming and unchanged sync content-addressed

Status: completed

Priority: P1

Suggested agent: synchronization performance engineer

Dependencies: CFSEC-02 and CFSEC-05 in the trust-boundary file

Primary ownership:

- `packages/confluence/src/index.ts:196-218`
- `packages/confluence/src/attachments.ts`
- `packages/confluence/src/mermaid.ts`
- `packages/confluence/test/index.test.ts` (CFARC-02 describe block)
- `packages/confluence/test/mermaid.test.ts` (insertion-stability test)

Finding:

`skipUnchanged` checks only after every attachment render/upload. Local images collide by basename, and Mermaid names depend on ordinal position, causing noisy updates and accidental replacement.

Implementation requirements:

1. Derive stable unique names/hashes from normalized source/content.
2. Compare deterministic source hashes before renderer or upload work.
3. Preserve current content when unchanged and clearly scope what the option guarantees.

Acceptance criteria:

- A second identical sync performs no page update, attachment mutation, or Mermaid spawn.
- Same-basename files remain distinct; inserting an earlier diagram does not rename unchanged diagrams.

Completion evidence:

- Changed: `packages/confluence/test/index.test.ts` (the `buildFakeClient` helper now tracks created pages in `getPagesByTitle` and preserves `parentId` through `createPage`/`updatePage`, so the two-sync no-op path is genuinely exercised against the same persisted page instead of silently creating a new page each run; removed the dead `syncTwoIdenticalRunsThenAssert` placeholder and the unused `buildAndRecordCalls`/`recording` locals that lint flagged), `packages/confluence/test/mermaid.test.ts` (added a new `CFARC-02: insertion-stable content-addressed mermaid names` describe block with a regression test that re-syncs a document after inserting an earlier diagram and asserts the unchanged `mermaid-<hash16>.svg` filename reuses the existing attachment, the second diagram renders exactly once, no `updateAttachmentData` runs, and the two diagrams keep distinct content-addressed filenames). The source modules (`packages/confluence/src/attachments.ts`, `packages/confluence/src/mermaid.ts`, `packages/confluence/src/index.ts`, `packages/confluence/src/content-hash.ts`) already implemented the content-addressed contract from prior work in this session (`buildStableName` → `<stem>-<sha256[:16]>.<ext>`, `preflightImagesToAttachments`/`preflightMermaidBlocks` comparing deterministic source hashes via `shortHashFile`/`shortHashString` before any renderer or upload work, and `predictBody` short-circuiting the second sync before `rewriteMermaidBlocks`/`rewriteImagesToAttachments` run); this change closes the missing-test gap rather than re-implementing the contract.
- Verified: `pnpm --filter @repo-toolkit/confluence test` (189 passed: 188 prior + 1 new insertion-stability test; the `CFARC-02` describe block previously failed 1/3 and now passes 3/3), `pnpm lint` (clean after removing the dead helper and unused locals), `pnpm typecheck` (clean), `pnpm test` (all packages green: publish-package 64, changelog 80, publish-packages 15, release-artifact 33, confluence 189), `pnpm build` (tsup clean across all packages; confluence `dist/index.js` 57.88 KB, `dist/cli.js` 68.19 KB, `dist/index.d.ts` 12.68 KB).
- Result:
  - A second identical sync performs no page PUT, no attachment mutation, and no Mermaid spawn: `predictBody` runs `preflightMermaidBlocks`/`preflightImagesToAttachments`, produces the byte-equal storage HTML, and short-circuits before `rewriteMermaidBlocks`/`rewriteImagesToAttachments` ever spawn `mmdc` or call `uploadAttachment`/`updateAttachmentData`. The third CFARC-02 test (mermaid-only page, `mmdc` unavailable → fallback code macro) now passes because the fake client persists the created page, so the second run hits the existing page and the preflight-derived code-macro body equals the current body.
  - Same-basename files remain distinct: `buildStableName(basename, shortHashFile(absPath))` keeps the original stem and appends the content hash, so `a/logo.png` and `b/logo.png` produce distinct `logo-<hash16>.png` filenames (asserted by the second CFARC-02 test).
  - Inserting an earlier diagram does not rename unchanged diagrams: `mermaidAttachmentFilename(shortHashString(block.source))` is independent of ordinal position, so the previously-uploaded `mermaid-<hash16>.svg` is reused (no `updateAttachmentData`, no re-render of the unchanged block) while the new earlier diagram gets its own distinct content-addressed name (asserted by the new `mermaid.test.ts` insertion-stability test).
- Follow-up: CFARC-03 (validate locally before remote mutation) now has its CFARC-02 prerequisite met and can proceed; CFARC-04 still waits on CFARC-03.

### Task CFARC-03: Validate locally before remote mutation

Status: completed

Priority: P1

Suggested agent: workflow architecture engineer

Dependencies: CFARC-01, CFARC-02

Primary ownership:

- `packages/confluence/src/index.ts:161-239`
- workflow tests

Finding:

Pages are found/created with empty bodies before local read, conversion, render, and upload work, so local failures can leave orphan pages and partial attachments (`184-225`, `262-267`).

Implementation requirements:

1. Pre-read and validate the document tree, titles, images, Markdown, and renderer inputs before API mutation.
2. Create leaf pages with final bodies where the API permits.
3. Return structured partial-mutation evidence for unavoidable remote failures.

Acceptance criteria:

- Every local validation failure causes zero API mutation calls.
- Remote failure reports changed pages/attachments and unprocessed work.
- Dry run uses the same local validation plan without credentials when a client is unnecessary.

Completion evidence:

- Changed: `packages/confluence/src/attachments.ts` (added `ValidatedAttachmentSource` interface and exported `validateAttachmentSources(html, options)` that runs the same `collectLocalSources` + `resolveImageForUpload` path as the rewriter and surfaces each resolved source's content-addressed filename, so a pre-mutation pass cannot relax the CFSEC-02 trust boundary), `packages/confluence/src/index.ts` (new `LocalSyncEntryPlan`/`LocalSyncPlan`/`LocalSyncValidationError`/`LocalSyncValidationAggregateError` types and exported `validateLocalSync(entries, plan)` function that pre-reads every markdown file, runs `markdownToStorage`, runs `validateAttachmentSources` for every local-image placeholder, and either returns a per-entry plan or throws an aggregate listing every defect with no client and no network; new `SyncChange`/`SyncFailure`/`SyncMutationError`/`SyncResult` types and changed `syncConfluenceToDocs` to (1) run `validateLocalSync` immediately after `validateLocalHierarchy` and before any client construction — so every local validation failure leaves zero API calls (criterion 1); (2) under `dryRun`, run the SAME preflight then log the per-entry plan including validated attachment and mermaid-block counts without constructing a client — credentials are not required under dry-run (criterion 3); (3) when a leaf page does not yet exist and its body has no attachment-bearing placeholders (no local-image placeholders, no mermaid blocks), create the page in ONE POST with the final rendered body via the new `PageTitleCache.createEntry` (requirement 2 — Cheers: leaf pages with attachments still require create-then-upload-then-PUT because the v1 multipart endpoint needs an existing page id); (4) wrap the mutation loop with `try`/`catch` so the first remote failure throws `SyncMutationError` carrying `changes` (pages already created/updated unchanged), `failure` (the failing entry + underlying error), and `unprocessed` (remaining entries after the failing one). `SyncMutationError.message` echoes the underlying error message so existing `.rejects.toThrowError(/regex/) assertions on remote errors keep matching. Updated the `dryRun`doc-comment, broadened the`buildFakeClient.createPage`helper in`packages/confluence/test/index.test.ts`to accept/persist a`body`field, updated the five tests whose assertions assumed the old create-then-PUT pattern (folder/leaf creation, remote image ri:url, html-macro, code-macro) to assert the new one-POST path via`createPage.args[0].body`, and added a new `CFARC-03: validate locally before remote mutation`describe block with 9 tests covering all three acceptance criteria),`packages/confluence/README.md`(updated the`--dry-run`flag bullet to describe the preflight-then-log contract and credentials-not-required behavior; expanded the JavaScript-API section to document local preflight,`LocalSyncValidationAggregateError`, `SyncMutationError`, `SyncResult`, and `validateLocalSync`), `website/docs/packages/confluence.md`(rewrote the`--dry-run` table row to describe the preflight-then-log contract).
- Verified: `pnpm --filter @repo-toolkit/confluence test` (198 passed: 189 prior + 9 new CFARC-03 tests; the new describe block passes 9/9), `pnpm lint` (clean after removing an unused `RewriteOptions` import in the package and an unused `ConfluenceSyncPlan` import in the test file), `pnpm typecheck` (clean across all packages), `pnpm test` (all packages green: changelog 80, publish-package 64, publish-packages 15, release-artifact 33, confluence 198), `pnpm build` (tsup clean across all packages; confluence `dist/index.js` 61.99 KB, `dist/cli.js` 72.20 KB, `dist/index.d.ts` 18.34 KB — confirms `validateAttachmentSources`, `validateLocalSync`, `LocalSyncValidationAggregateError`, `SyncMutationError`, `SyncChange`, `SyncFailure`, `SyncResult`, `LocalSyncEntryPlan`, `LocalSyncPlan`, `ValidatedAttachmentSource`, and `LocalSyncValidationError` are all emitted in the public declarations), `pnpm --filter @repo-toolkit/confluence pack` (tarball contains only `dist/cli.js`, `dist/index.js`, `dist/index.d.ts`, `package.json`, `README.md`, `LICENSE`), `node packages/confluence/action-fixture/smoke.mjs` (`PASS: confluence action smoke fixture`).
- Result:
  - Every local validation failure causes zero API mutation calls: `validateLocalSync` runs against the doc-tree entries after `validateLocalHierarchy` and before the client is constructed. On the first defect it throws `LocalSyncValidationAggregateError`; the new CFARC-03 tests assert that for an escaping attachment source, a missing attachment source, and multiple aggregate defects, the recorded client calls contain zero entries in `{createPage, updatePage, uploadAttachment, updateAttachmentData}` (and even zero `getSpaceIdByKey` — no API call of any kind runs when local validation fails).
  - Dry run uses the same local validation plan without credentials: `--dry-run` first runs `validateLocalSync` (which reads files and validates attachment sources — no client needed) and only that. If a defect exists it throws `LocalSyncValidationAggregateError` even with no `--username`/`--api-token`/`--baseUrl`/`--spaceKey`/`--parentPageId` supplied (asserted by the `dry-run validates locally without credentials` test, which passes only `folder` and `dryRun: true`). When valid, the plan logs each entry's segment path plus its validated attachment count and parsed mermaid block count, and the recorded client calls have length zero (asserted).
  - Local failures never leave orphan pages or partial attachments: because `validateLocalSync` runs the root-confined, regular-file, and size checks that `collectLocalSources`/`resolveImageForUpload` enforce — uses the same code path via the new exported `validateAttachmentSources` — the upload phase can no longer be reached with a bad local image. The remaining failure mode after the preflight is remote-only (network, server 5xx, optimistic concurrency 409).
  - Leaf pages are created with final bodies where the API permits: `PageTitleCache.createEntry({ title, parentId, body })` posts `createPage` with the `markdownToStorage`-rendered HTML directly when the leaf page does not yet exist AND `hasLocalImages === false && hasMermaidBlocks === false`. Verified by the updated `creates parent pages for folders and a leaf page for the markdown file` test — `createPage.args[0].body.value` for `intro` is `'<h1>Intro</h1>'` and `methods` does NOT contain `updatePage`. Leaves WITH attachments (local-image placeholder, mermaid blocks) keep the create-then-upload-then-PUT order because the Confluence v1 multipart endpoint needs an existing page id.
  - Remote failure reports changed pages/attachments and unprocessed work: `SyncMutationError` is thrown on the first remote failure in the mutation loop, carrying `changes: SyncChange[]` (`kind: 'created' | 'updated' | 'unchanged'`, `entry`, `pageId`), `failure: SyncFailure` (`entry`, `error: Error` — preserves the underlying `.message`), and `unprocessed: DocEntry[]` (entries after the failing one). The new CFARC-03 tests cover the 1-success-then-fail-then-unprocessed case (`doc-a` `kind:'created'`, `doc-b` failure with `error.message: 'server 500 during updatePage'`, `unprocessed: ['c.md']`) and the empty-changes case (`doc-bad` fails immediately, `unprocessed: ['later.md']`).
  - No new runtime dependency was introduced; the preflight reuses `resolveImageForUpload` and `collectLocalSources` from `attachments.ts` via the new pure helper `validateAttachmentSources`, keeping the zero-runtime-dep constraint.
- Follow-up: CFARC-04 (introduce narrow gateways and fix custom-client contract) now has its CFARC-03 dependency met. CFARC-04's "Tests inject fakes without `unknown as`" criterion can be exercised against the new explicit `SyncMutationError`/`SyncChange`/`LocalSyncValidationAggregateError` exports; the existing test casts `client as unknown as Parameters<typeof syncConfluenceToDocs>[0]['client']` (CFARC-04's finding, scope out-of-bounds here).

### Task CFARC-04: Introduce narrow gateways and fix custom-client contract

Status: pending

Priority: P2

Suggested agent: TypeScript architecture engineer

Dependencies: CFARC-03

Primary ownership:

- `packages/confluence/src/index.ts`
- public declarations and tests

Finding:

Sync accepts concrete `ConfluenceClient`, still requires credentials despite docs saying a supplied client replaces them (`index.ts:67-68,93-112`), and exports implementation regexes/shared CLI internals (`4-5`, `15-32`). Tests rely on unsafe casts.

Implementation requirements:

1. Depend on narrow page/attachment/rendering interfaces and accept typed fakes.
2. Skip base URL/credential requirements when a supplied gateway handles requests.
3. Keep implementation regexes/internal helpers out of the supported root API, with contract-aware migration only if external use is known.

Acceptance criteria:

- Tests inject fakes without `unknown as`.
- Supplied clients work without dummy credentials.
- Public declarations expose only intentional package contracts.

## Definition Of Done

Run package and root verification plus a package tarball/import/bin check. An independent reviewer validates XML, no-op second-sync behavior, local preflight, and public API/documentation alignment.
