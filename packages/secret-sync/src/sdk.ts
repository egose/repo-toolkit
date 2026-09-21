import { randomUUID } from 'node:crypto';

import { isPlainObject } from '@repo-toolkit/publish-package';

import { MAX_RECORD_BYTES } from './records';
import { SecretSyncError } from './errors';
import type { SecretSyncSdkAuthConfig } from './types';
import {
  validateCreateSecretItemInput,
  validateItemId,
  validateSecretItemDetail,
  validateSecretItemSummary,
  validateVaultListResponse,
  type CreateItemResult,
  type CreateSecretItemInput,
  type ListItemsOptions,
  type SecretItemDetail,
  type SecretItemSummary,
  type SecretStore,
  type VaultSummary,
} from './store';

export const SDK_INTEGRATION_NAME = 'repo-toolkit-secret-sync';
export const SDK_INTEGRATION_VERSION = '0.0.0';
export const SDK_TIMEOUT_MS = 30000;
export const SDK_MAX_GET_RETRIES = 3;
export const SDK_MAX_RECORDS = 10000;
export const SDK_MAX_DETAIL_BYTES = 256 * 1024;
export const SDK_RETRY_BASE_MS = 100;
export const SDK_RETRY_CAP_MS = 2000;

export interface SdkListFilter {
  type: 'ByState';
  content: { active: boolean; archived: boolean };
}

export interface SdkOverviewLike {
  id: unknown;
  title: unknown;
  category: unknown;
  vaultId: unknown;
  tags: unknown;
  state: unknown;
}

export interface SdkFieldLike {
  id: unknown;
  title: unknown;
  sectionId: unknown;
  fieldType: unknown;
  value: unknown;
}

export interface SdkItemLike {
  id: unknown;
  title: unknown;
  category: unknown;
  vaultId: unknown;
  tags: unknown;
  fields: unknown;
}

export interface SdkCreateField {
  id: string;
  title: string;
  sectionId?: string;
  fieldType: string;
  value: string;
}

export interface SdkCreateParams {
  category: string;
  vaultId: string;
  title: string;
  tags: string[];
  fields: SdkCreateField[];
}

export interface SdkItemsApiLike {
  list(vaultId: string, ...filters: SdkListFilter[]): Promise<SdkOverviewLike[]>;
  get(vaultId: string, itemId: string): Promise<SdkItemLike>;
  create(params: SdkCreateParams): Promise<SdkItemLike>;
}

export interface SdkVaultLike {
  id: unknown;
  title: unknown;
  description?: unknown;
  vaultType?: unknown;
  activeItemCount?: unknown;
}

export interface SdkVaultsApiLike {
  list(): Promise<SdkVaultLike[]>;
}

export interface SdkClientLike {
  items: SdkItemsApiLike;
  vaults?: SdkVaultsApiLike;
}

export type SdkFactoryAuth = { kind: 'service-account'; token: string } | { kind: 'desktop'; account: string };

export interface SdkFactoryConfig {
  auth: SdkFactoryAuth;
  integrationName: string;
  integrationVersion: string;
}

export type SdkClientFactory = (config: SdkFactoryConfig) => Promise<SdkClientLike>;

export interface SdkStoreOptions {
  vaultId: string;
  auth: SecretSyncSdkAuthConfig;
  env?: Record<string, string | undefined>;
  clientFactory?: SdkClientFactory;
  integrationName?: string;
  integrationVersion?: string;
  timeoutMs?: number;
  maxRecords?: number;
  maxDetailBytes?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function delayForSdkAttempt(attempt: number): number {
  const grown = SDK_RETRY_BASE_MS * Math.pow(2, attempt);
  return Math.min(grown, SDK_RETRY_CAP_MS);
}

function byteLengthUtf8(text: string): number {
  return new TextEncoder().encode(text).length;
}

function sdkItemPath(vaultId: string): string {
  return `sdk/vaults/${vaultId}/items`;
}

function safeName(error: unknown): string {
  if (error instanceof Error && typeof error.name === 'string' && error.name.length > 0) {
    return error.name;
  }
  return 'Error';
}

function safeMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message;
  }
  try {
    return String(error);
  } catch {
    return 'unknown failure';
  }
}

function mapSdkError(error: unknown, op: string, path: string): SecretSyncError {
  if (error instanceof SecretSyncError) {
    return error;
  }
  const name = safeName(error);
  if (name === 'DesktopSessionExpiredError') {
    return new SecretSyncError('auth', '1Password desktop session expired; approve access again.', {
      method: op,
      path,
      cause: { name },
    });
  }
  if (name === 'RateLimitExceededError') {
    return new SecretSyncError('rate-limited', '1Password SDK request was rate limited.', {
      retryable: true,
      method: op,
      path,
      cause: { name },
    });
  }
  if (name === 'AuthExpiredError') {
    return new SecretSyncError('auth', '1Password authentication expired; refresh the credential.', {
      method: op,
      path,
      cause: { name },
    });
  }
  const text = safeMessage(error).toLowerCase();
  if (text.includes('incomplete') || text.includes('truncat')) {
    return new SecretSyncError(
      'remote-incomplete',
      '1Password SDK listing was incomplete; nothing was treated as deleted.',
      {
        retryable: true,
        method: op,
        path,
        cause: { name },
      },
    );
  }
  if (
    text.includes('rate limit') ||
    text.includes('ratelimit') ||
    text.includes('quota') ||
    text.includes('too many requests') ||
    text.includes('429')
  ) {
    return new SecretSyncError('rate-limited', '1Password SDK request was rate limited.', {
      retryable: true,
      method: op,
      path,
      cause: { name },
    });
  }
  if (
    text.includes('vault') &&
    (text.includes('not found') ||
      text.includes('notfound') ||
      text.includes('unknown') ||
      text.includes('missing') ||
      text.includes('no access') ||
      text.includes('access denied') ||
      text.includes('forbidden') ||
      text.includes('permission'))
  ) {
    return new SecretSyncError('not-found', '1Password vault was not found or is not visible to this identity.', {
      method: op,
      path,
      cause: { name },
    });
  }
  if (text.includes('itemnotfound') || text.includes('item not found') || text.includes('item_not_found')) {
    return new SecretSyncError('not-found', '1Password item was not found in the configured vault.', {
      method: op,
      path,
      cause: { name },
    });
  }
  if (
    text.includes('unauthorized') ||
    text.includes('unauthenticated') ||
    text.includes('invalid token') ||
    (text.includes('invalid') && text.includes('token')) ||
    text.includes('expired token') ||
    (text.includes('expired') && text.includes('token')) ||
    text.includes('auth expired') ||
    text.includes('authentication') ||
    text.includes('permission') ||
    text.includes('forbidden') ||
    text.includes('access denied') ||
    text.includes('denied') ||
    text.includes('cancel') ||
    text.includes('abort') ||
    text.includes('reject') ||
    text.includes('locked') ||
    text.includes('approval') ||
    text.includes('no session') ||
    text.includes('session expired')
  ) {
    return new SecretSyncError('auth', '1Password authentication failed; check the credential or desktop approval.', {
      method: op,
      path,
      cause: { name },
    });
  }
  if (
    text.includes('message size exceeds') ||
    text.includes('too big') ||
    text.includes('too large') ||
    text.includes('exceeds the limit')
  ) {
    return new SecretSyncError('too-large', '1Password SDK payload exceeds the size bound.', {
      method: op,
      path,
      cause: { name },
    });
  }
  if (text.includes('timeout') || text.includes('timed out') || text.includes('deadline')) {
    return new SecretSyncError('timeout', '1Password SDK request timed out.', {
      retryable: true,
      method: op,
      path,
      cause: { name },
    });
  }
  if (
    text.includes('network') ||
    text.includes('econn') ||
    text.includes('socket') ||
    text.includes('connection') ||
    text.includes('fetch failed') ||
    text.includes('enotfound') ||
    text.includes('eai_again')
  ) {
    return new SecretSyncError('network', '1Password SDK request failed before a response was received.', {
      retryable: true,
      method: op,
      path,
      cause: { name },
    });
  }
  return new SecretSyncError('server', '1Password SDK request failed.', {
    retryable: true,
    method: op,
    path,
    cause: { name },
  });
}

function resolveVaultId(vaultId: string): string {
  if (typeof vaultId !== 'string' || vaultId.length === 0 || vaultId.length > 256) {
    throw new SecretSyncError('validation', 'Vault id must be a non-empty string of at most 256 characters.');
  }
  if (vaultId.includes('\0') || vaultId.includes('/') || vaultId.includes('\n') || vaultId.includes('\r')) {
    throw new SecretSyncError('validation', 'Vault id contains characters that are never valid.');
  }
  return vaultId;
}

function toSdkCategory(category: string): string {
  const normalized = category.split('_').join('').toLowerCase();
  if (normalized === 'securenote') {
    return 'SecureNote';
  }
  throw new SecretSyncError('validation', 'Direct SDK backend only stores SECURE_NOTE records.');
}

function toSdkFieldType(type: string): string {
  return type === 'CONCEALED' ? 'Concealed' : 'Text';
}

function toNeutralFieldType(fieldType: unknown): string {
  return String(fieldType) === 'Concealed' ? 'CONCEALED' : 'STRING';
}

function mapOverview(value: SdkOverviewLike, vaultId: string): SecretItemSummary | undefined {
  if (!isPlainObject(value)) {
    throw new SecretSyncError('schema', 'Direct SDK list entry is not an object.');
  }
  const record = value as Record<string, unknown>;
  if (record.vaultId !== vaultId) {
    return undefined;
  }
  if (String(record.category) !== 'SecureNote') {
    return undefined;
  }
  return validateSecretItemSummary({
    id: record.id,
    title: record.title,
    tags: record.tags,
    category: 'SECURE_NOTE',
  });
}

function mapItemFields(
  rawFields: unknown,
): Array<{ type: string; value: string; id?: string; label?: string; purpose?: string }> {
  if (!Array.isArray(rawFields)) {
    throw new SecretSyncError('schema', 'Direct SDK item has invalid fields.');
  }
  const fields: Array<{ type: string; value: string; id?: string; label?: string; purpose?: string }> = [];
  for (const entry of rawFields) {
    if (!isPlainObject(entry)) {
      throw new SecretSyncError('schema', 'Direct SDK item has invalid fields.');
    }
    const field = entry as Record<string, unknown>;
    if (typeof field.value !== 'string') {
      throw new SecretSyncError('schema', 'Direct SDK item has invalid fields.');
    }
    const mapped: { type: string; value: string; id?: string; label?: string; purpose?: string } = {
      type: toNeutralFieldType(field.fieldType),
      value: field.value,
    };
    if (typeof field.id === 'string' && field.id.length > 0) {
      mapped.id = field.id;
    }
    if (typeof field.title === 'string' && field.title.length > 0) {
      mapped.label = field.title;
    }
    if (typeof field.sectionId === 'string' && field.sectionId.length > 0) {
      mapped.purpose = field.sectionId;
    }
    fields.push(mapped);
  }
  return fields;
}

function isDeterministicCreateError(error: SecretSyncError): boolean {
  return (
    error.code === 'auth' ||
    error.code === 'not-found' ||
    error.code === 'validation' ||
    error.code === 'too-large' ||
    error.code === 'schema'
  );
}

export async function defaultSdkClientFactory(config: SdkFactoryConfig): Promise<SdkClientLike> {
  if (!isPlainObject(config)) {
    throw new SecretSyncError('validation', 'Direct SDK client configuration must be an object.');
  }
  if (config.auth.kind !== 'service-account' && config.auth.kind !== 'desktop') {
    throw new SecretSyncError('validation', 'Direct SDK client needs a service-account token or desktop account.');
  }
  if (config.auth.kind === 'service-account' && config.auth.token.length === 0) {
    throw new SecretSyncError('auth', '1Password service-account token is not configured.');
  }
  if (config.auth.kind === 'desktop' && config.auth.account.length === 0) {
    throw new SecretSyncError('auth', '1Password desktop account selector is not configured.');
  }
  if (config.integrationName.length === 0 || config.integrationVersion.length === 0) {
    throw new SecretSyncError('validation', 'Direct SDK client needs an integration name and version.');
  }
  let loaded: unknown;
  try {
    loaded = await import('@1password/sdk');
  } catch (error) {
    throw new SecretSyncError(
      'server',
      '1Password SDK runtime failed to load; verify @1password/sdk and @1password/sdk-core assets are installed.',
      { method: 'auth', path: 'sdk/client', cause: { name: safeName(error) } },
    );
  }
  const module = loaded as { createClient?: unknown; DesktopAuth?: unknown };
  if (typeof module.createClient !== 'function' || typeof module.DesktopAuth !== 'function') {
    throw new SecretSyncError(
      'server',
      '1Password SDK runtime failed to load; verify @1password/sdk and @1password/sdk-core assets are installed.',
      { method: 'auth', path: 'sdk/client', cause: { name: 'Error' } },
    );
  }
  const createClient = module.createClient as (clientConfig: unknown) => Promise<unknown>;
  const DesktopAuth = module.DesktopAuth as new (accountName: string) => unknown;
  const authValue = config.auth.kind === 'desktop' ? new DesktopAuth(config.auth.account) : config.auth.token;
  try {
    const client = await createClient({
      auth: authValue,
      integrationName: config.integrationName,
      integrationVersion: config.integrationVersion,
    });
    if (!isPlainObject(client)) {
      throw new SecretSyncError('server', '1Password SDK client initialization failed.', {
        method: 'auth',
        path: 'sdk/client',
        cause: { name: 'Error' },
      });
    }
    const typed = client as { items?: unknown };
    if (!isPlainObject(typed.items)) {
      throw new SecretSyncError('server', '1Password SDK client initialization failed.', {
        method: 'auth',
        path: 'sdk/client',
        cause: { name: 'Error' },
      });
    }
    return client as unknown as SdkClientLike;
  } catch (error) {
    throw mapSdkError(error, 'auth', 'sdk/client');
  }
}

export class SdkSecretStore implements SecretStore {
  private readonly vaultId: string;
  private readonly auth: SecretSyncSdkAuthConfig;
  private readonly env: Record<string, string | undefined> | undefined;
  private readonly factory: SdkClientFactory;
  private readonly integrationName: string;
  private readonly integrationVersion: string;
  private readonly timeoutMs: number;
  private readonly maxRecords: number;
  private readonly maxDetailBytes: number;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private client: SdkClientLike | undefined;
  private pending: Promise<SdkClientLike> | undefined;

  constructor(options: SdkStoreOptions) {
    if (!isPlainObject(options)) {
      throw new SecretSyncError('validation', 'Direct SDK store options must be an object.');
    }
    const candidate = options as SdkStoreOptions;
    this.vaultId = resolveVaultId(candidate.vaultId);
    const auth = candidate.auth;
    if (!isPlainObject(auth)) {
      throw new SecretSyncError('validation', 'Direct SDK store needs an explicit auth configuration.');
    }
    if (auth.type !== 'service-account' && auth.type !== 'desktop') {
      throw new SecretSyncError('validation', 'Direct SDK store needs a service-account or desktop auth type.');
    }
    if (auth.type === 'service-account') {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(auth.tokenEnv)) {
        throw new SecretSyncError('validation', 'Direct SDK token env name is invalid.');
      }
      this.auth = { type: 'service-account', tokenEnv: auth.tokenEnv };
    } else {
      if (typeof auth.account !== 'string' || auth.account.length === 0 || auth.account.length > 256) {
        throw new SecretSyncError('validation', 'Direct SDK desktop account selector is invalid.');
      }
      this.auth = { type: 'desktop', account: auth.account };
    }
    if (candidate.env !== undefined && !isPlainObject(candidate.env)) {
      throw new SecretSyncError('validation', 'Direct SDK store env must be an object.');
    }
    this.env = candidate.env;
    if (candidate.clientFactory !== undefined && typeof candidate.clientFactory !== 'function') {
      throw new SecretSyncError('validation', 'Direct SDK client factory must be a function.');
    }
    this.factory = candidate.clientFactory ?? defaultSdkClientFactory;
    const integrationName = candidate.integrationName ?? SDK_INTEGRATION_NAME;
    if (typeof integrationName !== 'string' || integrationName.length === 0 || integrationName.length > 128) {
      throw new SecretSyncError('validation', 'Direct SDK integration name is invalid.');
    }
    this.integrationName = integrationName;
    const integrationVersion = candidate.integrationVersion ?? SDK_INTEGRATION_VERSION;
    if (typeof integrationVersion !== 'string' || integrationVersion.length === 0 || integrationVersion.length > 64) {
      throw new SecretSyncError('validation', 'Direct SDK integration version is invalid.');
    }
    this.integrationVersion = integrationVersion;
    const timeoutMs = candidate.timeoutMs ?? SDK_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
      throw new SecretSyncError('validation', 'Direct SDK timeout must be between 1 and 120000 ms.');
    }
    this.timeoutMs = timeoutMs;
    const maxRecords = candidate.maxRecords ?? SDK_MAX_RECORDS;
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > SDK_MAX_RECORDS) {
      throw new SecretSyncError('validation', 'Direct SDK record bound is out of range.');
    }
    this.maxRecords = maxRecords;
    const maxDetailBytes = candidate.maxDetailBytes ?? SDK_MAX_DETAIL_BYTES;
    if (!Number.isSafeInteger(maxDetailBytes) || maxDetailBytes < 1 || maxDetailBytes > SDK_MAX_DETAIL_BYTES) {
      throw new SecretSyncError('validation', 'Direct SDK detail byte bound is out of range.');
    }
    this.maxDetailBytes = maxDetailBytes;
    const maxRetries = candidate.maxRetries ?? SDK_MAX_GET_RETRIES;
    if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > SDK_MAX_GET_RETRIES) {
      throw new SecretSyncError('validation', 'Direct SDK retry count is out of range.');
    }
    this.maxRetries = maxRetries;
    if (candidate.sleep !== undefined && typeof candidate.sleep !== 'function') {
      throw new SecretSyncError('validation', 'Direct SDK sleep hook must be a function.');
    }
    this.sleep = candidate.sleep ?? defaultSleep;
  }

  getVaultId(): string {
    return this.vaultId;
  }

  getAuthType(): string {
    return this.auth.type;
  }

  async close(): Promise<void> {
    const active = this.client;
    this.client = undefined;
    this.pending = undefined;
    if (active === undefined) {
      return;
    }
    const record = active as unknown as Record<string, unknown>;
    const names = ['close', 'dispose', 'release', 'destroy'];
    for (const name of names) {
      const candidate = record[name];
      if (typeof candidate === 'function') {
        try {
          await (candidate as () => unknown).call(active);
        } catch {
          return;
        }
        return;
      }
    }
  }

  private resolveAuth(): SdkFactoryAuth {
    const source: Record<string, string | undefined> = this.env ?? (process.env as Record<string, string | undefined>);
    if (this.auth.type === 'desktop') {
      return { kind: 'desktop', account: this.auth.account };
    }
    const token = source[this.auth.tokenEnv];
    if (typeof token !== 'string' || token.length === 0) {
      throw new SecretSyncError(
        'auth',
        `1Password service-account token is not configured (env ${this.auth.tokenEnv}).`,
        { method: 'auth', path: sdkItemPath(this.vaultId) },
      );
    }
    return { kind: 'service-account', token };
  }

  private ensureClient(): Promise<SdkClientLike> {
    if (this.client !== undefined) {
      return Promise.resolve(this.client);
    }
    if (this.pending !== undefined) {
      return this.pending;
    }
    const task = (async (): Promise<SdkClientLike> => {
      const resolved = this.resolveAuth();
      const client = await this.factory({
        auth: resolved,
        integrationName: this.integrationName,
        integrationVersion: this.integrationVersion,
      });
      if (!isPlainObject(client) || !isPlainObject((client as { items?: unknown }).items)) {
        throw new SecretSyncError('server', '1Password SDK client initialization failed.', {
          method: 'auth',
          path: sdkItemPath(this.vaultId),
          cause: { name: 'Error' },
        });
      }
      this.client = client;
      this.pending = undefined;
      return client;
    })();
    this.pending = task;
    task.then(undefined, () => {
      if (this.pending === task) {
        this.pending = undefined;
      }
    });
    return task;
  }

  private withDeadline<T>(task: Promise<T>, op: string): Promise<T> {
    const path = sdkItemPath(this.vaultId);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new SecretSyncError('timeout', `1Password SDK ${op} timed out.`, { retryable: true, method: op, path }));
      }, this.timeoutMs);
      task.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private async readWithRetries<T>(op: string, fn: (client: SdkClientLike) => Promise<T>): Promise<T> {
    const path = sdkItemPath(this.vaultId);
    let attempt = 0;
    for (;;) {
      try {
        const client = await this.ensureClient();
        return await this.withDeadline(fn(client), op);
      } catch (error) {
        const mapped = error instanceof SecretSyncError ? error : mapSdkError(error, op, path);
        if (!mapped.retryable || attempt >= this.maxRetries) {
          throw mapped;
        }
        await this.sleep(delayForSdkAttempt(attempt));
        attempt += 1;
      }
    }
  }

  private decodeItem(raw: SdkItemLike): SecretItemDetail {
    if (!isPlainObject(raw)) {
      throw new SecretSyncError('schema', 'Direct SDK item is not an object.');
    }
    const record = raw as Record<string, unknown>;
    if (record.vaultId !== this.vaultId) {
      throw new SecretSyncError('remote-corrupt', 'Direct SDK item belongs to a different vault.');
    }
    if (String(record.category) !== 'SecureNote') {
      throw new SecretSyncError('schema', 'Direct SDK item category is not supported.');
    }
    const detail = validateSecretItemDetail({
      id: record.id,
      title: record.title,
      ...(record.tags === undefined ? {} : { tags: record.tags }),
      category: 'SECURE_NOTE',
      fields: mapItemFields(record.fields),
    });
    if (byteLengthUtf8(JSON.stringify(detail)) > this.maxDetailBytes) {
      throw new SecretSyncError('too-large', 'Direct SDK item exceeds the detail byte bound without truncation.');
    }
    return detail;
  }

  async listItems(options: ListItemsOptions = {}): Promise<SecretItemSummary[]> {
    let titleFilter: string | undefined;
    if (options.titleFilter !== undefined) {
      if (typeof options.titleFilter !== 'string' || options.titleFilter.length === 0) {
        throw new SecretSyncError('validation', 'Title filter must be a non-empty string.');
      }
      titleFilter = options.titleFilter;
    }
    const path = sdkItemPath(this.vaultId);
    let overviews: SdkOverviewLike[];
    try {
      overviews = await this.readWithRetries('list', (client) =>
        client.items.list(this.vaultId, { type: 'ByState', content: { active: true, archived: true } }),
      );
    } catch (error) {
      throw error instanceof SecretSyncError ? error : mapSdkError(error, 'list', path);
    }
    if (!Array.isArray(overviews)) {
      throw new SecretSyncError('schema', 'Direct SDK list response is not an array.');
    }
    if (overviews.length > this.maxRecords) {
      throw new SecretSyncError('too-large', 'Direct SDK record scan exceeds the record bound without truncation.');
    }
    const result: SecretItemSummary[] = [];
    for (const overview of overviews) {
      const mapped = mapOverview(overview, this.vaultId);
      if (mapped === undefined) {
        continue;
      }
      if (titleFilter !== undefined && mapped.title !== titleFilter) {
        continue;
      }
      result.push(mapped);
    }
    return result;
  }

  async listVaults(): Promise<VaultSummary[]> {
    const path = 'sdk/vaults';
    let raw: SdkVaultLike[];
    try {
      raw = await this.readWithRetries('list-vaults', (client) => {
        if (client.vaults === undefined || typeof client.vaults.list !== 'function') {
          throw new SecretSyncError('server', '1Password SDK client does not expose vault listing.');
        }
        return client.vaults.list();
      });
    } catch (error) {
      throw error instanceof SecretSyncError ? error : mapSdkError(error, 'list-vaults', path);
    }
    if (!Array.isArray(raw)) {
      throw new SecretSyncError('schema', 'Direct SDK vault list response is not an array.');
    }
    return validateVaultListResponse(
      raw.map((entry) => {
        if (!isPlainObject(entry)) {
          return entry;
        }
        const record = entry as Record<string, unknown>;
        return {
          id: record.id,
          title: record.title,
          ...(record.description === undefined ? {} : { description: record.description }),
          ...(record.vaultType === undefined ? {} : { vaultType: record.vaultType }),
          ...(record.activeItemCount === undefined ? {} : { activeItemCount: record.activeItemCount }),
        };
      }),
    );
  }

  async getItem(id: string): Promise<SecretItemDetail> {
    const validId = validateItemId(id);
    const path = sdkItemPath(this.vaultId);
    let raw: SdkItemLike;
    try {
      raw = await this.readWithRetries('get', (client) => client.items.get(this.vaultId, validId));
    } catch (error) {
      throw error instanceof SecretSyncError ? error : mapSdkError(error, 'get', path);
    }
    return this.decodeItem(raw);
  }

  async createItem(input: CreateSecretItemInput): Promise<CreateItemResult> {
    const valid = validateCreateSecretItemInput(input);
    for (const field of valid.fields) {
      if (byteLengthUtf8(field.value) > MAX_RECORD_BYTES) {
        throw new SecretSyncError('too-large', 'Create payload exceeds the 64KiB record bound without truncation.');
      }
    }
    const category = toSdkCategory(valid.category);
    const params: SdkCreateParams = {
      category,
      vaultId: this.vaultId,
      title: valid.title,
      tags: [...valid.tags],
      fields: valid.fields.map((field) => ({
        id: typeof field.id === 'string' && field.id.length > 0 ? field.id : randomUUID(),
        title: typeof field.label === 'string' && field.label.length > 0 ? field.label : 'field',
        ...(typeof field.purpose === 'string' && field.purpose.length > 0 ? { sectionId: field.purpose } : {}),
        fieldType: toSdkFieldType(field.type),
        value: field.value,
      })),
    };
    let client: SdkClientLike;
    try {
      client = await this.ensureClient();
    } catch (error) {
      throw error instanceof SecretSyncError ? error : mapSdkError(error, 'create', sdkItemPath(this.vaultId));
    }
    let raw: SdkItemLike;
    try {
      raw = await this.withDeadline(client.items.create(params), 'create');
    } catch (error) {
      if (error instanceof SecretSyncError) {
        if (isDeterministicCreateError(error)) {
          throw error;
        }
        return { status: 'uncertain', attempts: 1 };
      }
      const mapped = mapSdkError(error, 'create', sdkItemPath(this.vaultId));
      if (isDeterministicCreateError(mapped)) {
        throw mapped;
      }
      return { status: 'uncertain', attempts: 1 };
    }
    try {
      const detail = this.decodeItem(raw);
      return { status: 'created', item: detail };
    } catch {
      return { status: 'uncertain', attempts: 1 };
    }
  }
}

export function createSdkStore(options: SdkStoreOptions): SecretStore {
  return new SdkSecretStore(options);
}
