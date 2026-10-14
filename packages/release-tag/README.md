# `@repo-toolkit/release-tag`

Determine the next `X.Y.Z` release tag from Conventional Commits, run the release command on a `changelog/<version>` branch, and open a GitHub release pull request.

Ports `egose/actions/release-tag` into a testable TypeScript package with injectable runners and fetch. The full guide lives at <https://repo-toolkit.pages.dev/docs/packages/release-tag>.

## Installation

```sh
pnpm add -D @repo-toolkit/release-tag
```

Requires Node.js 20 or newer and `git` on `PATH` for the release stage. No runtime dependencies beyond `@repo-toolkit/publish-package`.

## CLI

```sh
repo-toolkit-release-tag --tag 1.2.3 --base-branch main
repo-toolkit-release-tag --only determine
repo-toolkit-release-tag --dry-run --json
```

| Option                                                 | Purpose                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `--tag <version>`                                      | Manual `X.Y.Z` with an optional single leading `v`; no prerelease              |
| `--cwd <path>`                                         | Working directory (default: `process.cwd()`)                                   |
| `--base-branch <name>`                                 | Base branch; falls back to `GITHUB_REF_NAME` then `git symbolic-ref`           |
| `--release-branch <name>`                              | Release branch (default: `changelog/<version>`)                                |
| `--git-executable <path>`                              | Git executable (default: `git`)                                                |
| `--release-command <path>`                             | Release executable (default: `./node_modules/.bin/release-it`)                 |
| `--release-it-path <path>`                             | Alias for `--release-command`; last writer wins                                |
| `--release-arg <value>`                                | Repeatable raw release argument; commas preserved (use `--release-arg=--flag`) |
| `--timeout-ms <integer>`                               | Per-process/request deadline (default: `60000`; range `1..2147483647`)         |
| `--max-output-bytes <integer>`                         | Combined child output cap (default: `1048576`; positive safe integer)          |
| `--git-user-name <name>`                               | Git author name (default: `github-actions[bot]`)                               |
| `--git-user-email <email>`                             | Git author email (default: `github-actions[bot]@users.noreply.github.com`)     |
| `--sign-commit` / `--no-sign-commit`                   | Set `commit.gpgsign=true` and pass `--gpg-sign` (default: off)                 |
| `--github-token <value>`                               | Inline token (prefer `--github-token-file`)                                    |
| `--github-token-file <path>`                           | File whose trimmed contents are the token, relative to `--cwd`                 |
| `--github-token-env <name>`                            | Env var holding the token (default: `GITHUB_TOKEN`)                            |
| `--github-repository <o/r>`                            | `owner/repo`; falls back to `GITHUB_REPOSITORY`                                |
| `--github-api-url <url>`                               | API base; falls back to `GITHUB_API_URL` (default: `https://api.github.com`)   |
| `--auto-merge-pr`                                      | Immediately merge the release PR using a validated, pinned head SHA            |
| `--merge-method <method>`                              | Immediate merge method: `merge` (default), `squash`, or `rebase`               |
| `--delete-merged-branch`                               | Delete the branch after a successful merge (requires `--auto-merge-pr`)        |
| `--skip-release`                                       | Create and push the branch but skip the release command                        |
| `--reset-release-branch` / `--no-reset-release-branch` | Intentionally reset an existing release branch (default: off)                  |
| `--allow-empty-release` / `--no-allow-empty-release`   | Patch-bump on an empty range instead of `noChanges` (default: off)             |
| `--skip-pr`                                            | Skip pull request creation                                                     |
| `--skip-preflight`                                     | Skip the fail-fast git-auth and token-permission checks                        |
| `--only <stage>[,...]`                                 | Stage prefix or `pr`-only recovery (repeatable, comma-split)                   |
| `--dry-run`                                            | Print the plan summary without processes or network; `determined` is null      |
| `--json`                                               | Print one schema-1 JSON object; children cannot write to stdout                |
| `-h, --help`                                           | Show help                                                                      |

Precedence per option: CLI flag > explicit option > environment > built-in default. Only `githubApiUrl` reads an env fallback (`GITHUB_API_URL`); `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, and `GITHUB_REF_NAME` are read by the plan and stages at runtime.

Prefer `--github-token-file` over `--github-token` to keep the token out of argv and process listings. The CLI warns on stderr when `--github-token` is used. Known explicit/environment credentials and the active file token are redacted from diagnostics, output snapshots, and PR descriptions; raw error causes and caller transport objects are excluded. Parse failures also redact every `--github-token` value (space and equals forms, including overridden repeats) and the referenced custom-env values.

`--dry-run` never spawns processes or touches the network. It reports `determined: null` even when a manual `--tag` is given. Library callers that need stage-1 git reads in a dry-run can call `determineNextTag` directly; automatic determination reads Git, while a manual tag requires no Git reads. Invalid stage selections fail identically in dry-run and execution.

Numeric flags use decimal digits only (`1..2147483647` for `--timeout-ms`, positive safe integers for `--max-output-bytes`): no blanks, signs, leading zeros, fractions, exponents, or hexadecimal. `--release-arg` is repeatable and raw: commas are preserved and dash-leading values require the equals form (`--release-arg=--flag=value`).

`--only pr --tag X.Y.Z --base-branch main` runs read-only PR recovery from the existing local target tag and matching release branch. It never configures Git, checks out, resets, pushes, creates tags, or runs the release command. See [PR-only recovery notes](../../docs/release-tag-review-notes.md#rtr-07-pr-only-recovery-and-thin-cli).

`--json` prints exactly one schema-1 object (`schemaVersion`, `plan`, `determined`, `release`, `pullRequest`). Schema 1 is retained because RTR-02 through RTR-07 only add optional/backward-compatible fields (`releasedHead`, `reused`, `noChanges`, `allowEmptyRelease`, `resetReleaseBranch`, `mergeMethod`); no existing field changed shape.

## Library

```ts
import {
  createReleasePullRequest,
  determineNextTag,
  resolveReleaseTagPlan,
  runReleaseBranch,
  runReleaseTag,
} from '@repo-toolkit/release-tag';

const outcome = await runReleaseTag({ tag: 'v1.2.3', baseBranch: 'main' });
```

Exports: `resolveReleaseTagPlan`, `runReleaseTag`, `determineNextTag`, `runReleaseBranch`, `createReleasePullRequest`, `runPreflight`, `formatPullRequestBody`, plus `ReleaseTagOptions`, `ReleaseTagPlan`, `ReleaseTagResult`, `ReleaseTagStage`, `ReleaseTagMergeMethod`, `ReleaseTagTokenSource`, `DeterminedTag`, `ReleaseBranchResult`, `PullRequestResult`, `PreflightResult` types. All runners accept `options = {}` defaults; `runner` and `fetchFn` are injectable for tests.

`runReleaseTag` resolves the plan, then runs `determine` -> `release` -> `pr` in order. `only` filters which stages run; unselected stages yield `null`. A determination with `noChanges: true` also yields `release: null` and `pullRequest: null`, bypassing all preflight, runtime base/ref checks, token-file resolution, and downstream work. Otherwise, `skipRelease` and `skipPr` still invoke their stage, which returns a skipped result. Release requires `determine`; `pr` requires `determine` and `release`, except `only: ['pr']` with explicit `tag` and `baseBranch`, which runs read-only recovery. Other subsets throw before I/O, including in dry-run. Errors propagate with the token redacted and stop subsequent stages.

Library option `allowEmptyRelease?: boolean` defaults to `false`: an empty commit range returns the current version/tag with `bump: null`, `manual: false`, and `noChanges: true`. Set it to `true` (CLI `--allow-empty-release` / `--no-allow-empty-release`) to request the old empty-range patch increment. Manual versions are always explicit release requests with `noChanges: false`. `DeterminedTag.noChanges` is a required boolean; direct-stage callers should inspect it before invoking downstream stages. No-change CLI output reports `release`/`pullRequest` as skipped (no changes) in text and `null` in JSON.

Library option `resetReleaseBranch?: boolean` defaults to `false`. Set it to `true` (CLI `--reset-release-branch` / `--no-reset-release-branch`) only for an intentional restart after inspecting existing release-branch work; remote updates use an explicit observed-ref lease. `ReleaseBranchResult.releasedHead?: string` contains the verified full commit ID after an executed release succeeds; preparation-only, excluded, and dry-run results omit it. Recovery ignores this flag and never resets.

Library option `mergeMethod?: 'merge' | 'squash' | 'rebase'` defaults to `'merge'` (CLI `--merge-method`) and is validated at plan, CLI, and direct-stage boundaries. `autoMergePr` performs an immediate REST merge; it does not queue GitHub auto-merge or satisfy required reviews/checks. `PullRequestResult.reused` is true for an existing or concurrently created matching PR, and false for a new creation or skipped stage.

Preflight checks Git authentication before release mutations. It preserves `GIT_SSH_COMMAND`, `GIT_SSH`, and Git's `core.sshCommand` (including the deploy key configured by `actions/checkout`). The default `ssh -o BatchMode=yes` is used only when no SSH override is configured; Git terminal prompts are disabled and the probe is bounded by `timeoutMs`.

Token preflight reads the repository metadata and accepts `permissions.push: true`. When that user-permission flag is absent or false, it confirms an App installation token with a read-only `HEAD /installation/repositories?per_page=1` probe. This supports the built-in Actions `GITHUB_TOKEN`; its endpoint-specific write permissions come from the workflow's `permissions` block and are enforced by GitHub when creating, labeling, or merging the PR. Read-only personal tokens still fail preflight.

Every package-owned Git, availability-probe, and release process now uses asynchronous capture with a **combined raw stdout/stderr limit** (`maxOutputBytes`, default 1 MiB) and a **per-command deadline** (`timeoutMs`, default 60,000 ms; integer range 1–2,147,483,647). Release output is not forwarded to stdout; failures include bounded diagnostics. All children receive `GIT_TERMINAL_PROMPT=0`, preserving SSH identity overrides. On POSIX, timeout/overflow terminates the process group, escalating from SIGTERM to SIGKILL after 250 ms, with a further 1 s cleanup allowance. See [process contract notes](../../docs/release-tag-review-notes.md#rtr-03-bounded-captured-process-execution) for platform and cleanup limits.

Injected `CapturingProcessRunner` implementations must handle **every invocation through `capture`**, including the release command; `run`/`runShell` are unused. Capture receives `timeoutMs`, `stdio: 'pipe'`, environment overrides, and an additional `maxOutputBytes` option. The custom transport owns streaming limits, non-interactive environment handling, cancellation, and child cleanup. The boundary validates returned shapes, combined UTF-8 bytes, and elapsed time after completion; it cannot interrupt a custom function or cancel an arbitrary pending promise. Configure the limits with library `timeoutMs`/`maxOutputBytes` or CLI `--timeout-ms`/`--max-output-bytes`.

Credentials are resolved lazily once per orchestration and stay pinned through preflight, release, and PR work, even if the token file or environment rotates. Plans and skipped/dry-run credential paths do not open token files. Direct stages accept an optional `githubToken` on their **stage input**, including `determineNextTag` and `runReleaseBranch`; a token passed only to plan resolution is never retained for later execution. Returned orchestration plans are sanitized data snapshots. Resolved execution plans retain operational values and nonenumerable transports, with safe resolved-time JSON/inspection snapshots; redaction does not alter Git arguments or PR head/base identities.

GitHub responses are read as byte streams with a `min(maxOutputBytes, 1 MiB)` cap and a deadline covering fetch **and body reads**. Overflow/failure cancels the reader and aborts the request; authenticated redirects are disabled. API bases use HTTPS except numeric loopback HTTP (`127.0.0.0/8`, `::1`) or literal `localhost`, reject userinfo/query/fragment routing, and preserve GHES prefixes such as `/api/v3`. Explicit `githubApiUrl` overrides `GITHUB_API_URL` in both library and CLI plans. See the [credential/HTTP contract notes](../../docs/release-tag-review-notes.md#rtr-04-private-credentials-and-bounded-github-transport) for bounds and custom-fetch responsibilities.

## Stage contracts

Stage 1 validates a manual `--tag` by stripping at most one leading `v` and requiring strict numeric `X.Y.Z` with no prerelease or build metadata. Each component must be a safe integer (`0` through `9007199254740991`). Without `--tag`, the latest tag comes from `git describe --tags --abbrev=0` and must match `vX.Y.Z`; a missing tag gives guidance to seed history with `--tag`. Nonconforming latest tags are rejected rather than reinterpreted or skipped. Numeric bump outputs are validated too: overflow fails before authentication or mutation.

Automatic determination reads NUL-delimited commit-ID/raw-message records from `git log <lastTag>..HEAD`. Only each message's first line is a Conventional Commit header. Any conventional type with a header `!` or an uppercase, column-zero `BREAKING CHANGE: <description>` / `BREAKING-CHANGE: <description>` line in the body gives major; otherwise a scoped/unscoped `feat` header gives minor; otherwise commits give patch. Major takes precedence over minor and patch. Headers require a separator space/tab and a nonempty description. Body `feat:` examples, incidental `!:` punctuation, and footer-like text in subjects do not trigger larger bumps. An empty-message commit still counts as a commit; zero records produce the no-change result. These are intentional corrections to shell-regex behavior; see [version-policy migration notes](../../docs/release-tag-review-notes.md#rtr-06-conventional-commit-boundaries-and-no-change-releases).

Stage 2 resolves the base branch from explicit `baseBranch` > `GITHUB_REF_NAME` > `git symbolic-ref --short HEAD`. Base and release branches must be distinct, valid short Git refs; options, full `refs/*` aliases, traversal/dot components, `.lock` components, whitespace/control characters, and `HEAD` are rejected. Nested and Unicode branch names remain valid. Base `vX.Y.Z` tag shapes are also rejected, and `GITHUB_REF_TYPE=tag` or `GITHUB_REF=refs/tags/*` prevents environment base inference.

Before configuring Git or preparing a branch, stage 2 requires the selected **local base branch to be checked out**, HEAD to match its inspected commit, and a clean tracked/untracked worktree. It checks command availability, branch collisions, and (when executing a new release) local and remote target-tag absence. Missing/non-executable commands fail with installation/configuration guidance. Path commands must be executable files relative to `cwd`; bare commands must pass a `--version` probe capped at `min(timeoutMs, 10s)`.

Existing local or remote release branches fail by default. With `resetReleaseBranch: true`, stage 2 resets only the release branch from the verified source commit, retaining its local reflog and updating the existing remote ref with a lease on the observed commit. New remote branches use an explicit absence lease. Symbolic branch aliases are refused. There are no branch deletions or unconditional force pushes, and the base ref is never reset.

Stage 2 then configures the author, optionally sets `commit.gpgsign=true` (the runner must already hold a usable key), prepares/pushes the branch, and runs `<releaseCommand> <version> --ci [...releaseArgs]`, appending `--git.commitArgs=--gpg-sign` when signing. A successful executable must leave the expected release branch checked out, a clean worktree, and `<tagVersion>` resolving to HEAD. Only then does stage 2 read the tag annotation and push the verified commit with a lease; failed postconditions stop the final push and PR. The executable remains responsible for its own tag publication.

Explicit `skipRelease` still prepares/pushes the branch and reads existing tag metadata, while bypassing command availability, duplicate-tag refusal, and executed-release postconditions. Direct `runReleaseBranch` calls excluded by `only`, like its dry-run path, perform zero process/file/network operations and require an explicit `baseBranch` or `GITHUB_REF_NAME`. See the [lifecycle migration notes](../../docs/release-tag-review-notes.md#rtr-02-verified-source-preparation-and-release-postconditions) for partial-failure and concurrency limits.

Direct library stages and dry-runs share identity validation: determined versions/tags must agree with each other and a supplied plan tag; PR payload refs must agree with the configured base/release identity. Explicit and environment `owner/repo` values reject dot segments and routing delimiters. Environment refs/repositories are no longer trimmed. See the [validation migration notes](../../docs/release-tag-review-notes.md).

Appended OpenPGP, SSH, and X.509 signature blocks are removed from `tagMessage` and generated PR bodies, preserving the annotation text. `formatPullRequestBody` also strips these blocks from raw tag messages supplied by library callers.

Stage 3 skips without network in order: `skipPr`, `only` excludes `pr`, `dryRun`, then missing token. Token order is explicit `githubToken` > trimmed `githubTokenFile` contents > `process.env[githubTokenEnv]`. Token files must resolve to regular files of at most **65,536 raw bytes**, including surrounding whitespace. Empty, unreadable, oversized, nonregular, or invalid-header files fail without fallback; tokens must be single ASCII bearer tokens. An explicitly supplied empty token also fails; an empty environment variable means no token. The repository resolves from explicit `githubRepository` > `GITHUB_REPOSITORY`; git remotes are not parsed. The body is `### Release Candidate Details`, the sanitized tag message, `---`, and the auto-generated footer; labels are always `changelog`, `release-candidate`, `<tagVersion>`.

Stage 3 queries all PR states for the exact repository/head/base, requesting at most two records to detect ambiguity. It creates only when absent, otherwise validates details, updates an open PR's title/body, and reapplies labels. Cross-repository/fork heads, mismatched identities and multiple matches fail; closed-unmerged PRs require inspection and reopening or a new release identity. Create status 409/422 permits one exact relookup for a concurrent creator, with no generic mutation retries. Errors after a known PR include its safe number/URL and the failed stage. Resume the library `createReleasePullRequest` with the existing verified determination/release metadata, or run `repo-toolkit-release-tag --only pr --tag X.Y.Z --base-branch main` for read-only recovery from the local tag and matching branch.

Merges use a fresh detail read, pin `sha` to the validated head, and compare `release.releasedHead` when present. Only an affirmative `merged === true` response confirms a requested merge. An exact already-merged PR is confirmed through detail data and can resume cleanup without another merge. With both merge/delete flags, cleanup reads `GET git/ref/heads/...`, checks the exact ref and merged head, then deletes it; an already-absent ref (404) counts as `branchDeleted: true`. **REST ref deletion is non-atomic:** a concurrent update/recreation between GET and DELETE can still be removed. Serialize release jobs and avoid concurrent ref writers. See the [PR lifecycle notes](../../docs/release-tag-review-notes.md#rtr-05-recoverable-pr-lifecycle-and-verified-merges) for bounds and recovery limits.

PR-only recovery (`only: ['pr']` with explicit `tag` and `baseBranch`) reads the local target tag object, resolves its commit, strips signatures from the annotation (or lightweight-tag commit message), and checks the local and `origin` release refs. Remote-only branches work without a local checkout; a dirty or detached checkout is preserved. An absent `origin` branch is accepted only with a verified local tag head and the exact already-merged PR at that commit. Mismatches, missing tags, symbolic aliases, and non-commit tags fail before any write API. Recovery makes no Git mutations and runs no release command. See the [recovery notes](../../docs/release-tag-review-notes.md#rtr-07-pr-only-recovery-and-thin-cli).

## CI example

```yaml
concurrency:
  group: release-tag
  cancel-in-progress: false

- run: pnpm release-tag -- --base-branch main --github-repository ${{ github.repository }}
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Serialize releases so only one runs at a time, and never cancel an active release mid-push. Seed an empty history once with `--tag 1.2.3`; afterwards omit `--tag` to derive the bump from Conventional Commits. After a label/merge/deletion failure, resume with `repo-toolkit-release-tag --only pr --tag <version> --base-branch <base>` instead of rerunning the release or deleting the tag.
