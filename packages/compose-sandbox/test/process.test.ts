import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import { runProcess, isProcessSuccess, truncateUtf8ToBytes } from '../src/process';

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
    const closeCode = opts.exitCode !== undefined ? opts.exitCode : 0;
    const closeSig = opts.signal !== undefined ? opts.signal : null;
    child.kill = vi.fn((sig: NodeJS.Signals) => {
      killed.push(sig);
      if (!opts.neverClose) {
        setTimeout(() => child.emit('close', closeCode, closeSig), 5);
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
        child.emit('close', closeCode, closeSig);
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
    expect(opts.detached).toBe(process.platform === 'win32' ? false : true);
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
    const getHandles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles;
    const beforeHandles = getHandles ? getHandles().length : 0;
    const beforeListeners = process.listenerCount('SIGINT');
    await runProcess(
      { executable: 'echo', args: ['hi'], timeoutMs: 5000 },
      { spawn: spawn as never, clock, graceMs: 10 },
    );
    await new Promise<void>((r) => setTimeout(r, 20));
    const afterHandles = getHandles ? getHandles().length : beforeHandles;
    const afterListeners = process.listenerCount('SIGINT');
    expect(afterHandles).toBe(beforeHandles);
    expect(afterListeners).toBe(beforeListeners);
  });

  it('SIGTERM-killed child cannot satisfy success predicate', async () => {
    const childRef: {
      current?: EventEmitter & {
        pid?: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig: NodeJS.Signals) => boolean;
      };
    } = {};
    const spawn = makeFakeSpawn(childRef, { exitCode: null, signal: 'SIGTERM' });
    const result = await runProcess(
      { executable: 'node', args: ['-e', 'process.kill(process.pid,"SIGTERM")'] },
      { spawn: spawn as never, graceMs: 10 },
    );
    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe('SIGTERM');
    expect(isProcessSuccess(result)).toBe(false);
  });

  it('timed-out cannot be successful even with null close code', async () => {
    const clock = createFakeClock();
    const killCalls: Array<{ pid: number; sig: NodeJS.Signals }> = [];
    const killFn = (pid: number, sig: NodeJS.Signals) => {
      killCalls.push({ pid, sig });
    };
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as unknown as EventEmitter & {
        pid: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig: NodeJS.Signals) => boolean;
      };
      child.pid = 3333;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn((sig: NodeJS.Signals) => {
        if (sig === 'SIGKILL') setTimeout(() => child.emit('close', null, 'SIGKILL'), 5);
        return true;
      }) as unknown as (sig: NodeJS.Signals) => boolean;
      return child as unknown as never;
    });
    const result = await runProcess(
      { executable: 'sleep', args: ['10'], timeoutMs: 20 },
      { spawn: spawn as never, clock, kill: killFn, graceMs: 15 },
    );
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(isProcessSuccess(result)).toBe(false);
  });

  it('pre-aborted does not invoke spawn or FS side effect', async () => {
    const controller = new AbortController();
    controller.abort(new Error('pre-aborted'));
    const spawn = vi.fn(() => {
      throw new Error('should not spawn');
    });
    await expect(
      runProcess(
        { executable: 'node', args: ['--version'], signal: controller.signal },
        { spawn: spawn as never, graceMs: 10 },
      ),
    ).rejects.toThrow(/aborted/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('close race: abort during setup terminates child', async () => {
    const controller = new AbortController();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const spawn = vi.fn((exec: string, args: ReadonlyArray<string>, opts: Record<string, unknown>) => {
      const child = new EventEmitter() as unknown as EventEmitter & {
        pid: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig: NodeJS.Signals) => boolean;
      };
      child.pid = 7777;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      const killed: NodeJS.Signals[] = [];
      child.kill = vi.fn((sig: NodeJS.Signals) => {
        killed.push(sig);
        setTimeout(() => child.emit('close', null, sig), 5);
        return true;
      }) as unknown as (sig: NodeJS.Signals) => boolean;
      (child as unknown as Record<string, unknown>)._killed = killed;
      setTimeout(() => controller.abort(new Error('race abort')), 0);
      return child as unknown as never;
    });
    const pending = runProcess(
      { executable: 'sleep', args: ['10'], signal: controller.signal },
      { spawn: spawn as never, graceMs: 10 },
    );
    await expect(pending).rejects.toThrow(/aborted/i);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('UTF-8 byte truncation never exceeds maxOutputBytes for ASCII, emoji, CJK', async () => {
    const cases: Array<{ input: string; max: number }> = [
      { input: 'a'.repeat(100), max: 5 },
      { input: '😀'.repeat(10), max: 5 },
      { input: '漢'.repeat(10), max: 5 },
      { input: 'a😀漢b'.repeat(20), max: 10 },
    ];
    for (const { input, max } of cases) {
      const spawn = vi.fn(() => {
        const child = new EventEmitter() as unknown as EventEmitter & {
          pid: number;
          stdout: EventEmitter;
          stderr: EventEmitter;
          kill: (sig: NodeJS.Signals) => boolean;
        };
        child.pid = 2222;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = vi.fn(() => true) as unknown as (sig: NodeJS.Signals) => boolean;
        setTimeout(() => {
          child.stdout.emit('data', Buffer.from(input, 'utf8'));
          child.stderr.emit('data', Buffer.from(input, 'utf8'));
          child.emit('close', 0, null);
        }, 5);
        return child as unknown as never;
      });
      const result = await runProcess(
        { executable: 'node', args: ['x'], maxOutputBytes: max },
        { spawn: spawn as never, graceMs: 10 },
      );
      expect(Buffer.byteLength(result.stdout, 'utf8')).toBeLessThanOrEqual(max);
      expect(Buffer.byteLength(result.stderr, 'utf8')).toBeLessThanOrEqual(max);
      expect(result.stdoutTruncated).toBe(true);
    }
    const emojiSpawn = vi.fn(() => {
      const child = new EventEmitter() as unknown as EventEmitter & {
        pid: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig: NodeJS.Signals) => boolean;
      };
      child.pid = 2223;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn(() => true) as unknown as (sig: NodeJS.Signals) => boolean;
      setTimeout(() => {
        child.stdout.emit('data', Buffer.from('😀', 'utf8'));
        child.emit('close', 0, null);
      }, 5);
      return child as unknown as never;
    });
    const emojiResult = await runProcess(
      { executable: 'node', args: ['x'], maxOutputBytes: 2 },
      { spawn: emojiSpawn as never, graceMs: 10 },
    );
    expect(Buffer.byteLength(emojiResult.stdout, 'utf8')).toBeLessThanOrEqual(2);
    expect(emojiResult.stdout === '' || Buffer.byteLength(emojiResult.stdout, 'utf8') <= 2).toBe(true);
  });

  it('truncateUtf8ToBytes helper never exceeds limit on emoji and CJK boundaries', () => {
    expect(Buffer.byteLength(truncateUtf8ToBytes('😀'.repeat(5), 5), 'utf8')).toBeLessThanOrEqual(5);
    expect(Buffer.byteLength(truncateUtf8ToBytes('漢字漢字', 5), 'utf8')).toBeLessThanOrEqual(5);
    expect(Buffer.byteLength(truncateUtf8ToBytes('a'.repeat(10), 5), 'utf8')).toBeLessThanOrEqual(5);
    expect(truncateUtf8ToBytes('😀', 2)).toBe('');
    expect(truncateUtf8ToBytes('a😀', 2)).toBe('a');
    expect(truncateUtf8ToBytes('漢', 2)).toBe('');
  });

  it('captureOutput and inheritStdio are mutually exclusive', async () => {
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as unknown as EventEmitter & {
        pid: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig: NodeJS.Signals) => boolean;
      };
      child.pid = 999;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn(() => true) as unknown as (sig: NodeJS.Signals) => boolean;
      setTimeout(() => child.emit('close', 0, null), 5);
      return child as unknown as never;
    });
    await expect(
      runProcess(
        { executable: 'node', args: ['--version'], captureOutput: true, inheritStdio: true },
        { spawn: spawn as never },
      ),
    ).rejects.toThrow(/mutually/i);
  });

  it('inheritStdio uses separate contract: stdio inherit and no capture', async () => {
    const spawn = vi.fn((exec: string, args: ReadonlyArray<string>, opts: Record<string, unknown>) => {
      const child = new EventEmitter() as unknown as EventEmitter & {
        pid: number;
        stdout: null;
        stderr: null;
        kill: (sig: NodeJS.Signals) => boolean;
      };
      child.pid = 1111;
      (child as unknown as Record<string, unknown>).stdout = null;
      (child as unknown as Record<string, unknown>).stderr = null;
      child.kill = vi.fn(() => true) as unknown as (sig: NodeJS.Signals) => boolean;
      expect(opts.stdio).toBe('inherit');
      setTimeout(() => child.emit('close', 0, null), 5);
      return child as unknown as never;
    });
    const result = await runProcess(
      { executable: 'node', args: ['--version'], inheritStdio: true, captureOutput: false },
      { spawn: spawn as never, graceMs: 10 },
    );
    expect(result.stdout).toBe('');
    expect(isProcessSuccess(result)).toBe(true);
  });

  it('real POSIX grandchild killed on timeout and abort', async () => {
    if (process.platform === 'win32') return;
    const dir = mkdtempSync(join(tmpdir(), 'csrem01-'));
    const marker = join(dir, 'marker');
    try {
      const result = await runProcess(
        { executable: 'bash', args: ['-c', `bash -c 'sleep 1; touch "${marker}"' & wait`], timeoutMs: 100 },
        { graceMs: 50 },
      );
      expect(result.timedOut).toBe(true);
      expect(isProcessSuccess(result)).toBe(false);
      await new Promise<void>((r) => setTimeout(r, 800));
      expect(existsSync(marker)).toBe(false);
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch (_e) {
        void _e;
      }
    }
    const dir2 = mkdtempSync(join(tmpdir(), 'csrem01-abort-'));
    const marker2 = join(dir2, 'marker2');
    const controller = new AbortController();
    try {
      const p = runProcess(
        { executable: 'bash', args: ['-c', `bash -c 'sleep 1; touch "${marker2}"' & wait`], signal: controller.signal },
        { graceMs: 50 },
      );
      setTimeout(() => controller.abort(new Error('test abort')), 100);
      await expect(p).rejects.toThrow(/abort/i);
      await new Promise<void>((r) => setTimeout(r, 800));
      expect(existsSync(marker2)).toBe(false);
    } finally {
      try {
        rmSync(dir2, { recursive: true, force: true });
      } catch (_e2) {
        void _e2;
      }
    }
  });

  it('cleans up abort listeners and timers on timeout and abort', async () => {
    const getHandles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles;
    const beforeHandles = getHandles ? getHandles().length : 0;
    function track(signal: AbortSignal): { getCount: () => number } {
      let count = 0;
      const s = signal as unknown as {
        addEventListener: typeof signal.addEventListener;
        removeEventListener: typeof signal.removeEventListener;
      };
      const origAdd = s.addEventListener.bind(s);
      const origRemove = s.removeEventListener.bind(s);
      s.addEventListener = ((type: string, listener: EventListener, opts?: unknown) => {
        if (type === 'abort') count += 1;
        return (origAdd as unknown as (t: string, l: EventListener, o?: unknown) => void)(type, listener, opts);
      }) as typeof s.addEventListener;
      s.removeEventListener = ((type: string, listener: EventListener, opts?: unknown) => {
        if (type === 'abort') count = Math.max(0, count - 1);
        return (origRemove as unknown as (t: string, l: EventListener, o?: unknown) => void)(type, listener, opts);
      }) as typeof s.removeEventListener;
      return { getCount: () => count };
    }
    const controller = new AbortController();
    const tracker = track(controller.signal);
    const spawn = vi.fn(() => {
      const child = new EventEmitter() as unknown as EventEmitter & {
        pid: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig: NodeJS.Signals) => boolean;
      };
      child.pid = 8888;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn((sig: NodeJS.Signals) => {
        if (sig === 'SIGKILL') setTimeout(() => child.emit('close', null, 'SIGKILL'), 5);
        return true;
      }) as unknown as (sig: NodeJS.Signals) => boolean;
      return child as unknown as never;
    });
    const pendingTimeout = runProcess(
      { executable: 'sleep', args: ['10'], timeoutMs: 20, signal: controller.signal },
      { spawn: spawn as never, graceMs: 10 },
    );
    await pendingTimeout;
    expect(tracker.getCount()).toBe(0);
    if (getHandles) {
      await new Promise<void>((r) => setTimeout(r, 20));
      expect(getHandles().length).toBe(beforeHandles);
    }
    const controller2 = new AbortController();
    const tracker2 = track(controller2.signal);
    const spawn2 = vi.fn(() => {
      const child = new EventEmitter() as unknown as EventEmitter & {
        pid: number;
        stdout: EventEmitter;
        stderr: EventEmitter;
        kill: (sig: NodeJS.Signals) => boolean;
      };
      child.pid = 9999;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn((sig: NodeJS.Signals) => {
        setTimeout(() => child.emit('close', null, sig), 5);
        return true;
      }) as unknown as (sig: NodeJS.Signals) => boolean;
      return child as unknown as never;
    });
    const p2 = runProcess(
      { executable: 'sleep', args: ['10'], signal: controller2.signal },
      { spawn: spawn2 as never, graceMs: 10 },
    );
    setTimeout(() => controller2.abort(new Error('abort2')), 10);
    await expect(p2).rejects.toThrow(/aborted/i);
    expect(tracker2.getCount()).toBe(0);
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
