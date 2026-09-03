import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  preparePackageArtifacts,
  publishPackage,
  type CapturingProcessRunner,
  type PackageArtifactContext,
  type ProcessCaptureOptions,
  type ProcessCaptureResult,
} from '../src/index';

interface RecordedEvent {
  kind: 'run' | 'runShell' | 'capture';
  executable?: string;
  args: string[];
  cwd: string;
  command?: string;
  env?: Record<string, string>;
}

interface FakePackRunner extends CapturingProcessRunner {
  events: RecordedEvent[];
  /** Per-stage tarball filename overrides keyed by stage dir. */
  filenamesByStage: Map<string, string>;
  /** When false, the synthesized tarball file is not created. */
  createTarball: boolean;
  /** Raw JSON returned for the next npm pack instead of the synthesized payload. */
  rawPackJson: string | null;
}

function createPackRunner(version: string, packageNamesByStageId: Record<string, string> = {}): FakePackRunner {
  const runner: FakePackRunner = {
    events: [],
    filenamesByStage: new Map(),
    createTarball: true,
    rawPackJson: null,
    run(executable, args, options) {
      runner.events.push({ kind: 'run', executable, args: [...args], cwd: options.cwd, env: options.env });
    },
    runShell(command, options) {
      runner.events.push({ kind: 'runShell', command, args: [], cwd: options.cwd });
    },
    capture(
      executable: string,
      args: ReadonlyArray<string>,
      options: ProcessCaptureOptions,
    ): Promise<ProcessCaptureResult> {
      runner.events.push({ kind: 'capture', executable, args: [...args], cwd: options.cwd });
      const destIndex = args.indexOf('--pack-destination');
      const dest = destIndex >= 0 ? args[destIndex + 1] : undefined;
      if (!dest) {
        return Promise.resolve({ stdout: '', stderr: 'missing pack destination', code: 1 });
      }
      if (runner.rawPackJson !== null) {
        return Promise.resolve({ stdout: runner.rawPackJson, stderr: '', code: 0 });
      }
      const stageId = options.cwd.replace(/\\/g, '/').split('/').pop() ?? 'artifact';
      const packageName = packageNamesByStageId[stageId] ?? stageId;
      const filename =
        runner.filenamesByStage.get(options.cwd) ??
        `${packageName.replace(/^@/, '').replace(/\//g, '-')}-${version}.tgz`;
      if (runner.createTarball) {
        mkdirSync(dest, { recursive: true });
        writeFileSync(join(dest, filename), 'fake-tarball\n');
      }
      return Promise.resolve({ stdout: JSON.stringify([{ filename, size: 1 }]), stderr: '', code: 0 });
    },
  };
  return runner;
}

async function makePackage(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: '@example/multi', version: '0.0.0-PLACEHOLDER' }, null, 2)}\n`,
  );
  await writeFile(join(dir, 'README.md'), '# multi\n');
  await writeFile(join(dir, 'LICENSE'), 'MIT\n');
}

describe('artifact preparation lifecycle (ARTIFACT-03)', () => {
  it('prepares both artifacts before any publish and publishes exact tarballs in order', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pp-artifact-lifecycle-'));
    try {
      await makePackage(rootDir);
      const runner = createPackRunner('1.2.3', { plain: '@example/plain', styled: '@example/styled' });
      const built: string[] = [];
      const validated: string[] = [];

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let results;
      try {
        results = await publishPackage({
          cwd: rootDir,
          version: '1.2.3',
          skipBuild: true,
          runner,
          artifacts: [
            {
              id: 'plain',
              packageName: '@example/plain',
              requireTarball: true,
              build(context) {
                built.push(context.artifactId);
                validateContext(context, rootDir);
                writeFileSync(join(context.stageDir, 'index.js'), 'export {}\n');
              },
              validate(context) {
                validated.push(context.artifactId);
              },
            },
            {
              id: 'styled',
              packageName: '@example/styled',
              requireTarball: true,
              build(context) {
                built.push(context.artifactId);
                writeFileSync(join(context.stageDir, 'index.js'), 'export {}\n');
              },
              validate(context) {
                validated.push(context.artifactId);
              },
            },
          ],
        });
      } finally {
        logSpy.mockRestore();
      }

      expect(built).toEqual(['plain', 'styled']);
      expect(validated).toEqual(['plain', 'styled']);
      expect(results).toHaveLength(2);
      expect(results[0].stageDir).not.toBe(results[1].stageDir);

      const packEvents = runner.events.filter((e) => e.kind === 'capture');
      const publishEvents = runner.events.filter((e) => e.kind === 'run');
      expect(packEvents).toHaveLength(2);
      expect(publishEvents).toHaveLength(2);

      // Both packs run before the first publish.
      const firstPublishIndex = runner.events.findIndex((e) => e.kind === 'run');
      const lastPackIndex = runner.events.map((e) => e.kind).lastIndexOf('capture');
      expect(lastPackIndex).toBeLessThan(firstPublishIndex);

      // Exact pack invocation contract.
      for (const pack of packEvents) {
        expect(pack.executable).toBe('npm');
        expect(pack.args.slice(0, 3)).toEqual(['pack', '--json', '--ignore-scripts']);
        expect(pack.args[3]).toBe('--pack-destination');
      }

      // The exact tarballs returned by npm pack are what gets published.
      for (const result of results) {
        expect(result.tarballPath).toBeDefined();
        expect(existsSync(result.tarballPath!)).toBe(true);
      }
      expect(publishEvents[0].args[0]).toBe('publish');
      expect(publishEvents[0].args[1]).toBe(results[0].tarballPath);
      expect(publishEvents[1].args[1]).toBe(results[1].tarballPath);
      expect(publishEvents[0].args).toContain('--access');
      expect(publishEvents[0].args).toContain('public');

      // Manifests are distinct and carry the recipe package names.
      const manifestA = JSON.parse(readFileSync(join(results[0].stageDir, 'package.json'), 'utf8'));
      const manifestB = JSON.parse(readFileSync(join(results[1].stageDir, 'package.json'), 'utf8'));
      expect(manifestA.name).toBe('@example/plain');
      expect(manifestB.name).toBe('@example/styled');
      expect(manifestA.version).toBe('1.2.3');
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('fails the whole run when the second validator fails, with zero npm publish calls', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pp-artifact-fail-'));
    try {
      await makePackage(rootDir);
      const runner = createPackRunner('1.2.3');
      const stagingBefore = new Set(tempStagingDirNames());

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let failure: unknown;
      try {
        await publishPackage({
          cwd: rootDir,
          version: '1.2.3',
          skipBuild: true,
          runner,
          artifacts: [
            {
              id: 'plain',
              packageName: '@example/plain',
              build(context) {
                writeFileSync(join(context.stageDir, 'index.js'), 'export {}\n');
              },
            },
            {
              id: 'styled',
              packageName: '@example/styled',
              build(context) {
                writeFileSync(join(context.stageDir, 'index.js'), 'export {}\n');
              },
              validate() {
                throw new Error('variant contract violation');
              },
            },
          ],
        });
      } catch (error) {
        failure = error;
      } finally {
        logSpy.mockRestore();
      }

      expect(failure).toBeInstanceOf(Error);
      const message = (failure as Error).message;
      expect(message).toContain('artifact "styled"');
      expect(message).toContain('@example/styled');
      expect(message).toContain('validate');
      expect(message).toContain('variant contract violation');
      expect((failure as Error & { cause?: unknown }).cause).toBeInstanceOf(Error);

      // Zero npm publish (or pack — validate ran before pack of the failing artifact).
      expect(runner.events.filter((e) => e.kind === 'run')).toHaveLength(0);
      // This failed run created no leftover temporary internal staging.
      expect(tempStagingDirNames().filter((name) => !stagingBefore.has(name))).toEqual([]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('preparePackageArtifacts returns inspectable records and never invokes npm publish', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pp-artifact-prepare-only-'));
    try {
      await makePackage(rootDir);
      const runner = createPackRunner('2.0.0', { plain: '@example/plain', styled: '@example/styled' });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      let prepared;
      try {
        prepared = await preparePackageArtifacts({
          cwd: rootDir,
          version: '2.0.0',
          skipBuild: true,
          runner,
          artifacts: [
            {
              id: 'plain',
              packageName: '@example/plain',
              requireTarball: true,
              build(context) {
                writeFileSync(join(context.stageDir, 'index.js'), 'export {}\n');
              },
            },
            {
              id: 'styled',
              packageName: '@example/styled',
              requireTarball: true,
              build(context) {
                writeFileSync(join(context.stageDir, 'index.js'), 'export {}\n');
              },
            },
          ],
        });
      } finally {
        logSpy.mockRestore();
      }

      expect(prepared).toHaveLength(2);
      expect(prepared[0].version).toBe('2.0.0');
      expect(prepared[0].stageDir).not.toBe(prepared[1].stageDir);
      for (const record of prepared) {
        expect(existsSync(record.stageDir)).toBe(true);
        expect(record.tarballPath).toBeDefined();
        expect(existsSync(record.tarballPath!)).toBe(true);
        expect(record.tarballPath!.startsWith(rootDir)).toBe(true);
      }
      const manifestA = JSON.parse(readFileSync(join(prepared[0].stageDir, 'package.json'), 'utf8'));
      const manifestB = JSON.parse(readFileSync(join(prepared[1].stageDir, 'package.json'), 'utf8'));
      expect(manifestA.name).toBe('@example/plain');
      expect(manifestB.name).toBe('@example/styled');

      // prepareOnly: packs happen (inspectable tarballs) but zero npm publish.
      expect(runner.events.filter((e) => e.kind === 'capture')).toHaveLength(2);
      expect(runner.events.filter((e) => e.kind === 'run')).toHaveLength(0);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('applies a manifest overlay and rejects an overlay that sets private', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pp-artifact-overlay-'));
    try {
      await makePackage(rootDir);

      const withOverlay = await preparePackageArtifacts({
        cwd: rootDir,
        version: '1.2.3',
        skipBuild: true,
        runner: createPackRunner('1.2.3'),
        artifacts: [
          {
            id: 'plain',
            packageName: '@example/plain',
            build(context) {
              writeFileSync(join(context.stageDir, 'index.js'), 'export {}\n');
            },
            manifestOverlay: { description: 'generated variant' },
          },
        ],
      });
      const manifest = JSON.parse(readFileSync(join(withOverlay[0].stageDir, 'package.json'), 'utf8'));
      expect(manifest.description).toBe('generated variant');
      expect(manifest.private).toBeUndefined();

      await rm(join(rootDir, 'dist'), { recursive: true, force: true });

      await expect(
        preparePackageArtifacts({
          cwd: rootDir,
          version: '1.2.3',
          skipBuild: true,
          runner: createPackRunner('1.2.3'),
          artifacts: [
            {
              id: 'plain',
              packageName: '@example/plain',
              manifestOverlay: { private: true },
            },
          ],
        }),
      ).rejects.toThrow(/must not set "private"/);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects unsafe npm pack filenames, malformed pack JSON, and missing tarballs without publishing', async () => {
    const cases: Array<{
      name: string;
      configure: (runner: FakePackRunner, stageDirs: string[]) => void;
      match: RegExp;
    }> = [
      {
        name: 'path-traversal filename',
        configure(runner, stageDirs) {
          runner.filenamesByStage.set(stageDirs[0], '../evil.tgz');
        },
        match: /unsafe filename/,
      },
      {
        name: 'unexpected filename',
        configure(runner, stageDirs) {
          runner.filenamesByStage.set(stageDirs[0], 'someone-else-9.9.9.tgz');
        },
        match: /unexpected filename/,
      },
      {
        name: 'malformed JSON',
        configure(runner) {
          runner.rawPackJson = 'not json at all';
        },
        match: /malformed JSON/,
      },
      {
        name: 'missing tarball',
        configure(runner) {
          runner.createTarball = false;
        },
        match: /does not exist/,
      },
    ];

    for (const testCase of cases) {
      const rootDir = await mkdtemp(join(tmpdir(), 'pp-artifact-packfail-'));
      try {
        await makePackage(rootDir);
        const runner = createPackRunner('1.2.3', { plain: '@example/plain' });
        const stageDir = join(rootDir, 'dist', '.artifacts', 'plain');
        testCase.configure(runner, [stageDir]);

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        let failure: unknown;
        try {
          await publishPackage({
            cwd: rootDir,
            version: '1.2.3',
            skipBuild: true,
            runner,
            artifacts: [
              {
                id: 'plain',
                packageName: '@example/plain',
                requireTarball: true,
                build(context) {
                  writeFileSync(join(context.stageDir, 'index.js'), 'export {}\n');
                },
              },
            ],
          });
        } catch (error) {
          failure = error;
        } finally {
          logSpy.mockRestore();
        }

        expect(failure, testCase.name).toBeInstanceOf(Error);
        expect((failure as Error).message, testCase.name).toMatch(testCase.match);
        expect((failure as Error).message, testCase.name).toContain('pack');
        expect(runner.events.filter((e) => e.kind === 'run')).toHaveLength(0);
      } finally {
        await rm(rootDir, { recursive: true, force: true });
      }
    }
  });

  it('requires a capturing runner when a recipe requires a tarball', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pp-artifact-nocapture-'));
    try {
      await makePackage(rootDir);
      const runner = {
        run() {},
        runShell() {},
      };

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await expect(
          publishPackage({
            cwd: rootDir,
            version: '1.2.3',
            skipBuild: true,
            runner,
            artifacts: [{ id: 'plain', packageName: '@example/plain', requireTarball: true }],
          }),
        ).rejects.toThrow(/CapturingProcessRunner/);
      } finally {
        logSpy.mockRestore();
      }
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects escaping copy sources inside recipe stages without publishing', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pp-artifact-escape-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'pp-artifact-outside-'));
    try {
      await makePackage(rootDir);
      await mkdir(join(rootDir, 'docs'), { recursive: true });
      await writeFile(join(outsideDir, 'secret.md'), 'secret\n');
      symlinkSync(join(outsideDir, 'secret.md'), join(rootDir, 'docs', 'secret.md'));
      const runner = createPackRunner('1.2.3');

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await expect(
          publishPackage({
            cwd: rootDir,
            version: '1.2.3',
            skipBuild: true,
            includePackageFiles: ['docs/secret.md'],
            runner,
            artifacts: [{ id: 'plain', packageName: '@example/plain' }],
          }),
        ).rejects.toThrow(/escapes the package root/);
      } finally {
        logSpy.mockRestore();
      }

      expect(runner.events.filter((e) => e.kind === 'run')).toHaveLength(0);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rejects escaping symlinks created by a recipe build before copying or packing', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pp-artifact-stage-symlink-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'pp-artifact-stage-outside-'));
    try {
      await makePackage(rootDir);
      const runner = createPackRunner('1.2.3');
      const outsideReadme = join(outsideDir, 'README.md');
      await writeFile(outsideReadme, 'secret\n');

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await expect(
          publishPackage({
            cwd: rootDir,
            version: '1.2.3',
            skipBuild: true,
            runner,
            artifacts: [
              {
                id: 'plain',
                packageName: '@example/plain',
                requireTarball: true,
                build(context) {
                  symlinkSync(outsideReadme, join(context.stageDir, 'README.md'));
                },
              },
            ],
          }),
        ).rejects.toThrow(/artifact stage symlink escapes/);
      } finally {
        logSpy.mockRestore();
      }

      expect(readFileSync(outsideReadme, 'utf8')).toBe('secret\n');
      expect(runner.events).toHaveLength(0);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('keeps access, tag, registry, provenance, dry-run, and OTP env identical for tarball publishes', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pp-artifact-flags-'));
    try {
      await makePackage(rootDir);
      const runner = createPackRunner('1.2.3-beta.1', { plain: '@example/plain', styled: '@example/styled' });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await publishPackage({
          cwd: rootDir,
          version: '1.2.3-beta.1',
          skipBuild: true,
          access: 'restricted',
          registry: 'https://registry.example.org',
          provenance: true,
          dryRun: true,
          otp: '654321',
          runner,
          artifacts: [
            { id: 'plain', packageName: '@example/plain', requireTarball: true },
            { id: 'styled', packageName: '@example/styled', requireTarball: true },
          ],
        });
      } finally {
        logSpy.mockRestore();
      }

      const publishEvents = runner.events.filter((e) => e.kind === 'run');
      expect(publishEvents).toHaveLength(2);
      for (const event of publishEvents) {
        const [verb, tarball, ...rest] = event.args;
        expect(verb).toBe('publish');
        expect(tarball.endsWith('.tgz')).toBe(true);
        expect(rest).toEqual([
          '--access',
          'restricted',
          '--tag',
          'beta',
          '--registry',
          'https://registry.example.org',
          '--provenance',
          '--dry-run',
        ]);
        expect(event.args.join(' ')).not.toContain('654321');
        expect(event.env).toEqual({ npm_config_otp: '654321' });
      }
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('retains prepared stage dirs across runs but rejects non-empty pre-existing stages', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pp-artifact-retain-'));
    try {
      await makePackage(rootDir);
      const runner = createPackRunner('1.2.3');

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await preparePackageArtifacts({
          cwd: rootDir,
          version: '1.2.3',
          skipBuild: true,
          runner,
          artifacts: [{ id: 'plain', packageName: '@example/plain' }],
        });

        // The retained stage now contains a manifest, so a second prepare of
        // the same stage dir is rejected instead of silently merging.
        await expect(
          preparePackageArtifacts({
            cwd: rootDir,
            version: '1.2.3',
            skipBuild: true,
            runner,
            artifacts: [{ id: 'plain', packageName: '@example/plain' }],
          }),
        ).rejects.toThrow(/must be empty or absent/);
      } finally {
        logSpy.mockRestore();
      }
      expect(runner.events.filter((e) => e.kind === 'run')).toHaveLength(0);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('cleans temporary preserved-layout staging when preparation fails before publication', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'pp-artifact-preserved-cleanup-'));
    try {
      await makePackage(rootDir);
      await mkdir(join(rootDir, 'dist'), { recursive: true });
      await writeFile(join(rootDir, 'dist', 'index.js'), 'export {}\n');
      const stagingBefore = new Set(tempStagingDirNames());

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await expect(
          publishPackage({
            cwd: rootDir,
            version: '1.2.3',
            skipBuild: true,
            preservePublishDir: true,
            dryRun: true,
            includePackageFiles: ['README.md'],
            runner: createPackRunner('1.2.3'),
          }),
        ).rejects.toThrow(/Duplicate copy entry/);
      } finally {
        logSpy.mockRestore();
      }

      expect(tempStagingDirNames().filter((name) => !stagingBefore.has(name))).toEqual([]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});

function validateContext(context: PackageArtifactContext, expectedCwd: string): void {
  expect(context.cwd).toBe(expectedCwd);
  expect(context.rootDir).toBe(expectedCwd);
  expect(context.stageDir).toContain(expectedCwd);
  expect(context.version).toBe('1.2.3');
  expect(typeof context.runner.run).toBe('function');
}

function tempStagingDirNames(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('repo-toolkit-publish-'));
}
