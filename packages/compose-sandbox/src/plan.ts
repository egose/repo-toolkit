import { isAbsolute, relative, resolve } from 'node:path';

import { isPlainObject } from '@repo-toolkit/publish-package';

const DEFAULT_COMPOSE_EXECUTABLE = 'docker';
const DEFAULT_EVIDENCE_DIRECTORY = '.compose-sandbox-logs';
const DEFAULT_EVIDENCE_CAPTURE = 'onFailure' as const;
const DEFAULT_MAX_LOG_BYTES = 1_048_576;
const DEFAULT_STRIP_ANSI = true;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_PROBE_INTERVAL_MS = 1_000;
const DEFAULT_COMMAND_PROBE_TIMEOUT_MS = 30_000;

const DEFAULT_TIMEOUTS = {
  startupMs: 120_000,
  readinessMs: 120_000,
  testMs: 300_000,
  cleanupMs: 30_000,
} as const;

const MAX_TIMEOUT_MS = 86_400_000;
const MAX_INTERVAL_MS = 60_000;
const MAX_LOG_BYTES = 10_485_760;
const MAX_PORT = 65_535;

export type EvidenceCapture = 'always' | 'onFailure';

export interface StructuredCommandOptions {
  readonly executable: string;
  readonly args?: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
}

export interface StructuredCommand {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly resolvedCwd?: string;
}

export interface ComposeSandboxComposeOptions {
  readonly executable?: string;
  readonly files: ReadonlyArray<string>;
  readonly envFile?: string;
  readonly projectName?: string;
  readonly profiles?: ReadonlyArray<string>;
  readonly build?: boolean;
  readonly pull?: boolean;
}

export interface ComposeSandboxComposePlan {
  readonly executable: string;
  readonly files: ReadonlyArray<string>;
  readonly resolvedFiles: ReadonlyArray<string>;
  readonly envFile?: string;
  readonly resolvedEnvFile?: string;
  readonly projectName?: string;
  readonly profiles: ReadonlyArray<string>;
  readonly build: boolean;
  readonly pull: boolean;
}

export interface PrepareOptions {
  readonly directories?: ReadonlyArray<string>;
  readonly copies?: ReadonlyArray<{ readonly from: string; readonly to: string }>;
}

export interface PreparePlan {
  readonly directories: ReadonlyArray<string>;
  readonly resolvedDirectories: ReadonlyArray<string>;
  readonly copies: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
    readonly resolvedFrom: string;
    readonly resolvedTo: string;
  }>;
}

export interface TcpProbeOptions {
  readonly type: 'tcp';
  readonly host: string;
  readonly port: number;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

export interface HttpProbeOptions {
  readonly type: 'http';
  readonly url: string;
  readonly method?: string;
  readonly expectedStatus?: number | ReadonlyArray<number>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

export interface ServiceRunningProbeOptions {
  readonly type: 'service-running';
  readonly service: string;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

export interface ServiceCompletedProbeOptions {
  readonly type: 'service-completed';
  readonly service: string;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
}

export interface CommandProbeOptions {
  readonly type: 'command';
  readonly executable: string;
  readonly args?: ReadonlyArray<string>;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export type ReadinessProbeOptions =
  | TcpProbeOptions
  | HttpProbeOptions
  | ServiceRunningProbeOptions
  | ServiceCompletedProbeOptions
  | CommandProbeOptions;

export interface TcpProbe {
  readonly type: 'tcp';
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
  readonly intervalMs: number;
}

export interface HttpProbe {
  readonly type: 'http';
  readonly url: string;
  readonly method: string;
  readonly expectedStatus: ReadonlyArray<number>;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly intervalMs: number;
}

export interface ServiceRunningProbe {
  readonly type: 'service-running';
  readonly service: string;
  readonly timeoutMs: number;
  readonly intervalMs: number;
}

export interface ServiceCompletedProbe {
  readonly type: 'service-completed';
  readonly service: string;
  readonly timeoutMs: number;
  readonly intervalMs: number;
}

export interface CommandProbe {
  readonly type: 'command';
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
}

export type ReadinessProbe = TcpProbe | HttpProbe | ServiceRunningProbe | ServiceCompletedProbe | CommandProbe;

export interface EvidenceOptions {
  readonly directory?: string;
  readonly capture?: EvidenceCapture;
  readonly maxLogBytes?: number;
  readonly stripAnsi?: boolean;
}

export interface EvidencePlan {
  readonly directory: string;
  readonly resolvedDirectory: string;
  readonly capture: EvidenceCapture;
  readonly maxLogBytes: number;
  readonly stripAnsi: boolean;
}

export interface CleanupOptions {
  readonly volumes?: boolean;
  readonly removeOrphans?: boolean;
  readonly paths?: ReadonlyArray<string>;
}

export interface CleanupPlan {
  readonly volumes: boolean;
  readonly removeOrphans: boolean;
  readonly paths: ReadonlyArray<string>;
  readonly resolvedPaths: ReadonlyArray<string>;
}

export interface TimeoutOptions {
  readonly startupMs?: number;
  readonly readinessMs?: number;
  readonly testMs?: number;
  readonly cleanupMs?: number;
  readonly totalMs?: number;
}

export interface TimeoutPlan {
  readonly startupMs: number;
  readonly readinessMs: number;
  readonly testMs: number;
  readonly cleanupMs: number;
  readonly totalMs?: number;
}

export interface ComposeSandboxOptions {
  readonly cwd?: string;
  readonly compose?: ComposeSandboxComposeOptions;
  readonly prepare?: PrepareOptions;
  readonly readiness?: ReadonlyArray<ReadinessProbeOptions>;
  readonly test: StructuredCommandOptions;
  readonly evidence?: EvidenceOptions;
  readonly cleanup?: CleanupOptions;
  readonly timeouts?: TimeoutOptions;
  readonly dryRun?: boolean;
  readonly config?: string;
}

export interface ComposeSandboxPlan {
  readonly cwd: string;
  readonly compose: ComposeSandboxComposePlan;
  readonly prepare: PreparePlan;
  readonly readiness: ReadonlyArray<ReadinessProbe>;
  readonly test: StructuredCommand;
  readonly evidence: EvidencePlan;
  readonly cleanup: CleanupPlan;
  readonly timeouts: TimeoutPlan;
  readonly dryRun: boolean;
}

const TOP_LEVEL_KEYS = new Set([
  'cwd',
  'compose',
  'prepare',
  'readiness',
  'test',
  'evidence',
  'cleanup',
  'timeouts',
  'dryRun',
  'config',
]);
const COMPOSE_KEYS = new Set(['executable', 'files', 'envFile', 'projectName', 'profiles', 'build', 'pull']);
const PREPARE_KEYS = new Set(['directories', 'copies']);
const COPY_KEYS = new Set(['from', 'to']);
const EVIDENCE_KEYS = new Set(['directory', 'capture', 'maxLogBytes', 'stripAnsi']);
const CLEANUP_KEYS = new Set(['volumes', 'removeOrphans', 'paths']);
const TIMEOUT_KEYS = new Set(['startupMs', 'readinessMs', 'testMs', 'cleanupMs', 'totalMs']);
const COMMAND_KEYS = new Set(['executable', 'args', 'env', 'cwd']);
const TCP_PROBE_KEYS = new Set(['type', 'host', 'port', 'timeoutMs', 'intervalMs']);
const HTTP_PROBE_KEYS = new Set(['type', 'url', 'method', 'expectedStatus', 'headers', 'timeoutMs', 'intervalMs']);
const SERVICE_RUNNING_KEYS = new Set(['type', 'service', 'timeoutMs', 'intervalMs']);
const SERVICE_COMPLETED_KEYS = new Set(['type', 'service', 'timeoutMs', 'intervalMs']);
const COMMAND_PROBE_KEYS = new Set(['type', 'executable', 'args', 'env', 'timeoutMs']);

export function resolveComposeSandboxPlan(options: unknown = {}): ComposeSandboxPlan {
  const input = validateOptions(options);
  const cwd = resolveCwd(input.cwd);
  const compose = resolveCompose(input.compose, cwd);
  const prepare = resolvePrepare(input.prepare, cwd);
  const readiness = resolveReadiness(input.readiness);
  const test = resolveTestCommand(input.test, cwd);
  const evidence = resolveEvidence(input.evidence, cwd);
  const cleanup = resolveCleanup(input.cleanup, cwd);
  const timeouts = resolveTimeouts(input.timeouts);
  const dryRun = input.dryRun ?? false;

  const plan: ComposeSandboxPlan = {
    cwd,
    compose,
    prepare,
    readiness,
    test,
    evidence,
    cleanup,
    timeouts,
    dryRun,
  };

  return deepFreeze(plan) as ComposeSandboxPlan;
}

function validateOptions(value: unknown): ComposeSandboxOptions {
  const options = requireObject(value, 'options');
  rejectUnknownKeys(options, TOP_LEVEL_KEYS, 'option');
  if (options.cwd !== undefined) {
    validateNonEmptyString(options.cwd, 'cwd');
  }
  if (options.compose !== undefined) {
    requireObject(options.compose, 'compose');
  } else {
    throw new Error('compose is required');
  }
  if (options.prepare !== undefined) {
    requireObject(options.prepare, 'prepare');
  }
  if (options.readiness !== undefined) {
    if (!Array.isArray(options.readiness)) {
      throw new Error('readiness must be an array');
    }
  }
  if (options.test === undefined) {
    throw new Error('test is required');
  }
  requireObject(options.test, 'test');
  if (options.evidence !== undefined) {
    requireObject(options.evidence, 'evidence');
  }
  if (options.cleanup !== undefined) {
    requireObject(options.cleanup, 'cleanup');
  }
  if (options.timeouts !== undefined) {
    requireObject(options.timeouts, 'timeouts');
  }
  if (options.dryRun !== undefined && typeof options.dryRun !== 'boolean') {
    throw new Error('dryRun must be a boolean');
  }
  if (options.config !== undefined) {
    validateNonEmptyString(options.config, 'config');
  }
  return options as unknown as ComposeSandboxOptions;
}

function resolveCwd(value: string | undefined): string {
  const raw = value ?? '.';
  const input = validateNonEmptyString(raw, 'cwd');
  if (input.includes('\0')) {
    throw new Error('cwd must not contain NUL bytes');
  }
  if (isAbsolute(input) && input.includes('\0')) {
    throw new Error('cwd must not contain NUL bytes');
  }
  const resolved = resolve(input);
  if (resolved.includes('\0')) {
    throw new Error('cwd must not contain NUL bytes');
  }
  return resolved;
}

function resolveCompose(value: ComposeSandboxComposeOptions | undefined, cwd: string): ComposeSandboxComposePlan {
  if (!value) {
    throw new Error('compose is required');
  }
  const obj = requireObject(value, 'compose') as Record<string, unknown>;
  rejectUnknownKeys(obj, COMPOSE_KEYS, 'compose option');
  const executable = validateNonEmptyString(
    (obj.executable as string) ?? DEFAULT_COMPOSE_EXECUTABLE,
    'compose.executable',
  );
  if (executable.includes('\0')) {
    throw new Error('compose.executable must not contain NUL bytes');
  }
  if (obj.build !== undefined && typeof obj.build !== 'boolean') {
    throw new Error('compose.build must be a boolean');
  }
  if (obj.pull !== undefined && typeof obj.pull !== 'boolean') {
    throw new Error('compose.pull must be a boolean');
  }
  validateOptionalStringArray(obj.profiles as unknown, 'compose.profiles');
  const profiles = ((obj.profiles as ReadonlyArray<string> | undefined) ?? []).map((p, idx) => {
    const name = validateNonEmptyString(p, `compose.profiles[${idx}]`);
    if (name.includes('\0')) {
      throw new Error(`compose.profiles[${idx}] must not contain NUL bytes`);
    }
    validateServiceName(name, `compose.profiles[${idx}]`);
    return name;
  });
  if (obj.files === undefined) {
    throw new Error('compose.files is required');
  }
  if (!Array.isArray(obj.files)) {
    throw new Error('compose.files must be an array');
  }
  const filesRaw = obj.files as unknown[];
  if (filesRaw.length === 0) {
    throw new Error('compose.files must contain at least one entry');
  }
  const files: string[] = [];
  const resolvedFiles: string[] = [];
  for (let i = 0; i < filesRaw.length; i += 1) {
    const label = `compose.files[${i}]`;
    const normalized = normalizeRelativePath(filesRaw[i], label);
    ensureContainedPath(cwd, resolve(cwd, normalized), label);
    files.push(normalized);
    resolvedFiles.push(resolve(cwd, normalized));
  }
  let envFile: string | undefined;
  let resolvedEnvFile: string | undefined;
  if (obj.envFile !== undefined) {
    const label = 'compose.envFile';
    const normalized = normalizeRelativePath(obj.envFile, label);
    ensureContainedPath(cwd, resolve(cwd, normalized), label);
    envFile = normalized;
    resolvedEnvFile = resolve(cwd, normalized);
  }
  let projectName: string | undefined;
  if (obj.projectName !== undefined) {
    projectName = validateProjectName(obj.projectName, 'compose.projectName');
  }

  const plan: ComposeSandboxComposePlan = {
    executable,
    files: Object.freeze([...files]),
    resolvedFiles: Object.freeze([...resolvedFiles]),
    ...(envFile !== undefined ? { envFile } : {}),
    ...(resolvedEnvFile !== undefined ? { resolvedEnvFile } : {}),
    ...(projectName !== undefined ? { projectName } : {}),
    profiles: Object.freeze([...profiles]),
    build: (obj.build as boolean) ?? false,
    pull: (obj.pull as boolean) ?? false,
  };
  return plan;
}

function resolvePrepare(value: PrepareOptions | undefined, cwd: string): PreparePlan {
  if (value === undefined) {
    return {
      directories: Object.freeze([]),
      resolvedDirectories: Object.freeze([]),
      copies: Object.freeze([]),
    };
  }
  const obj = requireObject(value, 'prepare') as Record<string, unknown>;
  rejectUnknownKeys(obj, PREPARE_KEYS, 'prepare option');
  const directories: string[] = [];
  const resolvedDirectories: string[] = [];
  if (obj.directories !== undefined) {
    if (!Array.isArray(obj.directories)) {
      throw new Error('prepare.directories must be an array');
    }
    const dirs = obj.directories as unknown[];
    for (let i = 0; i < dirs.length; i += 1) {
      const label = `prepare.directories[${i}]`;
      const normalized = normalizeRelativePath(dirs[i], label);
      if (normalized === '.' || normalized === '') {
        throw new Error(`${label} must not be the project root`);
      }
      ensureContainedPath(cwd, resolve(cwd, normalized), label);
      directories.push(normalized);
      resolvedDirectories.push(resolve(cwd, normalized));
    }
  }
  const copies: Array<{ from: string; to: string; resolvedFrom: string; resolvedTo: string }> = [];
  if (obj.copies !== undefined) {
    if (!Array.isArray(obj.copies)) {
      throw new Error('prepare.copies must be an array');
    }
    const list = obj.copies as unknown[];
    for (let i = 0; i < list.length; i += 1) {
      const label = `prepare.copies[${i}]`;
      const entry = requireObject(list[i], label) as Record<string, unknown>;
      rejectUnknownKeys(entry, COPY_KEYS, label);
      const from = normalizeRelativePath(entry.from, `${label}.from`);
      const to = normalizeRelativePath(entry.to, `${label}.to`);
      if (from === '.' || to === '.') {
        throw new Error(`${label} paths must not be the project root`);
      }
      ensureContainedPath(cwd, resolve(cwd, from), `${label}.from`);
      ensureContainedPath(cwd, resolve(cwd, to), `${label}.to`);
      copies.push({
        from,
        to,
        resolvedFrom: resolve(cwd, from),
        resolvedTo: resolve(cwd, to),
      });
    }
  }
  return {
    directories: Object.freeze([...directories]),
    resolvedDirectories: Object.freeze([...resolvedDirectories]),
    copies: Object.freeze(copies.map((c) => Object.freeze({ ...c }))),
  };
}

function resolveReadiness(value: ReadonlyArray<ReadinessProbeOptions> | undefined): ReadonlyArray<ReadinessProbe> {
  if (value === undefined) {
    return Object.freeze([]);
  }
  if (!Array.isArray(value)) {
    throw new Error('readiness must be an array');
  }
  const probes: ReadinessProbe[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < value.length; i += 1) {
    const raw = value[i];
    const label = `readiness[${i}]`;
    const entry = requireObject(raw, label) as Record<string, unknown>;
    if (typeof entry.type !== 'string') {
      throw new Error(`${label}.type must be a non-empty string`);
    }
    if ((entry.type as string).includes('\0')) {
      throw new Error(`${label}.type must not contain NUL bytes`);
    }
    const type = entry.type as string;
    let probe: ReadinessProbe;
    let dedupeKey: string;
    if (type === 'tcp') {
      rejectUnknownKeys(entry, TCP_PROBE_KEYS, label);
      const host = validateNonEmptyString(entry.host, `${label}.host`);
      if (host.includes('\0')) throw new Error(`${label}.host must not contain NUL bytes`);
      const port = validatePort(entry.port, `${label}.port`);
      const timeoutMs = validateBoundedTimeout(entry.timeoutMs, `${label}.timeoutMs`, DEFAULT_PROBE_TIMEOUT_MS);
      const intervalMs = validateBoundedInterval(entry.intervalMs, `${label}.intervalMs`, DEFAULT_PROBE_INTERVAL_MS);
      probe = { type: 'tcp', host, port, timeoutMs, intervalMs };
      dedupeKey = `tcp:${host}:${port}`;
    } else if (type === 'http') {
      rejectUnknownKeys(entry, HTTP_PROBE_KEYS, label);
      const url = validateHttpUrl(entry.url, `${label}.url`);
      const method = validateHttpMethod(entry.method, `${label}.method`);
      const expectedStatus = validateExpectedStatus(entry.expectedStatus, `${label}.expectedStatus`);
      const headers = validateHeaders(entry.headers, `${label}.headers`);
      const timeoutMs = validateBoundedTimeout(entry.timeoutMs, `${label}.timeoutMs`, DEFAULT_PROBE_TIMEOUT_MS);
      const intervalMs = validateBoundedInterval(entry.intervalMs, `${label}.intervalMs`, DEFAULT_PROBE_INTERVAL_MS);
      probe = { type: 'http', url, method, expectedStatus, headers, timeoutMs, intervalMs };
      dedupeKey = `http:${method}:${url}`;
    } else if (type === 'service-running') {
      rejectUnknownKeys(entry, SERVICE_RUNNING_KEYS, label);
      const service = validateServiceName(entry.service, `${label}.service`);
      const timeoutMs = validateBoundedTimeout(entry.timeoutMs, `${label}.timeoutMs`, DEFAULT_PROBE_TIMEOUT_MS);
      const intervalMs = validateBoundedInterval(entry.intervalMs, `${label}.intervalMs`, DEFAULT_PROBE_INTERVAL_MS);
      probe = { type: 'service-running', service, timeoutMs, intervalMs };
      dedupeKey = `service-running:${service}`;
    } else if (type === 'service-completed') {
      rejectUnknownKeys(entry, SERVICE_COMPLETED_KEYS, label);
      const service = validateServiceName(entry.service, `${label}.service`);
      const timeoutMs = validateBoundedTimeout(entry.timeoutMs, `${label}.timeoutMs`, DEFAULT_PROBE_TIMEOUT_MS);
      const intervalMs = validateBoundedInterval(entry.intervalMs, `${label}.intervalMs`, DEFAULT_PROBE_INTERVAL_MS);
      probe = { type: 'service-completed', service, timeoutMs, intervalMs };
      dedupeKey = `service-completed:${service}`;
    } else if (type === 'command') {
      rejectUnknownKeys(entry, COMMAND_PROBE_KEYS, label);
      const executable = validateNonEmptyString(entry.executable, `${label}.executable`);
      if (executable.includes('\0')) throw new Error(`${label}.executable must not contain NUL bytes`);
      const args = validateStringArray(entry.args, `${label}.args`);
      const env = validateEnvRecord(entry.env, `${label}.env`);
      const timeoutMs = validateBoundedTimeout(entry.timeoutMs, `${label}.timeoutMs`, DEFAULT_COMMAND_PROBE_TIMEOUT_MS);
      probe = { type: 'command', executable, args, env, timeoutMs };
      dedupeKey = `command:${executable}:${args.join('\0')}`;
    } else {
      throw new Error(`${label}.type must be one of tcp, http, service-running, service-completed, command`);
    }
    if (seen.has(dedupeKey)) {
      throw new Error(`Duplicate readiness probe: ${dedupeKey} at ${label}`);
    }
    seen.add(dedupeKey);
    // also detect conflicting service probes: same service with different types considered distinct, but we could warn? For now only exact duplicate rejected.
    probes.push(Object.freeze(probe) as ReadinessProbe);
  }
  return Object.freeze([...probes]);
}

function resolveTestCommand(value: StructuredCommandOptions | undefined, cwd: string): StructuredCommand {
  if (!value) {
    throw new Error('test is required');
  }
  const obj = requireObject(value, 'test') as Record<string, unknown>;
  rejectUnknownKeys(obj, COMMAND_KEYS, 'test');
  const executable = validateNonEmptyString(obj.executable, 'test.executable');
  if (executable.includes('\0')) throw new Error('test.executable must not contain NUL bytes');
  const args = validateStringArray(obj.args, 'test.args');
  const env = validateEnvRecord(obj.env, 'test.env');
  let resolvedCwd: string | undefined;
  let cwdVal: string | undefined;
  if (obj.cwd !== undefined) {
    const label = 'test.cwd';
    const normalized = normalizeRelativePath(obj.cwd, label);
    ensureContainedPath(cwd, resolve(cwd, normalized), label);
    cwdVal = normalized;
    resolvedCwd = resolve(cwd, normalized);
  }
  const plan: StructuredCommand = {
    executable,
    args: Object.freeze([...args]),
    env: Object.freeze({ ...env }),
    ...(cwdVal !== undefined ? { cwd: cwdVal } : {}),
    ...(resolvedCwd !== undefined ? { resolvedCwd } : {}),
  };
  return plan;
}

function resolveEvidence(value: EvidenceOptions | undefined, cwd: string): EvidencePlan {
  if (value === undefined) {
    const directory = DEFAULT_EVIDENCE_DIRECTORY;
    return {
      directory,
      resolvedDirectory: resolve(cwd, directory),
      capture: DEFAULT_EVIDENCE_CAPTURE,
      maxLogBytes: DEFAULT_MAX_LOG_BYTES,
      stripAnsi: DEFAULT_STRIP_ANSI,
    };
  }
  const obj = requireObject(value, 'evidence') as Record<string, unknown>;
  rejectUnknownKeys(obj, EVIDENCE_KEYS, 'evidence option');
  const directory =
    obj.directory !== undefined
      ? normalizeRelativePath(obj.directory, 'evidence.directory')
      : DEFAULT_EVIDENCE_DIRECTORY;
  if (directory === '.' || directory === '') {
    throw new Error('evidence.directory must not be the project root');
  }
  ensureContainedPath(cwd, resolve(cwd, directory), 'evidence.directory');
  const capture =
    obj.capture !== undefined ? validateCapture(obj.capture, 'evidence.capture') : DEFAULT_EVIDENCE_CAPTURE;
  const maxLogBytes =
    obj.maxLogBytes !== undefined
      ? validateBoundedLogBytes(obj.maxLogBytes, 'evidence.maxLogBytes')
      : DEFAULT_MAX_LOG_BYTES;
  if (obj.stripAnsi !== undefined && typeof obj.stripAnsi !== 'boolean') {
    throw new Error('evidence.stripAnsi must be a boolean');
  }
  const stripAnsi = (obj.stripAnsi as boolean) ?? DEFAULT_STRIP_ANSI;
  return {
    directory,
    resolvedDirectory: resolve(cwd, directory),
    capture,
    maxLogBytes,
    stripAnsi,
  };
}

function resolveCleanup(value: CleanupOptions | undefined, cwd: string): CleanupPlan {
  if (value === undefined) {
    return {
      volumes: false,
      removeOrphans: true,
      paths: Object.freeze([]),
      resolvedPaths: Object.freeze([]),
    };
  }
  const obj = requireObject(value, 'cleanup') as Record<string, unknown>;
  rejectUnknownKeys(obj, CLEANUP_KEYS, 'cleanup option');
  if (obj.volumes !== undefined && typeof obj.volumes !== 'boolean') {
    throw new Error('cleanup.volumes must be a boolean');
  }
  if (obj.removeOrphans !== undefined && typeof obj.removeOrphans !== 'boolean') {
    throw new Error('cleanup.removeOrphans must be a boolean');
  }
  const volumes = (obj.volumes as boolean) ?? false;
  const removeOrphans = obj.removeOrphans !== undefined ? (obj.removeOrphans as boolean) : true;
  const paths: string[] = [];
  const resolvedPaths: string[] = [];
  if (obj.paths !== undefined) {
    if (!Array.isArray(obj.paths)) {
      throw new Error('cleanup.paths must be an array');
    }
    const list = obj.paths as unknown[];
    const seen = new Set<string>();
    for (let i = 0; i < list.length; i += 1) {
      const label = `cleanup.paths[${i}]`;
      const normalized = normalizeRelativePath(list[i], label);
      if (normalized === '.' || normalized === '') {
        throw new Error(`${label} must not be the project root`);
      }
      if (seen.has(normalized)) {
        throw new Error(`Duplicate cleanup path: ${normalized}`);
      }
      seen.add(normalized);
      ensureContainedPath(cwd, resolve(cwd, normalized), label);
      const resolved = resolve(cwd, normalized);
      if (resolved === cwd) {
        throw new Error(`${label} must not resolve to the project root`);
      }
      paths.push(normalized);
      resolvedPaths.push(resolved);
    }
  }
  return {
    volumes,
    removeOrphans,
    paths: Object.freeze([...paths]),
    resolvedPaths: Object.freeze([...resolvedPaths]),
  };
}

function resolveTimeouts(value: TimeoutOptions | undefined): TimeoutPlan {
  if (value === undefined) {
    return { ...DEFAULT_TIMEOUTS };
  }
  const obj = requireObject(value, 'timeouts') as Record<string, unknown>;
  rejectUnknownKeys(obj, TIMEOUT_KEYS, 'timeouts option');
  const startupMs = validateBoundedTimeout(obj.startupMs, 'timeouts.startupMs', DEFAULT_TIMEOUTS.startupMs);
  const readinessMs = validateBoundedTimeout(obj.readinessMs, 'timeouts.readinessMs', DEFAULT_TIMEOUTS.readinessMs);
  const testMs = validateBoundedTimeout(obj.testMs, 'timeouts.testMs', DEFAULT_TIMEOUTS.testMs);
  const cleanupMs = validateBoundedTimeout(obj.cleanupMs, 'timeouts.cleanupMs', DEFAULT_TIMEOUTS.cleanupMs);
  let totalMs: number | undefined;
  if (obj.totalMs !== undefined) {
    totalMs = validateBoundedTimeout(obj.totalMs, 'timeouts.totalMs', undefined);
    if (totalMs !== undefined && typeof totalMs === 'number') {
      // totalMs must be at least max of other timeouts? Not required but validate bounded.
    }
  }
  const plan: TimeoutPlan = {
    startupMs,
    readinessMs,
    testMs,
    cleanupMs,
    ...(totalMs !== undefined ? { totalMs } : {}),
  };
  return plan;
}

function validateProjectName(value: unknown, label: string): string {
  const name = validateNonEmptyString(value, label);
  if (name.includes('\0')) throw new Error(`${label} must not contain NUL bytes`);
  if (!/^[a-z0-9][a-z0-9_-]*$/u.test(name)) {
    throw new Error(`${label} must match ^[a-z0-9][a-z0-9_-]*$`);
  }
  if (name.length > 64) {
    throw new Error(`${label} must be at most 64 characters`);
  }
  return name;
}

function validateServiceName(value: unknown, label: string): string {
  const name = validateNonEmptyString(value, label);
  if (name.includes('\0')) throw new Error(`${label} must not contain NUL bytes`);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(name)) {
    throw new Error(`${label} must match ^[a-zA-Z0-9][a-zA-Z0-9_-]*$`);
  }
  return name;
}

function validatePort(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_PORT) {
    throw new Error(`${label} must be an integer 1-${MAX_PORT}`);
  }
  return value;
}

function validateHttpUrl(value: unknown, label: string): string {
  const urlStr = validateNonEmptyString(value, label);
  if (urlStr.includes('\0')) throw new Error(`${label} must not contain NUL bytes`);
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use http or https`);
  }
  if (!parsed.host) {
    throw new Error(`${label} must contain a host`);
  }
  return urlStr;
}

function validateHttpMethod(value: unknown, label: string): string {
  if (value === undefined) return 'GET';
  const method = validateNonEmptyString(value, label);
  if (method.includes('\0')) throw new Error(`${label} must not contain NUL bytes`);
  if (!/^[A-Z]+$/u.test(method)) {
    throw new Error(`${label} must be uppercase letters`);
  }
  return method;
}

function validateExpectedStatus(value: unknown, label: string): ReadonlyArray<number> {
  if (value === undefined) {
    return Object.freeze([200, 299]);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 100 || value > 599) {
      throw new Error(`${label} must be an integer 100-599`);
    }
    return Object.freeze([value]);
  }
  if (Array.isArray(value)) {
    const arr = value as unknown[];
    if (arr.length === 0) throw new Error(`${label} must contain at least one status code`);
    if (arr.length > 20) throw new Error(`${label} must contain at most 20 status codes`);
    const nums: number[] = [];
    for (let i = 0; i < arr.length; i += 1) {
      const n = arr[i];
      if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 100 || n > 599) {
        throw new Error(`${label}[${i}] must be an integer 100-599`);
      }
      nums.push(n);
    }
    if (arr.length === 2) {
      const [a, b] = nums as [number, number];
      if (a > b) {
        throw new Error(`${label} range min must be <= max`);
      }
    }
    return Object.freeze([...nums]);
  }
  throw new Error(`${label} must be a number or array of numbers`);
}

function validateHeaders(value: unknown, label: string): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  const obj = requireObject(value, label) as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const key of Object.keys(obj)) {
    if (key.length === 0) throw new Error(`${label} header name must be non-empty`);
    if (key.includes('\0') || key.includes(':')) throw new Error(`${label} header name must not contain NUL or colon`);
    const v = obj[key];
    if (typeof v !== 'string') throw new Error(`${label}.headers[${key}] must be a string`);
    if (v.includes('\0')) throw new Error(`${label}.headers[${key}] must not contain NUL bytes`);
    result[key] = v;
  }
  return Object.freeze({ ...result });
}

function validateEnvRecord(value: unknown, label: string): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  const obj = requireObject(value, label) as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const key of Object.keys(obj)) {
    if (key.length === 0) throw new Error(`${label} env key must be non-empty`);
    if (key.includes('\0') || key.includes('=')) throw new Error(`${label} env key must not contain NUL or '='`);
    const v = obj[key];
    if (typeof v !== 'string') throw new Error(`${label}[${key}] must be a string`);
    if (v.includes('\0')) throw new Error(`${label}[${key}] must not contain NUL bytes`);
    result[key] = v;
  }
  return Object.freeze({ ...result });
}

function validateStringArray(value: unknown, label: string): ReadonlyArray<string> {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const arr = value as unknown[];
  for (let i = 0; i < arr.length; i += 1) {
    if (typeof arr[i] !== 'string') throw new Error(`${label}[${i}] must be a string`);
    const s = arr[i] as string;
    if (s.length === 0) throw new Error(`${label}[${i}] must be non-empty`);
    if (s.includes('\0')) throw new Error(`${label}[${i}] must not contain NUL bytes`);
  }
  return Object.freeze([...(arr as string[])]);
}

function validateCapture(value: unknown, label: string): EvidenceCapture {
  const str = validateNonEmptyString(value, label);
  if (str !== 'always' && str !== 'onFailure') {
    throw new Error(`${label} must be 'always' or 'onFailure'`);
  }
  return str;
}

function validateBoundedTimeout(value: unknown, label: string, fallback: number): number;
function validateBoundedTimeout(value: unknown, label: string, fallback: undefined): number | undefined;
function validateBoundedTimeout(value: unknown, label: string, fallback: number | undefined): number | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  if (value > MAX_TIMEOUT_MS) {
    throw new Error(`${label} must be <= ${MAX_TIMEOUT_MS}`);
  }
  return value;
}

function validateBoundedInterval(value: unknown, label: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  if (value > MAX_INTERVAL_MS) {
    throw new Error(`${label} must be <= ${MAX_INTERVAL_MS}`);
  }
  return value;
}

function validateBoundedLogBytes(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  if (value > MAX_LOG_BYTES) {
    throw new Error(`${label} must be <= ${MAX_LOG_BYTES}`);
  }
  return value;
}

function normalizeRelativePath(value: unknown, label: string): string {
  const input = validateNonEmptyString(value, label);
  if (input.includes('\0')) {
    throw new Error(`${label} must not contain NUL bytes`);
  }
  const slashPath = input.replace(/\\/gu, '/');
  if (isAbsolute(input) || slashPath.startsWith('/') || /^[A-Za-z]:\//u.test(slashPath)) {
    throw new Error(`${label} must be relative: ${input}`);
  }
  const parts = slashPath.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.length === 0) {
    throw new Error(`${label} must not be empty or '.'`);
  }
  if (parts.includes('..')) {
    throw new Error(`${label} must not contain parent-directory segments: ${input}`);
  }
  for (const part of parts) {
    if (part.includes('\0')) {
      throw new Error(`${label} must not contain NUL bytes`);
    }
  }
  return parts.join('/');
}

function ensureContainedPath(root: string, target: string, label: string): void {
  const rel = relative(root, target);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return;
  }
  throw new Error(`${label} escapes the project root: ${target}`);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(value: Record<string, unknown>, keys: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) {
      throw new Error(`Unknown ${label}: ${key}`);
    }
  }
}

function validateNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (value.includes('\0')) {
    throw new Error(`${label} must not contain NUL bytes`);
  }
  return value;
}

function validateOptionalStringArray(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || (entry as string).length === 0)) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
  for (const entry of value as string[]) {
    if (entry.includes('\0')) {
      throw new Error(`${label} entries must not contain NUL bytes`);
    }
  }
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const val = record[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}
