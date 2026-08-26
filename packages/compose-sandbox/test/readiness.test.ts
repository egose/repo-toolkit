import { describe, expect, it, vi } from 'vitest';

import { resolveComposeSandboxPlan } from '../src/plan';
import { waitForReadiness, describeProbe, ServiceProbeError, ReadinessTimeoutError } from '../src/readiness';

function makeClock() {
  let nowMs = 1000;
  return {
    now: () => nowMs,
    sleep: async (ms: number) => {
      nowMs += ms;
    },
    advance: (ms: number) => {
      nowMs += ms;
    },
    getNow: () => nowMs,
  };
}

function basePlanWithReadiness(readiness: unknown[], timeouts: Record<string, number> = {}) {
  return resolveComposeSandboxPlan({
    compose: { files: ['a.yml'] },
    readiness: readiness as never,
    test: { executable: 'echo' },
    timeouts: { readinessMs: 5000, ...timeouts },
  } as unknown as Record<string, unknown>);
}

describe('waitForReadiness', () => {
  it('reproduces database-shaped mixed probes', async () => {
    const plan = basePlanWithReadiness([
      { type: 'tcp', host: '127.0.0.1', port: 5432, intervalMs: 10 },
      { type: 'tcp', host: '127.0.0.1', port: 27017, intervalMs: 10 },
      { type: 'http', url: 'http://localhost:9000/minio/health/live', intervalMs: 10 },
      { type: 'service-completed', service: 'minio-init', intervalMs: 10 },
    ]);
    const clock = makeClock();

    const tcpConnect = vi.fn(async () => {});
    const httpFetch = vi.fn(async () => ({ status: 200 }));
    const getServiceState = vi.fn(async (svc: string) => {
      if (svc === 'minio-init')
        return { service: svc, state: 'exited', status: 'Exited (0)', exitCode: 0, exists: true };
      throw new Error('unexpected service ' + svc);
    });

    await waitForReadiness(plan, {
      clock: clock as never,
      tcpConnect: tcpConnect as never,
      httpFetch: httpFetch as never,
      getServiceState: getServiceState as never,
    });
    expect(tcpConnect).toHaveBeenCalled();
    expect(httpFetch).toHaveBeenCalled();
    expect(getServiceState).toHaveBeenCalledWith(
      'minio-init',
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it('reproduces template-shaped HTTP probes', async () => {
    const plan = basePlanWithReadiness([
      { type: 'http', url: 'http://localhost:8080/realms/master/.well-known/openid-configuration', intervalMs: 10 },
      { type: 'http', url: 'http://127.0.0.1:8000/api/v1/info', intervalMs: 10 },
      { type: 'http', url: 'http://localhost:3000', intervalMs: 10 },
    ]);
    const clock = makeClock();
    const httpFetch = vi.fn(async (url: string) => {
      if (url.includes('8080')) return { status: 200 };
      if (url.includes('8000')) return { status: 200 };
      if (url.includes('3000')) return { status: 200 };
      return { status: 404 };
    });
    await waitForReadiness(plan, { clock: clock as never, httpFetch: httpFetch as never });
    expect(httpFetch).toHaveBeenCalledTimes(3);
  });

  it('tcp probe retries then succeeds', async () => {
    const plan = basePlanWithReadiness([{ type: 'tcp', host: '127.0.0.1', port: 5432, intervalMs: 10 }], {
      readinessMs: 1000,
    });
    const clock = makeClock();
    let attempts = 0;
    const tcpConnect = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('ECONNREFUSED');
    });
    await waitForReadiness(plan, { clock: clock as never, tcpConnect: tcpConnect as never });
    expect(attempts).toBe(3);
  });

  it('http probe validates status range 200-299 and retries on 500', async () => {
    const plan = basePlanWithReadiness(
      [{ type: 'http', url: 'http://127.0.0.1:9000/minio/health/live', intervalMs: 10 }],
      { readinessMs: 1000 },
    );
    const clock = makeClock();
    let calls = 0;
    const httpFetch = vi.fn(async () => {
      calls += 1;
      if (calls < 2) return { status: 500 };
      return { status: 200 };
    });
    await waitForReadiness(plan, { clock: clock as never, httpFetch: httpFetch as never });
    expect(calls).toBe(2);
  });

  it('http probe respects exact expectedStatus', async () => {
    const plan = basePlanWithReadiness(
      [{ type: 'http', url: 'http://example.com', expectedStatus: 204, intervalMs: 10 }],
      { readinessMs: 1000 },
    );
    const clock = makeClock();
    const httpFetch = vi.fn(async () => ({ status: 204 }));
    await waitForReadiness(plan, { clock: clock as never, httpFetch: httpFetch as never });
    expect(httpFetch).toHaveBeenCalled();
  });

  it('http probe with 2-element range treats as inclusive', async () => {
    const plan = basePlanWithReadiness(
      [{ type: 'http', url: 'http://example.com', expectedStatus: [200, 299], intervalMs: 10 }],
      { readinessMs: 1000 },
    );
    const clock = makeClock();
    const httpFetch = vi.fn(async () => ({ status: 201 }));
    await waitForReadiness(plan, { clock: clock as never, httpFetch: httpFetch as never });
    expect(httpFetch).toHaveBeenCalled();
  });

  it('service-running succeeds when running, retries when created', async () => {
    const plan = basePlanWithReadiness([{ type: 'service-running', service: 'api', intervalMs: 10 }], {
      readinessMs: 1000,
    });
    const clock = makeClock();
    let calls = 0;
    const getServiceState = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { service: 'api', state: 'created', status: 'Created', exists: true };
      return { service: 'api', state: 'running', status: 'Up 1 sec', exists: true };
    });
    await waitForReadiness(plan, { clock: clock as never, getServiceState: getServiceState as never });
    expect(calls).toBe(2);
  });

  it('service-completed succeeds when exited 0', async () => {
    const plan = basePlanWithReadiness([{ type: 'service-completed', service: 'provision', intervalMs: 10 }], {
      readinessMs: 1000,
    });
    const clock = makeClock();
    const getServiceState = vi.fn(async () => ({
      service: 'provision',
      state: 'exited',
      status: 'Exited (0)',
      exitCode: 0,
      exists: true,
    }));
    await waitForReadiness(plan, { clock: clock as never, getServiceState: getServiceState as never });
    expect(getServiceState).toHaveBeenCalled();
  });

  it('failed one-shot service fails immediately with service/state/exit-code evidence', async () => {
    const plan = basePlanWithReadiness(
      [
        { type: 'tcp', host: '127.0.0.1', port: 5432, intervalMs: 10 },
        { type: 'service-completed', service: 'minio-init', intervalMs: 10 },
      ],
      { readinessMs: 5000 },
    );
    const clock = makeClock();
    const tcpConnect = vi.fn(async () => {
      await new Promise<void>((r) => setTimeout(r, 50));
      throw new Error('not ready');
    });
    const getServiceState = vi.fn(async () => ({
      service: 'minio-init',
      state: 'exited',
      status: 'Exited (1) 2 seconds ago',
      exitCode: 1,
      exists: true,
    }));
    const start = Date.now();
    await expect(
      waitForReadiness(plan, {
        clock: clock as never,
        tcpConnect: tcpConnect as never,
        getServiceState: getServiceState as never,
      }),
    ).rejects.toMatchObject({
      service: 'minio-init',
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
    let caught: unknown;
    try {
      await waitForReadiness(plan, {
        clock: clock as never,
        tcpConnect: tcpConnect as never,
        getServiceState: getServiceState as never,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ServiceProbeError);
    const e = caught as ServiceProbeError;
    expect(e.message).toMatch(/minio-init/);
    expect(e.message).toMatch(/exitCode=1/);
    expect(e.state).toBe('exited');
    expect(e.exitCode).toBe(1);
  });

  it('service dead fails immediately', async () => {
    const plan = basePlanWithReadiness([{ type: 'service-running', service: 'db', intervalMs: 10 }], {
      readinessMs: 5000,
    });
    const clock = makeClock();
    const getServiceState = vi.fn(async () => ({ service: 'db', state: 'dead', status: 'Dead', exists: true }));
    await expect(
      waitForReadiness(plan, { clock: clock as never, getServiceState: getServiceState as never }),
    ).rejects.toBeInstanceOf(ServiceProbeError);
  });

  it('service missing produces actionable error with available services', async () => {
    const plan = basePlanWithReadiness([{ type: 'service-completed', service: 'missing-svc', intervalMs: 10 }], {
      readinessMs: 5000,
    });
    const clock = makeClock();
    const getServiceState = vi.fn(async () => {
      throw new Error(
        'service missing-svc not found in compose ps output; available: api, db; service may have never been created',
      );
    });
    await expect(
      waitForReadiness(plan, { clock: clock as never, getServiceState: getServiceState as never }),
    ).rejects.toThrow(/not found.*available/);
  });

  it('parsing error isolated as probe error', async () => {
    const plan = basePlanWithReadiness([{ type: 'service-running', service: 'api', intervalMs: 10 }], {
      readinessMs: 5000,
    });
    const clock = makeClock();
    const getServiceState = vi.fn(async () => {
      throw new Error('failed to parse compose ps output: unexpected token');
    });
    await expect(
      waitForReadiness(plan, { clock: clock as never, getServiceState: getServiceState as never }),
    ).rejects.toThrow(/inspect failed/);
  });

  it('timeout diagnostics identify every unsatisfied probe', async () => {
    const plan = basePlanWithReadiness(
      [
        { type: 'tcp', host: '127.0.0.1', port: 5432, intervalMs: 10 },
        { type: 'http', url: 'http://127.0.0.1:8000/api', intervalMs: 10 },
        { type: 'service-running', service: 'api', intervalMs: 10 },
      ],
      { readinessMs: 100 },
    );
    const clock = makeClock();
    const tcpConnect = vi.fn(async () => {
      throw new Error('refused');
    });
    const httpFetch = vi.fn(async () => ({ status: 500 }));
    const getServiceState = vi.fn(async () => ({ service: 'api', state: 'created', status: 'Created', exists: true }));
    let err: unknown;
    try {
      await waitForReadiness(plan, {
        clock: clock as never,
        tcpConnect: tcpConnect as never,
        httpFetch: httpFetch as never,
        getServiceState: getServiceState as never,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReadinessTimeoutError);
    const te = err as ReadinessTimeoutError;
    expect(te.unsatisfied).toHaveLength(3);
    expect(te.message).toContain('tcp 127.0.0.1:5432');
    expect(te.message).toContain('http GET http://127.0.0.1:8000/api');
    expect(te.message).toContain('service-running api');
  });

  it('timeout diagnostics do not expose secret env values', async () => {
    const plan = resolveComposeSandboxPlan({
      compose: { files: ['a.yml'] },
      readiness: [
        {
          type: 'command',
          executable: 'node',
          args: ['-e', 'process.exit(1)'],
          env: { SECRET_TOKEN: 'super-secret-123', PASSWORD: 'hunter2' },
          timeoutMs: 100,
        } as never,
        { type: 'tcp', host: '127.0.0.1', port: 9999, intervalMs: 10 } as never,
      ],
      test: { executable: 'echo' },
      timeouts: { readinessMs: 100 },
    } as unknown as Record<string, unknown>);
    const clock = makeClock();
    const tcpConnect = vi.fn(async () => {
      throw new Error('refused');
    });
    const runCommandProbe = vi.fn(async () => ({
      exitCode: 1,
      signal: null,
      stdout: '',
      stderr: '',
      durationMs: 10,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      truncatedBytes: 0,
    }));
    let err: unknown;
    try {
      await waitForReadiness(plan, {
        clock: clock as never,
        tcpConnect: tcpConnect as never,
        runCommandProbe: runCommandProbe as never,
      } as never);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReadinessTimeoutError);
    const msg = (err as Error).message;
    expect(msg).not.toContain('super-secret-123');
    expect(msg).not.toContain('hunter2');
    expect(msg).toContain('command node');
    expect(msg).toContain('tcp 127.0.0.1:9999');
    const unsatisfied = (err as ReadinessTimeoutError).unsatisfied.join(' ');
    expect(unsatisfied).not.toContain('super-secret');
  });

  it('http headers secrets not exposed in timeout diagnostics', async () => {
    const plan = basePlanWithReadiness(
      [
        {
          type: 'http',
          url: 'http://127.0.0.1:8000/api',
          headers: { Authorization: 'Bearer secret-xyz' },
          intervalMs: 10,
        },
      ],
      { readinessMs: 100 },
    );
    const clock = makeClock();
    const httpFetch = vi.fn(async () => ({ status: 401 }));
    let err: unknown;
    try {
      await waitForReadiness(plan, { clock: clock as never, httpFetch: httpFetch as never });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReadinessTimeoutError);
    expect((err as Error).message).not.toContain('secret-xyz');
    expect((err as Error).message).not.toContain('Bearer');
  });

  it('command probe succeeds when exitCode 0, retries when non-zero until timeout', async () => {
    const plan = resolveComposeSandboxPlan({
      compose: { files: ['a.yml'] },
      readiness: [{ type: 'command', executable: 'node', args: ['-e', 'process.exit(0)'], timeoutMs: 500 }],
      test: { executable: 'echo' },
      timeouts: { readinessMs: 1000 },
    } as unknown as Record<string, unknown>);
    const clock = makeClock();
    const runCommandProbe = vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      stdout: 'ok',
      stderr: '',
      durationMs: 5,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      truncatedBytes: 0,
    }));
    await waitForReadiness(plan, { clock: clock as never, runCommandProbe: runCommandProbe as never } as never);
    expect(runCommandProbe).toHaveBeenCalled();

    const plan2 = resolveComposeSandboxPlan({
      compose: { files: ['a.yml'] },
      readiness: [{ type: 'command', executable: 'node', args: ['-e', 'process.exit(1)'], timeoutMs: 500 } as never],
      test: { executable: 'echo' },
      timeouts: { readinessMs: 1200 },
    } as unknown as Record<string, unknown>);
    const clock2 = makeClock();
    let calls = 0;
    const runFail = vi.fn(async () => {
      calls += 1;
      return {
        exitCode: 1,
        signal: null,
        stdout: '',
        stderr: '',
        durationMs: 5,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        truncatedBytes: 0,
      };
    });
    await expect(
      waitForReadiness(plan2, { clock: clock2 as never, runCommandProbe: runFail as never } as never),
    ).rejects.toBeInstanceOf(ReadinessTimeoutError);
    expect(calls).toBeGreaterThan(1);
  });

  it('runs independent probes concurrently with deterministic diagnostics', async () => {
    const plan = basePlanWithReadiness(
      [
        { type: 'tcp', host: '127.0.0.1', port: 1111, intervalMs: 10 },
        { type: 'tcp', host: '127.0.0.1', port: 2222, intervalMs: 10 },
        { type: 'http', url: 'http://127.0.0.1:3333', intervalMs: 10 },
      ],
      { readinessMs: 200 },
    );
    const clock = makeClock();
    const startNow = clock.now();
    const tcpConnect = vi.fn(async (host: string, port: number) => {
      if (port === 1111) return;
      throw new Error('refused');
    });
    const httpFetch = vi.fn(async () => ({ status: 500 }));
    let err: unknown;
    try {
      await waitForReadiness(plan, {
        clock: clock as never,
        tcpConnect: tcpConnect as never,
        httpFetch: httpFetch as never,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReadinessTimeoutError);
    const te = err as ReadinessTimeoutError;
    expect(te.unsatisfied.some((s) => s.includes('127.0.0.1:2222'))).toBe(true);
    expect(te.unsatisfied.some((s) => s.includes('127.0.0.1:3333'))).toBe(true);
    expect(te.unsatisfied.some((s) => s.includes('127.0.0.1:1111'))).toBe(false);
    const elapsed = clock.now() - startNow;
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });

  it('cancels remaining probes when one-shot fails immediately', async () => {
    const plan = basePlanWithReadiness(
      [
        { type: 'tcp', host: '127.0.0.1', port: 5432, intervalMs: 10 },
        { type: 'service-completed', service: 'init', intervalMs: 10 },
      ],
      { readinessMs: 5000 },
    );
    const clock = makeClock();
    let tcpCalls = 0;
    const tcpConnect = vi.fn(async () => {
      tcpCalls += 1;
      await new Promise<void>((r) => setTimeout(r, 100));
      throw new Error('refused');
    });
    const getServiceState = vi.fn(async () => ({
      service: 'init',
      state: 'exited',
      status: 'Exited (2)',
      exitCode: 2,
      exists: true,
    }));
    const start = Date.now();
    await expect(
      waitForReadiness(plan, {
        clock: clock as never,
        tcpConnect: tcpConnect as never,
        getServiceState: getServiceState as never,
      }),
    ).rejects.toBeInstanceOf(ServiceProbeError);
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(500);
    expect(tcpCalls).toBeLessThan(5);
  });

  it('respects outer abort signal', async () => {
    const plan = basePlanWithReadiness([{ type: 'tcp', host: '127.0.0.1', port: 5432, intervalMs: 10 }], {
      readinessMs: 5000,
    });
    const clock = makeClock();
    const controller = new AbortController();
    const tcpConnect = vi.fn(async (_host: string, _port: number, _timeoutMs: number, signal?: AbortSignal) => {
      return new Promise<void>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason ?? new Error('aborted'));
          return;
        }
        const onAbort = () => reject(signal?.reason ?? new Error('outer abort'));
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    });
    setTimeout(() => controller.abort(new Error('outer abort')), 20);
    await expect(
      waitForReadiness(plan, { clock: clock as never, tcpConnect: tcpConnect as never }, controller.signal),
    ).rejects.toThrow(/abort/);
  });

  it('supports per-probe timeout diagnostics without unbounded log polling', async () => {
    const plan = basePlanWithReadiness(
      [
        { type: 'tcp', host: '127.0.0.1', port: 5432, timeoutMs: 50, intervalMs: 10 },
        { type: 'http', url: 'http://127.0.0.1:8000', timeoutMs: 50, intervalMs: 10 },
      ],
      { readinessMs: 80 },
    );
    const clock = makeClock();
    let tcpAttempts = 0;
    let httpAttempts = 0;
    const tcpConnect = vi.fn(async () => {
      tcpAttempts += 1;
      throw new Error('timeout');
    });
    const httpFetch = vi.fn(async () => {
      httpAttempts += 1;
      throw new Error('timeout');
    });
    await expect(
      waitForReadiness(plan, { clock: clock as never, tcpConnect: tcpConnect as never, httpFetch: httpFetch as never }),
    ).rejects.toBeInstanceOf(ReadinessTimeoutError);
    expect(tcpAttempts).toBeGreaterThan(1);
    expect(tcpAttempts).toBeLessThan(20);
    expect(httpAttempts).toBeGreaterThan(1);
    expect(httpAttempts).toBeLessThan(20);
  });

  it('describeProbe redacts env secrets', () => {
    const plan = resolveComposeSandboxPlan({
      compose: { files: ['a.yml'] },
      readiness: [{ type: 'command', executable: 'mybin', args: ['a', 'b'], env: { SECRET: 's3cr3t', TOKEN: 'abcd' } }],
      test: { executable: 'echo' },
    } as unknown as Record<string, unknown>);
    const desc = describeProbe(plan.readiness[0] as never);
    expect(desc).toBe('command mybin a b');
    expect(desc).not.toContain('s3cr3t');
    expect(desc).not.toContain('abcd');
  });

  it('no probe case returns immediately', async () => {
    const plan = basePlanWithReadiness([]);
    const clock = makeClock();
    await expect(waitForReadiness(plan, { clock: clock as never })).resolves.toBeUndefined();
  });

  it('handles mixed tcp/http/service/command with aggregate timeout and redaction', async () => {
    const plan = resolveComposeSandboxPlan({
      compose: { files: ['a.yml'] },
      readiness: [
        { type: 'tcp', host: '127.0.0.1', port: 5432, intervalMs: 10 },
        { type: 'http', url: 'http://127.0.0.1:8080/health', intervalMs: 10 },
        { type: 'service-running', service: 'api', intervalMs: 10 },
        { type: 'command', executable: 'check', args: ['--ok'], env: { KEY: 'secretVal' }, timeoutMs: 200 } as never,
      ],
      test: { executable: 'echo' },
      timeouts: { readinessMs: 120 },
    } as unknown as Record<string, unknown>);
    const clock = makeClock();
    const tcpConnect = vi.fn(async () => {});
    const httpFetch = vi.fn(async () => ({ status: 200 }));
    const getServiceState = vi.fn(async () => ({ service: 'api', state: 'running', status: 'Up', exists: true }));
    const runCommandProbe = vi.fn(async () => ({
      exitCode: 1,
      signal: null,
      stdout: '',
      stderr: '',
      durationMs: 5,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      truncatedBytes: 0,
    }));
    let err: unknown;
    try {
      await waitForReadiness(plan, {
        clock: clock as never,
        tcpConnect: tcpConnect as never,
        httpFetch: httpFetch as never,
        getServiceState: getServiceState as never,
        runCommandProbe: runCommandProbe as never,
      } as never);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReadinessTimeoutError);
    expect((err as Error).message).not.toContain('secretVal');
    expect((err as ReadinessTimeoutError).unsatisfied[0]).toContain('command check');
  });
});
