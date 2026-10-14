import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CapturingProcessRunner } from '@repo-toolkit/publish-package';

import { captureProcess, type BoundedProcessOptions } from '../src/process';

export interface GitFixture {
  root: string;
  cwd: string;
  remote: string;
  sourceCommit: string;
  git: (args: ReadonlyArray<string>, input?: string) => string;
  remoteGit: (args: ReadonlyArray<string>) => string;
  commit: (message: string, parent?: string) => string;
  releaseCommand: (body: string) => Promise<string>;
}

export async function withGitFixture(fn: (fixture: GitFixture) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'release-tag-git-'));
  const cwd = join(root, 'work');
  const remote = join(root, 'origin.git');
  try {
    await mkdir(cwd);
    const git = (args: ReadonlyArray<string>, input?: string): string =>
      execFileSync('git', args, {
        cwd,
        input,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
      });
    const remoteGit = (args: ReadonlyArray<string>): string => git([`--git-dir=${remote}`, ...args]);
    git(['init', '--quiet', '--initial-branch=main']);
    git(['config', 'user.name', 'Fixture Author']);
    git(['config', 'user.email', 'fixture@example.test']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['config', 'tag.gpgsign', 'false']);
    git(['config', 'core.hooksPath', '/dev/null']);
    await writeFile(join(cwd, 'tracked.txt'), 'source work\n');
    git(['add', 'tracked.txt']);
    git(['commit', '--quiet', '--no-gpg-sign', '-m', 'fixture source']);
    git(['init', '--bare', '--quiet', '--initial-branch=main', remote]);
    git(['remote', 'add', 'origin', remote]);
    git(['push', '--quiet', '--set-upstream', 'origin', 'refs/heads/main:refs/heads/main']);
    const sourceCommit = git(['rev-parse', 'HEAD']).trim();
    const commit = (message: string, parent = sourceCommit): string =>
      git(['-c', 'commit.gpgsign=false', 'commit-tree', `${sourceCommit}^{tree}`, '-p', parent], `${message}\n`).trim();
    const releaseCommand = async (body: string): Promise<string> => {
      const path = join(root, 'release-command.cjs');
      await writeFile(
        path,
        `#!/usr/bin/env node\nconst { execFileSync } = require('node:child_process');\nconst { writeFileSync } = require('node:fs');\nconst git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();\nconst tag = 'v' + process.argv[2];\n${body}\n`,
      );
      await chmod(path, 0o700);
      return path;
    };
    await fn({ root, cwd, remote, sourceCommit, git, remoteGit, commit, releaseCommand });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function snapshotGitFixture(fixture: GitFixture) {
  const format = ['for-each-ref', '--format=%(refname) %(objectname) %(symref)'];
  return {
    localRefs: fixture.git(format),
    remoteRefs: fixture.remoteGit(format),
    head: await readFile(join(fixture.cwd, '.git', 'HEAD'), 'utf8'),
    config: await readFile(join(fixture.cwd, '.git', 'config'), 'utf8'),
    index: await readFile(join(fixture.cwd, '.git', 'index')),
    work: await readFile(join(fixture.cwd, 'tracked.txt'), 'utf8'),
    status: fixture.git(['--no-optional-locks', 'status', '--porcelain=v1', '--untracked-files=all']),
  };
}

export function recordingGitRunner(
  fixture: GitFixture,
  beforeCapture?: (args: ReadonlyArray<string>) => void,
): CapturingProcessRunner & { captures: ReadonlyArray<string>[]; runs: ReadonlyArray<string>[] } {
  const captures: ReadonlyArray<string>[] = [];
  const runs: ReadonlyArray<string>[] = [];
  return {
    captures,
    runs,
    run() {
      throw new Error('Real-Git release fixture must use capture');
    },
    runShell() {
      throw new Error('Real-Git fixture must not invoke a shell');
    },
    async capture(executable, args, options) {
      if (options.cwd !== fixture.cwd) {
        throw new Error('Real-Git capture must stay in its disposable checkout');
      }
      captures.push([...args]);
      if (args[1] === '--ci') {
        runs.push([...args]);
      }
      beforeCapture?.(args);
      return captureProcess(executable, args, options as BoundedProcessOptions);
    },
  };
}
