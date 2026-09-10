import { redactSensitiveValues } from '@repo-toolkit/publish-package';

import {
  assertResolvedImagePaths,
  MAX_MAP_ENTRIES,
  MAX_MAP_KEY_LENGTH,
  MAX_MAP_VALUE_LENGTH,
  resolveDockerPublishPlan,
  SECRET_KEY_PATTERN,
  type DockerPublishImage,
  type DockerPublishOptions,
  type DockerPublishPlan,
} from './plan';
import {
  resolveDockerRunner,
  runWithConcurrency,
  stripExtraKeys,
  type DockerRunner,
  type DockerRunOptions,
} from './runner';

const IMAGES_FORMAT = '{{.Repository}}:{{.Tag}} {{.ID}}';

const BUILD_EXTRA_KEYS = new Set(['runner']);

export type DockerBuildRunner = DockerRunner;

export interface DockerBuildOptions extends DockerPublishOptions {
  readonly runner?: DockerBuildRunner;
}

export interface DockerBuildImageResult {
  readonly image: string;
  readonly references: ReadonlyArray<string>;
  readonly platforms: ReadonlyArray<string>;
  readonly imageIds: Readonly<Record<string, string>>;
  readonly durationMs: number;
}

export interface DockerBuildResult {
  readonly images: ReadonlyArray<DockerBuildImageResult>;
}

export async function buildDockerImages(options: DockerBuildOptions): Promise<DockerBuildResult> {
  const runner = resolveDockerRunner(options);
  const plan = resolveDockerPublishPlan(stripExtraKeys(options, BUILD_EXTRA_KEYS) as unknown as DockerPublishOptions);
  const ordered = await runWithConcurrency(plan.images, Math.min(plan.buildConcurrency, plan.images.length), (image) =>
    buildOneImage(plan, image, runner),
  );
  const images: DockerBuildImageResult[] = [];
  for (const entry of ordered) {
    if (entry === undefined) {
      throw new Error('Docker build completed without a result for every planned image');
    }
    images.push(entry);
  }
  return { images };
}

async function buildOneImage(
  plan: DockerPublishPlan,
  image: DockerPublishImage,
  runner: DockerRunner,
): Promise<DockerBuildImageResult> {
  const start = Date.now();
  const platformNames = imagePlatformNames(plan);
  const buildSecrets = collectBuildSecrets(plan, image);
  try {
    await runBuild(plan, image, platformNames, buildSecrets, runner);
    const imageIds = await verifyLocalImages(plan, image, platformNames, buildSecrets, runner);
    return {
      image: image.name,
      references: [...image.references],
      platforms: [...platformNames],
      imageIds,
      durationMs: Date.now() - start,
    };
  } catch (error) {
    await untagImage(plan, image, buildSecrets, runner);
    throw buildError(image.name, platformNames, error, buildSecrets);
  }
}

function imagePlatformNames(plan: DockerPublishPlan): ReadonlyArray<string> {
  return plan.platforms.map((platform) => platform.name);
}

function mergedMap(
  globalEntries: Readonly<Record<string, string>>,
  imageEntries: Readonly<Record<string, string>>,
  label: string,
  allowSecrets: boolean,
): Readonly<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const key of Object.keys(globalEntries)) {
    merged[key] = globalEntries[key];
  }
  for (const key of Object.keys(imageEntries)) {
    merged[key] = imageEntries[key];
  }
  assertStringMapBounds(merged, label, allowSecrets);
  return merged;
}

function assertStringMapBounds(entries: Readonly<Record<string, string>>, label: string, allowSecrets: boolean): void {
  const keys = Object.keys(entries);
  if (keys.length > MAX_MAP_ENTRIES) {
    throw new Error(`${label} must not contain more than ${MAX_MAP_ENTRIES} entries`);
  }
  for (const key of keys) {
    if (key.length === 0 || key.length > MAX_MAP_KEY_LENGTH) {
      throw new Error(`${label} keys must be 1-${MAX_MAP_KEY_LENGTH} characters long`);
    }
    if (/\s/u.test(key) || containsControlCharacter(key)) {
      throw new Error(`${label} key must not contain whitespace or control characters: ${key}`);
    }
    const value = entries[key];
    if (typeof value !== 'string') {
      throw new Error(`${label}.${key} must be a string`);
    }
    if (value.includes('\0')) {
      throw new Error(`${label}.${key} must not contain NUL bytes`);
    }
    if (value.length > MAX_MAP_VALUE_LENGTH) {
      throw new Error(`${label}.${key} must not exceed ${MAX_MAP_VALUE_LENGTH} characters`);
    }
    if (!allowSecrets && SECRET_KEY_PATTERN.test(key.toUpperCase())) {
      throw new Error(
        `${label}.${key} looks like a secret; refusing to embed it in build configuration unless allowSecretsInBuildArgs is true`,
      );
    }
  }
}

function containsControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function collectBuildSecrets(plan: DockerPublishPlan, image: DockerPublishImage): string[] {
  const buildArgs = mergedMap(plan.buildArgs, image.buildArgs, 'buildArgs', plan.allowSecretsInBuildArgs);
  const labels = mergedMap(plan.labels, image.labels, 'labels', plan.allowSecretsInBuildArgs);
  const secrets: string[] = [];
  const consider = (entries: Readonly<Record<string, string>>): void => {
    for (const key of Object.keys(entries)) {
      if (SECRET_KEY_PATTERN.test(key.toUpperCase())) {
        const value = entries[key];
        if (value.length > 0 && secrets.indexOf(value) < 0) {
          secrets.push(value);
        }
      }
    }
  };
  consider(buildArgs);
  consider(labels);
  return secrets;
}

function buildArgv(plan: DockerPublishPlan, image: DockerPublishImage, platformNames: ReadonlyArray<string>): string[] {
  const buildArgs = mergedMap(plan.buildArgs, image.buildArgs, 'buildArgs', plan.allowSecretsInBuildArgs);
  const labels = mergedMap(plan.labels, image.labels, 'labels', plan.allowSecretsInBuildArgs);
  const argv: string[] = ['buildx', 'build', '--platform', platformNames.join(','), '-f', image.resolvedDockerfile];
  if (image.target !== undefined) {
    argv.push('--target', image.target);
  }
  for (const reference of image.references) {
    argv.push('-t', reference);
  }
  for (const key of Object.keys(buildArgs).sort()) {
    argv.push('--build-arg', `${key}=${buildArgs[key]}`);
  }
  for (const key of Object.keys(labels).sort()) {
    argv.push('--label', `${key}=${labels[key]}`);
  }
  if (platformNames.length === 1) {
    argv.push('--load');
  }
  argv.push(image.resolvedContextDir);
  return argv;
}

function runOptions(plan: DockerPublishPlan, secrets: ReadonlyArray<string>): DockerRunOptions {
  return {
    cwd: plan.cwd,
    stdio: 'pipe',
    timeoutMs: plan.processLimits.timeoutMs,
    maxOutputBytes: plan.processLimits.maxOutputBytes,
    secrets,
  };
}

function captureOptions(plan: DockerPublishPlan, secrets: ReadonlyArray<string>): DockerRunOptions {
  return {
    cwd: plan.cwd,
    timeoutMs: plan.processLimits.timeoutMs,
    maxOutputBytes: plan.processLimits.maxOutputBytes,
    secrets,
  };
}

async function runBuild(
  plan: DockerPublishPlan,
  image: DockerPublishImage,
  platformNames: ReadonlyArray<string>,
  secrets: ReadonlyArray<string>,
  runner: DockerRunner,
): Promise<void> {
  assertResolvedImagePaths(plan, image);
  await runner.run(plan.dockerExecutable, buildArgv(plan, image, platformNames), runOptions(plan, secrets));
}

async function verifyLocalImages(
  plan: DockerPublishPlan,
  image: DockerPublishImage,
  platformNames: ReadonlyArray<string>,
  secrets: ReadonlyArray<string>,
  runner: DockerRunner,
): Promise<Readonly<Record<string, string>>> {
  if (platformNames.length !== 1) {
    return {};
  }
  const output = await runner.capture(
    plan.dockerExecutable,
    ['images', '--no-trunc', '--format', IMAGES_FORMAT, ...image.references],
    captureOptions(plan, secrets),
  );
  return parseImagesOutput(image.name, platformNames, image.references, output.stdout);
}

function parseImagesOutput(
  imageName: string,
  platformNames: ReadonlyArray<string>,
  references: ReadonlyArray<string>,
  stdout: string,
): Readonly<Record<string, string>> {
  const expected: Record<string, boolean> = {};
  for (const reference of references) {
    expected[reference] = true;
  }
  const observed: Record<string, string> = {};
  const lines = stdout.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const separator = trimmed.lastIndexOf(' ');
    if (separator < 0) {
      throw verificationError(imageName, platformNames, `unexpected local tag entry: ${trimmed}`);
    }
    const reference = trimmed.slice(0, separator);
    const id = trimmed.slice(separator + 1);
    if (!Object.prototype.hasOwnProperty.call(expected, reference)) {
      throw verificationError(imageName, platformNames, `unexpected local tag: ${reference}`);
    }
    if (id.length === 0) {
      throw verificationError(imageName, platformNames, `empty local image ID for reference: ${reference}`);
    }
    if (Object.prototype.hasOwnProperty.call(observed, reference) && observed[reference] !== id) {
      throw verificationError(imageName, platformNames, `conflicting local image IDs for reference: ${reference}`);
    }
    observed[reference] = id;
  }
  for (const reference of references) {
    if (!Object.prototype.hasOwnProperty.call(observed, reference)) {
      throw verificationError(imageName, platformNames, `missing local image for reference: ${reference}`);
    }
  }
  return observed;
}

async function untagImage(
  plan: DockerPublishPlan,
  image: DockerPublishImage,
  secrets: ReadonlyArray<string>,
  runner: DockerRunner,
): Promise<void> {
  try {
    await runner.run(plan.dockerExecutable, ['rmi', ...image.references], runOptions(plan, secrets));
  } catch {
    return;
  }
}

function buildError(
  imageName: string,
  platformNames: ReadonlyArray<string>,
  cause: unknown,
  secrets: ReadonlyArray<string>,
): Error {
  const tail = cause instanceof Error ? cause.message : String(cause);
  const redacted = redactSensitiveValues(tail, secrets);
  return new Error(
    `Failed to build Docker image "${imageName}" for platforms [${platformNames.join(', ')}]: ${redacted}`,
  );
}

function verificationError(imageName: string, platformNames: ReadonlyArray<string>, detail: string): Error {
  return new Error(
    `Local image verification failed for Docker image "${imageName}" for platforms [${platformNames.join(', ')}]: ${detail}`,
  );
}
