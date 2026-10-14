import type { CredentialContext } from './credentials';
import { determineNextTagWithContext, type DeterminedTag } from './determine';
import type { ReleaseTagPlan } from './plan';
import { resolveProcessRunner } from './process';
import type { CreateReleasePullRequestInput } from './pull-request';
import type { ReleaseBranchResult } from './release';
import { captureGit, readCommit, readLocalRef, readRemoteRef } from './release-git';
import { stripTagSignature } from './tag-message';
import { assertPlanIdentity, resolveReleaseBranchName } from './validation';

class VerifiedReleaseRecovery {
  constructor(
    readonly determined: DeterminedTag,
    readonly release: ReleaseBranchResult,
    readonly remoteBranchMissing: boolean,
  ) {
    Object.freeze(determined);
    Object.freeze(release);
    Object.freeze(this);
  }
}

export type ReleaseRecovery = VerifiedReleaseRecovery;

export function assertRecoveryInputs(
  plan: ReleaseTagPlan,
): asserts plan is ReleaseTagPlan & { tag: string; baseBranch: string } {
  if (plan.only.length !== 1 || plan.only[0] !== 'pr') {
    throw new Error("PR-only recovery requires only: ['pr'] (--only pr)");
  }
  if (plan.tag === undefined || plan.baseBranch === undefined) {
    throw new Error(
      'PR-only recovery requires explicit tag and baseBranch inputs (use --only pr --tag X.Y.Z --base-branch main); environment base inference is not used.',
    );
  }
  assertPlanIdentity(plan);
}

export function requiresMergedRecovery(
  recovery: ReleaseRecovery | undefined,
  input: CreateReleasePullRequestInput,
): boolean {
  if (recovery === undefined) {
    return false;
  }
  assertRecoveryInputs(input.plan);
  if (
    !(recovery instanceof VerifiedReleaseRecovery) ||
    recovery.determined !== input.determined ||
    recovery.release !== input.release ||
    recovery.release.releasedHead === undefined
  ) {
    throw new Error('PR-only recovery requires its original read-only verified tag and release identity');
  }
  return recovery.remoteBranchMissing;
}

export async function readReleaseRecoveryWithContext(
  plan: ReleaseTagPlan,
  context: CredentialContext,
): Promise<ReleaseRecovery> {
  assertRecoveryInputs(plan);
  const determined = await determineNextTagWithContext({ plan }, context);
  const releaseBranch = resolveReleaseBranchName(plan, determined);
  const runner = resolveProcessRunner(plan);
  const diagnostics = context.diagnostics(plan);
  const tagRef = `refs/tags/${determined.tagVersion}`;
  const tagObject = await readLocalRef(runner, plan, tagRef, diagnostics);
  if (tagObject === null) {
    throw new Error(
      `PR-only recovery requires existing local target tag ${determined.tagVersion}. Obtain and verify that tag before retrying; recovery does not fetch or recreate refs.`,
    );
  }
  const releasedHead = await readCommit(
    runner,
    plan,
    tagObject,
    `PR-only recovery: local target tag ${determined.tagVersion} must resolve to a commit`,
    diagnostics,
  );
  const tag = await captureGit(
    runner,
    plan,
    ['cat-file', '-p', tagObject],
    'PR-only recovery: read target tag metadata',
    undefined,
    diagnostics,
  );
  const separator = tag.stdout.indexOf('\n\n');
  if (separator < 0) {
    throw new Error('PR-only recovery received invalid target tag/commit metadata');
  }
  const tagMessage = stripTagSignature(tag.stdout.slice(separator + 2)).replace(/[\r\n]+$/, '');
  const releaseRef = `refs/heads/${releaseBranch}`;
  const localHead = await readLocalRef(runner, plan, releaseRef, diagnostics);
  if (localHead !== null && localHead !== releasedHead) {
    throw new Error(
      `PR-only recovery: local release branch ${releaseBranch} does not match target tag ${determined.tagVersion}. Inspect the existing release identity; no refs were changed.`,
    );
  }
  const remoteHead = await readRemoteRef(runner, plan, releaseRef, diagnostics);
  if (remoteHead !== null && remoteHead !== releasedHead) {
    throw new Error(
      `PR-only recovery: origin release branch ${releaseBranch} does not match target tag ${determined.tagVersion}. Inspect the published release identity; no refs were changed.`,
    );
  }
  if ((await readLocalRef(runner, plan, tagRef, diagnostics)) !== tagObject) {
    throw new Error(
      'PR-only recovery: local target tag changed during inspection. Stop concurrent ref writers and verify the release identity before retrying.',
    );
  }
  return new VerifiedReleaseRecovery(
    determined,
    {
      baseBranch: plan.baseBranch,
      releaseBranch,
      releaseRan: false,
      releasedHead,
      skippedReason: 'PR-only recovery (read-only Git)',
      tagMessage,
      prTitle: `chore(release): release candidate ${determined.tagVersion}`,
    },
    remoteHead === null,
  );
}
