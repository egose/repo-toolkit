import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  preparePackageArtifacts,
  publishPackage,
  VersionResolutionError,
  type CapturingProcessRunner,
  type PackageArtifactRecipe,
  type ProcessCaptureOptions,
  type ProcessCaptureResult,
} from '../src/index';

const tarLocation = spawnSync('bash', ['-c', 'command -v tar'], { encoding: 'utf8' }).stdout.trim();
const TAR_AVAILABLE = tarLocation.length > 0;

interface Event {
  kind: 'run' | 'capture';
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

interface FixtureRunner extends CapturingProcessRunner {
  events: Event[];
  registryResult: ProcessCaptureResult;
}

function createRunner(
  registryResult: ProcessCaptureResult = { stdout: '"3.4.5"', stderr: '', code: 0 },
): FixtureRunner {
  const runner: FixtureRunner = {
    events: [],
    registryResult,
    run(executable, args, options) {
      runner.events.push({ kind: 'run', executable, args: [...args], cwd: options.cwd, env: options.env });
    },
    runShell() {},
    async capture(
      executable: string,
      args: ReadonlyArray<string>,
      options: ProcessCaptureOptions,
    ): Promise<ProcessCaptureResult> {
      runner.events.push({ kind: 'capture', executable, args: [...args], cwd: options.cwd, env: options.env });
      if (args[0] === 'view') {
        return runner.registryResult;
      }

      const destinationIndex = args.indexOf('--pack-destination');
      const destination = args[destinationIndex + 1];
      if (args[0] !== 'pack' || !destination) {
        return { stdout: '', stderr: 'unexpected npm invocation', code: 1 };
      }
      const manifest = readManifest(options.cwd);
      const filename = `${String(manifest.name).replace(/^@/, '').replace(/\//g, '-')}-${String(manifest.version)}.tgz`;
      const tarballPath = join(destination, filename);
      mkdirSync(destination, { recursive: true });
      if (TAR_AVAILABLE) {
        execFileSync(tarLocation, ['-czf', tarballPath, '-C', options.cwd, '.']);
      } else {
        writeFileSync(tarballPath, 'tar unavailable\n');
      }
      return { stdout: JSON.stringify([{ filename }]), stderr: '', code: 0 };
    },
  };
  return runner;
}

function makeFixture(label: string, sourceManifest: Record<string, unknown>): { rootDir: string; packageDir: string } {
  const rootDir = mkdtempSync(join(tmpdir(), `pp-consumer-${label}-`));
  const packageDir = join(rootDir, 'package');
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(
    join(rootDir, 'package.json'),
    `${JSON.stringify({ author: 'Example Maintainer <maintainer@example.test>', license: 'MIT' }, null, 2)}\n`,
  );
  writeFileSync(join(rootDir, 'LICENSE'), 'MIT\n');
  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify(sourceManifest, null, 2)}\n`);
  writeFileSync(join(packageDir, 'README.md'), '# release fixture\n');
  writeFileSync(join(packageDir, 'llms.txt'), 'release notes\n');
  return { rootDir, packageDir };
}

function readManifest(stageDir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(stageDir, 'package.json'), 'utf8')) as Record<string, unknown>;
}

function generatedRecipes(failSecond = false): PackageArtifactRecipe[] {
  return ['plain', 'tw'].map((id) => ({
    id,
    packageName: `@fixture/angular-${id}`,
    requireTarball: true,
    build(context) {
      writeFileSync(join(context.stageDir, 'index.js'), `export const variant = '${id}';\n`);
      writeFileSync(join(context.stageDir, 'index.d.ts'), 'export declare const variant: string;\n');
      writeFileSync(join(context.stageDir, `${id}.js`), `export default '${id}';\n`);
      writeFileSync(join(context.stageDir, `${id}.d.ts`), 'declare const value: string; export default value;\n');
      writeFileSync(join(context.cwd, `.generated-exports-${id}.json`), JSON.stringify({ id }));
    },
    manifestOverlay(context) {
      const generated = JSON.parse(readFileSync(join(context.cwd, `.generated-exports-${id}.json`), 'utf8')) as {
        id: string;
      };
      return {
        exports: {
          '.': { types: './index.d.ts', import: './index.js' },
          [`./${generated.id}`]: { types: `./${generated.id}.d.ts`, import: `./${generated.id}.js` },
        },
      };
    },
    validate(context) {
      const manifest = readManifest(context.stageDir);
      expect(manifest.name).toBe(context.packageName);
      expect(manifest.private).toBeUndefined();
      expect(manifest.scripts).toBeUndefined();
      expect(manifest.devDependencies).toBeUndefined();
      expect(manifest.exports).toHaveProperty(`./${id}`);
      if (failSecond && id === 'tw') {
        throw new Error('second generated artifact is invalid');
      }
    },
  }));
}

function inspectTarball(tarballPath: string): { entries: string[]; extractedDir: string } {
  const extractedDir = mkdtempSync(join(tmpdir(), 'pp-consumer-extract-'));
  execFileSync(tarLocation, ['-xzf', tarballPath, '-C', extractedDir]);
  const entries = execFileSync(tarLocation, ['-tzf', tarballPath], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((entry) => entry.replace(/^\.\//, ''));
  return { entries, extractedDir };
}

describe('consumer-compatible artifact flows (ARTIFACT-06)', () => {
  it('prepares a React-like private template as one flattened public package', async () => {
    const fixture = makeFixture('react', {
      name: '@fixture/react-template',
      version: '0.0.0-PLACEHOLDER',
      private: true,
      author: 'PLACEHOLDER',
      license: 'PLACEHOLDER',
      files: ['*.js', '*.d.ts', 'README.md', 'LICENSE', 'llms.txt'],
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      scripts: { build: 'unsafe source command' },
      devDependencies: { typescript: '^5.0.0' },
    });
    try {
      const runner = createRunner();
      const [prepared] = await preparePackageArtifacts({
        cwd: fixture.packageDir,
        rootDir: fixture.rootDir,
        version: 'v1.2.3',
        skipBuild: true,
        runner,
        allowPrivateTemplate: true,
        artifacts: [
          {
            id: 'public',
            packageName: '@fixture/react',
            requireTarball: true,
            preserveSourceFiles: true,
            publishAccess: 'public',
            build(context) {
              writeFileSync(join(context.stageDir, 'index.js'), 'export const ready = true;\n');
              writeFileSync(join(context.stageDir, 'index.d.ts'), 'export declare const ready: boolean;\n');
            },
            validate(context) {
              const manifest = readManifest(context.stageDir);
              expect(manifest.author).toBe('Example Maintainer <maintainer@example.test>');
              expect(manifest.license).toBe('MIT');
              expect(manifest.files).toEqual(['*.js', '*.d.ts', 'README.md', 'LICENSE', 'llms.txt']);
              expect(manifest.exports).toEqual({ '.': { types: './index.d.ts', import: './index.js' } });
              expect(manifest.publishConfig).toEqual({ access: 'public' });
            },
          },
        ],
      });

      expect(prepared.version).toBe('1.2.3');
      expect(prepared.tarballPath).toBeDefined();
      const manifest = readManifest(prepared.stageDir);
      expect(manifest.private).toBeUndefined();
      expect(manifest.scripts).toBeUndefined();
      expect(manifest.devDependencies).toBeUndefined();
      expect(runner.events.filter((event) => event.kind === 'run')).toHaveLength(0);

      if (!TAR_AVAILABLE) return;
      const inspected = inspectTarball(prepared.tarballPath!);
      try {
        expect(inspected.entries).toEqual(
          expect.arrayContaining(['package.json', 'README.md', 'LICENSE', 'llms.txt', 'index.js', 'index.d.ts']),
        );
        const packedManifest = JSON.parse(readFileSync(join(inspected.extractedDir, 'package.json'), 'utf8')) as Record<
          string,
          unknown
        >;
        expect(packedManifest.exports).toEqual(manifest.exports);
        expect(
          inspected.entries.some(
            (entry) => /(^|\/)(?:src|test)\//.test(entry) || /\.map$|generated-exports|temp/i.test(entry),
          ),
        ).toBe(false);
      } finally {
        rmSync(inspected.extractedDir, { recursive: true, force: true });
      }
    } finally {
      rmSync(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it('prepares two Angular-like deterministic variants, retaining inspectable exact tarballs', async () => {
    const fixture = makeFixture('angular-prepare', {
      name: '@fixture/angular-template',
      version: '0.0.0-PLACEHOLDER',
      private: true,
      scripts: { build: 'unsafe source command' },
      devDependencies: { typescript: '^5.0.0' },
    });
    try {
      const runner = createRunner();
      const prepared = await preparePackageArtifacts({
        cwd: fixture.packageDir,
        rootDir: fixture.rootDir,
        bump: 'patch',
        skipBuild: true,
        runner,
        allowPrivateTemplate: true,
        artifacts: generatedRecipes(),
      });
      expect(prepared.map((entry) => [entry.id, entry.packageName, entry.version])).toEqual([
        ['plain', '@fixture/angular-plain', '3.4.6'],
        ['tw', '@fixture/angular-tw', '3.4.6'],
      ]);
      expect(prepared[0].stageDir).not.toBe(prepared[1].stageDir);
      expect(runner.events.filter((event) => event.kind === 'run')).toHaveLength(0);
      expect(runner.events.filter((event) => event.kind === 'capture' && event.args[0] === 'view')).toHaveLength(1);

      if (!TAR_AVAILABLE) return;
      for (const entry of prepared) {
        expect(existsSync(entry.tarballPath!)).toBe(true);
        const inspected = inspectTarball(entry.tarballPath!);
        try {
          const manifest = JSON.parse(readFileSync(join(inspected.extractedDir, 'package.json'), 'utf8')) as Record<
            string,
            unknown
          >;
          const id = entry.id;
          expect(manifest.exports).toHaveProperty(`./${id}`);
          expect(inspected.entries).toEqual(
            expect.arrayContaining([
              'package.json',
              'README.md',
              'LICENSE',
              'index.js',
              'index.d.ts',
              `${id}.js`,
              `${id}.d.ts`,
            ]),
          );
          expect(
            inspected.entries.some((name) =>
              /private|scripts|devdependencies|generated-exports|\.map$|(^|\/)test\//i.test(name),
            ),
          ).toBe(false);
        } finally {
          rmSync(inspected.extractedDir, { recursive: true, force: true });
        }
      }
    } finally {
      rmSync(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it('does not publish when the second generated variant fails validation', async () => {
    const fixture = makeFixture('angular-failure', {
      name: '@fixture/angular-template',
      version: '0.0.0-PLACEHOLDER',
      private: true,
    });
    try {
      const runner = createRunner();
      await expect(
        publishPackage({
          cwd: fixture.packageDir,
          rootDir: fixture.rootDir,
          version: '2.0.0',
          skipBuild: true,
          runner,
          allowPrivateTemplate: true,
          artifacts: generatedRecipes(true),
        }),
      ).rejects.toThrow(/second generated artifact is invalid/);
      expect(runner.events.filter((event) => event.kind === 'run' && event.args[0] === 'publish')).toHaveLength(0);
    } finally {
      rmSync(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it('packs every variant before deterministic dry-run publication and forwards OTP only through the environment', async () => {
    const fixture = makeFixture('angular-publish', {
      name: '@fixture/angular-template',
      version: '0.0.0-PLACEHOLDER',
      private: true,
    });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const runner = createRunner();
      const results = await publishPackage({
        cwd: fixture.packageDir,
        rootDir: fixture.rootDir,
        version: '2.0.0',
        skipBuild: true,
        runner,
        allowPrivateTemplate: true,
        artifacts: generatedRecipes(),
        dryRun: true,
        otp: 'opaque-otp',
      });
      const firstPublish = runner.events.findIndex((event) => event.kind === 'run');
      const lastPack = runner.events
        .map((event) => event.kind === 'capture' && event.args[0] === 'pack')
        .lastIndexOf(true);
      expect(lastPack).toBeLessThan(firstPublish);
      const published = runner.events.filter((event) => event.kind === 'run');
      expect(published.map((event) => event.args[1])).toEqual(results.map((entry) => entry.tarballPath));
      for (const event of published) {
        expect(event.args).toContain('--dry-run');
        expect(event.args.join(' ')).not.toContain('opaque-otp');
        expect(event.env).toEqual({ npm_config_otp: 'opaque-otp' });
      }
    } finally {
      logSpy.mockRestore();
      rmSync(fixture.rootDir, { recursive: true, force: true });
    }
  });

  it('uses 0.0.1 only for a clean E404 initial release and rejects malformed registry JSON', async () => {
    const absent = makeFixture('registry-absent', {
      name: '@fixture/angular-template',
      version: '0.0.0-PLACEHOLDER',
      private: true,
    });
    const malformed = makeFixture('registry-malformed', {
      name: '@fixture/angular-template',
      version: '0.0.0-PLACEHOLDER',
      private: true,
    });
    try {
      const initialRunner = createRunner({ stdout: '', stderr: 'npm error code E404\nnot found', code: 1 });
      const [initial] = await preparePackageArtifacts({
        cwd: absent.packageDir,
        rootDir: absent.rootDir,
        bump: 'patch',
        skipBuild: true,
        runner: initialRunner,
        allowPrivateTemplate: true,
        artifacts: generatedRecipes().slice(0, 1),
      });
      expect(initial.version).toBe('0.0.1');

      const malformedRunner = createRunner({ stdout: '{bad json', stderr: '', code: 0 });
      await expect(
        preparePackageArtifacts({
          cwd: malformed.packageDir,
          rootDir: malformed.rootDir,
          bump: 'patch',
          skipBuild: true,
          runner: malformedRunner,
          allowPrivateTemplate: true,
          artifacts: generatedRecipes().slice(0, 1),
        }),
      ).rejects.toBeInstanceOf(VersionResolutionError);
      expect(
        malformedRunner.events.filter((event) => event.args[0] === 'pack' || event.args[0] === 'publish'),
      ).toHaveLength(0);
    } finally {
      rmSync(absent.rootDir, { recursive: true, force: true });
      rmSync(malformed.rootDir, { recursive: true, force: true });
    }
  });
});
