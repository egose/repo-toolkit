# `@repo-toolkit/confluence`

Sync a folder of Markdown documentation to Confluence, mirroring the directory
structure as a page hierarchy. Each Markdown file becomes one Confluence page
under the configured parent; each sub-folder becomes a parent page. Local
images referenced from the markdown are uploaded as Confluence attachments and
inline-rendered as `<ac:image><ri:attachment />` macros; remote images stay as
`<ac:image><ri:url />`.

The package is GitHub-Action compatible: when invoked with no CLI flags it reads
`INPUT_*` environment variables (the same shape as the `Bhacaz/docs-as-code-confluence`
action's `action.yml`), so you can drop it into a `node20` action or run it as a
standalone CLI.

## Installation

```sh
pnpm add -D @repo-toolkit/confluence
```

## CLI

```sh
repo-toolkit-confluence \
  --folder docs \
  --username user@example.com \
  --api-token $API_TOKEN \
  --confluence-base-url https://mydomain.atlassian.net/wiki \
  --space-key ENG \
  --parent-page-id 123456789
```

Flags:

- `--config <path>` — JSON/`.mjs`/`.cjs` config file with any of the options below
- `--cwd <path>` — working directory (default: `process.cwd()`)
- `--folder <path>` — documentation folder (required)
- `--username <value>` — Confluence username/email (required)
- `--api-token <value>` — Confluence API token (required; alias: `--password`)
- `--confluence-base-url <url>` — URL with `/wiki` (required; alias: `--base-url`)
- `--space-key <key>` — Confluence space key (required; resolved to a `spaceId`)
- `--parent-page-id <id>` — numeric Confluence page id (required)
- `--version-message <text>` — version-message suffix appended to every PUT
- `--skip-unchanged` / `--no-skip-unchanged` — skip pages whose body is unchanged (default: `skip`)
- `--dry-run` — walk the doc tree and log the plan, no API calls
- `-i, --interactive` — reserved (no interactive prompts yet)

## JavaScript API

```ts
import { syncConfluenceToDocs } from '@repo-toolkit/confluence';

await syncConfluenceToDocs({
  folder: 'docs',
  username: 'user@example.com',
  apiToken: process.env.API_TOKEN!,
  baseUrl: 'https://mydomain.atlassian.net/wiki',
  spaceKey: 'ENG',
  parentPageId: '123456789',
  versionMessage: 'chore(docs): sync',
});
```

## GitHub Action usage

The CLI auto-detects the GitHub Actions inputs environment when no flags are
supplied. Build and bundle this package (e.g. with `@vercel/ncc`) and ship the
resulting `dist/index.js` as the action entrypoint. Example `action.yml`:

```yaml
runs:
  using: 'node20'
  main: 'dist/index.js'
inputs:
  folder: { required: true }
  username: { required: true }
  password: { required: true }
  confluence-base-url: { required: true }
  space-key: { required: true }
  parent-page-id: { required: true }
```

## Notes

- Authentication uses HTTP Basic with an API token (not your account password).
- Attachment binary upload uses the Confluence v1 multipart endpoint
  (`/wiki/rest/api/content/{pageId}/child/attachment`) with
  `X-Atlassian-Token: no-check`, because v2 has no multipart upload contract
  yet. Page, space, and attachment-list calls use v2.
- Pages are reconciled without race conditions: each PUT supplies
  `version.number = current + 1` so the server rejects concurrent writes with
  HTTP 409.
- All HTML output is entity-escaped; the only place raw markup lands in the
  page body is inside fenced code blocks, where the `]]>` CDATA terminator is
  neutralized before publishing.
