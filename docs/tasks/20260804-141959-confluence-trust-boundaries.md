# Confluence Trust Boundaries

Created: 2026-08-04 14:19:59

## Objective

Prevent synchronization from mutating the wrong page, exfiltrating local files, leaking credentials, or hanging on unbounded network/subprocess work.

### Task CFSEC-01: Make page identity parent-aware

Status: completed

Priority: P0

Suggested agent: Confluence API correctness engineer

Dependencies: none

Primary ownership:

- `packages/confluence/src/index.ts:253-271`
- `packages/confluence/src/confluence-client.ts:127-137`
- focused hierarchy tests

Finding:

Page lookup requests the first space-wide title match and caches it under the requested parent without checking `parentId`. Duplicate titles in separate hierarchies can update the wrong page.

Implementation requirements:

1. Enumerate exact-title candidates with pagination and select by parent ID.
2. Create only when no candidate exists under that parent; reject ambiguous same-parent duplicates.
3. Detect local directory/document title collisions before API mutations.

Acceptance criteria:

- Same titles under parents A and B select the requested hierarchy.
- An elsewhere-only title creates a new child.
- Ambiguous and local `foo.md`/`foo/` cases fail before mutation.

Completion evidence:

- Changed: `packages/confluence/src/index.ts`, `packages/confluence/src/confluence-client.ts`, `packages/confluence/test/index.test.ts`, `packages/confluence/test/confluence-client.test.ts`
- Verified: `pnpm --filter @repo-toolkit/confluence test`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
- Result: title lookups now enumerate exact matches, select by parent, reject same-parent ambiguity, and validate local title collisions before any API mutation.

### Task CFSEC-02: Confine local attachment reads

Status: completed

Priority: P0

Suggested agent: filesystem security engineer

Dependencies: none

Primary ownership:

- `packages/confluence/src/attachments.ts`
- attachment tests

Finding:

Image references accept absolute paths, `../` escapes, and symlinks outside the documentation root (`attachments.ts:54-68,89-97`), allowing arbitrary readable files to be uploaded.

Implementation requirements:

1. Pass an explicit allowed root, realpath every source, and require containment plus a regular file.
2. Reject absolute paths and define missing/unreadable image behavior; never leave internal placeholder markup in successful output.
3. Add configurable individual and aggregate input limits.

Acceptance criteria:

- Absolute, traversal, escaping symlink, directory, socket, missing, and oversized sources fail before page update/upload.
- Normal nested files remain supported and repeated references upload once.

Completion evidence:

- Changed: `packages/confluence/src/attachments.ts`, `packages/confluence/src/index.ts`, `packages/confluence/test/index.test.ts`
- Verified: `pnpm --filter @repo-toolkit/confluence test`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
- Result: attachment uploads are now confined to the documentation root, invalid local sources fail before page updates, and repeated references are still deduplicated.

### Task CFSEC-03: Validate endpoint and redirect credential boundaries

Status: completed

Priority: P0

Suggested agent: HTTP security engineer

Dependencies: none

Primary ownership:

- `packages/confluence/src/confluence-client.ts:257-341`
- client tests

Finding:

Base URLs are string-normalized rather than parsed, permitting plaintext HTTP, userinfo, query/fragment, and unclear paths while Basic credentials are attached to requests. Redirect behavior is not constrained.

Implementation requirements:

1. Parse with `URL`, require HTTPS by default, reject userinfo/query/fragment, and normalize supported base paths.
2. Reject redirects or prove credentials are never forwarded cross-origin.
3. Bound/redact response bodies retained in errors.

Acceptance criteria:

- Invalid schemes, credential-bearing URLs, query/fragment, malformed URLs, and cross-origin redirects fail safely.
- Valid HTTPS trailing-slash forms normalize consistently.

Completion evidence:

- Changed: `packages/confluence/src/confluence-client.ts`, `packages/confluence/test/confluence-client.test.ts`
- Verified: `pnpm --filter @repo-toolkit/confluence test`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
- Result: base URLs now use strict `URL` parsing, only HTTPS empty-path or `/wiki` forms are accepted, redirect responses are rejected, and retained error bodies are bounded.

### Task CFSEC-04: Bound network pagination and retries

Status: pending

Priority: P1

Suggested agent: resilient HTTP client engineer

Dependencies: CFSEC-03

Primary ownership:

- `packages/confluence/src/confluence-client.ts:187-197,267-283`
- client tests

Finding:

Fetch has no timeout/cancellation or body bound. Attachment pagination treats `_links.next` as a cursor token, can malformedly re-encode links, and has no loop/page guard.

Implementation requirements:

1. Add configurable abort timeouts and bounded response/error reading.
2. Follow only validated same-origin next links or extract their cursor correctly; track visited pages and cap pagination.
3. Add limited `Retry-After`-aware retries for safe requests; define write retry policy explicitly.

Acceptance criteria:

- Hanging requests abort, oversized bodies truncate/fail, repeated/cross-origin next links reject, and multipage results accumulate exactly once.
- Retry count and safe/unsafe method behavior are deterministic in fake-fetch tests.

### Task CFSEC-05: Bound Mermaid execution and preserve upload failures

Status: pending

Priority: P1

Suggested agent: subprocess security engineer

Dependencies: none

Primary ownership:

- `packages/confluence/src/mermaid.ts`
- Mermaid tests

Finding:

Configured `mmdcPath` is probed but literal `mmdc` is spawned (`61`, `125-150`). Processes have no timeout, stream/output limits, or SVG validation. A broad catch downgrades API upload failures to renderer fallback (`72-94`).

Implementation requirements:

1. Spawn the exact configured binary without shell mediation.
2. Ignore/bound output, enforce timeout/input/output limits, terminate robustly, validate a regular nonempty SVG, and clean temporary state.
3. Catch renderer failures separately and propagate Confluence upload/auth/rate-limit errors.
4. Investigate sandbox/network/file restrictions for untrusted Mermaid input and document residual risk.

Acceptance criteria:

- Custom paths execute; hanging/noisy/invalid renderers cannot hang or exhaust memory.
- Renderer failure falls back, while upload 401/403/429/5xx rejects sync with a distinct error.
- Cleanup succeeds after success, failure, and timeout.

## Verification And Done

Run package tests after each task, then root lint/typecheck/test. Completion requires adversarial path/URL/pagination/process tests and an independent review of credential, filesystem, and wrong-page mutation boundaries.
