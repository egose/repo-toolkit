import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { parseFlags } from '@repo-toolkit/publish-package';

import { SPECS, buildOptions, optionsFromEnv, resolveConfluenceOptions, resolveSecretFile } from '../src/cli';
import type { ConfluenceSyncOptions } from '../src/index';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI_PATH = join(REPO_ROOT, 'dist', 'cli.js');

const PRESERVED_ENV_KEYS = [
  'CONFLUENCE_FOLDER',
  'CONFLUENCE_USERNAME',
  'CONFLUENCE_API_TOKEN',
  'CONFLUENCE_API_TOKEN_FILE',
  'CONFLUENCE_BASE_URL',
  'CONFLUENCE_SPACE_KEY',
  'CONFLUENCE_PARENT_PAGE_ID',
  'CONFLUENCE_VERSION_MESSAGE',
  'CONFLUENCE_REPOSITORY_URL',
  'CONFLUENCE_PAGE_TITLE_STRATEGY',
  'CONFLUENCE_DRY_RUN',
  'CONFLUENCE_SKIP_UNCHANGED',
  'CONFLUENCE_RENDER_HTML_BLOCKS',
  'INPUT_FOLDER',
  'INPUT_USERNAME',
  'INPUT_API-TOKEN',
  'INPUT_PASSWORD',
  'INPUT_API-TOKEN-FILE',
  'INPUT_PASSWORD-FILE',
  'INPUT_CONFLUENCE-BASE-URL',
  'INPUT_SPACE-KEY',
  'INPUT_PARENT-PAGE-ID',
  'INPUT_VERSION-MESSAGE',
  'INPUT_REPOSITORY-URL',
  'INPUT_PAGE-TITLE-STRATEGY',
  'INPUT_DRY-RUN',
  'INPUT_SKIP-UNCHANGED',
  'INPUT_RENDER-HTML-BLOCKS',
  'GITHUB_SERVER_URL',
  'GITHUB_REPOSITORY',
];

function snapshotEnv(): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of PRESERVED_ENV_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of PRESERVED_ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

function clearConfluenceEnv(): void {
  for (const key of PRESERVED_ENV_KEYS) {
    delete process.env[key];
  }
}

function flagResult(argv: string[]): ReturnType<typeof parseFlags> {
  const result = parseFlags(argv, SPECS);
  if (!result) {
    throw new Error('unexpected help result');
  }
  return result;
}

function runCli(
  argv: string[],
  env: Record<string, string> = {},
): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('node', [CLI_PATH, ...argv], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolvePromise({ code, stdout, stderr });
    });
  });
}

async function makeDocTree(): Promise<string> {
  const tmp = await mkdtemp(join(tmpdir(), 'cf-cli-'));
  await mkdir(join(tmp, 'docs', 'sub'), { recursive: true });
  await writeFile(join(tmp, 'docs', 'index.md'), '# Index\n');
  await writeFile(join(tmp, 'docs', 'sub', 'page.md'), '# Sub Page\n');
  return tmp;
}

describe('confluence cli options precedence', () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
    clearConfluenceEnv();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it('CLI flag overrides config and environment per option', async () => {
    process.env.CONFLUENCE_FOLDER = 'env-folder';
    process.env.CONFLUENCE_USERNAME = 'env-user';

    const configPath = await writeConfig({
      folder: 'config-folder',
      username: 'config-user',
      baseUrl: 'http://from-config/wiki',
    });

    const result = flagResult(['--folder', 'cli-folder', '--config', configPath]);
    const merged = await resolveConfluenceOptions({ result });

    expect(merged.folder).toBe('cli-folder');
    expect(merged.username).toBe('config-user');
    expect(merged.baseUrl).toBe('http://from-config/wiki');
  });

  it('config overrides environment when no CLI flag is supplied for that option', async () => {
    process.env.CONFLUENCE_SPACE_KEY = 'ENV';
    process.env.CONFLUENCE_DRY_RUN = 'true';

    const configPath = await writeConfig({ spaceKey: 'CFG' });

    const result = flagResult(['--config', configPath]);
    const merged = await resolveConfluenceOptions({ result });

    expect(merged.spaceKey).toBe('CFG');
    expect(merged.dryRun).toBe(true);
  });

  it('environment fills gaps left by CLI and config without disabling each other', async () => {
    process.env.CONFLUENCE_USERNAME = 'env-user';
    process.env.CONFLUENCE_PARENT_PAGE_ID = '999';

    const configPath = await writeConfig({ baseUrl: 'http://from-config/wiki', spaceKey: 'CFG' });

    const result = flagResult(['--config', configPath, '--folder', 'cli-folder']);
    const merged = await resolveConfluenceOptions({ result });

    expect(merged.folder).toBe('cli-folder');
    expect(merged.baseUrl).toBe('http://from-config/wiki');
    expect(merged.spaceKey).toBe('CFG');
    expect(merged.username).toBe('env-user');
    expect(merged.parentPageId).toBe('999');
  });

  it('resolves repositoryUrl from CLI, config, explicit env, and GitHub Actions env', async () => {
    process.env.CONFLUENCE_REPOSITORY_URL = 'https://example.com/env/repo';
    process.env.GITHUB_REPOSITORY = 'owner/action-repo';

    const fromEnv = optionsFromEnv();
    expect(fromEnv.repositoryUrl).toBe('https://example.com/env/repo');

    delete process.env.CONFLUENCE_REPOSITORY_URL;
    expect(optionsFromEnv().repositoryUrl).toBe('https://github.com/owner/action-repo');

    process.env.CONFLUENCE_REPOSITORY_URL = 'https://example.com/env/repo';
    const configPath = await writeConfig({ repositoryUrl: 'https://example.com/config/repo' });
    const result = flagResult(['--config', configPath, '--repository-url', 'https://example.com/cli/repo']);
    const merged = await resolveConfluenceOptions({ result });
    expect(merged.repositoryUrl).toBe('https://example.com/cli/repo');
  });

  it('CONFLUENCE_* env vars take precedence over INPUT_* env vars', () => {
    process.env.INPUT_USERNAME = 'action-user';
    process.env['INPUT_SPACE-KEY'] = 'ACTION_KEY';
    process.env.CONFLUENCE_USERNAME = 'cli-env-user';
    process.env['INPUT_API-TOKEN'] = '_OLD';
    process.env['INPUT_CONFLUENCE-BASE-URL'] = 'http://action/wiki';

    const fromEnv = optionsFromEnv();

    expect(fromEnv.username).toBe('cli-env-user');
    expect(fromEnv.spaceKey).toBe('ACTION_KEY');
    expect(fromEnv.apiToken).toBe('_OLD');
    expect(fromEnv.baseUrl).toBe('http://action/wiki');
  });

  it('argv secrets do not disable environment resolution', async () => {
    process.env.CONFLUENCE_USERNAME = 'env-user';
    process.env.CONFLUENCE_BASE_URL = 'http://env/wiki';

    const result = flagResult(['--folder', 'cli-folder', '--api-token', 'cli-secret']);
    const merged = await resolveConfluenceOptions({ result });

    expect(merged.folder).toBe('cli-folder');
    expect(merged.username).toBe('env-user');
    expect(merged.baseUrl).toBe('http://env/wiki');
    expect(merged.apiToken).toBe('cli-secret');
  });
});

describe('confluence cli boolean environment forms', () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
    clearConfluenceEnv();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it('accepts true|1|yes|on as truthy for every boolean option', () => {
    const cases: Array<[string, string]> = [
      ['CONFLUENCE_DRY_RUN', 'true'],
      ['CONFLUENCE_DRY_RUN', '1'],
      ['CONFLUENCE_DRY_RUN', 'yes'],
      ['CONFLUENCE_DRY_RUN', 'on'],
    ];
    for (const [key, value] of cases) {
      process.env[key] = value;
      const fromEnv = optionsFromEnv();
      expect(fromEnv.dryRun).toBe(true);
      delete process.env[key];
    }
  });

  it('accepts false|0|no|off|empty as falsy for every boolean option', () => {
    const cases: Array<[string, string]> = [
      ['CONFLUENCE_DRY_RUN', 'false'],
      ['CONFLUENCE_DRY_RUN', '0'],
      ['CONFLUENCE_DRY_RUN', 'no'],
      ['CONFLUENCE_DRY_RUN', 'off'],
      ['CONFLUENCE_DRY_RUN', ''],
    ];
    for (const [key, value] of cases) {
      process.env[key] = value;
      const fromEnv = optionsFromEnv();
      expect(fromEnv.dryRun).toBe(false);
      delete process.env[key];
    }
  });

  it('rejects invalid boolean values with a clear error naming the env var', () => {
    process.env.CONFLUENCE_DRY_RUN = 'maybe';
    expect(() => optionsFromEnv()).toThrow(/CONFLUENCE_DRY_RUN.*maybe/);
  });

  it('parses skip-unchanged and render-html-blocks env booleans', () => {
    process.env.CONFLUENCE_SKIP_UNCHANGED = 'false';
    process.env.CONFLUENCE_RENDER_HTML_BLOCKS = 'true';
    const fromEnv = optionsFromEnv();
    expect(fromEnv.skipUnchanged).toBe(false);
    expect(fromEnv.renderHtmlBlocks).toBe(true);
  });

  it('honors --no-skip-unchanged negation', () => {
    const result = flagResult(['--no-skip-unchanged']);
    const options = buildOptions(result);
    expect(options.skipUnchanged).toBe(false);
  });
});

describe('confluence cli secret-file token resolution', () => {
  let tempRoot: string;
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(async () => {
    envSnapshot = snapshotEnv();
    clearConfluenceEnv();
    tempRoot = await mkdtemp(join(tmpdir(), 'cf-secret-'));
  });

  afterEach(async () => {
    restoreEnv(envSnapshot);
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('reads apiToken from --api-token-file and strips trailing newline', async () => {
    const tokenFile = join(tempRoot, 'token.txt');
    await writeFile(tokenFile, 'SKT_abc\n');
    const opts: Partial<ConfluenceSyncOptions> = { apiTokenFile: tokenFile };
    await resolveSecretFile(opts, tempRoot);
    expect(opts.apiToken).toBe('SKT_abc');
  });

  it('trims surrounding whitespace and rejects an empty token file', async () => {
    const tokenFile = join(tempRoot, 'token.txt');
    await writeFile(tokenFile, '   \n');
    const opts: Partial<ConfluenceSyncOptions> = { apiTokenFile: tokenFile };
    await expect(resolveSecretFile(opts, tempRoot)).rejects.toThrow(/empty/);
  });

  it('resolves secret files relative to cwd when the path is not absolute', async () => {
    await mkdir(join(tempRoot, 'nested'), { recursive: true });
    const tokenFile = join(tempRoot, 'nested', 'token.txt');
    await writeFile(tokenFile, 'REL_TOKEN\r\n');
    const opts: Partial<ConfluenceSyncOptions> = { apiTokenFile: 'nested/token.txt' };
    await resolveSecretFile(opts, tempRoot);
    expect(opts.apiToken).toBe('REL_TOKEN');
  });

  it('explicit --api-token wins over --api-token-file when both are supplied', async () => {
    const tokenFile = join(tempRoot, 'token.txt');
    await writeFile(tokenFile, 'FROM_FILE\n');
    const opts: Partial<ConfluenceSyncOptions> = {
      apiToken: 'FROM_FLAG',
      apiTokenFile: tokenFile,
    };
    await resolveSecretFile(opts, tempRoot);
    expect(opts.apiToken).toBe('FROM_FLAG');
  });

  it('throws a clear error when apiTokenFile cannot be read', async () => {
    const opts: Partial<ConfluenceSyncOptions> = { apiTokenFile: join(tempRoot, 'missing.txt') };
    await expect(resolveSecretFile(opts, tempRoot)).rejects.toThrow(/Failed to read apiTokenFile/);
  });

  it('reads the token from CONFLUENCE_API_TOKEN_FILE when no apiToken is present', async () => {
    const tokenFile = join(tempRoot, 'env-token.txt');
    await writeFile(tokenFile, 'ENV_FILE_TOKEN\n');
    process.env.CONFLUENCE_API_TOKEN_FILE = tokenFile;
    const fromEnv = optionsFromEnv();
    expect(fromEnv.apiTokenFile).toBe(tokenFile);
    const opts: Partial<ConfluenceSyncOptions> = { ...fromEnv };
    await resolveSecretFile(opts, tempRoot);
    expect(opts.apiToken).toBe('ENV_FILE_TOKEN');
  });
});

describe('confluence cli help and errors redact tokens', () => {
  let tempTree: string;

  beforeEach(async () => {
    tempTree = await mkdtemp(join(tmpdir(), 'cf-help-'));
  });

  afterEach(async () => {
    await rm(tempTree, { recursive: true, force: true });
  });

  it('help output never echoes an api token', async () => {
    const { stdout, code } = await runCli(['--help'], {
      CONFLUENCE_API_TOKEN: 'TopSecretHelpValue',
    });
    expect(code).toBe(0);
    expect(stdout).not.toContain('TopSecretHelpValue');
    expect(stdout).toContain('repo-toolkit-confluence');
    expect(stdout).toContain('CONFLUENCE_API_TOKEN_FILE');
  });

  it('missing required credentials error never echoes the supplied token', async () => {
    const { stderr, code } = await runCli(['--folder', join(tempTree, 'nope'), '--api-token', 'TopSecretCliValue'], {});
    expect(code).toBe(1);
    expect(stderr).not.toContain('TopSecretCliValue');
  });

  it('invalid env boolean error never includes a CLI token', async () => {
    const { stderr, code } = await runCli(['--folder', join(tempTree, 'nope'), '--api-token', 'TopSecretBadBool'], {
      CONFLUENCE_DRY_RUN: 'maybe',
    });
    expect(code).toBe(1);
    expect(stderr).toContain('CONFLUENCE_DRY_RUN');
    expect(stderr).not.toContain('TopSecretBadBool');
  });
});

describe('confluence cli dry-run with env credentials and config', () => {
  let tempTree: string;
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(async () => {
    envSnapshot = snapshotEnv();
    clearConfluenceEnv();
    tempTree = await makeDocTree();
  });

  afterEach(async () => {
    restoreEnv(envSnapshot);
    await rm(tempTree, { recursive: true, force: true });
  });

  it('runs dry-run with environment credentials and CLI --dry-run override', async () => {
    const { code, stdout, stderr } = await runCli(['--dry-run', '--folder', join(tempTree, 'docs')], {
      CONFLUENCE_USERNAME: 'env-user',
      CONFLUENCE_API_TOKEN: 'env-secret-do-not-log',
      CONFLUENCE_BASE_URL: 'http://env/wiki',
      CONFLUENCE_SPACE_KEY: 'ENV',
      CONFLUENCE_PARENT_PAGE_ID: '123',
    });
    expect(stderr).not.toContain('env-secret-do-not-log');
    expect(code).toBe(0);
    expect(stdout).toContain('[dry-run]');
    expect(stdout).toContain('index.md');
    expect(stdout).toContain('sub/page.md');
  });

  it('combines env credentials with --config and individual CLI overrides', async () => {
    const configPath = await writeConfig({
      baseUrl: 'http://from-config/wiki',
      spaceKey: 'CFG',
      parentPageId: '555',
    });
    const { code, stdout, stderr } = await runCli(
      ['--dry-run', '--folder', join(tempTree, 'docs'), '--config', configPath, '--space-key', 'CLI'],
      {
        CONFLUENCE_USERNAME: 'env-user',
        CONFLUENCE_API_TOKEN: 'env-secret-do-not-log',
      },
    );
    expect(stderr).not.toContain('env-secret-do-not-log');
    expect(code).toBe(0);
    expect(stdout).toContain('[dry-run]');
  });
});

describe('confluence cli page-title-strategy', () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
    clearConfluenceEnv();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it('parses --page-title-strategy from CLI and exposes it via buildOptions', () => {
    const result = flagResult(['--page-title-strategy', 'sentence-case-parent']);
    const opts = buildOptions(result);
    expect(opts.pageTitleStrategy).toBe('sentence-case-parent');
  });

  it('parses CONFLUENCE_PAGE_TITLE_STRATEGY and INPUT_PAGE-TITLE-STRATEGY from env with CONFLUENCE precedence', () => {
    process.env['INPUT_PAGE-TITLE-STRATEGY'] = 'filename';
    process.env.CONFLUENCE_PAGE_TITLE_STRATEGY = 'sentence-case-path';
    const fromEnv = optionsFromEnv();
    expect(fromEnv.pageTitleStrategy).toBe('sentence-case-path');

    delete process.env.CONFLUENCE_PAGE_TITLE_STRATEGY;
    expect(optionsFromEnv().pageTitleStrategy).toBe('filename');
  });

  it('resolves precedence CLI > config > CONFLUENCE_* > INPUT_* > default', async () => {
    process.env['INPUT_PAGE-TITLE-STRATEGY'] = 'filename';
    process.env.CONFLUENCE_PAGE_TITLE_STRATEGY = 'sentence-case-parent';

    const configPath = await writeConfig({
      pageTitleStrategy: 'sentence-case-parents',
    } as unknown as Partial<ConfluenceSyncOptions>);
    const result = flagResult(['--page-title-strategy', 'sentence-case-path', '--config', configPath]);
    const merged = await resolveConfluenceOptions({ result });
    expect(merged.pageTitleStrategy).toBe('sentence-case-path');

    const result2 = flagResult(['--config', configPath]);
    const merged2 = await resolveConfluenceOptions({ result: result2 });
    expect(merged2.pageTitleStrategy).toBe('sentence-case-parents');

    const result3 = flagResult([]);
    const merged3 = await resolveConfluenceOptions({ result: result3 });
    expect(merged3.pageTitleStrategy).toBe('sentence-case-parent');

    delete process.env.CONFLUENCE_PAGE_TITLE_STRATEGY;
    const merged4 = await resolveConfluenceOptions({ result: result3 });
    expect(merged4.pageTitleStrategy).toBe('filename');

    delete process.env['INPUT_PAGE-TITLE-STRATEGY'];
    const merged5 = await resolveConfluenceOptions({ result: result3 });
    expect(merged5.pageTitleStrategy).toBeUndefined();
  });

  it('defaults to filename-stem when no source supplies a strategy (via sync plan validation)', async () => {
    const { resolveConfluenceSyncPlan } = await import('../src/index');
    const plan = resolveConfluenceSyncPlan({
      folder: 'docs',
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
    } as ConfluenceSyncOptions);
    expect(plan.pageTitleStrategy).toBe('filename-stem');

    const merged = await resolveConfluenceOptions({ result: flagResult([]) });
    const plan2 = resolveConfluenceSyncPlan({
      folder: 'docs',
      username: 'u',
      apiToken: 't',
      baseUrl: 'https://x/wiki',
      spaceKey: 'ENG',
      parentPageId: '123',
      ...merged,
    } as ConfluenceSyncOptions);
    expect(plan2.pageTitleStrategy).toBe('filename-stem');
  });

  it('rejects malformed CLI, config, and env values with pageTitleStrategy accepted-values message', async () => {
    const { resolveConfluenceSyncPlan, PAGE_TITLE_STRATEGIES } = await import('../src/index');
    const allValues = PAGE_TITLE_STRATEGIES.join(', ');

    const cliResult = flagResult(['--page-title-strategy', 'bogus']);
    const cliMerged = await resolveConfluenceOptions({ result: cliResult });
    expect(() =>
      resolveConfluenceSyncPlan({
        folder: 'docs',
        username: 'u',
        apiToken: 't',
        baseUrl: 'https://x/wiki',
        spaceKey: 'ENG',
        parentPageId: '123',
        ...cliMerged,
      } as ConfluenceSyncOptions),
    ).toThrowError(new RegExp(`Invalid pageTitleStrategy.*${allValues.replace(/-/g, '\\-')}`));

    const configPath = await writeConfig({ pageTitleStrategy: '' } as unknown as Partial<ConfluenceSyncOptions>);
    const cfgResult = flagResult(['--config', configPath]);
    const cfgMerged = await resolveConfluenceOptions({ result: cfgResult });
    expect(() =>
      resolveConfluenceSyncPlan({
        folder: 'docs',
        username: 'u',
        apiToken: 't',
        baseUrl: 'https://x/wiki',
        spaceKey: 'ENG',
        parentPageId: '123',
        ...cfgMerged,
      } as ConfluenceSyncOptions),
    ).toThrowError(/Invalid pageTitleStrategy/);

    process.env.CONFLUENCE_PAGE_TITLE_STRATEGY = 'totally-bogus';
    const envMerged = optionsFromEnv();
    expect(() =>
      resolveConfluenceSyncPlan({
        folder: 'docs',
        username: 'u',
        apiToken: 't',
        baseUrl: 'https://x/wiki',
        spaceKey: 'ENG',
        parentPageId: '123',
        ...(envMerged as ConfluenceSyncOptions),
      } as ConfluenceSyncOptions),
    ).toThrowError(/Invalid pageTitleStrategy/);
  });

  it('help output lists --page-title-strategy and five values with default', async () => {
    const { stdout, code } = await runCli(['--help'], {});
    expect(code).toBe(0);
    expect(stdout).toContain('--page-title-strategy');
    expect(stdout).toContain('filename-stem');
    expect(stdout).toContain('sentence-case-parent');
    expect(stdout).toContain('CONFLUENCE_PAGE_TITLE_STRATEGY');
  });

  it('CLI dry-run with non-default strategy emits generated titles', async () => {
    const tempTree = await makeDocTree();
    try {
      const { code, stdout } = await runCli(
        ['--dry-run', '--folder', join(tempTree, 'docs'), '--page-title-strategy', 'sentence-case-parent'],
        {},
      );
      expect(code).toBe(0);
      expect(stdout).toContain('Page (sub)');
      expect(stdout).toContain('Index');
    } finally {
      await rm(tempTree, { recursive: true, force: true });
    }
  });
});

async function writeConfig(partial: Partial<ConfluenceSyncOptions> & { apiTokenFile?: string }): Promise<string> {
  const tmp = await mkdtemp(join(tmpdir(), 'cf-cfg-'));
  const configPath = join(tmp, 'config.json');
  await writeFile(configPath, JSON.stringify(partial));
  return configPath;
}
