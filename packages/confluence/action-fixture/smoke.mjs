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

async function main() {
  let tempRoot;
  try {
    tempRoot = await mkdtemp(join(tmpdir(), 'cf-action-fixture-'));
    const docsDir = join(tempRoot, 'docs');
    const subDir = join(docsDir, 'sub');
    await mkdir(subDir, { recursive: true });
    await writeFile(join(docsDir, 'index.md'), '# Index\n\nHello fixture.\n');
    await writeFile(join(subDir, 'page.md'), '# Page\n\nSub page.\n');

    const env = {
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

    for (const k of Object.keys(env)) {
      if (k.startsWith('CONFLUENCE_')) delete env[k];
    }
    delete env.CONFLUENCE_API_TOKEN;
    delete env.CONFLUENCE_USERNAME;
    delete env.CONFLUENCE_BASE_URL;
    delete env.CONFLUENCE_SPACE_KEY;
    delete env.CONFLUENCE_PARENT_PAGE_ID;
    delete env.CONFLUENCE_FOLDER;
    delete env.CONFLUENCE_DRY_RUN;
    delete env.CONFLUENCE_SKIP_UNCHANGED;
    delete env.CONFLUENCE_RENDER_HTML_BLOCKS;
    delete env.CONFLUENCE_API_TOKEN_FILE;
    delete env.CONFLUENCE_PAGE_TITLE_STRATEGY;
    delete env['INPUT_PASSWORD'];
    delete env['INPUT_API-TOKEN-FILE'];
    delete env['INPUT_PASSWORD-FILE'];
    // keep INPUT_API-TOKEN (MOCK_TOKEN) for dry-run token-non-echo check; original fixture deleted it but dry-run no longer requires it
    // Do NOT delete INPUT_PAGE-TITLE-STRATEGY — the non-default strategy must reach the sync plan

    const result = spawnSync(process.execPath, [cliPath], {
      env,
      encoding: 'utf8',
    });

    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';

    const failures = [];
    if (result.status !== 0) {
      failures.push(`expected exit 0, got ${result.status}`);
    }
    if (!stdout.includes('[dry-run]')) {
      failures.push('expected at least one [dry-run] line on stdout');
    }
    if (!stdout.includes('index.md')) {
      failures.push('expected dry-run plan to list index.md');
    }
    if (!stdout.includes('sub/page.md')) {
      failures.push('expected dry-run plan to list sub/page.md');
    }
    if (!stdout.includes('Page (sub)')) {
      failures.push('expected dry-run plan to contain generated title "Page (sub)" for page-title-strategy sentence-case-parent (sub/page.md)');
    }
    if (!stdout.includes('Index')) {
      failures.push('expected dry-run plan to contain generated title "Index" for sentence-case-parent root (index.md)');
    }
    if (stdout.includes(MOCK_TOKEN) || stderr.includes(MOCK_TOKEN)) {
      failures.push(`token "${MOCK_TOKEN}" was echoed to stdout or stderr`);
    }

    if (failures.length > 0) {
      console.error('FAIL: confluence action smoke fixture');
      for (const f of failures) console.error('  - ' + f);
      console.error('--- stdout ---\n' + stdout);
      console.error('--- stderr ---\n' + stderr);
      process.exitCode = 1;
      return;
    }

    console.error('PASS: confluence action smoke fixture');
    console.error('  spawn target: ' + cliPath);
    console.error('  INPUT_* resolved by dist/cli.js; dry-run plan emitted; token not echoed.');
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
