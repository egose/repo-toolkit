import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  inferNpmTag,
  publishPackages,
  resolvePublishPackagesPlan,
  sortPackagesByInternalDependencies,
} from '../src/index';

const internalNames = new Set(['@repo-toolkit/changelog', '@repo-toolkit/publish-packages']);

describe('inferNpmTag', () => {
  it('derives the preid from a prerelease version', () => {
    expect(inferNpmTag('1.2.3-beta.1')).toBe('beta');
  });

  it('returns undefined for stable versions', () => {
    expect(inferNpmTag('1.2.3')).toBeUndefined();
  });
});

describe('sortPackagesByInternalDependencies', () => {
  it('orders dependencies before dependents', () => {
    const packages = [
      {
        dir: '/repo/packages/publish-packages',
        packageJson: {
          name: '@repo-toolkit/publish-packages',
          dependencies: { '@repo-toolkit/changelog': 'workspace:*' },
        },
      },
      {
        dir: '/repo/packages/changelog',
        packageJson: { name: '@repo-toolkit/changelog' },
      },
    ];

    const sorted = sortPackagesByInternalDependencies(packages, internalNames);

    expect(sorted[0].packageJson.name).toBe('@repo-toolkit/changelog');
    expect(sorted[1].packageJson.name).toBe('@repo-toolkit/publish-packages');
  });

  it('throws with the cycle path on circular deps', () => {
    const names = new Set(['a', 'b']);
    const packages = [
      {
        dir: '/repo/packages/a',
        packageJson: { name: 'a', dependencies: { b: 'workspace:*' } },
      },
      {
        dir: '/repo/packages/b',
        packageJson: { name: 'b', dependencies: { a: 'workspace:*' } },
      },
    ];

    expect(() => sortPackagesByInternalDependencies(packages, names)).toThrowError(
      /Circular internal dependency detected: a -> b -> a/,
    );
  });
});

describe('resolvePublishPackagesPlan', () => {
  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

  it('preserves internalPackageNames from the full discovered set under --filter', () => {
    const plan = resolvePublishPackagesPlan({
      version: 'v1.2.3',
      cwd: repoRoot,
      filters: ['publish-packages'],
    });

    expect(plan.internalPackageNames.has('@repo-toolkit/changelog')).toBe(true);
    expect(plan.packages).toHaveLength(1);
    expect(plan.packages[0].packageJson.name).toBe('@repo-toolkit/publish-packages');
    expect([...plan.rootFiles]).toEqual(['LICENSE']);
    expect([...plan.packageFiles]).toEqual(['README.md', 'CHANGELOG.md', 'llms.txt']);
    expect(plan.includePackageFiles).toEqual([]);
    expect(plan.noDefaultPackageFiles).toBe(false);
    expect(plan.includeRootFiles).toEqual([]);
    expect(plan.noDefaultRootFiles).toBe(false);
    expect(plan.publishDir).toBe('dist');
    expect(plan.versionPlaceholder).toBe('0.0.0-PLACEHOLDER');
    expect(plan.buildCommand).toBe('pnpm build');
    expect(plan.version).toBe('1.2.3');
    expect(plan.npmTag).toBeUndefined();
  });

  it('infers the npmTag from a prerelease version', () => {
    const plan = resolvePublishPackagesPlan({
      version: 'v2.0.0-beta.3',
      cwd: repoRoot,
      filters: ['publish-packages'],
    });

    expect(plan.npmTag).toBe('beta');
  });

  it('resolves custom shared publish options including include/no-default', () => {
    const plan = resolvePublishPackagesPlan({
      version: 'v1.2.3',
      cwd: repoRoot,
      filters: ['publish-packages'],
      publishDir: 'build-artifacts',
      versionPlaceholder: '__VERSION__',
      buildCommand: 'pnpm bundle',
      skipBuild: true,
      packageFiles: ['README.md'],
      includePackageFiles: ['extra.md'],
      noDefaultPackageFiles: false,
      rootFiles: ['LICENSE', 'NOTICE'],
      includeRootFiles: ['FOO'],
      noDefaultRootFiles: false,
      access: 'restricted',
      registry: 'https://registry.example.com',
      otp: '123456',
      provenance: true,
      dryRun: true,
    });

    expect(plan.publishDir).toBe('build-artifacts');
    expect(plan.versionPlaceholder).toBe('__VERSION__');
    expect(plan.buildCommand).toBe('pnpm bundle');
    expect(plan.skipBuild).toBe(true);
    expect(plan.packageFiles).toEqual(['README.md']);
    expect(plan.includePackageFiles).toEqual(['extra.md']);
    expect(plan.noDefaultPackageFiles).toBe(false);
    expect(plan.rootFiles).toEqual(['LICENSE', 'NOTICE']);
    expect(plan.includeRootFiles).toEqual(['FOO']);
    expect(plan.noDefaultRootFiles).toBe(false);
    expect(plan.access).toBe('restricted');
    expect(plan.registry).toBe('https://registry.example.com');
    expect(plan.otp).toBe('123456');
    expect(plan.provenance).toBe(true);
    expect(plan.dryRun).toBe(true);
  });
});

describe('publishPackages (integration, dry-run)', () => {
  it('builds, writes package.json, and runs npm publish --dry-run for each package', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-publish-packages-'));

    try {
      // Create a minimal monorepo fixture
      await mkdir(join(rootDir, 'packages', 'pkg-a'), { recursive: true });
      await mkdir(join(rootDir, 'packages', 'pkg-a', 'dist'), { recursive: true });

      await writeFile(
        join(rootDir, 'package.json'),
        `${JSON.stringify({ name: 'monorepo', private: true, license: 'MIT' }, null, 2)}\n`,
      );
      await writeFile(
        join(rootDir, 'packages', 'pkg-a', 'package.json'),
        `${JSON.stringify({ name: '@example/pkg-a', version: '1.2.3', main: 'dist/index.js' }, null, 2)}\n`,
      );
      await writeFile(join(rootDir, 'packages', 'pkg-a', 'dist', 'index.js'), 'export {}\n');
      await writeFile(join(rootDir, 'packages', 'pkg-a', 'README.md'), '# pkg-a\n');
      await writeFile(join(rootDir, 'LICENSE'), 'MIT\n');

      publishPackages({
        version: '1.2.3',
        cwd: rootDir,
        filters: ['pkg-a'],
        skipBuild: true,
        dryRun: true,
      });

      const publishPkgJson = JSON.parse(
        await readFile(join(rootDir, 'packages', 'pkg-a', 'dist', 'package.json'), 'utf8'),
      );
      expect(publishPkgJson.name).toBe('@example/pkg-a');
      expect(publishPkgJson.main).toBe('./index.js');
      expect(publishPkgJson.files).toEqual(['**/*', '!**/*.map']);
      expect(publishPkgJson.license).toBe('MIT');
      expect(existsSync(join(rootDir, 'packages', 'pkg-a', 'dist', 'README.md'))).toBe(true);
      expect(existsSync(join(rootDir, 'packages', 'pkg-a', 'dist', 'LICENSE'))).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);
});
