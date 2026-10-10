import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import {
  defaultProcessRunner,
  isCapturingProcessRunner,
  isPlainObject,
  redactSensitiveValues,
  type CapturingProcessRunner,
  type ProcessCaptureResult,
} from '@repo-toolkit/publish-package';

import type { DeterminedTag } from './determine';
import type { ReleaseTagPlan } from './plan';

export interface ReleaseBranchResult {
  baseBranch: string;
  releaseBranch: string;
  releaseRan: boolean;
  skippedReason: string | null;
  tagMessage: string;
  prTitle: string;
}

export interface RunReleaseBranchInput {
  plan: ReleaseTagPlan;
  determined: DeterminedTag;
  runner?: CapturingProcessRunner;
}

const BRANCH_GUARD_MESSAGE = 'This workflow must be run on a branch, not a tag.';
const TAG_SHAPE_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const WHITESPACE_PATTERN = /\s/;
const STDERR_TAIL_MAX_CHARS = 2048;
const VERSION_PROBE_TIMEOUT_MS = 10000;

function truncateTail(text: string): string {
  if (text.length <= STDERR_TAIL_MAX_CHARS) {
    return text;
  }
  return `...[truncated] ${text.slice(text.length - STDERR_TAIL_MAX_CHARS)}`;
}

function failureDetails(result: ProcessCaptureResult): string {
  const parts: string[] = [];
  if (result.error) {
    parts.push(`error: ${result.error.message}`);
  }
  const tail = result.stderr.trim();
  if (tail.length > 0) {
    parts.push(`stderr: ${truncateTail(tail)}`);
  }
  return parts.length === 0 ? '' : ` (${parts.join('; ')})`;
}

function firstLine(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return '';
  }
  const lines = trimmed.split('\n');
  return lines[0].trim();
}

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

function resolveReleaseBranchName(plan: ReleaseTagPlan, determined: DeterminedTag): string {
  const branch = plan.releaseBranch === undefined ? `changelog/${determined.version}` : plan.releaseBranch;
  if (branch.includes('\0')) {
    throw new Error('releaseBranch must not contain NUL bytes');
  }
  if (branch.length === 0) {
    throw new Error('releaseBranch must be a non-empty string');
  }
  if (WHITESPACE_PATTERN.test(branch)) {
    throw new Error('releaseBranch must not contain whitespace');
  }
  if (branch === 'HEAD') {
    throw new Error('releaseBranch must not be HEAD');
  }
  return branch;
}

function assertBranchGuard(value: string): void {
  if (value.length === 0 || value === 'HEAD' || value.startsWith('refs/tags/') || TAG_SHAPE_PATTERN.test(value)) {
    throw new Error(BRANCH_GUARD_MESSAGE);
  }
}

function explicitOrEnvBaseBranch(plan: ReleaseTagPlan): string | undefined {
  if (plan.baseBranch !== undefined) {
    return plan.baseBranch;
  }
  const refName = process.env.GITHUB_REF_NAME;
  if (refName !== undefined && refName.trim().length > 0) {
    return refName.trim();
  }
  return undefined;
}

async function resolveBaseBranch(plan: ReleaseTagPlan, runner: CapturingProcessRunner): Promise<string> {
  const direct = explicitOrEnvBaseBranch(plan);
  if (direct !== undefined) {
    assertBranchGuard(direct);
    return direct;
  }
  const result = await runner.capture(plan.gitExecutable, ['symbolic-ref', '--short', 'HEAD'], {
    cwd: plan.cwd,
    timeoutMs: plan.timeoutMs,
  });
  if (result.error || result.code !== 0) {
    throw new Error(redactSensitiveValues(`${BRANCH_GUARD_MESSAGE}${failureDetails(result)}`, []));
  }
  const branch = firstLine(result.stdout);
  assertBranchGuard(branch);
  return branch;
}

function throwGitFailure(label: string, result: ProcessCaptureResult): never {
  throw new Error(redactSensitiveValues(`${label} failed${failureDetails(result)}`, []));
}

async function captureOrThrow(
  runner: CapturingProcessRunner,
  plan: ReleaseTagPlan,
  args: ReadonlyArray<string>,
  label: string,
): Promise<ProcessCaptureResult> {
  const result = await runner.capture(plan.gitExecutable, args, {
    cwd: plan.cwd,
    timeoutMs: plan.timeoutMs,
  });
  if (result.error || result.code !== 0) {
    throwGitFailure(label, result);
  }
  return result;
}

async function isPathReleaseCommandAvailable(plan: ReleaseTagPlan): Promise<boolean> {
  const resolved = resolvePath(plan.cwd, plan.releaseCommand);
  try {
    await access(resolved, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function isBareReleaseCommandAvailable(plan: ReleaseTagPlan, runner: CapturingProcessRunner): Promise<boolean> {
  const timeoutMs = Math.min(plan.timeoutMs, VERSION_PROBE_TIMEOUT_MS);
  const result = await runner.capture(plan.releaseCommand, ['--version'], {
    cwd: plan.cwd,
    timeoutMs,
  });
  return !result.error && result.code === 0;
}

function assertDetermined(value: unknown): asserts value is DeterminedTag {
  if (!isPlainObject(value)) {
    throw new Error('determined must be an object');
  }
  const candidate = value as Partial<DeterminedTag>;
  if (typeof candidate.version !== 'string' || candidate.version.length === 0) {
    throw new Error('determined.version must be a non-empty string');
  }
  if (typeof candidate.tagVersion !== 'string' || candidate.tagVersion.length === 0) {
    throw new Error('determined.tagVersion must be a non-empty string');
  }
}

export async function runReleaseBranch(input: RunReleaseBranchInput): Promise<ReleaseBranchResult> {
  if (!isPlainObject(input)) {
    throw new Error('input must be an object');
  }
  if (!isPlainObject(input.plan)) {
    throw new Error('plan must be an object');
  }
  assertDetermined(input.determined);
  const plan = input.plan;
  const determined = input.determined;
  const releaseBranch = resolveReleaseBranchName(plan, determined);
  const prTitle = `chore(release): release candidate ${determined.tagVersion}`;

  if (plan.dryRun) {
    const baseBranch = explicitOrEnvBaseBranch(plan);
    if (baseBranch === undefined) {
      throw new Error(
        'baseBranch could not be resolved in dry-run without git: provide explicit baseBranch or GITHUB_REF_NAME',
      );
    }
    assertBranchGuard(baseBranch);
    return {
      baseBranch,
      releaseBranch,
      releaseRan: false,
      skippedReason: 'dry-run',
      tagMessage: '',
      prTitle,
    };
  }

  const runner = input.runner ?? plan.runner ?? defaultProcessRunner;
  if (!isCapturingProcessRunner(runner)) {
    throw new Error('runner must be a CapturingProcessRunner with a capture function');
  }

  const baseBranch = await resolveBaseBranch(plan, runner);

  await captureOrThrow(runner, plan, ['config', 'user.name', plan.gitUserName], 'git config user.name');
  await captureOrThrow(runner, plan, ['config', 'user.email', plan.gitUserEmail], 'git config user.email');
  if (plan.signCommit) {
    await captureOrThrow(runner, plan, ['config', 'commit.gpgsign', 'true'], 'git config commit.gpgsign');
  }

  await runner.capture(plan.gitExecutable, ['push', 'origin', '--delete', releaseBranch], {
    cwd: plan.cwd,
    timeoutMs: plan.timeoutMs,
  });
  await runner.capture(plan.gitExecutable, ['branch', '-D', releaseBranch], {
    cwd: plan.cwd,
    timeoutMs: plan.timeoutMs,
  });
  await captureOrThrow(runner, plan, ['checkout', '-b', releaseBranch], `git checkout -b ${releaseBranch}`);
  await captureOrThrow(
    runner,
    plan,
    ['push', '--set-upstream', 'origin', releaseBranch],
    `git push --set-upstream origin ${releaseBranch}`,
  );

  let releaseRan = false;
  let skippedReason: string | null = null;
  if (plan.skipRelease) {
    skippedReason = 'skipped via skipRelease';
  } else if (!plan.only.includes('release')) {
    skippedReason = 'stage not selected';
  } else {
    const available = plan.releaseCommand.includes('/')
      ? await isPathReleaseCommandAvailable(plan)
      : await isBareReleaseCommandAvailable(plan, runner);
    if (!available) {
      skippedReason = `release command not available: ${plan.releaseCommand}`;
    } else {
      const releaseArgs: string[] = [determined.version, '--ci', ...plan.releaseArgs];
      if (plan.signCommit) {
        releaseArgs.push('--git.commitArgs=--gpg-sign');
      }
      const startedAt = Date.now();
      try {
        await runner.run(plan.releaseCommand, releaseArgs, { cwd: plan.cwd });
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        const message = error instanceof Error ? error.message : String(error);
        const wrapped = new Error(
          redactSensitiveValues(
            `release command ${JSON.stringify(plan.releaseCommand)} failed after ${durationMs}ms: ${message}`,
            [],
          ),
        ) as Error & { cause?: unknown };
        wrapped.cause = error;
        throw wrapped;
      }
      releaseRan = true;
    }
  }

  await captureOrThrow(runner, plan, ['push', 'origin', releaseBranch], `git push origin ${releaseBranch}`);
  const tagResult = await runner.capture(
    plan.gitExecutable,
    ['tag', '-l', '--format=%(contents)', determined.tagVersion],
    { cwd: plan.cwd, timeoutMs: plan.timeoutMs },
  );
  if (tagResult.error || tagResult.code !== 0) {
    throwGitFailure(`git tag -l --format=%(contents) ${determined.tagVersion}`, tagResult);
  }

  return {
    baseBranch,
    releaseBranch,
    releaseRan,
    skippedReason,
    tagMessage: stripTrailingNewlines(tagResult.stdout),
    prTitle,
  };
}
