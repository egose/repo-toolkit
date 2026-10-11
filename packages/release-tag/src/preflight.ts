import {
  defaultProcessRunner,
  isCapturingProcessRunner,
  isPlainObject,
  redactSensitiveValues,
  type CapturingProcessRunner,
  type ProcessCaptureResult,
} from '@repo-toolkit/publish-package';

import {
  MAX_RESPONSE_BYTES_CAP,
  createGitHubHeaders,
  resolveExplicitToken,
  resolveFetchFn,
  resolveGitHubToken,
  resolveOwnerRepo,
  sendGitHubRequest,
  truncateChars,
} from './github';
import type { ReleaseTagPlan } from './plan';

export interface PreflightCheckResult {
  name: 'git' | 'token';
  skipped: boolean;
  skippedReason: string | null;
}

export interface PreflightResult {
  git: PreflightCheckResult;
  token: PreflightCheckResult;
}

export interface RunPreflightInput {
  plan: ReleaseTagPlan;
  githubToken?: string;
  runner?: CapturingProcessRunner;
  fetchFn?: typeof fetch;
}

const GUIDE_PREREQUISITES_URL = 'https://repo-toolkit.pages.dev/docs/packages/release-tag#prerequisites';
const GIT_REMOTE = 'origin';
const STDERR_TAIL_MAX_CHARS = 2048;

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

function skipped(name: 'git' | 'token', reason: string): PreflightCheckResult {
  return { name, skipped: true, skippedReason: reason };
}

function passed(name: 'git' | 'token'): PreflightCheckResult {
  return { name, skipped: false, skippedReason: null };
}

function gitGuidance(details: string): string {
  return [
    `preflight failed: git ls-remote ${GIT_REMOTE} HEAD did not succeed${details}.`,
    'Stage 2 pushes require non-interactive git authentication:',
    'load your SSH key into an agent (eval "$(ssh-agent -s)" && ssh-add ~/.ssh/<key>)',
    'configure core.sshCommand with your key and -o BatchMode=yes, or configure an HTTPS credential helper,',
    `then verify with GIT_TERMINAL_PROMPT=0 git ls-remote ${GIT_REMOTE} HEAD and retry.`,
    `See ${GUIDE_PREREQUISITES_URL}. Bypass with --skip-preflight.`,
  ].join(' ');
}

function tokenGuidance(repository: string, problem: string): string {
  return [
    `preflight failed: GitHub token check GET /repos/${repository} ${problem}.`,
    `The token needs Contents (read/write), Pull requests (read/write), and Issues (read/write) on ${repository};`,
    'GitHub reports insufficient permission as 404.',
    `See ${GUIDE_PREREQUISITES_URL}. Bypass with --skip-preflight.`,
  ].join(' ');
}

async function checkGitAuth(plan: ReleaseTagPlan, runner: CapturingProcessRunner): Promise<void> {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' };
  const sshCommand = process.env.GIT_SSH_COMMAND;
  const sshExecutable = process.env.GIT_SSH;
  if (
    (sshCommand === undefined || sshCommand.length === 0) &&
    (sshExecutable === undefined || sshExecutable.length === 0)
  ) {
    const configuredSsh = await runner.capture(plan.gitExecutable, ['config', '--get', 'core.sshCommand'], {
      cwd: plan.cwd,
      timeoutMs: plan.timeoutMs,
      env: { ...env },
    });
    if (!configuredSsh.error && configuredSsh.code === 1) {
      env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes';
    } else if (!configuredSsh.error && configuredSsh.code === 0 && sshCommand === '') {
      env.GIT_SSH_COMMAND = configuredSsh.stdout.trim();
    }
  }
  const result = await runner.capture(plan.gitExecutable, ['ls-remote', GIT_REMOTE, 'HEAD'], {
    cwd: plan.cwd,
    timeoutMs: plan.timeoutMs,
    env,
  });
  if (result.error || result.code !== 0) {
    throw new Error(redactSensitiveValues(gitGuidance(failureDetails(result)), []));
  }
}

function hasPushPermission(text: string, status: number, repository: string, token: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      redactSensitiveValues(
        `preflight failed: GitHub token check GET /repos/${repository} returned invalid JSON (status=${status}): ${truncateChars(text)}. Bypass with --skip-preflight.`,
        [token],
      ),
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      redactSensitiveValues(
        `preflight failed: GitHub token check GET /repos/${repository} returned an unexpected shape (status=${status}): ${truncateChars(text)}. Bypass with --skip-preflight.`,
        [token],
      ),
    );
  }
  const permissions = (parsed as Record<string, unknown>).permissions;
  return isPlainObject(permissions) && (permissions as Record<string, unknown>).push === true;
}

export async function runPreflight(input: RunPreflightInput): Promise<PreflightResult> {
  if (!isPlainObject(input)) {
    throw new Error('input must be an object');
  }
  if (!isPlainObject(input.plan)) {
    throw new Error('plan must be an object');
  }
  const plan = input.plan;
  const explicitToken = resolveExplicitToken(input.githubToken);

  if (plan.skipPreflight) {
    return { git: skipped('git', 'skipped via skipPreflight'), token: skipped('token', 'skipped via skipPreflight') };
  }
  if (plan.dryRun) {
    return { git: skipped('git', 'dry-run'), token: skipped('token', 'dry-run') };
  }

  let git: PreflightCheckResult;
  if (!plan.only.includes('release')) {
    git = skipped('git', 'stage not selected');
  } else {
    const runner = input.runner ?? plan.runner ?? defaultProcessRunner;
    if (!isCapturingProcessRunner(runner)) {
      throw new Error('runner must be a CapturingProcessRunner with a capture function');
    }
    await checkGitAuth(plan, runner);
    git = passed('git');
  }

  let token: PreflightCheckResult;
  if (!plan.only.includes('pr')) {
    token = skipped('token', 'stage not selected');
  } else if (plan.skipPr) {
    token = skipped('token', 'skipped via skipPr');
  } else {
    const resolved = await resolveGitHubToken(plan, explicitToken);
    if (resolved === undefined) {
      token = skipped('token', 'github token not available');
    } else {
      const fetchFn = resolveFetchFn(plan, input);
      const ownerRepo = resolveOwnerRepo(plan);
      const owner = encodeURIComponent(ownerRepo.owner);
      const repo = encodeURIComponent(ownerRepo.repo);
      const apiBase = plan.githubApiUrl.replace(/\/+$/, '');
      const responseLimit = Math.min(plan.maxOutputBytes, MAX_RESPONSE_BYTES_CAP);
      const repository = `${ownerRepo.owner}/${ownerRepo.repo}`;
      const result = await sendGitHubRequest(
        fetchFn,
        `${apiBase}/repos/${owner}/${repo}`,
        'GET',
        createGitHubHeaders(resolved),
        undefined,
        plan.timeoutMs,
        responseLimit,
        'GET repo',
        resolved,
      );
      if (result.status < 200 || result.status >= 300) {
        throw new Error(
          redactSensitiveValues(
            tokenGuidance(repository, `failed (status=${result.status}): ${truncateChars(result.text)}`),
            [resolved],
          ),
        );
      }
      if (!hasPushPermission(result.text, result.status, repository, resolved)) {
        const installation = await sendGitHubRequest(
          fetchFn,
          `${apiBase}/installation/repositories?per_page=1`,
          'HEAD',
          createGitHubHeaders(resolved),
          undefined,
          plan.timeoutMs,
          responseLimit,
          'HEAD /installation/repositories',
          resolved,
        );
        if (installation.status < 200 || installation.status >= 300) {
          throw new Error(
            redactSensitiveValues(
              tokenGuidance(
                repository,
                `lacks push permission and HEAD /installation/repositories could not confirm an installation token (status=${installation.status}): ${truncateChars(installation.text)}`,
              ),
              [resolved],
            ),
          );
        }
      }
      token = passed('token');
    }
  }

  return { git, token };
}
