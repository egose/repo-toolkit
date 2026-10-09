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

| Option                               | Purpose                                                                      |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| `--tag <version>`                    | Manual `X.Y.Z` with an optional single leading `v`; no prerelease            |
| `--cwd <path>`                       | Working directory (default: `process.cwd()`)                                 |
| `--base-branch <name>`               | Base branch; falls back to `GITHUB_REF_NAME` then `git symbolic-ref`         |
| `--release-branch <name>`            | Release branch (default: `changelog/<version>`)                              |
| `--git-executable <path>`            | Git executable (default: `git`)                                              |
| `--release-command <path>`           | Release executable (default: `./node_modules/.bin/release-it`)               |
| `--release-it-path <path>`           | Alias for `--release-command`; last writer wins                              |
| `--git-user-name <name>`             | Git author name (default: `github-actions[bot]`)                             |
| `--git-user-email <email>`           | Git author email (default: `github-actions[bot]@users.noreply.github.com`)   |
| `--sign-commit` / `--no-sign-commit` | Set `commit.gpgsign=true` and pass `--gpg-sign` (default: off)               |
| `--github-token <value>`             | Inline token (prefer `--github-token-file`)                                  |
| `--github-token-file <path>`         | File whose trimmed contents are the token, relative to `--cwd`               |
| `--github-token-env <name>`          | Env var holding the token (default: `GITHUB_TOKEN`)                          |
| `--github-repository <o/r>`          | `owner/repo`; falls back to `GITHUB_REPOSITORY`                              |
| `--github-api-url <url>`             | API base; falls back to `GITHUB_API_URL` (default: `https://api.github.com`) |
| `--auto-merge-pr`                    | Merge the created pull request                                               |
| `--delete-merged-branch`             | Delete the branch after a successful merge (requires `--auto-merge-pr`)      |
| `--skip-release`                     | Create and push the branch but skip the release command                      |
| `--skip-pr`                          | Skip pull request creation                                                   |
| `--only <stage>[,...]`               | Run only `determine`, `release`, `pr` (repeatable, comma-split)              |
| `--dry-run`                          | Print the plan summary without processes or network; `determined` is null    |
| `--json`                             | Print a single JSON object with schema version, plan, and stage results      |
| `-h, --help`                         | Show help                                                                    |

Precedence per option: CLI flag > explicit option > environment > built-in default. Only `githubApiUrl` reads an env fallback (`GITHUB_API_URL`); `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, and `GITHUB_REF_NAME` are read by the plan and stages at runtime.

Prefer `--github-token-file` over `--github-token` to keep the token out of argv and process listings. The CLI warns on stderr when `--github-token` is used. Token bytes never appear in plans, results, JSON output, or error messages.

`--dry-run` never spawns processes or touches the network. It reports `determined: null` even when a manual `--tag` is given. Library callers that need stage-1 git reads in a dry-run can call `determineNextTag` directly, which always reads.

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

Exports: `resolveReleaseTagPlan`, `runReleaseTag`, `determineNextTag`, `runReleaseBranch`, `createReleasePullRequest`, `formatPullRequestBody`, plus `ReleaseTagOptions`, `ReleaseTagPlan`, `ReleaseTagResult`, `ReleaseTagStage`, `DeterminedTag`, `ReleaseBranchResult`, `PullRequestResult` types. All runners accept `options = {}` defaults; `runner` and `fetchFn` are injectable for tests.

`runReleaseTag` resolves the plan, then runs `determine` -> `release` -> `pr` in order. `only` filters which stages run; unselected stages yield `null`. `skipRelease` and `skipPr` still invoke their stage, which returns a skipped result, so callers can distinguish not-selected (`null`) from selected-but-skipped. Downstream stages require their upstream stages to be selected; `only: ['release']` or `only: ['pr']` alone throws. Errors propagate with the token redacted and stop subsequent stages.

## Stage contracts

Stage 1 validates a manual `--tag` by stripping at most one leading `v` and requiring strict numeric `X.Y.Z` with no prerelease or build metadata. This fixes the reference shell `${input_tag//v}`, which strips every `v`. Without `--tag`, the latest tag comes from `git describe --tags --abbrev=0`, must match `vX.Y.Z` (no leading zeros), and the bump comes from `git log <lastTag>..HEAD` with the exact shell regexes: major on `BREAKING CHANGE:`, `feat(...):` with `!`, `fix(...):` with `!`, or any `!:`; else minor on `feat:`; else patch. Any `!:` inside a scope or subject triggers major, matching the shell quirk.

Stage 2 resolves the base branch from explicit `baseBranch` > `GITHUB_REF_NAME` > `git symbolic-ref --short HEAD`, rejecting empty, `HEAD`, `refs/tags/*`, and `vX.Y.Z` tag shapes. It configures the git author, optionally sets `commit.gpgsign=true` (the runner must already hold a usable key; no import in v1), resets the branch (`push --delete` and `branch -D` best-effort, then fatal `checkout -b` and `push --set-upstream`), runs `<releaseCommand> <version> --ci [...releaseArgs]` plus `--git.commitArgs=--gpg-sign` when signing, then pushes and reads `git tag -l --format=%(contents) <tagVersion>` for the PR body. A path-shaped command is checked with executable access against `cwd`; a bare name is probed with `--version` capped at `min(timeoutMs, 10s)`. Missing commands skip without failing. Dry-run performs zero invocations but still requires an explicit `baseBranch` or `GITHUB_REF_NAME`.

Stage 3 skips without network in order: `skipPr`, `only` excludes `pr`, `dryRun`, then missing token. Token order is explicit `githubToken` > trimmed `githubTokenFile` contents > `process.env[githubTokenEnv]`. An empty or unreadable token file throws without falling back. The repository resolves from explicit `githubRepository` > `GITHUB_REPOSITORY`; git remotes are not parsed. The body is `### Release Candidate Details`, the tag message, `---`, and the auto-generated footer; labels are always `changelog`, `release-candidate`, `<tagVersion>`. REST calls are `POST pulls`, `POST labels`, optional `PUT merge` when `autoMergePr`, and optional `DELETE ref` only after a successful merge when both `autoMergePr` and `deleteMergedBranch` are set. Responses are capped at `min(maxOutputBytes, 1MiB)` with `AbortSignal.timeout(timeoutMs)`; every error path redacts the token and URL credentials.

## CI example

```yaml
- run: pnpm release-tag -- --base-branch main --github-repository ${{ github.repository }}
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Seed an empty history once with `--tag 1.2.3`; afterwards omit `--tag` to derive the bump from Conventional Commits.
