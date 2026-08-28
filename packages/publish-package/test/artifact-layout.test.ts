import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { publishPackage, type ProcessRunner } from '../src/index';

interface Captured {
  cwd: string;
  manifest: Record<string, unknown>;
  files: string[];
  copyDir: string;
}

function listFilesRecursive(root: string, base = root): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  const entries = readdirSync(root, { withFileTypes: true });
  for (const e of entries) {
    const full = join(root, e.name);
    const rel = relative(base, full);
    if (e.isSymbolicLink()) {
      out.push(rel);
      continue;
    }
    if (e.isDirectory()) {
      out.push(...listFilesRecursive(full, base));
    } else if (e.isFile()) {
      out.push(rel);
    }
  }
  return out.sort();
}

function copyRecursiveSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const s = join(src, e.name);
    const d = join(dest, e.name);
    const lst = lstatSync(s);
    if (lst.isSymbolicLink()) {
      try {
        const linkTarget = readlinkSync(s);
        symlinkSync(linkTarget, d);
      } catch {
        /* ignore */
      }
      continue;
    }
    if (lst.isDirectory()) {
      copyRecursiveSync(s, d);
      try {
        chmodSync(d, lst.mode);
      } catch {
        /* ignore */
      }
    } else if (lst.isFile()) {
      const data = readFileSync(s);
      writeFileSync(d, data);
      try {
        chmodSync(d, lst.mode);
      } catch {
        /* ignore */
      }
    }
  }
}

function createTarball(sourceDir: string, destTar: string, excludeMap = true): void {
  const args = ['-czf', destTar];
  if (excludeMap) args.push('--exclude=*.map');
  args.push('-C', sourceDir, '.');
  execFileSync('tar', args, { stdio: 'pipe' });
}

function listTarball(tarPath: string): string[] {
  const out = execFileSync('tar', ['-tzf', tarPath], { encoding: 'utf8' });
  return out
    .split('\n')
    .filter(Boolean)
    .map((s) => s.replace(/^\.\//, ''))
    .filter((s) => s !== '.' && s !== './')
    .sort();
}

async function createRichFixture(opts: {
  pkgDir: string;
  rootDir: string;
  publishDir: string;
  outsideDir: string;
}): Promise<void> {
  const { pkgDir, rootDir, publishDir, outsideDir } = opts;
  const pd = join(pkgDir, publishDir);
  await mkdir(pd, { recursive: true });
  await mkdir(join(pkgDir, 'src'), { recursive: true });
  await mkdir(join(pkgDir, 'tests'), { recursive: true });
  await mkdir(join(pd, 'nested'), { recursive: true });

  const pkgJson = {
    name: '@example/pkg',
    version: '1.2.3',
    main: `${publishDir}/index.js`,
    module: `${publishDir}/index.mjs`,
    types: `${publishDir}/index.d.ts`,
    bin: { 'example-cli': `${publishDir}/cli.js` },
    exports: {
      '.': {
        types: `./${publishDir}/index.d.ts`,
        import: `./${publishDir}/index.js`,
        require: `./${publishDir}/index.cjs`,
      },
      './feature': `./${publishDir}/feature.js`,
      './nested': `./${publishDir}/nested/feature.js`,
    },
    imports: {
      '#internal': `./${publishDir}/internal.js`,
    },
  };
  await writeFile(join(pkgDir, 'package.json'), `${JSON.stringify(pkgJson, null, 2)}\n`);
  await writeFile(
    join(rootDir, 'package.json'),
    `${JSON.stringify({ name: 'root', private: true, version: '0.0.0', license: 'MIT' }, null, 2)}\n`,
  );
  await writeFile(join(pkgDir, 'README.md'), '# Example\n');
  await writeFile(join(pkgDir, 'CHANGELOG.md'), '# Changelog\n');
  await writeFile(join(rootDir, 'LICENSE'), 'MIT\n');
  await writeFile(join(pkgDir, 'src', 'index.ts'), 'export const src = true;\n');
  await writeFile(join(pkgDir, 'tests', 'leak.test.js'), 'should not leak\n');
  await writeFile(join(pkgDir, '.npmrc'), 'registry=https://registry.example/\n');

  await writeFile(join(pd, 'index.js'), 'export const hello = "hello";\n');
  await writeFile(join(pd, 'index.mjs'), 'export const hello = "hello-mjs";\n');
  await writeFile(join(pd, 'index.cjs'), 'module.exports = { hello: "hello-cjs" };\n');
  await writeFile(join(pd, 'index.d.ts'), 'export declare const hello: string;\n');
  await writeFile(join(pd, 'feature.js'), 'export const feature = 1;\n');
  await writeFile(join(pd, 'internal.js'), 'export const internal = true;\n');
  await writeFile(join(pd, 'nested', 'feature.js'), 'export const nested = 1;\n');
  await writeFile(join(pd, 'index.js.map'), '{"version":3,"sources":["index.ts"]}\n');
  const cliPath = join(pd, 'cli.js');
  await writeFile(cliPath, '#!/usr/bin/env node\nconsole.log("cli");\n');
  chmodSync(cliPath, 0o755);

  await writeFile(join(outsideDir, 'secret.txt'), 'secret\n');
  try {
    await symlink(join(outsideDir, 'secret.txt'), join(pd, 'link-outside.txt'));
  } catch {
    /* ignore */
  }
  try {
    await symlink(join(outsideDir, 'secret.txt'), join(pd, 'nested', 'link-outside-nested.txt'));
  } catch {
    /* ignore */
  }
}

describe('artifact layout end-to-end (PPDIR-04)', () => {
  it('default flattened vs preserved layouts agree with manifests, have correct roots, and support consumer import', async () => {
    const base = await mkdtemp(join(tmpdir(), 'pp-artifact-'));
    const outside = await mkdtemp(join(tmpdir(), 'pp-outside-'));
    const preservedCopy = await mkdtemp(join(tmpdir(), 'pp-preserved-copy-'));
    const extractFlat = await mkdtemp(join(tmpdir(), 'pp-extract-flat-'));
    const extractPreserved = await mkdtemp(join(tmpdir(), 'pp-extract-preserved-'));
    const tarFlat = join(tmpdir(), `pp-flat-${Date.now()}.tgz`);
    const tarPreserved = join(tmpdir(), `pp-preserved-${Date.now()}.tgz`);

    const makePkg = async (suffix: string) => {
      const pkgDir = join(base, suffix);
      const rootDir = join(base, `${suffix}-root`);
      await mkdir(pkgDir, { recursive: true });
      await mkdir(rootDir, { recursive: true });
      await createRichFixture({ pkgDir, rootDir, publishDir: 'dist', outsideDir: outside });
      return { pkgDir, rootDir };
    };

    const flat = await makePkg('flat-pkg');
    const preserved = await makePkg('preserved-pkg');

    try {
      const flatRuns: Array<{ cwd: string; args: string[] }> = [];
      const flatRunner: ProcessRunner = {
        run(executable, args, options) {
          flatRuns.push({ cwd: options.cwd, args: [...args] });
        },
        runShell() {
          void 0;
        },
      };

      const flatLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      publishPackage({
        cwd: flat.pkgDir,
        rootDir: flat.rootDir,
        version: '1.2.3',
        skipBuild: true,
        dryRun: true,
        runner: flatRunner,
      });
      flatLog.mockRestore();

      expect(flatRuns).toHaveLength(1);
      const flatCwd = flatRuns[0].cwd;
      expect(flatCwd).toBe(resolve(flat.pkgDir, 'dist'));

      const flatManifest = JSON.parse(await readFile(join(flatCwd, 'package.json'), 'utf8')) as Record<string, unknown>;
      expect(flatManifest.main).toBe('./index.js');
      expect(flatManifest.types).toBe('./index.d.ts');
      expect((flatManifest.bin as Record<string, string>)['example-cli']).toBe('./cli.js');
      expect(flatManifest.files).toEqual(['**/*', '!**/*.map']);
      const flatExports = flatManifest.exports as Record<string, unknown>;
      expect(JSON.stringify(flatExports)).not.toContain('dist/');
      const flatImports = flatManifest.imports as Record<string, unknown>;
      expect(JSON.stringify(flatImports)).not.toContain('dist/');

      const flatFiles = listFilesRecursive(flatCwd);
      expect(flatFiles).toContain('index.js');
      expect(flatFiles).toContain('index.d.ts');
      expect(flatFiles).toContain('cli.js');
      expect(flatFiles).toContain('nested/feature.js');
      expect(flatFiles).toContain('README.md');
      expect(flatFiles).toContain('LICENSE');
      expect(flatFiles).not.toContain('dist/index.js');
      expect(flatFiles).not.toContain('src/index.ts');
      expect(flatFiles.some((f) => f.startsWith('src/'))).toBe(false);
      expect(flatFiles.some((f) => f === 'tests/leak.test.js')).toBe(false);
      expect(flatFiles.some((f) => f === '.npmrc')).toBe(false);
      expect(flatFiles).toContain('index.js.map');
      const flatLinkPath = join(flatCwd, 'link-outside.txt');
      if (existsSync(flatLinkPath)) {
        expect(lstatSync(flatLinkPath).isSymbolicLink()).toBe(true);
      }
      expect(flatFiles.some((f) => f.includes('repo-toolkit-publish-'))).toBe(false);

      const flatCliMode = lstatSync(join(flatCwd, 'cli.js')).mode & 0o111;
      expect(flatCliMode).not.toBe(0);

      createTarball(flatCwd, tarFlat, true);
      const flatTarList = listTarball(tarFlat);
      expect(flatTarList).toContain('index.js');
      expect(flatTarList).toContain('cli.js');
      expect(flatTarList).toContain('README.md');
      expect(flatTarList).toContain('LICENSE');
      expect(flatTarList).not.toContain('dist/index.js');
      expect(flatTarList.some((f) => f.includes('src/'))).toBe(false);
      expect(flatTarList.some((f) => f.endsWith('.map'))).toBe(false);
      expect(flatTarList.some((f) => f.includes('repo-toolkit-publish-'))).toBe(false);
      expect(flatTarList.some((f) => f.includes('secret.txt'))).toBe(false);

      execFileSync('tar', ['-xzf', tarFlat, '-C', extractFlat], { stdio: 'pipe' });
      const flatEntry = join(extractFlat, 'index.js');
      expect(existsSync(flatEntry)).toBe(true);
      const flatMod = await import(pathToFileURL(flatEntry).href);
      expect(flatMod.hello).toBe('hello');
      const flatBin = join(extractFlat, 'cli.js');
      expect(existsSync(flatBin)).toBe(true);
      expect(lstatSync(flatBin).mode & 0o111).not.toBe(0);

      const captured: Captured[] = [];
      const preservedRunner: ProcessRunner = {
        run(executable, args, options) {
          const manifest = JSON.parse(readFileSync(join(options.cwd, 'package.json'), 'utf8'));
          const files = listFilesRecursive(options.cwd);
          const copyDir = join(preservedCopy, 'snap');
          try {
            mkdirSync(copyDir, { recursive: true });
          } catch (_e) {
            void _e;
          }
          try {
            execFileSync('cp', ['-a', `${options.cwd}/.`, copyDir], { stdio: 'pipe' });
          } catch (_e) {
            void _e;
            copyRecursiveSync(options.cwd, copyDir);
          }
          captured.push({ cwd: options.cwd, manifest, files, copyDir });
        },
        runShell() {
          void 0;
        },
      };

      const preservedLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      publishPackage({
        cwd: preserved.pkgDir,
        rootDir: preserved.rootDir,
        version: '1.2.3',
        preservePublishDir: true,
        skipBuild: true,
        dryRun: true,
        runner: preservedRunner,
      });
      preservedLog.mockRestore();

      expect(captured).toHaveLength(1);
      const cap = captured[0];
      expect(cap.cwd).not.toBe(resolve(preserved.pkgDir, 'dist'));
      expect(cap.cwd.includes('repo-toolkit-publish-')).toBe(true);
      expect(cap.manifest.main).toBe('dist/index.js');
      expect(cap.manifest.types).toBe('dist/index.d.ts');
      expect((cap.manifest.bin as Record<string, string>)['example-cli']).toBe('dist/cli.js');
      expect(cap.manifest.files).toEqual(['**/*', '!**/*.map']);
      const presExports = cap.manifest.exports as Record<string, unknown>;
      expect(JSON.stringify(presExports)).toContain('dist/');
      const presImports = cap.manifest.imports as Record<string, unknown>;
      expect(JSON.stringify(presImports)).toContain('dist/');

      expect(cap.files).toContain('dist/index.js');
      expect(cap.files).toContain('dist/index.d.ts');
      expect(cap.files).toContain('dist/cli.js');
      expect(cap.files).toContain('dist/nested/feature.js');
      expect(cap.files).toContain('README.md');
      expect(cap.files).toContain('LICENSE');
      expect(cap.files).toContain('package.json');
      expect(cap.files).not.toContain('index.js');
      expect(cap.files.some((f) => f === 'dist/index.js.map')).toBe(true);
      expect(cap.files.some((f) => f.startsWith('src/') || f.includes('/src/'))).toBe(false);
      expect(cap.files.some((f) => f.includes('link-outside'))).toBe(false);
      expect(cap.files.some((f) => f.includes('repo-toolkit-publish-') && f !== 'dist/index.js')).toBe(false);

      expect(existsSync(cap.cwd)).toBe(false);
      expect(existsSync(join(preserved.pkgDir, 'dist', 'index.js'))).toBe(true);
      expect(existsSync(join(preserved.pkgDir, 'dist', 'index.js.map'))).toBe(true);

      const preservedCliMode = lstatSync(join(cap.copyDir, 'dist', 'cli.js')).mode & 0o111;
      expect(preservedCliMode).not.toBe(0);

      createTarball(cap.copyDir, tarPreserved, true);
      const presTarList = listTarball(tarPreserved);
      expect(presTarList).toContain('dist/index.js');
      expect(presTarList).toContain('dist/cli.js');
      expect(presTarList).toContain('README.md');
      expect(presTarList).toContain('LICENSE');
      expect(presTarList).not.toContain('index.js');
      expect(presTarList.some((f) => f.endsWith('.map'))).toBe(false);
      expect(presTarList.some((f) => f.includes('src/'))).toBe(false);
      expect(presTarList.some((f) => f.includes('link-outside'))).toBe(false);
      expect(presTarList.some((f) => f.includes('repo-toolkit-publish-'))).toBe(false);

      execFileSync('tar', ['-xzf', tarPreserved, '-C', extractPreserved], { stdio: 'pipe' });
      const presEntry = join(extractPreserved, 'dist', 'index.js');
      expect(existsSync(presEntry)).toBe(true);
      const presMod = await import(pathToFileURL(presEntry).href);
      expect(presMod.hello).toBe('hello');
      const presBin = join(extractPreserved, 'dist', 'cli.js');
      expect(existsSync(presBin)).toBe(true);
      expect(lstatSync(presBin).mode & 0o111).not.toBe(0);
    } finally {
      await rm(base, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
      await rm(preservedCopy, { recursive: true, force: true });
      await rm(extractFlat, { recursive: true, force: true });
      await rm(extractPreserved, { recursive: true, force: true });
      await rm(tarFlat, { force: true });
      await rm(tarPreserved, { force: true });
    }
  }, 30_000);

  it('preserved mode retains full custom nested publishDir path and flattened mode strips it', async () => {
    const base = await mkdtemp(join(tmpdir(), 'pp-artifact-nested-'));
    const outside = await mkdtemp(join(tmpdir(), 'pp-outside-nested-'));
    const preservedCopy = await mkdtemp(join(tmpdir(), 'pp-preserved-nested-copy-'));
    const tarFlat = join(tmpdir(), `pp-nested-flat-${Date.now()}.tgz`);
    const tarPres = join(tmpdir(), `pp-nested-pres-${Date.now()}.tgz`);

    try {
      const pkgFlat = join(base, 'flat');
      const rootFlat = join(base, 'flat-root');
      await mkdir(pkgFlat, { recursive: true });
      await mkdir(rootFlat, { recursive: true });
      await createRichFixture({ pkgDir: pkgFlat, rootDir: rootFlat, publishDir: 'artifacts/npm', outsideDir: outside });

      const flatRuns: string[] = [];
      const flatRunner: ProcessRunner = {
        run(_exe, _args, options) {
          flatRuns.push(options.cwd);
        },
        runShell() {
          void 0;
        },
      };
      const flatLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      publishPackage({
        cwd: pkgFlat,
        rootDir: rootFlat,
        version: '1.2.3',
        publishDir: 'artifacts/npm',
        skipBuild: true,
        dryRun: true,
        runner: flatRunner,
      });
      flatLog.mockRestore();
      const flatManifest = JSON.parse(await readFile(join(flatRuns[0], 'package.json'), 'utf8'));
      expect(flatManifest.main).toBe('./index.js');
      expect((flatManifest.bin as Record<string, string>)['example-cli']).toBe('./cli.js');
      const flatFiles = listFilesRecursive(flatRuns[0]);
      expect(flatFiles).toContain('index.js');
      expect(flatFiles).not.toContain('artifacts/npm/index.js');
      expect(flatFiles).not.toContain('artifacts');
      createTarball(flatRuns[0], tarFlat, true);
      const flatTar = listTarball(tarFlat);
      expect(flatTar).toContain('index.js');
      expect(flatTar.some((f) => f.includes('artifacts'))).toBe(false);

      const pkgPres = join(base, 'pres');
      const rootPres = join(base, 'pres-root');
      await mkdir(pkgPres, { recursive: true });
      await mkdir(rootPres, { recursive: true });
      await createRichFixture({ pkgDir: pkgPres, rootDir: rootPres, publishDir: 'artifacts/npm', outsideDir: outside });

      const captured: Captured[] = [];
      const presRunner: ProcessRunner = {
        run(_exe, _args, options) {
          const manifest = JSON.parse(readFileSync(join(options.cwd, 'package.json'), 'utf8'));
          const files = listFilesRecursive(options.cwd);
          const copyDir = join(preservedCopy, 'snap2');
          try {
            mkdirSync(copyDir, { recursive: true });
          } catch (_e) {
            void _e;
          }
          try {
            execFileSync('cp', ['-a', `${options.cwd}/.`, copyDir], { stdio: 'pipe' });
          } catch (_e) {
            void _e;
            copyRecursiveSync(options.cwd, copyDir);
          }
          captured.push({ cwd: options.cwd, manifest, files, copyDir });
        },
        runShell() {
          void 0;
        },
      };
      const presLog = vi.spyOn(console, 'log').mockImplementation(() => {});
      publishPackage({
        cwd: pkgPres,
        rootDir: rootPres,
        version: '1.2.3',
        publishDir: 'artifacts/npm',
        preservePublishDir: true,
        skipBuild: true,
        dryRun: true,
        runner: presRunner,
      });
      presLog.mockRestore();
      expect(captured).toHaveLength(1);
      expect(captured[0].manifest.main).toBe('artifacts/npm/index.js');
      expect((captured[0].manifest.bin as Record<string, string>)['example-cli']).toBe('artifacts/npm/cli.js');
      expect(captured[0].files).toContain('artifacts/npm/index.js');
      expect(captured[0].files).toContain('artifacts/npm/cli.js');
      expect(captured[0].files).toContain('README.md');
      expect(captured[0].files).not.toContain('index.js');
      expect(captured[0].files.some((f) => f === 'artifacts/npm/index.js.map')).toBe(true);
      createTarball(captured[0].copyDir, tarPres, true);
      const presTar = listTarball(tarPres);
      expect(presTar).toContain('artifacts/npm/index.js');
      expect(presTar).toContain('README.md');
      expect(presTar).not.toContain('index.js');
      expect(presTar.some((f) => f.endsWith('.map'))).toBe(false);
    } finally {
      await rm(base, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
      await rm(preservedCopy, { recursive: true, force: true });
      await rm(tarFlat, { force: true });
      await rm(tarPres, { force: true });
    }
  }, 30_000);

  it('cleanup removes staging after success and failure, original publishDir stays intact and no external content leaks', async () => {
    const base = await mkdtemp(join(tmpdir(), 'pp-cleanup-'));
    const outside = await mkdtemp(join(tmpdir(), 'pp-cleanup-outside-'));
    try {
      const pkgDir = join(base, 'pkg');
      const rootDir = join(base, 'root');
      await mkdir(pkgDir, { recursive: true });
      await mkdir(rootDir, { recursive: true });
      await createRichFixture({ pkgDir, rootDir, publishDir: 'dist', outsideDir: outside });

      let stagingPath: string | null = null;
      const runner: ProcessRunner = {
        run(_exe, _args, options) {
          stagingPath = options.cwd;
        },
        runShell() {
          void 0;
        },
      };
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      publishPackage({
        cwd: pkgDir,
        rootDir,
        version: '1.2.3',
        preservePublishDir: true,
        skipBuild: true,
        dryRun: true,
        runner,
      });
      log.mockRestore();
      expect(stagingPath).not.toBeNull();
      expect(existsSync(stagingPath!)).toBe(false);
      expect(existsSync(join(pkgDir, 'dist', 'index.js'))).toBe(true);
      expect(existsSync(join(pkgDir, 'dist', 'index.js.map'))).toBe(true);

      const pkgDir2 = join(base, 'pkg2');
      const rootDir2 = join(base, 'root2');
      await mkdir(pkgDir2, { recursive: true });
      await mkdir(rootDir2, { recursive: true });
      await createRichFixture({ pkgDir: pkgDir2, rootDir: rootDir2, publishDir: 'dist', outsideDir: outside });
      let failStaging: string | null = null;
      const failRunner: ProcessRunner = {
        run(_exe, _args, options) {
          failStaging = options.cwd;
          throw new Error('fake npm failure');
        },
        runShell() {
          void 0;
        },
      };
      const log2 = vi.spyOn(console, 'log').mockImplementation(() => {});
      expect(() =>
        publishPackage({
          cwd: pkgDir2,
          rootDir: rootDir2,
          version: '1.2.3',
          preservePublishDir: true,
          skipBuild: true,
          dryRun: true,
          runner: failRunner,
        }),
      ).toThrow(/fake npm failure/);
      log2.mockRestore();
      expect(failStaging).not.toBeNull();
      expect(existsSync(failStaging!)).toBe(false);
      expect(existsSync(join(pkgDir2, 'dist', 'index.js'))).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  }, 30_000);
});
