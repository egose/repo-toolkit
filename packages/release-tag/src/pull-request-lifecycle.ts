import { diagnosticText, safeError } from './diagnostics';
import { MAX_ERROR_CHARS, type GitHubRequestResult } from './github';
import type { ReleaseTagMergeMethod } from './plan';
import type { PullRequestResult } from './pull-request';
import { assertGitObjectId } from './validation';
import {
  assertCleanupRef,
  assertMergeConfirmed,
  parsePullRequestDetails,
  parsePullRequestJson,
  parsePullRequestList,
  parsePullRequestReference,
  type ExpectedPullRequest,
  type PullRequestDetails,
  type PullRequestRecord,
  type PullRequestReference,
} from './pull-request-data';

export type PullRequestRequest = (
  method: string,
  path: ReadonlyArray<string>,
  label: string,
  body?: unknown,
  query?: Readonly<Record<string, string>>,
) => Promise<GitHubRequestResult>;

interface PullRequestLifecycleInput {
  request: PullRequestRequest;
  expected: ExpectedPullRequest;
  title: string;
  body: string;
  labels: ReadonlyArray<string>;
  autoMergePr: boolean;
  deleteMergedBranch: boolean;
  mergeMethod: ReleaseTagMergeMethod;
  requireAlreadyMerged?: boolean;
  secrets: ReadonlyArray<string>;
}

function requireStatus(
  response: GitHubRequestResult,
  label: string,
  secrets: ReadonlyArray<string>,
  statuses?: ReadonlyArray<number>,
): void {
  if (statuses === undefined ? response.status >= 200 && response.status < 300 : statuses.includes(response.status)) {
    return;
  }
  throw new Error(
    `GitHub API request to ${label} failed (status=${response.status}): ${diagnosticText(response.text, secrets, MAX_ERROR_CHARS)}`,
  );
}

async function findPullRequest(input: PullRequestLifecycleInput): Promise<PullRequestRecord | null> {
  const { request, expected, secrets } = input;
  const response = await request('GET', ['pulls'], 'GET pulls', undefined, {
    state: 'all',
    head: `${expected.owner}:${expected.head}`,
    base: expected.base,
    per_page: '2',
    page: '1',
  });
  requireStatus(response, 'GET pulls', secrets, [200]);
  return parsePullRequestList(response, expected);
}

async function readPullRequest(
  input: PullRequestLifecycleInput,
  previous: PullRequestRecord,
): Promise<PullRequestDetails> {
  const response = await input.request('GET', ['pulls', String(previous.number)], 'GET pull');
  requireStatus(response, 'GET pull', input.secrets, [200]);
  return parsePullRequestDetails(parsePullRequestJson(response, 'GET pull'), input.expected, 'GET pull', previous);
}

function assertRecoverable(pull: PullRequestDetails): void {
  if (pull.state === 'closed' && !pull.merged) {
    throw new Error(
      'The matching PR is closed without merging. Reopen that PR after inspection, or choose a new release identity; it will not be replaced automatically',
    );
  }
}

async function cleanupBranch(input: PullRequestLifecycleInput, pull: PullRequestDetails): Promise<void> {
  const branch = ['heads', ...input.expected.head.split('/')];
  const current = await input.request('GET', ['git', 'ref', ...branch], 'GET ref');
  if (current.status === 404) {
    return;
  }
  requireStatus(current, 'GET ref', input.secrets, [200]);
  assertCleanupRef(current, input.expected, pull.headSha);
  const deleted = await input.request('DELETE', ['git', 'refs', ...branch], 'DELETE ref');
  requireStatus(deleted, 'DELETE ref', input.secrets, [204]);
}

export async function runPullRequestLifecycle(input: PullRequestLifecycleInput): Promise<PullRequestResult> {
  const { request, expected, title, body, secrets } = input;
  let reference: PullRequestReference | undefined;
  let stage = 'lookup';
  try {
    if (input.requireAlreadyMerged) {
      assertGitObjectId(expected.releasedHead, 'PR-only recovery releasedHead');
    }
    let existing = await findPullRequest(input);
    let reused = existing !== null;
    let pull: PullRequestDetails | undefined;
    if (existing === null) {
      if (input.requireAlreadyMerged) {
        throw new Error(
          'PR-only recovery: origin release branch is absent and no exact already-merged PR was found. Refusing to create a PR or reconstruct missing refs.',
        );
      }
      stage = 'create';
      const created = await request('POST', ['pulls'], 'POST pulls', {
        head: expected.head,
        base: expected.base,
        title,
        body,
      });
      if (created.status === 409 || created.status === 422) {
        stage = 'create-conflict lookup';
        existing = await findPullRequest(input);
        if (existing === null) {
          requireStatus(created, 'POST pulls (no exact PR found in the single conflict relookup)', secrets, [200, 201]);
        }
        reused = true;
      } else {
        requireStatus(created, 'POST pulls', secrets, [200, 201]);
        const data = parsePullRequestJson(created, 'POST pulls');
        reference = parsePullRequestReference(data, expected, 'POST pulls');
        pull = parsePullRequestDetails(data, expected, 'POST pulls');
        if (pull.state !== 'open' || pull.merged) {
          throw new Error(
            'POST pulls did not return an open, unmerged PR; inspect the creation result before resuming',
          );
        }
      }
    }
    if (existing !== null) {
      reference = existing;
      stage = 'read';
      pull = await readPullRequest(input, existing);
    }
    if (pull === undefined) {
      throw new Error('No exact release PR was confirmed after the bounded lookup');
    }
    reference = pull;
    assertRecoverable(pull);
    if (input.requireAlreadyMerged && !pull.merged) {
      throw new Error(
        'PR-only recovery: origin release branch is absent; the exact PR must already be merged at the verified target tag head before any write API is allowed. Inspect the release identity without reconstructing refs.',
      );
    }
    let mergeConfirmed = pull.merged;
    if (reused && !mergeConfirmed) {
      stage = 'update';
      const updated = await request('PATCH', ['pulls', String(pull.number)], 'PATCH pull', { title, body });
      requireStatus(updated, 'PATCH pull', secrets, [200]);
      pull = parsePullRequestDetails(parsePullRequestJson(updated, 'PATCH pull'), expected, 'PATCH pull', pull);
      assertRecoverable(pull);
      mergeConfirmed = pull.merged;
    }
    stage = 'labels';
    const labels = await request('POST', ['issues', String(pull.number), 'labels'], 'POST labels', {
      labels: input.labels,
    });
    requireStatus(labels, 'POST labels', secrets);

    if (input.autoMergePr && !mergeConfirmed) {
      stage = 'merge validation';
      pull = await readPullRequest(input, pull);
      assertRecoverable(pull);
      mergeConfirmed = pull.merged;
      if (!mergeConfirmed) {
        stage = 'merge';
        const merged = await request('PUT', ['pulls', String(pull.number), 'merge'], 'PUT merge', {
          merge_method: input.mergeMethod,
          sha: pull.headSha,
        });
        requireStatus(merged, 'PUT merge', secrets);
        assertMergeConfirmed(merged);
        mergeConfirmed = true;
      }
    }
    let branchDeleted = false;
    if (input.autoMergePr && mergeConfirmed && input.deleteMergedBranch) {
      stage = 'cleanup';
      await cleanupBranch(input, pull);
      branchDeleted = true;
    }
    return {
      skipped: false,
      skippedReason: null,
      number: pull.number,
      url: pull.url,
      reused,
      merged: mergeConfirmed,
      branchDeleted,
    };
  } catch (error) {
    const sanitized = safeError(error, secrets);
    const identity =
      reference === undefined
        ? 'Release PR'
        : `PR #${reference.number} (${diagnosticText(reference.url, secrets, 512)})`;
    const guidance =
      stage === 'create'
        ? 'Creation may have succeeded even if its response was lost or invalid; inspect the exact repository/head/base before resuming.'
        : stage === 'cleanup'
          ? 'Merge is confirmed. Inspect the current release ref before resuming cleanup.'
          : stage.startsWith('merge')
            ? 'Check the released head, required reviews/status checks, and branch protection before resuming the immediate REST merge.'
            : 'Inspect the PR and correct the failed operation before resuming.';
    const wrapped = new Error(
      `${identity}: PR stage failed at ${stage}. ${guidance} Resume createReleasePullRequest with the same verified determined/release metadata to rediscover the PR and reapply labels. ${diagnosticText(sanitized.message, secrets, MAX_ERROR_CHARS)}`,
    );
    wrapped.name = sanitized.name;
    throw safeError(wrapped, secrets);
  }
}
