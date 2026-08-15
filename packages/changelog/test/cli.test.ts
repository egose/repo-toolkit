import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseFlags, resolveCliOptions } from '@repo-toolkit/publish-package';
import { SPECS, printHelp, resolveGenerateChangelogCliOptions } from '../src/cli';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  it('ignores a mid-argv -- separator (pnpm/npm/yarn passthrough) and keeps parsing flags', () => {
    const result = parseFlags(['--cwd', '/r', '--', '--append'], SPECS);
    expect(result).not.toBeNull();
    expect(result!.values.cwd).toBe('/r');
    expect(result!.values['append']).toBe('true');
  });

  it('ignores trailing -- separators with no following args', () => {
    const result = parseFlags(['--cwd', '/r', '--'], SPECS);
    expect(result!.values.cwd).toBe('/r');
  });

  it('still rejects genuinely unknown flags after a -- separator in strict mode', () => {
    expect(() => parseFlags(['--cwd', '/r', '--', '--bogus'], SPECS)).toThrow(/Unknown argument: --bogus/);
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

describe('help README parity (CLARC-03)', () => {
  const readmePath = resolve(__dirname, '..', 'README.md');

  it('every mentioned CLI flag in README also appears in --help output', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printHelp();
    const help = spy.mock.calls[0][0] as string;
    spy.mockRestore();

    const readme = await readFile(readmePath, 'utf8');

    const flagsInReadme = [
      ...readme.matchAll(
        /`--(config|cwd|output|tag-prefix|release-count|append|first-release|skip-unstable|output-unreleased|help)`/g,
      ),
    ].map((m) => m[1]);

    expect(flagsInReadme.length).toBeGreaterThan(0);
    for (const flag of flagsInReadme) {
      expect(help).toContain(`--${flag}`);
    }
  });

  it('SPECS entries match the flags advertised in help output', () => {
    const names = new Set(SPECS.map((s) => s.name));
    expect(names).toEqual(
      new Set([
        'config',
        'cwd',
        'output',
        'tag-prefix',
        'release-count',
        'append',
        'first-release',
        'skip-unstable',
        'output-unreleased',
      ]),
    );
  });
});

describe('package pack smoke (CLARC-03)', () => {
  const tempPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('the configured files list keeps sources out of the published tarball', async () => {
    const { execFileSync } = await import('node:child_process');
    const packDest = await mkdtemp(join(tmpdir(), 'pack-smoke-'));
    tempPaths.push(packDest);

    const pkgRoot = resolve(__dirname, '..');
    execFileSync('pnpm', ['pack', '--pack-destination', packDest], {
      cwd: pkgRoot,
      stdio: 'pipe',
      env: { ...process.env, CI: '1' },
    });

    const entries = await import('node:fs/promises').then((fs) => fs.readdir(packDest));
    const tarballs = entries.filter((entry) => entry.endsWith('.tgz'));
    expect(tarballs.length).toBe(1);

    const tarball = join(packDest, tarballs[0]);
    const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).split('\n');

    // Required artifacts must be present.
    expect(listing.some((entry) => entry.endsWith('/package.json'))).toBe(true);
    expect(listing.some((entry) => entry.endsWith('/README.md'))).toBe(true);
    expect(listing.some((entry) => entry.endsWith('/dist/index.js'))).toBe(true);
    expect(listing.some((entry) => entry.endsWith('/dist/index.d.ts'))).toBe(true);
    expect(listing.some((entry) => entry.endsWith('/dist/cli.js'))).toBe(true);

    // Source, tests, and config files must NOT leak into the tarball.
    expect(listing.some((entry) => entry.includes('/src/'))).toBe(false);
    expect(listing.some((entry) => entry.includes('/test/'))).toBe(false);
    expect(listing.some((entry) => entry.endsWith('/tsup.config.ts'))).toBe(false);
    expect(listing.some((entry) => entry.endsWith('/vitest.config.ts'))).toBe(false);
  });
});
