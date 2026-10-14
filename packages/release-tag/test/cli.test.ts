import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseFlags } from '@repo-toolkit/publish-package';
import type { CapturingProcessRunner, ProcessCaptureResult } from '@repo-toolkit/publish-package';

import { SPECS, buildOptions, collectCliSecrets, parseCliOptions } from '../src/cli-options';
import {
  RELEASE_TAG_CLI_SCHEMA_VERSION,
  formatJsonDryRun,
  formatJsonResult,
  formatTextDryRun,
  formatTextResult,
  planSummary,
} from '../src/format';
import { resolveReleaseTagPlan, runReleaseTag } from '../src/index';
import { createReleaseRunner } from './release-fixture';
import { snapshotGitFixture, withGitFixture } from './git-fixture';
import { pullRequestData, pullRequestListData, successfulGitHubResponse } from './http-fixture';
import { RECOVERY_BRANCH, RECOVERY_TAG, seedRecovery } from './recovery-fixture';
import { FILE_TOKEN } from './security-fixture';

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
    timeout: 15000,
    killSignal: 'SIGKILL',
    maxBuffer: 2 * 1024 * 1024,
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
  const fetchFn: typeof fetch = async (url, init) => {
    calls.push({ url: String(url) });
    return successfulGitHubResponse(url, init, { number: 1 });
  };
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
        flagResult([
          '--auto-merge-pr',
          '--delete-merged-branch',
          '--skip-release',
          '--skip-pr',
          '--skip-preflight',
          '--dry-run',
        ]),
      );
      expect(options.autoMergePr).toBe(true);
      expect(options.deleteMergedBranch).toBe(true);
      expect(options.skipRelease).toBe(true);
      expect(options.skipPr).toBe(true);
      expect(options.skipPreflight).toBe(true);
      expect(options.dryRun).toBe(true);
      const empty = buildOptions(flagResult([]));
      expect(empty.autoMergePr).toBeUndefined();
      expect(empty.deleteMergedBranch).toBeUndefined();
      expect(empty.skipRelease).toBeUndefined();
      expect(empty.skipPr).toBeUndefined();
      expect(empty.skipPreflight).toBeUndefined();
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

  it('leaves the GITHUB_API_URL fallback to plan resolution', () => {
    withEnv({ GITHUB_API_URL: 'https://ghe.example.com/api/v3' }, () => {
      expect(buildOptions(flagResult([])).githubApiUrl).toBeUndefined();
      expect(resolveReleaseTagPlan(buildOptions(flagResult([]))).githubApiUrl).toBe('https://ghe.example.com/api/v3');
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

describe('release-tag cli recovery flags', () => {
  it('preserves raw release-arg values with commas and dash-leading equals form', () => {
    withEnv({ GITHUB_API_URL: undefined }, () => {
      expect(buildOptions(flagResult([])).releaseArgs).toBeUndefined();
      expect(
        buildOptions(flagResult(['--release-arg', 'a,b', '--release-arg=a,b', '--release-arg=--flag=value']))
          .releaseArgs,
      ).toEqual(['a,b', 'a,b', '--flag=value']);
      expect(buildOptions(flagResult(['--release-arg=--dry-run', '--release-arg=--ci'])).releaseArgs).toEqual([
        '--dry-run',
        '--ci',
      ]);
    });
  });

  it('rejects dash-leading release-arg via the space form as a missing value', () => {
    expect(() => flagResult(['--release-arg', '--flag'])).toThrow(/Missing value for --release-arg/);
    expect(() => flagResult(['--release-arg', '-x'])).toThrow(/Missing value for --release-arg/);
  });

  it('validates timeout-ms and max-output-bytes strictly', () => {
    withEnv({ GITHUB_API_URL: undefined }, () => {
      expect(buildOptions(flagResult(['--timeout-ms', '1'])).timeoutMs).toBe(1);
      expect(buildOptions(flagResult(['--timeout-ms=2147483647'])).timeoutMs).toBe(2147483647);
      expect(buildOptions(flagResult(['--max-output-bytes', '1048576'])).maxOutputBytes).toBe(1048576);
      expect(buildOptions(flagResult(['--max-output-bytes=9007199254740991'])).maxOutputBytes).toBe(9007199254740991);
      expect(buildOptions(flagResult([])).timeoutMs).toBeUndefined();
      expect(buildOptions(flagResult([])).maxOutputBytes).toBeUndefined();
    });
  });

  it.each([
    '',
    ' ',
    ' 123',
    '123 ',
    '0',
    '00',
    '01',
    '-1',
    '+1',
    '1.0',
    '1e3',
    '0x10',
    '2147483648',
    '9007199254740992',
  ])('rejects invalid timeout-ms %j', (value) => {
    expect(() => buildOptions(flagResult([`--timeout-ms=${value}`]))).toThrow(/--timeout-ms/);
  });

  it.each([
    '',
    ' ',
    '0',
    '00',
    '01',
    '-5',
    '1.5',
    '2e2',
    '0x20',
    ' 1048576',
    '9007199254740992',
    '9999999999999999999999',
  ])('rejects invalid max-output-bytes %j', (value) => {
    expect(() => buildOptions(flagResult([`--max-output-bytes=${value}`]))).toThrow(/--max-output-bytes/);
  });

  it('handles reset and allow-empty negation with last-writer wins', () => {
    withEnv({ GITHUB_API_URL: undefined }, () => {
      expect(buildOptions(flagResult([])).resetReleaseBranch).toBeUndefined();
      expect(buildOptions(flagResult([])).allowEmptyRelease).toBeUndefined();
      expect(buildOptions(flagResult(['--reset-release-branch'])).resetReleaseBranch).toBe(true);
      expect(buildOptions(flagResult(['--no-reset-release-branch'])).resetReleaseBranch).toBe(false);
      expect(buildOptions(flagResult(['--reset-release-branch', '--no-reset-release-branch'])).resetReleaseBranch).toBe(
        false,
      );
      expect(buildOptions(flagResult(['--allow-empty-release'])).allowEmptyRelease).toBe(true);
      expect(buildOptions(flagResult(['--no-allow-empty-release'])).allowEmptyRelease).toBe(false);
      expect(buildOptions(flagResult(['--no-allow-empty-release', '--allow-empty-release'])).allowEmptyRelease).toBe(
        true,
      );
    });
  });

  it('validates merge-method strictly', () => {
    withEnv({ GITHUB_API_URL: undefined }, () => {
      expect(buildOptions(flagResult([])).mergeMethod).toBeUndefined();
      expect(buildOptions(flagResult(['--merge-method', 'merge'])).mergeMethod).toBe('merge');
      expect(buildOptions(flagResult(['--merge-method=squash'])).mergeMethod).toBe('squash');
      expect(buildOptions(flagResult(['--merge-method', 'rebase'])).mergeMethod).toBe('rebase');
      for (const value of ['queue', 'MERGE', 'merge ', ' squash', '', 'null']) {
        expect(() => buildOptions(flagResult([`--merge-method=${value}`]))).toThrow(/mergeMethod/);
      }
    });
  });

  it('maps only pr recovery inputs without environment inference', () => {
    withEnv({ GITHUB_API_URL: undefined }, () => {
      const options = buildOptions(flagResult(['--only', 'pr', '--tag', '1.2.3', '--base-branch', 'main']));
      expect(options.only).toEqual(['pr']);
      expect(options.tag).toBe('1.2.3');
      expect(options.baseBranch).toBe('main');
    });
  });
});

describe('release-tag cli module boundaries', () => {
  it('imports helpers without executing CLI or changing process state', async () => {
    const exitBefore = process.exitCode;
    const optionsModule = await import('../src/cli-options');
    const formatModule = await import('../src/format');
    expect(optionsModule.SPECS.length).toBeGreaterThan(0);
    expect(typeof optionsModule.buildOptions).toBe('function');
    expect(typeof optionsModule.collectCliSecrets).toBe('function');
    expect(typeof optionsModule.parseCliOptions).toBe('function');
    expect(formatModule.RELEASE_TAG_CLI_SCHEMA_VERSION).toBe(1);
    expect(typeof formatModule.formatJsonResult).toBe('function');
    expect(process.exitCode).toBe(exitBefore);
  });

  it('collects every inline token value and custom-env values for parse-failure redaction', () => {
    const custom = 'recovery-cli-custom-token-9c4e';
    withEnv({ GITHUB_TOKEN: ENV_TOKEN, CUSTOM_RECOVERY_TOKEN: custom }, () => {
      expect(collectCliSecrets(['--github-token=first-canary', '--github-token', 'second-canary'])).toEqual([
        'cli-env-token-3b8e1c-do-not-leak',
        'first-canary',
        'second-canary',
      ]);
      expect(collectCliSecrets(['--github-token-env=CUSTOM_RECOVERY_TOKEN'])).toEqual([ENV_TOKEN, custom]);
      expect(collectCliSecrets(['--github-token-env', 'CUSTOM_RECOVERY_TOKEN'])).toEqual([ENV_TOKEN, custom]);
    });
    withEnv({ GITHUB_TOKEN: undefined, CUSTOM_RECOVERY_TOKEN: undefined }, () => {
      expect(collectCliSecrets(['--github-token-env=CUSTOM_RECOVERY_TOKEN'])).toEqual([]);
    });
  });

  it('redacts known tokens when option building itself fails', () => {
    withEnv({ GITHUB_TOKEN: undefined }, () => {
      try {
        parseCliOptions(['--github-token=parse-failure-canary', '--timeout-ms=not-a-number']);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('--timeout-ms');
        expect((error as Error).message).not.toContain('parse-failure-canary');
      }
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
    expect(help.stdout).toContain('--skip-preflight');
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
  it.each(['explicit', 'env'] as const)('sanitizes known %s credential echoes in dry-run output', (source) => {
    const token = source === 'explicit' ? TOKEN_CANARY : ENV_TOKEN;
    const result = runCli(
      [
        '--tag=1.2.3',
        '--base-branch=main',
        '--dry-run',
        '--json',
        `--git-user-name=bot ${token}`,
        `--release-command=./release-${token}`,
        ...(source === 'explicit' ? [`--github-token=${token}`] : []),
      ],
      {
        GITHUB_TOKEN: source === 'env' ? ENV_TOKEN : undefined,
        GITHUB_REPOSITORY: undefined,
        GITHUB_REF_NAME: undefined,
        GITHUB_API_URL: undefined,
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(token);
    expect(result.stderr).not.toContain(token);
    expect(JSON.parse(result.stdout).plan.gitUserName).toBe('bot [redacted]');
  });

  it('validates the shared GHES environment fallback in spawned CLI plans', () => {
    const base = 'https://ghe.example/prefix/api/v3';
    const valid = runCli(['--tag=1.2.3', '--base-branch=main', '--dry-run', '--json'], {
      GITHUB_TOKEN: undefined,
      GITHUB_API_URL: base,
    });
    expect(valid.status).toBe(0);
    expect(JSON.parse(valid.stdout).plan.githubApiUrl).toBe(base);
    const invalid = runCli(['--tag=1.2.3', '--base-branch=main', '--dry-run', '--json'], {
      GITHUB_TOKEN: undefined,
      GITHUB_API_URL: `${base}?route=unexpected`,
    });
    expect(invalid.status).toBe(1);
    expect(invalid.stdout).toBe('');
    expect(invalid.stderr).toContain('githubApiUrl');
  });

  it.each([
    ['--release-branch=--mirror', /releaseBranch/],
    ['--base-branch=-D', /baseBranch/],
    ['--release-branch=refs/heads/main', /releaseBranch/],
    ['--release-branch=main', /different from baseBranch/],
    ['--tag=9007199254740992.0.0', /safe integers/],
    ['--github-repository=../repo', /githubRepository/],
  ] as const)('rejects unsafe equals-form identity %s even in dry-run', (argument, message) => {
    const result = runCli(
      ['--cwd', tmpdir(), '--tag', 'v1.2.3', '--base-branch', 'main', argument, '--dry-run', '--json'],
      { GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined, GITHUB_API_URL: undefined },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(message);
  });

  it.each([
    { GITHUB_REF_NAME: '--mirror' },
    { GITHUB_REF_NAME: 'latest', GITHUB_REF_TYPE: 'tag' },
    { GITHUB_REF_NAME: 'latest', GITHUB_REF: 'refs/tags/latest' },
    { GITHUB_REPOSITORY: 'owner/..' },
  ])('rejects invalid environment identity %j in dry-run', (env) => {
    const result = runCli(['--cwd', tmpdir(), '--tag', 'v1.2.3', '--dry-run', '--json'], {
      GITHUB_TOKEN: undefined,
      GITHUB_REPOSITORY: undefined,
      GITHUB_REF_NAME: undefined,
      GITHUB_REF_TYPE: undefined,
      GITHUB_REF: undefined,
      GITHUB_API_URL: undefined,
      ...env,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/GITHUB_REF_NAME|tag checkout|GITHUB_REPOSITORY/);
  });

  it('preserves nested Unicode branch names in the dry-run JSON plan', () => {
    const baseBranch = 'développement/日本語';
    const releaseBranch = 'release/日本語/🚀';
    const result = runCli(
      [
        '--cwd',
        tmpdir(),
        '--tag=v1.2.3',
        `--base-branch=${baseBranch}`,
        `--release-branch=${releaseBranch}`,
        '--dry-run',
        '--json',
      ],
      { GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_API_URL: undefined },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).plan).toMatchObject({ tag: '1.2.3', baseBranch, releaseBranch });
  });

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

describe('release-tag cli spawned flag validation', () => {
  it('reflects valid limits, merge method, reset, allow-empty, and raw release args in dry-run JSON', () => {
    const result = runCli(
      [
        '--tag=1.2.3',
        '--base-branch=main',
        '--dry-run',
        '--json',
        '--timeout-ms=120000',
        '--max-output-bytes=2048',
        '--merge-method=squash',
        '--reset-release-branch',
        '--allow-empty-release',
        '--release-arg=a,b',
        '--release-arg=--flag=value',
        '--release-arg=--dry-run',
      ],
      { GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined, GITHUB_API_URL: undefined },
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { schemaVersion: number; plan: Record<string, unknown> };
    expect(parsed.schemaVersion).toBe(RELEASE_TAG_CLI_SCHEMA_VERSION);
    expect(parsed.plan).toMatchObject({
      timeoutMs: 120000,
      maxOutputBytes: 2048,
      mergeMethod: 'squash',
      resetReleaseBranch: true,
      allowEmptyRelease: true,
      releaseArgs: ['a,b', '--flag=value', '--dry-run'],
    });
    expect(result.stderr).toBe('');
  });

  it('reflects negated reset and allow-empty defaults in dry-run JSON', () => {
    const result = runCli(
      [
        '--tag=1.2.3',
        '--base-branch=main',
        '--dry-run',
        '--json',
        '--no-reset-release-branch',
        '--no-allow-empty-release',
      ],
      { GITHUB_TOKEN: undefined, GITHUB_REPOSITORY: undefined, GITHUB_REF_NAME: undefined, GITHUB_API_URL: undefined },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).plan).toMatchObject({ resetReleaseBranch: false, allowEmptyRelease: false });
  });

  it.each([
    '--timeout-ms=',
    '--timeout-ms= ',
    '--timeout-ms=0',
    '--timeout-ms=01',
    '--timeout-ms=-1',
    '--timeout-ms=1.0',
    '--timeout-ms=1e3',
    '--timeout-ms=2147483648',
    '--max-output-bytes=',
    '--max-output-bytes=0',
    '--max-output-bytes=01',
    '--max-output-bytes= 1048576',
    '--max-output-bytes=9007199254740992',
    '--merge-method=queue',
    '--merge-method=MERGE',
    '--merge-method=',
  ])('rejects invalid spawned flag %s with empty stdout', (flag) => {
    const result = runCli(['--tag=1.2.3', '--base-branch=main', '--dry-run', '--json', flag], {
      GITHUB_TOKEN: undefined,
      GITHUB_REPOSITORY: undefined,
      GITHUB_REF_NAME: undefined,
      GITHUB_API_URL: undefined,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/timeout-ms|max-output-bytes|mergeMethod/);
  });

  it('rejects dash-leading release-arg via the space form in a spawned CLI', () => {
    const result = runCli(['--tag=1.2.3', '--base-branch=main', '--dry-run', '--release-arg', '--flag'], {
      GITHUB_TOKEN: undefined,
      GITHUB_REPOSITORY: undefined,
      GITHUB_REF_NAME: undefined,
      GITHUB_API_URL: undefined,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Missing value for --release-arg');
  });

  it('redacts repeated inline and custom-env tokens when spawned parsing fails', () => {
    const first = 'spawn-first-token-aa11';
    const second = 'spawn-second-token-bb22';
    const custom = 'spawn-custom-token-cc33';
    const result = runCli(
      [`--github-token=${first}`, '--github-token', second, '--github-token-env=CUSTOM_SPAWN_TOKEN', '--bogus-flag'],
      { GITHUB_TOKEN: ENV_TOKEN, CUSTOM_SPAWN_TOKEN: custom },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown argument');
    for (const token of [first, second, ENV_TOKEN, custom]) {
      expect(result.stderr).not.toContain(token);
      expect(result.stdout).not.toContain(token);
    }
  });

  it('redacts custom-env tokens when spawned numeric validation fails', () => {
    const custom = 'spawn-numeric-custom-dd44';
    const result = runCli(['--tag=1.2.3', '--timeout-ms=bad', '--github-token-env=CUSTOM_SPAWN_TOKEN'], {
      GITHUB_TOKEN: undefined,
      CUSTOM_SPAWN_TOKEN: custom,
      GITHUB_REPOSITORY: undefined,
      GITHUB_REF_NAME: undefined,
      GITHUB_API_URL: undefined,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--timeout-ms');
    expect(result.stderr).not.toContain(custom);
  });

  it.each([true, false])('rejects invalid stage prefixes consistently with dryRun=%s', (dryRun) => {
    for (const only of [
      ['--only', 'release'],
      ['--only', 'determine,pr'],
      ['--only', 'release,pr'],
    ]) {
      const result = runCli(['--tag=1.2.3', '--base-branch=main', ...only, ...(dryRun ? ['--dry-run'] : [])], {
        GITHUB_TOKEN: undefined,
        GITHUB_REPOSITORY: 'octo/hello',
        GITHUB_REF_NAME: undefined,
        GITHUB_API_URL: undefined,
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/requires stage/);
    }
  });

  it.each([true, false])('rejects incomplete PR-only recovery inputs consistently with dryRun=%s', (dryRun) => {
    const missingBase = runCli(['--tag=1.2.3', '--only', 'pr', ...(dryRun ? ['--dry-run'] : [])], {
      GITHUB_TOKEN: undefined,
      GITHUB_REPOSITORY: 'octo/hello',
      GITHUB_REF_NAME: 'main',
      GITHUB_API_URL: undefined,
    });
    expect(missingBase.status).toBe(1);
    expect(missingBase.stdout).toBe('');
    expect(missingBase.stderr).toContain('PR-only recovery requires explicit tag and baseBranch');
    const missingTag = runCli(['--base-branch=main', '--only', 'pr', ...(dryRun ? ['--dry-run'] : [])], {
      GITHUB_TOKEN: undefined,
      GITHUB_REPOSITORY: 'octo/hello',
      GITHUB_REF_NAME: undefined,
      GITHUB_API_URL: undefined,
    });
    expect(missingTag.status).toBe(1);
    expect(missingTag.stdout).toBe('');
    expect(missingTag.stderr).toContain('PR-only recovery requires explicit tag and baseBranch');
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
      const runner = createReleaseRunner();
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
  it.each([0, 23])(
    'keeps active file/env credentials out of real child output and CLI results (exit %i)',
    async (exitCode) => {
      await withGitFixture(async (fixture) => {
        const tokenFile = join(fixture.root, 'token');
        const fetchHook = join(fixture.root, 'fake-fetch.mjs');
        await writeFile(tokenFile, FILE_TOKEN);
        await writeFile(
          fetchHook,
          `
import { execFileSync } from 'node:child_process';
globalThis.fetch = async (url, init) => {
  const token = ${JSON.stringify(FILE_TOKEN)};
  if (init.headers.Authorization !== 'Bearer ' + token) throw new Error('fixture expected file credential');
  if (init.redirect !== 'error') throw new Error('fixture expected redirects disabled');
  if (new URL(url).pathname.endsWith('/pulls') && init.method === 'GET') return new Response('[]');
  if (url.endsWith('/repos/octo/repo')) return new Response(JSON.stringify({ permissions: { push: true } }));
  if (url.endsWith('/pulls') && init.method === 'POST') {
    const body = JSON.parse(init.body);
    if (body.body.includes(token)) throw new Error('fixture received unsanitized description');
    const pull = ${JSON.stringify(pullRequestData({ repository: 'octo/repo', number: 7, url: `https://github.com/octo/repo/pull/7?token=${FILE_TOKEN}` }))};
    pull.head.sha = execFileSync('git', ['-C', ${JSON.stringify(fixture.cwd)}, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    return new Response(JSON.stringify(pull), { status: 201 });
  }
  return new Response('[]');
};
`,
        );
        const releaseCommand = await fixture.releaseCommand(`
process.stdout.write(${JSON.stringify(`stdout ${FILE_TOKEN} ${ENV_TOKEN}`)});
process.stderr.write(${JSON.stringify(`stderr ${FILE_TOKEN} ${ENV_TOKEN}`)});
git(['commit', '--quiet', '--allow-empty', '--no-gpg-sign', '-m', 'credential fixture release']);
git(['tag', '-a', tag, '-m', ${JSON.stringify(`notes ${FILE_TOKEN} ${ENV_TOKEN}`)}]);
process.exitCode = ${exitCode};
`);
        const result = runCli(
          [
            '--cwd',
            fixture.cwd,
            '--tag=1.2.3',
            '--base-branch=main',
            '--github-repository=octo/repo',
            '--github-token-file',
            tokenFile,
            '--release-command',
            releaseCommand,
            `--git-user-name=bot ${FILE_TOKEN}`,
            '--json',
          ],
          {
            NODE_OPTIONS: `--import=${pathToFileURL(fetchHook).href}`,
            GITHUB_TOKEN: ENV_TOKEN,
            GITHUB_API_URL: undefined,
            GITHUB_REPOSITORY: undefined,
            GITHUB_REF_NAME: undefined,
            GITHUB_REF_TYPE: undefined,
            GITHUB_REF: undefined,
            GIT_SSH_COMMAND: undefined,
            GIT_SSH: undefined,
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_CONFIG_NOSYSTEM: '1',
          },
        );
        for (const token of [FILE_TOKEN, ENV_TOKEN]) {
          expect(result.stdout).not.toContain(token);
          expect(result.stderr).not.toContain(token);
        }
        expect(fixture.git(['rev-parse', 'refs/heads/main']).trim()).toBe(fixture.sourceCommit);
        if (exitCode === 0) {
          expect(result.status).toBe(0);
          expect(result.stderr).toBe('');
          const json = JSON.parse(result.stdout);
          expect(json.release.tagMessage).toBe('notes [redacted] [redacted]');
          expect(json.plan.gitUserName).toBe('bot [redacted]');
          expect(json.pullRequest.url).toBe('https://github.com/octo/repo/pull/7?token=[redacted]');
          expect(json.pullRequest.reused).toBe(false);
        } else {
          expect(result.status).toBe(1);
          expect(result.stdout).toBe('');
          expect(result.stderr).toContain('exit code 23');
          expect(result.stderr).toContain('stdout: stdout [redacted] [redacted]');
          expect(result.stderr).toContain('stderr: stderr [redacted] [redacted]');
          expect(fixture.remoteGit(['rev-parse', 'refs/heads/changelog/1.2.3']).trim()).toBe(fixture.sourceCommit);
        }
      });
    },
  );

  it.each([0, 23])('isolates a noisy real release child from JSON stdout with exit code %i', async (exitCode) => {
    await withGitFixture(async (fixture) => {
      const releaseCommand = await fixture.releaseCommand(`
if (process.env.GIT_TERMINAL_PROMPT !== '0') throw new Error('Git terminal prompts were enabled');
process.stdout.write('NOISY-RELEASE-STDOUT-🌍\\n'.repeat(4000) + 'OUTPUT-END');
process.stderr.write('NOISY-RELEASE-STDERR-界\\n'.repeat(4000) + 'ERROR-END');
git(['commit', '--quiet', '--allow-empty', '--no-gpg-sign', '-m', 'noisy fixture release']);
git(['tag', '-a', tag, '-m', 'Noisy release notes']);
process.exitCode = ${exitCode};
`);
      const result = runCli(
        [
          '--cwd',
          fixture.cwd,
          '--tag=1.2.3',
          '--base-branch=main',
          '--release-command',
          releaseCommand,
          '--skip-pr',
          '--json',
        ],
        {
          GITHUB_TOKEN: undefined,
          GITHUB_REPOSITORY: undefined,
          GITHUB_REF_NAME: undefined,
          GITHUB_REF_TYPE: undefined,
          GITHUB_REF: undefined,
          GITHUB_API_URL: undefined,
          GIT_SSH_COMMAND: undefined,
          GIT_SSH: undefined,
          GIT_TERMINAL_PROMPT: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
        },
      );
      const head = fixture.git(['rev-parse', 'HEAD']).trim();
      const remoteHead = fixture.remoteGit(['rev-parse', 'refs/heads/changelog/1.2.3']).trim();
      expect(fixture.git(['rev-parse', 'refs/heads/main']).trim()).toBe(fixture.sourceCommit);
      if (exitCode === 0) {
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        const json = JSON.parse(result.stdout);
        expect(json.schemaVersion).toBe(1);
        expect(json.release).toMatchObject({ releaseRan: true, releasedHead: head, tagMessage: 'Noisy release notes' });
        expect(json.pullRequest.skipped).toBe(true);
        expect(remoteHead).toBe(head);
        expect(result.stdout).not.toContain('NOISY-RELEASE');
      } else {
        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('exit code 23');
        expect(result.stderr).toContain('OUTPUT-END');
        expect(result.stderr).toContain('ERROR-END');
        expect(Buffer.byteLength(result.stderr)).toBeLessThan(3000);
        expect(remoteHead).toBe(fixture.sourceCommit);
      }
    });
  });

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
        const runner = createReleaseRunner({ tagMessage: 'notes' });
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
        expect(summary.resetReleaseBranch).toBe(false);
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
      const runner = createReleaseRunner();
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

describe('release-tag cli no-change output', () => {
  it('emits pure JSON for a no-change run without network or Git mutation', async () => {
    await withGitFixture(async (fixture) => {
      fixture.git(['tag', '-a', 'v1.2.3', fixture.sourceCommit, '-m', 'Seed release']);
      const before = await snapshotGitFixture(fixture);
      const fetchHook = join(fixture.root, 'no-network.mjs');
      await writeFile(
        fetchHook,
        `globalThis.fetch = async () => { throw new Error('no-change must not contact GitHub'); };\n`,
      );
      const result = runCli(['--cwd', fixture.cwd, '--json'], {
        NODE_OPTIONS: `--import=${pathToFileURL(fetchHook).href}`,
        GITHUB_TOKEN: undefined,
        GITHUB_REPOSITORY: undefined,
        GITHUB_REF_NAME: undefined,
        GITHUB_REF_TYPE: undefined,
        GITHUB_REF: undefined,
        GITHUB_API_URL: undefined,
        GIT_SSH_COMMAND: undefined,
        GIT_SSH: undefined,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(parsed.schemaVersion).toBe(RELEASE_TAG_CLI_SCHEMA_VERSION);
      expect(parsed.determined).toMatchObject({ version: '1.2.3', tagVersion: 'v1.2.3', noChanges: true, bump: null });
      expect(parsed.release).toBeNull();
      expect(parsed.pullRequest).toBeNull();
      expect(await snapshotGitFixture(fixture)).toEqual(before);
    });
  });

  it('reports skipped no-change stages in text without network', async () => {
    await withGitFixture(async (fixture) => {
      fixture.git(['tag', '-a', 'v1.2.3', fixture.sourceCommit, '-m', 'Seed release']);
      const fetchHook = join(fixture.root, 'no-network.mjs');
      await writeFile(
        fetchHook,
        `globalThis.fetch = async () => { throw new Error('no-change must not contact GitHub'); };\n`,
      );
      const result = runCli(['--cwd', fixture.cwd], {
        NODE_OPTIONS: `--import=${pathToFileURL(fetchHook).href}`,
        GITHUB_TOKEN: undefined,
        GITHUB_REPOSITORY: undefined,
        GITHUB_REF_NAME: undefined,
        GITHUB_REF_TYPE: undefined,
        GITHUB_REF: undefined,
        GITHUB_API_URL: undefined,
        GIT_SSH_COMMAND: undefined,
        GIT_SSH: undefined,
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('noChanges true');
      expect(result.stdout).toContain('release: skipped (no changes)');
      expect(result.stdout).toContain('pullRequest: skipped (no changes)');
    });
  });
});

describe('release-tag cli full release with new flags', () => {
  it('passes raw release args through a real release and reflects limits in JSON', async () => {
    await withGitFixture(async (fixture) => {
      const argsFile = join(fixture.root, 'release-args.json');
      const releaseCommand = await fixture.releaseCommand(`
writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
git(['commit', '--quiet', '--allow-empty', '--no-gpg-sign', '-m', 'flag fixture release']);
git(['tag', '-a', tag, '-m', 'Flag release notes']);
`);
      const result = runCli(
        [
          '--cwd',
          fixture.cwd,
          '--tag=1.2.3',
          '--base-branch=main',
          '--github-repository=octo/hello',
          '--release-command',
          releaseCommand,
          '--skip-pr',
          '--json',
          '--timeout-ms=120000',
          '--max-output-bytes=2097152',
          '--release-arg=a,b',
          '--release-arg=--flag=value',
          '--release-arg=--dry-run',
        ],
        {
          GITHUB_TOKEN: undefined,
          GITHUB_REPOSITORY: undefined,
          GITHUB_REF_NAME: undefined,
          GITHUB_REF_TYPE: undefined,
          GITHUB_REF: undefined,
          GITHUB_API_URL: undefined,
          GIT_SSH_COMMAND: undefined,
          GIT_SSH: undefined,
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
        },
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      const parsed = JSON.parse(result.stdout) as { plan: Record<string, unknown>; release: Record<string, unknown> };
      expect(parsed.plan).toMatchObject({
        timeoutMs: 120000,
        maxOutputBytes: 2097152,
        releaseArgs: ['a,b', '--flag=value', '--dry-run'],
      });
      expect(parsed.release).toMatchObject({ releaseRan: true, tagMessage: 'Flag release notes' });
      expect(JSON.parse(await readFile(argsFile, 'utf8'))).toEqual([
        '1.2.3',
        '--ci',
        'a,b',
        '--flag=value',
        '--dry-run',
      ]);
      expect(fixture.git(['rev-parse', 'refs/heads/main']).trim()).toBe(fixture.sourceCommit);
    });
  });
});

describe('release-tag cli PR-only recovery', () => {
  async function writeReuseHook(fixtureRoot: string, sha: string, merged: boolean): Promise<string> {
    const list = pullRequestListData({ sha, merged });
    const detail = pullRequestData({ sha, merged });
    const hook = join(fixtureRoot, 'reuse-fetch.mjs');
    await writeFile(
      hook,
      `globalThis.fetch = async (url, init) => {
  const method = init?.method ?? 'GET';
  const path = new URL(String(url)).pathname;
  if (method === 'GET' && path.endsWith('/repos/octo/hello')) return new Response(JSON.stringify({ permissions: { push: true } }));
  if (method === 'GET' && path.endsWith('/pulls')) return new Response(${JSON.stringify(JSON.stringify([list]))});
  if ((method === 'GET' || method === 'PATCH') && path.endsWith('/pulls/42')) return new Response(${JSON.stringify(JSON.stringify(detail))});
  if (method === 'POST' && path.endsWith('/labels')) return new Response('[]');
  throw new Error('unexpected recovery request ' + method + ' ' + path);
};\n`,
    );
    return hook;
  }

  it('recovers an existing PR read-only with pure JSON and no Git mutation', async () => {
    await withGitFixture(async (fixture) => {
      const sha = seedRecovery(fixture, { message: 'Spawned recovery notes' });
      fixture.git(['checkout', '--quiet', '--detach', fixture.sourceCommit]);
      await writeFile(join(fixture.cwd, 'untracked.txt'), 'preserve\n');
      const before = await snapshotGitFixture(fixture);
      const hook = await writeReuseHook(fixture.root, sha, false);
      const result = runCli(
        [
          '--cwd',
          fixture.cwd,
          '--only',
          'pr',
          '--tag=1.2.3',
          '--base-branch=main',
          '--github-repository=octo/hello',
          '--json',
          '--release-command',
          '/nonexistent-must-never-run',
        ],
        {
          NODE_OPTIONS: `--import=${pathToFileURL(hook).href}`,
          GITHUB_TOKEN: TOKEN_CANARY,
          GITHUB_REPOSITORY: undefined,
          GITHUB_REF_NAME: undefined,
          GITHUB_REF_TYPE: undefined,
          GITHUB_REF: undefined,
          GITHUB_API_URL: undefined,
          GIT_SSH_COMMAND: undefined,
          GIT_SSH: undefined,
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
        },
      );
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(parsed.schemaVersion).toBe(RELEASE_TAG_CLI_SCHEMA_VERSION);
      expect(parsed.determined).toBeNull();
      expect(parsed.release).toBeNull();
      expect(parsed.pullRequest).toMatchObject({ reused: true, merged: false, number: 42 });
      expect((parsed.plan as Record<string, unknown>).only).toEqual(['pr']);
      expect(result.stdout).not.toContain(TOKEN_CANARY);
      expect(result.stdout).not.toContain('untracked');
      expect(await snapshotGitFixture(fixture)).toEqual(before);
      expect(await readFile(join(fixture.cwd, 'untracked.txt'), 'utf8')).toBe('preserve\n');
    });
  });

  it('creates a missing PR for a remote-only branch without a local checkout', async () => {
    await withGitFixture(async (fixture) => {
      const sha = seedRecovery(fixture, { local: false });
      const list: Array<unknown> = [];
      const detail = pullRequestData({ sha });
      const hook = join(fixture.root, 'remote-only.mjs');
      await writeFile(
        hook,
        `globalThis.fetch = async (url, init) => {
  const method = init?.method ?? 'GET';
  const path = new URL(String(url)).pathname;
  if (method === 'GET' && path.endsWith('/repos/octo/hello')) return new Response(JSON.stringify({ permissions: { push: true } }));
  if (method === 'GET' && path.endsWith('/pulls')) return new Response(${JSON.stringify(JSON.stringify(list))});
  if (method === 'POST' && path.endsWith('/pulls')) {
    const body = JSON.parse(init.body);
    if (body.head !== ${JSON.stringify(RECOVERY_BRANCH)} || body.base !== 'main') throw new Error('unexpected PR identity');
    return new Response(${JSON.stringify(JSON.stringify(detail))}, { status: 201 });
  }
  if (method === 'POST' && path.endsWith('/labels')) return new Response('[]');
  if ((method === 'GET' || method === 'PATCH') && path.endsWith('/pulls/42')) return new Response(${JSON.stringify(JSON.stringify(detail))});
  throw new Error('unexpected remote-only request ' + method + ' ' + path);
};\n`,
      );
      const before = await snapshotGitFixture(fixture);
      const result = runCli(
        [
          '--cwd',
          fixture.cwd,
          '--only',
          'pr',
          '--tag',
          RECOVERY_TAG,
          '--base-branch',
          'main',
          '--github-repository=octo/hello',
          '--json',
        ],
        {
          NODE_OPTIONS: `--import=${pathToFileURL(hook).href}`,
          GITHUB_TOKEN: TOKEN_CANARY,
          GITHUB_REPOSITORY: undefined,
          GITHUB_REF_NAME: undefined,
          GITHUB_REF_TYPE: undefined,
          GITHUB_REF: undefined,
          GITHUB_API_URL: undefined,
          GIT_SSH_COMMAND: undefined,
          GIT_SSH: undefined,
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
        },
      );
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(parsed.pullRequest).toMatchObject({ reused: false, merged: false, number: 42 });
      expect(await snapshotGitFixture(fixture)).toEqual(before);
      expect(fixture.git(['for-each-ref', '--format=%(refname)', `refs/heads/${RECOVERY_BRANCH}`]).trim()).toBe('');
    });
  });

  it('confirms an already-merged PR when the origin branch is gone without rebuilding refs', async () => {
    await withGitFixture(async (fixture) => {
      const sha = seedRecovery(fixture, { remote: false, local: false });
      const list = pullRequestListData({ sha, merged: true });
      const detail = pullRequestData({ sha, merged: true });
      const hook = join(fixture.root, 'merged-gone.mjs');
      await writeFile(
        hook,
        `globalThis.fetch = async (url, init) => {
  const method = init?.method ?? 'GET';
  const path = new URL(String(url)).pathname;
  if (method === 'GET' && path.endsWith('/repos/octo/hello')) return new Response(JSON.stringify({ permissions: { push: true } }));
  if (method === 'GET' && path.endsWith('/pulls')) return new Response(${JSON.stringify(JSON.stringify([list]))});
  if (method === 'GET' && path.endsWith('/pulls/42')) return new Response(${JSON.stringify(JSON.stringify(detail))});
  if (method === 'POST' && path.endsWith('/labels')) return new Response('[]');
  if (method === 'GET' && path.includes('/git/ref/heads/')) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
  throw new Error('unexpected merged-gone request ' + method + ' ' + path);
};\n`,
      );
      const before = await snapshotGitFixture(fixture);
      const result = runCli(
        [
          '--cwd',
          fixture.cwd,
          '--only',
          'pr',
          '--tag=1.2.3',
          '--base-branch=main',
          '--github-repository=octo/hello',
          '--json',
          '--auto-merge-pr',
          '--delete-merged-branch',
        ],
        {
          NODE_OPTIONS: `--import=${pathToFileURL(hook).href}`,
          GITHUB_TOKEN: TOKEN_CANARY,
          GITHUB_REPOSITORY: undefined,
          GITHUB_REF_NAME: undefined,
          GITHUB_REF_TYPE: undefined,
          GITHUB_REF: undefined,
          GITHUB_API_URL: undefined,
          GIT_SSH_COMMAND: undefined,
          GIT_SSH: undefined,
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
        },
      );
      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      expect(parsed.pullRequest).toMatchObject({ reused: true, merged: true, branchDeleted: true });
      expect(await snapshotGitFixture(fixture)).toEqual(before);
      expect(fixture.git(['for-each-ref', '--format=%(refname)', `refs/heads/${RECOVERY_BRANCH}`]).trim()).toBe('');
    });
  });

  it.each(['missing tag', 'local mismatch', 'remote mismatch'] as const)(
    'rejects spawned recovery with %s before HTTP or Git mutation',
    async (failure) => {
      await withGitFixture(async (fixture) => {
        seedRecovery(fixture);
        if (failure === 'missing tag') {
          fixture.git(['tag', '-d', RECOVERY_TAG]);
        } else if (failure === 'local mismatch') {
          fixture.git(['update-ref', `refs/heads/${RECOVERY_BRANCH}`, fixture.sourceCommit]);
        } else {
          fixture.remoteGit(['update-ref', `refs/heads/${RECOVERY_BRANCH}`, fixture.sourceCommit]);
        }
        const before = await snapshotGitFixture(fixture);
        const hook = join(fixture.root, 'no-http.mjs');
        await writeFile(
          hook,
          `globalThis.fetch = async () => { throw new Error('recovery mismatch must not use HTTP'); };\n`,
        );
        const result = runCli(
          [
            '--cwd',
            fixture.cwd,
            '--only',
            'pr',
            '--tag=1.2.3',
            '--base-branch=main',
            '--github-repository=octo/hello',
            '--json',
          ],
          {
            NODE_OPTIONS: `--import=${pathToFileURL(hook).href}`,
            GITHUB_TOKEN: TOKEN_CANARY,
            GITHUB_REPOSITORY: undefined,
            GITHUB_REF_NAME: undefined,
            GITHUB_REF_TYPE: undefined,
            GITHUB_REF: undefined,
            GITHUB_API_URL: undefined,
            GIT_SSH_COMMAND: undefined,
            GIT_SSH: undefined,
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_CONFIG_NOSYSTEM: '1',
          },
        );
        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toMatch(/target tag|does not match/);
        expect(result.stderr).not.toContain(TOKEN_CANARY);
        expect(await snapshotGitFixture(fixture)).toEqual(before);
      });
    },
  );
});
