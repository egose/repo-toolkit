import { readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { verifyDockerPublish, type DockerVerifyOptions, type DockerVerifyRunner } from '../src/index';
import { resolveDockerPublishCliOptions } from '../src/cli-options';
import { createScriptedPrompter, resolveInteractiveDockerPublishOptions } from '../src/interactive';
import { resolveDockerPublishPlan } from '../src/plan';
import { DEFAULT_VERIFY_CONCURRENCY } from '../src/verify';
import { createRecordedRunner, DIGEST_A, DIGEST_B, withProject, writeImageContext, type RecordedCall } from './helpers';

const planResolutionCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('../src/plan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/plan')>();
  return {
    ...actual,
    resolveDockerPublishPlan: (options: unknown) => {
      planResolutionCalls.count += 1;
      return actual.resolveDockerPublishPlan(options);
    },
  };
});

const REFERENCE = 'registry.example.com/team/app:1.2.3';
const EXTRA_REFERENCE = 'registry.example.com/team/app:9.9.9';

function listVerificationDirs(root: string): string[] {
  return readdirSync(realpathSync(root)).filter((name) => name.startsWith('.docker-publish-verify-'));
}

function indexManifest(digest: string, platforms: ReadonlyArray<string>): string {
  const manifests = platforms.map((name, position) => {
    const parts = name.split('/');
    const platform: Record<string, string> = { os: parts[0], architecture: parts[1] };
    if (parts.length > 2) {
      platform['variant'] = parts[2];
    }
    return {
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      digest: `sha256:${position.toString(16).padStart(64, '0')}`,
      platform,
    };
  });
  return JSON.stringify({
    mediaType: 'application/vnd.oci.image.index.v1+json',
    digest,
    manifests,
  });
}

function singleManifest(digest: string, platform: string): string {
  const parts = platform.split('/');
  return JSON.stringify({
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    digest,
    config: { mediaType: 'application/vnd.oci.image.config.v1+json', digest: DIGEST_B },
    platform: { os: parts[0], architecture: parts[1] },
  });
}

function baseOptions(root: string, platforms: ReadonlyArray<string>): DockerVerifyOptions {
  return {
    cwd: root,
    images: [{ name: 'app', contextDir: 'services/app' }],
    registries: [{ hostname: 'registry.example.com', repositoryPrefix: 'team' }],
    tags: ['1.2.3'],
    platforms: [...platforms],
    expectedDigests: { [REFERENCE]: DIGEST_A },
  };
}

function createVerifyRunner(
  hooks: {
    readonly manifestFor?: (reference: string) => string;
    readonly failFor?: ReadonlySet<string>;
  } = {},
): { readonly calls: RecordedCall[]; readonly runner: DockerVerifyRunner } {
  return createRecordedRunner({
    onRun: (executable, args) => {
      throw new Error(`unexpected run invocation: ${executable} ${args.join(' ')}`);
    },
    onCapture: (_executable, args) => {
      const reference = args[args.length - 1];
      if (hooks.failFor !== undefined && hooks.failFor.has(reference)) {
        throw new Error('Executable "docker" exited with status 1 (duration 3ms): no such manifest');
      }
      const stdout =
        hooks.manifestFor === undefined
          ? indexManifest(DIGEST_A, ['linux/amd64', 'linux/arm64'])
          : hooks.manifestFor(reference);
      return { stdout, stderr: '', durationMs: 3, outputBytes: Buffer.byteLength(stdout, 'utf8') };
    },
  });
}

function assertManifestOnly(calls: ReadonlyArray<RecordedCall>): void {
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) {
    expect(call.kind).toBe('capture');
    expect(call.args).not.toContain('push');
    expect(call.args).not.toContain('pull');
    expect(call.args).not.toContain('login');
  }
}

describe('verifyDockerPublish', () => {
  it('verifies an exact match and returns structured evidence', () =>
    withProject('docker-publish-verify-', async (root) => {
      writeImageContext(root, 'services/app');
      const { calls, runner } = createVerifyRunner();
      const result = await verifyDockerPublish({ ...baseOptions(root, ['linux/amd64', 'linux/arm64']), runner });
      expect(result.verified).toBe(true);
      expect(result.references).toHaveLength(1);
      const entry = result.references[0];
      expect(entry.reference).toBe(REFERENCE);
      expect(entry.expectedDigest).toBe(DIGEST_A);
      expect(entry.observedDigest).toBe(DIGEST_A);
      expect([...entry.platforms]).toEqual(['linux/amd64', 'linux/arm64']);
      expect(entry.match).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].executable).toBe('docker');
      expect(calls[0].args).toEqual(['buildx', 'imagetools', 'inspect', '--raw', REFERENCE]);
      expect(calls[0].options.cwd).toBe(realpathSync(root));
      expect(calls[0].options.timeoutMs).toBe(600_000);
      expect(calls[0].options.maxOutputBytes).toBe(1_048_576);
      assertManifestOnly(calls);
      expect(listVerificationDirs(root)).toEqual([]);
    }));

  it('verifies a single-image config manifest', () =>
    withProject('docker-publish-verify-', async (root) => {
      writeImageContext(root, 'services/app');
      const { calls, runner } = createVerifyRunner({
        manifestFor: () => singleManifest(DIGEST_A, 'linux/amd64'),
      });
      const result = await verifyDockerPublish({ ...baseOptions(root, ['linux/amd64']), runner });
      expect(result.verified).toBe(true);
      expect(result.references[0].platforms).toEqual(['linux/amd64']);
      expect(result.references[0].match).toBe(true);
      assertManifestOnly(calls);
      expect(listVerificationDirs(root)).toEqual([]);
    }));

  it('fails closed on digest mismatch and case-sensitive differences', () =>
    withProject('docker-publish-verify-', async (root) => {
      writeImageContext(root, 'services/app');
      const mismatched = createVerifyRunner({
        manifestFor: () => indexManifest(DIGEST_B, ['linux/amd64', 'linux/arm64']),
      });
      await expect(
        verifyDockerPublish({ ...baseOptions(root, ['linux/amd64', 'linux/arm64']), runner: mismatched.runner }),
      ).rejects.toThrow(/digest mismatch/);
      expect(listVerificationDirs(root)).toEqual([]);
      const upper = createVerifyRunner({
        manifestFor: () =>
          indexManifest(DIGEST_A, ['linux/amd64', 'linux/arm64']).replace(DIGEST_A, DIGEST_A.toUpperCase()),
      });
      await expect(
        verifyDockerPublish({ ...baseOptions(root, ['linux/amd64', 'linux/arm64']), runner: upper.runner }),
      ).rejects.toThrow(/malformed content digest/);
      expect(listVerificationDirs(root)).toEqual([]);
    }));

  it('fails closed when a reference cannot be inspected', () =>
    withProject('docker-publish-verify-', async (root) => {
      writeImageContext(root, 'services/app');
      const { calls, runner } = createVerifyRunner({ failFor: new Set([REFERENCE]) });
      await expect(
        verifyDockerPublish({ ...baseOptions(root, ['linux/amd64', 'linux/arm64']), runner }),
      ).rejects.toThrow(/manifest inspection failed/);
      expect(calls).toHaveLength(1);
      expect(listVerificationDirs(root)).toEqual([]);
    }));

  it('rejects an additional reference before any runner call', () =>
    withProject('docker-publish-verify-', async (root) => {
      writeImageContext(root, 'services/app');
      const { calls, runner } = createVerifyRunner();
      await expect(
        verifyDockerPublish({
          ...baseOptions(root, ['linux/amd64', 'linux/arm64']),
          runner,
          references: [REFERENCE, EXTRA_REFERENCE],
        }),
      ).rejects.toThrow(/unexpected reference/);
      expect(calls).toHaveLength(0);
      expect(listVerificationDirs(root)).toEqual([]);
    }));

  it('rejects missing references and mismatched digest maps', () =>
    withProject('docker-publish-verify-', async (root) => {
      writeImageContext(root, 'services/app');
      const { calls, runner } = createVerifyRunner();
      const options = baseOptions(root, ['linux/amd64', 'linux/arm64']);
      await expect(verifyDockerPublish({ ...options, runner, references: [] })).rejects.toThrow(
        /missing expected reference/,
      );
      const { expectedDigests: _dropped, ...withoutDigests } = options;
      void _dropped;
      await expect(verifyDockerPublish({ ...withoutDigests, runner })).rejects.toThrow(/expectedDigests is required/);
      await expect(verifyDockerPublish({ ...options, runner, expectedDigests: {} })).rejects.toThrow(
        /missing expected reference/,
      );
      await expect(
        verifyDockerPublish({
          ...options,
          runner,
          expectedDigests: { [REFERENCE]: DIGEST_A, [EXTRA_REFERENCE]: DIGEST_B },
        }),
      ).rejects.toThrow(/unexpected reference/);
      await expect(
        verifyDockerPublish({ ...options, runner, expectedDigests: { [REFERENCE]: 'SHA256:ZZZ' } }),
      ).rejects.toThrow(/strict lowercase sha256 digest/);
      expect(calls).toHaveLength(0);
      expect(listVerificationDirs(root)).toEqual([]);
    }));

  it('fails closed on a platform subset', () =>
    withProject('docker-publish-verify-', async (root) => {
      writeImageContext(root, 'services/app');
      const { runner } = createVerifyRunner({
        manifestFor: () => indexManifest(DIGEST_A, ['linux/amd64']),
      });
      await expect(
        verifyDockerPublish({ ...baseOptions(root, ['linux/amd64', 'linux/arm64']), runner }),
      ).rejects.toThrow(/missing expected platform\(s\): linux\/arm64/);
      expect(listVerificationDirs(root)).toEqual([]);
    }));

  it('fails closed on a platform superset', () =>
    withProject('docker-publish-verify-', async (root) => {
      writeImageContext(root, 'services/app');
      const { runner } = createVerifyRunner({
        manifestFor: () => indexManifest(DIGEST_A, ['linux/amd64', 'linux/arm64', 'linux/s390x']),
      });
      await expect(
        verifyDockerPublish({ ...baseOptions(root, ['linux/amd64', 'linux/arm64']), runner }),
      ).rejects.toThrow(/unexpected platform\(s\): linux\/s390x/);
      expect(listVerificationDirs(root)).toEqual([]);
    }));

  it('fails closed on malformed JSON', () =>
    withProject('docker-publish-verify-', async (root) => {
      writeImageContext(root, 'services/app');
      const { runner } = createVerifyRunner({ manifestFor: () => 'not json {' });
      await expect(
        verifyDockerPublish({ ...baseOptions(root, ['linux/amd64', 'linux/arm64']), runner }),
      ).rejects.toThrow(/not valid JSON/);
      expect(listVerificationDirs(root)).toEqual([]);
    }));

  it('fails closed on manifests missing required fields', () =>
    withProject('docker-publish-verify-', async (root) => {
      writeImageContext(root, 'services/app');
      const platforms = ['linux/amd64', 'linux/arm64'];
      const payloads: ReadonlyArray<string> = [
        '{}',
        JSON.stringify({ mediaType: 'application/vnd.oci.image.index.v1+json' }),
        JSON.stringify({ mediaType: 'application/vnd.oci.image.index.v1+json', digest: 'sha256:xyz' }),
        JSON.stringify({
          mediaType: 'application/vnd.oci.image.index.v1+json',
          digest: DIGEST_A,
          manifests: [],
        }),
        JSON.stringify({
          mediaType: 'application/vnd.oci.image.index.v1+json',
          digest: DIGEST_A,
        }),
        JSON.stringify({
          mediaType: 'application/vnd.oci.image.index.v1+json',
          digest: DIGEST_A,
          manifests: [{ digest: DIGEST_B }],
        }),
      ];
      for (const payload of payloads) {
        const { runner } = createVerifyRunner({ manifestFor: () => payload });
        await expect(verifyDockerPublish({ ...baseOptions(root, platforms), runner })).rejects.toThrow(
          /Verification failed for Docker reference/,
        );
        expect(listVerificationDirs(root)).toEqual([]);
      }
    }));

  it('fails closed on oversized manifests', () =>
    withProject('docker-publish-verify-', async (root) => {
      writeImageContext(root, 'services/app');
      const { calls, runner } = createVerifyRunner();
      await expect(
        verifyDockerPublish({ ...baseOptions(root, ['linux/amd64', 'linux/arm64']), runner, maxManifestBytes: 32 }),
      ).rejects.toThrow(/exceeds the 32-byte bound/);
      expect(calls).toHaveLength(1);
      expect(listVerificationDirs(root)).toEqual([]);
      await expect(
        verifyDockerPublish({ ...baseOptions(root, ['linux/amd64', 'linux/arm64']), runner, maxManifestBytes: 0 }),
      ).rejects.toThrow(/positive safe integer/);
      expect(listVerificationDirs(root)).toEqual([]);
    }));

  it('rejects pull requests and performs zero pushes or pulls by default', () =>
    withProject('docker-publish-verify-', async (root) => {
      writeImageContext(root, 'services/app');
      const { calls, runner } = createVerifyRunner();
      await expect(
        verifyDockerPublish({ ...baseOptions(root, ['linux/amd64', 'linux/arm64']), runner, pull: true }),
      ).rejects.toThrow(/manifest-only inspection/);
      expect(calls).toHaveLength(0);
      await verifyDockerPublish({ ...baseOptions(root, ['linux/amd64', 'linux/arm64']), runner });
      assertManifestOnly(calls);
      expect(listVerificationDirs(root)).toEqual([]);
    }));

  it('refuses to verify when the plan disables verification', () =>
    withProject('docker-publish-verify-', async (root) => {
      writeImageContext(root, 'services/app');
      const { calls, runner } = createVerifyRunner();
      await expect(
        verifyDockerPublish({
          ...baseOptions(root, ['linux/amd64', 'linux/arm64']),
          verification: { enabled: false },
          runner,
        }),
      ).rejects.toThrow(/verification\.enabled is false/);
      expect(calls).toHaveLength(0);
      expect(listVerificationDirs(root)).toEqual([]);
    }));
});

describe('plan-once CLI resolution (REV-10)', () => {
  function writeCliConfig(root: string, images: ReadonlyArray<{ name: string; contextDir: string }>): string {
    for (const image of images) {
      writeImageContext(root, image.contextDir);
    }
    const configPath = join(root, 'docker-publish.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        cwd: root,
        images: images.map((image) => ({ name: image.name, contextDir: image.contextDir })),
        registries: [{ hostname: 'registry.example.com', repositoryPrefix: 'team' }],
        tags: ['1.2.3'],
        platforms: ['linux/amd64'],
      }),
    );
    return configPath;
  }

  it('resolves the non-interactive plan with a single plan resolution pass', () =>
    withProject('docker-publish-verify-', async (root) => {
      const config = writeCliConfig(root, [
        { name: 'app', contextDir: 'services/app' },
        { name: 'worker', contextDir: 'services/worker' },
      ]);
      planResolutionCalls.count = 0;
      const resolved = await resolveDockerPublishCliOptions(
        { values: { config }, repeat: {}, unknown: [] },
        { images: ['worker'] },
      );
      expect(planResolutionCalls.count).toBe(1);
      expect(resolved.plan.images.map((image) => image.name)).toEqual(['worker']);
      expect(resolved.plan.references).toEqual(['registry.example.com/team/worker:1.2.3']);
      expect(resolved.plan).toEqual(resolveDockerPublishPlan(resolved.options));
    }));

  it('resolves the interactive plan with a single plan resolution pass', () =>
    withProject('docker-publish-verify-', async (root) => {
      const config = writeCliConfig(root, [{ name: 'app', contextDir: 'services/app' }]);
      const expected = await resolveDockerPublishCliOptions({ values: { config }, repeat: {}, unknown: [] }, {});
      const prompter = createScriptedPrompter(['', '', '', '', false, undefined, '', '', false, '', '', false]);
      planResolutionCalls.count = 0;
      const resolved = await resolveInteractiveDockerPublishOptions(
        { values: { config }, repeat: {}, unknown: [] },
        {},
        { interactive: true, prompter, canPromptNow: true },
      );
      expect(planResolutionCalls.count).toBe(1);
      expect(resolved).toEqual(expected);
    }));
});

describe('bounded parallel verification (REV-10)', () => {
  const PARALLEL_REFS = [
    'registry.example.com/team/app:1.2.3',
    'registry.example.com/team/app:latest',
    'registry.example.com/team/worker:1.2.3',
    'registry.example.com/team/worker:latest',
  ];

  function digestFor(reference: string): string {
    return `sha256:${PARALLEL_REFS.indexOf(reference).toString(16).padStart(64, '0')}`;
  }

  function parallelOptions(root: string): DockerVerifyOptions {
    const expectedDigests: Record<string, string> = {};
    for (const reference of PARALLEL_REFS) {
      expectedDigests[reference] = digestFor(reference);
    }
    return {
      cwd: root,
      images: [
        { name: 'app', contextDir: 'services/app' },
        { name: 'worker', contextDir: 'services/worker' },
      ],
      registries: [{ hostname: 'registry.example.com', repositoryPrefix: 'team' }],
      tags: ['1.2.3', 'latest'],
      platforms: ['linux/amd64'],
      expectedDigests,
    };
  }

  function trackingRunner(root: string, calls: RecordedCall[], peak: { value: number }): DockerVerifyRunner {
    let active = 0;
    return {
      run(executable, args, options) {
        calls.push({ kind: 'run', executable, args: [...args], options });
        throw new Error(`unexpected run invocation: ${executable} ${args.join(' ')}`);
      },
      capture(executable, args, options) {
        calls.push({ kind: 'capture', executable, args: [...args], options });
        expect(listVerificationDirs(root)).toEqual([]);
        const reference = args[args.length - 1];
        active += 1;
        peak.value = Math.max(peak.value, active);
        void Promise.resolve().then(() => {
          active -= 1;
        });
        const stdout = singleManifest(digestFor(reference), 'linux/amd64');
        return { stdout, stderr: '', durationMs: 1, outputBytes: Buffer.byteLength(stdout, 'utf8') };
      },
    };
  }

  it('verifies multiple references with bounded parallelism and byte-identical evidence', () =>
    withProject('docker-publish-verify-', async (root) => {
      writeImageContext(root, 'services/app');
      writeImageContext(root, 'services/worker');
      const calls: RecordedCall[] = [];
      const peak = { value: 0 };
      const runner = trackingRunner(root, calls, peak);
      const result = await verifyDockerPublish({
        ...parallelOptions(root),
        runner,
        references: [...PARALLEL_REFS].reverse(),
      });
      expect(result.verified).toBe(true);
      expect(result.references).toEqual(
        [...PARALLEL_REFS].sort().map((reference) => ({
          reference,
          expectedDigest: digestFor(reference),
          observedDigest: digestFor(reference),
          platforms: ['linux/amd64'],
          match: true,
        })),
      );
      expect(peak.value).toBe(Math.min(DEFAULT_VERIFY_CONCURRENCY, PARALLEL_REFS.length));
      expect(calls).toHaveLength(PARALLEL_REFS.length);
      assertManifestOnly(calls);
      expect(listVerificationDirs(root)).toEqual([]);
    }));

  it('keeps peak concurrency within the documented bound at scale', () =>
    withProject('docker-publish-verify-', async (root) => {
      writeImageContext(root, 'services/app');
      writeImageContext(root, 'services/worker');
      const refs: string[] = [];
      for (const image of ['app', 'worker']) {
        for (const tag of ['1.0.0', '1.0.1', '1.0.2', '1.0.3']) {
          refs.push(`registry.example.com/team/${image}:${tag}`);
        }
      }
      const digests: Record<string, string> = {};
      refs.forEach((reference, index) => {
        digests[reference] = `sha256:${index.toString(16).padStart(64, '0')}`;
      });
      const calls: RecordedCall[] = [];
      let active = 0;
      const peak = { value: 0 };
      const runner: DockerVerifyRunner = {
        run(executable, args, options) {
          calls.push({ kind: 'run', executable, args: [...args], options });
          throw new Error(`unexpected run invocation: ${executable} ${args.join(' ')}`);
        },
        capture(executable, args, options) {
          calls.push({ kind: 'capture', executable, args: [...args], options });
          expect(listVerificationDirs(root)).toEqual([]);
          const reference = args[args.length - 1];
          active += 1;
          peak.value = Math.max(peak.value, active);
          void Promise.resolve().then(() => {
            active -= 1;
          });
          const stdout = singleManifest(digests[reference], 'linux/amd64');
          return { stdout, stderr: '', durationMs: 1, outputBytes: Buffer.byteLength(stdout, 'utf8') };
        },
      };
      const result = await verifyDockerPublish({
        cwd: root,
        images: [
          { name: 'app', contextDir: 'services/app' },
          { name: 'worker', contextDir: 'services/worker' },
        ],
        registries: [{ hostname: 'registry.example.com', repositoryPrefix: 'team' }],
        tags: ['1.0.0', '1.0.1', '1.0.2', '1.0.3'],
        platforms: ['linux/amd64'],
        expectedDigests: digests,
        runner,
      });
      expect(result.verified).toBe(true);
      expect(result.references.map((entry) => entry.reference)).toEqual([...refs].sort());
      expect(peak.value).toBeLessThanOrEqual(DEFAULT_VERIFY_CONCURRENCY);
      expect(peak.value).toBeGreaterThan(1);
      expect(calls).toHaveLength(refs.length);
      assertManifestOnly(calls);
      expect(listVerificationDirs(root)).toEqual([]);
    }));
});
