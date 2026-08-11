import { execFileSync } from 'node:child_process';
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
  createArtifactManifest,
  installReleaseArtifact,
  matchesAnyGlob,
  resolveArtifactPath,
  resolveBuildArtifactPlan,
  toBinEntries,
  validateReleaseArchive,
  verifyExtractedArtifact,
  verifyReleaseArtifact,
  verifySymlinks,
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
    const plan = buildReleaseArtifact({
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

    rmSync(plan.artifactRoot, { recursive: true, force: true });
    rmSync(plan.artifactPath, { recursive: true, force: true });
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
