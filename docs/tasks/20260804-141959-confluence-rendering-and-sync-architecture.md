# Confluence Rendering And Sync Architecture

Created: 2026-08-04 14:19:59

## Objective

Make rendering correct and XML-safe, avoid unnecessary remote mutations, and introduce narrow testable boundaries without broad framework changes.

### Task CFARC-01: Replace regex-over-generated-markup inline rendering

Status: pending

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

### Task CFARC-02: Make attachment naming and unchanged sync content-addressed

Status: pending

Priority: P1

Suggested agent: synchronization performance engineer

Dependencies: CFSEC-02 and CFSEC-05 in the trust-boundary file

Primary ownership:

- `packages/confluence/src/index.ts:196-218`
- `packages/confluence/src/attachments.ts`
- `packages/confluence/src/mermaid.ts`

Finding:

`skipUnchanged` checks only after every attachment render/upload. Local images collide by basename, and Mermaid names depend on ordinal position, causing noisy updates and accidental replacement.

Implementation requirements:

1. Derive stable unique names/hashes from normalized source/content.
2. Compare deterministic source hashes before renderer or upload work.
3. Preserve current content when unchanged and clearly scope what the option guarantees.

Acceptance criteria:

- A second identical sync performs no page update, attachment mutation, or Mermaid spawn.
- Same-basename files remain distinct; inserting an earlier diagram does not rename unchanged diagrams.

### Task CFARC-03: Validate locally before remote mutation

Status: pending

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
