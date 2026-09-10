import { isPlainObject, type ParseFlagsResult } from '@repo-toolkit/publish-package';

import { formatImageReference, type DockerPublishOptions, type DockerPublishPlan } from './plan';
import { validateDockerPublishAuthMap, type DockerPublishRegistryAuth } from './publish';

export interface DockerPublishCliFilters {
  readonly images?: ReadonlyArray<string>;
  readonly platforms?: ReadonlyArray<string>;
  readonly registries?: ReadonlyArray<string>;
}

export interface DockerPublishCliPassthrough {
  readonly auth: Readonly<Record<string, DockerPublishRegistryAuth>>;
  readonly digestManifestPath?: string;
  readonly publishConcurrency?: number;
  readonly expectedDigests?: Readonly<Record<string, string>>;
}

export const CLI_ONLY_KEYS = new Set(['runner', 'auth', 'digestManifestPath', 'publishConcurrency', 'expectedDigests']);

export function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive safe integer: ${value}`);
  }
  return parsed;
}

export function readCliPassthrough(loaded: Record<string, unknown>): DockerPublishCliPassthrough {
  const auth = readAuth(loaded.auth);
  let digestManifestPath: string | undefined;
  if (loaded.digestManifestPath !== undefined) {
    if (typeof loaded.digestManifestPath !== 'string' || loaded.digestManifestPath.length === 0) {
      throw new Error('digestManifestPath must be a non-empty string');
    }
    digestManifestPath = loaded.digestManifestPath;
  }
  let publishConcurrency: number | undefined;
  if (loaded.publishConcurrency !== undefined) {
    if (
      typeof loaded.publishConcurrency !== 'number' ||
      !Number.isSafeInteger(loaded.publishConcurrency) ||
      loaded.publishConcurrency <= 0
    ) {
      throw new Error('publishConcurrency must be a positive safe integer');
    }
    publishConcurrency = loaded.publishConcurrency;
  }
  let expectedDigests: Readonly<Record<string, string>> | undefined;
  if (loaded.expectedDigests !== undefined) {
    if (!isPlainObject(loaded.expectedDigests)) {
      throw new Error('expectedDigests must be a record of reference to digest');
    }
    expectedDigests = loaded.expectedDigests as Readonly<Record<string, string>>;
  }
  return {
    auth,
    ...(digestManifestPath === undefined ? {} : { digestManifestPath }),
    ...(publishConcurrency === undefined ? {} : { publishConcurrency }),
    ...(expectedDigests === undefined ? {} : { expectedDigests }),
  };
}

export function mergeOverrides(loaded: Record<string, unknown>, result: ParseFlagsResult): DockerPublishOptions {
  const config: Record<string, unknown> = {};
  for (const key of Object.keys(loaded)) {
    if (!CLI_ONLY_KEYS.has(key)) {
      config[key] = loaded[key];
    }
  }
  return applyCliOverrides(config, result);
}

export function applyCliOverrides(configured: Record<string, unknown>, result: ParseFlagsResult): DockerPublishOptions {
  const config: Record<string, unknown> = { ...configured };
  if (result.values.cwd !== undefined) {
    config.cwd = result.values.cwd;
  }
  if (result.values['docker-executable'] !== undefined) {
    config.dockerExecutable = result.values['docker-executable'];
  }
  if (result.values.concurrency !== undefined) {
    const current = config.processLimits;
    if (current !== undefined && !isPlainObject(current)) {
      throw new Error('processLimits must be an object');
    }
    config.buildConcurrency = positiveInteger(result.values.concurrency, '--concurrency');
  }
  return config as unknown as DockerPublishOptions;
}

export function applyCliFilters(
  plan: DockerPublishPlan,
  merged: DockerPublishOptions,
  filters: DockerPublishCliFilters,
): DockerPublishOptions {
  const raw = merged as unknown as Record<string, unknown>;
  const images = selectNamed(
    Array.isArray(raw.images) ? (raw.images as ReadonlyArray<Record<string, unknown>>) : [],
    plan.images.map((image) => image.name),
    filters.images,
    'image',
  );
  const platforms = selectNamed(
    Array.isArray(raw.platforms)
      ? (raw.platforms as ReadonlyArray<string>)
      : plan.platforms.map((platform) => platform.name),
    plan.platforms.map((platform) => platform.name),
    filters.platforms,
    'platform',
  );
  const registries = selectRegistries(
    Array.isArray(raw.registries) ? (raw.registries as ReadonlyArray<Record<string, unknown>>) : [],
    plan,
    filters.registries,
  );
  return {
    cwd: plan.cwd,
    images: images as unknown as DockerPublishOptions['images'],
    registries: registries as unknown as DockerPublishOptions['registries'],
    tags: [...plan.tags],
    platforms,
    buildArgs: { ...plan.buildArgs },
    labels: { ...plan.labels },
    buildConcurrency: plan.buildConcurrency,
    processLimits: { ...plan.processLimits },
    dockerExecutable: plan.dockerExecutable,
    allowSecretsInBuildArgs: plan.allowSecretsInBuildArgs,
    allowCustomPlatforms: plan.allowCustomPlatforms,
    verification: { ...plan.verification },
  };
}

export function selectNamed<Entry extends string | Record<string, unknown>>(
  configured: ReadonlyArray<Entry>,
  planned: ReadonlyArray<string>,
  filter: ReadonlyArray<string> | undefined,
  kind: string,
): ReadonlyArray<Entry> {
  if (filter === undefined) {
    return configured;
  }
  const seen = new Set<string>();
  for (const entry of filter) {
    if (seen.has(entry)) {
      throw new Error(`Duplicate ${kind} filter: ${entry}`);
    }
    seen.add(entry);
  }
  const names = new Set<string>(planned);
  for (const entry of filter) {
    if (!names.has(entry)) {
      throw new Error(`Unknown ${kind} filter: ${entry}`);
    }
  }
  return configured.filter((entry) => {
    const name = typeof entry === 'string' ? entry : String((entry as Record<string, unknown>).name);
    return seen.has(name);
  });
}

export function selectRegistries(
  configured: ReadonlyArray<Record<string, unknown>>,
  plan: DockerPublishPlan,
  filter: ReadonlyArray<string> | undefined,
): ReadonlyArray<Record<string, unknown>> {
  if (filter === undefined) {
    return configured;
  }
  const seen = new Set<string>();
  for (const entry of filter) {
    if (seen.has(entry)) {
      throw new Error(`Duplicate registry filter: ${entry}`);
    }
    seen.add(entry);
  }
  const known = new Set<string>(plan.registries.map((registry) => registry.hostname));
  for (const entry of filter) {
    if (!known.has(entry)) {
      throw new Error(`Unknown registry filter: ${entry}`);
    }
  }
  return configured.filter((entry) => seen.has(String(entry.hostname)));
}

export function deriveFilteredPlan(fullPlan: DockerPublishPlan, filters: DockerPublishCliFilters): DockerPublishPlan {
  const imageNames = fullPlan.images.map((image) => image.name);
  const filteredImageNames = selectNamed(imageNames, imageNames, filters.images, 'image');
  const imageSet = new Set<string>(filteredImageNames);
  const platformNames = fullPlan.platforms.map((platform) => platform.name);
  const filteredPlatformNames = selectNamed(platformNames, platformNames, filters.platforms, 'platform');
  const platformSet = new Set<string>(filteredPlatformNames);
  const registryCopies = fullPlan.registries.map((registry) => ({
    hostname: registry.hostname,
    repositoryPrefix: registry.repositoryPrefix,
  }));
  const filteredRegistries = selectRegistries(registryCopies, fullPlan, filters.registries);
  const registries = filteredRegistries.map((entry) => ({
    hostname: String(entry.hostname),
    repositoryPrefix: String(entry.repositoryPrefix),
  }));
  if (imageSet.size === 0) {
    throw new Error('images must contain at least one entry');
  }
  if (registries.length === 0) {
    throw new Error('registries must contain at least one entry');
  }
  if (platformSet.size === 0) {
    throw new Error('platforms must contain at least one entry');
  }
  const platforms = fullPlan.platforms.filter((platform) => platformSet.has(platform.name));
  const images = fullPlan.images
    .filter((image) => imageSet.has(image.name))
    .map((image) => {
      const references: string[] = [];
      for (const registry of registries) {
        for (const tag of fullPlan.tags) {
          references.push(formatImageReference(registry.hostname, registry.repositoryPrefix, image.name, tag));
        }
      }
      return { ...image, references };
    });
  const references: string[] = [];
  for (const image of images) {
    for (const reference of image.references) {
      references.push(reference);
    }
  }
  return { ...fullPlan, images, registries, platforms, references };
}

function readAuth(value: unknown): Readonly<Record<string, DockerPublishRegistryAuth>> {
  return validateDockerPublishAuthMap(value);
}
