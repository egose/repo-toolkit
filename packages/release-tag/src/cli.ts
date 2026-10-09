import { parseFlags, redactSensitiveValues, type FlagSpec } from '@repo-toolkit/publish-package';

import type { ReleaseTagOptions, ReleaseTagPlan } from './plan';
import { runReleaseTag, type ReleaseTagResult } from './run';

export const RELEASE_TAG_CLI_SCHEMA_VERSION = 1;

export const SPECS: FlagSpec[] = [
  { name: 'tag' },
  { name: 'cwd' },
  { name: 'base-branch' },
  { name: 'release-branch' },
  { name: 'git-executable' },
  { name: 'release-command', aliases: ['release-it-path'] },
  { name: 'git-user-name' },
  { name: 'git-user-email' },
  { name: 'sign-commit', boolean: true, negatable: true },
  { name: 'github-token' },
  { name: 'github-token-file' },
  { name: 'github-token-env' },
  { name: 'github-repository' },
  { name: 'github-api-url' },
  { name: 'auto-merge-pr', boolean: true },
  { name: 'delete-merged-branch', boolean: true },
  { name: 'skip-release', boolean: true },
  { name: 'skip-pr', boolean: true },
  { name: 'only', list: true },
  { name: 'dry-run', boolean: true },
  { name: 'json', boolean: true },
];

export function buildOptions(result: Exclude<ReturnType<typeof parseFlags>, null>): ReleaseTagOptions {
  const values = result.values;
  const options: ReleaseTagOptions = {};
  if (values.tag !== undefined) {
    options.tag = values.tag;
  }
  if (values.cwd !== undefined) {
    options.cwd = values.cwd;
  }
  if (values['base-branch'] !== undefined) {
    options.baseBranch = values['base-branch'];
  }
  if (values['release-branch'] !== undefined) {
    options.releaseBranch = values['release-branch'];
  }
  if (values['git-executable'] !== undefined) {
    options.gitExecutable = values['git-executable'];
  }
  if (values['release-command'] !== undefined) {
    options.releaseCommand = values['release-command'];
  }
  if (values['git-user-name'] !== undefined) {
    options.gitUserName = values['git-user-name'];
  }
  if (values['git-user-email'] !== undefined) {
    options.gitUserEmail = values['git-user-email'];
  }
  if (values['sign-commit'] !== undefined) {
    options.signCommit = values['sign-commit'] === 'true';
  }
  if (values['github-token'] !== undefined) {
    options.githubToken = values['github-token'];
  }
  if (values['github-token-file'] !== undefined) {
    options.githubTokenFile = values['github-token-file'];
  }
  if (values['github-token-env'] !== undefined) {
    options.githubTokenEnv = values['github-token-env'];
  }
  if (values['github-repository'] !== undefined) {
    options.githubRepository = values['github-repository'];
  }
  if (values['github-api-url'] !== undefined) {
    options.githubApiUrl = values['github-api-url'];
  } else {
    const fallback = process.env.GITHUB_API_URL;
    if (typeof fallback === 'string' && fallback.length > 0) {
      options.githubApiUrl = fallback;
    }
  }
  if (values['auto-merge-pr'] !== undefined) {
    options.autoMergePr = values['auto-merge-pr'] === 'true';
  }
  if (values['delete-merged-branch'] !== undefined) {
    options.deleteMergedBranch = values['delete-merged-branch'] === 'true';
  }
  if (values['skip-release'] !== undefined) {
    options.skipRelease = values['skip-release'] === 'true';
  }
  if (values['skip-pr'] !== undefined) {
    options.skipPr = values['skip-pr'] === 'true';
  }
  const only = result.repeat.only;
  if (only !== undefined && only.length > 0) {
    options.only = [...only];
  }
  if (values['dry-run'] !== undefined) {
    options.dryRun = values['dry-run'] === 'true';
  }
  return options;
}

export function planSummary(plan: ReleaseTagPlan): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    cwd: plan.cwd,
    gitExecutable: plan.gitExecutable,
    gitUserName: plan.gitUserName,
    gitUserEmail: plan.gitUserEmail,
    signCommit: plan.signCommit,
    releaseCommand: plan.releaseCommand,
    releaseArgs: [...plan.releaseArgs],
    skipRelease: plan.skipRelease,
    githubTokenEnv: plan.githubTokenEnv,
    githubApiUrl: plan.githubApiUrl,
    autoMergePr: plan.autoMergePr,
    deleteMergedBranch: plan.deleteMergedBranch,
    skipPr: plan.skipPr,
    tokenSource: plan.tokenSource,
    tokenAvailable: plan.tokenAvailable,
    dryRun: plan.dryRun,
    only: [...plan.only],
    timeoutMs: plan.timeoutMs,
    maxOutputBytes: plan.maxOutputBytes,
  };
  if (plan.tag !== undefined) {
    summary.tag = plan.tag;
  }
  if (plan.baseBranch !== undefined) {
    summary.baseBranch = plan.baseBranch;
  }
  if (plan.releaseBranch !== undefined) {
    summary.releaseBranch = plan.releaseBranch;
  }
  if (plan.githubTokenFile !== undefined) {
    summary.githubTokenFile = plan.githubTokenFile;
  }
  if (plan.githubRepository !== undefined) {
    summary.githubRepository = plan.githubRepository;
  }
  return summary;
}

export function formatJsonResult(outcome: ReleaseTagResult): string {
  return JSON.stringify(
    {
      schemaVersion: RELEASE_TAG_CLI_SCHEMA_VERSION,
      plan: planSummary(outcome.plan),
      determined: outcome.determined,
      release: outcome.release,
      pullRequest: outcome.pullRequest,
    },
    null,
    2,
  );
}

export function formatJsonDryRun(plan: ReleaseTagPlan): string {
  return JSON.stringify(
    {
      schemaVersion: RELEASE_TAG_CLI_SCHEMA_VERSION,
      dryRun: true,
      plan: planSummary(plan),
      determined: null,
      release: null,
      pullRequest: null,
    },
    null,
    2,
  );
}

export function formatTextResult(outcome: ReleaseTagResult): string {
  const lines: string[] = [];
  if (outcome.determined === null) {
    lines.push('determine: not selected');
  } else {
    const determined = outcome.determined;
    lines.push(
      `determine: version ${determined.version} tag ${determined.tagVersion} bump ${determined.bump === null ? 'manual' : determined.bump} manual ${determined.manual ? 'true' : 'false'} lastTag ${determined.lastTag === null ? '(none)' : determined.lastTag}`,
    );
  }
  if (outcome.release === null) {
    lines.push('release: not selected');
  } else {
    const release = outcome.release;
    if (release.skippedReason !== null) {
      lines.push(
        `release: skipped (${release.skippedReason}) base ${release.baseBranch} branch ${release.releaseBranch} title ${release.prTitle}`,
      );
    } else {
      lines.push(
        `release: base ${release.baseBranch} branch ${release.releaseBranch} releaseRan ${release.releaseRan ? 'true' : 'false'} title ${release.prTitle}`,
      );
    }
  }
  if (outcome.pullRequest === null) {
    lines.push('pullRequest: not selected');
  } else {
    const pullRequest = outcome.pullRequest;
    if (pullRequest.skipped) {
      lines.push(
        `pullRequest: skipped (${pullRequest.skippedReason === null ? 'unknown' : pullRequest.skippedReason})`,
      );
    } else {
      lines.push(
        `pullRequest: number ${pullRequest.number === null ? '(none)' : String(pullRequest.number)} url ${pullRequest.url === null ? '(none)' : pullRequest.url} merged ${pullRequest.merged ? 'true' : 'false'} branchDeleted ${pullRequest.branchDeleted ? 'true' : 'false'}`,
      );
    }
  }
  return lines.join('\n');
}

export function formatTextDryRun(plan: ReleaseTagPlan): string {
  const summary = planSummary(plan);
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

function collectCliSecrets(result: Exclude<ReturnType<typeof parseFlags>, null>): string[] {
  const secrets: string[] = [];
  const explicit = result.values['github-token'];
  if (typeof explicit === 'string' && explicit.length > 0) {
    secrets.push(explicit);
  }
  const envName = result.values['github-token-env'] !== undefined ? result.values['github-token-env'] : 'GITHUB_TOKEN';
  const envValue = process.env[envName];
  if (typeof envValue === 'string' && envValue.length > 0 && secrets.indexOf(envValue) < 0) {
    secrets.push(envValue);
  }
  return secrets;
}

function printHelp(): void {
  console.log(`repo-toolkit-release-tag

Usage:
  repo-toolkit-release-tag [options]

Determine the next release tag, run the release on a changelog branch, and open a GitHub release pull request.

Stages (run in order by default):
  determine  Validate --tag or derive the next X.Y.Z from the latest vX.Y.Z plus Conventional Commits
  release    Create/reset changelog/<version>, configure the git author, run the release command, push, read tag message
  pr         Create pull request changelog/<version> -> base branch with labels and optional merge/delete

Conditional skips:
  --only determine[,release][,pr]  Run only selected stages; unselected stages yield null results
  --skip-release                   Create and push the branch but skip the release command (skipped result, not null)
  --skip-pr                        Skip pull request creation (skipped result, not null)
  --dry-run                        Print the resolved plan summary without spawning processes or network; determined is null
  Missing release command          Skip the release command without failing (reason: release command not available)
  Missing github token             Skip pull request creation without failing (reason: github token not available)

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
  --git-user-name <name>       Git author name (default: github-actions[bot])
  --git-user-email <email>     Git author email (default: github-actions[bot]@users.noreply.github.com)
  --sign-commit                Set commit.gpgsign=true and pass --gpg-sign to the release command
  --no-sign-commit             Disable commit signing
  --github-token <value>       GitHub token inline (prefer --github-token-file)
  --github-token-file <path>   File whose trimmed contents are the GitHub token
  --github-token-env <name>    Env var holding the token (default: GITHUB_TOKEN)
  --github-repository <o/r>    owner/repo; falls back to GITHUB_REPOSITORY
  --github-api-url <url>       API base; falls back to GITHUB_API_URL (default: https://api.github.com)
  --auto-merge-pr              Merge the created pull request
  --delete-merged-branch       Delete the release branch after a successful merge (requires --auto-merge-pr)
  --skip-release               Create and push the branch but skip the release command
  --skip-pr                    Skip pull request creation
  --only <stage>[,...]         Run only selected stages: determine, release, pr (repeatable, comma-split)
  --dry-run                    Print the plan summary without mutations, processes, or network
  --json                       Print a single JSON object with schema version, plan, and stage results
  -h, --help                   Show this help message

Examples:
  repo-toolkit-release-tag --tag 1.2.3 --base-branch main
  repo-toolkit-release-tag --only determine
  repo-toolkit-release-tag --skip-release --skip-pr --dry-run
  repo-toolkit-release-tag --dry-run --json
`);
}

async function main(): Promise<void> {
  const result = parseFlags(process.argv.slice(2), SPECS);
  if (!result) {
    printHelp();
    return;
  }
  const json = result.values.json === 'true';
  try {
    if (result.values['github-token'] !== undefined) {
      console.error(
        'warning: prefer --github-token-file over --github-token to avoid exposing the token in process listings',
      );
    }
    const options = buildOptions(result);
    const outcome = await runReleaseTag(options);
    if (outcome.plan.dryRun) {
      if (json) {
        console.log(formatJsonDryRun(outcome.plan));
      } else {
        console.log(formatTextDryRun(outcome.plan));
      }
      return;
    }
    if (json) {
      console.log(formatJsonResult(outcome));
    } else {
      console.log(formatTextResult(outcome));
    }
  } catch (error) {
    const secrets = collectCliSecrets(result);
    const message = error instanceof Error ? error.message : String(error);
    console.error(redactSensitiveValues(message, secrets));
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
