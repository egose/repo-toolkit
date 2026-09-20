# Secret Sync Package: Design And Implementation Tasks

Created: 2026-09-20 10:00:15 (local timestamp)

Status: complete; all SECSYNC-01–10 implementation tasks are complete (SECSYNC-10 notes live-vault V6 as blocked — no credentials — with synthetic plus loopback fake-Connect evidence recorded).

## Objective And Scope

Build `@repo-toolkit/secret-sync`, with one `repo-toolkit-secret-sync` executable, to synchronize explicitly selected local files with 1Password. Provide Git-like status, push, pull, file history, single-file rollback, and independent named branches. Preserve exact bytes, including binary data and line endings.

This document records the product decisions and executable backlog requested for the rough package idea. It is the implementation contract; no package implementation accompanies this planning change.

Initial scope: small secret files such as `.env`, credentials JSON, certificates, and private keys; one project and vault per config; online remote operations; a public TypeScript API and a thin CLI. Non-goals: general-purpose backup, automatic secret rotation, dotenv key-level merging, Git hooks, automatic Git branch coupling, provisioning Connect infrastructure, and large-file storage.

## Analysis Coverage And Evidence

Inspected on 2026-09-20:

- `AGENTS.md`: package scaffolding, verification, ES2018, shared helpers, website separation.
- Root `package.json:19-41`: dependency-closure build scripts and serialized workspace tests.
- `packages/docker-publish/package.json`: published ESM/types/bin/files conventions.
- `packages/docker-publish/src/cli.ts:24-77`: shared flag tables and thin command boundary.
- `packages/publish-package/src/flags.ts:30-139` (`parseFlags`): flag-only parser; bare `--` is ignored, not a positional delimiter.
- `packages/publish-package/src/prompt.ts:14-45` (`resolveConfigPath`, `loadConfigFile`): JSON and module config loading.
- `packages/publish-package/src/index.ts`: public helpers and types.
- `packages/publish-packages/test/contract.test.ts`: root scripts, exports, unique bins, README and website membership requirements.
- Existing task filenames and a focused search for `1Password`/`secret-sync`: no overlapping secret-sync task found. `20260909-220018-docker-publish-package.md` supplies a relevant package-plan precedent.
- Root `pnpm-lock.yaml`: `picomatch@4.0.5` already exists transitively. It is not currently declared as a direct runtime dependency of the inspected package.
- `website/package.json`: separate installation and `build`/`typecheck` commands.

Primary external references, fetched during planning:

1. [Connect API reference](https://www.1password.dev/connect/api-reference/): item list/get/create/replace/patch/delete; concealed custom fields; Document creation unsupported; file endpoints expose reads; item `version` exists, but no general historical item-retrieval endpoint is documented. PATCH documents `add`, `remove`, `replace`, not a conditional `test` operation.
2. [Connect concepts](https://www.1password.dev/connect/concepts/): deployed API and sync containers; encrypted local copy; `OP_CONNECT_HOST` and `OP_CONNECT_TOKEN`.
3. [Connect security](https://www.1password.dev/connect/security/): vault-scoped read/write access tokens.
4. [SDK overview](https://www.1password.dev/sdks/): service-account and desktop-app authentication, direct SDK integration.
5. [SDK files](https://www.1password.dev/sdks/files/): SDK supports attachment and Document writes; currently documents a 50 MB message-size ceiling. This is an SDK limit, not a Connect concealed-field limit.

Limitations: documentation review only; no authenticated Connect requests, field-size experiments, multi-server consistency tests, SDK runtime tests, or implementation baseline tests were run. Do not infer conditional-write guarantees from an item's `version` field. No reviewed contract establishes globally consistent listings or transactional multi-item writes. SECSYNC-01 must validate the proposed encoding and capacity against an actual deployment before freezing storage format v1.

Verification actually run: initial `git status --short` was clean. After document creation, `git diff --no-index --check /dev/null docs/tasks/20260920-100015-secret-sync-package.md` passed, and status showed only this new document. Task dependencies and required fields were reviewed. Lint, typecheck, build, and tests were not run for this planning-only Markdown change.

## Product And Architecture Decisions

### 1. Backend And Authentication

- Implement **1Password Connect REST first**, using Node's fetch API through an injected transport. This directly satisfies the endpoint-based workflow without requiring a new 1Password runtime dependency.
- A deployed Connect server is required. Read the endpoint from `OP_CONNECT_HOST` and token from `OP_CONNECT_TOKEN` by default; config may name alternative environment variables. A service-account token is not a Connect token.
- Configure a vault ID, not a title. Pin the remote identity to endpoint + vault ID + project ID in local state; changing that identity requires explicit reinitialization, not silently reusing a baseline.
- Allow HTTPS and HTTP loopback for local Connect use. Reject URL credentials, fragments, and redirects; never send authorization to a redirected origin. Support custom trust through the host Node runtime rather than disabling TLS verification.
- Keep a small `SecretStore` boundary for list/get/create immutable records. Initial sync does not need remote update/delete methods. A future SDK adapter can implement this contract with different physical encoding.
- Use read-only Connect access for status/pull/log; push, rollback, branch creation, and conflict resolution additionally need write access. `doctor` reports observable connectivity/read capability; it must not claim write access was tested without a write probe.

### 2. Configuration And File Selection

Default config: `secret-sync.config.json`; support explicit `.json`, `.mjs`, `.cjs` via `loadConfigFile`. Module configs execute as trusted project code. Resolve the config from invocation cwd, then resolve `root` relative to the config directory. Do not search parent directories implicitly.

```json
{
  "schemaVersion": 1,
  "projectId": "a64208df-4a95-4516-b8c7-e00621a7820c",
  "root": ".",
  "remote": {
    "type": "onepassword-connect",
    "vaultId": "<1password-vault-id>",
    "hostEnv": "OP_CONNECT_HOST",
    "tokenEnv": "OP_CONNECT_TOKEN"
  },
  "branch": "main",
  "files": [".env", ".env.*", "apps/**/.env*", "secrets/**/*.{json,pem,key}"],
  "ignore": ["**/.env.example", "**/.env.sample", "**/node_modules/**", "**/dist/**"],
  "limits": {
    "maxFileBytes": 32768,
    "maxFiles": 100,
    "concurrency": 4
  }
}
```

- The ESLint-like syntax is **glob matching**, not arbitrary JavaScript regular expressions. Use `picomatch` directly, declaring the already-present dependency explicitly; avoid a bespoke glob-to-regex translator. Support `*`, `**`, `?`, character classes, and braces, with dotfiles enabled and case-sensitive matching.
- `files` is an inclusion union; `ignore` always wins. Reject leading `!` patterns with an instruction to use `ignore`, avoiding ambiguous re-inclusion ordering. Reject raw RegExp objects and regex-looking configuration objects in v1.
- Use slash-normalized project-relative paths. Apply the same matcher to local paths, tracked baseline paths, and remote tree paths: a fresh clone must discover remote files even when local glob expansion finds nothing.
- Do not implicitly honor `.gitignore`: secret files are often intentionally Git-ignored. Always exclude `.git/**`, `.repo-toolkit-secret-sync/**`, and the active config file, regardless of user globs.
- Reject absolute paths, traversal, symlinks, special files, unsafe platform names, and destination case/normalization collisions. Never escape the configured root. Treat the local filesystem as subject to change between planning and execution.
- `--file` selects an exact path inside the config's allowed set, is repeatable without comma splitting, and never overrides excludes. Changing selection rules does not delete remote files or silently reset old baseline entries.
- Proposed v1 ceilings: 32 KiB per file, 100 selected files, 64 KiB serialized remote record, 10,000 project records per scan, 16 MiB list response, 256 KiB detail response, 30-second request timeout, three bounded GET retries, concurrency default 4/max 8. These are tool bounds, not claimed 1Password limits. Config can lower the file/count bounds, not bypass hard ceilings. SECSYNC-01 may lower them with evidence before implementation.

### 3. Storage And History

Use append-only, tool-managed records inside the configured vault. Every record is a `SECURE_NOTE` item with a concealed `payload` field containing a versioned JSON envelope. Base64 file bytes inside that envelope preserve exact content; base64 is encoding, while 1Password supplies encryption at rest and HTTPS protects transport.

| Record | Payload                                                                                                                                                                        | Lifecycle                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Blob   | Schema version, project ID, random logical blob ID, byte length, SHA-256, base64 bytes                                                                                         | Created for a new file revision; reused when unchanged |
| Commit | Schema version, project ID, random logical commit ID, branch name, parent commit IDs, full sorted path-to-blob tree, timestamp, optional message, operation ID, operation kind | Created once, after its blobs are verified             |

Tree entries include the blob ID, expected digest, and byte length. Commit parents encode ancestry; commit metadata may record a restore source. Do not use timestamps or increasing integers to decide which commit wins. UUID revision/commit identifiers remain stable under concurrency; 1Password item versions are not the tool's revision numbers.

- Titles/tags contain only the tool marker, project ID, record kind, and opaque ID. Keep paths, hashes, messages, and bytes in the concealed payload. Item metadata remains visible to users who can access that vault; branches do not hide secrets from vault readers.
- Store logical IDs separately from provider item IDs. Provider-generated item IDs cannot be chosen to enforce uniqueness. Index listings by logical ID and validate the full envelope before accepting a match.
- Treat byte-identical duplicate records from ambiguous POST retries as one logical record; different payloads with the same logical ID are corruption. Persist an operation ID and intended record IDs before writes so a later command can reconcile an uncertain result.
- Reuse unchanged blobs across commits and branches in the same project/vault. Do not deduplicate by putting plaintext content hashes in item titles. A commit's full tree must fit the record bound; fail preflight without truncation or implicit chunking.
- Push creates blobs first and commit last. Unreferenced blobs from interrupted pushes are not visible file revisions. A commit with temporarily missing dependencies is `remote-incomplete`; retry boundedly and refuse to materialize a partial tree.
- Immutability is a tool rule, not WORM storage: a vault writer can manually edit/delete items. Validate schema, project, identity, dependency closure, lengths, and hashes. This detects many corruptions but is not a signature against an authorized writer who rewrites consistent data.
- Retain all history in v1. Deletion is a tombstone represented by absence in a new tree; historical blobs remain. Automatic pruning and physical deletion need a separate reachability/retention design and are deferred. Report record counts and capacity exhaustion without implying unlimited retention.

### 4. Branches And Concurrent Writers

Use named branches in the tool's commit graph, independently of Git branches. Default `main`; names match `[A-Za-z0-9][A-Za-z0-9._/-]{0,127}`, with empty, `.` and `..` slash segments rejected. Branch names are data, never local filesystem paths.

- A new branch is a commit with the source commit as parent and the same tree. Branch creation is metadata-only and copies no file bytes. An empty project's first branch commit has no parent and an empty tree.
- Derive a branch's heads from all valid commits belonging to that branch: a head has no descendant on the same branch. Creating a different branch must not remove the source branch's head.
- Do not maintain a mutable authoritative HEAD item. Read-then-write checks or a lock stored in a normal Connect item cannot supply an undocumented compare-and-swap guarantee.
- One observed head is usable. Multiple heads are `remote-diverged`: status/log list them; normal push/pull/rollback refuse. Preserve all commits rather than silently picking the newest timestamp.
- Before publishing, re-read the observed head set and require it to match the planned set. After publishing, re-list and report detected divergence. This narrows races but is not global serialization: delayed Connect synchronization can reveal another head later. A push success means its immutable commit was verified on the configured Connect endpoint, not that every server or 1Password.com has durably observed it.
- `resolve --head A --head B --take A` creates a new commit whose parents include every currently observed head and whose entire tree is the explicitly chosen head's tree. Recheck heads before publication. This deliberately simple v1 resolver preserves the unchosen history; it does not text-merge secrets. Users can subsequently restore selected files from the other commit.
- `switch` requires a clean selected worktree on the current branch and materializes the target branch through the guarded pull machinery. Persist the new active branch only after completion. Track the worktree's materialized branch separately from cached per-branch baselines; an old branch cache never proves the current worktree is clean.
- `--branch` can target read-only commands and metadata-only `branch create`. Worktree-mutating commands operate on the active branch; changing it requires `switch`. Branch precedence for read-only targeting is CLI, local active branch, config default.
- Production and development access separation requires separate vaults/configs/projects. Branches inside a vault are organizational, not authorization boundaries. Cross-vault promotion is deferred.

### 5. Local State And Sync Semantics

Store `.repo-toolkit-secret-sync/` under the root, Git-ignored. Use directory mode `0700` and state/temp/output file mode `0600` on POSIX; document and test the supported Windows filesystem behavior without equating POSIX modes with Windows ACLs.

State contains schema version, remote identity, active/materialized branch, per-file last acknowledged remote revision or absence, per-file comparison fingerprints, observed heads, and an operation journal. No file bodies, bearer tokens, or plaintext secret diff cache. Use a generated local HMAC key for persisted content fingerprints instead of exposed bare hashes; store that key with the protected state. This limits standalone fingerprint disclosure, not compromise of the entire state directory.

Compare three states for each selected path: **B** = last acknowledged baseline, **L** = local bytes/absence, **R** = remote bytes/absence. A baseline is per file because partial push/pull must not advance unrelated paths. Unknown baseline is distinct from acknowledged absence.

| Comparison                                | Status / behavior                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| L = R                                     | `clean`; an explicit successful sync may acknowledge this state        |
| L differs from B, R = B                   | `local-added`, `local-modified`, or `local-deleted`; push candidate    |
| R differs from B, L = B                   | `remote-added`, `remote-modified`, or `remote-deleted`; pull candidate |
| Both differ from B and L differs from R   | `conflict`; neither direction overwrites automatically                 |
| No baseline, local absent, remote present | `remote-added`; initial pull can create it                             |
| No baseline, remote absent, local present | `local-added`; initial push can create it                              |
| No baseline, both present but different   | `unbased-conflict`; user must explicitly choose a source               |

- `status` is read-only, including no baseline advancement. `--check` exits 1 for drift, conflicts, divergence, or incompleteness; ordinary successful status exits 0. All failed commands exit 1 with structured error codes to distinguish failure classes.
- Push preserves remote-only changes in the resulting full tree; pull preserves local-only changes. Any conflict among selected paths stops preflight before changing either side. No-op syncs create no commit. Selection-limited commands leave other files and baselines intact.
- Missing local tracked files are deletion candidates, not permission/read errors. Publish deletions only with `push --delete`; otherwise leave them pending and report them. Materialize remote tombstones only with `pull --delete`; otherwise report pending deletion and preserve the local baseline/file. Never delete untracked files.
- Do not provide a catch-all `--force`. Resolve a single worktree conflict through explicit `restore --file ... --revision ... --overwrite`, or restore the current remote revision with `--acknowledge-remote` before making a new local edit. The latter advances only that path's baseline to the observed current remote version after verifying the write. Historical restore never acknowledges the current remote implicitly.
- Scan and preflight first; retain the bytes being pushed in bounded memory and recheck file identity/content before publication. For pull, validate all destinations/content before changing files and recheck the destination immediately before replacement. Refuse unexpected concurrent local edits.
- Atomic replacement is per file, not a multi-file filesystem transaction. Journal each replacement and its baseline update durably so interruption can resume without treating completed writes as unrelated edits. A crash must not advance a baseline for bytes that were never written. Keep temporary plaintext only as needed for same-directory atomic replacement, with restricted permissions and deterministic recovery/cleanup.
- Hold an exclusive local state lock for mutating commands, with stale-lock recovery that does not break a live owner's lock. This coordinates local processes only; it is not a remote distributed lock.
- Offline cached status, an index/staging area, and automatic merge are deferred. A remote error must never become an empty remote tree or a deletion plan.

### 6. Commands And Public API

The command is the first non-wrapper token; all remaining arguments are flags. Strip only leading wrapper `--` tokens, extract a recognized command (and `branch` subcommand), then use `parseFlags` in strict mode. Do not change shared parser semantics or use unknown-argument collection to guess positional paths. Use exact paths through repeatable `--file`, including `--file=-leading-name`.

```sh
repo-toolkit-secret-sync init --config secret-sync.config.json --vault <vault-id>
repo-toolkit-secret-sync doctor
repo-toolkit-secret-sync status
repo-toolkit-secret-sync status --check --json
repo-toolkit-secret-sync push --dry-run
repo-toolkit-secret-sync push --file .env --message "Rotate development credentials"
repo-toolkit-secret-sync pull
repo-toolkit-secret-sync diff --file .env
repo-toolkit-secret-sync log --file .env --limit 20
repo-toolkit-secret-sync restore --file .env --revision <blob-id>
repo-toolkit-secret-sync rollback --file .env --revision <blob-id> --message "Revert rotation"
repo-toolkit-secret-sync branch list
repo-toolkit-secret-sync branch create --name feature/demo --from main
repo-toolkit-secret-sync switch --branch feature/demo
repo-toolkit-secret-sync resolve --head <commit-A> --head <commit-B> --take <commit-A>
```

| Command                        | Contract                                                                                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`                         | Generate project UUID/config and protected local state; idempotently add state-dir ignore entry when `.gitignore` is applicable; preserve existing config; remote initialization happens on first push                                               |
| `doctor`                       | Validate config, matching support, local permissions/state, endpoint/read access, and observed bounds; output metadata only                                                                                                                          |
| `status`                       | Three-way per-file status and branch/head summary                                                                                                                                                                                                    |
| `push` / `pull`                | Directional synchronization; exact-path selection, dry-run, explicit deletion propagation                                                                                                                                                            |
| `diff`                         | Metadata-only local/remote or revision comparison: path, changed/unchanged, lengths, IDs; no plaintext diff in v1                                                                                                                                    |
| `log`                          | Paginated display over bounded ancestry traversal; per-file history with commit IDs, blob revision IDs, messages and deletions; stable ordering with explicit fork relationships                                                                     |
| `restore`                      | Materialize one historical file locally; require revision reachable for that same path/project; `--overwrite` needed for divergent existing local bytes; local-only by default; optional current-remote acknowledgment as specified above            |
| `rollback`                     | Require the selected file clean at the current single head; create a new remote commit replacing only that file with its historical blob, then materialize locally; preserve every other tree entry; never reset the branch pointer or erase history |
| `branch list/create`, `switch` | Independent branches, metadata-only creation, guarded worktree switching                                                                                                                                                                             |
| `resolve`                      | Explicitly choose one full snapshot to join observed divergent heads without erasing either ancestry                                                                                                                                                 |

`rollback` requires a file revision, not a commit-wide reset. A deleted file can be restored from a historical blob. Rollback that equals the current file is a no-op. If remote publication succeeds but local materialization fails, report the published commit ID and pending local recovery; rerun must not publish a second rollback commit. `restore --from-branch <name> --file <path>` may select that branch's current revision for deliberate same-vault file promotion; resolve a single head and keep the active branch unchanged.

All mutating commands support `--dry-run` (reads permitted, no remote/local writes, including locks/state/temp files). All commands support `--config`, `--json`, and help. JSON output has a schema version and discriminated statuses/errors; errors and summaries never include authorization, raw remote response bodies, file bytes, or content fingerprints. Messages/paths are caller metadata and must be documented as visible in output; callers should not put secret values in commit messages. CLI errors set `process.exitCode = 1`.

Public API: exported `SecretSyncOptions`, validated `SecretSyncPlan`, injected `SecretStore`/transport interfaces, `resolveSecretSyncPlan(options = {})`, and `runSecretSync(options = {})` with a discriminated command and typed results. Public results are metadata-only; internal byte buffers never enter a serialized plan/result. Keep config validation, discovery, provider transport, record encoding, graph, planner, local writes, operations, and CLI formatting in focused modules.

## Execution Rules And Verification

Priority: **P1** = foundational behavior or correctness needed for v1; **P2** = usability/integration required before publishing. No P0 is assigned: this is a new feature plan, not an active production defect.

Update each task's status when starting it, and append changed paths, actual commands/results, and follow-ups on completion. Check `git status --short` first and preserve unrelated work. Do not commit without a request. Do not add code comments unless requested. No subagents are assigned by this plan.

Shared checks (repository root, after `pnpm install`):

- **V1:** `pnpm lint` and `pnpm typecheck` after every code change; `pnpm test` for changes touching `src/` or `test/`, per repository instructions.
- **V2:** once scaffolded, `pnpm --filter @repo-toolkit/secret-sync test`; script must build the package dependency closure before Vitest. Use injected transport, deterministic clock/IDs, and temp-directory fixtures. Ordinary tests require no credentials or network.
- **V3:** `pnpm --filter @repo-toolkit/publish-packages test` after metadata/docs membership changes.
- **V4:** final `pnpm build`, V1, V2, V3, plus packed ESM/type/bin consumer checks in a disposable directory. Verify release-artifact bin auto-discovery through the existing package tests. Never commit `dist/`.
- **V5:** website edits and its `pnpm install`, `pnpm typecheck`, `pnpm build` run from `website/` as a separate project, not from the workspace root.
- **V6:** opt-in real Connect contract exercise using synthetic files and a disposable, explicitly designated vault; record server version, payload bounds, visibility observations, and cleanup. Do not print credentials or secret content. This is required for storage-format feasibility/release compatibility claims; it is not part of ordinary unit tests.

Serialize tests that rebuild shared dependency outputs. Root `pnpm test` already sets workspace concurrency to 1. Scaffold and docs membership must land together because existing contract tests require a dedicated website package page immediately.

## Tasks

### Task SECSYNC-01: Validate Connect Storage Feasibility

Status: complete

Kind: investigation

Priority: P1 — prevent committing to an unsupported file encoding or consistency assumption.

Dependencies: none.

Primary ownership: this document's provider evidence/limits; a disposable external probe, followed by fixtures owned with SECSYNC-03.

Finding / references: Connect documents item creation and concealed fields, but not usable field-size limits, historical reads, or atomic conditional writes; see external references 1–3. SDK file writes exist (reference 5), so Connect restrictions must not be generalized to every 1Password integration.

Requirements:

1. Exercise synthetic empty, binary, multiline, and 32 KiB payloads in the proposed Secure Note envelope, plus the maximum serialized commit. Record actual request/response lengths, item schema, and round-trip byte equality.
2. Observe list filtering, immediate get/list visibility, read-only credential behavior, server outages, and resynchronization. Separate documented guarantees from empirical observations; do not infer CAS from one successful experiment.
3. Confirm create retry reconciliation can identify records without title uniqueness. Record exact supported minimum/tested Connect version and verified payload ceilings.
4. If the proposed ceiling fails, lower the tool bound with evidence. If concealed records are impractical, record a concrete SDK-backend design revision before storage implementation; do not silently add undocumented endpoints.

Acceptance criteria: recorded synthetic round trips and envelope schema; an evidence-backed implement/revise recommendation; no invented concurrency guarantee. If no disposable vault/credentials are available, mark blocked with that exact prerequisite and leave storage-format readiness unclaimed.

Verification: V6 and evidence review against the cited API reference. No credentials were supplied for this planning request, and no live authentication was attempted.

Completion evidence:

- Changed paths: only `docs/tasks/20260920-100015-secret-sync-package.md` (this file). No runtime code scaffolded, no other SECSYNC sections touched, `CHANGELOG.md` untouched. Probe script lives outside the repo at `/tmp/opencode/secsync01-probe.mjs` (Node stdlib only: `node:crypto`, `Buffer`).
- Commands/results:
  - `git status --short` (before): only `?? docs/tasks/20260920-100015-secret-sync-package.md`; unrelated work preserved; nothing committed.
  - `node /tmp/opencode/secsync01-probe.mjs`: 16/16 checks passed (output below).
  - `git diff --check`: clean (whitespace check passed for this Markdown-only change). Lint/typecheck/test not run per task instruction (planning-only Markdown change, no `src/`/`test/` touched).
- Probe output (actual):
  - `round-trip:empty` bytes=0 b64=0 json=224; `round-trip:multiline` bytes=28 b64=40 json=269; `round-trip:binary` bytes=13 b64=20 json=246; `round-trip:32kib` bytes=32768 b64=43692 json=43920; `round-trip:32kib-random` bytes=32768 b64=43692 json=43927 — all byte-equal with matching SHA-256.
  - `bound:32KiB-blob-fits-64KiB-record` serialized=43927 bound=65536 headroom=21609.
  - `bound:empty-blob-overhead` envelope fixed overhead ≈ 224 bytes.
  - `math:base64-overhead-32KiB` b64=43692 ratio=1.3334 (+33.33%).
  - `bound:commit-100-short-paths` serialized=15138; `bound:commit-100-long-paths` (100 × ~200-char paths) serialized=33737, fits; `size:commit-1-file` serialized=378.
  - `opacity:title-tags-hide-secrets` title/tags carry only tool marker + projectId + kind + opaque ID; canary scan (secret bytes, sha, b64 prefix, path, message) found zero leaks. `opacity:payload-is-concealed-field` bytes live only in the CONCEALED `payload` value.
  - `reconcile:duplicate-POST-same-payload` two provider IDs + one payload variant => one logical record. `reconcile:same-id-different-payload-is-corruption` two payload variants => corruption error, never silent pick.
  - `filter:client-side-envelope-validation-required` foreign-project item excludable only after list+parse; no server-side logical-ID query assumed.
- Envelope schema verified (v1, frozen for SECSYNC-04): blob `{schemaVersion: 1, projectId, kind: 'blob', logicalId, byteLength, sha256, contentBase64}`; commit `{schemaVersion: 1, projectId, kind: 'commit', logicalId, branch, parents, tree[{path, blobId, sha256, byteLength}], timestamp, message, operationId, operationKind}`; Connect item `{title: '<marker> <projectId> <kind> <logicalId>', category: 'SECURE_NOTE', tags: [marker, projectId, kind], fields: [notesPlain STRING, payload CONCEALED JSON]}`.
- Size calculations: max blob payload JSON ≈ 43,927 bytes (32 KiB file + 224-byte envelope + 43,692 base64) vs 65,536 record bound → 21,609 headroom. Commit stays well under bound even at 100 files with ~200-char paths (33,737). Formula: `serialized ≈ 228 + ceil(n/3)*4`; bound holds for all n ≤ 32768.
- API reference findings vs empirical gaps (docs only, no live server): documented — item list/get/create/replace/patch/delete, concealed custom fields, item `version` field, vault-scoped tokens, PATCH `add`/`remove`/`replace` (no `test` op), no history endpoint, Document creation unsupported via Connect. Empirical gaps (NOT verified, no live vault): actual concealed-field size ceiling, list/get staleness and visibility latency, read-only credential error shape, outage/resync behavior, minimum/supported Connect server version. No CAS inferred: `version` is not a conditional-write guarantee; the design's re-read-heads check narrows but does not serialize races.
- Recommendation: implement with tool bounds (envelope v1 as above; `maxFileBytes: 32768`, `maxFiles: 100`, 64 KiB serialized record hard ceiling with preflight fail, no truncation/chunking). No SDK-backend revision needed: concealed SECURE_NOTE records are practical within these bounds.
- Follow-ups: V6 live-vault exercise still required before any storage-compat claim — synthetic round trips + docs review only; must still record tested Connect version, verified payload ceilings, visibility/permission/outage observations, and cleanup in a disposable vault (blocks SECSYNC-04 compat claims and SECSYNC-10, not SECSYNC-02/03/06).

### Task SECSYNC-02: Scaffold Package And Validate Config/Selection

Status: complete

Completion evidence:

Kind: improvement

Priority: P1 — establish the publishable boundary and one selection contract.

Dependencies: none; pure config/scaffolding can proceed while SECSYNC-01 is pending.

Primary ownership: `packages/secret-sync/{package.json,tsconfig.json,tsup.config.ts,vitest.config.ts,README.md}`, `src/{index,types,config,discovery,cli}.ts`, focused config/discovery tests; root `package.json`, `tsconfig.base.json`, `pnpm-lock.yaml`, README membership; initial `website/docs/packages/{index,secret-sync}.md`.

Finding / references: existing package conventions and `publish-packages/test/contract.test.ts` require complete package membership; `loadConfigFile` supplies loading but not this runtime schema; `parseFlags` does not implement subcommands.

Requirements:

1. Add one bin and root `secret-sync` build-then-run script, placeholder metadata and canonical exports/files. Copy a matching single-CLI sibling's configuration files per AGENTS.md; inspect its actual entrypoints before choosing the template.
2. Export the options/plan/runner contract, reject unsupported commands rather than returning stub success, and validate all nested config fields, limits, branch/path names, unknown schema versions, and mutually exclusive command options.
3. Add a direct `picomatch` dependency using the already-present compatible version, recording that it supplies consistent glob semantics. Discover regular files with a bounded walk; enforce exclusions and remote-path matching in a reusable predicate.
4. Add package/page membership together. Make website edits in that project's context and keep its installation separate.

Acceptance criteria: packed metadata conforms to existing contract tests; fixtures cover dotfiles, braces, zero local matches with remote matches, ignores, repeated exact paths with commas, invalid patterns, symlinks and outside-root paths; config results contain no token values.

Verification: V1, V2, V3; V5 for website changes.

- Changed paths:
  - `packages/secret-sync/package.json` (name `@repo-toolkit/secret-sync`, placeholder version/license/repository, single `repo-toolkit-secret-sync -> dist/cli.js` bin, `picomatch ^4.0.5` direct dep alongside `workspace:*` publish-package dep), `tsconfig.json`/`tsup.config.ts`/`vitest.config.ts` (diff-verified byte-identical to the confluence/publish-package single-CLI siblings), `src/picomatch.d.ts` (one-line ambient declaration per repo convention, picomatch ships no types), `src/types.ts`, `src/config.ts`, `src/discovery.ts`, `src/index.ts`, `src/cli.ts`, `test/index.test.ts`, `README.md`.
  - Membership together: root `package.json` (`secret-sync` build-closure script), `tsconfig.base.json` (both path aliases), `pnpm-lock.yaml` (secret-sync importer + picomatch 4.0.5), root `README.md` (Packages + Workspace Layout), `website/docs/packages/index.md` + `website/docs/packages/secret-sync.md` (minimal page with sidebar_position 8).
  - No other SECSYNC sections touched, `CHANGELOG.md` untouched, nothing committed, no `dist/` artifacts committed.
- Commands/results:
  - `git status --short` (before): only `?? docs/tasks/20260920-100015-secret-sync-package.md`; unrelated work preserved.
  - V1 `pnpm lint`: pass (exit 0). V1 `pnpm typecheck`: pass after two scaffold fixes (ambient picomatch declaration; `Error` `cause` attached via assignment instead of the ES2022 constructor option, matching the confluence precedent, since packages target ES2018).
  - V2 `pnpm --filter @repo-toolkit/secret-sync test`: 23/23 pass (builds dependency closure first, then vitest). Fixtures cover dotfiles, braces, zero local matches with remote matches, ignores, repeated comma-bearing exact paths (no split), invalid patterns, symlinks (skipped in walk, rejected via `--file`), outside-root paths, `--file`-never-overrides-excludes, bounded-walk refusal, branch/option validation, token-canary absence from serialized plans, CLI dispatch, and not-implemented rejection for every scaffolded command.
  - V3 `pnpm --filter @repo-toolkit/publish-packages test`: 85/85 pass (all contract tests, including new-package membership).
  - CLI smoke: `node packages/secret-sync/dist/cli.js --help` exits 0; `... explode` exits 1 with `Unknown command: explode. Expected one of ...`. (One `pnpm secret-sync | head` invocation was SIGPIPE-killed mid-build and left a partial `dist/`; a full rebuild restored it — use untruncated output for build commands.)
  - `diff` confirmed `tsup.config.ts`/`tsconfig.json`/`vitest.config.ts` byte-identical to siblings; `pnpm install` resolved the direct `picomatch ^4.0.5` dep to the already-present 4.0.5.
- Follow-ups: V5 website `pnpm install`/`typecheck`/`build` from `website/` not run (minimal docs page only; full V5 due with SECSYNC-09). V6 live-vault exercise still outstanding per SECSYNC-01. Sync behavior (transport, records, planner, state, operations) lands with SECSYNC-03+; `runSecretSync` rejects all commands by design until then.

### Task SECSYNC-03: Implement The Connect Transport Adapter

Status: complete

Kind: improvement

Priority: P1 — make external I/O bounded, testable, and credential-safe.

Dependencies: SECSYNC-02.

Primary ownership: `packages/secret-sync/src/{store,connect,errors}.ts`, `test/connect.test.ts` and synthetic provider fixtures.

Finding / references: Connect list/get/create endpoints and vault permissions are documented in external references 1–3; no provider adapter exists in this scope.

Requirements: implement injected fetch, environment credential resolution at execution time, URL/redirect policy, bounded streamed responses, timeout/cancellation, limited GET retries with Retry-After/backoff, status/schema errors, and full-record validation after list filtering. Never blindly retry POST with a fresh logical ID. Return an uncertain-write result for higher-level reconciliation. Do not retry authorization/validation failures or interpolate unescaped values into filters.

Acceptance criteria: fake transport exercises 401/403/404/429/5xx, oversized/truncated/malformed responses, timeout, delayed visibility, redirect attempts, filter escaping, and commit-accepted/response-lost behavior. Tokens and synthetic secret canaries are absent from serialized results, thrown errors, stdout/stderr, and transport diagnostics.

Verification: V1, V2; add actual fixtures from SECSYNC-01 once available without making unit tests depend on credentials.

Completion evidence:

- Changed paths: `packages/secret-sync/src/errors.ts`, `packages/secret-sync/src/store.ts`, `packages/secret-sync/src/connect.ts`, `packages/secret-sync/src/index.ts`, `packages/secret-sync/test/connect.test.ts`, `docs/tasks/20260920-100015-secret-sync-package.md` (this SECSYNC-03 section only). No `CHANGELOG.md`, no commit, no `dist/` artifacts committed.
- Commands/results:
  - `git status --short` (before): pre-existing SECSYNC-02 scaffold modifications plus untracked task file and `packages/secret-sync/`; unrelated work preserved.
  - V1 `pnpm lint`: pass (exit 0) after removing a redundant try/catch in `createItem`. V1 `pnpm typecheck`: pass after typing the async-iterator brand check without indexed `Symbol` access.
  - V2 `pnpm --filter @repo-toolkit/secret-sync test`: 54/54 pass (23 SECSYNC-02 contract/discovery tests intact plus 31 new Connect adapter tests). Covers 401/403/404/429/5xx, Retry-After seconds/date backoff, no retry on auth/validation, oversized list/detail plus streamed bounds, truncated vs malformed JSON, per-attempt 30s timeout with GET retries and POST uncertain fallback, delayed list/get visibility, 3xx/redirected/cross-origin blocking with single-request auth containment, backslash/quote filter escaping with URL-encoded `title eq` filter, POST-once uncertain paths for 500/network/malformed with later list/get reconciliation, SECSYNC-01 envelope fixtures (empty/binary/CRLF/32KiB byte-equal round trips, duplicate-POST one-logical-record shape), full-list shape validation after filtering, concurrency default 4/max 8 with ordered bounded mapping, and token/payload canary absence from serialized results/errors/diagnostics.
- Follow-ups: V6 live-vault exercise still outstanding per SECSYNC-01 (unit fixtures are synthetic; no credentials used). Envelope/graph reconciliation stays with SECSYNC-04; the adapter returns shape-validated summaries/details and `{ status: 'uncertain' }` for the higher layer to reconcile.

### Task SECSYNC-04: Implement Immutable Records And Branch Graphs

Status: complete

Kind: improvement

Priority: P1 — preserve revisions under interruptions and simultaneous writers.

Dependencies: SECSYNC-01, SECSYNC-03.

Primary ownership: `packages/secret-sync/src/{records,graph,history-store}.ts`, `test/{records,graph,history-store}.test.ts`.

Finding / references: no documented Connect CAS or historical file API supplies the required history; design sections 3–4 specify append-only records and derived heads.

Requirements: implement the validated envelope, opaque IDs, deterministic tree serialization, full dependency validation, bounded graph traversal, duplicate-ID reconciliation, and same-branch head derivation. Publish commit last; distinguish incomplete/corrupt/diverged/empty remote states. Keep branches independent even when they share ancestors/blobs. Detect cycles, mismatched projects, unsafe paths, and oversized trees before use.

Acceptance criteria: two writers sharing a parent produce preserved divergent heads; branch creation leaves the source head unchanged; timeout/retry with the same operation yields one logical commit; missing blobs/parents block materialization; conflicting duplicate IDs are errors; timestamps cannot choose a winner. Tests include simultaneous first pushes, fork-after-resolution, cross-branch ancestry, and list-size exhaustion.

Verification: V1, V2; synthetic graph fixtures must model delayed item visibility rather than assume a transactional provider.

Completion evidence:

- Changed paths: `packages/secret-sync/src/records.ts`, `packages/secret-sync/src/graph.ts`, `packages/secret-sync/src/history-store.ts`, `packages/secret-sync/test/records.test.ts`, `packages/secret-sync/test/graph.test.ts`, `packages/secret-sync/test/history-store.test.ts`, `packages/secret-sync/src/index.ts` (exports only), `docs/tasks/20260920-100015-secret-sync-package.md` (this section only). No `CHANGELOG.md`, no commit, no `dist/` artifacts committed. Pre-existing unrelated modifications preserved untouched.
- Commands/results:
  - `git status --porcelain=v1 -b` (before): pre-existing scaffold modifications plus untracked task file and `packages/secret-sync/`; unrelated work preserved.
  - V1 `pnpm lint`: pass (exit 0). V1 `pnpm typecheck`: pass after narrowing the `ReadonlyArray | ReadonlyMap` union in `graph.ts` with an explicit type guard (`isCommitList`) instead of bare `Array.isArray`, fixing DTS build errors in `deriveBranchHeads`/`classifyBranchState`.
  - V2 `pnpm --filter @repo-toolkit/secret-sync test`: 86/86 pass across 5 files (23 SECSYNC-02 + 31 SECSYNC-03 intact, plus records/graph/history-store suites). Covers two-writers fork, simultaneous first pushes, branch-create independence, same-operation retry yielding one logical commit (uncertain + delayed-visibility reconciliation), missing blob/parent blocking, conflicting duplicate IDs as corruption, timestamp never choosing a winner, fork-after-resolution joining every head, cross-branch ancestry without merging head sets, 10000-record list exhaustion, and delayed-visibility tolerance via a pending/flush fake store.
- Follow-ups: V6 live-vault exercise still outstanding per SECSYNC-01 (fixtures are synthetic with deterministic UUIDs/clocks; no credentials used). Sync planning, local state, and push/pull recovery land with SECSYNC-05+.

### Task SECSYNC-05: Implement Three-Way Status And Operation Planning

Status: complete

Kind: improvement

Priority: P1 — avoid ambiguous overwrite and deletion decisions.

Dependencies: SECSYNC-02, SECSYNC-04.

Primary ownership: `packages/secret-sync/src/{status,plan,diff}.ts`, table-driven planner tests.

Finding / references: glob matching alone cannot distinguish an absent local file from remote deletion or a concurrent change; design section 5 defines per-file B/L/R semantics.

Requirements: implement the complete comparison table with absent/unknown/error as distinct states, read-only status, metadata-only diff, branch targeting, exact-path selection, and mutation-free dry runs. Preserve changes outside selection and distinguish pending deletion from authorized deletion. Plan from validated remote snapshots; do not turn transport errors into empty lists.

Acceptance criteria: table-driven tests cover all presence/change combinations, identical concurrent content, fresh-clone pull, config selection changes, partial baselines, zero matches, permission errors, unbased conflicts, multiple heads, and current/previous materialized branches. No dry run invokes write/lock/state mutation methods.

Verification: V1, V2.

Completion evidence:

- Changed paths: `packages/secret-sync/src/status.ts`, `packages/secret-sync/src/plan.ts`, `packages/secret-sync/src/diff.ts`, `packages/secret-sync/src/index.ts` (exports only), `packages/secret-sync/test/status.test.ts`, `packages/secret-sync/test/plan.test.ts`, `packages/secret-sync/test/diff.test.ts`, `docs/tasks/20260920-100015-secret-sync-package.md` (this section only). No `CHANGELOG.md`, no commit, no `dist/` artifacts committed. Pre-existing unrelated modifications preserved untouched.
- Commands/results:
  - `git status --porcelain=v1 -b` (before): pre-existing scaffold modifications plus untracked task file and `packages/secret-sync/`; unrelated work preserved.
  - V1 `pnpm lint`: pass (exit 0). V1 `pnpm typecheck`: pass with no fixes needed.
  - V2 `pnpm --filter @repo-toolkit/secret-sync test`: 154/154 pass across 8 files (86 SECSYNC-02/03/04 intact plus 68 new status/plan/diff tests). Covers the full 27-row B/L/R table, identical concurrent content with distinct blob IDs resolving clean, fresh-clone pull as remote-added, selection narrowing with out-of-selection preservation, partial baselines without unrelated resets, zero matches as empty clean reports, permission errors surfacing as local-error/remote-error, unbased conflicts on unknown baselines, diverged-head refusal without winner-picking, current/previous materialized-branch tracking with switched flags, pending vs `--delete`-authorized deletions for both directions, conflict-stops-preflight with no partial plan, no-op plans with commitNeeded false, transport errors rethrown verbatim instead of empty trees, metadata-only diff entries (path, changed, lengths, blob IDs; sha/plaintext bytes absent, verified by canary scans), and dry-run plus non-dry-run planning with zero calls to a write/lock/state effects recorder.
- Follow-ups: V6 live-vault exercise still outstanding per SECSYNC-01 (fixtures are synthetic with deterministic UUIDs/digests; no credentials used). Push/pull execution, local state, and journal recovery land with SECSYNC-06/07; the planner is pure and performs no local or remote writes by construction.

### Task SECSYNC-06: Implement Protected Local State And Recoverable Writes

Status: complete

Completion evidence:

- Changed paths: `packages/secret-sync/src/errors.ts` (added `state-corrupt`, `identity-mismatch`, `lock-busy`, `unsafe-path`, `local-changed` codes; all prior codes/exports intact), `packages/secret-sync/src/state.ts`, `packages/secret-sync/src/filesystem.ts`, `packages/secret-sync/src/journal.ts`, `packages/secret-sync/src/index.ts` (exports only), `packages/secret-sync/test/state.test.ts`, `packages/secret-sync/test/filesystem.test.ts`, `packages/secret-sync/test/journal.test.ts`, `docs/tasks/20260920-100015-secret-sync-package.md` (this section only). No `CHANGELOG.md`, no commit, no `dist/` artifacts committed. Pre-existing unrelated modifications preserved untouched.
- Commands/results:
  - `git status --porcelain=v1 -b` (before): pre-existing scaffold modifications plus untracked task file and `packages/secret-sync/`; unrelated work preserved.
  - V1 `pnpm lint`: pass (exit 0) after one fix (`no-useless-assignment` on the lock-staleness flag in `state.ts`) plus one cleanup fix (temp-file removal on `beforeRename` hook failure in `filesystem.ts`, found by the crash-recovery test).
  - V1 `pnpm typecheck`: pass with no fixes needed.
  - V2 `pnpm --filter @repo-toolkit/secret-sync test`: 190/190 pass across 11 files (154 SECSYNC-02/03/04/05 intact plus 36 new state/filesystem/journal tests). Covers protected 0700/0600 state layout with generated HMAC key, no secret bytes or bare sha256 in state/journal serialization (canary scans), endpoint+vault+project identity binding with mismatch refusal on endpoint/vault/project change and idempotent re-init, corrupt-state rejection (invalid JSON, bad schema version, smuggled sha256/body fields), exclusive locks with contention refusal that never unlinks a live owner, dead-PID and aged-lock takeover, per-file atomic replacement via same-directory 0600 temp plus rename with destination and ancestor rechecks, symlink/special/dir/state-dir/outside-root/case-collision refusal, symlink-swap and dir-swap planted before rename producing controlled `local-changed` errors, injected failures before rename (destination untouched, temp cleaned) and after rename (new bytes durable, state still valid JSON) for both file writes and state saves, journaled pending entries never advancing baselines, written entries verified by HMAC re-read before baseline advance, mismatched files held pending, deterministic repeated recovery, orphan temp cleanup preserving live journal temps, and POSIX mode assertions with Windows ACL behavior recorded as unverified on non-Windows hosts.
- Follow-ups: V6 live-vault exercise still outstanding per SECSYNC-01 (fixtures are synthetic with temp directories; no credentials used). Push/pull execution lands with SECSYNC-07 on top of this journaled-write contract; `FILESYSTEM_RACE_LIMITS` and `STATE_LOCK_RACE_LIMITS` document the residual per-file rename and same-host lock races.

Kind: improvement

Priority: P1 — keep local materialization and its baseline consistent.

Dependencies: SECSYNC-02.

Primary ownership: `packages/secret-sync/src/{state,filesystem,journal}.ts`, temporary-filesystem and fault-injection tests.

Finding / references: per-file baselines and partial commands require durable state; the filesystem provides per-file replacement, not a repository-wide transaction (design section 5).

Requirements: implement protected state/HMAC fingerprints, remote identity binding, local locking, state schema validation, operation journals, restrictive same-directory temporary files, per-file atomic replacement, local-change rechecks, and resume/cleanup. Use descriptor-level checks where available and explicitly document residual filesystem-race limits on supported platforms. Ignore neither symlink ancestors nor the state directory itself. Do not cache secret bodies as history.

Acceptance criteria: injected failures before/after each file rename and state update recover without lost edits or false clean baselines; symlink swaps, directory destinations, special files, case collisions, lock contention, stale locks, changed config identity, and corrupt state produce controlled errors. POSIX output permissions are tested; Windows support is either verified on Windows or clearly recorded as unverified before release.

Verification: V1, V2; inspect temporary fixture cleanup and state serialization for synthetic secret canaries.

### Task SECSYNC-07: Implement Push And Pull With Retry Recovery

Status: complete

Completion evidence:

Kind: improvement

Priority: P1 — deliver the core user workflow with explicit concurrency behavior.

Dependencies: SECSYNC-05, SECSYNC-06.

Primary ownership: `packages/secret-sync/src/{push,pull,operations}.ts`, integration tests using fake Connect and real temp files.

Finding / references: transport, graph, planner, and local writes must share the same publication/recovery contract; design sections 3–5 define it.

Requirements: preflight entire selected operations, upload changed blobs, preserve unchanged references and remote-only changes, verify dependencies, check observed heads before/after commit publication, and acknowledge only completed paths. Implement explicit deletion flags and no-op behavior. Persist operation IDs through uncertain POST results. Surface publication success separately from local recovery failure; do not erase forks or announce global cloud durability.

Acceptance criteria: two independent temp clones round-trip empty/binary/CRLF files; partial push/pull leaves unrelated state untouched; local/remote deletes require flags; concurrent local edits refuse overwrite; interrupted blob uploads do not alter visible history; response-lost commits reconcile; interrupted pulls resume; late-visible forks remain discoverable without discarding either writer.

Verification: V1, V2; record request counts for no-op and one-file pushes to demonstrate bounded concurrency and unchanged-blob reuse without claiming constant-time graph discovery.

Completion evidence:

- Changed paths: `packages/secret-sync/src/operations.ts`, `packages/secret-sync/src/push.ts`, `packages/secret-sync/src/pull.ts`, `packages/secret-sync/src/index.ts` (exports only), `packages/secret-sync/test/push.test.ts`, `packages/secret-sync/test/pull.test.ts`, `packages/secret-sync/test/operations.test.ts`, `docs/tasks/20260920-100015-secret-sync-package.md` (this section only). No `CHANGELOG.md`, no commit, no `dist/` artifacts committed. Pre-existing unrelated modifications preserved untouched.
- Commands/results:
  - `git status --porcelain=v1 -b` (before): pre-existing scaffold modifications plus untracked task file and `packages/secret-sync/`; unrelated work preserved.
  - V1 `pnpm lint`: pass (exit 0) after removing one unused `randomUUID` import in `pull.ts`.
  - V1 `pnpm typecheck` (`tsc --noEmit` in each package): pass after renaming the operations helper to `requireSingleOperationHead` (collided with the graph export) and passing derived head commits (not full history) to `planSync`, whose `requireSingleBranchHead` counts every same-branch commit as a head.
  - V2 `pnpm --filter @repo-toolkit/secret-sync test`: 212/212 pass across 14 files (190 SECSYNC-02/03/04/05/06 intact plus 22 new push/pull/operations tests). Uses a counting fake `SecretStore` plus real temp dirs; no credentials or network.
  - Request counts (immediate fake store): one-file push = 3 lists + 3 gets + 2 creates (1 blob + 1 commit; pre-load, pre-commit head recheck, post-publish verify); repeat no-op push = 1 list + 2 gets + 0 creates with no new commit and blob count unchanged at 1. Demonstrates bounded concurrency (`mapWithConcurrency`, default 4/max 8) and unchanged-blob reuse.
  - Coverage: two-clone round trip of empty (0 bytes), binary (0..255), and CRLF files with byte equality; partial push/pull leaving unrelated baselines and remote entries untouched; local deletes and remote tombstones pending without `--delete` and published only with the flag; concurrent-edit refusal via retained-bytes recheck before blob upload and again after the pre-publish hook before the commit POST; interrupted blob upload (failed create) leaving zero visible commits with retry on persisted operation/blob/commit IDs yielding one commit; response-lost blob and commit (uncertain POST) reconciling to one logical record with `reconciled: true`; interrupted pull (hook throw on `b.env`) resuming via the journal with `resumedFromJournal: true`, completed clean files acknowledged without rewrite, and an empty journal afterwards; delayed-visibility double push reporting `divergedAfter` with both commits preserved; head recheck refusing publication over a changed head set; state-save failure returning `published: true` with `localRecoveryOk: false` and converging to a no-op (no second commit) on retry; push/pull notes verified on the configured endpoint/vault or root with no global durability claim; serialized results and state file scanned for secret canaries.
- Follow-ups: V6 live-vault exercise still outstanding per SECSYNC-01 (fixtures are synthetic with deterministic UUIDs; no credentials used). History/rollback/branch commands land with SECSYNC-08; CLI/docs land with SECSYNC-09.

### Task SECSYNC-08: Implement History, File Rollback, And Branch Commands

Status: complete

Completion evidence:

- Changed paths: `packages/secret-sync/src/log.ts`, `packages/secret-sync/src/restore.ts`, `packages/secret-sync/src/rollback.ts`, `packages/secret-sync/src/branches.ts`, `packages/secret-sync/src/resolve.ts`, `packages/secret-sync/src/operations.ts` (extended `OperationKind` with `rollback`/`resolve`/`branch` for persisted operation records; all prior exports intact), `packages/secret-sync/src/index.ts` (added exports only), `packages/secret-sync/test/{log,restore,rollback,branches,resolve}.test.ts`, `docs/tasks/20260920-100015-secret-sync-package.md` (this section only). No `CHANGELOG.md`, no commit, no `dist/` artifacts committed. Pre-existing unrelated modifications preserved untouched.
- Commands/results:
  - `git status --porcelain=v1 -b` (before): pre-existing scaffold modifications plus untracked task file and `packages/secret-sync/`; unrelated work preserved.
  - V1 `pnpm lint`: pass (exit 0) after removing one unused import in `resolve.ts` and dropping the unused worktree-listing import in `branches.ts`.
  - V1 `pnpm typecheck` (`tsc --noEmit` in each package): pass with no fixes needed on the final tree.
  - V2 `pnpm --filter @repo-toolkit/secret-sync test`: 233/233 pass across 19 files (212 SECSYNC-02/03/04/05/06/07 intact plus 21 new log/restore/rollback/branches/resolve tests). Uses immediate fake `SecretStore` plus real temp dirs and deterministic UUIDs/timestamps; no credentials or network.
  - Coverage: bounded per-file log with add/modify/delete events, stable timestamp/logicalId ordering with parents plus `isHead` fork info, limit pagination with truncation flag, divergent-head log without winner-picking, empty-branch empty history; restore of one historical blob with local-only default and unchanged baselines, `--overwrite` refusal on divergent bytes, equal-bytes no-op, deleted-file recreation, dry-run planning, foreign/unrelated/other-project revision rejection, current-remote-only acknowledgment, `--from-branch` promotion without changing the active branch; single-file rollback publishing a new commit that preserves every other tree entry with exact local materialization, equal-revision no-op, dirty-worktree refusal, unknown-revision rejection, publish-then-state-save failure reporting the commit ID and resuming with the same operation/commit IDs without a second logical commit, deleted-file restoration; metadata-only branch creation with unchanged blob count and untouched source head plus duplicate-name refusal, branch listing, switch refusing drift with the active branch unchanged, partial-switch failure leaving the branch unpersisted and resuming to completion; resolve joining every observed head with the taken full snapshot, stale-head-set rejection, and losing-fork file restoration after the join. Serialized rollback results scanned for secret canaries.
- Follow-ups: V6 live-vault exercise still outstanding per SECSYNC-01 (fixtures are synthetic; no credentials used). CLI/docs land with SECSYNC-09.

Kind: improvement

Priority: P1 — deliver the requested per-file versioning and independent branches.

Dependencies: SECSYNC-07.

Primary ownership: `packages/secret-sync/src/{log,restore,rollback,branches,resolve}.ts`, focused operation tests.

Finding / references: 1Password item versions alone cannot implement these semantics; design sections 3–6 define tool-owned history and commands.

Requirements: implement bounded per-file log including deletion events, revision/path reachability, local restore with explicit overwrite/current-remote acknowledgment, single-file forward rollback, metadata-only branch creation, clean switching, and explicit full-snapshot fork resolution. Resolve revision IDs unambiguously; do not accept a same-vault blob that was never associated with the requested path/project. Branch promotion stays within the project/vault.

Acceptance criteria: rollback changes exactly one path and creates a new commit preserving earlier history; failure after remote rollback resumes without another commit; restored deleted files are retrievable; foreign/unrelated revisions fail; branch switching refuses local drift and recovers partial writes; selected-head resolution joins every observed head and rejects changed head sets. A losing fork's file can still be restored afterward.

Verification: V1, V2; include the exact user-facing single-file rollback scenario as an integration fixture.

### Task SECSYNC-09: Complete CLI, Diagnostics, And User Documentation

Status: complete

Completion evidence:

- Changed paths: `packages/secret-sync/src/format.ts`, `src/init.ts`, `src/doctor.ts`, `src/cli-options.ts`, `src/cli.ts` (adapted; `extractCommand`/`buildOptions`/`parseFlags` strict semantics preserved), `src/index.ts` (implemented `runSecretSync` for all 12 commands with injected `store`/`fetchImpl`/`env`; `resolveSecretSyncPlan` untouched), `test/helpers.ts`, `test/cli.test.ts`, `test/examples.test.ts`, `test/index.test.ts` (scaffold rejection replaced with injected-store status execution), `examples/fake-server.mjs` (executable loopback fake Connect + init/push/status/pull round trip), `packages/secret-sync/README.md`, `website/docs/packages/secret-sync.md`, `AGENTS.md` (secret-sync layout bullet + `pnpm secret-sync` command). No `CHANGELOG.md`, no commit, no `dist/` artifacts committed. Pre-existing unrelated modifications preserved untouched.
- Commands/results:
  - `git status --porcelain=v1 -b` (before): pre-existing SECSYNC-02 scaffold modifications plus untracked task file and `packages/secret-sync/`; unrelated work preserved.
  - V1 `pnpm lint`: pass (exit 0) after one `no-useless-assignment` fix in `resolveEffectiveSelection`. V1 `pnpm typecheck` (`tsc --noEmit` in each package): pass after fixing `listBranches(store, ...)` argument order.
  - V2 `pnpm --filter @repo-toolkit/secret-sync test`: 248/248 pass across 21 files (233 SECSYNC-02–08 intact with one updated scaffold test, plus 12 CLI + 3 examples tests). Covers root/command help via spawned `dist/cli.js`, leading wrapper `--` stripping, unknown commands/flags/subcommands, strict per-command flag rejection, missing vs `--file=` inline values including `-leading-name`, repeatable `--file` with comma paths kept whole, JSON/text error exits with canary redaction and fingerprint stripping, `status --check` drift vs clean, push `--dry-run` with zero creates and no state file, init config preservation plus gitignore idempotency plus vault-mismatch refusal, README/website config equality plus fake-store execution, and `examples/fake-server.mjs` exit 0 with exact-byte round trip.
  - V3 `pnpm --filter @repo-toolkit/publish-packages test`: 85/85 pass (membership/contracts intact).
  - `node packages/secret-sync/examples/fake-server.mjs`: exit 0, prints fake endpoint plus init/push/status/pull agreement without a real vault.
- Follow-ups: V5 website `pnpm install`/`typecheck`/`build` from `website/` not run (minimal markdown only; config fences verified by `test/examples.test.ts`). V6 live-vault exercise still outstanding per SECSYNC-01 (all fixtures synthetic; no credentials used). End-to-end consumer/packaging checks land with SECSYNC-10.

Kind: improvement

Priority: P2 — make the implemented behavior understandable and scriptable.

Dependencies: SECSYNC-08.

Primary ownership: `packages/secret-sync/src/{cli,cli-options,format,init,doctor}.ts`, `test/cli.test.ts`, package README/examples, `website/docs/packages/secret-sync.md`, `AGENTS.md` package layout/commands.

Finding / references: shared `parseFlags` is flag-only and ignores `--`; public commands need deliberate dispatch. Existing package/docs contracts require matching help, bins, and examples.

Requirements: implement the exact dispatch contract, strict command-specific flags, metadata-only schema-versioned JSON, exit codes, init/doctor, and all examples. Document Connect deployment/auth, proposed versus verified size ceilings, glob behavior, remote identity, local state, retention, branch authorization, recovery, and eventual visibility. Add a fake-server example executable without a real vault. Keep token provisioning out of config and argv.

Acceptance criteria: built CLI tests cover root/command help, leading wrapper separators, unknown commands/flags, missing/inline/repeated values, comma-containing paths, error exits, canary redaction, `status --check`, and mutation-free dry runs. README/website examples execute against the fake fixture and describe the actual shipped format and limits.

Verification: V1, V2, V3, V5. Website work uses its own project context.

### Task SECSYNC-10: Verify End-To-End And Published Consumer Behavior

Status: complete with blocked V6 note (all offline checks pass; live-vault verification blocked — no credentials)

Kind: improvement

Priority: P2 — confirm the public package and storage contract agree before release.

Dependencies: SECSYNC-09.

Primary ownership: final integration/consumer fixtures and completion evidence in this document; minimal fixes in affected owning modules.

Finding / references: root scripts, publish contracts, and release-artifact auto-discovery are separate from source-level behavior; AGENTS.md requires workspace verification.

Requirements: review each acceptance criterion against runtime evidence; inspect the package tarball for expected ESM/types/bin and absence of fixture secrets/state; run a disposable installed-consumer smoke test and release-artifact bin checks. Repeat the real provider contract with final encoding and a two-worktree push/pull/rollback/branch workflow. Record remaining platform/provider limitations and deferred work rather than declaring untested guarantees.

Acceptance criteria: V4/V5 pass as applicable; V6 verifies final round trips and documented support; CLI/public types/docs match; no secrets enter logs/package contents; all required tasks have completion evidence. If credentials or a required platform are unavailable, record exactly which release claim is blocked rather than marking it verified.

Verification: V4, V5, V6. Append actual results here; none have been run during planning.

Completion evidence:

- Changed paths: `packages/secret-sync/src/index.ts` (one-line plan fix, see follow-ups), `packages/secret-sync/test/cli.test.ts` (one regression test), `docs/tasks/20260920-100015-secret-sync-package.md` (this section only). No `CHANGELOG.md`, no commit, no `dist/` artifacts committed. Pre-existing unrelated modifications preserved untouched.
- `git status --porcelain=v1 -b` (before): pre-existing scaffold modifications plus untracked task file, `packages/secret-sync/`, `website/docs/packages/secret-sync.md`; unrelated work preserved.
- V4 — `pnpm build`: pass. V1 `pnpm lint`: pass (exit 0). V1 `pnpm typecheck` (`tsc --noEmit` per package): pass.
- V4 — V2 `pnpm --filter @repo-toolkit/secret-sync test`: 249/249 pass across 21 files (248 SECSYNC-02–09 intact plus 1 new switch regression test). V3 `pnpm --filter @repo-toolkit/publish-packages test`: 85/85 pass. `pnpm --filter @repo-toolkit/release-artifact test`: 100/100 pass.
- V4 — tarball (`npm pack`, 85 files, 128.7 kB): contains only `package/README.md`, `package/dist/*`, `package/package.json`. No `test/`, `examples/`, fixtures, `.repo-toolkit-secret-sync` state, or `.env` files. `dist/cli.js` has `#!/usr/bin/env node` shebang with ESM `import` graph; `dist/index.js` ESM; `dist/index.d.ts` (51.5 kB) present; `bin` maps `repo-toolkit-secret-sync -> dist/cli.js`.
- V4 — release-artifact bin auto-discovery: `collectCommands` over `packages/` yields 16 commands including `{ name: 'repo-toolkit-secret-sync', packageDir: 'secret-sync', entry: 'dist/cli.js' }`; no `release-artifact` edit needed.
- V4 — disposable consumer in `/tmp/opencode`: bare `tar -xzf` + `node package/dist/cli.js --help` exits 0 (help text); `npm install` of the tarball into an empty dir fails with `EUNSUPPORTEDPROTOCOL workspace:*` because the packed manifest still references `@repo-toolkit/publish-package: workspace:*`, which `@repo-toolkit/publish-packages` rewrites to the target version only at release time. Installed-consumer `npm install` is therefore blocked by design until the release flow runs; the supported disposable smoke is `node packages/secret-sync/dist/cli.js --help` (exit 0) plus `node packages/secret-sync/examples/fake-server.mjs` (exit 0: `init main, push true, status clean, pull [.env]`, exact-byte round trip over loopback HTTP, no real vault).
- V4 — two-worktree workflow (`/tmp/opencode/secsync10-workflow.mjs`, `runSecretSync` against the loopback fake Connect server with final envelope encoding): worktree A init/push 3 files (empty-adjacent `.env`, 5-byte binary, CRLF) then `status clean files=3`; fresh worktree B `pull downloaded=[.env,crlf.txt,data.bin]` with byte-equal round trip; `log` 1 entry; rotate push; `rollback` to first blob publishes a new commit and restores `KEY=alpha`; `branch create feature/demo` metadata-only; `branch list` shows `feature/demo,main`; `switch to=feature/demo switched=true`, feature push, switch back to main materializes `KEY=alpha`; B pushes `b-writer`; A pushes `a-writer` through a stale-list `fetchImpl` (simulated delayed visibility) publishing a second head; `status diverged=true heads=2`; `resolve --take` joins every head; post-resolve `diverged=false heads=1`; `push --dry-run published=false`. No secret canaries printed; temp dirs removed.
- V4 — minimal fix found by this verification: `switch` via `runSecretSync`/CLI always failed with `switch requires --branch <name>` because `resolveSecretSyncPlan` dropped an explicit `branch` override from `commandOptions` whenever it equaled the merged config branch (always true, since the override is merged first), so validation could never see it. Fixed to record `commandOptions.branch` whenever `options.branch` is explicitly provided. This also makes explicit `--branch` win over cached state for read-only commands, matching the documented CLI > active-branch > config precedence. Added regression test `switches branches through runSecretSync with an explicit target` (switch succeeds with `to=feature/demo`; bare switch still rejected).
- V5 — from `website/`: `pnpm typecheck` pass; `pnpm build` pass (`Server/Client: Compiled successfully`, static files generated). `website/docs/packages/secret-sync.md` present and listed.
- V6 — BLOCKED, not claimed: no `OP_CONNECT_HOST`/`OP_CONNECT_TOKEN` in the environment and no disposable vault was designated, so no live authenticated requests were attempted. Blocked release claims: storage-format feasibility and release compatibility against a real Connect deployment — tested server version, verified concealed-field payload ceilings, list/get visibility latency, read-only credential error shape, outage/resync behavior, and vault cleanup. Partial substitutes actually run: SECSYNC-01 synthetic envelope math (32 KiB blob serializes ≈ 43,927 bytes < 65,536 bound) and this task's loopback fake-Connect HTTP round trips (init/push/status/pull/rollback/branch/switch/resolve over real `fetch`, exact bytes preserved). Do not mark live-vault verified.
- Criterion review: V4/V5 pass as above; CLI/public types/docs match (help text, `SecretSyncOptions`/`runSecretSync` exports, README/website config fences executed by `test/examples.test.ts`); no secrets in logs or package contents (canary/redaction tests plus tarball scan); SECSYNC-01–09 each carry completion evidence above. Remaining limits: POSIX 0700/0600 asserted, Windows ACL behavior unverified on this host; per-file (not multi-file) atomicity and same-host-only state locks per `FILESYSTEM_RACE_LIMITS`/`STATE_LOCK_RACE_LIMITS`; no-CAS races only narrowed by head recheck; history retained, no pruning/GC; `npm install` consumer flow pending the release rewrite; all deferred items in Deferred Work stay deferred.
- Follow-ups: run V6 against a disposable vault with read/write credentials before any storage-compatibility release claim; re-run `npm install` consumer smoke on a release-rewritten tarball.

## Deferred Work And Definition Of Done

Deferred with rationale:

- SDK/service-account/desktop-auth backend and larger Document/attachment payloads: valuable for users without Connect, but introduce a different dependency, packaging, and provider contract. Investigate after the initial backend; do not imply SDK cannot write files.
- Raw regular expressions: glob syntax covers the requested ESLint-style use case; raw regex needs a separate execution/complexity contract.
- Automatic content merge, staging/index, offline status, automatic Git branch mapping: introduce ambiguity for secrets and additional local-cache semantics. V1 resolves whole files/snapshots explicitly.
- Branch rename/delete, automatic history pruning, remote garbage collection: require safe reachability and concurrent-writer rules. V1 retains history and stops at capacity rather than deleting it.
- Cross-vault promotion and secret-level dotenv mapping: separate authorization/data-model work. V1 syncs exact whole-file bytes.
- Strong globally serialized pushes or signed tamper-evident audit history: not supplied by this append-only Connect design. V1 preserves concurrent revisions and reports observed forks; strict coordination would need an additional proven primitive/service.

No user product decision blocks beginning SECSYNC-02/03/06. SECSYNC-01 requires a disposable Connect deployment/vault and read/write credentials to validate the chosen storage format; no such validation was performed in this session. This prerequisite blocks SECSYNC-04 and storage compatibility claims, not config/scaffold work.

Done means the initial CLI and public API implement the contracts above, default automated tests run offline, required repository/website/consumer checks pass, real-provider evidence establishes the published encoding/limits, and remaining restrictions are documented accurately. Completion includes a two-clone demonstration of status/push/pull, isolated single-file rollback, named branches, and recoverable concurrent divergence.
