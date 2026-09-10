import {
  lstatSync,
  mkdirSync,
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

import { resolveDockerPublishPlan, type DockerPublishOptions } from '../src/index';
import { assertResolvedImagePaths, formatImageReference } from '../src/plan';
import { withProject, writeImageContext } from './helpers';

const packageRoot = resolve(import.meta.dirname, '..');

function singleImageOptions(root: string): DockerPublishOptions {
  return {
    cwd: root,
    images: [{ name: 'app', contextDir: 'services/app' }],
    registries: [{ hostname: 'registry.example.com', repositoryPrefix: 'team' }],
    tags: ['1.2.3'],
    platforms: ['linux/amd64', 'linux/arm64'],
  };
}

function twoImageOptions(root: string): DockerPublishOptions {
  return {
    cwd: root,
    images: [
      {
        name: 'api',
        contextDir: 'services/api',
        target: 'runtime',
        buildArgs: { LOG_LEVEL: 'info' },
        labels: { 'org.example.component': 'api' },
      },
      {
        name: 'worker',
        contextDir: 'services/worker',
        dockerfile: 'services/worker/Dockerfile.prod',
        buildArgs: { WORKERS: '4' },
        labels: { 'org.example.component': 'worker' },
      },
    ],
    registries: [{ hostname: 'registry.example.com', repositoryPrefix: 'team' }, { hostname: 'localhost:5000' }],
    tags: ['2.0.0', '2.0'],
    platforms: ['linux/amd64', 'linux/arm64'],
  };
}

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
      } else {
        entries.set(rel, `other:${String(stats.mode)}`);
      }
    }
  };
  walk(root);
  return entries;
}

describe('formatImageReference', () => {
  it('joins registry, repository prefix, name, and tag', () => {
    expect(formatImageReference('registry.example.com', 'team', 'app', '1.2.3')).toBe(
      'registry.example.com/team/app:1.2.3',
    );
  });

  it('omits the repository segment when the prefix is empty', () => {
    expect(formatImageReference('localhost:5000', '', 'app', '1.2.3')).toBe('localhost:5000/app:1.2.3');
  });

  it('rejects unsupported template tokens instead of evaluating them', () => {
    expect(() => formatImageReference('registry.example.com', 'team', 'app', '{version}')).toThrow(
      'unsupported template token',
    );
    expect(() => formatImageReference('registry.example.com', '{prefix}', 'app', '1.0')).toThrow(
      'unsupported template token',
    );
  });

  it('rejects empty parts', () => {
    expect(() => formatImageReference('', 'team', 'app', '1.0')).toThrow('registry must be a non-empty string');
    expect(() => formatImageReference('registry.example.com', 'team', '', '1.0')).toThrow(
      'name must be a non-empty string',
    );
    expect(() => formatImageReference('registry.example.com', 'team', 'app', '')).toThrow(
      'tag must be a non-empty string',
    );
  });
});

describe('single-image plan', () => {
  it('resolves one image, one registry, two platforms, and a version tag', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      const plan = resolveDockerPublishPlan(singleImageOptions(root));
      expect(plan).not.toBeInstanceOf(Promise);
      expect(plan.cwd).toBe(realpathSync(root));
      expect(plan.images.length).toBe(1);
      expect(plan.images[0].name).toBe('app');
      expect(plan.images[0].contextDir).toBe('services/app');
      expect(plan.images[0].resolvedContextDir).toBe(realpathSync(join(root, 'services/app')));
      expect(plan.images[0].dockerfile).toBe('services/app/Dockerfile');
      expect(plan.images[0].resolvedDockerfile).toBe(join(realpathSync(root), 'services/app/Dockerfile'));
      expect(plan.images[0].target).toBeUndefined();
      expect(plan.images[0].buildArgs).toEqual({});
      expect(plan.images[0].labels).toEqual({});
      expect(plan.registries).toEqual([{ hostname: 'registry.example.com', repositoryPrefix: 'team' }]);
      expect(plan.tags).toEqual(['1.2.3']);
      expect(plan.platforms).toEqual([
        { os: 'linux', arch: 'amd64', name: 'linux/amd64' },
        { os: 'linux', arch: 'arm64', name: 'linux/arm64' },
      ]);
      const expected = [formatImageReference('registry.example.com', 'team', 'app', '1.2.3')];
      expect(plan.images[0].references).toEqual(expected);
      expect(plan.references).toEqual(expected);
      expect(plan.buildConcurrency).toBe(2);
      expect(plan.processLimits).toEqual({ timeoutMs: 600_000, maxOutputBytes: 1_048_576 });
      expect(plan.dockerExecutable).toBe('docker');
      expect(plan.allowSecretsInBuildArgs).toBe(false);
      expect(plan.allowCustomPlatforms).toBe(false);
      expect(plan.verification).toEqual({ enabled: true, requireDigestMatch: true });
    });
  });
});

describe('two-image two-registry plan', () => {
  it('resolves distinct tags, build args, and labels across the full reference matrix', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/api');
      writeImageContext(root, 'services/worker', 'Dockerfile.prod');
      const plan = resolveDockerPublishPlan(twoImageOptions(root));
      expect(plan.images.length).toBe(2);
      expect(plan.registries).toEqual([
        { hostname: 'registry.example.com', repositoryPrefix: 'team' },
        { hostname: 'localhost:5000', repositoryPrefix: '' },
      ]);
      expect(plan.images[0].target).toBe('runtime');
      expect(plan.images[0].buildArgs).toEqual({ LOG_LEVEL: 'info' });
      expect(plan.images[0].labels).toEqual({ 'org.example.component': 'api' });
      expect(plan.images[1].dockerfile).toBe('services/worker/Dockerfile.prod');
      expect(plan.images[1].buildArgs).toEqual({ WORKERS: '4' });
      expect(plan.images[1].labels).toEqual({ 'org.example.component': 'worker' });
      const expected: string[] = [];
      for (const image of ['api', 'worker']) {
        for (const registry of [
          { hostname: 'registry.example.com', prefix: 'team' },
          { hostname: 'localhost:5000', prefix: '' },
        ]) {
          for (const tag of ['2.0.0', '2.0']) {
            expected.push(formatImageReference(registry.hostname, registry.prefix, image, tag));
          }
        }
      }
      expect(plan.references).toEqual(expected);
      expect(plan.references.length).toBe(8);
      expect(plan.images[0].references).toEqual(expected.slice(0, 4));
      expect(plan.images[1].references).toEqual(expected.slice(4));
    });
  });
});

describe('required collections', () => {
  it('requires images, registries, tags, and platforms', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      const base = singleImageOptions(root);
      expect(() => resolveDockerPublishPlan({})).toThrow('images must be an array');
      expect(() => resolveDockerPublishPlan(undefined)).toThrow('options must be an object');
      expect(() => resolveDockerPublishPlan({ ...base, images: [] })).toThrow('images must contain at least one entry');
      expect(() => resolveDockerPublishPlan({ ...base, registries: [] })).toThrow(
        'registries must contain at least one entry',
      );
      expect(() => resolveDockerPublishPlan({ ...base, tags: [] })).toThrow('tags must contain at least one entry');
      expect(() => resolveDockerPublishPlan({ ...base, platforms: [] })).toThrow(
        'platforms must contain at least one entry',
      );
      expect(() => resolveDockerPublishPlan({ ...base, cwd: join(root, 'missing') })).toThrow(
        'cwd must be an existing directory',
      );
    });
  });
});

describe('unknown keys', () => {
  it('rejects unknown keys at every level', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      const base = singleImageOptions(root);
      expect(() => resolveDockerPublishPlan({ ...base, extra: true })).toThrow('Unknown docker-publish option: extra');
      expect(() => resolveDockerPublishPlan({ ...base, images: [{ ...base.images[0], extra: true }] })).toThrow(
        'Unknown images[0]: extra',
      );
      expect(() =>
        resolveDockerPublishPlan({
          ...base,
          registries: [{ ...base.registries[0], extra: true }],
        }),
      ).toThrow('Unknown registries[0]: extra');
      expect(() => resolveDockerPublishPlan({ ...base, processLimits: { timeoutMs: 1, extra: true } })).toThrow(
        'Unknown processLimits: extra',
      );
      expect(() => resolveDockerPublishPlan({ ...base, verification: { enabled: true, extra: true } })).toThrow(
        'Unknown verification: extra',
      );
    });
  });
});

describe('path containment', () => {
  it('rejects invalid contexts', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      const base = singleImageOptions(root);
      expect(() =>
        resolveDockerPublishPlan({
          ...base,
          images: [{ name: 'app', contextDir: 'services/missing' }],
        }),
      ).toThrow('must be an existing directory');
      expect(() => resolveDockerPublishPlan({ ...base, images: [{ name: 'app', contextDir: '/abs/path' }] })).toThrow(
        'must be relative',
      );
      expect(() => resolveDockerPublishPlan({ ...base, images: [{ name: 'app', contextDir: '../escape' }] })).toThrow(
        'without parent-directory segments',
      );
      expect(() =>
        resolveDockerPublishPlan({ ...base, images: [{ name: 'app', contextDir: 'services/\0app' }] }),
      ).toThrow('must not contain NUL bytes');
    });
  });

  it('rejects Dockerfile escapes and missing Dockerfiles', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      writeImageContext(root, 'other');
      const base = singleImageOptions(root);
      expect(() =>
        resolveDockerPublishPlan({
          ...base,
          images: [{ name: 'app', contextDir: 'services/app', dockerfile: '/abs/Dockerfile' }],
        }),
      ).toThrow('must be relative');
      expect(() =>
        resolveDockerPublishPlan({
          ...base,
          images: [{ name: 'app', contextDir: 'services/app', dockerfile: 'other/Dockerfile' }],
        }),
      ).toThrow('must resolve inside its image context');
      expect(() =>
        resolveDockerPublishPlan({
          ...base,
          images: [{ name: 'app', contextDir: 'services/app', dockerfile: 'services/app/Missing' }],
        }),
      ).toThrow('must be an existing file');
    });
  });

  it('rejects Dockerfiles that escape their image context through symlinks', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      writeImageContext(root, 'services/other');
      symlinkSync(join(root, 'services/other'), join(root, 'services/app', 'link'), 'dir');
      const base = singleImageOptions(root);
      expect(() =>
        resolveDockerPublishPlan({
          ...base,
          images: [{ name: 'app', contextDir: 'services/app', dockerfile: 'services/app/link/Dockerfile' }],
        }),
      ).toThrow('must resolve inside its image context');
    });
  });

  it('rejects invalid image names and targets', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      const base = singleImageOptions(root);
      expect(() =>
        resolveDockerPublishPlan({ ...base, images: [{ name: 'App', contextDir: 'services/app' }] }),
      ).toThrow('must be a lowercase Docker repository name');
      expect(() => resolveDockerPublishPlan({ ...base, images: [{ name: '', contextDir: 'services/app' }] })).toThrow(
        'must be a non-empty string',
      );
      expect(() =>
        resolveDockerPublishPlan({
          ...base,
          images: [{ name: 'app', contextDir: 'services/app', target: 'bad stage' }],
        }),
      ).toThrow('is not a valid build stage name');
    });
  });
});

describe('duplicates', () => {
  it('rejects duplicate names, registries, tags, platforms, and references', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      writeImageContext(root, 'services/other');
      writeImageContext(root, 'c1');
      writeImageContext(root, 'c2');
      const base = singleImageOptions(root);
      expect(() =>
        resolveDockerPublishPlan({
          ...base,
          images: [
            { name: 'app', contextDir: 'services/app' },
            { name: 'app', contextDir: 'services/other' },
          ],
        }),
      ).toThrow('Duplicate image name: app');
      expect(() => resolveDockerPublishPlan({ ...base, tags: ['1.0', '1.0'] })).toThrow('Duplicate tag: 1.0');
      expect(() =>
        resolveDockerPublishPlan({
          ...base,
          registries: [
            { hostname: 'registry.example.com', repositoryPrefix: 'team' },
            { hostname: 'registry.example.com', repositoryPrefix: 'team' },
          ],
        }),
      ).toThrow('Duplicate registry');
      expect(() => resolveDockerPublishPlan({ ...base, platforms: ['linux/amd64', 'linux/amd64'] })).toThrow(
        'Duplicate platform: linux/amd64',
      );
      expect(() =>
        resolveDockerPublishPlan({
          cwd: root,
          images: [
            { name: 'b', contextDir: 'c1' },
            { name: 'a/b', contextDir: 'c2' },
          ],
          registries: [
            { hostname: 'registry.example.com', repositoryPrefix: 'a' },
            { hostname: 'registry.example.com' },
          ],
          tags: ['1.0'],
          platforms: ['linux/amd64'],
        }),
      ).toThrow('Duplicate image reference: registry.example.com/a/b:1.0');
    });
  });
});

describe('registry validation', () => {
  it('rejects malformed registry hostnames', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      const base = singleImageOptions(root);
      const cases: ReadonlyArray<readonly [string, unknown]> = [
        ['must be lowercase', 'Registry.Example.com'],
        ['without a scheme', 'https://registry.example.com'],
        ['without a path', 'registry.example.com/team'],
        ['without userinfo', 'user@registry.example.com'],
        ['must be a non-empty string', ''],
        ['must not contain whitespace', 'registry.example .com'],
        ['port must be numeric', 'registry.example.com:http'],
        ['port must be 1-65535', 'registry.example.com:99999'],
        ['is not a valid registry hostname', '-bad-.example.com'],
      ];
      for (const [message, hostname] of cases) {
        expect(() => resolveDockerPublishPlan({ ...base, registries: [{ hostname }] }), String(hostname)).toThrow(
          message,
        );
      }
      expect(() =>
        resolveDockerPublishPlan({
          ...base,
          registries: [{ hostname: 'registry.example.com', repositoryPrefix: 'Team/Upper' }],
        }),
      ).toThrow('must be lowercase');
      expect(
        resolveDockerPublishPlan({
          ...base,
          registries: [{ hostname: 'localhost:5000' }],
        }).registries,
      ).toEqual([{ hostname: 'localhost:5000', repositoryPrefix: '' }]);
    });
  });
});

describe('tag validation', () => {
  it('rejects illegal tags', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      const base = singleImageOptions(root);
      const cases: ReadonlyArray<unknown> = ['Latest', 'v1:0', 'a/b', '', '-bad', '.bad', 'has space', 'x'.repeat(129)];
      for (const tag of cases) {
        expect(() => resolveDockerPublishPlan({ ...base, tags: [tag] }), String(tag)).toThrow(
          /must be a non-empty string|must match Docker tag rules/,
        );
      }
      expect(resolveDockerPublishPlan({ ...base, tags: ['latest'] }).tags).toEqual(['latest']);
    });
  });
});

describe('platform validation', () => {
  it('rejects malformed and unknown platforms without the escape hatch', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      const base = singleImageOptions(root);
      expect(() => resolveDockerPublishPlan({ ...base, platforms: ['linux'] })).toThrow(
        'must use os/arch[/variant] form',
      );
      expect(() => resolveDockerPublishPlan({ ...base, platforms: ['linux/amd64/v7/extra'] })).toThrow(
        'must use os/arch[/variant] form',
      );
      expect(() => resolveDockerPublishPlan({ ...base, platforms: ['LINUX/amd64'] })).toThrow(
        'os must contain only lowercase ASCII letters and digits',
      );
      expect(() => resolveDockerPublishPlan({ ...base, platforms: ['myos/amd64'] })).toThrow("uses unknown os 'myos'");
      expect(() => resolveDockerPublishPlan({ ...base, platforms: ['linux/myarch'] })).toThrow(
        "uses unknown arch 'myarch'",
      );
    });
  });

  it('accepts custom platforms and variants through the documented escape hatch', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      const base = singleImageOptions(root);
      const plan = resolveDockerPublishPlan({
        ...base,
        platforms: ['linux/arm/v7', 'myos/myarch'],
        allowCustomPlatforms: true,
      });
      expect(plan.allowCustomPlatforms).toBe(true);
      expect(plan.platforms).toEqual([
        { os: 'linux', arch: 'arm', variant: 'v7', name: 'linux/arm/v7' },
        { os: 'myos', arch: 'myarch', name: 'myos/myarch' },
      ]);
      expect(() =>
        resolveDockerPublishPlan({ ...base, platforms: ['linux/amd64/'], allowCustomPlatforms: true }),
      ).toThrow('variant is not a valid platform variant');
    });
  });
});

describe('build argument and label maps', () => {
  it('rejects oversized and malformed maps', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      const base = singleImageOptions(root);
      const tooMany: Record<string, string> = {};
      for (let i = 0; i < 65; i += 1) {
        tooMany[`KEY_${i}`] = 'v';
      }
      expect(() => resolveDockerPublishPlan({ ...base, buildArgs: tooMany })).toThrow(
        'must not contain more than 64 entries',
      );
      expect(() => resolveDockerPublishPlan({ ...base, labels: { OK: 'x'.repeat(4097) } })).toThrow(
        'must not exceed 4096 characters',
      );
      expect(() => resolveDockerPublishPlan({ ...base, buildArgs: { 'MY KEY': 'v' } })).toThrow(
        'must not contain whitespace or control characters',
      );
      expect(() => resolveDockerPublishPlan({ ...base, buildArgs: { 'BAD\x01KEY': 'v' } })).toThrow(
        'must not contain whitespace or control characters',
      );
      expect(() => resolveDockerPublishPlan({ ...base, buildArgs: { K: 'v\0' } })).toThrow(
        'must not contain NUL bytes',
      );
      expect(() => resolveDockerPublishPlan({ ...base, buildArgs: { ['K'.repeat(129)]: 'v' } })).toThrow(
        'keys must be 1-128 characters long',
      );
      const nonString = singleImageOptions(root) as unknown as { images: Array<Record<string, unknown>> };
      nonString.images[0]['buildArgs'] = { COUNT: 4 };
      expect(() => resolveDockerPublishPlan(nonString)).toThrow('must be a string');
    });
  });

  it('rejects secret-like keys unless explicitly allowed', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      const base = singleImageOptions(root);
      expect(() => resolveDockerPublishPlan({ ...base, buildArgs: { NPM_TOKEN: 'x' } })).toThrow('looks like a secret');
      expect(() =>
        resolveDockerPublishPlan({
          ...base,
          images: [{ name: 'app', contextDir: 'services/app', buildArgs: { DB_PASSWORD: 'x' } }],
        }),
      ).toThrow('looks like a secret');
      expect(() => resolveDockerPublishPlan({ ...base, labels: { API_SECRET: 'x' } })).toThrow('looks like a secret');
      const allowed = resolveDockerPublishPlan({
        ...base,
        buildArgs: { NPM_TOKEN: 'x' },
        allowSecretsInBuildArgs: true,
      });
      expect(allowed.allowSecretsInBuildArgs).toBe(true);
      expect(allowed.buildArgs).toEqual({ NPM_TOKEN: 'x' });
    });
  });
});

describe('scalar options', () => {
  it('rejects wrong types and out-of-range limits', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      const base = singleImageOptions(root);
      expect(() => resolveDockerPublishPlan({ ...base, images: 'app' })).toThrow('images must be an array');
      const badName = singleImageOptions(root) as unknown as { images: Array<Record<string, unknown>> };
      badName.images[0]['name'] = 42;
      expect(() => resolveDockerPublishPlan(badName)).toThrow('must be a non-empty string');
      expect(() => resolveDockerPublishPlan({ ...base, buildConcurrency: 0 })).toThrow(
        'buildConcurrency must be a positive safe integer',
      );
      expect(() => resolveDockerPublishPlan({ ...base, buildConcurrency: 1.5 })).toThrow(
        'buildConcurrency must be a positive safe integer',
      );
      expect(() => resolveDockerPublishPlan({ ...base, buildConcurrency: 65 })).toThrow(
        'buildConcurrency must not exceed 64',
      );
      expect(() => resolveDockerPublishPlan({ ...base, processLimits: { timeoutMs: 'fast' } })).toThrow(
        'processLimits.timeoutMs must be a number',
      );
      expect(() => resolveDockerPublishPlan({ ...base, dockerExecutable: '' })).toThrow(
        'dockerExecutable must be a non-empty string',
      );
      expect(() => resolveDockerPublishPlan({ ...base, allowSecretsInBuildArgs: 'yes' })).toThrow(
        'allowSecretsInBuildArgs must be a boolean',
      );
      expect(() => resolveDockerPublishPlan({ ...base, verification: { enabled: 1 } })).toThrow(
        'verification.enabled must be a boolean',
      );
      const resolved = resolveDockerPublishPlan({
        ...base,
        buildConcurrency: 4,
        processLimits: { timeoutMs: 1000, maxOutputBytes: 2048 },
        dockerExecutable: '/usr/bin/docker',
        verification: { enabled: false, requireDigestMatch: false },
      });
      expect(resolved.buildConcurrency).toBe(4);
      expect(resolved.processLimits).toEqual({ timeoutMs: 1000, maxOutputBytes: 2048 });
      expect(resolved.dockerExecutable).toBe('/usr/bin/docker');
      expect(resolved.verification).toEqual({ enabled: false, requireDigestMatch: false });
    });
  });
});

describe('resolved path re-validation', () => {
  it('passes on an unchanged plan', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      const plan = resolveDockerPublishPlan(singleImageOptions(root));
      expect(() => assertResolvedImagePaths(plan, plan.images[0])).not.toThrow();
    });
  });

  it('fails closed when the context dir is swapped for a symlink after resolution', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      const plan = resolveDockerPublishPlan(singleImageOptions(root));
      const outside = mkdtempSync(join(tmpdir(), 'docker-publish-outside-'));
      try {
        writeFileSync(join(outside, 'Dockerfile'), 'FROM scratch\n');
        rmSync(join(root, 'services/app'), { recursive: true });
        symlinkSync(outside, join(root, 'services/app'), 'dir');
        expect(() => assertResolvedImagePaths(plan, plan.images[0])).toThrow(
          /changed since plan resolution|escapes the project root/,
        );
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  it('fails closed when a parent component is swapped for a symlink after resolution', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      const plan = resolveDockerPublishPlan(singleImageOptions(root));
      const outside = mkdtempSync(join(tmpdir(), 'docker-publish-outside-'));
      try {
        mkdirSync(join(outside, 'app'), { recursive: true });
        writeFileSync(join(outside, 'app', 'Dockerfile'), 'FROM scratch\n');
        rmSync(join(root, 'services'), { recursive: true });
        symlinkSync(outside, join(root, 'services'), 'dir');
        expect(() => assertResolvedImagePaths(plan, plan.images[0])).toThrow(
          /changed since plan resolution|escapes the project root/,
        );
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  it('fails closed when the Dockerfile is replaced after resolution', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      writeImageContext(root, 'services/other');
      const plan = resolveDockerPublishPlan(singleImageOptions(root));
      rmSync(join(root, 'services/app', 'Dockerfile'));
      symlinkSync(join(root, 'services/other', 'Dockerfile'), join(root, 'services/app', 'Dockerfile'));
      expect(() => assertResolvedImagePaths(plan, plan.images[0])).toThrow('changed since plan resolution');
    });
  });

  it('leaves symlinks inside the context tree to the documented trust contract', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      writeFileSync(join(root, 'secret.txt'), 'top-secret\n');
      symlinkSync(join(root, 'secret.txt'), join(root, 'services/app', 'data'));
      const plan = resolveDockerPublishPlan(singleImageOptions(root));
      expect(() => assertResolvedImagePaths(plan, plan.images[0])).not.toThrow();
    });
  });
});

describe('context trust contract', () => {
  it('documents trusted immutable snapshots in README and website docs', () => {
    const readme = readFileSync(join(packageRoot, 'README.md'), 'utf8');
    const website = readFileSync(
      join(packageRoot, '..', '..', 'website', 'docs', 'packages', 'docker-publish.md'),
      'utf8',
    );
    for (const doc of [readme, website]) {
      expect(doc).toContain('trusted, immutable snapshots');
    }
  });
});

describe('plan purity', () => {
  it('leaves fixtures byte-for-byte unchanged and invokes zero processes', () => {
    withProject('docker-publish-plan-', (root) => {
      writeImageContext(root, 'services/app');
      writeImageContext(root, 'services/api');
      writeImageContext(root, 'services/worker', 'Dockerfile.prod');
      const before = snapshotTree(root);
      resolveDockerPublishPlan(singleImageOptions(root));
      resolveDockerPublishPlan(twoImageOptions(root));
      const after = snapshotTree(root);
      expect([...after.entries()]).toEqual([...before.entries()]);
    });
    const planSource = readFileSync(join(packageRoot, 'src', 'plan.ts'), 'utf8');
    expect(planSource).not.toContain('child_process');
    expect(planSource).not.toContain('spawn');
    expect(planSource).not.toContain('execFile');
    expect(planSource).not.toContain('execSync');
    expect(planSource).not.toContain('process.env');
    expect(planSource).not.toContain('process.exit');
  });
});
