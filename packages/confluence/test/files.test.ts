import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readDocTree, isMarkdownName, titleFromSegment } from '../src/files';

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
