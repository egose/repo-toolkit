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

Status: completed

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

Completion evidence:

- Changed: `packages/confluence/test/confluence-client.test.ts` (added `makeStreamingResponse` helper that returns a `Response` whose `body` is a real `ReadableStream` async iterator; added `truncates oversized streaming response bodies surfaced in errors`, `accumulates getAttachments across pagination exactly once and terminates`, and `rejects a getAttachments next-link cycle before the page cap is hit`).
- Verified: `pnpm --filter @repo-toolkit/confluence test` (201 passed), `pnpm lint`, `pnpm typecheck`, `pnpm test` (all packages green).
- Result: implementation already landed under a prior session at HEAD (`confluence-client.ts:367-464` — `requestJson` with `makeTimeoutSignal` using `AbortSignal.timeout(ms)` for abort timeouts, `readBodyBounded` capping bodies at `MAX_ERROR_BODY_LENGTH = 8_192` with a streaming branch that appends `...` on truncation and a `response.text()` fallback branch with the same bound; `getPagesByTitle`/`getAttachments` both maintain a `visited` Set and throw `ConfluencePagination loop detected` plus a `MAX_PAGES_PER_QUERY = 100` cap; `resolveNextUrl` rejects malformed and cross-origin next links via `baseUrlOrigin` comparison; `requestJson` retries only `SAFE_METHODS` (`GET/HEAD/OPTIONS`) on `shouldRetryStatus` (429/5xx) with `Retry-After`-aware `sleepBackoff` parsing both numeric-seconds and HTTP-date forms, and writes use `maxRetries = 0`). The three new regression tests close the gaps against the stated acceptance criteria: the streaming-body truncation test exercises the previously-untested async-iterator branch of `readBodyBounded`; the `getAttachments` accumulation test asserts exactly-once multipage merge (3 ids, 2 calls); and the `getAttachments` cycle test asserts the visited-set rejects a next-link cycle in `callCount < 5` calls — well below the page cap — proving loop detection is independent of the cap. Pre-existing tests cover hanging-request abort (`aborts a hanging request after the configured timeout`), `Retry-After`-honoring safe-method retries (`retries 429 responses on safe GETs honoring Retry-After, then succeeds`), no-write-retries (`does not retry writes (POST)`), cross-origin next-link rejection (`rejects cross-origin pagination next links`), and pages-path loop/cap (`caps pagination and rejects a next-link loop`).

### Task CFSEC-05: Bound Mermaid execution and preserve upload failures

Status: completed

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

Completion evidence:

- Changed: `packages/confluence/src/mermaid.ts` (removed the NO-OP `try/catch` around the `client.uploadAttachment`/`updateAttachmentData` calls — both branches rethrew the same `cause` so the catch was dead code; uploads now propagate their original `ConfluenceUploadError`/`ConfluenceApiError` instances unmodified, matching the boundary in `attachments.ts:174-176`. Dropped the now-unused `ConfluenceUploadError` import. The pre-existing bounds stay in place: `runMmdc` spawns `cmdPath` (configured `mmdcPath` or `mmdc`) with `shell: false`, `stdio: ['pipe','pipe','pipe']` (no inherited fd leak), stdin-only `mmd` input, a single `setTimeout(timeoutMs)` that SIGTERMs the child and SIGKILLs two seconds later, and per-stream byte counters that SIGKILL when `stdoutLen` or `stderrLen` crosses `maxStreamBytes`; the rendered file is validated via nonempty `SVG_START_RE`/`SVG_END_RE`; and `rewriteMermaidBlocks` wraps each block in a per-iteration `mkdtemp`/`finally rm(workDir, { recursive: true, force: true })` so cleanup runs after success, render failure, timeout, overflow, and upload-error propagation).
- Changed: `packages/confluence/test/mermaid.test.ts` (new `CFSEC-05` suite — writes a real per-test `TMPDIR`, generates a fake `mmdc` Node script with a `#!/usr/bin/env node` shebang under that dir, and drives the real `defaultRenderHook`/`runMmdc` subprocess path end-to-end via `available: true` + `mmdcPath = scriptPath`.
  - `spawns the configured binary verbatim with no shell mediation and validates a regular SVG` — the fake script logs `process.argv` to a sidecar JSON file: it asserts `/bin/sh` and `-c` never appear and that the args `['-i','-','-o',<diagram.svg>,'-t','default','-b','transparent']` were passed exactly, proving `shell:false` and that the configured path is honored verbatim; the rendered SVG is then validated and uploaded.
  - `aborts a hanging renderer after the timeout and cleans up` — the script never resolves; with `renderTimeoutMs: 300` the test resolves in under 5s and falls back to a code macro, and the per-iteration work dir is gone afterward.
  - `kills a renderer that overflows stdout past the byte bound and falls back` and `kills a renderer that overflows stderr past the byte bound and falls back` — `maxStreamBytes: 1024` against a 64 KiB burst proves both streams have independent bounds and the on-overflow SIGKILL path lands in fallback, not a hang.
  - `falls back when the renderer exits non-zero`, `falls back when the rendered output is not a valid SVG`, `reuses the existing attachment when content hash matches and skips rendering` — round out the renderer-side contract (the reuse test points `mmdcPath` at a script that would `exit(99)` and asserts it never runs because the content-hash short-circuit precedes the spawn).
  - `propagates a ConfluenceUploadError from upload and does not fall back` — a `client.uploadAttachment` throw of `new ConfluenceUploadError('Forbidden', 403, '/attachments', 'forbidden')` is rejected verbatim by `rewriteMermaidBlocks` (instance equality), proving 401/403/429/5xx upload failures abort the sync with a distinct error instead of degrading to a code macro.
  - `leftoverWorkDirs()` after every case asserts no `rt-mermaid-*` work dirs survive in `TMPDIR`, satisfying the "cleanup after success, failure, and timeout" criterion.)
- Verified: `pnpm --filter @repo-toolkit/confluence test` (209 passed, up from 201 — the new suite adds 8 tests; pre-existing mermaid tests unchanged), `pnpm lint` (clean), `pnpm typecheck` (clean), `pnpm test` (all packages green: changelog 80, publish-packages 15, release-artifact 33, confluence 209).
- Residual risk (investigation, requirement 4): `runMmdc` does not itself impose sandbox, network-egress, or filesystem-confine the `mmdc` subprocess — the toolkit treats Mermaid input as trusted (authored by the same operator who runs `repo-toolkit-confluence`). When the CLI is driven from a CI job that processes untrusted/PR-supplied Mermaid (e.g., a `pull_request_target` workflow), the job runner must apply its own network egress allow-list, reduced-filesystem permissions, and a confining sandbox (container/seccomp/chroot) for the `mmdc` render subprocess. The bounds in this task prevent a hanging, noisy, or invalid `mmdc` from blocking sync or exhausting memory within `@repo-toolkit/confluence`; they do not prevent a fully malicious `mmdc` from acting as its operator/user — that remains an operator responsibility.

## Verification And Done

Run package tests after each task, then root lint/typecheck/test. Completion requires adversarial path/URL/pagination/process tests and an independent review of credential, filesystem, and wrong-page mutation boundaries.
