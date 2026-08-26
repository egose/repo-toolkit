import { createConnection } from 'node:net';
import * as http from 'node:http';
import * as https from 'node:https';

import { getServiceState as defaultGetServiceState } from './compose';
import type {
  ComposeSandboxPlan,
  ReadinessProbe,
  CommandProbe,
  TcpProbe,
  HttpProbe,
  ServiceRunningProbe,
  ServiceCompletedProbe,
} from './plan';
import { runProcess, type ProcessResult } from './process';

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

function defaultClock(): Clock {
  return {
    now: () => Date.now(),
    sleep: (ms) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }),
  };
}

export type TcpConnect = (host: string, port: number, timeoutMs: number, signal?: AbortSignal) => Promise<void>;

export type HttpFetch = (
  url: string,
  options: { method: string; headers: Readonly<Record<string, string>>; timeoutMs: number; signal?: AbortSignal },
) => Promise<{ status: number }>;

export type GetServiceState = (
  service: string,
) => Promise<{ service: string; state: string; status: string; exitCode?: number; exists: boolean }>;

export type RunCommandProbe = (probe: CommandProbe) => Promise<ProcessResult>;

export interface ReadinessDeps {
  readonly clock?: Clock;
  readonly tcpConnect?: TcpConnect;
  readonly httpFetch?: HttpFetch;
  readonly getServiceState?: GetServiceState;
  readonly runCommandProbe?: RunCommandProbe;
}

export class ServiceProbeError extends Error {
  public readonly service: string;
  public readonly state: string;
  public readonly exitCode?: number;
  public readonly probeType: string;

  constructor(message: string, service: string, state: string, exitCode?: number, probeType = 'service') {
    super(message);
    this.name = 'ServiceProbeError';
    this.service = service;
    this.state = state;
    if (exitCode !== undefined) this.exitCode = exitCode;
    this.probeType = probeType;
  }
}

export class ReadinessTimeoutError extends Error {
  public readonly unsatisfied: ReadonlyArray<string>;
  public readonly elapsedMs: number;

  constructor(message: string, unsatisfied: ReadonlyArray<string>, elapsedMs: number) {
    super(message);
    this.name = 'ReadinessTimeoutError';
    this.unsatisfied = unsatisfied;
    this.elapsedMs = elapsedMs;
  }
}

export class ReadinessProbeError extends Error {
  public readonly probe: string;
  constructor(message: string, probe: string) {
    super(message);
    this.name = 'ReadinessProbeError';
    this.probe = probe;
  }
}

export function describeProbe(probe: ReadinessProbe): string {
  switch (probe.type) {
    case 'tcp':
      return `tcp ${probe.host}:${probe.port}`;
    case 'http': {
      const exp =
        probe.expectedStatus.length === 1
          ? `${probe.expectedStatus[0]}`
          : probe.expectedStatus.length === 2
            ? `${probe.expectedStatus[0]}-${probe.expectedStatus[1]}`
            : probe.expectedStatus.join(',');
      return `http ${probe.method} ${probe.url} => ${exp}`;
    }
    case 'service-running':
      return `service-running ${probe.service}`;
    case 'service-completed':
      return `service-completed ${probe.service}`;
    case 'command':
      return `command ${probe.executable} ${probe.args.join(' ')}`.trim();
    default:
      return `unknown`;
  }
}

function httpStatusMatches(status: number, expected: ReadonlyArray<number>): boolean {
  if (expected.length === 0) return false;
  if (expected.length === 1) return status === expected[0];
  if (expected.length === 2) {
    const a = expected[0] as number;
    const b = expected[1] as number;
    if (a <= b && expected.length === 2) {
      if (a >= 100 && b <= 599 && b - a <= 400) {
        return status >= a && status <= b;
      }
    }
    return expected.includes(status);
  }
  return expected.includes(status);
}

function defaultTcpConnect(host: string, port: number, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const socket = createConnection({ host, port });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch (_unused) {
        void _unused;
      }
      reject(new Error(`tcp connect timeout ${host}:${port} after ${timeoutMs}ms`));
    }, timeoutMs);
    if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
      (timer as unknown as { unref: () => void }).unref();
    }
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch (_unused2) {
        void _unused2;
      }
      reject(signal?.reason ?? new Error('aborted'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    socket.on('connect', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      try {
        socket.end();
        socket.destroy();
      } catch (_unused3) {
        void _unused3;
      }
      resolve();
    });
    socket.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      try {
        socket.destroy();
      } catch (_unused4) {
        void _unused4;
      }
      reject(err);
    });
  });
}

function defaultHttpFetch(
  urlStr: string,
  options: { method: string; headers: Readonly<Record<string, string>>; timeoutMs: number; signal?: AbortSignal },
): Promise<{ status: number }> {
  return new Promise<{ status: number }>((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch (err) {
      reject(err);
      return;
    }
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;
    const req = lib.request(
      urlStr,
      {
        method: options.method,
        headers: options.headers as Record<string, string>,
        signal: options.signal,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        res.resume();
        resolve({ status });
      },
    );
    req.on('error', (err) => reject(err));
    const timer = setTimeout(() => {
      try {
        req.destroy(new Error(`http timeout ${urlStr} after ${options.timeoutMs}ms`));
      } catch (_unused) {
        void _unused;
      }
    }, options.timeoutMs);
    if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
      (timer as unknown as { unref: () => void }).unref();
    }
    req.on('close', () => clearTimeout(timer));
    req.end();
  });
}

async function checkTcp(probe: TcpProbe, deps: ReadinessDeps, signal?: AbortSignal): Promise<boolean> {
  const connect = deps.tcpConnect ?? defaultTcpConnect;
  try {
    await connect(probe.host, probe.port, probe.timeoutMs, signal);
    return true;
  } catch (err) {
    if (signal?.aborted) throw err;
    return false;
  }
}

async function checkHttp(probe: HttpProbe, deps: ReadinessDeps, signal?: AbortSignal): Promise<boolean> {
  const fetcher = deps.httpFetch ?? defaultHttpFetch;
  try {
    const res = await fetcher(probe.url, {
      method: probe.method,
      headers: probe.headers,
      timeoutMs: probe.timeoutMs,
      signal,
    });
    return httpStatusMatches(res.status, probe.expectedStatus);
  } catch (err) {
    if (signal?.aborted) throw err;
    return false;
  }
}

async function checkServiceRunning(
  probe: ServiceRunningProbe,
  deps: ReadinessDeps,
  plan: ComposeSandboxPlan,
): Promise<boolean> {
  const getter = deps.getServiceState ?? ((svc: string) => defaultGetServiceState(plan, svc));
  let state: { service: string; state: string; status: string; exitCode?: number; exists: boolean };
  try {
    state = await getter(probe.service);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not found') || msg.includes('never been created')) {
      throw new ServiceProbeError(
        `service ${probe.service} not found: ${msg}`,
        probe.service,
        'missing',
        undefined,
        'service-running',
      );
    }
    if (msg.includes('failed to parse') || msg.includes('failed to inspect')) {
      throw new ReadinessProbeError(`service ${probe.service} inspect failed: ${msg}`, describeProbe(probe));
    }
    throw err;
  }
  const s = state.state.toLowerCase();
  if (s === 'running') return true;
  if (s === 'dead' || s === 'failed') {
    throw new ServiceProbeError(
      `service ${probe.service} is ${state.state} (status: ${state.status})`,
      probe.service,
      state.state,
      state.exitCode,
      'service-running',
    );
  }
  return false;
}

async function checkServiceCompleted(
  probe: ServiceCompletedProbe,
  deps: ReadinessDeps,
  plan: ComposeSandboxPlan,
): Promise<boolean> {
  const getter = deps.getServiceState ?? ((svc: string) => defaultGetServiceState(plan, svc));
  let state: { service: string; state: string; status: string; exitCode?: number; exists: boolean };
  try {
    state = await getter(probe.service);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not found') || msg.includes('never been created')) {
      throw new ServiceProbeError(
        `service ${probe.service} not found: ${msg}`,
        probe.service,
        'missing',
        undefined,
        'service-completed',
      );
    }
    if (msg.includes('failed to parse') || msg.includes('failed to inspect')) {
      throw new ReadinessProbeError(`service ${probe.service} inspect failed: ${msg}`, describeProbe(probe));
    }
    throw err;
  }
  const s = state.state.toLowerCase();
  if (s === 'exited') {
    const code = state.exitCode ?? 0;
    if (code === 0) return true;
    throw new ServiceProbeError(
      `service ${probe.service} completed with failure: state=${state.state} exitCode=${code} status=${state.status}`,
      probe.service,
      state.state,
      code,
      'service-completed',
    );
  }
  if (s === 'dead' || s === 'failed') {
    throw new ServiceProbeError(
      `service ${probe.service} is ${state.state} (status: ${state.status}) exitCode=${state.exitCode ?? 'unknown'}`,
      probe.service,
      state.state,
      state.exitCode,
      'service-completed',
    );
  }
  if (s === 'missing') {
    throw new ServiceProbeError(`service ${probe.service} missing`, probe.service, s, undefined, 'service-completed');
  }
  return false;
}

async function checkCommand(probe: CommandProbe, deps: ReadinessDeps): Promise<boolean> {
  const runner =
    deps.runCommandProbe ??
    ((p: CommandProbe) =>
      runProcess({
        executable: p.executable,
        args: [...p.args],
        env: p.env as Record<string, string>,
        timeoutMs: p.timeoutMs,
        captureOutput: true,
      }));
  try {
    const result = await runner(probe);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

async function checkProbeOnce(
  probe: ReadinessProbe,
  deps: ReadinessDeps,
  plan: ComposeSandboxPlan,
  signal?: AbortSignal,
): Promise<boolean> {
  switch (probe.type) {
    case 'tcp':
      return checkTcp(probe, deps, signal);
    case 'http':
      return checkHttp(probe, deps, signal);
    case 'service-running':
      return checkServiceRunning(probe, deps, plan);
    case 'service-completed':
      return checkServiceCompleted(probe, deps, plan);
    case 'command':
      return checkCommand(probe, deps);
    default:
      return false;
  }
}

export async function waitForReadiness(
  plan: ComposeSandboxPlan,
  deps: ReadinessDeps = {},
  outerSignal?: AbortSignal,
): Promise<void> {
  const clock = deps.clock ?? defaultClock();
  const probes = plan.readiness;
  if (probes.length === 0) return;

  const aggregateMs = plan.timeouts.readinessMs;
  const startMs = clock.now();
  const deadline = startMs + aggregateMs;

  const abortInner = new AbortController();
  const onOuterAbort = () => {
    try {
      abortInner.abort(outerSignal?.reason ?? new Error('aborted'));
    } catch (_unused) {
      void _unused;
    }
  };
  if (outerSignal) {
    if (outerSignal.aborted) abortInner.abort(outerSignal.reason);
    else outerSignal.addEventListener('abort', onOuterAbort, { once: true });
  }

  const probeStatus = new Map<string, { probe: ReadinessProbe; done: boolean; lastError?: Error }>();
  for (const p of probes) {
    probeStatus.set(describeProbe(p), { probe: p, done: false });
  }

  let fatalError: Error | undefined;

  async function runOne(probe: ReadinessProbe): Promise<void> {
    const key = describeProbe(probe);
    const interval = (probe as unknown as { intervalMs?: number }).intervalMs ?? 1000;
    while (true) {
      if (abortInner.signal.aborted || outerSignal?.aborted) {
        throw abortInner.signal.reason ?? outerSignal?.reason ?? new Error('aborted');
      }
      const now = clock.now();
      if (now >= deadline) {
        break;
      }
      let ok: boolean;
      try {
        ok = await checkProbeOnce(probe, deps, plan, abortInner.signal);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (e instanceof ServiceProbeError) {
          throw e;
        }
        if (e instanceof ReadinessProbeError) {
          throw e;
        }
        probeStatus.get(key)!.lastError = e;
        ok = false;
      }
      if (ok) {
        probeStatus.get(key)!.done = true;
        return;
      }
      const remaining = deadline - clock.now();
      if (remaining <= 0) break;
      const sleepMs = Math.min(interval, remaining);
      if (sleepMs > 0) {
        await clock.sleep(sleepMs);
      } else {
        break;
      }
    }
  }

  const promises = probes.map((probe) =>
    runOne(probe).catch((err) => {
      if (err instanceof ServiceProbeError || err instanceof ReadinessProbeError) {
        if (!fatalError) {
          fatalError = err;
          try {
            abortInner.abort(err);
          } catch (_unused) {
            void _unused;
          }
        }
      }
      throw err;
    }),
  );

  let settled: PromiseSettledResult<void>[] | undefined;
  try {
    settled = await Promise.allSettled(promises);
  } finally {
    if (outerSignal) {
      try {
        outerSignal.removeEventListener('abort', onOuterAbort);
      } catch (_unused) {
        void _unused;
      }
    }
  }
  const settledSnapshot = settled ?? [];

  if (abortInner.signal.aborted) {
    throw abortInner.signal.reason ?? new Error('aborted');
  }
  if (outerSignal?.aborted) {
    throw outerSignal.reason ?? new Error('aborted');
  }

  const nonFatalAbort = settledSnapshot.find(
    (r) =>
      r.status === 'rejected' &&
      String((r as PromiseRejectedResult).reason?.message ?? '')
        .toLowerCase()
        .includes('abort'),
  );
  if (nonFatalAbort) {
    throw (nonFatalAbort as PromiseRejectedResult).reason;
  }

  if (fatalError) {
    throw fatalError;
  }

  const unsatisfied: string[] = [];
  for (const [key, val] of probeStatus.entries()) {
    if (!val.done) unsatisfied.push(key);
  }

  if (unsatisfied.length > 0) {
    const elapsed = clock.now() - startMs;
    const redacted = unsatisfied.join(', ');
    throw new ReadinessTimeoutError(
      `readiness timeout after ${elapsed}ms: unsatisfied probes: ${redacted}`,
      unsatisfied,
      elapsed,
    );
  }

  const rejected = settledSnapshot.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  if (rejected.length > 0) {
    const first = rejected[0] as PromiseRejectedResult;
    throw first.reason;
  }
}

export function _internalForTests() {
  return { httpStatusMatches, defaultTcpConnect, defaultHttpFetch, describeProbe };
}
