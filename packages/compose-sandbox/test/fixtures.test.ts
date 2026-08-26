import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { resolveComposeSandboxPlan } from '../src/plan';
import { loadConfigFile } from '@repo-toolkit/publish-package';

const fixturesRoot = resolve(import.meta.dirname, 'fixtures');

describe('consumer-shaped fixtures', () => {
  it('database-tools-shaped mixed TCP/HTTP/one-shot config resolves', async () => {
    const dir = join(fixturesRoot, 'database-tools-shaped');
    const raw = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')) as Record<string, unknown>;
    const plan = resolveComposeSandboxPlan({ ...raw, cwd: dir });
    expect(plan.compose.files).toEqual(['docker-compose.yml', 'docker-compose-ci.yml']);
    expect(plan.compose.envFile).toBe('.env.dev');
    expect(plan.readiness.map((r) => r.type)).toEqual(['tcp', 'tcp', 'http', 'service-completed']);
    const tcpPorts = plan.readiness.filter((r) => r.type === 'tcp').map((r) => (r as { port: number }).port);
    expect(tcpPorts).toEqual([5432, 27017]);
    const http = plan.readiness.find((r) => r.type === 'http') as { url: string } | undefined;
    expect(http?.url).toContain('/minio/health/live');
    const completed = plan.readiness.find((r) => r.type === 'service-completed') as { service: string } | undefined;
    expect(completed?.service).toBe('minio-init');
    expect(plan.test.executable).toBe('pnpm');
    expect(plan.test.args).toContain('bats');
    expect(plan.prepare.directories.length).toBe(3);
    expect(plan.cleanup.paths.length).toBe(2);
  });

  it('vite-fastapi-shaped multiple HTTP endpoints plus test command resolves', async () => {
    const dir = join(fixturesRoot, 'vite-fastapi-shaped');
    const loaded = await loadConfigFile<Record<string, unknown>>(join(dir, 'config.mjs'));
    const plan = resolveComposeSandboxPlan({ ...loaded, cwd: dir });
    expect(plan.compose.files).toEqual(['docker-compose.yml', 'docker-compose-apps.yml']);
    expect(plan.readiness.length).toBe(3);
    for (const probe of plan.readiness) {
      expect(probe.type).toBe('http');
    }
    const urls = plan.readiness.map((r) => (r as { url: string }).url);
    expect(urls).toContain('http://127.0.0.1:8080/realms/master');
    expect(urls).toContain('http://127.0.0.1:8000/api/v1/info');
    expect(urls).toContain('http://127.0.0.1:3000');
    expect(plan.test.executable).toBe('pnpm');
    expect(plan.test.args).toContain('playwright:test');
    expect(plan.evidence.capture).toBe('always');
  });

  it('both fixtures expose JSON/JavaScript config via loadConfigFile', async () => {
    const dbJson = await loadConfigFile<Record<string, unknown>>(
      join(fixturesRoot, 'database-tools-shaped', 'config.json'),
    );
    expect(dbJson.compose).toBeDefined();
    const vfptMjs = await loadConfigFile<Record<string, unknown>>(
      join(fixturesRoot, 'vite-fastapi-shaped', 'config.mjs'),
    );
    expect(vfptMjs.compose).toBeDefined();
    // also verify cjs via dynamic import not needed; JSON suffices for contract
    expect(() =>
      resolveComposeSandboxPlan({ ...dbJson, cwd: join(fixturesRoot, 'database-tools-shaped') }),
    ).not.toThrow();
    expect(() =>
      resolveComposeSandboxPlan({ ...vfptMjs, cwd: join(fixturesRoot, 'vite-fastapi-shaped') }),
    ).not.toThrow();
  });
});
