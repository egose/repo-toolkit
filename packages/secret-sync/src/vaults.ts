import { SecretSyncError } from './errors';
import type { SecretStore, VaultSummary } from './store';

export interface VaultListOptions {
  store: SecretStore;
  dryRun?: boolean;
}

export interface VaultListResult {
  vaults: VaultSummary[];
  count: number;
  dryRun: boolean;
}

export async function listVaults(options: VaultListOptions): Promise<VaultListResult> {
  const dryRun = options.dryRun === true;
  if (options.store.listVaults === undefined) {
    throw new SecretSyncError('validation', 'The configured backend does not support vault listing.');
  }
  const vaults = await options.store.listVaults();
  const sorted = [...vaults].sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  return { vaults: sorted, count: sorted.length, dryRun };
}
