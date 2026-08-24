import { createHash } from 'node:crypto';
import { closeSync, lstatSync, mkdtempSync, openSync, readSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';

import { createGoReleaseArchives } from './archive';
import { buildGoRelease } from './build';
import { resolveGoReleasePlan, type GoReleaseOptions, type GoReleasePlan, type GoReleaseTarget } from './plan';
import { verifyGoRelease } from './verify';

export interface GoReleaseReproducibilityOptions extends GoReleaseOptions {
  readonly targetSubset?: ReadonlyArray<string>;
}

export interface GoReleaseReproducibilityArtifact {
  readonly archiveName: string;
  readonly size: number;
  readonly checksum: string;
}

export interface GoReleaseReproducibilityRun {
  readonly run: 'first' | 'second';
  readonly artifacts: ReadonlyArray<GoReleaseReproducibilityArtifact>;
}

export interface GoReleaseReproducibilitySetDifference {
  readonly run: 'first' | 'second';
  readonly archiveName: string;
}

export interface GoReleaseReproducibilityDifference {
  readonly archiveName: string;
  readonly first: GoReleaseReproducibilityArtifact;
  readonly second: GoReleaseReproducibilityArtifact;
}

export interface GoReleaseReproducibilityResult {
  readonly reproducible: boolean;
  readonly targets: ReadonlyArray<string>;
  readonly expectedArchives: ReadonlyArray<string>;
  readonly runs: readonly [GoReleaseReproducibilityRun, GoReleaseReproducibilityRun];
  readonly missing: ReadonlyArray<GoReleaseReproducibilitySetDifference>;
  readonly additional: ReadonlyArray<GoReleaseReproducibilitySetDifference>;
  readonly different: ReadonlyArray<GoReleaseReproducibilityDifference>;
}

export interface GoReleaseReproducibilityError extends Error {
  readonly evidence: GoReleaseReproducibilityResult;
}

export function verifyGoReleaseReproducibility(
  options: GoReleaseReproducibilityOptions,
): Promise<GoReleaseReproducibilityResult>;
export async function verifyGoReleaseReproducibility(options: unknown): Promise<GoReleaseReproducibilityResult> {
  const { planOptions, targetSubset } = resolveReproducibilityOptions(options);
  const plan = resolveGoReleasePlan(planOptions);
  const targets = selectTargets(plan, targetSubset);
  const expectedArchives = targets.map((target) => target.archiveName).sort();
  let firstRoot: string | undefined;
  let secondRoot: string | undefined;

  try {
    firstRoot = mkdtempSync(join(plan.cwd, '.go-release-reproducibility-first-'));
    secondRoot = mkdtempSync(join(plan.cwd, '.go-release-reproducibility-second-'));
    const first = await produceRun(plan, targets, firstRoot, 'first');
    const second = await produceRun(plan, targets, secondRoot, 'second');
    const evidence = compareRuns(targets, expectedArchives, first, second);
    if (!evidence.reproducible) throw reproducibilityError(evidence);
    return evidence;
  } finally {
    if (firstRoot !== undefined) rmSync(firstRoot, { recursive: true, force: true });
    if (secondRoot !== undefined) rmSync(secondRoot, { recursive: true, force: true });
  }
}

function resolveReproducibilityOptions(value: unknown): {
  planOptions: GoReleaseOptions;
  targetSubset: ReadonlyArray<string> | undefined;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('options must be an object');
  const { targetSubset, ...planOptions } = value as Record<string, unknown>;
  if (
    targetSubset !== undefined &&
    (!Array.isArray(targetSubset) ||
      targetSubset.length === 0 ||
      targetSubset.some((entry) => typeof entry !== 'string' || entry.length === 0))
  ) {
    throw new Error('targetSubset must be a nonempty array of target names');
  }
  return {
    planOptions: planOptions as unknown as GoReleaseOptions,
    targetSubset: targetSubset as ReadonlyArray<string> | undefined,
  };
}

function selectTargets(plan: GoReleasePlan, subset: ReadonlyArray<string> | undefined): ReadonlyArray<GoReleaseTarget> {
  if (subset === undefined) return plan.targets;
  const requested = new Set<string>();
  for (const name of subset) {
    if (requested.has(name)) throw new Error(`Duplicate reproducibility target: ${name}`);
    requested.add(name);
  }
  const targets = plan.targets.filter((target) => requested.has(target.name));
  for (const name of requested) {
    if (!targets.some((target) => target.name === name)) throw new Error(`Unknown reproducibility target: ${name}`);
  }
  return targets;
}

async function produceRun(
  plan: GoReleasePlan,
  targets: ReadonlyArray<GoReleaseTarget>,
  root: string,
  run: 'first' | 'second',
): Promise<GoReleaseReproducibilityRun> {
  const options = optionsForRun(plan, targets, join(root, 'release'));
  await buildGoRelease(options);
  await createGoReleaseArchives(options);
  await verifyGoRelease(options);
  return { run, artifacts: collectArtifacts(join(root, 'release')) };
}

function optionsForRun(
  plan: GoReleasePlan,
  targets: ReadonlyArray<GoReleaseTarget>,
  outputDir: string,
): GoReleaseOptions {
  return {
    cwd: plan.cwd,
    toolName: plan.toolName,
    version: plan.version,
    outputDir: relative(plan.cwd, outputDir),
    goExecutable: plan.goExecutable,
    tarExecutable: plan.tarExecutable,
    binaries: plan.binaries.map((binary) => ({
      name: binary.name,
      package: binary.packagePath,
      linkerValues: binary.linkerValues,
      ...(binary.versionCommand ? { versionCommand: binary.versionCommand } : {}),
    })),
    targets: targets.map((target) => ({ os: target.os, arch: target.arch })),
    buildFlags: plan.buildFlags,
    linkerFlags: plan.linkerFlags,
    archiveName: plan.archiveName,
    checksumFile: plan.checksumFile,
    additionalFiles: plan.additionalFiles.map((file) => ({ source: file.source, destination: file.destination })),
    sourceDateEpoch: plan.sourceDateEpoch,
    processLimits: plan.processLimits,
    runner: plan.runner,
  };
}

function collectArtifacts(outputDir: string): ReadonlyArray<GoReleaseReproducibilityArtifact> {
  const artifacts: GoReleaseReproducibilityArtifact[] = [];
  for (const entry of readdirSync(outputDir, { withFileTypes: true })) {
    if (!entry.name.endsWith('.tar.gz')) continue;
    const path = join(outputDir, entry.name);
    const stats = lstatSync(path);
    if (!entry.isFile() || stats.isSymbolicLink()) throw new Error(`Archive evidence is not a regular file: ${path}`);
    artifacts.push({ archiveName: entry.name, size: stats.size, checksum: hashFile(path) });
  }
  return artifacts.sort((left, right) =>
    left.archiveName < right.archiveName ? -1 : left.archiveName > right.archiveName ? 1 : 0,
  );
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

function compareRuns(
  targets: ReadonlyArray<GoReleaseTarget>,
  expectedArchives: ReadonlyArray<string>,
  first: GoReleaseReproducibilityRun,
  second: GoReleaseReproducibilityRun,
): GoReleaseReproducibilityResult {
  const expected = new Set(expectedArchives);
  const firstByName = new Map(first.artifacts.map((artifact) => [artifact.archiveName, artifact]));
  const secondByName = new Map(second.artifacts.map((artifact) => [artifact.archiveName, artifact]));
  const missing: GoReleaseReproducibilitySetDifference[] = [];
  const additional: GoReleaseReproducibilitySetDifference[] = [];
  const different: GoReleaseReproducibilityDifference[] = [];

  for (const archiveName of expectedArchives) {
    if (!firstByName.has(archiveName)) missing.push({ run: 'first', archiveName });
    if (!secondByName.has(archiveName)) missing.push({ run: 'second', archiveName });
    const firstArtifact = firstByName.get(archiveName);
    const secondArtifact = secondByName.get(archiveName);
    if (
      firstArtifact &&
      secondArtifact &&
      (firstArtifact.size !== secondArtifact.size || firstArtifact.checksum !== secondArtifact.checksum)
    ) {
      different.push({ archiveName, first: firstArtifact, second: secondArtifact });
    }
  }
  for (const artifact of first.artifacts) {
    if (!expected.has(artifact.archiveName)) additional.push({ run: 'first', archiveName: artifact.archiveName });
  }
  for (const artifact of second.artifacts) {
    if (!expected.has(artifact.archiveName)) additional.push({ run: 'second', archiveName: artifact.archiveName });
  }

  return {
    reproducible: missing.length === 0 && additional.length === 0 && different.length === 0,
    targets: targets.map((target) => target.name),
    expectedArchives,
    runs: [first, second],
    missing,
    additional,
    different,
  };
}

function formatFailure(evidence: GoReleaseReproducibilityResult): string {
  const details: string[] = [];
  for (const entry of evidence.missing) details.push(`missing from ${entry.run} run: ${entry.archiveName}`);
  for (const entry of evidence.additional) details.push(`additional in ${entry.run} run: ${entry.archiveName}`);
  for (const entry of evidence.different) {
    details.push(
      `different archive: ${entry.archiveName} ` +
        `(first size ${entry.first.size}, SHA-256 ${entry.first.checksum}; ` +
        `second size ${entry.second.size}, SHA-256 ${entry.second.checksum})`,
    );
  }
  return `Go release reproducibility verification failed: ${details.join('; ')}`;
}

function reproducibilityError(evidence: GoReleaseReproducibilityResult): GoReleaseReproducibilityError {
  const error = new Error(formatFailure(evidence)) as GoReleaseReproducibilityError;
  error.name = 'GoReleaseReproducibilityError';
  Object.defineProperty(error, 'evidence', { value: evidence, enumerable: true });
  return error;
}
