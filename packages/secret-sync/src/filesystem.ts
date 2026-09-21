import { createHmac } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

import { MAX_FILE_BYTES_HARD_CEILING, normalizeProjectRelPath } from './config';
import { SECRET_SYNC_STATE_DIR } from './discovery';
import { SecretSyncError } from './errors';

export const SAFE_WRITE_TEMP_PREFIX = '.tmp-secret-sync-';
export const SAFE_WRITE_FILE_MODE = 0o600;

export const FILESYSTEM_RACE_LIMITS = [
  'Replacement is atomic per file via same-directory rename; there is no multi-file filesystem transaction.',
  'Each write rechecks the destination and its ancestors immediately before rename, but a privileged local actor can still swap a symlink ancestor or the destination between that recheck and rename.',
  'Descriptor-level identity is not retained across rename on this path; callers needing stronger guarantees must hold the local state lock for the whole operation.',
  'Case-insensitive filesystems may treat distinct spellings as one file; writes therefore refuse case collisions before touching the filesystem.',
  'Network filesystems can delay rename visibility; recovery must verify file bytes rather than assuming a rename result.',
  'POSIX modes 0600/0700 are enforced where the platform supports them; Windows ACL behavior is unverified in ordinary CI.',
].join(' ');

export interface SafeWriteHooks {
  beforeRename?: () => void | Promise<void>;
  afterRename?: () => void | Promise<void>;
  beforeTempWrite?: () => void | Promise<void>;
  afterTempWrite?: () => void | Promise<void>;
}

export interface SafeWriteOptions {
  maxFileBytes?: number;
  hooks?: SafeWriteHooks;
}

export interface ReadBoundedOptions {
  maxFileBytes?: number;
}

export interface RemoveGuardOptions {
  expectedHmac?: string;
  expectedByteLength?: number;
  localKey?: string;
}

export type DestinationKind = 'absent' | 'file' | 'directory' | 'symlink' | 'special';

export function resolveSafeDestination(rootAbsolute: string, relPath: string): string {
  const normalized = normalizeProjectRelPath(relPath, 'destination path');
  const first = normalized.split('/')[0] as string;
  if (first === SECRET_SYNC_STATE_DIR) {
    throw new SecretSyncError('unsafe-path', 'Refusing to write inside the protected state directory.');
  }
  const root = resolve(rootAbsolute);
  const absolute = join(root, ...normalized.split('/'));
  const back = relative(root, absolute);
  if (back === '' || back === '..' || back.startsWith(`..${sep}`)) {
    throw new SecretSyncError('unsafe-path', 'Refusing a destination that escapes the sync root.');
  }
  if (isAbsolute(back)) {
    throw new SecretSyncError('unsafe-path', 'Refusing a destination that escapes the sync root.');
  }
  return absolute;
}

export function detectCaseCollision(paths: ReadonlyArray<string>): [string, string] | undefined {
  const seen = new Map<string, string>();
  for (const raw of paths) {
    const normalized = normalizeProjectRelPath(raw, 'destination path');
    const folded = normalized.toLowerCase();
    const previous = seen.get(folded);
    if (previous !== undefined && previous !== normalized) {
      return [previous, normalized];
    }
    if (previous === undefined) {
      seen.set(folded, normalized);
    }
  }
  return undefined;
}

export function assertNoCaseCollision(paths: ReadonlyArray<string>): void {
  const collision = detectCaseCollision(paths);
  if (collision !== undefined) {
    throw new SecretSyncError(
      'unsafe-path',
      `Refusing case-colliding destinations ${JSON.stringify(collision[0])} and ${JSON.stringify(collision[1])}.`,
    );
  }
}

export async function checkDestinationKind(absolutePath: string): Promise<DestinationKind> {
  let stats;
  try {
    stats = await lstat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'absent';
    }
    throw error;
  }
  if (stats.isSymbolicLink()) {
    return 'symlink';
  }
  if (stats.isDirectory()) {
    return 'directory';
  }
  if (stats.isFile()) {
    return 'file';
  }
  return 'special';
}

export async function assertAncestorDirsSafe(rootAbsolute: string, relPath: string): Promise<void> {
  const normalized = normalizeProjectRelPath(relPath, 'destination path');
  const segments = normalized.split('/');
  const root = resolve(rootAbsolute);
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    let stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new SecretSyncError('unsafe-path', 'Refusing a destination below a symlinked ancestor.');
    }
    if (!stats.isDirectory()) {
      throw new SecretSyncError('unsafe-path', 'Refusing a destination whose ancestor is not a directory.');
    }
  }
}

async function assertSiblingCaseFree(absolutePath: string): Promise<void> {
  const parent = dirname(absolutePath);
  const base = absolutePath.split(sep).pop() as string;
  let entries: string[];
  try {
    entries = await readdir(parent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
  const folded = base.toLowerCase();
  for (const entry of entries) {
    if (entry.toLowerCase() === folded && entry !== base) {
      throw new SecretSyncError(
        'unsafe-path',
        `Refusing a destination that collides with existing ${JSON.stringify(entry)} on case-insensitive filesystems.`,
      );
    }
  }
}

function resolveMaxBytes(value: number | undefined): number {
  if (value === undefined) {
    return MAX_FILE_BYTES_HARD_CEILING;
  }
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_FILE_BYTES_HARD_CEILING) {
    throw new SecretSyncError('validation', 'Write bound is out of range.');
  }
  return value;
}

async function fsyncDir(dir: string): Promise<void> {
  try {
    const handle = await open(dir, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    return;
  }
}

async function removeTempQuietly(tempPath: string): Promise<void> {
  try {
    await unlink(tempPath);
  } catch {
    return;
  }
}

export async function assertAbsoluteAncestorDirsSafe(absolutePath: string): Promise<void> {
  const absolute = resolve(absolutePath);
  const root = parse(absolute).root;
  let current = dirname(absolute);
  for (;;) {
    let stats;
    try {
      stats = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    if (stats !== undefined) {
      if (stats.isSymbolicLink()) {
        throw new SecretSyncError('unsafe-path', 'Refusing a destination below a symlinked ancestor.');
      }
      if (!stats.isDirectory()) {
        throw new SecretSyncError('unsafe-path', 'Refusing a destination whose ancestor is not a directory.');
      }
    }
    if (current === root) {
      break;
    }
    current = dirname(current);
  }
}

async function replaceAtomically(
  absolute: string,
  bytes: Uint8Array,
  options: SafeWriteOptions,
  recheck: () => Promise<void>,
): Promise<{ byteLength: number }> {
  await mkdir(dirname(absolute), { recursive: true });
  const tempName = `${SAFE_WRITE_TEMP_PREFIX}${process.pid}-${Date.now()}-${Math.floor(Math.random() * 0xffffffff).toString(16)}.tmp`;
  const tempPath = join(dirname(absolute), tempName);
  if (options.hooks?.beforeTempWrite !== undefined) {
    await options.hooks.beforeTempWrite();
  }
  await writeFile(tempPath, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
    mode: SAFE_WRITE_FILE_MODE,
  });
  await chmod(tempPath, SAFE_WRITE_FILE_MODE);
  const tempHandle = await open(tempPath, 'r');
  try {
    await tempHandle.sync();
  } finally {
    await tempHandle.close();
  }
  if (options.hooks?.afterTempWrite !== undefined) {
    await options.hooks.afterTempWrite();
  }
  if (options.hooks?.beforeRename !== undefined) {
    try {
      await options.hooks.beforeRename();
    } catch (error) {
      await removeTempQuietly(tempPath);
      throw error;
    }
  }
  await recheck();
  const rechecked = await checkDestinationKind(absolute);
  if (rechecked === 'symlink' || rechecked === 'special') {
    await removeTempQuietly(tempPath);
    throw new SecretSyncError('local-changed', 'Destination changed to a symlink or special file before replacement.');
  }
  if (rechecked === 'directory') {
    await removeTempQuietly(tempPath);
    throw new SecretSyncError('local-changed', 'Destination changed to a directory before replacement.');
  }
  try {
    await rename(tempPath, absolute);
  } catch (error) {
    await removeTempQuietly(tempPath);
    throw error;
  }
  if (options.hooks?.afterRename !== undefined) {
    await options.hooks.afterRename();
  }
  await chmod(absolute, SAFE_WRITE_FILE_MODE);
  await fsyncDir(dirname(absolute));
  return { byteLength: bytes.byteLength };
}

export async function writeFileAtomically(
  rootAbsolute: string,
  relPath: string,
  bytes: Uint8Array,
  options: SafeWriteOptions = {},
): Promise<{ byteLength: number }> {
  const maxBytes = resolveMaxBytes(options.maxFileBytes);
  if (!(bytes instanceof Uint8Array)) {
    throw new SecretSyncError('validation', 'Write bytes must be a Uint8Array.');
  }
  if (bytes.byteLength > maxBytes) {
    throw new SecretSyncError('too-large', 'Refusing to write bytes beyond the per-file bound.');
  }
  const absolute = resolveSafeDestination(rootAbsolute, relPath);
  assertNoCaseCollision([relPath]);
  await assertAncestorDirsSafe(rootAbsolute, relPath);
  await assertSiblingCaseFree(absolute);
  const before = await checkDestinationKind(absolute);
  if (before === 'symlink' || before === 'special') {
    throw new SecretSyncError('unsafe-path', 'Refusing to replace a symlink or special file.');
  }
  if (before === 'directory') {
    throw new SecretSyncError('unsafe-path', 'Refusing to replace a directory with a file.');
  }
  return replaceAtomically(absolute, bytes, options, async () => {
    await assertAncestorDirsSafe(rootAbsolute, relPath);
  });
}

export async function writeExportFileAtomically(
  absolutePath: string,
  bytes: Uint8Array,
  options: SafeWriteOptions = {},
): Promise<{ byteLength: number }> {
  const maxBytes = resolveMaxBytes(options.maxFileBytes);
  if (!(bytes instanceof Uint8Array)) {
    throw new SecretSyncError('validation', 'Write bytes must be a Uint8Array.');
  }
  if (bytes.byteLength > maxBytes) {
    throw new SecretSyncError('too-large', 'Refusing to write bytes beyond the per-file bound.');
  }
  if (typeof absolutePath !== 'string' || absolutePath.length === 0 || absolutePath.includes('\0')) {
    throw new SecretSyncError('validation', 'Export path must be a non-empty absolute path.');
  }
  const absolute = resolve(absolutePath);
  if (absolute === parse(absolute).root) {
    throw new SecretSyncError('unsafe-path', 'Refusing to overwrite a filesystem root.');
  }
  await assertAbsoluteAncestorDirsSafe(absolute);
  await assertSiblingCaseFree(absolute);
  const before = await checkDestinationKind(absolute);
  if (before === 'symlink' || before === 'special') {
    throw new SecretSyncError('unsafe-path', 'Refusing to export over a symlink or special file.');
  }
  if (before === 'directory') {
    throw new SecretSyncError('unsafe-path', 'Refusing to export over a directory.');
  }
  return replaceAtomically(absolute, bytes, options, async () => {
    await assertAbsoluteAncestorDirsSafe(absolute);
  });
}

export async function readFileBounded(
  rootAbsolute: string,
  relPath: string,
  options: ReadBoundedOptions = {},
): Promise<Uint8Array | undefined> {
  const maxBytes = resolveMaxBytes(options.maxFileBytes);
  const absolute = resolveSafeDestination(rootAbsolute, relPath);
  await assertAncestorDirsSafe(rootAbsolute, relPath);
  const kind = await checkDestinationKind(absolute);
  if (kind === 'absent') {
    return undefined;
  }
  if (kind === 'symlink' || kind === 'special') {
    throw new SecretSyncError('unsafe-path', 'Refusing to read a symlink or special file.');
  }
  if (kind === 'directory') {
    throw new SecretSyncError('unsafe-path', 'Refusing to read a directory as a file.');
  }
  const data = await readFile(absolute);
  if (data.byteLength > maxBytes) {
    throw new SecretSyncError('too-large', 'Local file exceeds the per-file bound.');
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

export async function removeFileGuarded(
  rootAbsolute: string,
  relPath: string,
  options: RemoveGuardOptions = {},
): Promise<boolean> {
  const absolute = resolveSafeDestination(rootAbsolute, relPath);
  await assertAncestorDirsSafe(rootAbsolute, relPath);
  const kind = await checkDestinationKind(absolute);
  if (kind === 'absent') {
    return false;
  }
  if (kind === 'symlink' || kind === 'special') {
    throw new SecretSyncError('unsafe-path', 'Refusing to remove a symlink or special file.');
  }
  if (kind === 'directory') {
    throw new SecretSyncError('unsafe-path', 'Refusing to remove a directory as a file.');
  }
  if (options.expectedHmac !== undefined || options.expectedByteLength !== undefined) {
    if (
      options.localKey === undefined ||
      options.expectedHmac === undefined ||
      options.expectedByteLength === undefined
    ) {
      throw new SecretSyncError('validation', 'Guarded removal needs a local key with expected hmac and length.');
    }
    const data = await readFile(absolute);
    const actual = createHmac('sha256', Buffer.from(options.localKey, 'hex')).update(data).digest('hex');
    if (actual !== options.expectedHmac || data.byteLength !== options.expectedByteLength) {
      throw new SecretSyncError('local-changed', 'Refusing removal after an unexpected concurrent local edit.');
    }
  }
  await unlink(absolute);
  await fsyncDir(dirname(absolute));
  return true;
}
