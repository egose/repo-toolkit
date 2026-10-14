---
sidebar_label: Release Tag
sidebar_position: 9
---

# `@repo-toolkit/release-tag`

`@repo-toolkit/release-tag` determines the next `X.Y.Z` release tag from Conventional Commits, verifies a clean checkout of the base branch, runs the release command on a `changelog/<version>` branch, and opens a GitHub release pull request. It ports `egose/actions/release-tag` into one `repo-toolkit-release-tag` executable with an injectable process runner and fetch transport, so every stage is unit-testable without a git daemon or network.

The remediation history behind the current contracts lives in the repository's [release-tag review notes](https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md). Behavior changed intentionally in several places versus the reference action and versus earlier package versions; those deltas are called out below and collected in [Migration](#migration).

## Install

```sh
pnpm add -D @repo-toolkit/release-tag
```

Requires Node.js 20 or newer and `git` on `PATH` for the release stage. The package has no runtime dependencies beyond `@repo-toolkit/publish-package`.

## Prerequisites

Stage 2 pushes and stage 3 API calls need working credentials before the run starts. A fail-fast preflight verifies both automatically after determine and before any mutation; bypass it with `--skip-preflight` only for exotic setups.

### Non-interactive git authentication

Every git-over-SSH connection prompts for a passphrase unless an agent holds the key. One stalled prompt mid-run strands a half-pushed `changelog/*` branch, so set this up first:

```sh
eval "$(ssh-agent -s)" && ssh-add ~/.ssh/<key>
ssh -T git@github.com
GIT_SSH_COMMAND="ssh -o BatchMode=yes" git ls-remote origin HEAD
```

All three must succeed with no prompt; the last proves fully non-interactive auth. The agent does not survive reboots or re-logins — persist it via your OS keychain, a systemd unit, or a shell-profile snippet, or re-add the key each session. Alternatives: a passphrase-less deploy key restricted to the repo (convenient, but weaker if the key leaks), or an HTTPS remote with a credential helper holding a PAT (one credential for git and API, at the cost of a token on disk).

The preflight probe runs `git ls-remote origin HEAD` with `GIT_TERMINAL_PROMPT=0`. Existing `GIT_SSH_COMMAND`, `GIT_SSH`, and Git's `core.sshCommand` identities are preserved (including the deploy key configured by `actions/checkout`); the built-in default `ssh -o BatchMode=yes` is supplied only when no SSH override is configured. Empty SSH environment overrides are treated as unset. Every later package-owned Git and release child also receives `GIT_TERMINAL_PROMPT=0`.

### Token permissions

The token needs these repository permissions (job `permissions` for `GITHUB_TOKEN`, repository access for a fine-grained PAT):

| Operation                                                   | Minimum permission            |
| ----------------------------------------------------------- | ----------------------------- |
| Push the `changelog/*` branch, merge the PR, delete the ref | Contents: read and write      |
| Create the PR                                               | Pull requests: read and write |
| Add the `changelog`, `release-candidate`, `<tag>` labels    | Issues: read and write        |

The same set covers runs with and without `--auto-merge-pr`, since merge and ref deletion fall under Contents. A classic PAT needs the `repo` scope (`public_repo` for public-only repos). GitHub reports insufficient permission as `404`, not `403`, so a 404 from a labels or repo endpoint can mean the token lacks access. Verify a token file before relying on it:

```sh
GH_TOKEN=$(cat ./token.txt) gh api repos/octocat/hello --jq .permissions
```

`push` must be `true`. The value never lands in shell history with this form.

### What preflight proves (and does not prove)

Preflight reads the repository metadata and accepts `permissions.push: true`. When that user-permission flag is absent or false, it confirms an App installation token with a read-only `HEAD /installation/repositories?per_page=1` probe. This supports the built-in Actions `GITHUB_TOKEN`; its endpoint-specific write permissions come from the workflow's `permissions` block.

Read access plus installation identity does **not** prove write permission on every endpoint the run will touch, and it does not eliminate later authentication failures: GitHub enforces Contents, Pull requests, and Issues permissions when the PR is created, labeled, merged, or deleted, and any of those steps can still fail with a permission-shaped 404. Treat preflight as a fail-fast probe that catches missing credentials before mutation, not as a guarantee that all later writes will succeed. See [Troubleshooting](#troubleshooting) for the resulting errors.

## How the three stages fit

`runReleaseTag` resolves a validated plan without I/O, validates the stage selection (including for dry-run), then runs `determine` -> `release` -> `pr` in order. `only` filters which stages run; unselected stages yield `null` results. `skipRelease` and `skipPr` still invoke their stage, which returns a skipped result, so `null` means not-selected while a skipped result means selected-but-skipped.

After determine and before any mutation, a preflight verifies non-interactive git auth (when `release` is selected) and token validity plus push permission (when `pr` is selected, not skipped, and a token is available); a missing token still yields the graceful stage-3 skip rather than a preflight error. A determination with `noChanges: true` bypasses preflight and every later stage entirely and returns `release: null` with `pullRequest: null`. Any throw propagates with secrets redacted and stops later stages. Token bytes never appear in plans, results, JSON output, or errors.

`only: ['pr']` with explicit `tag` and `baseBranch` is the read-only [PR-only recovery](#pr-only-recovery) composition, not a normal prefix: it revalidates the existing release identity from local Git state and runs the idempotent PR stage without configuring Git, changing refs, or running the release command. Every other non-prefix subset (`release` without `determine`, `pr` without both) throws before I/O, including in dry-run.

## Versioning rules

A manual `tag` strips at most one leading `v`, then requires strict numeric `X.Y.Z` with no leading zeros and no prerelease or build metadata. Each component must be a safe integer (`0` through `9007199254740991`). `v1.2.3` and `1.2.3` both resolve to version `1.2.3` and tag `v1.2.3`; `vv1.2.3`, `1.2`, `1.2.3.4`, `1.2.3-beta`, and `1.2.3+build` all throw. This is an intentional fix versus the reference shell `${input_tag//v}`, which strips every `v` character. Manual tags are always explicit release requests with zero Git reads during determination; numeric bump outputs are validated too, so an increment past the safe-integer limit fails inside determination before authentication or mutation.

Without a manual tag, stage 1 runs `git describe --tags --abbrev=0` for the latest tag and requires strict stable `vX.Y.Z`. A missing tag gives guidance to seed history with `--tag`; nonconforming latest tags are rejected rather than reinterpreted or skipped. It then reads NUL-delimited commit-ID/raw-message records from `git log <lastTag>..HEAD` and classifies each commit independently:

- Any conventional type with a header `!` (for example `refactor!: ...`, `chore(deps)!: ...`), or an uppercase column-zero `BREAKING CHANGE: <description>` / `BREAKING-CHANGE: <description>` footer line in the body, gives **major**.
- Otherwise a scoped or unscoped `feat` header (for example `feat: ...`, `feat(api): ...`) gives **minor**.
- Otherwise the commit gives **patch**.

Headers are only the first raw line of each message; type matching is case-insensitive with no type allowlist, scopes must be nonempty, and headers require a space or tab after the colon plus a nonempty description. Major takes precedence over minor and patch across all records. A breaking footer can mark a commit whose subject is not conventional, but footer-like text in a subject and inline or indented `BREAKING CHANGE:` examples do not qualify. Body `feat:` examples, incidental `!:` punctuation such as `fix: handle a!:b`, and scoped text like `feat(scope!:example): add support` never trigger a larger bump. An empty-message commit still counts as a commit. These boundaries intentionally correct the old shell behavior of scanning concatenated commit bodies with whole-output regexes; see the [version-policy migration notes](https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-06-conventional-commit-boundaries-and-no-change-releases).

When the range contains zero commits, the default result is the current version and last tag with `bump: null` and `noChanges: true`; orchestration then performs only the two determination reads and skips preflight, base/ref checks, token-file resolution, release, and PR work, so an unchanged, dirty, or detached checkout returns successfully. Library option `allowEmptyRelease: true` (CLI `--allow-empty-release`) opts back into the old empty-range patch increment; it does not weaken any later validation. Consumers must use `manual`/`noChanges` to interpret `bump: null`:

| Determination                                      | Version/tag                  | `bump`                       | `manual` | `noChanges` |
| -------------------------------------------------- | ---------------------------- | ---------------------------- | -------- | ----------- |
| Manual `tag`                                       | Normalized requested version | `null`                       | `true`   | `false`     |
| Automatic, commits present                         | Classified next version      | `major`, `minor`, or `patch` | `false`  | `false`     |
| Automatic, zero commits, default                   | Current version and last tag | `null`                       | `false`  | `true`      |
| Automatic, zero commits, `allowEmptyRelease: true` | Next patch version           | `patch`                      | `false`  | `false`     |

## Verified source preparation

The release branch defaults to `changelog/<version>` where `<version>` is the bare version without `v`. Base and release branches must be valid short Git branch names: leading options, full `refs/*` aliases, refspecs, traversal/dot components, `.lock` components, whitespace/control characters, and `HEAD` are rejected, while ordinary nested and Unicode names remain valid. Base and release branches must differ. Environment values are validated exactly as supplied and are no longer trimmed.

The base branch resolves from explicit `baseBranch` > non-empty `GITHUB_REF_NAME` > `git symbolic-ref --short HEAD`. Empty values, `HEAD`, `refs/tags/*`, and `vX.Y.Z` tag shapes throw `This workflow must be run on a branch, not a tag.` with checkout guidance. `GITHUB_REF_TYPE=tag` or `GITHUB_REF=refs/tags/*` prevents environment base inference, including for non-version tags such as `latest`. Detached HEAD, including spawn failures, throws the same guard. Branch names starting with `v` that are not strict tags (for example `version-next`) are accepted.

Before configuring Git or preparing a branch, stage 2 requires the selected **local** base branch to be checked out, HEAD to match its inspected commit, and a clean tracked/untracked worktree; an explicit or environment base never authorizes releasing another branch at the same commit, a detached HEAD, or a tag checkout. Branch creation uses the verified source commit explicitly and never switches to or resets the base.

Existing local or remote release branches are refused by default. With `resetReleaseBranch: true` (CLI `--reset-release-branch`), stage 2 resets only the release branch from the verified source commit, retaining its local reflog and updating the existing remote ref with an explicit `--force-with-lease=<full-ref>:<observed-object-id>`; new remote branches use an empty expected ID to require remote absence. There are no branch deletions or unconditional force pushes, and the base ref is never reset. Local symbolic branch refs (including dangling aliases omitted by ordinary ref listings) and remote-advertised symbolic aliases are refused before configuration or reset, because Git can otherwise follow a symbolic release ref and move the base.

New releases are refused when the target tag already exists locally or on origin; release tags are immutable and `resetReleaseBranch` never overrides that. Choose a new version rather than deleting or overwriting a tag. Explicit `skipRelease` still prepares/pushes the branch and reads existing tag metadata while bypassing command availability, duplicate-tag refusal, and executed-release postconditions.

Preparation is not transactional: a failed lease or later step can leave a local prepared branch (including an explicitly authorized reset) and an already-pushed upstream branch. Inspect that state before retrying, serialize release jobs, and never treat tag deletion as a recovery action. See the [lifecycle notes](https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-02-verified-source-preparation-and-release-postconditions).

## Release-command contract

The default command is `./node_modules/.bin/release-it`. Availability is checked **before** any branch mutation: a path containing `/` must resolve to an executable regular file relative to `cwd`, and a bare name must pass a `<cmd> --version` probe capped at `min(timeoutMs, 10s)`. Missing, non-executable, and failed-probe commands fail with installation/configuration guidance instead of pushing a branch and reporting success. Deliberate `skipRelease` remains the supported way to prepare a branch without running a command.

The command runs as `<releaseCommand> <version> --ci [...releaseArgs]`, with `--git.commitArgs=--gpg-sign` appended when `signCommit` is true. Extra `releaseArgs` (CLI `--release-arg`, repeatable and raw) are appended after `<version> --ci`. Release execution uses captured, bounded output like every other package-owned child, so a noisy executable cannot corrupt JSON stdout; failures include bounded diagnostics. The release command is the executable's own tag publisher: package-owned branch pushes use explicit refspecs and disable implicit tag following.

A zero exit alone is insufficient. A successful executable must leave the expected release branch checked out, a clean worktree, and the target `<tagVersion>` resolving to HEAD; missing/mismatched tags, branch switches, detached HEAD, or pending changes stop the package's final push and all downstream PR work. Successful executed releases record the verified full commit ID in `releasedHead`, and the final branch publication pins that commit with a lease on the prepared source (also accepting a branch already published at the same head by the executable).

A directly invoked stage excluded by `only`, like its dry-run path, performs zero process/file/network operations and requires an explicit `baseBranch` or `GITHUB_REF_NAME` because no Git fallback is attempted. Dry-run returns `releaseRan: false`, `skippedReason: 'dry-run'`, and an empty tag message.

## Process and API bounds

Every package-owned Git, availability-probe, and release process uses asynchronous capture with a **combined raw stdout/stderr limit** (`maxOutputBytes`, default 1 MiB, positive safe integer) applied while streaming, and a **per-command deadline** (`timeoutMs`, default 60,000 ms, integer range `1..2147483647`). On POSIX, timeout/overflow terminates the process group, escalating from SIGTERM to SIGKILL after 250 ms, with a further 1 s cleanup allowance; process groups that escape, OS-uninterruptible tasks, and non-POSIX process-tree cancellation are outside the guarantee. CLI flags are `--timeout-ms` and `--max-output-bytes` (decimal digits only: no blanks, signs, leading zeros, fractions, exponents, or hexadecimal).

GitHub response bodies stream with a `min(maxOutputBytes, 1MiB)` cap and one deadline covering fetch **and** body reads; overflow/failure cancels the reader and aborts the request, and authenticated redirects are disabled. API bases use HTTPS except numeric loopback HTTP (`127.0.0.0/8`, `::1`) or literal `localhost`, reject userinfo/query/fragment routing, and preserve GHES prefixes such as `/api/v3`. Token files must resolve to regular files of at most **65,536 raw bytes**; empty, unreadable, oversized, nonregular, or invalid-header files fail without fallback, and tokens must be single ASCII bearer tokens. Credentials resolve lazily once per orchestration and stay pinned through preflight, release, and PR work even if the token file or environment rotates; plans and skipped/dry-run credential paths never open token files. See the [process](https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-03-bounded-captured-process-execution) and [credential/HTTP](https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-04-private-credentials-and-bounded-github-transport) contract notes.

Custom transports own their actual execution behavior. Injected `CapturingProcessRunner` implementations must handle **every** invocation through `capture`, including the release command (`run`/`runShell` are unused), and must implement their own streaming bounds, environment merging, deadlines, termination, and stdout isolation; the boundary only validates completed shapes, combined UTF-8 bytes, and elapsed time afterwards. Custom fetch implementations must return standard `Response` byte streams, honor the redirect policy and `AbortSignal`, and own socket/producer cleanup; the boundary cannot undo credential forwarding or side effects inside an injected transport, preempt blocking JavaScript, or bound memory it allocated before delivering a chunk.

## PR template and labels

Stage 3 skips without network in this order: `skipPr` (`skipped via skipPr`), `only` excludes `pr` (`stage not selected`), `dryRun` (`dry-run`), then missing token (`github token not available`). Dry-run is checked before token availability, so dry-run never reads token files.

Token resolution order is explicit `githubToken` > trimmed `githubTokenFile` contents > `process.env[githubTokenEnv]`. The file is read relative to `cwd`; empty files throw without falling back to env, and unreadable files throw without network calls. An explicitly supplied empty token fails; an empty environment variable means no token. The token travels only in the `Authorization: Bearer` header, and known explicit/environment/file credentials plus the active file token are redacted from diagnostics, output snapshots, and PR descriptions.

The repository resolves from explicit `githubRepository` > `GITHUB_REPOSITORY`. Both must use `owner/repo` with ASCII letters, digits, dots, underscores, or hyphens per component; dot segments, routing delimiters, and control characters are rejected. Git remotes are not parsed.

`formatPullRequestBody(tagMessage)` renders the exact template:

```text
### Release Candidate Details

<tagMessage>

---

> This PR was automatically generated.
```

Labels are always `['changelog', 'release-candidate', determined.tagVersion]`. Appended OpenPGP, SSH, and X.509 signature blocks are removed from tag messages and generated PR bodies, preserving the annotation text.

Stage 3 discovers PRs with `GET /repos/{owner}/{repo}/pulls?state=all&head={owner}:{releaseBranch}&base={baseBranch}&per_page=2&page=1`, requesting two records so ambiguity fails without scanning arbitrary pages; it never follows response-provided pagination URLs. It creates only when absent, otherwise validates a detail read, updates an open PR's title/body without retargeting its base, and reapplies labels on every successful attempt. Cross-repository/fork heads, mismatched identities, and multiple matches fail; closed-unmerged matches require inspection and reopening or a new release identity. Create status 409/422 permits one exact relookup for a concurrent creator, with no generic mutation retries. A complete conflict/merge/cleanup execution makes at most ten HTTP requests. `PullRequestResult.reused` is `true` for a discovered or concurrently created PR and `false` for an initial creation or skip. Errors after a known PR include its safe number/URL and the failed stage, with guidance to resume the PR stage with the existing verified metadata.

REST calls use `fetch` against the validated `githubApiUrl` with `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: repo-toolkit-release-tag`, and JSON content type. Failures throw with the redacted status and bounded diagnostics. There are no automatic retries beyond the single create-conflict relookup.

## Auto-merge and branch deletion

`mergeMethod?: 'merge' | 'squash' | 'rebase'` (CLI `--merge-method`, default `merge`) selects the immediate REST merge method. `autoMergePr` performs an **immediate** merge, not queued auto-merge, approval automation, or a merge queue; branch protection, required reviews/checks, and unsupported methods can still reject it and are reported as actionable errors.

Before a requested merge, a fresh detail read must retain the selected PR number, repository IDs, base/head refs, and head SHA. Every observed PR head is compared against `release.releasedHead` when present, and the merge request pins `sha` to the validated head so GitHub's SHA precondition guards a changed head. Only a successful response with literal `merged === true` confirms a requested merge; false, missing, or malformed confirmations never trigger cleanup. An exact already-merged PR returns `merged: true` through detail data without another merge, so cleanup can resume after a lost merge response.

With both `autoMergePr` and `deleteMergedBranch`, cleanup reads the singular `GET /git/ref/heads/{releaseBranch}`, checks the exact full release ref (never the base) and the merged head SHA, then deletes it; DELETE must return 204. An already-absent ref (404) counts as `branchDeleted: true`, covering GitHub-owned auto-deletion. When `autoMergePr` is false, `deleteMergedBranch` is ignored and the branch is never deleted.

**REST ref deletion is not an atomic compare-and-delete:** GitHub's DELETE-ref endpoint provides no SHA lease, so a concurrent writer can change or recreate the ref between the GET check and DELETE, and that new ref can still be deleted. A ref 404 also cannot independently distinguish absence from a simultaneous access-policy change. Serialize release jobs and avoid concurrent ref writers; these checks cannot provide a distributed lock. See the [PR lifecycle notes](https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-05-recoverable-pr-lifecycle-and-verified-merges).

## PR-only recovery

`--only pr --tag X.Y.Z --base-branch main` (or library `only: ['pr']` with explicit `tag` and `baseBranch`) recovers the PR stage from the existing local release identity without rerunning the release command or touching tags. It validates inputs without I/O, reads the pinned local target tag object, resolves its commit, strips signatures from the annotation (or lightweight-tag commit message), and checks the local and `origin` release refs. Remote-only branches work from a fresh checkout without a local base, and dirty or detached checkouts are preserved. An absent `origin` branch is accepted only with a verified local tag head and the exact already-merged PR at that commit. Mismatches, missing tags, symbolic aliases, and non-commit tags fail before any write API.

Recovery never runs Git `config`, `checkout`, `reset`, `push`, `fetch`, `branch`, `tag`, or `update-ref`, never creates refs, and never runs the release command, regardless of `resetReleaseBranch`, `signCommit`, or `allowEmptyRelease`. It does not fetch or reconstruct refs. Skip/missing-token recovery paths perform zero Git, token-file, and network work. The orchestration result reports `determined: null` and `release: null` for the unselected stages with the idempotent PR result; text output names the recovery mode. See the [recovery notes](https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-07-pr-only-recovery-and-thin-cli).

Typical recovery after a label, merge, or deletion failure:

```sh
repo-toolkit-release-tag --only pr --tag 1.2.3 --base-branch main --auto-merge-pr --delete-merged-branch
```

This rediscovers the exact matching PR, reapplies labels, retries the merge with SHA pinning, and resumes ref cleanup — no release rerun, no tag deletion, no new release identity.

## Signing with externally prepared keys

`signCommit` only runs `git config commit.gpgsign true` and passes `--gpg-sign` to the release command. It never imports keys, never sets `user.signingkey`, and never writes outside `cwd` or into `HOME/.gnupg`. The runner must already hold a usable secret key: import it in the surrounding workflow into a temporary `GNUPGHOME` with owner-only permissions, point Git at a signing wrapper, and remove the keyring when the step exits. The repository's own dispatch workflow follows exactly this pattern; see the [release-tag dispatch notes](https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-dispatch.md). For a GitHub `Verified` badge, upload the public key to the account matching `--git-user-email`.

## Configuration precedence and environment

Each option resolves independently as CLI flag > explicit option > environment > built-in default. Only `githubApiUrl` reads an env fallback (`GITHUB_API_URL`); `GITHUB_TOKEN` (or the custom `githubTokenEnv`), `GITHUB_REPOSITORY`, and `GITHUB_REF_NAME` are read by the plan and stages at runtime, not by flag mapping.

| CLI flag                                 | Library option       | Env fallback                | Default                                        |
| ---------------------------------------- | -------------------- | --------------------------- | ---------------------------------------------- |
| `--tag`                                  | `tag`                | none                        | none (derive from git)                         |
| `--cwd`                                  | `cwd`                | none                        | `process.cwd()`                                |
| `--base-branch`                          | `baseBranch`         | `GITHUB_REF_NAME`, then git | none (resolved at runtime)                     |
| `--release-branch`                       | `releaseBranch`      | none                        | `changelog/<version>` once known               |
| `--git-executable`                       | `gitExecutable`      | none                        | `git`                                          |
| `--release-command`, `--release-it-path` | `releaseCommand`     | none                        | `./node_modules/.bin/release-it`               |
| `--release-arg`                          | `releaseArgs`        | none                        | none (empty list)                              |
| `--timeout-ms`                           | `timeoutMs`          | none                        | `60000`                                        |
| `--max-output-bytes`                     | `maxOutputBytes`     | none                        | `1048576`                                      |
| `--git-user-name`                        | `gitUserName`        | none                        | `github-actions[bot]`                          |
| `--git-user-email`                       | `gitUserEmail`       | none                        | `github-actions[bot]@users.noreply.github.com` |
| `--sign-commit`                          | `signCommit`         | none                        | `false`                                        |
| `--github-token`                         | `githubToken`        | none (prefer file)          | none                                           |
| `--github-token-file`                    | `githubTokenFile`    | none                        | none                                           |
| `--github-token-env`                     | `githubTokenEnv`     | none                        | `GITHUB_TOKEN`                                 |
| `--github-repository`                    | `githubRepository`   | `GITHUB_REPOSITORY`         | none                                           |
| `--github-api-url`                       | `githubApiUrl`       | `GITHUB_API_URL`            | `https://api.github.com`                       |
| `--auto-merge-pr`                        | `autoMergePr`        | none                        | `false`                                        |
| `--merge-method`                         | `mergeMethod`        | none                        | `merge`                                        |
| `--delete-merged-branch`                 | `deleteMergedBranch` | none                        | `false`                                        |
| `--skip-release`                         | `skipRelease`        | none                        | `false`                                        |
| `--reset-release-branch`                 | `resetReleaseBranch` | none                        | `false`                                        |
| `--allow-empty-release`                  | `allowEmptyRelease`  | none                        | `false`                                        |
| `--skip-pr`                              | `skipPr`             | none                        | `false`                                        |
| `--skip-preflight`                       | `skipPreflight`      | none                        | `false`                                        |
| `--only`                                 | `only`               | none                        | all three stages                               |
| `--dry-run`                              | `dryRun`             | none                        | `false`                                        |
| `--json`                                 | none (output only)   | none                        | human-readable text                            |

`--release-it-path` is an alias for `--release-command` for action parity; when both appear, the last writer wins. `--sign-commit`, `--reset-release-branch`, and `--allow-empty-release` are negatable (`--no-*`). `--release-arg` is repeatable and raw: commas are preserved and dash-leading values require the equals form (`--release-arg=--flag=value`). `--only` is repeatable and comma-split. Unknown args throw in strict mode. `-h` and `--help` print help and exit 0.

Prefer `--github-token-file` over `--github-token`. The CLI warns on stderr when the inline flag is used. The plan records only `tokenSource` (`explicit`, `file`, `env`, `none`) and `tokenAvailable`. Known explicit/environment credentials and the active file token are redacted from diagnostics, output snapshots, and PR descriptions; raw error causes and caller transport objects are excluded. Parse failures also redact every `--github-token` value (space and equals forms, including overridden repeats) and the referenced custom-env values.

## CLI reference

```sh
repo-toolkit-release-tag --tag 1.2.3 --base-branch main
repo-toolkit-release-tag --only determine
repo-toolkit-release-tag --only pr --tag 1.2.3 --base-branch main --auto-merge-pr --merge-method squash --delete-merged-branch
repo-toolkit-release-tag --allow-empty-release --release-arg=--verbose --timeout-ms 120000
repo-toolkit-release-tag --skip-release --skip-pr --dry-run
repo-toolkit-release-tag --dry-run --json
```

`src/cli.ts` is a thin entrypoint that only parses, executes, formats, and sets `process.exitCode`; import-safe `src/cli-options.ts` and `src/format.ts` own flags/secrets and help/JSON/text rendering, so tests import those helpers without executing CLI or Git/network code.

Human output prints one line per stage with versions, branches, PR numbers and URLs, and skip reasons; unselected stages print `not selected`, no-change downstream stages print `skipped (no changes)`, and PR-only recovery names its read-only mode. `--json` prints exactly one schema-1 object (`schemaVersion`, secret-free `plan`, `determined`, `release`, `pullRequest`) even when children are noisy; dry-run JSON adds `dryRun: true`. Schema 1 is retained because the remediation only added optional/backward-compatible fields (`releasedHead`, `reused`, `noChanges`, `allowEmptyRelease`, `resetReleaseBranch`, `mergeMethod`); no established field changed shape. Errors print the redacted message to stderr and set `process.exitCode = 1` without calling `process.exit`.

Dry-run text prints the sorted resolved plan summary, for example:

```text
dry-run: no processes spawned and no network calls made
allowEmptyRelease: false
autoMergePr: false
baseBranch: main
...
releaseBranch: changelog/1.2.3
...
tokenAvailable: false
tokenSource: none
determined: null (dry-run skips even stage-1 git reads)
release: null
pullRequest: null
```

A `--dry-run --json` plan carries the same fields in machine-readable form:

```json
{
  "schemaVersion": 1,
  "dryRun": true,
  "plan": {
    "cwd": "/home/dev/repo",
    "tag": "1.2.3",
    "allowEmptyRelease": false,
    "baseBranch": "main",
    "releaseBranch": "changelog/1.2.3",
    "gitExecutable": "git",
    "gitUserName": "github-actions[bot]",
    "gitUserEmail": "github-actions[bot]@users.noreply.github.com",
    "signCommit": false,
    "releaseCommand": "./node_modules/.bin/release-it",
    "releaseArgs": [],
    "skipRelease": false,
    "resetReleaseBranch": false,
    "githubTokenEnv": "GITHUB_TOKEN",
    "githubApiUrl": "https://api.github.com",
    "autoMergePr": false,
    "mergeMethod": "merge",
    "deleteMergedBranch": false,
    "skipPr": false,
    "skipPreflight": false,
    "tokenSource": "none",
    "tokenAvailable": false,
    "dryRun": true,
    "only": ["determine", "release", "pr"],
    "timeoutMs": 60000,
    "maxOutputBytes": 1048576
  },
  "determined": null,
  "release": null,
  "pullRequest": null
}
```

Execution results use the same envelope without `dryRun`: `determined` is `{ version, tagVersion, bump, lastTag, manual, noChanges }`, `release` is `{ baseBranch, releaseBranch, releaseRan, releasedHead?, skippedReason, tagMessage, prTitle }`, and `pullRequest` is `{ skipped, skippedReason, number, url, reused, merged, branchDeleted }`.

## Library reference

```ts
import { runReleaseTag, resolveReleaseTagPlan } from '@repo-toolkit/release-tag';

const plan = resolveReleaseTagPlan({ tag: 'v1.2.3' });
const outcome = await runReleaseTag({ tag: 'v1.2.3', baseBranch: 'main' });
```

Exports: `resolveReleaseTagPlan`, `runReleaseTag`, `determineNextTag`, `runReleaseBranch`, `createReleasePullRequest`, `runPreflight`, `formatPullRequestBody`, plus `ReleaseTagOptions`, `ReleaseTagPlan`, `ReleaseTagStage`, `ReleaseTagMergeMethod`, `ReleaseTagTokenSource`, `DeterminedTag`, `DetermineNextTagInput`, `ReleaseBranchResult`, `RunReleaseBranchInput`, `PullRequestResult`, `CreateReleasePullRequestInput`, `PreflightResult`, `PreflightCheckResult`, and `RunPreflightInput` types. All runners accept `options = {}` defaults; `runner` and `fetchFn` are injectable for tests.

`resolveReleaseTagPlan(options = {})` validates without I/O or network and never embeds token bytes. Returned orchestration plans are sanitized data snapshots; execution plans retain nonenumerable transports with safe resolved-time JSON/inspection snapshots. `runReleaseTag(options = {})` returns `{ plan, determined, release, pullRequest }`. Lower-level `determineNextTag`, `runReleaseBranch`, `createReleasePullRequest`, and `runPreflight` accept `{ plan, ... }` with optional runner/fetch overrides and are the seam for fake-runner and fake-fetch tests. Direct stages accept an optional `githubToken` on their **stage input**; a token passed only to plan resolution is never retained for later execution. Direct-stage composition must honor `determined.noChanges` before invoking downstream stages, and `runReleaseTag` already bypasses runtime identity inference, preflight, token-file resolution, release, and PR on the no-change path.

## Examples

### Full pipeline from git history

Derive the bump from Conventional Commits since the latest tag, run `release-it` on `changelog/<version>`, and open the PR:

```sh
repo-toolkit-release-tag --base-branch main
```

From the monorepo root via the workspace script:

```sh
pnpm release-tag -- --base-branch main
```

### Seed history with an explicit version

Run once when no previous tag exists, then omit `--tag` afterwards:

```sh
repo-toolkit-release-tag --tag 1.2.3 --base-branch main
```

`v1.2.3` is accepted too; exactly one leading `v` is stripped. Manual versions are always explicit release requests, even when the range is empty.

### Automatic run with no changes

When no commits follow the last tag, the default run returns the current version with `noChanges: true` and skips preflight, release, and PR work:

```sh
repo-toolkit-release-tag --base-branch main
```

```text
determine: version 1.2.3 tag v1.2.3 bump none manual false noChanges true lastTag v1.2.3
release: skipped (no changes)
pullRequest: skipped (no changes)
```

To deliberately cut an empty patch release instead, opt in explicitly:

```sh
repo-toolkit-release-tag --base-branch main --allow-empty-release
```

### Environment setup

Auth, repository, and base branch resolve from the environment, so local runs need no secret flags:

```sh
export GITHUB_TOKEN=ghp_example
export GITHUB_REPOSITORY=octocat/hello
export GITHUB_REF_NAME=main
repo-toolkit-release-tag
```

Prefer a token file over env or argv when the token lives on disk:

```sh
printf '%s' "$GITHUB_TOKEN" > ./token.txt
repo-toolkit-release-tag --github-token-file ./token.txt --github-repository octocat/hello
```

### Run stages individually

```sh
repo-toolkit-release-tag --only determine
repo-toolkit-release-tag --only determine,release
repo-toolkit-release-tag --only determine --only release
```

`--only` is repeatable and comma-split. Unselected stages yield `null`. Downstream stages require their upstream prefix: `--only release` alone, or `--only determine,pr`, throws with guidance. `--only pr` alone is valid only as [PR-only recovery](#pr-only-recovery) with explicit `--tag` and `--base-branch`.

### Skip the release command or the PR

Create and push the branch but skip the `release-it` invocation:

```sh
repo-toolkit-release-tag --base-branch main --skip-release
```

Run determine plus release but skip PR creation:

```sh
repo-toolkit-release-tag --base-branch main --skip-pr
```

Unlike `--only`, skipped stages still run and return a skipped result with `skippedReason`, so callers can tell not-selected (`null`) apart from selected-but-skipped.

### Auto-merge the release PR

Merge immediately after creation and delete the `changelog/*` branch, matching `auto-merge-pr` plus `delete-merged-branch` in the reference action:

```sh
repo-toolkit-release-tag --base-branch main --auto-merge-pr --delete-merged-branch
```

`--delete-merged-branch` without `--auto-merge-pr` is ignored; the branch is never deleted unless the merge succeeded with `merged === true`.

### Squash-only repositories

Repositories that only allow squash merges select the method explicitly; the merge still pins the validated head SHA and requires `merged === true`:

```sh
repo-toolkit-release-tag --base-branch main --auto-merge-pr --merge-method squash --delete-merged-branch
```

Use `--merge-method rebase` for rebase-only repositories. Unsupported methods and branch-protection rejections fail without deleting the branch.

### Signed release commits

Prepare the key outside the tool, then sign the release commit:

```sh
repo-toolkit-release-tag --base-branch main --sign-commit \
  --git-user-name release-bot \
  --git-user-email release-bot@example.com
```

This sets `commit.gpgsign=true` and passes `--gpg-sign` to the release command. The runner must already hold a usable secret key; the tool never imports keys or sets `user.signingkey`. See [Signing with externally prepared keys](#signing-with-externally-prepared-keys).

### Recover after a label, merge, or deletion failure

When the release and its tag already exist but the PR step failed partway, resume only the PR stage from the verified local identity:

```sh
repo-toolkit-release-tag --only pr --tag 1.2.3 --base-branch main --auto-merge-pr --delete-merged-branch
```

This rediscovers the exact matching PR, reapplies labels, retries the SHA-pinned merge, and resumes ref cleanup. Never rerun the full release (the existing tag would correctly refuse a second release) and never delete the release tag to force a retry.

### Dry-run preview

```sh
repo-toolkit-release-tag --tag 1.2.3 --base-branch main --dry-run
```

Prints the resolved plan without spawning processes or network (exit 0); see [CLI reference](#cli-reference) for the full summary shape. Add `--json` for the machine-readable form (`schemaVersion: 1`, secret-free plan, null stage results).

### Library per-stage composition

```ts
import {
  createReleasePullRequest,
  determineNextTag,
  resolveReleaseTagPlan,
  runReleaseBranch,
} from '@repo-toolkit/release-tag';

const plan = resolveReleaseTagPlan({ baseBranch: 'main' });
const determined = await determineNextTag({ plan });
console.log(determined);
// { version: '1.3.0', tagVersion: 'v1.3.0', bump: 'minor', lastTag: 'v1.2.3', manual: false, noChanges: false }

if (!determined.noChanges) {
  const release = await runReleaseBranch({ plan, determined });
  console.log(release.releaseBranch, release.prTitle);
  // changelog/1.3.0 chore(release): release candidate v1.3.0

  const pullRequest = await createReleasePullRequest({
    plan,
    determined,
    release,
    githubToken: process.env.GITHUB_TOKEN,
  });
  console.log(pullRequest.url, pullRequest.merged, pullRequest.branchDeleted);
}
```

`runReleaseTag` does exactly this composition, including the no-change bypass; call the stages directly when you need values between stages or dry-run git reads (see [Dry-run](#dry-run)).

### Testing with fake runners (vitest)

Every stage accepts an injected runner or fetch, so tests need no git daemon or network. Stage 1 with a scripted fake runner, using the NUL-delimited record format the implementation reads:

```ts
import { describe, expect, it } from 'vitest';

import type { CapturingProcessRunner, ProcessCaptureResult } from '@repo-toolkit/publish-package';
import { determineNextTag, resolveReleaseTagPlan } from '@repo-toolkit/release-tag';

function scriptedRunner(outputs: string[]): CapturingProcessRunner {
  let index = 0;
  return {
    run() {
      throw new Error('unexpected run call');
    },
    runShell() {
      throw new Error('must not invoke a shell');
    },
    async capture(): Promise<ProcessCaptureResult> {
      const stdout = outputs[index];
      index += 1;
      if (stdout === undefined) {
        throw new Error('script exhausted');
      }
      return { stdout, stderr: '', code: 0 };
    },
  };
}

describe('determineNextTag', () => {
  it('bumps minor on feat commits', async () => {
    const plan = resolveReleaseTagPlan({ cwd: '/fake/workdir' });
    const commitId = 'a'.repeat(40);
    const runner = scriptedRunner(['v1.2.3\n', `${commitId}\0feat: add widget\0`]);
    const determined = await determineNextTag({ plan, runner });
    expect(determined).toMatchObject({ version: '1.3.0', bump: 'minor', manual: false, noChanges: false });
  });
});
```

Stage 3 with a real `Response` fake fetch (the implementation streams response bodies, so prefer real responses over minimal stubs; see `test/http-fixture.ts` in the package):

```ts
import { createReleasePullRequest, resolveReleaseTagPlan } from '@repo-toolkit/release-tag';

const seen: string[] = [];
const fetchFn = (async (url: unknown) => {
  seen.push(String(url));
  if (seen.length === 1) {
    return new Response('[]', { status: 200 });
  }
  return new Response(JSON.stringify({ number: 7, html_url: 'https://github.com/octocat/hello/pull/7' }), {
    status: 201,
  });
}) as unknown as typeof fetch;

const plan = resolveReleaseTagPlan({ githubRepository: 'octocat/hello' });
const result = await createReleasePullRequest({
  plan,
  determined: {
    version: '1.2.3',
    tagVersion: 'v1.2.3',
    bump: 'minor',
    lastTag: 'v1.2.2',
    manual: false,
    noChanges: false,
  },
  release: {
    baseBranch: 'main',
    releaseBranch: 'changelog/1.2.3',
    releaseRan: true,
    skippedReason: null,
    tagMessage: 'Release 1.2.3 notes',
    prTitle: 'chore(release): release candidate v1.2.3',
  },
  githubToken: 'fake-token-for-tests',
  fetchFn,
});
expect(result).toMatchObject({ skipped: false, number: 7 });
expect(seen[0]).toContain('/repos/octocat/hello/pulls');
```

Stage 2 follows the same queue pattern with one canned `capture` result per git invocation plus a `capture` handler for the release command; every invocation — including release execution — goes through `capture`, never `run`. See `test/release.test.ts`, `test/release-fixture.ts`, and `test/run.test.ts` in the package for full scripted coverage, including merge/delete flows.

### GitHub Actions workflow

Serialize releases so only one runs at a time, and never cancel an active release mid-push: a cancelled job can strand a pushed branch or tag that a retry must then handle deliberately.

```yaml
name: Release

on:
  workflow_dispatch:

concurrency:
  group: release-tag
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          fetch-tags: true

      - run: pnpm install --frozen-lockfile

      - run: pnpm release-tag -- --base-branch main --github-repository ${{ github.repository }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Add `--auto-merge-pr --delete-merged-branch` to merge the release PR immediately. The checkout needs full history and tags so stage 1 can read `git describe` and `git log`. The repository's own signed dispatch workflow is documented separately in the [release-tag dispatch notes](https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-dispatch.md).

## Dry-run

CLI `--dry-run` resolves and prints the plan summary and exits 0 without mutations, processes, or network. It reports `determined: null`, `release: null`, and `pullRequest: null`, even with a manual `--tag`, so no git reads occur. Invalid stage selections fail identically in dry-run and execution. This differs from the library split: `determineNextTag` always reads git state when called directly (reads are permitted in dry-run), `runReleaseBranch` with `dryRun: true` validates names and returns a dry-run skipped result with zero invocations but requires an explicit base or `GITHUB_REF_NAME`, and `createReleasePullRequest` with `dryRun: true` returns a dry-run skipped result with zero fetch calls. Library callers that need dry-run git reads can call `determineNextTag` first, then pass the result to the later stages.

## Troubleshooting

- `No previous tag found and no tag input provided.` Seed history once with `--tag 1.2.3`, then omit `--tag`.
- `Last tag '<tag>' does not follow 'vX.Y.Z' format.` Rename or delete the non-conforming tag; leading zeros and prereleases are rejected.
- `This workflow must be run on a branch, not a tag.` Run on a branch, or pass `--base-branch main`; tag-shaped `GITHUB_REF_NAME` values and `GITHUB_REF_TYPE=tag` checkouts are rejected.
- `baseBranch could not be resolved in dry-run without git.` Pass `--base-branch` or set `GITHUB_REF_NAME` for dry-run branch validation.
- `preflight failed: git ls-remote origin HEAD did not succeed.` Non-interactive git auth is missing (usually a passphrase-protected SSH key with no agent). Load the key (`eval "$(ssh-agent -s)" && ssh-add ~/.ssh/<key>`), verify with `GIT_SSH_COMMAND="ssh -o BatchMode=yes" git ls-remote origin HEAD`, then retry. See [Prerequisites](#prerequisites). Nothing was mutated.
- `Release command '<cmd>' is not available.` Install or correct `--release-command`; nothing was mutated. Use `--skip-release` only for deliberate branch preparation without a command.
- `Release branch '<branch>' already exists locally or on origin.` Inspect the existing work; choose another `--release-branch` or pass `--reset-release-branch` for an intentional restart with an observed remote lease. Nothing was overwritten.
- `Release tag '<tag>' already exists locally or on origin.` Choose a new version. Never delete or overwrite a release tag to force a retry; use `--skip-release` only for deliberate preparation with existing metadata, or `--only pr` to resume the PR step.
- `Release source validation: ...` The selected local base is not checked out cleanly at its inspected commit. Check out the intended base branch, commit/stash/remove pending work, and retry. Detached, tag, and wrong-branch checkouts cannot be released.
- `Local <ref> is a symbolic ref.` / `Origin <ref> is a symbolic ref.` Replace the aliased ref with an independent branch ref; symbolic aliases are refused so a reset can never move the base.
- `githubRepository is required.` Pass `--github-repository owner/repo` or set `GITHUB_REPOSITORY`.
- `githubTokenFile at <path> is empty.` (and oversized, invalid-header, nonregular, or unreadable variants) The file must be a regular file of at most 65,536 raw bytes trimming to one ASCII bearer token. Invalid files throw without env fallback; fix the file and retry.
- `preflight failed: GitHub token check ...` Either the token is invalid (non-2xx, including permission-404s) or it lacks push permission and is not an installation token. Grant Contents, Pull requests, and Issues read/write on the repo as listed in [Prerequisites](#prerequisites), verify with `GH_TOKEN=$(cat ./token.txt) gh api repos/octocat/hello --jq .permissions`, then retry. Nothing was mutated.
- `GitHub API response ... exceeding the ...-byte response limit.` Lower history or raise `--max-output-bytes`; the PR cap is `min(maxOutputBytes, 1MiB)`.
- `The matching PR is closed without merging.` Inspect and reopen that PR, or choose a new release identity; it is not replaced automatically.
- Multiple or ambiguous matching PRs. Inspect the duplicates and resolve them manually; discovery refuses to select one automatically.
- Merge `405`/`422` or unsupported-method errors. Branch protection, required reviews/checks, or a non-mergeable state; the stage fails without deleting the branch.
- Recovery `tag ... not found` / head-mismatch errors from `--only pr`. The local tag, local branch, and `origin` branch disagree. Inspect them with `git show-ref`, `git status --short --branch`, and `git ls-remote origin`; fix the checkout or publish the missing state, then resume recovery. Recovery never fetches or reconstructs refs.
- Numeric/enum flag errors (`--timeout-ms must be ...`, `--max-output-bytes must be ...`, unknown merge method). Use decimal digits only without leading zeros (`1..2147483647` for `--timeout-ms`, positive safe integers for `--max-output-bytes`) and `merge`, `squash`, or `rebase` for `--merge-method`.
- Stuck release command (only possible past a skipped or exotic preflight, since the default preflight catches missing non-interactive auth). Release output is captured, so a hidden SSH passphrase prompt surfaces as a hang until `--timeout-ms` terminates the child. Assess with `git status --short --branch`, `git log --oneline -3`, `git tag -l`, and `git ls-remote origin`; inspect whether the executable published the branch or tag. Either resume the PR step with `--only pr --tag <version> --base-branch <base>` once the tag and branch exist, or retry cleanly from the base branch after loading ssh-agent. Never delete the release tag as part of the retry.
- `could not add label: '<tag>' not found` from `gh pr create --label`. `gh` validates labels client-side and requires them to pre-exist; create them first (`gh label create`) or use `gh api repos/octocat/hello/issues/<n>/labels`, which auto-creates missing labels exactly like the tool's own REST call.

## Migration

### Migration from `egose/actions/release-tag`

| Action input                  | CLI flag                                              |
| ----------------------------- | ----------------------------------------------------- |
| `tag`                         | `--tag`                                               |
| `release-it-path`             | `--release-it-path` (alias for `--release-command`)   |
| `git-user-name`               | `--git-user-name`                                     |
| `git-user-email`              | `--git-user-email`                                    |
| `sign-commit`                 | `--sign-commit`                                       |
| `github-token`                | `--github-token-file` (preferred) or `--github-token` |
| `auto-merge-pr`               | `--auto-merge-pr`                                     |
| `delete-merged-branch`        | `--delete-merged-branch`                              |
| `skip-release` (when present) | `--skip-release`                                      |
| `skip-pr` (when present)      | `--skip-pr`                                           |

New flags with no action equivalent: `--release-arg`, `--timeout-ms`, `--max-output-bytes`, `--reset-release-branch`, `--allow-empty-release`, `--merge-method`, `--only`, `--dry-run`, and `--json`.

Behavioral deltas are intentional: manual tags strip one leading `v` instead of every `v`; branch names and `owner/repo` values are strictly validated and environment values are no longer trimmed; the base branch must be checked out cleanly and creation uses its verified commit; existing release branches and tags refuse by default instead of blind deletion or silent overwrite; missing release commands fail before mutation; version bumps follow per-commit Conventional Commit boundaries instead of whole-output shell regexes; empty ranges return `noChanges` instead of a patch; `signCommit` never imports GPG keys; merges pin the validated head SHA and require `merged === true`; `githubApiUrl` plus `GITHUB_API_URL` support GitHub Enterprise REST without `gh`; and PRs are reused idempotently with `--only pr` recovery. The PR title, body template, and label set match the action.

### Review remediation contract changes

The remediation review (RTR-01 through RTR-07) changed these externally visible contracts; each link records the exact migration:

- [Stricter ref and payload validation](https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-01-stricter-ref-and-stage-payload-validation): option-shaped/full/traversal refs, `HEAD`, base/release equality, tag-shaped bases, untrimmed env values, safe-integer versions, exact payload identity, strict `owner/repo`.
- [Verified source preparation](https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-02-verified-source-preparation-and-release-postconditions): clean checked-out base, collision refusal with leased `--reset-release-branch`, symbolic-alias refusal, command availability before mutation, immutable tags, executed-release postconditions, `releasedHead`, nontransactional limits.
- [Bounded captured execution](https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-03-bounded-captured-process-execution): per-command `timeoutMs`/`maxOutputBytes`, captured release output, POSIX termination/cleanup limits, SSH preservation, `capture`-only custom runners.
- [Private credentials and bounded transport](https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-04-private-credentials-and-bounded-github-transport): ASCII bearer tokens, 64 KiB file cap, pinned per-run credentials, streamed `min(maxOutputBytes, 1MiB)` bodies, disabled redirects, loopback-only HTTP, sanitized diagnostics, custom-fetch responsibilities.
- [Recoverable PR lifecycle](https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-05-recoverable-pr-lifecycle-and-verified-merges): exact PR reuse with `reused`, one create-conflict relookup, merge methods, SHA pinning, `merged === true`, already-merged cleanup recovery, non-atomic GET/DELETE limits.
- [Conventional Commit boundaries and no-change releases](https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-06-conventional-commit-boundaries-and-no-change-releases): per-record classification, breaking-footer rules, `noChanges`/`allowEmptyRelease`, NUL-delimited runner format, safe-integer bump validation.
- [PR-only recovery and thin CLI](https://github.com/egose/repo-toolkit/blob/main/docs/release-tag-review-notes.md#rtr-07-pr-only-recovery-and-thin-cli): read-only `--only pr` composition, new flags, import-safe helpers, parse redaction, schema-1 retention.
