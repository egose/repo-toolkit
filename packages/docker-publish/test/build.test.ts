import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { redactSensitiveValues } from '@repo-toolkit/publish-package';

import {
  buildDockerImages,
  publishDockerImages,
  resolveDockerPublishPlan,
  type DockerBuildRunner,
  type DockerPublishOptions,
} from '../src/index';
import { createRecordedRunner, withProject, writeImageContext, type RecordedCall } from './helpers';

const packageRoot = resolve(import.meta.dirname, '..');

function snapshotTree(root: string): Map<string, string> {
  const entries = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const rel = relative(root, full);
      const stats = lstatSync(full);
      if (stats.isDirectory()) {
        entries.set(`${rel}/`, 'dir');
        walk(full);
      } else if (stats.isFile()) {
        entries.set(rel, readFileSync(full, 'utf8'));
      }
    }
  };
  walk(root);
  return entries;
}

function defaultImagesStdout(references: ReadonlyArray<string>): string {
  if (references.length === 0) {
    return '';
  }
  return `${references.map((reference, index) => `${reference} sha256:fake-image-id-${index}`).join('\n')}\n`;
}

function createSyncRunner(
  hooks: {
    readonly failContexts?: ReadonlySet<string>;
    readonly captureStdout?: (references: ReadonlyArray<string>) => string;
  } = {},
): { readonly calls: RecordedCall[]; readonly runner: DockerBuildRunner } {
  return createRecordedRunner({
    onRun: (_executable, args) => {
      if (args[0] === 'rmi') {
        return { durationMs: 0 };
      }
      const context = args[args.length - 1];
      if (hooks.failContexts !== undefined && hooks.failContexts.has(context)) {
        throw new Error(
          `Executable "docker" exited with status 1 (duration 5ms): failing build output tail for ${context}`,
        );
      }
      return { durationMs: 5 };
    },
    onCapture: (_executable, args) => {
      const references = args.slice(4);
      const stdout =
        hooks.captureStdout === undefined ? defaultImagesStdout(references) : hooks.captureStdout(references);
      return { stdout, stderr: '', durationMs: 3, outputBytes: Buffer.byteLength(stdout, 'utf8') };
    },
  });
}

function singleImageOptions(root: string): DockerPublishOptions {
  return {
    cwd: root,
    images: [{ name: 'app', contextDir: 'services/app' }],
    registries: [{ hostname: 'registry.example.com', repositoryPrefix: 'team' }],
    tags: ['1.2.3'],
    platforms: ['linux/amd64'],
  };
}

describe('buildDockerImages single-platform', () => {
  it('builds with --load, verifies local IDs, and leaves fixtures unchanged', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const base = singleImageOptions(root);
      const plan = resolveDockerPublishPlan(base);
      const before = snapshotTree(root);
      const { calls, runner } = createSyncRunner();
      const result = await buildDockerImages({ ...base, runner });
      expect(snapshotTree(root)).toEqual(before);

      const reference = 'registry.example.com/team/app:1.2.3';
      const builds = calls.filter((call) => call.kind === 'run' && call.args[0] === 'buildx');
      const captures = calls.filter((call) => call.kind === 'capture');
      const untags = calls.filter((call) => call.kind === 'run' && call.args[0] === 'rmi');
      expect(builds.length).toBe(1);
      expect(captures.length).toBe(1);
      expect(untags.length).toBe(0);

      expect(builds[0].executable).toBe('docker');
      expect(builds[0].args).toEqual([
        'buildx',
        'build',
        '--platform',
        'linux/amd64',
        '-f',
        plan.images[0].resolvedDockerfile,
        '-t',
        reference,
        '--load',
        plan.images[0].resolvedContextDir,
      ]);
      expect(builds[0].options.cwd).toBe(plan.cwd);
      expect(builds[0].options.env).toBeUndefined();
      expect(builds[0].options.timeoutMs).toBe(plan.processLimits.timeoutMs);
      expect(builds[0].options.maxOutputBytes).toBe(plan.processLimits.maxOutputBytes);

      expect(captures[0].executable).toBe('docker');
      expect(captures[0].args).toEqual([
        'images',
        '--no-trunc',
        '--format',
        '{{.Repository}}:{{.Tag}} {{.ID}}',
        reference,
      ]);
      expect(captures[0].options.cwd).toBe(plan.cwd);
      expect(captures[0].options.env).toBeUndefined();

      expect(result.images.length).toBe(1);
      expect(result.images[0].image).toBe('app');
      expect(result.images[0].references).toEqual([reference]);
      expect(result.images[0].platforms).toEqual(['linux/amd64']);
      expect(result.images[0].imageIds).toEqual({ [reference]: 'sha256:fake-image-id-0' });
      expect(result.images[0].durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('buildDockerImages multi-image multi-platform', () => {
  it('joins platforms, tags every reference, and skips --load without verification', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/api');
      writeImageContext(root, 'services/worker', 'Dockerfile.prod');
      const base: DockerPublishOptions = {
        cwd: root,
        images: [
          {
            name: 'api',
            contextDir: 'services/api',
            target: 'runtime',
            buildArgs: { LOG_LEVEL: 'info', SHARED: 'image' },
            labels: { 'org.example.component': 'api' },
          },
          {
            name: 'worker',
            contextDir: 'services/worker',
            dockerfile: 'services/worker/Dockerfile.prod',
          },
        ],
        registries: [{ hostname: 'registry.example.com', repositoryPrefix: 'team' }, { hostname: 'localhost:5000' }],
        tags: ['2.0.0', '2.0'],
        platforms: ['linux/amd64', 'linux/arm64'],
        buildArgs: { GLOBAL_ARG: 'g', SHARED: 'global' },
        labels: { 'org.example.team': 'core' },
        buildConcurrency: 2,
      };
      const plan = resolveDockerPublishPlan(base);
      const { calls, runner } = createSyncRunner();
      const result = await buildDockerImages({ ...base, runner });

      expect(calls.filter((call) => call.kind === 'capture').length).toBe(0);
      expect(calls.filter((call) => call.kind === 'run' && call.args[0] === 'rmi').length).toBe(0);
      const builds = calls.filter((call) => call.kind === 'run' && call.args[0] === 'buildx');
      expect(builds.length).toBe(2);

      const apiRefs = [
        'registry.example.com/team/api:2.0.0',
        'registry.example.com/team/api:2.0',
        'localhost:5000/api:2.0.0',
        'localhost:5000/api:2.0',
      ];
      const api = builds.filter((call) => call.args.indexOf(plan.images[0].resolvedContextDir) >= 0);
      expect(api.length).toBe(1);
      const apiTags: string[] = [];
      for (let index = 0; index < api[0].args.length; index += 1) {
        if (api[0].args[index] === '-t') {
          apiTags.push(api[0].args[index + 1]);
        }
      }
      expect(apiTags).toEqual(apiRefs);
      expect(api[0].args).toEqual([
        'buildx',
        'build',
        '--platform',
        'linux/amd64,linux/arm64',
        '-f',
        plan.images[0].resolvedDockerfile,
        '--target',
        'runtime',
        '-t',
        apiRefs[0],
        '-t',
        apiRefs[1],
        '-t',
        apiRefs[2],
        '-t',
        apiRefs[3],
        '--build-arg',
        'GLOBAL_ARG=g',
        '--build-arg',
        'LOG_LEVEL=info',
        '--build-arg',
        'SHARED=image',
        '--label',
        'org.example.component=api',
        '--label',
        'org.example.team=core',
        plan.images[0].resolvedContextDir,
      ]);

      const worker = builds.filter((call) => call.args.indexOf(plan.images[1].resolvedContextDir) >= 0);
      expect(worker.length).toBe(1);
      expect(worker[0].args).toEqual([
        'buildx',
        'build',
        '--platform',
        'linux/amd64,linux/arm64',
        '-f',
        plan.images[1].resolvedDockerfile,
        '-t',
        'registry.example.com/team/worker:2.0.0',
        '-t',
        'registry.example.com/team/worker:2.0',
        '-t',
        'localhost:5000/worker:2.0.0',
        '-t',
        'localhost:5000/worker:2.0',
        '--build-arg',
        'GLOBAL_ARG=g',
        '--build-arg',
        'SHARED=global',
        '--label',
        'org.example.team=core',
        plan.images[1].resolvedContextDir,
      ]);

      expect(result.images.length).toBe(2);
      expect(result.images[0].image).toBe('api');
      expect(result.images[0].imageIds).toEqual({});
      expect(result.images[1].image).toBe('worker');
      expect(result.images[1].imageIds).toEqual({});
    });
  });
});

describe('build path never publishes', () => {
  it('contains no --push in any recorded argv or in the build module source', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      writeImageContext(root, 'services/other');
      const { calls, runner } = createSyncRunner();
      await buildDockerImages({
        cwd: root,
        images: [
          { name: 'app', contextDir: 'services/app' },
          { name: 'other', contextDir: 'services/other' },
        ],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64', 'linux/arm64'],
        runner,
      });
      for (const call of calls) {
        expect(call.args).not.toContain('--push');
      }
      const source = readFileSync(join(packageRoot, 'src', 'build.ts'), 'utf8');
      expect(source).not.toContain('--push');
      expect(source).not.toContain('child_process');
      expect(source).not.toContain('process.exit');
      expect(source).toContain('node:fs');
      expect(source).toContain('buildx');
    });
  });
});

describe('build failure handling', () => {
  it('stops scheduling, untags the failed image, and surfaces image identity', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/api');
      writeImageContext(root, 'services/worker');
      const base: DockerPublishOptions = {
        cwd: root,
        images: [
          { name: 'api', contextDir: 'services/api' },
          { name: 'worker', contextDir: 'services/worker' },
        ],
        registries: [{ hostname: 'registry.example.com', repositoryPrefix: 'team' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64'],
        buildConcurrency: 1,
      };
      const plan = resolveDockerPublishPlan(base);
      const { calls, runner } = createSyncRunner({
        failContexts: new Set([plan.images[0].resolvedContextDir]),
      });
      const failure = await buildDockerImages({ ...base, runner }).then(
        () => {
          throw new Error('expected the build to fail');
        },
        (error: unknown) => error as Error,
      );
      expect(failure.message).toContain('"api"');
      expect(failure.message).toContain('linux/amd64');
      expect(failure.message).toContain('failing build output tail');

      const builds = calls.filter((call) => call.kind === 'run' && call.args[0] === 'buildx');
      expect(builds.length).toBe(1);
      expect(builds[0].args[builds[0].args.length - 1]).toBe(plan.images[0].resolvedContextDir);

      const untags = calls.filter((call) => call.kind === 'run' && call.args[0] === 'rmi');
      expect(untags.length).toBe(1);
      expect(untags[0].executable).toBe('docker');
      expect(untags[0].args).toEqual(['rmi', ...plan.images[0].references]);
      expect(untags[0].options.cwd).toBe(plan.cwd);
    });
  });

  it('rejects invalid options before invoking any process', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const { calls, runner } = createSyncRunner();
      await expect(
        buildDockerImages({ cwd: root, runner } as unknown as DockerPublishOptions & { runner: DockerBuildRunner }),
      ).rejects.toThrow();
      expect(calls.length).toBe(0);
    });
  });
});

describe('local image verification', () => {
  async function verifyWithStdout(root: string, stdout: string): Promise<{ error: Error; untags: RecordedCall[] }> {
    writeImageContext(root, 'services/app');
    const base = singleImageOptions(root);
    const { calls, runner } = createSyncRunner({ captureStdout: () => stdout });
    const error = await buildDockerImages({ ...base, runner }).then(
      () => {
        throw new Error('expected verification to fail');
      },
      (caught: unknown) => caught as Error,
    );
    return { error, untags: calls.filter((call) => call.kind === 'run' && call.args[0] === 'rmi') };
  }

  it('rejects empty verification output and untags', async () => {
    await withProject('docker-publish-build-', async (root) => {
      const { error, untags } = await verifyWithStdout(root, '');
      expect(error.message).toContain('"app"');
      expect(error.message).toContain('missing local image for reference');
      expect(untags.length).toBe(1);
    });
  });

  it('rejects a missing reference among several tags and untags', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const base: DockerPublishOptions = {
        cwd: root,
        images: [{ name: 'app', contextDir: 'services/app' }],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0', '2.0.0'],
        platforms: ['linux/amd64'],
      };
      const { calls, runner } = createSyncRunner({
        captureStdout: () => 'registry.example.com/app:1.0.0 sha256:fake-image-id-0\n',
      });
      const error = await buildDockerImages({ ...base, runner }).then(
        () => {
          throw new Error('expected verification to fail');
        },
        (caught: unknown) => caught as Error,
      );
      expect(error.message).toContain('missing local image for reference: registry.example.com/app:2.0.0');
      expect(calls.filter((call) => call.kind === 'run' && call.args[0] === 'rmi').length).toBe(1);
    });
  });

  it('rejects unexpected local tags and untags', async () => {
    await withProject('docker-publish-build-', async (root) => {
      const { error, untags } = await verifyWithStdout(
        root,
        'registry.example.com/team/app:1.2.3 sha256:fake-image-id-0\nregistry.example.com/team/other:9.9.9 sha256:zzz\n',
      );
      expect(error.message).toContain('unexpected local tag: registry.example.com/team/other:9.9.9');
      expect(untags.length).toBe(1);
    });
  });

  it('rejects malformed verification lines and untags', async () => {
    await withProject('docker-publish-build-', async (root) => {
      const { error, untags } = await verifyWithStdout(root, 'not-a-verification-line\n');
      expect(error.message).toContain('unexpected local tag entry');
      expect(untags.length).toBe(1);
    });
  });

  it('rejects conflicting image IDs for the same reference and untags', async () => {
    await withProject('docker-publish-build-', async (root) => {
      const { error, untags } = await verifyWithStdout(
        root,
        'registry.example.com/team/app:1.2.3 sha256:aaa\nregistry.example.com/team/app:1.2.3 sha256:bbb\n',
      );
      expect(error.message).toContain('conflicting local image IDs');
      expect(untags.length).toBe(1);
    });
  });
});

describe('argv preservation', () => {
  it('keeps spaces and special characters as exact argv entries', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/my app');
      const base: DockerPublishOptions = {
        cwd: root,
        images: [
          {
            name: 'app',
            contextDir: 'services/my app',
            buildArgs: {
              EMPTY_OK: '',
              EQ: 'a=b=c',
              GREETING: 'hello world',
              SEMICOLON: 'one;two',
              SPECIAL: '$HOME `echo hi` "quoted" \'single\' \\ backslash $(touch probe)',
            },
            labels: { 'org.example.note': 'value with spaces' },
          },
        ],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64'],
      };
      const plan = resolveDockerPublishPlan(base);
      const { calls, runner } = createSyncRunner();
      const result = await buildDockerImages({ ...base, runner });
      const builds = calls.filter((call) => call.kind === 'run' && call.args[0] === 'buildx');
      expect(builds.length).toBe(1);
      expect(builds[0].args).toEqual([
        'buildx',
        'build',
        '--platform',
        'linux/amd64',
        '-f',
        plan.images[0].resolvedDockerfile,
        '-t',
        'registry.example.com/app:1.0.0',
        '--build-arg',
        'EMPTY_OK=',
        '--build-arg',
        'EQ=a=b=c',
        '--build-arg',
        'GREETING=hello world',
        '--build-arg',
        'SEMICOLON=one;two',
        '--build-arg',
        'SPECIAL=$HOME `echo hi` "quoted" \'single\' \\ backslash $(touch probe)',
        '--label',
        'org.example.note=value with spaces',
        '--load',
        plan.images[0].resolvedContextDir,
      ]);
      expect(plan.images[0].resolvedContextDir).toBe(join(realpathSync(root), 'services', 'my app'));
      expect(result.images[0].imageIds).toEqual({
        'registry.example.com/app:1.0.0': 'sha256:fake-image-id-0',
      });
    });
  });
});

describe('bounded concurrency', () => {
  interface PendingBuild {
    readonly context: string;
    resolve(value: { readonly durationMs: number }): void;
    reject(error: Error): void;
  }

  function createDeferredRunner(): {
    readonly calls: RecordedCall[];
    readonly pending: Map<string, PendingBuild>;
    readonly started: string[];
    maxActive(): number;
    readonly runner: DockerBuildRunner;
  } {
    const calls: RecordedCall[] = [];
    const pending = new Map<string, PendingBuild>();
    const started: string[] = [];
    let active = 0;
    let peak = 0;
    const runner: DockerBuildRunner = {
      run(executable, args, options) {
        calls.push({ kind: 'run', executable, args: [...args], options });
        if (args[0] === 'rmi') {
          return Promise.resolve({ durationMs: 0 });
        }
        const context = args[args.length - 1];
        active += 1;
        if (active > peak) {
          peak = active;
        }
        started.push(context);
        return new Promise<{ durationMs: number }>((resolve, reject) => {
          pending.set(context, {
            context,
            resolve: (value) => {
              active -= 1;
              resolve(value);
            },
            reject: (error) => {
              active -= 1;
              reject(error);
            },
          });
        });
      },
      capture() {
        throw new Error('capture must not be called for multi-platform builds');
      },
    };
    return { calls, pending, started, maxActive: () => peak, runner };
  }

  function tick(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  function multiImageBase(root: string, count: number): DockerPublishOptions {
    for (let index = 0; index < count; index += 1) {
      writeImageContext(root, `services/img${index}`);
    }
    return {
      cwd: root,
      images: Array.from({ length: count }, (_, index) => ({
        name: `img${index}`,
        contextDir: `services/img${index}`,
      })),
      registries: [{ hostname: 'registry.example.com' }],
      tags: ['1.0.0'],
      platforms: ['linux/amd64', 'linux/arm64'],
      buildConcurrency: 2,
    };
  }

  it('never exceeds the configured bound across four images', async () => {
    await withProject('docker-publish-build-', async (root) => {
      const base = multiImageBase(root, 4);
      const plan = resolveDockerPublishPlan(base);
      const contexts = plan.images.map((image) => image.resolvedContextDir);
      const deferred = createDeferredRunner();
      const promise = buildDockerImages({ ...base, runner: deferred.runner });
      await tick();
      expect(deferred.started.length).toBe(2);
      expect(deferred.maxActive()).toBeLessThanOrEqual(2);

      for (const context of contexts) {
        while (!deferred.pending.has(context)) {
          await tick();
        }
        deferred.pending.get(context)?.resolve({ durationMs: 1 });
        await tick();
        expect(deferred.maxActive()).toBeLessThanOrEqual(2);
      }
      const result = await promise;
      expect(result.images.length).toBe(4);
      expect(deferred.calls.filter((call) => call.kind === 'run' && call.args[0] === 'buildx').length).toBe(4);
      expect(deferred.calls.filter((call) => call.kind === 'run' && call.args[0] === 'rmi').length).toBe(0);
      for (const entry of result.images) {
        expect(entry.imageIds).toEqual({});
      }
    });
  });

  it('starts no new build after a known failure', async () => {
    await withProject('docker-publish-build-', async (root) => {
      const base = multiImageBase(root, 3);
      const plan = resolveDockerPublishPlan(base);
      const contexts = plan.images.map((image) => image.resolvedContextDir);
      const deferred = createDeferredRunner();
      const settlement = buildDockerImages({ ...base, runner: deferred.runner }).then(
        () => {
          throw new Error('expected the build to fail');
        },
        (error: unknown) => error as Error,
      );
      await tick();
      expect(deferred.started.length).toBe(2);

      while (!deferred.pending.has(contexts[1])) {
        await tick();
      }
      deferred.pending.get(contexts[1])?.reject(new Error('boom output tail marker'));
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (deferred.calls.some((call) => call.kind === 'run' && call.args[0] === 'rmi')) {
          break;
        }
        await tick();
      }
      await tick();
      await tick();
      deferred.pending.get(contexts[0])?.resolve({ durationMs: 1 });
      const failure = await settlement;
      expect(failure.message).toContain('boom output tail marker');
      expect(failure.message).toContain('"img1"');
      expect(failure.message).toContain('linux/amd64, linux/arm64');
      const buildContexts = deferred.calls
        .filter((call) => call.kind === 'run' && call.args[0] === 'buildx')
        .map((call) => call.args[call.args.length - 1]);
      expect(buildContexts).not.toContain(contexts[2]);
      const untags = deferred.calls.filter((call) => call.kind === 'run' && call.args[0] === 'rmi');
      expect(untags.length).toBe(1);
      expect(untags[0].args).toEqual(['rmi', ...plan.images[1].references]);
    });
  });
});

describe('context trust re-validation', () => {
  it('fails closed when a context is swapped for a symlink between resolution and spawn', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/img0');
      writeImageContext(root, 'services/img1');
      const outside = mkdtempSync(join(tmpdir(), 'docker-publish-outside-'));
      try {
        writeFileSync(join(outside, 'Dockerfile'), 'FROM scratch\n');
        writeFileSync(join(outside, 'canary.txt'), 'OUTSIDE-CANARY\n');
        const base: DockerPublishOptions = {
          cwd: root,
          images: [
            { name: 'img0', contextDir: 'services/img0' },
            { name: 'img1', contextDir: 'services/img1' },
          ],
          registries: [{ hostname: 'registry.example.com' }],
          tags: ['1.0.0'],
          platforms: ['linux/amd64', 'linux/arm64'],
          buildConcurrency: 2,
        };
        const plan = resolveDockerPublishPlan(base);
        const staleContext = plan.images[1].resolvedContextDir;
        const calls: RecordedCall[] = [];
        let swapped = false;
        const runner: DockerBuildRunner = {
          run(executable, args, options) {
            calls.push({ kind: 'run', executable, args: [...args], options });
            if (args[0] === 'rmi') {
              return { durationMs: 0 };
            }
            if (!swapped) {
              swapped = true;
              rmSync(join(root, 'services/img1'), { recursive: true, force: true });
              symlinkSync(outside, join(root, 'services/img1'), 'dir');
            }
            return { durationMs: 1 };
          },
          capture() {
            throw new Error('capture must not be called for multi-platform builds');
          },
        };
        const failure = await buildDockerImages({ ...base, runner }).then(
          () => {
            throw new Error('expected the build to fail');
          },
          (error: unknown) => error as Error,
        );
        expect(failure.message).toContain('"img1"');
        expect(failure.message).toMatch(/changed since plan resolution|escapes the project root/);
        const builds = calls.filter((call) => call.kind === 'run' && call.args[0] === 'buildx');
        expect(builds.length).toBe(1);
        for (const call of builds) {
          expect(call.args).not.toContain(staleContext);
        }
        expect(readFileSync(join(outside, 'canary.txt'), 'utf8')).toBe('OUTSIDE-CANARY\n');
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });
});

describe('secret build-arg and label redaction', () => {
  const NPM_CANARY = 'canary-npm-token-REV01-9f3a7d';
  const LABEL_CANARY = 'canary-label-password-REV01-4b1e62';

  function secretBase(root: string): DockerPublishOptions {
    return {
      cwd: root,
      images: [
        {
          name: 'app',
          contextDir: 'services/app',
          buildArgs: { NPM_TOKEN: NPM_CANARY },
          labels: { 'org.example.admin-password': LABEL_CANARY },
        },
      ],
      registries: [{ hostname: 'registry.example.com' }],
      tags: ['1.0.0'],
      platforms: ['linux/amd64'],
      buildArgs: { GLOBAL_SECRET: 'canary-global-secret-REV01-77aa' },
      allowSecretsInBuildArgs: true,
    };
  }

  it('passes merged secret values as runner secrets and redacts the build failure', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const base = secretBase(root);
      const globalSecret = base.buildArgs?.['GLOBAL_SECRET'] as string;
      const calls: RecordedCall[] = [];
      const runner: DockerBuildRunner = {
        run(executable, args, options) {
          calls.push({ kind: 'run', executable, args: [...args], options });
          if (args[0] === 'rmi') {
            return { durationMs: 0 };
          }
          throw new Error(`daemon echoed ${NPM_CANARY} and ${LABEL_CANARY} and ${globalSecret}`);
        },
        capture(executable, args, options) {
          calls.push({ kind: 'capture', executable, args: [...args], options });
          return { stdout: '', stderr: '', durationMs: 0, outputBytes: 0 };
        },
      };
      const failure = await buildDockerImages({ ...base, runner }).then(
        () => {
          throw new Error('expected the build to fail');
        },
        (error: unknown) => error as Error,
      );
      expect(failure.message).toContain('"app"');
      expect(failure.message).toContain('linux/amd64');
      expect(failure.message).not.toContain(NPM_CANARY);
      expect(failure.message).not.toContain(LABEL_CANARY);
      expect(failure.message).not.toContain(globalSecret);

      const builds = calls.filter((call) => call.kind === 'run' && call.args[0] === 'buildx');
      expect(builds.length).toBe(1);
      const runSecrets = (builds[0].options.secrets ?? []) as ReadonlyArray<string>;
      expect(runSecrets).toContain(NPM_CANARY);
      expect(runSecrets).toContain(LABEL_CANARY);
      expect(runSecrets).toContain(globalSecret);
      expect(builds[0].args).toContain(`NPM_TOKEN=${NPM_CANARY}`);
      const scrubbedArgv = redactSensitiveValues(builds[0].args.join('\n'), runSecrets);
      expect(scrubbedArgv).not.toContain(NPM_CANARY);
      expect(scrubbedArgv).not.toContain(LABEL_CANARY);
      expect(scrubbedArgv).not.toContain(globalSecret);
    });
  });

  it('passes secrets to capture options and redacts verification failures', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const base = secretBase(root);
      const calls: RecordedCall[] = [];
      const runner: DockerBuildRunner = {
        run(executable, args, options) {
          calls.push({ kind: 'run', executable, args: [...args], options });
          return { durationMs: 1 };
        },
        capture(executable, args, options) {
          calls.push({ kind: 'capture', executable, args: [...args], options });
          throw new Error(`inspect echoed ${NPM_CANARY}`);
        },
      };
      const failure = await buildDockerImages({ ...base, runner }).then(
        () => {
          throw new Error('expected verification to fail');
        },
        (error: unknown) => error as Error,
      );
      expect(failure.message).not.toContain(NPM_CANARY);
      const captures = calls.filter((call) => call.kind === 'capture');
      expect(captures.length).toBe(1);
      expect((captures[0].options.secrets ?? []) as ReadonlyArray<string>).toContain(NPM_CANARY);
    });
  });

  it('keeps non-secret failure messages in the exact prior shape', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const base: DockerPublishOptions = {
        cwd: root,
        images: [{ name: 'app', contextDir: 'services/app', buildArgs: { LOG_LEVEL: 'info' } }],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64'],
      };
      const plan = resolveDockerPublishPlan(base);
      const calls: RecordedCall[] = [];
      const runner: DockerBuildRunner = {
        run(executable, args, options) {
          calls.push({ kind: 'run', executable, args: [...args], options });
          if (args[0] === 'rmi') {
            return { durationMs: 0 };
          }
          throw new Error('Executable "docker" exited with status 1 (duration 5ms): plain failure tail');
        },
        capture(executable, args, options) {
          calls.push({ kind: 'capture', executable, args: [...args], options });
          return { stdout: '', stderr: '', durationMs: 0, outputBytes: 0 };
        },
      };
      const failure = await buildDockerImages({ ...base, runner }).then(
        () => {
          throw new Error('expected the build to fail');
        },
        (error: unknown) => error as Error,
      );
      expect(failure.message).toBe(
        `Failed to build Docker image "app" for platforms [linux/amd64]: Executable "docker" exited with status 1 (duration 5ms): plain failure tail`,
      );
      const builds = calls.filter((call) => call.kind === 'run' && call.args[0] === 'buildx');
      expect(builds.length).toBe(1);
      expect(builds[0].args).toEqual([
        'buildx',
        'build',
        '--platform',
        'linux/amd64',
        '-f',
        plan.images[0].resolvedDockerfile,
        '-t',
        'registry.example.com/app:1.0.0',
        '--build-arg',
        'LOG_LEVEL=info',
        '--load',
        plan.images[0].resolvedContextDir,
      ]);
      expect(builds[0].options.secrets ?? []).toEqual([]);
    });
  });
});

describe('annotation argv', () => {
  it('passes merged annotations as sorted --annotation entries with per-image precedence', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const base: DockerPublishOptions = {
        cwd: root,
        images: [
          {
            name: 'app',
            contextDir: 'services/app',
            annotations: { 'z-key': 'image', shared: 'image' },
          },
        ],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64'],
        annotations: { 'a-key': 'global', shared: 'global' },
      };
      const plan = resolveDockerPublishPlan(base);
      const { calls, runner } = createSyncRunner();
      await buildDockerImages({ ...base, runner });
      const builds = calls.filter((call) => call.kind === 'run' && call.args[0] === 'buildx');
      expect(builds.length).toBe(1);
      expect(builds[0].args).toEqual([
        'buildx',
        'build',
        '--platform',
        'linux/amd64',
        '-f',
        plan.images[0].resolvedDockerfile,
        '-t',
        'registry.example.com/app:1.0.0',
        '--annotation',
        'a-key=global',
        '--annotation',
        'shared=image',
        '--annotation',
        'z-key=image',
        '--load',
        plan.images[0].resolvedContextDir,
      ]);
    });
  });

  it('flows buildx qualifier prefixes through as ordinary key characters', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const base: DockerPublishOptions = {
        cwd: root,
        images: [{ name: 'app', contextDir: 'services/app' }],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64'],
        annotations: { 'manifest:org.opencontainers.image.revision': 'abc123' },
      };
      const { calls, runner } = createSyncRunner();
      await buildDockerImages({ ...base, runner });
      const builds = calls.filter((call) => call.kind === 'run' && call.args[0] === 'buildx');
      expect(builds.length).toBe(1);
      expect(builds[0].args).toContain('--annotation');
      expect(builds[0].args).toContain('manifest:org.opencontainers.image.revision=abc123');
    });
  });

  it('rejects merged annotation overflow at build time like buildArgs', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const globalAnnotations: Record<string, string> = {};
      const imageAnnotations: Record<string, string> = {};
      for (let i = 0; i < 40; i += 1) {
        globalAnnotations[`GLOBAL_${i}`] = 'g';
        imageAnnotations[`IMAGE_${i}`] = 'v';
      }
      const base: DockerPublishOptions = {
        cwd: root,
        images: [{ name: 'app', contextDir: 'services/app', annotations: imageAnnotations }],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64'],
        annotations: globalAnnotations,
      };
      const plan = resolveDockerPublishPlan(base);
      expect(Object.keys(plan.annotations).length).toBe(40);
      const { calls, runner } = createSyncRunner();
      const failure = await buildDockerImages({ ...base, runner }).then(
        () => {
          throw new Error('expected the build to fail');
        },
        (error: unknown) => error as Error,
      );
      expect(failure.message).toContain('must not contain more than 64 entries');
      expect(calls.filter((call) => call.kind === 'run' && call.args[0] === 'buildx').length).toBe(0);
      expect(calls.length).toBe(0);
    });
  });

  it('rejects secret-like annotation keys at plan time before invoking any process', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const base: DockerPublishOptions = {
        cwd: root,
        images: [{ name: 'app', contextDir: 'services/app' }],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64'],
        annotations: { API_TOKEN: 'x' },
      };
      const { calls, runner } = createSyncRunner();
      await expect(buildDockerImages({ ...base, runner })).rejects.toThrow('looks like a secret');
      expect(calls.length).toBe(0);
    });
  });
});

describe('secret annotation redaction', () => {
  const ANNOTATION_CANARY = 'canary-annotation-token-PAR01-7c2e91';

  function secretAnnotationBase(root: string): DockerPublishOptions {
    return {
      cwd: root,
      images: [
        {
          name: 'app',
          contextDir: 'services/app',
          annotations: { 'org.example.api-token': ANNOTATION_CANARY },
        },
      ],
      registries: [{ hostname: 'registry.example.com' }],
      tags: ['1.0.0'],
      platforms: ['linux/amd64'],
      allowSecretsInBuildArgs: true,
    };
  }

  it('passes secret annotation values as runner secrets and redacts the build failure', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const base = secretAnnotationBase(root);
      const calls: RecordedCall[] = [];
      const runner: DockerBuildRunner = {
        run(executable, args, options) {
          calls.push({ kind: 'run', executable, args: [...args], options });
          if (args[0] === 'rmi') {
            return { durationMs: 0 };
          }
          throw new Error(`daemon echoed ${ANNOTATION_CANARY}`);
        },
        capture(executable, args, options) {
          calls.push({ kind: 'capture', executable, args: [...args], options });
          return { stdout: '', stderr: '', durationMs: 0, outputBytes: 0 };
        },
      };
      const failure = await buildDockerImages({ ...base, runner }).then(
        () => {
          throw new Error('expected the build to fail');
        },
        (error: unknown) => error as Error,
      );
      expect(failure.message).toContain('"app"');
      expect(failure.message).not.toContain(ANNOTATION_CANARY);
      const builds = calls.filter((call) => call.kind === 'run' && call.args[0] === 'buildx');
      expect(builds.length).toBe(1);
      const runSecrets = (builds[0].options.secrets ?? []) as ReadonlyArray<string>;
      expect(runSecrets).toContain(ANNOTATION_CANARY);
      const scrubbedArgv = redactSensitiveValues(builds[0].args.join('\n'), runSecrets);
      expect(scrubbedArgv).not.toContain(ANNOTATION_CANARY);
    });
  });

  it('adds no annotation values to the build result', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const base = secretAnnotationBase(root);
      const { runner } = createSyncRunner();
      const result = await buildDockerImages({ ...base, runner });
      expect(result.images.length).toBe(1);
      expect(JSON.stringify(result)).not.toContain(ANNOTATION_CANARY);
    });
  });
});

describe('build cache flags', () => {
  it('passes cache specs as repeated flags after annotations and before --load', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const base: DockerPublishOptions = {
        cwd: root,
        images: [{ name: 'app', contextDir: 'services/app' }],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64'],
        annotations: { 'org.example.title': 'app' },
        cacheFrom: ['type=registry,ref=registry.example.com/app:cache', 'type=local,src=/tmp/cache'],
        cacheTo: ['type=inline', 'type=local,dest=/tmp/cache,mode=max'],
      };
      const plan = resolveDockerPublishPlan(base);
      const { calls, runner } = createSyncRunner();
      await buildDockerImages({ ...base, runner });
      const builds = calls.filter((call) => call.kind === 'run' && call.args[0] === 'buildx');
      expect(builds.length).toBe(1);
      expect(builds[0].args).toEqual([
        'buildx',
        'build',
        '--platform',
        'linux/amd64',
        '-f',
        plan.images[0].resolvedDockerfile,
        '-t',
        'registry.example.com/app:1.0.0',
        '--annotation',
        'org.example.title=app',
        '--cache-from',
        'type=registry,ref=registry.example.com/app:cache',
        '--cache-from',
        'type=local,src=/tmp/cache',
        '--cache-to',
        'type=inline',
        '--cache-to',
        'type=local,dest=/tmp/cache,mode=max',
        '--load',
        plan.images[0].resolvedContextDir,
      ]);
    });
  });

  it('preserves user order exactly and never sorts cache specs', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const cacheFrom = ['type=local,src=/tmp/z', 'type=registry,ref=registry.example.com/app:a', 'type=inline'];
      const cacheTo = ['type=local,dest=/tmp/z,mode=max', 'type=inline'];
      const base: DockerPublishOptions = {
        cwd: root,
        images: [{ name: 'app', contextDir: 'services/app' }],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64'],
        cacheFrom,
        cacheTo,
      };
      const first = createSyncRunner();
      await buildDockerImages({ ...base, runner: first.runner });
      const firstBuilds = first.calls.filter((call) => call.kind === 'run' && call.args[0] === 'buildx');
      expect(firstBuilds.length).toBe(1);
      const firstFrom = firstBuilds[0].args.filter((_, index) => firstBuilds[0].args[index - 1] === '--cache-from');
      const firstTo = firstBuilds[0].args.filter((_, index) => firstBuilds[0].args[index - 1] === '--cache-to');
      expect(firstFrom).toEqual(cacheFrom);
      expect(firstTo).toEqual(cacheTo);

      const reversed: DockerPublishOptions = {
        ...base,
        cacheFrom: [...cacheFrom].reverse(),
        cacheTo: [...cacheTo].reverse(),
      };
      const second = createSyncRunner();
      await buildDockerImages({ ...reversed, runner: second.runner });
      const secondBuilds = second.calls.filter((call) => call.kind === 'run' && call.args[0] === 'buildx');
      expect(secondBuilds.length).toBe(1);
      const secondFrom = secondBuilds[0].args.filter((_, index) => secondBuilds[0].args[index - 1] === '--cache-from');
      const secondTo = secondBuilds[0].args.filter((_, index) => secondBuilds[0].args[index - 1] === '--cache-to');
      expect(secondFrom).toEqual([...cacheFrom].reverse());
      expect(secondTo).toEqual([...cacheTo].reverse());
    });
  });

  it('emits no cache flags when no cache is configured', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const base: DockerPublishOptions = {
        cwd: root,
        images: [{ name: 'app', contextDir: 'services/app' }],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64'],
      };
      const { calls, runner } = createSyncRunner();
      await buildDockerImages({ ...base, runner });
      const builds = calls.filter((call) => call.kind === 'run' && call.args[0] === 'buildx');
      expect(builds.length).toBe(1);
      expect(builds[0].args).not.toContain('--cache-from');
      expect(builds[0].args).not.toContain('--cache-to');
    });
  });

  it('fails invalid cache specs during planning before invoking any process', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const base: DockerPublishOptions = {
        cwd: root,
        images: [{ name: 'app', contextDir: 'services/app' }],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64'],
        cacheFrom: [''],
      };
      const { calls, runner } = createSyncRunner();
      await expect(buildDockerImages({ ...base, runner })).rejects.toThrow('cacheFrom[0] must be a non-empty string');
      expect(calls.length).toBe(0);
    });
  });

  it('adds no cache spec values to the build result', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const cacheMarker = 'type=registry,ref=registry.example.com/par02-unique-cache-marker';
      const base: DockerPublishOptions = {
        cwd: root,
        images: [{ name: 'app', contextDir: 'services/app' }],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64'],
        cacheFrom: [cacheMarker],
        cacheTo: ['type=inline'],
      };
      const { runner } = createSyncRunner();
      const result = await buildDockerImages({ ...base, runner });
      expect(result.images.length).toBe(1);
      expect(JSON.stringify(result)).not.toContain(cacheMarker);
    });
  });
});

describe('oci export mode', () => {
  const OCI_OUTPUT_PREFIX = 'type=oci,dest=';

  function destFromArgs(args: ReadonlyArray<string>): string {
    const outputIndex = args.indexOf('--output');
    expect(outputIndex).toBeGreaterThanOrEqual(0);
    const spec = args[outputIndex + 1];
    expect(spec.slice(0, OCI_OUTPUT_PREFIX.length)).toBe(OCI_OUTPUT_PREFIX);
    return spec.slice(OCI_OUTPUT_PREFIX.length);
  }

  function createExportRunner(calls: RecordedCall[], writeLayout: (dest: string) => void): DockerBuildRunner {
    return {
      run(executable, args, options) {
        calls.push({ kind: 'run', executable, args: [...args], options });
        if (args[0] === 'rmi') {
          return { durationMs: 0 };
        }
        writeLayout(destFromArgs(args));
        return { durationMs: 5 };
      },
      capture(executable, args, options) {
        calls.push({ kind: 'capture', executable, args: [...args], options });
        throw new Error('capture must not be called for OCI export builds');
      },
    };
  }

  function writeValidLayout(dest: string, digest = 'a'.repeat(64)): void {
    const indexContent = JSON.stringify({
      schemaVersion: 2,
      manifests: [{ mediaType: 'application/vnd.oci.image.index.v1+json', digest: `sha256:${digest}`, size: 100 }],
    });
    writeFileSync(join(dest, 'index.json'), indexContent);
    writeFileSync(join(dest, 'oci-layout'), JSON.stringify({ imageLayoutVersion: '1.0.0' }));
  }

  function tempLeftovers(root: string, exportRel: string): string[] {
    const stats = lstatSync(join(root, exportRel), { throwIfNoEntry: false });
    if (!stats) {
      return [];
    }
    return readdirSync(join(root, exportRel)).filter((name) => name.indexOf('.tmp-') >= 0);
  }

  it('writes per-image layouts with --output instead of --load and reports exportDigest', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const base: DockerPublishOptions = {
        cwd: root,
        images: [{ name: 'app', contextDir: 'services/app' }],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64'],
        ociExportDir: 'oci-layouts',
      };
      const plan = resolveDockerPublishPlan(base);
      const calls: RecordedCall[] = [];
      const runner = createExportRunner(calls, (dest) => writeValidLayout(dest));
      const result = await buildDockerImages({ ...base, runner });

      const builds = calls.filter((call) => call.kind === 'run' && call.args[0] === 'buildx');
      expect(builds.length).toBe(1);
      expect(builds[0].args).not.toContain('--load');
      expect(builds[0].args).not.toContain('--push');
      const tempDest = destFromArgs(builds[0].args);
      const finalDir = join(realpathSync(root), 'oci-layouts', 'app');
      expect(tempDest.slice(0, `${finalDir}.tmp-`.length)).toBe(`${finalDir}.tmp-`);
      expect(calls.filter((call) => call.kind === 'capture').length).toBe(0);
      expect(calls.filter((call) => call.kind === 'run' && call.args[0] === 'rmi').length).toBe(0);

      const raw = readFileSync(join(finalDir, 'index.json'));
      const expectedDigest = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
      expect(result.images.length).toBe(1);
      expect(result.images[0].image).toBe('app');
      expect(result.images[0].platforms).toEqual(['linux/amd64']);
      expect(result.images[0].imageIds).toEqual({});
      expect(result.images[0].exportDir).toBe(finalDir);
      expect(result.images[0].exportDigest).toBe(expectedDigest);
      expect(plan.ociExportDir).toBe(join(realpathSync(root), 'oci-layouts'));
      expect(tempLeftovers(root, 'oci-layouts')).toEqual([]);
    });
  });

  it('exports multi-platform images into one layout without --load', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const base: DockerPublishOptions = {
        cwd: root,
        images: [{ name: 'app', contextDir: 'services/app' }],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64', 'linux/arm64'],
        ociExportDir: 'oci-layouts',
      };
      const calls: RecordedCall[] = [];
      const runner = createExportRunner(calls, (dest) => writeValidLayout(dest));
      const result = await buildDockerImages({ ...base, runner });
      const builds = calls.filter((call) => call.kind === 'run' && call.args[0] === 'buildx');
      expect(builds.length).toBe(1);
      expect(builds[0].args).toContain('--platform');
      expect(builds[0].args).toContain('linux/amd64,linux/arm64');
      expect(builds[0].args).not.toContain('--load');
      expect(builds[0].args).not.toContain('--push');
      expect(result.images[0].platforms).toEqual(['linux/amd64', 'linux/arm64']);
      expect(result.images[0].exportDir).toBe(join(realpathSync(root), 'oci-layouts', 'app'));
      expect(result.images[0].exportDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(calls.filter((call) => call.kind === 'capture').length).toBe(0);
    });
  });

  it('fails closed on malformed layouts without untagging', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const base: DockerPublishOptions = {
        cwd: root,
        images: [{ name: 'app', contextDir: 'services/app' }],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64'],
        ociExportDir: 'oci-layouts',
      };
      const cases: ReadonlyArray<readonly [string, (dest: string) => void]> = [
        ['missing index.json', () => {}],
        ['not valid JSON', (dest) => writeFileSync(join(dest, 'index.json'), 'not-json{{{')],
        [
          'empty manifests array',
          (dest) => writeFileSync(join(dest, 'index.json'), JSON.stringify({ schemaVersion: 2, manifests: [] })),
        ],
      ];
      for (const [message, writeLayout] of cases) {
        const calls: RecordedCall[] = [];
        const failure = await buildDockerImages({
          ...base,
          runner: createExportRunner(calls, writeLayout),
        }).then(
          () => {
            throw new Error('expected the export build to fail');
          },
          (error: unknown) => error as Error,
        );
        expect(failure.message, message).toContain('"app"');
        expect(failure.message, message).toMatch(/missing index\.json|not valid JSON|empty manifests/);
        expect(calls.filter((call) => call.kind === 'run' && call.args[0] === 'rmi').length, message).toBe(0);
        expect(tempLeftovers(root, 'oci-layouts'), message).toEqual([]);
      }
    });
  });

  it('leaves no partial dir and cleans the temp sibling when the build fails', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const base: DockerPublishOptions = {
        cwd: root,
        images: [{ name: 'app', contextDir: 'services/app' }],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64'],
        ociExportDir: 'oci-layouts',
      };
      const calls: RecordedCall[] = [];
      const runner: DockerBuildRunner = {
        run(executable, args, options) {
          calls.push({ kind: 'run', executable, args: [...args], options });
          if (args[0] === 'rmi') {
            return { durationMs: 0 };
          }
          throw new Error('Executable "docker" exited with status 1 (duration 5ms): export boom');
        },
        capture(executable, args, options) {
          calls.push({ kind: 'capture', executable, args: [...args], options });
          throw new Error('capture must not be called for OCI export builds');
        },
      };
      const failure = await buildDockerImages({ ...base, runner }).then(
        () => {
          throw new Error('expected the export build to fail');
        },
        (error: unknown) => error as Error,
      );
      expect(failure.message).toContain('"app"');
      expect(failure.message).toContain('export boom');
      expect(lstatSync(join(root, 'oci-layouts', 'app'), { throwIfNoEntry: false })).toBeUndefined();
      expect(tempLeftovers(root, 'oci-layouts')).toEqual([]);
      expect(calls.filter((call) => call.kind === 'run' && call.args[0] === 'rmi').length).toBe(0);
    });
  });

  it('refuses to publish a plan carrying ociExportDir before any push', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const base: DockerPublishOptions = {
        cwd: root,
        images: [{ name: 'app', contextDir: 'services/app' }],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64'],
        ociExportDir: 'oci-layouts',
      };
      const { calls, runner } = createRecordedRunner();
      const failure = await publishDockerImages({ ...base, runner }).then(
        () => {
          throw new Error('expected publish to fail');
        },
        (error: unknown) => error as Error,
      );
      expect(failure.message).toMatch(/export-only.*rebuild without ociExportDir/);
      expect(calls.length).toBe(0);
    });
  });

  it('fails invalid ociExportDir during planning before invoking any process', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const { calls, runner } = createSyncRunner();
      await expect(
        buildDockerImages({
          cwd: root,
          images: [{ name: 'app', contextDir: 'services/app' }],
          registries: [{ hostname: 'registry.example.com' }],
          tags: ['1.0.0'],
          platforms: ['linux/amd64'],
          ociExportDir: '../escape',
          runner,
        }),
      ).rejects.toThrow('without parent-directory segments');
      expect(calls.length).toBe(0);
    });
  });

  it('never emits --push on the export path', async () => {
    await withProject('docker-publish-build-', async (root) => {
      writeImageContext(root, 'services/app');
      const calls: RecordedCall[] = [];
      await buildDockerImages({
        cwd: root,
        images: [{ name: 'app', contextDir: 'services/app' }],
        registries: [{ hostname: 'registry.example.com' }],
        tags: ['1.0.0'],
        platforms: ['linux/amd64', 'linux/arm64'],
        ociExportDir: 'oci-layouts',
        runner: createExportRunner(calls, (dest) => writeValidLayout(dest)),
      });
      for (const call of calls) {
        expect(call.args).not.toContain('--push');
      }
      const source = readFileSync(join(packageRoot, 'src', 'build.ts'), 'utf8');
      expect(source).not.toContain('--push');
    });
  });
});
