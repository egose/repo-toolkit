# Confluence CLI Multipart And Documentation

Created: 2026-08-04 14:19:59

## Objective

Finish Confluence transport hardening and make CLI/environment/action documentation accurately represent executable behavior.

### Task CFINT-01: Stream and sanitize multipart uploads

Status: pending

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

### Task CFINT-02: Define per-option CLI/config/environment precedence

Status: pending

Priority: P1

Suggested agent: CLI integration engineer

Dependencies: CFARC-04 in the rendering architecture file

Primary ownership:

- `packages/confluence/src/cli.ts`
- CLI tests

Finding:

Any argv input disables all environment resolution (`cli.ts:107,120`), environment support omits booleans, and `--interactive` is inert (`18`, `47`). Token examples encourage argv secret exposure.

Implementation requirements:

1. Resolve each option with documented CLI > config > environment > default precedence.
2. Validate boolean environment forms and include supported behavioral options.
3. Remove inert interactive mode or implement it; prefer environment/secret-file input for tokens and avoid logging secrets.

Acceptance criteria:

- Environment credentials combine predictably with `--dry-run`, `--config`, and individual CLI overrides.
- Help/errors redact tokens and every option path has tests.

### Task CFINT-03: Correct raw HTML, Action, and canonical docs

Status: pending

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

## Definition Of Done

Package lint/typecheck/test/build/pack and website typecheck/build pass. Independent review confirms no secret-bearing primary example and no unqualified safety claim.
