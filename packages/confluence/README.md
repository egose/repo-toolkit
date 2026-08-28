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
concurrency, non-pruning behavior, raw-HTML safety) lives at
<https://repo-toolkit.pages.dev/docs/packages/confluence>.

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
  mutation calls; credentials are not required under `--dry-run`.
- `--render-html-blocks` — render ` ```html ` fenced blocks as inline HTML via
  the Confluence `html` macro instead of a code box (default: `false`). **Unsafe
  for untrusted Markdown** — see the raw HTML section of the website guide.
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

> **Changing the strategy changes title-based identity.** Sync is additive and non-pruning and looks up Confluence pages by title under parent. Switching the strategy therefore seeks a new title and may **create a new page while leaving the old page untouched** — it does not rename, move, or delete existing pages. Operators must manually rename, delete, or archive old generated pages (or migrate them) before switching strategies in production.

Path-based strategies reduce predictable local collisions (for example, repeated basenames such as `credentials.md` or `README.md` in separate subtrees) but cannot guarantee uniqueness against unrelated or manually created pages already present in the target Confluence space. Existing spaces may still cause Confluence API conflicts if a generated title collides with an unrelated page under the same parent. Do not truncate or hash titles locally; if Confluence imposes a remote title-length limit, the existing API error behavior applies.

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
});
```

`resolveConfluenceSyncPlan(options)` resolves the same plan without starting a
sync; it is the documented way to validate options up front.

`syncConfluenceToDocs` runs a **local preflight** before any remote mutation:
every markdown file is read and converted to storage HTML, and every local
image source is validated against the same root-confined, regular-file, and
size checks the upload path applies. On the first defect it throws an
`LocalSyncValidationAggregateError` listing every failing entry (zero API
calls). On a remote failure mid-run it throws a `SyncMutationError` carrying
`.changes` (pages that succeeded), `.failure` (the failing entry + its error),
and `.unprocessed` (remaining entries). On success it returns a
`SyncResult` whose `.changes` lists every created/updated/unchanged page.
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
```

A runnable smoke fixture lives under `packages/confluence/action-fixture/` and
demonstrates starting a sync with mocked `INPUT_*` inputs (no network).

## Notes

- Authentication uses HTTP Basic with an API token (not your account password).
- Attachment binary upload uses the Confluence v1 multipart endpoint
  (`/wiki/rest/api/content/{pageId}/child/attachment`) with
  `X-Atlassian-Token: no-check`, because v2 has no multipart upload contract
  yet. Page, space, and attachment-list calls use v2.
- Pages are reconciled additively (non-pruning): sync never deletes Confluence
  pages or attachments that are absent locally. Each PUT supplies
  `version.number = current + 1`, so the server rejects concurrent writes with
  HTTP 409.
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
