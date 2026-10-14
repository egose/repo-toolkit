import { describe, expect, it } from 'vitest';

import { runReleaseTag } from '../src/index';
import { recordingGitRunner, withGitFixture } from './git-fixture';
import { successfulGitHubResponse } from './http-fixture';

describe('runReleaseTag signed tag annotations', () => {
  it('keeps signature metadata out of results and the PR body when reading a real Git tag', async () => {
    await withGitFixture(async (fixture) => {
      const { cwd, git: runGit, sourceCommit: commit } = fixture;
      const annotation = 'krypton\nrelease candidate\n\n* feat: add secret previews';
      const signature = '-----BEGIN PGP SIGNATURE-----\n\nc2lnbmF0dXJlLWZpeHR1cmU=\n=TEST\n-----END PGP SIGNATURE-----';
      const tag = runGit(
        ['mktag'],
        `object ${commit}\ntype commit\ntag v1.2.3\ntagger Repo Toolkit <repo-toolkit@example.com> 1700000000 +0000\n\n${annotation}\n${signature}\n`,
      ).trim();
      runGit(['update-ref', 'refs/tags/v1.2.3', tag]);
      expect(runGit(['tag', '-l', '--format=%(contents)', 'v1.2.3'])).toContain(signature);

      const runner = recordingGitRunner(fixture);
      const requests: Record<string, unknown>[] = [];
      const fetchFn: typeof fetch = async (_url, init) => {
        if (init?.method === 'POST') {
          requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        }
        return successfulGitHubResponse(_url, init, { sha: commit });
      };
      const result = await runReleaseTag({
        cwd,
        tag: '1.2.3',
        baseBranch: 'main',
        skipRelease: true,
        githubRepository: 'octo/hello',
        githubToken: 'signed-tag-test-token',
        runner,
        fetchFn,
      });
      expect(runner.runs).toEqual([]);
      expect(result.release?.tagMessage).toBe(annotation);
      expect(requests[0].body).toBe(
        `### Release Candidate Details\n\n${annotation}\n\n---\n\n> This PR was automatically generated.`,
      );
      for (const output of [JSON.stringify(result), JSON.stringify(requests)]) {
        expect(output).not.toContain('PGP SIGNATURE');
        expect(output).not.toContain('c2lnbmF0dXJlLWZpeHR1cmU=');
        expect(output).not.toContain('=TEST');
      }
    });
  });
});
