import { resolve } from 'node:path';

import { type PreparedArtifactEntry, prepareArtifacts, wrapRunnerErrors, writeJson } from './prepare';
import {
  type PreparedPackageArtifact,
  type PublishPackageOptions,
  type PublishPackagePlan,
  resolvePublishPackagePlanAsync,
} from './plan';

const PACKAGE_JSON = 'package.json';

export async function publishPackage(options: PublishPackageOptions = {}): Promise<PreparedPackageArtifact[]> {
  const plan = await resolvePublishPackagePlanAsync(options);

  console.log(`publishing package from ${plan.cwd}`);
  console.log(`package version ${plan.version}`);
  if (plan.npmTag) {
    console.log(`npm dist-tag ${plan.npmTag}`);
  }

  const session = await prepareArtifacts(plan);

  try {
    publishPreparedArtifacts(plan, session.entries, { skipNpm: plan.prepareOnly });
    return session.results;
  } finally {
    session.cleanup();
  }
}

/**
 * Prepare every configured artifact (stage, manifest, validate, and pack when
 * required) without invoking `npm publish`. Equivalent to
 * `publishPackage({ ...options, prepareOnly: true })`.
 */
export async function preparePackageArtifacts(options: PublishPackageOptions = {}): Promise<PreparedPackageArtifact[]> {
  return publishPackage({ ...options, prepareOnly: true });
}

function publishPreparedArtifacts(
  plan: PublishPackagePlan,
  entries: ReadonlyArray<PreparedArtifactEntry>,
  options: { skipNpm: boolean },
): void {
  for (const entry of entries) {
    if (entry.sequenceNames) {
      for (const name of plan.packageNames) {
        writeJson(resolve(entry.publishRoot, PACKAGE_JSON), {
          ...entry.manifestData,
          name,
        });
        if (!options.skipNpm) {
          runNpmPublish(plan, name, entry.publishRoot);
        }
      }
      continue;
    }

    if (options.skipNpm) {
      continue;
    }

    if (entry.result.tarballPath !== undefined) {
      runNpmPublish(plan, entry.artifact.packageName, plan.cwd, entry.result.tarballPath);
      continue;
    }

    runNpmPublish(plan, entry.artifact.packageName, entry.publishRoot);
  }
}

function runNpmPublish(plan: PublishPackagePlan, packageName: string, cwd: string, tarballPath?: string): void {
  const publishArgs = ['publish'];
  if (tarballPath !== undefined) {
    publishArgs.push(tarballPath);
  }
  publishArgs.push('--access', plan.access);

  if (plan.npmTag) {
    publishArgs.push('--tag', plan.npmTag);
  }

  if (plan.registry) {
    publishArgs.push('--registry', plan.registry);
  }

  const env: Record<string, string> | undefined = plan.otp ? { npm_config_otp: plan.otp } : undefined;

  if (plan.provenance) {
    publishArgs.push('--provenance');
  }

  if (plan.dryRun) {
    publishArgs.push('--dry-run');
  }

  console.log(`publishing ${packageName}${tarballPath !== undefined ? ` from ${tarballPath}` : ` from ${cwd}`}`);
  wrapRunnerErrors('npm publish', () => {
    plan.runner.run('npm', publishArgs, { cwd, env });
  });
}
