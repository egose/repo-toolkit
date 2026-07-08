import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { inferNpmTag, resolvePublishPackagesPlan, sortPackagesByInternalDependencies } from '../src/index';

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
  it('preserves internalPackageNames from the full discovered set under --filter', () => {
    const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

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
    expect(plan.publishDir).toBe('dist');
    expect(plan.versionPlaceholder).toBe('0.0.0-PLACEHOLDER');
    expect(plan.buildCommand).toBe('pnpm build');
    expect(plan.version).toBe('1.2.3');
    expect(plan.npmTag).toBeUndefined();
  });

  it('infers the npmTag from a prerelease version', () => {
    const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

    const plan = resolvePublishPackagesPlan({
      version: 'v2.0.0-beta.3',
      cwd: repoRoot,
      filters: ['publish-packages'],
    });

    expect(plan.npmTag).toBe('beta');
  });

  it('resolves custom shared publish options', () => {
    const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

    const plan = resolvePublishPackagesPlan({
      version: 'v1.2.3',
      cwd: repoRoot,
      filters: ['publish-packages'],
      publishDir: 'build-artifacts',
      versionPlaceholder: '__VERSION__',
      buildCommand: 'pnpm bundle',
      skipBuild: true,
      packageFiles: ['README.md'],
      rootFiles: ['LICENSE', 'NOTICE'],
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
    expect(plan.rootFiles).toEqual(['LICENSE', 'NOTICE']);
    expect(plan.access).toBe('restricted');
    expect(plan.registry).toBe('https://registry.example.com');
    expect(plan.otp).toBe('123456');
    expect(plan.provenance).toBe(true);
    expect(plan.dryRun).toBe(true);
  });
});
