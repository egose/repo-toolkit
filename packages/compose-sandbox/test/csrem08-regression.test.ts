/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/ban-ts-comment, @typescript-eslint/no-unused-vars, no-useless-catch */
import { execSync, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { parseFlags } from '@repo-toolkit/publish-package';
import { resolveComposeSandboxPlan } from '../src/plan';
import { SPECS, resolveComposeSandboxCliOptions } from '../src/cli';
import { runComposeSandbox } from '../src/run';

const packageRoot = resolve(import.meta.dirname, '..');

describe('CSREM-08 regression: library vs CLI merge consistency', () => {
  it('equivalent config plus overrides produce same plan via CLI and library paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'csrem08-merge-'));
    try {
      const configPath = join(dir, 'config.json');
      await writeFile(
        configPath,
        JSON.stringify({
          cwd: dir,
          compose: { files: ['a.yml'], projectName: 'orig' },
          test: { executable: 'echo', args: ['hi'] },
          evidence: { directory: 'orig-logs' },
        }),
        'utf8',
      );
      await writeFile(join(dir, 'a.yml'), 'services: {}', 'utf8');

      const parsed = parseFlags(
        ['--config', configPath, '--project-name', 'newproj', '--evidence-dir', 'new-ev'],
        SPECS,
      );
      if (!parsed) throw new Error('parse null');
      const { plan: cliPlan } = await resolveComposeSandboxCliOptions(parsed);

      const libOptions = {
        config: configPath,
        cwd: dir,
        compose: { projectName: 'newproj' },
        evidence: { directory: 'new-ev' },
      };
      // library path: use runComposeSandbox's load-and-merge via internal helper if available, else simulate via plan resolution
      // After fix, library should deep-merge compose/evidence so files preserved
      // Before fix, library shallow-merges and loses files
      // We test by invoking a helper that will be unified: try importing the new unified loader
      let libPlan: any;
      try {
        const mod = await import('../src/run.js');
        // @ts-ignore try unified helper
        const loader =
          (mod as any).loadAndMergeComposeSandboxOptions ?? (mod as any).resolveComposeSandboxPlanWithConfig;
        if (loader) {
          const res = await loader(libOptions);
          libPlan = res.plan ?? resolveComposeSandboxPlan(res.merged ?? res.options ?? libOptions);
        } else {
          // fallback: directly test shallow vs expected deep behavior
          // This branch will be taken before fix and should fail
          const { loadConfigFile } = await import('@repo-toolkit/publish-package');
          const loaded = await loadConfigFile<Record<string, unknown>>(configPath, dir);
          const withoutConfig = { ...libOptions } as Record<string, unknown>;
          delete (withoutConfig as any).config;
          // shallow merge (old library behavior)
          const shallowMerged = { ...loaded, ...withoutConfig };
          // This will throw or lose files because shallow replaces compose
          try {
            libPlan = resolveComposeSandboxPlan(shallowMerged);
          } catch {
            libPlan = null;
          }
          // Expect libPlan to equal cliPlan (preserve files)
          expect(libPlan).not.toBeNull();
          expect(libPlan?.compose.files).toEqual(['a.yml']);
          expect(libPlan?.compose.projectName).toBe('newproj');
          expect(libPlan?.evidence.directory).toBe('new-ev');
        }
      } catch (e) {
        throw e;
      }

      if (libPlan) {
        expect(cliPlan.compose.files).toEqual(libPlan.compose.files);
        expect(cliPlan.compose.projectName).toBe(libPlan.compose.projectName);
        expect(cliPlan.evidence.directory).toBe(libPlan.evidence.directory);
      }
      expect(cliPlan.compose.files).toEqual(['a.yml']);
      expect(cliPlan.compose.projectName).toBe('newproj');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('nested compose evidence overrides preserve unrelated keys and config-inside-config rejected at both boundaries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'csrem08-nested-'));
    try {
      const configPath = join(dir, 'config.json');
      await writeFile(
        configPath,
        JSON.stringify({
          cwd: dir,
          compose: { files: ['a.yml'], projectName: 'orig', prefixArgs: ['compose'] },
          test: { executable: 'echo' },
          evidence: { directory: 'ev', maxLogBytes: 12345, capture: 'always' as const },
          config: './other.json',
        }),
        'utf8',
      );
      await writeFile(
        join(dir, 'other.json'),
        JSON.stringify({ cwd: dir, compose: { files: ['a.yml'] }, test: { executable: 'echo' } }),
        'utf8',
      );
      await writeFile(join(dir, 'a.yml'), 'services: {}', 'utf8');

      // CLI should reject config-inside-config
      const parsed = parseFlags(['--config', configPath], SPECS);
      if (!parsed) throw new Error('parse null');
      await expect(resolveComposeSandboxCliOptions(parsed)).rejects.toThrow(
        /config key is not allowed inside config file/i,
      );

      // Library should also reject same
      await expect(
        runComposeSandbox({ config: configPath, cwd: dir } as any, {
          runProcess: async () =>
            ({
              exitCode: 0,
              stdout: 'Docker Compose version v2',
              stderr: '',
              signal: null,
              durationMs: 0,
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              truncatedBytes: 0,
            }) as any,
          clock: { now: () => Date.now(), sleep: async () => {} } as any,
          signalTarget: { on: () => {}, off: () => {}, listenerCount: () => 0 } as any,
          fs: (await import('../src/fs.js')).createDefaultFs() as any,
        }),
      ).rejects.toThrow(/config key is not allowed inside config file/i);

      // nested merge: overriding only evidence capture should preserve directory/maxLogBytes
      const dir2 = await mkdtemp(join(tmpdir(), 'csrem08-nested2-'));
      try {
        const cfg2 = join(dir2, 'config2.json');
        await writeFile(
          cfg2,
          JSON.stringify({
            cwd: dir2,
            compose: { files: ['a.yml'], projectName: 'orig' },
            test: { executable: 'echo' },
            evidence: { directory: 'orig-ev', maxLogBytes: 9999, capture: 'always' },
          }),
          'utf8',
        );
        await writeFile(join(dir2, 'a.yml'), 'services: {}', 'utf8');
        const parsed2 = parseFlags(['--config', cfg2, '--evidence-dir', 'new-ev'], SPECS);
        if (!parsed2) throw new Error('parse null');
        const { plan: cliPlan2 } = await resolveComposeSandboxCliOptions(parsed2);
        expect(cliPlan2.evidence.directory).toBe('new-ev');
        expect(cliPlan2.evidence.maxLogBytes).toBe(9999);
        expect(cliPlan2.evidence.capture).toBe('always');
      } finally {
        await rm(dir2, { recursive: true, force: true });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('CLI preserves representative test exit codes while still proving cleanup occurred', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'csrem08-exitcode-'));
    try {
      const configPath = join(dir, 'config.json');
      await writeFile(
        configPath,
        JSON.stringify({
          cwd: dir,
          compose: { files: ['a.yml'] },
          test: { executable: process.execPath, args: ['-e', 'process.exit(5)'] },
          evidence: { directory: 'ev', capture: 'always' },
          cleanup: { paths: [] },
          timeouts: { startupMs: 5000, readinessMs: 5000, testMs: 5000, cleanupMs: 5000 },
        }),
        'utf8',
      );
      await writeFile(join(dir, 'a.yml'), 'services:\n  x:\n    image: alpine\n', 'utf8');
      // Build CLI helper that preserves exit code: after fix, cli main maps test exitCode 5 to process.exitCode 5
      // We test the mapping function directly if exported, otherwise test via spawned CLI with mocked deps not possible
      // Instead test that runComposeSandbox error carries exitCode and that CLI mapping (to be added) preserves it
      let cliExitCode: number | undefined;
      try {
        const cliMod: any = await import('../src/cli.js');
        if (typeof cliMod.getCliExitCode === 'function') {
          const err: any = new Error('test command failed with exitCode 5');
          err.exitCode = 5;
          cliExitCode = cliMod.getCliExitCode(err);
          expect(cliExitCode).toBe(5);
          const err2: any = new Error('validation failed');
          expect(cliMod.getCliExitCode(err2)).toBe(1);
          // lifecycle error wrapping test exit should also preserve
          const { ComposeSandboxLifecycleError } = await import('../src/lifecycle.js');
          const primary: any = new Error('test command failed with exitCode 7');
          primary.exitCode = 7;
          const lifecycleErr = new ComposeSandboxLifecycleError('test', primary);
          expect(cliMod.getCliExitCode(lifecycleErr)).toBe(7);
        } else {
          // Before fix, function missing => fail
          expect(cliMod.getCliExitCode).toBeDefined();
        }
      } catch (e) {
        throw e;
      }

      // Also prove cleanup occurred: library test with fake runProcess that captures down call
      let downCalled = false;
      const fakeRunProcess: any = async (opts: any) => {
        if (opts.args.join(' ').includes('down')) downCalled = true;
        if (opts.args.includes('version'))
          return {
            exitCode: 0,
            stdout: 'Docker Compose version v2',
            stderr: '',
            signal: null,
            durationMs: 1,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            truncatedBytes: 0,
          };
        if (opts.args.includes('up'))
          return {
            exitCode: 0,
            stdout: '',
            stderr: '',
            signal: null,
            durationMs: 1,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            truncatedBytes: 0,
          };
        if (opts.args.includes('ps') || opts.args.includes('logs'))
          return {
            exitCode: 0,
            stdout: '[]',
            stderr: '',
            signal: null,
            durationMs: 1,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            truncatedBytes: 0,
          };
        // test command
        return {
          exitCode: 5,
          stdout: '',
          stderr: '',
          signal: null,
          durationMs: 1,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          truncatedBytes: 0,
        };
      };
      await expect(
        runComposeSandbox({ config: configPath }, {
          runProcess: fakeRunProcess,
          clock: {
            now: () => Date.now(),
            sleep: async () => {},
            setTimeout: (cb: any, ms: any) => setTimeout(cb, ms),
            clearTimeout: (h: any) => clearTimeout(h as any),
          } as any,
          signalTarget: { on: () => {}, off: () => {}, removeListener: () => {}, listenerCount: () => 0 } as any,
        } as any),
      ).rejects.toThrow(/exitCode 5/);
      expect(downCalled).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('RunResult and runComposeSandbox declarations no longer contradict', async () => {
    const dts = await readFile(join(packageRoot, 'dist', 'index.d.ts'), 'utf8');
    expect(dts).toContain('RunResult');
    // runComposeSandbox should return Promise<RunResult>
    expect(dts).toMatch(/runComposeSandbox[^;]*Promise<RunResult>/);
    expect(dts).not.toMatch(/runComposeSandbox[^;]*Promise<void>/);

    // runtime returns RunResult on success
    const dir = await mkdtemp(join(tmpdir(), 'csrem08-result-'));
    try {
      const { createDefaultFs } = await import('../src/fs.js');
      await writeFile(join(dir, 'a.yml'), 'services: {}', 'utf8');
      const fakeRunProcess: any = async (opts: any) => {
        if (opts.args.includes('version'))
          return {
            exitCode: 0,
            stdout: 'Docker Compose version v2',
            stderr: '',
            signal: null,
            durationMs: 1,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            truncatedBytes: 0,
          };
        if (opts.args.includes('up') || opts.args.includes('down'))
          return {
            exitCode: 0,
            stdout: '',
            stderr: '',
            signal: null,
            durationMs: 1,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            truncatedBytes: 0,
          };
        if (opts.args.includes('ps') || opts.args.includes('logs'))
          return {
            exitCode: 0,
            stdout: '[]',
            stderr: '',
            signal: null,
            durationMs: 1,
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            truncatedBytes: 0,
          };
        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          signal: null,
          durationMs: 1,
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          truncatedBytes: 0,
        };
      };
      const result: any = await runComposeSandbox(
        {
          cwd: dir,
          compose: { files: ['a.yml'] },
          test: { executable: process.execPath, args: ['-e', 'process.exit(0)'] },
          evidence: { directory: 'ev', capture: 'always' },
          cleanup: { paths: [] },
        },
        {
          runProcess: fakeRunProcess,
          clock: {
            now: () => Date.now(),
            sleep: async () => {},
            setTimeout: (cb: any, ms: any) => setTimeout(cb, ms),
            clearTimeout: (h: any) => clearTimeout(h as any),
          } as any,
          signalTarget: { on: () => {}, off: () => {}, removeListener: () => {}, listenerCount: () => 0 } as any,
        } as any,
      );
      expect(result).toBeDefined();
      expect(result.outcome).toBe('success');
      expect(result.phase).toBeDefined();
      expect(result.evidenceFiles).toBeDefined();
      expect(result.manifestPath).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('supported export list documented and protected by contract test', async () => {
    const exported = execSync(
      `node --input-type=module --eval "import('./dist/index.js').then(m=>console.log(Object.keys(m).sort().join(',')))"`,
      { cwd: packageRoot, encoding: 'utf8' },
    ).trim();
    const names = exported.split(',').filter(Boolean);
    const allowed = new Set([
      'ComposeSandboxLifecycleError',
      'resolveComposeSandboxPlan',
      'runComposeSandbox',
      'loadAndMergeComposeSandboxOptions',
      'mergeComposeSandboxOptions',
    ]);
    for (const n of names) {
      expect(allowed.has(n)).toBe(true);
    }
    expect(names).toContain('resolveComposeSandboxPlan');
    expect(names).toContain('runComposeSandbox');
    expect(names).toContain('loadAndMergeComposeSandboxOptions');
    expect(names).toContain('mergeComposeSandboxOptions');
    // low-level should NOT be in root
    expect(names).not.toContain('runProcess');
    expect(names).not.toContain('runLifecycle');
    expect(names).not.toContain('buildComposeArgs');
    expect(names).not.toContain('waitForReadiness');
    // README documents same list
    const readme = await readFile(join(packageRoot, 'README.md'), 'utf8');
    expect(readme).toContain('resolveComposeSandboxPlan');
    expect(readme).toContain('runComposeSandbox');
    expect(readme).toContain('loadAndMergeComposeSandboxOptions');
  });

  it('built declaration consumer tests against dist output', async () => {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `
      import { resolveComposeSandboxPlan, runComposeSandbox } from './dist/index.js';
      const plan = resolveComposeSandboxPlan({ cwd: '.', compose: { files: ['a.yml'] }, test: { executable: 'echo' } });
      if (!plan) throw new Error('no plan');
      if (typeof runComposeSandbox !== 'function') throw new Error('no runner');
      console.log('ok');
    `,
      ],
      { cwd: packageRoot, encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ok');
    // CLI dry-run built output
    const cli = spawnSync(process.execPath, [join(packageRoot, 'dist', 'cli.js'), '--help'], { encoding: 'utf8' });
    expect(cli.status).toBe(0);
    expect(cli.stdout).toContain('repo-toolkit-compose-sandbox');
    const dts = await readFile(join(packageRoot, 'dist', 'index.d.ts'), 'utf8');
    expect(dts).toContain('resolveComposeSandboxPlan');
    expect(dts).toContain('runComposeSandbox');
    expect(dts).toContain('RunResult');
    expect(dts).toContain('ComposeSandboxLifecycleError');
  });

  it('built CLI integration preserves test exitCode while still proving cleanup occurred', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'csrem08-cli-int-'));
    try {
      const marker = join(dir, 'down.marker');
      const shim = join(dir, 'fake-docker.js');
      await writeFile(
        shim,
        `#!/usr/bin/env node
const fs=require('fs');
const args=process.argv.slice(2);
const marker=process.env.FAKE_DOWN_MARKER;
if(args.includes('version')){ console.log('Docker Compose version v2.27.0'); process.exit(0); }
if(args.includes('up')){ process.exit(0); }
if(args.includes('ps')){ console.log('[]'); process.exit(0); }
if(args.includes('logs')){ console.log('fake logs'); process.exit(0); }
if(args.includes('down')){ if(marker) fs.writeFileSync(marker,'down'); process.exit(0); }
console.error('unknown',args.join(' ')); process.exit(1);
`,
        'utf8',
      );
      await writeFile(join(dir, 'a.yml'), 'services: {}', 'utf8');
      const configPath = join(dir, 'config.json');
      await writeFile(
        configPath,
        JSON.stringify({
          cwd: dir,
          compose: { files: ['a.yml'], executable: process.execPath, prefixArgs: [shim] },
          test: { executable: process.execPath, args: ['-e', 'process.exit(42)'] },
          evidence: { directory: 'ev', capture: 'always' },
          cleanup: { paths: [] },
          timeouts: { startupMs: 5000, readinessMs: 5000, testMs: 5000, cleanupMs: 5000 },
        }),
        'utf8',
      );
      const cliPath = join(packageRoot, 'dist', 'cli.js');
      const res = spawnSync(process.execPath, [cliPath, '--config', configPath], {
        encoding: 'utf8',
        env: { ...process.env, FAKE_DOWN_MARKER: marker },
      });
      expect(res.status).toBe(42);
      const markerContent = await readFile(marker, 'utf8').catch(() => '');
      expect(markerContent).toBe('down');
      const manifest = await readFile(join(dir, 'ev', 'result.json'), 'utf8');
      expect(manifest).toContain('"outcome"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
