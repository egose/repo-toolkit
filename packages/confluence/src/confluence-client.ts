import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { statSync, createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { Readable } from 'node:stream';

const V2_PATH = '/api/v2';
const V1_PATH = '/rest/api';
const DEFAULT_USER_AGENT = 'repo-toolkit-confluence/1.0 (+node)';
const MAX_LIMIT = 250;
const MAX_ERROR_BODY_LENGTH = 8_192;
const MAX_PAGES_PER_QUERY = 100;
export const CONFLUENCE_MANAGED_LABEL = 'repo-toolkit-confluence';
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface ConfluenceClientOptions {
  baseUrl: string;
  username: string;
  apiToken: string;
  fetch?: typeof fetch;
  userAgent?: string;
  /** Timeout (ms) applied to every HTTP request. Default 30000. */
  requestTimeoutMs?: number;
  /** Retries for 429 / 5xx on safe methods (GET/HEAD/OPTIONS). Default 3; never applied to writes. */
  maxRetries?: number;
  /** Per-file maximum attachment upload size in bytes. Default 50 MB. */
  maxUploadBytes?: number;
}

/**
 * Narrow gateway covering only the attachment-list and binary upload methods the
 * image/mermaid rewriters need. `ConfluenceClient` implements this interface;
 * tests inject fakes that implement just these three methods.
 */
export interface AttachmentGateway {
  getAttachments(pageId: string): Promise<Attachment[]>;
  uploadAttachment(pageId: string, filePath: string, comment?: string, filename?: string): Promise<Attachment>;
  updateAttachmentData(
    pageId: string,
    attachmentId: string,
    filePath: string,
    comment?: string,
    filename?: string,
  ): Promise<Attachment>;
}

/**
 * Narrow remote-mutation boundary consumed by the sync orchestrator and the
 * image/mermaid rewriters. `ConfluenceClient` implements this interface; tests
 * may inject any object whose method shapes match (typed fakes — no `unknown`
 * cast required). Replacing the client also replaces the credentials/baseUrl
 * requirement: the sync orchestrator relies solely on this gateway for remote
 * work, so callers that supply their own gateway never need dummy credentials.
 *
 * The interface is the supported contract for custom clients: every method
 * listed here is one the sync actually calls, and the signatures match the v1
 * multipart + v2 JSON contract the bundled `ConfluenceClient` honors.
 */
export interface ConfluenceGateway extends AttachmentGateway {
  getSpaceIdByKey(spaceKey: string): Promise<string>;
  getPagesByTitle(spaceId: string, title: string): Promise<Page[]>;
  getPage(pageId: string): Promise<Page>;
  createPage(input: CreatePageInput): Promise<Page>;
  updatePage(input: UpdatePageInput): Promise<Page>;
  getPageDescendants(pageId: string): Promise<PageDescendant[]>;
  getPageLabels(pageId: string): Promise<PageLabel[]>;
  addManagedLabel(pageId: string): Promise<void>;
  deletePage(pageId: string): Promise<void>;
}

export interface PageDescendant {
  id: string;
  type: string;
  title?: string;
  parentId?: string;
  depth?: number;
  status?: string;
}

export interface PageLabel {
  name: string;
  prefix: string;
  id?: string;
}

export interface PageBody {
  representation: 'storage' | 'atlas_doc' | 'wiki' | 'view' | 'export_view';
  value: string;
}

export interface PageVersion {
  number: number;
  message?: string;
}

export interface CreatePageInput {
  spaceId: string;
  title: string;
  body: PageBody;
  parentId?: string;
  status?: 'current' | 'draft';
}

export interface UpdatePageInput {
  id: string;
  title: string;
  body: PageBody;
  version: PageVersion;
  status?: 'current' | 'draft';
}

export interface Page {
  id: string;
  status: string;
  title: string;
  spaceId: string;
  parentId?: string;
  body?: { storage?: { value: string; representation: string } };
  version: { number: number; createdAt?: string; message?: string };
  _links: { webui: string; self?: string; base?: string };
}

export interface Attachment {
  id: string;
  title: string;
  filename?: string;
  mediaType?: string;
  fileSize?: number;
  pageId?: string;
  spaceId?: string;
  version: { number: number; createdAt?: string; message?: string };
  _links: { webui: string; download?: string; self?: string };
}

interface PaginatedResult<T> {
  results: T[];
  _links?: { next?: string };
}

export class ConfluenceUploadError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly responseBody: string;

  constructor(message: string, status: number, endpoint: string, responseBody: string) {
    super(`${message} (status=${status}, endpoint=${endpoint})`);
    this.name = 'ConfluenceUploadError';
    this.status = status;
    this.endpoint = endpoint;
    this.responseBody = responseBody;
  }
}

const STATUS_CODES = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
} as const;

export class ConfluenceApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly responseBody: string;

  constructor(message: string, status: number, endpoint: string, responseBody: string) {
    const responseBodySuffix = responseBody === '' ? '' : `, responseBody=${responseBody}`;
    super(`${message} (status=${status}, endpoint=${endpoint}${responseBodySuffix})`);
    this.name = 'ConfluenceApiError';
    this.status = status;
    this.endpoint = endpoint;
    this.responseBody = responseBody;
  }
}

export class ConfluenceClient implements ConfluenceGateway {
  private readonly baseUrl: string;
  private readonly baseUrlOrigin: string;
  private readonly authHeader: string;
  private readonly fetchFn: typeof fetch;
  private readonly userAgent: string;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxUploadBytes: number;

  constructor(options: ConfluenceClientOptions) {
    if (!options.baseUrl) {
      throw new Error('ConfluenceClient: baseUrl is required');
    }
    if (!options.username || !options.apiToken) {
      throw new Error('ConfluenceClient: username and apiToken are required');
    }

    const normalized = normalizeBaseUrl(options.baseUrl);
    this.baseUrl = normalized;
    this.baseUrlOrigin = new URL(normalized).origin;
    this.authHeader = 'Basic ' + Buffer.from(`${options.username}:${options.apiToken}`, 'utf8').toString('base64');
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.maxUploadBytes = options.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  }

  async getSpaceIdByKey(spaceKey: string): Promise<string> {
    const query = new URLSearchParams({ keys: spaceKey, limit: '1' });
    const data = await this.requestJson<PaginatedResult<{ id: string; key: string }>>(
      this.v2Url(`/spaces?${query.toString()}`),
      { method: 'GET' },
    );
    const result = data.results[0];
    if (!result) {
      throw new Error(`Confluence space not found for key: ${spaceKey}`);
    }
    return result.id;
  }

  async getPagesByTitle(spaceId: string, title: string): Promise<Page[]> {
    const pages: Page[] = [];
    const visited = new Set<string>();
    let pageCount = 0;
    const startUrl = this.v2Url(
      `/spaces/${encodeURIComponent(spaceId)}/pages?${new URLSearchParams({
        title,
        limit: String(MAX_LIMIT),
        'body-format': 'storage',
      }).toString()}`,
    );

    let nextUrl: string | undefined = startUrl;
    while (nextUrl) {
      pageCount += 1;
      if (pageCount > MAX_PAGES_PER_QUERY) {
        throw new ConfluenceApiError(`Pagination limit (${MAX_PAGES_PER_QUERY}) exceeded`, 0, nextUrl, '');
      }
      if (visited.has(nextUrl)) {
        throw new ConfluenceApiError('Confluence pagination loop detected', 0, nextUrl, '');
      }
      visited.add(nextUrl);

      const data = await this.requestJson<PaginatedResult<Page>>(nextUrl, { method: 'GET' });
      pages.push(...data.results);
      nextUrl = resolveNextUrl(this.baseUrl, this.baseUrlOrigin, data._links?.next);
    }

    return pages;
  }

  async getPage(pageId: string): Promise<Page> {
    return this.requestJson<Page>(this.v2Url(`/pages/${encodeURIComponent(pageId)}?body-format=storage`), {
      method: 'GET',
    });
  }

  async createPage(input: CreatePageInput): Promise<Page> {
    const body = {
      spaceId: input.spaceId,
      status: input.status ?? 'current',
      title: input.title,
      parentId: input.parentId,
      body: {
        representation: input.body.representation,
        value: input.body.value,
      },
    };
    return this.requestJson<Page>(this.v2Url('/pages'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async updatePage(input: UpdatePageInput): Promise<Page> {
    const body = {
      id: input.id,
      status: input.status ?? 'current',
      title: input.title,
      body: {
        representation: input.body.representation,
        value: input.body.value,
      },
      version: { number: input.version.number, message: input.version.message },
    };
    return this.requestJson<Page>(this.v2Url(`/pages/${encodeURIComponent(input.id)}`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async getPageDescendants(pageId: string): Promise<PageDescendant[]> {
    const query = new URLSearchParams({ limit: String(MAX_LIMIT) });
    return this.listAll(this.v2Url(`/pages/${encodeURIComponent(pageId)}/descendants?${query.toString()}`));
  }

  async getPageLabels(pageId: string): Promise<PageLabel[]> {
    const query = new URLSearchParams({ limit: String(MAX_LIMIT) });
    return this.listAll(this.v2Url(`/pages/${encodeURIComponent(pageId)}/labels?${query.toString()}`));
  }

  async addManagedLabel(pageId: string): Promise<void> {
    await this.requestJson<unknown>(this.v1Url(`/content/${encodeURIComponent(pageId)}/label`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ prefix: 'global', name: CONFLUENCE_MANAGED_LABEL }]),
    });
  }

  async deletePage(pageId: string): Promise<void> {
    await this.requestJson<unknown>(this.v2Url(`/pages/${encodeURIComponent(pageId)}`), { method: 'DELETE' });
  }

  private async listAll<T>(startUrl: string): Promise<T[]> {
    const results: T[] = [];
    const visited = new Set<string>();
    let pageCount = 0;
    let nextUrl: string | undefined = startUrl;

    while (nextUrl) {
      pageCount += 1;
      if (pageCount > MAX_PAGES_PER_QUERY) {
        throw new ConfluenceApiError(`Pagination limit (${MAX_PAGES_PER_QUERY}) exceeded`, 0, nextUrl, '');
      }
      if (visited.has(nextUrl)) {
        throw new ConfluenceApiError('Confluence pagination loop detected', 0, nextUrl, '');
      }
      visited.add(nextUrl);

      const data = await this.requestJson<PaginatedResult<T>>(nextUrl, { method: 'GET' });
      results.push(...data.results);
      nextUrl = resolveNextUrl(this.baseUrl, this.baseUrlOrigin, data._links?.next);
    }

    return results;
  }

  async getAttachments(pageId: string): Promise<Attachment[]> {
    const results: Attachment[] = [];
    const visited = new Set<string>();
    let pageCount = 0;
    let nextUrl: string | undefined = this.v2Url(
      `/pages/${encodeURIComponent(pageId)}/attachments?${new URLSearchParams({
        limit: String(MAX_LIMIT),
      }).toString()}`,
    );

    while (nextUrl) {
      pageCount += 1;
      if (pageCount > MAX_PAGES_PER_QUERY) {
        throw new ConfluenceApiError(`Pagination limit (${MAX_PAGES_PER_QUERY}) exceeded`, 0, nextUrl, '');
      }
      if (visited.has(nextUrl)) {
        throw new ConfluenceApiError('Confluence pagination loop detected', 0, nextUrl, '');
      }
      visited.add(nextUrl);

      const data = await this.requestJson<PaginatedResult<Attachment> & { meta?: { hasMore?: boolean } }>(nextUrl, {
        method: 'GET',
      });
      for (const item of data.results) {
        results.push(item);
      }
      nextUrl = resolveNextUrl(this.baseUrl, this.baseUrlOrigin, data._links?.next);
    }
    return results;
  }

  async uploadAttachment(pageId: string, filePath: string, comment?: string, filename?: string): Promise<Attachment> {
    return this.sendAttachmentMultipart(pageId, undefined, filePath, comment, filename);
  }

  async updateAttachmentData(
    pageId: string,
    attachmentId: string,
    filePath: string,
    comment?: string,
    filename?: string,
  ): Promise<Attachment> {
    return this.sendAttachmentMultipart(pageId, attachmentId, filePath, comment, filename);
  }

  private async sendAttachmentMultipart(
    pageId: string,
    attachmentId: string | undefined,
    filePath: string,
    comment?: string,
    filenameOverride?: string,
  ): Promise<Attachment> {
    const info = statSync(filePath);
    if (!info.isFile()) {
      throw new ConfluenceApiError(`Attachment source must be a regular file: ${filePath}`, 0, filePath, '');
    }
    if (info.size > this.maxUploadBytes) {
      throw new ConfluenceApiError(
        `Attachment exceeds upload size limit (${this.maxUploadBytes} bytes): ${filePath}`,
        0,
        filePath,
        '',
      );
    }

    const filename = sanitizeFilename(filenameOverride ?? basename(filePath));
    const endpoint = attachmentId
      ? this.v1Url(`/content/${encodeURIComponent(pageId)}/child/attachment/${encodeURIComponent(attachmentId)}/data`)
      : this.v1Url(`/content/${encodeURIComponent(pageId)}/child/attachment`);

    const boundary = '----repo-toolkit-confluence-' + randomBytes(16).toString('hex');

    const fileStream = createReadStream(filePath);
    const commentBuffer = comment ? multipartField(boundary, 'comment', undefined, Buffer.from(comment, 'utf8')) : null;
    const body = Readable.from(
      (async function* () {
        const fileHeader = Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
          'utf8',
        );
        yield fileHeader;
        for await (const chunk of fileStream) {
          yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        }
        yield Buffer.from('\r\n', 'utf8');
        if (commentBuffer) {
          yield commentBuffer;
        }
        yield Buffer.from(`--${boundary}--\r\n`, 'utf8');
      })(),
    );

    try {
      const data = await this.requestJson<Attachment | PaginatedResult<Attachment>>(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'X-Atlassian-Token': 'no-check',
        },
        body: body as unknown as BodyInit,
        uploadKind: 'attachment',
        contentTypeExplicit: true,
      });

      return normalizeAttachmentResult(data);
    } catch (cause) {
      if (cause instanceof ConfluenceApiError) {
        const status = cause.status;
        if (
          status === STATUS_CODES.UNAUTHORIZED ||
          status === STATUS_CODES.FORBIDDEN ||
          status === STATUS_CODES.TOO_MANY_REQUESTS ||
          status >= 500
        ) {
          const uploadErr = new ConfluenceUploadError(cause.message, status, cause.endpoint, cause.responseBody);
          uploadErr.stack = cause.stack;
          throw uploadErr;
        }
      }
      throw cause;
    }
  }

  private async requestJson<T>(
    endpoint: string,
    init: {
      method: string;
      headers?: Record<string, string>;
      body?: BodyInit;
      uploadKind?: 'attachment';
      contentTypeExplicit?: boolean;
    },
  ): Promise<T> {
    void init.uploadKind;
    void init.contentTypeExplicit;
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: 'application/json',
      'User-Agent': this.userAgent,
    };

    for (const [k, v] of Object.entries(init.headers ?? {})) {
      headers[k] = v;
    }

    const method = init.method.toUpperCase();
    const isSafe = SAFE_METHODS.has(method);
    const maxRetries = isSafe ? this.maxRetries : 0;

    let attempt = 0;
    let lastError: unknown;
    while (attempt <= maxRetries) {
      const signal = this.makeTimeoutSignal();
      try {
        const response = await this.fetchFn(endpoint, {
          method,
          headers,
          body: init.body as BodyInit,
          redirect: 'manual',
          signal,
        });

        if (response.status >= 300 && response.status < 400) {
          throw new ConfluenceApiError('Redirect responses are not allowed', response.status, endpoint, '');
        }

        if (!response.ok) {
          const text = await readBodyBounded(response, MAX_ERROR_BODY_LENGTH);
          if (isSafe && shouldRetryStatus(response.status) && attempt < maxRetries) {
            attempt += 1;
            lastError = new ConfluenceApiError(describeStatus(response.status), response.status, endpoint, text);
            await sleepBackoff(response, endpoint);
            continue;
          }
          throw new ConfluenceApiError(describeStatus(response.status), response.status, endpoint, text);
        }

        const text = await response.text();
        if (text.length === 0) {
          return {} as T;
        }
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new ConfluenceApiError('Response was not valid JSON', response.status, endpoint, truncateText(text));
        }
      } catch (cause) {
        if (cause instanceof ConfluenceApiError || cause instanceof ConfluenceUploadError) {
          throw cause;
        }
        const reason = cause instanceof Error ? cause : undefined;
        if (isSafe && reason && reason.name !== 'AbortError' && attempt < maxRetries) {
          attempt += 1;
          lastError = cause;
          await sleepBackoff(undefined, endpoint, reason);
          continue;
        }
        throw new ConfluenceApiError(reason ? `Network error: ${reason.message}` : 'Network error', 0, endpoint, '');
      }
    }

    if (lastError instanceof Error) {
      throw new ConfluenceApiError(`Network error: ${lastError.message}`, 0, endpoint, '');
    }
    throw new ConfluenceApiError('Network error', 0, endpoint, '');
  }

  private makeTimeoutSignal(): AbortSignal {
    const ms = this.requestTimeoutMs;
    if (ms <= 0) {
      return new AbortController().signal;
    }
    if (typeof (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout === 'function') {
      return AbortSignal.timeout(ms);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${ms}ms`)), ms);
    if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
      (timer as unknown as { unref: () => void }).unref();
    }
    return controller.signal;
  }

  private v2Url(path: string): string {
    return this.baseUrl + V2_PATH + path;
  }

  private v1Url(path: string): string {
    return this.baseUrl + V1_PATH + path;
  }
}

function shouldRetryStatus(status: number): boolean {
  return status === STATUS_CODES.TOO_MANY_REQUESTS || status >= 500;
}

async function sleepBackoff(response: Response | undefined, endpoint: string, cause?: Error): Promise<void> {
  let delayMs = 0;
  if (response) {
    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter) {
      delayMs = parseRetryAfter(retryAfter, endpoint);
    }
  }
  if (delayMs <= 0) {
    const base = cause ? 200 : 500;
    const jitter = Math.floor(Math.random() * 250);
    delayMs = base + jitter;
  }
  const boundedDelay = Math.min(delayMs, 30_000);
  await delay(boundedDelay);
}

function parseRetryAfter(value: string, endpoint: string): number {
  if (!value) {
    return 0;
  }
  if (/^\d+$/.test(value.trim())) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return 0;
    }
    return Math.min(seconds * 1000, 30_000);
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.max(0, Math.min(date - Date.now(), 30_000));
  }
  void endpoint;
  return 0;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readBodyBounded(response: Response, maxBytes: number): Promise<string> {
  let total = 0;
  const chunks: Buffer[] = [];
  const reader = (response.body as unknown as AsyncIterable<Buffer> | undefined)?.[Symbol.asyncIterator]?.();
  if (reader) {
    let oversized = false;
    while (true) {
      const step = await reader.next();
      if (step.done) {
        break;
      }
      const chunk = Buffer.isBuffer(step.value) ? step.value : Buffer.from(step.value);
      if (total + chunk.length > maxBytes) {
        oversized = true;
        chunks.push(chunk.subarray(0, Math.max(0, maxBytes - total)));
        break;
      }
      total += chunk.length;
      chunks.push(chunk);
    }
    let body = Buffer.concat(chunks).toString('utf8');
    if (oversized) {
      body = body + '...';
    }
    return body;
  }

  const text = await response.text();
  if (text.length > maxBytes) {
    return text.slice(0, maxBytes) + '...';
  }
  return text;
}

function sanitizeFilename(name: string): string {
  if (name === '' || name === '.' || name === '..') {
    throw new ConfluenceApiError('Invalid attachment filename', 0, 'attachment', '');
  }
  let cleaned = '';
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    if (code === 0x22 || code === 0x27 || code === 0xd || code === 0xa || code === 0x00) {
      cleaned += '_';
      continue;
    }
    cleaned += name[i] ?? '';
  }
  cleaned = cleaned.replace(/[/\\]/g, '_');
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    throw new ConfluenceApiError('Invalid attachment filename', 0, 'attachment', '');
  }
  return cleaned;
}

function truncateText(text: string, maxBytes = MAX_ERROR_BODY_LENGTH): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text;
  }
  let end = text.length;
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes) {
    end -= 1;
  }
  return text.slice(0, end) + '...';
}

function multipartField(boundary: string, name: string, filename: string | undefined, value: Buffer): Buffer {
  const headerLines = [`--${boundary}\r\n`];
  if (filename) {
    headerLines.push(
      `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n`,
      'Content-Type: application/octet-stream\r\n',
    );
  } else {
    headerLines.push(`Content-Disposition: form-data; name="${name}"\r\n`);
  }
  headerLines.push('\r\n');
  return Buffer.concat([Buffer.from(headerLines.join(''), 'utf8'), value, Buffer.from('\r\n', 'utf8')]);
}

function normalizeAttachmentResult(data: Attachment | PaginatedResult<Attachment>): Attachment {
  if ((data as PaginatedResult<Attachment>).results) {
    const first = (data as PaginatedResult<Attachment>).results[0];
    if (!first) {
      throw new ConfluenceApiError('Attachment upload returned no results', 0, 'attachment', JSON.stringify(data));
    }
    return first;
  }
  return data as Attachment;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    throw new Error('baseUrl must not be empty');
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Invalid baseUrl: ${baseUrl}`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(`baseUrl must use https: ${baseUrl}`);
  }

  if (url.username || url.password) {
    throw new Error('baseUrl must not include embedded credentials');
  }

  if (url.search || url.hash) {
    throw new Error('baseUrl must not include query or fragment components');
  }

  const normalizedPath = url.pathname.replace(/\/+$/u, '') || '/';
  if (normalizedPath !== '/' && normalizedPath !== '/wiki') {
    throw new Error(`baseUrl path must be empty or /wiki: ${baseUrl}`);
  }

  return normalizedPath === '/' ? url.origin : `${url.origin}${normalizedPath}`;
}

function resolveNextUrl(baseUrl: string, baseUrlOrigin: string, next: string | undefined): string | undefined {
  if (!next) {
    return undefined;
  }

  let resolved: URL;
  try {
    resolved = new URL(next, baseUrl);
  } catch {
    throw new ConfluenceApiError(`Confluence pagination returned a malformed next link`, 0, next, '');
  }
  if (resolved.origin !== baseUrlOrigin) {
    throw new ConfluenceApiError(`Confluence pagination returned a cross-origin next link: ${next}`, 0, next, '');
  }

  return resolved.toString();
}

function describeStatus(status: number): string {
  switch (status) {
    case STATUS_CODES.UNAUTHORIZED:
      return 'Authentication failed (check username/apiToken)';
    case STATUS_CODES.FORBIDDEN:
      return 'Permission denied';
    case STATUS_CODES.NOT_FOUND:
      return 'Resource not found';
    case STATUS_CODES.CONFLICT:
      return 'Version conflict (page was updated concurrently)';
    case STATUS_CODES.TOO_MANY_REQUESTS:
      return 'Rate limited by Confluence';
    default:
      if (status >= STATUS_CODES.BAD_REQUEST && status < 500) {
        return `Client error (${status})`;
      }
      if (status >= 500) {
        return `Server error (${status})`;
      }
      return `Unexpected status (${status})`;
  }
}
