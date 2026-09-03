import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseFlags, publishPackage, resolveCliOptions } from '@repo-toolkit/publish-package';
import { SPECS, printHelp, buildOptions, assertVersionSelection, assertJsonConfigRecipesDeclarative } from '../src/cli';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseCli(argv: string[]) {
  const result = parseFlags(argv, SPECS);
  if (!result) return null;
  return buildOptions(result);
}

describe('CLI flag resolution (PPARC-03)', () => {
  it('parses --cwd', () => {
    expect(parseCli(['--cwd', '/repo'])).toEqual({ cwd: '/repo' });
  });

  it('parses --root-dir', () => {
    expect(parseCli(['--root-dir', '/root'])).toEqual({ rootDir: '/root' });
  });

  it('parses --version and the --tag alias', () => {
    expect(parseCli(['--version', '1.2.3'])).toEqual({ version: '1.2.3' });
    expect(parseCli(['--tag', '2.0.0'])).toEqual({ version: '2.0.0' });
  });

  it('parses --npm-tag', () => {
    expect(parseCli(['--npm-tag', 'next'])).toEqual({ npmTag: 'next' });
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

  it('parses --bump <major|minor|patch>', () => {
    expect(parseCli(['--bump', 'major'])).toEqual({ bump: 'major' });
    expect(parseCli(['--bump=minor'])).toEqual({ bump: 'minor' });
    expect(parseCli(['--bump', 'patch'])).toEqual({ bump: 'patch' });
  });

  it('parses --prepare-only and --allow-private-template as booleans', () => {
    expect(parseCli(['--prepare-only'])).toEqual({ prepareOnly: true });
    expect(parseCli(['--allow-private-template'])).toEqual({ allowPrivateTemplate: true });
  });

  it('parses --publish-access', () => {
    expect(parseCli(['--publish-access', 'public'])).toEqual({ publishAccess: 'public' });
  });

  it('parses list flags --package-files and --root-files (comma split)', () => {
    expect(parseCli(['--package-files', 'README.md,CHANGELOG.md'])).toEqual({
      packageFiles: ['README.md', 'CHANGELOG.md'],
    });
    expect(parseCli(['--root-files', 'LICENSE,NOTICE'])).toEqual({ rootFiles: ['LICENSE', 'NOTICE'] });
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

describe('CLI config precedence (PPARC-03)', () => {
  const workDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(workDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

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
    const cwd = await mkdtemp(join(tmpdir(), 'pp-cli-config-'));
    workDirs.push(cwd);
    await mkConfig(cwd, 'conf.json', { version: '1.0.0', access: 'restricted', dryRun: false });
    const merged = await merge(['--config', 'conf.json', '--version', '2.0.0', '--access', 'public'], cwd);
    expect(merged.version).toBe('2.0.0');
    expect(merged.access).toBe('public');
    expect(merged.dryRun).toBe(false);
  });

  it('config supplies values when CLI omits them', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pp-cli-config-'));
    workDirs.push(cwd);
    await mkConfig(cwd, 'conf.json', { version: '1.5.0', registry: 'https://cfg.example' });
    const merged = await merge(['--config', 'conf.json'], cwd);
    expect(merged.version).toBe('1.5.0');
    expect(merged.registry).toBe('https://cfg.example');
  });

  it('relative config is resolved against --cwd', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pp-cli-cwd-'));
    workDirs.push(cwd);
    await mkConfig(cwd, 'opts.json', { access: 'restricted' });
    const merged = await merge(['--cwd', cwd, '--config', 'opts.json']);
    expect(merged.access).toBe('restricted');
  });

  it('preservePublishDir flows from config and CLI overrides config false', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pp-cli-preserve-'));
    workDirs.push(cwd);
    await mkConfig(cwd, 'conf.json', { preservePublishDir: true });
    const fromConfig = await merge(['--config', 'conf.json'], cwd);
    expect(fromConfig.preservePublishDir).toBe(true);

    const cwd2 = await mkdtemp(join(tmpdir(), 'pp-cli-preserve-'));
    workDirs.push(cwd2);
    await mkConfig(cwd2, 'conf.json', { preservePublishDir: false });
    const fromCliOverride = await merge(['--config', 'conf.json', '--preserve-publish-dir'], cwd2);
    expect(fromCliOverride.preservePublishDir).toBe(true);
  });
});

describe('help README parity (PPARC-03)', () => {
  const readmePath = resolve(__dirname, '..', 'README.md');

  it('every mentioned CLI flag in README also appears in --help output', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printHelp();
    const help = spy.mock.calls[0][0] as string;
    spy.mockRestore();

    const readme = await readFile(readmePath, 'utf8');

    const flagsInReadme = [
      ...readme.matchAll(
        /`--(config|cwd|root-dir|package-json|version|tag|bump|npm-tag|publish-dir|preserve-publish-dir|version-placeholder|package-files|include-package-file|no-default-package-files|root-files|include-root-file|no-default-root-files|build-command|skip-build|access|registry|otp|provenance|dry-run|publish-access|prepare-only|allow-private-template|interactive|help)`/g,
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
        'root-dir',
        'package-json',
        'version',
        'bump',
        'npm-tag',
        'publish-dir',
        'preserve-publish-dir',
        'version-placeholder',
        'package-files',
        'include-package-file',
        'no-default-package-files',
        'root-files',
        'include-root-file',
        'no-default-root-files',
        'build-command',
        'skip-build',
        'access',
        'registry',
        'otp',
        'provenance',
        'dry-run',
        'publish-access',
        'prepare-only',
        'allow-private-template',
        'interactive',
      ]),
    );
  });
});

describe('CLI version selection validation (ARTIFACT-05)', () => {
  it('accepts a bare explicit version or a bare valid bump', () => {
    expect(() => assertVersionSelection({ version: '1.2.3' })).not.toThrow();
    expect(() => assertVersionSelection({ bump: 'major' })).not.toThrow();
    expect(() => assertVersionSelection({ bump: 'minor' })).not.toThrow();
    expect(() => assertVersionSelection({ bump: 'patch' })).not.toThrow();
    expect(() => assertVersionSelection({})).not.toThrow();
  });

  it('rejects --version combined with --bump', () => {
    expect(() => assertVersionSelection({ version: '1.2.3', bump: 'patch' })).toThrow(/mutually exclusive/);
  });

  it('rejects an invalid bump value', () => {
    expect(() => assertVersionSelection({ bump: 'banana' as 'major' })).toThrow(
      /--bump must be one of "major", "minor", or "patch": banana/,
    );
  });
});

describe('CLI artifact recipe config (ARTIFACT-05)', () => {
  const workDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(workDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function merge(argv: string[], cwd?: string) {
    const result = parseFlags(argv, SPECS);
    expect(result).not.toBeNull();
    return resolveCliOptions({ result: result!, buildOptions, cwd });
  }

  it('loads executable recipe callbacks from an ESM config default export', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pp-cli-esm-'));
    workDirs.push(cwd);
    await writeFile(
      join(cwd, 'config.mjs'),
      `export default {
        artifacts: [
          {
            id: 'widget',
            packageName: '@example/widget',
            requireTarball: true,
            build() {},
            manifestOverlay(context) { return { description: context.artifactId }; },
            validate() {},
          },
        ],
      };\n`,
    );
    const merged = await merge(['--config', 'config.mjs'], cwd);
    const recipe = merged.artifacts![0];
    expect(recipe.id).toBe('widget');
    expect(recipe.requireTarball).toBe(true);
    expect(typeof recipe.build).toBe('function');
    expect(typeof recipe.manifestOverlay).toBe('function');
    expect(typeof recipe.validate).toBe('function');
  });

  it('loads recipes from a named "artifacts" export when the config has no default export', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pp-cli-esm-named-'));
    workDirs.push(cwd);
    await writeFile(
      join(cwd, 'config.mjs'),
      `export const artifacts = [
        { id: 'widget', packageName: '@example/widget', build() {} },
      ];\n`,
    );
    const merged = await merge(['--config', 'config.mjs'], cwd);
    expect(merged.artifacts).toHaveLength(1);
    expect(typeof merged.artifacts![0].build).toBe('function');
  });

  it('rejects a JSON config that names executable recipe hooks', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pp-cli-json-hook-'));
    workDirs.push(cwd);
    await writeFile(
      join(cwd, 'conf.json'),
      JSON.stringify({
        artifacts: [{ id: 'widget', packageName: '@example/widget', build: 'pnpm build' }],
      }),
    );
    const merged = await merge(['--config', 'conf.json'], cwd);
    expect(() => assertJsonConfigRecipesDeclarative(merged, 'conf.json')).toThrow(
      /artifact recipe hook "build" is a function and cannot be expressed in a JSON config.*use a JavaScript config file/,
    );
  });

  it('rejects a JSON config whose manifestOverlay is not a plain object', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pp-cli-json-overlay-'));
    workDirs.push(cwd);
    await writeFile(
      join(cwd, 'conf.json'),
      JSON.stringify({
        artifacts: [{ id: 'widget', packageName: '@example/widget', manifestOverlay: 'exports.js' }],
      }),
    );
    const merged = await merge(['--config', 'conf.json'], cwd);
    expect(() => assertJsonConfigRecipesDeclarative(merged, 'conf.json')).toThrow(
      /manifestOverlay" must be a plain object in a JSON config.*use a JavaScript config file/,
    );
  });

  it('allows declarative recipes in a JSON config', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pp-cli-json-ok-'));
    workDirs.push(cwd);
    await writeFile(
      join(cwd, 'conf.json'),
      JSON.stringify({
        artifacts: [
          {
            id: 'widget',
            packageName: '@example/widget',
            requireTarball: true,
            preserveSourceFiles: true,
            publishAccess: 'public',
            manifestOverlay: { description: 'widget' },
          },
        ],
      }),
    );
    const merged = await merge(['--config', 'conf.json'], cwd);
    expect(merged.artifacts).toHaveLength(1);
    expect(() => assertJsonConfigRecipesDeclarative(merged, 'conf.json')).not.toThrow();
  });

  it('ignores recipe validation for JavaScript configs', () => {
    expect(() =>
      assertJsonConfigRecipesDeclarative(
        { artifacts: [{ id: 'w', packageName: '@example/w', build() {} }] },
        'config.mjs',
      ),
    ).not.toThrow();
  });

  it('CLI bump overrides config bump and CLI prepare-only overrides config', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pp-cli-bump-'));
    workDirs.push(cwd);
    await writeFile(join(cwd, 'conf.json'), JSON.stringify({ bump: 'minor', prepareOnly: false }));
    const merged = await merge(['--config', 'conf.json', '--bump', 'major', '--prepare-only'], cwd);
    expect(merged.bump).toBe('major');
    expect(merged.prepareOnly).toBe(true);
  });

  it('config bump and CLI version remain mutually exclusive', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pp-cli-conflict-'));
    workDirs.push(cwd);
    await writeFile(join(cwd, 'conf.json'), JSON.stringify({ bump: 'patch' }));
    const merged = await merge(['--config', 'conf.json', '--version', '1.2.3'], cwd);
    expect(() => assertVersionSelection(merged)).toThrow(/mutually exclusive/);
  });
});

describe('CLI prepare-only versus npm dry-run (ARTIFACT-05)', () => {
  const workDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(workDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  function recordingRunner() {
    const events: { executable?: string; args: string[]; command?: string }[] = [];
    return {
      events,
      run(executable: string, args: string[]) {
        events.push({ executable, args: [...args] });
      },
      runShell(command: string) {
        events.push({ command, args: [] });
      },
    };
  }

  async function makeFixture(cwd: string): Promise<void> {
    await mkdir(join(cwd, 'dist'), { recursive: true });
    await writeFile(
      join(cwd, 'package.json'),
      JSON.stringify({ name: '@example/widget', version: '0.0.0-PLACEHOLDER' }),
    );
    await writeFile(join(cwd, 'dist', 'index.js'), 'export {}\n');
  }

  it('prepare-only makes no npm publish calls', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pp-cli-prepare-only-'));
    workDirs.push(cwd);
    await makeFixture(cwd);
    const runner = recordingRunner();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await publishPackage({ cwd, version: '1.2.3', skipBuild: true, prepareOnly: true, runner });
    } finally {
      logSpy.mockRestore();
    }

    expect(runner.events.filter((e) => e.executable === 'npm')).toHaveLength(0);
  });

  it('dry-run still invokes npm publish --dry-run', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'pp-cli-dry-run-'));
    workDirs.push(cwd);
    await makeFixture(cwd);
    const runner = recordingRunner();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await publishPackage({ cwd, version: '1.2.3', skipBuild: true, dryRun: true, runner });
    } finally {
      logSpy.mockRestore();
    }

    const npmPublishes = runner.events.filter((e) => e.executable === 'npm' && e.args[0] === 'publish');
    expect(npmPublishes).toHaveLength(1);
    expect(npmPublishes[0].args).toContain('--dry-run');
  });
});

describe('CLI misuse exits nonzero (ARTIFACT-05)', () => {
  const workDirs: string[] = [];
  const cliPath = resolve(__dirname, '..', 'dist', 'cli.js');

  afterEach(async () => {
    await Promise.all(workDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function makeFixture(): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), 'pp-cli-exit-'));
    workDirs.push(cwd);
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ name: '@example/widget', version: '1.0.0' }));
    return cwd;
  }

  function runCli(args: string[]) {
    return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
  }

  it('--version combined with --bump exits 1 before any subprocess or prompt', async () => {
    const cwd = await makeFixture();
    const outcome = runCli(['--cwd', cwd, '--version', '1.2.3', '--bump', 'patch']);
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toMatch(/mutually exclusive/);
  });

  it('an invalid --bump value exits 1', async () => {
    const cwd = await makeFixture();
    const outcome = runCli(['--cwd', cwd, '--bump', 'banana']);
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toMatch(/--bump must be one of "major", "minor", or "patch"/);
  });

  it('an unknown argument still exits 1', async () => {
    const cwd = await makeFixture();
    const outcome = runCli(['--cwd', cwd, '--allow-private', '--version', '1.2.3']);
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toMatch(/Unknown argument: --allow-private/);
  });
});

describe('package pack smoke (PPARC-03)', () => {
  const tempPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((p) => rm(p, { recursive: true, force: true })));
  });

  it('the configured files list keeps sources out of the published tarball and exposes the public API surface', async () => {
    const packDest = await mkdtemp(join(tmpdir(), 'pp-pack-smoke-'));
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

    // Source, tests, and config files must NOT leak into the tarball.
    expect(listing.some((entry) => entry.includes('/src/'))).toBe(false);
    expect(listing.some((entry) => entry.includes('/test/'))).toBe(false);
    expect(listing.some((entry) => entry.endsWith('/tsup.config.ts'))).toBe(false);
    expect(listing.some((entry) => entry.endsWith('/vitest.config.ts'))).toBe(false);
  });
});
