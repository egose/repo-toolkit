import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runSecretSync } from '../src/index';
import { MemoryFakeStore } from './helpers';

const packageRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(packageRoot, '../..');
const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';

function documentedConfig(source: string): Record<string, unknown> {
  const docs = source;
  const start = docs.indexOf('"schemaVersion"');
  if (start < 0) throw new Error('Missing documented config example');
  const fenceStart = docs.lastIndexOf('```json', start);
  const fenceEnd = docs.indexOf('```', start);
  if (fenceStart < 0 || fenceEnd < 0) throw new Error('Missing documented config fence');
  const bodyStart = docs.indexOf('\n', fenceStart) + 1;
  return JSON.parse(docs.slice(bodyStart, fenceEnd)) as Record<string, unknown>;
}

describe('documented secret-sync examples', () => {
  it('keeps the README config example valid and executable with a fake store', async () => {
    const readme = await readFile(join(packageRoot, 'README.md'), 'utf8');
    const config = documentedConfig(readme);
    expect(config.schemaVersion).toBe(1);
    expect(config.projectId).toBe(PROJECT_ID);
    const dir = await mkdtemp(join(tmpdir(), 'secsync-example-'));
    try {
      await writeFile(join(dir, 'secret-sync.config.json'), `${JSON.stringify(config, null, 2)}\n`);
      await writeFile(join(dir, '.env'), 'EXAMPLE=1\n');
      const store = new MemoryFakeStore();
      const env = { OP_CONNECT_HOST: 'https://connect.example', OP_CONNECT_TOKEN: 'example-token' };
      const push = await runSecretSync({
        cwd: dir,
        config: join(dir, 'secret-sync.config.json'),
        command: 'push',
        env,
        store,
      });
      expect(push.command).toBe('push');
      const status = await runSecretSync({
        cwd: dir,
        config: join(dir, 'secret-sync.config.json'),
        command: 'status',
        env,
        store,
      });
      if (status.command === 'status') {
        expect(status.result.clean).toBe(true);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps the website config example identical to the README example', async () => {
    const readme = await readFile(join(packageRoot, 'README.md'), 'utf8');
    const website = await readFile(join(repositoryRoot, 'website', 'docs', 'packages', 'secret-sync.md'), 'utf8');
    expect(documentedConfig(website)).toEqual(documentedConfig(readme));
  });

  it('runs the fake-server example without a real vault', () => {
    const result = spawnSync(process.execPath, [join(packageRoot, 'examples', 'fake-server.mjs')], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('fake-server round trip ok');
  });
});
