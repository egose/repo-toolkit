import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { generateChangelog } from '../src/index';

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Repo Toolkit',
      GIT_AUTHOR_EMAIL: 'repo-toolkit@example.com',
      GIT_COMMITTER_NAME: 'Repo Toolkit',
      GIT_COMMITTER_EMAIL: 'repo-toolkit@example.com',
    },
  });
}

async function writePackageJson(cwd: string, version: string): Promise<void> {
  await writeFile(
    join(cwd, 'package.json'),
    `${JSON.stringify({ name: '@example/changelog-fixture', version }, null, 2)}\n`,
  );
}

async function commitFile(cwd: string, fileName: string, contents: string, message: string): Promise<void> {
  await writeFile(join(cwd, fileName), contents);
  runGit(cwd, ['add', fileName]);
  runGit(cwd, ['commit', '-m', message]);
}

async function setVersion(cwd: string, version: string, message = `chore: set version ${version}`): Promise<void> {
  await writePackageJson(cwd, version);
  runGit(cwd, ['add', 'package.json']);
  runGit(cwd, ['commit', '-m', message]);
}

async function initRepo(version: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'repo-toolkit-changelog-git-'));
  runGit(cwd, ['init']);
  runGit(cwd, ['config', 'user.name', 'Repo Toolkit']);
  runGit(cwd, ['config', 'user.email', 'repo-toolkit@example.com']);
  await writePackageJson(cwd, version);
  runGit(cwd, ['add', 'package.json']);
  runGit(cwd, ['commit', '-m', 'chore: init']);
  return cwd;
}

describe('generateChangelog (real git)', () => {
  const repoDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(repoDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('uses tagPrefix when resolving release tags', async () => {
    const cwd = await initRepo('1.1.0');
    repoDirs.push(cwd);

    await commitFile(cwd, 'feature-a.txt', 'a\n', 'feat: alpha release');
    runGit(cwd, ['tag', 'release-1.0.0']);
    await commitFile(cwd, 'feature-b.txt', 'b\n', 'feat: beta release');
    runGit(cwd, ['tag', 'release-1.1.0']);
    await setVersion(cwd, '1.1.1');
    await commitFile(cwd, 'feature-c.txt', 'c\n', 'fix: current change');

    const outputFile = await generateChangelog({
      cwd,
      outputFile: 'CHANGELOG.md',
      outputUnreleased: true,
      releaseCount: 1,
      tagPrefix: 'release-',
    });

    const contents = await readFile(outputFile, 'utf8');
    expect(contents).toContain('current change');
    expect(contents).not.toContain('beta release');
    expect(contents).not.toContain('alpha release');
  });

  it('skips unstable tags by default and can include them explicitly', async () => {
    const cwd = await initRepo('1.0.0');
    repoDirs.push(cwd);

    await commitFile(cwd, 'stable.txt', 'stable\n', 'feat: stable release');
    runGit(cwd, ['tag', 'v1.0.0']);
    await commitFile(cwd, 'beta.txt', 'beta\n', 'feat: beta release');
    runGit(cwd, ['tag', 'v1.1.0-beta.1']);
    await setVersion(cwd, '1.1.0-beta.2');
    await commitFile(cwd, 'current.txt', 'current\n', 'fix: current release');

    const stableOnlyPath = await generateChangelog({
      cwd,
      outputFile: 'CHANGELOG-stable.md',
      outputUnreleased: true,
      releaseCount: 1,
    });
    const stableOnly = await readFile(stableOnlyPath, 'utf8');

    const includeUnstablePath = await generateChangelog({
      cwd,
      outputFile: 'CHANGELOG-beta.md',
      outputUnreleased: true,
      releaseCount: 1,
      skipUnstable: false,
    });
    const includeUnstable = await readFile(includeUnstablePath, 'utf8');

    expect(stableOnly).toContain('current release');
    expect(stableOnly).toContain('beta release');
    expect(includeUnstable).toContain('current release');
    expect(includeUnstable).not.toContain('beta release');
  });

  it('lets firstRelease regenerate more history than a single release count', async () => {
    const cwd = await initRepo('1.0.0');
    repoDirs.push(cwd);

    await commitFile(cwd, 'one.txt', 'one\n', 'feat: first shipped feature');
    runGit(cwd, ['tag', 'v1.0.0']);
    await commitFile(cwd, 'two.txt', 'two\n', 'fix: second shipped fix');
    runGit(cwd, ['tag', 'v1.1.0']);
    await setVersion(cwd, '1.2.0');
    await commitFile(cwd, 'three.txt', 'three\n', 'docs: current work');

    const latestOnlyPath = await generateChangelog({
      cwd,
      outputFile: 'CHANGELOG-latest.md',
      outputUnreleased: true,
      releaseCount: 1,
    });
    const latestOnly = await readFile(latestOnlyPath, 'utf8');

    const firstReleasePath = await generateChangelog({
      cwd,
      outputFile: 'CHANGELOG-first.md',
      outputUnreleased: true,
      releaseCount: 1,
      firstRelease: true,
    });
    const firstRelease = await readFile(firstReleasePath, 'utf8');

    expect(latestOnly).toContain('current work');
    expect(latestOnly).not.toContain('second shipped fix');
    expect(latestOnly).not.toContain('first shipped feature');
    expect(firstRelease).toContain('first shipped feature');
    expect(firstRelease).toContain('second shipped fix');
  });
});
