import { isPlainObject, type CapturingProcessRunner } from '@repo-toolkit/publish-package';

import { stageCredentialContext, type CredentialContext } from './credentials';
import { diagnosticText, safeError } from './diagnostics';
import {
  MAX_ERROR_CHARS,
  MAX_RESPONSE_BYTES_CAP,
  createGitHubHeaders,
  resolveFetchFn,
  resolveOwnerRepo,
  sendGitHubRequest,
} from './github';
import { buildGitHubApiUrl } from './github-url';
import type { ReleaseTagPlan } from './plan';
import { captureCommand, resolveProcessRunner } from './process';
import { assertPlanIdentity } from './validation';

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

function skipped(name: 'git' | 'token', reason: string): PreflightCheckResult {
  return { name, skipped: true, skippedReason: reason };
}

function passed(name: 'git' | 'token'): PreflightCheckResult {
  return { name, skipped: false, skippedReason: null };
}

function gitGuidance(): string {
  return [
    `preflight failed: git ls-remote ${GIT_REMOTE} HEAD did not succeed.`,
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

async function checkGitAuth(
  plan: ReleaseTagPlan,
  runner: CapturingProcessRunner | undefined,
  context: CredentialContext,
): Promise<void> {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0' };
  const sshCommand = process.env.GIT_SSH_COMMAND;
  const sshExecutable = process.env.GIT_SSH;
  if (
    (sshCommand === undefined || sshCommand.length === 0) &&
    (sshExecutable === undefined || sshExecutable.length === 0)
  ) {
    const configuredSsh = await captureCommand(
      runner,
      plan,
      plan.gitExecutable,
      ['config', '--get', 'core.sshCommand'],
      {
        ...context.diagnostics(plan),
        label: 'git config --get core.sshCommand',
        failureMessage: `${gitGuidance()} SSH configuration probe failed`,
        acceptedExitCodes: [0, 1],
        env: { ...env },
      },
    );
    if (configuredSsh.code === 1) {
      env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes';
    } else if (configuredSsh.code === 0 && sshCommand === '') {
      env.GIT_SSH_COMMAND = configuredSsh.stdout.trim();
    }
  }
  await captureCommand(runner, plan, plan.gitExecutable, ['ls-remote', GIT_REMOTE, 'HEAD'], {
    ...context.diagnostics(plan),
    label: `git ls-remote ${GIT_REMOTE} HEAD`,
    failureMessage: gitGuidance(),
    env,
  });
}

function hasPushPermission(text: string, status: number, repository: string, secrets: ReadonlyArray<string>): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `preflight failed: GitHub token check GET /repos/${repository} returned invalid JSON (status=${status}): ${diagnosticText(text, secrets, MAX_ERROR_CHARS)}. Bypass with --skip-preflight.`,
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `preflight failed: GitHub token check GET /repos/${repository} returned an unexpected shape (status=${status}): ${diagnosticText(text, secrets, MAX_ERROR_CHARS)}. Bypass with --skip-preflight.`,
    );
  }
  const permissions = (parsed as Record<string, unknown>).permissions;
  return isPlainObject(permissions) && (permissions as Record<string, unknown>).push === true;
}

export async function runPreflightWithContext(
  input: RunPreflightInput,
  context: CredentialContext,
): Promise<PreflightResult> {
  if (!isPlainObject(input)) {
    throw new Error('input must be an object');
  }
  if (!isPlainObject(input.plan)) {
    throw new Error('plan must be an object');
  }
  const plan = input.plan;
  assertPlanIdentity(plan, process.env);

  if (plan.skipPreflight) {
    return { git: skipped('git', 'skipped via skipPreflight'), token: skipped('token', 'skipped via skipPreflight') };
  }
  if (plan.dryRun) {
    return { git: skipped('git', 'dry-run'), token: skipped('token', 'dry-run') };
  }

  const checkToken = plan.only.includes('pr') && !plan.skipPr;
  if (checkToken) {
    buildGitHubApiUrl(plan.githubApiUrl, ['repos']);
    await context.resolve(plan);
  }

  let git: PreflightCheckResult;
  if (!plan.only.includes('release')) {
    git = skipped('git', 'stage not selected');
  } else {
    const runner = resolveProcessRunner(plan, input.runner);
    await checkGitAuth(plan, runner, context);
    git = passed('git');
  }

  let token: PreflightCheckResult;
  if (!plan.only.includes('pr')) {
    token = skipped('token', 'stage not selected');
  } else if (plan.skipPr) {
    token = skipped('token', 'skipped via skipPr');
  } else {
    const resolved = await context.resolve(plan);
    if (resolved === undefined) {
      token = skipped('token', 'github token not available');
    } else {
      const fetchFn = resolveFetchFn(plan, input);
      const ownerRepo = resolveOwnerRepo(plan);
      const responseLimit = Math.min(plan.maxOutputBytes, MAX_RESPONSE_BYTES_CAP);
      const repository = `${ownerRepo.owner}/${ownerRepo.repo}`;
      const secrets = context.secrets();
      const result = await sendGitHubRequest(
        fetchFn,
        buildGitHubApiUrl(plan.githubApiUrl, ['repos', ownerRepo.owner, ownerRepo.repo]),
        'GET',
        createGitHubHeaders(resolved),
        undefined,
        plan.timeoutMs,
        responseLimit,
        'GET repo',
        secrets,
      );
      if (result.status < 200 || result.status >= 300) {
        throw new Error(
          tokenGuidance(
            repository,
            `failed (status=${result.status}): ${diagnosticText(result.text, secrets, MAX_ERROR_CHARS)}`,
          ),
        );
      }
      if (!hasPushPermission(result.text, result.status, repository, secrets)) {
        const installation = await sendGitHubRequest(
          fetchFn,
          buildGitHubApiUrl(plan.githubApiUrl, ['installation', 'repositories'], { per_page: '1' }),
          'HEAD',
          createGitHubHeaders(resolved),
          undefined,
          plan.timeoutMs,
          responseLimit,
          'HEAD /installation/repositories',
          secrets,
        );
        if (installation.status < 200 || installation.status >= 300) {
          throw new Error(
            tokenGuidance(
              repository,
              `lacks push permission and HEAD /installation/repositories could not confirm an installation token (status=${installation.status}): ${diagnosticText(installation.text, secrets, MAX_ERROR_CHARS)}`,
            ),
          );
        }
      }
      token = passed('token');
    }
  }

  return { git, token };
}

export async function runPreflight(input: RunPreflightInput): Promise<PreflightResult> {
  const context = stageCredentialContext(input);
  try {
    return await runPreflightWithContext(input, context);
  } catch (error) {
    throw safeError(error, context.secrets());
  }
}
