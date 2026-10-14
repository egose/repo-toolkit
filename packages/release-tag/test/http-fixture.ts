import { RELEASED_HEAD, SOURCE_COMMIT } from './release-fixture';

export function makeResponse(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response([204, 205, 304].includes(status) ? null : text, { status });
}

export interface PullRequestFixtureOptions {
  number?: number;
  repository?: string;
  repositoryId?: number;
  head?: string;
  base?: string;
  sha?: string;
  url?: string;
  merged?: boolean;
  state?: 'open' | 'closed';
}

export function pullRequestListData(options: PullRequestFixtureOptions = {}) {
  const repository = options.repository ?? 'octo/hello';
  const [owner, name] = repository.split('/');
  const repo = { id: options.repositoryId ?? 123, name, full_name: repository, owner: { login: owner }, fork: false };
  const number = options.number ?? 42;
  const head = options.head ?? 'changelog/1.2.3';
  const base = options.base ?? 'main';
  return {
    number,
    html_url: options.url ?? `https://github.com/${repository}/pull/${number}`,
    state: options.state ?? (options.merged ? 'closed' : 'open'),
    merged_at: options.merged ? '2026-10-12T18:00:00Z' : null,
    head: { label: `${owner}:${head}`, ref: head, sha: options.sha ?? RELEASED_HEAD, user: { login: owner }, repo },
    base: {
      label: `${owner}:${base}`,
      ref: base,
      sha: SOURCE_COMMIT,
      user: { login: owner },
      repo: { ...repo, owner: { ...repo.owner } },
    },
  };
}

export function pullRequestData(options: PullRequestFixtureOptions = {}) {
  return { ...pullRequestListData(options), merged: options.merged ?? false };
}

export function branchRefData(options: PullRequestFixtureOptions = {}) {
  return {
    ref: `refs/heads/${options.head ?? 'changelog/1.2.3'}`,
    object: { type: 'commit', sha: options.sha ?? RELEASED_HEAD },
  };
}

export function successfulGitHubResponse(
  input: string | URL | Request,
  init?: RequestInit,
  options: PullRequestFixtureOptions = {},
): Response {
  const url = new URL(String(input));
  const method = init?.method ?? 'GET';
  const repository = options.repository ?? 'octo/hello';
  const path = url.pathname;
  if (method === 'GET' && path.endsWith(`/repos/${repository}`)) {
    return makeResponse(200, { permissions: { push: true } });
  }
  if (method === 'HEAD' && path.endsWith('/installation/repositories')) {
    return makeResponse(200, '');
  }
  if (path.endsWith('/pulls')) {
    if (method === 'GET') {
      return makeResponse(200, []);
    }
    if (method === 'POST') {
      return makeResponse(201, pullRequestData(options));
    }
  }
  if (['GET', 'PATCH'].includes(method) && path.endsWith(`/pulls/${options.number ?? 42}`)) {
    return makeResponse(200, pullRequestData(options));
  }
  if (method === 'POST' && path.endsWith('/labels')) {
    return makeResponse(200, []);
  }
  if (method === 'PUT' && path.endsWith('/merge')) {
    return makeResponse(200, { merged: true, sha: 'c'.repeat(40), message: 'Pull Request successfully merged' });
  }
  if (method === 'GET' && path.includes('/git/ref/heads/')) {
    return makeResponse(200, branchRefData(options));
  }
  if (method === 'DELETE' && path.includes('/git/refs/heads/')) {
    return makeResponse(204, '');
  }
  throw new Error(`Unexpected GitHub fixture request: ${method} ${path}`);
}
