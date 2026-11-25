import { describe, expect, it, vi } from 'vitest';

import { ConfluenceApiError, type CreatePageInput, type Page } from '../src/confluence-client';
import { findOrCreateDisambiguatedFolderPage, pathQualifiedFolderTitle } from '../src/folder-pages';

const parentId = 'integrations-id';
const relativePath = 'integrations/chefs';
const defaultTitle = 'chefs';
const qualifiedTitle = 'chefs (integrations/chefs)';

function page(id: string, title: string, parentId: string): Page {
  return { id, title, parentId, status: 'current', spaceId: 'space', version: { number: 1 }, _links: { webui: '' } };
}

function setup(initialPages: Page[] = []) {
  const pages = [...initialPages];
  const client = {
    getPagesByTitle: vi.fn(async (_spaceId: string, title: string) => pages.filter((candidate) => candidate.title === title)),
    createPage: vi.fn(async (input: CreatePageInput) => {
      const created = page(`created-${pages.length}`, input.title, input.parentId ?? '');
      pages.push(created);
      return created;
    }),
  };
  return {
    client,
    pages,
    resolve: () => findOrCreateDisambiguatedFolderPage({ client, spaceId: 'space', parentId, relativePath, title: defaultTitle }),
  };
}

function duplicateTitle() {
  return new ConfluenceApiError('Client error (400)', 400, '/wiki/api/v2/pages', JSON.stringify({
    errors: [{ title: 'A page with this title already exists: A page already exists with the same TITLE in this space' }],
  }));
}

describe('folder title disambiguation', () => {
  it('uses a path separator even for a root-level fallback so it is not a possible raw directory name', () => {
    expect(pathQualifiedFolderTitle('guide', 'guide')).toBe('guide (./guide)');
  });

  it('uses a path-qualified title if the short title is not visible in lookup but Confluence rejects it', async () => {
    const { client, resolve } = setup();
    client.createPage.mockRejectedValueOnce(duplicateTitle());

    expect(await resolve()).toMatchObject({ title: qualifiedTitle, parentId });
    expect(client.createPage.mock.calls.map(([input]) => input.title)).toEqual([defaultTitle, qualifiedTitle]);
    expect(client.getPagesByTitle.mock.calls.filter(([, title]) => title === defaultTitle)).toHaveLength(2);
  });

  it('rechecks the attempted title after a duplicate response and reuses a newly visible page under the expected parent', async () => {
    const { client, pages, resolve } = setup();
    const existing = page('winner', defaultTitle, parentId);
    client.createPage.mockImplementationOnce(async () => {
      pages.push(existing);
      throw duplicateTitle();
    });

    expect(await resolve()).toEqual(existing);
    expect(client.createPage).toHaveBeenCalledTimes(1);
  });

  it('uses a stable parent-scoped title if the unqualified and path-qualified titles are both taken elsewhere', async () => {
    const { client, pages, resolve } = setup([
      page('one', defaultTitle, 'community-nodes-id'),
      page('two', qualifiedTitle, 'another-root'),
    ]);
    const scoped = await resolve();
    expect(scoped.title).toMatch(/^chefs \(integrations\/chefs\) \[[a-f0-9]{16}\]$/);
    expect(scoped.parentId).toBe(parentId);
    expect(client.createPage).toHaveBeenCalledTimes(1);

    pages.splice(0, 2);
    expect(await resolve()).toEqual(scoped);
    expect(client.createPage).toHaveBeenCalledTimes(1);
  });

  it('does not silently choose a new identity if different candidate titles already exist under the intended parent', async () => {
    const { client, resolve } = setup([
      page('one', defaultTitle, parentId),
      page('two', qualifiedTitle, parentId),
    ]);

    await expect(resolve()).rejects.toThrow(/Ambiguous Confluence folder "integrations\/chefs" under parent integrations-id/);
    expect(client.createPage).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'Invalid request body'],
    [403, 'A page with this title already exists'],
    [409, 'Version conflict'],
    [500, 'Internal server error'],
  ])('does not retry page creation on status %i with an unrelated error', async (status, message) => {
    const { client, resolve } = setup();
    const error = new ConfluenceApiError('Create error', status, '/wiki/api/v2/pages', message);
    client.createPage.mockRejectedValueOnce(error);

    await expect(resolve()).rejects.toBe(error);
    expect(client.createPage).toHaveBeenCalledTimes(1);
  });

  it('bounds alternative create attempts and identifies the folder when all titles are rejected', async () => {
    const { client, resolve } = setup();
    client.createPage.mockRejectedValue(duplicateTitle());

    await expect(resolve()).rejects.toThrow(/No available Confluence page title for folder "integrations\/chefs" under parent integrations-id/);
    expect(client.createPage).toHaveBeenCalledTimes(3);
    expect(new Set(client.createPage.mock.calls.map(([input]) => input.title)).size).toBe(3);
  });
});
