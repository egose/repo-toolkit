import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep, normalize } from 'node:path';

const MARKDOWN_EXT = '.md';
const MAX_DEPTH = 32;

export interface DocEntry {
  /** Path segments relative to the root, e.g. ['guide', 'intro.md']. Always uses `/` separators. */
  segments: string[];
  /** Absolute path to the file on disk. */
  absolute: string;
}

export interface DocTree {
  entries: DocEntry[];
}

export async function readDocTree(root: string, depth = 0): Promise<DocTree> {
  const normalizedRoot = normalize(root);
  const info = await stat(normalizedRoot);
  if (!info.isDirectory()) {
    throw new Error(`Not a directory: ${normalizedRoot}`);
  }
  if (depth > MAX_DEPTH) {
    throw new Error(`Max directory depth exceeded under ${normalizedRoot}`);
  }

  const entries: DocEntry[] = [];
  await walk(normalizedRoot, normalizedRoot, entries, depth);
  entries.sort((a, b) => a.segments.join('/').localeCompare(b.segments.join('/')));
  return { entries };
}

async function walk(dir: string, root: string, out: DocEntry[], depth: number): Promise<void> {
  if (depth > MAX_DEPTH) {
    throw new Error(`Max directory depth exceeded under ${root}`);
  }
  const names = await readdir(dir, { withFileTypes: true });
  for (const entry of names) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, root, out, depth + 1);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(MARKDOWN_EXT)) {
      const rel = relative(root, full).split(sep).join('/');
      out.push({ segments: rel.split('/'), absolute: full });
    }
  }
}

export function isMarkdownName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.length > MARKDOWN_EXT.length && lower.endsWith(MARKDOWN_EXT);
}

export function titleFromSegment(segment: string): string {
  const dot = segment.lastIndexOf('.');
  if (dot > 0) {
    return segment.slice(0, dot);
  }
  return segment;
}

export const PAGE_TITLE_STRATEGIES = [
  'filename-stem',
  'filename',
  'sentence-case-parent',
  'sentence-case-parents',
  'sentence-case-path',
] as const;

export type PageTitleStrategy = (typeof PAGE_TITLE_STRATEGIES)[number];

export const DEFAULT_PAGE_TITLE_STRATEGY: PageTitleStrategy = 'filename-stem';

export function resolvePageTitleStrategy(value: unknown): PageTitleStrategy {
  if (value === undefined || value === null) {
    return DEFAULT_PAGE_TITLE_STRATEGY;
  }
  if (typeof value === 'string' && (PAGE_TITLE_STRATEGIES as readonly string[]).includes(value)) {
    return value as PageTitleStrategy;
  }
  throw new Error(
    `Invalid pageTitleStrategy: expected one of ${PAGE_TITLE_STRATEGIES.join(', ')}, got ${JSON.stringify(value)}`,
  );
}

function sentenceCaseStem(filename: string): string {
  let stem = filename;
  if (/\.md$/i.test(stem)) {
    stem = stem.slice(0, stem.length - MARKDOWN_EXT.length);
  }
  let out = stem
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/[A-Z]/g, (c) => c.toLowerCase());
  const firstLetter = /[a-z]/.exec(out);
  if (firstLetter) {
    const i = firstLetter.index;
    out = out.slice(0, i) + out.charAt(i).toUpperCase() + out.slice(i + 1);
  }
  return out;
}

export function pageTitleFromSegments(segments: readonly string[], strategy: PageTitleStrategy): string {
  const filename = segments.length > 0 ? segments[segments.length - 1] : '';
  const parents = segments.slice(0, segments.length - 1);
  switch (strategy) {
    case 'filename-stem':
      return titleFromSegment(filename);
    case 'filename':
      return filename;
    case 'sentence-case-parent': {
      const title = sentenceCaseStem(filename);
      if (parents.length === 0) {
        return title;
      }
      return `${title} (${parents[parents.length - 1]})`;
    }
    case 'sentence-case-parents': {
      const title = sentenceCaseStem(filename);
      if (parents.length === 0) {
        return title;
      }
      return `${title} (${parents.join('/')})`;
    }
    case 'sentence-case-path':
      return `${sentenceCaseStem(filename)} (${[...parents, filename].join('/')})`;
  }
}
