import { describe, expect, it, vi } from 'vitest';
import { resolveComposeSandboxPlan } from '../src/plan';
import { waitForReadiness, ServiceProbeError, ReadinessTimeoutError, type GetServiceState } from '../src/readiness';

function makeRealPlan(readiness: unknown[], timeouts: Record<string, number> = {}) {
  return resolveComposeSandboxPlan({
    compose: { files: ['a.yml'] },
    readiness: readiness as never,
    test: { executable: 'echo' },
    timeouts: { readinessMs: 120, ...timeouts },
  } as unknown as Record<string, unknown>);
}

function makeClock() {
  let nowMs = 1000;
  return {
    now: () => nowMs,
    sleep: async (ms: number) => {
      nowMs += ms;
    },
  };
}

describe('CSREM-05 hard deadlines and service completion', () => {
  it('hanging command probe canceled at readinessMs within tolerance', async () => {
    const plan = makeRealPlan([{ type: 'command', executable: 'hang', args: ['a'], timeoutMs: 5000 } as never], {
      readinessMs: 80,
    });
    const runCommandProbe = vi.fn(async (_probe: unknown, opts?: { signal?: AbortSignal; timeoutMs?: number }) => {
      const sig = (opts as { signal?: AbortSignal } | undefined)?.signal;
      return new Promise<never>((_resolve, reject) => {
        if (sig?.aborted) {
          reject(sig.reason ?? new Error('aborted'));
          return;
        }
        const onAbort = () => reject(sig?.reason ?? new Error('aborted'));
        sig?.addEventListener('abort', onAbort, { once: true });
      }) as unknown as Promise<never>;
    });
    const start = Date.now();
    const raced = Promise.race([
      waitForReadiness(plan, { runCommandProbe: runCommandProbe as never } as never),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('hang-detected')), 600)),
    ]);
    await expect(raced).rejects.toBeInstanceOf(ReadinessTimeoutError);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(350);
    expect(elapsed).toBeGreaterThanOrEqual(30);
  });

  it('hanging service probe canceled at readinessMs within tolerance', async () => {
    const plan = makeRealPlan(
      [{ type: 'service-completed', service: 'svc', timeoutMs: 5000, intervalMs: 10 } as never],
      { readinessMs: 80 },
    );
    const getServiceState: GetServiceState = vi.fn(
      async (_svc: string, opts?: { signal?: AbortSignal; timeoutMs?: number }) => {
        const sig = opts?.signal;
        return new Promise<never>((_resolve, reject) => {
          if (sig?.aborted) {
            reject(sig.reason ?? new Error('aborted'));
            return;
          }
          const onAbort = () => reject(sig?.reason ?? new Error('aborted'));
          sig?.addEventListener('abort', onAbort, { once: true });
        }) as unknown as Promise<never>;
      },
    ) as unknown as GetServiceState;
    const start = Date.now();
    const raced = Promise.race([
      waitForReadiness(plan, { getServiceState: getServiceState as never } as never),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('hang-detected')), 600)),
    ]);
    await expect(raced).rejects.toBeInstanceOf(ReadinessTimeoutError);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(350);
  });

  it('abort during retry sleep rejects immediately without extra probe', async () => {
    const plan = makeRealPlan(
      [{ type: 'tcp', host: '127.0.0.1', port: 5432, timeoutMs: 100, intervalMs: 500 } as never],
      {
        readinessMs: 5000,
      },
    );
    let attempts = 0;
    const tcpConnect = vi.fn(async () => {
      attempts += 1;
      throw new Error('refused');
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('outer abort')), 30);
    const start = Date.now();
    await expect(
      waitForReadiness(plan, { tcpConnect: tcpConnect as never } as never, controller.signal),
    ).rejects.toThrow(/abort/i);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(250);
    expect(attempts).toBe(1);
  });

  it('probe.timeoutMs > readinessMs is clamped', async () => {
    const plan = makeRealPlan(
      [{ type: 'tcp', host: '127.0.0.1', port: 5432, timeoutMs: 5000, intervalMs: 10 } as never],
      {
        readinessMs: 40,
      },
    );
    const seen: number[] = [];
    const tcpConnect = vi.fn(async (_host: string, _port: number, timeoutMs: number) => {
      seen.push(timeoutMs);
      throw new Error('refused');
    });
    await expect(waitForReadiness(plan, { tcpConnect: tcpConnect as never } as never)).rejects.toBeInstanceOf(
      ReadinessTimeoutError,
    );
    expect(seen.length).toBeGreaterThan(0);
    for (const t of seen) expect(t).toBeLessThanOrEqual(40);
  });

  it('probe timeoutMs via command also clamped', async () => {
    const plan = resolveComposeSandboxPlan({
      compose: { files: ['a.yml'] },
      readiness: [{ type: 'command', executable: 'bin', args: ['a'], timeoutMs: 5000 } as never],
      test: { executable: 'echo' },
      timeouts: { readinessMs: 45 },
    } as unknown as Record<string, unknown>);
    const seen: number[] = [];
    const runCommandProbe = vi.fn(async (probe: unknown, opts?: { signal?: AbortSignal; timeoutMs?: number }) => {
      const effective =
        (opts as { timeoutMs?: number } | undefined)?.timeoutMs ?? (probe as { timeoutMs: number }).timeoutMs;
      seen.push(effective);
      return {
        exitCode: 1,
        signal: null,
        stdout: '',
        stderr: '',
        durationMs: 1,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        truncatedBytes: 0,
      };
    });
    await expect(waitForReadiness(plan, { runCommandProbe: runCommandProbe as never } as never)).rejects.toBeInstanceOf(
      ReadinessTimeoutError,
    );
    expect(seen.length).toBeGreaterThan(0);
    for (const t of seen) expect(t).toBeLessThanOrEqual(45);
  });

  it('missing exitCode does NOT pass', async () => {
    const plan = makeRealPlan([{ type: 'service-completed', service: 'svc', intervalMs: 10 } as never], {
      readinessMs: 120,
    });
    const getServiceState = vi.fn(async () => ({
      service: 'svc',
      state: 'exited',
      status: 'Exited',
      exists: true,
    }));
    const clock = makeClock();
    await expect(
      waitForReadiness(plan, { clock: clock as never, getServiceState: getServiceState as never } as never),
    ).rejects.toBeInstanceOf(ReadinessTimeoutError);
  });

  it('explicit exitCode 0 passes', async () => {
    const plan = makeRealPlan([{ type: 'service-completed', service: 'svc', intervalMs: 10 } as never], {
      readinessMs: 500,
    });
    const clock = makeClock();
    const getServiceState = vi.fn(async () => ({
      service: 'svc',
      state: 'exited',
      status: 'Exited (0)',
      exitCode: 0,
      exists: true,
    }));
    await expect(
      waitForReadiness(plan, { clock: clock as never, getServiceState: getServiceState as never } as never),
    ).resolves.toBeUndefined();
  });

  it('status-derived exitCode 0 passes via compose ps', async () => {
    const plan = makeRealPlan([{ type: 'service-completed', service: 'svc', intervalMs: 10 } as never], {
      readinessMs: 500,
    });
    const clock = makeClock();
    const getServiceStateMock = vi.fn(async () => ({
      service: 'svc',
      state: 'exited',
      status: 'Exited (0) 2 seconds ago',
      exitCode: 0,
      exists: true,
    }));
    await expect(
      waitForReadiness(plan, { clock: clock as never, getServiceState: getServiceStateMock as never } as never),
    ).resolves.toBeUndefined();
  });

  it('nonzero exitCode fails immediately', async () => {
    const plan = makeRealPlan([{ type: 'service-completed', service: 'svc', intervalMs: 10 } as never], {
      readinessMs: 5000,
    });
    const clock = makeClock();
    const getServiceState = vi.fn(async () => ({
      service: 'svc',
      state: 'exited',
      status: 'Exited (2)',
      exitCode: 2,
      exists: true,
    }));
    const start = Date.now();
    await expect(
      waitForReadiness(plan, { clock: clock as never, getServiceState: getServiceState as never } as never),
    ).rejects.toBeInstanceOf(ServiceProbeError);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });

  it('malformed missing status code does NOT pass', async () => {
    const plan = makeRealPlan([{ type: 'service-completed', service: 'svc', intervalMs: 10 } as never], {
      readinessMs: 100,
    });
    const clock = makeClock();
    const getServiceState = vi.fn(async () => ({
      service: 'svc',
      state: 'exited',
      status: 'Exited (bad)',
      exists: true,
    }));
    await expect(
      waitForReadiness(plan, { clock: clock as never, getServiceState: getServiceState as never } as never),
    ).rejects.toBeInstanceOf(ReadinessTimeoutError);
  });

  it('multiple service probes bounds ps invocations via snapshot', async () => {
    const plan = makeRealPlan(
      [
        { type: 'service-running', service: 'api', intervalMs: 10 } as never,
        { type: 'service-running', service: 'db', intervalMs: 10 } as never,
      ],
      { readinessMs: 150 },
    );
    let snapshotCalls = 0;
    const getServiceSnapshot = vi.fn(async (opts?: { signal?: AbortSignal; timeoutMs?: number }) => {
      snapshotCalls += 1;
      if (opts?.signal?.aborted) throw opts.signal.reason ?? new Error('aborted');
      if (opts?.timeoutMs !== undefined) expect(opts.timeoutMs).toBeLessThanOrEqual(150);
      const m = new Map<
        string,
        { service: string; state: string; status: string; exitCode?: number; exists: boolean }
      >();
      m.set('api', { service: 'api', state: 'created', status: 'Created', exists: true });
      m.set('db', { service: 'db', state: 'created', status: 'Created', exists: true });
      return m;
    });
    const start = Date.now();
    await expect(
      waitForReadiness(plan, { getServiceSnapshot: getServiceSnapshot as never } as never),
    ).rejects.toBeInstanceOf(ReadinessTimeoutError);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(elapsed).toBeLessThan(400);
    expect(snapshotCalls).toBeGreaterThanOrEqual(8);
    expect(snapshotCalls).toBeLessThanOrEqual(20);
    // Old per-service path would have done ~30 calls (2 per cycle); snapshot shares one ps per polling cycle.
  });
});
