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
