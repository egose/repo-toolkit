import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { isPlainObject, type CapturingProcessRunner } from '@repo-toolkit/publish-package';

import { stageCredentialContext, type CredentialContext } from './credentials';
import type { DeterminedTag } from './determine';
import { safeError, safeMetadata } from './diagnostics';
import type { ReleaseTagPlan } from './plan';
import { captureCommand, resolveProcessRunner } from './process';
import { captureGit, inspectReleasePreparation, pushReleaseBranch, verifyReleasedHead } from './release-git';
import { stripTagSignature } from './tag-message';
import {
  BRANCH_GUARD_MESSAGE,
  assertBaseBranch,
  assertDetermined,
  assertDistinctBranches,
  assertPlanIdentity,
  resolveBaseBranchInput,
  resolveReleaseBranchName,
} from './validation';

export interface ReleaseBranchResult {
  baseBranch: string;
  releaseBranch: string;
  releaseRan: boolean;
  releasedHead?: string;
  skippedReason: string | null;
  tagMessage: string;
  prTitle: string;
}

export interface RunReleaseBranchInput {
  plan: ReleaseTagPlan;
  determined: DeterminedTag;
  githubToken?: string;
  runner?: CapturingProcessRunner;
}

const VERSION_PROBE_TIMEOUT_MS = 10000;

function stripTrailingNewlines(text: string): string {
  let end = text.length;
  while (end > 0) {
    const char = text[end - 1];
    if (char === '\n' || char === '\r') {
      end -= 1;
    } else {
      break;
    }
  }
  return text.slice(0, end);
}

async function resolveBaseBranch(
  plan: ReleaseTagPlan,
  runner: CapturingProcessRunner | undefined,
  context: CredentialContext,
): Promise<string> {
  const direct = resolveBaseBranchInput(plan, process.env);
  if (direct !== undefined) {
    return direct;
  }
  const result = await captureCommand(runner, plan, plan.gitExecutable, ['symbolic-ref', '--short', 'HEAD'], {
    ...context.diagnostics(plan),
    label: 'git symbolic-ref --short HEAD',
    failureMessage: BRANCH_GUARD_MESSAGE,
  });
  const branch = result.stdout.replace(/\r?\n$/, '');
  assertBaseBranch(branch);
  return branch;
}

async function assertReleaseCommandAvailable(
  plan: ReleaseTagPlan,
  runner: CapturingProcessRunner | undefined,
  context: CredentialContext,
): Promise<void> {
  const guidance = `Release command ${JSON.stringify(plan.releaseCommand)} is not available. Install an executable release command or configure releaseCommand; use skipRelease only for deliberate branch preparation.`;
  if (plan.releaseCommand.includes('/')) {
    const resolved = resolvePath(plan.cwd, plan.releaseCommand);
    try {
      if (!(await stat(resolved)).isFile()) {
        throw new Error('not a regular executable file');
      }
      await access(resolved, constants.X_OK);
    } catch {
      throw new Error(guidance);
    }
    return;
  }
  const timeoutMs = Math.min(plan.timeoutMs, VERSION_PROBE_TIMEOUT_MS);
  await captureCommand(runner, plan, plan.releaseCommand, ['--version'], {
    ...context.diagnostics(plan),
    label: 'release command --version probe',
    failureMessage: `${guidance} --version probe failed`,
    timeoutMs,
    includeStdout: true,
  });
}

export async function resolveReleaseBranchRefsWithContext(
  input: RunReleaseBranchInput,
  context: CredentialContext,
): Promise<Pick<ReleaseBranchResult, 'baseBranch' | 'releaseBranch'>> {
  if (!isPlainObject(input)) {
    throw new Error('input must be an object');
  }
  if (!isPlainObject(input.plan)) {
    throw new Error('plan must be an object');
  }
  const plan = input.plan;
  assertPlanIdentity(plan, process.env);
  assertDetermined(input.determined, plan);
  const determined = input.determined;
  const releaseBranch = resolveReleaseBranchName(plan, determined);
  const direct = resolveBaseBranchInput(plan, process.env);
  if (direct !== undefined) {
    assertDistinctBranches(direct, releaseBranch);
    return { baseBranch: direct, releaseBranch };
  }
  if (plan.dryRun || !plan.only.includes('release')) {
    throw new Error(
      `baseBranch could not be resolved in ${plan.dryRun ? 'dry-run' : 'an unselected release stage'} without git: provide explicit baseBranch or GITHUB_REF_NAME`,
    );
  }

  const runner = resolveProcessRunner(plan, input.runner);
  const baseBranch = await resolveBaseBranch(plan, runner, context);
  assertDistinctBranches(baseBranch, releaseBranch);
  return { baseBranch, releaseBranch };
}

export async function runReleaseBranchWithContext(
  input: RunReleaseBranchInput,
  context: CredentialContext,
): Promise<ReleaseBranchResult> {
  const { baseBranch, releaseBranch } = await resolveReleaseBranchRefsWithContext(input, context);
  const plan = input.plan;
  const determined = input.determined;
  const prTitle = `chore(release): release candidate ${determined.tagVersion}`;
  if (plan.dryRun || !plan.only.includes('release')) {
    return {
      baseBranch,
      releaseBranch,
      releaseRan: false,
      skippedReason: plan.dryRun ? 'dry-run' : 'stage not selected',
      tagMessage: '',
      prTitle,
    };
  }

  await context.prepare(plan);
  const runner = resolveProcessRunner(plan, input.runner);
  const diagnostics = context.diagnostics(plan);

  if (!plan.skipRelease) {
    await assertReleaseCommandAvailable(plan, runner, context);
  }
  const preparation = await inspectReleasePreparation(
    runner,
    plan,
    baseBranch,
    releaseBranch,
    determined.tagVersion,
    diagnostics,
  );

  await captureGit(
    runner,
    plan,
    ['config', 'user.name', plan.gitUserName],
    'git config user.name',
    undefined,
    diagnostics,
  );
  await captureGit(
    runner,
    plan,
    ['config', 'user.email', plan.gitUserEmail],
    'git config user.email',
    undefined,
    diagnostics,
  );
  if (plan.signCommit) {
    await captureGit(
      runner,
      plan,
      ['config', 'commit.gpgsign', 'true'],
      'git config commit.gpgsign',
      undefined,
      diagnostics,
    );
  }

  await captureGit(
    runner,
    plan,
    ['checkout', plan.resetReleaseBranch === true ? '-B' : '-b', releaseBranch, preparation.sourceCommit],
    undefined,
    undefined,
    diagnostics,
  );
  await pushReleaseBranch(
    runner,
    plan,
    releaseBranch,
    `refs/heads/${releaseBranch}`,
    preparation.remoteReleaseCommit,
    true,
    diagnostics,
  );

  let releasedHead: string | undefined;
  if (!plan.skipRelease) {
    const releaseArgs: string[] = [determined.version, '--ci', ...plan.releaseArgs];
    if (plan.signCommit) {
      releaseArgs.push('--git.commitArgs=--gpg-sign');
    }
    await captureCommand(runner, plan, plan.releaseCommand, releaseArgs, {
      ...diagnostics,
      label: `release command ${JSON.stringify(plan.releaseCommand)}`,
      includeStdout: true,
    });
    releasedHead = await verifyReleasedHead(runner, plan, releaseBranch, determined.tagVersion, diagnostics);
  }

  const tagResult = await captureGit(
    runner,
    plan,
    ['tag', '-l', '--format=%(contents)', determined.tagVersion],
    undefined,
    undefined,
    diagnostics,
  );
  if (releasedHead !== undefined) {
    await pushReleaseBranch(runner, plan, releaseBranch, releasedHead, preparation.sourceCommit, false, diagnostics);
  }

  return {
    baseBranch,
    releaseBranch,
    releaseRan: releasedHead !== undefined,
    ...(releasedHead === undefined ? {} : { releasedHead }),
    skippedReason: plan.skipRelease ? 'skipped via skipRelease' : null,
    tagMessage: stripTrailingNewlines(stripTagSignature(tagResult.stdout)),
    prTitle,
  };
}

export async function resolveReleaseBranchRefs(
  input: RunReleaseBranchInput,
): Promise<Pick<ReleaseBranchResult, 'baseBranch' | 'releaseBranch'>> {
  const context = stageCredentialContext(input);
  try {
    return safeMetadata(await resolveReleaseBranchRefsWithContext(input, context), context.secrets());
  } catch (error) {
    throw safeError(error, context.secrets());
  }
}

export async function runReleaseBranch(input: RunReleaseBranchInput): Promise<ReleaseBranchResult> {
  const context = stageCredentialContext(input);
  try {
    return safeMetadata(await runReleaseBranchWithContext(input, context), context.secrets());
  } catch (error) {
    throw safeError(error, context.secrets());
  }
}
