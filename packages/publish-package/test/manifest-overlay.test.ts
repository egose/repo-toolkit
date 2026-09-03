import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  preparePackageArtifacts,
  type CapturingProcessRunner,
  type PackageArtifactRecipe,
  type ProcessCaptureOptions,
  type ProcessCaptureResult,
} from '../src/index';

interface FakeRunner extends CapturingProcessRunner {
  runs: Array<{ executable: string; args: string[] }>;
}

function createRunner(version: string): FakeRunner {
  const runner: FakeRunner = {
    runs: [],
    run(executable, args) {
      runner.runs.push({ executable, args: [...args] });
    },
    runShell() {},
    capture(
      executable: string,
      args: ReadonlyArray<string>,
      options: ProcessCaptureOptions,
    ): Promise<ProcessCaptureResult> {
      runner.runs.push({ executable, args: [...args] });
      const destIndex = args.indexOf('--pack-destination');
      const dest = args[destIndex + 1];
      const stageId = options.cwd.replace(/\\/g, '/').split('/').pop() ?? 'artifact';
      const filename = `example-pkg-${stageId}-${version}.tgz`;
      mkdirSync(dest, { recursive: true });
      writeFileSync(join(dest, filename), 'fake-tarball\n');
      return Promise.resolve({ stdout: JSON.stringify([{ filename }]), stderr: '', code: 0 });
    },
  };
  return runner;
}

async function makeRoot(manifest: Record<string, unknown>): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), 'pp-overlay-'));
  writeFileSync(join(rootDir, 'package.json'), `${JSON.stringify(manifest)}\n`);
  writeFileSync(join(rootDir, 'README.md'), '# pkg\n');
  writeFileSync(join(rootDir, 'LICENSE'), 'Apache-2.0\n');
  return rootDir;
}

function readManifest(stageDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(stageDir, 'package.json'), 'utf8')) as Record<string, unknown>;
}

async function prepare(rootDir: string, recipes: PackageArtifactRecipe[], version = '1.2.3'): Promise<string[]> {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const prepared = await preparePackageArtifacts({
      cwd: rootDir,
      version,
      skipBuild: true,
      runner: createRunner(version),
      artifacts: recipes,
    });
    return prepared.map((entry) => entry.stageDir);
  } finally {
    logSpy.mockRestore();
  }
}

describe('artifact manifest completion (ARTIFACT-04)', () => {
  it('preserves a source files allow-list and injects publishConfig.access for a recipe', async () => {
    const rootDir = await makeRoot({
      name: '@example/pkg',
      version: '0.0.0-PLACEHOLDER',
      author: 'PLACEHOLDER',
      files: ['dist', 'README.md'],
    });
    try {
      writeFileSync(join(rootDir, 'root-package-note.txt'), 'note\n');
      const [stageDir] = await prepare(rootDir, [
        {
          id: 'main',
          packageName: '@example/pkg',
          preserveSourceFiles: true,
          publishAccess: 'public',
          build(context) {
            writeFileSync(join(context.stageDir, 'index.js'), 'export {}\n');
          },
        },
      ]);

      const manifest = readManifest(stageDir);
      expect(manifest.files).toEqual(['dist', 'README.md']);
      expect(manifest.publishConfig).toEqual({ access: 'public' });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('keeps the default generated files field for recipes without preserveSourceFiles', async () => {
    const rootDir = await makeRoot({
      name: '@example/pkg',
      version: '0.0.0-PLACEHOLDER',
      files: ['dist'],
    });
    try {
      const [stageDir] = await prepare(rootDir, [{ id: 'main', packageName: '@example/pkg' }]);
      expect(readManifest(stageDir).files).toEqual(['**/*', '!**/*.map']);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('fails before publish when preserveSourceFiles meets an invalid source files field', async () => {
    const rootDir = await makeRoot({ name: '@example/pkg', version: '0.0.0-PLACEHOLDER', files: 'dist' });
    const runner = createRunner('1.2.3');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(
        preparePackageArtifacts({
          cwd: rootDir,
          version: '1.2.3',
          skipBuild: true,
          runner,
          artifacts: [{ id: 'main', packageName: '@example/pkg', preserveSourceFiles: true }],
        }),
      ).rejects.toThrow(/files" field to be an array of strings/);
      expect(runner.runs.filter((entry) => entry.args[0] === 'publish')).toHaveLength(0);
    } finally {
      logSpy.mockRestore();
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('gives two variants distinct generated exports maps and never packs the intermediate overlay file', async () => {
    const rootDir = await makeRoot({
      name: '@example/pkg',
      version: '0.0.0-PLACEHOLDER',
      exports: { '.': './dist/index.js' },
    });
    try {
      const recipes: PackageArtifactRecipe[] = ['plain', 'accented'].map((variant) => ({
        id: variant,
        packageName: `@example/pkg-${variant}`,
        requireTarball: true,
        build(context) {
          writeFileSync(join(context.stageDir, 'index.js'), 'export {}\n');
          writeFileSync(join(context.stageDir, `${variant}.js`), 'export {}\n');
          // An intermediate file used only to compute the overlay. It lives
          // outside the stage so it cannot leak into the packed artifact.
          writeFileSync(join(context.cwd, `.overlay-source-${variant}.json`), JSON.stringify({ variant }));
        },
        manifestOverlay(context) {
          const intermediate = JSON.parse(
            readFileSync(join(context.cwd, `.overlay-source-${variant}.json`), 'utf8'),
          ) as { variant: string };
          return {
            exports: {
              '.': './index.js',
              [`./${intermediate.variant}`]: {
                types: `./${intermediate.variant}.d.ts`,
                import: `./${intermediate.variant}.js`,
              },
            },
          };
        },
      }));

      const stageDirs = await prepare(rootDir, recipes);
      expect(stageDirs).toHaveLength(2);

      const manifestA = readManifest(stageDirs[0]);
      const manifestB = readManifest(stageDirs[1]);
      expect(manifestA.exports).toEqual({
        '.': './index.js',
        './plain': { types: './plain.d.ts', import: './plain.js' },
      });
      expect(manifestB.exports).toEqual({
        '.': './index.js',
        './accented': { types: './accented.d.ts', import: './accented.js' },
      });
      expect(manifestA.exports).not.toEqual(manifestB.exports);

      for (const stageDir of stageDirs) {
        const stageEntries = readdirSync(stageDir);
        expect(stageEntries.some((entry) => entry.includes('.overlay-source'))).toBe(false);
      }
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects overlays with protected or conflicting fields before publish', async () => {
    const cases: Array<{ overlay: Record<string, unknown>; match: RegExp }> = [
      { overlay: { private: true }, match: /must not set "private"/ },
      { overlay: { scripts: { postpublish: 'rm -rf /' } }, match: /must not set "scripts"/ },
      { overlay: { devDependencies: { typescript: '^5' } }, match: /must not set "devDependencies"/ },
      { overlay: { packageManager: 'pnpm@9.0.0' }, match: /must not set "packageManager"/ },
      { overlay: { version: '9.9.9' }, match: /version conflicts with the release version/ },
      { overlay: { name: '@example/other' }, match: /name conflicts with the artifact package name/ },
      { overlay: { exports: 42 }, match: /invalid exports field/ },
      { overlay: { exports: null }, match: /invalid exports field/ },
      { overlay: { files: 'dist' }, match: /files must be an array of strings/ },
      {
        overlay: { dependencies: { '@example/internal': 'workspace:*' } },
        match: /Unresolved workspace: range/,
      },
    ];

    for (const testCase of cases) {
      const rootDir = await makeRoot({ name: '@example/pkg', version: '0.0.0-PLACEHOLDER' });
      const runner = createRunner('1.2.3');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await expect(
          preparePackageArtifacts({
            cwd: rootDir,
            version: '1.2.3',
            skipBuild: true,
            runner,
            artifacts: [{ id: 'main', packageName: '@example/pkg', manifestOverlay: testCase.overlay }],
          }),
        ).rejects.toThrow(testCase.match);
        expect(runner.runs.filter((entry) => entry.args[0] === 'publish')).toHaveLength(0);
        expect(existsSync(join(rootDir, 'dist', '.artifacts', 'main', 'package.json'))).toBe(false);
      } finally {
        logSpy.mockRestore();
        await rm(rootDir, { recursive: true, force: true });
      }
    }
  });

  it('accepts an overlay name/version equal to the plan values', async () => {
    const rootDir = await makeRoot({ name: '@example/pkg', version: '0.0.0-PLACEHOLDER' });
    try {
      const [stageDir] = await prepare(rootDir, [
        {
          id: 'main',
          packageName: '@example/pkg',
          manifestOverlay: { name: '@example/pkg', version: '1.2.3', description: 'ok' },
        },
      ]);
      const manifest = readManifest(stageDir);
      expect(manifest.description).toBe('ok');
      expect(manifest.name).toBe('@example/pkg');
      expect(manifest.version).toBe('1.2.3');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rewrites dependency placeholders in overlay dependency maps', async () => {
    const rootDir = await makeRoot({ name: '@example/pkg', version: '0.0.0-PLACEHOLDER' });
    try {
      const [stageDir] = await prepare(rootDir, [
        {
          id: 'main',
          packageName: '@example/pkg',
          manifestOverlay: {
            peerDependencies: { '@example/peer': '0.0.0-PLACEHOLDER' },
          },
        },
      ]);
      expect(readManifest(stageDir).peerDependencies).toEqual({ '@example/peer': '1.2.3' });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
