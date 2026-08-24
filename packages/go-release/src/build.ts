import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, rmdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { resolveGoReleasePlan, type GoReleaseOptions, type GoReleasePlan, type GoReleaseTarget } from './plan';

export interface GoReleaseBuildOutput {
  readonly target: string;
  readonly os: string;
  readonly arch: string;
  readonly binary: string;
  readonly outputName: string;
  readonly path: string;
  readonly size: number;
}

export interface GoReleaseBuildResult {
  readonly outputDir: string;
  readonly outputs: ReadonlyArray<GoReleaseBuildOutput>;
}

export function buildGoRelease(options: GoReleaseOptions): Promise<GoReleaseBuildResult>;
export async function buildGoRelease(options: unknown): Promise<GoReleaseBuildResult> {
  const plan = resolveGoReleasePlan(options);
  const outputParent = dirname(plan.resolvedOutputDir);
  const createdParents = createParentDirectories(outputParent, plan.cwd);
  let stagingDir: string | undefined;
  let published = false;

  try {
    stagingDir = mkdtempSync(join(outputParent, `.${basename(plan.resolvedOutputDir)}-build-`));
    await buildTargets(plan, stagingDir);
    const outputs = validateStagedTree(plan, stagingDir);
    replaceOutput(stagingDir, plan.resolvedOutputDir);
    published = true;
    stagingDir = undefined;
    return {
      outputDir: plan.resolvedOutputDir,
      outputs: outputs.map((output) => ({
        ...output,
        path: join(plan.resolvedOutputDir, output.target, output.outputName),
      })),
    };
  } finally {
    if (stagingDir !== undefined) rmSync(stagingDir, { recursive: true, force: true });
    if (!published) {
      removeEmptyParents(createdParents);
    }
  }
}

async function buildTargets(plan: GoReleasePlan, stagingDir: string): Promise<void> {
  let nextTarget = 0;
  let failure: unknown;

  const worker = async (): Promise<void> => {
    while (failure === undefined) {
      const index = nextTarget;
      if (index >= plan.targets.length) return;
      nextTarget += 1;
      try {
        await buildTarget(plan, plan.targets[index], stagingDir, () => failure !== undefined);
      } catch (error) {
        if (failure === undefined) failure = error;
      }
    }
  };

  const workerCount = Math.min(plan.processLimits.concurrency, plan.targets.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (failure !== undefined) throw failure;
}

async function buildTarget(
  plan: GoReleasePlan,
  target: GoReleaseTarget,
  stagingDir: string,
  hasFailed: () => boolean,
): Promise<void> {
  const targetDir = join(stagingDir, target.name);
  mkdirSync(targetDir);

  for (const binary of target.binaries) {
    if (hasFailed()) return;
    const outputPath = join(targetDir, binary.outputName);
    const linkerArgs = [...plan.linkerFlags];
    for (const { symbol, value } of binary.linkerValues) {
      linkerArgs.push('-X', `"${symbol}=${value}"`);
    }
    const args = [
      'build',
      ...plan.buildFlags,
      ...(linkerArgs.length > 0 ? ['-ldflags', linkerArgs.join(' ')] : []),
      '-o',
      outputPath,
      binary.packagePath,
    ];
    await plan.runner.run(plan.goExecutable, args, {
      cwd: plan.cwd,
      env: { CGO_ENABLED: '0', GOOS: target.os, GOARCH: target.arch },
      stdio: 'pipe',
      timeoutMs: plan.processLimits.timeoutMs,
      maxOutputBytes: plan.processLimits.maxOutputBytes,
    });
  }
}

function validateStagedTree(plan: GoReleasePlan, stagingDir: string): ReadonlyArray<GoReleaseBuildOutput> {
  assertEntries(
    stagingDir,
    plan.targets.map((target) => target.name),
    'build staging directory',
  );
  const outputs: GoReleaseBuildOutput[] = [];

  for (const target of plan.targets) {
    const targetDir = join(stagingDir, target.name);
    const targetStats = lstatSync(targetDir, { throwIfNoEntry: false });
    if (!targetStats || !targetStats.isDirectory() || targetStats.isSymbolicLink()) {
      throw new Error(`Expected target output directory: ${targetDir}`);
    }
    assertEntries(
      targetDir,
      target.binaries.map((binary) => binary.outputName),
      `target ${target.name}`,
    );

    for (const binary of target.binaries) {
      const outputPath = join(targetDir, binary.outputName);
      const stats = lstatSync(outputPath, { throwIfNoEntry: false });
      if (!stats || !stats.isFile() || stats.isSymbolicLink()) {
        throw new Error(`Expected non-symlink regular binary output: ${outputPath}`);
      }
      if (stats.size === 0) {
        throw new Error(`Expected nonempty binary output: ${outputPath}`);
      }
      chmodSync(outputPath, target.os === 'windows' ? 0o644 : 0o755);
      outputs.push({
        target: target.name,
        os: target.os,
        arch: target.arch,
        binary: binary.name,
        outputName: binary.outputName,
        path: outputPath,
        size: stats.size,
      });
    }
  }
  return outputs;
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

function replaceOutput(stagingDir: string, outputDir: string): void {
  const previous = lstatSync(outputDir, { throwIfNoEntry: false });
  if (!previous) {
    renameSync(stagingDir, outputDir);
    return;
  }

  const backupDir = `${stagingDir}-previous`;
  renameSync(outputDir, backupDir);
  try {
    renameSync(stagingDir, outputDir);
  } catch (error) {
    renameSync(backupDir, outputDir);
    throw error;
  }
  rmSync(backupDir, { recursive: true, force: true });
}

function createParentDirectories(directory: string, root: string): ReadonlyArray<string> {
  const created: string[] = [];
  let current = directory;
  while (current !== root && !lstatSync(current, { throwIfNoEntry: false })) {
    created.push(current);
    current = dirname(current);
  }
  mkdirSync(directory, { recursive: true });
  return created;
}

function removeEmptyParents(created: ReadonlyArray<string>): void {
  for (const directory of created) {
    try {
      rmdirSync(directory);
    } catch {
      return;
    }
  }
}
