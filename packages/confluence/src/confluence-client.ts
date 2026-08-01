import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const V2_PATH = '/api/v2';
const V1_PATH = '/rest/api';
const DEFAULT_USER_AGENT = 'repo-toolkit-confluence/1.0 (+node)';
const MAX_LIMIT = 250;

export interface ConfluenceClientOptions {
  baseUrl: string;
  username: string;
  apiToken: string;
  fetch?: typeof fetch;
  userAgent?: string;
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

const STATUS_CODES = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
} as const;

export class ConfluenceApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly responseBody: string;

  constructor(message: string, status: number, endpoint: string, responseBody: string) {
    super(`${message} (status=${status}, endpoint=${endpoint})`);
    this.name = 'ConfluenceApiError';
    this.status = status;
    this.endpoint = endpoint;
    this.responseBody = responseBody;
  }
}

export class ConfluenceClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetchFn: typeof fetch;
  private readonly userAgent: string;

  constructor(options: ConfluenceClientOptions) {
    if (!options.baseUrl) {
      throw new Error('ConfluenceClient: baseUrl is required');
    }
    if (!options.username || !options.apiToken) {
      throw new Error('ConfluenceClient: username and apiToken are required');
    }

    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.authHeader = 'Basic ' + Buffer.from(`${options.username}:${options.apiToken}`, 'utf8').toString('base64');
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
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

  async getPageByTitle(spaceId: string, title: string): Promise<Page | undefined> {
    const query = new URLSearchParams({
      'space-id': spaceId,
      title: title,
      limit: '1',
      'body-format': 'storage',
    });
    const data = await this.requestJson<PaginatedResult<Page>>(this.v2Url(`/pages?${query.toString()}`), {
      method: 'GET',
    });
    return data.results[0];
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

  async getAttachments(pageId: string): Promise<Attachment[]> {
    const results: Attachment[] = [];
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({ limit: String(MAX_LIMIT) });
      if (cursor) {
        query.set('cursor', cursor);
      }
      const data = await this.requestJson<PaginatedResult<Attachment> & { meta?: { hasMore?: boolean } }>(
        this.v2Url(`/pages/${encodeURIComponent(pageId)}/attachments?${query.toString()}`),
        { method: 'GET' },
      );
      for (const item of data.results) {
        results.push(item);
      }
      cursor = data._links?.next;
    } while (cursor);
    return results;
  }

  async uploadAttachment(pageId: string, filePath: string, comment?: string): Promise<Attachment> {
    return this.sendAttachmentMultipart(pageId, undefined, filePath, comment);
  }

  async updateAttachmentData(
    pageId: string,
    attachmentId: string,
    filePath: string,
    comment?: string,
  ): Promise<Attachment> {
    return this.sendAttachmentMultipart(pageId, attachmentId, filePath, comment);
  }

  private async sendAttachmentMultipart(
    pageId: string,
    attachmentId: string | undefined,
    filePath: string,
    comment?: string,
  ): Promise<Attachment> {
    const fileBuffer = readFileSync(filePath);
    const filename = basename(filePath);
    const boundary = '----repo-toolkit-confluence-' + Math.random().toString(16).slice(2);
    const parts: Buffer[] = [];

    parts.push(multipartField(boundary, 'file', filename, fileBuffer));
    if (comment) {
      parts.push(multipartField(boundary, 'comment', undefined, Buffer.from(comment, 'utf8')));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const endpoint = attachmentId
      ? this.v1Url(`/content/${encodeURIComponent(pageId)}/child/attachment/${encodeURIComponent(attachmentId)}/data`)
      : this.v1Url(`/content/${encodeURIComponent(pageId)}/child/attachment`);

    const data = await this.requestJson<Attachment | PaginatedResult<Attachment>>(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'X-Atlassian-Token': 'no-check',
      },
      body: Buffer.concat(parts) as unknown as BodyInit,
    });

    return normalizeAttachmentResult(data);
  }

  private async requestJson<T>(
    endpoint: string,
    init: {
      method: string;
      headers?: Record<string, string>;
      body?: BodyInit;
    },
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: 'application/json',
      'User-Agent': this.userAgent,
    };
    if (init.headers) {
      for (const [k, v] of Object.entries(init.headers)) {
        headers[k] = v;
      }
    }

    let response: Response;
    try {
      response = await this.fetchFn(endpoint, {
        method: init.method,
        headers,
        body: init.body as BodyInit,
      });
    } catch (cause) {
      throw new ConfluenceApiError(
        cause instanceof Error ? `Network error: ${cause.message}` : 'Network error',
        0,
        endpoint,
        '',
      );
    }

    const text = await response.text();
    if (!response.ok) {
      throw new ConfluenceApiError(describeStatus(response.status), response.status, endpoint, text);
    }

    if (text.length === 0) {
      return {} as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ConfluenceApiError('Response was not valid JSON', response.status, endpoint, text);
    }
  }

  private v2Url(path: string): string {
    return this.baseUrl + V2_PATH + path;
  }

  private v1Url(path: string): string {
    return this.baseUrl + V1_PATH + path;
  }
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
  let url = trimmed;
  while (url.endsWith('/')) {
    url = url.slice(0, -1);
  }
  return url;
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
