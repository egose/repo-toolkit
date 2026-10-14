const DEFAULT_GITHUB_API_URL = 'https://api.github.com';

function parseApiBase(value: unknown): URL {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('githubApiUrl must be a non-empty URL');
  }
  if (/[\s\\\p{Cc}\p{Cs}]/u.test(value)) {
    throw new Error('githubApiUrl must not contain whitespace, control characters, or backslashes');
  }
  if (value.includes('?') || value.includes('#')) {
    throw new Error('githubApiUrl must not contain a query or fragment');
  }
  const parts = /^[a-z][a-z0-9+.-]*:\/\/([^/]*)(\/.*)?$/i.exec(value);
  if (parts === null) {
    throw new Error('githubApiUrl is not a valid absolute URL');
  }
  if (parts[1].includes('@')) {
    throw new Error('githubApiUrl must not contain credentials or userinfo');
  }
  for (const part of (parts[2] ?? '').replace(/\/+$/, '').split('/').slice(1)) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      throw new Error('githubApiUrl contains an invalid encoded path');
    }
    if (decoded.length === 0 || decoded === '.' || decoded === '..' || /[\s/\\%?#\p{Cc}\p{Cs}]/u.test(decoded)) {
      throw new Error('githubApiUrl must use an unambiguous base path without routing or dot segments');
    }
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('githubApiUrl is not a valid URL');
  }
  const loopback =
    url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('githubApiUrl must use HTTPS, except HTTP on numeric loopback addresses or localhost');
  }
  return url;
}

export function resolveGitHubApiUrl(value: unknown): string {
  const resolved = value === undefined ? process.env.GITHUB_API_URL || DEFAULT_GITHUB_API_URL : value;
  parseApiBase(resolved);
  return resolved as string;
}

export function assertGitHubRequestUrl(value: string): void {
  if (typeof value !== 'string' || /[\s\\#\p{Cc}\p{Cs}]/u.test(value)) {
    throw new Error('GitHub API request URL must not contain whitespace, backslashes, or fragments');
  }
  const authority = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(value)?.[1];
  if (authority === undefined || authority.includes('@')) {
    throw new Error('GitHub API request URL must be absolute and must not contain userinfo');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('GitHub API request URL is invalid');
  }
  parseApiBase(url.origin);
}

export function buildGitHubApiUrl(
  base: string,
  segments: ReadonlyArray<string>,
  query?: Readonly<Record<string, string>>,
): string {
  const url = parseApiBase(base);
  const path = segments
    .map((segment) => {
      if (
        typeof segment !== 'string' ||
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        /[/\\\p{Cc}\p{Cs}]/u.test(segment)
      ) {
        throw new Error('GitHub API path must contain valid individual path segments');
      }
      return encodeURIComponent(segment);
    })
    .join('/');
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path}`;
  if (query !== undefined) {
    url.search = new URLSearchParams(query).toString();
  }
  return url.toString();
}
