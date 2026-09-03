import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  inferNpmTag,
  publishPackages,
  resolvePublishPackagesPlan,
  sortPackagesByInternalDependencies,
  type ProcessRunner,
} from '../src/index';

const internalNames = new Set(['@repo-toolkit/changelog', '@repo-toolkit/publish-packages']);

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function createWorkspacePackage(
  rootDir: string,
  dirName: string,
  packageJson: unknown,
  extraFiles: Record<string, string> = {},
): Promise<void> {
  const packageDir = join(rootDir, 'packages', dirName);
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(packageDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);

  for (const [relativePath, contents] of Object.entries(extraFiles)) {
    const targetPath = join(packageDir, relativePath);
    await mkdir(join(targetPath, '..'), { recursive: true });
    await writeFile(targetPath, contents);
  }
}

async function writeRootPackage(rootDir: string, packageJson: unknown): Promise<void> {
  await writeFile(join(rootDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
}

interface FakeRun {
  kind: 'run' | 'runShell';
  executable?: string;
  args?: string[];
  command?: string;
  options: { cwd: string; env?: Record<string, string> };
}

interface FakeRunner extends ProcessRunner {
  runs: FakeRun[];
}

function createFakeRunner(): FakeRunner {
  const runs: FakeRun[] = [];
  return {
    runs,
    run(executable, args, options) {
      runs.push({ kind: 'run', executable, args: [...args], options });
    },
    runShell(command, options) {
      runs.push({ kind: 'runShell', command, options });
    },
  };
}

/**
 * Build a fake runner that pretends the build step created the publish
 * directory by writing index.js so the publish pipeline progresses. Tests
 * inspect `runs` afterwards.
 */
function createFakePublishRunner(publishDirs: ReadonlyArray<string>): FakeRunner {
  const runs: FakeRun[] = [];
  const seen = new Set<string>();
  const runner: FakeRunner = {
    runs,
    run(executable, args, options) {
      runs.push({ kind: 'run', executable, args: [...args], options });
    },
    runShell(command, options) {
      runs.push({ kind: 'runShell', command, options });
      // Simulate the build step writing dist/ files on first build call per cwd.
      if (!seen.has(options.cwd)) {
        seen.add(options.cwd);
        for (const publishDir of publishDirs) {
          const distPath = join(options.cwd, publishDir);
          try {
            mkdirSync(distPath, { recursive: true });
          } catch {
            // already exists
          }
          writeFileSync(join(distPath, 'index.js'), 'export {}\n');
        }
      }
    },
  };
  return runner;
}

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

  it('includes internal devDependencies in build order and uses a lexical tie-breaker', () => {
    const names = new Set(['a', 'b', 'c']);
    const packages = [
      {
        dir: '/repo/packages/c',
        packageJson: { name: 'c', devDependencies: { a: 'workspace:*' } },
      },
      {
        dir: '/repo/packages/b',
        packageJson: { name: 'b' },
      },
      {
        dir: '/repo/packages/a',
        packageJson: { name: 'a' },
      },
    ];

    expect(sortPackagesByInternalDependencies(packages, names).map((pkg) => pkg.packageJson.name)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('produces the same order regardless of filesystem enumeration order', () => {
    const names = new Set(['a', 'b', 'c', 'd']);
    const baseManifests: Record<string, Record<string, unknown>> = {
      d: { name: 'd', dependencies: { b: 'workspace:*', c: 'workspace:*' } },
      c: { name: 'c', dependencies: { a: 'workspace:*' } },
      b: { name: 'b', dependencies: { a: 'workspace:*' } },
      a: { name: 'a' },
    };

    // Same manifest contents - present them in different "discovery" orders.
    const order1 = ['d', 'c', 'b', 'a'];
    const order2 = ['a', 'b', 'c', 'd'];
    const order3 = ['c', 'a', 'd', 'b'];

    const toPackages = (order: string[]) =>
      order.map((name) => ({ dir: `/repo/packages/${name}`, packageJson: baseManifests[name] }));

    const result1 = sortPackagesByInternalDependencies(toPackages(order1), names).map((p) => p.packageJson.name);
    const result2 = sortPackagesByInternalDependencies(toPackages(order2), names).map((p) => p.packageJson.name);
    const result3 = sortPackagesByInternalDependencies(toPackages(order3), names).map((p) => p.packageJson.name);

    expect(result1).toEqual(result2);
    expect(result2).toEqual(result3);
    // Dependencies always precede dependents.
    expect(result1).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('resolvePublishPackagesPlan', () => {
  async function makeFakeWorkspace(): Promise<string> {
    const rootDir = await makeTempRoot('repo-toolkit-publish-packages-plan-');
    await writeRootPackage(rootDir, { name: 'monorepo', private: true, license: 'MIT' });
    await createWorkspacePackage(rootDir, 'changelog', {
      name: '@example/changelog',
      version: '0.0.0-PLACEHOLDER',
    });
    await createWorkspacePackage(rootDir, 'publish-packages', {
      name: '@example/publish-packages',
      version: '0.0.0-PLACEHOLDER',
      dependencies: { '@example/changelog': 'workspace:*' },
    });
    return rootDir;
  }

  it('preserves internalPackageNames from the full discovered set under --filter', async () => {
    const rootDir = await makeFakeWorkspace();

    const plan = resolvePublishPackagesPlan({
      version: 'v1.2.3',
      cwd: rootDir,
      filters: ['publish-packages'],
    });

    expect(plan.internalPackageNames.has('@example/changelog')).toBe(true);
    expect(plan.internalPackageNames.has('@example/publish-packages')).toBe(true);
    expect(plan.packages).toHaveLength(1);
    expect(plan.packages[0].packageJson.name).toBe('@example/publish-packages');
  });

  it('applies default file lists, publishDir, placeholder, and build command', async () => {
    const rootDir = await makeFakeWorkspace();

    const plan = resolvePublishPackagesPlan({
      version: 'v1.2.3',
      cwd: rootDir,
      filters: ['publish-packages'],
    });

    expect([...plan.packageFiles]).toEqual(['README.md', 'CHANGELOG.md', 'llms.txt']);
    expect([...plan.rootFiles]).toEqual(['LICENSE']);
    expect(plan.includePackageFiles).toEqual([]);
    expect(plan.noDefaultPackageFiles).toBe(false);
    expect(plan.includeRootFiles).toEqual([]);
    expect(plan.noDefaultRootFiles).toBe(false);
    expect(plan.publishDir).toBe('dist');
    expect(plan.preservePublishDir).toBe(false);
    expect(plan.versionPlaceholder).toBe('0.0.0-PLACEHOLDER');
    expect(plan.buildCommand).toBe('pnpm build');
    expect(plan.version).toBe('1.2.3');
    expect(plan.npmTag).toBeUndefined();
  });

  it('infers the npmTag from a prerelease version', async () => {
    const rootDir = await makeFakeWorkspace();

    const plan = resolvePublishPackagesPlan({
      version: 'v2.0.0-beta.3',
      cwd: rootDir,
      filters: ['publish-packages'],
    });

    expect(plan.npmTag).toBe('beta');
  });

  it('resolves custom shared publish options including include/no-default', async () => {
    const rootDir = await makeFakeWorkspace();

    const plan = resolvePublishPackagesPlan({
      version: 'v1.2.3',
      cwd: rootDir,
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
    expect(plan.preservePublishDir).toBe(false);
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

  it('returns defensive (frozen) array copies for plan fields', async () => {
    const rootDir = await makeFakeWorkspace();

    const plan = resolvePublishPackagesPlan({
      version: 'v1.2.3',
      cwd: rootDir,
      filters: ['publish-packages'],
    });

    expect(() => (plan.packageFiles as string[] as string[]).push('extra.md')).toThrowError();
    expect(
      resolvePublishPackagesPlan({ version: 'v1.2.3', cwd: rootDir, filters: ['publish-packages'] }).packageFiles,
    ).toEqual(['README.md', 'CHANGELOG.md', 'llms.txt']);
  });

  it('public plan consumers cannot mutate internalPackageNames via the plan', async () => {
    const rootDir = await makeFakeWorkspace();

    const plan = resolvePublishPackagesPlan({ version: 'v1.2.3', cwd: rootDir, filters: ['publish-packages'] });
    const before = plan.internalPackageNames.has('@example/changelog');

    plan.internalPackageNames.add('@example/tampered');

    expect(before).toBe(true);
    // Re-resolving yields a fresh set that excludes the tampered name.
    const fresh = resolvePublishPackagesPlan({
      version: 'v1.2.3',
      cwd: rootDir,
      filters: ['publish-packages'],
    });
    expect(fresh.internalPackageNames.has('@example/tampered')).toBe(false);
  });

  it('suppresses default package and root files when the no-default flags are set', async () => {
    const rootDir = await makeTempRoot('repo-toolkit-publish-packages-plan-');
    await writeRootPackage(rootDir, { name: 'monorepo', private: true });
    await createWorkspacePackage(rootDir, 'pkg-a', { name: '@example/pkg-a', version: '1.2.3' });

    const plan = resolvePublishPackagesPlan({
      version: '1.2.3',
      cwd: rootDir,
      filters: ['pkg-a'],
      noDefaultPackageFiles: true,
      noDefaultRootFiles: true,
    });

    expect(plan.packageFiles).toEqual([]);
    expect(plan.rootFiles).toEqual([]);
  });

  it('rejects private workspace packages during discovery', async () => {
    const rootDir = await makeTempRoot('repo-toolkit-publish-packages-private-');
    await writeRootPackage(rootDir, { name: 'monorepo', private: true });
    await createWorkspacePackage(rootDir, 'pkg-a', { name: '@example/pkg-a', version: '1.2.3', private: true });

    expect(() => resolvePublishPackagesPlan({ version: '1.2.3', cwd: rootDir })).toThrowError(
      /Refusing to publish private workspace package/,
    );
  });

  it('rejects duplicate workspace package names and reports every manifest path', async () => {
    const rootDir = await makeTempRoot('repo-toolkit-publish-packages-duplicates-');
    await writeRootPackage(rootDir, { name: 'monorepo', private: true });
    await createWorkspacePackage(rootDir, 'pkg-a', { name: '@example/pkg-a', version: '1.2.3' });
    await createWorkspacePackage(rootDir, 'pkg-b', { name: '@example/pkg-a', version: '1.2.3' });

    expect(() => resolvePublishPackagesPlan({ version: '1.2.3', cwd: rootDir })).toThrowError(/pkg-a\/package.json/);
    expect(() => resolvePublishPackagesPlan({ version: '1.2.3', cwd: rootDir })).toThrowError(/pkg-b\/package.json/);
  });

  it('selects packages with --from inclusive of the matched package', async () => {
    const rootDir = await makeFakeWorkspace();

    const plan = resolvePublishPackagesPlan({
      version: '1.2.3',
      cwd: rootDir,
      from: 'publish-packages',
    });

    expect(plan.packages.map((p) => p.packageJson.name)).toEqual(['@example/publish-packages']);
  });

  it('rejects --from when no package matches', async () => {
    const rootDir = await makeFakeWorkspace();

    expect(() => resolvePublishPackagesPlan({ version: '1.2.3', cwd: rootDir, from: 'missing' })).toThrowError(
      /No package matched --from missing/,
    );
  });

  it('throws when no packages match the selection', async () => {
    const rootDir = await makeFakeWorkspace();

    expect(() => resolvePublishPackagesPlan({ version: '1.2.3', cwd: rootDir, filters: ['missing'] })).toThrowError(
      /No packages matched the current selection/,
    );
  });

  it('rejects unknown config-style option keys and invalid selector arrays', async () => {
    const rootDir = await makeTempRoot('repo-toolkit-publish-packages-validation-');
    await writeRootPackage(rootDir, { name: 'monorepo', private: true });
    await createWorkspacePackage(rootDir, 'pkg-a', { name: '@example/pkg-a', version: '1.2.3' });

    expect(() =>
      resolvePublishPackagesPlan({
        version: '1.2.3',
        cwd: rootDir,
        filters: ['pkg-a'],
        unknownKey: true,
      } as unknown as Parameters<typeof resolvePublishPackagesPlan>[0]),
    ).toThrowError(/Unknown publish-packages option/);

    expect(() =>
      resolvePublishPackagesPlan({
        version: '1.2.3',
        cwd: rootDir,
        filters: [''],
      }),
    ).toThrowError(/filters must be an array of non-empty strings/);
  });

  it('rejects a non-object runner option', async () => {
    const rootDir = await makeFakeWorkspace();

    expect(() =>
      resolvePublishPackagesPlan({
        version: '1.2.3',
        cwd: rootDir,
        filters: ['publish-packages'],
        runner: 'not-a-runner' as unknown as ProcessRunner,
      }),
    ).toThrowError(/runner must be a ProcessRunner object/);
  });

  it('honors a custom runner in the resolved plan', async () => {
    const rootDir = await makeFakeWorkspace();
    const runner = createFakeRunner();

    const plan = resolvePublishPackagesPlan({
      version: '1.2.3',
      cwd: rootDir,
      filters: ['publish-packages'],
      runner,
    });

    expect(plan.runner).toBe(runner);
  });

  it('defaults preservePublishDir to false', async () => {
    const rootDir = await makeFakeWorkspace();
    const plan = resolvePublishPackagesPlan({ version: '1.2.3', cwd: rootDir, filters: ['publish-packages'] });
    expect(plan.preservePublishDir).toBe(false);
  });

  it('resolves preservePublishDir true via API and config validation', async () => {
    const rootDir = await makeFakeWorkspace();
    const plan = resolvePublishPackagesPlan({
      version: '1.2.3',
      cwd: rootDir,
      filters: ['publish-packages'],
      preservePublishDir: true,
    });
    expect(plan.preservePublishDir).toBe(true);
  });

  it('rejects non-boolean preservePublishDir', async () => {
    const rootDir = await makeFakeWorkspace();
    expect(() =>
      resolvePublishPackagesPlan({
        version: '1.2.3',
        cwd: rootDir,
        filters: ['publish-packages'],
        preservePublishDir: 'yes' as unknown as boolean,
      }),
    ).toThrowError(/preservePublishDir must be a boolean/);
  });
});

describe('publishPackages (integration, fake runner)', () => {
  async function makePublishableWorkspace(pkgName: string, dirName: string): Promise<string> {
    const rootDir = await makeTempRoot('repo-toolkit-publish-packages-');
    await writeRootPackage(rootDir, { name: 'monorepo', private: true, license: 'MIT' });
    await createWorkspacePackage(
      rootDir,
      dirName,
      { name: pkgName, version: '0.0.0-PLACEHOLDER', main: 'dist/index.js' },
      { 'dist/index.js': 'export {}\n', 'README.md': '# pkg\n' },
    );
    await writeFile(join(rootDir, 'LICENSE'), 'MIT\n');
    return rootDir;
  }

  it('builds, writes package.json, and runs npm publish --dry-run for each package', async () => {
    const rootDir = await makePublishableWorkspace('@example/pkg-a', 'pkg-a');
    const runner = createFakePublishRunner(['dist']);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await publishPackages({
        version: '1.2.3',
        cwd: rootDir,
        filters: ['pkg-a'],
        dryRun: true,
        runner,
      });
    } finally {
      logSpy.mockRestore();
    }

    const publishPkgJson = JSON.parse(
      await readFile(join(rootDir, 'packages', 'pkg-a', 'dist', 'package.json'), 'utf8'),
    );
    expect(publishPkgJson.name).toBe('@example/pkg-a');
    expect(publishPkgJson.main).toBe('./index.js');
    expect(publishPkgJson.files).toEqual(['**/*', '!**/*.map']);
    expect(publishPkgJson.license).toBe('MIT');
    expect(existsSync(join(rootDir, 'packages', 'pkg-a', 'dist', 'README.md'))).toBe(true);
    expect(existsSync(join(rootDir, 'packages', 'pkg-a', 'dist', 'LICENSE'))).toBe(true);

    // Build ran once (runShell), and npm publish ran once with --dry-run.
    expect(runner.runs.filter((entry) => entry.kind === 'runShell')).toHaveLength(1);
    const npmRuns = runner.runs.filter((entry) => entry.kind === 'run');
    expect(npmRuns).toHaveLength(1);
    expect(npmRuns[0].executable).toBe('npm');
    expect(npmRuns[0].args).toContain('--dry-run');
  }, 30_000);

  it('preflights every selected package before the first publish side effect', async () => {
    const rootDir = await makeTempRoot('repo-toolkit-publish-packages-preflight-');
    await writeRootPackage(rootDir, { name: 'monorepo', private: true, license: 'MIT' });
    await createWorkspacePackage(
      rootDir,
      'pkg-a',
      { name: '@example/pkg-a', version: '0.0.0-PLACEHOLDER', main: 'dist/index.js' },
      { 'dist/index.js': 'export {}\n', 'README.md': '# pkg-a\n' },
    );
    // pkg-b is private — discovery must abort before any runner invocation.
    await createWorkspacePackage(rootDir, 'pkg-b', { name: '@example/pkg-b', version: '1.2.3', private: true });
    await writeFile(join(rootDir, 'LICENSE'), 'MIT\n');

    const runner = createFakePublishRunner(['dist']);

    await expect(
      publishPackages({
        version: '1.2.3',
        cwd: rootDir,
        dryRun: true,
        runner,
      }),
    ).rejects.toThrowError(/Refusing to publish private workspace package/);
    expect(existsSync(join(rootDir, 'packages', 'pkg-a', 'dist', 'package.json'))).toBe(false);
    // Preflight means the runner was never invoked.
    expect(runner.runs).toHaveLength(0);
  });

  it('runs npm publish once per package in dependency order on the injected runner', async () => {
    const rootDir = await makeTempRoot('repo-toolkit-publish-packages-order-');
    await writeRootPackage(rootDir, { name: 'monorepo', private: true, license: 'MIT' });
    await createWorkspacePackage(
      rootDir,
      'pkg-a',
      { name: '@example/pkg-a', version: '0.0.0-PLACEHOLDER', main: 'dist/index.js' },
      { 'dist/index.js': 'export {}\n', 'README.md': '# pkg-a\n' },
    );
    await createWorkspacePackage(
      rootDir,
      'pkg-b',
      {
        name: '@example/pkg-b',
        version: '0.0.0-PLACEHOLDER',
        main: 'dist/index.js',
        dependencies: { '@example/pkg-a': 'workspace:*' },
      },
      { 'dist/index.js': 'export {}\n', 'README.md': '# pkg-b\n' },
    );
    await writeFile(join(rootDir, 'LICENSE'), 'MIT\n');

    const runner = createFakePublishRunner(['dist']);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await publishPackages({ version: '1.2.3', cwd: rootDir, dryRun: true, runner });
    } finally {
      logSpy.mockRestore();
    }

    const npmRuns = runner.runs.filter((entry) => entry.kind === 'run');
    expect(npmRuns).toHaveLength(2);
    // pkg-a is published before pkg-b because pkg-b depends on pkg-a.
    expect(npmRuns[0].options.cwd.endsWith(join('packages', 'pkg-a', 'dist'))).toBe(true);
    expect(npmRuns[1].options.cwd.endsWith(join('packages', 'pkg-b', 'dist'))).toBe(true);
    // The rewritten manifest for pkg-b points its dependency at the target version.
    const pkgBPublished = JSON.parse(
      await readFile(join(rootDir, 'packages', 'pkg-b', 'dist', 'package.json'), 'utf8'),
    );
    expect(pkgBPublished.dependencies['@example/pkg-a']).toBe('1.2.3');
  });

  it('stops at the first failing publish and reports completed and pending packages', async () => {
    const rootDir = await makeTempRoot('repo-toolkit-publish-packages-fail-');
    await writeRootPackage(rootDir, { name: 'monorepo', private: true, license: 'MIT' });
    await createWorkspacePackage(
      rootDir,
      'pkg-a',
      { name: '@example/pkg-a', version: '0.0.0-PLACEHOLDER', main: 'dist/index.js' },
      { 'dist/index.js': 'export {}\n', 'README.md': '# pkg-a\n' },
    );
    await createWorkspacePackage(
      rootDir,
      'pkg-b',
      {
        name: '@example/pkg-b',
        version: '0.0.0-PLACEHOLDER',
        main: 'dist/index.js',
        dependencies: { '@example/pkg-a': 'workspace:*' },
      },
      { 'dist/index.js': 'export {}\n', 'README.md': '# pkg-b\n' },
    );
    await writeFile(join(rootDir, 'LICENSE'), 'MIT\n');

    const runs: FakeRun[] = [];
    const runner: ProcessRunner = {
      run(executable, args, options) {
        runs.push({ kind: 'run', executable, args: [...args], options });
        // Fail the first npm publish invocation.
        throw new Error('fake: npm publish failed');
      },
      runShell(command, options) {
        runs.push({ kind: 'runShell', command, options });
      },
    };

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(publishPackages({ version: '1.2.3', cwd: rootDir, dryRun: true, runner })).rejects.toThrowError(
        /Publish failed after preflight/,
      );
    } finally {
      logSpy.mockRestore();
    }

    // Only one npm publish attempt was made — pkg-b is never published after pkg-a fails.
    expect(runs.filter((entry) => entry.kind === 'run')).toHaveLength(1);
  });

  it('forwards preservePublishDir false to each package (flattened manifests)', async () => {
    const rootDir = await makeTempRoot('repo-toolkit-publish-packages-preserve-false-');
    await writeRootPackage(rootDir, { name: 'monorepo', private: true, license: 'MIT' });
    await createWorkspacePackage(
      rootDir,
      'pkg-a',
      { name: '@example/pkg-a', version: '0.0.0-PLACEHOLDER', main: 'dist/index.js' },
      { 'dist/index.js': 'export {}\n', 'README.md': '# pkg-a\n' },
    );
    await createWorkspacePackage(
      rootDir,
      'pkg-b',
      { name: '@example/pkg-b', version: '0.0.0-PLACEHOLDER', main: 'dist/index.js' },
      { 'dist/index.js': 'export {}\n', 'README.md': '# pkg-b\n' },
    );
    await writeFile(join(rootDir, 'LICENSE'), 'MIT\n');

    const runner = createFakePublishRunner(['dist']);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await publishPackages({ version: '1.2.3', cwd: rootDir, dryRun: true, preservePublishDir: false, runner });
    } finally {
      logSpy.mockRestore();
    }

    const pkgA = JSON.parse(await readFile(join(rootDir, 'packages', 'pkg-a', 'dist', 'package.json'), 'utf8'));
    const pkgB = JSON.parse(await readFile(join(rootDir, 'packages', 'pkg-b', 'dist', 'package.json'), 'utf8'));
    expect(pkgA.main).toBe('./index.js');
    expect(pkgB.main).toBe('./index.js');
    for (const entry of runner.runs.filter((r) => r.kind === 'run')) {
      expect(entry.options.cwd.endsWith(join('dist'))).toBe(true);
    }
  });

  it('forwards preservePublishDir true to every selected package (retained dist prefix)', async () => {
    const rootDir = await makeTempRoot('repo-toolkit-publish-packages-preserve-true-');
    await writeRootPackage(rootDir, { name: 'monorepo', private: true, license: 'MIT' });
    await createWorkspacePackage(
      rootDir,
      'pkg-a',
      { name: '@example/pkg-a', version: '0.0.0-PLACEHOLDER', main: 'dist/index.js' },
      { 'dist/index.js': 'export {}\n', 'README.md': '# pkg-a\n' },
    );
    await createWorkspacePackage(
      rootDir,
      'pkg-b',
      { name: '@example/pkg-b', version: '0.0.0-PLACEHOLDER', main: 'dist/index.js' },
      { 'dist/index.js': 'export {}\n', 'README.md': '# pkg-b\n' },
    );
    await writeFile(join(rootDir, 'LICENSE'), 'MIT\n');

    const captured: Array<{ cwd: string; manifest: Record<string, unknown> }> = [];
    const seen = new Set<string>();
    const runs: FakeRun[] = [];
    const runner: ProcessRunner = {
      run(executable, args, options) {
        runs.push({ kind: 'run', executable, args: [...args], options });
        const manifestPath = join(options.cwd, 'package.json');
        try {
          const raw = readFileSync(manifestPath, 'utf8');
          captured.push({ cwd: options.cwd, manifest: JSON.parse(raw) });
        } catch {
          // ignore
        }
      },
      runShell(command, options) {
        runs.push({ kind: 'runShell', command, options });
        if (!seen.has(options.cwd)) {
          seen.add(options.cwd);
          const distPath = join(options.cwd, 'dist');
          mkdirSync(distPath, { recursive: true });
          writeFileSync(join(distPath, 'index.js'), 'export {}\n');
        }
      },
    };

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await publishPackages({ version: '1.2.3', cwd: rootDir, dryRun: true, preservePublishDir: true, runner });
    } finally {
      logSpy.mockRestore();
    }

    expect(captured).toHaveLength(2);
    for (const { manifest } of captured) {
      expect(manifest.main).toBe('dist/index.js');
    }
  });

  it('forwards a custom nested publishDir with preservePublishDir true', async () => {
    const rootDir = await makeTempRoot('repo-toolkit-publish-packages-preserve-nested-');
    await writeRootPackage(rootDir, { name: 'monorepo', private: true, license: 'MIT' });
    await createWorkspacePackage(
      rootDir,
      'pkg-a',
      { name: '@example/pkg-a', version: '0.0.0-PLACEHOLDER', main: 'artifacts/npm/index.js' },
      { 'artifacts/npm/index.js': 'export {}\n', 'README.md': '# pkg-a\n' },
    );
    await writeFile(join(rootDir, 'LICENSE'), 'MIT\n');

    const captured: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    const runs: FakeRun[] = [];
    const runner: ProcessRunner = {
      run(executable, args, options) {
        runs.push({ kind: 'run', executable, args: [...args], options });
        captured.push(JSON.parse(readFileSync(join(options.cwd, 'package.json'), 'utf8')));
      },
      runShell(command, options) {
        runs.push({ kind: 'runShell', command, options });
        if (!seen.has(options.cwd)) {
          seen.add(options.cwd);
          const out = join(options.cwd, 'artifacts', 'npm');
          mkdirSync(out, { recursive: true });
          writeFileSync(join(out, 'index.js'), 'export {}\n');
        }
      },
    };

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await publishPackages({
        version: '1.2.3',
        cwd: rootDir,
        dryRun: true,
        publishDir: 'artifacts/npm',
        preservePublishDir: true,
        runner,
      });
    } finally {
      logSpy.mockRestore();
    }

    expect(captured).toHaveLength(1);
    expect(captured[0].main).toBe('artifacts/npm/index.js');
  });
});
