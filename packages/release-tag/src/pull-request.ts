import { isPlainObject } from '@repo-toolkit/publish-package';

import { stageCredentialContext, type CredentialContext } from './credentials';
import type { DeterminedTag } from './determine';
import { knownCredentialSecrets, redactText, safeError, safeMetadata } from './diagnostics';
import {
  MAX_RESPONSE_BYTES_CAP,
  createGitHubHeaders,
  resolveFetchFn,
  resolveOwnerRepo,
  sendGitHubRequest,
} from './github';
import { buildGitHubApiUrl } from './github-url';
import type { ReleaseTagPlan } from './plan';
import { runPullRequestLifecycle, type PullRequestRequest } from './pull-request-lifecycle';
import { requiresMergedRecovery, type ReleaseRecovery } from './recovery';
import type { ReleaseBranchResult } from './release';
import { stripTagSignature } from './tag-message';
import { assertDetermined, assertPlanIdentity, assertRelease, resolveMergeMethod } from './validation';

export interface PullRequestResult {
  skipped: boolean;
  skippedReason: string | null;
  number: number | null;
  url: string | null;
  reused: boolean;
  merged: boolean;
  branchDeleted: boolean;
}

export interface CreateReleasePullRequestInput {
  plan: ReleaseTagPlan;
  determined: DeterminedTag;
  release: ReleaseBranchResult;
  githubToken?: string;
  fetchFn?: typeof fetch;
}

export function formatPullRequestBody(tagMessage: string, secrets: ReadonlyArray<string | undefined> = []): string {
  if (typeof tagMessage !== 'string') {
    throw new Error('tagMessage must be a string');
  }
  return redactText(
    `### Release Candidate Details\n\n${stripTagSignature(tagMessage)}\n\n---\n\n> This PR was automatically generated.`,
    [...secrets, ...knownCredentialSecrets(undefined, undefined)],
  );
}

function skippedResult(reason: string): PullRequestResult {
  return {
    skipped: true,
    skippedReason: reason,
    number: null,
    url: null,
    reused: false,
    merged: false,
    branchDeleted: false,
  };
}

export async function preparePullRequestWithContext(
  plan: ReleaseTagPlan,
  context: CredentialContext,
): Promise<{ token: string } | { skipped: PullRequestResult }> {
  if (plan.skipPr) {
    return { skipped: skippedResult('skipped via skipPr') };
  }
  if (!plan.only.includes('pr')) {
    return { skipped: skippedResult('stage not selected') };
  }
  if (plan.dryRun) {
    return { skipped: skippedResult('dry-run') };
  }
  buildGitHubApiUrl(plan.githubApiUrl, ['repos']);
  const token = await context.resolve(plan);
  return token === undefined ? { skipped: skippedResult('github token not available') } : { token };
}

export async function createReleasePullRequestWithContext(
  input: CreateReleasePullRequestInput,
  context: CredentialContext,
  recovery?: ReleaseRecovery,
): Promise<PullRequestResult> {
  if (!isPlainObject(input)) {
    throw new Error('input must be an object');
  }
  if (!isPlainObject(input.plan)) {
    throw new Error('plan must be an object');
  }
  const plan = input.plan;
  assertPlanIdentity(plan, process.env);
  assertDetermined(input.determined, plan);
  assertRelease(input.release, plan, input.determined, process.env);
  const determined = input.determined;
  const release = input.release;
  const requireAlreadyMerged = requiresMergedRecovery(recovery, input);
  const preparation = await preparePullRequestWithContext(plan, context);
  if ('skipped' in preparation) {
    return preparation.skipped;
  }

  const fetchFn = resolveFetchFn(plan, input);
  const ownerRepo = resolveOwnerRepo(plan);
  const repoPath = ['repos', ownerRepo.owner, ownerRepo.repo];
  const responseLimit = Math.min(plan.maxOutputBytes, MAX_RESPONSE_BYTES_CAP);
  const headers = createGitHubHeaders(preparation.token);
  const secrets = context.secrets();

  const { githubApiUrl, timeoutMs } = plan;
  const request: PullRequestRequest = (method, path, label, body, query) =>
    sendGitHubRequest(
      fetchFn,
      buildGitHubApiUrl(githubApiUrl, [...repoPath, ...path], query),
      method,
      headers,
      body === undefined ? undefined : JSON.stringify(body),
      timeoutMs,
      responseLimit,
      label,
      secrets,
    );
  return runPullRequestLifecycle({
    request,
    expected: {
      ...ownerRepo,
      head: release.releaseBranch,
      base: release.baseBranch,
      releasedHead: release.releasedHead,
    },
    title: redactText(release.prTitle, secrets),
    body: formatPullRequestBody(release.tagMessage, secrets),
    labels: ['changelog', 'release-candidate', determined.tagVersion],
    autoMergePr: plan.autoMergePr,
    deleteMergedBranch: plan.deleteMergedBranch,
    mergeMethod: resolveMergeMethod(plan.mergeMethod),
    requireAlreadyMerged,
    secrets,
  });
}

export async function createReleasePullRequest(input: CreateReleasePullRequestInput): Promise<PullRequestResult> {
  const context = stageCredentialContext(input);
  try {
    return safeMetadata(await createReleasePullRequestWithContext(input, context), context.secrets());
  } catch (error) {
    throw safeError(error, context.secrets());
  }
}
