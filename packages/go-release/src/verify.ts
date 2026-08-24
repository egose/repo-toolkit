import { createHash } from 'node:crypto';
import {
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  closeSync,
} from 'node:fs';
import { arch as hostArch, platform as hostPlatform } from 'node:os';
import { basename, isAbsolute, join, posix as pathPosix, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { resolveGoReleasePlan, type GoReleaseOptions, type GoReleasePlan, type GoReleaseTarget } from './plan';

const DEFAULT_ARCHIVE_LIMITS = {
  maxMemberCount: 1_024,
  maxPathLength: 512,
  maxExpandedBytes: 512 * 1024 * 1024,
} as const;
const TAR_BLOCK_SIZE = 512;

export interface GoReleaseArchiveLimitsOptions {
  readonly maxMemberCount?: number;
  readonly maxPathLength?: number;
  readonly maxExpandedBytes?: number;
}

export interface GoReleaseVerifyOptions extends GoReleaseOptions {
  readonly archiveLimits?: GoReleaseArchiveLimitsOptions;
}

export interface GoReleaseVerifiedArtifact {
  readonly target: string;
  readonly archivePath: string;
  readonly size: number;
  readonly checksum: string;
  readonly versionChecks: ReadonlyArray<string>;
}

export interface GoReleaseVerifyResult {
  readonly outputDir: string;
  readonly checksumPath: string;
  readonly artifacts: ReadonlyArray<GoReleaseVerifiedArtifact>;
}

interface ArchiveLimits {
  readonly maxMemberCount: number;
  readonly maxPathLength: number;
  readonly maxExpandedBytes: number;
}

interface ArchiveMember {
  readonly path: string;
  readonly size: number;
  readonly mode: number;
}

interface ValidatedArtifact {
  readonly target: GoReleaseTarget;
  readonly archivePath: string;
  readonly snapshotPath: string;
  readonly size: number;
  readonly checksum: string;
  readonly members: ReadonlyArray<ArchiveMember>;
}

export function verifyGoRelease(options: GoReleaseVerifyOptions): Promise<GoReleaseVerifyResult>;
export async function verifyGoRelease(options: unknown): Promise<GoReleaseVerifyResult> {
  const { planOptions, archiveLimits } = resolveVerifyOptions(options);
  const plan = resolveGoReleasePlan(planOptions);
  assertDirectory(plan.resolvedOutputDir, 'release output directory');
  assertExactArchiveSet(plan);
  const checksumPath = join(plan.resolvedOutputDir, plan.checksumFile);
  const checksums = parseChecksumManifest(
    checksumPath,
    plan.targets.map((target) => target.archiveName),
  );
  const verificationRoot = mkdtempSync(join(plan.resolvedOutputDir, '.go-release-verify-'));

  try {
    const snapshotRoot = join(verificationRoot, 'archives');
    const extractionRoot = join(verificationRoot, 'extracted');
    mkdirSync(snapshotRoot);
    mkdirSync(extractionRoot);
    const artifacts = plan.targets.map((target) =>
      snapshotAndValidateArchive(
        plan,
        target,
        checksums.get(target.archiveName) as string,
        snapshotRoot,
        archiveLimits,
      ),
    );

    const results: GoReleaseVerifiedArtifact[] = [];
    for (const artifact of artifacts) {
      const targetRoot = join(extractionRoot, artifact.target.name);
      mkdirSync(targetRoot);
      await plan.runner.run(
        plan.tarExecutable,
        [
          '--extract',
          '--gzip',
          '--file',
          artifact.snapshotPath,
          '--directory',
          targetRoot,
          '--no-same-owner',
          '--same-permissions',
          '--no-overwrite-dir',
          '--',
        ],
        {
          cwd: verificationRoot,
          env: { TAR_OPTIONS: '' },
          stdio: 'pipe',
          timeoutMs: plan.processLimits.timeoutMs,
          maxOutputBytes: plan.processLimits.maxOutputBytes,
        },
      );
      validateExtractedTree(plan, artifact.target, targetRoot, artifact.members);
      const versionChecks = verifyVersions(plan, artifact.target, targetRoot);
      results.push({
        target: artifact.target.name,
        archivePath: artifact.archivePath,
        size: artifact.size,
        checksum: artifact.checksum,
        versionChecks,
      });
    }

    return { outputDir: plan.resolvedOutputDir, checksumPath, artifacts: results };
  } finally {
    rmSync(verificationRoot, { recursive: true, force: true });
  }
}

function resolveVerifyOptions(value: unknown): { planOptions: GoReleaseOptions; archiveLimits: ArchiveLimits } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('options must be an object');
  }
  const { archiveLimits: rawLimits, ...planOptions } = value as Record<string, unknown>;
  if (rawLimits !== undefined && (typeof rawLimits !== 'object' || rawLimits === null || Array.isArray(rawLimits))) {
    throw new Error('archiveLimits must be an object');
  }
  const limits = (rawLimits ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(limits)) {
    if (!['maxMemberCount', 'maxPathLength', 'maxExpandedBytes'].includes(key)) {
      throw new Error(`Unknown archiveLimits option: ${key}`);
    }
  }
  return {
    planOptions: planOptions as unknown as GoReleaseOptions,
    archiveLimits: {
      maxMemberCount: boundedPositiveInteger(
        limits.maxMemberCount,
        DEFAULT_ARCHIVE_LIMITS.maxMemberCount,
        'archiveLimits.maxMemberCount',
      ),
      maxPathLength: boundedPositiveInteger(
        limits.maxPathLength,
        DEFAULT_ARCHIVE_LIMITS.maxPathLength,
        'archiveLimits.maxPathLength',
      ),
      maxExpandedBytes: boundedPositiveInteger(
        limits.maxExpandedBytes,
        DEFAULT_ARCHIVE_LIMITS.maxExpandedBytes,
        'archiveLimits.maxExpandedBytes',
      ),
    },
  };
}

function parseChecksumManifest(path: string, expectedNames: ReadonlyArray<string>): Map<string, string> {
  assertRegularFile(path, 'checksum manifest');
  const expectedBytes = expectedNames.reduce((total, name) => total + 67 + Buffer.byteLength(name, 'utf8'), 0);
  const maximumBytes = expectedBytes + 64 * 1024;
  if (lstatSync(path).size > maximumBytes) throw new Error('Checksum manifest exceeds its expected size bound');
  const contents = readFileSync(path, 'utf8');
  if (contents.length === 0 || !contents.endsWith('\n') || contents.includes('\r') || contents.includes('\0')) {
    throw new Error('Checksum manifest must be nonempty, LF-terminated UTF-8 text');
  }
  const entries = new Map<string, string>();
  for (const line of contents.slice(0, -1).split('\n')) {
    const match = /^([0-9a-f]{64}) {2}([^/\\\r\n]+)$/u.exec(line);
    if (!match) throw new Error(`Malformed checksum manifest line: ${line}`);
    const [, checksum, name] = match;
    if (name === '.' || name === '..' || name.includes('\0')) throw new Error(`Unsafe checksum filename: ${name}`);
    if (entries.has(name)) throw new Error(`Duplicate checksum manifest entry: ${name}`);
    entries.set(name, checksum);
  }
  assertExactSet([...entries.keys()], expectedNames, 'checksum manifest');
  return entries;
}

function snapshotAndValidateArchive(
  plan: GoReleasePlan,
  target: GoReleaseTarget,
  expectedChecksum: string,
  snapshotRoot: string,
  limits: ArchiveLimits,
): ValidatedArtifact {
  const archivePath = join(plan.resolvedOutputDir, target.archiveName);
  assertNonemptyRegularFile(archivePath, `archive ${target.archiveName}`);
  const maximumArchiveBytes = maximumCompressedArchiveBytes(limits);
  if (lstatSync(archivePath).size > maximumArchiveBytes) {
    throw new Error(`Archive ${target.archiveName} exceeds the compressed size bound`);
  }
  const snapshotPath = join(snapshotRoot, target.archiveName);
  copyFileSync(archivePath, snapshotPath, constants.COPYFILE_EXCL);
  const snapshotStats = lstatSync(snapshotPath);
  if (snapshotStats.size > maximumArchiveBytes) {
    throw new Error(`Archive ${target.archiveName} exceeds the compressed size bound`);
  }
  const checksum = hashFile(snapshotPath);
  if (checksum !== expectedChecksum) throw new Error(`Checksum mismatch for ${target.archiveName}`);
  const members = parseArchive(snapshotPath, target, plan, limits);
  return { target, archivePath, snapshotPath, size: snapshotStats.size, checksum, members };
}

function parseArchive(
  archivePath: string,
  target: GoReleaseTarget,
  plan: GoReleasePlan,
  limits: ArchiveLimits,
): ReadonlyArray<ArchiveMember> {
  let contents: Buffer;
  try {
    const metadataAllowance = (limits.maxMemberCount + 2) * TAR_BLOCK_SIZE;
    contents = gunzipSync(readFileSync(archivePath), { maxOutputLength: limits.maxExpandedBytes + metadataAllowance });
  } catch (error) {
    const wrapped = new Error(
      `Unable to decompress bounded archive ${basename(archivePath)}: ${error instanceof Error ? error.message : String(error)}`,
    ) as Error & { cause?: unknown };
    wrapped.cause = error;
    throw wrapped;
  }
  const expectedModes = expectedMemberModes(plan, target);
  const members: ArchiveMember[] = [];
  const seen = new Set<string>();
  let expandedBytes = 0;
  let offset = 0;
  let endBlocks = 0;

  while (offset + TAR_BLOCK_SIZE <= contents.length) {
    const header = contents.subarray(offset, offset + TAR_BLOCK_SIZE);
    offset += TAR_BLOCK_SIZE;
    if (header.every((byte) => byte === 0)) {
      endBlocks += 1;
      if (endBlocks === 2) break;
      continue;
    }
    if (endBlocks !== 0) throw new Error('Archive contains data after an end marker');
    if (members.length >= limits.maxMemberCount)
      throw new Error(`Archive exceeds the member limit: ${limits.maxMemberCount}`);
    validateTarChecksum(header);
    const name = decodeTarField(header.subarray(0, 100), 'member name');
    const prefix = decodeTarField(header.subarray(345, 500), 'member prefix');
    const rawPath = prefix ? `${prefix}/${name}` : name;
    if (Buffer.byteLength(rawPath, 'utf8') > limits.maxPathLength)
      throw new Error(`Archive member path is too long: ${rawPath}`);
    const normalizedPath = normalizeArchivePath(rawPath);
    if (seen.has(normalizedPath))
      throw new Error(`Archive contains duplicate normalized member path: ${normalizedPath}`);
    seen.add(normalizedPath);
    if (rawPath !== normalizedPath) throw new Error(`Archive member path is not normalized: ${rawPath}`);
    const type = header[156];
    if (type !== 0 && type !== 48) throw new Error(`Archive contains unsupported member type for ${normalizedPath}`);
    const magic = header.subarray(257, 263).toString('ascii');
    if (magic !== 'ustar\0') throw new Error(`Archive member is not in strict ustar format: ${normalizedPath}`);
    const size = parseTarNumber(header.subarray(124, 136), `size for ${normalizedPath}`);
    const mode = parseTarNumber(header.subarray(100, 108), `mode for ${normalizedPath}`) & 0o777;
    expandedBytes += size;
    if (!Number.isSafeInteger(expandedBytes) || expandedBytes > limits.maxExpandedBytes) {
      throw new Error(`Archive exceeds the expanded size limit: ${limits.maxExpandedBytes}`);
    }
    const expectedMode = expectedModes.get(normalizedPath);
    if (expectedMode === undefined) throw new Error(`Archive contains unexpected member: ${normalizedPath}`);
    if (mode !== expectedMode) throw new Error(`Archive member has unexpected permissions: ${normalizedPath}`);
    if (offset + size > contents.length) throw new Error(`Archive member data is truncated: ${normalizedPath}`);
    offset += Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;
    if (offset > contents.length) throw new Error(`Archive member padding is truncated: ${normalizedPath}`);
    if (
      contents
        .subarray(offset - ((TAR_BLOCK_SIZE - (size % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE), offset)
        .some((byte) => byte !== 0)
    ) {
      throw new Error(`Archive member has nonzero padding: ${normalizedPath}`);
    }
    members.push({ path: normalizedPath, size, mode });
  }
  if (endBlocks !== 2) throw new Error('Archive is missing its two-block end marker');
  if (contents.subarray(offset).some((byte) => byte !== 0)) throw new Error('Archive contains nonzero trailing data');
  if (members.length === 0) throw new Error('Archive is empty');
  assertExactSet(
    members.map((member) => member.path),
    [...expectedModes.keys()],
    `archive ${target.archiveName}`,
  );
  return members;
}

function assertExactArchiveSet(plan: GoReleasePlan): void {
  const actual = readdirSync(plan.resolvedOutputDir, { withFileTypes: true })
    .filter((entry) => entry.name !== plan.checksumFile && entry.name.endsWith('.tar.gz'))
    .map((entry) => entry.name);
  assertExactSet(
    actual,
    plan.targets.map((target) => target.archiveName),
    'release output archives',
  );
}

function maximumCompressedArchiveBytes(limits: ArchiveLimits): number {
  return limits.maxExpandedBytes + (limits.maxMemberCount + 2) * TAR_BLOCK_SIZE + 1_048_576;
}

function validateExtractedTree(
  plan: GoReleasePlan,
  target: GoReleaseTarget,
  root: string,
  members: ReadonlyArray<ArchiveMember>,
): void {
  assertDirectory(root, `extraction root for ${target.name}`);
  const expectedDirectories = new Set<string>();
  for (const member of members) {
    const segments = member.path.split('/');
    for (let index = 1; index < segments.length; index += 1)
      expectedDirectories.add(segments.slice(0, index).join('/'));
  }
  const actualFiles: string[] = [];
  const walk = (directory: string, prefix = ''): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) throw new Error(`Extracted archive contains a symlink: ${relativePath}`);
      assertContainedRealPath(root, path, relativePath);
      if (stats.isDirectory()) {
        if (!expectedDirectories.has(relativePath))
          throw new Error(`Extracted archive contains unexpected directory: ${relativePath}`);
        walk(path, relativePath);
      } else if (stats.isFile()) {
        actualFiles.push(relativePath);
      } else {
        throw new Error(`Extracted archive contains a special file: ${relativePath}`);
      }
    }
  };
  walk(root);
  assertExactSet(
    actualFiles,
    members.map((member) => member.path),
    `extracted archive ${target.archiveName}`,
  );
  const binaries = new Set(target.binaries.map((binary) => binary.outputName));
  for (const member of members) {
    const path = resolve(root, ...member.path.split('/'));
    const stats = lstatSync(path);
    if (!stats.isFile() || stats.isSymbolicLink())
      throw new Error(`Extracted member is not a regular file: ${member.path}`);
    if (stats.size !== member.size) throw new Error(`Extracted member size mismatch: ${member.path}`);
    if ((stats.mode & 0o777) !== member.mode) throw new Error(`Extracted member permission mismatch: ${member.path}`);
    if (binaries.has(member.path) && stats.size === 0) throw new Error(`Extracted binary is empty: ${member.path}`);
  }
  void plan;
}

function verifyVersions(plan: GoReleasePlan, target: GoReleaseTarget, root: string): ReadonlyArray<string> {
  if (!isHostCompatible(target)) return [];
  const verified: string[] = [];
  for (const binary of target.binaries) {
    if (!binary.versionCommand) continue;
    const binaryPath = resolve(root, binary.outputName);
    const output = plan.runner.capture(binaryPath, binary.versionCommand.args, {
      cwd: root,
      timeoutMs: plan.processLimits.timeoutMs,
      maxOutputBytes: plan.processLimits.maxOutputBytes,
    });
    const matches =
      binary.versionCommand.match === 'exact'
        ? output === binary.versionCommand.expectedOutput
        : output.split(/\r?\n/u).includes(binary.versionCommand.expectedOutput);
    if (!matches) throw new Error(`Version output mismatch for ${binary.outputName} in ${target.name}`);
    verified.push(binary.outputName);
  }
  return verified;
}

function isHostCompatible(target: GoReleaseTarget): boolean {
  const osMap: Readonly<Record<string, string>> = { win32: 'windows', sunos: 'solaris' };
  const archMap: Readonly<Record<string, string>> = { x64: 'amd64', ia32: '386' };
  const os = osMap[hostPlatform()] ?? hostPlatform();
  const architecture = archMap[hostArch()] ?? hostArch();
  return target.os === os && target.arch === architecture;
}

function expectedMemberModes(plan: GoReleasePlan, target: GoReleaseTarget): Map<string, number> {
  const result = new Map<string, number>();
  for (const binary of target.binaries) result.set(binary.outputName, target.os === 'windows' ? 0o644 : 0o755);
  for (const file of plan.additionalFiles) result.set(file.destination, 0o644);
  return result;
}

function normalizeArchivePath(value: string): string {
  if (
    value.length === 0 ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.includes('\r') ||
    value.includes('\n') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/u.test(value)
  ) {
    throw new Error(`Archive member must be a safe relative POSIX path: ${value}`);
  }
  const segments = value.split('/');
  if (segments.includes('..')) throw new Error(`Archive member contains traversal: ${value}`);
  const normalized = pathPosix.normalize(value).replace(/^\.\//u, '');
  if (normalized === '.' || normalized.length === 0 || normalized.startsWith('../')) {
    throw new Error(`Archive member must be a safe relative POSIX path: ${value}`);
  }
  return normalized;
}

function decodeTarField(field: Buffer, label: string): string {
  const nul = field.indexOf(0);
  const end = nul < 0 ? field.length : nul;
  if (nul >= 0 && field.subarray(nul).some((byte) => byte !== 0))
    throw new Error(`Archive ${label} contains embedded NUL data`);
  const bytes = field.subarray(0, end);
  const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (value.length === 0 && label === 'member name') throw new Error('Archive member name is empty');
  return value;
}

function parseTarNumber(field: Buffer, label: string): number {
  if ((field[0] & 0x80) !== 0) throw new Error(`Archive ${label} uses unsupported binary numeric encoding`);
  const text = field.toString('ascii').replace(/\0.*$/u, '').trim();
  if (!/^[0-7]+$/u.test(text)) throw new Error(`Archive has invalid ${label}`);
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Archive has unsafe ${label}`);
  return value;
}

function validateTarChecksum(header: Buffer): void {
  const expected = parseTarNumber(header.subarray(148, 156), 'header checksum');
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) actual += index >= 148 && index < 156 ? 32 : header[index];
  if (actual !== expected) throw new Error('Archive header checksum mismatch');
}

function hashFile(path: string): string {
  const hash = createHash('sha256');
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex');
}

function assertExactSet(actual: ReadonlyArray<string>, expected: ReadonlyArray<string>, label: string): void {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (
    actualSorted.length !== expectedSorted.length ||
    actualSorted.some((entry, index) => entry !== expectedSorted[index])
  ) {
    throw new Error(
      `${label} has an unexpected file set: expected ${expectedSorted.join(', ')}, found ${actualSorted.join(', ')}`,
    );
  }
}

function assertDirectory(path: string, label: string): void {
  const stats = lstatSync(path, { throwIfNoEntry: false });
  if (!stats || !stats.isDirectory() || stats.isSymbolicLink())
    throw new Error(`Expected non-symlink ${label}: ${path}`);
}

function assertRegularFile(path: string, label: string): void {
  const stats = lstatSync(path, { throwIfNoEntry: false });
  if (!stats || !stats.isFile() || stats.isSymbolicLink())
    throw new Error(`Expected non-symlink regular ${label}: ${path}`);
}

function assertNonemptyRegularFile(path: string, label: string): void {
  assertRegularFile(path, label);
  if (lstatSync(path).size === 0) throw new Error(`Expected nonempty ${label}: ${path}`);
}

function assertContainedRealPath(root: string, target: string, label: string): void {
  const realRoot = realpathSync(root);
  const realTarget = realpathSync(target);
  const path = relative(realRoot, realTarget);
  if (path === '' || (!path.startsWith('..') && !isAbsolute(path))) return;
  throw new Error(`Extracted member escapes its temporary root: ${label}`);
}

function boundedPositiveInteger(value: unknown, maximum: number, label: string): number {
  const resolved = value ?? maximum;
  if (typeof resolved !== 'number' || !Number.isSafeInteger(resolved) || resolved <= 0 || resolved > maximum) {
    throw new Error(`${label} must be a positive safe integer no greater than ${maximum}`);
  }
  return resolved;
}
