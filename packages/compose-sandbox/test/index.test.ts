import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(import.meta.dirname, '..');

describe('@repo-toolkit/compose-sandbox package scaffold', () => {
  it('exposes the planned API and CLI bundle after build', () => {
    const exportedNames = execFileSync(
      process.execPath,
      ['--input-type=module', '--eval', "console.log(Object.keys(await import('./dist/index.js')).sort().join(','))"],
      { cwd: packageRoot, encoding: 'utf8' },
    ).trim();

    const names = exportedNames.split(',');
    expect(names).toContain('resolveComposeSandboxPlan');
    expect(names).toContain('runComposeSandbox');
    expect(names).toContain('runProcess');
    expect(names).toContain('runLifecycle');

    const cliPath = resolve(packageRoot, 'dist', 'cli.js');
    expect(readFileSync(cliPath, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env node');

    const result = spawnSync(process.execPath, [cliPath, '--help'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage:');
  });

  it('does not silently succeed for unimplemented operations', () => {
    const cliPath = resolve(packageRoot, 'dist', 'cli.js');
    const result = spawnSync(process.execPath, [cliPath], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not yet implemented|compose|test is required/);
  });
});
