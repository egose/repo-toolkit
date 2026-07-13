import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
    const result = parseFlags(['--', '--cwd', '/x'], specs);
    expect(result?.values.cwd).toBe('/x');
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

describe('publishPackage', () => {
  it('writes a publish-ready package.json and copies files in dry-run mode (last additionalName wins)', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-publish-package-'));
    const publishDir = join(rootDir, 'dist');

    try {
      await mkdir(publishDir, { recursive: true });
      await writeFile(
        join(rootDir, 'package.json'),
        `${JSON.stringify(
          {
            name: '@example/pkg',
            additionalNames: ['@example/pkg-alt'],
            version: '1.2.3',
            main: 'dist/index.js',
            types: 'dist/index.d.ts',
          },
          null,
          2,
        )}\n`,
      );
      await writeFile(join(rootDir, 'README.md'), '# Example\n');
      await writeFile(join(rootDir, 'CHANGELOG.md'), '# Changelog\n');
      await writeFile(join(rootDir, 'LICENSE'), 'Apache-2.0\n');
      await writeFile(join(publishDir, 'index.js'), 'export {}\n');
      await writeFile(join(publishDir, 'index.d.ts'), 'export {};\n');

      publishPackage({
        cwd: rootDir,
        version: '1.2.3',
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
      expect(existsSync(join(publishDir, 'LICENSE'))).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
