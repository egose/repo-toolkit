import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  createPublishPackageJson,
  inferNpmTag,
  resolvePublishPlan,
  sortPackagesByInternalDependencies,
} from '../src/index';

const internalNames = new Set(['@repo-toolkit/changelog', '@repo-toolkit/publish-all']);

describe('inferNpmTag', () => {
  it('derives the preid from a prerelease version', () => {
    expect(inferNpmTag('1.2.3-beta.1')).toBe('beta');
    expect(inferNpmTag('1.2.3-alpha.4')).toBe('alpha');
    expect(inferNpmTag('1.2.3-rc.0')).toBe('rc');
  });

  it('returns undefined for stable versions', () => {
    expect(inferNpmTag('1.2.3')).toBeUndefined();
    expect(inferNpmTag('0.0.0')).toBeUndefined();
  });

  it('is defensive against non-strings', () => {
    expect(inferNpmTag(undefined as unknown as string)).toBeUndefined();
    expect(inferNpmTag('')).toBeUndefined();
  });
});

describe('createPublishPackageJson', () => {
  it('replaces 0.0.0-PLACEHOLDER with the target version', () => {
    const out = createPublishPackageJson(
      {
        name: '@repo-toolkit/changelog',
        version: '0.0.0-PLACEHOLDER',
      },
      '1.2.3',
      internalNames,
      {},
    );

    expect(out.version).toBe('1.2.3');
    expect(out.name).toBe('@repo-toolkit/changelog');
  });

  it('supports a custom versionPlaceholder override', () => {
    const out = createPublishPackageJson(
      {
        name: '@repo-toolkit/changelog',
        version: '__VERSION__',
        dependencies: {
          '@repo-toolkit/publish-all': '__VERSION__',
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
      '@repo-toolkit/publish-all': '1.2.3',
    });
  });

  it('rewrites workspace:* ranges on internal deps to the target version', () => {
    const out = createPublishPackageJson(
      {
        name: '@repo-toolkit/publish-all',
        version: '0.0.0-PLACEHOLDER',
        dependencies: {
          '@repo-toolkit/changelog': 'workspace:*',
          'conventional-changelog': '^7.2.1',
        },
      },
      '1.2.3',
      internalNames,
      {},
    );

    expect(out.dependencies).toEqual({
      '@repo-toolkit/changelog': '1.2.3',
      'conventional-changelog': '^7.2.1',
    });
  });

  it('rewrites workspace:^ / workspace:~ to prefixed ranges', () => {
    const out = createPublishPackageJson(
      {
        name: '@repo-toolkit/publish-all',
        version: '0.0.0-PLACEHOLDER',
        dependencies: {
          '@repo-toolkit/changelog': 'workspace:^',
        },
        peerDependencies: {
          '@repo-toolkit/changelog': 'workspace:~',
        },
      },
      '1.2.3',
      internalNames,
      {},
    );

    expect(out.dependencies['@repo-toolkit/changelog']).toBe('^1.2.3');
    expect(out.peerDependencies['@repo-toolkit/changelog']).toBe('~1.2.3');
  });

  it('keeps pinned workspace ranges verbatim', () => {
    const out = createPublishPackageJson(
      {
        name: '@repo-toolkit/publish-all',
        version: '0.0.0-PLACEHOLDER',
        dependencies: {
          '@repo-toolkit/changelog': 'workspace:1.5.0',
        },
      },
      '1.2.3',
      internalNames,
      {},
    );

    expect(out.dependencies['@repo-toolkit/changelog']).toBe('1.5.0');
  });

  it('leaves external workspace: ranges untouched', () => {
    const out = createPublishPackageJson(
      {
        name: '@repo-toolkit/publish-all',
        version: '0.0.0-PLACEHOLDER',
        dependencies: {
          'some-external-pkg': 'workspace:^1.0.0',
        },
      },
      '1.2.3',
      internalNames,
      {},
    );

    expect(out.dependencies['some-external-pkg']).toBe('workspace:^1.0.0');
  });

  it('rewrites dist/ paths in main/module/types/exports', () => {
    const out = createPublishPackageJson(
      {
        name: '@repo-toolkit/publish-all',
        version: '0.0.0-PLACEHOLDER',
        main: 'dist/index.js',
        types: 'dist/index.d.ts',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            import: './dist/index.js',
          },
          './package.json': './package.json',
        },
      },
      '1.2.3',
      internalNames,
      {},
    );

    expect(out.main).toBe('./index.js');
    expect(out.types).toBe('./index.d.ts');
    expect(out.exports).toEqual({
      '.': {
        types: './index.d.ts',
        import: './index.js',
      },
      './package.json': './package.json',
    });
  });

  it('drops omitted fields and merges root metadata', () => {
    const out = createPublishPackageJson(
      {
        name: '@repo-toolkit/publish-all',
        version: '0.0.0-PLACEHOLDER',
        private: true,
        devDependencies: { vitest: '^4.0.0' },
        files: ['dist'],
        scripts: { build: 'tsup' },
      },
      '1.2.3',
      internalNames,
      {
        author: 'Junmin Ahn',
        license: 'Apache-2.0',
        engines: { node: '>=20' },
      },
    );

    expect(out).not.toHaveProperty('private');
    expect(out).not.toHaveProperty('devDependencies');
    expect(out).not.toHaveProperty('files');
    expect(out).not.toHaveProperty('scripts');
    expect(out.author).toBe('Junmin Ahn');
    expect(out.license).toBe('Apache-2.0');
    expect(out.engines).toEqual({ node: '>=20' });
  });

  it('merges repository with per-package directory when supplied by caller', () => {
    const out = createPublishPackageJson(
      {
        name: '@repo-toolkit/publish-all',
        version: '0.0.0-PLACEHOLDER',
      },
      '1.2.3',
      internalNames,
      {
        repository: {
          type: 'git',
          url: 'https://github.com/egose/repo-toolkit',
          directory: 'packages/publish-all',
        },
      },
    );

    expect(out.repository).toEqual({
      type: 'git',
      url: 'https://github.com/egose/repo-toolkit',
      directory: 'packages/publish-all',
    });
  });
});

describe('sortPackagesByInternalDependencies', () => {
  it('orders dependencies before dependents', () => {
    const packages = [
      {
        dir: '/repo/packages/publish-all',
        packageJson: {
          name: '@repo-toolkit/publish-all',
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
    expect(sorted[1].packageJson.name).toBe('@repo-toolkit/publish-all');
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

describe('resolvePublishPlan', () => {
  it('preserves internalPackageNames from the FULL discovered set under --filter', () => {
    // The fixture monorepo at the repo root has both `changelog` and
    // `publish-all`. With `--filter publish-all`, the plan's package list is
    // narrowed to `publish-all`, but `internalPackageNames` must still contain
    // `changelog` so workspace ranges on it can be rewritten to a real version.
    const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

    const plan = resolvePublishPlan({
      tag: 'v1.2.3',
      cwd: repoRoot,
      filters: ['publish-all'],
    });

    expect(plan.internalPackageNames.has('@repo-toolkit/changelog')).toBe(true);
    expect(plan.packages).toHaveLength(1);
    expect(plan.packages[0].packageJson.name).toBe('@repo-toolkit/publish-all');
    expect([...plan.rootFiles]).toEqual(['LICENSE']);
    expect(plan.publishDir).toBe('dist');
    expect(plan.versionPlaceholder).toBe('0.0.0-PLACEHOLDER');
    expect(plan.version).toBe('1.2.3');
    expect(plan.npmTag).toBeUndefined();
  });

  it('resolves custom publishDir and versionPlaceholder values', () => {
    const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

    const plan = resolvePublishPlan({
      tag: 'v1.2.3',
      cwd: repoRoot,
      filters: ['publish-all'],
      publishDir: 'build-artifacts',
      versionPlaceholder: '__VERSION__',
    });

    expect(plan.publishDir).toBe('build-artifacts');
    expect(plan.versionPlaceholder).toBe('__VERSION__');
  });

  it('infers the npmTag from a prerelease version', () => {
    const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

    const plan = resolvePublishPlan({
      tag: 'v2.0.0-beta.3',
      cwd: repoRoot,
      filters: ['publish-all'],
    });

    expect(plan.npmTag).toBe('beta');
  });
});
