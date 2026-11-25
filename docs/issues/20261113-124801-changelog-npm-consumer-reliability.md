# Changelog CLI reliability for npm-package-manager consumers

Created: 2026-11-13 12:48:01

## Objective

Fix two demonstrated defects that make `@repo-toolkit/changelog` (the
`repo-toolkit-changelog` CLI) silently or hard-fail when consumed by projects
that use npm as their package manager. Both defects were reproduced against the
published `@repo-toolkit/changelog@0.14.2` artifact from a downstream
npm-workspaces consumer project.

## Scope and non-goals

In scope:

- `packages/changelog/src/cli.ts` (CLI entrypoint detection)
- `packages/changelog/package.json` (dependency declarations)
- `packages/changelog/test/` (regression coverage)

Non-goals:

- Fixing upstream packages (`@conventional-changelog/git-client`,
  `conventional-changelog`); the report records the upstream root cause for
  context only.
- Changing changelog output semantics, the preset, or the JS API contract.
- pnpm/Bun consumers: both defects are invisible in this repository's own
  pnpm workspace and in Bun-driven consumers (see Analysis coverage).

## Analysis coverage and limitations

Verified during analysis (evidence below):

- Built `cli.js` from the published 0.14.2 tarball, executed under Node via a
  symlinked `node_modules/.bin` entry, via the real `dist` path, and through the
  JS API (`generateChangelog`).
- Upstream dependency metadata via the npm registry (`peerDependencies`,
  `peerDependenciesMeta`) for `@conventional-changelog/git-client@2.7.0` and
  `@3.1.2`.
- This repository's `pnpm-lock.yaml` resolution for both git-client versions.

Limitations:

- Not audited: whether any other `@repo-toolkit/*` CLI shares the same
  entrypoint-detection pattern (`publish-package`, `release-artifact`, and so
  on bundle their CLIs the same way). Worth a quick grep when implementing
  CHANGELOG-01.
- The minimal upstream versions that would remove the need for CHANGELOG-02's
  dependency additions were not exhaustively enumerated; the observed
  resolution under npm is recorded instead.

Baseline verification actually run (downstream consumer project, npm 11.20.0,
Node 26.12.0):

- `repo-toolkit-changelog` executed through `node_modules/.bin` (symlink):
  exit 0, no output, no file written, for `--help`, for default flags, and for
  explicit `--release-count 0 --output-unreleased` flags.
- `node <pkg-root>/node_modules/@repo-toolkit/changelog/cli.js` (real path):
  same silent no-op before CHANGELOG-02's missing dependency was worked around
  in the consumer; after the workaround, generation succeeded and printed
  `Changelog generated at <path>.`
- `generateChangelog()` JS API before the workaround: rejects with
  `Cannot find package 'conventional-commits-filter' imported from
.../node_modules/conventional-changelog/node_modules/@conventional-changelog/git-client/dist/ConventionalGitClient.js`

### Task CHANGELOG-01: Fix CLI entrypoint detection so symlinked bins execute

Status: pending

Kind: defect

Priority: P1 — the CLI exits 0 without doing anything when invoked the way npm,
yarn, and pnpm package scripts run bins. Silent wrong-success corrupts release
automation trust (a release hook "succeeds" while generating nothing); there is
no error to notice. The workspace itself is unaffected because root scripts
call `node packages/<pkg>/dist/cli.js` directly, which is why this went
unnoticed.

Suggested agent: changelog package maintainer

Dependencies: none

Primary ownership:

- `packages/changelog/src/cli.ts`
- `packages/changelog/test/` (new regression)

Finding:

`packages/changelog/src/cli.ts:84` detects entrypoint execution with:

```ts
const executedAsEntryPoint = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
```

`main()` at line 86 only runs when this is true. When a bin is executed through
its install symlink (`node_modules/.bin/repo-toolkit-changelog` — the standard
path for package scripts on npm/yarn/pnpm), Node keeps `process.argv[1]` as the
symlink path while `import.meta.url` is the real file, so the comparison is
always false and the CLI exits 0 without running `main()`. Demonstrated with a
minimal fixture under Node: argv1 = `.../node_modules/.bin/tool`,
metaUrl = `.../node_modules/real/tool.mjs`. Under Bun, `argv1` is resolved to
the real path, which matches `import.meta.url` — explaining why Bun-driven
consumers never observed this. All downstream Node symptoms follow from this
one line: silent `--help`, silent generation, silent exit 0 (confirmed against
the packed 0.14.2 artifact).

References:

- `packages/changelog/src/cli.ts:84-92` (`executedAsEntryPoint`, `main().catch`)
- `packages/changelog/src/cli.ts:60-77` (`main`, also unreachable)

Requirements:

1. Entrypoint detection must succeed when `argv[1]` is a symlink to the
   executed module, and must still stay false when the module is imported as a
   library (import side effects must not run `main()`).
2. Preserve the existing error convention: `main().catch` prints the message
   and sets `process.exitCode = 1`; do not introduce `process.exit()`
   (repository convention).
3. Apply the same correction to any other bundled CLI in this repository that
   repeats this pattern, or record explicitly that none do.

Acceptance criteria:

- Executing the built CLI through a `node_modules/.bin`-style symlink prints
  help for `--help` and generates a changelog for a real invocation under Node.
- Importing `cli.js` as a module still does not execute `main()`.
- A regression test executes the built `dist/cli.js` through a symlink (for
  example in a temporary directory) and asserts observable output; it fails on
  the current implementation and passes after the fix.

Verification: `pnpm build` then run the symlink reproduction against
`packages/changelog/dist/cli.js` from a temporary directory
(`node '<repo-root>/packages/changelog/dist/cli.js'` executed via a symlink,
plus the direct invocation); `pnpm --filter @repo-toolkit/changelog... build &&
pnpm --filter @repo-toolkit/changelog test`; `pnpm lint && pnpm typecheck`
(working directory: `<repo-root>`).

### Task CHANGELOG-02: Declare git-client's optional peers so npm consumers can generate

Status: pending

Kind: defect

Priority: P2 — generation is impossible for npm consumers (hard failure), but
the failure is loud once CHANGELOG-01 is fixed, the current consumer base runs
pnpm or Bun (where resolution happens to link the peers), and the fix is a
dependency declaration rather than a code change.

Suggested agent: changelog package maintainer

Dependencies: none (independent of CHANGELOG-01; verify through the JS API or
the real dist path while CHANGELOG-01 is open)

Primary ownership:

- `packages/changelog/package.json`
- `packages/changelog/test/` (generation regression under an npm-style tree)

Finding:

`@repo-toolkit/changelog` declares `conventional-changelog: ^7.2.1`, which
resolves `@conventional-changelog/git-client@2.7.0` under npm. That upstream
package's `dist/ConventionalGitClient.js` (`loadDeps()`) unconditionally
dynamic-imports two packages it declares only as **optional peerDependencies**:

- `conventional-commits-parser` (`^6.4.0`)
- `conventional-commits-filter` (`^5.0.0`)

pnpm resolves and links optional peers that exist in the graph
(`pnpm-lock.yaml` records
`'@conventional-changelog/git-client@2.7.0(conventional-commits-filter@5.0.0)(conventional-commits-parser@6.4.0)'`),
so the workspace works. npm does not auto-install optional peers of transitive
dependencies, and nothing else in an npm consumer's tree is guaranteed to
provide them — in the reproduced consumer tree `conventional-commits-filter`
existed only nested under `conventional-changelog-writer`, unreachable from
git-client's install location. `generateChangelog()` then rejects with
`Cannot find package 'conventional-commits-filter' imported from
.../ConventionalGitClient.js`. Upstream does not fix this by upgrading:
`@conventional-changelog/git-client@3.1.2` uses the same optional-peer pattern
(`conventional-commits-parser ^7.1.2`, `conventional-commits-filter ^6.0.1`).

References:

- `packages/changelog/package.json` (`dependencies.conventional-changelog`)
- `pnpm-lock.yaml` (git-client@2.7.0 peer resolution, contrasted with the npm
  tree of a downstream consumer)
- Upstream registry metadata: `@conventional-changelog/git-client@2.7.0`
  `peerDependencies`/`peerDependenciesMeta` (both peers marked optional)

Requirements:

1. Add `conventional-commits-parser` and `conventional-commits-filter` as
   direct dependencies of `packages/changelog` with ranges compatible with the
   git-client version resolved by `conventional-changelog@^7.2.1` (observed
   working pair under npm: parser `6.x`, filter `^5`/`6.x`; confirm the
   `filterRevertedCommits` export exists in the chosen filter version).
2. Keep the runtime-dependency rule in mind: these are required for the
   changelog generator to function and are already present in the resolved
   graph, so adding them as direct dependencies does not introduce a new
   third-party package.
3. Do not pin `--save-exact` versions that conflict with the peer ranges of the
   git-client version conventional-changelog resolves; prefer the peer ranges
   themselves.

Acceptance criteria:

- In a scratch npm project (`npm install` of the packed
  `@repo-toolkit/changelog` tarball), `generateChangelog()` and the CLI complete
  generation against a fixture git repository with at least one `v`-prefixed
  tag, without manual dependency additions.
- The workspace still resolves with pnpm (`pnpm install` clean) and
  `pnpm --filter @repo-toolkit/changelog test` passes, including a generation
  case that exercises `filterRevertedCommits` (a revert commit) so the
  previously-dynamic import is covered.
- Registry dependency metadata of the next published version shows both
  packages under `dependencies`.

Verification: from a scratch directory, `npm install
'<repo-root>/packages/changelog/<tarball from npm pack>'` and run generation
against a fixture repository with a tag (JS API and real dist path while
CHANGELOG-01 is open; symlinked bin after CHANGELOG-01);
`pnpm --filter @repo-toolkit/changelog... build && pnpm --filter
@repo-toolkit/changelog test`; `pnpm lint && pnpm typecheck` (working
directory: `<repo-root>`).

## Shared verification and definition of done

- Both tasks: `pnpm lint && pnpm typecheck` and
  `pnpm --filter @repo-toolkit/changelog... build && pnpm --filter
@repo-toolkit/changelog test` from `<repo-root>` must pass.
- Joint consumer check (after both): packed-tarball install into a scratch
  npm project, then run the CLI through `node_modules/.bin` against a fixture
  git repository with a `v`-prefixed tag; expect the generated changelog file
  and the `Changelog generated at <path>.` message.
- Definition of done: both tasks completed with the acceptance criteria above,
  regression tests in place for the symlinked-bin execution and the npm
  dependency resolution, and the downstream consumer reproduction no longer
  reproducible against the new artifact. Bump the changelog package version
  and note the fixes in its release notes, since external npm consumers are
  affected.
