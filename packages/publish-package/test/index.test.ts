import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createPublishPackageJson, inferNpmTag, publishPackage, resolvePublishPackagePlan } from '../src/index';

const internalNames = new Set(['@repo-toolkit/changelog', '@repo-toolkit/publish-package']);

describe('inferNpmTag', () => {
  it('derives the preid from a prerelease version', () => {
    expect(inferNpmTag('1.2.3-beta.1')).toBe('beta');
  });

  it('returns undefined for stable versions', () => {
    expect(inferNpmTag('1.2.3')).toBeUndefined();
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
      '1.2.3',
      internalNames,
      {},
      {
        versionPlaceholder: '__VERSION__',
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
      '1.2.3',
      internalNames,
      {},
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
});

describe('publishPackage', () => {
  it('writes a publish-ready package.json and copies files in dry-run mode', async () => {
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
        dryRun: true,
      });

      const publishPackageJson = JSON.parse(await readFile(join(publishDir, 'package.json'), 'utf8'));
      expect(publishPackageJson.name).toBe('@example/pkg-alt');
      expect(publishPackageJson.main).toBe('./index.js');
      expect(existsSync(join(publishDir, 'README.md'))).toBe(true);
      expect(existsSync(join(publishDir, 'CHANGELOG.md'))).toBe(true);
      expect(existsSync(join(publishDir, 'LICENSE'))).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
