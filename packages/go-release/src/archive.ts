import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  closeSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { basename, dirname, join } from 'node:path';

import { resolveGoReleasePlan, type GoReleaseOptions, type GoReleasePlan, type GoReleaseTarget } from './plan';

export interface GoReleaseArchiveArtifact {
  readonly target: string;
  readonly os: string;
  readonly arch: string;
  readonly archivePath: string;
  readonly size: number;
  readonly checksum: string;
}

export interface GoReleaseArchiveResult {
  readonly outputDir: string;
  readonly checksumPath: string;
  readonly artifacts: ReadonlyArray<GoReleaseArchiveArtifact>;
}

export interface GoReleaseChecksumArtifact {
  readonly archivePath: string;
  readonly size: number;
  readonly checksum: string;
}

export interface GoReleaseChecksumResult {
  readonly checksumPath: string;
  readonly artifacts: ReadonlyArray<GoReleaseChecksumArtifact>;
}

export function createGoReleaseArchives(options: GoReleaseOptions): Promise<GoReleaseArchiveResult>;
export async function createGoReleaseArchives(options: unknown): Promise<GoReleaseArchiveResult> {
  const plan = resolveGoReleasePlan(options);
  assertOutputDirectory(plan);
  const artifacts: GoReleaseArchiveArtifact[] = [];

  for (const target of plan.targets) {
    const archivePath = join(plan.resolvedOutputDir, target.archiveName);
    await createTargetArchive(plan, target, archivePath);
    const artifact = checksumArchive(archivePath);
    artifacts.push({
      target: target.name,
      os: target.os,
      arch: target.arch,
      ...artifact,
    });
  }

  const checksumPath = writeChecksumManifest(plan, artifacts);
  return { outputDir: plan.resolvedOutputDir, checksumPath, artifacts };
}

export function writeGoReleaseChecksums(options: GoReleaseOptions): GoReleaseChecksumResult;
export function writeGoReleaseChecksums(options: unknown): GoReleaseChecksumResult {
  const plan = resolveGoReleasePlan(options);
  assertOutputDirectory(plan);
  const artifacts = plan.targets.map((target) => checksumArchive(join(plan.resolvedOutputDir, target.archiveName)));
  return { checksumPath: writeChecksumManifest(plan, artifacts), artifacts };
}

async function createTargetArchive(plan: GoReleasePlan, target: GoReleaseTarget, archivePath: string): Promise<void> {
  const stagingDir = mkdtempSync(join(plan.resolvedOutputDir, `.${target.name}-archive-stage-`));
  const token = randomUUID();
  const temporaryTar = join(plan.resolvedOutputDir, `.${target.archiveName}.${token}.tar`);
  const temporaryArchive = join(plan.resolvedOutputDir, `.${target.archiveName}.${token}.tmp`);

  try {
    const members = stageMembers(plan, target, stagingDir);
    const args = [
      '--create',
      '--format=ustar',
      '--sort=name',
      `--mtime=@${plan.sourceDateEpoch}`,
      '--owner=0',
      '--group=0',
      '--numeric-owner',
      '--no-recursion',
      '--file',
      temporaryTar,
      '--',
      ...members,
    ];
    try {
      await plan.runner.run(plan.tarExecutable, args, {
        cwd: stagingDir,
        env: { TAR_OPTIONS: '' },
        stdio: 'pipe',
        timeoutMs: plan.processLimits.timeoutMs,
        maxOutputBytes: plan.processLimits.maxOutputBytes,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const wrapped = new Error(
        `Failed to create ${target.archiveName}; GNU-compatible tar support for --format, --sort, --mtime, ownership, and --no-recursion is required: ${message}`,
      ) as Error & { cause?: unknown };
      wrapped.cause = error;
      throw wrapped;
    }
    assertNonemptyRegularFile(temporaryTar, `temporary tar for ${target.name}`);

    await pipeline(
      createReadStream(temporaryTar),
      createGzip({ level: 9 }),
      createWriteStream(temporaryArchive, { flags: 'wx', mode: 0o644 }),
    );
    normalizeGzipHeader(temporaryArchive);
    assertNonemptyRegularFile(temporaryArchive, `temporary archive for ${target.name}`);
    renameSync(temporaryArchive, archivePath);
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
    rmSync(temporaryTar, { force: true });
    rmSync(temporaryArchive, { force: true });
  }
}

function stageMembers(plan: GoReleasePlan, target: GoReleaseTarget, stagingDir: string): ReadonlyArray<string> {
  const targetDir = join(plan.resolvedOutputDir, target.name);
  assertDirectory(targetDir, `build output for ${target.name}`);
  assertEntries(
    targetDir,
    target.binaries.map((binary) => binary.outputName),
    `build output for ${target.name}`,
  );
  const members: string[] = [];

  for (const binary of target.binaries) {
    const source = join(targetDir, binary.outputName);
    assertNonemptyRegularFile(source, `binary ${binary.outputName} for ${target.name}`);
    const destination = join(stagingDir, binary.outputName);
    copyFileSync(source, destination);
    chmodSync(destination, target.os === 'windows' ? 0o644 : 0o755);
    members.push(binary.outputName);
  }
  for (const file of plan.additionalFiles) {
    assertRegularFile(file.sourcePath, `additional file ${file.source}`);
    const destination = join(stagingDir, ...file.destination.split('/'));
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(file.sourcePath, destination);
    chmodSync(destination, 0o644);
    members.push(file.destination);
  }
  return members.sort();
}

function checksumArchive(archivePath: string): GoReleaseChecksumArtifact {
  assertNonemptyRegularFile(archivePath, `archive ${basename(archivePath)}`);
  const contents = readFileSync(archivePath);
  return {
    archivePath,
    size: contents.byteLength,
    checksum: createHash('sha256').update(contents).digest('hex'),
  };
}

function writeChecksumManifest(plan: GoReleasePlan, artifacts: ReadonlyArray<GoReleaseChecksumArtifact>): string {
  const entries = artifacts
    .map((artifact) => {
      const name = basename(artifact.archivePath);
      if (/\r|\n/u.test(name)) throw new Error(`Archive filename is ambiguous in checksum manifest: ${name}`);
      return { name, checksum: artifact.checksum };
    })
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const contents = entries.map(({ checksum, name }) => `${checksum}  ${name}\n`).join('');
  const checksumPath = join(plan.resolvedOutputDir, plan.checksumFile);
  const temporaryPath = join(plan.resolvedOutputDir, `.${plan.checksumFile}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
    renameSync(temporaryPath, checksumPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return checksumPath;
}

function normalizeGzipHeader(path: string): void {
  const descriptor = openSync(path, 'r+');
  try {
    writeSync(descriptor, Buffer.from([0, 0, 0, 0]), 0, 4, 4);
    writeSync(descriptor, Buffer.from([255]), 0, 1, 9);
  } finally {
    closeSync(descriptor);
  }
}

function assertOutputDirectory(plan: GoReleasePlan): void {
  assertDirectory(plan.resolvedOutputDir, 'managed build output');
}

function assertDirectory(path: string, label: string): void {
  const stats = lstatSync(path, { throwIfNoEntry: false });
  if (!stats || !stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Expected non-symlink directory for ${label}: ${path}`);
  }
}

function assertRegularFile(path: string, label: string): void {
  const stats = lstatSync(path, { throwIfNoEntry: false });
  if (!stats || !stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Expected non-symlink regular file for ${label}: ${path}`);
  }
}

function assertNonemptyRegularFile(path: string, label: string): void {
  assertRegularFile(path, label);
  if (lstatSync(path).size === 0) throw new Error(`Expected nonempty ${label}: ${path}`);
}

function assertEntries(directory: string, expected: ReadonlyArray<string>, label: string): void {
  const actual = readdirSync(directory).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((entry, index) => entry !== sortedExpected[index])) {
    throw new Error(
      `${label} contains unexpected entries: expected ${sortedExpected.join(', ')}, found ${actual.join(', ')}`,
    );
  }
}
