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

| Flag                          | Description                                                                                                                                                                                                                         | Default                              |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `--config <path>`             | JSON / `.mjs` / `.cjs` config file. CLI flags override config for the same option; env fills gaps; see [precedence](#configuration-precedence).                                                                                     | —                                    |
| `--cwd <path>`                | Working directory; `--folder` and secret-file paths resolve against this.                                                                                                                                                           | `process.cwd()`                      |
| `--folder <path>`             | Folder containing the documentation to publish (required, unless `--interactive` collects it).                                                                                                                                      | —                                    |
| `--username <value>`          | Confluence username or email (required).                                                                                                                                                                                            | —                                    |
| `--api-token <value>`         | Confluence API token (required). Alias: `--password`. Prefer a secret file; see [credentials](#credentials).                                                                                                                        | —                                    |
| `--api-token-file <path>`     | File whose contents become the API token (one trailing newline + surrounding whitespace stripped). Alias: `--password-file`. Resolved relative to `--cwd`.                                                                          | —                                    |
| `--confluence-base-url <url>` | Confluence URL with `/wiki` (required). Alias: `--base-url`.                                                                                                                                                                        | —                                    |
| `--space-key <key>`           | Confluence space key (required; resolved to a `spaceId` via the API).                                                                                                                                                               | —                                    |
| `--parent-page-id <id>`       | Numeric page id under which docs are published (required).                                                                                                                                                                          | —                                    |
| `--version-message <text>`    | Version-message suffix appended to every page/attachment PUT.                                                                                                                                                                       | `Synced via repo-toolkit-confluence` |
| `--skip-unchanged`            | Skip pages whose body is unchanged.                                                                                                                                                                                                 | `true` (skip)                        |
| `--no-skip-unchanged`         | Re-upload every page even when unchanged.                                                                                                                                                                                           | —                                    |
| `--dry-run`                   | Walk the doc tree and run the same local preflight (read + convert every markdown file, validate every local image source) then print the plan. No API mutation calls; bypasses required-field checks so no credentials are needed. | `false`                              |
| `--render-html-blocks`        | Render ` ```html ` fenced blocks as inline HTML via the Confluence `html` macro instead of a code box. **Unsafe for untrusted Markdown.**                                                                                           | `false`                              |
| `-i, --interactive`           | Prompt on a real TTY for missing non-secret required fields. The API token is never prompted.                                                                                                                                       | `false`                              |
| `-h, --help`                  | Show help and return.                                                                                                                                                                                                               | —                                    |

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

| Option                  | `CONFLUENCE_*`                  | `INPUT_*` (Actions form)                      |
| ----------------------- | ------------------------------- | --------------------------------------------- |
| folder                  | `CONFLUENCE_FOLDER`             | `INPUT_FOLDER`                                |
| username                | `CONFLUENCE_USERNAME`           | `INPUT_USERNAME`                              |
| apiToken                | `CONFLUENCE_API_TOKEN`          | `INPUT_API-TOKEN`, `INPUT_PASSWORD`           |
| apiTokenFile            | `CONFLUENCE_API_TOKEN_FILE`     | `INPUT_API-TOKEN-FILE`, `INPUT_PASSWORD-FILE` |
| baseUrl                 | `CONFLUENCE_BASE_URL`           | `INPUT_CONFLUENCE-BASE-URL`                   |
| spaceKey                | `CONFLUENCE_SPACE_KEY`          | `INPUT_SPACE-KEY`                             |
| parentPageId            | `CONFLUENCE_PARENT_PAGE_ID`     | `INPUT_PARENT-PAGE-ID`                        |
| versionMessage          | `CONFLUENCE_VERSION_MESSAGE`    | `INPUT_VERSION-MESSAGE`                       |
| skipUnchanged (bool)    | `CONFLUENCE_SKIP_UNCHANGED`     | `INPUT_SKIP-UNCHANGED`                        |
| dryRun (bool)           | `CONFLUENCE_DRY_RUN`            | `INPUT_DRY-RUN`                               |
| renderHtmlBlocks (bool) | `CONFLUENCE_RENDER_HTML_BLOCKS` | `INPUT_RENDER-HTML-BLOCKS`                    |

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

## Additive (non-pruning) sync

Sync is strictly additive with respect to Confluence: it only creates pages
that do not yet exist and updates the body of pages it can map. It **never
deletes** Confluence pages or attachments that are absent locally. Removing a
file from your docs folder will not remove the corresponding Confluence page;
you must delete it in Confluence yourself.

This is intentional for docs-as-code: most teams want edits made directly in
Confluence (sibling pages, free-form notes) to survive a sync. The trade-off
is that the local tree is not the source of truth for **removal**.

A few other reconciliation rules:

- The local tree is hashed by **page title under parent**: collisions between a
  file-page and a folder-page with the same title under the same parent are
  rejected up front with `Local documentation tree contains conflicting page
titles under the same parent: <title>`.
- If two Confluence pages match a title under the same parent, sync throws
  `Multiple Confluence pages matched title <title> under parent <parentId>`
  rather than guessing.
- Pages are cached per space+title+parent within a single sync run; the cache
  is not persisted, so cross-sync concurrency is governed by the 409 path
  above.

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
});

await syncConfluenceToDocs({ ...plan, renderHtmlBlocks: false });
```

### Exports

- `syncConfluenceToDocs(options)` — walk the doc tree and sync pages,
  attachments, and mermaid blocks.
- `resolveConfluenceSyncPlan(options)` — resolve and validate the sync plan
  (`ConfluenceSyncPlan`) without starting a sync. Useful for previewing
  defaults.
- `ConfluenceClient`, `ConfluenceApiError` — the HTTP client used by the
  sync. Page/space/attachment-list calls use the v2 API; binary attachment
  uploads use the v1 multipart endpoint with `X-Atlassian-Token: no-check`
  because v2 has no multipart contract yet.
- `markdownToStorage(markdown, options)` — the standalone Markdown →
  Confluence storage-format converter. Returns `{ html, mermaidBlocks }`.
- `renderHtmlBlock`, `renderCodeBlock`, `renderInline`, `escapeXmlAttribute`,
  `escapeAttachmentFilename`, `isRemoteUrl`, `isAllowedUrl`,
  `LOCAL_IMAGE_PLACEHOLDER_RE` — converter building blocks for reuse in tests
  or custom pipelines. `isAllowedUrl` exposes the inline link/image URL
  allowlist (`http`/`https`/`mailto`/`tel` + scheme-less relative) so custom
  pipelines can validate against the same policy.
- `rewriteImagesToAttachments`, `rewriteMermaidBlocks` — second-pass rewriters
  that turn `<ac:image data-local-src>` placeholders into attachment macros
  and mermaid placeholders into `mmdc`-rendered SVG attachments.
- `readDocTree`, `titleFromSegment`, `isMarkdownName`, `DocEntry`,
  `DocTree` — the local documentation-tree reader used by the sync.

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
  dry-run: { required: false, default: 'false' }
  skip-unchanged: { required: false, default: 'true' }
  render-html-blocks: { required: false, default: 'false' }
```

A runnable smoke fixture lives under
[`packages/confluence/action-fixture`](https://github.com/egose/repo-toolkit/blob/main/packages/confluence/action-fixture)
and demonstrates starting a sync with mocked `INPUT_*` inputs and no network,
so an Action runner can confirm the bundle wires the CLI to `INPUT_*` inputs
end-to-end.
