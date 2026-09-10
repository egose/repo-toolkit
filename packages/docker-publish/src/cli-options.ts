import { loadConfigFile, redactSensitiveValues, type ParseFlagsResult } from '@repo-toolkit/publish-package';

import {
  applyCliFilters,
  deriveFilteredPlan,
  mergeOverrides,
  positiveInteger,
  readCliPassthrough,
  CLI_ONLY_KEYS,
  type DockerPublishCliFilters,
  type DockerPublishCliPassthrough,
} from './cli-filter';
import { resolveDockerPublishPlan, type DockerPublishOptions, type DockerPublishPlan } from './plan';
import type { DockerPublishRegistryAuth } from './publish';

export type { DockerPublishCliFilters, DockerPublishCliPassthrough };
export { CLI_ONLY_KEYS, positiveInteger };

export interface DockerPublishCliResolution {
  readonly options: DockerPublishOptions;
  readonly plan: DockerPublishPlan;
  readonly passthrough: DockerPublishCliPassthrough;
}

export async function resolveDockerPublishCliOptions(
  result: ParseFlagsResult,
  filters: DockerPublishCliFilters = {},
): Promise<DockerPublishCliResolution> {
  const loaded =
    result.values.config !== undefined
      ? await loadConfigFile<Record<string, unknown>>(result.values.config, result.values.cwd)
      : {};
  if (Object.prototype.hasOwnProperty.call(loaded, 'runner')) {
    throw new Error('runner is available only to library callers');
  }
  const passthrough = readCliPassthrough(loaded);
  const merged = mergeOverrides(loaded, result);
  const fullPlan = resolveDockerPublishPlan(merged);
  const options = applyCliFilters(fullPlan, merged, filters);
  const plan = deriveFilteredPlan(fullPlan, filters);
  return { options, plan, passthrough };
}

export function planSummary(operation: string, plan: DockerPublishPlan, dryRun: boolean): object {
  return {
    operation,
    dryRun,
    dockerExecutable: plan.dockerExecutable,
    cwd: plan.cwd,
    buildConcurrency: plan.buildConcurrency,
    tags: [...plan.tags],
    platforms: plan.platforms.map((platform) => platform.name),
    registries: plan.registries.map((registry) =>
      registry.repositoryPrefix === '' ? registry.hostname : `${registry.hostname}/${registry.repositoryPrefix}`,
    ),
    images: plan.images.map((image) => ({
      image: image.name,
      contextDir: image.contextDir,
      dockerfile: image.dockerfile,
      ...(image.target === undefined ? {} : { target: image.target }),
      references: [...image.references],
    })),
    references: [...plan.references],
  };
}

export function printSummary(summary: object): void {
  console.log(JSON.stringify(summary, null, 2));
}

export function collectCliSecrets(
  plan: DockerPublishPlan,
  auth: Readonly<Record<string, DockerPublishRegistryAuth>> = {},
): string[] {
  const secrets: string[] = [];
  const consider = (value: unknown): void => {
    if (typeof value === 'string' && value.length > 0 && secrets.indexOf(value) < 0) {
      secrets.push(value);
    }
  };
  for (const key of Object.keys(plan.buildArgs)) {
    consider(plan.buildArgs[key]);
  }
  for (const key of Object.keys(plan.labels)) {
    consider(plan.labels[key]);
  }
  for (const image of plan.images) {
    for (const key of Object.keys(image.buildArgs)) {
      consider(image.buildArgs[key]);
    }
    for (const key of Object.keys(image.labels)) {
      consider(image.labels[key]);
    }
  }
  for (const hostname of Object.keys(auth)) {
    const entry = auth[hostname];
    if (entry.username !== undefined) {
      consider(entry.username);
    } else if (entry.usernameEnv !== undefined) {
      consider(process.env[entry.usernameEnv]);
    }
    consider(process.env[entry.passwordEnv]);
  }
  return secrets;
}

export function reportCliError(error: unknown, secrets: ReadonlyArray<string> = []): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(redactSensitiveValues(message, secrets));
}

export function resolvePublishConcurrencyFlag(
  result: ParseFlagsResult,
  passthrough: DockerPublishCliPassthrough,
): number | undefined {
  if (result.values['publish-concurrency'] !== undefined) {
    return positiveInteger(result.values['publish-concurrency'], '--publish-concurrency');
  }
  return passthrough.publishConcurrency;
}

export function resolveDigestManifestFlag(
  result: ParseFlagsResult,
  passthrough: DockerPublishCliPassthrough,
): string | undefined {
  if (result.values['digest-manifest'] !== undefined) {
    const value = result.values['digest-manifest'];
    if (value.length === 0) {
      throw new Error('--digest-manifest must be a non-empty path');
    }
    return value;
  }
  return passthrough.digestManifestPath;
}
