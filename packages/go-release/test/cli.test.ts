import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const packageRoot = resolve(import.meta.dirname, '..');
const buildCli = join(packageRoot, 'dist', 'cli-build.js');
const verifyCli = join(packageRoot, 'dist', 'cli-verify.js');
const tempPaths: string[] = [];

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

afterEach(() => {
  for (const path of tempPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'go-release-cli-'));
  tempPaths.push(cwd);
  return cwd;
}

function runCli(cli: string, args: ReadonlyArray<string>, cwd = packageRoot): CliResult {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function writeConfig(cwd: string, overrides: Readonly<Record<string, unknown>> = {}): string {
  const path = join(cwd, 'go-release.json');
  writeFileSync(
    path,
    JSON.stringify({
      toolName: 'fixture',
      version: '1.2.3',
      outputDir: 'dist',
      binaries: [{ name: 'fixture', package: 'cmd/fixture' }],
      targets: [{ os: 'linux', arch: 'amd64' }],
      ...overrides,
    }),
  );
  return path;
}

function writeFakeGo(cwd: string, fail = false): string {
  const path = join(cwd, fail ? 'secret-failing-go.cjs' : 'secret-fake-go.cjs');
  writeFileSync(
    path,
    fail
      ? '#!/usr/bin/env node\nprocess.stderr.write("controlled compiler failure\\n"); process.exitCode = 7;\n'
      : `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const output = args[args.indexOf('-o') + 1];
fs.writeFileSync(output, 'binary:' + process.env.GOOS + '-' + process.env.GOARCH);
`,
  );
  chmodSync(path, 0o755);
  return path;
}

function writeFailingTar(cwd: string): string {
  const path = join(cwd, 'failing-tar.cjs');
  writeFileSync(
    path,
    '#!/usr/bin/env node\nprocess.stderr.write("controlled tar failure\\n"); process.exitCode = 8;\n',
  );
  chmodSync(path, 0o755);
  return path;
}

function buildRelease(cwd: string, config: string, goExecutable: string): CliResult {
  return runCli(buildCli, ['--cwd', cwd, '--config', config, '--go-executable', goExecutable]);
}

function treeSnapshot(root: string): ReadonlyArray<string> {
  const entries: string[] = [];
  const visit = (directory: string, prefix = ''): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      entries.push(`${entry.isDirectory() ? 'd' : 'f'}:${relative}`);
      if (entry.isDirectory()) visit(join(directory, entry.name), relative);
      else entries.push(`c:${relative}:${readFileSync(join(directory, entry.name)).toString('base64')}`);
    }
  };
  visit(root);
  return entries;
}

function helpFlags(text: string): Set<string> {
  return new Set([...text.matchAll(/--([a-z][a-z-]*)/gu)].map((match) => match[1]));
}

function tableFlags(text: string): Set<string> {
  return new Set([...text.matchAll(/\| `--([a-z][a-z-]*)/gu)].map((match) => match[1]));
}

describe('Go release CLI parsing and plans', () => {
  it('prints matching help and README option tables for both bins', () => {
    const buildHelp = runCli(buildCli, ['--help']);
    const verifyHelp = runCli(verifyCli, ['-h']);
    expect(buildHelp).toMatchObject({ status: 0, stderr: '' });
    expect(verifyHelp).toMatchObject({ status: 0, stderr: '' });
    expect(buildHelp.stdout).toContain('repo-toolkit-build-go-release');
    expect(verifyHelp.stdout).toContain('repo-toolkit-verify-go-release');

    const readme = readFileSync(join(packageRoot, 'README.md'), 'utf8');
    const [buildSection, verifySection] = readme.split('Verify options:');
    expect(tableFlags(buildSection)).toEqual(helpFlags(buildHelp.stdout));
    expect(tableFlags(verifySection)).toEqual(helpFlags(verifyHelp.stdout));
  });

  it('rejects unknown flags and missing values with nonzero exit codes', () => {
    const unknown = runCli(buildCli, ['--unknown']);
    const missing = runCli(verifyCli, ['--config']);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('Unknown argument: --unknown');
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('Missing value for --config');
  });

  it('uses config defaults, applies CLI overrides, filters targets, and dry-runs without mutation', () => {
    const cwd = fixture();
    const config = writeConfig(cwd, {
      version: 'from-config',
      outputDir: 'config-output',
      goExecutable: join(cwd, 'secret-never-run-go'),
      tarExecutable: join(cwd, 'secret-never-run-tar'),
      targets: [
        { os: 'linux', arch: 'amd64' },
        { os: 'windows', arch: 'arm64' },
      ],
      processLimits: { concurrency: 1 },
    });
    const before = treeSnapshot(cwd);
    const result = runCli(
      buildCli,
      [
        '--cwd',
        cwd,
        '--config',
        'go-release.json',
        '--version',
        'from-cli',
        '--output-dir',
        'cli-output',
        '--target',
        'windows-arm64',
        '--concurrency',
        '3',
        '--dry-run',
      ],
      packageRoot,
    );

    expect(result).toMatchObject({ status: 0, stderr: '' });
    expect(JSON.parse(result.stdout)).toMatchObject({
      operation: 'build',
      dryRun: true,
      version: 'from-cli',
      outputDir: 'cli-output',
      concurrency: 3,
      targets: [{ target: 'windows-arm64', archive: 'fixture-windows-arm64.tar.gz', binaries: ['fixture.exe'] }],
    });
    expect(result.stdout).not.toContain('secret-never-run');
    expect(treeSnapshot(cwd)).toEqual(before);
    expect(config).toBe(join(cwd, 'go-release.json'));
  });

  it('validates config and target filters before any external process runs', () => {
    const cwd = fixture();
    const marker = join(cwd, 'called');
    const executable = join(cwd, 'marker-go.cjs');
    writeFileSync(
      executable,
      `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'called');\n`,
    );
    chmodSync(executable, 0o755);
    const invalid = writeConfig(cwd, { goExecutable: executable, unexpected: true });
    const invalidResult = runCli(buildCli, ['--cwd', cwd, '--config', invalid]);
    expect(invalidResult.status).toBe(1);
    expect(invalidResult.stderr).toContain('Unknown go-release option: unexpected');
    expect(existsSync(marker)).toBe(false);

    writeConfig(cwd, { goExecutable: executable });
    const targetResult = runCli(buildCli, ['--cwd', cwd, '--config', 'go-release.json', '--target', 'darwin-arm64']);
    expect(targetResult.status).toBe(1);
    expect(targetResult.stderr).toContain('Unknown target filter: darwin-arm64');
    expect(existsSync(marker)).toBe(false);

    writeConfig(cwd, { runner: {} });
    const runnerResult = runCli(buildCli, ['--cwd', cwd, '--config', 'go-release.json']);
    expect(runnerResult.status).toBe(1);
    expect(runnerResult.stderr).toContain('runner is available only to library callers');
    expect(existsSync(marker)).toBe(false);
  });

  it('validates verify config limits and gives explicit CLI values precedence', () => {
    const cwd = fixture();
    writeConfig(cwd, { archiveLimits: { maxMemberCount: 100, maxPathLength: 200 } });
    const result = runCli(verifyCli, [
      '--cwd',
      cwd,
      '--config',
      'go-release.json',
      '--max-member-count',
      '50',
      '--dry-run',
    ]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      operation: 'verify',
      archiveLimits: { maxMemberCount: 50, maxPathLength: 200 },
    });

    writeConfig(cwd, { archiveLimits: { unknown: 1 } });
    const invalid = runCli(verifyCli, ['--cwd', cwd, '--config', 'go-release.json', '--dry-run']);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('Unknown archiveLimits option: unknown');
  });
});

describe('Go release CLI execution', () => {
  it('builds, archives, checksums, filters targets, and prints a deterministic secrets-free summary', () => {
    const cwd = fixture();
    const config = writeConfig(cwd, {
      targets: [
        { os: 'linux', arch: 'amd64' },
        { os: 'windows', arch: 'arm64' },
      ],
    });
    const result = runCli(buildCli, [
      '--cwd',
      cwd,
      '--config',
      config,
      '--go-executable',
      writeFakeGo(cwd),
      '--target',
      'linux-amd64',
      '--concurrency',
      '1',
    ]);
    expect(result).toMatchObject({ status: 0, stderr: '' });
    const summary = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(summary).toMatchObject({
      operation: 'build',
      dryRun: false,
      targets: ['linux-amd64'],
      checksumFile: 'SHA256SUMS',
    });
    expect(result.stdout).not.toContain('secret-fake-go');
    expect(existsSync(join(cwd, 'dist', 'linux-amd64', 'fixture'))).toBe(true);
    expect(existsSync(join(cwd, 'dist', 'fixture-linux-amd64.tar.gz'))).toBe(true);
    expect(readFileSync(join(cwd, 'dist', 'SHA256SUMS'), 'utf8')).toMatch(
      /^[0-9a-f]{64} {2}fixture-linux-amd64\.tar\.gz\n$/u,
    );
    expect(existsSync(join(cwd, 'dist', 'windows-arm64'))).toBe(false);
  });

  it('verifies existing output and optionally verifies independent reproducibility', () => {
    const cwd = fixture();
    const config = writeConfig(cwd);
    const goExecutable = writeFakeGo(cwd);
    expect(buildRelease(cwd, config, goExecutable).status).toBe(0);

    const result = runCli(verifyCli, [
      '--cwd',
      cwd,
      '--config',
      config,
      '--go-executable',
      goExecutable,
      '--reproducibility',
    ]);
    expect(result).toMatchObject({ status: 0, stderr: '' });
    expect(JSON.parse(result.stdout)).toMatchObject({
      operation: 'verify',
      artifacts: [{ target: 'linux-amd64', name: 'fixture-linux-amd64.tar.gz' }],
      reproducibility: { verified: true, targets: ['linux-amd64'] },
    });
    expect(result.stdout).not.toContain('secret-fake-go');
    expect(readdirSync(cwd).filter((name) => name.startsWith('.go-release-reproducibility-'))).toEqual([]);
  });

  it('reports compiler and verifier process failures through main().catch without process.exit()', () => {
    const cwd = fixture();
    const config = writeConfig(cwd);
    const buildFailure = buildRelease(cwd, config, writeFakeGo(cwd, true));
    expect(buildFailure.status).toBe(1);
    expect(buildFailure.stderr).toContain('exited with status 7');

    const goodGo = writeFakeGo(cwd);
    expect(buildRelease(cwd, config, goodGo).status).toBe(0);
    const verifyFailure = runCli(verifyCli, [
      '--cwd',
      cwd,
      '--config',
      config,
      '--tar-executable',
      writeFailingTar(cwd),
    ]);
    expect(verifyFailure.status).toBe(1);
    expect(verifyFailure.stderr).toContain('exited with status 8');
    expect(readFileSync(join(packageRoot, 'src', 'cli-build.ts'), 'utf8')).not.toContain('process.exit(');
    expect(readFileSync(join(packageRoot, 'src', 'cli-verify.ts'), 'utf8')).not.toContain('process.exit(');
  });
});

describe('packed Go release bins', () => {
  it('packs executable shebang bins that import as ESM and run help after extraction', () => {
    const packDir = fixture();
    execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
      cwd: packageRoot,
      stdio: 'pipe',
      env: { ...process.env, CI: '1' },
    });
    const tarballs = readdirSync(packDir).filter((entry) => entry.endsWith('.tgz'));
    expect(tarballs).toHaveLength(1);
    const tarball = join(packDir, tarballs[0]);
    const listing = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' });
    expect(listing).toContain('package/dist/cli-build.js');
    expect(listing).toContain('package/dist/cli-verify.js');
    expect(listing).toContain('package/dist/index.js');
    expect(listing).toContain('package/dist/index.d.ts');

    const extractDir = fixture();
    execFileSync('tar', ['-xzf', tarball, '-C', extractDir]);
    const dependencyScope = join(extractDir, 'package', 'node_modules', '@repo-toolkit');
    mkdirSync(dependencyScope, { recursive: true });
    symlinkSync(resolve(packageRoot, '..', 'publish-package'), join(dependencyScope, 'publish-package'), 'dir');

    for (const [file, name] of [
      ['cli-build.js', 'repo-toolkit-build-go-release'],
      ['cli-verify.js', 'repo-toolkit-verify-go-release'],
    ]) {
      const path = join(extractDir, 'package', 'dist', file);
      expect(readFileSync(path, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env node');
      const result = spawnSync(path, ['--help'], { encoding: 'utf8' });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain(name);
    }

    const imported = execFileSync(
      process.execPath,
      ['--input-type=module', '--eval', "console.log(Object.keys(await import('./dist/index.js')).sort().join(','))"],
      { cwd: join(extractDir, 'package'), encoding: 'utf8' },
    );
    expect(imported).toContain('buildGoRelease');
    expect(imported).toContain('verifyGoRelease');

    const consumer = fixture();
    const config = writeConfig(consumer);
    const goExecutable = writeFakeGo(consumer);
    const packedBuild = runCli(join(extractDir, 'package/dist/cli-build.js'), [
      '--cwd',
      consumer,
      '--config',
      config,
      '--go-executable',
      goExecutable,
    ]);
    expect(packedBuild).toMatchObject({ status: 0, stderr: '' });
    const packedVerify = runCli(join(extractDir, 'package/dist/cli-verify.js'), [
      '--cwd',
      consumer,
      '--config',
      config,
    ]);
    expect(packedVerify).toMatchObject({ status: 0, stderr: '' });
  });
});
