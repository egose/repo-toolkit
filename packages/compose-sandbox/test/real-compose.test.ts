/* eslint-disable preserve-caught-error */
import { spawnSync, execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile, rm, readdir, access, mkdir, symlink } from 'node:fs/promises';
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

const requireRealCompose = process.env.COMPOSE_SANDBOX_REQUIRE_DOCKER === '1';
const realComposeAvailable = dockerAvailable();
const dockerUnavailableReason =
  'Docker Compose unavailable; set COMPOSE_SANDBOX_REQUIRE_DOCKER=1 in CI/release verification to fail instead of skip';
const realComposeIt = !realComposeAvailable && !requireRealCompose ? it.skip : it;

function requireDockerCompose(): void {
  if (!realComposeAvailable) {
    throw new Error(dockerUnavailableReason);
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

async function assertMissing(path: string): Promise<void> {
  try {
    await access(path);
  } catch {
    return;
  }
  throw new Error(`Managed path remains after cleanup: ${path}`);
}

async function assertFinallyClean(projectName: string, root: string, managedPaths: string[] = []): Promise<void> {
  let leakError: unknown;
  try {
    await assertNoLeak(projectName);
    for (const managedPath of managedPaths) {
      await assertMissing(managedPath);
    }
  } catch (err) {
    leakError = err;
  }
  spawnSync('docker', ['compose', '-p', projectName, 'down', '--volumes', '--remove-orphans'], {
    timeout: 10000,
    stdio: 'ignore',
  });
  await rm(root, { recursive: true, force: true });
  if (leakError) throw leakError;
}

async function writeLoopingCompose(root: string, service: string): Promise<void> {
  await writeFile(
    join(root, 'docker-compose.yml'),
    `
services:
  ${service}:
    image: alpine:3.19
    command: ["sh", "-c", "while true; do echo ${service}; sleep 1; done"]
`.trim() + '\n',
    'utf8',
  );
}

describe('real compose integration', () => {
  realComposeIt(
    `proves startup, readiness, test execution, evidence capture, and cleanup${realComposeAvailable ? '' : ` (skipped: ${dockerUnavailableReason})`}`,
    async () => {
      requireDockerCompose();
      const projectName = uniqueProject('csbox-real-success');
      const root = await mkdtemp(join(tmpdir(), 'csbox-real-'));
      const managedPath = join(root, 'managed-data');
      try {
        await writeLoopingCompose(root, 'hello');

        const evidenceDir = 'evidence';
        const options = {
          cwd: root,
          compose: { files: ['docker-compose.yml'], projectName },
          prepare: { directories: ['managed-data'] },
          readiness: [{ type: 'service-running', service: 'hello' } as const],
          test: { executable: process.execPath, args: ['-e', 'console.log("test-ok"); process.exit(0)'] },
          evidence: { directory: evidenceDir, capture: 'always' as const, maxLogBytes: 65536, stripAnsi: true },
          cleanup: { volumes: true, removeOrphans: true, paths: ['managed-data'] },
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
      } finally {
        await assertFinallyClean(projectName, root, [managedPath]);
      }
    },
    120_000,
  );

  realComposeIt(
    `verifies no leak after forced test failure and still captures evidence${realComposeAvailable ? '' : ` (skipped: ${dockerUnavailableReason})`}`,
    async () => {
      requireDockerCompose();
      const projectName = uniqueProject('csbox-real-fail');
      const root = await mkdtemp(join(tmpdir(), 'csbox-real-fail-'));
      try {
        await writeLoopingCompose(root, 'sleeper');

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
      } finally {
        await assertFinallyClean(projectName, root);
      }
    },
    120_000,
  );

  realComposeIt(
    `verifies timeout cleanup terminates child processes and removes managed paths${realComposeAvailable ? '' : ` (skipped: ${dockerUnavailableReason})`}`,
    async () => {
      requireDockerCompose();
      const projectName = uniqueProject('csbox-real-timeout');
      const root = await mkdtemp(join(tmpdir(), 'csbox-real-timeout-'));
      const marker = join(root, 'child-marker');
      const managedPath = join(root, 'timeout-data');
      try {
        await writeLoopingCompose(root, 'timeoutsvc');
        const childScript = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'leaked'), 4000); setInterval(() => {}, 1000);`;
        const parentScript = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: 'ignore' }); setInterval(() => {}, 1000);`;

        let thrown: unknown;
        try {
          await runComposeSandbox({
            cwd: root,
            compose: { files: ['docker-compose.yml'], projectName },
            prepare: { directories: ['timeout-data'] },
            readiness: [{ type: 'service-running', service: 'timeoutsvc' } as const],
            test: { executable: process.execPath, args: ['-e', parentScript] },
            evidence: { directory: 'evidence-timeout', capture: 'onFailure' as const, maxLogBytes: 65536 },
            cleanup: { volumes: true, removeOrphans: true, paths: ['timeout-data'] },
            timeouts: { startupMs: 60000, readinessMs: 30000, testMs: 1000, cleanupMs: 30000 },
          });
        } catch (e) {
          thrown = e;
        }
        expect(thrown).toBeDefined();
        expect((thrown as Error).message).toMatch(/timed out/i);
        await new Promise((resolve) => setTimeout(resolve, 4500));
        await assertMissing(marker);

        const manifest = JSON.parse(await readFile(join(root, 'evidence-timeout', 'result.json'), 'utf8')) as {
          outcome: string;
          errors: { primary: string };
        };
        expect(manifest.outcome).toBe('failure');
        expect(manifest.errors.primary).toMatch(/timed out/i);
      } finally {
        await assertFinallyClean(projectName, root, [managedPath]);
      }
    },
    120_000,
  );

  realComposeIt(
    `verifies signal cleanup removes services and writes failure evidence${realComposeAvailable ? '' : ` (skipped: ${dockerUnavailableReason})`}`,
    async () => {
      requireDockerCompose();
      const projectName = uniqueProject('csbox-real-signal');
      const root = await mkdtemp(join(tmpdir(), 'csbox-real-signal-'));
      const signalTarget = new EventEmitter() as EventEmitter & {
        on(event: 'SIGINT' | 'SIGTERM', handler: () => void): void;
        off(event: 'SIGINT' | 'SIGTERM', handler: () => void): void;
      };
      let timer: NodeJS.Timeout | undefined;
      try {
        await writeLoopingCompose(root, 'signalsvc');
        timer = setTimeout(() => signalTarget.emit('SIGTERM'), 2000);

        let thrown: unknown;
        try {
          await runComposeSandbox(
            {
              cwd: root,
              compose: { files: ['docker-compose.yml'], projectName },
              readiness: [{ type: 'service-running', service: 'signalsvc' } as const],
              test: { executable: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] },
              evidence: { directory: 'evidence-signal', capture: 'onFailure' as const, maxLogBytes: 65536 },
              cleanup: { volumes: true, removeOrphans: true },
              timeouts: { startupMs: 60000, readinessMs: 30000, testMs: 30000, cleanupMs: 30000 },
            },
            { signalTarget },
          );
        } catch (e) {
          thrown = e;
        }
        expect(thrown).toBeDefined();
        expect((thrown as Error).message).toMatch(/SIGTERM|aborted/i);
        expect(signalTarget.listenerCount('SIGINT')).toBe(0);
        expect(signalTarget.listenerCount('SIGTERM')).toBe(0);

        const manifest = JSON.parse(await readFile(join(root, 'evidence-signal', 'result.json'), 'utf8')) as {
          outcome: string;
          errors: { primary: string };
        };
        expect(manifest.outcome).toBe('failure');
        expect(manifest.errors.primary).toMatch(/SIGTERM|aborted/i);
      } finally {
        if (timer) clearTimeout(timer);
        await assertFinallyClean(projectName, root);
      }
    },
    120_000,
  );

  realComposeIt(
    `verifies symlinked cleanup paths cannot escape the project${realComposeAvailable ? '' : ` (skipped: ${dockerUnavailableReason})`}`,
    async () => {
      requireDockerCompose();
      const projectName = uniqueProject('csbox-real-path');
      const root = await mkdtemp(join(tmpdir(), 'csbox-real-path-'));
      const outside = await mkdtemp(join(tmpdir(), 'csbox-real-outside-'));
      const outsideVictim = join(outside, 'victim');
      try {
        await writeLoopingCompose(root, 'pathsvc');
        await mkdir(outsideVictim);
        await writeFile(join(outsideVictim, 'sentinel.txt'), 'keep', 'utf8');
        await symlink(outside, join(root, 'alias'), 'dir');

        let thrown: unknown;
        try {
          await runComposeSandbox({
            cwd: root,
            compose: { files: ['docker-compose.yml'], projectName },
            readiness: [{ type: 'service-running', service: 'pathsvc' } as const],
            test: { executable: process.execPath, args: ['-e', 'process.exit(0)'] },
            evidence: { directory: 'evidence-path', capture: 'always' as const, maxLogBytes: 65536 },
            cleanup: { volumes: true, removeOrphans: true, paths: ['alias/victim'] },
            timeouts: { startupMs: 60000, readinessMs: 30000, testMs: 30000, cleanupMs: 30000 },
          });
        } catch (e) {
          thrown = e;
        }
        expect(thrown).toBeDefined();
        expect((thrown as Error).message).toMatch(/escapes|outside/i);
        await expect(readFile(join(outsideVictim, 'sentinel.txt'), 'utf8')).resolves.toBe('keep');
      } finally {
        try {
          await assertFinallyClean(projectName, root);
        } finally {
          await rm(outside, { recursive: true, force: true });
        }
      }
    },
    120_000,
  );
});
