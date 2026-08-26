import { writeFile, mkdtemp, rm, symlink, readFile, lstat as realLstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';

import { prepareSandbox } from '../src/compose';
import { resolveComposeSandboxPlan } from '../src/plan';
import { runComposeSandbox } from '../src/run';
import type { SandboxFs } from '../src/fs';

function fakeClock() {
  let nowMs = 1000;
  return {
    now: () => nowMs,
    sleep: async (ms: number) => {
      nowMs += ms;
    },
  };
}

import { EventEmitter } from 'node:events';
import type { SignalTarget } from '../src/lifecycle';

function fakeSignalTarget(): SignalTarget & EventEmitter {
  const ee = new EventEmitter() as SignalTarget & EventEmitter;
  // @ts-expect-error bind exists
  ee.on = ee.on.bind(ee);
  if (!ee.off) ee.off = ee.removeListener.bind(ee) as never;
  return ee as never;
}

async function makeTempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fs-containment-'));
  return dir;
}

function makeFakeRunProcess() {
  return vi.fn(async (opts: { executable: string; args: ReadonlyArray<string>; signal?: AbortSignal }) => {
    if (opts.signal?.aborted) throw opts.signal.reason ?? new Error('aborted');
    if (opts.args.includes('version')) {
      return {
        exitCode: 0,
        stdout: 'Docker Compose version v2.27.0',
        stderr: '',
        signal: null,
        durationMs: 10,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        truncatedBytes: 0,
      };
    }
    if (
      opts.args.includes('up') ||
      opts.args.includes('ps') ||
      opts.args.includes('logs') ||
      opts.args.includes('down')
    ) {
      const isPs = opts.args.includes('ps');
      return {
        exitCode: 0,
        stdout: isPs ? JSON.stringify([{ Service: 'api', State: 'running', Status: 'Up' }]) : 'log line',
        stderr: '',
        signal: null,
        durationMs: 10,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        truncatedBytes: 0,
      };
    }
    return {
      exitCode: 0,
      stdout: '',
      stderr: '',
      signal: null,
      durationMs: 10,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      truncatedBytes: 0,
    };
  });
}

describe('filesystem containment', () => {
  it('prepare directories rejects symlinked ancestor and preserves outside', async () => {
    const root = await makeTempRoot();
    const outside = await makeTempRoot();
    try {
      const alias = join(root, 'alias');
      await symlink(outside, alias);
      const outsideFile = join(outside, 'keep.txt');
      await writeFile(outsideFile, 'keep');
      const plan = resolveComposeSandboxPlan({
        cwd: root,
        compose: { files: ['a.yml'] },
        prepare: { directories: ['alias/victim'] },
        test: { executable: 'echo' },
      } as unknown as Record<string, unknown>);
      await expect(prepareSandbox(plan)).rejects.toThrow(/escapes|outside/);
      const content = await readFile(outsideFile, 'utf8');
      expect(content).toBe('keep');
      // victim should not have been created outside
      const leaked = join(outside, 'victim');
      await expect(realLstat(leaked)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('prepare copy dest rejects symlinked ancestor and preserves outside', async () => {
    const root = await makeTempRoot();
    const outside = await makeTempRoot();
    try {
      const alias = join(root, 'alias');
      await symlink(outside, alias);
      const outsideFile = join(outside, 'keep.txt');
      await writeFile(outsideFile, 'keep');
      await writeFile(join(root, 'src.txt'), 'src');
      const plan = resolveComposeSandboxPlan({
        cwd: root,
        compose: { files: ['a.yml'] },
        prepare: { copies: [{ from: 'src.txt', to: 'alias/dest.txt' }] },
        test: { executable: 'echo' },
      } as unknown as Record<string, unknown>);
      await expect(prepareSandbox(plan)).rejects.toThrow(/escapes|outside/);
      expect(await readFile(outsideFile, 'utf8')).toBe('keep');
      await expect(realLstat(join(outside, 'dest.txt'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('evidence directory rejects symlinked ancestor and preserves outside', async () => {
    const root = await makeTempRoot();
    const outside = await makeTempRoot();
    try {
      const alias = join(root, 'alias');
      await symlink(outside, alias);
      const outsideFile = join(outside, 'keep.txt');
      await writeFile(outsideFile, 'keep');
      const runProcess = makeFakeRunProcess();
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget() as never;
      const options = {
        cwd: root,
        compose: { files: ['a.yml'] },
        test: { executable: process.execPath, args: ['-e', 'process.exit(0)'] },
        evidence: { directory: 'alias/evidence', capture: 'always' },
        cleanup: { paths: [] },
        timeouts: { startupMs: 5000, readinessMs: 5000, testMs: 5000, cleanupMs: 5000 },
      };
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      expect(String((thrown as Error).message)).toMatch(/escapes|outside/);
      expect(await readFile(outsideFile, 'utf8')).toBe('keep');
      await expect(realLstat(join(outside, 'evidence'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('cleanup path rejects symlinked ancestor and preserves outside', async () => {
    const root = await makeTempRoot();
    const outside = await makeTempRoot();
    try {
      const alias = join(root, 'alias');
      await symlink(outside, alias);
      const outsideFile = join(outside, 'keep.txt');
      await writeFile(outsideFile, 'keep');
      const runProcess = makeFakeRunProcess();
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget() as never;
      const options = {
        cwd: root,
        compose: { files: ['a.yml'] },
        test: { executable: process.execPath, args: ['-e', 'process.exit(0)'] },
        evidence: { directory: 'evidence', capture: 'always' },
        cleanup: { paths: ['alias/victim'] },
      };
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      expect(String((thrown as Error).message)).toMatch(/escapes|outside/);
      expect(await readFile(outsideFile, 'utf8')).toBe('keep');
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('manifest write rejects symlinked evidence ancestor and preserves outside', async () => {
    const root = await makeTempRoot();
    const outside = await makeTempRoot();
    try {
      const alias = join(root, 'alias');
      await symlink(outside, alias);
      const outsideFile = join(outside, 'keep.txt');
      await writeFile(outsideFile, 'keep');
      const runProcess = makeFakeRunProcess();
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget() as never;
      const options = {
        cwd: root,
        compose: { files: ['a.yml'] },
        test: { executable: process.execPath, args: ['-e', 'process.exit(0)'] },
        evidence: { directory: 'alias/ev', capture: 'always' },
        cleanup: { paths: [] },
      };
      let thrown: unknown;
      try {
        await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeDefined();
      expect(String((thrown as Error).message)).toMatch(/escapes|outside/);
      expect(await readFile(outsideFile, 'utf8')).toBe('keep');
      await expect(realLstat(join(outside, 'ev', 'result.json'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('EACCES during lstat fails closed and does not invoke mkdir/write/rm', async () => {
    const root = resolve('/tmp/fake-root-eacces');
    const plan = resolveComposeSandboxPlan({
      cwd: root,
      compose: { files: ['a.yml'] },
      prepare: { directories: ['data/sub'] },
      test: { executable: 'echo' },
      evidence: { directory: 'evidence', capture: 'always' },
      cleanup: { paths: ['to-clean'] },
    } as unknown as Record<string, unknown>);
    const mkdir = vi.fn(async () => {});
    const writeFileFn = vi.fn(async () => {});
    const rmFn = vi.fn(async () => {});
    const copyFile = vi.fn(async () => {});
    const access = vi.fn(async () => {});
    const lstat = vi.fn(async () => {
      const err = new Error('permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });
    const realpath = vi.fn(async (p: string) => p);
    const fs: SandboxFs = { mkdir, writeFile: writeFileFn, copyFile, access, lstat, realpath, rm: rmFn };
    // prepare should fail closed
    await expect(prepareSandbox(plan, { fs })).rejects.toThrow(/EACCES|permission/i);
    expect(mkdir).not.toHaveBeenCalled();
    expect(copyFile).not.toHaveBeenCalled();

    // evidence path via runComposeSandbox: use fake runProcess and fs that fails on lstat
    const runProcess = makeFakeRunProcess();
    const clock = fakeClock();
    const signalTarget = fakeSignalTarget() as never;
    const options = {
      cwd: root,
      compose: { files: ['a.yml'] },
      test: { executable: process.execPath, args: ['-e', 'process.exit(0)'] },
      evidence: { directory: 'evidence', capture: 'always' },
      cleanup: { paths: [] },
    };
    // Need realRoot to succeed, but lstat will fail for evidence dir check; we make realpath succeed for root but lstat fail for target
    const fs2: SandboxFs = {
      mkdir: mkdir,
      writeFile: writeFileFn,
      copyFile,
      access,
      lstat,
      realpath: vi.fn(async (p: string) => {
        if (p === root) return root;
        // for evidence dir's nearest ancestor, make lstat fail before realpath? but ensurePathInsideRoot calls lstat first, so it will throw EACCES before realpath
        return p;
      }),
      rm: rmFn,
    };
    // Use plan with evidence inside root, but lstat fails
    let thrown2: unknown;
    try {
      await runComposeSandbox(options, { clock, signalTarget, runProcess: runProcess as never, fs: fs2 });
    } catch (e) {
      thrown2 = e;
    }
    expect(thrown2).toBeDefined();
    expect(writeFileFn).not.toHaveBeenCalled();
  });

  it('EIO during metadata fails closed and does not invoke write/copy/delete', async () => {
    const root = resolve('/tmp/fake-root-eio');
    const plan = resolveComposeSandboxPlan({
      cwd: root,
      compose: { files: ['a.yml'] },
      prepare: { copies: [{ from: 'a.txt', to: 'out.txt' }] },
      test: { executable: 'echo' },
    } as unknown as Record<string, unknown>);
    const mkdir = vi.fn(async () => {});
    const writeFileFn = vi.fn(async () => {});
    const rmFn = vi.fn(async () => {});
    const copyFile = vi.fn(async () => {});
    const access = vi.fn(async () => {});
    const lstat = vi.fn(async () => {
      const err = new Error('i/o error') as NodeJS.ErrnoException;
      err.code = 'EIO';
      throw err;
    });
    const realpath = vi.fn(async (p: string) => p);
    const fs: SandboxFs = { mkdir, writeFile: writeFileFn, copyFile, access, lstat, realpath, rm: rmFn };
    await expect(prepareSandbox(plan, { fs })).rejects.toThrow(/EIO|i\/o/i);
    expect(mkdir).not.toHaveBeenCalled();
    expect(copyFile).not.toHaveBeenCalled();
    expect(writeFileFn).not.toHaveBeenCalled();
    expect(rmFn).not.toHaveBeenCalled();
  });

  it('typed ENOENT is idempotent for cleanup of missing path', async () => {
    const root = await makeTempRoot();
    try {
      const plan = {
        cwd: root,
        compose: { files: ['a.yml'] },
        test: { executable: process.execPath, args: ['-e', 'process.exit(0)'] },
        evidence: { directory: 'evidence', capture: 'always' },
        cleanup: { paths: ['missing-dir'] },
      };
      const runProcess = makeFakeRunProcess();
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget() as never;
      const result = await runComposeSandbox(plan, { clock, signalTarget, runProcess: runProcess as never });
      expect(result.outcome).toBe('success');
      expect(result.phase).toBe('cleanup');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fully typed injected FS can execute without casts', async () => {
    const cwd = resolve('.');
    const plan = resolveComposeSandboxPlan({
      cwd: '.',
      compose: { files: ['a.yml'] },
      prepare: { directories: ['typed/dir'] },
      test: { executable: 'echo' },
    } as unknown as Record<string, unknown>);
    const mkdir = vi.fn(async () => {});
    const copyFile = vi.fn(async () => {});
    const access = vi.fn(async () => {});
    const lstat = vi.fn(async () => ({ isSymbolicLink: () => false }));
    const realpath = vi.fn(async (p: string) => p);
    const writeFileFn = vi.fn(async () => {});
    const rmFn = vi.fn(async () => {});
    const fs: SandboxFs = { mkdir, writeFile: writeFileFn, copyFile, access, lstat, realpath, rm: rmFn };
    await prepareSandbox(plan, { fs });
    // also test runComposeSandbox with same fs and fake runProcess
    const root = await makeTempRoot();
    try {
      const opts = {
        cwd: root,
        compose: { files: ['a.yml'] },
        test: { executable: process.execPath, args: ['-e', 'process.exit(0)'] },
        evidence: { directory: 'evidence', capture: 'always' },
        cleanup: { paths: [] },
      };
      const runProcess = makeFakeRunProcess();
      const clock = fakeClock();
      const signalTarget = fakeSignalTarget() as never;
      // use a fs that realpaths correctly for temp root
      const realFs: SandboxFs = {
        mkdir: async (p, o) => mkdir(p, o),
        writeFile: writeFileFn,
        copyFile,
        access,
        lstat: async (p) => {
          try {
            const st = await realLstat(p);
            return { isSymbolicLink: () => st.isSymbolicLink() };
          } catch (err) {
            const e = err as NodeJS.ErrnoException;
            if (e.code === 'ENOENT') throw err;
            throw err;
          }
        },
        realpath: async (p) => {
          const { realpath: rp } = await import('node:fs/promises');
          return rp(p);
        },
        rm: rmFn,
      };
      // This should execute without casts
      await runComposeSandbox(opts, { clock, signalTarget, runProcess: runProcess as never, fs: realFs });
      expect(mkdir).toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    void cwd;
  });

  it('non-existing final component validates nearest existing ancestor', async () => {
    const root = await makeTempRoot();
    const outside = await makeTempRoot();
    try {
      // create alias symlink to outside, but evidence dir is alias/new/sub where new does not exist yet, alias exists
      const alias = join(root, 'alias');
      await symlink(outside, alias);
      const outsideFile = join(outside, 'keep.txt');
      await writeFile(outsideFile, 'keep');
      const plan = resolveComposeSandboxPlan({
        cwd: root,
        compose: { files: ['a.yml'] },
        prepare: { directories: ['alias/new/sub'] },
        test: { executable: 'echo' },
      } as unknown as Record<string, unknown>);
      await expect(prepareSandbox(plan)).rejects.toThrow(/escapes|outside/);
      expect(await readFile(outsideFile, 'utf8')).toBe('keep');
      await expect(realLstat(join(outside, 'new'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

// compile-time check: omitting required FS op should be error
// @ts-expect-error missing rm
const _badFs1: SandboxFs = {
  mkdir: async () => {},
  writeFile: async () => {},
  copyFile: async () => {},
  access: async () => {},
  lstat: async () => ({ isSymbolicLink: () => false }),
  realpath: async () => '',
};

// @ts-expect-error missing lstat
const _badFs2: SandboxFs = {
  mkdir: async () => {},
  writeFile: async () => {},
  copyFile: async () => {},
  access: async () => {},
  realpath: async () => '',
  rm: async () => {},
};
void _badFs1;
void _badFs2;
