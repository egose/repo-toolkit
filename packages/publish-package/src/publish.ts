import { copyFileSync, existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve, relative as pathRelative, basename as pathBasename } from 'node:path';

import { createPublishPackageJson } from './manifest';
import {
  type PublishPackageOptions,
  type PublishPackagePlan,
  assertPathWithinRoot,
  ensurePathWithinRoot,
  resolvePublishPackagePlan,
  toRootMetadata,
} from './plan';

const PACKAGE_JSON = 'package.json';

export function publishPackage(options: PublishPackageOptions = {}): void {
  const plan = resolvePublishPackagePlan(options);
  const packageRoot = realpathSync(plan.cwd);

  console.log(`publishing package from ${plan.cwd}`);
  console.log(`package version ${plan.version}`);
  if (plan.npmTag) {
    console.log(`npm dist-tag ${plan.npmTag}`);
  }

  ensurePathWithinRoot(packageRoot, plan.resolvedPublishDir, 'publish directory');

  if (!plan.skipBuild) {
    runBuild(plan);
    ensurePathWithinRoot(packageRoot, plan.resolvedPublishDir, 'publish directory');
    if (!existsSync(plan.resolvedPublishDir)) {
      throw new Error(`Missing publish directory after build: ${plan.resolvedPublishDir}`);
    }
  }

  ensurePathWithinRoot(packageRoot, plan.resolvedPublishDir, 'publish directory');
  mkdirSync(plan.resolvedPublishDir, { recursive: true });
  detectCopyCollisions([...plan.packageFiles, ...plan.rootFiles]);
  copyFilesFromDirectory(plan.cwd, plan.resolvedPublishDir, plan.packageFiles);
  copyFilesFromDirectory(plan.rootDir, plan.resolvedPublishDir, plan.rootFiles);

  const publishPackageData = createPublishPackageJson(plan.sourcePackageJson, {
    version: plan.version,
    internalPackageNames: plan.internalPackageNames,
    rootMetadata: toRootMetadata(plan.rootPackageJson, pathRelative(plan.rootDir, plan.cwd)),
    rewrite: {
      versionPlaceholder: plan.versionPlaceholder,
      publishDir: plan.publishDir,
    },
  });

  const targetPackageJson = resolve(plan.resolvedPublishDir, PACKAGE_JSON);

  for (const name of plan.packageNames) {
    ensurePathWithinRoot(packageRoot, plan.resolvedPublishDir, 'publish directory');
    writeJson(targetPackageJson, {
      ...publishPackageData,
      name,
    });
    runNpmPublish(plan, name);
  }
}

function runBuild(plan: PublishPackagePlan): void {
  wrapRunnerErrors('build', () => {
    plan.runner.runShell(plan.buildCommand, { cwd: plan.cwd });
  });
}

function runNpmPublish(plan: PublishPackagePlan, packageName: string): void {
  const publishArgs = ['publish', '--access', plan.access];

  if (plan.npmTag) {
    publishArgs.push('--tag', plan.npmTag);
  }

  if (plan.registry) {
    publishArgs.push('--registry', plan.registry);
  }

  // Forward the OTP through npm's environment rather than `--otp`, so it does
  // not appear in argv / process listings. `npm_config_otp` is the documented
  // npm-config channel.
  const env: Record<string, string> | undefined = plan.otp ? { npm_config_otp: plan.otp } : undefined;

  if (plan.provenance) {
    publishArgs.push('--provenance');
  }

  if (plan.dryRun) {
    publishArgs.push('--dry-run');
  }

  console.log(`publishing ${packageName} from ${plan.resolvedPublishDir}`);
  wrapRunnerErrors('npm publish', () => {
    plan.runner.run('npm', publishArgs, { cwd: plan.resolvedPublishDir, env });
  });
}

function wrapRunnerErrors(label: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) {
      const redacted = redactSensitive(error.message);
      if (redacted !== error.message) {
        const wrapped = new Error(`${label}: ${redacted}`) as Error & { cause?: unknown };
        wrapped.cause = error;
        throw wrapped;
      }
    }
    throw error;
  }
}

function redactSensitive(message: string): string {
  return message.replace(/(otp[= :]+)([^\s]+)/gi, '$1[redacted]');
}

/**
 * Copies files from `sourceDir` into `publishDir`.
 *
 * Subpaths are flattened: `--package-files docs/llms.txt` copies to
 * `dist/llms.txt`, not `dist/docs/llms.txt`. This matches npm's publish
 * directory semantics where the publish dir is the root of the tarball.
 */
function copyFilesFromDirectory(sourceDir: string, publishDir: string, fileNames: ReadonlyArray<string>): void {
  const sourceRoot = realpathSync(sourceDir);

  for (const fileName of fileNames) {
    assertSafeRelativeCopySource(fileName);
    const sourcePath = resolve(sourceDir, fileName);
    if (!existsSync(sourcePath)) {
      continue;
    }

    const resolvedSourcePath = realpathSync(sourcePath);
    assertPathWithinRoot(sourceRoot, resolvedSourcePath, `copy source ${fileName}`);

    if (!lstatSync(resolvedSourcePath).isFile()) {
      throw new Error(`Copy source must be a regular file: ${fileName}`);
    }

    copyFileSync(resolvedSourcePath, resolve(publishDir, pathBasename(fileName)));
  }
}

function assertSafeRelativeCopySource(fileName: string): void {
  if (isAbsolute(fileName)) {
    throw new Error(`Copy source must be relative: ${fileName}`);
  }

  const normalized = fileName.replace(/\\/g, '/');
  if (normalized.split('/').includes('..')) {
    throw new Error(`Copy source must not contain parent-directory segments: ${fileName}`);
  }
}

function detectCopyCollisions(allFiles: ReadonlyArray<string>): void {
  const seen = new Map<string, string>();

  for (const fileName of allFiles) {
    const dest = pathBasename(fileName);
    const existingSource = seen.get(dest);
    if (existingSource !== undefined) {
      if (existingSource === fileName) {
        throw new Error(`Duplicate copy entry: ${fileName} listed more than once`);
      }
      throw new Error(`Copy destination collision: ${existingSource} and ${fileName} both copy to ${dest}`);
    }
    seen.set(dest, fileName);
  }
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
