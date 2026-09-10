import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { defaultDockerRunner, formatImageReference, validateDockerRunner } from '../src/index';

const packageRoot = resolve(import.meta.dirname, '..');

describe('@repo-toolkit/docker-publish package scaffold', () => {
  it('exposes the planned API and all CLI bundles after build', () => {
    const exportedNames = execFileSync(
      process.execPath,
      ['--input-type=module', '--eval', "console.log(Object.keys(await import('./dist/index.js')).sort().join(','))"],
      { cwd: packageRoot, encoding: 'utf8' },
    ).trim();

    expect(exportedNames.split(',')).toEqual([
      'buildDockerImages',
      'defaultDockerRunner',
      'formatImageReference',
      'publishDockerImages',
      'resolveDockerPublishPlan',
      'validateDockerRunner',
      'verifyDockerPublish',
    ]);

    const runtimeTypes = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "const mod = await import('./dist/index.js');" +
          "console.log([typeof mod.formatImageReference, typeof mod.defaultDockerRunner, typeof mod.validateDockerRunner].join(','));" +
          "console.log(mod.formatImageReference('registry.example.com', 'team', 'app', '1.2.3'));",
      ],
      { cwd: packageRoot, encoding: 'utf8' },
    )
      .trim()
      .split('\n');

    expect(runtimeTypes[0]).toBe('function,object,function');
    expect(runtimeTypes[1]).toBe('registry.example.com/team/app:1.2.3');

    for (const cli of ['cli.js', 'cli-build.js', 'cli-publish.js']) {
      const cliPath = resolve(packageRoot, 'dist', cli);
      expect(readFileSync(cliPath, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env node');

      const result = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Usage:');
    }
  });

  it('re-exports the formatter and runner values from the package index', () => {
    expect(formatImageReference('registry.example.com', 'team', 'app', '1.2.3')).toBe(
      'registry.example.com/team/app:1.2.3',
    );
    expect(formatImageReference('registry.example.com', '', 'app', '1.2.3')).toBe('registry.example.com/app:1.2.3');
    expect(typeof defaultDockerRunner.run).toBe('function');
    expect(typeof defaultDockerRunner.capture).toBe('function');
    expect(() => validateDockerRunner(defaultDockerRunner)).not.toThrow();
    expect(() => validateDockerRunner({})).toThrow('runner must implement run() and capture()');
  });

  it('fails closed for missing configuration without calling process.exit()', () => {
    const build = spawnSync(process.execPath, [resolve(packageRoot, 'dist', 'cli-build.js')], { encoding: 'utf8' });
    expect(build.status).toBe(1);
    expect(build.stderr).toContain('images must be an array');

    const publish = spawnSync(process.execPath, [resolve(packageRoot, 'dist', 'cli-publish.js')], {
      encoding: 'utf8',
    });
    expect(publish.status).toBe(1);
    expect(publish.stderr).toContain('images must be an array');
  });
});
