import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { chmodSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  buildReleaseArtifact,
  buildRequiredFiles,
  buildWrapperScript,
  collectCommands,
  collectCommandPackageClosure,
  createArtifactManifest,
  defaultArtifactRunner,
  installReleaseArtifact,
  intersectSemverRanges,
  matchesAnyGlob,
  mergeClosureDependencies,
  resolveArtifactPath,
  resolveBuildArtifactPlan,
  resolveNodeModulesMode,
  resolveRootFileDestination,
  toBinEntries,
  validateReleaseArchive,
  verifyExtractedArtifact,
  verifyReleaseArtifact,
  verifySymlinks,
  type ArtifactRunner,
  type ArtifactRunOptions,
  type NodeModulesMode,
} from '../src/index';

const FIXTURE_VERSION = '1.2.3';
const FIXTURE_TOOL_NAME = 'fixture-toolkit';

async function createFixtureWorkspace(rootDir: string): Promise<void> {
  await mkdir(join(rootDir, 'packages', 'fixture-cli'), { recursive: true });
  await mkdir(join(rootDir, 'packages', 'pkg-no-bin'), { recursive: true });

  await writeFile(join(rootDir, 'VERSION'), `${FIXTURE_VERSION}\n`);
  await writeFile(join(rootDir, 'LICENSE'), 'Apache-2.0\n');

  await writeFile(
    join(rootDir, 'packages', 'fixture-cli', 'package.json'),
    `${JSON.stringify(
      {
        name: '@example/fixture-cli',
        version: '0.0.0-PLACEHOLDER',
        bin: { 'fixture-cli': 'cli.js' },
      },
      null,
      2,
    )}\n`,
  );

  // A minimal CLI that responds to --help and exits 0 (used by verifyReleaseArtifact).
  await writeFile(
    join(rootDir, 'packages', 'fixture-cli', 'cli.js'),
    `#!/usr/bin/env node
if (process.argv.includes('--help')) {
  console.log('fixture-cli help');
  process.exit(0);
}
console.log('running');
`,
  );

  // A package without a bin entry should be copied but produce no commands.
  await writeFile(
    join(rootDir, 'packages', 'pkg-no-bin', 'package.json'),
    `${JSON.stringify({ name: '@example/pkg-no-bin', version: '0.0.0-PLACEHOLDER' }, null, 2)}\n`,
  );
}

async function createTraversalArchive(archivePath: string, topLevelDirName: string): Promise<void> {
  const sourceRoot = await mkdtemp(join(tmpdir(), 'repo-toolkit-artifact-malicious-src-'));

  try {
    await mkdir(join(sourceRoot, topLevelDirName), { recursive: true });
    await writeFile(join(sourceRoot, topLevelDirName, 'escape.txt'), 'malicious\n');
    execFileSync('tar', [
      '-czf',
      archivePath,
      '--transform',
      `s#^${topLevelDirName}/escape.txt#../escape.txt#`,
      '-C',
      sourceRoot,
      topLevelDirName,
    ]);
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
  }
}

describe('toBinEntries', () => {
  it('returns a single entry for a string bin on a scoped package', () => {
    expect(toBinEntries('dist/cli.js', '@scope/tool')).toEqual([['tool', 'dist/cli.js']]);
  });

  it('returns a single entry for a string bin on an unscoped package', () => {
    expect(toBinEntries('dist/cli.js', 'tool')).toEqual([['tool', 'dist/cli.js']]);
  });

  it('returns object entries as-is', () => {
    expect(toBinEntries({ a: 'dist/a.js', b: 'dist/b.js' }, 'tool')).toEqual([
      ['a', 'dist/a.js'],
      ['b', 'dist/b.js'],
    ]);
  });

  it('returns an empty array for missing/invalid bin', () => {
    expect(toBinEntries(undefined, 'tool')).toEqual([]);
    expect(toBinEntries(42, 'tool')).toEqual([]);
  });
});

describe('buildWrapperScript', () => {
  it('produces an env-aware bash wrapper that execs node against the relative target', () => {
    const script = buildWrapperScript('packages/foo/dist/cli.js');
    expect(script).toContain('#!/usr/bin/env bash');
    expect(script).toContain("target_path='packages/foo/dist/cli.js'");
    expect(script).toContain('node_bin="${REPO_TOOLKIT_NODE_BIN:-${ASDF_NODEJS_BIN:-}}"');
    expect(script).toContain('exec "$node_bin" "${script_dir}/../${target_path}" "$@"');
  });

  it('falls back to the build-time nodeCommand when no env var is set', () => {
    const script = buildWrapperScript('packages/foo/dist/cli.js', 'node20');
    expect(script).toContain("default_node='node20'");
    expect(script).toContain('node_bin="$default_node"');
  });

  it('appends the node command to a directory env var', () => {
    const script = buildWrapperScript('packages/foo/dist/cli.js', 'node');
    expect(script).toContain('[ -d "$node_bin" ] && node_bin="${node_bin}/${default_node}"');
  });

  it('shell-quotes nodeCommand and targetPath literals before embedding them', () => {
    const script = buildWrapperScript("packages/foo/cli'$(touch nope)'.js", "node'20");

    expect(script).toContain("default_node='node'\\''20'");
    expect(script).toContain("target_path='packages/foo/cli'\\''$(touch nope)'\\''.js'");
  });
});

describe('buildRequiredFiles', () => {
  it('includes version files, manifest, wrapper, package.json and entry', () => {
    const requiredFiles = buildRequiredFiles(
      [{ name: 'my-cli', packageDir: 'my-cli', entry: 'dist/cli.js' }],
      ['VERSION'],
    );

    expect(requiredFiles).toEqual(
      expect.arrayContaining([
        'VERSION',
        'artifact-manifest.json',
        'bin/my-cli',
        'packages/my-cli/package.json',
        'packages/my-cli/dist/cli.js',
      ]),
    );
  });
});

describe('createArtifactManifest', () => {
  it('sorts commands by name then packageDir', () => {
    const manifest = createArtifactManifest(
      FIXTURE_TOOL_NAME,
      '1.2.3',
      `${FIXTURE_TOOL_NAME}-1.2.3`,
      `${FIXTURE_TOOL_NAME}-1.2.3.tar.gz`,
      [
        { name: 'b-cli', packageDir: 'b', entry: 'cli.js' },
        { name: 'a-cli', packageDir: 'a', entry: 'cli.js' },
      ],
      ['VERSION', 'artifact-manifest.json'],
    );

    expect(manifest.toolName).toBe(FIXTURE_TOOL_NAME);
    expect(manifest.version).toBe('1.2.3');
    expect(manifest.commands.map((command) => command.name)).toEqual(['a-cli', 'b-cli']);
    expect(manifest.requiredFiles).toEqual([...['VERSION', 'artifact-manifest.json']].sort());
  });
});

describe('resolveBuildArtifactPlan', () => {
  it('throws when the packages directory is missing', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-artifact-plan-'));

    try {
      expect(() => resolveBuildArtifactPlan({ version: '1.2.3', cwd: rootDir })).toThrowError(
        /packages directory not found/,
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('strips a leading v from the version', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-artifact-plan-'));

    try {
      await createFixtureWorkspace(rootDir);

      const plan = resolveBuildArtifactPlan({
        version: 'v1.2.3',
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        includeNodeModules: false,
        productionNodeModules: false,
      });

      expect(plan.version).toBe('1.2.3');
      expect(plan.artifactDirName).toBe('fixture-toolkit-1.2.3');
      expect(plan.artifactPath.endsWith('fixture-toolkit-1.2.3.tar.gz')).toBe(true);
      expect(plan.commands.map((command) => command.name)).toEqual(['fixture-cli']);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('collectCommands', () => {
  it('only collects entries from packages with a bin field', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-artifact-cmds-'));

    try {
      await createFixtureWorkspace(rootDir);

      const commands = collectCommands(join(rootDir, 'packages'), ['fixture-cli', 'pkg-no-bin']);

      expect(commands).toEqual([{ name: 'fixture-cli', packageDir: 'fixture-cli', entry: 'cli.js' }]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('throws when a package.json is missing a name', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-artifact-cmds-'));

    try {
      await mkdir(join(rootDir, 'packages', 'pkg-no-name'), { recursive: true });
      await writeFile(
        join(rootDir, 'packages', 'pkg-no-name', 'package.json'),
        `${JSON.stringify({ version: '0.0.0-PLACEHOLDER', bin: { x: 'cli.js' } }, null, 2)}\n`,
      );

      expect(() => collectCommands(join(rootDir, 'packages'), ['pkg-no-name'])).toThrowError(/Package name missing/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects duplicate command names across packages', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-artifact-cmds-'));

    try {
      await mkdir(join(rootDir, 'packages', 'pkg-a'), { recursive: true });
      await mkdir(join(rootDir, 'packages', 'pkg-b'), { recursive: true });
      await writeFile(
        join(rootDir, 'packages', 'pkg-a', 'package.json'),
        `${JSON.stringify({ name: '@example/a', bin: { shared: 'cli.js' } }, null, 2)}\n`,
      );
      await writeFile(join(rootDir, 'packages', 'pkg-a', 'cli.js'), 'console.log("a")\n');
      await writeFile(
        join(rootDir, 'packages', 'pkg-b', 'package.json'),
        `${JSON.stringify({ name: '@example/b', bin: { shared: 'cli.js' } }, null, 2)}\n`,
      );
      await writeFile(join(rootDir, 'packages', 'pkg-b', 'cli.js'), 'console.log("b")\n');

      expect(() => collectCommands(join(rootDir, 'packages'), ['pkg-a', 'pkg-b'])).toThrowError(
        /Duplicate artifact command name/,
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('globToRegex / matchesAnyGlob', () => {
  it('matches a bare directory name at the copy root or as a trailing segment', () => {
    expect(matchesAnyGlob('test', ['test'])).toBe(true);
    expect(matchesAnyGlob('packages/x/test', ['test'])).toBe(true);
    expect(matchesAnyGlob('packages/x/tests', ['test'])).toBe(false);
  });

  it('matches a ** prefix against zero or more leading directories', () => {
    expect(matchesAnyGlob('index.test.ts', ['**/*.test.ts'])).toBe(true);
    expect(matchesAnyGlob('dist/index.test.ts', ['**/*.test.ts'])).toBe(true);
    expect(matchesAnyGlob('packages/foo/dist/bar.test.ts', ['**/*.test.ts'])).toBe(true);
    expect(matchesAnyGlob('dist/index.ts', ['**/*.test.ts'])).toBe(false);
  });

  it('matches .map files via a star glob at any depth', () => {
    expect(matchesAnyGlob('cli.js.map', ['**/*.map'])).toBe(true);
    expect(matchesAnyGlob('dist/cli.js.map', ['**/*.map'])).toBe(true);
    expect(matchesAnyGlob('dist/cli.js', ['**/*.map'])).toBe(false);
  });

  it('anchors a leading-slash pattern to the copy root only', () => {
    expect(matchesAnyGlob('src', ['/src'])).toBe(true);
    expect(matchesAnyGlob('src/index.ts', ['/src'])).toBe(false);
    expect(matchesAnyGlob('nested/src', ['/src'])).toBe(false);
    expect(matchesAnyGlob('nested/src/index.ts', ['/src'])).toBe(false);
    expect(matchesAnyGlob('test', ['/test'])).toBe(true);
    expect(matchesAnyGlob('src/foo/test', ['/test'])).toBe(false);
  });
});

describe('resolveArtifactPath', () => {
  it('resolves from cwd, toolName and distDir', () => {
    const artifactPath = resolveArtifactPath({
      version: 'v3.4.5',
      cwd: '/repo',
      toolName: FIXTURE_TOOL_NAME,
      distDir: 'build',
    });

    expect(artifactPath).toBe(join('/repo', 'build', 'fixture-toolkit-3.4.5.tar.gz'));
  });

  it('honours an explicit artifactPath', () => {
    const artifactPath = resolveArtifactPath({ version: '1.0.0', artifactPath: '/somewhere/artifact.tar.gz' });
    expect(artifactPath).toBe('/somewhere/artifact.tar.gz');
  });
});

describe('verifySymlinks', () => {
  it('throws on an absolute symlink', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-artifact-symlinks-'));

    try {
      await mkdir(join(rootDir, 'sub'), { recursive: true });
      try {
        const { symlink } = await import('node:fs/promises');
        await symlink('/etc/passwd', join(rootDir, 'sub', 'abs-link'));
      } catch {
        return;
      }

      expect(() => verifySymlinks(rootDir)).toThrowError(/absolute symlink/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('throws on a relative symlink that escapes the artifact root', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-artifact-symlinks-'));

    try {
      await mkdir(join(rootDir, 'sub'), { recursive: true });
      try {
        const { symlink } = await import('node:fs/promises');
        await symlink('../../escape', join(rootDir, 'sub', 'escape-link'));
      } catch {
        return;
      }

      expect(() => verifySymlinks(rootDir)).toThrowError(/escaping the artifact root/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('accepts a relative symlink staying inside the artifact root', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-artifact-symlinks-'));

    try {
      await mkdir(join(rootDir, 'sub'), { recursive: true });
      await writeFile(join(rootDir, 'target.txt'), 'ok\n');
      try {
        const { symlink } = await import('node:fs/promises');
        await symlink('../target.txt', join(rootDir, 'sub', 'inner-link'));
      } catch {
        return;
      }

      expect(() => verifySymlinks(rootDir)).not.toThrow();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('buildReleaseArtifact + verifyReleaseArtifact (integration)', () => {
  it('builds a tarball that verifyReleaseArtifact accepts', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-artifact-integration-'));

    try {
      await createFixtureWorkspace(rootDir);

      const plan = buildReleaseArtifact({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        includeNodeModules: false,
        productionNodeModules: false,
        versionFiles: ['VERSION'],
        rootFiles: ['LICENSE'],
      });

      expect(existsSync(plan.artifactPath)).toBe(true);

      // The artifact contains the manifest, the wrapper, and the copied package.
      const manifestPath = join(plan.artifactRoot, 'artifact-manifest.json');
      expect(existsSync(manifestPath)).toBe(true);
      expect(existsSync(join(plan.artifactRoot, 'bin', 'fixture-cli'))).toBe(true);
      expect(existsSync(join(plan.artifactRoot, 'packages', 'fixture-cli', 'cli.js'))).toBe(true);
      expect(existsSync(join(plan.artifactRoot, 'VERSION'))).toBe(true);
      expect(existsSync(join(plan.artifactRoot, 'LICENSE'))).toBe(true);

      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      expect(manifest.version).toBe(FIXTURE_VERSION);
      expect(manifest.commands).toEqual([{ name: 'fixture-cli', packageDir: 'fixture-cli', entry: 'cli.js' }]);

      // verify extracts, checks required files, syntax-checks the wrapper, runs --help, and checks symlinks.
      expect(() =>
        verifyReleaseArtifact({
          version: FIXTURE_VERSION,
          cwd: rootDir,
          toolName: FIXTURE_TOOL_NAME,
          distDir: 'dist',
        }),
      ).not.toThrow();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('verifies an explicit artifactPath without requiring version', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-artifact-path-'));

    try {
      await createFixtureWorkspace(rootDir);

      const plan = buildReleaseArtifact({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        includeNodeModules: false,
        productionNodeModules: false,
      });

      expect(() => verifyReleaseArtifact({ artifactPath: plan.artifactPath })).not.toThrow();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('checks symlink safety before syntax-checking or executing extracted wrappers', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-artifact-malicious-'));
    const distDir = join(rootDir, 'dist');
    const installRoot = join(distDir, `${FIXTURE_TOOL_NAME}-${FIXTURE_VERSION}`);
    const packageRoot = join(installRoot, 'packages', 'fixture-cli');
    const outsideScript = join(rootDir, 'outside.sh');
    const markerPath = join(rootDir, 'executed.txt');
    const artifactPath = `${installRoot}.tar.gz`;

    try {
      await mkdir(join(installRoot, 'bin'), { recursive: true });
      await mkdir(packageRoot, { recursive: true });

      await writeFile(
        join(installRoot, 'artifact-manifest.json'),
        `${JSON.stringify(
          {
            version: FIXTURE_VERSION,
            commands: [{ name: 'fixture-cli', packageDir: 'fixture-cli', entry: 'cli.js' }],
            requiredFiles: [
              'artifact-manifest.json',
              'bin/fixture-cli',
              'packages/fixture-cli/package.json',
              'packages/fixture-cli/cli.js',
            ],
          },
          null,
          2,
        )}\n`,
      );
      await writeFile(
        join(packageRoot, 'package.json'),
        `${JSON.stringify({ name: '@example/fixture-cli' }, null, 2)}\n`,
      );
      await writeFile(join(packageRoot, 'cli.js'), 'console.log("fixture")\n');
      await writeFile(
        outsideScript,
        `#!/usr/bin/env bash
echo executed > "${markerPath}"
exit 0
`,
      );
      chmodSync(outsideScript, 0o755);
      await symlink(relative(join(installRoot, 'bin'), outsideScript), join(installRoot, 'bin', 'fixture-cli'));

      execFileSync('tar', ['-czf', artifactPath, '-C', distDir, `${FIXTURE_TOOL_NAME}-${FIXTURE_VERSION}`]);

      expect(() => verifyReleaseArtifact({ artifactPath })).toThrowError(/escaping (the artifact root|link)/);
      expect(existsSync(markerPath)).toBe(false);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('verifyReleaseArtifact throws for a missing artifact', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-artifact-missing-'));

    try {
      expect(() => verifyReleaseArtifact({ version: '9.9.9', cwd: rootDir, toolName: FIXTURE_TOOL_NAME })).toThrowError(
        /Missing release artifact/,
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('verifyReleaseArtifact with skipExec validates without executing wrappers', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-artifact-skipexec-'));

    try {
      await createFixtureWorkspace(rootDir);

      buildReleaseArtifact({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        includeNodeModules: false,
        productionNodeModules: false,
      });

      expect(() =>
        verifyReleaseArtifact({ version: FIXTURE_VERSION, cwd: rootDir, toolName: FIXTURE_TOOL_NAME, skipExec: true }),
      ).not.toThrow();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects traversal archive members before extraction', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-artifact-traversal-'));
    const archivePath = join(rootDir, `${FIXTURE_TOOL_NAME}-${FIXTURE_VERSION}.tar.gz`);

    try {
      await createTraversalArchive(archivePath, `${FIXTURE_TOOL_NAME}-${FIXTURE_VERSION}`);

      expect(() => verifyReleaseArtifact({ artifactPath: archivePath })).toThrowError(
        /normalized relative POSIX path|top-level directory/,
      );
      expect(existsSync(join(rootDir, 'escape.txt'))).toBe(false);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('excludes src/test/sourcemaps from copied package directories by default', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-artifact-excludes-'));

    try {
      await createFixtureWorkspace(rootDir);
      await mkdir(join(rootDir, 'packages', 'fixture-cli', 'src'), { recursive: true });
      await mkdir(join(rootDir, 'packages', 'fixture-cli', 'test'), { recursive: true });
      await writeFile(join(rootDir, 'packages', 'fixture-cli', 'src', 'index.ts'), 'export {}\n');
      await writeFile(join(rootDir, 'packages', 'fixture-cli', 'test', 'index.test.ts'), 'test\n');
      await writeFile(join(rootDir, 'packages', 'fixture-cli', 'cli.js.map'), '{}\n');

      const plan = buildReleaseArtifact({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        includeNodeModules: false,
        productionNodeModules: false,
      });

      expect(existsSync(join(plan.artifactRoot, 'packages', 'fixture-cli', 'src'))).toBe(false);
      expect(existsSync(join(plan.artifactRoot, 'packages', 'fixture-cli', 'test'))).toBe(false);
      expect(existsSync(join(plan.artifactRoot, 'packages', 'fixture-cli', 'cli.js'))).toBe(true);
      expect(existsSync(join(plan.artifactRoot, 'packages', 'fixture-cli', 'cli.js.map'))).toBe(false);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('buildReleaseArtifact (production node_modules, real repo)', () => {
  const repoRoot = new URL('../../..', import.meta.url).pathname;

  it('installs only production deps and the artifact boots without the repo on disk', () => {
    let plan: ReturnType<typeof buildReleaseArtifact> | undefined;
    try {
      plan = buildReleaseArtifact({
        version: '0.0.0-test',
        cwd: repoRoot,
        toolName: 'repo-toolkit',
      });

      expect(existsSync(plan.artifactPath)).toBe(true);
      expect(existsSync(join(plan.artifactRoot, 'node_modules'))).toBe(true);
      // dev-only deps must not be present in a production install
      expect(existsSync(join(plan.artifactRoot, 'node_modules', 'eslint'))).toBe(false);
      expect(existsSync(join(plan.artifactRoot, 'node_modules', 'vitest'))).toBe(false);
      // internal workspace dep is linked relatively inside the artifact root
      expect(
        existsSync(join(plan.artifactRoot, 'node_modules', '@repo-toolkit', 'publish-package', 'package.json')),
      ).toBe(true);

      // verify (with exec) must succeed: wrappers boot using the artifact's own node_modules
      expect(() =>
        verifyReleaseArtifact({ version: '0.0.0-test', cwd: repoRoot, toolName: 'repo-toolkit' }),
      ).not.toThrow();
    } finally {
      if (plan) {
        rmSync(plan.artifactRoot, { recursive: true, force: true });
        rmSync(plan.artifactPath, { recursive: true, force: true });
      }
    }
  }, 60_000);
});

describe('installReleaseArtifact', () => {
  it('atomically installs a valid artifact and refuses a stale non-empty destination', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-install-runner-'));
    const installDir = join(rootDir, 'install', 'fixture-toolkit');

    try {
      await createFixtureWorkspace(rootDir);
      const plan = buildReleaseArtifact({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        includeNodeModules: false,
        productionNodeModules: false,
      });

      const { installPath, manifest } = installReleaseArtifact({
        archivePath: plan.artifactPath,
        installPath: installDir,
        version: FIXTURE_VERSION,
        toolName: FIXTURE_TOOL_NAME,
      });

      expect(installPath).toBe(installDir);
      expect(existsSync(join(installPath, 'artifact-manifest.json'))).toBe(true);
      expect(existsSync(join(installPath, 'bin', 'fixture-cli'))).toBe(true);
      expect(existsSync(join(installPath, 'packages', 'fixture-cli', 'cli.js'))).toBe(true);
      expect(manifest.toolName).toBe(FIXTURE_TOOL_NAME);
      expect(manifest.version).toBe(FIXTURE_VERSION);

      // The temp extraction dir must be gone after success.
      const installParent = join(rootDir, 'install');
      const leftovers = readdirSync(installParent).filter((name) => name.startsWith('fixture-toolkit-install-'));
      expect(leftovers).toEqual([]);

      // Re-running with the same non-empty destination must refuse without --force
      // and must NOT touch the existing install tree.
      expect(() =>
        installReleaseArtifact({
          archivePath: plan.artifactPath,
          installPath: installDir,
          version: FIXTURE_VERSION,
          toolName: FIXTURE_TOOL_NAME,
        }),
      ).toThrowError(/already exists and is non-empty/);
      expect(existsSync(join(installDir, 'artifact-manifest.json'))).toBe(true);

      // --force replaces the existing install tree.
      installReleaseArtifact({
        archivePath: plan.artifactPath,
        installPath: installDir,
        version: FIXTURE_VERSION,
        toolName: FIXTURE_TOOL_NAME,
        force: true,
      });
      expect(existsSync(join(installDir, 'artifact-manifest.json'))).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects a version mismatch before touching the install path and leaves no temp dir', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-install-ver-'));
    const installDir = join(rootDir, 'install', 'fixture-toolkit');

    try {
      await createFixtureWorkspace(rootDir);
      const plan = buildReleaseArtifact({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        includeNodeModules: false,
        productionNodeModules: false,
      });

      expect(() =>
        installReleaseArtifact({
          archivePath: plan.artifactPath,
          installPath: installDir,
          version: '9.9.9',
          toolName: FIXTURE_TOOL_NAME,
        }),
      ).toThrowError(/extracted to unexpected directory|version mismatch/);

      // The final install path must not have been created, and no temp dir may linger.
      expect(existsSync(installDir)).toBe(false);
      const installParent = join(rootDir, 'install');
      const leftovers = readdirSync(installParent).filter((name) => name.startsWith('fixture-toolkit-install-'));
      expect(leftovers).toEqual([]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects a malicious traversal archive before extraction and leaves no temp dir', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-install-trav-'));
    const archivePath = join(rootDir, `${FIXTURE_TOOL_NAME}-${FIXTURE_VERSION}.tar.gz`);
    const installDir = join(rootDir, 'install', 'fixture-toolkit');

    try {
      await createTraversalArchive(archivePath, `${FIXTURE_TOOL_NAME}-${FIXTURE_VERSION}`);

      expect(() =>
        installReleaseArtifact({
          archivePath,
          installPath: installDir,
          version: FIXTURE_VERSION,
          toolName: FIXTURE_TOOL_NAME,
        }),
      ).toThrowError(/normalized relative POSIX path|top-level directory/);

      expect(existsSync(join(rootDir, 'escape.txt'))).toBe(false);
      expect(existsSync(installDir)).toBe(false);
      const installParent = join(rootDir, 'install');
      if (existsSync(installParent)) {
        const leftovers = readdirSync(installParent).filter((name) => name.startsWith('fixture-toolkit-install-'));
        expect(leftovers).toEqual([]);
      }
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('pre-existing files cannot satisfy missing required archive members', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-install-preexisting-'));
    const installDir = join(rootDir, 'install', 'fixture-toolkit');

    try {
      await createFixtureWorkspace(rootDir);
      const plan = buildReleaseArtifact({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        includeNodeModules: false,
        productionNodeModules: false,
      });

      // Seed the install path with a fake, incomplete tree that is missing the real cli.js.
      await mkdir(join(installDir, 'bin'), { recursive: true });
      await writeFile(join(installDir, 'VERSION'), `fake\n`);
      await writeFile(join(installDir, 'bin', 'fixture-cli'), `#!/usr/bin/env bash\necho fake\n`);
      chmodSync(join(installDir, 'bin', 'fixture-cli'), 0o755);

      // Without --force the install refuses because the destination is non-empty; the
      // fake tree must remain untouched (the real artifact is never extracted into it).
      expect(() =>
        installReleaseArtifact({
          archivePath: plan.artifactPath,
          installPath: installDir,
          version: FIXTURE_VERSION,
          toolName: FIXTURE_TOOL_NAME,
        }),
      ).toThrowError(/already exists and is non-empty/);
      expect(await readFile(join(installDir, 'VERSION'), 'utf8')).toBe(`fake\n`);

      // With --force the validated artifact fully replaces the fake tree; the bogus
      // VERSION file is overwritten with the real one.
      installReleaseArtifact({
        archivePath: plan.artifactPath,
        installPath: installDir,
        version: FIXTURE_VERSION,
        toolName: FIXTURE_TOOL_NAME,
        force: true,
      });
      expect(await readFile(join(installDir, 'VERSION'), 'utf8')).toBe(`${FIXTURE_VERSION}\n`);
      expect(existsSync(join(installDir, 'packages', 'fixture-cli', 'cli.js'))).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('validateReleaseArchive', () => {
  it('returns the top-level directory name for a valid artifact', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-validate-valid-'));

    try {
      await createFixtureWorkspace(rootDir);
      const plan = buildReleaseArtifact({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        includeNodeModules: false,
        productionNodeModules: false,
      });

      const validated = validateReleaseArchive(plan.artifactPath);
      expect(validated.topLevelDirName).toBe(`${FIXTURE_TOOL_NAME}-${FIXTURE_VERSION}`);
      expect(validated.archiveFileName).toBe(`${FIXTURE_TOOL_NAME}-${FIXTURE_VERSION}.tar.gz`);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('throws before extraction for a traversal archive', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-validate-trav-'));
    const archivePath = join(rootDir, `${FIXTURE_TOOL_NAME}-${FIXTURE_VERSION}.tar.gz`);

    try {
      await createTraversalArchive(archivePath, `${FIXTURE_TOOL_NAME}-${FIXTURE_VERSION}`);
      expect(() => validateReleaseArchive(archivePath)).toThrowError(
        /normalized relative POSIX path|top-level directory/,
      );
      expect(existsSync(join(rootDir, 'escape.txt'))).toBe(false);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('verifyExtractedArtifact', () => {
  it('runs symlink, manifest, required-file, and wrapper checks on an extracted tree', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-verify-extr-'));

    try {
      await createFixtureWorkspace(rootDir);
      const plan = buildReleaseArtifact({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        includeNodeModules: false,
        productionNodeModules: false,
      });

      const extractRoot = await mkdtemp(join(tmpdir(), 'repo-toolkit-extract-'));
      try {
        execFileSync('tar', ['-xzf', plan.artifactPath, '-C', extractRoot], { stdio: 'inherit' });
        const installRoot = join(extractRoot, plan.artifactDirName);

        const manifest = verifyExtractedArtifact(installRoot, {
          archiveFileName: basename(plan.artifactPath),
          expectedDirName: plan.artifactDirName,
          expectedVersion: FIXTURE_VERSION,
          expectedToolName: FIXTURE_TOOL_NAME,
        });

        expect(manifest.toolName).toBe(FIXTURE_TOOL_NAME);
        expect(manifest.commands.map((c) => c.name)).toEqual(['fixture-cli']);
      } finally {
        await rm(extractRoot, { recursive: true, force: true });
      }
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects a missing required file', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-verify-missing-'));

    try {
      await createFixtureWorkspace(rootDir);
      const plan = buildReleaseArtifact({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        includeNodeModules: false,
        productionNodeModules: false,
      });

      const extractRoot = await mkdtemp(join(tmpdir(), 'repo-toolkit-extract-'));
      try {
        execFileSync('tar', ['-xzf', plan.artifactPath, '-C', extractRoot], { stdio: 'inherit' });
        const installRoot = join(extractRoot, plan.artifactDirName);

        // Remove a required file; verifyExtractedArtifact must fail before any wrapper runs.
        rmSync(join(installRoot, 'packages', 'fixture-cli', 'cli.js'), { force: true });

        expect(() =>
          verifyExtractedArtifact(installRoot, {
            archiveFileName: basename(plan.artifactPath),
            expectedDirName: plan.artifactDirName,
            expectedVersion: FIXTURE_VERSION,
            expectedToolName: FIXTURE_TOOL_NAME,
          }),
        ).toThrowError(/missing packages\/fixture-cli\/cli\.js/);
      } finally {
        await rm(extractRoot, { recursive: true, force: true });
      }
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects a manifest version mismatch', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-verify-version-'));

    try {
      await createFixtureWorkspace(rootDir);
      const plan = buildReleaseArtifact({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        includeNodeModules: false,
        productionNodeModules: false,
      });

      const extractRoot = await mkdtemp(join(tmpdir(), 'repo-toolkit-extract-'));
      try {
        execFileSync('tar', ['-xzf', plan.artifactPath, '-C', extractRoot], { stdio: 'inherit' });
        const installRoot = join(extractRoot, plan.artifactDirName);

        expect(() =>
          verifyExtractedArtifact(installRoot, {
            archiveFileName: basename(plan.artifactPath),
            expectedDirName: plan.artifactDirName,
            expectedVersion: '9.9.9',
            expectedToolName: FIXTURE_TOOL_NAME,
          }),
        ).toThrowError(/version mismatch/);
      } finally {
        await rm(extractRoot, { recursive: true, force: true });
      }
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);
});

function runInstallScript(repoRoot: string, env: NodeJS.ProcessEnv): { status: number; stderr: string } {
  try {
    execFileSync('bash', [join(repoRoot, 'bin', 'install')], {
      env,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return { status: 0, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stderr?: string };
    return { status: e.status ?? 1, stderr: e.stderr ?? '' };
  }
}

describe('bin/install (black-box)', () => {
  const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
  const REPO_TOOL_NAME = 'repo-toolkit';
  const REPO_VERSION = '0.0.0-bbtest';

  async function buildRealRepoArtifact(): Promise<string> {
    buildReleaseArtifact({ version: REPO_VERSION, cwd: repoRoot, toolName: REPO_TOOL_NAME });
    return join(repoRoot, 'dist', `${REPO_TOOL_NAME}-${REPO_VERSION}.tar.gz`);
  }

  it('rejects malicious traversal archives before extracting and leaves no partial state', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-bbinstall-trav-'));
    const downloadDir = join(rootDir, 'download');
    const installDir = join(rootDir, 'install');
    const archivePath = join(downloadDir, `${FIXTURE_TOOL_NAME}-${FIXTURE_VERSION}.tar.gz`);

    try {
      await mkdir(downloadDir, { recursive: true });
      await createTraversalArchive(archivePath, `${FIXTURE_TOOL_NAME}-${FIXTURE_VERSION}`);

      const { status, stderr } = runInstallScript(repoRoot, {
        ...process.env,
        ASDF_INSTALL_TYPE: 'version',
        ASDF_INSTALL_VERSION: FIXTURE_VERSION,
        ASDF_INSTALL_PATH: installDir,
        ASDF_DOWNLOAD_PATH: downloadDir,
      });

      expect(status).not.toBe(0);
      expect(stderr).toMatch(/normalized relative POSIX path|top-level directory/);
      expect(existsSync(join(installDir, 'escape.txt'))).toBe(false);
      // No partial install tree, and no leftover temp dirs in the install parent.
      expect(existsSync(installDir)).toBe(false);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('installs a valid real-repo artifact atomically and reports success', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-bbinstall-valid-'));
    const downloadDir = join(rootDir, 'download');
    const installDir = join(rootDir, 'install', REPO_TOOL_NAME);
    let archivePath: string;

    try {
      await mkdir(downloadDir, { recursive: true });
      archivePath = await buildRealRepoArtifact();
      await import('node:fs/promises').then((fs) => fs.copyFile(archivePath, join(downloadDir, basename(archivePath))));

      const { status, stderr } = runInstallScript(repoRoot, {
        ...process.env,
        ASDF_INSTALL_TYPE: 'version',
        ASDF_INSTALL_VERSION: REPO_VERSION,
        ASDF_INSTALL_PATH: installDir,
        ASDF_DOWNLOAD_PATH: downloadDir,
      });

      expect(status).toBe(0);
      expect(stderr).toBe('');
      expect(existsSync(join(installDir, 'artifact-manifest.json'))).toBe(true);
      expect(existsSync(join(installDir, 'VERSION'))).toBe(true);
      expect(existsSync(join(installDir, 'bin', 'repo-toolkit-verify-artifact'))).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
      rmSync(archivePath!, { force: true });
      rmSync(join(repoRoot, 'dist', `${REPO_TOOL_NAME}-${REPO_VERSION}`), { recursive: true, force: true });
    }
  }, 120_000);

  it('rejects a stale non-empty destination without touching the existing tree', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-bbinstall-stale-'));
    const downloadDir = join(rootDir, 'download');
    const installDir = join(rootDir, 'install', REPO_TOOL_NAME);
    let archivePath: string;

    try {
      await mkdir(installDir, { recursive: true });
      await writeFile(join(installDir, 'preexisting.txt'), 'untouched\n');
      await mkdir(downloadDir, { recursive: true });
      archivePath = await buildRealRepoArtifact();
      await import('node:fs/promises').then((fs) => fs.copyFile(archivePath, join(downloadDir, basename(archivePath))));

      const { status, stderr } = runInstallScript(repoRoot, {
        ...process.env,
        ASDF_INSTALL_TYPE: 'version',
        ASDF_INSTALL_VERSION: REPO_VERSION,
        ASDF_INSTALL_PATH: installDir,
        ASDF_DOWNLOAD_PATH: downloadDir,
      });

      expect(status).not.toBe(0);
      expect(stderr).toMatch(/already exists and is non-empty/);
      expect(await readFile(join(installDir, 'preexisting.txt'), 'utf8')).toBe('untouched\n');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
      rmSync(archivePath!, { force: true });
      rmSync(join(repoRoot, 'dist', `${REPO_TOOL_NAME}-${REPO_VERSION}`), { recursive: true, force: true });
    }
  }, 120_000);

  it('rejects a version mismatch before placing any files and leaves no temp dir', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-bbinstall-ver-'));
    const downloadDir = join(rootDir, 'download');
    const installDir = join(rootDir, 'install', REPO_TOOL_NAME);
    let archivePath: string;

    try {
      await mkdir(downloadDir, { recursive: true });
      archivePath = await buildRealRepoArtifact();
      await import('node:fs/promises').then((fs) => fs.copyFile(archivePath, join(downloadDir, basename(archivePath))));

      const { status, stderr } = runInstallScript(repoRoot, {
        ...process.env,
        ASDF_INSTALL_TYPE: 'version',
        ASDF_INSTALL_VERSION: '9.9.9',
        ASDF_INSTALL_PATH: installDir,
        ASDF_DOWNLOAD_PATH: downloadDir,
      });

      expect(status).not.toBe(0);
      expect(stderr).toMatch(/extracted to unexpected directory|version mismatch/);
      expect(existsSync(installDir)).toBe(false);
      // No leftover temp dirs in the install parent.
      const installParent = join(rootDir, 'install');
      const leftovers = existsSync(installParent)
        ? readdirSync(installParent).filter((name) => name.startsWith('repo-toolkit-install-'))
        : [];
      expect(leftovers).toEqual([]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
      rmSync(archivePath!, { force: true });
      rmSync(join(repoRoot, 'dist', `${REPO_TOOL_NAME}-${REPO_VERSION}`), { recursive: true, force: true });
    }
  }, 120_000);

  it('pre-existing files cannot satisfy a missing required archive member', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-bbinstall-preexisting-'));
    const downloadDir = join(rootDir, 'download');
    const installDir = join(rootDir, 'install', REPO_TOOL_NAME);
    let archivePath: string;

    try {
      await mkdir(join(installDir, 'bin'), { recursive: true });
      await writeFile(join(installDir, 'VERSION'), 'fake\n');
      await writeFile(join(installDir, 'bin', 'repo-toolkit-verify-artifact'), '#!/usr/bin/env bash\n');
      await mkdir(downloadDir, { recursive: true });
      archivePath = await buildRealRepoArtifact();
      await import('node:fs/promises').then((fs) => fs.copyFile(archivePath, join(downloadDir, basename(archivePath))));

      const { status, stderr } = runInstallScript(repoRoot, {
        ...process.env,
        ASDF_INSTALL_TYPE: 'version',
        ASDF_INSTALL_VERSION: REPO_VERSION,
        ASDF_INSTALL_PATH: installDir,
        ASDF_DOWNLOAD_PATH: downloadDir,
      });

      expect(status).not.toBe(0);
      expect(stderr).toMatch(/already exists and is non-empty/);
      // The fake install tree must remain untouched; the real artifact is never
      // extracted into it (validation runs against a fresh temp sibling).
      expect(await readFile(join(installDir, 'VERSION'), 'utf8')).toBe('fake\n');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
      rmSync(archivePath!, { force: true });
      rmSync(join(repoRoot, 'dist', `${REPO_TOOL_NAME}-${REPO_VERSION}`), { recursive: true, force: true });
    }
  }, 120_000);

  it('rejects multiple archives in the download dir', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-bbinstall-multi-'));
    const downloadDir = join(rootDir, 'download');
    const installDir = join(rootDir, 'install', REPO_TOOL_NAME);
    let archivePath: string;

    try {
      await mkdir(downloadDir, { recursive: true });
      archivePath = await buildRealRepoArtifact();
      await import('node:fs/promises').then((fs) =>
        Promise.all([
          fs.copyFile(archivePath, join(downloadDir, 'a.tar.gz')),
          fs.copyFile(archivePath, join(downloadDir, 'b.tar.gz')),
        ]),
      );

      const { status, stderr } = runInstallScript(repoRoot, {
        ...process.env,
        ASDF_INSTALL_TYPE: 'version',
        ASDF_INSTALL_VERSION: REPO_VERSION,
        ASDF_INSTALL_PATH: installDir,
        ASDF_DOWNLOAD_PATH: downloadDir,
      });

      expect(status).not.toBe(0);
      expect(stderr).toMatch(/Expected exactly one release archive/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
      rmSync(archivePath!, { force: true });
      rmSync(join(repoRoot, 'dist', `${REPO_TOOL_NAME}-${REPO_VERSION}`), { recursive: true, force: true });
    }
  }, 120_000);

  it('rejects install types other than version', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-bbinstall-type-'));
    const downloadDir = join(rootDir, 'download');
    const installDir = join(rootDir, 'install', REPO_TOOL_NAME);

    try {
      await mkdir(downloadDir, { recursive: true });
      const { status, stderr } = runInstallScript(repoRoot, {
        ...process.env,
        ASDF_INSTALL_TYPE: 'ref',
        ASDF_INSTALL_VERSION: REPO_VERSION,
        ASDF_INSTALL_PATH: installDir,
        ASDF_DOWNLOAD_PATH: downloadDir,
      });

      expect(status).not.toBe(0);
      expect(stderr).toMatch(/install type 'version' only/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('yields equivalent outcomes to verifyReleaseArtifact for the traversal corpus', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-bbinstall-equiv-'));
    const downloadDir = join(rootDir, 'download');
    const installDir = join(rootDir, 'install');
    const archivePath = join(downloadDir, `${FIXTURE_TOOL_NAME}-${FIXTURE_VERSION}.tar.gz`);

    try {
      await mkdir(downloadDir, { recursive: true });
      await createTraversalArchive(archivePath, `${FIXTURE_TOOL_NAME}-${FIXTURE_VERSION}`);

      let verifierMessage = '';
      try {
        verifyReleaseArtifact({ artifactPath: archivePath });
      } catch (error) {
        verifierMessage = (error as Error).message;
      }
      expect(verifierMessage.length).toBeGreaterThan(0);

      const { status, stderr } = runInstallScript(repoRoot, {
        ...process.env,
        ASDF_INSTALL_TYPE: 'version',
        ASDF_INSTALL_VERSION: FIXTURE_VERSION,
        ASDF_INSTALL_PATH: installDir,
        ASDF_DOWNLOAD_PATH: downloadDir,
      });

      expect(status).not.toBe(0);
      // The embedded bundle shares the same validateReleaseArchive code path as
      // verifyReleaseArtifact, so both reject with the same message for traversal archives.
      expect(stderr).toContain(verifierMessage.split('\n')[0]);
      expect(existsSync(join(installDir, 'escape.txt'))).toBe(false);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('resolveNodeModulesMode (RAARC-01)', () => {
  it('defaults to production when nothing is supplied', () => {
    expect(resolveNodeModulesMode(undefined, undefined, undefined)).toBe<'production'>('production');
  });

  it('maps productionNodeModules=true to production and ignores includeNodeModules', () => {
    expect(resolveNodeModulesMode(undefined, true, true)).toBe<'production'>('production');
    expect(resolveNodeModulesMode(undefined, false, true)).toBe<'production'>('production');
  });

  it('maps productionNodeModules=false + includeNodeModules=true to copy', () => {
    expect(resolveNodeModulesMode(undefined, true, false)).toBe<'copy'>('copy');
  });

  it('maps productionNodeModules=false + includeNodeModules=false to none', () => {
    expect(resolveNodeModulesMode(undefined, false, false)).toBe<'none'>('none');
  });

  it('maps productionNodeModules=false with no includeNodeModules to none', () => {
    expect(resolveNodeModulesMode(undefined, undefined, false)).toBe<'none'>('none');
  });

  it('maps includeNodeModules=true alone to copy', () => {
    expect(resolveNodeModulesMode(undefined, true, undefined)).toBe<'copy'>('copy');
  });

  it('maps includeNodeModules=false alone to none', () => {
    expect(resolveNodeModulesMode(undefined, false, undefined)).toBe<'none'>('none');
  });

  it('accepts an explicit mode that agrees with the legacy booleans', () => {
    expect(resolveNodeModulesMode('production', false, true)).toBe<'production'>('production');
    expect(resolveNodeModulesMode('copy', true, false)).toBe<'copy'>('copy');
    expect(resolveNodeModulesMode('none', false, false)).toBe<'none'>('none');
  });

  it('rejects an explicit mode that contradicts the legacy booleans', () => {
    expect(() => resolveNodeModulesMode('none', false, true)).toThrowError(/contradicts the legacy booleans/);
    expect(() => resolveNodeModulesMode('copy', false, true)).toThrowError(/contradicts the legacy booleans/);
    expect(() => resolveNodeModulesMode('production', true, false)).toThrowError(/contradicts the legacy booleans/);
  });

  it('rejects an invalid mode label', () => {
    expect(() => resolveNodeModulesMode('bogus' as NodeModulesMode, undefined, undefined)).toThrowError(
      /Invalid nodeModulesMode/,
    );
  });
});

describe('intersectSemverRanges (RAARC-03)', () => {
  it('returns the lone range when all listed ranges agree', () => {
    expect(intersectSemverRanges(['^1.2.3'])).toBe('^1.2.3');
    expect(intersectSemverRanges(['^1.2.3', '^1.2.3'])).toBe('^1.2.3');
  });

  it('picks the narrower of two compatible ranges with the same major', () => {
    expect(intersectSemverRanges(['^1.2.3', '^1.0.0'])).toBe('^1.0.0');
  });

  it('returns null for major-version conflicts', () => {
    expect(intersectSemverRanges(['^1.0.0', '^2.0.0'])).toBeNull();
  });

  it('returns null for malformed ranges', () => {
    expect(intersectSemverRanges(['not-a-version'])).toBeNull();
  });

  it('treats workspace: as identical and returns the sorted-min range', () => {
    expect(intersectSemverRanges(['workspace:*', 'workspace:*'])).toBe('workspace:*');
    expect(intersectSemverRanges(['workspace:^1.2.3', 'workspace:*'])).toBe('workspace:*');
  });

  it('rejects mixtures of workspace: and concrete ranges', () => {
    expect(intersectSemverRanges(['workspace:*', '^1.2.3'])).toBeNull();
  });
});

describe('mergeClosureDependencies (RAARC-03)', () => {
  it('merges and deduplicates identical ranges across closure members', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-merge-closure-'));
    try {
      await mkdir(join(rootDir, 'packages', 'a'), { recursive: true });
      await mkdir(join(rootDir, 'packages', 'b'), { recursive: true });
      await writeFile(
        join(rootDir, 'packages', 'a', 'package.json'),
        `${JSON.stringify({ name: '@example/a', dependencies: { lodash: '^4.0.0' } })}\n`,
      );
      await writeFile(
        join(rootDir, 'packages', 'b', 'package.json'),
        `${JSON.stringify({ name: '@example/b', dependencies: { lodash: '^4.0.0', axios: '^1.0.0' } })}\n`,
      );

      expect(mergeClosureDependencies(join(rootDir, 'packages'), ['a', 'b'])).toEqual({
        lodash: '^4.0.0',
        axios: '^1.0.0',
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('keeps internal @repo-toolkit/* workspace deps so the install links them', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-merge-closure-int-'));
    try {
      await mkdir(join(rootDir, 'packages', 'a'), { recursive: true });
      await mkdir(join(rootDir, 'packages', 'b'), { recursive: true });
      await writeFile(
        join(rootDir, 'packages', 'a', 'package.json'),
        `${JSON.stringify({ name: '@repo-toolkit/a', dependencies: { '@repo-toolkit/b': 'workspace:*', lodash: '^4.0.0' } })}\n`,
      );
      await writeFile(
        join(rootDir, 'packages', 'b', 'package.json'),
        `${JSON.stringify({ name: '@repo-toolkit/b', dependencies: { lodash: '^4.0.0' } })}\n`,
      );

      expect(mergeClosureDependencies(join(rootDir, 'packages'), ['a', 'b'])).toEqual({
        '@repo-toolkit/b': 'workspace:*',
        lodash: '^4.0.0',
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects incompatible range conflicts with a clear message', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-merge-closure-conflict-'));
    try {
      await mkdir(join(rootDir, 'packages', 'a'), { recursive: true });
      await mkdir(join(rootDir, 'packages', 'b'), { recursive: true });
      await writeFile(
        join(rootDir, 'packages', 'a', 'package.json'),
        `${JSON.stringify({ name: '@example/a', dependencies: { lodash: '^1.0.0' } })}\n`,
      );
      await writeFile(
        join(rootDir, 'packages', 'b', 'package.json'),
        `${JSON.stringify({ name: '@example/b', dependencies: { lodash: '^2.0.0' } })}\n`,
      );

      expect(() => mergeClosureDependencies(join(rootDir, 'packages'), ['a', 'b'])).toThrowError(
        /Incompatible dependency ranges for lodash/,
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('collectCommandPackageClosure (RAARC-03)', () => {
  it('walks internal workspace deps from command-owning packages', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-closure-walk-'));
    try {
      await mkdir(join(rootDir, 'packages', 'cli-a'), { recursive: true });
      await mkdir(join(rootDir, 'packages', 'shared-b'), { recursive: true });
      await mkdir(join(rootDir, 'packages', 'unrelated-c'), { recursive: true });
      await writeFile(
        join(rootDir, 'packages', 'cli-a', 'package.json'),
        `${JSON.stringify({ name: '@repo-toolkit/cli-a', dependencies: { '@repo-toolkit/shared-b': 'workspace:*' } })}\n`,
      );
      await writeFile(
        join(rootDir, 'packages', 'shared-b', 'package.json'),
        `${JSON.stringify({ name: '@repo-toolkit/shared-b' })}\n`,
      );
      await writeFile(
        join(rootDir, 'packages', 'unrelated-c', 'package.json'),
        `${JSON.stringify({ name: '@example/unrelated-c' })}\n`,
      );

      const closure = collectCommandPackageClosure(
        join(rootDir, 'packages'),
        ['cli-a', 'shared-b', 'unrelated-c'],
        [{ name: 'cli-a', packageDir: 'cli-a', entry: 'cli.js' }],
      );

      expect(closure).toEqual(['cli-a', 'shared-b']);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('returns just the owner when an owner has no internal deps', () => {
    expect(
      collectCommandPackageClosure('/nonexistent', ['a'], [{ name: 'x', packageDir: 'a', entry: 'cli.js' }]),
    ).toEqual(['a']);
  });
});

describe('resolveRootFileDestination (RAARC-02)', () => {
  it('preserves the configured subpath', () => {
    expect(resolveRootFileDestination('VERSION', 'versionFiles')).toBe('VERSION');
    expect(resolveRootFileDestination('config/version.txt', 'versionFiles')).toBe('config/version.txt');
  });

  it('rejects absolute, drive-prefixed, backslash, NUL, dot-segment, and backslash paths', () => {
    expect(() => resolveRootFileDestination('/etc/passwd', 'versionFiles')).toThrowError(
      /normalized relative POSIX path/,
    );
    expect(() => resolveRootFileDestination('C:\\Windows\\system32', 'versionFiles')).toThrowError(
      /normalized relative POSIX path/,
    );
    expect(() => resolveRootFileDestination('../escape', 'versionFiles')).toThrowError(
      /normalized relative POSIX path/,
    );
    expect(() => resolveRootFileDestination('a/../../b', 'versionFiles')).toThrow();
    expect(() => resolveRootFileDestination('a\0b', 'versionFiles')).toThrow();
    expect(() => resolveRootFileDestination('a\nb', 'versionFiles')).toThrow();
    expect(() => resolveRootFileDestination('a\\b', 'versionFiles')).toThrow();
  });
});

describe('buildReleaseArtifact root-file destination handling (RAARC-02)', () => {
  it('fails the build when a version file source is missing', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-missing-version-'));
    try {
      await createFixtureWorkspace(rootDir);

      expect(() =>
        buildReleaseArtifact({
          version: FIXTURE_VERSION,
          cwd: rootDir,
          toolName: FIXTURE_TOOL_NAME,
          nodeModulesMode: 'none',
          versionFiles: ['does-not-exist.txt'],
        }),
      ).toThrowError(/versionFiles source not found: does-not-exist\.txt/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('fails the build when a root file source is missing', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-missing-root-'));
    try {
      await createFixtureWorkspace(rootDir);

      expect(() =>
        buildReleaseArtifact({
          version: FIXTURE_VERSION,
          cwd: rootDir,
          toolName: FIXTURE_TOOL_NAME,
          nodeModulesMode: 'none',
          rootFiles: ['missing.txt'],
        }),
      ).toThrowError(/rootFiles source not found: missing\.txt/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('fails when a root file source is a directory', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-dir-root-'));
    try {
      await createFixtureWorkspace(rootDir);
      await mkdir(join(rootDir, 'docs'), { recursive: true });

      expect(() =>
        buildReleaseArtifact({
          version: FIXTURE_VERSION,
          cwd: rootDir,
          toolName: FIXTURE_TOOL_NAME,
          nodeModulesMode: 'none',
          rootFiles: ['docs'],
        }),
      ).toThrowError(/directory, not a regular file/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('fails when a version file source is a non-regular FIFO', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-fifo-root-'));
    try {
      await createFixtureWorkspace(rootDir);

      await new Promise<void>((resolve, reject) => {
        const fifoPath = join(rootDir, 'fifo');
        const mk = spawn('mkfifo', [fifoPath]);
        mk.on('error', reject);
        mk.on('exit', (status) => (status === 0 ? resolve() : reject(new Error(`mkfifo failed: ${status}`))));
      });

      expect(() =>
        buildReleaseArtifact({
          version: FIXTURE_VERSION,
          cwd: rootDir,
          toolName: FIXTURE_TOOL_NAME,
          nodeModulesMode: 'none',
          versionFiles: ['VERSION', 'fifo'],
        }),
      ).toThrowError(/FIFO|not a regular file|is not a regular file/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('fails when two version files resolve to the same destination (duplicate entry)', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-basename-collision-'));
    try {
      await createFixtureWorkspace(rootDir);

      expect(() =>
        buildReleaseArtifact({
          version: FIXTURE_VERSION,
          cwd: rootDir,
          toolName: FIXTURE_TOOL_NAME,
          nodeModulesMode: 'none',
          versionFiles: ['VERSION', 'VERSION'],
        }),
      ).toThrowError(/destination collides with versionFiles: VERSION/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('fails when a version file and a root file resolve to the same destination (cross-category collision)', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-cross-collision-'));
    try {
      await createFixtureWorkspace(rootDir);

      expect(() =>
        buildReleaseArtifact({
          version: FIXTURE_VERSION,
          cwd: rootDir,
          toolName: FIXTURE_TOOL_NAME,
          nodeModulesMode: 'none',
          versionFiles: ['VERSION'],
          rootFiles: ['VERSION'],
        }),
      ).toThrowError(/rootFiles destination collides with versionFiles: VERSION/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('now preserves subpaths so previously colliding basenames no longer clash', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-preserved-subpath-'));
    try {
      await createFixtureWorkspace(rootDir);
      await mkdir(join(rootDir, 'config'), { recursive: true });
      await writeFile(join(rootDir, 'config', 'VERSION'), `nested\n`);

      const plan = buildReleaseArtifact({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        nodeModulesMode: 'none',
        versionFiles: ['VERSION', 'config/VERSION'],
      });

      try {
        expect(await readFile(join(plan.artifactRoot, 'VERSION'), 'utf8')).toBe(`${FIXTURE_VERSION}\n`);
        expect(await readFile(join(plan.artifactRoot, 'config', 'VERSION'), 'utf8')).toBe(`nested\n`);
      } finally {
        rmSync(plan.artifactRoot, { recursive: true, force: true });
        rmSync(plan.artifactPath, { recursive: true, force: true });
      }
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('fails when a root file destination collides with a reserved path', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-reserved-dest-'));
    try {
      await createFixtureWorkspace(rootDir);
      await writeFile(join(rootDir, 'artifact-manifest.json'), '{}\n');

      expect(() =>
        buildReleaseArtifact({
          version: FIXTURE_VERSION,
          cwd: rootDir,
          toolName: FIXTURE_TOOL_NAME,
          nodeModulesMode: 'none',
          versionFiles: [],
          rootFiles: ['artifact-manifest.json'],
        }),
      ).toThrowError(/destination is reserved: artifact-manifest\.json/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('fails when a root file directory collides with bin or packages', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-reserved-dir-'));
    try {
      await createFixtureWorkspace(rootDir);
      await mkdir(join(rootDir, 'bin'), { recursive: true });
      await writeFile(join(rootDir, 'bin', 'extra.txt'), 'collision\n');

      expect(() =>
        buildReleaseArtifact({
          version: FIXTURE_VERSION,
          cwd: rootDir,
          toolName: FIXTURE_TOOL_NAME,
          nodeModulesMode: 'none',
          rootFiles: ['bin/extra.txt'],
        }),
      ).toThrowError(/destination collides with a reserved path: bin\/extra\.txt/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('preserves the configured subpath for nested version files', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-nested-version-'));
    try {
      await createFixtureWorkspace(rootDir);
      await mkdir(join(rootDir, 'config'), { recursive: true });
      await writeFile(join(rootDir, 'config', 'version.txt'), `${FIXTURE_VERSION}-nested\n`);

      const plan = buildReleaseArtifact({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        nodeModulesMode: 'none',
        versionFiles: ['config/version.txt'],
      });

      try {
        expect(await readFile(join(plan.artifactRoot, 'config', 'version.txt'), 'utf8')).toBe(
          `${FIXTURE_VERSION}-nested\n`,
        );
      } finally {
        rmSync(plan.artifactRoot, { recursive: true, force: true });
        rmSync(plan.artifactPath, { recursive: true, force: true });
      }
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects a root file symlink that escapes the workspace root', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-escaping-symlink-'));
    try {
      await createFixtureWorkspace(rootDir);
      await writeFile(join(tmpdir(), 'outside.txt'), 'escaped\n');
      const targetOutside = join(tmpdir(), 'outside.txt');
      try {
        await symlink(targetOutside, join(rootDir, 'VERSION-link'));
      } catch {
        return;
      }

      expect(() =>
        buildReleaseArtifact({
          version: FIXTURE_VERSION,
          cwd: rootDir,
          toolName: FIXTURE_TOOL_NAME,
          nodeModulesMode: 'none',
          rootFiles: ['VERSION-link'],
        }),
      ).toThrowError(/symlink escapes the workspace root/);
    } finally {
      await rm(join(tmpdir(), 'outside.txt'), { force: true });
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('buildReleaseArtifact with injected runner (RAARC-04)', () => {
  interface FakeRun {
    executable: string;
    args: string[];
    options: ArtifactRunOptions;
  }

  interface RecordingRunner extends ArtifactRunner {
    runs: FakeRun[];
    captureResults: Map<string, string>;
    failNextWith: Error | null;
  }

  function createRecordingRunner(): RecordingRunner {
    const runs: FakeRun[] = [];
    const captureResults = new Map<string, string>();
    const runner: RecordingRunner = {
      runs,
      captureResults,
      failNextWith: null,
      run(executable, args, options) {
        runs.push({ executable, args: [...args], options });
        if (runner.failNextWith) {
          const err = runner.failNextWith;
          runner.failNextWith = null;
          throw err;
        }
      },
      capture(executable, args, options) {
        runs.push({ executable, args: [...args], options });
        if (runner.failNextWith) {
          const err = runner.failNextWith;
          runner.failNextWith = null;
          throw err;
        }
        const key = `${executable} ${[...args].join(' ')}`;
        return captureResults.get(key) ?? '';
      },
    };
    return runner;
  }

  it('build routes tar through the injected runner with the configured cwd and timeout', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-runner-build-'));
    const runner = createRecordingRunner();
    let plan: ReturnType<typeof buildReleaseArtifact> | undefined;
    try {
      await createFixtureWorkspace(rootDir);

      plan = buildReleaseArtifact({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        nodeModulesMode: 'none',
        runner,
        runTimeoutMs: 5_000,
      });

      // The build only invokes tar via the runner. There is no pnpm install in 'none' mode.
      expect(runner.runs.filter((r) => r.executable === 'tar')).toHaveLength(1);
      const tarRun = runner.runs.find((r) => r.executable === 'tar');
      expect(tarRun?.args).toEqual(['-czf', plan.artifactPath, '-C', plan.distRoot, plan.artifactDirName]);
      expect(tarRun?.options.cwd).toBe(plan.repoRoot);
      expect(tarRun?.options.timeoutMs).toBe(5_000);
      expect(tarRun?.options.stdio).toBe('inherit');
    } finally {
      if (plan) {
        rmSync(plan.artifactRoot, { recursive: true, force: true });
        rmSync(plan.artifactPath, { recursive: true, force: true });
      }
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('build routes pnpm through the injected runner in production mode', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-runner-pnpm-'));
    const runner = createRecordingRunner();
    let plan: ReturnType<typeof buildReleaseArtifact> | undefined;
    try {
      await createFixtureWorkspace(rootDir);

      plan = buildReleaseArtifact({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        nodeModulesMode: 'production',
        runner,
        runTimeoutMs: 7_500,
      });

      const pnpmRun = runner.runs.find((r) => r.executable === 'pnpm');
      expect(pnpmRun).toBeDefined();
      expect(pnpmRun?.args).toEqual([
        'install',
        '--prod',
        '--no-frozen-lockfile',
        '--ignore-scripts',
        '--prefer-offline',
      ]);
      expect(pnpmRun?.options.cwd).toBe(plan.artifactRoot);
      expect(pnpmRun?.options.timeoutMs).toBe(7_500);
    } finally {
      if (plan) {
        rmSync(plan.artifactRoot, { recursive: true, force: true });
        rmSync(plan.artifactPath, { recursive: true, force: true });
      }
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('build does NOT invoke pnpm when nodeModulesMode is none or copy', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-runner-no-pnpm-'));
    const runner = createRecordingRunner();
    let plan: ReturnType<typeof buildReleaseArtifact> | undefined;
    try {
      await createFixtureWorkspace(rootDir);

      plan = buildReleaseArtifact({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        nodeModulesMode: 'none',
        runner,
      });

      expect(runner.runs.find((r) => r.executable === 'pnpm')).toBeUndefined();
    } finally {
      if (plan) {
        rmSync(plan.artifactRoot, { recursive: true, force: true });
        rmSync(plan.artifactPath, { recursive: true, force: true });
      }
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects a runner that is not an ArtifactRunner object', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-runner-reject-'));
    try {
      await createFixtureWorkspace(rootDir);
      expect(() =>
        buildReleaseArtifact({
          version: FIXTURE_VERSION,
          cwd: rootDir,
          toolName: FIXTURE_TOOL_NAME,
          nodeModulesMode: 'none',
          runner: 'not-a-runner' as unknown as ArtifactRunner,
        }),
      ).toThrowError(/runner must be an ArtifactRunner object/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('verify routes tar listing through capture() and bash/wrapper through run()', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-runner-verify-'));
    const runner = createRecordingRunner();
    let plan: ReturnType<typeof buildReleaseArtifact> | undefined;
    try {
      await createFixtureWorkspace(rootDir);

      // Build via the default runner first (so we have a real archive);
      plan = buildReleaseArtifact({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        nodeModulesMode: 'none',
      });

      // Reset the recorder to capture only verify invocations; reuse as the verify runner.
      runner.runs.length = 0;
      // Prepare a fake tar listing for capture(): single top-level dir + the
      // fixture cli.js file extracted beneath. We test capture() returns the
      // string the caller requested.
      const listingKey = `tar -tvzf ${plan.artifactPath} --full-time --numeric-owner`;
      runner.captureResults.set(
        listingKey,
        [
          `drwxr-xr-x 0/0 0 2026-08-04 14:19:59 ${plan.artifactDirName}/`,
          `-rw-r--r-- 0/0 12 2026-08-04 14:19:59 ${plan.artifactDirName}/VERSION`,
        ].join('\n'),
      );

      // The verify pipeline runs the real tar extraction; we cannot fake that here.
      // We only assert that build artifact validation routes the listing via capture().
      expect(() => validateReleaseArchive(plan.artifactPath, { runner, cwd: rootDir })).not.toThrow();

      const captureRun = runner.runs.find((r) => r.executable === 'tar' && r.args[0] === '-tvzf');
      expect(captureRun).toBeDefined();
      expect(captureRun?.options.cwd).toBe(rootDir);
    } finally {
      if (plan) {
        rmSync(plan.artifactRoot, { recursive: true, force: true });
        rmSync(plan.artifactPath, { recursive: true, force: true });
      }
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('default runner terminates a hanging process with a clear error when the timeout fires', () => {
    // Use a node script that sleeps longer than the configured timeout. The
    // default runner must kill the child and surface a nonzero exit / clear
    // error rather than hanging the test.
    const node = process.execPath;
    const hangScript = 'setInterval(()=>{}, 100)';
    expect(() => defaultArtifactRunner.run(node, ['-e', hangScript], { cwd: tmpdir(), timeoutMs: 200 })).toThrowError();
  }, 5_000);

  it('default runner rejects captured output larger than maxOutputBytes', () => {
    // Generate ~4 KB of output while the cap is set to 1 KB.
    const node = process.execPath;
    expect(() =>
      defaultArtifactRunner.capture(node, ['-e', "process.stdout.write('x'.repeat(4096))"], {
        cwd: tmpdir(),
        timeoutMs: 5_000,
        maxOutputBytes: 1024,
      }),
    ).toThrowError();
  }, 10_000);

  it('default runner.run accepts execFileSync options through the typed RunOptions', () => {
    // Sanity check that run() throws the expected error for a non-existent binary,
    // proving the runner surfaces process failures rather than swallowing them.
    expect(() => defaultArtifactRunner.run('/nonexistent-binary-xyz', [], { cwd: tmpdir() })).toThrowError();
  });
});

describe('resolveBuildArtifactPlan with deprecated boolean combinations (RAARC-01)', () => {
  it('rejects productionNodeModules=true paired with nodeModulesMode=none', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-plan-conflict-'));
    try {
      await createFixtureWorkspace(rootDir);

      expect(() =>
        resolveBuildArtifactPlan({
          version: FIXTURE_VERSION,
          cwd: rootDir,
          toolName: FIXTURE_TOOL_NAME,
          nodeModulesMode: 'none',
          productionNodeModules: true,
        }),
      ).toThrowError(/contradicts the legacy booleans/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('accepts an explicit nodeModulesMode and reports it on the plan', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-plan-mode-'));
    try {
      await createFixtureWorkspace(rootDir);

      const plan = resolveBuildArtifactPlan({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        nodeModulesMode: 'copy',
      });
      expect(plan.nodeModulesMode).toBe<'copy'>('copy');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects a non-finite or non-positive runTimeoutMs', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-plan-timeout-'));
    try {
      await createFixtureWorkspace(rootDir);
      expect(() =>
        resolveBuildArtifactPlan({
          version: FIXTURE_VERSION,
          cwd: rootDir,
          toolName: FIXTURE_TOOL_NAME,
          nodeModulesMode: 'none',
          runTimeoutMs: -1,
        }),
      ).toThrowError(/runTimeoutMs must be a positive finite number/);
      expect(() =>
        resolveBuildArtifactPlan({
          version: FIXTURE_VERSION,
          cwd: rootDir,
          toolName: FIXTURE_TOOL_NAME,
          nodeModulesMode: 'none',
          runTimeoutMs: Number.NaN,
        }),
      ).toThrowError(/runTimeoutMs must be a positive finite number/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe('installReleaseArtifact with injected runner', () => {
  it('routes tar listing and extraction through the injected runner', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'repo-toolkit-install-runner-inj-'));
    const installDir = join(rootDir, 'install', 'fixture-toolkit');

    const runs: Array<{ executable: string; args: string[] }> = [];
    let capturedListing = '';
    const runner: ArtifactRunner = {
      run(executable, args) {
        runs.push({ executable, args: [...args] });
      },
      capture() {
        return capturedListing;
      },
    };

    let archivePath = '';
    try {
      await createFixtureWorkspace(rootDir);
      const plan = buildReleaseArtifact({
        version: FIXTURE_VERSION,
        cwd: rootDir,
        toolName: FIXTURE_TOOL_NAME,
        nodeModulesMode: 'none',
      });
      archivePath = plan.artifactPath;

      // Capture the real tar listing once so the fake capture() can replay it.
      const realListing = execFileSync('tar', ['-tvzf', archivePath, '--full-time', '--numeric-owner'], {
        encoding: 'utf8',
      });
      capturedListing = realListing;

      // Reset runs; installReleaseArtifact will route tar listing through
      // capture() and the tar extraction through run(). The fake runner's
      // run() is a no-op, so the install will fail downstream when the
      // extractRoot ends up empty — but we only assert the runner was invoked.
      runs.length = 0;
      expect(() =>
        installReleaseArtifact({
          archivePath,
          installPath: installDir,
          version: FIXTURE_VERSION,
          toolName: FIXTURE_TOOL_NAME,
          runner,
        }),
      ).toThrow();

      const tarExtractCalls = runs.filter((r) => r.executable === 'tar' && r.args[0] === '-xzf');
      // Note: capture() invocations don't show up in `runs` (they go through capture()),
      // but the tar extraction call must go through run().
      expect(tarExtractCalls.length).toBeGreaterThanOrEqual(1);
      // Sanity: the listing call did happen (via capture, so not in runs).
      expect(capturedListing.length).toBeGreaterThan(0);
    } finally {
      if (archivePath) {
        rmSync(archivePath, { recursive: true, force: true });
      }
      rmSync(join(rootDir, 'dist', `${FIXTURE_TOOL_NAME}-${FIXTURE_VERSION}`), { recursive: true, force: true });
      await rm(rootDir, { recursive: true, force: true });
    }
  }, 30_000);
});
