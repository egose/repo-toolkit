import { createHash, createHmac } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';

import { MAX_FILE_BYTES_HARD_CEILING, normalizeProjectRelPath } from './config';
import { SECRET_SYNC_STATE_DIR } from './discovery';
import { SecretSyncError } from './errors';

export const SAFE_WRITE_TEMP_PREFIX = '.tmp-secret-sync-';
export const SAFE_WRITE_FILE_MODE = 0o600;

export const FILESYSTEM_RACE_LIMITS = [
  'Replacement is atomic per file via same-directory rename; there is no multi-file filesystem transaction.',
  'Worktree writes recheck expected content or absence and ancestors immediately before rename; export deliberately overwrites regular files.',
  'Restore removals recheck preflight content or absence before unlink or an absent no-op; pull and switch retain keyed removal guards.',
  'This is not filesystem compare-and-swap: another local writer can edit the destination or swap an ancestor between recheck and rename or unlink, or create a file after an absence check.',
  'The local state lock serializes cooperating sync operations, not editors or other local writers.',
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

export type ExpectedDestination = { state: 'absent' } | { state: 'present'; sha256: string; byteLength: number };

export interface WorktreeWriteOptions extends SafeWriteOptions {
  expectedDestination?: ExpectedDestination;
}

export function expectedDestinationFromBytes(bytes: Uint8Array | undefined): ExpectedDestination {
  return bytes === undefined
    ? { state: 'absent' }
    : { state: 'present', sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.byteLength };
}

export interface ReadBoundedOptions {
  maxFileBytes?: number;
}

export interface RemoveGuardOptions {
  expectedDestination?: ExpectedDestination;
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
  expectedDestination?: ExpectedDestination,
): Promise<{ byteLength: number }> {
  await mkdir(dirname(absolute), { recursive: true });
  const tempName = `${SAFE_WRITE_TEMP_PREFIX}${process.pid}-${Date.now()}-${Math.floor(Math.random() * 0xffffffff).toString(16)}.tmp`;
  const tempPath = join(dirname(absolute), tempName);
  let tempOwned = false;
  try {
    await options.hooks?.beforeTempWrite?.();
    const tempHandle = await open(tempPath, 'wx', SAFE_WRITE_FILE_MODE);
    tempOwned = true;
    try {
      await tempHandle.writeFile(bytes);
      await tempHandle.chmod(SAFE_WRITE_FILE_MODE);
      await tempHandle.sync();
    } finally {
      await tempHandle.close();
    }
    await options.hooks?.afterTempWrite?.();
    await options.hooks?.beforeRename?.();
    await recheck();
    const rechecked = await checkDestinationKind(absolute);
    if (rechecked === 'symlink' || rechecked === 'special') {
      throw new SecretSyncError(
        'local-changed',
        'Destination changed to a symlink or special file before replacement.',
      );
    }
    if (rechecked === 'directory') {
      throw new SecretSyncError('local-changed', 'Destination changed to a directory before replacement.');
    }
    if (expectedDestination !== undefined) {
      await assertExpectedDestination(absolute, rechecked, expectedDestination);
    }
    await rename(tempPath, absolute);
    tempOwned = false;
  } finally {
    if (tempOwned) {
      await removeTempQuietly(tempPath);
    }
  }
  if (options.hooks?.afterRename !== undefined) {
    await options.hooks.afterRename();
  }
  await chmod(absolute, SAFE_WRITE_FILE_MODE);
  await fsyncDir(dirname(absolute));
  return { byteLength: bytes.byteLength };
}

async function assertExpectedDestination(
  absolute: string,
  kind: DestinationKind,
  expected: ExpectedDestination,
  action = 'replacement',
): Promise<void> {
  if (expected.state === 'absent' && kind === 'absent') {
    return;
  }
  if (expected.state === 'present' && kind === 'file') {
    try {
      const stats = await lstat(absolute);
      if (stats.isFile() && stats.size === expected.byteLength) {
        const actual = expectedDestinationFromBytes(await readFile(absolute));
        if (
          actual.state === 'present' &&
          actual.byteLength === expected.byteLength &&
          actual.sha256 === expected.sha256
        ) {
          return;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
  throw new SecretSyncError('local-changed', `Refusing ${action} after an unexpected concurrent local edit.`);
}

export async function writeFileAtomically(
  rootAbsolute: string,
  relPath: string,
  bytes: Uint8Array,
  options: WorktreeWriteOptions = {},
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
  const expected =
    options.expectedDestination ??
    expectedDestinationFromBytes(await readFileBounded(rootAbsolute, relPath, { maxFileBytes: options.maxFileBytes }));
  return replaceAtomically(
    absolute,
    bytes,
    options,
    async () => {
      await assertAncestorDirsSafe(rootAbsolute, relPath);
    },
    expected,
  );
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
    if (options.expectedDestination !== undefined) {
      await assertExpectedDestination(absolute, kind, options.expectedDestination, 'removal');
    }
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
  if (options.expectedDestination !== undefined) {
    await assertExpectedDestination(absolute, kind, options.expectedDestination, 'removal');
  }
  await unlink(absolute);
  await fsyncDir(dirname(absolute));
  return true;
}
