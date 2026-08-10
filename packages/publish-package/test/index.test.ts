import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createPublishPackageJson,
  inferNpmTag,
  parseFlags,
  publishPackage,
  resolvePublishPackagePlan,
  resolveCliOptions,
  promptForRequiredValue,
  canPrompt,
  INTERACTIVE_FLAG,
} from '../src/index';

const internalNames = new Set(['@repo-toolkit/changelog', '@repo-toolkit/publish-package']);

describe('inferNpmTag', () => {
  it('derives the preid from a prerelease version', () => {
    expect(inferNpmTag('1.2.3-beta.1')).toBe('beta');
  });

  it('returns undefined for stable versions', () => {
    expect(inferNpmTag('1.2.3')).toBeUndefined();
  });

  it('strips build metadata before deriving preid', () => {
    expect(inferNpmTag('1.2.3-beta.1+sha.abc')).toBe('beta');
  });

  it('handles a preid without a dotted numeric segment', () => {
    expect(inferNpmTag('1.2.3-alpha')).toBe('alpha');
  });

  it('handles a version without a numeric prerelease', () => {
    expect(inferNpmTag('1.0.0-rc')).toBe('rc');
  });

  it('strips a leading v before deriving preid', () => {
    expect(inferNpmTag('v1.2.3-beta.4')).toBe('beta');
  });
});

describe('parseFlags', () => {
  const specs = [
    { name: 'cwd' },
    { name: 'version', aliases: ['tag'] },
    { name: 'dry-run', boolean: true },
    { name: 'append', boolean: true, negatable: true },
    { name: 'filter', list: true },
    { name: 'include', repeatable: true },
    INTERACTIVE_FLAG,
    { name: 'out', aliases: ['o'] },
  ];

  it('returns null for -h', () => {
    expect(parseFlags(['-h'], specs)).toBeNull();
  });

  it('returns null for --help', () => {
    expect(parseFlags(['--help'], specs)).toBeNull();
  });

  it('parses --flag value and --flag=value forms', () => {
    const a = parseFlags(['--cwd', '/a'], specs);
    expect(a?.values.cwd).toBe('/a');

    const b = parseFlags(['--cwd=/b'], specs);
    expect(b?.values.cwd).toBe('/b');
  });

  it('resolves aliases to the canonical name', () => {
    const result = parseFlags(['--tag', '1.2.3'], specs);
    expect(result?.values.version).toBe('1.2.3');
  });

  it('stores boolean flags as "true"', () => {
    const result = parseFlags(['--dry-run'], specs);
    expect(result?.values['dry-run']).toBe('true');
  });

  it('negates negatable boolean flags via --no-<name>', () => {
    const result = parseFlags(['--no-append'], specs);
    expect(result?.values.append).toBe('false');
  });

  it('accumulates list flags across occurrences with comma splitting', () => {
    const result = parseFlags(['--filter', 'a,b', '--filter', 'c'], specs);
    expect(result?.repeat.filter).toEqual(['a', 'b', 'c']);
  });

  it('accumulates repeatable flags without comma splitting', () => {
    const result = parseFlags(['--include', 'x', '--include', 'y,z'], specs);
    expect(result?.repeat.include).toEqual(['x', 'y,z']);
  });

  it('throws on a missing value', () => {
    expect(() => parseFlags(['--cwd'], specs)).toThrowError(/Missing value for --cwd/);
  });

  it('throws when a value starts with "-"', () => {
    expect(() => parseFlags(['--cwd', '--version'], specs)).toThrowError(/Missing value for --cwd/);
  });

  it('accepts a value starting with "-" in the --flag=value form', () => {
    const result = parseFlags(['--cwd=-1'], specs);
    expect(result?.values.cwd).toBe('-1');
  });

  it('throws on unknown arguments in strict mode (default)', () => {
    expect(() => parseFlags(['--bogus'], specs)).toThrowError(/Unknown argument: --bogus/);
  });

  it('collects unknown arguments when strict is false', () => {
    const result = parseFlags(['--bogus'], specs, { strict: false });
    expect(result?.unknown).toEqual(['--bogus']);
  });

  it('rejects --flag=value on a boolean flag', () => {
    expect(() => parseFlags(['--dry-run=yes'], specs)).toThrowError(/Boolean flag --dry-run does not take a value/);
  });

  it('treats -- as a separator and parses subsequent flags normally', () => {
    expect(() => parseFlags(['--', '--cwd', '/x'], specs)).toThrowError(/Unknown argument: --cwd/);
  });

  it('collects post-separator args as unknown in non-strict mode', () => {
    const result = parseFlags(['--', '--cwd', '/x'], specs, { strict: false });
    expect(result?.unknown).toEqual(['--cwd', '/x']);
  });

  it('resolves a short boolean alias (-i) to the canonical name', () => {
    const result = parseFlags(['-i'], specs);
    expect(result?.values.interactive).toBe('true');
  });

  it('resolves a short value alias (-o) and consumes the next arg', () => {
    const result = parseFlags(['-o', '/out'], specs);
    expect(result?.values.out).toBe('/out');
  });

  it('accepts -alias=value form', () => {
    const result = parseFlags(['-o=/out'], specs);
    expect(result?.values.out).toBe('/out');
  });

  it('throws on unknown short flags', () => {
    expect(() => parseFlags(['-x'], specs)).toThrowError(/Unknown argument: -x/);
  });

  it('rejects duplicate canonical flag names and aliases', () => {
    expect(() => parseFlags([], [{ name: 'cwd' }, { name: 'cwd' }])).toThrowError(/Duplicate flag registration/);
    expect(() =>
      parseFlags(
        [],
        [
          { name: 'cwd', aliases: ['c'] },
          { name: 'config', aliases: ['c'] },
        ],
      ),
    ).toThrowError(/Duplicate flag registration/);
  });

  it('does not treat prototype keys as registered flags unless explicitly declared', () => {
    expect(() => parseFlags(['--constructor'], specs)).toThrowError(/Unknown argument: --constructor/);
  });
});

describe('canPrompt', () => {
  it('returns false when stdin is not a TTY', () => {
    const origStdin = process.stdin.isTTY;
    const origStdout = process.stdout.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    try {
      expect(canPrompt()).toBe(false);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: origStdin, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: origStdout, configurable: true });
    }
  });

  it('returns false when stdout is not a TTY', () => {
    const origStdin = process.stdin.isTTY;
    const origStdout = process.stdout.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    try {
      expect(canPrompt()).toBe(false);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: origStdin, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: origStdout, configurable: true });
    }
  });
});

describe('resolveCliOptions', () => {
  it('merges config values with CLI options, preferring CLI values', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-cli-config-'));

    try {
      const configPath = join(rootDir, 'publish-package.config.json');
      await writeFile(
        configPath,
        `${JSON.stringify({ cwd: '/config-cwd', version: '1.2.3', access: 'restricted' }, null, 2)}\n`,
      );

      const result = parseFlags(['--config', configPath, '--cwd', '/cli-cwd'], [{ name: 'config' }, { name: 'cwd' }]);

      expect(result).not.toBeNull();

      const merged = await resolveCliOptions<{ cwd?: string; version?: string; access?: string }>({
        result: result!,
        buildOptions: (flags) => ({ cwd: flags.values.cwd }),
      });

      expect(merged).toEqual({
        cwd: '/cli-cwd',
        version: '1.2.3',
        access: 'restricted',
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('promptForRequiredValue', () => {
  it('returns the provided value without prompting', async () => {
    await expect(
      promptForRequiredValue({
        value: '1.2.3',
        interactive: true,
        message: 'Target version:',
        missingMessage: 'missing',
      }),
    ).resolves.toBe('1.2.3');
  });

  it('throws the supplied error when prompting is unavailable', async () => {
    await expect(
      promptForRequiredValue({
        value: undefined,
        interactive: true,
        canPromptNow: false,
        message: 'Target version:',
        missingMessage: 'version is required',
      }),
    ).rejects.toThrowError(/version is required/);
  });
});

describe('createPublishPackageJson', () => {
  it('supports a custom versionPlaceholder override', () => {
    const out = createPublishPackageJson(
      {
        name: '@repo-toolkit/changelog',
        version: '__VERSION__',
        dependencies: {
          '@repo-toolkit/publish-package': '__VERSION__',
        },
      },
      {
        version: '1.2.3',
        internalPackageNames: internalNames,
        rewrite: { versionPlaceholder: '__VERSION__' },
      },
    );

    expect(out.version).toBe('1.2.3');
    expect(out.dependencies).toEqual({
      '@repo-toolkit/publish-package': '1.2.3',
    });
  });

  it('rewrites dist/ paths in main/module/types/bin/exports', () => {
    const out = createPublishPackageJson(
      {
        name: '@repo-toolkit/publish-package',
        version: '0.0.0-PLACEHOLDER',
        main: 'dist/index.js',
        types: 'dist/index.d.ts',
        bin: {
          'repo-toolkit-publish-package': 'dist/cli.js',
        },
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js',
          },
        },
      },
      {
        version: '1.2.3',
        internalPackageNames: internalNames,
      },
    );

    expect(out.main).toBe('./index.js');
    expect(out.types).toBe('./index.d.ts');
    expect(out.bin).toEqual({
      'repo-toolkit-publish-package': './cli.js',
    });
    expect(out.exports).toEqual({
      '.': {
        types: './index.d.ts',
        import: './index.js',
      },
    });
  });

  it('rewrites paths using a configurable publishDir', () => {
    const out = createPublishPackageJson(
      {
        name: '@repo-toolkit/publish-package',
        version: '0.0.0-PLACEHOLDER',
        main: 'build/index.js',
        types: 'build/index.d.ts',
        bin: { cli: 'build/cli.js' },
      },
      {
        version: '1.2.3',
        internalPackageNames: internalNames,
        rewrite: { publishDir: 'build' },
      },
    );

    expect(out.main).toBe('./index.js');
    expect(out.types).toBe('./index.d.ts');
    expect(out.bin).toEqual({ cli: './cli.js' });
  });

  it('injects a files field that excludes sourcemaps', () => {
    const out = createPublishPackageJson(
      {
        name: '@repo-toolkit/publish-package',
        version: '0.0.0-PLACEHOLDER',
      },
      {
        version: '1.2.3',
        internalPackageNames: internalNames,
      },
    );

    expect(out.files).toEqual(['**/*', '!**/*.map']);
  });

  it('merges root metadata fields', () => {
    const out = createPublishPackageJson(
      {
        name: '@repo-toolkit/publish-package',
        version: '0.0.0-PLACEHOLDER',
      },
      {
        version: '1.2.3',
        internalPackageNames: internalNames,
        rootMetadata: {
          author: 'Junmin Ahn',
          license: 'Apache-2.0',
          engines: { node: '>=20' },
        },
      },
    );

    expect(out.author).toBe('Junmin Ahn');
    expect(out.license).toBe('Apache-2.0');
    expect(out.engines).toEqual({ node: '>=20' });
  });

  it('rewrites array-form exports entries leaf by leaf', () => {
    const out = createPublishPackageJson(
      {
        name: '@repo-toolkit/publish-package',
        version: '0.0.0-PLACEHOLDER',
        exports: {
          '.': [{ types: ['./dist/index.d.ts'], import: './dist/index.js' }, './dist/index.cjs'],
          './tools': ['./dist/tools.js', { import: './dist/tools.mjs' }],
        },
      },
      {
        version: '1.2.3',
        internalPackageNames: internalNames,
      },
    );

    expect(out.exports).toEqual({
      '.': [{ types: ['./index.d.ts'], import: './index.js' }, './index.cjs'],
      './tools': ['./tools.js', { import: './tools.mjs' }],
    });
  });

  it('rewrites imports paths', () => {
    const out = createPublishPackageJson(
      {
        name: '@repo-toolkit/publish-package',
        version: '0.0.0-PLACEHOLDER',
        imports: {
          '#internal': './dist/internal.js',
          '#shared': {
            import: './dist/shared.mjs',
            default: './dist/shared.cjs',
          },
        },
      },
      {
        version: '1.2.3',
        internalPackageNames: internalNames,
      },
    );

    expect(out.imports).toEqual({
      '#internal': './internal.js',
      '#shared': {
        import: './shared.mjs',
        default: './shared.cjs',
      },
    });
  });
});

describe('createPublishPackageJson validation', () => {
  it('rejects a non-object exports value', () => {
    expect(() =>
      createPublishPackageJson(
        {
          name: '@repo-toolkit/publish-package',
          version: '0.0.0-PLACEHOLDER',
          exports: 42,
        },
        {
          version: '1.2.3',
          internalPackageNames: internalNames,
        },
      ),
    ).toThrow(/Unsupported exports type/);
  });

  it('rejects an unsupported bin type', () => {
    expect(() =>
      createPublishPackageJson(
        {
          name: '@repo-toolkit/publish-package',
          version: '0.0.0-PLACEHOLDER',
          bin: 42,
        },
        {
          version: '1.2.3',
          internalPackageNames: internalNames,
        },
      ),
    ).toThrow(/Unsupported bin type/);
  });

  it('rejects a non-string bin entry', () => {
    expect(() =>
      createPublishPackageJson(
        {
          name: '@repo-toolkit/publish-package',
          version: '0.0.0-PLACEHOLDER',
          bin: { cli: 42 },
        },
        {
          version: '1.2.3',
          internalPackageNames: internalNames,
        },
      ),
    ).toThrow(/Unsupported bin.cli type/);
  });

  it('rejects unresolved workspace:* ranges in final manifests', () => {
    expect(() =>
      createPublishPackageJson(
        {
          name: '@repo-toolkit/publish-package',
          version: '0.0.0-PLACEHOLDER',
          dependencies: {
            '@repo-toolkit/some-thing': 'workspace:*',
            lodash: '^4.0.0',
          },
        },
        {
          version: '1.2.3',
          internalPackageNames: new Set<string>(),
        },
      ),
    ).toThrow(/Unresolved workspace: range/);
  });

  it('rejects a non-string main value', () => {
    expect(() =>
      createPublishPackageJson(
        {
          name: '@repo-toolkit/publish-package',
          version: '0.0.0-PLACEHOLDER',
          main: 42,
        },
        {
          version: '1.2.3',
          internalPackageNames: internalNames,
        },
      ),
    ).toThrow(/value.replace is not a function|Invalid main/);
  });
});

describe('resolvePublishPackagePlan', () => {
  it('requires an explicit version when package.json.version still uses the placeholder', () => {
    const cwd = process.cwd();

    expect(() => resolvePublishPackagePlan({ cwd })).toThrowError(
      /version is required when package\.json\.version uses the version placeholder/,
    );
  });

  it('uses package.json.version when a real version is already present', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-publish-package-plan-'));

    try {
      await writeFile(
        join(rootDir, 'package.json'),
        `${JSON.stringify({ name: '@example/pkg', version: '1.2.3' }, null, 2)}\n`,
      );

      const plan = resolvePublishPackagePlan({ cwd: rootDir });

      expect(plan.version).toBe('1.2.3');
      expect(plan.npmTag).toBeUndefined();
      expect(plan.publishDir).toBe('dist');
      expect(plan.versionPlaceholder).toBe('0.0.0-PLACEHOLDER');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('resolves custom publishDir and versionPlaceholder values', () => {
    const cwd = process.cwd();

    const plan = resolvePublishPackagePlan({
      cwd,
      version: 'v1.2.3',
      publishDir: 'build-artifacts',
      versionPlaceholder: '__VERSION__',
    });

    expect(plan.version).toBe('1.2.3');
    expect(plan.publishDir).toBe('build-artifacts');
    expect(plan.versionPlaceholder).toBe('__VERSION__');
  });

  it('rejects publishDir values that escape the package root', () => {
    const cwd = process.cwd();

    expect(() =>
      resolvePublishPackagePlan({
        cwd,
        version: '1.2.3',
        publishDir: '../outside',
      }),
    ).toThrowError(/publishDir must not contain parent-directory segments/);
  });

  it('appends includePackageFiles to defaults', () => {
    const cwd = process.cwd();

    const plan = resolvePublishPackagePlan({
      cwd,
      version: '1.2.3',
      includePackageFiles: ['llms.txt', 'extra.md'],
    });

    expect(plan.packageFiles).toEqual(['README.md', 'CHANGELOG.md', 'llms.txt', 'llms.txt', 'extra.md']);
  });

  it('replaces defaults when noDefaultPackageFiles is set', () => {
    const cwd = process.cwd();

    const plan = resolvePublishPackagePlan({
      cwd,
      version: '1.2.3',
      noDefaultPackageFiles: true,
      packageFiles: ['only-this.md'],
    });

    expect(plan.packageFiles).toEqual(['only-this.md']);
  });
});

describe('resolvePublishPackagePlan source validation', () => {
  it('rejects a non-object name field', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pp-manifest-'));
    try {
      await writeFile(join(rootDir, 'package.json'), `${JSON.stringify({ name: 42, version: '1.0.0' })}\n`);
      expect(() => resolvePublishPackagePlan({ cwd: rootDir, skipBuild: true, dryRun: true })).toThrow(
        /name must be a non-empty string/,
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects an additionalNames entry that is not a string', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pp-manifest-'));
    try {
      await writeFile(
        join(rootDir, 'package.json'),
        `${JSON.stringify({ name: '@ex/pkg', additionalNames: ['@ex/ok', 42], version: '1.0.0' })}\n`,
      );
      expect(() => resolvePublishPackagePlan({ cwd: rootDir, skipBuild: true, dryRun: true })).toThrow(
        /additionalNames must be non-empty strings/,
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects a malformed (non-object) dependencies field', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pp-manifest-'));
    try {
      await writeFile(
        join(rootDir, 'package.json'),
        `${JSON.stringify({ name: '@ex/pkg', version: '1.0.0', dependencies: ['bad'] })}\n`,
      );
      expect(() => resolvePublishPackagePlan({ cwd: rootDir, skipBuild: true, dryRun: true })).toThrow(
        /dependencies must be an object/,
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects a null exports value', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pp-manifest-'));
    try {
      await writeFile(
        join(rootDir, 'package.json'),
        `${JSON.stringify({ name: '@ex/pkg', version: '1.0.0', exports: null })}\n`,
      );
      expect(() => resolvePublishPackagePlan({ cwd: rootDir, skipBuild: true, dryRun: true })).toThrow(
        /exports must not be null/,
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects non-object imports field', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pp-manifest-'));
    try {
      await writeFile(
        join(rootDir, 'package.json'),
        `${JSON.stringify({ name: '@ex/pkg', version: '1.0.0', imports: 'bad' })}\n`,
      );
      expect(() => resolvePublishPackagePlan({ cwd: rootDir, skipBuild: true, dryRun: true })).toThrow(
        /imports must be an object/,
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects a non-numeric additionalNames entry', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pp-manifest-num'));
    try {
      await writeFile(
        join(rootDir, 'package.json'),
        `${JSON.stringify({ name: '@ex/pkg', version: '1.0.0', additionalNames: [42] })}\n`,
      );
      expect(() => resolvePublishPackagePlan({ cwd: rootDir, skipBuild: true, dryRun: true })).toThrow(
        /additionalNames must be non-empty strings/,
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('publishPackage copy collisions', () => {
  it('rejects two distinct sources that flatten to the same basename', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pp-collision-'));
    try {
      await mkdir(join(rootDir, 'dist'), { recursive: true });
      await mkdir(join(rootDir, 'docs'), { recursive: true });
      await writeFile(join(rootDir, 'package.json'), `${JSON.stringify({ name: '@ex/pkg', version: '1.0.0' })}\n`);
      await writeFile(join(rootDir, 'dist', 'index.js'), 'export {}\n');
      await writeFile(join(rootDir, 'README.md'), 'readme\n');
      await writeFile(join(rootDir, 'docs', 'README.md'), 'docs readme\n');

      expect(() =>
        publishPackage({
          cwd: rootDir,
          skipBuild: true,
          dryRun: true,
          includePackageFiles: ['docs/README.md'],
        }),
      ).toThrow(/Copy destination collision/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects identical duplicate source entries', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pp-dup-'));
    try {
      await mkdir(join(rootDir, 'dist'), { recursive: true });
      await writeFile(join(rootDir, 'package.json'), `${JSON.stringify({ name: '@ex/pkg', version: '1.0.0' })}\n`);
      await writeFile(join(rootDir, 'dist', 'index.js'), 'export {}\n');

      expect(() =>
        publishPackage({
          cwd: rootDir,
          skipBuild: true,
          dryRun: true,
          includePackageFiles: ['README.md', 'README.md'],
        }),
      ).toThrow(/Duplicate copy entry/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('publishPackage', () => {
  it('writes a publish-ready package.json and copies files in dry-run mode (last additionalName wins)', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-publish-package-'));
    const publishDir = join(rootDir, 'artifacts', 'npm');

    try {
      await mkdir(publishDir, { recursive: true });
      await mkdir(join(rootDir, 'docs'), { recursive: true });
      await writeFile(
        join(rootDir, 'package.json'),
        `${JSON.stringify(
          {
            name: '@example/pkg',
            additionalNames: ['@example/pkg-alt'],
            version: '1.2.3',
            main: 'artifacts/npm/index.js',
            types: 'artifacts/npm/index.d.ts',
          },
          null,
          2,
        )}\n`,
      );
      await writeFile(join(rootDir, 'README.md'), '# Example\n');
      await writeFile(join(rootDir, 'CHANGELOG.md'), '# Changelog\n');
      await writeFile(join(rootDir, 'docs', 'NOTICE.md'), 'Nested notice\n');
      await writeFile(join(rootDir, 'LICENSE'), 'Apache-2.0\n');
      await writeFile(join(publishDir, 'index.js'), 'export {}\n');
      await writeFile(join(publishDir, 'index.d.ts'), 'export {};\n');

      publishPackage({
        cwd: rootDir,
        version: '1.2.3',
        publishDir: 'artifacts/npm',
        includePackageFiles: ['docs/NOTICE.md'],
        skipBuild: true,
        dryRun: true,
      });

      // The loop writes package.json N times (once per name); the last write
      // wins, so the file on disk has the last additionalName.
      const publishPackageJson = JSON.parse(await readFile(join(publishDir, 'package.json'), 'utf8'));
      expect(publishPackageJson.name).toBe('@example/pkg-alt');
      expect(publishPackageJson.main).toBe('./index.js');
      expect(publishPackageJson.files).toEqual(['**/*', '!**/*.map']);
      expect(existsSync(join(publishDir, 'README.md'))).toBe(true);
      expect(existsSync(join(publishDir, 'CHANGELOG.md'))).toBe(true);
      expect(existsSync(join(publishDir, 'NOTICE.md'))).toBe(true);
      expect(existsSync(join(publishDir, 'LICENSE'))).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects private packages before writing to the publish directory', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-publish-package-private-'));

    try {
      await writeFile(
        join(rootDir, 'package.json'),
        `${JSON.stringify({ name: '@example/pkg', version: '1.2.3', private: true })}\n`,
      );

      expect(() =>
        publishPackage({
          cwd: rootDir,
          skipBuild: true,
          dryRun: true,
        }),
      ).toThrowError(/Refusing to publish private package/);
      expect(existsSync(join(rootDir, 'dist', 'package.json'))).toBe(false);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects traversal copy sources before modifying the publish directory', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-publish-package-traversal-'));
    const outsideFile = join(rootDir, '..', 'outside.txt');

    try {
      await mkdir(join(rootDir, 'dist'), { recursive: true });
      await writeFile(join(rootDir, 'package.json'), `${JSON.stringify({ name: '@example/pkg', version: '1.2.3' })}\n`);
      await writeFile(join(rootDir, 'dist', 'index.js'), 'export {}\n');
      await writeFile(outsideFile, 'marker\n');

      expect(() =>
        publishPackage({
          cwd: rootDir,
          skipBuild: true,
          dryRun: true,
          includePackageFiles: ['../outside.txt'],
        }),
      ).toThrowError(/parent-directory segments/);
      expect(existsSync(join(rootDir, 'dist', 'outside.txt'))).toBe(false);
      await expect(readFile(outsideFile, 'utf8')).resolves.toBe('marker\n');
    } finally {
      await rm(outsideFile, { force: true });
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects symlinked copy sources that escape the package root', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-publish-package-symlink-source-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-publish-package-outside-'));

    try {
      await mkdir(join(rootDir, 'dist'), { recursive: true });
      await mkdir(join(rootDir, 'docs'), { recursive: true });
      await writeFile(join(rootDir, 'package.json'), `${JSON.stringify({ name: '@example/pkg', version: '1.2.3' })}\n`);
      await writeFile(join(rootDir, 'dist', 'index.js'), 'export {}\n');
      await writeFile(join(outsideDir, 'secret.md'), 'secret\n');
      await symlink(join(outsideDir, 'secret.md'), join(rootDir, 'docs', 'secret.md'));

      expect(() =>
        publishPackage({
          cwd: rootDir,
          skipBuild: true,
          dryRun: true,
          includePackageFiles: ['docs/secret.md'],
        }),
      ).toThrowError(/escapes the package root/);
      expect(existsSync(join(rootDir, 'dist', 'secret.md'))).toBe(false);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects publishDir symlinks that escape the package root before running the build', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-publish-package-symlink-dist-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-publish-package-dest-outside-'));
    const markerPath = join(rootDir, 'build-ran.txt');

    try {
      await writeFile(join(rootDir, 'package.json'), `${JSON.stringify({ name: '@example/pkg', version: '1.2.3' })}\n`);
      await symlink(outsideDir, join(rootDir, 'dist'));

      expect(() =>
        publishPackage({
          cwd: rootDir,
          buildCommand: `touch ${JSON.stringify(markerPath)}`,
          dryRun: true,
        }),
      ).toThrowError(/publish directory escapes the package root/);
      expect(existsSync(markerPath)).toBe(false);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
