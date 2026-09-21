import type { ParseFlagsResult } from '@repo-toolkit/publish-package';

import { createConnectStore, type FetchLike } from './connect';
import { createSdkStore, type SdkClientFactory } from './sdk';
import { remoteIdentityFromConfig, type RemoteIdentity } from './state';
import type { SecretSyncPlan } from './types';
import type { SecretStore } from './store';

export const GLOBAL_FLAGS = new Set(['config', 'cwd', 'json']);

const COMMAND_FLAGS: Record<string, ReadonlyArray<string>> = {
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
  show: ['config', 'cwd', 'branch', 'file', 'revision', 'interactive', 'copy', 'dry-run', 'json'],
  switch: ['config', 'cwd', 'branch', 'dry-run', 'json'],
  resolve: ['config', 'cwd', 'branch', 'head', 'take', 'dry-run', 'json'],
};

function commandKey(
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
  const allowed = COMMAND_FLAGS[key];
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
