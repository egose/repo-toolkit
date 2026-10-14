import { inspect } from 'node:util';

import { isCapturingProcessRunner, isPlainObject, type CapturingProcessRunner } from '@repo-toolkit/publish-package';

import { resolveExplicitToken } from './credentials';
import { knownCredentialSecrets, readProperty, redactText, safeError, safeMetadata } from './diagnostics';
import { resolveGitHubApiUrl } from './github-url';
import { assertProcessLimits } from './process';
import {
  assertBranchName,
  assertPlanIdentity,
  normalizeStableTag,
  parseOwnerRepo,
  resolveMergeMethod,
} from './validation';

export type ReleaseTagStage = 'determine' | 'release' | 'pr';

export type ReleaseTagTokenSource = 'explicit' | 'file' | 'env' | 'none';

export type ReleaseTagMergeMethod = 'merge' | 'squash' | 'rebase';

const RELEASE_TAG_STAGES: ReadonlyArray<ReleaseTagStage> = ['determine', 'release', 'pr'];

const DEFAULT_GIT_EXECUTABLE = 'git';
const DEFAULT_GIT_USER_NAME = 'github-actions[bot]';
const DEFAULT_GIT_USER_EMAIL = 'github-actions[bot]@users.noreply.github.com';
const DEFAULT_RELEASE_COMMAND = './node_modules/.bin/release-it';
const DEFAULT_GITHUB_TOKEN_ENV = 'GITHUB_TOKEN';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_OUTPUT_BYTES = 1048576;

export interface ReleaseTagOptions {
  cwd?: string;
  tag?: string;
  allowEmptyRelease?: boolean;
  baseBranch?: string;
  releaseBranch?: string;
  gitExecutable?: string;
  gitUserName?: string;
  gitUserEmail?: string;
  signCommit?: boolean;
  releaseCommand?: string;
  releaseArgs?: ReadonlyArray<string>;
  skipRelease?: boolean;
  resetReleaseBranch?: boolean;
  githubToken?: string;
  githubTokenFile?: string;
  githubTokenEnv?: string;
  githubRepository?: string;
  githubApiUrl?: string;
  autoMergePr?: boolean;
  mergeMethod?: ReleaseTagMergeMethod;
  deleteMergedBranch?: boolean;
  skipPr?: boolean;
  skipPreflight?: boolean;
  dryRun?: boolean;
  only?: ReadonlyArray<string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
  runner?: CapturingProcessRunner;
  fetchFn?: typeof fetch;
}

export interface ReleaseTagPlan {
  cwd: string;
  tag?: string;
  allowEmptyRelease: boolean;
  baseBranch?: string;
  releaseBranch?: string;
  gitExecutable: string;
  gitUserName: string;
  gitUserEmail: string;
  signCommit: boolean;
  releaseCommand: string;
  releaseArgs: ReadonlyArray<string>;
  skipRelease: boolean;
  resetReleaseBranch: boolean;
  githubTokenEnv: string;
  githubTokenFile?: string;
  githubRepository?: string;
  githubApiUrl: string;
  autoMergePr: boolean;
  mergeMethod: ReleaseTagMergeMethod;
  deleteMergedBranch: boolean;
  skipPr: boolean;
  skipPreflight: boolean;
  tokenSource: ReleaseTagTokenSource;
  tokenAvailable: boolean;
  dryRun: boolean;
  only: ReadonlyArray<ReleaseTagStage>;
  timeoutMs: number;
  maxOutputBytes: number;
  runner?: CapturingProcessRunner;
  fetchFn?: typeof fetch;
}

function assertNoNul(value: string, label: string): void {
  if (value.includes('\0')) {
    throw new Error(`${label} must not contain NUL bytes`);
  }
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  assertNoNul(value, label);
  if (value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function stringOrDefault(value: unknown, label: string, fallback: string): string {
  const resolved = optionalString(value, label);
  return resolved === undefined ? fallback : resolved;
}

function booleanOrDefault(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
}

function positiveIntOrDefault(value: unknown, label: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function resolveTag(value: unknown): string | undefined {
  return value === undefined ? undefined : normalizeStableTag(value);
}

function resolveReleaseBranch(value: unknown, tag: string | undefined): string | undefined {
  const branch = value === undefined && tag !== undefined ? `changelog/${tag}` : value;
  if (branch !== undefined) {
    assertBranchName(branch, 'releaseBranch');
  }
  return branch;
}

function resolveGithubRepository(value: unknown): string | undefined {
  const resolved = optionalString(value, 'githubRepository');
  if (resolved === undefined) {
    return undefined;
  }
  parseOwnerRepo(resolved, 'githubRepository');
  return resolved;
}

function resolveReleaseArgs(value: unknown): ReadonlyArray<string> {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error('releaseArgs must be an array of strings');
  }
  return value.map((entry, index) => {
    const label = `releaseArgs[${index}]`;
    if (typeof entry !== 'string') {
      throw new Error(`${label} must be a string`);
    }
    assertNoNul(entry, label);
    if (entry.length === 0) {
      throw new Error(`${label} must be a non-empty string`);
    }
    return entry;
  });
}

function isReleaseTagStage(value: string): value is ReleaseTagStage {
  return (RELEASE_TAG_STAGES as ReadonlyArray<string>).includes(value);
}

function resolveOnly(value: unknown): ReadonlyArray<ReleaseTagStage> {
  if (value === undefined) {
    return [...RELEASE_TAG_STAGES];
  }
  if (!Array.isArray(value)) {
    throw new Error('only must be an array of stage names');
  }
  const stages: ReleaseTagStage[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !isReleaseTagStage(entry)) {
      throw new Error(`only contains unknown stage ${JSON.stringify(entry)}: expected one of determine, release, pr`);
    }
    if (!stages.includes(entry)) {
      stages.push(entry);
    }
  }
  return stages;
}

function resolveRunner(value: unknown): CapturingProcessRunner | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isPlainObject(value)) {
    throw new Error('runner must be a CapturingProcessRunner with run, runShell, and capture functions');
  }
  const candidate = value as unknown as CapturingProcessRunner;
  if (
    typeof candidate.run !== 'function' ||
    typeof candidate.runShell !== 'function' ||
    !isCapturingProcessRunner(candidate)
  ) {
    throw new Error('runner must be a CapturingProcessRunner with run, runShell, and capture functions');
  }
  return candidate;
}

function resolveFetchFn(value: unknown): typeof fetch | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'function') {
    throw new Error('fetchFn must be a function');
  }
  return value as typeof fetch;
}

function buildPlan(options: ReleaseTagOptions): ReleaseTagPlan {
  if (!isPlainObject(options)) {
    throw new Error('options must be an object');
  }

  const tag = resolveTag(options.tag);
  const githubTokenEnv = stringOrDefault(options.githubTokenEnv, 'githubTokenEnv', DEFAULT_GITHUB_TOKEN_ENV);
  const githubToken = resolveExplicitToken(options.githubToken);
  const githubTokenFile = optionalString(options.githubTokenFile, 'githubTokenFile');

  let tokenSource: ReleaseTagTokenSource = 'none';
  if (githubToken !== undefined) {
    tokenSource = 'explicit';
  } else if (githubTokenFile !== undefined) {
    tokenSource = 'file';
  } else if ((process.env[githubTokenEnv] ?? '').length > 0) {
    tokenSource = 'env';
  }

  const plan: ReleaseTagPlan = {
    cwd: stringOrDefault(options.cwd, 'cwd', process.cwd()),
    allowEmptyRelease: booleanOrDefault(options.allowEmptyRelease, 'allowEmptyRelease', false),
    gitExecutable: stringOrDefault(options.gitExecutable, 'gitExecutable', DEFAULT_GIT_EXECUTABLE),
    gitUserName: stringOrDefault(options.gitUserName, 'gitUserName', DEFAULT_GIT_USER_NAME),
    gitUserEmail: stringOrDefault(options.gitUserEmail, 'gitUserEmail', DEFAULT_GIT_USER_EMAIL),
    signCommit: booleanOrDefault(options.signCommit, 'signCommit', false),
    releaseCommand: stringOrDefault(options.releaseCommand, 'releaseCommand', DEFAULT_RELEASE_COMMAND),
    releaseArgs: resolveReleaseArgs(options.releaseArgs),
    skipRelease: booleanOrDefault(options.skipRelease, 'skipRelease', false),
    resetReleaseBranch: booleanOrDefault(options.resetReleaseBranch, 'resetReleaseBranch', false),
    githubTokenEnv,
    githubApiUrl: resolveGitHubApiUrl(options.githubApiUrl),
    autoMergePr: booleanOrDefault(options.autoMergePr, 'autoMergePr', false),
    mergeMethod: resolveMergeMethod(options.mergeMethod),
    deleteMergedBranch: booleanOrDefault(options.deleteMergedBranch, 'deleteMergedBranch', false),
    skipPr: booleanOrDefault(options.skipPr, 'skipPr', false),
    skipPreflight: booleanOrDefault(options.skipPreflight, 'skipPreflight', false),
    tokenSource,
    tokenAvailable: tokenSource !== 'none',
    dryRun: booleanOrDefault(options.dryRun, 'dryRun', false),
    only: resolveOnly(options.only),
    timeoutMs: positiveIntOrDefault(options.timeoutMs, 'timeoutMs', DEFAULT_TIMEOUT_MS),
    maxOutputBytes: positiveIntOrDefault(options.maxOutputBytes, 'maxOutputBytes', DEFAULT_MAX_OUTPUT_BYTES),
  };

  if (tag !== undefined) {
    plan.tag = tag;
  }
  const baseBranch = optionalString(options.baseBranch, 'baseBranch');
  if (baseBranch !== undefined) {
    plan.baseBranch = baseBranch;
  }
  const releaseBranch = resolveReleaseBranch(options.releaseBranch, tag);
  if (releaseBranch !== undefined) {
    plan.releaseBranch = releaseBranch;
  }
  if (githubTokenFile !== undefined) {
    plan.githubTokenFile = githubTokenFile;
  }
  const githubRepository = resolveGithubRepository(options.githubRepository);
  if (githubRepository !== undefined) {
    plan.githubRepository = githubRepository;
  }
  const runner = resolveRunner(options.runner);
  if (runner !== undefined) {
    Object.defineProperty(plan, 'runner', { value: runner, configurable: true, writable: true });
  }
  const fetchFn = resolveFetchFn(options.fetchFn);
  if (fetchFn !== undefined) {
    Object.defineProperty(plan, 'fetchFn', { value: fetchFn, configurable: true, writable: true });
  }

  assertProcessLimits(plan);
  assertPlanIdentity(plan);
  return plan;
}

export function snapshotReleaseTagPlan(
  plan: ReleaseTagPlan,
  secrets: ReadonlyArray<string | undefined>,
): ReleaseTagPlan {
  return safeMetadata(
    {
      cwd: plan.cwd,
      ...(plan.tag === undefined ? {} : { tag: plan.tag }),
      allowEmptyRelease: plan.allowEmptyRelease,
      ...(plan.baseBranch === undefined ? {} : { baseBranch: plan.baseBranch }),
      ...(plan.releaseBranch === undefined ? {} : { releaseBranch: plan.releaseBranch }),
      gitExecutable: plan.gitExecutable,
      gitUserName: plan.gitUserName,
      gitUserEmail: plan.gitUserEmail,
      signCommit: plan.signCommit,
      releaseCommand: plan.releaseCommand,
      releaseArgs: plan.releaseArgs.map((arg) => redactText(arg, secrets)),
      skipRelease: plan.skipRelease,
      resetReleaseBranch: plan.resetReleaseBranch,
      githubTokenEnv: plan.githubTokenEnv,
      ...(plan.githubTokenFile === undefined ? {} : { githubTokenFile: plan.githubTokenFile }),
      ...(plan.githubRepository === undefined ? {} : { githubRepository: plan.githubRepository }),
      githubApiUrl: plan.githubApiUrl,
      autoMergePr: plan.autoMergePr,
      mergeMethod: plan.mergeMethod,
      deleteMergedBranch: plan.deleteMergedBranch,
      skipPr: plan.skipPr,
      skipPreflight: plan.skipPreflight,
      tokenSource: plan.tokenSource,
      tokenAvailable: plan.tokenAvailable,
      dryRun: plan.dryRun,
      only: [...plan.only],
      timeoutMs: plan.timeoutMs,
      maxOutputBytes: plan.maxOutputBytes,
    },
    secrets,
  );
}

export function cloneStagePlan(
  plan: ReleaseTagPlan,
  refs: { baseBranch: string; releaseBranch: string },
  secrets: ReadonlyArray<string | undefined>,
): ReleaseTagPlan {
  const clone = { ...plan, ...refs };
  for (const key of ['runner', 'fetchFn'] as const) {
    if (plan[key] !== undefined) {
      Object.defineProperty(clone, key, { value: plan[key], configurable: true, writable: true });
    }
  }
  return attachPlanSnapshot(clone, snapshotReleaseTagPlan(clone, secrets));
}

function attachPlanSnapshot(plan: ReleaseTagPlan, snapshot: ReleaseTagPlan): ReleaseTagPlan {
  Object.freeze(snapshot.releaseArgs);
  Object.freeze(snapshot.only);
  Object.freeze(snapshot);
  Object.defineProperties(plan, {
    toJSON: { value: () => snapshot },
    [inspect.custom]: { value: () => snapshot },
  });
  return plan;
}

export function resolveReleaseTagPlan(options: ReleaseTagOptions = {}): ReleaseTagPlan {
  const secrets = knownCredentialSecrets(readProperty(options, 'githubToken'), readProperty(options, 'githubTokenEnv'));
  try {
    const plan = buildPlan(options);
    return attachPlanSnapshot(plan, snapshotReleaseTagPlan(plan, secrets));
  } catch (error) {
    throw safeError(error, secrets);
  }
}
