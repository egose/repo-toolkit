/* eslint-disable preserve-caught-error */
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { runComposeSandbox } from '../src/run';

function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['compose', 'version'], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function uniqueProject(base: string): string {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${base}-${suffix}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

async function assertNoLeak(projectName: string): Promise<void> {
  // Compose ps for this project should be empty / not found
  const ps = spawnSync('docker', ['compose', '-p', projectName, 'ps', '-a', '--format', 'json'], {
    encoding: 'utf8',
    timeout: 8000,
  });
  const out = (ps.stdout ?? '').trim();
  if (out.length > 0) {
    try {
      const parsed = JSON.parse(out) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        throw new Error(`Leaked containers for project ${projectName}: ${out}`);
      }
      if (!Array.isArray(parsed) && typeof parsed === 'object' && parsed !== null) {
        throw new Error(`Leaked container object for project ${projectName}: ${out}`);
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        if (out.length > 0 && !out.includes('no such') && !out.includes('not found')) {
          throw new Error(`Unexpected ps output for ${projectName}: ${out}`);
        }
      } else {
        throw err;
      }
    }
  }
  // Networks: filter by label com.docker.compose.project
  const net = spawnSync(
    'docker',
    ['network', 'ls', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.Name}}'],
    { encoding: 'utf8', timeout: 5000 },
  );
  if ((net.stdout ?? '').trim().length > 0) {
    throw new Error(`Leaked network for project ${projectName}: ${net.stdout}`);
  }
  const vol = spawnSync(
    'docker',
    ['volume', 'ls', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.Name}}'],
    { encoding: 'utf8', timeout: 5000 },
  );
  if ((vol.stdout ?? '').trim().length > 0) {
    throw new Error(`Leaked volume for project ${projectName}: ${vol.stdout}`);
  }
}

describe('real compose integration', () => {
  it('proves startup, readiness, test execution, evidence capture, and cleanup', async () => {
    if (!dockerAvailable()) {
      console.warn('Skipping real compose test: Docker not available');
      return;
    }
    const projectName = uniqueProject('csbox-real-success');
    const root = await mkdtemp(join(tmpdir(), 'csbox-real-'));
    try {
      const composeFile = join(root, 'docker-compose.yml');
      await writeFile(
        composeFile,
        `
services:
  hello:
    image: alpine:3.19
    command: ["sh", "-c", "while true; do echo hello; sleep 1; done"]
`.trim() + '\n',
        'utf8',
      );

      const evidenceDir = 'evidence';
      const options = {
        cwd: root,
        compose: { files: ['docker-compose.yml'], projectName },
        readiness: [{ type: 'service-running', service: 'hello' } as const],
        test: { executable: process.execPath, args: ['-e', 'console.log("test-ok"); process.exit(0)'] },
        evidence: { directory: evidenceDir, capture: 'always' as const, maxLogBytes: 65536, stripAnsi: true },
        cleanup: { volumes: true, removeOrphans: true },
        timeouts: { startupMs: 60000, readinessMs: 30000, testMs: 30000, cleanupMs: 30000 },
      };

      await runComposeSandbox(options);

      const evidencePath = join(root, evidenceDir);
      const files = await readdir(evidencePath);
      expect(files).toContain('ps.json');
      expect(files).toContain('logs.txt');
      expect(files).toContain('result.json');
      const manifestRaw = await readFile(join(evidencePath, 'result.json'), 'utf8');
      const manifest = JSON.parse(manifestRaw) as { outcome: string; phase: string; evidenceFiles: string[] };
      expect(manifest.outcome).toBe('success');
      expect(manifest.phase).toBe('cleanup');
      expect(manifest.evidenceFiles).toContain('result.json');
      const logs = await readFile(join(evidencePath, 'logs.txt'), 'utf8');
      expect(logs.length).toBeGreaterThan(0);
      const ps = await readFile(join(evidencePath, 'ps.json'), 'utf8');
      expect(ps.length).toBeGreaterThan(0);

      await assertNoLeak(projectName);
    } finally {
      spawnSync('docker', ['compose', '-p', projectName, 'down', '--volumes', '--remove-orphans'], {
        timeout: 10000,
        stdio: 'ignore',
      });
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it('verifies no leak after forced test failure and still captures evidence', async () => {
    if (!dockerAvailable()) {
      console.warn('Skipping real compose test (failure case): Docker not available');
      return;
    }
    const projectName = uniqueProject('csbox-real-fail');
    const root = await mkdtemp(join(tmpdir(), 'csbox-real-fail-'));
    try {
      const composeFile = join(root, 'docker-compose.yml');
      await writeFile(
        composeFile,
        `
services:
  sleeper:
    image: alpine:3.19
    command: ["sh", "-c", "while true; do echo sleeper; sleep 1; done"]
`.trim() + '\n',
        'utf8',
      );

      const evidenceDir = 'evidence-fail';
      const options = {
        cwd: root,
        compose: { files: ['docker-compose.yml'], projectName },
        readiness: [{ type: 'service-running', service: 'sleeper' } as const],
        test: { executable: process.execPath, args: ['-e', 'console.error("forced-fail"); process.exit(2)'] },
        evidence: { directory: evidenceDir, capture: 'onFailure' as const, maxLogBytes: 65536, stripAnsi: true },
        cleanup: { volumes: true, removeOrphans: true },
        timeouts: { startupMs: 60000, readinessMs: 30000, testMs: 30000, cleanupMs: 30000 },
      };

      let thrown: unknown;
      try {
        await runComposeSandbox(options);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      expect((thrown as Error).message).toMatch(/exitCode 2|failed/i);

      const evidencePath = join(root, evidenceDir);
      const files = await readdir(evidencePath);
      expect(files).toContain('result.json');
      expect(files).toContain('ps.json');
      expect(files).toContain('logs.txt');
      const manifest = JSON.parse(await readFile(join(evidencePath, 'result.json'), 'utf8')) as {
        outcome: string;
        errors: { primary: string };
      };
      expect(manifest.outcome).toBe('failure');
      expect(manifest.errors.primary).toMatch(/exitCode 2/);

      await assertNoLeak(projectName);
    } finally {
      spawnSync('docker', ['compose', '-p', projectName, 'down', '--volumes', '--remove-orphans'], {
        timeout: 10000,
        stdio: 'ignore',
      });
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
