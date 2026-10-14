import type { CapturingProcessRunner, ProcessCaptureResult } from '@repo-toolkit/publish-package';

import type { ReleaseTagPlan } from './plan';
import { captureCommand, type CommandDiagnostics } from './process';
import { assertGitObjectId } from './validation';

export interface ReleasePreparation {
  sourceCommit: string;
  remoteReleaseCommit: string | null;
}

export async function captureGit(
  runner: CapturingProcessRunner | undefined,
  plan: ReleaseTagPlan,
  args: ReadonlyArray<string>,
  label = `git ${args.join(' ')}`,
  acceptedExitCodes: ReadonlyArray<number> = [0],
  diagnostics: CommandDiagnostics = {},
): Promise<ProcessCaptureResult> {
  return captureCommand(runner, plan, plan.gitExecutable, args, { ...diagnostics, label, acceptedExitCodes });
}

function outputLines(stdout: string): string[] {
  return stdout.length === 0 ? [] : stdout.replace(/\r?\n$/, '').split('\n');
}

export async function readLocalRef(
  runner: CapturingProcessRunner | undefined,
  plan: ReleaseTagPlan,
  ref: string,
  diagnostics: CommandDiagnostics,
): Promise<string | null> {
  const symbolic = await captureGit(
    runner,
    plan,
    ['symbolic-ref', '--quiet', '--no-recurse', ref],
    `git symbolic-ref ${ref}`,
    [0, 1],
    diagnostics,
  );
  if (symbolic.code === 0) {
    throw new Error(
      `Local ${ref} is a symbolic ref. Use independent branch refs; refusing to follow or reset an alias.`,
    );
  }
  const result = await captureGit(
    runner,
    plan,
    ['for-each-ref', '--format=%(refname)%09%(objectname)%09%(symref)', ref],
    undefined,
    undefined,
    diagnostics,
  );
  let objectId: string | null = null;
  for (const line of outputLines(result.stdout)) {
    const fields = line.split('\t');
    if (fields.length !== 3 || (fields[0] !== ref && !fields[0].startsWith(`${ref}/`))) {
      throw new Error(`git for-each-ref returned unexpected output for ${ref}`);
    }
    if (fields[0] !== ref) {
      continue;
    }
    if (fields[2] !== '') {
      throw new Error(
        `Local ${ref} is a symbolic ref. Use independent branch refs; refusing to follow or reset an alias.`,
      );
    }
    if (objectId !== null) {
      throw new Error(`git for-each-ref returned multiple entries for ${ref}`);
    }
    assertGitObjectId(fields[1], `git for-each-ref ${ref}`);
    objectId = fields[1];
  }
  return objectId;
}

export async function readRemoteRef(
  runner: CapturingProcessRunner | undefined,
  plan: ReleaseTagPlan,
  ref: string,
  diagnostics: CommandDiagnostics,
): Promise<string | null> {
  const result = await captureGit(
    runner,
    plan,
    ['ls-remote', '--refs', '--symref', 'origin', ref],
    undefined,
    undefined,
    diagnostics,
  );
  let objectId: string | null = null;
  for (const line of outputLines(result.stdout)) {
    const fields = line.split('\t');
    if (fields.length !== 2 || fields[1] !== ref) {
      throw new Error(`git ls-remote returned unexpected output for ${ref}; inspect origin before retrying.`);
    }
    if (fields[0].startsWith('ref: ')) {
      throw new Error(
        `Origin ${ref} is a symbolic ref. Use independent branch refs; refusing to follow or reset an alias.`,
      );
    }
    if (objectId !== null) {
      throw new Error(`git ls-remote returned multiple entries for ${ref}; inspect origin before retrying.`);
    }
    assertGitObjectId(fields[0], `git ls-remote origin ${ref}`);
    objectId = fields[0];
  }
  return objectId;
}

export async function readCommit(
  runner: CapturingProcessRunner | undefined,
  plan: ReleaseTagPlan,
  ref: string,
  label: string,
  diagnostics: CommandDiagnostics,
): Promise<string> {
  const result = await captureGit(
    runner,
    plan,
    ['rev-parse', '--verify', `${ref}^{commit}`],
    label,
    undefined,
    diagnostics,
  );
  const commit = result.stdout.replace(/\r?\n$/, '');
  assertGitObjectId(commit, label);
  return commit;
}

async function assertCheckedOutBranch(
  runner: CapturingProcessRunner | undefined,
  plan: ReleaseTagPlan,
  branch: string,
  guidance: string,
  diagnostics: CommandDiagnostics,
): Promise<void> {
  const result = await captureGit(runner, plan, ['symbolic-ref', '--quiet', 'HEAD'], guidance, undefined, diagnostics);
  if (result.stdout.replace(/\r?\n$/, '') !== `refs/heads/${branch}`) {
    throw new Error(`${guidance}: expected branch ${JSON.stringify(branch)} to be checked out.`);
  }
}

async function assertCleanWorktree(
  runner: CapturingProcessRunner | undefined,
  plan: ReleaseTagPlan,
  label: string,
  diagnostics: CommandDiagnostics,
): Promise<void> {
  const result = await captureGit(
    runner,
    plan,
    ['--no-optional-locks', 'status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none'],
    `${label}: git status`,
    undefined,
    diagnostics,
  );
  if (result.stdout.length > 0) {
    throw new Error(
      `${label}: a clean tracked/untracked worktree is required. Commit, stash, or remove pending work before retrying.`,
    );
  }
}

async function verifyReleaseSource(
  runner: CapturingProcessRunner | undefined,
  plan: ReleaseTagPlan,
  baseBranch: string,
  diagnostics: CommandDiagnostics,
): Promise<string> {
  const baseCommit = await readLocalRef(runner, plan, `refs/heads/${baseBranch}`, diagnostics);
  const guidance = `Release source validation: check out the intended local base branch ${JSON.stringify(baseBranch)} and provide --base-branch; detached/tag or other branch checkouts cannot be released`;
  if (baseCommit === null) {
    throw new Error(`Local base branch ${JSON.stringify(baseBranch)} is missing. Fetch/create it, then ${guidance}`);
  }
  await assertCheckedOutBranch(runner, plan, baseBranch, guidance, diagnostics);
  const head = await readCommit(runner, plan, 'HEAD', `${guidance}: git rev-parse HEAD`, diagnostics);
  if (head !== baseCommit) {
    throw new Error(
      `${guidance}: HEAD does not match the inspected base commit. Stop concurrent Git operations and retry from a verified checkout.`,
    );
  }
  await assertCleanWorktree(runner, plan, 'Release source validation', diagnostics);
  return head;
}

export async function inspectReleasePreparation(
  runner: CapturingProcessRunner | undefined,
  plan: ReleaseTagPlan,
  baseBranch: string,
  releaseBranch: string,
  tagVersion: string,
  diagnostics: CommandDiagnostics = {},
): Promise<ReleasePreparation> {
  const sourceCommit = await verifyReleaseSource(runner, plan, baseBranch, diagnostics);
  const releaseRef = `refs/heads/${releaseBranch}`;
  const localReleaseCommit = await readLocalRef(runner, plan, releaseRef, diagnostics);
  const remoteReleaseCommit = await readRemoteRef(runner, plan, releaseRef, diagnostics);
  if ((localReleaseCommit !== null || remoteReleaseCommit !== null) && plan.resetReleaseBranch !== true) {
    throw new Error(
      `Release branch ${JSON.stringify(releaseBranch)} already exists locally or on origin. Inspect the existing work; choose another releaseBranch or explicitly set resetReleaseBranch: true for an intentional restart.`,
    );
  }
  if (!plan.skipRelease) {
    const tagRef = `refs/tags/${tagVersion}`;
    const localTag = await readLocalRef(runner, plan, tagRef, diagnostics);
    const remoteTag = await readRemoteRef(runner, plan, tagRef, diagnostics);
    if (localTag !== null || remoteTag !== null) {
      throw new Error(
        `Release tag ${JSON.stringify(tagVersion)} already exists locally or on origin. Choose a new version; use skipRelease only for deliberate preparation/composition with existing metadata. Release tags must not be overwritten.`,
      );
    }
  }
  return { sourceCommit, remoteReleaseCommit };
}

export async function verifyReleasedHead(
  runner: CapturingProcessRunner | undefined,
  plan: ReleaseTagPlan,
  releaseBranch: string,
  tagVersion: string,
  diagnostics: CommandDiagnostics = {},
): Promise<string> {
  const label = 'Release command postcondition failed; inspect the release checkout before retrying';
  await assertCheckedOutBranch(runner, plan, releaseBranch, label, diagnostics);
  await assertCleanWorktree(runner, plan, label, diagnostics);
  const head = await readCommit(runner, plan, 'HEAD', `${label}: git rev-parse HEAD`, diagnostics);
  const tagCommit = await readCommit(
    runner,
    plan,
    `refs/tags/${tagVersion}`,
    `${label}: target tag ${tagVersion} must exist and resolve to the released head`,
    diagnostics,
  );
  if (tagCommit !== head) {
    throw new Error(
      `${label}: target tag ${tagVersion} points to ${tagCommit}, but release HEAD is ${head}. Resolve the release identity before pushing or creating a PR.`,
    );
  }
  return head;
}

export async function pushReleaseBranch(
  runner: CapturingProcessRunner | undefined,
  plan: ReleaseTagPlan,
  releaseBranch: string,
  source: string,
  expectedRemoteCommit: string | null,
  setUpstream = false,
  diagnostics: CommandDiagnostics = {},
): Promise<void> {
  const ref = `refs/heads/${releaseBranch}`;
  await captureGit(
    runner,
    plan,
    [
      'push',
      '--no-follow-tags',
      `--force-with-lease=${ref}:${expectedRemoteCommit ?? ''}`,
      ...(setUpstream ? ['--set-upstream'] : []),
      'origin',
      `${source}:${ref}`,
    ],
    `git push${setUpstream ? ' --set-upstream' : ''} origin ${releaseBranch} with an explicit lease; inspect remote changes and authentication before retrying`,
    undefined,
    diagnostics,
  );
}
