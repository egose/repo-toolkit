import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readDocTree,
  isMarkdownName,
  titleFromSegment,
  resolvePageTitleStrategy,
  pageTitleFromSegments,
  PAGE_TITLE_STRATEGIES,
  DEFAULT_PAGE_TITLE_STRATEGY,
  type PageTitleStrategy,
} from '../src/files';

describe('isMarkdownName / titleFromSegment', () => {
  it('recognizes markdown files (case-insensitive)', () => {
    expect(isMarkdownName('a.md')).toBe(true);
    expect(isMarkdownName('B.MD')).toBe(true);
    expect(isMarkdownName('note.markdown')).toBe(false);
    expect(isMarkdownName('readme.txt')).toBe(false);
    expect(isMarkdownName('.md')).toBe(false);
  });

  it('strips the trailing .md only', () => {
    expect(titleFromSegment('intro.md')).toBe('intro');
    expect(titleFromSegment('a.b.md')).toBe('a.b');
    expect(titleFromSegment('noext')).toBe('noext');
  });
});

describe('pageTitleFromSegments', () => {
  const SEGMENTS = ['community-nodes', 'cdogs-document-generator', 'credentials.md'];

  it('matches the naming contract table for all five strategies', () => {
    expect(pageTitleFromSegments(SEGMENTS, 'filename-stem')).toBe('credentials');
    expect(pageTitleFromSegments(SEGMENTS, 'filename')).toBe('credentials.md');
    expect(pageTitleFromSegments(SEGMENTS, 'sentence-case-parent')).toBe('Credentials (cdogs-document-generator)');
    expect(pageTitleFromSegments(SEGMENTS, 'sentence-case-parents')).toBe(
      'Credentials (community-nodes/cdogs-document-generator)',
    );
    expect(pageTitleFromSegments(SEGMENTS, 'sentence-case-path')).toBe(
      'Credentials (community-nodes/cdogs-document-generator/credentials.md)',
    );
  });

  it('handles root files for all five strategies', () => {
    const root: [PageTitleStrategy, string][] = [
      ['filename-stem', 'overview'],
      ['filename', 'overview.md'],
      ['sentence-case-parent', 'Overview'],
      ['sentence-case-parents', 'Overview'],
      ['sentence-case-path', 'Overview (overview.md)'],
    ];
    for (const [strategy, expected] of root) {
      expect(pageTitleFromSegments(['overview.md'], strategy)).toBe(expected);
    }
  });

  it('keeps dots in the stem for filename-stem', () => {
    expect(pageTitleFromSegments(['release.notes.1.2.md'], 'filename-stem')).toBe('release.notes.1.2');
  });

  it('collapses repeated hyphens and underscores', () => {
    expect(pageTitleFromSegments(['failed--deployment__notes.md'], 'sentence-case-parent')).toBe(
      'Failed deployment notes',
    );
    expect(pageTitleFromSegments(['dir', 'failed-deployment.md'], 'sentence-case-parent')).toBe(
      'Failed deployment (dir)',
    );
    expect(pageTitleFromSegments(['n8n_setup.md'], 'sentence-case-parent')).toBe('N8n setup');
    expect(pageTitleFromSegments(['README.md'], 'sentence-case-parent')).toBe('Readme');
  });

  it('preserves digits in sentence-cased titles', () => {
    expect(pageTitleFromSegments(['guide', '1password--2fa.md'], 'sentence-case-parent')).toBe('1Password 2fa (guide)');
  });

  it('preserves original filename and extension casing for filename and sentence-case-path', () => {
    expect(pageTitleFromSegments(['docs', 'Guide.MD'], 'filename')).toBe('Guide.MD');
    expect(pageTitleFromSegments(['docs', 'Guide.MD'], 'sentence-case-path')).toBe('Guide (docs/Guide.MD)');
    expect(pageTitleFromSegments(['Guide.MD'], 'sentence-case-parent')).toBe('Guide');
  });

  it('removes a trailing .md case-insensitively when sentence-casing', () => {
    expect(pageTitleFromSegments(['Notes.MD'], 'sentence-case-parent')).toBe('Notes');
  });

  it('filename-stem matches titleFromSegment for existing fixture cases', () => {
    for (const segment of ['intro.md', 'a.b.md', 'noext', 'Guide.MD']) {
      expect(pageTitleFromSegments(['x', 'y', segment], 'filename-stem')).toBe(titleFromSegment(segment));
      expect(pageTitleFromSegments([segment], 'filename-stem')).toBe(titleFromSegment(segment));
    }
  });
});

describe('resolvePageTitleStrategy', () => {
  it('defaults to filename-stem for undefined/null', () => {
    expect(DEFAULT_PAGE_TITLE_STRATEGY).toBe('filename-stem');
    expect(resolvePageTitleStrategy(undefined)).toBe('filename-stem');
    expect(resolvePageTitleStrategy(null)).toBe('filename-stem');
  });

  it('accepts all five documented values', () => {
    for (const value of PAGE_TITLE_STRATEGIES) {
      expect(resolvePageTitleStrategy(value)).toBe(value);
    }
  });

  it('rejects unknown, empty, and non-string values with a pageTitleStrategy error', () => {
    const badValues: unknown[] = ['bogus', '', '  filename-stem  ', 42, {}, [], true];
    for (const value of badValues) {
      expect(() => resolvePageTitleStrategy(value)).toThrowError(/pageTitleStrategy/);
    }
  });

  it('lists all five accepted values in the error message', () => {
    let message = '';
    try {
      resolvePageTitleStrategy('bogus');
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    for (const value of PAGE_TITLE_STRATEGIES) {
      expect(message).toContain(value);
    }
  });
});

describe('readDocTree', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'rt-files-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('walks recursively and returns only markdown files', async () => {
    await writeFile(join(tmp, 'root.md'), '# Root');
    await mkdir(join(tmp, 'guide'));
    await writeFile(join(tmp, 'guide', 'intro.md'), '# Intro');
    await writeFile(join(tmp, 'guide', 'image.png'), 'binary');
    await mkdir(join(tmp, 'guide', 'nested'));
    await writeFile(join(tmp, 'guide', 'nested', 'deep.md'), '# Deep');

    const tree = await readDocTree(tmp);
    const joined = tree.entries.map((e) => e.segments.join('/')).sort();
    expect(joined).toEqual(['guide/intro.md', 'guide/nested/deep.md', 'root.md']);
  });

  it('skips dotfile directories', async () => {
    await mkdir(join(tmp, '.github'));
    await writeFile(join(tmp, '.github', 'workflow.md'), '# w');
    await writeFile(join(tmp, 'a.md'), '# A');
    const tree = await readDocTree(tmp);
    expect(tree.entries.map((e) => e.segments.join('/'))).toEqual(['a.md']);
  });

  it('returns an empty entries array when only non-md files exist', async () => {
    await writeFile(join(tmp, 'a.txt'), 'x');
    await writeFile(join(tmp, 'b.png'), 'y');
    const tree = await readDocTree(tmp);
    expect(tree.entries).toEqual([]);
  });

  it('throws when the root does not exist or is a file', async () => {
    await expect(readDocTree(join(tmp, 'nope'))).rejects.toThrowError();
    await writeFile(join(tmp, 'file.md'), '# x');
    await expect(readDocTree(join(tmp, 'file.md'))).rejects.toThrowError(/Not a directory/);
  });
});
