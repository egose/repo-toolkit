# Release Artifact Archive Security

Created: 2026-08-04 14:19:59

## Objective

Prevent malicious or malformed artifacts from writing outside extraction roots, executing host files, deleting unintended paths, or installing a mismatched release. This file is the highest-priority backlog in the review.

Priority: P0 is a pre-extraction or arbitrary-path security boundary; P1 is release-integrity enforcement.

### Task RASEC-01: Validate archive headers before extraction

Status: completed

Priority: P0

Suggested agent: archive security engineer

Dependencies: none

Primary ownership:

- `packages/release-artifact/src/index.ts:424-471`
- `bin/install:31-32`
- malicious archive fixtures

Finding:

Verifier and installer call `tar -xzf` before validating members. Post-extraction symlink checks cannot undo traversal, absolute-path, link-order, device/FIFO, duplicate-member, or decompression-resource writes.

Implementation requirements:

1. Inspect all headers before extraction and reject unsafe names, types, link targets, duplicates, and unexpected top-level entries.
2. Enforce configurable member-count, expanded-size, and path-length limits.
3. Use one validated extraction contract for verifier and installer; account explicitly for supported GNU/BSD tar behavior if external tar remains.

Acceptance criteria:

- Traversal, absolute paths, escaping symbolic/hard links, special files, duplicate paths, and oversized archives fail before extraction.
- External marker files remain untouched for the shared malicious corpus.
- Exactly one expected top-level directory and no top-level files are accepted.

Completion evidence:

- Changed: `packages/release-artifact/src/index.ts`, `packages/release-artifact/test/index.test.ts`, `bin/install`
- Verified: `pnpm --filter @repo-toolkit/release-artifact test`, `bash -n bin/install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
- Result: verifier and installer now inspect tar headers before extraction, reject unsafe member types and escaping links, and enforce one top-level directory with bounded archive metadata.

### Task RASEC-02: Define and enforce a strict manifest/path schema

Status: completed

Priority: P0

Suggested agent: schema and path-validation engineer

Dependencies: RASEC-01

Primary ownership:

- `packages/release-artifact/src/index.ts:454-500`
- `bin/install:42-73`
- manifest tests

Finding:

Manifest `requiredFiles` and command names are joined and executed without type or containment validation (`477-499`). Traversal values can inspect or execute host paths; installer newline serialization permits path-list injection.

Implementation requirements:

1. Add a schema version and strict parser for all manifest fields.
2. Permit only normalized nonempty relative POSIX paths; reject absolute, dot segments, backslashes, drive syntax, NUL/newline, duplicates, and non-string values.
3. Restrict command names to safe basenames and prove every resolved path remains under the artifact root.
4. Compare requested version, archive name, top-level directory, and manifest identity.

Acceptance criteria:

- Malicious values fail before filesystem access, shell syntax checks, or command execution.
- Mismatched versions/schema and duplicate commands/files fail explicitly.
- Installer consumes structured/NUL-safe data rather than newline-delimited untrusted paths.

Completion evidence:

- Changed: `packages/release-artifact/src/index.ts`, `packages/release-artifact/test/index.test.ts`, `bin/install`
- Verified: `pnpm --filter @repo-toolkit/release-artifact test`, `bash -n bin/install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
- Result: artifact manifests now carry `schemaVersion`, `toolName`, `artifactDirName`, and `archiveFileName`, with strict parsing for command and required-file paths in both verifier and installer.

### Task RASEC-03: Constrain build output and bin-derived paths

Status: completed

Priority: P0

Suggested agent: filesystem safety engineer

Dependencies: RASEC-02

Primary ownership:

- `packages/release-artifact/src/index.ts:156-207,295-305,352-392,510-513`
- build fixtures

Finding:

User-controlled tool/version components form paths later recursively deleted, without component validation. Package `bin` names/entries are cast and used as wrapper/target paths without containment, existence, regular-file, or uniqueness checks.

Implementation requirements:

1. Validate tool/version filename components and prove all output/delete paths descend from `distRoot`.
2. Validate each bin name and entry, require an existing regular file within its package, and reject global command collisions.
3. Preserve external marker files in every rejection test.

Acceptance criteria:

- Slash, dot, traversal, absolute, malformed bin values, missing entries, directories, and duplicate commands all fail before deletion/copy.
- Valid scoped package bins still produce working wrappers.

Completion evidence:

- Changed: `packages/release-artifact/src/index.ts`, `packages/release-artifact/test/index.test.ts`
- Verified: `pnpm --filter @repo-toolkit/release-artifact test`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
- Result: build planning now validates tool/version filename components, constrains artifact paths to `distRoot`, and rejects duplicate or non-regular bin entries before artifact cleanup or wrapper generation.

### Task RASEC-04: Make asdf installation atomic and contract-equivalent

Status: completed

Priority: P1

Suggested agent: asdf integration engineer

Dependencies: RASEC-01, RASEC-02, RASEC-03

Primary ownership:

- `bin/install`
- reusable verifier entrypoint
- black-box shell tests

Finding:

Installer extracts into a possibly stale final destination, applies weaker validation than the package verifier, and can leave partial state (`bin/install:31-73`).

Implementation requirements:

1. Extract into a fresh temporary sibling, invoke the shared validation contract, then move into place.
2. Reject stale destination content and escaping symlinks; clean temporary state on all failures.
3. Validate command syntax/executability and exact version before activation.

Acceptance criteria:

- Pre-existing files cannot satisfy missing required archive members.
- Failed installs leave neither partial final trees nor temporary directories.
- The same malicious corpus yields equivalent verifier and installer outcomes.

Completion evidence:

- Changed: `packages/release-artifact/src/index.ts`, `packages/release-artifact/src/cli-install.ts` (new), `packages/release-artifact/src/cli-install-embedded.ts` (new), `packages/release-artifact/tsup.config.ts`, `packages/release-artifact/package.json`, `packages/release-artifact/scripts/generate-install.mjs` (new), `packages/release-artifact/test/index.test.ts`, `packages/publish-package/package.json`, `packages/publish-package/tsup.config.ts`, `bin/install`, `package.json`
- Verified: `pnpm --filter @repo-toolkit/release-artifact test` (49/49), `pnpm --filter @repo-toolkit/publish-package test` (103/103), `pnpm lint`, `pnpm typecheck`, `pnpm test` (all 6 packages green), `bash -n` on `bin/install`/`bin/download`/`bin/list-all`/`bin/lib/repo-toolkit.sh`, ShellCheck 0.11.0 (`-x`) clean on `bin/install` and the other bin scripts
- Result: A single exported `verifyExtractedArtifact(installRoot, options)` post-extraction contract is now shared by both `verifyReleaseArtifact` and the new `installReleaseArtifact(options)` runner. `installReleaseArtifact` extracts into a fresh `mkdtemp` sibling of the destination, applies the shared contract (archive-header pre-check, symlink audit, strict manifest parse with exact `$toolName-$version` directory + version assertions, required-file containment, per-wrapper `accessSync(X_OK)` + `bash -n` + `--help` boot), refuses a non-empty existing install path unless `--force`, atomically `renameSync`s the validated tree into place, and removes the temp dir in a `finally` on every failure path. The asdf `bin/install` is now regenerated by `packages/release-artifact/scripts/generate-install.mjs` from the zero-runtime-dependency `dist/cli-install-embedded.js` bundle (all of `@repo-toolkit/publish-package` and node builtins inlined via tsup `noExternal: [/.*/]` and `splitting: false`), eliminating the previously hand-duplicated verifier logic; the bundle is invoked via a quoted heredoc so the asdf plugin source carries one auditable install path. New `./helpers` subpath export on `@repo-toolkit/publish-package` exposes the zero-dep `isPlainObject`/`normalizeVersion` helpers so the embedded bundle stays free of the `@clack/prompts` transitive dependency. Added black-box `bin/install` tests (atomic install of the real-repo artifact; stale-destination refusal leaving the existing tree untouched; version mismatch leaving neither a partial final tree nor a leftover temp dir; traversal corpus rejected before touching the install path; pre-existing files cannot satisfy missing required members; multiple-archive and non-`version` install-type rejection; equivalent outcomes to `verifyReleaseArtifact` on the shared traversal corpus) plus `installReleaseArtifact`/`validateReleaseArchive`/`verifyExtractedArtifact` direct unit tests. `gen-install` npm scripts (package-level and root convenience) regen `bin/install` after installer changes.

## Verification And Done

Targeted tests must never extract malicious members outside isolated fixtures. Run package tests, `bash -n` on all bin scripts, ShellCheck when available, then root lint/typecheck/test and a valid artifact build/verify/install smoke test. Independent security review is required before completion.
