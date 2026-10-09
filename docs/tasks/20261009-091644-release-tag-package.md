# Release Tag Package: Design And Implementation Tasks

Created: 2026-10-09 09:16:44 (local timestamp)

Status: complete; RELTAG-01 through RELTAG-06 all completed via sequential sub-agents with V1/V2/V3/V4 green.

## Objective And Scope

Build `@repo-toolkit/release-tag` with one `repo-toolkit-release-tag` executable that ports the behavior of `<egose-actions-checkout>/release-tag` (composite GitHub Action) into a testable TypeScript package following this repo's conventions.

The package has three distinct stages, executed in order by default:

- Stage 1 — Determine next tag: validate a manual `tag` override or derive the next `X.Y.Z` version from the latest `vX.Y.Z` tag plus Conventional Commit messages since that tag. Output is `version` (`1.2.3`) and `tagVersion` (`v1.2.3`).
- Stage 2 — Release branch + release command: create/reset `changelog/<version>` from the base branch, configure the git author, run the configured release command (default `release-it <version> --ci`) only when it is available and not skipped, push the branch, and read the annotated tag message for the PR body.
- Stage 3 — GitHub PR: when a GitHub token is available and not skipped, create a pull request `changelog/<version>` -> base branch with the release-candidate title/body template, apply `changelog`, `release-candidate`, `<tagVersion>` labels, and optionally auto-merge plus delete the branch.

This document is the implementation contract. No package implementation accompanies the planning revision; RELTAG-01 through RELTAG-05 build it, RELTAG-06 independently reviews it.

Initial scope: one ESM package with zero new runtime dependencies (only `workspace:*` on `@repo-toolkit/publish-package`), public `*Options`/`resolve*Plan`/runner API, thin `parseFlags` CLI, injectable process runner and fetch transport, temp-fixture unit tests with no git daemon or network required, concise `README.md` plus Docusaurus page, and full workspace membership (path aliases, root script, README lists, website index, release-artifact auto-discovery).

Non-goals for v1:

- GPG private-key import from env secrets. `signCommit` only sets `commit.gpgsign=true` and passes `--gpg-sign` to the release command; the runner must already have a usable secret key. Full `gpg --import` port is deferred to RELTAG-07.
- Generic release-command auto-detection beyond an explicit `releaseCommand` path plus executable check. No shell-string parsing, no npm/npx resolution.
- GitHub Enterprise custom auth flows, GraphQL, or `gh` CLI invocation. Only REST via `fetch` against a configurable API base URL.
- Windows-specific git/gpg behavior beyond what the shared runner already supports.
- Automatic retry of release-command or PR-merge failures.

## Working Rules And Non-Goals (Repo Conventions)

All agents must follow `AGENTS.md`:

- Mirror an existing single-CLI package exactly. Each package has 8 files: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `src/index.ts`, `src/cli.ts`, `test/index.test.ts`, `README.md`. Copy `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts` verbatim from a matching sibling (inspect `packages/confluence` single-CLI files before choosing the template; do not copy the multi-CLI `docker-publish`/`go-release` tsup entries).
- `package.json`: `name "@repo-toolkit/release-tag"`, `version/license/repository` placeholders, `type module`, `sideEffects false`, standard `exports`/`files`/`engines` block, `bin { "repo-toolkit-release-tag": "dist/cli.js" }`, scripts `build` (`tsup --config tsup.config.ts`), `test` (`pnpm --filter @repo-toolkit/release-tag... build && vitest run --config vitest.config.ts`), `release-tag` (`node dist/cli.js`).
- `src/index.ts`: exported `ReleaseTagOptions` (optional/defaulted `options = {}`), exported `resolveReleaseTagPlan` plus runner `runReleaseTag`. Import shared helpers (`isPlainObject`, `normalizeVersion`, `inferNpmTag`, `parseFlags`, `loadConfigFile`, `readValue`, `splitListArg`, `isCapturingProcessRunner`, `defaultProcessRunner`, `normalizeReleaseVersion`, `bumpVersion`, `redactSensitiveValues`) from `@repo-toolkit/publish-package`. Do not reimplement them.
- `src/cli.ts`: thin wrapper with `SPECS: FlagSpec[]`, `parseFlags`, options builder, runner call. Always end with `main().catch` that sets `process.exitCode = 1` (never call `process.exit`). Support `-h/--help` via `parseFlags` null return.
- TypeScript: `target ES2018`, `module ESNext`, `moduleResolution Bundler`, `strict true`. No `Array.prototype.at`, `Object.hasOwn`, or other post-ES2018 lib features. Use index access and `Object.prototype.hasOwnProperty.call`. No new ambient declarations needed (no untyped deps).
- No `process.exit()` from library or CLI code; throw and set `exitCode`.
- No code comments unless the user asks. Keep code self-explanatory.
- No new runtime dependencies without checking they are already used in the repo. This package must stay zero-runtime-dep except `workspace:*`.
- Do not edit `website/` from the workspace root as a pnpm workspace command; website is a separate pnpm project. Edit its markdown files directly but run its `pnpm install/typecheck/build` from `website/` only if needed.
- Do not commit unless explicitly asked. Do not create `dist/` artifacts in commits.
- After scaffolding: add path aliases to `tsconfig.base.json`, root script to `package.json`, package to root `README.md` (Packages list + Workspace Layout) and `website/docs/packages/index.md`, plus `website/docs/packages/release-tag.md`. Release-artifact `bin` auto-discovery needs no edit but must be verified via existing contract tests.

Verification commands (repository root, after `pnpm install`):

- **V1:** `pnpm lint` and `pnpm typecheck` after every code change; `pnpm test` for changes touching `src/` or `test/`.
- **V2:** `pnpm --filter @repo-toolkit/release-tag test` — builds dependency closure first, then vitest. Unit/CLI tests use injected fake runners and fake fetch; no git daemon or network required.
- **V3:** `pnpm --filter @repo-toolkit/publish-packages test` after metadata/docs membership changes (contract tests require README/website membership, unique bins, root scripts).
- **V4:** final `pnpm build`, V1, V2, V3, plus packed ESM/type/bin consumer smoke in a disposable directory. Never commit `dist/`.

Serialize builds/tests that rebuild shared outputs. Root `pnpm test` already sets workspace concurrency to 1. Agents must not run conflicting builds concurrently.

## Baseline Verification

Inspected on 2026-10-09:

- `AGENTS.md`: scaffolding, verification, ES2018, shared helpers, website separation.
- `<egose-actions-checkout>/release-tag/action.yml:1-132`: branch guard, determine-tag step, release-it step, github-script PR create + labels + optional merge/delete.
- `<egose-actions-checkout>/release-tag/determine-tag.sh:1-58`: manual SemVer validation, `git describe --tags --abbrev=0`, `vX.Y.Z` parse, `git log last_tag..HEAD --pretty=format:%B`, breaking/feat/patch bump regexes, `GITHUB_OUTPUT` write.
- `<egose-actions-checkout>/release-tag/create-release-pr-branch.sh:1-88`: GPG signing setup, git author config, branch reset (`push --delete`, `branch -D`, `checkout -b`, `push --set-upstream`), `release-it <version> --ci` (+ `--git.commitArgs=--gpg-sign`), push, `pr_title`/`pr_body` from `git tag -l --format='%(contents)'`.
- `<egose-actions-checkout>/release-tag/README.md:1-171`: inputs table, versioning rules, branch naming, GPG/Verified notes.
- Root `package.json:19-42`, `tsconfig.base.json:1-25`, `README.md:1-126`: workspace scripts/aliases/membership contracts.
- `packages/publish-package/src/flags.ts:30-139` (`parseFlags`), `src/runner.ts:1-138` (`ProcessRunner`, `CapturingProcessRunner`, `defaultProcessRunner`), `src/version.ts:39-80` (`isValidSemver`, `normalizeReleaseVersion`, `bumpVersion`, `redactSensitiveValues`), `src/index.ts:24-113` (public re-exports).
- `packages/docker-publish/src/cli.ts:24-77`, `packages/confluence/src/cli.ts:20-125`, `packages/secret-sync/src/cli.ts:1-201`: thin CLI precedents, env+config+flag precedence, secret-file handling, redaction.
- `packages/docker-publish/src/runner.ts:1-397`: bounded runner precedent (timeout, output limits, secret redaction, NUL/arg validation).
- `packages/go-release/README.md`, `packages/docker-publish/package.json`, `packages/docker-publish/tsup.config.ts`: packaging/docs precedents.
- `docs/tasks/`: no overlapping release-tag task found; `20260920-100015-secret-sync-package.md` and `20260909-220018-docker-publish-package.md` supply package-plan precedents.

Verification actually run for this planning revision: `date +%Y%m%d-%H%M%S` for the filename timestamp and directory listings. `git status`, lint, typecheck, build, and tests were not run for this Markdown-only change and must be run by the implementation agents per task verification sections.

## Priority Definitions

- **P0** = correctness or security defect that blocks release; must land before the package is usable.
- **P1** = foundational v1 behavior required for the three stages to work end to end.
- **P2** = usability, docs, or integration polish required before publishing but not blocking stage execution.

No P0 is assigned at planning time: this is a new feature plan, not an active production defect.

## Ordered Waves And Milestones

- Wave 0 — Planning (this file). No code.
- Wave 1 — RELTAG-01 scaffold + plan validation + workspace membership. Blocks all later tasks.
- Wave 2 — RELTAG-02 stage 1 tag determination. Blocks RELTAG-03/04 on version/branch contracts.
- Wave 3 — RELTAG-03 stage 2 release branch + RELTAG-04 stage 3 PR creation. May run in parallel after RELTAG-02 only if file ownership stays disjoint; default is sequential to avoid `src/index.ts`/`src/plan.ts` conflicts.
- Wave 4 — RELTAG-05 orchestrator + CLI + docs. Requires RELTAG-02/03/04.
- Wave 5 — RELTAG-06 final integration review by an agent that did not implement RELTAG-05.

## Detailed Executable Tasks

### Task RELTAG-01: Scaffold Package And Validate Plan

Status: completed

Priority: P1

Suggested agent: scaffold-agent

Dependencies: none

Primary ownership:

- `packages/release-tag/package.json`
- `packages/release-tag/tsconfig.json`
- `packages/release-tag/tsup.config.ts`
- `packages/release-tag/vitest.config.ts`
- `packages/release-tag/src/types.ts` (or `src/plan.ts` if a single plan module is preferred)
- `packages/release-tag/src/index.ts` (plan exports only; stage runners land later)
- `packages/release-tag/test/plan.test.ts` (plus `test/index.test.ts` placeholder if required by vitest include)
- `packages/release-tag/README.md` (scaffold stub; full docs land in RELTAG-05)
- Root `package.json` (one `release-tag` script)
- `tsconfig.base.json` (two path aliases)
- Root `README.md` (Packages + Workspace Layout)
- `website/docs/packages/index.md` + `website/docs/packages/release-tag.md` (minimal page; full guide in RELTAG-05)
- `pnpm-lock.yaml` (via `pnpm install`)

Finding:

No `@repo-toolkit/release-tag` package exists. Existing contract tests in `packages/publish-packages/test/contract.test.ts` require complete membership (root scripts, exports, unique bins, README and website page) as soon as the package is scaffolded.

References:

- `AGENTS.md` (Adding a new package)
- `packages/confluence/package.json` and single-CLI `tsup.config.ts`/`tsconfig.json`/`vitest.config.ts` (template source; inspect before copying)
- `packages/publish-package/src/flags.ts:30-139`
- `packages/publish-package/src/version.ts:39-80`
- `tsconfig.base.json:1-25`
- `package.json:19-42`
- `README.md:7-28`

Implementation requirements:

1. Create the 8-file scaffold with exact placeholder metadata, ESM, `sideEffects false`, one `repo-toolkit-release-tag` bin, and canonical scripts. Copy sibling config files verbatim; do not invent new tsup entries or tsconfig options.
2. Define and export `ReleaseTagOptions` (all optional, `options = {}` default), `ReleaseTagPlan`, and `resolveReleaseTagPlan(options)`. Required option fields (names are contractual for later tasks):
   - `cwd?: string`, `tag?: string`, `baseBranch?: string`, `releaseBranch?: string`
   - `gitExecutable?: string` (default `git`)
   - `gitUserName?: string` (default `github-actions[bot]`), `gitUserEmail?: string` (default `github-actions[bot]@users.noreply.github.com`), `signCommit?: boolean` (default `false`)
   - `releaseCommand?: string` (default `./node_modules/.bin/release-it`), `releaseArgs?: ReadonlyArray<string>` (extra args appended after `<version> --ci`), `skipRelease?: boolean` (default `false`)
   - `githubToken?: string`, `githubTokenFile?: string`, `githubTokenEnv?: string` (default `GITHUB_TOKEN`), `githubRepository?: string`, `githubApiUrl?: string` (default `https://api.github.com`), `autoMergePr?: boolean` (default `false`), `deleteMergedBranch?: boolean` (default `false`), `skipPr?: boolean` (default `false`)
   - `dryRun?: boolean` (default `false`), `only?: ReadonlyArray<string>` (subset of `determine`, `release`, `pr`; default all three)
   - `timeoutMs?: number` (default `60000`), `maxOutputBytes?: number` (default `1048576`)
   - `runner?: CapturingProcessRunner`, `fetchFn?: typeof fetch`
3. Validate strictly in `resolveReleaseTagPlan` without I/O or network: reject non-object options, unknown `only` stages, empty-string `cwd`/`baseBranch`/`releaseBranch`/`gitExecutable`/`releaseCommand`/`githubRepository`/`githubApiUrl`, invalid `githubRepository` shape (must be `owner/repo` with no empty segment, no leading/trailing slash, no whitespace), invalid `githubApiUrl` (must be `http(s)://` with no credentials, no fragment), non-string `releaseArgs` entries, NUL bytes in any string field, non-positive `timeoutMs`/`maxOutputBytes`, invalid runner/fetch shapes. Do not resolve the token value in the plan; record only `tokenSource` metadata (`explicit`, `file`, `env`, `none`) and `tokenAvailable: boolean` after checking env/file presence without embedding the secret. Never put token bytes in the returned plan.
4. Normalize `tag` input: strip at most one leading `v`, then require `X.Y.Z` numeric core via `normalizeReleaseVersion` semantics; reject prerelease/build metadata for the manual override to match `determine-tag.sh` `^[0-9]+\.[0-9]+\.[0-9]+$` contract. Document this as an intentional contract fix versus the shell `${input_tag//v}` (which strips all `v` characters).
5. Default `releaseBranch` to the template `changelog/<version>` where `<version>` is the resolved bare version (without `v`). If `releaseBranch` is explicitly set, validate it is non-empty, contains no whitespace/NUL, and is not `HEAD`. Do not create the branch in this task.
6. Default `baseBranch` resolution is explicitly deferred to runtime (RELTAG-03 reads `git symbolic-ref --short HEAD` or `GITHUB_REF_NAME`); the plan stores the explicit value or `undefined` and later stages resolve it. The plan must include `dryRun`, `only`, `skipRelease`, `skipPr`, `signCommit`, `autoMergePr`, `deleteMergedBranch` booleans with documented defaults.
7. Add root script `"release-tag": "pnpm --filter @repo-toolkit/release-tag... build && node packages/release-tag/dist/cli.js"`, both `tsconfig.base.json` aliases, root README entries, and minimal website page with `sidebar_position` following the most recent package page. Run `pnpm install` to update the lockfile.
8. Export only plan/types from `src/index.ts` in this task; stage functions are added by RELTAG-02/03/04 and the orchestrator/CLI by RELTAG-05. Keep `src/cli.ts` as a help-only stub that still satisfies `parseFlags` null handling and `process.exitCode` conventions, to be completed in RELTAG-05.

Acceptance criteria:

- `pnpm --filter @repo-toolkit/publish-packages test` passes with the new package membership (bins unique, root script present, README/website entries present).
- `resolveReleaseTagPlan({})` returns documented defaults with no token bytes; `resolveReleaseTagPlan({ tag: 'v1.2.3' })` normalizes to `1.2.3`; `tag: '1.2.3.4'`, `tag: 'v1.2'`, `tag: '1.2.3-beta'`, and `tag: 'vv1.2.3'` all throw.
- Invalid `only`, `githubRepository`, `githubApiUrl`, NUL bytes, and bad runner/fetch shapes throw with messages naming the field.
- Token canary test: a fake token in env/file/explicit option never appears in `JSON.stringify(plan)` or thrown error messages.
- Config files are byte-identical to the chosen single-CLI sibling (verified via `diff`).

Verification: V1, V2 (plan tests only), V3.

Completion evidence:

- Changed: `packages/release-tag/{package.json,tsconfig.json,tsup.config.ts,vitest.config.ts,src/plan.ts,src/index.ts,src/cli.ts,test/plan.test.ts,README.md}`, root `package.json`, `tsconfig.base.json`, `README.md`, `website/docs/packages/index.md`, `website/docs/packages/release-tag.md`, `pnpm-lock.yaml`
- Verified: `pnpm lint` pass, `pnpm typecheck` pass, `pnpm --filter @repo-toolkit/release-tag test` 23/23 pass, `pnpm --filter @repo-toolkit/publish-packages test` 85/85 pass; `cmp` byte-identical configs; token canary absent
- Result: scaffold + plan validation complete per RELTAG-01 acceptance criteria
- Follow-up: RELTAG-04 needs explicit token input (plan carries only metadata); RELTAG-05 owns asdf list + full CLI/docs

### Task RELTAG-02: Implement Stage 1 Tag Determination

Status: completed

Priority: P1

Suggested agent: tag-agent

Dependencies: RELTAG-01

Primary ownership:

- `packages/release-tag/src/determine.ts`
- `packages/release-tag/src/index.ts` (additive exports only)
- `packages/release-tag/test/determine.test.ts`

Finding:

The shell `determine-tag.sh` logic (manual validation, `git describe`, `vX.Y.Z` parse, `git log` bump detection) has no TypeScript equivalent. A direct port must preserve the bump regexes while fixing the `//v` strip bug and making git I/O injectable and bounded.

References:

- `<egose-actions-checkout>/release-tag/determine-tag.sh:1-58`
- `packages/publish-package/src/runner.ts:38-73` (`ProcessCaptureOptions`, `ProcessCaptureResult`, `isCapturingProcessRunner`)
- `packages/publish-package/src/version.ts:39-80`
- `packages/docker-publish/src/runner.ts:179-257` (bounded invocation precedent)
- `packages/release-tag/src/types.ts` or `src/plan.ts` from RELTAG-01

Implementation requirements:

1. Export `determineNextTag(input: { plan: ReleaseTagPlan; runner?: CapturingProcessRunner }): Promise<DeterminedTag>` where `DeterminedTag = { version: string; tagVersion: string; bump: 'major'|'minor'|'patch'|null; lastTag: string|null; manual: boolean }`. `bump` is `null` for manual tags. Require a capturing runner (default `defaultProcessRunner`); throw if `capture` is missing.
2. Manual path: when `plan.tag` is set, strip one leading `v`, validate `^[0-9]+\.[0-9]+\.[0-9]+$` (no prerelease/build), return `{ version, tagVersion: 'v'+version, bump: null, lastTag: null, manual: true }`. Error message must name the provided value and state the SemVer contract.
3. Auto path:
   - Run `git describe --tags --abbrev=0` via `runner.capture(gitExecutable, [...], { cwd, timeoutMs })`. On non-zero exit, empty stdout, or spawn error, throw `No previous tag found and no tag input provided. Provide --tag once to seed release history.` Preserve stderr tail (truncated to 2048 chars) without secrets.
   - Parse the last tag with `/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/` on the trimmed first line. On mismatch throw `Last tag '<tag>' does not follow 'vX.Y.Z' format.`
   - Run `git log <lastTag>..HEAD --pretty=format:%B` via capture. Treat capture failure as fatal with truncated stderr. Enforce `maxOutputBytes` on combined stdout/stderr; throw when exceeded.
   - Apply the exact shell bump regexes in order: major if `/(BREAKING CHANGE:|^feat\([^)]*\)!:|^fix\([^)]*\)!:|!:)/m`, else minor if `/^feat(\(.+\))?:/m`, else patch. Use multiline matching. Document that `!:` inside a scope or subject triggers major, matching the shell.
   - Apply the bump with `bumpVersion(lastVersion, bump)` and return `{ version, tagVersion, bump, lastTag, manual: false }`.
4. Never invoke a shell; always use explicit arg arrays. Never log or return commit bodies beyond the bump decision; tests must assert commit canaries do not leak into errors except as truncated git stderr (which is git's own output, not the full log).
5. Handle `dryRun` at the orchestrator level, not here: this function always reads git state (reads are permitted in dry-run). Document that determinism comes from git history, not from cached state.

Acceptance criteria:

- Fake-runner tests cover: manual `1.2.3` and `v1.2.3` success; manual `1.2`, `1.2.3.4`, `1.2.3-beta`, `vv1.2.3`, empty tag errors; auto patch/minor/major bumps with representative commit logs (`fix:`, `feat:`, `feat(api):`, `feat!:`, `fix(api)!:`, `BREAKING CHANGE:`); last-tag parse failure; missing previous tag with guidance; `git log` failure; output-overflow refusal.
- A regression test fails on the old shell `${input_tag//v}` semantics (e.g. input `v1.2.3` with a `v` inside a prerelease is rejected, and `1.2.3` containing no `v` is unaffected) and passes with single-prefix stripping.
- No test spawns a real git executable or touches the network.

Verification: V1, V2.

Completion evidence:

- Changed: `packages/release-tag/src/determine.ts`, `packages/release-tag/src/index.ts` (additive), `packages/release-tag/test/determine.test.ts`
- Verified: `pnpm lint` pass, `pnpm typecheck` pass, `pnpm --filter @repo-toolkit/release-tag test` 47/47 pass (23 plan + 24 determine)
- Result: stage 1 tag determination complete; exact shell bump regexes ported; single-v fix verified; commit canaries absent from errors
- Follow-up: RELTAG-05 must document `!:` quirk and dry-run split in README/website; RELTAG-06 to review leading-zero strictness and describe output-limit defense-in-depth

### Task RELTAG-03: Implement Stage 2 Release Branch And Release Command

Status: completed

Priority: P1

Suggested agent: release-agent

Dependencies: RELTAG-01, RELTAG-02

Primary ownership:

- `packages/release-tag/src/release.ts`
- `packages/release-tag/src/git.ts` (shared git helpers if needed; otherwise keep in `release.ts`)
- `packages/release-tag/src/index.ts` (additive exports only)
- `packages/release-tag/test/release.test.ts`

Finding:

The shell `create-release-pr-branch.sh` branch-reset and `release-it` invocation logic has no TypeScript equivalent. It must be ported with explicit-arg subprocess calls, conditional release execution, and dry-run support.

References:

- `<egose-actions-checkout>/release-tag/create-release-pr-branch.sh:57-88`
- `<egose-actions-checkout>/release-tag/action.yml:47-75` (branch guard + env bindings)
- `packages/publish-package/src/runner.ts:19-73`
- `packages/docker-publish/src/runner.ts:324-379` (error redaction precedent)

Implementation requirements:

1. Export `runReleaseBranch(input: { plan: ReleaseTagPlan; determined: DeterminedTag; runner?: CapturingProcessRunner }): Promise<ReleaseBranchResult>` where `ReleaseBranchResult = { baseBranch: string; releaseBranch: string; releaseRan: boolean; skippedReason: string|null; tagMessage: string; prTitle: string }`. `prTitle` is always `chore(release): release candidate <tagVersion>`. `tagMessage` is the annotated tag contents (may be empty string).
2. Resolve `baseBranch`: explicit `plan.baseBranch` wins; else `process.env.GITHUB_REF_NAME` when non-empty; else `git symbolic-ref --short HEAD` via capture (trimmed first line). If the resolved value is empty, `HEAD`, or starts with `refs/tags/` or `v` matching a tag shape, throw `This workflow must be run on a branch, not a tag.` If git reports detached HEAD (non-zero exit), throw the same branch-guard error with the git stderr tail. Never accept a tag as the base.
3. Configure the author via `git config user.name <name>` and `git config user.email <email>` using explicit args. When `plan.signCommit` is true, also run `git config commit.gpgsign true`. Do not import GPG keys, do not set `user.signingkey`, do not write to `~/.gnupg` in v1. Document that the runner must already have a usable secret key.
4. Reset the release branch in order, each as an explicit-arg call with `cwd` and `timeoutMs`:
   - `git push origin --delete <branch>` — ignore failure (best-effort cleanup, matching `|| true`).
   - `git branch -D <branch>` — ignore failure.
   - `git checkout -b <branch>` — fatal on failure.
   - `git push --set-upstream origin <branch>` — fatal on failure.
     Record the exact invocation sequence for tests via the fake runner.
5. Determine release availability: if `plan.skipRelease` is true, skip with `skippedReason: 'skipped via skipRelease'`. Else if `plan.only` does not include `release`, skip with `skippedReason: 'stage not selected'`. Else check the release command is available: when `releaseCommand` contains `/`, use `node:fs/promises.access(path, X_OK)` resolved against `cwd` (missing/not-executable means unavailable); when it is a bare name, run `<cmd> --version` via capture with a short timeout and treat non-zero/spawn-error as unavailable. When unavailable, skip with `skippedReason: 'release command not available: <cmd>'` without failing. Do not attempt to run a missing executable.
6. When available and selected: run `<releaseCommand> <version> --ci [...releaseArgs]` plus `--git.commitArgs=--gpg-sign` when `signCommit` is true. Use `runner.run` (inheriting stdio) or `runner.capture`? Use `runner.run` for the release command to stream output, and `runner.capture` for git plumbing. If the provided runner only implements `run` without `capture`, throw early (stage 2 requires capture for git reads). On release-command failure, throw with the redacted command label and duration; do not proceed to push/tag-read.
7. After a successful release run (or when skipped? No — only after run OR when skipped but branch exists): always `git push origin <branch>` (fatal on failure), then read `git tag -l --format=%(contents) <tagVersion>` via capture (tolerate empty output; fatal on spawn failure). When `skipRelease` is true, still create/push the branch and read the tag message (which may be empty because no release ran); this matches `if release is available, it runs the release command in release branch` — the branch always exists, the command is conditional.
8. When `plan.dryRun` is true: perform no mutations. Validate the resolved base/branch names and release-command availability check only (read-only `access` or `--version` probe is permitted? No — even the probe spawns a process; in dry-run, report `releaseRan: false`, `skippedReason: 'dry-run'`, `tagMessage: ''` without invoking the runner at all). Tests must assert zero runner invocations in dry-run.

Acceptance criteria:

- Fake-runner tests cover: base-branch explicit/env/git-symbolic resolution; detached-HEAD/tag-base rejection; author config sequence; branch-reset order with ignored delete failures and fatal checkout/push failures; `skipRelease` skip with branch still created; missing release command skip with reason; bare-name `--version` probe success/failure; release-it args with and without `--gpg-sign`; post-release push + tag-message read (including empty message); dry-run zero-invocation.
- `signCommit: true` never writes outside `cwd` and never touches `HOME/.gnupg` (assert via temp `HOME` and file-watcher or by asserting only git-config invocations).
- No test spawns real git/release-it or touches the network.

Verification: V1, V2.

Completion evidence:

- Changed: `packages/release-tag/src/release.ts`, `packages/release-tag/src/index.ts` (additive), `packages/release-tag/test/release.test.ts`
- Verified: `pnpm lint` pass, `pnpm typecheck` pass, `pnpm --filter @repo-toolkit/release-tag test` 96/96 pass (23 plan + 24 determine + 49 release)
- Result: stage 2 branch reset + conditional release execution complete; dry-run zero invocations; no HOME writes
- Follow-up: RELTAG-05 must document dry-run baseBranch requirement and 10s bare-name probe cap

### Task RELTAG-04: Implement Stage 3 GitHub PR Creation

Status: completed

Priority: P1

Suggested agent: pr-agent

Dependencies: RELTAG-01, RELTAG-02

Primary ownership:

- `packages/release-tag/src/pull-request.ts`
- `packages/release-tag/src/github.ts` (API client helpers if needed; otherwise keep in `pull-request.ts`)
- `packages/release-tag/src/index.ts` (additive exports only)
- `packages/release-tag/test/pull-request.test.ts`

Finding:

The `github-script` PR-create/label/merge/delete block in `action.yml` has no TypeScript equivalent. It must be ported to `fetch` with env-only auth, redaction, bounded responses, and conditional execution.

References:

- `<egose-actions-checkout>/release-tag/action.yml:77-132`
- `<egose-actions-checkout>/release-tag/create-release-pr-branch.sh:81-88` (title/body contract)
- `packages/confluence/src/cli.ts:324-350` (secret-file precedent)
- `packages/confluence/src/confluence-client.ts` (fetch + auth + error-shape precedent; inspect before implementing)
- `packages/publish-package/src/version.ts:92-100` (`redactSensitiveValues`)

Implementation requirements:

1. Export `createReleasePullRequest(input: { plan: ReleaseTagPlan; determined: DeterminedTag; release: ReleaseBranchResult; fetchFn?: typeof fetch }): Promise<PullRequestResult>` where `PullRequestResult = { skipped: boolean; skippedReason: string|null; number: number|null; url: string|null; merged: boolean; branchDeleted: boolean }`.
2. Skip without network when: `plan.skipPr` is true (`skippedReason: 'skipped via skipPr'`), `plan.only` excludes `pr` (`skippedReason: 'stage not selected'`), no token is available from explicit option, token file, or `githubTokenEnv` (`skippedReason: 'github token not available'`), or `plan.dryRun` is true (`skippedReason: 'dry-run'`). Token resolution order: explicit `githubToken` > `githubTokenFile` contents (trimmed, must be non-empty, read relative to `cwd`) > `process.env[githubTokenEnv]`. Never log or return the token; pass it only in the `Authorization: Bearer` header.
3. Resolve `owner/repo`: explicit `plan.githubRepository` wins; else `process.env.GITHUB_REPOSITORY` when it matches `owner/repo`; else throw `githubRepository is required (explicit --github-repository or GITHUB_REPOSITORY).` Do not parse `git remote` URLs in v1. Validate no empty segments, no whitespace, no extra slashes.
4. Build the PR body with the exact template: `### Release Candidate Details\n\n<tagMessage>\n\n---\n\n> This PR was automatically generated.` where `<tagMessage>` is `release.tagMessage` (may be empty). Title is `release.prTitle`. Labels are always `['changelog', 'release-candidate', determined.tagVersion]`.
5. Call GitHub REST with `fetchFn` (default `globalThis.fetch`), base `plan.githubApiUrl` (default `https://api.github.com`, trailing slashes trimmed), headers `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: repo-toolkit-release-tag`, `Content-Type: application/json`, `Authorization: Bearer <token>`:
   - `POST /repos/{owner}/{repo}/pulls` with `{ head: releaseBranch, base: baseBranch, title, body }`. Require 201/200 with numeric `number` and string `html_url`; else throw with redacted status + truncated body (max 2048 chars).
   - `POST /repos/{owner}/{repo}/issues/{number}/labels` with `{ labels }`. Non-2xx is fatal with redacted diagnostics.
   - When `autoMergePr` is true: `PUT /repos/{owner}/{repo}/pulls/{number}/merge` with `{ merge_method: 'merge' }`. Non-2xx (including branch-protection 405/422) is fatal; do not swallow merge failures.
   - When `autoMergePr` and `deleteMergedBranch` are both true and merge succeeded: `DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}` (branch segment URL-encoded per segment, preserving slashes as `%2F`? No — encode the full ref path after `heads/` with `encodeURIComponent` per segment joined by `/`). Non-2xx is fatal.
   - When `autoMergePr` is false, `deleteMergedBranch` is ignored (never delete without a successful merge), matching the shell contract.
6. Enforce `timeoutMs` via `AbortSignal.timeout(timeoutMs)` and `maxOutputBytes`/`maxResponseBytes` by reading `response.text()` and refusing bodies over the limit (default 256 KiB for PR responses; reuse `plan.maxOutputBytes` capped to 1 MiB). Redact the token and any `://...@` URL credentials in all thrown errors. Never retry auth/validation failures; no automatic retries in v1.
7. Export a pure `formatPullRequestBody(tagMessage: string): string` helper for the template, unit-tested independently.

Acceptance criteria:

- Fake-fetch tests cover: all four skip reasons with zero fetch calls; token resolution order (explicit > file > env > none) plus empty-file error; repository resolution explicit/env/missing; exact body template with empty and multiline tag messages; PR-create success + labels call shapes/headers (assert `Authorization` present but redacted in errors); create-failure (401/422) with redacted diagnostics; auto-merge success/failure; delete-after-merge success and ignored-when-no-merge; oversized-response refusal; timeout abort.
- Token canary test: a fake token never appears in results, thrown messages, or captured logs; `redactSensitiveValues` is applied to every error path.
- No test touches the real network or requires `GITHUB_TOKEN`.

Verification: V1, V2.

Completion evidence:

- Changed: `packages/release-tag/src/pull-request.ts`, `packages/release-tag/src/index.ts` (additive), `packages/release-tag/test/pull-request.test.ts`
- Verified: `pnpm lint` pass, `pnpm typecheck` pass, `pnpm --filter @repo-toolkit/release-tag test` 133/133 pass (96 prior + 37 new)
- Result: stage 3 PR create/label/merge/delete complete with exact template; token redacted on all paths; skips without network
- Follow-up: RELTAG-05 must document skip order (dry-run before token-missing), empty token-file throws without fallback, and response cap min(plan.maxOutputBytes, 1MiB); RELTAG-06 to confirm 256KiB vs 1MiB default

### Task RELTAG-05: Orchestrator CLI And Docs

Status: completed

Priority: P1

Suggested agent: cli-agent

Dependencies: RELTAG-02, RELTAG-03, RELTAG-04

Primary ownership:

- `packages/release-tag/src/index.ts` (orchestrator exports)
- `packages/release-tag/src/run.ts` (or `src/orchestrator.ts`; one module for `runReleaseTag`)
- `packages/release-tag/src/cli.ts` (complete the stub from RELTAG-01)
- `packages/release-tag/test/run.test.ts` + `packages/release-tag/test/cli.test.ts`
- `packages/release-tag/README.md` (full concise docs)
- `website/docs/packages/release-tag.md` (full guide)
- Root `README.md` asdf command list (add `repo-toolkit-release-tag`)

Finding:

Stage modules without an orchestrator and thin CLI cannot be invoked end to end. The CLI must follow `parseFlags` conventions, support distinct-stage execution, and keep secrets out of argv/output.

References:

- `packages/docker-publish/src/cli.ts:24-77` (flag table + dry-run precedent)
- `packages/confluence/src/cli.ts:20-125` (env/config/flag precedence + secret-file + help text)
- `packages/secret-sync/src/cli.ts:91-201` (exit-code + redaction precedent)
- `packages/publish-package/src/flags.ts:30-139`
- `packages/go-release/README.md:1-66` (concise README precedent)

Implementation requirements:

1. Export `runReleaseTag(options: ReleaseTagOptions = {}): Promise<ReleaseTagResult>` where `ReleaseTagResult = { plan: ReleaseTagPlan; determined: DeterminedTag | null; release: ReleaseBranchResult | null; pullRequest: PullRequestResult | null }`. Behavior: resolve the plan, then run selected stages in order `determine` -> `release` -> `pr`. `only` filters which stages run; unselected stages yield `null` results. `skipRelease`/`skipPr` still invoke the stage function (which returns a skipped result) rather than yielding `null`, so callers can distinguish `not selected` from `selected but skipped`. On any stage throw, propagate with redacted message and stop subsequent stages. Never include token bytes in the result.
2. Support `only` as CLI `--only <stage>[,...]` (list flag, repeatable, comma-split) with values `determine`, `release`, `pr`. Default (flag absent) runs all three. `--skip-release`/`--skip-pr` are boolean conveniences that set the corresponding plan flags. `--dry-run` resolves and prints the plan without mutations or network (stages return skipped/dry-run results; stage 1 git reads are still permitted? No — for CLI dry-run, skip even stage 1 git reads and report `determined: null` with a `dryRun` plan summary, so `--dry-run` never spawns processes. Library callers that need stage-1 reads in dry-run can call `determineNextTag` directly. Document this split clearly.)
3. Define `SPECS: FlagSpec[]` with: `tag`, `cwd`, `base-branch`, `release-branch`, `git-executable`, `release-command`, `release-it-path` (alias that maps to `releaseCommand` for action-parity; last writer wins with `release-command`), `git-user-name`, `git-user-email`, `sign-commit` (boolean, negatable), `github-token`, `github-token-file`, `github-token-env`, `github-repository`, `github-api-url`, `auto-merge-pr` (boolean), `delete-merged-branch` (boolean), `skip-release` (boolean), `skip-pr` (boolean), `only` (list), `dry-run` (boolean), `json` (boolean). No positional args. Strict mode (unknown args throw). `-h/--help` prints help and returns.
4. Implement `printHelp()` documenting usage, the three stages, conditional skips, env vars (`GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_REF_NAME`, `GITHUB_API_URL` as fallback for `githubApiUrl`?), secret-file preference (`--github-token-file` over `--github-token` to avoid argv exposure), and examples. Read `GITHUB_API_URL` as a fallback for `githubApiUrl` when the flag/option is absent (GitHub Enterprise parity), but explicit config wins. Document precedence: CLI flag > explicit option > env > built-in default.
5. Output: human text by default (stage summaries with versions/branches/PR URLs/skip reasons), `--json` prints a single JSON object with schema version, plan summary (no secrets), and per-stage results. Errors print the redacted message to stderr and set `process.exitCode = 1`. `--dry-run` prints the resolved plan summary (no secrets) and exits 0 without invoking runners/fetch.
6. Complete `README.md` (concise: install, CLI table, library exports, env vars, stage contracts, CI example) and `website/docs/packages/release-tag.md` (full guide: versioning rules, branch naming, release-command contract, PR template/labels, auto-merge/delete semantics, GPG notes, troubleshooting, migration from `egose/actions/release-tag`). Add `repo-toolkit-release-tag` to the root README asdf command list.

Acceptance criteria:

- CLI tests (spawned via `node dist/cli.js` with fake env, or via extracted `buildOptions` + `runReleaseTag` with injected fakes) cover: `--help` exit 0; unknown arg exit 1; `--only determine` runs only stage 1; `--skip-release`/`--skip-pr` yield skipped results; `--dry-run` performs zero runner/fetch invocations; `--json` output parses and contains no token canary; `--release-it-path` maps to `releaseCommand`; `--no-sign-commit` negates.
- End-to-end orchestrator test with fake runner + fake fetch: manual tag `1.2.3` produces branch `changelog/1.2.3`, release args `[1.2.3, --ci]`, PR title `chore(release): release candidate v1.2.3`, labels `['changelog','release-candidate','v1.2.3']`, and merge/delete when enabled.
- Docs membership still passes V3; website page renders (no broken frontmatter).

Verification: V1, V2, V3.

Completion evidence:

- Changed: `packages/release-tag/src/run.ts`, `packages/release-tag/src/cli.ts`, `packages/release-tag/src/index.ts` (additive), `packages/release-tag/test/run.test.ts`, `packages/release-tag/test/cli.test.ts`, `packages/release-tag/README.md`, `website/docs/packages/release-tag.md`, root `README.md` (asdf list)
- Verified: `pnpm lint` pass, `pnpm typecheck` pass, `pnpm --filter @repo-toolkit/release-tag test` 169/169 pass (133 prior + 36 new), `pnpm --filter @repo-toolkit/publish-packages test` 85/85 pass
- Result: orchestrator + CLI + docs complete; only-vs-skip distinction, dry-run zero invocations, json canary-free, E2E fake-runner PR flow verified
- Follow-up: RELTAG-06 to confirm response-cap default, leading-zero strictness, only-prefix and dry-run nulls policies, and run V4 packed smoke

### Task RELTAG-06: Final Integration Review

Status: completed

Priority: P2

Suggested agent: review-agent (must not be the RELTAG-05 implementer)

Dependencies: RELTAG-05

Primary ownership: review-only; may fix blocking defects in place but must record every change as follow-up evidence rather than silent rewrites.

Finding:

To be determined by the reviewer. This task verifies the whole package against the contracts in RELTAG-01 through RELTAG-05 and the reference action behavior.

References:

- This file (all prior tasks)
- `<egose-actions-checkout>/release-tag/*` (reference behavior)
- `AGENTS.md` (verification + conventions)

Implementation requirements:

1. Verify each acceptance criterion against runtime behavior: run V1/V2/V3/V4, inspect `dist/` outputs, run the packed bin in a disposable directory, and exercise `--help`, `--dry-run`, `--only`, and `--json` paths.
2. Verify security boundaries: token never in argv-required paths (warn when `--github-token` is used), never in plans/results/errors/logs; `redactSensitiveValues` on every error path; no `~/.gnupg` writes; no shell invocation (`runShell` must not be used); NUL/whitespace/path validation on all string inputs; bounded git/fetch outputs with timeouts.
3. Verify public types, docs, and implementation agree: `ReleaseTagOptions`/`ReleaseTagPlan`/`ReleaseTagResult` field names match README + website + help text; `releaseBranch` template, PR title/body template, label set, and bump regexes match the reference action (except the documented `//v` fix).
4. Verify no internal data crosses external boundaries: commit bodies, tag messages, and branch names are only sent to the intended git/GitHub calls; JSON output contains no secrets; dry-run performs zero mutations/network.
5. Record any deferred work with rationale and residual risk; file follow-up tasks (e.g. RELTAG-07 GPG import) when new scope is discovered rather than expanding this review.

Acceptance criteria:

- All V1/V2/V3/V4 checks pass from a clean tree after `pnpm install`.
- Reviewer attests each RELTAG-01 through RELTAG-05 acceptance criterion passes, or files a blocking follow-up with exact reproduction.
- No unresolved `blocked` statuses remain without a named owner and prerequisite.

Verification: V1, V2, V3, V4.

Completion evidence:

- Changed: none (review-only)
- Verified: `pnpm lint` pass, `pnpm typecheck` pass, `pnpm build` pass, `pnpm --filter @repo-toolkit/release-tag test` 169/169 pass, `pnpm --filter @repo-toolkit/publish-packages test` 85/85 pass, `pnpm --filter @repo-toolkit/release-artifact test` 101/101 pass; packed tarball + npm-installed bin smoke in `<temp-dir>`; real-git temp-repo E2E for minor/major/manual paths
- Result: PASS — all RELTAG-01 through RELTAG-05 acceptance criteria attested; response-cap follow-up resolved as min(plan.maxOutputBytes, 1MiB); no blocking defects
- Follow-up: RELTAG-07 GPG import and GHES live contract remain deferred non-goals; website Docusaurus build not run per AGENTS.md separation (frontmatter verified)

## Dependency And Parallelization Guidance

- RELTAG-01 must land first; it owns the scaffold, plan contract, and workspace membership that all later tasks import.
- RELTAG-02 must land before RELTAG-03/04; the `DeterminedTag` shape and version/branch contracts are load-bearing for both downstream stages.
- RELTAG-03 and RELTAG-04 may run in parallel after RELTAG-02 only when: neither changes the other's owned files, `src/index.ts` edits are strictly additive exports (no reordering), and tests are not run concurrently with builds that rebuild shared outputs. Default recommendation is sequential (03 then 04) to avoid `index.ts` merge conflicts.
- RELTAG-05 requires RELTAG-02/03/04 and owns the orchestrator/CLI/docs integration; do not start it early.
- RELTAG-06 must be assigned to a different agent/session than RELTAG-05 and must run last.
- Shared hotspots: `src/index.ts` (additive only), `src/types.ts`/`src/plan.ts` (frozen after RELTAG-01 except for documented fixes), root `package.json`/`README.md`/`tsconfig.base.json` (RELTAG-01 only), website index (RELTAG-01 structure, RELTAG-05 content).

Recommended agent allocation for sequential execution (user-requested one-by-one):

| Order | Task      | Agent          | Depends on                      |
| ----- | --------- | -------------- | ------------------------------- |
| 1     | RELTAG-01 | scaffold-agent | none                            |
| 2     | RELTAG-02 | tag-agent      | RELTAG-01                       |
| 3     | RELTAG-03 | release-agent  | RELTAG-01, RELTAG-02            |
| 4     | RELTAG-04 | pr-agent       | RELTAG-01, RELTAG-02            |
| 5     | RELTAG-05 | cli-agent      | RELTAG-02, RELTAG-03, RELTAG-04 |
| 6     | RELTAG-06 | review-agent   | RELTAG-05                       |

## Deferred Decisions Requiring Maintainer Input

1. **Package name**: `release-tag` is assumed from the reference action name. If `release-pr` or `release-candidate` is preferred, rename the directory, package name, bin, aliases, scripts, and docs together before RELTAG-01 lands. Owner: maintainer. Blocks RELTAG-01 naming only.
2. **GPG import scope**: v1 deliberately omits `gpg-private-key`/`gpg-passphrase` import (RELTAG-07 follow-up). If signing with ephemeral keys is required for v1, the plan must add env-only key handling, `0700`/`0600` state, redaction, and fake-gpg tests. Owner: maintainer. Does not block RELTAG-01 through RELTAG-06.
3. **Generic release command vs release-it only**: v1 defaults to `release-it` but accepts any executable via `releaseCommand`/`releaseArgs`. If only `release-it` should ever be supported, remove `releaseArgs` and rename to `releaseItPath` in RELTAG-01. Owner: maintainer. Decide before RELTAG-03.
4. **GitHub Enterprise auth**: v1 supports `githubApiUrl` override plus `GITHUB_API_URL` fallback but does not test against a live GHES instance. If GHES parity must be claimed, add a live-contract task with a disposable repo. Owner: maintainer. Does not block unit-tested v1.

## Final Integration And Definition Of Done

The package is done when:

- RELTAG-01 through RELTAG-05 are `completed` with evidence (changed paths, commands/results, follow-ups).
- RELTAG-06 is `completed` by an independent reviewer with V1/V2/V3/V4 passing.
- `pnpm lint`, `pnpm typecheck`, `pnpm --filter @repo-toolkit/release-tag test`, `pnpm --filter @repo-toolkit/publish-packages test`, and `pnpm build` all pass from the repository root.
- The packed artifact exposes `repo-toolkit-release-tag` with working `--help`, `--dry-run`, `--only`, and `--json` paths, and `release-artifact` auto-discovery picks up the new bin via existing tests.
- No token, GPG, or commit-body secrets leak into plans, results, errors, logs, or JSON output.
- Docs (package README + website page + root README + website index) agree with the implementation and help text.
- No `dist/` artifacts are committed; no unrelated work is reverted; no code comments were added unless requested.
- Deferred work (if any) is recorded with rationale, risk, and a follow-up task number.

## Quality Checklist (Planning Revision)

- Filename has a generated sortable timestamp: `20261009-091644-release-tag-package.md`.
- Objective, scope, working rules, and non-goals are explicit.
- Reference findings have file:line evidence.
- Each task has status, priority, suggested agent, dependencies, ownership, finding, references, requirements, and acceptance criteria.
- Shared-file conflicts are sequenced; default execution is sequential per user request.
- Verification commands are repository-correct (V1–V4).
- The `//v` contract fix and GPG-import deferral are explicit.
- Unresolved decisions are collected rather than guessed.
- Final integration and definition of done are present.
- Another agent can execute each task without the original conversation.
