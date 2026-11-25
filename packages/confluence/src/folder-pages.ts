import { ConfluenceApiError, type ConfluenceGateway, type Page } from './confluence-client';
import { shortHashString } from './content-hash';

interface FolderPageOptions {
  client: Pick<ConfluenceGateway, 'getPagesByTitle' | 'createPage'>;
  spaceId: string;
  parentId: string;
  title: string;
  relativePath: string;
}

interface TitleMatches {
  title: string;
  pages: ReadonlyArray<Page>;
}

export function pathQualifiedFolderTitle(title: string, relativePath: string): string {
  const path = relativePath.includes('/') ? relativePath : `./${relativePath}`;
  return `${title} (${path})`;
}

export async function findOrCreateDisambiguatedFolderPage(options: FolderPageOptions): Promise<Page> {
  const { client, spaceId, parentId, title, relativePath } = options;
  const qualified = pathQualifiedFolderTitle(title, relativePath);
  const scoped = `${qualified} [${shortHashString(JSON.stringify([parentId, relativePath]))}]`;
  const candidates = [title, qualified, scoped];
  const lookup = async (name: string): Promise<TitleMatches> => ({
    title: name,
    pages: await client.getPagesByTitle(spaceId, name),
  });

  const results = await Promise.all(candidates.map(lookup));
  const existing = uniqueFolderMatch(results, relativePath, parentId);
  if (existing) {
    return existing;
  }

  let lastConflict: ConfluenceApiError | undefined;
  for (const result of results) {
    if (result.pages.length !== 0) {
      continue;
    }
    try {
      return await client.createPage({
        spaceId,
        parentId,
        title: result.title,
        body: { representation: 'storage', value: '' },
      });
    } catch (error) {
      if (!isDuplicateTitleError(error)) {
        throw error;
      }
      const justCreated = uniqueFolderMatch([await lookup(result.title)], relativePath, parentId);
      if (justCreated) {
        return justCreated;
      }
      lastConflict = error;
    }
  }

  const attempted = candidates.map((candidate) => JSON.stringify(candidate)).join(', ');
  const detail = lastConflict ? `: ${lastConflict.message}` : '';
  throw new Error(
    `No available Confluence page title for folder "${relativePath}" under parent ${parentId} (tried ${attempted})${detail}`,
  );
}

function uniqueFolderMatch(
  results: ReadonlyArray<TitleMatches>,
  relativePath: string,
  parentId: string,
): Page | undefined {
  const matches = new Map<string, Page>();
  for (const { title, pages } of results) {
    for (const page of pages) {
      if (page.parentId === parentId && page.title === title) {
        matches.set(page.id, page);
      }
    }
  }
  if (matches.size > 1) {
    const conflicting = [...matches.values()].map((page) => `"${page.title}" (page ${page.id})`).join(', ');
    throw new Error(`Ambiguous Confluence folder "${relativePath}" under parent ${parentId}: ${conflicting}`);
  }
  return matches.values().next().value;
}

function isDuplicateTitleError(error: unknown): error is ConfluenceApiError {
  return (
    error instanceof ConfluenceApiError &&
    (error.status === 400 || error.status === 409) &&
    /page (?:with this title already exists|already exists with the same title)/i.test(error.responseBody)
  );
}
