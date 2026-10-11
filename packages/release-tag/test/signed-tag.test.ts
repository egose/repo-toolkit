import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { CapturingProcessRunner } from '@repo-toolkit/publish-package';

import { runReleaseTag } from '../src/index';

describe('runReleaseTag signed tag annotations', () => {
  it('keeps signature metadata out of results and the PR body when reading a real Git tag', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'release-tag-signature-'));
    try {
      const runGit = (args: ReadonlyArray<string>, input?: string): string =>
        execFileSync('git', args, {
          cwd,
          encoding: 'utf8',
          input,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: 'Repo Toolkit',
            GIT_AUTHOR_EMAIL: 'repo-toolkit@example.com',
            GIT_COMMITTER_NAME: 'Repo Toolkit',
            GIT_COMMITTER_EMAIL: 'repo-toolkit@example.com',
          },
        });
      runGit(['init', '--quiet']);
      const tree = runGit(['mktree'], '').trim();
      const commit = runGit(['-c', 'commit.gpgsign=false', 'commit-tree', tree], 'fixture commit\n').trim();
      const annotation = 'krypton\nrelease candidate\n\n* feat: add secret previews';
      const signature = '-----BEGIN PGP SIGNATURE-----\n\nc2lnbmF0dXJlLWZpeHR1cmU=\n=TEST\n-----END PGP SIGNATURE-----';
      const tag = runGit(
        ['mktag'],
        `object ${commit}\ntype commit\ntag v1.2.3\ntagger Repo Toolkit <repo-toolkit@example.com> 1700000000 +0000\n\n${annotation}\n${signature}\n`,
      ).trim();
      runGit(['update-ref', 'refs/tags/v1.2.3', tag]);
      expect(runGit(['tag', '-l', '--format=%(contents)', 'v1.2.3'])).toContain(signature);

      const runner: CapturingProcessRunner = {
        run() {
          throw new Error('release execution must be skipped');
        },
        runShell() {
          throw new Error('shell execution must not be used');
        },
        async capture(_executable, args) {
          return { stdout: args[0] === 'tag' ? runGit(args) : '', stderr: '', code: 0 };
        },
      };
      const requests: Record<string, unknown>[] = [];
      const fetchFn: typeof fetch = async (_url, init) => {
        if (init?.method === 'POST') {
          requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return new Response(JSON.stringify({ number: 42, html_url: 'https://github.com/octo/hello/pull/42' }), {
            status: 201,
          });
        }
        return new Response(JSON.stringify({ permissions: { push: true } }));
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
      expect(result.release?.tagMessage).toBe(annotation);
      expect(requests[0].body).toBe(
        `### Release Candidate Details\n\n${annotation}\n\n---\n\n> This PR was automatically generated.`,
      );
      for (const output of [JSON.stringify(result), JSON.stringify(requests)]) {
        expect(output).not.toContain('PGP SIGNATURE');
        expect(output).not.toContain('c2lnbmF0dXJlLWZpeHR1cmU=');
        expect(output).not.toContain('=TEST');
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
