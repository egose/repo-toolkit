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
import { createDefaultClock, getScheduler, type Clock } from './clock';

export type { Clock } from './clock';

function defaultClock(): Clock {
  return createDefaultClock();
}

export type TcpConnect = (host: string, port: number, timeoutMs: number, signal?: AbortSignal) => Promise<void>;

export type HttpFetch = (
  url: string,
  options: { method: string; headers: Readonly<Record<string, string>>; timeoutMs: number; signal?: AbortSignal },
) => Promise<{ status: number }>;

export type GetServiceState = (
  service: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<{ service: string; state: string; status: string; exitCode?: number; exists: boolean }>;

export type GetServiceSnapshot = (opts?: {
  signal?: AbortSignal;
  timeoutMs?: number;
}) => Promise<Map<string, { service: string; state: string; status: string; exitCode?: number; exists: boolean }>>;

export type RunCommandProbe = (
  probe: CommandProbe,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
) => Promise<ProcessResult>;

export interface ReadinessDeps {
  readonly clock?: Clock;
  readonly tcpConnect?: TcpConnect;
  readonly httpFetch?: HttpFetch;
  readonly getServiceState?: GetServiceState;
  readonly getServiceSnapshot?: GetServiceSnapshot;
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
      const hp = probe as HttpProbe;
      const range = (hp as unknown as { expectedStatusRange?: { min: number; max: number } }).expectedStatusRange;
      if (range) return `http ${hp.method} ${hp.url} => ${range.min}-${range.max}`;
      const exp = hp.expectedStatus.length === 1 ? `${hp.expectedStatus[0]}` : hp.expectedStatus.join(',');
      return `http ${hp.method} ${hp.url} => ${exp || 'none'}`;
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

export function httpStatusMatches(
  status: number,
  expected: ReadonlyArray<number>,
  range?: { min: number; max: number },
): boolean {
  if (range) {
    if (status >= range.min && status <= range.max) return true;
    if (expected.length > 0) return expected.includes(status);
    return false;
  }
  if (expected.length === 0) return false;
  return expected.includes(status);
}

function httpStatusMatchesForProbe(status: number, probe: HttpProbe): boolean {
  const range = (probe as unknown as { expectedStatusRange?: { min: number; max: number } }).expectedStatusRange;
  return httpStatusMatches(status, probe.expectedStatus, range);
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

async function checkTcp(
  probe: TcpProbe,
  deps: ReadinessDeps,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<boolean> {
  const connect = deps.tcpConnect ?? defaultTcpConnect;
  try {
    await connect(probe.host, probe.port, timeoutMs, signal);
    return true;
  } catch (err) {
    if (signal?.aborted) throw err;
    return false;
  }
}

async function checkHttp(
  probe: HttpProbe,
  deps: ReadinessDeps,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<boolean> {
  const fetcher = deps.httpFetch ?? defaultHttpFetch;
  try {
    const res = await fetcher(probe.url, {
      method: probe.method,
      headers: probe.headers,
      timeoutMs,
      signal,
    });
    return httpStatusMatchesForProbe(res.status, probe);
  } catch (err) {
    if (signal?.aborted) throw err;
    return false;
  }
}

async function checkServiceRunningWithState(
  probe: ServiceRunningProbe,
  state: { service: string; state: string; status: string; exitCode?: number; exists: boolean },
): Promise<boolean> {
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

async function checkServiceCompletedWithState(
  probe: ServiceCompletedProbe,
  state: { service: string; state: string; status: string; exitCode?: number; exists: boolean },
): Promise<boolean> {
  const s = state.state.toLowerCase();
  if (s === 'exited') {
    if (state.exitCode === undefined) return false;
    const code = state.exitCode;
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

async function fetchServiceStateWithBudget(
  service: string,
  deps: ReadinessDeps,
  plan: ComposeSandboxPlan,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<{ service: string; state: string; status: string; exitCode?: number; exists: boolean }> {
  const getter =
    deps.getServiceState ??
    ((svc: string, opts?: { signal?: AbortSignal; timeoutMs?: number }) => defaultGetServiceState(plan, svc, {}, opts));
  try {
    return await getter(service, { signal, timeoutMs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not found') || msg.includes('never been created')) {
      throw new ServiceProbeError(`service ${service} not found: ${msg}`, service, 'missing', undefined, 'service');
    }
    if (msg.includes('failed to parse') || msg.includes('failed to inspect')) {
      throw new ReadinessProbeError(`service ${service} inspect failed: ${msg}`, `service ${service}`);
    }
    throw err;
  }
}

async function checkCommand(
  probe: CommandProbe,
  deps: ReadinessDeps,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<boolean> {
  const runner =
    deps.runCommandProbe ??
    ((p: CommandProbe, opts?: { signal?: AbortSignal; timeoutMs?: number }) =>
      runProcess({
        executable: p.executable,
        args: [...p.args],
        env: p.env as Record<string, string>,
        timeoutMs: opts?.timeoutMs ?? p.timeoutMs,
        signal: opts?.signal,
        captureOutput: true,
      }));
  try {
    const result = await runner(probe, { signal, timeoutMs });
    if (result.timedOut) return false;
    if (result.signal !== null) return false;
    return result.exitCode === 0;
  } catch (err) {
    if (signal?.aborted) throw err;
    return false;
  }
}

async function sleepWithAbort(
  clock: Clock,
  scheduler: ReturnType<typeof getScheduler>,
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  if (ms <= 0) return;
  if (signal.aborted) throw signal.reason ?? new Error('aborted');
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const onAbort = () => {
      if (finished) return;
      finished = true;
      try {
        signal.removeEventListener('abort', onAbort);
      } catch (_unused) {
        void _unused;
      }
      reject(signal.reason ?? new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    const sleepP = clock.sleep(ms);
    sleepP.then(
      () => {
        if (finished) return;
        finished = true;
        try {
          signal.removeEventListener('abort', onAbort);
        } catch (_unused) {
          void _unused;
        }
        resolve();
      },
      (e) => {
        if (finished) return;
        finished = true;
        try {
          signal.removeEventListener('abort', onAbort);
        } catch (_unused) {
          void _unused;
        }
        reject(e);
      },
    );
  });
}

async function raceWithBudgetAndSignal<T>(
  promise: Promise<T>,
  budgetMs: number,
  signal: AbortSignal,
  scheduler: ReturnType<typeof getScheduler>,
): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new Error('aborted');
  if (budgetMs <= 0) throw signal.reason ?? new Error('aborted');
  let timeoutHandle: unknown | undefined;
  let abortHandler: (() => void) | undefined;
  try {
    const timeoutP = new Promise<never>((_, reject) => {
      timeoutHandle = scheduler.setTimeout(() => reject(new Error('probe budget exceeded')), budgetMs);
    });
    const abortP = new Promise<never>((_, reject) => {
      if (signal.aborted) {
        reject(signal.reason ?? new Error('aborted'));
      } else {
        abortHandler = () => reject(signal.reason ?? new Error('aborted'));
        signal.addEventListener('abort', abortHandler, { once: true });
      }
    });
    const result = await Promise.race([promise, timeoutP, abortP]);
    return result as T;
  } finally {
    if (timeoutHandle !== undefined) {
      try {
        scheduler.clearTimeout(timeoutHandle);
      } catch (_unused) {
        void _unused;
      }
    }
    if (abortHandler) {
      try {
        signal.removeEventListener('abort', abortHandler);
      } catch (_unused) {
        void _unused;
      }
    }
  }
}

export async function waitForReadiness(
  plan: ComposeSandboxPlan,
  deps: ReadinessDeps = {},
  outerSignal?: AbortSignal,
): Promise<void> {
  const clock = deps.clock ?? defaultClock();
  const scheduler = getScheduler(clock);
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
  const abortSignal = abortInner.signal;

  const probeStatus = new Map<string, { probe: ReadinessProbe; done: boolean; lastError?: Error; nextAt: number }>();
  for (const p of probes) {
    const interval = (p as unknown as { intervalMs?: number }).intervalMs ?? 1000;
    probeStatus.set(describeProbe(p), { probe: p, done: false, nextAt: startMs });
    void interval;
  }

  let fatalError: Error | undefined;

  function remainingMs(): number {
    return deadline - clock.now();
  }

  function clampTimeout(probeTimeout: number): number {
    const rem = remainingMs();
    if (rem <= 0) return 0;
    return Math.min(probeTimeout, rem);
  }

  let snapshotCache: Map<
    string,
    { service: string; state: string; status: string; exitCode?: number; exists: boolean }
  > | null = null;
  let snapshotAt = 0;
  const SNAPSHOT_TTL_MS = 5;

  async function getSnapshot(
    rem: number,
  ): Promise<Map<string, { service: string; state: string; status: string; exitCode?: number; exists: boolean }>> {
    const now = clock.now();
    if (snapshotCache && now - snapshotAt < SNAPSHOT_TTL_MS) {
      return snapshotCache;
    }
    const effective = clampTimeout(rem);
    if (deps.getServiceSnapshot) {
      const m = await deps.getServiceSnapshot({ signal: abortSignal, timeoutMs: effective });
      snapshotCache = m;
      snapshotAt = clock.now();
      return m;
    }
    const pendingServices = [...probeStatus.values()]
      .filter((v) => !v.done && (v.probe.type === 'service-running' || v.probe.type === 'service-completed'))
      .map((v) => (v.probe as ServiceRunningProbe | ServiceCompletedProbe).service);
    const distinct = [...new Set(pendingServices)];
    if (distinct.length === 0) {
      const empty = new Map();
      snapshotCache = empty;
      snapshotAt = now;
      return empty;
    }
    const entries: Array<
      [string, { service: string; state: string; status: string; exitCode?: number; exists: boolean }]
    > = [];
    for (const svc of distinct) {
      try {
        const st = await fetchServiceStateWithBudget(svc, deps, plan, abortSignal, effective);
        entries.push([svc, st]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('not found') ||
          msg.includes('never been created') ||
          msg.includes('failed to parse') ||
          msg.includes('failed to inspect')
        ) {
          const probeForSvc = [...probeStatus.values()].find(
            (v) => (v.probe as { service?: string }).service === svc,
          )?.probe;
          const pType = probeForSvc ? probeForSvc.type : 'service';
          if (msg.includes('failed to parse') || msg.includes('failed to inspect')) {
            throw new ReadinessProbeError(
              `service ${svc} inspect failed: ${msg}`,
              describeProbe(probeForSvc as ReadinessProbe),
            );
          }
          throw new ServiceProbeError(`service ${svc} not found: ${msg}`, svc, 'missing', undefined, pType);
        }
        throw err;
      }
    }
    const m = new Map<string, { service: string; state: string; status: string; exitCode?: number; exists: boolean }>();
    for (const [svc, st] of entries) m.set(svc, st);
    snapshotCache = m;
    snapshotAt = clock.now();
    return m;
  }

  async function checkOneWithBudget(
    probe: ReadinessProbe,
    snapshot: Map<
      string,
      { service: string; state: string; status: string; exitCode?: number; exists: boolean }
    > | null,
  ): Promise<boolean> {
    const rem = remainingMs();
    if (rem <= 0) return false;
    const effective = clampTimeout((probe as unknown as { timeoutMs: number }).timeoutMs ?? 5000);
    if (effective <= 0) return false;
    let inner: Promise<boolean>;
    switch (probe.type) {
      case 'tcp':
        inner = checkTcp(probe, deps, abortSignal, effective);
        break;
      case 'http':
        inner = checkHttp(probe, deps, abortSignal, effective);
        break;
      case 'service-running': {
        const st = snapshot?.get((probe as ServiceRunningProbe).service);
        if (!st) {
          inner = (async () => {
            const s = await fetchServiceStateWithBudget(
              (probe as ServiceRunningProbe).service,
              deps,
              plan,
              abortSignal,
              effective,
            );
            return checkServiceRunningWithState(probe as ServiceRunningProbe, s);
          })();
        } else {
          inner = checkServiceRunningWithState(probe as ServiceRunningProbe, st);
        }
        break;
      }
      case 'service-completed': {
        const st = snapshot?.get((probe as ServiceCompletedProbe).service);
        if (!st) {
          inner = (async () => {
            const s = await fetchServiceStateWithBudget(
              (probe as ServiceCompletedProbe).service,
              deps,
              plan,
              abortSignal,
              effective,
            );
            return checkServiceCompletedWithState(probe as ServiceCompletedProbe, s);
          })();
        } else {
          inner = checkServiceCompletedWithState(probe as ServiceCompletedProbe, st);
        }
        break;
      }
      case 'command':
        inner = checkCommand(probe as CommandProbe, deps, abortSignal, effective);
        break;
      default:
        inner = Promise.resolve(false);
    }
    return raceWithBudgetAndSignal(inner, effective, abortSignal, scheduler);
  }

  try {
    while (true) {
      if (abortSignal.aborted) {
        throw abortSignal.reason ?? new Error('aborted');
      }
      const rem = remainingMs();
      if (rem <= 0) break;

      const pendingEntries = [...probeStatus.entries()].filter(([, v]) => !v.done);
      if (pendingEntries.length === 0) break;

      const now = clock.now();
      const due = pendingEntries.filter(([, v]) => now >= v.nextAt);
      if (due.length === 0) {
        const nextAt = Math.min(...pendingEntries.map(([, v]) => v.nextAt));
        const sleepMs = Math.min(nextAt - now, rem);
        if (sleepMs <= 0) continue;
        await sleepWithAbort(clock, scheduler, sleepMs, abortSignal);
        continue;
      }

      // Determine if any due is service probe needing snapshot
      const needsSnapshot = due.some(
        ([, v]) => v.probe.type === 'service-running' || v.probe.type === 'service-completed',
      );
      let snapshot: Map<
        string,
        { service: string; state: string; status: string; exitCode?: number; exists: boolean }
      > | null = null;
      if (needsSnapshot) {
        try {
          snapshot = await raceWithBudgetAndSignal(getSnapshot(rem), clampTimeout(5000), abortSignal, scheduler);
        } catch (err) {
          const e = err instanceof Error ? err : new Error(String(err));
          if (e instanceof ServiceProbeError || e instanceof ReadinessProbeError) {
            if (!fatalError) {
              fatalError = e;
              try {
                abortInner.abort(e);
              } catch (_unused) {
                void _unused;
              }
            }
            throw e;
          }
          if (abortSignal.aborted) throw abortSignal.reason ?? e;
          // Snapshot fetch failed non-fatally: treat as not ready for this cycle
          snapshot = null;
        }
      }

      // Process due probes in input order for deterministic fatal selection
      const orderedDue = [...due].sort((a, b) => probes.indexOf(a[1].probe) - probes.indexOf(b[1].probe));
      const results = await Promise.allSettled(
        orderedDue.map(async ([key, entry]) => {
          try {
            const ok = await checkOneWithBudget(entry.probe, snapshot);
            return { key, ok };
          } catch (err) {
            const e = err instanceof Error ? err : new Error(String(err));
            throw { key, err: e };
          }
        }),
      );

      let hadFatalInThisCycle = false;
      for (const res of results) {
        if (res.status === 'fulfilled') {
          const { key, ok } = res.value as { key: string; ok: boolean };
          if (ok) {
            const ent = probeStatus.get(key);
            if (ent) ent.done = true;
          } else {
            const ent = probeStatus.get(key);
            if (ent) {
              const interval = (ent.probe as unknown as { intervalMs?: number }).intervalMs ?? 1000;
              ent.nextAt = clock.now() + Math.min(interval, remainingMs());
            }
          }
        } else {
          const reason = (res.reason as { key: string; err: Error }) ?? { key: '', err: new Error(String(res.reason)) };
          const e = reason.err;
          const key = reason.key;
          if (e instanceof ServiceProbeError || e instanceof ReadinessProbeError) {
            if (!fatalError) {
              fatalError = e;
              try {
                abortInner.abort(e);
              } catch (_unused) {
                void _unused;
              }
            }
            hadFatalInThisCycle = true;
          } else {
            if (String(e.message).toLowerCase().includes('abort')) {
              throw e;
            }
            const ent = probeStatus.get(key);
            if (ent) {
              ent.lastError = e;
              const interval = (ent.probe as unknown as { intervalMs?: number }).intervalMs ?? 1000;
              ent.nextAt = clock.now() + Math.min(interval, remainingMs());
            }
          }
        }
      }
      if (hadFatalInThisCycle && fatalError) throw fatalError;

      const remainingAfter = remainingMs();
      if (remainingAfter <= 0) break;
      if ([...probeStatus.values()].every((v) => v.done)) break;
      // If no progress and no fatal, loop will sleep to next due
    }
  } finally {
    if (outerSignal) {
      try {
        outerSignal.removeEventListener('abort', onOuterAbort);
      } catch (_unused) {
        void _unused;
      }
    }
  }

  if (abortSignal.aborted) {
    const reason = abortInner.signal.reason;
    if (fatalError && reason === fatalError) throw fatalError;
    // If abort due to deadline, fall through to timeout handling
    if (fatalError) throw fatalError;
    if (outerSignal?.aborted) throw outerSignal.reason ?? reason ?? new Error('aborted');
    if (
      String((reason as Error)?.message ?? '')
        .toLowerCase()
        .includes('aborted')
    )
      throw reason as Error;
    // If deadline abort, continue to unsatisfied handling unless fatal
    if (!fatalError && remainingMs() <= 0) {
      // treat as timeout
    } else {
      throw reason ?? new Error('aborted');
    }
  }
  if (outerSignal?.aborted) throw outerSignal.reason ?? new Error('aborted');
  if (fatalError) throw fatalError;

  const unsatisfied: string[] = [];
  for (const [key, val] of probeStatus.entries()) {
    if (!val.done) unsatisfied.push(key);
  }
  if (unsatisfied.length > 0) {
    const elapsed = clock.now() - startMs;
    throw new ReadinessTimeoutError(
      `readiness timeout after ${elapsed}ms: unsatisfied probes: ${unsatisfied.join(', ')}`,
      unsatisfied,
      elapsed,
    );
  }
}

export function _internalForTests() {
  return { httpStatusMatches, defaultTcpConnect, defaultHttpFetch, describeProbe };
}
