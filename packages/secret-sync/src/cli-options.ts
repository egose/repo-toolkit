import type { FlagSpec, ParseFlagsResult } from '@repo-toolkit/publish-package';

import { createConnectStore, type FetchLike } from './connect';
import { createSdkStore, type SdkClientFactory } from './sdk';
import { remoteIdentityFromConfig, type RemoteIdentity } from './state';
import type { SecretSyncPlan } from './types';
import type { SecretStore } from './store';

export const GLOBAL_FLAGS = new Set(['config', 'cwd', 'json']);

export const COMMAND_FLAGS = {
  init: ['config', 'cwd', 'vault', 'provider', 'auth', 'account', 'token-env', 'json'],
  doctor: ['config', 'cwd', 'branch', 'json'],
  status: ['config', 'cwd', 'branch', 'file', 'check', 'dry-run', 'json'],
  push: ['config', 'cwd', 'file', 'message', 'delete', 'dry-run', 'json'],
  pull: ['config', 'cwd', 'file', 'delete', 'dry-run', 'json'],
  diff: ['config', 'cwd', 'branch', 'file', 'dry-run', 'json'],
  log: ['config', 'cwd', 'branch', 'file', 'limit', 'dry-run', 'json'],
  restore: ['config', 'cwd', 'file', 'revision', 'from-branch', 'overwrite', 'acknowledge-remote', 'dry-run', 'json'],
  rollback: ['config', 'cwd', 'file', 'revision', 'message', 'dry-run', 'json'],
  'branch list': ['config', 'cwd', 'dry-run', 'json'],
  'branch create': ['config', 'cwd', 'name', 'from', 'dry-run', 'json'],
  'vault list': ['config', 'cwd', 'provider', 'auth', 'account', 'token-env', 'dry-run', 'json'],
  show: ['config', 'cwd', 'branch', 'file', 'revision', 'interactive', 'copy', 'export', 'dry-run', 'json'],
  switch: ['config', 'cwd', 'branch', 'dry-run', 'json'],
  resolve: ['config', 'cwd', 'branch', 'head', 'take', 'dry-run', 'json'],
} as const satisfies Record<string, ReadonlyArray<string>>;

export type CommandKey = keyof typeof COMMAND_FLAGS;

export interface CliFlagSpec extends FlagSpec {
  argument?: string;
  description: string;
}

export const SPECS: CliFlagSpec[] = [
  {
    name: 'config',
    argument: '<path>',
    description:
      'Config file (JSON, .mjs, or .cjs default export; default: ./secret-sync.config.json in the working directory).',
  },
  { name: 'cwd', argument: '<path>', description: 'Working directory (default: process.cwd()).' },
  {
    name: 'branch',
    argument: '<name>',
    description: 'Target branch (default: configured branch, main when omitted in config).',
  },
  {
    name: 'file',
    argument: '<path>',
    repeatable: true,
    description:
      'Exact project-relative path; never overrides excludes. No comma splitting; use --file=<name> for dash-leading names.',
  },
  {
    name: 'message',
    argument: '<text>',
    description: 'Optional commit message (default: absent); visible in history and output, so use non-secret text.',
  },
  {
    name: 'revision',
    argument: '<blob-id>',
    description: 'Historical blob UUID associated with the selected path; obtain it from log.',
  },
  { name: 'limit', argument: '<count>', description: 'Maximum history entries (default: 20; range: 1–1000).' },
  {
    name: 'head',
    argument: '<commit-id>',
    repeatable: true,
    description: 'Observed head commit UUID; repeat for every divergent head (at least two distinct IDs).',
  },
  {
    name: 'take',
    argument: '<commit-id>',
    description: 'Required: one of the supplied head IDs; choose its entire snapshot.',
  },
  { name: 'name', argument: '<branch>', description: 'Required: new branch name.' },
  {
    name: 'from',
    argument: '<branch>',
    description: 'Source branch to copy (default: main); an empty source produces an empty branch.',
  },
  {
    name: 'from-branch',
    argument: '<name>',
    description: 'Restore from this branch head instead of a revision; absence there requests local removal.',
  },
  {
    name: 'vault',
    argument: '<vault-id>',
    description: 'Required when creating a config; exact vault ID, discoverable with vault list.',
  },
  {
    name: 'provider',
    argument: 'onepassword-connect | onepassword-sdk',
    description: 'Explicit backend selection; credentials never select the backend implicitly.',
  },
  {
    name: 'auth',
    argument: 'service-account | desktop',
    description: 'Required for a new SDK configuration; only supported by onepassword-sdk.',
  },
  {
    name: 'account',
    argument: '<selector>',
    description: 'Required with desktop auth: 1Password account ID or name; prefer a stable ID.',
  },
  {
    name: 'token-env',
    argument: '<name>',
    description:
      'Environment variable name, never a token value (default: OP_SERVICE_ACCOUNT_TOKEN); requires explicit service-account auth.',
  },
  {
    name: 'interactive',
    boolean: true,
    description:
      'Pick file, revision, and branch interactively; supplied flags pre-answer their steps. Cancellation exits nonzero.',
  },
  {
    name: 'copy',
    boolean: true,
    description: 'Copy verified bytes to the system clipboard; stdout receives metadata only on a non-dry run.',
  },
  {
    name: 'export',
    argument: '<path>',
    description:
      'Atomically write verified bytes with mode 0600; overwrites regular files, refuses symlinks/special files. Relative to the working directory.',
  },
  {
    name: 'json',
    boolean: true,
    description:
      'Emit schema-versioned metadata-only JSON (default: text); never includes secret bytes or fingerprints.',
  },
  {
    name: 'dry-run',
    boolean: true,
    description:
      'Read/plan only (default: false); no remote/local writes, locks, state, or temp files. Credentials are still needed for remote reads.',
  },
  { name: 'check', boolean: true, description: 'Exit 1 on drift/conflicts/errors (default: false); useful in CI.' },
  { name: 'delete', boolean: true, description: 'Opt into deletions (default: false); other conflicts still refuse.' },
  {
    name: 'overwrite',
    boolean: true,
    description:
      'Allow replacing/removing differing preflight local bytes (default: false); later edits still refuse replacement.',
  },
  {
    name: 'acknowledge-remote',
    boolean: true,
    description:
      'Update baseline only when the restored target equals the active branch current remote revision (default: false).',
  },
];

export function commandKey(
  command: string | undefined,
  branchSubcommand: string | undefined,
  vaultSubcommand?: string,
): string {
  if (command === undefined) {
    return 'status';
  }
  if (command === 'branch') {
    return `branch ${branchSubcommand ?? 'list'}`;
  }
  if (command === 'vault') {
    return `vault ${vaultSubcommand ?? 'list'}`;
  }
  return command;
}

function presentFlags(result: ParseFlagsResult): string[] {
  const names = new Set<string>([...Object.keys(result.values), ...Object.keys(result.repeat)]);
  return [...names].sort();
}

export function assertCommandFlags(
  result: ParseFlagsResult,
  command: string | undefined,
  branchSubcommand: string | undefined,
  vaultSubcommand?: string,
): void {
  const key = commandKey(command, branchSubcommand, vaultSubcommand);
  const allowed = (COMMAND_FLAGS as Record<string, ReadonlyArray<string>>)[key];
  if (allowed === undefined) {
    return;
  }
  const allowedSet = new Set(allowed);
  for (const flag of presentFlags(result)) {
    if (flag === 'help') {
      continue;
    }
    if (!allowedSet.has(flag)) {
      throw new Error(`Flag --${flag} is not supported by the ${key} command.`);
    }
  }
}

export interface StoreOverrides {
  store?: SecretStore;
  fetchImpl?: FetchLike;
  sdkClientFactory?: SdkClientFactory;
  env?: Record<string, string | undefined>;
}

export function resolveStoreEnv(overrides: StoreOverrides = {}): Record<string, string | undefined> {
  return overrides.env ?? (process.env as Record<string, string | undefined>);
}

export function resolveEndpointForPlan(plan: SecretSyncPlan, env: Record<string, string | undefined>): string {
  if (plan.remote.type !== 'onepassword-connect') {
    throw new Error('Direct SDK backend does not use a Connect endpoint.');
  }
  const raw = env[plan.remote.hostEnv];
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(`Connect host is not configured (env ${plan.remote.hostEnv}).`);
  }
  return raw.trim();
}

export function resolveIdentityForPlan(plan: SecretSyncPlan, env: Record<string, string | undefined>): RemoteIdentity {
  if (plan.remote.type === 'onepassword-sdk') {
    return remoteIdentityFromConfig(plan.remote, plan.projectId);
  }
  return remoteIdentityFromConfig(plan.remote, plan.projectId, resolveEndpointForPlan(plan, env));
}

export function collectCliSecrets(plan: SecretSyncPlan, env: Record<string, string | undefined>): string[] {
  if (plan.remote.type === 'onepassword-sdk') {
    if (plan.remote.auth.type !== 'service-account') {
      return [];
    }
    const token = env[plan.remote.auth.tokenEnv];
    if (typeof token === 'string' && token.length > 0) {
      return [token];
    }
    return [];
  }
  const secrets: string[] = [];
  const token = env[plan.remote.tokenEnv];
  if (typeof token === 'string' && token.length > 0 && secrets.indexOf(token) < 0) {
    secrets.push(token);
  }
  const host = env[plan.remote.hostEnv];
  if (typeof host === 'string' && host.length > 0 && host.indexOf('token') >= 0 && secrets.indexOf(host) < 0) {
    secrets.push(host);
  }
  return secrets;
}

export function createSecretStoreForPlan(plan: SecretSyncPlan, overrides: StoreOverrides = {}): SecretStore {
  if (overrides.store !== undefined) {
    return overrides.store;
  }
  if (plan.remote.type === 'onepassword-sdk') {
    return createSdkStore({
      vaultId: plan.remote.vaultId,
      auth: plan.remote.auth,
      env: resolveStoreEnv(overrides),
      ...(overrides.sdkClientFactory === undefined ? {} : { clientFactory: overrides.sdkClientFactory }),
    });
  }
  const fetchImpl = overrides.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required to contact 1Password Connect.');
  }
  return createConnectStore({
    vaultId: plan.remote.vaultId,
    hostEnv: plan.remote.hostEnv,
    tokenEnv: plan.remote.tokenEnv,
    env: resolveStoreEnv(overrides),
    fetchImpl,
    concurrency: plan.limits.concurrency,
  });
}
