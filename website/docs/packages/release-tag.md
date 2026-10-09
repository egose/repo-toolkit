---
sidebar_label: Release Tag
sidebar_position: 9
---

# `@repo-toolkit/release-tag`

`@repo-toolkit/release-tag` determines the next `X.Y.Z` release tag from Conventional Commits, runs the release command on a `changelog/<version>` branch, and opens a GitHub release pull request. It ports `egose/actions/release-tag` into one `repo-toolkit-release-tag` executable with an injectable process runner and fetch transport, so every stage is unit-testable without a git daemon or network.

## Install

```sh
pnpm add -D @repo-toolkit/release-tag
```

Requires Node.js 20 or newer and `git` on `PATH` for the release stage. The package has no runtime dependencies beyond `@repo-toolkit/publish-package`.

## How the three stages fit

`runReleaseTag` resolves a validated plan, then runs `determine` -> `release` -> `pr` in order. `only` filters which stages run; unselected stages yield `null` results. `skipRelease` and `skipPr` still invoke their stage, which returns a skipped result, so `null` means not-selected while a skipped result means selected-but-skipped. Downstream stages require their upstream stages: `only: ['release']`, `only: ['pr']`, and `only: ['determine', 'pr']` throw with guidance to select the prefix. Any stage throw propagates with secrets redacted and stops later stages. Token bytes never appear in plans, results, JSON output, or errors.

## Versioning rules

A manual `tag` strips at most one leading `v`, then requires strict numeric `X.Y.Z` with no leading zeros and no prerelease or build metadata. `v1.2.3` and `1.2.3` both resolve to version `1.2.3` and tag `v1.2.3`; `vv1.2.3`, `1.2`, `1.2.3.4`, `1.2.3-beta`, and `1.2.3+build` all throw. This is an intentional fix versus the reference shell `${input_tag//v}`, which strips every `v` character.

Without a manual tag, stage 1 runs `git describe --tags --abbrev=0` for the latest tag, requires `vX.Y.Z` on the trimmed first line, then runs `git log <lastTag>..HEAD --pretty=format:%B` and applies the exact shell bump regexes in order: major on `BREAKING CHANGE:`, `feat(...)!:` , `fix(...)!:` , or any `!:`; else minor on `feat:` with an optional scope; else patch. Matching is multiline. Any `!:` inside a scope or subject triggers major, matching the shell quirk. Empty history yields patch. Missing previous tags throw with guidance to provide `--tag` once to seed history. Output over `maxOutputBytes` throws. Commit bodies are used only for the bump decision and never returned.

## Branch naming

The release branch defaults to `changelog/<version>` where `<version>` is the bare version without `v`. An explicit `releaseBranch` must be non-empty, contain no whitespace or NUL, and must not be `HEAD`.

The base branch resolves from explicit `baseBranch` > non-empty `GITHUB_REF_NAME` > `git symbolic-ref --short HEAD` (trimmed first line). Empty values, `HEAD`, `refs/tags/*`, and `vX.Y.Z` tag shapes throw `This workflow must be run on a branch, not a tag.` Detached HEAD, including spawn failures, throws the same guard with a truncated stderr tail. Branch names starting with `v` that are not strict tags (for example `version-next`) are accepted.

The branch reset runs with explicit arg arrays, never a shell: best-effort `git push origin --delete <branch>`, best-effort `git branch -D <branch>`, fatal `git checkout -b <branch>`, fatal `git push --set-upstream origin <branch>`. The exact sequence is observable through a fake runner in tests.

## Release-command contract

The default command is `./node_modules/.bin/release-it`. Extra `releaseArgs` are appended after `<version> --ci`, and `--git.commitArgs=--gpg-sign` is appended when `signCommit` is true. The command runs via `runner.run` to stream output, while git plumbing uses `runner.capture`. A stage-2 runner must implement `capture`.

Availability is checked before execution. When `releaseCommand` contains `/`, the path is resolved against `cwd` and checked with executable access. When it is a bare name, `<cmd> --version` is probed via capture with a timeout of `min(timeoutMs, 10s)`; non-zero exits and spawn errors mean unavailable. Missing commands skip with `release command not available: <cmd>` without failing. `skipRelease` skips with `skipped via skipRelease`, and an unselected stage skips with `stage not selected` when the stage is invoked directly. The branch is always created and pushed, and `git tag -l --format=%(contents) <tagVersion>` is always read (empty output tolerated); only the release invocation is conditional. The PR title is always `chore(release): release candidate <tagVersion>`.

Dry-run performs zero runner invocations and returns `releaseRan: false`, `skippedReason: 'dry-run'`, and an empty tag message. It still validates names and requires an explicit `baseBranch` or `GITHUB_REF_NAME`, because no git fallback is attempted; without either it throws.

## PR template and labels

Stage-3 skips without network in this order: `skipPr` (`skipped via skipPr`), `only` excludes `pr` (`stage not selected`), `dryRun` (`dry-run`), then missing token (`github token not available`). Dry-run is checked before token availability, so dry-run never reads token files.

Token resolution order is explicit `githubToken` > trimmed `githubTokenFile` contents > `process.env[githubTokenEnv]`. The file is read relative to `cwd`. An empty file throws without falling back to env, and an unreadable file throws without network calls. The token travels only in the `Authorization: Bearer` header.

The repository resolves from explicit `githubRepository` > `GITHUB_REPOSITORY`. Both must use `owner/repo` with no empty segments, whitespace, or extra slashes. Git remotes are not parsed in v1.

`formatPullRequestBody(tagMessage)` renders the exact template:

```text
### Release Candidate Details

<tagMessage>

---

> This PR was automatically generated.
```

Labels are always `['changelog', 'release-candidate', determined.tagVersion]`.

REST calls use `fetch` against the trimmed `githubApiUrl` with `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: repo-toolkit-release-tag`, and JSON content type: `POST /repos/{owner}/{repo}/pulls` with `head`, `base`, `title`, `body` (requires 200/201 with a numeric `number` and string `html_url`), then `POST /repos/{owner}/{repo}/issues/{number}/labels`. Failures throw with the redacted status and a body truncated to 2048 chars. Responses are read as text and refused over `min(maxOutputBytes, 1MiB)`. Requests use `AbortSignal.timeout(timeoutMs)` with a timer fallback. There are no automatic retries.

## Auto-merge and branch deletion

When `autoMergePr` is true, the stage sends `PUT /repos/{owner}/{repo}/pulls/{number}/merge` with `{ merge_method: 'merge' }`. Any non-2xx, including branch-protection 405/422, is fatal. When both `autoMergePr` and `deleteMergedBranch` are true and the merge succeeded, it sends `DELETE /repos/{owner}/{repo}/git/refs/heads/{branch}` with each slash-separated segment URL-encoded. Non-2xx is fatal. When `autoMergePr` is false, `deleteMergedBranch` is ignored and the branch is never deleted, matching the shell contract.

## GPG notes

`signCommit` only runs `git config commit.gpgsign true` and passes `--gpg-sign` to the release command. It never imports keys, never sets `user.signingkey`, and never writes outside `cwd` or into `HOME/.gnupg`. The runner must already hold a usable secret key. Full `gpg --import` from env secrets is deferred to a follow-up.

## Configuration precedence and environment

Each option resolves independently as CLI flag > explicit option > environment > built-in default. The CLI reads `GITHUB_API_URL` as a fallback for `githubApiUrl` only when `--github-api-url` is absent; the flag always wins. `GITHUB_TOKEN` (or the custom `githubTokenEnv`), `GITHUB_REPOSITORY`, and `GITHUB_REF_NAME` are read by the plan and stages at runtime, not by flag mapping.

| CLI flag                                 | Library option       | Env fallback                | Default                                        |
| ---------------------------------------- | -------------------- | --------------------------- | ---------------------------------------------- |
| `--tag`                                  | `tag`                | none                        | none (derive from git)                         |
| `--cwd`                                  | `cwd`                | none                        | `process.cwd()`                                |
| `--base-branch`                          | `baseBranch`         | `GITHUB_REF_NAME`, then git | none (resolved at runtime)                     |
| `--release-branch`                       | `releaseBranch`      | none                        | `changelog/<version>` once known               |
| `--git-executable`                       | `gitExecutable`      | none                        | `git`                                          |
| `--release-command`, `--release-it-path` | `releaseCommand`     | none                        | `./node_modules/.bin/release-it`               |
| `--git-user-name`                        | `gitUserName`        | none                        | `github-actions[bot]`                          |
| `--git-user-email`                       | `gitUserEmail`       | none                        | `github-actions[bot]@users.noreply.github.com` |
| `--sign-commit`                          | `signCommit`         | none                        | `false`                                        |
| `--github-token`                         | `githubToken`        | none (prefer file)          | none                                           |
| `--github-token-file`                    | `githubTokenFile`    | none                        | none                                           |
| `--github-token-env`                     | `githubTokenEnv`     | none                        | `GITHUB_TOKEN`                                 |
| `--github-repository`                    | `githubRepository`   | `GITHUB_REPOSITORY`         | none                                           |
| `--github-api-url`                       | `githubApiUrl`       | `GITHUB_API_URL`            | `https://api.github.com`                       |
| `--auto-merge-pr`                        | `autoMergePr`        | none                        | `false`                                        |
| `--delete-merged-branch`                 | `deleteMergedBranch` | none                        | `false`                                        |
| `--skip-release`                         | `skipRelease`        | none                        | `false`                                        |
| `--skip-pr`                              | `skipPr`             | none                        | `false`                                        |
| `--only`                                 | `only`               | none                        | all three stages                               |
| `--dry-run`                              | `dryRun`             | none                        | `false`                                        |

`--release-it-path` is an alias for `--release-command` for action parity; when both appear, the last writer wins. `--sign-commit` is negatable via `--no-sign-commit`. `--only` is repeatable and comma-split. Unknown args throw in strict mode. `-h` and `--help` print help and exit 0.

Prefer `--github-token-file` over `--github-token`. The CLI warns on stderr when the inline flag is used. The plan records only `tokenSource` (`explicit`, `file`, `env`, `none`) and `tokenAvailable`; `redactSensitiveValues` covers every error path plus `://...@` URL credentials.

## CLI reference

```sh
repo-toolkit-release-tag --tag 1.2.3 --base-branch main
repo-toolkit-release-tag --only determine
repo-toolkit-release-tag --skip-release --skip-pr --dry-run
repo-toolkit-release-tag --dry-run --json
```

Human output prints one line per stage with versions, branches, PR numbers and URLs, and skip reasons; unselected stages print `not selected`. `--json` prints a single object with `schemaVersion: 1`, a secret-free plan summary (no `runner` or `fetchFn`), and `determined`, `release`, and `pullRequest` results. Errors print the redacted message to stderr and set `process.exitCode = 1` without calling `process.exit`.

## Library reference

```ts
import { runReleaseTag, resolveReleaseTagPlan } from '@repo-toolkit/release-tag';

const plan = resolveReleaseTagPlan({ tag: 'v1.2.3' });
const outcome = await runReleaseTag({ tag: 'v1.2.3', baseBranch: 'main' });
```

`resolveReleaseTagPlan(options = {})` validates without I/O or network and never embeds token bytes. `runReleaseTag(options = {})` returns `{ plan, determined, release, pullRequest }`. Lower-level `determineNextTag`, `runReleaseBranch`, and `createReleasePullRequest` accept `{ plan, ... }` with optional runner and fetch overrides and are the seam for fake-runner and fake-fetch tests.

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

`v1.2.3` is accepted too; exactly one leading `v` is stripped.

### Environment setup

Auth, repository, and base branch resolve from the environment, so local runs need no secret flags:

```sh
export GITHUB_TOKEN=ghp_example
export GITHUB_REPOSITORY=octo/hello
export GITHUB_REF_NAME=main
repo-toolkit-release-tag
```

Prefer a token file over env or argv when the token lives on disk:

```sh
printf '%s' "$GITHUB_TOKEN" > ./token.txt
repo-toolkit-release-tag --github-token-file ./token.txt --github-repository octo/hello
```

### Run stages individually

```sh
repo-toolkit-release-tag --only determine
repo-toolkit-release-tag --only determine,release
repo-toolkit-release-tag --only determine --only release
```

`--only` is repeatable and comma-split. Unselected stages yield `null`. Downstream stages require their upstream prefix: `--only release` or `--only pr` alone throws with guidance.

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

`--delete-merged-branch` without `--auto-merge-pr` is ignored; the branch is never deleted unless the merge succeeded.

### Signed release commits

```sh
repo-toolkit-release-tag --base-branch main --sign-commit \
  --git-user-name release-bot \
  --git-user-email release-bot@example.com
```

This sets `commit.gpgsign=true` and passes `--gpg-sign` to the release command. The runner must already hold a usable GPG secret key; v1 never imports keys. For a GitHub `Verified` badge, upload the public key to the account matching `--git-user-email`.

### Dry-run preview

```sh
repo-toolkit-release-tag --tag 1.2.3 --base-branch main --dry-run
```

Prints the resolved plan without spawning processes or network (exit 0):

```text
dry-run: no processes spawned and no network calls made
baseBranch: main
releaseBranch: changelog/1.2.3
releaseCommand: ./node_modules/.bin/release-it
tokenAvailable: false
tokenSource: none
determined: null (dry-run skips even stage-1 git reads)
release: null
pullRequest: null
```

Add `--json` for the machine-readable form (`schemaVersion: 1`, secret-free plan, null stage results).

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
// { version: '1.3.0', tagVersion: 'v1.3.0', bump: 'minor', lastTag: 'v1.2.3', manual: false }

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
```

`runReleaseTag` does exactly this composition; call the stages directly when you need values between stages or dry-run git reads (see [Dry-run](#dry-run)).

### Testing with fake runners (vitest)

Every stage accepts an injected runner or fetch, so tests need no git daemon or network. Stage 1 with a scripted fake runner:

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
    const runner = scriptedRunner(['v1.2.3\n', 'feat: add widget\n']);
    const determined = await determineNextTag({ plan, runner });
    expect(determined).toMatchObject({ version: '1.3.0', bump: 'minor', manual: false });
  });
});
```

Stage 3 with a recording fake fetch (the implementation only reads `ok`, `status`, and `text()`, so a minimal stub suffices):

```ts
import { createReleasePullRequest, resolveReleaseTagPlan } from '@repo-toolkit/release-tag';

const seen: string[] = [];
const fetchFn = (async (url: unknown) => {
  seen.push(String(url));
  return {
    ok: true,
    status: 201,
    text: async () => JSON.stringify({ number: 7, html_url: 'https://github.com/octo/hello/pull/7' }),
  };
}) as unknown as typeof fetch;

const plan = resolveReleaseTagPlan({ githubRepository: 'octo/hello' });
const result = await createReleasePullRequest({
  plan,
  determined: { version: '1.2.3', tagVersion: 'v1.2.3', bump: 'minor', lastTag: 'v1.2.2', manual: false },
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
expect(seen[0]).toContain('/repos/octo/hello/pulls');
```

Stage 2 follows the same queue pattern with one canned result per git invocation plus a `run` handler for the release command; see `test/release.test.ts` and `test/run.test.ts` in the package for full scripted coverage, including merge/delete flows.

### GitHub Actions workflow

```yaml
name: Release

on:
  workflow_dispatch:

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

Add `--auto-merge-pr --delete-merged-branch` to merge the release PR immediately. The checkout needs full history and tags so stage 1 can read `git describe` and `git log`.

## Dry-run

CLI `--dry-run` resolves and prints the plan summary and exits 0 without mutations, processes, or network. It reports `determined: null`, `release: null`, and `pullRequest: null`, even with a manual `--tag`, so no git reads occur. This differs from the library split: `determineNextTag` always reads git state when called directly (reads are permitted in dry-run), `runReleaseBranch` with `dryRun: true` validates names and returns a dry-run skipped result with zero invocations but requires an explicit base or `GITHUB_REF_NAME`, and `createReleasePullRequest` with `dryRun: true` returns a dry-run skipped result with zero fetch calls. Library callers that need dry-run git reads can call `determineNextTag` first, then pass the result to the later stages.

## Troubleshooting

- `No previous tag found and no tag input provided.` Seed history once with `--tag 1.2.3`, then omit `--tag`.
- `Last tag '<tag>' does not follow 'vX.Y.Z' format.` Rename or delete the non-conforming tag; leading zeros and prereleases are rejected.
- `This workflow must be run on a branch, not a tag.` Run on a branch, or pass `--base-branch main`; tag-shaped `GITHUB_REF_NAME` values are rejected.
- `baseBranch could not be resolved in dry-run without git.` Pass `--base-branch` or set `GITHUB_REF_NAME` for dry-run branch validation.
- `release command not available: <cmd>.` Install or correct `--release-command`; the branch is still created and pushed.
- `githubRepository is required.` Pass `--github-repository owner/repo` or set `GITHUB_REPOSITORY`.
- `githubTokenFile at <path> is empty.` The file must contain non-whitespace; empty files throw without env fallback.
- `GitHub API response ... exceeding the ...-byte response limit.` Lower history or raise `maxOutputBytes`; the PR cap is `min(maxOutputBytes, 1MiB)`.
- Merge `405`/`422`. Branch protection or a non-mergeable state; the stage fails without deleting the branch.

## Migration from `egose/actions/release-tag`

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

Behavioral deltas are intentional: manual tags strip one leading `v` instead of every `v`; `signCommit` never imports GPG keys; `githubApiUrl` plus `GITHUB_API_URL` support GitHub Enterprise REST without `gh`; and `--only`, `--dry-run`, and `--json` have no action equivalent. The PR title, body template, label set, branch naming, and bump regexes otherwise match the action.
