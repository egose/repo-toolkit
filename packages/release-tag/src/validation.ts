import { isPlainObject, isVersionBump } from '@repo-toolkit/publish-package';

import type { DeterminedTag } from './determine';
import type { ReleaseTagMergeMethod, ReleaseTagPlan } from './plan';
import type { ReleaseBranchResult } from './release';

interface IdentityEnvironment {
  GITHUB_REF_NAME?: string;
  GITHUB_REF_TYPE?: string;
  GITHUB_REF?: string;
  GITHUB_REPOSITORY?: string;
}

const VERSION_CORE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const INVALID_BRANCH_CHARACTER_PATTERN = /[\s\p{Cc}\p{Cs}~^:?*[\\]/u;
const REPOSITORY_COMPONENT_PATTERN = /^[A-Za-z0-9_.-]+$/;

export const BRANCH_GUARD_MESSAGE =
  'This workflow must be run on a branch, not a tag. Check out the intended base branch and provide --base-branch.';

export function assertBranchName(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty short Git branch name`);
  }
  if (
    value === 'HEAD' ||
    value === '@' ||
    value.startsWith('-') ||
    value.startsWith('refs/') ||
    value.endsWith('.') ||
    value.includes('..') ||
    value.includes('@{') ||
    INVALID_BRANCH_CHARACTER_PATTERN.test(value) ||
    value
      .split('/')
      .some((component) => component.length === 0 || component.startsWith('.') || component.endsWith('.lock'))
  ) {
    throw new Error(`${label} must be a valid short Git branch name, not HEAD, an option, or a full refs/* alias`);
  }
}

export function assertBaseBranch(value: unknown, label = 'baseBranch'): asserts value is string {
  if (
    typeof value === 'string' &&
    (value.length === 0 ||
      value === 'HEAD' ||
      value.startsWith('refs/tags/') ||
      (value.startsWith('v') && VERSION_CORE_PATTERN.exec(value.slice(1))?.[0] === value.slice(1)))
  ) {
    throw new Error(`${label}: ${BRANCH_GUARD_MESSAGE}`);
  }
  assertBranchName(value, label);
}

export function assertDistinctBranches(baseBranch: string | undefined, releaseBranch: string | undefined): void {
  if (baseBranch !== undefined && baseBranch === releaseBranch) {
    throw new Error('releaseBranch must be different from baseBranch');
  }
}

export function assertGitObjectId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.exec(value)?.[0] !== value || /^0+$/.test(value)) {
    throw new Error(`${label} must be a full nonzero Git object ID (40 or 64 lowercase hexadecimal characters)`);
  }
}

export function assertStableVersion(value: unknown, label: string): asserts value is string {
  const match = typeof value === 'string' ? VERSION_CORE_PATTERN.exec(value) : null;
  if (match === null || match[0] !== value) {
    throw new Error(`${label} must be a stable X.Y.Z version with no leading zeros, prerelease, or build metadata`);
  }
  if (match.slice(1).some((component) => !Number.isSafeInteger(Number(component)))) {
    throw new Error(`${label} numeric components must be safe integers (0 through ${Number.MAX_SAFE_INTEGER})`);
  }
}

export function normalizeStableTag(value: unknown, label = 'tag'): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  const version = value.startsWith('v') ? value.slice(1) : value;
  assertStableVersion(version, label);
  return version;
}

export function assertStableTagVersion(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.startsWith('v')) {
    throw new Error(`${label} must use vX.Y.Z format`);
  }
  assertStableVersion(value.slice(1), label);
}

export function resolveBaseBranchInput(plan: ReleaseTagPlan, env: IdentityEnvironment): string | undefined {
  if (plan.baseBranch !== undefined) {
    assertBaseBranch(plan.baseBranch);
    return plan.baseBranch;
  }
  if (env.GITHUB_REF_TYPE === 'tag' || env.GITHUB_REF?.startsWith('refs/tags/')) {
    throw new Error(`Cannot infer baseBranch from a tag checkout. ${BRANCH_GUARD_MESSAGE}`);
  }
  const refName = env.GITHUB_REF_NAME;
  if (refName === undefined || refName.length === 0) {
    return undefined;
  }
  assertBaseBranch(refName, 'GITHUB_REF_NAME');
  return refName;
}

export function parseOwnerRepo(value: unknown, label: string): { owner: string; repo: string } {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string in owner/repo form`);
  }
  const parts = value.split('/');
  if (
    parts.length !== 2 ||
    parts.some(
      (component) =>
        component === '.' || component === '..' || REPOSITORY_COMPONENT_PATTERN.exec(component)?.[0] !== component,
    )
  ) {
    throw new Error(
      `${label} must use owner/repo form with letters, numbers, dots, underscores, or hyphens and no dot segments`,
    );
  }
  return { owner: parts[0], repo: parts[1] };
}

export function resolveOptionalOwnerRepo(
  plan: ReleaseTagPlan,
  env: IdentityEnvironment,
): { owner: string; repo: string } | undefined {
  if (plan.githubRepository !== undefined) {
    return parseOwnerRepo(plan.githubRepository, 'githubRepository');
  }
  const repository = env.GITHUB_REPOSITORY;
  if (repository === undefined || repository.length === 0) {
    return undefined;
  }
  return parseOwnerRepo(repository, 'GITHUB_REPOSITORY');
}

export function resolveMergeMethod(value: unknown): ReleaseTagMergeMethod {
  if (value === undefined) {
    return 'merge';
  }
  if (value !== 'merge' && value !== 'squash' && value !== 'rebase') {
    throw new Error('mergeMethod must be merge, squash, or rebase');
  }
  return value;
}

export function assertPlanIdentity(plan: ReleaseTagPlan, env: IdentityEnvironment = {}): void {
  if (plan.allowEmptyRelease !== undefined && typeof plan.allowEmptyRelease !== 'boolean') {
    throw new Error('allowEmptyRelease must be a boolean');
  }
  if (plan.resetReleaseBranch !== undefined && typeof plan.resetReleaseBranch !== 'boolean') {
    throw new Error('resetReleaseBranch must be a boolean');
  }
  resolveMergeMethod(plan.mergeMethod);
  const version = plan.tag === undefined ? undefined : normalizeStableTag(plan.tag, 'plan.tag');
  const baseBranch = resolveBaseBranchInput(plan, plan.only.includes('release') ? env : {});
  const releaseBranch =
    plan.releaseBranch === undefined && version !== undefined ? `changelog/${version}` : plan.releaseBranch;
  if (releaseBranch !== undefined) {
    assertBranchName(releaseBranch, 'releaseBranch');
  }
  assertDistinctBranches(baseBranch, releaseBranch);
  resolveOptionalOwnerRepo(plan, plan.only.includes('pr') ? env : {});
}

export function assertDetermined(value: unknown, plan: ReleaseTagPlan): asserts value is DeterminedTag {
  if (!isPlainObject(value)) {
    throw new Error('determined must be an object');
  }
  const candidate = value as Partial<DeterminedTag>;
  assertStableVersion(candidate.version, 'determined.version');
  assertStableTagVersion(candidate.tagVersion, 'determined.tagVersion');
  if (candidate.tagVersion !== `v${candidate.version}`) {
    throw new Error("determined.tagVersion must equal 'v' + determined.version");
  }
  if (plan.tag !== undefined && normalizeStableTag(plan.tag, 'plan.tag') !== candidate.version) {
    throw new Error('plan.tag must match determined.version');
  }
  if (candidate.bump !== null && !isVersionBump(candidate.bump)) {
    throw new Error('determined.bump must be major, minor, patch, or null');
  }
  if (candidate.lastTag !== null) {
    assertStableTagVersion(candidate.lastTag, 'determined.lastTag');
  }
  if (typeof candidate.manual !== 'boolean') {
    throw new Error('determined.manual must be a boolean');
  }
  if (typeof candidate.noChanges !== 'boolean') {
    throw new Error('determined.noChanges must be a boolean');
  }
}

export function resolveReleaseBranchName(plan: ReleaseTagPlan, determined: DeterminedTag): string {
  const branch = plan.releaseBranch === undefined ? `changelog/${determined.version}` : plan.releaseBranch;
  assertBranchName(branch, 'releaseBranch');
  return branch;
}

export function assertRelease(
  value: unknown,
  plan: ReleaseTagPlan,
  determined: DeterminedTag,
  env: IdentityEnvironment,
): asserts value is ReleaseBranchResult {
  if (!isPlainObject(value)) {
    throw new Error('release must be an object');
  }
  const candidate = value as Partial<ReleaseBranchResult>;
  assertBaseBranch(candidate.baseBranch, 'release.baseBranch');
  assertBranchName(candidate.releaseBranch, 'release.releaseBranch');
  assertDistinctBranches(candidate.baseBranch, candidate.releaseBranch);
  const baseBranch = resolveBaseBranchInput(plan, env);
  if (baseBranch !== undefined && baseBranch !== candidate.baseBranch) {
    throw new Error('release.baseBranch must match the configured baseBranch or GITHUB_REF_NAME');
  }
  if (candidate.releaseBranch !== resolveReleaseBranchName(plan, determined)) {
    throw new Error('release.releaseBranch must match the configured releaseBranch or changelog/<determined.version>');
  }
  if (typeof candidate.prTitle !== 'string' || candidate.prTitle.length === 0) {
    throw new Error('release.prTitle must be a non-empty string');
  }
  if (typeof candidate.tagMessage !== 'string') {
    throw new Error('release.tagMessage must be a string');
  }
  if (typeof candidate.releaseRan !== 'boolean') {
    throw new Error('release.releaseRan must be a boolean');
  }
  if (candidate.releasedHead !== undefined) {
    assertGitObjectId(candidate.releasedHead, 'release.releasedHead');
  }
  if (candidate.skippedReason !== null && typeof candidate.skippedReason !== 'string') {
    throw new Error('release.skippedReason must be a string or null');
  }
}
