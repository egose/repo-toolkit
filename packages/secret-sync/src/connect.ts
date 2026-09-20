import { SecretSyncError } from './errors';
import {
  validateConnectItemDetail,
  validateConnectItemSummary,
  validateCreateConnectItemInput,
  validateItemId,
  validateListResponse,
  type ConnectItemDetail,
  type ConnectItemSummary,
  type CreateConnectItemInput,
  type CreateItemResult,
  type ListItemsOptions,
  type SecretStore,
} from './store';

export interface FetchRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  redirect?: string;
}

export interface FetchHeadersLike {
  get(name: string): string | null;
}

export interface FetchResponseLike {
  status: number;
  headers: FetchHeadersLike;
  text(): Promise<string>;
  body?: unknown;
  url?: string;
  redirected?: boolean;
}

export type FetchLike = (url: string, init?: FetchRequestInit) => Promise<FetchResponseLike>;

export interface ConnectStoreOptions {
  vaultId: string;
  hostEnv?: string;
  tokenEnv?: string;
  env?: Record<string, string | undefined>;
  fetchImpl: FetchLike;
  timeoutMs?: number;
  maxListBytes?: number;
  maxDetailBytes?: number;
  maxRetries?: number;
  concurrency?: number;
  sleep?: (ms: number) => Promise<void>;
}

export const CONNECT_TIMEOUT_MS = 30000;
export const CONNECT_MAX_GET_RETRIES = 3;
export const CONNECT_MAX_LIST_BYTES = 16 * 1024 * 1024;
export const CONNECT_MAX_DETAIL_BYTES = 256 * 1024;
export const CONNECT_DEFAULT_CONCURRENCY = 4;
export const CONNECT_MAX_CONCURRENCY = 8;
export const CONNECT_MAX_RETRY_AFTER_MS = 5000;
export const CONNECT_RETRY_BASE_MS = 100;
export const CONNECT_RETRY_CAP_MS = 2000;
export const DEFAULT_CONNECT_HOST_ENV = 'OP_CONNECT_HOST';
export const DEFAULT_CONNECT_TOKEN_ENV = 'OP_CONNECT_TOKEN';

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized =
    hostname.toLowerCase().startsWith('[') && hostname.endsWith(']')
      ? hostname.toLowerCase().slice(1, -1)
      : hostname.toLowerCase();
  const lower = normalized;
  if (lower === 'localhost' || lower === '::1' || lower === '0:0:0:0:0:0:0:1') {
    return true;
  }
  const parts = lower.split('.');
  if (parts.length === 4 && parts[0] === '127') {
    for (const part of parts) {
      if (!/^[0-9]+$/.test(part)) {
        return false;
      }
      const n = Number(part);
      if (!Number.isSafeInteger(n) || n < 0 || n > 255) {
        return false;
      }
    }
    return true;
  }
  return false;
}

export function resolveConnectBaseUrl(rawHost: string): URL {
  const trimmed = rawHost.trim();
  if (trimmed.length === 0) {
    throw new SecretSyncError('invalid-url', 'Connect host is not configured.');
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new SecretSyncError('invalid-url', 'Connect host is not a valid URL.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new SecretSyncError('invalid-url', 'Connect host must not contain credentials.');
  }
  if (url.hash !== '') {
    throw new SecretSyncError('invalid-url', 'Connect host must not contain a fragment.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SecretSyncError('invalid-url', 'Connect host must use https or http loopback.');
  }
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    throw new SecretSyncError('invalid-url', 'Plain http is only allowed for loopback hosts.');
  }
  return url;
}

export function escapeConnectFilterValue(value: string): string {
  if (value.includes('\0')) {
    throw new SecretSyncError('validation', 'Filter value must not contain NUL bytes.');
  }
  return value.split('\\').join('\\\\').split('"').join('\\"');
}

export function buildTitleFilter(title: string): string {
  return `title eq "${escapeConnectFilterValue(title)}"`;
}

export function validateConcurrency(value: number | undefined, fallback: number): number {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > CONNECT_MAX_CONCURRENCY) {
    throw new SecretSyncError('validation', `Concurrency must be an integer between 1 and ${CONNECT_MAX_CONCURRENCY}.`);
  }
  return candidate;
}

export function parseRetryAfterMs(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (/^[0-9]+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isSafeInteger(seconds) || seconds < 0) {
      return undefined;
    }
    return Math.min(seconds * 1000, CONNECT_MAX_RETRY_AFTER_MS);
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const diff = parsed - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) {
    return undefined;
  }
  return Math.min(diff, CONNECT_MAX_RETRY_AFTER_MS);
}

export function delayForAttempt(attempt: number, retryAfterMs: number | undefined): number {
  if (retryAfterMs !== undefined) {
    return Math.min(Math.max(retryAfterMs, 0), CONNECT_MAX_RETRY_AFTER_MS);
  }
  const grown = CONNECT_RETRY_BASE_MS * Math.pow(2, attempt);
  return Math.min(grown, CONNECT_RETRY_CAP_MS);
}

function byteLengthUtf8(text: string): number {
  return new TextEncoder().encode(text).length;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function assertNoRedirect(response: FetchResponseLike, expectedOrigin: string, method: string, path: string): void {
  if (isRedirectStatus(response.status)) {
    throw new SecretSyncError('redirect-blocked', `Connect ${method} redirect was blocked for ${path}.`, {
      status: response.status,
      method,
      path,
    });
  }
  if (response.redirected === true) {
    throw new SecretSyncError('redirect-blocked', `Connect ${method} redirect was blocked for ${path}.`, {
      status: response.status,
      method,
      path,
    });
  }
  if (typeof response.url === 'string' && response.url !== '') {
    try {
      const actual = new URL(response.url);
      const expected = new URL(expectedOrigin);
      if (actual.origin !== expected.origin) {
        throw new SecretSyncError('redirect-blocked', `Connect ${method} redirect was blocked for ${path}.`, {
          status: response.status,
          method,
          path,
        });
      }
    } catch (error) {
      if (error instanceof SecretSyncError && error.code === 'redirect-blocked') {
        throw error;
      }
    }
  }
}

function classifyJsonParseError(error: unknown): 'truncated' | 'schema' {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes('Unexpected end') ||
    message.includes('Unterminated') ||
    message.includes('end of JSON input') ||
    message.includes('premature') ||
    message.includes('EOF')
  ) {
    return 'truncated';
  }
  return 'schema';
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }
  return false;
}

interface BodyReaderLike {
  read(): Promise<{ done?: boolean; value?: unknown }>;
  cancel?(): Promise<void> | void;
}

function getBodyReader(body: unknown): BodyReaderLike | undefined {
  if (body === null || body === undefined) {
    return undefined;
  }
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.getReader === 'function') {
    try {
      const reader = (candidate.getReader as () => BodyReaderLike)();
      if (reader !== null && typeof reader === 'object' && typeof reader.read === 'function') {
        return reader;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function getAsyncIterator(body: unknown): AsyncIterable<unknown> | undefined {
  if (body === null || body === undefined) {
    return undefined;
  }
  const holder = body as unknown as { [key: symbol]: unknown };
  const marker = holder[Symbol.asyncIterator];
  if (typeof marker === 'function') {
    return body as AsyncIterable<unknown>;
  }
  return undefined;
}

export async function readBoundedText(
  response: FetchResponseLike,
  maxBytes: number,
  method: string,
  path: string,
): Promise<string> {
  const declaredRaw = response.headers.get('content-length');
  let declared: number | undefined;
  if (declaredRaw !== null && declaredRaw.trim() !== '') {
    const parsed = Number(declaredRaw.trim());
    if (Number.isSafeInteger(parsed) && parsed >= 0 && parsed > maxBytes) {
      throw new SecretSyncError('too-large', `Connect ${method} response exceeds the byte bound for ${path}.`, {
        method,
        path,
      });
    }
    if (Number.isSafeInteger(parsed) && parsed >= 0) {
      declared = parsed;
    }
  }
  const reader = getBodyReader(response.body);
  const iterator = reader === undefined ? getAsyncIterator(response.body) : undefined;
  if (reader === undefined && iterator === undefined) {
    const text = await response.text();
    const size = byteLengthUtf8(text);
    if (size > maxBytes) {
      throw new SecretSyncError('too-large', `Connect ${method} response exceeds the byte bound for ${path}.`, {
        method,
        path,
      });
    }
    if (declared !== undefined && size < declared) {
      throw new SecretSyncError('truncated', `Connect ${method} response was truncated for ${path}.`, {
        method,
        path,
      });
    }
    return text;
  }
  const decoder = new TextDecoder();
  const textParts: string[] = [];
  const byteChunks: Uint8Array[] = [];
  let stringMode = false;
  let total = 0;
  const pushBytes = (size: number): void => {
    total += size;
    if (total > maxBytes) {
      throw new SecretSyncError('too-large', `Connect ${method} response exceeds the byte bound for ${path}.`, {
        method,
        path,
      });
    }
  };
  try {
    if (reader !== undefined) {
      for (;;) {
        const next = await reader.read();
        if (next.done === true) {
          break;
        }
        const value = next.value;
        if (typeof value === 'string') {
          stringMode = true;
          pushBytes(byteLengthUtf8(value));
          textParts.push(value);
        } else if (value instanceof Uint8Array) {
          pushBytes(value.byteLength);
          byteChunks.push(value);
        } else if (value === undefined) {
          break;
        } else {
          const asText = String(value);
          stringMode = true;
          pushBytes(byteLengthUtf8(asText));
          textParts.push(asText);
        }
      }
    } else if (iterator !== undefined) {
      for await (const value of iterator) {
        if (typeof value === 'string') {
          stringMode = true;
          pushBytes(byteLengthUtf8(value));
          textParts.push(value);
        } else if (value instanceof Uint8Array) {
          pushBytes(value.byteLength);
          byteChunks.push(value);
        } else if (value === undefined || value === null) {
          continue;
        } else {
          const asText = String(value);
          stringMode = true;
          pushBytes(byteLengthUtf8(asText));
          textParts.push(asText);
        }
      }
    }
  } catch (error) {
    if (error instanceof SecretSyncError) {
      throw error;
    }
    if (isAbortError(error)) {
      throw error;
    }
    throw new SecretSyncError('truncated', `Connect ${method} response was truncated for ${path}.`, {
      method,
      path,
    });
  }
  let text: string;
  if (stringMode) {
    if (byteChunks.length > 0) {
      let combined = '';
      for (const chunk of byteChunks) {
        combined += decoder.decode(chunk, { stream: true });
      }
      combined += decoder.decode();
      textParts.push(combined);
    }
    text = textParts.join('');
  } else {
    let combined = '';
    for (const chunk of byteChunks) {
      combined += decoder.decode(chunk, { stream: true });
    }
    combined += decoder.decode();
    text = combined;
  }
  if (declared !== undefined && total < declared) {
    throw new SecretSyncError('truncated', `Connect ${method} response was truncated for ${path}.`, {
      method,
      path,
    });
  }
  return text;
}

export async function mapWithConcurrency<T, R>(
  items: ReadonlyArray<T>,
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const limit = validateConcurrency(concurrency, CONNECT_DEFAULT_CONCURRENCY);
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers: Promise<void>[] = [];
  const count = Math.min(limit, items.length);
  for (let w = 0; w < count; w += 1) {
    workers.push(
      (async () => {
        for (;;) {
          const current = next;
          next += 1;
          if (current >= items.length) {
            return;
          }
          const item = items[current] as T;
          results[current] = await fn(item, current);
        }
      })(),
    );
  }
  await Promise.all(workers);
  return results;
}

interface ResolvedEndpoint {
  base: URL;
  vaultId: string;
  token: string;
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

export class ConnectSecretStore implements SecretStore {
  private readonly vaultId: string;
  private readonly hostEnv: string;
  private readonly tokenEnv: string;
  private readonly env: Record<string, string | undefined> | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxListBytes: number;
  private readonly maxDetailBytes: number;
  private readonly maxRetries: number;
  private readonly concurrency: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ConnectStoreOptions) {
    if (typeof options.fetchImpl !== 'function') {
      throw new SecretSyncError('validation', 'A fetch implementation is required.');
    }
    this.vaultId = resolveVaultId(options.vaultId);
    this.hostEnv = options.hostEnv ?? DEFAULT_CONNECT_HOST_ENV;
    this.tokenEnv = options.tokenEnv ?? DEFAULT_CONNECT_TOKEN_ENV;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(this.hostEnv)) {
      throw new SecretSyncError('validation', 'Connect host env name is invalid.');
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(this.tokenEnv)) {
      throw new SecretSyncError('validation', 'Connect token env name is invalid.');
    }
    this.env = options.env;
    this.fetchImpl = options.fetchImpl;
    const timeoutMs = options.timeoutMs ?? CONNECT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
      throw new SecretSyncError('validation', 'Connect timeout must be between 1 and 120000 ms.');
    }
    this.timeoutMs = timeoutMs;
    const maxListBytes = options.maxListBytes ?? CONNECT_MAX_LIST_BYTES;
    if (!Number.isSafeInteger(maxListBytes) || maxListBytes < 1 || maxListBytes > CONNECT_MAX_LIST_BYTES) {
      throw new SecretSyncError('validation', 'List byte bound is out of range.');
    }
    this.maxListBytes = maxListBytes;
    const maxDetailBytes = options.maxDetailBytes ?? CONNECT_MAX_DETAIL_BYTES;
    if (!Number.isSafeInteger(maxDetailBytes) || maxDetailBytes < 1 || maxDetailBytes > CONNECT_MAX_DETAIL_BYTES) {
      throw new SecretSyncError('validation', 'Detail byte bound is out of range.');
    }
    this.maxDetailBytes = maxDetailBytes;
    const maxRetries = options.maxRetries ?? CONNECT_MAX_GET_RETRIES;
    if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > CONNECT_MAX_GET_RETRIES) {
      throw new SecretSyncError('validation', 'GET retry count is out of range.');
    }
    this.maxRetries = maxRetries;
    this.concurrency = validateConcurrency(options.concurrency, CONNECT_DEFAULT_CONCURRENCY);
    this.sleep = options.sleep ?? defaultSleep;
  }

  getConcurrency(): number {
    return this.concurrency;
  }

  getVaultId(): string {
    return this.vaultId;
  }

  private resolveEndpoint(): ResolvedEndpoint {
    const source: Record<string, string | undefined> = this.env ?? (process.env as Record<string, string | undefined>);
    const rawHost = source[this.hostEnv];
    const token = source[this.tokenEnv];
    if (typeof rawHost !== 'string' || rawHost.trim() === '') {
      throw new SecretSyncError('invalid-url', `Connect host is not configured (env ${this.hostEnv}).`);
    }
    if (typeof token !== 'string' || token === '') {
      throw new SecretSyncError('auth', `Connect token is not configured (env ${this.tokenEnv}).`);
    }
    const base = resolveConnectBaseUrl(rawHost);
    return { base, vaultId: this.vaultId, token };
  }

  private listPath(): string {
    return `/v1/vaults/${this.vaultId}/items`;
  }

  private itemPath(id: string): string {
    return `/v1/vaults/${this.vaultId}/items/${id}`;
  }

  private buildUrl(base: URL, path: string, filter?: string): string {
    const url = new URL(path, base.origin);
    if (base.pathname !== '' && base.pathname !== '/') {
      const cleanedBase = base.pathname.endsWith('/') ? base.pathname.slice(0, -1) : base.pathname;
      url.pathname = `${cleanedBase}${path}`;
    }
    if (filter !== undefined) {
      url.searchParams.set('filter', filter);
    }
    return url.toString();
  }

  private async fetchOnce(url: string, init: FetchRequestInit, timeoutMs: number): Promise<FetchResponseLike> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (isAbortError(error)) {
        throw new SecretSyncError('timeout', 'Connect request timed out.', { retryable: true });
      }
      if (error instanceof SecretSyncError) {
        throw error;
      }
      throw new SecretSyncError('network', 'Connect request failed before a response was received.', {
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async getJson(url: string, token: string, maxBytes: number, path: string): Promise<unknown> {
    let attempt = 0;
    for (;;) {
      let response: FetchResponseLike;
      try {
        response = await this.fetchOnce(
          url,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            redirect: 'manual',
          },
          this.timeoutMs,
        );
      } catch (error) {
        if (error instanceof SecretSyncError && error.retryable && attempt < this.maxRetries) {
          const wait = delayForAttempt(attempt, undefined);
          attempt += 1;
          await this.sleep(wait);
          continue;
        }
        throw error;
      }
      const origin = new URL(url).origin;
      assertNoRedirect(response, origin, 'GET', path);
      if (response.status === 200) {
        let text: string;
        try {
          text = await readBoundedText(response, maxBytes, 'GET', path);
        } catch (error) {
          if (isAbortError(error)) {
            const timeout = new SecretSyncError('timeout', 'Connect GET response read timed out.', {
              method: 'GET',
              path,
              retryable: true,
            });
            if (attempt < this.maxRetries) {
              const wait = delayForAttempt(attempt, undefined);
              attempt += 1;
              await this.sleep(wait);
              continue;
            }
            throw timeout;
          }
          throw error;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (error) {
          const kind = classifyJsonParseError(error);
          throw new SecretSyncError(
            kind,
            kind === 'truncated'
              ? `Connect GET response was truncated for ${path}.`
              : `Connect GET response was not valid JSON for ${path}.`,
            { method: 'GET', path },
          );
        }
        return parsed;
      }
      if (response.status === 401 || response.status === 403) {
        throw new SecretSyncError('auth', `Connect GET was rejected for ${path}.`, {
          status: response.status,
          method: 'GET',
          path,
        });
      }
      if (response.status === 404) {
        throw new SecretSyncError('not-found', `Connect resource was not found for ${path}.`, {
          status: response.status,
          method: 'GET',
          path,
        });
      }
      if (response.status === 429) {
        const retryAfter = parseRetryAfterMs(response.headers.get('retry-after'));
        if (attempt < this.maxRetries) {
          const wait = delayForAttempt(attempt, retryAfter);
          attempt += 1;
          await this.sleep(wait);
          continue;
        }
        throw new SecretSyncError('rate-limited', `Connect GET was rate limited for ${path}.`, {
          status: 429,
          method: 'GET',
          path,
        });
      }
      if (response.status >= 500 && response.status <= 599) {
        if (attempt < this.maxRetries) {
          const retryAfter = parseRetryAfterMs(response.headers.get('retry-after'));
          const wait = delayForAttempt(attempt, retryAfter);
          attempt += 1;
          await this.sleep(wait);
          continue;
        }
        throw new SecretSyncError('server', `Connect GET failed for ${path}.`, {
          status: response.status,
          method: 'GET',
          path,
        });
      }
      throw new SecretSyncError('validation', `Connect GET was rejected for ${path}.`, {
        status: response.status,
        method: 'GET',
        path,
      });
    }
  }

  async listItems(options: ListItemsOptions = {}): Promise<ConnectItemSummary[]> {
    const endpoint = this.resolveEndpoint();
    const path = this.listPath();
    let filter: string | undefined;
    if (options.titleFilter !== undefined) {
      if (typeof options.titleFilter !== 'string' || options.titleFilter.length === 0) {
        throw new SecretSyncError('validation', 'Title filter must be a non-empty string.');
      }
      filter = buildTitleFilter(options.titleFilter);
    }
    const url = this.buildUrl(endpoint.base, `/v1/vaults/${encodeURIComponent(endpoint.vaultId)}/items`, filter);
    const parsed = await this.getJson(url, endpoint.token, this.maxListBytes, path);
    return validateListResponse(parsed);
  }

  async getItem(id: string): Promise<ConnectItemDetail> {
    const validId = validateItemId(id);
    const endpoint = this.resolveEndpoint();
    const path = this.itemPath(validId);
    const url = this.buildUrl(
      endpoint.base,
      `/v1/vaults/${encodeURIComponent(endpoint.vaultId)}/items/${encodeURIComponent(validId)}`,
    );
    const parsed = await this.getJson(url, endpoint.token, this.maxDetailBytes, path);
    return validateConnectItemDetail(parsed);
  }

  async createItem(input: CreateConnectItemInput): Promise<CreateItemResult> {
    const valid = validateCreateConnectItemInput(input);
    const endpoint = this.resolveEndpoint();
    const path = this.listPath();
    const url = this.buildUrl(endpoint.base, `/v1/vaults/${encodeURIComponent(endpoint.vaultId)}/items`);
    const body = JSON.stringify({
      title: valid.title,
      category: valid.category,
      tags: valid.tags,
      fields: valid.fields.map((field) => ({ ...field })),
    });
    let response: FetchResponseLike;
    try {
      response = await this.fetchOnce(
        url,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${endpoint.token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body,
          redirect: 'manual',
        },
        this.timeoutMs,
      );
    } catch {
      return { status: 'uncertain', attempts: 1 };
    }
    const origin = new URL(url).origin;
    assertNoRedirect(response, origin, 'POST', path);
    if (response.status === 401 || response.status === 403) {
      throw new SecretSyncError('auth', `Connect POST was rejected for ${path}.`, {
        status: response.status,
        method: 'POST',
        path,
      });
    }
    if (response.status === 404) {
      throw new SecretSyncError('not-found', `Connect resource was not found for ${path}.`, {
        status: response.status,
        method: 'POST',
        path,
      });
    }
    if (response.status === 429 || (response.status >= 500 && response.status <= 599)) {
      return { status: 'uncertain', attempts: 1 };
    }
    if (response.status !== 200 && response.status !== 201) {
      throw new SecretSyncError('validation', `Connect POST was rejected for ${path}.`, {
        status: response.status,
        method: 'POST',
        path,
      });
    }
    let text: string;
    try {
      text = await readBoundedText(response, this.maxDetailBytes, 'POST', path);
    } catch {
      return { status: 'uncertain', attempts: 1 };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { status: 'uncertain', attempts: 1 };
    }
    try {
      const item = validateConnectItemDetail(parsed);
      void validateConnectItemSummary({ id: item.id, title: item.title, tags: item.tags });
      return { status: 'created', item };
    } catch {
      return { status: 'uncertain', attempts: 1 };
    }
  }
}

export function createConnectStore(options: ConnectStoreOptions): SecretStore {
  return new ConnectSecretStore(options);
}
