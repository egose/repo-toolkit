import {
  mkdir as fsMkdir,
  writeFile as fsWriteFile,
  copyFile as fsCopyFile,
  access as fsAccess,
  lstat as fsLstat,
  realpath as fsRealpath,
  rm as fsRm,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';

export interface FsStat {
  isSymbolicLink(): boolean;
}

export interface SandboxFs {
  readonly mkdir: (path: string, opts: { recursive: boolean }) => Promise<void>;
  readonly writeFile: (path: string, data: string, encoding: string) => Promise<void>;
  readonly copyFile: (src: string, dst: string) => Promise<void>;
  readonly access: (path: string) => Promise<void>;
  readonly lstat: (path: string) => Promise<FsStat>;
  readonly realpath: (path: string) => Promise<string>;
  readonly rm: (path: string, opts: { recursive: boolean; force: boolean }) => Promise<void>;
}

export type PrepareFs = Pick<SandboxFs, 'mkdir' | 'copyFile' | 'access' | 'lstat' | 'realpath'>;
export type EvidenceFs = Pick<SandboxFs, 'mkdir' | 'writeFile' | 'lstat' | 'realpath'>;
export type CleanupFs = Pick<SandboxFs, 'lstat' | 'realpath' | 'rm'>;
export type ManifestFs = Pick<SandboxFs, 'mkdir' | 'writeFile' | 'lstat' | 'realpath'>;

export function isEnoent(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

export function createDefaultFs(): SandboxFs {
  return {
    mkdir: (path, opts) => fsMkdir(path, opts) as Promise<void>,
    writeFile: (path, data, encoding) =>
      fsWriteFile(path, data, encoding as unknown as BufferEncoding) as Promise<void>,
    copyFile: fsCopyFile as SandboxFs['copyFile'],
    access: fsAccess as SandboxFs['access'],
    lstat: fsLstat as SandboxFs['lstat'],
    realpath: fsRealpath as SandboxFs['realpath'],
    rm: (path, opts) => fsRm(path, opts) as Promise<void>,
  };
}

export async function resolveRealRoot(cwd: string, fs: Pick<SandboxFs, 'realpath'>): Promise<string> {
  return fs.realpath(cwd);
}

/**
 * Validate that `target` remains inside `realRoot` after resolving existing ancestors.
 *
 * Walks existing ancestors via `lstat`. On ENOENT climbs to parent until an existing
 * component is found. Any other metadata error (EACCES, EIO, etc.) fails closed.
 * Once the nearest existing ancestor is found, its `realpath` is resolved and checked
 * to be inside `realRoot`. The effective target (real ancestor + non-existing suffix)
 * is also checked.
 *
 * Lexical plan validation rejects `..` etc., but this runtime check handles symlink
 * ancestors that redirect outside the project.
 *
 * Residual TOCTOU risk: the check and the subsequent mkdir/write/copy/rm are not
 * atomic. An attacker with concurrent write access could replace a directory with a
 * symlink between the check and the use. Mitigation would require platform-specific
 * directory-handle operations (e.g., openat with O_NOFOLLOW). The current
 * check-then-use is the best portable option and fails closed on unverifiable
 * metadata.
 */
export async function ensurePathInsideRoot(
  target: string,
  realRoot: string,
  fs: Pick<SandboxFs, 'lstat' | 'realpath'>,
): Promise<void> {
  let cur = target;
  let nearest: string | undefined;
  while (true) {
    try {
      await fs.lstat(cur);
      nearest = cur;
      break;
    } catch (err) {
      if (isEnoent(err)) {
        const parent = dirname(cur);
        if (parent === cur) {
          // eslint-disable-next-line preserve-caught-error
          throw new Error(`path outside project: no existing ancestor for ${target}`);
        }
        cur = parent;
        continue;
      }
      throw err;
    }
  }
  if (nearest === undefined) {
    throw new Error(`unable to resolve ancestor for ${target}`);
  }
  const realNearest = await fs.realpath(nearest);
  const relNearest = relative(realRoot, realNearest);
  if (relNearest.startsWith('..') || isAbsolute(relNearest)) {
    throw new Error(`path escapes project root: ${target} resolves to ${realNearest} outside ${realRoot}`);
  }
  const suffix = relative(nearest, target);
  if (suffix.startsWith('..') || isAbsolute(suffix)) {
    throw new Error(`path escapes project root: ${target}`);
  }
  const effective = suffix ? join(realNearest, suffix) : realNearest;
  const relEffective = relative(realRoot, effective);
  if (relEffective.startsWith('..') || isAbsolute(relEffective)) {
    throw new Error(`path escapes project root: ${target} effective ${effective} outside ${realRoot}`);
  }
}
