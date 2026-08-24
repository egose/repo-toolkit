import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(import.meta.dirname, '..');

describe('@repo-toolkit/go-release package scaffold', () => {
  it('exposes the planned API and both CLI bundles after build', () => {
    const exportedNames = execFileSync(
      process.execPath,
      ['--input-type=module', '--eval', "console.log(Object.keys(await import('./dist/index.js')).sort().join(','))"],
      { cwd: packageRoot, encoding: 'utf8' },
    ).trim();

    expect(exportedNames.split(',')).toEqual([
      'buildGoRelease',
      'createGoReleaseArchives',
      'defaultGoReleaseRunner',
      'resolveGoReleasePlan',
      'validateGoReleaseRunner',
      'verifyGoRelease',
      'verifyGoReleaseReproducibility',
      'writeGoReleaseChecksums',
    ]);

    for (const cli of ['cli-build.js', 'cli-verify.js']) {
      const cliPath = resolve(packageRoot, 'dist', cli);
      expect(readFileSync(cliPath, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env node');

      const result = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Usage:');
    }
  });

  it('does not silently succeed for unimplemented operations', () => {
    const build = spawnSync(process.execPath, [resolve(packageRoot, 'dist', 'cli-build.js')], { encoding: 'utf8' });
    expect(build.status).toBe(1);
    expect(build.stderr).toContain('toolName must be a non-empty string');

    const verify = spawnSync(process.execPath, [resolve(packageRoot, 'dist', 'cli-verify.js')], { encoding: 'utf8' });
    expect(verify.status).toBe(1);
    expect(verify.stderr).toContain('toolName must be a non-empty string');
  });
});
