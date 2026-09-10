import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildDockerImages,
  publishDockerImages,
  resolveDockerPublishPlan,
  verifyDockerPublish,
  type DockerBuildRunner,
  type DockerPublishOptions,
  type DockerPublishRunner,
  type DockerRunOptions,
  type DockerVerifyRunner,
} from '../src/index';

const packageRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(packageRoot, '../..');
const buildCli = join(packageRoot, 'dist', 'cli-build.js');
const examples = ['single-image', 'multi-image-multi-registry'] as const;

const DIGEST = `sha256:${'d'.repeat(64)}`;
const STRICT_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

const tempPaths: string[] = [];

afterEach(() => {
  for (const path of tempPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function readFixture(name: (typeof examples)[number]): Record<string, unknown> {
  return JSON.parse(readFileSync(join(packageRoot, 'test', 'fixtures', name, 'docker-publish.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

function documentedExample(name: (typeof examples)[number]): Record<string, unknown> {
  const docs = readFileSync(join(repositoryRoot, 'website', 'docs', 'packages', 'docker-publish.md'), 'utf8');
  const marker = `<!-- example:${name} -->`;
  const start = docs.indexOf(marker);
  if (start < 0) throw new Error(`Missing documented example: ${name}`);
  const fence = docs.slice(start + marker.length).match(/^\s*```json\r?\n/);
  if (!fence) throw new Error(`Missing documented example fence: ${name}`);
  const bodyStart = start + marker.length + fence[0].length;
  const end = docs.indexOf('\n```', bodyStart);
  if (end < 0) throw new Error(`Unterminated documented example: ${name}`);
  return JSON.parse(docs.slice(bodyStart, end)) as Record<string, unknown>;
}

function exampleProject(name: (typeof examples)[number]): { readonly cwd: string; readonly config: string } {
  const config = readFixture(name);
  const cwd = mkdtempSync(join(tmpdir(), `docker-publish-${name}-`));
  tempPaths.push(cwd);
  writeFileSync(join(cwd, 'docker-publish.json'), `${JSON.stringify(config, null, 2)}\n`);
  const images = config.images as ReadonlyArray<{ readonly contextDir: string }>;
  for (const image of images) {
    mkdirSync(join(cwd, image.contextDir), { recursive: true });
    writeFileSync(join(cwd, image.contextDir, 'Dockerfile'), 'FROM scratch\n');
  }
  return { cwd, config: join(cwd, 'docker-publish.json') };
}

function indexManifest(digest: string, platforms: ReadonlyArray<string>): string {
  const manifests = platforms.map((name, position) => {
    const parts = name.split('/');
    return {
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      digest: `sha256:${position.toString(16).padStart(64, '0')}`,
      platform: { os: parts[0], architecture: parts[1] },
    };
  });
  return JSON.stringify({
    mediaType: 'application/vnd.oci.image.index.v1+json',
    digest,
    manifests,
  });
}

interface RecordedCall {
  readonly kind: 'run' | 'capture';
  readonly executable: string;
  readonly args: string[];
  readonly options: DockerRunOptions;
}

function createFakeRunner(platforms: ReadonlyArray<string>): {
  readonly calls: RecordedCall[];
  readonly runner: DockerBuildRunner & DockerPublishRunner & DockerVerifyRunner;
} {
  const calls: RecordedCall[] = [];
  const runner = {
    run(executable: string, args: ReadonlyArray<string>, options: DockerRunOptions): { readonly durationMs: number } {
      calls.push({ kind: 'run', executable, args: [...args], options });
      return { durationMs: 1 };
    },
    capture(
      executable: string,
      args: ReadonlyArray<string>,
      options: DockerRunOptions,
    ): { readonly stdout: string; readonly stderr: string; readonly durationMs: number; readonly outputBytes: number } {
      calls.push({ kind: 'capture', executable, args: [...args], options });
      let stdout: string;
      if (args[0] === 'images') {
        const references = args.slice(4);
        stdout = references.map((reference) => `${reference} sha256:${'1'.repeat(64)}`).join('\n');
        stdout = stdout.length === 0 ? '' : `${stdout}\n`;
      } else if (args[0] === 'push') {
        stdout = `latest: digest: ${DIGEST} size: 1783\n`;
      } else if (args.indexOf('--raw') >= 0) {
        stdout = `${indexManifest(DIGEST, platforms)}\n`;
      } else {
        stdout = `${JSON.stringify({ mediaType: 'application/vnd.oci.image.index.v1+json', digest: DIGEST })}\n`;
      }
      return { stdout, stderr: '', durationMs: 2, outputBytes: Buffer.byteLength(stdout, 'utf8') };
    },
  };
  return { calls, runner };
}

describe('documented Docker publish examples', () => {
  it.each(examples)('keeps the %s website example identical to its tested fixture', (name) => {
    expect(documentedExample(name)).toEqual(readFixture(name));
  });

  it.each(examples)('resolves, dry-runs, builds, publishes, and verifies the %s example', async (name) => {
    const project = exampleProject(name);
    const config = readFixture(name);
    const options = { ...(config as unknown as DockerPublishOptions), cwd: project.cwd };

    const plan = resolveDockerPublishPlan(options);
    const expectedReferences = name === 'single-image' ? ['registry.example.com/team/app:1.2.3'] : plan.references;
    expect([...plan.references]).toEqual(expectedReferences);
    expect(plan.references.length).toBe(name === 'single-image' ? 1 : 8);

    const neverInvoked = join(project.cwd, 'never-invoked-docker');
    const dryRun = spawnSync(
      process.execPath,
      [buildCli, '--cwd', project.cwd, '--config', project.config, '--docker-executable', neverInvoked, '--dry-run'],
      { encoding: 'utf8' },
    );
    expect(dryRun.status).toBe(0);
    expect(dryRun.stderr).toBe('');
    expect(JSON.parse(dryRun.stdout)).toMatchObject({
      operation: 'build',
      dryRun: true,
      references: [...plan.references],
    });

    const platformNames = plan.platforms.map((platform) => platform.name);
    const fake = createFakeRunner(platformNames);
    const built = await buildDockerImages({ ...options, runner: fake.runner });
    expect(built.images.map((entry) => entry.image).sort()).toEqual(
      (config.images as ReadonlyArray<{ readonly name: string }>).map((image) => image.name).sort(),
    );
    for (const call of fake.calls) {
      expect(call.executable).toBe('docker');
      expect(call.args).not.toContain('--push');
    }
    expect(fake.calls.some((call) => call.args[0] === 'buildx' && call.args[1] === 'build')).toBe(true);

    const published = await publishDockerImages({
      ...options,
      runner: fake.runner,
      digestManifestPath: 'digests.json',
    });
    expect(published.publishes.map((entry) => entry.reference)).toEqual([...plan.references].sort());
    for (const entry of published.publishes) {
      expect(entry.digest).toMatch(STRICT_DIGEST_PATTERN);
      expect(entry.digest).toBe(DIGEST);
    }
    const manifest = JSON.parse(readFileSync(join(project.cwd, 'digests.json'), 'utf8')) as Record<string, string>;
    expect(Object.keys(manifest)).toEqual([...plan.references].sort());
    for (const reference of Object.keys(manifest)) {
      expect(manifest[reference]).toBe(DIGEST);
    }
    expect(readdirSync(project.cwd).filter((entry) => entry.includes('.tmp-'))).toEqual([]);

    const expectedDigests: Record<string, string> = {};
    for (const entry of published.publishes) {
      expectedDigests[entry.reference] = entry.digest;
    }
    const verified = await verifyDockerPublish({ ...options, runner: fake.runner, expectedDigests });
    expect(verified.verified).toBe(true);
    expect(verified.references.map((entry) => entry.reference)).toEqual([...plan.references].sort());
    for (const entry of verified.references) {
      expect(entry).toMatchObject({ expectedDigest: DIGEST, observedDigest: DIGEST, match: true });
      expect([...entry.platforms].sort()).toEqual([...platformNames].sort());
    }
    expect(readdirSync(project.cwd).filter((entry) => entry.indexOf('.docker-publish-verify-') === 0)).toEqual([]);
  });
});
