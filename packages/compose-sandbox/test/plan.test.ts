import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveComposeSandboxPlan } from '../src/plan';

function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function baseValidOptions(): Record<string, unknown> {
  return {
    cwd: '.',
    compose: {
      files: ['sandbox/docker-compose.yml'],
      projectName: 'vfpt',
    },
    test: {
      executable: 'pnpm',
      args: ['playwright:test'],
    },
  };
}

describe('resolveComposeSandboxPlan', () => {
  it('resolves database-tools shaped mixed probes', () => {
    const options = {
      cwd: '.',
      compose: {
        files: ['sandbox/docker-compose.yml', 'sandbox/docker-compose-ci.yml'],
        envFile: 'sandbox/.env.test',
        projectName: 'dbtools',
        build: false,
      },
      readiness: [
        { type: 'tcp', host: '127.0.0.1', port: 5432 },
        { type: 'tcp', host: '127.0.0.1', port: 27017 },
        { type: 'http', url: 'http://localhost:9000/minio/health/live' },
        { type: 'service-completed', service: 'minio-init' },
      ],
      test: { executable: 'pnpm', args: ['exec', 'bats', 'test/test.bats'] },
      evidence: { directory: '.ci-logs', capture: 'onFailure' },
      cleanup: { volumes: true, removeOrphans: true, paths: ['sandbox/mnt/postgres', 'sandbox/mnt/mongodb'] },
      timeouts: { readinessMs: 120_000, testMs: 300_000 },
    };
    const before = cloneDeep(options);
    const plan = resolveComposeSandboxPlan(options);
    expect(JSON.stringify(options)).toBe(JSON.stringify(before));
    expect(plan.cwd).toBe(resolve('.'));
    expect(plan.compose.files).toEqual(['sandbox/docker-compose.yml', 'sandbox/docker-compose-ci.yml']);
    expect(plan.compose.envFile).toBe('sandbox/.env.test');
    expect(plan.compose.projectName).toBe('dbtools');
    expect(plan.readiness).toHaveLength(4);
    expect(plan.readiness[0]).toMatchObject({ type: 'tcp', host: '127.0.0.1', port: 5432 });
    expect(plan.readiness[2]).toMatchObject({ type: 'http', url: 'http://localhost:9000/minio/health/live' });
    expect(plan.readiness[3]).toMatchObject({ type: 'service-completed', service: 'minio-init' });
    expect(plan.test).toMatchObject({ executable: 'pnpm', args: ['exec', 'bats', 'test/test.bats'] });
    expect(plan.evidence.directory).toBe('.ci-logs');
    expect(plan.cleanup.volumes).toBe(true);
    expect(plan.cleanup.paths).toEqual(['sandbox/mnt/postgres', 'sandbox/mnt/mongodb']);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.compose.files)).toBe(true);
  });

  it('resolves vite-fastapi template shaped http probes', () => {
    const options = {
      compose: {
        files: ['sandbox/docker-compose.yml', 'sandbox/docker-compose-apps.yml'],
      },
      readiness: [
        { type: 'http', url: 'http://localhost:8080/realms/master/.well-known/openid-configuration' },
        { type: 'http', url: 'http://127.0.0.1:8000/api/v1/info' },
        { type: 'http', url: 'http://localhost:3000' },
      ],
      test: { executable: 'pnpm', args: ['playwright:test'] },
      evidence: { directory: '.ci-logs' },
    };
    const plan = resolveComposeSandboxPlan(options);
    expect(plan.compose.files).toEqual(['sandbox/docker-compose.yml', 'sandbox/docker-compose-apps.yml']);
    expect(plan.readiness).toHaveLength(3);
    for (const probe of plan.readiness) {
      expect(probe.type).toBe('http');
    }
  });

  it('resolves task example with defaults', () => {
    const options = {
      cwd: '.',
      compose: {
        files: ['sandbox/docker-compose.yml'],
        envFile: 'sandbox/.env.dev',
        projectName: 'vfpt',
        build: true,
      },
      readiness: [
        { type: 'http', url: 'http://127.0.0.1:8000/api/v1/info' },
        { type: 'tcp', host: '127.0.0.1', port: 5432 },
        { type: 'service-completed', service: 'provision' },
      ],
      test: { executable: 'pnpm', args: ['playwright:test'] },
      evidence: { directory: '.ci-logs' },
      cleanup: { volumes: true, removeOrphans: true },
    };
    const plan = resolveComposeSandboxPlan(options as unknown as Record<string, unknown>);
    expect(plan.compose.build).toBe(true);
    expect(plan.evidence.capture).toBe('onFailure');
    expect(plan.cleanup.removeOrphans).toBe(true);
  });

  it('applies explicit defaults for minimal valid plan', () => {
    const plan = resolveComposeSandboxPlan(baseValidOptions());
    expect(plan.compose.executable).toBe('docker');
    expect(plan.compose.profiles).toEqual([]);
    expect(plan.compose.build).toBe(false);
    expect(plan.compose.pull).toBe(false);
    expect(plan.prepare.directories).toEqual([]);
    expect(plan.prepare.copies).toEqual([]);
    expect(plan.readiness).toEqual([]);
    expect(plan.evidence.directory).toBe('.compose-sandbox-logs');
    expect(plan.evidence.capture).toBe('onFailure');
    expect(plan.evidence.maxLogBytes).toBe(1_048_576);
    expect(plan.evidence.stripAnsi).toBe(true);
    expect(plan.cleanup.volumes).toBe(false);
    expect(plan.cleanup.removeOrphans).toBe(true);
    expect(plan.cleanup.paths).toEqual([]);
    expect(plan.timeouts.startupMs).toBe(120_000);
    expect(plan.timeouts.readinessMs).toBe(120_000);
    expect(plan.timeouts.testMs).toBe(300_000);
    expect(plan.timeouts.cleanupMs).toBe(30_000);
    expect(plan.dryRun).toBe(false);
    expect(plan.cwd).toBe(resolve('.'));
    expect(plan.test.args).toEqual(['playwright:test']);
    expect(plan.test.env).toEqual({});
  });

  it('does not mutate input and performs no FS writes', () => {
    const options = {
      compose: { files: ['sandbox/docker-compose.yml'] },
      test: { executable: 'node', args: ['--version'] },
      prepare: { directories: ['tmp/data'] },
      evidence: { directory: '.compose-sandbox-logs' },
      cleanup: { paths: ['tmp/data'] },
    };
    const before = JSON.stringify(options);
    const plan = resolveComposeSandboxPlan(cloneDeep(options));
    expect(JSON.stringify(options)).toBe(before);
    expect(plan.prepare.directories).toEqual(['tmp/data']);
    // resolved paths are syntactically inside cwd but no FS check required
    expect(plan.prepare.resolvedDirectories[0]).toBe(resolve('tmp/data'));
    expect(plan.evidence.resolvedDirectory).toBe(resolve('.compose-sandbox-logs'));
  });

  it('freezes plan immutably', () => {
    const plan = resolveComposeSandboxPlan(baseValidOptions());
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.compose)).toBe(true);
    expect(Object.isFrozen(plan.test)).toBe(true);
    expect(Object.isFrozen(plan.timeouts)).toBe(true);
  });

  it('rejects unknown top-level keys', () => {
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo' },
        unknown: true,
      }),
    ).toThrow(/Unknown option/);
  });

  it('rejects unknown compose keys', () => {
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'], extra: true } as unknown as Record<string, unknown>,
        test: { executable: 'echo' },
      }),
    ).toThrow(/Unknown compose option/);
  });

  it('rejects unknown readiness keys', () => {
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        readiness: [{ type: 'tcp', host: '127.0.0.1', port: 5432, foo: 1 } as unknown as Record<string, unknown>],
        test: { executable: 'echo' },
      }),
    ).toThrow(/Unknown readiness/);
  });

  it('rejects unknown test keys', () => {
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo', bogus: true } as unknown as Record<string, unknown>,
      }),
    ).toThrow(/Unknown test/);
  });

  it('requires at least one compose file and a test command', () => {
    expect(() =>
      resolveComposeSandboxPlan({ compose: { files: [] as string[] }, test: { executable: 'echo' } }),
    ).toThrow(/compose\.files must contain at least one entry/);
    expect(() =>
      resolveComposeSandboxPlan({ compose: { files: ['a.yml'] } } as unknown as Record<string, unknown>),
    ).toThrow(/test is required/);
    expect(() => resolveComposeSandboxPlan({} as unknown as Record<string, unknown>)).toThrow(/compose is required/);
    expect(() => resolveComposeSandboxPlan({ compose: { files: ['a.yml'] }, test: { executable: '' } })).toThrow(
      /test\.executable must be a non-empty string/,
    );
  });

  it('rejects NUL bytes everywhere', () => {
    expect(() =>
      resolveComposeSandboxPlan({
        cwd: 'a\0b',
        compose: { files: ['a.yml'] },
        test: { executable: 'echo' },
      }),
    ).toThrow(/NUL/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a\0.yml'] },
        test: { executable: 'echo' },
      }),
    ).toThrow(/NUL/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo\0' },
      }),
    ).toThrow(/NUL/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'], projectName: 'a\0' },
        test: { executable: 'echo' },
      }),
    ).toThrow(/NUL/);
  });

  it('rejects absolute and escaping paths', () => {
    expect(() =>
      resolveComposeSandboxPlan({ compose: { files: ['/absolute.yml'] }, test: { executable: 'echo' } }),
    ).toThrow(/must be relative/);
    expect(() =>
      resolveComposeSandboxPlan({ compose: { files: ['../escape.yml'] }, test: { executable: 'echo' } }),
    ).toThrow(/must not contain parent-directory/);
    expect(() =>
      resolveComposeSandboxPlan({ compose: { files: ['a/../b.yml'] }, test: { executable: 'echo' } }),
    ).toThrow(/must not contain parent-directory/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'], envFile: '/etc/passwd' },
        test: { executable: 'echo' },
      }),
    ).toThrow(/must be relative/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        prepare: { directories: ['../escape'] },
        test: { executable: 'echo' },
      }),
    ).toThrow(/must not contain parent-directory/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        evidence: { directory: '../escape' },
        test: { executable: 'echo' },
      }),
    ).toThrow(/must not contain parent-directory/);
  });

  it('prevents destructive cleanup of project root', () => {
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo' },
        cleanup: { paths: ['.'] },
      }),
    ).toThrow(/must not be/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo' },
        cleanup: { paths: [''] } as unknown as Record<string, unknown>,
      }),
    ).toThrow(/must be a non-empty string/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo' },
        cleanup: { paths: ['../outside'] },
      }),
    ).toThrow(/must not contain parent-directory/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo' },
        cleanup: { paths: ['a', 'a'] },
      }),
    ).toThrow(/Duplicate cleanup path/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo' },
        evidence: { directory: '.' },
      }),
    ).toThrow(/must not be/);
  });

  it('validates project and service names', () => {
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'], projectName: 'Invalid' },
        test: { executable: 'echo' },
      }),
    ).toThrow(/must match/);
    expect(() =>
      resolveComposeSandboxPlan({ compose: { files: ['a.yml'], projectName: '-bad' }, test: { executable: 'echo' } }),
    ).toThrow(/must match/);
    expect(() =>
      resolveComposeSandboxPlan({ compose: { files: ['a.yml'], projectName: 'a b' }, test: { executable: 'echo' } }),
    ).toThrow(/must match/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        readiness: [{ type: 'service-running', service: 'bad service' }],
        test: { executable: 'echo' },
      }),
    ).toThrow(/must match/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'], profiles: ['bad profile'] },
        test: { executable: 'echo' },
      }),
    ).toThrow(/must match/);
  });

  it('validates ports', () => {
    for (const port of [0, -1, 70000, 3.5, '5432' as unknown as number]) {
      expect(() =>
        resolveComposeSandboxPlan({
          compose: { files: ['a.yml'] },
          readiness: [{ type: 'tcp', host: '127.0.0.1', port: port as number }],
          test: { executable: 'echo' },
        }),
      ).toThrow(/must be an integer 1-65535/);
    }
  });

  it('validates URLs and HTTP fields', () => {
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        readiness: [{ type: 'http', url: 'not-a-url' }],
        test: { executable: 'echo' },
      }),
    ).toThrow(/must be a valid URL/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        readiness: [{ type: 'http', url: 'ftp://example.com/file' }],
        test: { executable: 'echo' },
      }),
    ).toThrow(/must use http or https/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        readiness: [{ type: 'http', url: 'http://127.0.0.1:8000/api', method: 'get' }],
        test: { executable: 'echo' },
      }),
    ).toThrow(/must be uppercase/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        readiness: [{ type: 'http', url: 'http://127.0.0.1:8000/api', expectedStatus: 99 }],
        test: { executable: 'echo' },
      }),
    ).toThrow(/must be an integer 100-599/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        readiness: [{ type: 'http', url: 'http://127.0.0.1:8000/api', expectedStatus: [300, 200] }],
        test: { executable: 'echo' },
      }),
    ).toThrow(/range min must be <= max/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        readiness: [
          {
            type: 'http',
            url: 'http://127.0.0.1:8000/api',
            headers: { '': 'value' } as unknown as Record<string, string>,
          },
        ],
        test: { executable: 'echo' },
      }),
    ).toThrow(/header name must be non-empty/);
  });

  it('validates structured commands', () => {
    expect(() => resolveComposeSandboxPlan({ compose: { files: ['a.yml'] }, test: { executable: '' } })).toThrow(
      /must be a non-empty string/,
    );
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo', args: 'not-array' as unknown as string[] },
      }),
    ).toThrow(/must be an array/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo', args: [''] },
      }),
    ).toThrow(/must be non-empty/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo', args: ['a\0'] },
      }),
    ).toThrow(/NUL/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo', env: { '': 'value' } as unknown as Record<string, string> },
      }),
    ).toThrow(/env key must be non-empty/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo', env: { KEY: 'a\0' } },
      }),
    ).toThrow(/NUL/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        readiness: [{ type: 'command', executable: '' }],
        test: { executable: 'echo' },
      }),
    ).toThrow(/must be a non-empty string/);
  });

  it('rejects duplicate probes', () => {
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        readiness: [
          { type: 'tcp', host: '127.0.0.1', port: 5432 },
          { type: 'tcp', host: '127.0.0.1', port: 5432 },
        ],
        test: { executable: 'echo' },
      }),
    ).toThrow(/Duplicate readiness probe/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        readiness: [
          { type: 'http', url: 'http://127.0.0.1:8000/info' },
          { type: 'http', url: 'http://127.0.0.1:8000/info' },
        ],
        test: { executable: 'echo' },
      }),
    ).toThrow(/Duplicate readiness probe/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        readiness: [
          { type: 'service-completed', service: 'provision' },
          { type: 'service-completed', service: 'provision' },
        ],
        test: { executable: 'echo' },
      }),
    ).toThrow(/Duplicate readiness probe/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        readiness: [
          { type: 'command', executable: 'echo', args: ['hello'] },
          { type: 'command', executable: 'echo', args: ['hello'] },
        ],
        test: { executable: 'echo' },
      }),
    ).toThrow(/Duplicate readiness probe/);
  });

  it('rejects invalid probe types and conflicting unknown keys', () => {
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        readiness: [
          { type: 'unknown' as unknown as 'tcp', host: '127.0.0.1', port: 5432 } as unknown as Record<string, unknown>,
        ],
        test: { executable: 'echo' },
      }),
    ).toThrow(/must be one of/);
  });

  it('rejects unbounded numeric limits', () => {
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo' },
        timeouts: { startupMs: 0 },
      }),
    ).toThrow(/must be a positive safe integer/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo' },
        timeouts: { readinessMs: 100_000_000 },
      }),
    ).toThrow(/must be <= 86400000/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        readiness: [{ type: 'tcp', host: '127.0.0.1', port: 5432, intervalMs: 100_000 }],
        test: { executable: 'echo' },
      }),
    ).toThrow(/must be <= 60000/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo' },
        evidence: { maxLogBytes: 20_000_000 },
      }),
    ).toThrow(/must be <= 10485760/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo' },
        evidence: { maxLogBytes: 0 },
      }),
    ).toThrow(/must be a positive safe integer/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        readiness: [{ type: 'http', url: 'http://127.0.0.1:8000/info', timeoutMs: -5 }],
        test: { executable: 'echo' },
      }),
    ).toThrow(/must be a positive safe integer/);
  });

  it('rejects unknown evidence/cleanup/timeout keys', () => {
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo' },
        evidence: { directory: '.logs', unknown: 1 } as unknown as Record<string, unknown>,
      }),
    ).toThrow(/Unknown evidence option/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo' },
        cleanup: { volumes: true, extra: true } as unknown as Record<string, unknown>,
      }),
    ).toThrow(/Unknown cleanup option/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo' },
        timeouts: { startupMs: 1000, extra: 1 } as unknown as Record<string, unknown>,
      }),
    ).toThrow(/Unknown timeouts option/);
  });

  it('validates evidence capture values', () => {
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo' },
        evidence: { capture: 'invalid' as unknown as 'always' },
      }),
    ).toThrow(/must be 'always' or 'onFailure'/);
  });

  it('validates prepare copies', () => {
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        prepare: { copies: [{ from: 'a', to: '.' }] },
        test: { executable: 'echo' },
      }),
    ).toThrow(/must not be/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        prepare: { copies: [{ from: '../escape', to: 'b' }] },
        test: { executable: 'echo' },
      }),
    ).toThrow(/must not contain parent-directory/);
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        prepare: { copies: [{ from: 'a', to: 'b', extra: 1 } as unknown as Record<string, unknown>] },
        test: { executable: 'echo' },
      }),
    ).toThrow(/Unknown prepare\.copies/);
  });

  it('does not require files to exist - dry-run planning', () => {
    const plan = resolveComposeSandboxPlan({
      compose: { files: ['nonexistent/docker-compose.yml'] },
      test: { executable: 'echo', args: ['hello'] },
    });
    expect(plan.compose.files).toEqual(['nonexistent/docker-compose.yml']);
    expect(plan.compose.resolvedFiles[0]).toBe(resolve('nonexistent/docker-compose.yml'));
  });

  it('resolves cwd relative and validates test.cwd containment', () => {
    const plan = resolveComposeSandboxPlan({
      cwd: '.',
      compose: { files: ['a.yml'] },
      test: { executable: 'echo', cwd: 'subdir' },
    });
    expect(plan.test.cwd).toBe('subdir');
    expect(plan.test.resolvedCwd).toBe(resolve('subdir'));
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'] },
        test: { executable: 'echo', cwd: '../escape' },
      }),
    ).toThrow(/must not contain parent-directory/);
  });

  it('validates compose.build/pull boolean types', () => {
    expect(() =>
      resolveComposeSandboxPlan({
        compose: { files: ['a.yml'], build: 'true' as unknown as boolean },
        test: { executable: 'echo' },
      }),
    ).toThrow(/must be a boolean/);
  });
});
