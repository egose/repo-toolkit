import { safeMetadata } from './diagnostics';
import { snapshotReleaseTagPlan, type ReleaseTagPlan } from './plan';
import type { ReleaseTagResult } from './run';

export const RELEASE_TAG_CLI_SCHEMA_VERSION = 1;

export function planSummary(plan: ReleaseTagPlan, secrets: ReadonlyArray<string> = []): Record<string, unknown> {
  return { ...snapshotReleaseTagPlan(plan, secrets) };
}

export function formatJsonResult(outcome: ReleaseTagResult, secrets: ReadonlyArray<string> = []): string {
  return JSON.stringify(
    {
      schemaVersion: RELEASE_TAG_CLI_SCHEMA_VERSION,
      plan: planSummary(outcome.plan, secrets),
      determined: outcome.determined === null ? null : safeMetadata(outcome.determined, secrets),
      release: outcome.release === null ? null : safeMetadata(outcome.release, secrets),
      pullRequest: outcome.pullRequest === null ? null : safeMetadata(outcome.pullRequest, secrets),
    },
    null,
    2,
  );
}

export function formatJsonDryRun(plan: ReleaseTagPlan, secrets: ReadonlyArray<string> = []): string {
  return JSON.stringify(
    {
      schemaVersion: RELEASE_TAG_CLI_SCHEMA_VERSION,
      dryRun: true,
      plan: planSummary(plan, secrets),
      determined: null,
      release: null,
      pullRequest: null,
    },
    null,
    2,
  );
}

export function formatTextResult(outcome: ReleaseTagResult, secrets: ReadonlyArray<string> = []): string {
  const lines: string[] = [];
  if (outcome.plan.only.length === 1 && outcome.plan.only[0] === 'pr') {
    const plan = planSummary(outcome.plan, secrets);
    lines.push(
      `PR-only recovery: tag v${plan.tag} base ${plan.baseBranch} branch ${plan.releaseBranch} (read-only Git)`,
    );
  }
  if (outcome.determined === null) {
    lines.push('determine: not selected');
  } else {
    const determined = safeMetadata(outcome.determined, secrets);
    lines.push(
      `determine: version ${determined.version} tag ${determined.tagVersion} bump ${determined.bump === null ? 'none' : determined.bump} manual ${determined.manual ? 'true' : 'false'} noChanges ${determined.noChanges ? 'true' : 'false'} lastTag ${determined.lastTag === null ? '(none)' : determined.lastTag}`,
    );
  }
  if (outcome.release === null) {
    lines.push(`release: ${outcome.determined?.noChanges ? 'skipped (no changes)' : 'not selected'}`);
  } else {
    const release = safeMetadata(outcome.release, secrets);
    if (release.skippedReason !== null) {
      lines.push(
        `release: skipped (${release.skippedReason}) base ${release.baseBranch} branch ${release.releaseBranch} title ${release.prTitle}`,
      );
    } else {
      lines.push(
        `release: base ${release.baseBranch} branch ${release.releaseBranch} releaseRan ${release.releaseRan ? 'true' : 'false'} releasedHead ${release.releasedHead ?? '(unverified)'} title ${release.prTitle}`,
      );
    }
  }
  if (outcome.pullRequest === null) {
    lines.push(`pullRequest: ${outcome.determined?.noChanges ? 'skipped (no changes)' : 'not selected'}`);
  } else {
    const pullRequest = safeMetadata(outcome.pullRequest, secrets);
    if (pullRequest.skipped) {
      lines.push(
        `pullRequest: skipped (${pullRequest.skippedReason === null ? 'unknown' : pullRequest.skippedReason})`,
      );
    } else {
      lines.push(
        `pullRequest: number ${pullRequest.number === null ? '(none)' : String(pullRequest.number)} url ${pullRequest.url === null ? '(none)' : pullRequest.url} reused ${pullRequest.reused ? 'true' : 'false'} merged ${pullRequest.merged ? 'true' : 'false'} branchDeleted ${pullRequest.branchDeleted ? 'true' : 'false'}`,
      );
    }
  }
  return lines.join('\n');
}

export function formatTextDryRun(plan: ReleaseTagPlan, secrets: ReadonlyArray<string> = []): string {
  const summary = planSummary(plan, secrets);
  const lines: string[] = ['dry-run: no processes spawned and no network calls made'];
  const keys = Object.keys(summary).sort();
  for (const key of keys) {
    const value = summary[key];
    if (Array.isArray(value)) {
      lines.push(`${key}: ${value.join(',')}`);
    } else if (typeof value === 'boolean' || typeof value === 'number') {
      lines.push(`${key}: ${String(value)}`);
    } else if (typeof value === 'string') {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('determined: null (dry-run skips even stage-1 git reads)');
  lines.push('release: null');
  lines.push('pullRequest: null');
  return lines.join('\n');
}

export function formatHelp(): string {
  return `repo-toolkit-release-tag

Usage:
  repo-toolkit-release-tag [options]

Determine the next release tag, run the release on a changelog branch, and open a GitHub release pull request.

Stages (run in order by default):
  determine  Validate --tag or derive the next X.Y.Z from the latest vX.Y.Z plus Conventional Commits
  release    Verify the clean base checkout, prepare changelog/<version>, run and verify the release, push, read tag message
  pr         Create or reuse pull request changelog/<version> -> base branch with labels and optional merge/delete

A fail-fast preflight checks non-interactive Git read access and token metadata
before release mutation; endpoint write permissions are enforced by GitHub.
Bypass these probes with --skip-preflight. No-change determination skips all later work.

Conditional skips:
  --only determine[,release][,pr]  Run only selected stages; unselected stages yield null results
  --only pr --tag X.Y.Z --base-branch main
                                   Recover a PR from the existing local target tag and matching release branch
  --skip-release                   Create and push the branch but skip the release command (skipped result, not null)
  --skip-pr                        Skip pull request creation (skipped result, not null)
  --dry-run                        Print the resolved plan summary without spawning processes or network; determined is null
  Missing github token             Skip pull request creation without failing (reason: github token not available)

Missing release commands fail before branch preparation; install/configure the executable
or deliberately select --skip-release. New releases refuse existing target tags;
release-branch collisions require --reset-release-branch for an intentional restart.

PR-only recovery requires explicit --tag AND --base-branch, including in dry-run.
It reads the local tag annotation (or lightweight-tag commit message), pins the tag
commit, and checks any local release branch plus the current branch on origin.
Remote-only branches work without a local base/release checkout. An absent origin
branch is accepted only for the exact already-merged PR at that tag commit.
Recovery never configures Git, fetches, checks out, resets, creates, or pushes refs,
and never runs the release command. Skipped PRs do not read Git or token files.

Configuration precedence:
  CLI flag > explicit option > environment > built-in default

Environment variables:
  GITHUB_TOKEN       GitHub token (or the custom name from --github-token-env)
  GITHUB_REPOSITORY  owner/repo fallback when --github-repository is absent
  GITHUB_REF_NAME    Base branch fallback when --base-branch is absent
  GITHUB_API_URL     API base fallback when --github-api-url is absent

Prefer --github-token-file over --github-token to avoid placing the token in argv and process listings.

Options:
  --tag <version>              Manual X.Y.Z version with an optional single leading v (no prerelease)
  --cwd <path>                 Working directory (default: process.cwd())
  --base-branch <name>         Base branch; falls back to GITHUB_REF_NAME then git symbolic-ref
  --release-branch <name>      Release branch (default: changelog/<version>)
  --git-executable <path>      Git executable (default: git)
  --release-command <path>     Release executable (default: ./node_modules/.bin/release-it)
  --release-it-path <path>     Alias for --release-command; last writer wins
  --release-arg <value>        Repeatable raw release argument; commas preserved (use --release-arg=--flag=value)
  --timeout-ms <integer>       Per-process/request deadline (default: 60000; range: 1..2147483647)
  --max-output-bytes <integer> Combined child output cap (default: 1048576; positive safe integer)
  --git-user-name <name>       Git author name (default: github-actions[bot])
  --git-user-email <email>     Git author email (default: github-actions[bot]@users.noreply.github.com)
  --sign-commit                Set commit.gpgsign=true and pass --gpg-sign to the release command
  --no-sign-commit             Disable commit signing
  --github-token <value>       GitHub token inline (prefer --github-token-file)
  --github-token-file <path>   File whose trimmed contents are the GitHub token
  --github-token-env <name>    Env var holding the token (default: GITHUB_TOKEN)
  --github-repository <o/r>    owner/repo; falls back to GITHUB_REPOSITORY
  --github-api-url <url>       API base; falls back to GITHUB_API_URL (default: https://api.github.com)
  --auto-merge-pr              Immediately merge the release pull request with a verified head SHA
  --merge-method <method>      Immediate merge method: merge (default), squash, or rebase
  --delete-merged-branch       Delete the release branch after a successful merge (requires --auto-merge-pr)
  --skip-release               Create and push the branch but skip the release command
  --reset-release-branch       Intentionally reset an existing release branch using an observed remote lease
  --no-reset-release-branch    Refuse existing release branches (default)
  --allow-empty-release        Patch-bump even when no commits follow the last tag
  --no-allow-empty-release     Return noChanges and skip later work on an empty range (default)
  --skip-pr                    Skip pull request creation
  --skip-preflight             Skip the fail-fast git-auth and token-permission checks
  --only <stage>[,...]         Select a stage prefix or PR-only recovery (repeatable, comma-split)
  --dry-run                    Print the plan summary without mutations, processes, or network
  --json                       Print one schema-1 JSON object; children cannot write to stdout
  -h, --help                   Show this help message

Numeric values use decimal digits only: no blanks, signs, leading zeros, fractions,
exponents, or hexadecimal forms. GitHub response bodies are capped at min(max-output-bytes, 1 MiB).

Examples:
  repo-toolkit-release-tag --tag 1.2.3 --base-branch main
  repo-toolkit-release-tag --only determine
  repo-toolkit-release-tag --only pr --tag 1.2.3 --base-branch main --auto-merge-pr --merge-method squash --delete-merged-branch
  repo-toolkit-release-tag --allow-empty-release --release-arg=--verbose --timeout-ms 120000
  repo-toolkit-release-tag --skip-release --skip-pr --dry-run
  repo-toolkit-release-tag --dry-run --json
`;
}
