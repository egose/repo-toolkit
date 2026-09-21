import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import picomatch from 'picomatch';

import { MAX_SCAN_RECORDS, normalizeProjectRelPath } from './config';

export const SECRET_SYNC_STATE_DIR = '.repo-toolkit-secret-sync';
export const ALWAYS_EXCLUDED_DIRS = ['.git', SECRET_SYNC_STATE_DIR];

export interface SelectionMatcherOptions {
  files: string[];
  ignore: string[];
  extraExcludes?: string[];
}

export function toSlashPath(value: string): string {
  return value.split('\\').join('/');
}

export function isAlwaysExcluded(relPath: string): boolean {
  const slashed = toSlashPath(relPath);
  for (const dir of ALWAYS_EXCLUDED_DIRS) {
    if (slashed === dir || slashed.startsWith(dir + '/')) {
      return true;
    }
  }
  return false;
}

function compileMatchers(patterns: string[]): Array<(value: string) => boolean> {
  return patterns.map((pattern) => picomatch(pattern, { dot: true, nocase: false }));
}

export function matchesFilesSelection(relPath: string, files: string[]): boolean {
  const slashed = toSlashPath(relPath);
  for (const matches of compileMatchers(files)) {
    if (matches(slashed)) {
      return true;
    }
  }
  return false;
}

export function matchesExclusion(relPath: string, ignore: string[], extraExcludes: string[] = []): boolean {
  const slashed = toSlashPath(relPath);
  if (isAlwaysExcluded(slashed)) {
    return true;
  }
  for (const exact of extraExcludes) {
    if (slashed === toSlashPath(exact)) {
      return true;
    }
  }
  for (const matches of compileMatchers(ignore)) {
    if (matches(slashed)) {
      return true;
    }
  }
  return false;
}

export function createSelectionMatcher(options: SelectionMatcherOptions): (relPath: string) => boolean {
  const extra = options.extraExcludes ?? [];
  return (relPath: string): boolean => {
    const slashed = toSlashPath(relPath);
    if (!matchesFilesSelection(slashed, options.files)) {
      return false;
    }
    if (matchesExclusion(slashed, options.ignore, extra)) {
      return false;
    }
    return true;
  };
}

function compileDirPruneMatchers(ignore: string[]): Array<(value: string) => boolean> {
  const prunable = ignore.filter((pattern) => pattern === '**' || pattern.endsWith('/**'));
  return compileMatchers(prunable);
}

function isPrunedDir(relPath: string, prune: ReadonlyArray<(value: string) => boolean>): boolean {
  const slashed = toSlashPath(relPath);
  for (const matches of prune) {
    if (matches(slashed)) {
      return true;
    }
  }
  return false;
}

export interface DiscoveryOptions {
  root: string;
  files: string[];
  ignore: string[];
  configRelPath?: string;
  maxRecords?: number;
}

export interface DiscoveryResult {
  paths: string[];
  skippedSymlinks: string[];
  skippedSpecial: string[];
  scanned: number;
}

export async function discoverLocalFiles(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const maxRecords = options.maxRecords ?? MAX_SCAN_RECORDS;
  const extra = options.configRelPath ? [options.configRelPath] : [];
  const matches = createSelectionMatcher({ files: options.files, ignore: options.ignore, extraExcludes: extra });
  const prune = compileDirPruneMatchers(options.ignore);
  const paths: string[] = [];
  const skippedSymlinks: string[] = [];
  const skippedSpecial: string[] = [];
  let scanned = 0;

  const pending: string[] = [''];
  while (pending.length > 0) {
    const dirRel = pending.pop() as string;
    const dirAbsolute = dirRel === '' ? options.root : join(options.root, ...dirRel.split('/'));
    let entries;
    try {
      entries = await readdir(dirAbsolute, { withFileTypes: true });
    } catch (error) {
      const wrapped = new Error(
        `Cannot read directory ${JSON.stringify(dirRel === '' ? '.' : dirRel)} under the sync root.`,
      ) as Error & { cause?: unknown };
      wrapped.cause = error;
      throw wrapped;
    }
    const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of sorted) {
      const rel = dirRel === '' ? entry.name : `${dirRel}/${entry.name}`;
      scanned += 1;
      if (scanned > maxRecords) {
        throw new Error(`Refusing to scan more than ${maxRecords} directory records under the sync root.`);
      }
      if (entry.isSymbolicLink()) {
        skippedSymlinks.push(rel);
        continue;
      }
      if (entry.isDirectory()) {
        if (!isAlwaysExcluded(rel) && !isPrunedDir(rel, prune)) {
          pending.push(rel);
        }
        continue;
      }
      if (!entry.isFile()) {
        skippedSpecial.push(rel);
        continue;
      }
      if (matches(rel)) {
        paths.push(rel);
      }
    }
  }

  paths.sort();
  skippedSymlinks.sort();
  skippedSpecial.sort();
  return { paths, skippedSymlinks, skippedSpecial, scanned };
}

export interface ExactSelectionOptions {
  root: string;
  files: string[];
  ignore: string[];
  configRelPath?: string;
}

export async function selectExactFiles(
  requested: ReadonlyArray<string>,
  options: ExactSelectionOptions,
): Promise<string[]> {
  const extra = options.configRelPath ? [options.configRelPath] : [];
  const selected: string[] = [];
  for (const raw of requested) {
    const rel = normalizeProjectRelPath(raw, '--file');
    if (!matchesFilesSelection(rel, options.files)) {
      throw new Error(`--file ${JSON.stringify(raw)} is outside the configured files selection.`);
    }
    if (matchesExclusion(rel, options.ignore, extra)) {
      throw new Error(`--file ${JSON.stringify(raw)} is excluded; --file never overrides excludes.`);
    }
    let stats;
    try {
      stats = await lstat(join(options.root, ...rel.split('/')));
    } catch {
      selected.push(rel);
      continue;
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`--file ${JSON.stringify(raw)} is a symlink; symlinks are never followed.`);
    }
    selected.push(rel);
  }
  return selected;
}
