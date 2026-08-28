#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dirname, '..', 'dist', 'cli.js');

const MOCK_TOKEN = 'fixture-token-do-not-log';

function run(env) {
  const result = spawnSync(process.execPath, [cliPath], {
    env,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

async function main() {
  let tempRoot;
  try {
    tempRoot = await mkdtemp(join(tmpdir(), 'cf-action-fixture-'));
    const docsDir = join(tempRoot, 'docs');
    const subDir = join(docsDir, 'sub');
    await mkdir(subDir, { recursive: true });
    await writeFile(join(docsDir, 'index.md'), '# Index\n\nHello fixture.\n');
    await writeFile(join(subDir, 'page.md'), '# Page\n\nSub page.\n');

    const baseEnv = {
      ...process.env,
      INPUT_FOLDER: docsDir,
      INPUT_USERNAME: 'fixture-user@example.com',
      'INPUT_API-TOKEN': MOCK_TOKEN,
      'INPUT_CONFLUENCE-BASE-URL': 'http://fixture.example/wiki',
      'INPUT_SPACE-KEY': 'FX',
      'INPUT_PARENT-PAGE-ID': '123456789',
      'INPUT_PAGE-TITLE-STRATEGY': 'sentence-case-parent',
      'INPUT_DRY-RUN': 'true',
      'INPUT_SKIP-UNCHANGED': 'true',
      'INPUT_RENDER-HTML-BLOCKS': 'false',
    };

    for (const k of Object.keys(baseEnv)) {
      if (k.startsWith('CONFLUENCE_')) delete baseEnv[k];
    }
    delete baseEnv.CONFLUENCE_API_TOKEN;
    delete baseEnv.CONFLUENCE_USERNAME;
    delete baseEnv.CONFLUENCE_BASE_URL;
    delete baseEnv.CONFLUENCE_SPACE_KEY;
    delete baseEnv.CONFLUENCE_PARENT_PAGE_ID;
    delete baseEnv.CONFLUENCE_FOLDER;
    delete baseEnv.CONFLUENCE_DRY_RUN;
    delete baseEnv.CONFLUENCE_SKIP_UNCHANGED;
    delete baseEnv.CONFLUENCE_RENDER_HTML_BLOCKS;
    delete baseEnv.CONFLUENCE_API_TOKEN_FILE;
    delete baseEnv.CONFLUENCE_PAGE_TITLE_STRATEGY;
    delete baseEnv.CONFLUENCE_CLEAN;
    delete baseEnv.CONFLUENCE_UPDATE_PARENT_PAGE;
    delete baseEnv['INPUT_PASSWORD'];
    delete baseEnv['INPUT_API-TOKEN-FILE'];
    delete baseEnv['INPUT_PASSWORD-FILE'];
    delete baseEnv['INPUT_CLEAN'];
    delete baseEnv['INPUT_UPDATE-PARENT-PAGE'];

    const failures = [];

    {
      const env = { ...baseEnv };
      const { status, stdout, stderr } = run(env);
      if (status !== 0) failures.push(`base: expected exit 0, got ${status}`);
      if (!stdout.includes('[dry-run]')) failures.push('base: expected at least one [dry-run] line on stdout');
      if (!stdout.includes('index.md')) failures.push('base: expected dry-run plan to list index.md');
      if (!stdout.includes('sub/page.md')) failures.push('base: expected dry-run plan to list sub/page.md');
      if (!stdout.includes('Page (sub)')) failures.push('base: expected dry-run plan to contain generated title "Page (sub)" for page-title-strategy sentence-case-parent (sub/page.md)');
      if (!stdout.includes('Index')) failures.push('base: expected dry-run plan to contain generated title "Index" for sentence-case-parent root (index.md)');
      if (stdout.includes(MOCK_TOKEN) || stderr.includes(MOCK_TOKEN)) failures.push(`base: token "${MOCK_TOKEN}" was echoed to stdout or stderr`);
      if (!stdout.includes('[dry-run] parent summary:')) failures.push('base: expected default parent summary (update-parent-page true) to emit [dry-run] parent summary');
      if (stdout.includes('[dry-run] clean requested')) failures.push('base: did not expect clean intent with default clean false');
    }

    {
      const env = { ...baseEnv, INPUT_CLEAN: 'true' };
      const { status, stdout, stderr } = run(env);
      if (status !== 0) failures.push(`clean=true: expected exit 0, got ${status}`);
      if (!stdout.includes('[dry-run] clean requested')) failures.push('clean=true: expected [dry-run] clean requested line on stdout');
      if (stdout.includes(MOCK_TOKEN) || stderr.includes(MOCK_TOKEN)) failures.push(`clean=true: token "${MOCK_TOKEN}" was echoed`);
    }

    {
      const env = { ...baseEnv, 'INPUT_UPDATE-PARENT-PAGE': 'false' };
      const { status, stdout, stderr } = run(env);
      if (status !== 0) failures.push(`update-parent-page=false: expected exit 0, got ${status}`);
      if (stdout.includes('[dry-run] parent summary:')) failures.push('update-parent-page=false: expected no [dry-run] parent summary line when opt-out');
      if (stdout.includes('[dry-run] parent tree:')) failures.push('update-parent-page=false: expected no parent tree when opt-out');
      if (stdout.includes(MOCK_TOKEN) || stderr.includes(MOCK_TOKEN)) failures.push(`update-parent-page=false: token "${MOCK_TOKEN}" was echoed`);
    }

    {
      const env = { ...baseEnv, INPUT_CLEAN: 'true', 'INPUT_UPDATE-PARENT-PAGE': 'true' };
      const { status, stdout, stderr } = run(env);
      if (status !== 0) failures.push(`clean+parent: expected exit 0, got ${status}`);
      if (!stdout.includes('[dry-run] clean requested')) failures.push('clean+parent: expected clean intent');
      if (!stdout.includes('[dry-run] parent summary:')) failures.push('clean+parent: expected parent summary when update-parent-page true');
      if (stdout.includes(MOCK_TOKEN) || stderr.includes(MOCK_TOKEN)) failures.push(`clean+parent: token "${MOCK_TOKEN}" was echoed`);
      if (!stdout.includes('[dry-run]') ) failures.push('clean+parent: expected dry-run lines');
    }

    if (failures.length > 0) {
      console.error('FAIL: confluence action smoke fixture');
      for (const f of failures) console.error('  - ' + f);
      process.exitCode = 1;
      return;
    }

    console.error('PASS: confluence action smoke fixture');
    console.error('  spawn target: ' + cliPath);
    console.error('  INPUT_* resolved by dist/cli.js; dry-run plan emitted; token not echoed; clean and update-parent-page inputs verified.');
  } catch (error) {
    console.error('FAIL: confluence action smoke fixture (threw)');
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
