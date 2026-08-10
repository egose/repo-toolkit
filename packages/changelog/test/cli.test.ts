import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseFlags, resolveCliOptions } from '@repo-toolkit/publish-package';
import { SPECS, resolveGenerateChangelogCliOptions } from '../src/cli';

function parseCli(argv: string[]) {
  const result = parseFlags(argv, SPECS);
  if (!result) return null;
  return resolveGenerateChangelogCliOptions(result);
}

describe('CLI flag resolution', () => {
  it('parses --cwd', () => {
    expect(parseCli(['--cwd', '/repo'])).toEqual({ cwd: '/repo' });
  });

  it('parses --output', () => {
    expect(parseCli(['--output', 'CHANGES.md'])).toEqual({ outputFile: 'CHANGES.md' });
  });

  it('parses --tag-prefix with a value', () => {
    expect(parseCli(['--tag-prefix', 'release-'])).toEqual({ tagPrefix: 'release-' });
  });

  it('preserves an explicit empty --tag-prefix=', () => {
    expect(parseCli(['--tag-prefix='])).toEqual({ tagPrefix: '' });
  });

  it('parses --release-count as a number', () => {
    expect(parseCli(['--release-count', '3'])).toEqual({ releaseCount: 3 });
  });

  it('rejects a non-numeric --release-count', () => {
    expect(() => parseCli(['--release-count', 'abc'])).toThrow(/Invalid numeric value/);
  });

  it('rejects a negative --release-count in --flag=value form', () => {
    expect(() => parseCli(['--release-count=-1'])).toThrow(/Invalid numeric value/);
  });

  it('parses --append as true', () => {
    expect(parseCli(['--append'])).toEqual({ append: true });
  });

  it('parses --no-append as false', () => {
    expect(parseCli(['--no-append'])).toEqual({ append: false });
  });

  it('parses --first-release as true', () => {
    expect(parseCli(['--first-release'])).toEqual({ firstRelease: true });
  });

  it('parses --no-first-release as false', () => {
    expect(parseCli(['--no-first-release'])).toEqual({ firstRelease: false });
  });

  it('parses --skip-unstable as true', () => {
    expect(parseCli(['--skip-unstable'])).toEqual({ skipUnstable: true });
  });

  it('parses --no-skip-unstable as false', () => {
    expect(parseCli(['--no-skip-unstable'])).toEqual({ skipUnstable: false });
  });

  it('parses --output-unreleased as true', () => {
    expect(parseCli(['--output-unreleased'])).toEqual({ outputUnreleased: true });
  });

  it('parses --no-output-unreleased as false', () => {
    expect(parseCli(['--no-output-unreleased'])).toEqual({ outputUnreleased: false });
  });

  it('combines all flags in one invocation', () => {
    const opts = parseCli([
      '--cwd',
      '/repo',
      '--output',
      'CHANGES.md',
      '--tag-prefix',
      'v',
      '--release-count',
      '2',
      '--append',
      '--no-skip-unstable',
      '--no-output-unreleased',
    ]);
    expect(opts).toEqual({
      cwd: '/repo',
      outputFile: 'CHANGES.md',
      tagPrefix: 'v',
      releaseCount: 2,
      append: true,
      skipUnstable: false,
      outputUnreleased: false,
    });
  });

  it('returns defaults when no flags are given', () => {
    expect(parseCli([])).toEqual({});
  });

  it('rejects unknown arguments in strict mode', () => {
    expect(() => parseCli(['--bogus'])).toThrow(/Unknown argument/);
  });

  it('returns null for -h (help)', () => {
    expect(parseCli(['-h'])).toBeNull();
  });

  it('returns null for --help', () => {
    expect(parseCli(['--help'])).toBeNull();
  });

  it('terminates parsing at -- in non-strict mode', () => {
    const result = parseFlags(['--cwd', '/r', '--', '--append'], SPECS, { strict: false });
    expect(result).not.toBeNull();
    const opts = resolveGenerateChangelogCliOptions(result!);
    expect(opts.cwd).toBe('/r');
    expect(opts.append).toBeUndefined();
    expect(result!.unknown).toContain('--append');
  });

  it('rejects post-dashdash args in strict mode', () => {
    expect(() => parseFlags(['--cwd', '/r', '--', '--append'], SPECS)).toThrow(/Unknown argument/);
  });

  it('does not auto-run main() on import (only when executed as entry point)', () => {
    const logSpy = { log: vi.spyOn(console, 'log').mockImplementation(() => {}) };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const origArgv = process.argv;
    process.argv = ['node'];

    // Importing cli.ts should not call main() because process.argv[1]
    // will not match import.meta.url (we are not the entry point).
    vi.resetModules();
    return import('../src/cli').then(() => {
      expect(logSpy.log).not.toHaveBeenCalledWith(expect.stringContaining('Changelog'));
      process.argv = origArgv;
      logSpy.log.mockRestore();
    });
  });

  it('accepts --flag=value form with dash-leading value', () => {
    expect(parseCli(['--tag-prefix=-'])).toEqual({ tagPrefix: '-' });
  });

  it('rejects --flag value form when value starts with a dash', () => {
    expect(() => parseCli(['--tag-prefix', '-x'])).toThrow(/Missing value/);
  });
});

describe('CLI config precedence', () => {
  const workDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(workDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function mkConfig(cwd: string, fileName: string, contents: Record<string, unknown>) {
    await writeFile(join(cwd, fileName), JSON.stringify(contents));
  }

  async function merge(argv: string[], cwd?: string) {
    const result = parseFlags(argv, SPECS);
    expect(result).not.toBeNull();
    return resolveCliOptions({
      result: result!,
      buildOptions: resolveGenerateChangelogCliOptions,
      cwd,
    });
  }

  it('CLI flags override config file values', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'cli-config-'));
    workDirs.push(cwd);
    await mkConfig(cwd, 'conf.json', { tagPrefix: 'config-prefix', releaseCount: 9, append: false });
    const merged = await merge(['--config', 'conf.json', '--tag-prefix', 'cli-prefix'], cwd);
    expect(merged.tagPrefix).toBe('cli-prefix');
    expect(merged.releaseCount).toBe(9);
    expect(merged.append).toBe(false);
  });

  it('config supplies values when CLI omits them', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'cli-config-'));
    workDirs.push(cwd);
    await mkConfig(cwd, 'conf.json', { tagPrefix: 'from-config', skipUnstable: false });
    const merged = await merge(['--config', 'conf.json'], cwd);
    expect(merged.tagPrefix).toBe('from-config');
    expect(merged.skipUnstable).toBe(false);
  });

  it('relative config is resolved against --cwd', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'cli-cwd-'));
    workDirs.push(cwd);
    await mkConfig(cwd, 'opts.json', { tagPrefix: 'cwd-relative' });
    const merged = await merge(['--cwd', cwd, '--config', 'opts.json']);
    expect(merged.tagPrefix).toBe('cwd-relative');
  });
});
