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

import { planSummary, reportCliError, resolveDockerPublishCliOptions } from '../src/cli-options';
import {
  collectInteractiveSecrets,
  createScriptedPrompter,
  promptInteractiveAuth,
  resolveInteractiveAuthAndConfirm,
} from '../src/interactive';
import { DIGEST_A, writeImageContext } from './helpers';

const packageRoot = resolve(import.meta.dirname, '..');
const buildCli = join(packageRoot, 'dist', 'cli-build.js');
const publishCli = join(packageRoot, 'dist', 'cli-publish.js');
const unifiedCli = join(packageRoot, 'dist', 'cli.js');
const tempPaths: string[] = [];

const SECRET_BUILD_ARG = 'cli-test-build-arg-secret-9f2c';
const AUTH_USER_ENV = 'DOCKER_PUBLISH_CLI_TEST_USER';
const AUTH_PASS_ENV = 'DOCKER_PUBLISH_CLI_TEST_PASS';
const AUTH_USER = 'cli-test-user';
const AUTH_PASS = 'cli-test-pass-secret-4d7e';

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

afterEach(() => {
  for (const path of tempPaths.splice(0)) rmSync(path, { recursive: true, force: true });
  delete process.env[AUTH_USER_ENV];
  delete process.env[AUTH_PASS_ENV];
});

function fixture(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'docker-publish-cli-'));
  tempPaths.push(cwd);
  return cwd;
}

function runCli(
  cli: string,
  args: ReadonlyArray<string>,
  cwd = packageRoot,
  env: Readonly<Record<string, string>> = {},
): CliResult {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function writeConfig(root: string, overrides: Readonly<Record<string, unknown>> = {}): string {
  const path = join(root, 'docker-publish.json');
  writeFileSync(
    path,
    JSON.stringify({
      images: [{ name: 'app', contextDir: 'services/app' }],
      registries: [{ hostname: 'registry.example.com', repositoryPrefix: 'team' }],
      tags: ['1.2.3'],
      platforms: ['linux/amd64'],
      ...overrides,
    }),
  );
  return path;
}

function writeMultiConfig(root: string): string {
  writeImageContext(root, 'services/app');
  writeImageContext(root, 'services/worker');
  return writeConfig(root, {
    images: [
      { name: 'app', contextDir: 'services/app' },
      { name: 'worker', contextDir: 'services/worker' },
    ],
    registries: [{ hostname: 'registry.example.com', repositoryPrefix: 'team' }, { hostname: 'localhost:5000' }],
    tags: ['1.2.3', 'latest'],
    platforms: ['linux/amd64', 'linux/arm64'],
    buildConcurrency: 1,
  });
}

function writeMarkerExecutable(root: string): { readonly path: string; readonly marker: string } {
  const marker = join(root, 'docker-called');
  const path = join(root, 'marker-docker.cjs');
  writeFileSync(path, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'called');\n`);
  chmodSync(path, 0o755);
  return { path, marker };
}

function writeFakeDocker(root: string): string {
  const path = join(root, 'fake-docker.cjs');
  writeFileSync(
    path,
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const digest = process.env.FAKE_DIGEST || ${JSON.stringify(DIGEST_A)};
const callLog = process.env.CALL_LOG;
if (callLog) fs.appendFileSync(callLog, args[0] + '\\n');
if (process.env.FAIL_MODE === 'build' && args[0] === 'buildx' && args[1] === 'build') {
  process.stderr.write('controlled build failure argv: ' + JSON.stringify(args) + '\\n');
  process.exit(7);
}
if (process.env.FAIL_LOGIN === '1' && args[0] === 'login') {
  process.stderr.write('controlled login failure\\n');
  process.exit(5);
}
if (args[0] === 'buildx' && args[1] === 'build') process.exit(0);
if (args[0] === 'images') {
  const refs = args.slice(args.indexOf('--format') + 2);
  for (const ref of refs) console.log(ref + ' sha256:' + '1'.repeat(64));
  process.exit(0);
}
if (args[0] === 'push') {
  console.log('latest: digest: ' + digest + ' size: 1783');
  process.exit(0);
}
if (args[0] === 'buildx' && args[1] === 'imagetools' && args[2] === 'inspect') {
  const ref = args[args.length - 1];
  void ref;
  if (args.includes('--raw')) {
    const platforms = (process.env.FAKE_PLATFORMS || 'linux/amd64').split(',');
    console.log(JSON.stringify({
      mediaType: 'application/vnd.oci.image.index.v1+json',
      digest,
      manifests: platforms.map((name) => {
        const parts = name.split('/');
        return {
          mediaType: 'application/vnd.oci.image.manifest.v1+json',
          digest: 'sha256:' + 'b'.repeat(64),
          platform: { os: parts[0], architecture: parts[1] },
        };
      }),
    }));
  } else {
    console.log(JSON.stringify({ mediaType: 'application/vnd.oci.image.index.v1+json', digest }));
  }
  process.exit(0);
}
if (args[0] === 'login' || args[0] === 'rmi') process.exit(0);
process.stderr.write('unexpected fake-docker argv: ' + JSON.stringify(args) + '\\n');
process.exit(3);
`,
  );
  chmodSync(path, 0o755);
  return path;
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

describe('Docker publish CLI parsing and plans', () => {
  it('prints matching help and README option tables for all three bins', () => {
    const buildHelp = runCli(buildCli, ['--help']);
    const publishHelp = runCli(publishCli, ['-h']);
    const unifiedHelp = runCli(unifiedCli, ['--help']);
    expect(buildHelp).toMatchObject({ status: 0, stderr: '' });
    expect(publishHelp).toMatchObject({ status: 0, stderr: '' });
    expect(unifiedHelp).toMatchObject({ status: 0, stderr: '' });
    expect(buildHelp.stdout).toContain('repo-toolkit-build-docker-publish');
    expect(publishHelp.stdout).toContain('repo-toolkit-publish-docker-publish');
    expect(unifiedHelp.stdout).toContain('repo-toolkit-docker-publish');

    const readme = readFileSync(join(packageRoot, 'README.md'), 'utf8');
    const [buildSection, afterBuild] = readme.split('Publish options:');
    const [publishSection, unifiedSection] = afterBuild.split('Unified options:');
    expect(tableFlags(buildSection)).toEqual(helpFlags(buildHelp.stdout));
    expect(tableFlags(publishSection)).toEqual(helpFlags(publishHelp.stdout));
    expect(tableFlags(unifiedSection)).toEqual(helpFlags(unifiedHelp.stdout));
  });

  it('rejects unknown flags, missing values, and positional subcommands', () => {
    const unknown = runCli(buildCli, ['--unknown']);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('Unknown argument: --unknown');

    const missing = runCli(publishCli, ['--config']);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('Missing value for --config');

    const cwd = fixture();
    writeImageContext(cwd, 'services/app');
    const config = writeConfig(cwd);
    const positional = runCli(unifiedCli, ['build', '--config', config], cwd);
    expect(positional.status).toBe(1);
    expect(positional.stderr).toContain('Unknown argument: build');
  });

  it('uses config defaults, applies CLI overrides, filters, and dry-runs without mutation', () => {
    const cwd = fixture();
    const config = writeMultiConfig(cwd);
    const marker = writeMarkerExecutable(cwd);
    const neverRun = join(cwd, 'never-run-docker');
    const before = treeSnapshot(cwd);
    const result = runCli(
      buildCli,
      [
        '--cwd',
        cwd,
        '--config',
        'docker-publish.json',
        '--image',
        'worker',
        '--platform',
        'linux/arm64',
        '--registry',
        'localhost:5000',
        '--concurrency',
        '3',
        '--docker-executable',
        neverRun,
        '--dry-run',
      ],
      packageRoot,
    );

    expect(result).toMatchObject({ status: 0, stderr: '' });
    expect(JSON.parse(result.stdout)).toMatchObject({
      operation: 'build',
      dryRun: true,
      dockerExecutable: neverRun,
      buildConcurrency: 3,
      platforms: ['linux/arm64'],
      registries: ['localhost:5000'],
      images: [{ image: 'worker', references: ['localhost:5000/worker:1.2.3', 'localhost:5000/worker:latest'] }],
      references: ['localhost:5000/worker:1.2.3', 'localhost:5000/worker:latest'],
    });
    expect(result.stdout).not.toContain('marker-docker');
    expect(treeSnapshot(cwd)).toEqual(before);
    expect(existsSync(marker.marker)).toBe(false);
    expect(config).toBe(join(cwd, 'docker-publish.json'));
  });

  it('validates config and filters before any external process runs', () => {
    const cwd = fixture();
    writeImageContext(cwd, 'services/app');
    const marker = writeMarkerExecutable(cwd);
    const args = ['--cwd', cwd, '--docker-executable', marker.path];

    const invalid = writeConfig(cwd, { dockerExecutable: marker.path, unexpected: true });
    const invalidResult = runCli(buildCli, [...args, '--config', invalid]);
    expect(invalidResult.status).toBe(1);
    expect(invalidResult.stderr).toContain('Unknown docker-publish option: unexpected');
    expect(existsSync(marker.marker)).toBe(false);

    writeConfig(cwd, { dockerExecutable: marker.path });
    for (const [flag, value, message] of [
      ['--image', 'missing-image', 'Unknown image filter: missing-image'],
      ['--platform', 'linux/s390x', 'Unknown platform filter: linux/s390x'],
      ['--registry', 'unknown.example.com', 'Unknown registry filter: unknown.example.com'],
    ] as ReadonlyArray<readonly [string, string, string]>) {
      const filtered = runCli(buildCli, [...args, '--config', 'docker-publish.json', flag, value]);
      expect(filtered.status).toBe(1);
      expect(filtered.stderr).toContain(message);
      expect(existsSync(marker.marker)).toBe(false);
    }

    writeConfig(cwd, { runner: {} });
    const runnerResult = runCli(buildCli, [...args, '--config', 'docker-publish.json']);
    expect(runnerResult.status).toBe(1);
    expect(runnerResult.stderr).toContain('runner is available only to library callers');
    expect(existsSync(marker.marker)).toBe(false);
  });
});

describe('Docker publish CLI execution', () => {
  it('builds single-platform images and prints a deterministic secrets-free summary', () => {
    const cwd = fixture();
    writeImageContext(cwd, 'services/app');
    const config = writeConfig(cwd, {
      buildArgs: { BUILD_MODE: 'release', EXTRA_TOKEN: SECRET_BUILD_ARG },
      allowSecretsInBuildArgs: true,
    });
    const result = runCli(buildCli, ['--cwd', cwd, '--config', config, '--docker-executable', writeFakeDocker(cwd)]);

    expect(result).toMatchObject({ status: 0, stderr: '' });
    const summary = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(summary).toMatchObject({
      operation: 'build',
      dryRun: false,
      references: ['registry.example.com/team/app:1.2.3'],
    });
    expect(result.stdout).not.toContain(SECRET_BUILD_ARG);
    expect(result.stdout).not.toContain('BUILD_MODE');
  });

  it('publishes prebuilt images, writes sorted digest manifests, and verifies', () => {
    const cwd = fixture();
    writeImageContext(cwd, 'services/app');
    const config = writeConfig(cwd);
    const docker = writeFakeDocker(cwd);
    const result = runCli(publishCli, [
      '--cwd',
      cwd,
      '--config',
      config,
      '--docker-executable',
      docker,
      '--skip-build',
      '--digest-manifest',
      'digests.json',
      '--verify',
    ]);

    expect(result).toMatchObject({ status: 0, stderr: '' });
    const summary = JSON.parse(result.stdout) as {
      publishes: Array<{ reference: string; digest: string }>;
      verified: { verified: boolean };
      digestManifest: string;
    };
    expect(summary.publishes).toEqual([
      {
        reference: 'registry.example.com/team/app:1.2.3',
        registry: 'registry.example.com',
        tag: '1.2.3',
        digest: DIGEST_A,
        durationMs: expect.any(Number),
      },
    ]);
    expect(summary.verified).toMatchObject({ verified: true });
    expect(summary.digestManifest).toBe('digests.json');
    expect(readFileSync(join(cwd, 'digests.json'), 'utf8')).toBe(
      `{\n  "registry.example.com/team/app:1.2.3": "${DIGEST_A}"\n}\n`,
    );
    expect(readdirSync(cwd).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  it('builds then publishes by default and chains unified operation flags', () => {
    const cwd = fixture();
    writeImageContext(cwd, 'services/app');
    const config = writeConfig(cwd);
    const docker = writeFakeDocker(cwd);

    const publishDefault = runCli(publishCli, ['--cwd', cwd, '--config', config, '--docker-executable', docker]);
    expect(publishDefault).toMatchObject({ status: 0, stderr: '' });
    const publishSummary = JSON.parse(publishDefault.stdout) as Record<string, unknown>;
    expect(publishSummary).toMatchObject({ operation: 'publish', dryRun: false });
    expect(publishSummary).toHaveProperty('built');
    expect(publishSummary).toHaveProperty('publishes');

    const unified = runCli(unifiedCli, [
      '--cwd',
      cwd,
      '--config',
      config,
      '--docker-executable',
      docker,
      '--build',
      '--push',
      '--verify',
    ]);
    expect(unified).toMatchObject({ status: 0, stderr: '' });
    expect(JSON.parse(unified.stdout)).toMatchObject({
      operation: 'docker-publish',
      operations: { build: true, push: true, verify: true },
      verified: { verified: true },
    });

    const unifiedDefault = runCli(unifiedCli, ['--cwd', cwd, '--config', config, '--docker-executable', docker]);
    expect(unifiedDefault).toMatchObject({ status: 0, stderr: '' });
    const defaultSummary = JSON.parse(unifiedDefault.stdout) as Record<string, unknown>;
    expect(defaultSummary).toMatchObject({ operations: { build: true, push: true, verify: false } });
    expect(defaultSummary).toHaveProperty('built');
    expect(defaultSummary).toHaveProperty('publishes');
    expect(defaultSummary).not.toHaveProperty('verified');
  });

  it('verifies a filtered image against expectedDigests without pushing', () => {
    const cwd = fixture();
    writeImageContext(cwd, 'services/app');
    writeImageContext(cwd, 'services/worker');
    const appReference = 'registry.example.com/team/app:1.2.3';
    const workerReference = 'registry.example.com/team/worker:1.2.3';
    const config = writeConfig(cwd, {
      images: [
        { name: 'app', contextDir: 'services/app' },
        { name: 'worker', contextDir: 'services/worker' },
      ],
      expectedDigests: { [appReference]: DIGEST_A, [workerReference]: DIGEST_A },
    });
    const docker = writeFakeDocker(cwd);
    const result = runCli(unifiedCli, [
      '--cwd',
      cwd,
      '--config',
      config,
      '--docker-executable',
      docker,
      '--image',
      'app',
      '--verify',
    ]);

    expect(result).toMatchObject({ status: 0, stderr: '' });
    const summary = JSON.parse(result.stdout) as {
      operations: { build: boolean; push: boolean; verify: boolean };
      verified: { verified: boolean; references: Array<{ reference: string }> };
    };
    expect(summary.operations).toEqual({ build: false, push: false, verify: true });
    expect(summary.verified.verified).toBe(true);
    expect(summary.verified.references.map((entry) => entry.reference)).toEqual([appReference]);
  });

  it('authenticates via env-sourced credentials and redacts secrets on login failure', () => {
    const cwd = fixture();
    writeImageContext(cwd, 'services/app');
    const hostname = 'registry.example.com';
    const config = writeConfig(cwd, {
      auth: { [hostname]: { usernameEnv: AUTH_USER_ENV, passwordEnv: AUTH_PASS_ENV } },
    });
    const docker = writeFakeDocker(cwd);
    const callLog = join(cwd, 'calls.log');

    process.env[AUTH_USER_ENV] = AUTH_USER;
    process.env[AUTH_PASS_ENV] = AUTH_PASS;
    const ok = runCli(
      publishCli,
      ['--cwd', cwd, '--config', config, '--docker-executable', docker, '--skip-build'],
      packageRoot,
      { CALL_LOG: callLog },
    );
    expect(ok).toMatchObject({ status: 0, stderr: '' });
    expect(ok.stdout).not.toContain(AUTH_PASS);
    expect(readFileSync(callLog, 'utf8').split('\n')).toContain('login');

    const failing = runCli(
      publishCli,
      ['--cwd', cwd, '--config', config, '--docker-executable', docker, '--skip-build'],
      packageRoot,
      { FAIL_LOGIN: '1' },
    );
    expect(failing.status).toBe(1);
    expect(failing.stderr).toContain('Failed to authenticate Docker registry "registry.example.com"');
    expect(failing.stderr).not.toContain(AUTH_PASS);
  });

  it('reports process failures with redaction through main().catch without process.exit()', () => {
    const cwd = fixture();
    writeImageContext(cwd, 'services/app');
    const config = writeConfig(cwd, {
      buildArgs: { EXTRA_TOKEN: SECRET_BUILD_ARG },
      allowSecretsInBuildArgs: true,
    });
    const failure = runCli(
      buildCli,
      ['--cwd', cwd, '--config', config, '--docker-executable', writeFakeDocker(cwd)],
      packageRoot,
      { FAIL_MODE: 'build' },
    );
    expect(failure.status).toBe(1);
    expect(failure.stderr).toContain('Failed to build Docker image "app"');
    expect(failure.stderr).toContain('[redacted]');
    expect(failure.stderr).not.toContain(SECRET_BUILD_ARG);
    expect(failure.stdout).toBe('');

    for (const source of ['cli.ts', 'cli-build.ts', 'cli-publish.ts', 'cli-options.ts']) {
      expect(readFileSync(join(packageRoot, 'src', source), 'utf8')).not.toContain('process.exit(');
    }
  });
});

describe('Docker publish CLI interactive flag', () => {
  it('exposes -i/--interactive in help for all three bins', () => {
    const cases = [
      [buildCli, 'repo-toolkit-build-docker-publish'],
      [publishCli, 'repo-toolkit-publish-docker-publish'],
      [unifiedCli, 'repo-toolkit-docker-publish'],
    ] as const;
    for (const [cli, name] of cases) {
      const help = runCli(cli, ['--help']);
      expect(help).toMatchObject({ status: 0, stderr: '' });
      expect(help.stdout).toContain(name);
      expect(help.stdout).toContain('-i, --interactive');
      expect(help.stdout).toContain('Prompt for missing required values interactively');
    }
    const shortFlag = runCli(buildCli, ['-i', '--help']);
    expect(shortFlag).toMatchObject({ status: 0, stderr: '' });
    expect(shortFlag.stdout).toContain('-i, --interactive');
  });

  it('fails closed without a TTY before any Docker invocation', () => {
    const cases = [
      { cli: buildCli, extra: [] as string[] },
      { cli: publishCli, extra: ['--skip-build'] as string[] },
      { cli: unifiedCli, extra: ['--build'] as string[] },
    ];
    for (const { cli, extra } of cases) {
      const cwd = fixture();
      writeImageContext(cwd, 'services/app');
      const config = writeConfig(cwd);
      const marker = writeMarkerExecutable(cwd);
      const result = runCli(cli, [
        '--cwd',
        cwd,
        '--config',
        config,
        '--docker-executable',
        marker.path,
        '--interactive',
        ...extra,
      ]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('no TTY');
      expect(result.stdout).toBe('');
      expect(existsSync(marker.marker)).toBe(false);
    }
  });

  it('fails closed for bare -i without --config and invokes no runner', () => {
    const cwd = fixture();
    const marker = writeMarkerExecutable(cwd);
    const result = runCli(buildCli, ['-i', '--cwd', cwd, '--docker-executable', marker.path]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no TTY');
    expect(result.stdout).toBe('');
    expect(existsSync(marker.marker)).toBe(false);
  });

  it('redacts interactive ephemeral auth values from CLI errors', async () => {
    const cwd = fixture();
    writeImageContext(cwd, 'services/app');
    const config = writeConfig(cwd, { cwd });
    const { plan } = await resolveDockerPublishCliOptions({ values: { config }, repeat: {}, unknown: [] }, {});
    const canary = 'cli-interactive-canary-pass-7q3x';
    const userEnv = 'DOCKER_PUBLISH_CLI_INT04_USER';
    const passEnv = 'DOCKER_PUBLISH_CLI_INT04_PASS';
    delete process.env[userEnv];
    delete process.env[passEnv];
    const before = { ...process.env };
    try {
      const prompter = createScriptedPrompter([userEnv, 'int04-user', passEnv, canary]);
      const resolved = await promptInteractiveAuth(prompter, plan.registries, {});
      expect(resolved.authValues['registry.example.com']?.password).toBe(canary);
      const secrets = collectInteractiveSecrets(plan, resolved.auth, resolved.authValues);
      expect(secrets).toContain(canary);
      expect(JSON.stringify(planSummary('publish', plan, false))).not.toContain(canary);
      const lines: string[] = [];
      const original = console.error;
      console.error = (...args: unknown[]): void => {
        lines.push(args.map((entry) => String(entry)).join(' '));
      };
      try {
        reportCliError(new Error(`login failed with ${canary}`), secrets);
      } finally {
        console.error = original;
      }
      expect(lines.join('\n')).toContain('[redacted]');
      expect(lines.join('\n')).not.toContain(canary);
      expect({ ...process.env }).toEqual(before);
    } finally {
      delete process.env[userEnv];
      delete process.env[passEnv];
    }
  });
});

describe('CLI auth shape validation (REV-09)', () => {
  it('rejects malformed auth in --dry-run with zero runner calls', () => {
    const cwd = fixture();
    writeImageContext(cwd, 'services/app');
    const marker = writeMarkerExecutable(cwd);
    const config = writeConfig(cwd, {
      dockerExecutable: marker.path,
      auth: { 'registry.example.com': { usernameEnv: 'A-BAD' } },
    });
    const result = runCli(buildCli, ['--cwd', cwd, '--config', config, '--dry-run']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must define exactly usernameEnv and passwordEnv');
    expect(result.stdout).toBe('');
    expect(existsSync(marker.marker)).toBe(false);
  });

  it('rejects invalid env names and non-object entries before any runner call', async () => {
    const cwd = fixture();
    writeImageContext(cwd, 'services/app');
    const cases = [
      {
        auth: { 'registry.example.com': { usernameEnv: 'A-BAD', passwordEnv: 'OK_PASS' } },
        message: 'auth["registry.example.com"].usernameEnv must be a valid environment variable name',
      },
      {
        auth: { 'registry.example.com': 'nope' },
        message: 'auth["registry.example.com"] must be an object with usernameEnv and passwordEnv',
      },
      {
        auth: { 'registry.example.com': { usernameEnv: 'OK_USER' } },
        message: 'auth["registry.example.com"] must define exactly usernameEnv and passwordEnv',
      },
    ] as const;
    for (const { auth, message } of cases) {
      const config = writeConfig(cwd, { auth });
      await expect(resolveDockerPublishCliOptions({ values: { config }, repeat: {}, unknown: [] }, {})).rejects.toThrow(
        message,
      );
    }
  });

  it('accepts valid auth in --dry-run exactly as before', () => {
    const cwd = fixture();
    writeImageContext(cwd, 'services/app');
    const marker = writeMarkerExecutable(cwd);
    const config = writeConfig(cwd, {
      dockerExecutable: marker.path,
      auth: { 'registry.example.com': { usernameEnv: AUTH_USER_ENV, passwordEnv: AUTH_PASS_ENV } },
    });
    const result = runCli(buildCli, ['--cwd', cwd, '--config', config, '--dry-run']);
    expect(result).toMatchObject({ status: 0, stderr: '' });
    expect(JSON.parse(result.stdout)).toMatchObject({ dryRun: true });
    expect(existsSync(marker.marker)).toBe(false);
  });

  it('rejects malformed configured auth in the pre-confirm dry-run summary before printing', async () => {
    const cwd = fixture();
    writeImageContext(cwd, 'services/app');
    const config = writeConfig(cwd, { cwd });
    const { plan } = await resolveDockerPublishCliOptions({ values: { config }, repeat: {}, unknown: [] }, {});
    let printed = 0;
    await expect(
      resolveInteractiveAuthAndConfirm(
        createScriptedPrompter([]),
        plan,
        { 'registry.example.com': { usernameEnv: 'A-BAD' } } as unknown as Record<string, { usernameEnv: string }>,
        {
          operation: 'publish',
          requiresPush: true,
          dryRun: true,
          printSummaryFn: () => {
            printed += 1;
          },
        },
      ),
    ).rejects.toThrow('must define exactly usernameEnv and passwordEnv');
    expect(printed).toBe(0);
  });
});

describe('packed Docker publish bins', () => {
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
    expect(listing).toContain('package/dist/cli.js');
    expect(listing).toContain('package/dist/cli-build.js');
    expect(listing).toContain('package/dist/cli-publish.js');
    expect(listing).toContain('package/dist/index.js');
    expect(listing).toContain('package/dist/index.d.ts');

    const extractDir = fixture();
    execFileSync('tar', ['-xzf', tarball, '-C', extractDir]);
    const dependencyScope = join(extractDir, 'package', 'node_modules', '@repo-toolkit');
    mkdirSync(dependencyScope, { recursive: true });
    symlinkSync(resolve(packageRoot, '..', 'publish-package'), join(dependencyScope, 'publish-package'), 'dir');

    for (const [file, name] of [
      ['cli.js', 'repo-toolkit-docker-publish'],
      ['cli-build.js', 'repo-toolkit-build-docker-publish'],
      ['cli-publish.js', 'repo-toolkit-publish-docker-publish'],
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
    expect(imported).toContain('buildDockerImages');
    expect(imported).toContain('publishDockerImages');
    expect(imported).toContain('resolveDockerPublishPlan');
    expect(imported).toContain('verifyDockerPublish');

    const consumer = fixture();
    writeImageContext(consumer, 'services/app');
    const config = writeConfig(consumer);
    const packedDryRun = runCli(join(extractDir, 'package/dist/cli-build.js'), [
      '--cwd',
      consumer,
      '--config',
      config,
      '--dry-run',
    ]);
    expect(packedDryRun).toMatchObject({ status: 0, stderr: '' });
    expect(JSON.parse(packedDryRun.stdout)).toMatchObject({
      operation: 'build',
      dryRun: true,
      references: ['registry.example.com/team/app:1.2.3'],
    });
  });
});
