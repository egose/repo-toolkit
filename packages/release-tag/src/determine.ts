import {
  bumpVersion,
  isPlainObject,
  type CapturingProcessRunner,
  type VersionBump,
} from '@repo-toolkit/publish-package';

import { parseCommitLog, selectCommitBump } from './conventional-commits';
import { stageCredentialContext, type CredentialContext } from './credentials';
import { safeError, safeMetadata } from './diagnostics';
import type { ReleaseTagPlan } from './plan';
import { captureCommand, resolveProcessRunner } from './process';
import { assertPlanIdentity, assertStableTagVersion, assertStableVersion, normalizeStableTag } from './validation';

export interface DeterminedTag {
  version: string;
  tagVersion: string;
  bump: VersionBump | null;
  lastTag: string | null;
  manual: boolean;
  noChanges: boolean;
}

export interface DetermineNextTagInput {
  plan: ReleaseTagPlan;
  githubToken?: string;
  runner?: CapturingProcessRunner;
}

const NO_PREVIOUS_TAG_MESSAGE =
  'No previous tag found and no tag input provided. Provide --tag once to seed release history.';

function resolveManualTag(rawTag: string): DeterminedTag {
  const version = normalizeStableTag(rawTag);
  return { version, tagVersion: `v${version}`, bump: null, lastTag: null, manual: true, noChanges: false };
}

export async function determineNextTagWithContext(
  input: DetermineNextTagInput,
  context: CredentialContext,
): Promise<DeterminedTag> {
  if (!isPlainObject(input)) {
    throw new Error('input must be an object');
  }
  const plan = input.plan;
  if (!isPlainObject(plan)) {
    throw new Error('plan must be an object');
  }
  assertPlanIdentity(plan);
  const runner = resolveProcessRunner(plan, input.runner);

  if (plan.tag !== undefined) {
    return resolveManualTag(plan.tag);
  }

  const describeResult = await captureCommand(runner, plan, plan.gitExecutable, ['describe', '--tags', '--abbrev=0'], {
    ...context.diagnostics(plan),
    label: 'git describe --tags --abbrev=0',
    failureMessage: NO_PREVIOUS_TAG_MESSAGE,
  });
  if (describeResult.stdout.trim().length === 0) {
    throw new Error(NO_PREVIOUS_TAG_MESSAGE);
  }
  const lastTag = describeResult.stdout.replace(/\r?\n$/, '');
  assertStableTagVersion(lastTag, 'Last tag');

  const range = `${lastTag}..HEAD`;
  const logResult = await captureCommand(runner, plan, plan.gitExecutable, ['log', range, '-z', '--format=%H%x00%B'], {
    ...context.diagnostics(plan),
    label: `git log ${range}`,
  });
  const commits = parseCommitLog(logResult.stdout);
  if (commits.length === 0 && !plan.allowEmptyRelease) {
    return { version: lastTag.slice(1), tagVersion: lastTag, bump: null, lastTag, manual: false, noChanges: true };
  }
  const bump = selectCommitBump(commits);
  const version = bumpVersion(lastTag.slice(1), bump);
  assertStableVersion(version, 'determined.version');
  return { version, tagVersion: `v${version}`, bump, lastTag, manual: false, noChanges: false };
}

export async function determineNextTag(input: DetermineNextTagInput): Promise<DeterminedTag> {
  const context = stageCredentialContext(input);
  try {
    return safeMetadata(await determineNextTagWithContext(input, context), context.secrets());
  } catch (error) {
    throw safeError(error, context.secrets());
  }
}
