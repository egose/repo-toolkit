# `@repo-toolkit/confluence`

Sync a folder of Markdown documentation to Confluence, mirroring the directory
structure as a page hierarchy. Each Markdown file becomes one Confluence page
under the configured parent; each sub-folder becomes a parent page. Local
images referenced from the markdown are uploaded as Confluence attachments and
inline-rendered as `<ac:image><ri:attachment />` macros; remote images stay as
`<ac:image><ri:url />`.

The package is GitHub-Action compatible: when invoked with no CLI flags it
reads `INPUT_*` environment variables (the same shape as the
`Bhacaz/docs-as-code-confluence` action's `action.yml`), so you can drop it
into a `node20` action or run it as a standalone CLI.

The long-form guide (credentials, Mermaid, Markdown subset, optimistic
concurrency, managed ownership/pruning/clean, parent summary, dry-run, raw-HTML
safety) lives at <https://repo-toolkit.pages.dev/docs/packages/confluence>.

## Installation

```sh
pnpm add -D @repo-toolkit/confluence
```

## Configuration precedence

Every option is resolved independently in this order, with later sources
overriding earlier ones only for the option they supply:

1. CLI flag for that option
2. `--config` file value for that option
3. `CONFLUENCE_*` environment variable for that option (higher specificity)
4. `INPUT_*` environment variable for that option (GitHub Actions form)
5. built-in default

Supplying `--api-token` or any other flag does **not** disable environment
resolution for the options you left unset. This means you can keep credentials
in the environment and still override, say, `--folder` on the command line.

For secret-free required fields (`folder`, `username`, `baseUrl`, `spaceKey`,
`parentPageId`) the CLI can prompt on a TTY when `--interactive` is set and
`--dry-run` is not. The API token is **never** prompted interactively (it
would echo to the terminal); provide it via a secret file or an environment
variable instead.

## CLI

```sh
repo-toolkit-confluence \
  --folder docs \
  --username user@example.com \
  --api-token-file /run/secrets/confluence_token \
  --confluence-base-url https://mydomain.atlassian.net/wiki \
  --space-key ENG \
  --parent-page-id 123456789
```

Prefer `--api-token-file` (or `CONFLUENCE_API_TOKEN_FILE`) over `--api-token`
to keep the token out of argv / process listings.

Flags:

- `--config <path>` — JSON/`.mjs`/`.cjs` config file with any of the options below
- `--cwd <path>` — working directory (default: `process.cwd()`)
- `--folder <path>` — documentation folder (required)
- `--username <value>` — Confluence username/email (required)
- `--api-token <value>` — Confluence API token (required; alias: `--password`)
- `--api-token-file <path>` — file whose contents become the API token; a
  single trailing newline and surrounding whitespace are stripped (alias:
  `--password-file`). Resolved relative to `--cwd`.
- `--confluence-base-url <url>` — URL with `/wiki` (required; alias: `--base-url`)
- `--space-key <key>` — Confluence space key (required; resolved to a `spaceId`)
- `--parent-page-id <id>` — numeric Confluence page id (required)
- `--version-message <text>` — version-message suffix appended to every PUT
- `--repository-url <url>` — repository URL appended to synced pages as an
  italic source notice. The `--folder` path is added to the notice link when it
  is relative to `--cwd`. When omitted, GitHub Actions runs infer this from
  `GITHUB_SERVER_URL` and `GITHUB_REPOSITORY`.
- `--page-title-strategy <value>` — leaf page title strategy (default: `filename-stem`). One of `filename-stem`, `filename`, `sentence-case-parent`, `sentence-case-parents`, `sentence-case-path`. Applied only to Markdown leaf pages; folder-generated parent pages keep their raw directory-segment titles. See [leaf page title strategies](#leaf-page-title-strategies).
- `--skip-unchanged` / `--no-skip-unchanged` — skip pages whose body is unchanged (default: `skip`)
- `--dry-run` — walk the doc tree and validate every markdown file and local
  image source (same preflight as a real sync) then log the plan. No API
  mutation calls; credentials are not required under `--dry-run`. Dry-run can
  show clean/prune and parent-summary intent but cannot list/count remote
  deletion candidates, fetch parent content, or provide mapped remote links
  because it makes zero API calls.
- `--render-html-blocks` — render ` ```html ` fenced blocks as inline HTML via
  the Confluence `html` macro instead of a code box (default: `false`). **Unsafe
  for untrusted Markdown** — see the raw HTML section of the website guide.
- `--clean` — move all page descendants to trash before recreation (default: `false`). **WARNING: destructive — all page descendants, including manual/unlabeled pages, are moved to trash before recreation; `parentPageId` itself is retained and never deleted.** Pages are moved to trash (recoverable), never purged.
- `--update-parent-page` / `--no-update-parent-page` — update the parent page summary region (default: `true`). Use `--no-update-parent-page` to opt out.
- `-i, --interactive` — prompt interactively (on a real TTY) for missing
  non-secret required fields. The API token is never prompted.

### Environment variables

`CONFLUENCE_*` (higher specificity) and the `INPUT_*` GitHub Actions form are
both read for every option. Boolean env values accept `true|1|yes|on` /
`false|0|no|off` (empty string is falsy); any other value exits nonzero with
`Invalid boolean value for <ENV_NAME>: <raw>`.

| Option                  | `CONFLUENCE_*`                   | `INPUT_*` (Actions form)                      |
| ----------------------- | -------------------------------- | --------------------------------------------- |
| folder                  | `CONFLUENCE_FOLDER`              | `INPUT_FOLDER`                                |
| username                | `CONFLUENCE_USERNAME`            | `INPUT_USERNAME`                              |
| apiToken                | `CONFLUENCE_API_TOKEN`           | `INPUT_API-TOKEN`, `INPUT_PASSWORD`           |
| apiTokenFile            | `CONFLUENCE_API_TOKEN_FILE`      | `INPUT_API-TOKEN-FILE`, `INPUT_PASSWORD-FILE` |
| baseUrl                 | `CONFLUENCE_BASE_URL`            | `INPUT_CONFLUENCE-BASE-URL`                   |
| spaceKey                | `CONFLUENCE_SPACE_KEY`           | `INPUT_SPACE-KEY`                             |
| parentPageId            | `CONFLUENCE_PARENT_PAGE_ID`      | `INPUT_PARENT-PAGE-ID`                        |
| versionMessage          | `CONFLUENCE_VERSION_MESSAGE`     | `INPUT_VERSION-MESSAGE`                       |
| repositoryUrl           | `CONFLUENCE_REPOSITORY_URL`      | `INPUT_REPOSITORY-URL`                        |
| pageTitleStrategy       | `CONFLUENCE_PAGE_TITLE_STRATEGY` | `INPUT_PAGE-TITLE-STRATEGY`                   |
| skipUnchanged (bool)    | `CONFLUENCE_SKIP_UNCHANGED`      | `INPUT_SKIP-UNCHANGED`                        |
| dryRun (bool)           | `CONFLUENCE_DRY_RUN`             | `INPUT_DRY-RUN`                               |
| renderHtmlBlocks (bool) | `CONFLUENCE_RENDER_HTML_BLOCKS`  | `INPUT_RENDER-HTML-BLOCKS`                    |
| clean (bool)            | `CONFLUENCE_CLEAN`               | `INPUT_CLEAN`                                 |
| updateParentPage (bool) | `CONFLUENCE_UPDATE_PARENT_PAGE`  | `INPUT_UPDATE-PARENT-PAGE`                    |

Errors, `--help`, and all log lines never print the supplied token value. The
secret-file loader wraps fs errors via `Error.cause` (`Failed to read
apiTokenFile at <path>`, `apiTokenFile at <path> is empty`) without revealing
the file contents.

## Leaf page title strategies

Leaf Confluence page titles are derived from the Markdown file's relative path segments. Directory segments become synthetic parent-page titles and retain their raw segment text for every strategy — only the Markdown leaf file uses `pageTitleStrategy`.

| Strategy                  | Behavior                                                                                      | Example for `community-nodes/cdogs-document-generator/credentials.md`   |
| ------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `filename-stem` (default) | Original filename without the final `.md` extension                                           | `credentials`                                                           |
| `filename`                | Original filename including extension                                                         | `credentials.md`                                                        |
| `sentence-case-parent`    | Sentence-case filename stem plus immediate parent folder                                      | `Credentials (cdogs-document-generator)`                                |
| `sentence-case-parents`   | Sentence-case filename stem plus all parent folders                                           | `Credentials (community-nodes/cdogs-document-generator)`                |
| `sentence-case-path`      | Sentence-case filename stem plus all parent folders and original filename including extension | `Credentials (community-nodes/cdogs-document-generator/credentials.md)` |

Sentence case is deterministic and dependency-free: remove only the final case-insensitive `.md`; replace each run of `-` and `_` with one space; trim; lowercase ASCII letters; uppercase the first ASCII letter. Digits and other punctuation are preserved. Examples: `failed-deployment.md` → `Failed deployment`, `n8n_setup.md` → `N8n setup`, `README.md` → `Readme`. Parent folders are the segments before the filename, joined with `/` exactly as stored. Preserve the original filename and extension casing in `filename` and inside `sentence-case-path` (for example, `Guide.MD` remains `Guide.MD` where the original filename is included).

Root-file behavior: for `sentence-case-parent` and `sentence-case-parents` the parentheses are omitted when a file is directly under the documentation root (`overview.md` → `Overview`). For `sentence-case-path`, the root parenthesized path is the filename itself (`overview.md` → `Overview (overview.md)`).

### Migration and uniqueness notes

> **Changing the strategy changes title-based identity.** Sync looks up Confluence pages by title under parent. Switching the strategy therefore seeks a new title and may **create a new page while leaving the old page untouched** — it does not rename or move existing pages. Previously labeled pages created under the old strategy carry the `repo-toolkit-confluence` ownership label and are **pruned (moved to trash) after a successful sync** under the new strategy because they become stale labeled descendants. Pages created before the labeling feature or otherwise unlabeled remain unlabeled and are **never pruned automatically** — they require manual cleanup in Confluence. Use `--dry-run` to preview generated titles (`would sync <path> as "<title>"`) before switching strategies in production.

Path-based strategies reduce predictable local collisions (for example, repeated basenames such as `credentials.md` or `README.md` in separate subtrees) but cannot guarantee uniqueness against unrelated or manually created pages already present in the target Confluence space. Existing spaces may still cause Confluence API conflicts if a generated title collides with an unrelated page under the same parent. Do not truncate or hash titles locally; if Confluence imposes a remote title-length limit, the existing API error behavior applies.

## Managed ownership and reconciliation

Every generated folder page and Markdown leaf page created, updated, or otherwise mapped by a successful sync carries the fixed global Confluence label `repo-toolkit-confluence` (`CONFLUENCE_MANAGED_LABEL`, prefix `global`). The label is additive — existing labels are preserved — and is added only when absent, so repeated unchanged syncs issue no redundant label POST. Adoption is explicit: an existing unlabeled page found by title-under-parent becomes managed once the sync maps it and successfully adds the marker; removing that page's local source later makes it eligible for pruning because it now carries the marker.

Default pruning (`clean: false`, the default) runs only after every local page has synced and its ownership label has been verified or added successfully. It enumerates all descendants of `parentPageId` (never the parent itself), and deletes stale pages deepest-first (children before parents). A page is stale only when it has the exact global `repo-toolkit-confluence` marker and its id is absent from the current mapped-id set. Pruning is **label-gated and target-subtree-scoped** — only labeled descendants of the configured `parentPageId` are candidates; space-wide label queries are not used. Unlabeled/manual pages are never deleted by default pruning. Removing the marker from a managed page opts it out of pruning until a future sync maps/adopts it again and re-applies the label. If a stale labeled ancestor contains an unlabeled, non-page, inaccessible, or otherwise retained descendant, that ancestor is blocked and reported as `blocked` rather than risking collateral deletion; safe stale siblings are still deleted. Pruning deletes by page id, moves pages to trash (recoverable), and never purges (`purge=true` is never sent). The target `parentPageId` itself is always an external anchor — it is never labeled and never deleted by either pruning mode.

Explicit clean (`clean: true`, default `false` via API/config/CLI/`CONFLUENCE_CLEAN`/`INPUT_CLEAN`) runs **before** creation after successful local preflight and moves **every page descendant** of `parentPageId` to trash, regardless of label, deepest-first, then recreates and labels the local hierarchy without a second prune pass. No destructive reset occurs when `clean` is omitted. An empty local tree with `clean: true` still performs the clean and leaves no safely deletable page descendants. Label lookup is not required for clean; it is deliberately stronger than managed pruning. A stale stale-ancestor protection still applies: pages with unsupported types or incomplete inventories fail closed before any deletion. Partial clean or prune failures abort and return structured evidence (`ReconciliationError` with phase `clean`/`prune`, `completed`, `failure`, `unprocessed`).

If sync or labeling fails before pruning, no stale-page deletions occur.

## Parent page summary

`updateParentPage` defaults to `true` via API/config, `--update-parent-page` (positive CLI), `CONFLUENCE_UPDATE_PARENT_PAGE`, and `INPUT_UPDATE-PARENT-PAGE` (GitHub Action). Use `--no-update-parent-page` or set `updateParentPage: false` / `CONFLUENCE_UPDATE_PARENT_PAGE=false` / `INPUT_UPDATE-PARENT-PAGE=false` to opt out.

After child-page sync, labeling, and clean/prune reconciliation succeed, the tool fetches the current target parent page, preserves its title and every byte outside one tool-managed region bounded by `<!-- repo-toolkit-confluence:parent-summary:start -->` / `<!-- repo-toolkit-confluence:parent-summary:end -->`, and updates that region with `version.number = current + 1`. The target parent itself remains unlabeled and is never deleted. On first run the region is appended; later runs replace it in place. Setting opt-out leaves both existing managed and manual parent content untouched — it does not remove a previously generated region. The PUT is skipped when the reconstructed body is byte-equal to the current body; no wall-clock timestamp, version, or per-run counters are included so identical deployments are idempotent. Malformed or duplicate markers fail closed without rewriting the parent. If any earlier phase fails, the parent summary is left unchanged; a parent GET/PUT failure after successful child reconciliation surfaces as `ParentSummaryError` (phase `parent-summary`) with child evidence and the failed parent id.

The generated region contains:

- `Synced documentation` heading with source provenance — when `repositoryUrl` resolves, the link is included; otherwise a generic `maintained by repo-toolkit-confluence` statement is rendered without exposing runner paths.
- Deterministic statistics derived from the validated local plan and final mapping: Markdown page count, generated directory-page count, total managed child-page count, maximum documentation depth, local attachment-reference count, and Mermaid-block count (zero values render explicitly for an empty tree).
- A nested deterministic directory-style tree for every generated directory and Markdown page, in local relative-path order, displaying the resolved Confluence title, distinguishing directory pages from Markdown leaves, and linking each item to its mapped Confluence page via id-backed storage links.
- Stable guidance that generated descendants carry the `repo-toolkit-confluence` label, missing labeled pages are pruned after successful sync, unlabeled pages are preserved by default, and explicit clean moves all safely deletable page descendants to trash.

With an empty local tree, provenance/guidance, zero statistics, and an explicit `No managed child pages` tree state are rendered. No child-page bodies, headings, excerpts, attachment names, secrets, credentials, local absolute paths, or unbounded remote metadata are copied into the parent.

Dry-run with `updateParentPage: true` prints locally known parent-summary statistics and title tree but cannot fetch parent content or provide mapped remote links because it makes zero API calls.

## Dry run

`--dry-run` walks the documentation tree, runs the same local preflight (read and convert every Markdown file, validate every local image source), and prints the plan without any API mutation calls. Credentials are not required under `--dry-run`. Dry-run preserves zero API calls — `dryRun + clean` logs that a remote clean would be requested and `dry-run` states that managed stale-page pruning would run during a real sync, but it cannot enumerate or count remote deletion candidates. With `updateParentPage` enabled, dry-run can show local parent-summary statistics and title tree, but cannot claim the parent would be unchanged, fetch parent content, or emit remote id-backed links.

## Permissions and concurrency

Required Confluence permissions and API scopes for a real sync:

- Read descendants of the configured `parentPageId` (`GET /wiki/api/v2/pages/{id}/descendants`, paginated, same-origin cursor).
- Read and add labels on generated pages (`GET /wiki/api/v2/pages/{id}/labels`, `POST /wiki/rest/api/content/{id}/label` with global `repo-toolkit-confluence`).
- Create and update pages and attachments under the target (`POST`/`PUT` pages, `GET`/`PUT` page bodies, attachment upload via v1 multipart `POST /wiki/rest/api/content/{pageId}/child/attachment` with `X-Atlassian-Token: no-check`).
- Read and update the target parent page body (`GET /wiki/api/v2/pages/{id}`, `PUT` with `version.number = current + 1`).
- Delete (move to trash) pages when pruning or cleaning (`DELETE /wiki/api/v2/pages/{id}` without `purge=true`). Pages are recoverable from Confluence trash.

Concurrent sync/clean jobs against the same `parentPageId` are unsupported and dangerous. Callers must serialize deployments for the same target; the tool does not add distributed locking. Two syncs racing on the same page are detected via optimistic concurrency (server returns HTTP 409 on version conflict) and the loser exits nonzero — rerun to reconcile.

Downstream `egose/actions/confluence` wiring for `clean` and `update-parent-page` is a named release follow-up if that repository requires separately declared inputs (this package already accepts them via CLI/config/`CONFLUENCE_*`/`INPUT_*`; the Action example below lists them).

## JavaScript API

```ts
import { syncConfluenceToDocs } from '@repo-toolkit/confluence';

await syncConfluenceToDocs({
  folder: 'docs',
  username: 'user@example.com',
  apiToken: process.env.CONFLUENCE_API_TOKEN!,
  baseUrl: 'https://mydomain.atlassian.net/wiki',
  spaceKey: 'ENG',
  parentPageId: '123456789',
  versionMessage: 'chore(docs): sync',
  pageTitleStrategy: 'sentence-case-parents', // optional; default: 'filename-stem'
  clean: false, // optional; default: false — when true, trash every page descendant before recreation
  updateParentPage: true, // optional; default: true — set false to skip parent summary update
});
```

`resolveConfluenceSyncPlan(options)` resolves the same plan without starting a
sync; it validates `pageTitleStrategy`, fills `clean` (default `false`) and
`updateParentPage` (default `true`), and is the documented way to validate
options up front.

`syncConfluenceToDocs` runs a **local preflight** before any remote mutation:
every markdown file is read and converted to storage HTML, and every local
image source is validated against the same root-confined, regular-file, and
size checks the upload path applies. On the first defect it throws an
`LocalSyncValidationAggregateError` listing every failing entry (zero API
calls). On a remote failure mid-run it throws a `SyncMutationError` carrying
`.changes` (pages that succeeded), `.failure` (the failing entry + its error),
and `.unprocessed` (remaining entries). Pruning/clean failures throw
`ReconciliationError` with `.phase` (`clean` or `prune`), `.completed`,
`.failure` (failed `pageId` + error), and `.unprocessed`. Parent summary
failures throw `ParentSummaryError` (phase `parent-summary`) after child
reconciliation succeeded, carrying `.changes`, `.labelsAdded`,
`.cleanDeletions`, `.pruneDeletions`, `.blocked`, and `.failure`. On success it
returns a `SyncResult` with `.changes` (created/updated/unchanged pages),
`.labelsAdded` (ids that received the ownership marker), `.cleanDeletions`
(pre-sync trash ids), `.pruneDeletions` (post-sync stale ids), `.blocked`
(retained stale ancestors), and `.parentStatus` (`updated`|`unchanged`|`skipped`).
`validateLocalSync(entries, plan)` runs the same local preflight standalone —
useful for CI gates or `--dry-run`-equivalent validation. Leaf pages with no
attachment-bearing placeholders are created in a single POST with their final
rendered body; pages with local images or Mermaid blocks are created first and
have attachments uploaded against their page id, then their body is PUT.

`syncConfluenceToDocs` and the lower-level rewriters depend only on the narrow
`ConfluenceGateway` and `AttachmentGateway` interfaces (which
`ConfluenceClient` implements). Supply your own gateway object as `client` and
the bundled HTTP `username`/`apiToken`/`baseUrl` are no longer required — the
gateway owns all remote work. Typed fakes implementing the interface are
accepted by `syncConfluenceToDocs({ client })` without `as unknown` casts.
`spaceKey` and `parentPageId` remain required even with a custom gateway.

Exported constants and helpers: `CONFLUENCE_MANAGED_LABEL`
(`repo-toolkit-confluence`), `planStalePruning` / `planCleanDeletions` (pure
deepest-first planners), plus `ReconciliationError`, `ParentSummaryError`,
`SyncMutationError`, `LocalSyncValidationAggregateError`.

## GitHub Action usage

The CLI auto-detects the GitHub Actions `INPUT_*` environment when no flags are
supplied. Bundle the **CLI entrypoint** (`src/cli.ts`) — not the library entry
(`src/index.ts`) — and ship the resulting `dist/cli.js` as the action
entrypoint. With `tsup` this is the second entry in `tsup.config.ts`, which is
emitted separately with a `#!/usr/bin/env node` banner.

With `@vercel/ncc`:

```sh
ncc build packages/confluence/src/cli.ts -o action-dist
# ships action-dist/index.js — reference it as the action main
```

Example `action.yml`:

```yaml
runs:
  using: 'node20'
  main: 'action-dist/index.js'
inputs:
  folder: { required: true }
  username: { required: true }
  password: { required: true }
  password-file: { required: false }
  confluence-base-url: { required: true }
  space-key: { required: true }
  parent-page-id: { required: true }
  version-message: { required: false }
  page-title-strategy: { required: false, default: 'filename-stem' }
  dry-run: { required: false, default: 'false' }
  skip-unchanged: { required: false, default: 'true' }
  render-html-blocks: { required: false, default: 'false' }
  clean: { required: false, default: 'false' }
  update-parent-page: { required: false, default: 'true' }
```

The `clean` input is destructive — when `true`, every page descendant of
`parentPageId`, including manual/unlabeled pages, is moved to trash before
recreation. The `update-parent-page` input controls the parent summary region
(default on); set `false` to skip parent updates and leave existing managed and
manual parent content untouched. If `egose/actions/confluence` requires
separately declared inputs, wire both there as a release follow-up.

A runnable smoke fixture lives under `packages/confluence/action-fixture/` and
demonstrates starting a sync with mocked `INPUT_*` inputs (no network), proving
`INPUT_CLEAN` and `INPUT_UPDATE-PARENT-PAGE` reach planning via dry-run.

## Notes

- Authentication uses HTTP Basic with an API token (not your account password).
- Attachment binary upload uses the Confluence v1 multipart endpoint
  (`/wiki/rest/api/content/{pageId}/child/attachment`) with
  `X-Atlassian-Token: no-check`, because v2 has no multipart upload contract
  yet. Page, space, and attachment-list calls use v2.
- Each PUT supplies `version.number = current + 1`, so the server rejects
  concurrent writes with HTTP 409. See optimistic concurrency in the website
  guide.
- All inline HTML output is entity-escaped; the only place raw markup lands in
  the page body is inside fenced code blocks (where the `]]>` CDATA terminator
  is neutralized) and, when `--render-html-blocks` is on, inside an
  `ac:structured-macro ac:name="html"` body. The latter is an active-content
  boundary — do not feed untrusted Markdown.
- Inline rendering is a single-pass tokenizer: inline code spans are protected
  first (their contents are never parsed as Markdown or re-escaped), then
  links/images, emphasis, and backslash escapes are resolved against the raw
  text and emitted as escaped XML exactly once. Links/images parse URLs across
  balanced nested parentheses and validate against an **allowlist**
  (`http`/`https`/`mailto`/`tel` + scheme-less relative); other schemes
  (`javascript:`/`data:`/`file:`/`vbscript:`/custom) collapse to their
  label/alt text. C0/DEL control characters and percent-encoded blocked
  schemes are rejected.
- The Markdown subset (CommonMark flanking emphasis, intraword `*` vs
  non-intraword `_`, nested emphasis/links, backslash escapes) and Mermaid
  rendering requirements/fallback are documented in the website guide.
