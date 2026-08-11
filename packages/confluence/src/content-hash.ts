import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const SHORT_HASH_LENGTH = 16;

export function shortHashBytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, SHORT_HASH_LENGTH);
}

export function shortHashString(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, SHORT_HASH_LENGTH);
}

export function shortHashFile(absPath: string): string {
  const buf = readFileSync(absPath);
  return shortHashBytes(buf);
}

export interface StableNameParts {
  stem: string;
  ext: string;
  base: string;
  filename: string;
}

function splitStemAndExt(basename: string): { stem: string; ext: string } {
  const dot = basename.lastIndexOf('.');
  if (dot <= 0 || dot === basename.length - 1) {
    return { stem: basename, ext: '' };
  }
  return { stem: basename.slice(0, dot), ext: basename.slice(dot + 1) };
}

export function buildStableName(originalBasename: string, hash: string): string {
  const { stem, ext } = splitStemAndExt(originalBasename);
  const safeStem = sanitizeNameSegment(stem);
  const safeExt = ext ? '.' + sanitizeNameSegment(ext) : '';
  return `${safeStem}-${hash}${safeExt}`;
}

function sanitizeNameSegment(segment: string): string {
  return segment.replace(/[/\\]/g, '_');
}
