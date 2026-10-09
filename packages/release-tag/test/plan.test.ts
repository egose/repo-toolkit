import { describe, expect, it } from 'vitest';

import { resolveReleaseTagPlan, type ReleaseTagOptions } from '../src/index';

const TOKEN_CANARY = 'release-tag-canary-9f3b1c-token-bytes';

function makeRunner() {
  return {
    run() {},
    runShell() {},
    capture: async () => ({ stdout: '', stderr: '', code: 0 }),
  };
}

function withGithubTokenEnv(value: string | undefined, fn: () => void): void {
  const saved = process.env.GITHUB_TOKEN;
  if (value === undefined) {
    delete process.env.GITHUB_TOKEN;
  } else {
    process.env.GITHUB_TOKEN = value;
  }
  try {
    fn();
  } finally {
    if (saved === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = saved;
    }
  }
}

describe('resolveReleaseTagPlan', () => {
  it('returns documented defaults with no token bytes', () => {
    withGithubTokenEnv(undefined, () => {
      const plan = resolveReleaseTagPlan({});
      expect(plan.cwd).toBe(process.cwd());
      expect(plan.tag).toBeUndefined();
      expect(plan.baseBranch).toBeUndefined();
      expect(plan.releaseBranch).toBeUndefined();
      expect(plan.gitExecutable).toBe('git');
      expect(plan.gitUserName).toBe('github-actions[bot]');
      expect(plan.gitUserEmail).toBe('github-actions[bot]@users.noreply.github.com');
      expect(plan.signCommit).toBe(false);
      expect(plan.releaseCommand).toBe('./node_modules/.bin/release-it');
      expect(plan.releaseArgs).toEqual([]);
      expect(plan.skipRelease).toBe(false);
      expect(plan.githubTokenEnv).toBe('GITHUB_TOKEN');
      expect(plan.githubTokenFile).toBeUndefined();
      expect(plan.githubRepository).toBeUndefined();
      expect(plan.githubApiUrl).toBe('https://api.github.com');
      expect(plan.autoMergePr).toBe(false);
      expect(plan.deleteMergedBranch).toBe(false);
      expect(plan.skipPr).toBe(false);
      expect(plan.tokenSource).toBe('none');
      expect(plan.tokenAvailable).toBe(false);
      expect(plan.dryRun).toBe(false);
      expect(plan.only).toEqual(['determine', 'release', 'pr']);
      expect(plan.timeoutMs).toBe(60000);
      expect(plan.maxOutputBytes).toBe(1048576);
      expect(plan.runner).toBeUndefined();
      expect(plan.fetchFn).toBeUndefined();
      expect('githubToken' in plan).toBe(false);
    });
  });

  it('accepts omitted options', () => {
    withGithubTokenEnv(undefined, () => {
      const plan = resolveReleaseTagPlan();
      expect(plan.tokenSource).toBe('none');
      expect(plan.only).toEqual(['determine', 'release', 'pr']);
    });
  });

  it('rejects non-object options', () => {
    for (const options of [null, 'tag', 42, ['tag']]) {
      expect(() => resolveReleaseTagPlan(options as unknown as ReleaseTagOptions)).toThrow(/options/);
    }
  });

  it('normalizes a tag with a single leading v', () => {
    const plan = resolveReleaseTagPlan({ tag: 'v1.2.3' });
    expect(plan.tag).toBe('1.2.3');
    expect(plan.releaseBranch).toBe('changelog/1.2.3');
  });

  it('accepts a bare X.Y.Z tag', () => {
    const plan = resolveReleaseTagPlan({ tag: '1.2.3' });
    expect(plan.tag).toBe('1.2.3');
    expect(plan.releaseBranch).toBe('changelog/1.2.3');
  });

  it('rejects tags outside the X.Y.Z manual contract', () => {
    for (const tag of ['1.2.3.4', 'v1.2', '1.2.3-beta', 'vv1.2.3', '', 'v', '1.2.3+build', ' 1.2.3']) {
      expect(() => resolveReleaseTagPlan({ tag })).toThrow(/tag/);
    }
  });

  it('accepts an explicit release branch over the tag template', () => {
    const plan = resolveReleaseTagPlan({ tag: 'v1.2.3', releaseBranch: 'custom/branch' });
    expect(plan.releaseBranch).toBe('custom/branch');
  });

  it('rejects empty, whitespace, and HEAD release branches', () => {
    for (const releaseBranch of ['', 'has space', 'has\ttab', 'HEAD']) {
      expect(() => resolveReleaseTagPlan({ releaseBranch })).toThrow(/releaseBranch/);
    }
  });

  it('stores an explicit base branch and leaves it undefined otherwise', () => {
    expect(resolveReleaseTagPlan({ baseBranch: 'main' }).baseBranch).toBe('main');
    expect(resolveReleaseTagPlan({}).baseBranch).toBeUndefined();
  });

  it('accepts valid only subsets and rejects unknown stages', () => {
    expect(resolveReleaseTagPlan({ only: ['pr'] }).only).toEqual(['pr']);
    expect(resolveReleaseTagPlan({ only: ['release', 'determine'] }).only).toEqual(['release', 'determine']);
    expect(() => resolveReleaseTagPlan({ only: ['bogus'] })).toThrow(/only/);
    expect(() => resolveReleaseTagPlan({ only: ['determine', 'bogus'] })).toThrow(/only/);
    expect(() => resolveReleaseTagPlan({ only: 'pr' as unknown as ReadonlyArray<string> })).toThrow(/only/);
  });

  it('accepts owner/repo repositories and rejects malformed shapes', () => {
    expect(resolveReleaseTagPlan({ githubRepository: 'octo/repo' }).githubRepository).toBe('octo/repo');
    for (const githubRepository of ['', 'owner', '/repo', 'owner/', 'a/b/c', 'owner /repo', '/']) {
      expect(() => resolveReleaseTagPlan({ githubRepository })).toThrow(/githubRepository/);
    }
  });

  it('accepts http(s) API urls and rejects credentials, fragments, and other schemes', () => {
    expect(resolveReleaseTagPlan({ githubApiUrl: 'http://127.0.0.1:8080' }).githubApiUrl).toBe('http://127.0.0.1:8080');
    expect(resolveReleaseTagPlan({ githubApiUrl: 'https://ghe.example.com/api/v3' }).githubApiUrl).toBe(
      'https://ghe.example.com/api/v3',
    );
    for (const githubApiUrl of [
      '',
      'not-a-url',
      'ftp://example.com',
      'https://user:pass@example.com',
      'https://example.com/path#fragment',
    ]) {
      expect(() => resolveReleaseTagPlan({ githubApiUrl })).toThrow(/githubApiUrl/);
    }
  });

  it('rejects empty strings for fields that require values', () => {
    const cases: Array<{ label: string; options: ReleaseTagOptions }> = [
      { label: 'cwd', options: { cwd: '' } },
      { label: 'baseBranch', options: { baseBranch: '' } },
      { label: 'gitExecutable', options: { gitExecutable: '' } },
      { label: 'releaseCommand', options: { releaseCommand: '' } },
      { label: 'githubRepository', options: { githubRepository: '' } },
      { label: 'githubApiUrl', options: { githubApiUrl: '' } },
    ];
    for (const { label, options } of cases) {
      expect(() => resolveReleaseTagPlan(options)).toThrow(new RegExp(label));
    }
  });

  it('rejects NUL bytes with messages naming the field', () => {
    const cases: Array<{ label: string; options: ReleaseTagOptions }> = [
      { label: 'cwd', options: { cwd: 'a\0b' } },
      { label: 'tag', options: { tag: '1.2\0.3' } },
      { label: 'gitExecutable', options: { gitExecutable: 'gi\0t' } },
      { label: 'releaseArgs', options: { releaseArgs: ['ok', 'a\0'] } },
      { label: 'githubRepository', options: { githubRepository: 'a\0/b' } },
    ];
    for (const { label, options } of cases) {
      expect(() => resolveReleaseTagPlan(options)).toThrow(new RegExp(label));
    }
  });

  it('rejects non-string releaseArgs entries', () => {
    expect(resolveReleaseTagPlan({ releaseArgs: ['--ci', '--dry-run'] }).releaseArgs).toEqual(['--ci', '--dry-run']);
    expect(() => resolveReleaseTagPlan({ releaseArgs: 'x' as unknown as ReadonlyArray<string> })).toThrow(
      /releaseArgs/,
    );
    expect(() => resolveReleaseTagPlan({ releaseArgs: ['ok', 42] as unknown as ReadonlyArray<string> })).toThrow(
      /releaseArgs/,
    );
  });

  it('rejects non-positive timeoutMs and maxOutputBytes', () => {
    for (const timeoutMs of [0, -1, Number.NaN, 1.5, 'x']) {
      expect(() => resolveReleaseTagPlan({ timeoutMs: timeoutMs as unknown as number })).toThrow(/timeoutMs/);
    }
    for (const maxOutputBytes of [0, -1, Number.NaN, 1.5, 'x']) {
      expect(() => resolveReleaseTagPlan({ maxOutputBytes: maxOutputBytes as unknown as number })).toThrow(
        /maxOutputBytes/,
      );
    }
    expect(resolveReleaseTagPlan({ timeoutMs: 1000, maxOutputBytes: 1024 }).timeoutMs).toBe(1000);
  });

  it('rejects non-boolean flags', () => {
    expect(() => resolveReleaseTagPlan({ dryRun: 'yes' as unknown as boolean })).toThrow(/dryRun/);
    expect(() => resolveReleaseTagPlan({ skipRelease: 1 as unknown as boolean })).toThrow(/skipRelease/);
  });

  it('accepts a capturing runner and rejects invalid runner shapes', () => {
    const runner = makeRunner();
    expect(resolveReleaseTagPlan({ runner }).runner).toBe(runner);
    for (const bad of [{}, { run() {}, runShell() {}, capture: 'x' }, null, 'x']) {
      expect(() => resolveReleaseTagPlan({ runner: bad } as unknown as ReleaseTagOptions)).toThrow(/runner/);
    }
  });

  it('accepts a fetch function and rejects invalid fetch shapes', () => {
    expect(resolveReleaseTagPlan({ fetchFn: globalThis.fetch }).fetchFn).toBe(globalThis.fetch);
    for (const fetchFn of ['x', {}, null]) {
      expect(() => resolveReleaseTagPlan({ fetchFn: fetchFn } as unknown as ReleaseTagOptions)).toThrow(/fetchFn/);
    }
  });

  it('never embeds an explicit token in the plan', () => {
    const plan = resolveReleaseTagPlan({ githubToken: TOKEN_CANARY });
    expect(plan.tokenSource).toBe('explicit');
    expect(plan.tokenAvailable).toBe(true);
    expect(JSON.stringify(plan)).not.toContain(TOKEN_CANARY);
    expect('githubToken' in plan).toBe(false);
  });

  it('resolves token source from file option and env without embedding secrets', () => {
    const filePlan = resolveReleaseTagPlan({ githubTokenFile: '/run/secrets/github_token' });
    expect(filePlan.tokenSource).toBe('file');
    expect(filePlan.tokenAvailable).toBe(true);
    expect(filePlan.githubTokenFile).toBe('/run/secrets/github_token');

    withGithubTokenEnv(TOKEN_CANARY, () => {
      const envPlan = resolveReleaseTagPlan({});
      expect(envPlan.tokenSource).toBe('env');
      expect(envPlan.tokenAvailable).toBe(true);
      expect(JSON.stringify(envPlan)).not.toContain(TOKEN_CANARY);
    });
  });

  it('prefers explicit tokens over file and env sources', () => {
    withGithubTokenEnv(TOKEN_CANARY, () => {
      expect(resolveReleaseTagPlan({ githubToken: 'explicit-value', githubTokenFile: '/tmp/token' }).tokenSource).toBe(
        'explicit',
      );
      expect(resolveReleaseTagPlan({ githubTokenFile: '/tmp/token' }).tokenSource).toBe('file');
    });
  });

  it('never leaks token bytes into thrown error messages', () => {
    try {
      resolveReleaseTagPlan({ githubToken: `${TOKEN_CANARY}\0` });
      expect.unreachable();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain('githubToken');
      expect(message).not.toContain(TOKEN_CANARY);
    }
  });
});
