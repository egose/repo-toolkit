import { isPlainObject } from '@repo-toolkit/publish-package';

import { createCredentialContext } from './credentials';
import { determineNextTagWithContext, type DeterminedTag } from './determine';
import { readProperty, safeError, safeMetadata } from './diagnostics';
import {
  cloneStagePlan,
  resolveReleaseTagPlan,
  snapshotReleaseTagPlan,
  type ReleaseTagOptions,
  type ReleaseTagPlan,
} from './plan';
import { runPreflightWithContext } from './preflight';
import { resolveReleaseBranchRefsWithContext, runReleaseBranchWithContext, type ReleaseBranchResult } from './release';
import {
  createReleasePullRequestWithContext,
  preparePullRequestWithContext,
  type PullRequestResult,
} from './pull-request';
import { assertRecoveryInputs, readReleaseRecoveryWithContext } from './recovery';
import { assertPlanIdentity } from './validation';

export interface ReleaseTagResult {
  plan: ReleaseTagPlan;
  determined: DeterminedTag | null;
  release: ReleaseBranchResult | null;
  pullRequest: PullRequestResult | null;
}

function assertStageSelection(plan: ReleaseTagPlan): void {
  const only = plan.only;
  if (only.length === 1 && only[0] === 'pr') {
    assertRecoveryInputs(plan);
    return;
  }
  if (only.includes('release') && !only.includes('determine')) {
    throw new Error("Stage 'release' requires stage 'determine' to be selected (use --only determine,release).");
  }
  if (only.includes('pr') && (!only.includes('determine') || !only.includes('release'))) {
    throw new Error(
      "Stage 'pr' requires stages 'determine' and 'release' to be selected, or PR-only recovery with explicit tag and baseBranch (use --only determine,release,pr or --only pr --tag X.Y.Z --base-branch main).",
    );
  }
}

export async function runReleaseTag(options: ReleaseTagOptions = {}): Promise<ReleaseTagResult> {
  const context = createCredentialContext(
    readProperty(options, 'githubToken'),
    readProperty(options, 'githubTokenEnv'),
  );
  try {
    if (!isPlainObject(options)) {
      throw new Error('options must be an object');
    }
    const plan = resolveReleaseTagPlan(options);
    assertStageSelection(plan);
    if (plan.dryRun) {
      assertPlanIdentity(plan, process.env);
      return {
        plan: snapshotReleaseTagPlan(plan, context.secrets()),
        determined: null,
        release: null,
        pullRequest: null,
      };
    }
    let determined: DeterminedTag | null = null;
    let release: ReleaseBranchResult | null = null;
    let pullRequest: PullRequestResult | null = null;
    if (plan.only.length === 1 && plan.only[0] === 'pr') {
      assertPlanIdentity(plan, process.env);
      const preparation = await preparePullRequestWithContext(plan, context);
      if ('skipped' in preparation) {
        pullRequest = preparation.skipped;
      } else {
        const recovery = await readReleaseRecoveryWithContext(plan, context);
        await runPreflightWithContext({ plan }, context);
        pullRequest = await createReleasePullRequestWithContext(
          { plan, determined: recovery.determined, release: recovery.release },
          context,
          recovery,
        );
      }
    } else if (plan.only.includes('determine')) {
      determined = await determineNextTagWithContext({ plan }, context);
    }
    if (determined !== null && !determined.noChanges) {
      assertPlanIdentity(plan, process.env);
      const stagePlan = plan.only.includes('release')
        ? cloneStagePlan(
            plan,
            await resolveReleaseBranchRefsWithContext({ plan, determined }, context),
            context.secrets(),
          )
        : plan;
      await runPreflightWithContext({ plan: stagePlan }, context);
      if (determined !== null && plan.only.includes('release')) {
        release = await runReleaseBranchWithContext({ plan: stagePlan, determined }, context);
      }
      if (determined !== null && release !== null && plan.only.includes('pr')) {
        pullRequest = await createReleasePullRequestWithContext({ plan: stagePlan, determined, release }, context);
      }
    }
    const secrets = context.secrets();
    return {
      plan: snapshotReleaseTagPlan(plan, secrets),
      determined: determined === null ? null : safeMetadata(determined, secrets),
      release: release === null ? null : safeMetadata(release, secrets),
      pullRequest: pullRequest === null ? null : safeMetadata(pullRequest, secrets),
    };
  } catch (error) {
    throw safeError(error, context.secrets());
  }
}
