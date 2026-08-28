---
sidebar_label: Confluence
sidebar_position: 5
---

# `@repo-toolkit/confluence`

Sync a folder of Markdown documentation to Confluence, mirroring the directory
structure as a page hierarchy. Each Markdown file becomes one Confluence page
under the configured parent; each sub-folder becomes a parent page. Local
images referenced from the markdown are uploaded as Confluence attachments and
inline-rendered as `<ac:image><ri:attachment />` macros; remote images stay as
`<ac:image><ri:url />`.

The package is GitHub-Action compatible: with no CLI flags it reads `INPUT_*`
environment variables (the same shape as the `Bhacaz/docs-as-code-confluence`
action's `action.yml`), so you can drop it into a `node20` action or run it as
a standalone CLI.

The package-local [`README.md`](https://github.com/egose/repo-toolkit/blob/main/packages/confluence/README.md)
stays concise; this guide is the canonical, behavior-exact reference. CLI help
(`repo-toolkit-confluence --help`) and the API defaults in
`resolveConfluenceSyncPlan` agree with everything documented here.

## Install

```bash npm2yarn
npm install --save-dev @repo-toolkit/confluence
```

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

### Flags

| Flag                          | Description                                                                                                                                                                                                                                                                                                                                                                                                                        | Default                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `--config <path>`             | JSON / `.mjs` / `.cjs` config file. CLI flags override config for the same option; env fills gaps; see [precedence](#configuration-precedence).                                                                                                                                                                                                                                                                                    | —                                    |
| `--cwd <path>`                | Working directory; `--folder` and secret-file paths resolve against this.                                                                                                                                                                                                                                                                                                                                                          | `process.cwd()`                      |
| `--folder <path>`             | Folder containing the documentation to publish (required, unless `--interactive` collects it).                                                                                                                                                                                                                                                                                                                                     | —                                    |
| `--username <value>`          | Confluence username or email (required).                                                                                                                                                                                                                                                                                                                                                                                           | —                                    |
| `--api-token <value>`         | Confluence API token (required). Alias: `--password`. Prefer a secret file; see [credentials](#credentials).                                                                                                                                                                                                                                                                                                                       | —                                    |
| `--api-token-file <path>`     | File whose contents become the API token (one trailing newline + surrounding whitespace stripped). Alias: `--password-file`. Resolved relative to `--cwd`.                                                                                                                                                                                                                                                                         | —                                    |
| `--confluence-base-url <url>` | Confluence URL with `/wiki` (required). Alias: `--base-url`.                                                                                                                                                                                                                                                                                                                                                                       | —                                    |
| `--space-key <key>`           | Confluence space key (required; resolved to a `spaceId` via the API).                                                                                                                                                                                                                                                                                                                                                              | —                                    |
| `--parent-page-id <id>`       | Numeric page id under which docs are published (required).                                                                                                                                                                                                                                                                                                                                                                         | —                                    |
| `--version-message <text>`    | Version-message suffix appended to every page/attachment PUT.                                                                                                                                                                                                                                                                                                                                                                      | `Synced via repo-toolkit-confluence` |
| `--page-title-strategy <val>` | Leaf page title strategy — `filename-stem` (default, filename without final `.md`), `filename` (with extension), `sentence-case-parent` (stem + immediate parent), `sentence-case-parents` (stem + all parents), `sentence-case-path` (stem + all parents + filename with extension). Folder pages keep raw directory names.                                                                                                       | `filename-stem`                      |
| `--skip-unchanged`            | Skip pages whose body is unchanged.                                                                                                                                                                                                                                                                                                                                                                                                | `true` (skip)                        |
| `--no-skip-unchanged`         | Re-upload every page even when unchanged.                                                                                                                                                                                                                                                                                                                                                                                          | —                                    |
| `--dry-run`                   | Walk the doc tree and run the same local preflight (read + convert every markdown file, validate every local image source) then print the plan. No API mutation calls; bypasses required-field checks so no credentials are needed. Dry-run can show clean/prune and parent-summary intent but cannot list/count remote deletion candidates, fetch parent content, or provide mapped remote links because it makes zero API calls. | `false`                              |
| `--render-html-blocks`        | Render ` ```html ` fenced blocks as inline HTML via the Confluence `html` macro instead of a code box. **Unsafe for untrusted Markdown.**                                                                                                                                                                                                                                                                                          | `false`                              |
| `--clean`                     | Move all page descendants to trash before recreation. **WARNING: destructive — all page descendants, including manual/unlabeled pages, are moved to trash; parentPageId is retained and never deleted.** Pages are moved to trash (recoverable), never purged.                                                                                                                                                                     | `false`                              |
| `--update-parent-page`        | Update parent page summary region.                                                                                                                                                                                                                                                                                                                                                                                                 | `true`                               |
| `--no-update-parent-page`     | Do not update parent page summary.                                                                                                                                                                                                                                                                                                                                                                                                 | —                                    |
| `-i, --interactive`           | Prompt on a real TTY for missing non-secret required fields. The API token is never prompted.                                                                                                                                                                                                                                                                                                                                      | `false`                              |
| `-h, --help`                  | Show help and return.                                                                                                                                                                                                                                                                                                                                                                                                              | —                                    |

## Configuration precedence

Every option is resolved **independently** in this order, with later sources
overriding earlier ones only for the option they supply:

1. CLI flag for that option
2. `--config` file value for that option
3. `CONFLUENCE_*` environment variable for that option (higher specificity)
4. `INPUT_*` environment variable for that option (GitHub Actions form)
5. built-in default

Supplying `--api-token` (or any other flag) does **not** disable environment
resolution for the options you left unset. You can keep credentials in the
environment and still override, say, `--folder` on the command line. The merged
options are computed as `{ ...envOptions, ...config, ...cliOptions }`, so CLI
wins per-option, config wins over env per-option, and env fills gaps left by
both.

### Environment variables

`CONFLUENCE_*` (higher specificity) and the `INPUT_*` GitHub Actions form are
both read for every option. Boolean env values accept `true|1|yes|on` /
`false|0|no|off` (the empty string is falsy); any other value exits nonzero
with `Invalid boolean value for <ENV_NAME>: <raw>. Use one of
true|false|1|0|yes|no|on|off.` naming the offending variable and value.

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

`CONFLUENCE_*` takes precedence over the lower-specificity `INPUT_*` form, so
non-Action users can supply env credentials with documented semantics while
the existing `INPUT_*` contract for GitHub Actions continues to work.

## Credentials

Authentication uses HTTP Basic with an **API token**, not your account
password. Three input paths exist, in order of recommendation:

1. **Secret file** — `--api-token-file <path>` (`--password-file`), the
   `apiTokenFile` config key, or `CONFLUENCE_API_TOKEN_FILE` /
   `INPUT_API-TOKEN-FILE` / `INPUT_PASSWORD-FILE` env. The file is read into
   `apiToken`; one trailing newline and surrounding whitespace are stripped.
   An empty file fails with `apiTokenFile at <path> is empty.`; an unreadable
   file fails with `Failed to read apiTokenFile at <path>` (the underlying fs
   error is preserved on `Error.cause` — `target: ES2018` precludes the
   `new Error(m, { cause })` constructor form). Secret-file paths resolve
   relative to `--cwd`.
2. **Environment variable** — `CONFLUENCE_API_TOKEN` (preferred) or
   `INPUT_API-TOKEN` / `INPUT_PASSWORD`.
3. **CLI flag** — `--api-token <value>` (`--password`). The least safe option
   because the value is visible in argv and process listings; prefer one of
   the above.

An explicit `--api-token` (or env-supplied token) **wins** over the file: if
both are present, the file is not read. An interactive session with no token
throws `apiToken is required. Provide it via --api-token-file,
INPUT_API-TOKEN-FILE, CONFLUENCE_API_TOKEN_FILE, or the CONFLUENCE_API_TOKEN /
INPUT_API-TOKEN environment variable. Tokens are never prompted interactively
to avoid entering them on screen.`

`--help`, errors, and all log lines never print the supplied token value.

## `--interactive`

Neither inert nor global. Resolution:

- Only effective when `--interactive` is set, `canPrompt()` is true (real
  TTY, not piped input), and `--dry-run` is not set.
- Collects missing **non-secret** required fields only: `folder`,
  `username`, `baseUrl`, `spaceKey`, `parentPageId`.
- The API token is **never** prompted interactively. An interactive session
  with no token throws the credential error above instead of asking.

Without `--interactive`, missing required fields short-circuit with a precise
field-level error before the Confluence client is built.

## Raw HTML and security

The Markdown → Confluence storage-format pipeline entity-escapes all inline
HTML by default. The only places raw markup lands in the page body are:

1. **Fenced code blocks** (` ```lang `) — emitted as a Confluence `code`
   structured macro whose plain-text body is wrapped in a CDATA section. The
   `]]>` CDATA terminator is neutralized (`]]>` → `]]]]><![CDATA[>`) so block
   contents cannot escape the macro. This is safe for arbitrary content
   because the macro renders text, not active markup.
2. **HTML fenced blocks** when `--render-html-blocks` is on — emitted as an
   `ac:structured-macro ac:name="html"` body. The Confluence `html` macro
   **executes the raw markup**, so this path is an active-content boundary.
   **Do not feed untrusted Markdown through `--render-html-blocks`.** The
   default (`false`) emits HTML fenced blocks as a `code` macro instead, which
   is safe.

The package deliberately does not ship a sanitization layer for raw HTML
blocks: the safe-by-default stance is `--render-html-blocks` off, and the
unsafe opt-in is documented as such. If you cannot trust your Markdown input,
leave `--render-html-blocks` off.

Inline link and image URLs are validated against an **allowlist**, not a
blocklist. Only `http`, `https`, `mailto`, and `tel` schemes, plus scheme-less
protocol-relative (`//host`), server-relative (`/path`), and pure-relative
(`path`, `#frag`, `?query`) URLs are rendered as links/images. Every other
scheme — `javascript:`, `data:`, `file:`, `vbscript:`, `blob:`, `myapp:`,
custom app schemes, etc. — is rejected and the link/image collapses to its
label/alt text. URLs containing C0/DEL control characters (NUL, TAB, CR, LF,
BEL, DEL, …) are rejected, defeating `java\tscript:`-style obfuscation.
Percent-encoded blocked schemes (e.g. `java%73cript:`) are decoded before the
scheme check and rejected. `&` in a URL attribute is escaped to `&` so the
generated `href`/`ri:value` remains XML-valid.

## Supported Markdown

A focused subset of CommonMark is converted to Confluence storage format.
Features not in this list are passed through as paragraphs (escaped), not
treated specially.

- ATX headings (`#` through `######`)
- Paragraphs, with hard line breaks (`<br />`) within a paragraph
- Unordered lists (`-`, `*`, `+`) and ordered lists (`1.`)
- Blockquotes (`>`)
- Thematic breaks (`---` / `***`)
- Fenced code blocks (` ```lang `), emitted as a Confluence `code` macro.
  Unknown languages are tagged `language=none`.
- Inline: `**strong**`, `__strong__`, `*em*`, `_em_`, `` `code` ``
- Inline code spans are tokenized **first** and their contents are never
  processed as Markdown or re-escaped; `*not italic*` inside `` ` ` `` stays
  literal. Backtick-run-length matching (`` `x` ``, `` `a`b`` `) follows
CommonMark, and a single leading/trailing space inside a span is trimmed
(` `code`→`<code>code</code>` ``).
- Emphasis is matched with CommonMark flanking rules. `*` allows intraword
  emphasis (`a*b*c`); `_` does not (`snake_case_name` is literal, not
  `snake<em>case</em>name`). Nested emphasis works:
  `**a *b* c** → <strong>a <em>b</em> c</strong>`.
- Backslash escapes work for ASCII punctuation: `\*` → `*`, `\_` → `_`,
  `\[` → `[`, etc., so escaped markers cannot open/close emphasis or links.
- Links `[text](url)` and images `![alt](src)` parse URLs across **balanced
  nested parentheses** (`[wiki](https://en/Foo_(bar))`) and recursively render
  the label (so `[*em* **strong**](url)` works). URLs are validated against
  the allowlist above.
- Local images (`![alt](relative.png)`) become `<ac:image
data-local-src="...">` placeholders that are rewritten to attachment macros
  after upload. Remote images (`http(s)://` / protocol-relative `//`) stay as
  `<ac:image><ri:url />`.
- YAML front matter (`---` … `---`/`...`) is stripped from the top of each
  file before conversion.

Beyond the Markdown subset, fenced ` ```mermaid ` blocks are rendered to SVG
and uploaded as attachments when `mmdc` is available (see below), otherwise
emitted as `code` macros.

Tables, footnotes, task lists, definition lists, HTML inline, and raw HTML
outside fenced blocks are **not** in the supported subset.

## Mermaid

` ```mermaid ` fenced blocks are turned inline as an `<ac:image>` macro
pointing at an SVG attachment on the page, when:

- The `mmdc` (mermaid-cli) binary is discoverable on `PATH`, or
- `renderHook`/`available` is supplied programmatically (testing path).

If `mmdc` is unavailable, or rendering fails, or the produced file is empty or
not a valid SVG, the block **falls back** to a Confluence `code` macro with
the original mermaid source, and a `mermaid: N block(s) not rendered (mmdc
unavailable or failed); emitted as code macros` line is logged. Existing
attachments with the same filename are updated in place (new version number)
instead of duplicated.

Per-render settings (`renderTimeoutMs` default 30 000 ms, `maxStreamBytes`
default 1 MiB) bound a misbehaving `mmdc` subprocess. There is no in-process
mermaid renderer; if you want diagrams rendered, install `@mermaid-js/mermaid-cli`
in the action runner or CI image.

## Optimistic concurrency

Page writes use Confluence's optimistic concurrency model:

- Before each PUT, the current page is fetched and the next version is
  computed as `version.number = current + 1`.
- The PUT supplies that `version.number`, so a concurrent edit between the
  fetch and the PUT makes the server reject the write with **HTTP 409**. The
  client surfaces this as `ConfluenceApiError` with a `version conflict`
  message and does not silently retry writes (retries apply only to safe
  methods — GET/HEAD/OPTIONS — on 429/5xx).
- `--skip-unchanged` (default on) avoids a PUT when the page body is already
  identical to the local render. The comparison is byte-equal on the produced
  storage-format HTML.

Because writes are versioned, two sync processes editing the same page cannot
silently clobber each other: the loser gets a 409 and exits nonzero. There is
no built-in retry-on-conflict policy; rerun the sync to reconcile.

## Managed ownership and reconciliation

The sync makes the local documentation tree authoritative for pages it creates
or adopts, without deleting unrelated Confluence content.

### Ownership label

- Every generated folder page and Markdown leaf page created, updated, or
  otherwise mapped by a successful sync carries the fixed global Confluence
  label `repo-toolkit-confluence` (`CONFLUENCE_MANAGED_LABEL`, prefix `global`).
  The value is not configurable. Comparison checks both name and prefix — a
  personal label with the same name is not an ownership marker.
- Existing labels are preserved; sync never replaces or removes labels.
- The label is added only when absent, so repeated unchanged syncs issue no
  redundant `POST /wiki/rest/api/content/{id}/label`.
- The target `parentPageId` is an external anchor and is never labeled.
- A page is not considered safely managed until the marker POST succeeds. A
  create/update followed by a label failure surfaces structured partial-mutation
  evidence and prevents the prune phase from running.
- Existing pages found by title-under-parent become tool-managed once the sync
  maps them and successfully adds the marker — this is adoption. Because the
  page now carries the marker, removing its local source later makes it
  eligible for pruning. Documentation calls this out prominently.
- Removing the marker from a managed page opts it out of pruning until a
  future sync maps/adopts it again and re-applies the label.

### Default managed pruning (`clean: false`, the default)

- Local preflight (read/convert every Markdown file, validate every local image
  source) runs before any remote call. Pruning only runs after every local page
  has synced and its ownership label has been verified or added successfully.
- The orchestrator tracks the page ids actually mapped during this run,
  including synthetic folder pages and Markdown leaves, by id — not by
  re-querying titles after mutation.
- All descendants under `parentPageId` are enumerated via paginated
  `GET /wiki/api/v2/pages/{id}/descendants` (same-origin cursor, bounded page
  cap), but `parentPageId` itself is never a deletion candidate. Decisions are
  scoped to that subtree; a space-wide label query is not used.
- A remote page is stale only when it has the exact global
  `repo-toolkit-confluence` marker and its id is absent from the current
  mapped-id set.
- Stale pages are deleted deepest-first (children before parents) by id via
  `DELETE /wiki/api/v2/pages/{id}`. Each delete moves the page to trash
  (recoverable); `purge=true` is never requested. Attachments are not deleted
  independently — trashing a page scopes its attachments.
- Unlabeled/manual pages are never deleted by default pruning.
- If deleting a stale labeled ancestor could also remove an unlabeled,
  non-page, inaccessible, or otherwise retained descendant, that ancestor is
  blocked and reported as `blocked` rather than risking collateral deletion.
  Safe stale siblings are still deleted.
- A local tree with zero Markdown entries is valid for reconciliation: it
  deletes every safely deletable managed descendant and retains every
  manual/unlabeled descendant.
- If sync fails before pruning, no stale-page deletions occur. If pruning
  fails partway, the run stops and returns structured evidence
  (`ReconciliationError` with `phase: 'prune'`, `completed`, `failure`
  (`pageId` + error), and `unprocessed`).

### Explicit clean (`clean: true`)

- `clean` defaults to `false` through every input path (API/config
  `clean: false`, CLI `--clean` absent, `CONFLUENCE_CLEAN=false`,
  `INPUT_CLEAN=false`). No destructive reset occurs when the option is omitted.
- After successful local preflight and before creating/updating pages, the
  subtree is enumerated and every page descendant is moved to trash,
  regardless of ownership label, deepest-first. `parentPageId` is never
  deleted. Label lookup is not required — `clean` is deliberately stronger
  than managed pruning.
- **WARNING:** All page descendants, including manual/unlabeled pages, are
  moved to trash before recreation. Pages are moved to trash (recoverable
  through Confluence trash), never purged.
- If the subtree contains a non-page type (whiteboard, database, embed,
  folder) or an incomplete inventory whose retention cannot be proven, `clean`
  fails closed before the first deletion with an unsupported-tree /
  collateral-deletion error; it does not silently widen from pages to other
  content.
- After clean succeeds, the normal sync and labeling run; no redundant
  post-sync prune against the newly created mapped set occurs.
- A local tree with zero Markdown entries plus `clean: true` still performs
  the clean and leaves the target page with no safely deletable page
  descendants.
- On a partial clean failure, the run aborts before page creation and exposes
  `ReconciliationError` with `phase: 'clean'`, `completed`, `failure`, and
  `unprocessed`.

## Parent page summary (`updateParentPage: true`, the default)

When `updateParentPage` is `true` (the default via API/config
`updateParentPage: true`, CLI `--update-parent-page` / absent flag,
`CONFLUENCE_UPDATE_PARENT_PAGE=true`, `INPUT_UPDATE-PARENT-PAGE=true`), the
target parent page is updated after child-page sync, ownership labeling, and
clean/prune reconciliation have completed successfully. If any earlier phase
fails, the parent summary is left unchanged.

- The parent page is fetched, its title and every byte of body content outside
  one tool-managed region are preserved, and the update is applied with
  `version.number = current + 1` under the existing optimistic-concurrency
  contract. The region is bounded by
  `<!-- repo-toolkit-confluence:parent-summary:start -->` and
  `<!-- repo-toolkit-confluence:parent-summary:end -->` which survive a
  storage-format round trip. The region is uniquely identifiable; malformed or
  duplicate markers fail closed without rewriting the parent; the whole parent
  body is never replaced as a shortcut.
- On the first run the managed region is appended without removing existing
  content; on later runs that region is replaced in place. Setting
  `updateParentPage: false` (or `--no-update-parent-page`,
  `CONFLUENCE_UPDATE_PARENT_PAGE=false`, `INPUT_UPDATE-PARENT-PAGE=false`)
  leaves both existing managed and manual parent content untouched — it does
  not remove a previously generated region.
- The PUT is skipped when the reconstructed body is byte-equal to the current
  body. No wall-clock timestamp, current page version, per-run
  created/updated/deleted counts, or other volatile values are included, so
  identical deployments do not force an update.
- The region contains:
  - `Synced documentation` heading with provenance equivalent to the footer on
    generated child pages. When `repositoryUrl` resolves, it links to that URL;
    when absent, only that the subtree is maintained by
    `repo-toolkit-confluence` is stated — absolute runner paths are never
    exposed.
  - Deterministic structural statistics derived from the validated local plan
    and final mapping: Markdown page count, generated directory-page count,
    total managed child-page count, maximum documentation depth, local
    attachment-reference count, and Mermaid-block count. Zero values render
    explicitly for an empty tree.
  - A nested deterministic directory-style tree for every generated directory
    and Markdown page, in local relative-path order, displaying the resolved
    Confluence title, distinguishing directory pages from Markdown leaves, and
    linking each item to its mapped Confluence page via an id-backed
    storage-format `ri:page` link. Links are built from returned page metadata
    / id, not title-only search.
  - Stable guidance that generated descendants carry the
    `repo-toolkit-confluence` label, missing labeled pages are pruned after
    successful sync, unlabeled pages are preserved by default, and explicit
    clean moves all safely deletable page descendants to trash.
  - The summary is compact and storage-format safe; it does not copy
    child-page bodies, headings, excerpts, attachment names, repository
    secrets, credentials, local absolute paths, or unbounded remote metadata.
- With an empty local tree, provenance/guidance, zero statistics, and an
  explicit `No managed child pages` tree state are rendered.
- `updateParentPage: false` causes zero parent `GET`/`PUT` calls and does not
  remove a previously generated region. The target parent itself remains
  unlabeled and is never deleted even when `updateParentPage` is on.
- A parent `GET`/`PUT` failure after child reconciliation returns structured
  phase-specific evidence (`ParentSummaryError` with `phase: 'parent-summary'`,
  `changes`, `labelsAdded`, `cleanDeletions`, `pruneDeletions`, `blocked`, and
  `failure` containing the parent `pageId` and error) showing that child work
  succeeded but the parent summary did not. The run still surfaces Confluence
  409 conflicts without write retries.
- Dry-run with `updateParentPage: true` retains zero API calls; it may print
  locally known parent-summary statistics and title tree, but it cannot claim
  the parent would be unchanged or emit remote id-backed links because it has
  not fetched the parent or mapped remote ids.

## Leaf page title strategies

Leaf Confluence page titles are derived from the Markdown file's relative path segments. Directory segments become synthetic parent-page titles and retain their raw segment text for every strategy — only the Markdown leaf file uses `pageTitleStrategy` (JS/config: `pageTitleStrategy`, CLI: `--page-title-strategy`, env: `CONFLUENCE_PAGE_TITLE_STRATEGY` / GitHub Action `INPUT_PAGE-TITLE-STRATEGY`; default: `filename-stem`).

| Strategy value          | Behavior                                                                                      | Example for `community-nodes/cdogs-document-generator/credentials.md`   |
| ----------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `filename-stem`         | Original filename without the final `.md` extension                                           | `credentials`                                                           |
| `filename`              | Original filename including extension                                                         | `credentials.md`                                                        |
| `sentence-case-parent`  | Sentence-case filename stem plus immediate parent folder                                      | `Credentials (cdogs-document-generator)`                                |
| `sentence-case-parents` | Sentence-case filename stem plus all parent folders                                           | `Credentials (community-nodes/cdogs-document-generator)`                |
| `sentence-case-path`    | Sentence-case filename stem plus all parent folders and original filename including extension | `Credentials (community-nodes/cdogs-document-generator/credentials.md)` |

Sentence case is deterministic and dependency-free: remove only the final case-insensitive `.md`; replace each run of `-` and `_` with one space; trim; lowercase ASCII letters; uppercase the first ASCII letter. Preserve digits and other punctuation. Examples: `failed-deployment.md` → `Failed deployment`, `n8n_setup.md` → `N8n setup`, `README.md` → `Readme`. Preserve the original filename and extension casing in `filename` and inside `sentence-case-path`; for example, `Guide.MD` remains `Guide.MD` where the original filename is included.

Parent folders are the `DocEntry.segments` before the filename. Exclude the configured documentation root itself and preserve each folder segment exactly as stored; join multiple folders with `/` on every platform. For `sentence-case-parent` and `sentence-case-parents`, omit the parentheses when a file is directly under the documentation root (`overview.md` → `Overview`). For `sentence-case-path`, the parenthesized path for a root file is the filename itself (`overview.md` → `Overview (overview.md)`). Folder-generated parent pages keep their existing raw segment titles for every strategy.

### Migration and uniqueness notes

> **Changing the strategy changes title-based identity.** Confluence lookup is title-under-parent with no persisted source-path-to-page-id mapping. Switching `pageTitleStrategy` therefore seeks a new title and may **create a new page while leaving the old page untouched** — it does not rename or move existing pages. Previously labeled pages created under the old strategy carry the `repo-toolkit-confluence` ownership label and are **pruned (moved to trash) after a successful sync** under the new strategy because they become stale labeled descendants. Pages created before the labeling feature or otherwise unlabeled remain unlabeled and are **never pruned automatically** — they require manual cleanup in Confluence. Use `--dry-run` to preview generated titles (`would sync <path> as "<title>"`) before switching strategies in production.
>
> Path-based strategies (`sentence-case-parent` / `sentence-case-parents` / `sentence-case-path`) reduce predictable local collisions (for example, repeated basenames such as `credentials.md`, `architecture.md`, or `README.md` in separate subtrees) but **do not guarantee uniqueness against unrelated or manually created pages** already present under the same Confluence parent. Existing unrelated pages can still cause Confluence API conflicts. Local preflight detects only conflicts within the supplied doc tree. Do not truncate or hash generated titles; if Confluence imposes a remote title-length limit, retain the existing API error behavior and document that path-based strategies can produce longer titles.

## Dry run

`--dry-run` walks the doc tree and runs the same local preflight (read + convert every Markdown file, validate every local image source) then prints the plan without any API mutation calls. Credentials are not required under `--dry-run`. The same local hierarchy validation applies, and dry-run logs:

- `would sync <path> as "<title>"` for every Markdown entry (with optional attachment/Mermaid counts)
- `[dry-run] clean requested: a real sync would move every page descendant of the target page to trash before recreating the local hierarchy.` when `clean: true`
- `a real sync would label every mapped page with the ownership marker and prune stale labeled descendants.` always, but without a concrete remote deletion count
- Parent-summary intent when `updateParentPage: true` — deterministic statistics (`Markdown pages`, `Directory pages`, `Total managed pages`, `Maximum depth`, `Attachment references`, `Mermaid blocks`) and title tree, but no mapped remote links or claim that the parent would be unchanged.

Because dry-run makes zero API calls, it cannot enumerate or count remote deletion candidates, fetch parent content, or provide id-backed links. Transition to a real sync to reconcile and update the parent summary.

## Permissions and concurrency

Required Confluence permissions and API scopes for a real sync:

- Read descendants of the configured `parentPageId` (`GET /wiki/api/v2/pages/{id}/descendants`, paginated, same-origin cursor).
- Read labels on descendants (`GET /wiki/api/v2/pages/{id}/labels`) and add the ownership marker (`POST /wiki/rest/api/content/{id}/label` with `[{ "prefix": "global", "name": "repo-toolkit-confluence" }]`).
- Create and update pages and attachments under the target (`POST`/`PUT` pages, `GET`/`PUT` page bodies, attachment upload via v1 multipart `POST /wiki/rest/api/content/{pageId}/child/attachment` with `X-Atlassian-Token: no-check`).
- Read and update the target parent page body (`GET /wiki/api/v2/pages/{id}`, `PUT` with `version.number = current + 1`).
- Delete (move to trash) pages when pruning or cleaning (`DELETE /wiki/api/v2/pages/{id}` without `purge=true`). Pages are moved to trash and remain recoverable; they are never purged.

Concurrent sync/clean jobs against the same `parentPageId` are unsupported and dangerous. Callers must serialize deployments for the same target; the tool does not add distributed locking. Two syncs racing on the same page are detected via optimistic concurrency (server returns HTTP 409 on version conflict) and the loser exits nonzero — rerun to reconcile. Downstream `egose/actions/confluence` wiring for `clean` and `update-parent-page` is a named release follow-up if that repository requires separately declared inputs.

## JavaScript API

```ts
import { syncConfluenceToDocs, resolveConfluenceSyncPlan, ConfluenceClient } from '@repo-toolkit/confluence';

// resolveConfluenceSyncPlan validates options without starting a sync:
const plan = resolveConfluenceSyncPlan({
  folder: 'docs',
  username: 'user@example.com',
  apiToken: process.env.CONFLUENCE_API_TOKEN!,
  baseUrl: 'https://mydomain.atlassian.net/wiki',
  spaceKey: 'ENG',
  parentPageId: '123456789',
  pageTitleStrategy: 'sentence-case-parents', // optional; default: 'filename-stem'
  clean: false, // optional; default: false
  updateParentPage: true, // optional; default: true
});

await syncConfluenceToDocs({ ...plan, renderHtmlBlocks: false });
```

### Custom gateway (typed testing / non-Confluence backends)

`syncConfluenceToDocs` and the lower-level rewriters depend only on the narrow
`ConfluenceGateway` and `AttachmentGateway` interfaces — they never read
`ConfluenceClient` directly. Supply your own object whose method shapes match
the interface and the bundled HTTP credentials/baseUrl are no longer required:
the gateway owns all remote work.

```ts
import { syncConfluenceToDocs, type ConfluenceGateway } from '@repo-toolkit/confluence';

// A typed fake: no `as unknown as ConfluenceClient` cast needed.
const fake: ConfluenceGateway = {
  async getSpaceIdByKey() {
    return 'SPACE';
  },
  async getPagesByTitle(_spaceId, _title) {
    return [];
  },
  async getPage() {
    throw new Error('not stubbed');
  },
  async createPage(input) {
    return {
      /* … */
    } as never;
  },
  async updatePage(input) {
    return {
      /* … */
    } as never;
  },
  async getAttachments() {
    return [];
  },
  async uploadAttachment() {
    throw new Error('not stubbed');
  },
  async updateAttachmentData() {
    throw new Error('not stubbed');
  },
};

await syncConfluenceToDocs({
  folder: 'docs',
  spaceKey: 'ENG',
  parentPageId: '123',
  client: fake, // ← skips username / apiToken / baseUrl checks
  log: () => {},
});
```

`spaceKey` and `parentPageId` remain required even with a custom gateway —
the orchestrator needs them to drive the gateway, and a custom client doesn't
know which Confluence space or parent page to publish under. `--dry-run`
remains credentials-free (no gateway needed).

### Exports

- `syncConfluenceToDocs(options)` — walk the doc tree and sync pages,
  attachments, and mermaid blocks.
- `resolveConfluenceSyncPlan(options)` — resolve and validate the sync plan
  (`ConfluenceSyncPlan`) without starting a sync. Fills `clean` (default
  `false`), `updateParentPage` (default `true`), and `pageTitleStrategy`
  (default `filename-stem`). Useful for previewing defaults.
- `ConfluenceClient`, `ConfluenceApiError` — the bundled HTTP client. Page/
  space/attachment-list calls use the v2 API; binary attachment uploads use
  the v1 multipart endpoint with `X-Atlassian-Token: no-check` because v2 has
  no multipart contract yet.
- `ConfluenceGateway`, `AttachmentGateway` — narrow remote-mutation
  interfaces that `ConfluenceClient` implements. Both the orchestrator and
  the image/mermaid rewriters depend only on these contracts, so a typed fake
  implementing the gateway is accepted by `syncConfluenceToDocs({ client })`
  and the rewriters without `as unknown as` casts. Supplying `client` skips
  the bundled-client credential/baseUrl required-field checks.
- `CONFLUENCE_MANAGED_LABEL` (`repo-toolkit-confluence`), `planStalePruning`,
  `planCleanDeletions`, `ReconciliationError` (phase `clean`/`prune`),
  `ParentSummaryError` (phase `parent-summary`), `SyncResult` (`changes`,
  `labelsAdded`, `cleanDeletions`, `pruneDeletions`, `blocked`,
  `parentStatus`), `SyncMutationError`, `LocalSyncValidationAggregateError` —
  managed ownership, reconciliation evidence, and parent-summary contracts.
- `markdownToStorage(markdown, options)` — the standalone Markdown →
  Confluence storage-format converter. Returns `{ html, mermaidBlocks }`.
- `escapeXmlAttribute`, `escapeAttachmentFilename`, `isRemoteUrl`,
  `isAllowedUrl` — converter building blocks for custom pipelines.
  `isAllowedUrl` exposes the inline link/image URL allowlist
  (`http`/`https`/`mailto`/`tel` + scheme-less relative) so custom pipelines
  can validate against the same policy.
- `rewriteImagesToAttachments`, `rewriteMermaidBlocks` — second-pass rewriters
  that turn `<ac:image data-local-src>` placeholders into attachment macros
  and mermaid placeholders into `mmdc`-rendered SVG attachments.
- `readDocTree`, `titleFromSegment`, `isMarkdownName`, `DocEntry`,
  `DocTree` — the local documentation-tree reader used by the sync.
- `pageTitleFromSegments(segments, strategy)`, `resolvePageTitleStrategy(value)`, `PAGE_TITLE_STRATEGIES`, `DEFAULT_PAGE_TITLE_STRATEGY`, `PageTitleStrategy` — leaf page title strategy contract (default: `filename-stem`). `resolvePageTitleStrategy` validates runtime values and `pageTitleFromSegments` implements all five Naming Contract outputs. `titleFromSegment` is retained for external consumers and directory-title compatibility.

## GitHub Action usage

The CLI auto-detects the GitHub Actions `INPUT_*` environment when no flags are
supplied. Bundle the **CLI entrypoint** (`src/cli.ts`) — not the library entry
(`src/index.ts`) — and ship the resulting `dist/cli.js` as the action main.
`tsup` emits the CLI as a separate entry with a `#!/usr/bin/env node` banner;
`@vercel/ncc` callers point at `src/cli.ts` directly.

```sh
# with @vercel/ncc
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

`clean` is destructive — when `true`, every page descendant of `parentPageId`,
including manual/unlabeled pages, is moved to trash (recoverable), never
purged, before recreation. `update-parent-page` controls the parent summary
region (default on); set `false` to skip parent updates and leave existing
managed and manual parent content untouched. If `egose/actions/confluence`
requires separately declared inputs, wire both there as a release follow-up.

A runnable smoke fixture lives under
[`packages/confluence/action-fixture`](https://github.com/egose/repo-toolkit/blob/main/packages/confluence/action-fixture)
and demonstrates starting a sync with mocked `INPUT_*` inputs and no network,
including `INPUT_CLEAN` and `INPUT_UPDATE-PARENT-PAGE`, so an Action runner
can confirm the bundle wires the CLI to `INPUT_*` inputs end-to-end.
