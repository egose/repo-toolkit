import { SecretSyncError } from '../src/errors';
import type {
  ConnectItemDetail,
  ConnectItemSummary,
  CreateConnectItemInput,
  CreateItemResult,
  SecretStore,
  VaultSummary,
} from '../src/store';

export class MemoryFakeStore implements SecretStore {
  private counter = 0;
  private readonly items = new Map<string, ConnectItemDetail>();
  private readonly vaults: VaultSummary[];
  readonly counts = { lists: 0, gets: 0, creates: 0, vaultLists: 0 };

  constructor(vaults: VaultSummary[] = [{ id: 'vault-1', title: 'Example' }]) {
    this.vaults = vaults.map((entry) => ({ ...entry }));
  }

  async listItems(): Promise<ConnectItemSummary[]> {
    this.counts.lists += 1;
    return [...this.items.values()].map((detail) => ({
      id: detail.id,
      title: detail.title,
      tags: [...detail.tags],
      category: detail.category,
    }));
  }

  async getItem(id: string): Promise<ConnectItemDetail> {
    this.counts.gets += 1;
    const hit = this.items.get(id);
    if (hit === undefined) {
      throw new SecretSyncError('not-found', 'Fake item is not visible.');
    }
    return JSON.parse(JSON.stringify(hit)) as ConnectItemDetail;
  }

  async listVaults(): Promise<VaultSummary[]> {
    this.counts.vaultLists += 1;
    return this.vaults.map((entry) => ({ ...entry }));
  }

  async createItem(input: CreateConnectItemInput): Promise<CreateItemResult> {
    this.counts.creates += 1;
    this.counter += 1;
    const id = `provider-${this.counter}`;
    const detail: ConnectItemDetail = {
      id,
      title: input.title,
      tags: [...input.tags],
      category: input.category,
      fields: input.fields.map((field) => ({ ...field })),
    };
    this.items.set(id, detail);
    return { status: 'created', item: JSON.parse(JSON.stringify(detail)) as ConnectItemDetail };
  }
}
