import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseFlags, resolveCliOptions } from '@repo-toolkit/publish-package';
import { SPECS, printHelp, buildOptions } from '../src/cli';

const __dirname = dirname(fileURLToPath(import.meta.url));

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

function parseCli(argv: string[]) {
  const result = parseFlags(argv, SPECS);
  if (!result) return null;
  return buildOptions(result);
}

describe('CLI flag resolution (MPPARC-03)', () => {
  it('parses --cwd', () => {
    expect(parseCli(['--cwd', '/repo'])).toEqual({ cwd: '/repo' });
  });

  it('parses --version and the --tag alias', () => {
    expect(parseCli(['--version', '1.2.3'])).toEqual({ version: '1.2.3' });
    expect(parseCli(['--tag', '2.0.0'])).toEqual({ version: '2.0.0' });
  });

  it('parses --npm-tag', () => {
    expect(parseCli(['--npm-tag', 'next'])).toEqual({ npmTag: 'next' });
  });

  it('parses --from', () => {
    expect(parseCli(['--from', 'publish-package'])).toEqual({ from: 'publish-package' });
  });

  it('parses --publish-dir', () => {
    expect(parseCli(['--publish-dir', 'build'])).toEqual({ publishDir: 'build' });
  });

  it('parses --access', () => {
    expect(parseCli(['--access', 'restricted'])).toEqual({ access: 'restricted' });
  });

  it('parses --registry', () => {
    expect(parseCli(['--registry', 'https://registry.example'])).toEqual({
      registry: 'https://registry.example',
    });
  });

  it('parses --otp', () => {
    expect(parseCli(['--otp', '123456'])).toEqual({ otp: '123456' });
  });

  it('parses --version-placeholder', () => {
    expect(parseCli(['--version-placeholder', '__VERSION__'])).toEqual({ versionPlaceholder: '__VERSION__' });
  });

  it('parses --build-command', () => {
    expect(parseCli(['--build-command', 'pnpm -w build'])).toEqual({ buildCommand: 'pnpm -w build' });
  });

  it('parses boolean flags as true', () => {
    expect(parseCli(['--skip-build'])).toEqual({ skipBuild: true });
    expect(parseCli(['--provenance'])).toEqual({ provenance: true });
    expect(parseCli(['--dry-run'])).toEqual({ dryRun: true });
    expect(parseCli(['--no-default-package-files'])).toEqual({ noDefaultPackageFiles: true });
    expect(parseCli(['--no-default-root-files'])).toEqual({ noDefaultRootFiles: true });
    expect(parseCli(['--preserve-publish-dir'])).toEqual({ preservePublishDir: true });
  });

  it('parses list flags --package-files and --root-files (comma split, accumulating across occurrences)', () => {
    expect(parseCli(['--package-files', 'README.md,CHANGELOG.md', '--package-files', 'llms.txt'])).toEqual({
      packageFiles: ['README.md', 'CHANGELOG.md', 'llms.txt'],
    });
    expect(parseCli(['--root-files', 'LICENSE,NOTICE'])).toEqual({ rootFiles: ['LICENSE', 'NOTICE'] });
  });

  it('parses --filter as a list flag with comma split', () => {
    expect(parseCli(['--filter', 'pkg-a,pkg-b', '--filter', 'pkg-c'])).toEqual({
      filters: ['pkg-a', 'pkg-b', 'pkg-c'],
    });
  });

  it('accumulates repeatable --include-package-file across occurrences without comma splitting', () => {
    expect(parseCli(['--include-package-file', 'docs/x.md', '--include-package-file', 'docs/y.md'])).toEqual({
      includePackageFiles: ['docs/x.md', 'docs/y.md'],
    });
  });

  it('accumulates repeatable --include-root-file across occurrences', () => {
    expect(parseCli(['--include-root-file', 'A', '--include-root-file', 'B,C'])).toEqual({
      includeRootFiles: ['A', 'B,C'],
    });
  });

  it('returns empty defaults when no flags given', () => {
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

  it('accepts --flag=value form, including dash-leading values', () => {
    expect(parseCli(['--version=v1.2.3'])).toEqual({ version: 'v1.2.3' });
    expect(parseCli(['--cwd=-x'])).toEqual({ cwd: '-x' });
  });

  it('rejects --flag value form when the value starts with a dash', () => {
    expect(() => parseCli(['--cwd', '-x'])).toThrow(/Missing value/);
  });

  it('rejects --flag=value on a boolean flag', () => {
    expect(() => parseCli(['--dry-run=yes'])).toThrow(/Boolean flag --dry-run does not take a value/);
  });

  it('rejects a missing value for the last --flag', () => {
    expect(() => parseCli(['--cwd'])).toThrow(/Missing value for --cwd/);
  });

  it('ignores a mid-argv -- separator (pnpm/npm/yarn passthrough) and keeps parsing flags', () => {
    const result = parseFlags(['--cwd', '/r', '--', '--dry-run'], SPECS);
    expect(result).not.toBeNull();
    expect(result!.values.cwd).toBe('/r');
    expect(result!.values['dry-run']).toBe('true');
  });

  it('ignores trailing -- separators with no following args', () => {
    const result = parseFlags(['--cwd', '/r', '--'], SPECS);
    expect(result!.values.cwd).toBe('/r');
  });

  it('still rejects genuinely unknown flags after a -- separator in strict mode', () => {
    expect(() => parseFlags(['--cwd', '/r', '--', '--bogus'], SPECS)).toThrow(/Unknown argument: --bogus/);
  });
});

describe('CLI config precedence (MPPARC-03)', () => {
  async function mkConfig(cwd: string, fileName: string, contents: Record<string, unknown>): Promise<void> {
    await writeFile(join(cwd, fileName), JSON.stringify(contents));
  }

  async function merge(argv: string[], cwd?: string) {
    const result = parseFlags(argv, SPECS);
    expect(result).not.toBeNull();
    return resolveCliOptions({
      result: result!,
      buildOptions,
      cwd,
    });
  }

  it('CLI flags override config file values', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'mpp-cli-config-'));
    tempPaths.push(cwd);
    await mkConfig(cwd, 'conf.json', { version: '1.0.0', access: 'restricted', dryRun: false });
    const merged = await merge(['--config', 'conf.json', '--version', '2.0.0', '--access', 'public'], cwd);
    expect(merged.version).toBe('2.0.0');
    expect(merged.access).toBe('public');
    expect(merged.dryRun).toBe(false);
  });

  it('config supplies values when CLI omits them', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'mpp-cli-config-'));
    tempPaths.push(cwd);
    await mkConfig(cwd, 'conf.json', { version: '1.5.0', registry: 'https://cfg.example' });
    const merged = await merge(['--config', 'conf.json'], cwd);
    expect(merged.version).toBe('1.5.0');
    expect(merged.registry).toBe('https://cfg.example');
  });

  it('relative config is resolved against --cwd', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'mpp-cli-cwd-'));
    tempPaths.push(cwd);
    await mkConfig(cwd, 'opts.json', { access: 'restricted' });
    const merged = await merge(['--cwd', cwd, '--config', 'opts.json']);
    expect(merged.access).toBe('restricted');
  });

  it('repeats config-side list flags as-is (filters, packageFiles, rootFiles)', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'mpp-cli-lists-'));
    tempPaths.push(cwd);
    await mkConfig(cwd, 'conf.json', { filters: ['pkg-a', 'pkg-b'], packageFiles: ['README.md'] });
    const merged = await merge(['--config', 'conf.json'], cwd);
    expect(merged.filters).toEqual(['pkg-a', 'pkg-b']);
    expect(merged.packageFiles).toEqual(['README.md']);
  });

  it('preservePublishDir flows from config and CLI overrides config false', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'mpp-cli-preserve-'));
    tempPaths.push(cwd);
    await mkConfig(cwd, 'conf.json', { preservePublishDir: true });
    const fromConfig = await merge(['--config', 'conf.json'], cwd);
    expect(fromConfig.preservePublishDir).toBe(true);

    const cwd2 = await mkdtemp(join(tmpdir(), 'mpp-cli-preserve-'));
    tempPaths.push(cwd2);
    await mkConfig(cwd2, 'conf.json', { preservePublishDir: false });
    const fromCliOverride = await merge(['--config', 'conf.json', '--preserve-publish-dir'], cwd2);
    expect(fromCliOverride.preservePublishDir).toBe(true);
  });
});

describe('help README parity (MPPARC-03)', () => {
  const readmePath = resolve(__dirname, '..', 'README.md');

  it('every mentioned CLI flag in README also appears in --help output', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printHelp();
    const help = spy.mock.calls[0][0] as string;
    spy.mockRestore();

    const readme = await readFile(readmePath, 'utf8');

    const flagsInReadme = [
      ...readme.matchAll(
        /`--(config|cwd|version|tag|npm-tag|filter|from|package-files|include-package-file|no-default-package-files|root-files|include-root-file|no-default-root-files|publish-dir|preserve-publish-dir|version-placeholder|build-command|skip-build|access|registry|otp|provenance|dry-run|interactive|help)`/g,
      ),
    ].map((m) => m[1]);

    expect(flagsInReadme.length).toBeGreaterThan(0);
    for (const flag of flagsInReadme) {
      expect(help).toContain(`--${flag}`);
    }
  });

  it('SPECS entries match the canonical flag names advertised in help output', () => {
    const names = new Set(SPECS.map((s) => s.name));
    expect(names).toEqual(
      new Set([
        'config',
        'cwd',
        'version',
        'npm-tag',
        'filter',
        'from',
        'package-files',
        'include-package-file',
        'no-default-package-files',
        'root-files',
        'include-root-file',
        'no-default-root-files',
        'publish-dir',
        'preserve-publish-dir',
        'version-placeholder',
        'build-command',
        'skip-build',
        'access',
        'registry',
        'otp',
        'provenance',
        'dry-run',
        'interactive',
      ]),
    );
  });

  it('printHelp mentions workspace-root behavior and the --from/--filter interactions', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printHelp();
    const help = spy.mock.calls[0][0] as string;
    spy.mockRestore();

    expect(help).toContain('Workspace root directory');
    expect(help).toContain('applied before --from');
    expect(help).toContain('--from');
    expect(help).toContain('--filter');
  });
});

describe('package pack smoke (MPPARC-03)', () => {
  it('the configured files list keeps sources out of the published tarball and exposes the public API surface', async () => {
    const packDest = await mkdtemp(join(tmpdir(), 'mpp-pack-smoke-'));
    tempPaths.push(packDest);

    const pkgRoot = resolve(__dirname, '..');
    execFileSync('pnpm', ['pack', '--pack-destination', packDest], {
      cwd: pkgRoot,
      stdio: 'pipe',
      env: { ...process.env, CI: '1' },
    });

    const entries = await readdir(packDest);
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

    // The CLI entry shebang is present.
    const cliFile = listing.find((entry) => entry.endsWith('/dist/cli.js'));
    expect(cliFile).toBeDefined();
    const extractDir = await mkdtemp(join(tmpdir(), 'mpp-pack-extract-'));
    tempPaths.push(extractDir);
    execFileSync('tar', ['-xzf', tarball, '-C', extractDir], { stdio: 'pipe' });

    // npm packs into a single top-level `package/` directory.
    const cliShebang = (await readFile(join(extractDir, 'package', 'dist', 'cli.js'), 'utf8')).split('\n')[0];
    expect(cliShebang).toBe('#!/usr/bin/env node');

    // Source, tests, and config files must NOT leak into the tarball.
    expect(listing.some((entry) => entry.includes('/src/'))).toBe(false);
    expect(listing.some((entry) => entry.includes('/test/'))).toBe(false);
    expect(listing.some((entry) => entry.endsWith('/tsup.config.ts'))).toBe(false);
    expect(listing.some((entry) => entry.endsWith('/vitest.config.ts'))).toBe(false);
    expect(listing.some((entry) => entry.endsWith('/tsconfig.json'))).toBe(false);
  });
});

describe('CLI integration: -h / --help prints help and exits 0', () => {
  const pkgRoot = resolve(__dirname, '..');
  const cliPath = join(pkgRoot, 'dist', 'cli.js');

  function runCli(argv: string[]): { code: number | null; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync('node', [cliPath, ...argv], { encoding: 'utf8', stdio: 'pipe' });
      return { code: 0, stdout, stderr: '' };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; status?: number };
      return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    }
  }

  it('-h prints help header and exits 0', () => {
    const { code, stdout } = runCli(['-h']);
    expect(code).toBe(0);
    expect(stdout).toContain('repo-toolkit-publish-packages');
    expect(stdout).toContain('Usage:');
  });

  it('--help is identical to -h output', () => {
    const h = runCli(['-h']).stdout;
    const help = runCli(['--help']).stdout;
    expect(h).toBe(help);
  });
});
