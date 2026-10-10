import { isCapturingProcessRunner, isPlainObject, type CapturingProcessRunner } from '@repo-toolkit/publish-package';

export type ReleaseTagStage = 'determine' | 'release' | 'pr';

export type ReleaseTagTokenSource = 'explicit' | 'file' | 'env' | 'none';

const RELEASE_TAG_STAGES: ReadonlyArray<ReleaseTagStage> = ['determine', 'release', 'pr'];

const DEFAULT_GIT_EXECUTABLE = 'git';
const DEFAULT_GIT_USER_NAME = 'github-actions[bot]';
const DEFAULT_GIT_USER_EMAIL = 'github-actions[bot]@users.noreply.github.com';
const DEFAULT_RELEASE_COMMAND = './node_modules/.bin/release-it';
const DEFAULT_GITHUB_TOKEN_ENV = 'GITHUB_TOKEN';
const DEFAULT_GITHUB_API_URL = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_OUTPUT_BYTES = 1048576;

const VERSION_CORE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const WHITESPACE_PATTERN = /\s/;

export interface ReleaseTagOptions {
  cwd?: string;
  tag?: string;
  baseBranch?: string;
  releaseBranch?: string;
  gitExecutable?: string;
  gitUserName?: string;
  gitUserEmail?: string;
  signCommit?: boolean;
  releaseCommand?: string;
  releaseArgs?: ReadonlyArray<string>;
  skipRelease?: boolean;
  githubToken?: string;
  githubTokenFile?: string;
  githubTokenEnv?: string;
  githubRepository?: string;
  githubApiUrl?: string;
  autoMergePr?: boolean;
  deleteMergedBranch?: boolean;
  skipPr?: boolean;
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
  baseBranch?: string;
  releaseBranch?: string;
  gitExecutable: string;
  gitUserName: string;
  gitUserEmail: string;
  signCommit: boolean;
  releaseCommand: string;
  releaseArgs: ReadonlyArray<string>;
  skipRelease: boolean;
  githubTokenEnv: string;
  githubTokenFile?: string;
  githubRepository?: string;
  githubApiUrl: string;
  autoMergePr: boolean;
  deleteMergedBranch: boolean;
  skipPr: boolean;
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

function optionalSecret(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  assertNoNul(value, label);
  return value.length === 0 ? undefined : value;
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
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error('tag must be a string');
  }
  assertNoNul(value, 'tag');
  if (value.length === 0) {
    throw new Error('tag must be a X.Y.Z version with an optional single leading v');
  }
  const stripped = value.startsWith('v') ? value.slice(1) : value;
  if (!VERSION_CORE_PATTERN.test(stripped)) {
    throw new Error(`tag must be a X.Y.Z version with an optional single leading v: ${value}`);
  }
  return stripped;
}

function resolveReleaseBranch(value: unknown, tag: string | undefined): string | undefined {
  if (value === undefined) {
    return tag === undefined ? undefined : `changelog/${tag}`;
  }
  if (typeof value !== 'string') {
    throw new Error('releaseBranch must be a string');
  }
  assertNoNul(value, 'releaseBranch');
  if (value.length === 0) {
    throw new Error('releaseBranch must be a non-empty string');
  }
  if (WHITESPACE_PATTERN.test(value)) {
    throw new Error('releaseBranch must not contain whitespace');
  }
  if (value === 'HEAD') {
    throw new Error('releaseBranch must not be HEAD');
  }
  return value;
}

function resolveGithubRepository(value: unknown): string | undefined {
  const resolved = optionalString(value, 'githubRepository');
  if (resolved === undefined) {
    return undefined;
  }
  if (WHITESPACE_PATTERN.test(resolved)) {
    throw new Error('githubRepository must use owner/repo form with no empty segments or whitespace');
  }
  const parts = resolved.split('/');
  if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
    throw new Error('githubRepository must use owner/repo form with no empty segments or whitespace');
  }
  return resolved;
}

function resolveGithubApiUrl(value: unknown): string {
  const resolved = stringOrDefault(value, 'githubApiUrl', DEFAULT_GITHUB_API_URL);
  let url: URL;
  try {
    url = new URL(resolved);
  } catch {
    throw new Error('githubApiUrl is not a valid URL');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('githubApiUrl must not contain credentials');
  }
  if (url.hash !== '') {
    throw new Error('githubApiUrl must not contain a fragment');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('githubApiUrl must use http or https');
  }
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

export function resolveReleaseTagPlan(options: ReleaseTagOptions = {}): ReleaseTagPlan {
  if (!isPlainObject(options)) {
    throw new Error('options must be an object');
  }

  const tag = resolveTag(options.tag);
  const githubTokenEnv = stringOrDefault(options.githubTokenEnv, 'githubTokenEnv', DEFAULT_GITHUB_TOKEN_ENV);
  const githubToken = optionalSecret(options.githubToken, 'githubToken');
  const githubTokenFile = optionalSecret(options.githubTokenFile, 'githubTokenFile');

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
    gitExecutable: stringOrDefault(options.gitExecutable, 'gitExecutable', DEFAULT_GIT_EXECUTABLE),
    gitUserName: stringOrDefault(options.gitUserName, 'gitUserName', DEFAULT_GIT_USER_NAME),
    gitUserEmail: stringOrDefault(options.gitUserEmail, 'gitUserEmail', DEFAULT_GIT_USER_EMAIL),
    signCommit: booleanOrDefault(options.signCommit, 'signCommit', false),
    releaseCommand: stringOrDefault(options.releaseCommand, 'releaseCommand', DEFAULT_RELEASE_COMMAND),
    releaseArgs: resolveReleaseArgs(options.releaseArgs),
    skipRelease: booleanOrDefault(options.skipRelease, 'skipRelease', false),
    githubTokenEnv,
    githubApiUrl: resolveGithubApiUrl(options.githubApiUrl),
    autoMergePr: booleanOrDefault(options.autoMergePr, 'autoMergePr', false),
    deleteMergedBranch: booleanOrDefault(options.deleteMergedBranch, 'deleteMergedBranch', false),
    skipPr: booleanOrDefault(options.skipPr, 'skipPr', false),
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
    plan.runner = runner;
  }
  const fetchFn = resolveFetchFn(options.fetchFn);
  if (fetchFn !== undefined) {
    plan.fetchFn = fetchFn;
  }

  return plan;
}
