import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseFlags } from '@repo-toolkit/publish-package';
import type { CapturingProcessRunner, ProcessCaptureResult } from '@repo-toolkit/publish-package';

import {
  SPECS,
  buildOptions,
  formatJsonDryRun,
  formatJsonResult,
  formatTextDryRun,
  formatTextResult,
  planSummary,
} from '../src/cli';
import { runReleaseTag } from '../src/index';

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI_PATH = join(PACKAGE_ROOT, 'dist', 'cli.js');
const TOKEN_CANARY = 'cli-canary-token-7f2a9d-do-not-leak';
const ENV_TOKEN = 'cli-env-token-3b8e1c-do-not-leak';

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: ReadonlyArray<string>, env: Record<string, string | undefined> = {}): CliResult {
  const merged: Record<string, string | undefined> = { ...process.env };
  for (const key of Object.keys(env)) {
    const value = env[key];
    if (value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    encoding: 'utf8',
    env: merged as Record<string, string>,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function flagResult(argv: ReadonlyArray<string>) {
  const result = parseFlags([...argv], SPECS);
  if (!result) {
    throw new Error('unexpected help result');
  }
  return result;
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    const value = vars[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(vars)) {
      const value = saved[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function ok(stdout: string): ProcessCaptureResult {
  return { stdout, stderr: '', code: 0 };
}

function makeRunner(script: ReadonlyArray<ProcessCaptureResult>): CapturingProcessRunner & {
  captures: Array<{ args: ReadonlyArray<string> }>;
  runs: Array<{ args: ReadonlyArray<string> }>;
} {
  const captures: Array<{ args: ReadonlyArray<string> }> = [];
  const runs: Array<{ args: ReadonlyArray<string> }> = [];
  let index = 0;
  return {
    captures,
    runs,
    run(_executable, args) {
      runs.push({ args: [...args] });
    },
    runShell() {
      throw new Error('unexpected runShell');
    },
    async capture(_executable, args) {
      captures.push({ args: [...args] });
      const result = script[index];
      index += 1;
      if (!result) {
        throw new Error('script exhausted');
      }
      return result;
    },
  } as unknown as CapturingProcessRunner & {
    captures: Array<{ args: ReadonlyArray<string> }>;
    runs: Array<{ args: ReadonlyArray<string> }>;
  };
}

function makeFetch() {
  const calls: Array<{ url: string }> = [];
  const fetchFn = (async (url: unknown) => {
    calls.push({ url: String(url) });
    return {
      ok: true,
      status: 201,
      headers: new Headers(),
      text: async () => JSON.stringify({ number: 1, html_url: 'https://github.com/octo/hello/pull/1' }),
    } as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe('release-tag cli flags', () => {
  it('maps string flags to camelCase options', () => {
    withEnv({ GITHUB_API_URL: undefined }, () => {
      const options = buildOptions(
        flagResult([
          '--tag',
          '1.2.3',
          '--cwd',
          '/tmp/work',
          '--base-branch',
          'main',
          '--release-branch',
          'changelog/1.2.3',
          '--git-executable',
          '/usr/bin/git',
          '--release-command',
          './bin/release-it',
          '--git-user-name',
          'Bot',
          '--git-user-email',
          'bot@example.com',
          '--github-token',
          'inline-token',
          '--github-token-file',
          'token.txt',
          '--github-token-env',
          'CUSTOM_TOKEN',
          '--github-repository',
          'octo/hello',
          '--github-api-url',
          'https://ghe.example.com/api/v3',
        ]),
      );
      expect(options.tag).toBe('1.2.3');
      expect(options.cwd).toBe('/tmp/work');
      expect(options.baseBranch).toBe('main');
      expect(options.releaseBranch).toBe('changelog/1.2.3');
      expect(options.gitExecutable).toBe('/usr/bin/git');
      expect(options.releaseCommand).toBe('./bin/release-it');
      expect(options.gitUserName).toBe('Bot');
      expect(options.gitUserEmail).toBe('bot@example.com');
      expect(options.githubToken).toBe('inline-token');
      expect(options.githubTokenFile).toBe('token.txt');
      expect(options.githubTokenEnv).toBe('CUSTOM_TOKEN');
      expect(options.githubRepository).toBe('octo/hello');
      expect(options.githubApiUrl).toBe('https://ghe.example.com/api/v3');
    });
  });

  it('maps release-it-path to releaseCommand with last writer wins', () => {
    withEnv({ GITHUB_API_URL: undefined }, () => {
      expect(buildOptions(flagResult(['--release-it-path', './a'])).releaseCommand).toBe('./a');
      expect(buildOptions(flagResult(['--release-command', './a', '--release-it-path', './b'])).releaseCommand).toBe(
        './b',
      );
      expect(buildOptions(flagResult(['--release-it-path', './a', '--release-command', './b'])).releaseCommand).toBe(
        './b',
      );
    });
  });

  it('handles sign-commit negation', () => {
    withEnv({ GITHUB_API_URL: undefined }, () => {
      expect(buildOptions(flagResult([])).signCommit).toBeUndefined();
      expect(buildOptions(flagResult(['--sign-commit'])).signCommit).toBe(true);
      expect(buildOptions(flagResult(['--no-sign-commit'])).signCommit).toBe(false);
      expect(buildOptions(flagResult(['--sign-commit', '--no-sign-commit'])).signCommit).toBe(false);
    });
  });

  it('maps boolean flags', () => {
    withEnv({ GITHUB_API_URL: undefined }, () => {
      const options = buildOptions(
        flagResult(['--auto-merge-pr', '--delete-merged-branch', '--skip-release', '--skip-pr', '--dry-run']),
      );
      expect(options.autoMergePr).toBe(true);
      expect(options.deleteMergedBranch).toBe(true);
      expect(options.skipRelease).toBe(true);
      expect(options.skipPr).toBe(true);
      expect(options.dryRun).toBe(true);
      const empty = buildOptions(flagResult([]));
      expect(empty.autoMergePr).toBeUndefined();
      expect(empty.deleteMergedBranch).toBeUndefined();
      expect(empty.skipRelease).toBeUndefined();
      expect(empty.skipPr).toBeUndefined();
      expect(empty.dryRun).toBeUndefined();
    });
  });

  it('splits only on commas and accumulates repeats', () => {
    withEnv({ GITHUB_API_URL: undefined }, () => {
      expect(buildOptions(flagResult([])).only).toBeUndefined();
      expect(buildOptions(flagResult(['--only', 'determine'])).only).toEqual(['determine']);
      expect(buildOptions(flagResult(['--only', 'determine,release'])).only).toEqual(['determine', 'release']);
      expect(buildOptions(flagResult(['--only', 'determine', '--only', 'pr'])).only).toEqual(['determine', 'pr']);
      expect(buildOptions(flagResult(['--only=determine, pr'])).only).toEqual(['determine', 'pr']);
    });
  });

  it('falls back to GITHUB_API_URL when the flag is absent', () => {
    withEnv({ GITHUB_API_URL: 'https://ghe.example.com/api/v3' }, () => {
      expect(buildOptions(flagResult([])).githubApiUrl).toBe('https://ghe.example.com/api/v3');
      expect(buildOptions(flagResult(['--github-api-url', 'https://api.github.com'])).githubApiUrl).toBe(
        'https://api.github.com',
      );
    });
    withEnv({ GITHUB_API_URL: undefined }, () => {
      expect(buildOptions(flagResult([])).githubApiUrl).toBeUndefined();
    });
    withEnv({ GITHUB_API_URL: '' }, () => {
      expect(buildOptions(flagResult([])).githubApiUrl).toBeUndefined();
    });
  });
});

describe('release-tag cli help and strict parsing', () => {
  it('prints help and exits 0', () => {
    const help = runCli(['--help'], { GITHUB_TOKEN: undefined });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('repo-toolkit-release-tag');
    expect(help.stdout).toContain('determine');
    expect(help.stdout).toContain('release');
    expect(help.stdout).toContain('--only');
    expect(help.stdout).toContain('GITHUB_TOKEN');
    expect(help.stdout).toContain('GITHUB_REPOSITORY');
    expect(help.stdout).toContain('GITHUB_REF_NAME');
    expect(help.stdout).toContain('GITHUB_API_URL');
    expect(help.stdout).toContain('--github-token-file');
    expect(help.stdout).toContain('--release-it-path');
    const short = runCli(['-h'], { GITHUB_TOKEN: undefined });
    expect(short.status).toBe(0);
    expect(short.stdout).toContain('Usage:');
  });

  it('rejects unknown args with exit 1', () => {
    const result = runCli(['--bogus-flag'], { GITHUB_TOKEN: undefined });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown argument');
  });

  it('rejects missing values with exit 1', () => {
    const result = runCli(['--tag'], { GITHUB_TOKEN: undefined });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Missing value');
  });

  it('rejects invalid only stages with exit 1', () => {
    const result = runCli(['--only', 'bogus', '--dry-run'], { GITHUB_TOKEN: undefined });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('only');
  });
});

describe('release-tag cli dry run', () => {
  it('performs zero runner and fetch invocations via buildOptions plus runReleaseTag', async () => {
    const savedApi = process.env.GITHUB_API_URL;
    const savedToken = process.env.GITHUB_TOKEN;
    const savedRepo = process.env.GITHUB_REPOSITORY;
    const savedRef = process.env.GITHUB_REF_NAME;
    delete process.env.GITHUB_API_URL;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_REF_NAME;
    try {
      const options = buildOptions(flagResult(['--tag', '1.2.3', '--dry-run']));
      const runner = makeRunner([]);
      let fetchCalls = 0;
      const fetchFn = (async () => {
        fetchCalls += 1;
        throw new Error('fetch must not be called');
      }) as unknown as typeof fetch;
      const outcome = await runReleaseTag({ ...options, runner, fetchFn });
      expect(outcome.plan.dryRun).toBe(true);
      expect(outcome.determined).toBeNull();
      expect(outcome.release).toBeNull();
      expect(outcome.pullRequest).toBeNull();
      expect(runner.captures).toHaveLength(0);
      expect(fetchCalls).toBe(0);
    } finally {
      if (savedApi === undefined) {
        delete process.env.GITHUB_API_URL;
      } else {
        process.env.GITHUB_API_URL = savedApi;
      }
      if (savedToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = savedToken;
      }
      if (savedRepo === undefined) {
        delete process.env.GITHUB_REPOSITORY;
      } else {
        process.env.GITHUB_REPOSITORY = savedRepo;
      }
      if (savedRef === undefined) {
        delete process.env.GITHUB_REF_NAME;
      } else {
        process.env.GITHUB_REF_NAME = savedRef;
      }
    }
  });

  it('spawned dry-run exits 0 with a plan summary and no secrets', () => {
    const result = runCli(['--tag', '1.2.3', '--base-branch', 'main', '--dry-run'], {
      GITHUB_TOKEN: undefined,
      GITHUB_REPOSITORY: undefined,
      GITHUB_REF_NAME: undefined,
      GITHUB_API_URL: undefined,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('dry-run');
    expect(result.stdout).toContain('determined: null');
    expect(result.stdout).not.toContain(TOKEN_CANARY);
  });

  it('spawned dry-run json parses and contains no token canary', () => {
    const result = runCli(
      ['--tag', '1.2.3', '--base-branch', 'main', '--dry-run', '--json', '--github-token', TOKEN_CANARY],
      { GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined, GITHUB_API_URL: undefined },
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.determined).toBeNull();
    expect(result.stdout).not.toContain(TOKEN_CANARY);
    expect(result.stderr).toContain('prefer --github-token-file');
  });

  it('warns when github-token is passed via argv', () => {
    const result = runCli(['--tag', '1.2.3', '--dry-run', '--github-token', 'inline-value'], {
      GITHUB_TOKEN: undefined,
      GITHUB_REPOSITORY: undefined,
      GITHUB_REF_NAME: undefined,
      GITHUB_API_URL: undefined,
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('prefer --github-token-file');
  });
});

describe('release-tag cli stage selection', () => {
  it('runs only determine when requested', async () => {
    const savedToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      const options = buildOptions(flagResult(['--tag', '1.2.3', '--only', 'determine']));
      const runner = makeRunner([]);
      const { calls, fetchFn } = makeFetch();
      const outcome = await runReleaseTag({ ...options, cwd: '/fake/workdir', runner, fetchFn });
      expect(outcome.determined?.version).toBe('1.2.3');
      expect(outcome.release).toBeNull();
      expect(outcome.pullRequest).toBeNull();
      expect(calls).toHaveLength(0);
    } finally {
      if (savedToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = savedToken;
      }
    }
  });

  it('yields skipped results for skip-release and skip-pr', async () => {
    const savedToken = process.env.GITHUB_TOKEN;
    const savedRepo = process.env.GITHUB_REPOSITORY;
    const savedRef = process.env.GITHUB_REF_NAME;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_REF_NAME;
    try {
      const options = buildOptions(
        flagResult([
          '--tag',
          '1.2.3',
          '--base-branch',
          'main',
          '--skip-release',
          '--skip-pr',
          '--github-repository',
          'octo/hello',
        ]),
      );
      const runner = makeRunner([ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok('')]);
      const { calls, fetchFn } = makeFetch();
      const outcome = await runReleaseTag({ ...options, cwd: '/fake/workdir', runner, fetchFn });
      expect(outcome.release?.skippedReason).toBe('skipped via skipRelease');
      expect(outcome.pullRequest?.skipped).toBe(true);
      expect(outcome.pullRequest?.skippedReason).toBe('skipped via skipPr');
      expect(calls).toHaveLength(0);
    } finally {
      if (savedToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = savedToken;
      }
      if (savedRepo === undefined) {
        delete process.env.GITHUB_REPOSITORY;
      } else {
        process.env.GITHUB_REPOSITORY = savedRepo;
      }
      if (savedRef === undefined) {
        delete process.env.GITHUB_REF_NAME;
      } else {
        process.env.GITHUB_REF_NAME = savedRef;
      }
    }
  });
});

describe('release-tag cli output formatting', () => {
  it('formats json without token bytes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'release-tag-cli-'));
    try {
      const savedToken = process.env.GITHUB_TOKEN;
      const savedRepo = process.env.GITHUB_REPOSITORY;
      const savedRef = process.env.GITHUB_REF_NAME;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_REPOSITORY;
      delete process.env.GITHUB_REF_NAME;
      try {
        const runner = makeRunner([ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok('notes')]);
        const { fetchFn } = makeFetch();
        const outcome = await runReleaseTag({
          cwd: dir,
          tag: '1.2.3',
          baseBranch: 'main',
          skipRelease: true,
          skipPr: true,
          githubToken: TOKEN_CANARY,
          githubRepository: 'octo/hello',
          runner,
          fetchFn,
        });
        const text = formatJsonResult(outcome);
        const parsed = JSON.parse(text) as Record<string, unknown>;
        expect(parsed.schemaVersion).toBe(1);
        expect(text).not.toContain(TOKEN_CANARY);
        const summary = planSummary(outcome.plan);
        expect('githubToken' in summary).toBe(false);
        expect(JSON.stringify(summary)).not.toContain(TOKEN_CANARY);
        expect(formatJsonDryRun(outcome.plan)).not.toContain(TOKEN_CANARY);
      } finally {
        if (savedToken === undefined) {
          delete process.env.GITHUB_TOKEN;
        } else {
          process.env.GITHUB_TOKEN = savedToken;
        }
        if (savedRepo === undefined) {
          delete process.env.GITHUB_REPOSITORY;
        } else {
          process.env.GITHUB_REPOSITORY = savedRepo;
        }
        if (savedRef === undefined) {
          delete process.env.GITHUB_REF_NAME;
        } else {
          process.env.GITHUB_REF_NAME = savedRef;
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('formats text with versions branches urls and skip reasons', async () => {
    const savedToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      const runner = makeRunner([ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok(''), ok('')]);
      const { fetchFn } = makeFetch();
      const full = await runReleaseTag({
        cwd: '/fake/workdir',
        tag: '1.2.3',
        baseBranch: 'main',
        skipRelease: true,
        skipPr: true,
        githubRepository: 'octo/hello',
        runner,
        fetchFn,
      });
      const text = formatTextResult(full);
      expect(text).toContain('1.2.3');
      expect(text).toContain('v1.2.3');
      expect(text).toContain('changelog/1.2.3');
      expect(text).toContain('skipped via skipRelease');
      expect(text).toContain('skipped via skipPr');
      const onlyDetermine = await runReleaseTag({
        cwd: '/fake/workdir',
        tag: '1.2.3',
        only: ['determine'],
        runner: makeRunner([]),
        fetchFn,
      });
      const partial = formatTextResult(onlyDetermine);
      expect(partial).toContain('not selected');
      expect(formatTextDryRun(full.plan)).toContain('dry-run');
      expect(formatTextDryRun(full.plan)).not.toContain(TOKEN_CANARY);
      expect(formatTextDryRun(full.plan)).not.toContain(ENV_TOKEN);
    } finally {
      if (savedToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = savedToken;
      }
    }
  });
});
