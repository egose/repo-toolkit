import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildReleaseArtifact,
  buildRequiredFiles,
  buildWrapperScript,
  collectCommands,
  createArtifactManifest,
  matchesAnyGlob,
  resolveArtifactPath,
  resolveBuildArtifactPlan,
  toBinEntries,
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
    expect(script).toContain('node_bin="${REPO_TOOLKIT_NODE_BIN:-${ASDF_NODEJS_BIN:-}}"');
    expect(script).toContain('exec "$node_bin" "${script_dir}/../packages/foo/dist/cli.js" "$@"');
  });

  it('falls back to the build-time nodeCommand when no env var is set', () => {
    const script = buildWrapperScript('packages/foo/dist/cli.js', 'node20');
    expect(script).toContain('node_bin="node20"');
  });

  it('appends the node command to a directory env var', () => {
    const script = buildWrapperScript('packages/foo/dist/cli.js', 'node');
    expect(script).toContain('[ -d "$node_bin" ] && node_bin="${node_bin}/node"');
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
      '1.2.3',
      [
        { name: 'b-cli', packageDir: 'b', entry: 'cli.js' },
        { name: 'a-cli', packageDir: 'a', entry: 'cli.js' },
      ],
      ['VERSION', 'artifact-manifest.json'],
    );

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
