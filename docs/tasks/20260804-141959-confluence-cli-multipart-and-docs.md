# Confluence CLI Multipart And Documentation

Created: 2026-08-04 14:19:59

## Objective

Finish Confluence transport hardening and make CLI/environment/action documentation accurately represent executable behavior.

### Task CFINT-01: Stream and sanitize multipart uploads

Status: completed

Priority: P1

Suggested agent: Node HTTP upload engineer

Dependencies: CFSEC-02, CFSEC-04 in `20260804-141959-confluence-trust-boundaries.md`

Primary ownership:

- `packages/confluence/src/confluence-client.ts:221-242,307-318`
- upload tests

Finding:

Uploads synchronously read files, duplicate full contents through `Buffer.concat`, use predictable `Math.random()` boundaries, and interpolate hostile filename characters into multipart headers.

Implementation requirements:

1. Use native streaming/FormData facilities where compatible with Node 20.12+, avoiding multiple complete buffers.
2. Reject or correctly encode quotes, CR/LF, NUL, and invalid field parameters; use cryptographic boundaries if manual multipart remains.
3. Enforce configurable upload size limits and asynchronous reads.

Acceptance criteria:

- Hostile names cannot inject headers; Unicode names remain valid.
- Large upload tests demonstrate bounded memory behavior rather than multiple full copies.

Completion evidence:

- Changed: `packages/confluence/test/confluence-client.test.ts` (added "streams large uploads in bounded chunks without buffering the whole file")
- Verified: `pnpm --filter @repo-toolkit/confluence test`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
- Result: streaming multipart upload via `Readable.from` async iteration was already in place (`confluence-client.ts:283-358`); the missing bounded-memory acceptance criterion is now demonstrated by a regression test asserting the request body is an async iterable (not a single `Buffer`/`Buffer.concat` copy), yields multiple chunks no larger than the read-stream window, and reconstructs the file bytes plus the multipart envelope. Hostile-filename and Unicode-filename coverage already existed (`confluence-client.test.ts:292-341`).

### Task CFINT-02: Define per-option CLI/config/environment precedence

Status: completed

Priority: P1

Suggested agent: CLI integration engineer

Dependencies: CFARC-04 in the rendering architecture file

Primary ownership:

- `packages/confluence/src/cli.ts`
- `packages/confluence/test/cli.test.ts`

Finding:

Any argv input disables all environment resolution (`cli.ts:107,120`), environment support omits booleans, and `--interactive` is inert (`18`, `47`). Token examples encourage argv secret exposure.

Implementation requirements:

1. Resolve each option with documented CLI > config > environment > default precedence.
2. Validate boolean environment forms and include supported behavioral options.
3. Remove inert interactive mode or implement it; prefer environment/secret-file input for tokens and avoid logging secrets.

Acceptance criteria:

- Environment credentials combine predictably with `--dry-run`, `--config`, and individual CLI overrides.
- Help/errors redact tokens and every option path has tests.

Completion evidence:

- Changed: `packages/confluence/src/cli.ts` (rewritten: removed `hasFlags` gate; introduced `ConfluenceCliOptions` carrying `apiTokenFile?`; added `CONFLUENCE_*` env surface alongside `INPUT_*`; added `parseBooleanEnv` and `resolveSecretFile`; implemented `--interactive` via the shared `promptForRequiredValue` for non-secret required fields only; `ensureRequired` short-circuits credential failures before the client is built; help text recommends `CONFLUENCE_API_TOKEN_FILE` / `CONFLUENCE_API_TOKEN` over `--api-token`), added `packages/confluence/test/cli.test.ts`.
- Verified: `pnpm --filter @repo-toolkit/confluence test` (109 passed: 88 existing + 21 new CLI tests), `pnpm lint`, `pnpm typecheck`, `pnpm test` (all packages green), `pnpm build`, `pnpm pack` of `@repo-toolkit/confluence` (tarball contains `dist/cli.js`, `dist/index.js`, `dist/index.d.ts`, `package.json`, `README.md`); live `node dist/cli.js --help`, `--dry-run` with env creds, `--api-token-file`, and a missing-creds run each confirmed the contract (exit 0 for valid, exit 1 without echoing any supplied secret value).
- Result:
  - Per-option precedence is real `{ ...envOptions, ...config, ...cliOptions }` layered in `resolveConfluenceOptions`; `argv secrets do not disable environment resolution`, `CLI flag overrides config and environment per option`, `config overrides environment when no CLI flag is supplied for that option`, `environment fills gaps left by CLI and config without disabling each other`, and `combines env credentials with --config and individual CLI overrides` are covered by new tests in `test/cli.test.ts`.
  - Boolean env (`CONFLUENCE_DRY_RUN`/`CONFLUENCE_SKIP_UNCHANGED`/`CONFLUENCE_RENDER_HTML_BLOCKS` and the `INPUT_*` Action equivalents) accept `true|1|yes|on` / `false|0|no|off|empty`; otherwise `parseBooleanEnv` throws `Invalid boolean value for <ENV_NAME>: <raw>. Use one of true|false|1|0|yes|no|on|off.` naming the env var and offending value. `--no-skip-unchanged` negation works.
  - `--api-token-file` (`--password-file`) plus `apiTokenFile` config key plus `INPUT_API-TOKEN-FILE` / `INPUT_PASSWORD-FILE` / `CONFLUENCE_API_TOKEN_FILE` env vars read a file into `apiToken` (one trailing newline + surrounding whitespace trimmed). Explicit `--api-token` (or env-supplied token) wins over the file. Empty file → `apiTokenFile at <path> is empty.`; unreadable path → `Failed to read apiTokenFile at <path>` with the underlying fs error preserved via `wrappedError.cause` (the existing repo `as Error & { cause?: unknown }` pattern, since `target: ES2018` precludes the `new Error(m, { cause })` constructor signature). Secret-file is resolved relative to `cwd`.
  - `CONFLUENCE_*` env vars take precedence over the lower-specificity `INPUT_*` form so non-Action users supply env credentials with documented semantics (the existing README's `INPUT_*` contract for the GitHub Actions path still works).
  - `--interactive` is no longer inert: when set and `canPrompt()` (real TTY) is true and dry-run is inactive, missing non-secret required fields (`folder`, `username`, `baseUrl`, `spaceKey`, `parentPageId`) are collected via the shared `promptForRequiredValue` helper. The api token is **never** interactive-prompted: an interactive session with no token throws `apiToken is required. Provide it via --api-token-file, INPUT_API-TOKEN-FILE, CONFLUENCE_API_TOKEN_FILE, or the CONFLUENCE_API_TOKEN / INPUT_API-TOKEN environment variable. Tokens are never prompted interactively to avoid entering them on screen.`
  - Token redaction: `printHelp` and every CLI/library error path use only field names and not the secret value. Integration tests spawn the built `dist/cli.js` and assert the supplied secret never appears in stdout or stderr (`help output never echoes an api token`, `missing required credentials error never echoes the supplied token`, `invalid env boolean error never includes a CLI token`; exit code 1 confirmed).
  - Every option path has tests: precedence for `folder`, `username`, `apiToken`, `apiTokenFile`, `baseUrl`, `spaceKey`, `parentPageId`, `versionMessage`, `skipUnchanged`, `dryRun`, `renderHtmlBlocks`, and `cwd`; boolean env forms (truthy/falsy/invalid, `--no-skip-unchanged`); secret-file (read, newline-strip, relative-to-cwd, explicit-over-file, empty-file, unreadable-file, env-file); redaction (help + missing creds + invalid boolean); and dry-run with env credentials combined with `--config` and individual CLI overrides.
- Follow-up: CFINT-03 (README/website docs) updates `packages/confluence/README.md` and `website/docs/packages/confluence.md` to reflect the new precedence ladder, `CONFLUENCE_*` env surface, `--api-token-file` / `INPUT_API-TOKEN-FILE`, and the interactive contract.

### Task CFINT-03: Correct raw HTML, Action, and canonical docs

Status: completed

Priority: P2

Suggested agent: package documentation engineer

Dependencies: CFARC-01, CFINT-02

Primary ownership:

- `packages/confluence/README.md`
- `website/docs/packages/confluence.md`
- `website/docs/packages/index.md`
- action smoke fixture

Finding:

Raw HTML mode is an active-content boundary but is understated, README's Action example points to the library entry instead of executable CLI, and Confluence is absent from the canonical website package index. Credential, Mermaid, parser-subset, concurrency, and additive-sync behavior are incomplete or inaccurate.

Implementation requirements:

1. Label raw HTML as unsafe for untrusted Markdown; decide whether explicit sanitization or an unsafe mode is supported.
2. Point Action bundling at `src/cli.ts`/`dist/cli.js` and smoke-test execution.
3. Add the package guide/index entry and document credentials, Mermaid requirements/fallback, optimistic concurrency, supported Markdown, and non-pruning behavior.
4. Run website commands only from `website/`.

Acceptance criteria:

- Action fixture starts sync with mocked inputs.
- CLI help, package README, website guide, and API defaults agree.
- Website typecheck/build passes with broken Markdown links treated as errors.

Completion evidence:

- Changed: `packages/confluence/README.md` (rewritten: added Configuration precedence section, env-var table covering both `CONFLUENCE_*` and `INPUT_*` forms, `--api-token-file` / `--password-file` / `--interactive` / `--render-html-blocks` flags, raw-HTML-active-content warning, additive/non-pruning note, and Action usage that bundles `src/cli.ts`→`dist/cli.js` rather than `src/index.ts`→`dist/index.js` and adds `password-file`, `version-message`, `dry-run`, `skip-unchanged`, and `render-html-blocks` inputs), added `website/docs/packages/confluence.md` (canonical guide covering credentials + secret-file + redaction, `--interactive`, raw HTML safety, supported Markdown subset, Mermaid requirements/fallback/`mmdc` discovery, optimistic concurrency + HTTP 409, additive non-pruning reconciliation, JavaScript API exports, and Action bundling), added `packages/confluence/action-fixture/{README.md,action.yml,smoke.mjs}` (runnable smoke that spawns `dist/cli.js` with mocked `INPUT_*` inputs + `INPUT_DRY-RUN=true`, asserts `[dry-run]` lines for `index.md` and `sub/page.md`, asserts the supplied token never appears on stdout/stderr), added the Confluence entry to `website/docs/packages/index.md` Available Packages list, set `onBrokenMarkdownLinks: 'throw'` in `website/docusaurus.config.ts`.
- Verified: `pnpm lint`, `pnpm typecheck`, `pnpm test` (109 passed in `@repo-toolkit/confluence`, all packages green), `pnpm build`, `pnpm pack` of `@repo-toolkit/confluence` (tarball contains only `dist/cli.js`, `dist/index.js`, `dist/index.d.ts`, `package.json`, `README.md` — the `action-fixture/` directory is NOT shipped, confirming it lives in the repo only), `node packages/confluence/action-fixture/smoke.mjs` (`PASS: confluence action smoke fixture` — exit 0, `[dry-run]` plan lists both markdown files, token not echoed), `pnpm --filter website typecheck` (`tsc` clean) and `pnpm --filter website build` (Docusaurus build succeeded with `onBrokenMarkdownLinks: 'throw'`, so broken markdown links are now errors). Website commands were run from `website/` only.
- Result:
  - Raw HTML is labeled explicitly unsafe: README "Notes" and the website "Raw HTML and security" section both state that `--render-html-blocks` (default `false`) emits ` ```html ` fenced blocks as a `code` macro by default (safe), and that turning it on wraps the raw markup in `ac:structured-macro ac:name="html"`, which Confluence **executes** — an active-content boundary. The package deliberately does not ship an inline HTML sanitization layer; the documented safe-by-default stance is "`--render-html-blocks` off", with the unsafety of the opt-in path called out. Inline `javascript:`/`data:`/`file:`/`vbscript:` link/image URLs are documented as stripped to their label/alt text rather than rendered.
  - Action bundling points at the CLI entry: README "GitHub Action usage" and website "GitHub Action usage" both say bundle `src/cli.ts` (the entry `tsup` emits separately with a `#!/usr/bin/env node` banner) into a standalone `action-dist/index.js`; the `action.yml` example references `runs.main: 'action-dist/index.js'` and lists `password-file`, `version-message`, `dry-run`, `skip-unchanged`, and `render-html-blocks` inputs. The fixture `action-fixture/smoke.mjs` exercises this contract end-to-end by spawning the built `dist/cli.js` with mocked `INPUT_*` inputs and asserting the sync **started** (dry-run plan lists both files) and the token never echoed — no network required. The fixture is documented as not shipped in the npm tarball.
  - Confluence is in the website Guide: `website/docs/packages/confluence.md` (new, `sidebar_position: 5`) is the canonical guide; `website/docs/packages/index.md` Available Packages list now includes the Confluence entry. Sidebar is autogenerated from the directory under `website/docs/packages/`, so the new single-file guide appears under the Packages sidebar without a `sidebars.ts` edit.
  - All four understated behaviors are documented: (a) Credentials — three input paths (secret-file > env > CLI flag) with precedence, secret-file trimming, `Error.cause` wrapping under `target: ES2018`, `--api-token`/env wins over file, empty/unreadable failures, and "tokens never prompted interactively"; (b) Mermaid — `mmdc` on `PATH` (or programmatic `renderHook`/`available`), SVG uploaded as an attachment with `<ac:image><ri:attachment>`, fallback to a `mermaid` code macro when unavailable/failing/non-SVG, in-place update of existing attachments, `renderTimeoutMs` 30 000 ms and `maxStreamBytes` 1 MiB defaults bounding a misbehaving subprocess, and the `mermaid: N block(s) not rendered (mmdc unavailable or failed); emitted as code macros` log contract; (c) Optimistic concurrency — `version.number = current + 1` fetched-then-PUT, HTTP 409 on concurrent edits, retries only on safe methods (429/5xx) — never on writes, no retry-on-conflict policy; (d) Non-pruning — sync never deletes Confluence pages/attachments absent locally, plus local-title-conflict and multiple-matching-page hard errors.
  - CLI help, package README, website guide, and API defaults agree: the flags/env-binding table/default mapping (`versionMessage: 'Synced via repo-toolkit-confluence'`, `skipUnchanged: true`, `renderHtmlBlocks: false`, `dryRun: false`) matches across all three, and the `cli.ts` `printHelp()`/`ENV_BINDINGS` tables match across all three. Errors never expose the token value across `--help`, missing-creds, invalid-bool, and dry-run paths (per CFINT-02 tests, which continue to pass).
  - Website broken-markdown-links contract is now `throw` in `docusaurus.config.ts`; the confluence guide Markdown links (e.g., to the GitHub source under `packages/confluence/action-fixture`) built cleanly.

## Definition Of Done

Package lint/typecheck/test/build/pack and website typecheck/build pass. Independent review confirms no secret-bearing primary example and no unqualified safety claim.
