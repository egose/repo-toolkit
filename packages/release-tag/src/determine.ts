import {
  bumpVersion,
  defaultProcessRunner,
  isCapturingProcessRunner,
  isPlainObject,
  type CapturingProcessRunner,
  type ProcessCaptureResult,
  type VersionBump,
} from '@repo-toolkit/publish-package';

import type { ReleaseTagPlan } from './plan';

export interface DeterminedTag {
  version: string;
  tagVersion: string;
  bump: VersionBump | null;
  lastTag: string | null;
  manual: boolean;
}

export interface DetermineNextTagInput {
  plan: ReleaseTagPlan;
  runner?: CapturingProcessRunner;
}

const MANUAL_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const LAST_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAJOR_BUMP_PATTERN = /(BREAKING CHANGE:|^feat\([^)]*\)!:|^fix\([^)]*\)!:|!:)/m;
const MINOR_BUMP_PATTERN = /^feat(\(.+\))?:/m;
const STDERR_TAIL_MAX_CHARS = 2048;
const NO_PREVIOUS_TAG_MESSAGE =
  'No previous tag found and no tag input provided. Provide --tag once to seed release history.';

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

function outputBytes(result: ProcessCaptureResult): number {
  return Buffer.byteLength(result.stdout, 'utf8') + Buffer.byteLength(result.stderr, 'utf8');
}

function assertOutputWithinLimit(result: ProcessCaptureResult, maxOutputBytes: number, label: string): void {
  const bytes = outputBytes(result);
  if (bytes > maxOutputBytes) {
    const tail = result.stderr.trim();
    const suffix = tail.length > 0 ? ` (stderr: ${truncateTail(tail)})` : '';
    throw new Error(
      `${label} produced ${bytes} bytes of output, exceeding the ${maxOutputBytes}-byte output limit${suffix}`,
    );
  }
}

function resolveManualTag(rawTag: string): DeterminedTag {
  const version = rawTag.startsWith('v') ? rawTag.slice(1) : rawTag;
  if (!MANUAL_VERSION_PATTERN.test(version)) {
    throw new Error(
      `Provided tag '${rawTag}' does not follow semantic versioning: expected X.Y.Z with an optional single leading v`,
    );
  }
  return { version, tagVersion: `v${version}`, bump: null, lastTag: null, manual: true };
}

function selectBump(commitMessages: string): VersionBump {
  if (MAJOR_BUMP_PATTERN.test(commitMessages)) {
    return 'major';
  }
  if (MINOR_BUMP_PATTERN.test(commitMessages)) {
    return 'minor';
  }
  return 'patch';
}

export async function determineNextTag(input: DetermineNextTagInput): Promise<DeterminedTag> {
  if (!isPlainObject(input)) {
    throw new Error('input must be an object');
  }
  const plan = input.plan;
  if (!isPlainObject(plan)) {
    throw new Error('plan must be an object');
  }
  const runner = input.runner ?? plan.runner ?? defaultProcessRunner;
  if (!isCapturingProcessRunner(runner)) {
    throw new Error('runner must be a CapturingProcessRunner with a capture function');
  }

  if (plan.tag !== undefined) {
    return resolveManualTag(plan.tag);
  }

  const describeResult = await runner.capture(plan.gitExecutable, ['describe', '--tags', '--abbrev=0'], {
    cwd: plan.cwd,
    timeoutMs: plan.timeoutMs,
  });
  if (describeResult.error || describeResult.code !== 0 || describeResult.stdout.trim().length === 0) {
    throw new Error(`${NO_PREVIOUS_TAG_MESSAGE}${failureDetails(describeResult)}`);
  }
  assertOutputWithinLimit(describeResult, plan.maxOutputBytes, 'git describe --tags --abbrev=0');
  const lastTag = describeResult.stdout.trim().split('\n')[0].trim();
  if (!LAST_TAG_PATTERN.test(lastTag)) {
    throw new Error(`Last tag '${lastTag}' does not follow 'vX.Y.Z' format.`);
  }

  const range = `${lastTag}..HEAD`;
  const logResult = await runner.capture(plan.gitExecutable, ['log', range, '--pretty=format:%B'], {
    cwd: plan.cwd,
    timeoutMs: plan.timeoutMs,
  });
  if (logResult.error || logResult.code !== 0) {
    throw new Error(`git log ${range} failed${failureDetails(logResult)}`);
  }
  assertOutputWithinLimit(logResult, plan.maxOutputBytes, `git log ${range}`);
  const bump = selectBump(logResult.stdout);
  const version = bumpVersion(lastTag.slice(1), bump);
  return { version, tagVersion: `v${version}`, bump, lastTag, manual: false };
}
