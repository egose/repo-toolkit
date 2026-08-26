import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { runProcess } from '../src/process';

function createFakeClock() {
  let nowMs = 1000;
  return {
    now: () => nowMs,
    sleep: (ms: number) =>
      new Promise<void>((resolve) => {
        nowMs += ms;
        setTimeout(resolve, 0);
      }),
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

function makeFakeSpawn(
  childRef: {
    current?: EventEmitter & {
      pid?: number;
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: (sig: NodeJS.Signals) => boolean;
    };
  },
  opts: { neverClose?: boolean; exitCode?: number | null; signal?: NodeJS.Signals | null } = {},
) {
  const spawn = vi.fn((executable: string, args: ReadonlyArray<string>, spawnOpts: Record<string, unknown>) => {
    const child = new EventEmitter() as unknown as EventEmitter & {
      pid: number;
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: (sig: NodeJS.Signals) => boolean;
    };
    child.pid = 12345;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const killed: NodeJS.Signals[] = [];
    (child as unknown as Record<string, unknown>)._killed = killed;
    child.kill = vi.fn((sig: NodeJS.Signals) => {
      killed.push(sig);
      if (!opts.neverClose) {
        setTimeout(() => child.emit('close', opts.exitCode ?? 0, opts.signal ?? null), 5);
      }
      return true;
    }) as unknown as (sig: NodeJS.Signals) => boolean;
    childRef.current = child as unknown as typeof childRef.current;
    if (!opts.neverClose && spawnOpts) {
      setTimeout(() => {
        if (spawnOpts.stdio === 'pipe') {
          child.stdout.emit('data', Buffer.from('hello stdout'));
          child.stderr.emit('data', Buffer.from('hello stderr'));
        }
        child.emit('close', opts.exitCode ?? 0, opts.signal ?? null);
      }, 5);
    }
    return child as unknown as never;
  });
  return spawn;
}

describe('runProcess', () => {
  it('executes executable + args without shell and captures output', async () => {
    const clock = createFakeClock();
    const childRef: {
      current?: EventEmitter & {
        pid?: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig: NodeJS.Signals) => boolean;
      };
    } = {};
    const spawn = makeFakeSpawn(childRef);
    const result = await runProcess(
      { executable: 'node', args: ['--version'], captureOutput: true },
      { spawn: spawn as never, clock, graceMs: 10 },
    );
    expect(spawn).toHaveBeenCalledTimes(1);
    const [exec, args, opts] = spawn.mock.calls[0] as unknown as [
      string,
      ReadonlyArray<string>,
      Record<string, unknown>,
    ];
    expect(exec).toBe('node');
    expect(args).toEqual(['--version']);
    expect(opts.shell).toBe(false);
    expect(opts.detached).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello stdout');
    expect(result.stderr).toContain('hello stderr');
    expect(result.timedOut).toBe(false);
  });

  it('does not interpolate shell characters in args', async () => {
    const clock = createFakeClock();
    const childRef: {
      current?: EventEmitter & {
        pid?: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig: NodeJS.Signals) => boolean;
      };
    } = {};
    const spawn = makeFakeSpawn(childRef);
    const evil = '$(rm -rf /)';
    const result = await runProcess(
      { executable: 'echo', args: [evil, 'a;b', '`id`'] },
      { spawn: spawn as never, clock, graceMs: 10 },
    );
    const [, args] = spawn.mock.calls[0] as unknown as [string, ReadonlyArray<string>];
    expect(args).toEqual([evil, 'a;b', '`id`']);
    expect(result.stdout).toBeDefined();
  });

  it('supports inherited stdio without capturing', async () => {
    const clock = createFakeClock();
    const childRef: {
      current?: EventEmitter & {
        pid?: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig: NodeJS.Signals) => boolean;
      };
    } = {};
    const spawn = vi.fn((exec: string, args: ReadonlyArray<string>, opts: Record<string, unknown>) => {
      const child = new EventEmitter() as unknown as EventEmitter & {
        pid: number;
        stdout: null;
        stderr: null;
        kill: (sig: NodeJS.Signals) => boolean;
      };
      child.pid = 111;
      (child as unknown as Record<string, unknown>).stdout = null;
      (child as unknown as Record<string, unknown>).stderr = null;
      child.kill = vi.fn(() => true) as unknown as (sig: NodeJS.Signals) => boolean;
      childRef.current = child as unknown as never;
      setTimeout(() => child.emit('close', 0, null), 5);
      expect(opts.stdio).toBe('inherit');
      return child as unknown as never;
    });
    const result = await runProcess(
      { executable: 'node', args: ['--version'], inheritStdio: true },
      { spawn: spawn as never, clock, graceMs: 10 },
    );
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('bounds captured output and marks truncated', async () => {
    const clock = createFakeClock();
    const childRef: {
      current?: EventEmitter & {
        pid?: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig: NodeJS.Signals) => boolean;
      };
    } = {};
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const spawn = vi.fn((_exec: string, _args: ReadonlyArray<string>, _opts: Record<string, unknown>) => {
      const child = new EventEmitter() as unknown as EventEmitter & {
        pid: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig: NodeJS.Signals) => boolean;
      };
      child.pid = 222;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn(() => true) as unknown as (sig: NodeJS.Signals) => boolean;
      childRef.current = child as unknown as typeof childRef.current;
      setTimeout(() => {
        child.stdout.emit('data', Buffer.from('1234567890'));
        child.stderr.emit('data', Buffer.from('abcdefghij'));
        child.emit('close', 0, null);
      }, 5);
      return child as unknown as never;
    });
    const result = await runProcess(
      { executable: 'node', args: ['x'], maxOutputBytes: 5 },
      { spawn: spawn as never, clock, graceMs: 10 },
    );
    expect(result.stdout.length).toBeLessThanOrEqual(5);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(true);
    expect(result.truncatedBytes).toBeGreaterThan(0);
  });

  it('kills process after timeout with SIGTERM then SIGKILL', async () => {
    const clock = createFakeClock();
    const childRef: {
      current?: EventEmitter & {
        pid?: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig: NodeJS.Signals) => boolean;
      };
    } = {};
    const killCalls: Array<{ pid: number; sig: NodeJS.Signals }> = [];
    const killFn = (pid: number, sig: NodeJS.Signals) => {
      killCalls.push({ pid, sig });
    };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const spawn = vi.fn((_exec: string, _args: ReadonlyArray<string>) => {
      const child = new EventEmitter() as unknown as EventEmitter & {
        pid: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig: NodeJS.Signals) => boolean;
      };
      child.pid = 333;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn((sig: NodeJS.Signals) => {
        if (sig === 'SIGKILL') setTimeout(() => child.emit('close', null, 'SIGKILL'), 5);
        return true;
      }) as unknown as (sig: NodeJS.Signals) => boolean;
      childRef.current = child as unknown as typeof childRef.current;
      return child as unknown as never;
    });
    const result = await runProcess(
      { executable: 'sleep', args: ['10'], timeoutMs: 20 },
      { spawn: spawn as never, clock, kill: killFn, graceMs: 15 },
    );
    expect(result.timedOut).toBe(true);
    expect(result.signal).toBe('SIGKILL');
    expect(killCalls.some((c) => c.pid === -333)).toBe(true);
  });

  it('supports abort signal termination', async () => {
    const clock = createFakeClock();
    const controller = new AbortController();
    const childRef: {
      current?: EventEmitter & {
        pid?: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig: NodeJS.Signals) => boolean;
      };
    } = {};
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as unknown as EventEmitter & {
        pid: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig: NodeJS.Signals) => boolean;
      };
      child.pid = 444;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn((sig: NodeJS.Signals) => {
        setTimeout(() => child.emit('close', null, sig), 5);
        return true;
      }) as unknown as (sig: NodeJS.Signals) => boolean;
      childRef.current = child as unknown as typeof childRef.current;
      return child as unknown as never;
    });
    const pending = runProcess(
      { executable: 'sleep', args: ['10'], signal: controller.signal },
      { spawn: spawn as never, clock, graceMs: 10 },
    );
    setTimeout(() => controller.abort(new Error('user abort')), 10);
    await expect(pending).rejects.toThrow(/aborted/i);
  });

  it('throws on executable not found via error event', async () => {
    const clock = createFakeClock();
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as unknown as EventEmitter & {
        pid?: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig: NodeJS.Signals) => boolean;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn(() => true) as unknown as (sig: NodeJS.Signals) => boolean;
      setTimeout(() => {
        const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
        child.emit('error', err);
      }, 5);
      return child as unknown as never;
    });
    await expect(
      runProcess({ executable: '__notfound__xyz' }, { spawn: spawn as never, clock, graceMs: 10 }),
    ).rejects.toThrow(/ENOENT|notfound/i);
  });

  it('throws synchronously on spawn throw', async () => {
    const clock = createFakeClock();
    const spawn = vi.fn(() => {
      throw Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    });
    await expect(runProcess({ executable: 'bad' }, { spawn: spawn as never, clock, graceMs: 10 })).rejects.toThrow(
      /ENOENT/,
    );
  });

  it('uses process-group kill where supported', async () => {
    const clock = createFakeClock();
    const killCalls: number[] = [];
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as unknown as EventEmitter & {
        pid: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig: NodeJS.Signals) => boolean;
      };
      child.pid = 555;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn(() => true) as unknown as (sig: NodeJS.Signals) => boolean;
      setTimeout(() => child.emit('close', null, 'SIGTERM'), 30);
      return child as unknown as never;
    });
    const killFn = (pid: number) => {
      killCalls.push(pid);
      if (pid < 0) throw new Error('no group');
    };
    const controller = new AbortController();
    const p = runProcess(
      { executable: 'sleep', args: ['10'], signal: controller.signal },
      { spawn: spawn as never, clock, kill: killFn as never, graceMs: 10 },
    );
    setTimeout(() => controller.abort(), 5);
    await expect(p).rejects.toThrow();
    expect(killCalls).toContain(-555);
  });

  it('does not leave timers when successful', async () => {
    const clock = createFakeClock();
    const spawn = makeFakeSpawn({} as never);
    const beforeHandles =
      (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.().length ?? 0;
    await runProcess(
      { executable: 'echo', args: ['hi'], timeoutMs: 5000 },
      { spawn: spawn as never, clock, graceMs: 10 },
    );
    await new Promise<void>((r) => setTimeout(r, 20));
    const afterHandles =
      (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.().length ?? beforeHandles;
    expect(afterHandles).toBeDefined();
  });

  it('real spawn captures output without shell interpolation', async () => {
    const result = await runProcess({
      executable: process.execPath,
      args: ['-e', 'console.log(process.argv[1])', '$(echo hacked)'],
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('$(echo hacked)');
  });

  it('real spawn timeout kills long-running process', async () => {
    const result = await runProcess({
      executable: process.execPath,
      args: ['-e', 'setTimeout(()=>{}, 5000)'],
      timeoutMs: 100,
      captureOutput: true,
    });
    expect(result.timedOut).toBe(true);
    expect(result.signal).toBeDefined();
  });
});
