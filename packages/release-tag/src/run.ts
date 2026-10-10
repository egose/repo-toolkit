import { isPlainObject, redactSensitiveValues } from '@repo-toolkit/publish-package';

import { determineNextTag, type DeterminedTag } from './determine';
import { resolveReleaseTagPlan, type ReleaseTagOptions, type ReleaseTagPlan } from './plan';
import { runReleaseBranch, type ReleaseBranchResult } from './release';
import { createReleasePullRequest, type PullRequestResult } from './pull-request';

export interface ReleaseTagResult {
  plan: ReleaseTagPlan;
  determined: DeterminedTag | null;
  release: ReleaseBranchResult | null;
  pullRequest: PullRequestResult | null;
}

function collectSecrets(options: ReleaseTagOptions, plan: ReleaseTagPlan): string[] {
  const secrets: string[] = [];
  if (typeof options.githubToken === 'string' && options.githubToken.length > 0) {
    secrets.push(options.githubToken);
  }
  const envValue = process.env[plan.githubTokenEnv];
  if (typeof envValue === 'string' && envValue.length > 0 && secrets.indexOf(envValue) < 0) {
    secrets.push(envValue);
  }
  return secrets;
}

function redactError(error: unknown, secrets: ReadonlyArray<string>): unknown {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = redactSensitiveValues(message, secrets);
  if (error instanceof Error && redacted === message) {
    return error;
  }
  const wrapped = new Error(redacted) as Error & { cause?: unknown };
  wrapped.cause = error;
  if (error instanceof Error && error.name !== 'Error') {
    wrapped.name = error.name;
  }
  return wrapped;
}

function resolveExplicitToken(options: ReleaseTagOptions): string | undefined {
  if (typeof options.githubToken === 'string' && options.githubToken.length > 0) {
    return options.githubToken;
  }
  return undefined;
}

export async function runReleaseTag(options: ReleaseTagOptions = {}): Promise<ReleaseTagResult> {
  if (!isPlainObject(options)) {
    throw new Error('options must be an object');
  }
  const plan = resolveReleaseTagPlan(options);
  const secrets = collectSecrets(options, plan);
  if (plan.dryRun) {
    return { plan, determined: null, release: null, pullRequest: null };
  }
  try {
    let determined: DeterminedTag | null = null;
    let release: ReleaseBranchResult | null = null;
    let pullRequest: PullRequestResult | null = null;
    if (plan.only.includes('determine')) {
      determined = await determineNextTag({ plan });
    }
    if (plan.only.includes('release')) {
      if (determined === null) {
        throw new Error("Stage 'release' requires stage 'determine' to be selected (use --only determine,release).");
      }
      release = await runReleaseBranch({ plan, determined });
    }
    if (plan.only.includes('pr')) {
      if (determined === null || release === null) {
        throw new Error(
          "Stage 'pr' requires stages 'determine' and 'release' to be selected (use --only determine,release,pr).",
        );
      }
      const explicitToken = resolveExplicitToken(options);
      pullRequest =
        explicitToken === undefined
          ? await createReleasePullRequest({ plan, determined, release })
          : await createReleasePullRequest({ plan, determined, release, githubToken: explicitToken });
    }
    return { plan, determined, release, pullRequest };
  } catch (error) {
    throw redactError(error, secrets);
  }
}
