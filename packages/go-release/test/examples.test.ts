import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveGoReleasePlan } from '../src/index';

const packageRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(packageRoot, '../..');
const buildCli = join(packageRoot, 'dist', 'cli-build.js');
const verifyCli = join(packageRoot, 'dist', 'cli-verify.js');
const examples = ['single-binary', 'multi-binary-license'] as const;
const tempPaths: string[] = [];

afterEach(() => {
  for (const path of tempPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function readExample(name: (typeof examples)[number]): Record<string, unknown> {
  return JSON.parse(readFileSync(join(packageRoot, 'test', 'fixtures', name, 'go-release.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

function documentedExample(name: (typeof examples)[number]): Record<string, unknown> {
  const docs = readFileSync(join(repositoryRoot, 'website', 'docs', 'packages', 'go-release.md'), 'utf8');
  const marker = `<!-- example:${name} -->\n\`\`\`json\n`;
  const start = docs.indexOf(marker);
  if (start < 0) throw new Error(`Missing documented example: ${name}`);
  const bodyStart = start + marker.length;
  const end = docs.indexOf('\n```', bodyStart);
  if (end < 0) throw new Error(`Unterminated documented example: ${name}`);
  return JSON.parse(docs.slice(bodyStart, end)) as Record<string, unknown>;
}

function fakeGo(cwd: string): string {
  const path = join(cwd, 'fake-go.cjs');
  writeFileSync(
    path,
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const output = args[args.indexOf('-o') + 1];
const name = path.basename(output).replace(/\\.exe$/, '');
const target = process.env.GOOS + '-' + process.env.GOARCH;
let version = '1.2.3/' + target;
if (name === 'mongo-archive') version = 'mongo-archive version: 1.2.3 ' + target;
if (name === 'mongo-unarchive') version = 'mongo-unarchive version: 1.2.3 ' + target;
fs.writeFileSync(output, '#!/usr/bin/env node\\nprocess.stdout.write(' + JSON.stringify(version + '\\n') + ');\\n');
`,
  );
  chmodSync(path, 0o755);
  return path;
}

describe('documented Go release examples', () => {
  it.each(examples)('keeps the %s website example identical to its tested fixture', (name) => {
    expect(documentedExample(name)).toEqual(readExample(name));
  });

  it.each(examples)('builds and verifies the %s example through both CLIs', (name) => {
    const cwd = mkdtempSync(join(tmpdir(), `go-release-${name}-`));
    tempPaths.push(cwd);
    const config = readExample(name);
    writeFileSync(join(cwd, 'go-release.json'), `${JSON.stringify(config, null, 2)}\n`);
    if (name === 'multi-binary-license') {
      writeFileSync(join(cwd, 'LICENSE'), readFileSync(join(packageRoot, 'test', 'fixtures', name, 'LICENSE')));
    }
    const goExecutable = fakeGo(cwd);

    const dryRun = spawnSync(process.execPath, [buildCli, '--cwd', cwd, '--config', 'go-release.json', '--dry-run'], {
      encoding: 'utf8',
    });
    expect(dryRun.status).toBe(0);
    expect(JSON.parse(dryRun.stdout)).toMatchObject({ dryRun: true, toolName: config.toolName });

    const build = spawnSync(
      process.execPath,
      [buildCli, '--cwd', cwd, '--config', 'go-release.json', '--go-executable', goExecutable],
      { encoding: 'utf8' },
    );
    expect(build.stderr).toBe('');
    expect(build.status).toBe(0);

    const verify = spawnSync(process.execPath, [verifyCli, '--cwd', cwd, '--config', 'go-release.json'], {
      encoding: 'utf8',
    });
    expect(verify.stderr).toBe('');
    expect(verify.status).toBe(0);
    expect(JSON.parse(verify.stdout)).toMatchObject({ operation: 'verify', toolName: config.toolName });
    expect(resolveGoReleasePlan({ ...config, cwd }).targets).toHaveLength((config.targets as unknown[]).length);
  });
});
