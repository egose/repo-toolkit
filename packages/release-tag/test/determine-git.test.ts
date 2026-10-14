import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { determineNextTag, resolveReleaseTagPlan, runReleaseTag } from '../src/index';
import { recordingGitRunner, snapshotGitFixture, withGitFixture, type GitFixture } from './git-fixture';

beforeEach(() => {
  for (const key of [
    'GITHUB_TOKEN',
    'GITHUB_REPOSITORY',
    'GITHUB_REF_NAME',
    'GITHUB_REF_TYPE',
    'GITHUB_REF',
    'GITHUB_API_URL',
  ]) {
    vi.stubEnv(key, undefined);
  }
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function commitMessage(fixture: GitFixture, message: string): void {
  fixture.git(
    ['commit', '--quiet', '--allow-empty', '--allow-empty-message', '--no-gpg-sign', '--cleanup=verbatim', '-F', '-'],
    message,
  );
}

describe('version determination with real Git records', () => {
  it('distinguishes an empty-message commit from a genuinely empty range', async () => {
    await withGitFixture(async (fixture) => {
      fixture.git(['tag', 'v1.2.3']);
      const runner = recordingGitRunner(fixture);
      const plan = resolveReleaseTagPlan({ cwd: fixture.cwd, runner });
      expect(await determineNextTag({ plan })).toEqual({
        version: '1.2.3',
        tagVersion: 'v1.2.3',
        bump: null,
        lastTag: 'v1.2.3',
        manual: false,
        noChanges: true,
      });
      commitMessage(fixture, '');
      expect(fixture.git(['log', 'v1.2.3..HEAD', '--pretty=format:%B'])).toBe('');
      expect(await determineNextTag({ plan })).toEqual({
        version: '1.2.4',
        tagVersion: 'v1.2.4',
        bump: 'patch',
        lastTag: 'v1.2.3',
        manual: false,
        noChanges: false,
      });
      expect(runner.captures.map((args) => args[0])).toEqual(['describe', 'log', 'describe', 'log']);
      expect(runner.runs).toHaveLength(0);
    });
  });

  it('keeps first-line headers separate from folded Git subject paragraphs', async () => {
    await withGitFixture(async (fixture) => {
      fixture.git(['tag', 'v1.2.3']);
      commitMessage(fixture, 'feat:\na description on the next line\n');
      expect(fixture.git(['log', '-1', '--format=%s'])).toBe('feat: a description on the next line\n');
      const result = await determineNextTag({ plan: resolveReleaseTagPlan({ cwd: fixture.cwd }) });
      expect(result).toMatchObject({ bump: 'patch', noChanges: false });
    });
  });

  it.each([
    {
      name: 'body examples',
      messages: ['docs: examples\n\nfeat: add widget\nrefactor!: replace interface\n'],
      bump: 'patch',
    },
    {
      name: 'incidental punctuation',
      messages: ['fix(scope!:example): repair\n', 'fix: handle a!:b\n'],
      bump: 'patch',
    },
    {
      name: 'footer-like subjects and inline text',
      messages: ['BREAKING CHANGE: only the subject\n', 'fix: explain\n\nInline BREAKING-CHANGE: example\n'],
      bump: 'patch',
    },
    {
      name: 'feature among multiple records',
      messages: ['docs: examples\n\nfeat!: body example\n', 'feat(api): add endpoint\n', 'fix: repair\n'],
      bump: 'minor',
    },
    {
      name: 'arbitrary breaking type and precedence',
      messages: ['custom-type(api)!: replace interface\n', 'feat: add widget\n', 'fix: repair\n'],
      bump: 'major',
    },
    { name: 'BREAKING CHANGE footer', messages: ['fix: update\n\nBREAKING CHANGE: remove api\n'], bump: 'major' },
    {
      name: 'BREAKING-CHANGE footer',
      messages: ['fix: update\n\nBREAKING-CHANGE: remove api\n', 'feat: add widget\n'],
      bump: 'major',
    },
    {
      name: 'control characters inside bodies',
      messages: ['docs: examples\n\nRecord-like text \u001e\nfeat: body example\n\u001f\n', 'fix: repair\n'],
      bump: 'patch',
    },
  ])('classifies $name without losing record or message boundaries', async ({ messages, bump }) => {
    await withGitFixture(async (fixture) => {
      fixture.git(['tag', 'v1.2.3']);
      for (const message of messages) {
        commitMessage(fixture, message);
      }
      const before = await snapshotGitFixture(fixture);
      const runner = recordingGitRunner(fixture);
      const result = await determineNextTag({ plan: resolveReleaseTagPlan({ cwd: fixture.cwd, runner }) });
      expect(result.bump).toBe(bump);
      expect(result.noChanges).toBe(false);
      expect(result.lastTag).toBe('v1.2.3');
      expect(await snapshotGitFixture(fixture)).toEqual(before);
      expect(runner.captures.map((args) => args[0])).toEqual(['describe', 'log']);
    });
  });

  it('returns no-change on a dirty detached checkout without requiring a base, origin, command or token file', async () => {
    await withGitFixture(async (fixture) => {
      fixture.git(['tag', 'v1.2.3']);
      fixture.git(['checkout', '--detach', 'v1.2.3']);
      fixture.git(['remote', 'remove', 'origin']);
      await writeFile(join(fixture.cwd, 'tracked.txt'), 'work that must survive\n');
      await writeFile(join(fixture.cwd, 'untracked.txt'), 'untracked work that must survive\n');
      vi.stubEnv('GITHUB_REF_TYPE', 'tag');
      vi.stubEnv('GITHUB_REF', 'refs/tags/v1.2.3');
      vi.stubEnv('GITHUB_REF_NAME', 'v1.2.3');
      vi.stubEnv('GITHUB_REPOSITORY', '../unused-repository');
      const before = await snapshotGitFixture(fixture);
      const runner = recordingGitRunner(fixture);
      const fetchFn = vi.fn<typeof fetch>(async () => {
        throw new Error('no-change must not fetch');
      });
      const result = await runReleaseTag({
        cwd: fixture.cwd,
        githubTokenFile: 'missing-token',
        releaseCommand: './missing-command',
        runner,
        fetchFn,
      });
      expect(result.determined).toMatchObject({ version: '1.2.3', bump: null, manual: false, noChanges: true });
      expect(result.release).toBeNull();
      expect(result.pullRequest).toBeNull();
      expect(runner.captures.map((args) => args[0])).toEqual(['describe', 'log']);
      expect(runner.runs).toHaveLength(0);
      expect(fetchFn).not.toHaveBeenCalled();
      expect(await snapshotGitFixture(fixture)).toEqual(before);
    });
  });

  it('retains seed guidance when no previous tag exists', async () => {
    await withGitFixture(async (fixture) => {
      const runner = recordingGitRunner(fixture);
      await expect(determineNextTag({ plan: resolveReleaseTagPlan({ cwd: fixture.cwd, runner }) })).rejects.toThrow(
        'No previous tag found and no tag input provided. Provide --tag once to seed release history.',
      );
      expect(runner.captures.map((args) => args[0])).toEqual(['describe']);
    });
  });

  it('refuses a nonconforming latest tag instead of reinterpreting it or selecting an older stable tag', async () => {
    await withGitFixture(async (fixture) => {
      fixture.git(['tag', 'v1.2.3']);
      commitMessage(fixture, 'feat: add widget\n');
      fixture.git(['tag', 'release-latest']);
      const runner = recordingGitRunner(fixture);
      await expect(determineNextTag({ plan: resolveReleaseTagPlan({ cwd: fixture.cwd, runner }) })).rejects.toThrow(
        /Last tag.*vX\.Y\.Z/,
      );
      expect(runner.captures.map((args) => args[0])).toEqual(['describe']);
    });
  });
});
