import { isAbsolute } from 'node:path';

import {
  canPrompt,
  isPlainObject,
  loadConfigFile,
  promptPassword,
  promptSelect,
  promptText,
  type ParseFlagsResult,
} from '@repo-toolkit/publish-package';

import {
  collectCliSecrets,
  planSummary,
  printSummary,
  resolveDockerPublishCliOptions,
  type DockerPublishCliFilters,
  type DockerPublishCliResolution,
} from './cli-options';
import {
  applyCliFilters,
  applyCliOverrides,
  deriveFilteredPlan,
  readCliPassthrough,
  CLI_ONLY_KEYS,
} from './cli-filter';
import {
  defaultHostPlatforms,
  KNOWN_ARCH,
  KNOWN_OS,
  MAX_CACHE_SPEC_LENGTH,
  MAX_CACHE_SPECS,
  MAX_MAP_ENTRIES,
  MAX_MAP_KEY_LENGTH,
  MAX_MAP_VALUE_LENGTH,
  resolveDockerPublishPlan,
  SECRET_KEY_PATTERN,
  type DockerPublishImageOptions,
  type DockerPublishPlan,
  type DockerPublishRegistryOptions,
} from './plan';
import { loginRegistries, validateDockerPublishAuthMap, validateDockerPublishUsername } from './publish';
import type { DockerLoginRunner, DockerPublishRegistryAuth, DockerRegistryCredentials } from './publish';

export interface PrompterTextRequest {
  readonly message: string;
  readonly placeholder?: string;
  readonly validate?: (value: string) => string | undefined;
}

export interface PrompterPasswordRequest {
  readonly message: string;
  readonly validate?: (value: string) => string | undefined;
  readonly mask?: string;
}

export interface PrompterSelectOption<T> {
  readonly value: T;
  readonly label: string;
}

export interface PrompterSelectRequest<T> {
  readonly message: string;
  readonly options: ReadonlyArray<PrompterSelectOption<T>>;
  readonly initialValue?: T;
}

export interface PrompterConfirmRequest {
  readonly message: string;
  readonly initialValue?: boolean;
}

export interface Prompter {
  text(request: PrompterTextRequest): Promise<string>;
  password(request: PrompterPasswordRequest): Promise<string>;
  select<T>(request: PrompterSelectRequest<T>): Promise<T>;
  confirm(request: PrompterConfirmRequest): Promise<boolean>;
}

export const clackPrompter: Prompter = {
  text(request: PrompterTextRequest): Promise<string> {
    return promptText({
      message: request.message,
      ...(request.placeholder === undefined ? {} : { placeholder: request.placeholder }),
      ...(request.validate === undefined ? {} : { validate: request.validate }),
    });
  },
  password(request: PrompterPasswordRequest): Promise<string> {
    return promptPassword({
      message: request.message,
      ...(request.validate === undefined ? {} : { validate: request.validate }),
      ...(request.mask === undefined ? {} : { mask: request.mask }),
    });
  },
  select<T>(request: PrompterSelectRequest<T>): Promise<T> {
    return promptSelect<T>({
      message: request.message,
      options: request.options.map((entry) => ({ value: entry.value, label: entry.label })),
      ...(request.initialValue === undefined ? {} : { initialValue: request.initialValue }),
    });
  },
  confirm(request: PrompterConfirmRequest): Promise<boolean> {
    return promptSelect<boolean>({
      message: request.message,
      options: [
        { value: true, label: 'Yes' },
        { value: false, label: 'No' },
      ],
      ...(request.initialValue === undefined ? {} : { initialValue: request.initialValue }),
    });
  },
};

export const SCRIPTED_CANCEL: unique symbol = Symbol('scripted-cancel');

export interface ScriptedPromptCall {
  readonly kind: 'text' | 'password' | 'select' | 'confirm';
  readonly message: string;
}

export interface ScriptedPrompter extends Prompter {
  readonly calls: ReadonlyArray<ScriptedPromptCall>;
}

export function createScriptedPrompter(answers: ReadonlyArray<unknown>): ScriptedPrompter {
  const queue = answers.slice();
  const calls: ScriptedPromptCall[] = [];
  const take = (kind: ScriptedPromptCall['kind'], message: string): unknown => {
    if (queue.length === 0) {
      throw new Error(`Scripted prompter has no more answers for ${kind} prompt: ${message}`);
    }
    const answer = queue.shift() as unknown;
    if (answer === SCRIPTED_CANCEL) {
      throw new Error('Operation cancelled.');
    }
    calls.push({ kind, message });
    return answer;
  };
  return {
    calls,
    text(request: PrompterTextRequest): Promise<string> {
      for (;;) {
        const value = String(take('text', request.message) as unknown);
        if (request.validate !== undefined) {
          const problem = request.validate(value);
          if (problem !== undefined) {
            continue;
          }
        }
        return Promise.resolve(value);
      }
    },
    password(request: PrompterPasswordRequest): Promise<string> {
      for (;;) {
        const value = String(take('password', request.message) as unknown);
        if (request.validate !== undefined) {
          const problem = request.validate(value);
          if (problem !== undefined) {
            continue;
          }
        }
        return Promise.resolve(value);
      }
    },
    select<T>(request: PrompterSelectRequest<T>): Promise<T> {
      const answer = take('select', request.message) as T | undefined;
      if (answer === undefined) {
        if (request.initialValue === undefined) {
          throw new Error(`Scripted prompter has no default for select prompt: ${request.message}`);
        }
        return Promise.resolve(request.initialValue);
      }
      return Promise.resolve(answer);
    },
    confirm(request: PrompterConfirmRequest): Promise<boolean> {
      const answer = take('confirm', request.message) as boolean | undefined;
      if (answer === undefined) {
        return Promise.resolve(request.initialValue ?? false);
      }
      if (typeof answer !== 'boolean') {
        throw new Error(`Scripted confirm answer must be a boolean: ${request.message}`);
      }
      return Promise.resolve(answer);
    },
  };
}

export interface InteractiveResolverDeps {
  readonly interactive?: boolean;
  readonly prompter?: Prompter;
  readonly canPromptNow?: boolean;
}

const ADVANCED_KEYS = new Set([
  'buildArgs',
  'labels',
  'annotations',
  'cacheFrom',
  'cacheTo',
  'ociExportDir',
  'buildConcurrency',
  'processLimits',
  'dockerExecutable',
  'allowSecretsInBuildArgs',
  'verification',
]);

const MAX_BUILD_CONCURRENCY = 64;
const DEFAULT_PROCESS_TIMEOUT_MS = 600_000;
const DEFAULT_PROCESS_MAX_OUTPUT_BYTES = 1_048_576;

export async function resolveInteractiveDockerPublishOptions(
  result: ParseFlagsResult,
  filters: DockerPublishCliFilters = {},
  deps: InteractiveResolverDeps = {},
): Promise<DockerPublishCliResolution> {
  if (deps.interactive !== true) {
    return resolveDockerPublishCliOptions(result, filters);
  }
  const prompter = deps.prompter ?? clackPrompter;
  if (!(deps.canPromptNow ?? canPrompt())) {
    throw new Error('Interactive prompting is unavailable: no TTY detected. Pass --config or run in a TTY.');
  }
  const loaded = await promptLoadedConfig(result, prompter);
  if (Object.prototype.hasOwnProperty.call(loaded, 'runner')) {
    throw new Error('runner is available only to library callers');
  }
  const images = await promptImageEntries(prompter, readImageDefaults(loaded));
  const registries = await promptRegistryEntries(prompter, readRegistryDefaults(loaded));
  const tags = await promptTags(prompter, readStringListDefault(loaded.tags));
  const platforms = await promptPlatforms(
    prompter,
    loaded.platforms === undefined ? defaultHostPlatforms() : readStringListDefault(loaded.platforms),
    readBooleanDefault(loaded.allowCustomPlatforms, false),
  );
  const advanced = await promptAdvanced(prompter, loaded, platforms.allowCustomPlatforms);
  const configured: Record<string, unknown> = {};
  for (const key of Object.keys(loaded)) {
    if (!CLI_ONLY_KEYS.has(key)) {
      configured[key] = loaded[key];
    }
  }
  configured.images = images;
  configured.registries = registries;
  configured.tags = tags;
  configured.platforms = platforms.entries;
  configured.allowCustomPlatforms = advanced.allowCustomPlatforms;
  for (const key of Object.keys(advanced.values)) {
    configured[key] = advanced.values[key];
  }
  const merged = applyCliOverrides(configured, result);
  const fullPlan = resolveDockerPublishPlan(merged);
  const options = applyCliFilters(fullPlan, merged, filters);
  const plan = deriveFilteredPlan(fullPlan, filters);
  return { options, plan, passthrough: readCliPassthrough(loaded) };
}

async function promptLoadedConfig(result: ParseFlagsResult, prompter: Prompter): Promise<Record<string, unknown>> {
  if (result.values.config !== undefined) {
    return loadConfigFile<Record<string, unknown>>(result.values.config, result.values.cwd);
  }
  let hint: string | undefined;
  for (;;) {
    const answer = await prompter.text({
      message:
        hint === undefined
          ? 'Config file path (leave empty to configure without a file)'
          : `Config file path (last error: ${hint})`,
      placeholder: 'docker-publish.json',
    });
    const trimmed = answer.trim();
    if (trimmed.length === 0) {
      return {};
    }
    try {
      return await loadConfigFile<Record<string, unknown>>(trimmed, result.values.cwd);
    } catch (error) {
      hint = error instanceof Error ? error.message : String(error);
    }
  }
}

interface ImageDefault {
  readonly name?: string;
  readonly contextDir?: string;
  readonly dockerfile?: string;
  readonly target?: string;
  readonly buildArgs?: Record<string, string>;
  readonly labels?: Record<string, string>;
  readonly annotations?: Record<string, string>;
}

interface RegistryDefault {
  readonly hostname?: string;
  readonly repositoryPrefix?: string;
}

export const CUSTOM_REGISTRY_HOSTNAME = '__custom__';

const KNOWN_REGISTRIES: ReadonlyArray<{ readonly hostname: string; readonly label: string }> = [
  { hostname: 'docker.io', label: 'Docker Hub (docker.io)' },
  { hostname: 'ghcr.io', label: 'GitHub Container Registry (ghcr.io)' },
  { hostname: 'registry.gitlab.com', label: 'GitLab Container Registry (registry.gitlab.com)' },
  { hostname: 'gcr.io', label: 'Google Container Registry (gcr.io)' },
  { hostname: 'quay.io', label: 'Quay.io (quay.io)' },
  { hostname: 'localhost:5000', label: 'Local registry (localhost:5000)' },
];

function readImageDefaults(loaded: Record<string, unknown>): ImageDefault[] {
  if (!Array.isArray(loaded.images)) {
    return [];
  }
  return (loaded.images as ReadonlyArray<unknown>).map((entry) => {
    if (!isPlainObject(entry)) {
      return {};
    }
    const record = entry as Record<string, unknown>;
    return {
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
      ...(typeof record.contextDir === 'string' ? { contextDir: record.contextDir } : {}),
      ...(typeof record.dockerfile === 'string' ? { dockerfile: record.dockerfile } : {}),
      ...(typeof record.target === 'string' ? { target: record.target } : {}),
      ...(isPlainObject(record.buildArgs) ? { buildArgs: readStringMapDefault(record.buildArgs) } : {}),
      ...(isPlainObject(record.labels) ? { labels: readStringMapDefault(record.labels) } : {}),
      ...(isPlainObject(record.annotations) ? { annotations: readStringMapDefault(record.annotations) } : {}),
    };
  });
}

function readRegistryDefaults(loaded: Record<string, unknown>): RegistryDefault[] {
  if (!Array.isArray(loaded.registries)) {
    return [];
  }
  return (loaded.registries as ReadonlyArray<unknown>).map((entry) => {
    if (!isPlainObject(entry)) {
      return {};
    }
    const record = entry as Record<string, unknown>;
    return {
      ...(typeof record.hostname === 'string' ? { hostname: record.hostname } : {}),
      ...(typeof record.repositoryPrefix === 'string' ? { repositoryPrefix: record.repositoryPrefix } : {}),
    };
  });
}

function readStringListDefault(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return (value as ReadonlyArray<unknown>).filter((entry) => typeof entry === 'string') as string[];
}

function readStringDefault(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumberDefault(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function readBooleanDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readStringMapDefault(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const key of Object.keys(record)) {
    if (typeof record[key] === 'string') {
      result[key] = record[key] as string;
    }
  }
  return result;
}

function readProcessLimitDefault(value: unknown, key: string): number | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return typeof record[key] === 'number' ? (record[key] as number) : undefined;
}

async function promptLine(
  prompter: Prompter,
  message: string,
  fallback: string | undefined,
  validateValue: (value: string) => string | undefined,
  emptyError: string,
): Promise<string> {
  const settled = fallback !== undefined && fallback.length > 0 ? fallback : undefined;
  const raw = await prompter.text({
    message,
    ...(settled === undefined ? {} : { placeholder: settled }),
    validate: (value: string) => {
      if (value.trim().length === 0) {
        return settled === undefined ? emptyError : undefined;
      }
      return validateValue(value.trim());
    },
  });
  if (raw.trim().length === 0) {
    return settled === undefined ? '' : settled;
  }
  return raw.trim();
}

async function promptOptionalLine(
  prompter: Prompter,
  message: string,
  fallback: string | undefined,
  validateValue: (value: string) => string | undefined,
): Promise<string> {
  const settled = fallback !== undefined && fallback.length > 0 ? fallback : undefined;
  const raw = await prompter.text({
    message,
    ...(settled === undefined ? {} : { placeholder: settled }),
    validate: (value: string) => {
      if (value.trim().length === 0) {
        return undefined;
      }
      return validateValue(value.trim());
    },
  });
  if (raw.trim().length === 0) {
    return settled === undefined ? '' : settled;
  }
  return raw.trim();
}

async function promptImageEntries(
  prompter: Prompter,
  defaults: ReadonlyArray<ImageDefault>,
): Promise<DockerPublishImageOptions[]> {
  const entries: DockerPublishImageOptions[] = [];
  let index = 0;
  for (;;) {
    const fallback = index < defaults.length ? (defaults[index] as ImageDefault) : undefined;
    const label = `images[${index}]`;
    const name = await promptLine(
      prompter,
      `Image ${index + 1} name`,
      fallback?.name,
      validateImageNameValue(`${label}.name`),
      `${label}.name must be a non-empty string`,
    );
    const contextDir = await promptLine(
      prompter,
      `Image ${index + 1} context directory`,
      fallback?.contextDir ?? '.',
      validateRelativePathValue(`${label}.contextDir`),
      `${label}.contextDir must be a non-empty string`,
    );
    const dockerfileDefault = fallback?.dockerfile ?? `${contextDir}/Dockerfile`;
    const dockerfile = await promptLine(
      prompter,
      `Image ${index + 1} Dockerfile`,
      dockerfileDefault,
      validateRelativePathValue(`${label}.dockerfile`),
      `${label}.dockerfile must be a non-empty string`,
    );
    const target = await promptOptionalLine(
      prompter,
      `Image ${index + 1} build target (optional)`,
      fallback?.target,
      validateTargetValue(`${label}.target`),
    );
    entries.push({
      name,
      contextDir,
      ...(fallback?.dockerfile === undefined && dockerfile === `${contextDir}/Dockerfile` ? {} : { dockerfile }),
      ...(target.length === 0 ? {} : { target }),
      ...(fallback?.buildArgs === undefined ? {} : { buildArgs: { ...fallback.buildArgs } }),
      ...(fallback?.labels === undefined ? {} : { labels: { ...fallback.labels } }),
      ...(fallback?.annotations === undefined ? {} : { annotations: { ...fallback.annotations } }),
    });
    index += 1;
    if (!(await prompter.confirm({ message: 'Add another image?', initialValue: false }))) {
      break;
    }
  }
  return entries;
}

async function promptRegistryEntries(
  prompter: Prompter,
  defaults: ReadonlyArray<RegistryDefault>,
): Promise<DockerPublishRegistryOptions[]> {
  const entries: DockerPublishRegistryOptions[] = [];
  const knownHostnames = KNOWN_REGISTRIES.map((entry) => entry.hostname);
  let index = 0;
  for (;;) {
    const fallback = index < defaults.length ? (defaults[index] as RegistryDefault) : undefined;
    const label = `registries[${index}]`;
    const fallbackHostname = fallback?.hostname;
    const fallbackKnown = fallbackHostname !== undefined && knownHostnames.indexOf(fallbackHostname) >= 0;
    const choice = await prompter.select({
      message: `Registry ${index + 1} hostname`,
      options: [
        ...KNOWN_REGISTRIES.map((entry) => ({ value: entry.hostname, label: entry.label })),
        { value: CUSTOM_REGISTRY_HOSTNAME, label: 'Custom hostname…' },
      ],
      initialValue:
        fallbackHostname === undefined ? 'docker.io' : fallbackKnown ? fallbackHostname : CUSTOM_REGISTRY_HOSTNAME,
    });
    let hostname: string;
    if (choice === CUSTOM_REGISTRY_HOSTNAME) {
      hostname = await promptLine(
        prompter,
        `Registry ${index + 1} custom hostname`,
        fallbackKnown ? undefined : fallbackHostname,
        validateRegistryHostnameValue(`${label}.hostname`),
        `${label}.hostname must be a non-empty string`,
      );
    } else {
      hostname = choice;
    }
    const repositoryPrefix = await promptOptionalLine(
      prompter,
      `Registry ${index + 1} repository prefix (optional)`,
      fallback?.repositoryPrefix,
      validateRepositoryPrefixValue(`${label}.repositoryPrefix`),
    );
    entries.push({ hostname, ...(repositoryPrefix.length === 0 ? {} : { repositoryPrefix }) });
    index += 1;
    if (!(await prompter.confirm({ message: 'Add another registry?', initialValue: false }))) {
      break;
    }
  }
  return entries;
}

function splitCommaList(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

async function promptTags(prompter: Prompter, defaults: ReadonlyArray<string>): Promise<string[]> {
  const fallback = defaults.length > 0 ? defaults.join(', ') : undefined;
  const answered = await promptLine(
    prompter,
    'Tags (comma-separated)',
    fallback,
    validateTagListValue,
    'tags must contain at least one entry',
  );
  return splitCommaList(answered);
}

function validateTagListValue(value: string): string | undefined {
  const tags = splitCommaList(value);
  if (tags.length === 0) {
    return 'tags must contain at least one entry';
  }
  const seen = new Set<string>();
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index] as string;
    if (!/^[a-z0-9_][a-z0-9_.-]{0,127}$/u.test(tag)) {
      return `tags[${index}] must match Docker tag rules [a-z0-9_][a-z0-9_.-]{0,127} (max 128 chars): ${tag}`;
    }
    if (seen.has(tag)) {
      return `Duplicate tag: ${tag}`;
    }
    seen.add(tag);
  }
  return undefined;
}

interface PlatformAnswers {
  readonly entries: string[];
  readonly allowCustomPlatforms: boolean;
}

async function promptPlatforms(
  prompter: Prompter,
  defaults: ReadonlyArray<string>,
  allowCustom: boolean,
): Promise<PlatformAnswers> {
  const fallback = defaults.length > 0 ? defaults.join(', ') : undefined;
  let custom = allowCustom;
  for (;;) {
    const answered = await promptLine(
      prompter,
      'Platforms (comma-separated os/arch[/variant])',
      fallback,
      validatePlatformListValue,
      'platforms must contain at least one entry',
    );
    const entries = splitCommaList(answered);
    if (!custom && hasUnknownPlatform(entries)) {
      const allow = await prompter.confirm({
        message: 'Unknown os/arch detected. Allow custom platforms?',
        initialValue: false,
      });
      if (!allow) {
        continue;
      }
      custom = true;
    }
    return { entries, allowCustomPlatforms: custom };
  }
}

function validatePlatformListValue(value: string): string | undefined {
  const entries = splitCommaList(value);
  if (entries.length === 0) {
    return 'platforms must contain at least one entry';
  }
  const seen = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as string;
    const label = `platforms[${index}]`;
    const problem = validatePlatformEntry(entry, label);
    if (problem !== undefined) {
      return problem;
    }
    if (seen.has(entry)) {
      return `Duplicate platform: ${entry}`;
    }
    seen.add(entry);
  }
  return undefined;
}

function validatePlatformEntry(entry: string, label: string): string | undefined {
  if (entry.length === 0) {
    return `${label} must be a non-empty string`;
  }
  if (entry.includes('\0')) {
    return `${label} must not contain NUL bytes`;
  }
  const parts = entry.split('/');
  if (parts.length < 2 || parts.length > 3) {
    return `${label} must use os/arch[/variant] form: ${entry}`;
  }
  const os = parts[0] as string;
  const arch = parts[1] as string;
  const variant = parts.length === 3 ? (parts[2] as string) : undefined;
  if (!/^[a-z0-9]+$/u.test(os)) {
    return `${label} os must contain only lowercase ASCII letters and digits: ${entry}`;
  }
  if (!/^[a-z0-9]+$/u.test(arch)) {
    return `${label} arch must contain only lowercase ASCII letters and digits: ${entry}`;
  }
  if (variant !== undefined && !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(variant)) {
    return `${label} variant is not a valid platform variant: ${entry}`;
  }
  return undefined;
}

function hasUnknownPlatform(entries: ReadonlyArray<string>): boolean {
  for (const entry of entries) {
    const parts = entry.split('/');
    const os = parts[0] as string;
    const arch = parts[1] as string;
    if (!KNOWN_OS.has(os) || !KNOWN_ARCH.has(arch)) {
      return true;
    }
  }
  return false;
}

interface AdvancedAnswers {
  readonly values: Record<string, unknown>;
  readonly allowCustomPlatforms: boolean;
}

async function promptAdvanced(
  prompter: Prompter,
  loaded: Record<string, unknown>,
  allowCustomPlatforms: boolean,
): Promise<AdvancedAnswers> {
  const customize = await prompter.confirm({
    message:
      'Customize advanced settings (build args, labels, annotations, cache, concurrency, executable, OCI export)?',
    initialValue: false,
  });
  if (!customize) {
    const values: Record<string, unknown> = {};
    for (const key of ADVANCED_KEYS) {
      if (loaded[key] !== undefined) {
        values[key] = loaded[key];
      }
    }
    return { values, allowCustomPlatforms };
  }
  const allowSecrets = await prompter.confirm({
    message: 'Allow secret-looking keys in build args and labels?',
    initialValue: readBooleanDefault(loaded.allowSecretsInBuildArgs, false),
  });
  const buildArgs = await promptKeyValueMap(
    prompter,
    'Global build args (comma-separated KEY=VALUE, empty for none)',
    'buildArgs',
    readStringMapDefault(loaded.buildArgs),
    allowSecrets,
  );
  const labels = await promptKeyValueMap(
    prompter,
    'Global labels (comma-separated KEY=VALUE, empty for none)',
    'labels',
    readStringMapDefault(loaded.labels),
    allowSecrets,
  );
  const annotations = await promptKeyValueMap(
    prompter,
    'Global annotations (comma-separated KEY=VALUE, empty for none)',
    'annotations',
    readStringMapDefault(loaded.annotations),
    allowSecrets,
  );
  const cacheFrom = await promptCacheSpecs(
    prompter,
    'Global cache-from specs (one spec per line, empty for none)',
    'cacheFrom',
    readStringListDefault(loaded.cacheFrom),
  );
  const cacheTo = await promptCacheSpecs(
    prompter,
    'Global cache-to specs (one spec per line, empty for none)',
    'cacheTo',
    readStringListDefault(loaded.cacheTo),
  );
  const buildConcurrency = await promptPositiveInteger(
    prompter,
    'Build concurrency',
    readNumberDefault(loaded.buildConcurrency) ?? 2,
    'buildConcurrency',
    MAX_BUILD_CONCURRENCY,
  );
  const timeoutMs = await promptPositiveInteger(
    prompter,
    'Process timeout in milliseconds',
    readProcessLimitDefault(loaded.processLimits, 'timeoutMs') ?? DEFAULT_PROCESS_TIMEOUT_MS,
    'processLimits.timeoutMs',
  );
  const maxOutputBytes = await promptPositiveInteger(
    prompter,
    'Process maximum output in bytes',
    readProcessLimitDefault(loaded.processLimits, 'maxOutputBytes') ?? DEFAULT_PROCESS_MAX_OUTPUT_BYTES,
    'processLimits.maxOutputBytes',
  );
  const dockerExecutable = await promptLine(
    prompter,
    'Docker executable',
    readStringDefault(loaded.dockerExecutable) ?? 'docker',
    validateDockerExecutableValue,
    'dockerExecutable must be a non-empty string',
  );
  const ociExportDir = await promptOptionalLine(
    prompter,
    'OCI export directory (project-root-relative, empty for none)',
    readStringDefault(loaded.ociExportDir),
    validateOciExportDirValue,
  );
  return {
    values: {
      buildArgs,
      labels,
      annotations,
      cacheFrom,
      cacheTo,
      buildConcurrency,
      processLimits: { timeoutMs, maxOutputBytes },
      dockerExecutable,
      ...(ociExportDir.length === 0 ? {} : { ociExportDir }),
      allowSecretsInBuildArgs: allowSecrets,
    },
    allowCustomPlatforms,
  };
}

async function promptKeyValueMap(
  prompter: Prompter,
  message: string,
  label: string,
  defaults: Record<string, string>,
  allowSecrets: boolean,
): Promise<Record<string, string>> {
  const keys = Object.keys(defaults);
  const fallback = keys.length > 0 ? keys.map((key) => `${key}=${defaults[key] as string}`).join(', ') : undefined;
  const raw = await prompter.text({
    message,
    ...(fallback === undefined ? {} : { placeholder: fallback }),
    validate: (value: string) => {
      if (value.trim().length === 0) {
        return undefined;
      }
      return validateKeyValueText(value.trim(), label, allowSecrets);
    },
  });
  if (raw.trim().length === 0) {
    return fallback === undefined ? {} : { ...defaults };
  }
  return parseKeyValueText(raw.trim());
}

function splitKeyValueLines(text: string): string[] {
  return text
    .split(/[,\n]/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function validateKeyValueText(text: string, label: string, allowSecrets: boolean): string | undefined {
  const lines = splitKeyValueLines(text);
  if (lines.length > MAX_MAP_ENTRIES) {
    return `${label} must not contain more than ${MAX_MAP_ENTRIES} entries`;
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    const problem = validateKeyValueLine(line, index, label, allowSecrets);
    if (problem !== undefined) {
      return problem;
    }
  }
  return undefined;
}

function validateKeyValueLine(line: string, index: number, label: string, allowSecrets: boolean): string | undefined {
  const separator = line.indexOf('=');
  if (separator <= 0) {
    return `${label}[${index}] must use KEY=VALUE form: ${line}`;
  }
  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (key.length === 0 || key.length > MAX_MAP_KEY_LENGTH) {
    return `${label} keys must be 1-${MAX_MAP_KEY_LENGTH} characters long`;
  }
  if (/\s/u.test(key) || containsControlCharacter(key)) {
    return `${label} key must not contain whitespace or control characters: ${key}`;
  }
  if (value.includes('\0')) {
    return `${label}.${key} must not contain NUL bytes`;
  }
  if (value.length > MAX_MAP_VALUE_LENGTH) {
    return `${label}.${key} must not exceed ${MAX_MAP_VALUE_LENGTH} characters`;
  }
  if (!allowSecrets && SECRET_KEY_PATTERN.test(key.toUpperCase())) {
    return (
      `${label}.${key} looks like a secret; refusing to embed it in build configuration ` +
      'unless allowSecretsInBuildArgs is true'
    );
  }
  return undefined;
}

function parseKeyValueText(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of splitKeyValueLines(text)) {
    const separator = line.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return result;
}

async function promptCacheSpecs(
  prompter: Prompter,
  message: string,
  label: string,
  defaults: ReadonlyArray<string>,
): Promise<string[]> {
  const fallback = defaults.length > 0 ? defaults.join('\n') : undefined;
  const raw = await prompter.text({
    message,
    ...(fallback === undefined ? {} : { placeholder: fallback }),
    validate: (value: string) => {
      if (value.trim().length === 0) {
        return undefined;
      }
      return validateCacheSpecLines(value, label);
    },
  });
  if (raw.trim().length === 0) {
    return fallback === undefined ? [] : [...defaults];
  }
  return splitCacheSpecLines(raw);
}

function splitCacheSpecLines(text: string): string[] {
  return text
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function validateCacheSpecLines(text: string, label: string): string | undefined {
  const lines = splitCacheSpecLines(text);
  if (lines.length > MAX_CACHE_SPECS) {
    return `${label} must not contain more than ${MAX_CACHE_SPECS} entries`;
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    if (line.includes('\0')) {
      return `${label}[${index}] must not contain NUL bytes`;
    }
    if (line.length > MAX_CACHE_SPEC_LENGTH) {
      return `${label}[${index}] must not exceed ${MAX_CACHE_SPEC_LENGTH} characters`;
    }
  }
  return undefined;
}

function validateOciExportDirValue(value: string): string | undefined {
  if (value.includes('\0')) {
    return 'ociExportDir must not contain NUL bytes';
  }
  const slashPath = value.replace(/\\/gu, '/');
  if (isAbsolute(value) || slashPath.startsWith('/') || /^[A-Za-z]:\//u.test(slashPath)) {
    return `ociExportDir must be relative: ${value}`;
  }
  const parts = slashPath.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.indexOf('..') >= 0) {
    return `ociExportDir must be a non-root path without parent-directory segments: ${value}`;
  }
  return undefined;
}

async function promptPositiveInteger(
  prompter: Prompter,
  message: string,
  fallbackValue: number,
  label: string,
  max?: number,
): Promise<number> {
  const answered = await promptLine(
    prompter,
    message,
    String(fallbackValue),
    (value: string) => validatePositiveIntegerValue(value, label, max),
    `${label} must be a positive safe integer`,
  );
  return Number(answered);
}

function validatePositiveIntegerValue(value: string, label: string, max?: number): string | undefined {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return `${label} must be a positive safe integer`;
  }
  if (max !== undefined && parsed > max) {
    return `${label} must not exceed ${max}`;
  }
  return undefined;
}

function validateDockerExecutableValue(value: string): string | undefined {
  if (value.length === 0) {
    return 'dockerExecutable must be a non-empty string';
  }
  if (value.includes('\0')) {
    return 'dockerExecutable must not contain NUL bytes';
  }
  return undefined;
}

function validateImageNameValue(label: string): (value: string) => string | undefined {
  return (value: string) => {
    if (value.length > 255) {
      return `${label} must not exceed 255 characters`;
    }
    if (!/^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*)(?:\/(?:[a-z0-9]+(?:[._-][a-z0-9]+)*))*$/u.test(value)) {
      return `${label} must be a lowercase Docker repository name: ${value}`;
    }
    return undefined;
  };
}

function validateRelativePathValue(label: string): (value: string) => string | undefined {
  return (value: string) => {
    if (value.includes('\0')) {
      return `${label} must not contain NUL bytes`;
    }
    const slashPath = value.replace(/\\/gu, '/');
    if (isAbsolute(value) || slashPath.startsWith('/') || /^[A-Za-z]:\//u.test(slashPath)) {
      return `${label} must be relative: ${value}`;
    }
    const parts = slashPath.split('/').filter((part) => part !== '' && part !== '.');
    if (parts.indexOf('..') >= 0) {
      return `${label} must be a non-root path without parent-directory segments: ${value}`;
    }
    return undefined;
  };
}

function validateTargetValue(label: string): (value: string) => string | undefined {
  return (value: string) => {
    if (value.length > 128) {
      return `${label} must not exceed 128 characters`;
    }
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/u.test(value)) {
      return `${label} is not a valid build stage name: ${value}`;
    }
    return undefined;
  };
}

function validateRegistryHostnameValue(label: string): (value: string) => string | undefined {
  return (value: string) => {
    if (value.length > 255) {
      return `${label} must not exceed 255 characters`;
    }
    if (value !== value.toLowerCase()) {
      return `${label} must be lowercase: ${value}`;
    }
    if (value.includes('://')) {
      return `${label} must be a hostname without a scheme: ${value}`;
    }
    if (value.includes('/')) {
      return `${label} must be a hostname without a path: ${value}`;
    }
    if (value.includes('@')) {
      return `${label} must be a hostname without userinfo: ${value}`;
    }
    if (/\s/u.test(value)) {
      return `${label} must not contain whitespace: ${value}`;
    }
    const colonCount = value.split(':').length - 1;
    if (colonCount > 1) {
      return `${label} must be a hostname with at most one port: ${value}`;
    }
    let host = value;
    if (colonCount === 1) {
      const portText = value.slice(value.lastIndexOf(':') + 1);
      host = value.slice(0, value.lastIndexOf(':'));
      if (!/^[0-9]+$/u.test(portText)) {
        return `${label} port must be numeric: ${value}`;
      }
      const port = Number(portText);
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
        return `${label} port must be 1-65535: ${value}`;
      }
    }
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/u.test(host)) {
      return `${label} is not a valid registry hostname: ${value}`;
    }
    return undefined;
  };
}

function validateRepositoryPrefixValue(label: string): (value: string) => string | undefined {
  return (value: string) => {
    if (value.length > 255) {
      return `${label} must not exceed 255 characters`;
    }
    if (value !== value.toLowerCase()) {
      return `${label} must be lowercase: ${value}`;
    }
    if (value.includes('\0') || value.includes('{') || value.includes('}')) {
      return `${label} contains unsupported characters: ${value}`;
    }
    for (const segment of value.split('/')) {
      if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(segment)) {
        return `${label} must be a slash-separated lowercase repository path: ${value}`;
      }
    }
    return undefined;
  };
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

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

type InteractivePasswordChoice = 'use-env' | 'enter-new';

export interface InteractiveAuthCredentials {
  readonly username: string;
  readonly password: string;
}

export type InteractiveAuthValues = Readonly<Record<string, InteractiveAuthCredentials>>;

export interface InteractiveAuthResolution {
  readonly auth: Readonly<Record<string, DockerPublishRegistryAuth>>;
  readonly authValues: InteractiveAuthValues;
}

export type InteractiveRunner = DockerLoginRunner;

export interface InteractiveAuthAndConfirmOptions {
  readonly operation: string;
  readonly requiresPush: boolean;
  readonly dryRun?: boolean;
  readonly printSummaryFn?: (summary: object) => void;
}

export interface InteractiveAuthAndConfirmResult extends InteractiveAuthResolution {
  readonly secrets: string[];
  readonly confirmed: boolean;
  readonly dryRun: boolean;
}

export async function promptInteractiveAuth(
  prompter: Prompter,
  registries: ReadonlyArray<{ readonly hostname: string }>,
  configuredAuth: Readonly<Record<string, DockerPublishRegistryAuth>> = {},
): Promise<InteractiveAuthResolution> {
  validateDockerPublishAuthMap(configuredAuth);
  const auth: Record<string, DockerPublishRegistryAuth> = {};
  const authValues: Record<string, InteractiveAuthCredentials> = {};
  for (const registry of registries) {
    const hostname = registry.hostname;
    const configured = Object.prototype.hasOwnProperty.call(configuredAuth, hostname)
      ? (configuredAuth[hostname] as DockerPublishRegistryAuth)
      : undefined;
    const configuredUsername = configured?.username;
    let promptedUsername: string;
    let promptedUsernameEnv: string | undefined;
    if (configuredUsername !== undefined) {
      promptedUsername = await promptLine(
        prompter,
        `Username for registry ${hostname}`,
        configuredUsername,
        (value: string) => validateDockerPublishUsername(value, `auth[${JSON.stringify(hostname)}].username`),
        `auth[${JSON.stringify(hostname)}].username must be a non-empty string`,
      );
    } else {
      promptedUsernameEnv = await promptEnvVarName(
        prompter,
        `Registry ${hostname} username env var`,
        `auth[${JSON.stringify(hostname)}].usernameEnv`,
        configured?.usernameEnv,
      );
      promptedUsername = await promptUsernameValue(prompter, hostname, promptedUsernameEnv);
    }
    const passwordEnv = await promptEnvVarName(
      prompter,
      `Registry ${hostname} password env var`,
      `auth[${JSON.stringify(hostname)}].passwordEnv`,
      configured?.passwordEnv,
    );
    const password = await promptPasswordValue(prompter, hostname, passwordEnv);
    auth[hostname] =
      promptedUsernameEnv === undefined
        ? { username: promptedUsername, passwordEnv }
        : { usernameEnv: promptedUsernameEnv, passwordEnv };
    authValues[hostname] = { username: promptedUsername, password };
  }
  return { auth, authValues };
}

export function collectInteractiveSecrets(
  plan: DockerPublishPlan,
  auth: Readonly<Record<string, DockerPublishRegistryAuth>>,
  authValues: InteractiveAuthValues,
): string[] {
  const secrets = collectCliSecrets(plan, auth);
  for (const hostname of Object.keys(authValues)) {
    const entry = authValues[hostname] as InteractiveAuthCredentials;
    if (typeof entry.username === 'string' && entry.username.length > 0 && secrets.indexOf(entry.username) < 0) {
      secrets.push(entry.username);
    }
    if (typeof entry.password === 'string' && entry.password.length > 0 && secrets.indexOf(entry.password) < 0) {
      secrets.push(entry.password);
    }
  }
  return secrets;
}

export async function loginWithInteractiveAuth(
  runner: InteractiveRunner,
  plan: DockerPublishPlan,
  auth: Readonly<Record<string, DockerPublishRegistryAuth>>,
  authValues: InteractiveAuthValues,
  secrets: ReadonlyArray<string> = [],
): Promise<void> {
  const credentials = resolveInteractiveCredentials(auth, authValues);
  const combined = [...secrets];
  for (const credential of credentials) {
    if (combined.indexOf(credential.username) < 0) {
      combined.push(credential.username);
    }
    if (combined.indexOf(credential.password) < 0) {
      combined.push(credential.password);
    }
  }
  await loginRegistries(runner, plan, credentials, combined);
}

function resolveInteractiveCredentials(
  auth: Readonly<Record<string, DockerPublishRegistryAuth>>,
  authValues: InteractiveAuthValues,
): DockerRegistryCredentials[] {
  const hostnames = Object.keys(auth).sort();
  const resolved: DockerRegistryCredentials[] = [];
  for (const hostname of hostnames) {
    const spec = auth[hostname] as DockerPublishRegistryAuth;
    const ephemeral = Object.prototype.hasOwnProperty.call(authValues, hostname)
      ? (authValues[hostname] as InteractiveAuthCredentials)
      : undefined;
    const literal = spec.username;
    const envName = spec.usernameEnv;
    const envUsername = envName !== undefined ? process.env[envName] : undefined;
    const envPassword = process.env[spec.passwordEnv];
    const username =
      ephemeral !== undefined
        ? ephemeral.username
        : literal !== undefined
          ? literal
          : typeof envUsername === 'string'
            ? envUsername
            : '';
    const password = ephemeral !== undefined ? ephemeral.password : typeof envPassword === 'string' ? envPassword : '';
    if (username.length === 0) {
      throw new Error(
        envName !== undefined
          ? `Missing username for registry ${hostname} in environment variable ${envName}`
          : `Missing username for registry ${hostname}`,
      );
    }
    if (password.length === 0) {
      throw new Error(`Missing password for registry ${hostname} in environment variable ${spec.passwordEnv}`);
    }
    resolved.push({ hostname, username, password });
  }
  return resolved;
}

export async function confirmInteractiveProceed(
  prompter: Prompter,
  options: { readonly requiresPush: boolean },
): Promise<void> {
  const proceed = await prompter.confirm({ message: 'Proceed?', initialValue: !options.requiresPush });
  if (!proceed) {
    throw new Error('Operation cancelled.');
  }
}

export async function resolveInteractiveAuthAndConfirm(
  prompter: Prompter,
  plan: DockerPublishPlan,
  configuredAuth: Readonly<Record<string, DockerPublishRegistryAuth>>,
  options: InteractiveAuthAndConfirmOptions,
): Promise<InteractiveAuthAndConfirmResult> {
  validateDockerPublishAuthMap(configuredAuth);
  const print = options.printSummaryFn ?? printSummary;
  if (options.dryRun === true) {
    print(planSummary(options.operation, plan, true));
    return { auth: {}, authValues: {}, secrets: [], confirmed: false, dryRun: true };
  }
  const resolved = await promptInteractiveAuth(prompter, plan.registries, configuredAuth);
  const secrets = collectInteractiveSecrets(plan, resolved.auth, resolved.authValues);
  print(planSummary(options.operation, plan, false));
  await confirmInteractiveProceed(prompter, { requiresPush: options.requiresPush });
  return { auth: resolved.auth, authValues: resolved.authValues, secrets, confirmed: true, dryRun: false };
}

function validateEnvVarNameValue(label: string): (value: string) => string | undefined {
  return (value: string) => {
    if (!ENV_NAME_PATTERN.test(value)) {
      return `${label} must be a valid environment variable name: ${value}`;
    }
    return undefined;
  };
}

async function promptEnvVarName(
  prompter: Prompter,
  message: string,
  label: string,
  fallback: string | undefined,
): Promise<string> {
  return promptLine(prompter, message, fallback, validateEnvVarNameValue(label), `${label} must be a non-empty string`);
}

async function promptUsernameValue(prompter: Prompter, hostname: string, usernameEnv: string): Promise<string> {
  const current = process.env[usernameEnv];
  const settled = typeof current === 'string' && current.length > 0 ? current : undefined;
  const raw = await prompter.text({
    message:
      settled === undefined
        ? `Username for registry ${hostname} (${usernameEnv} is unset)`
        : `Username for registry ${hostname} (default $${usernameEnv} from environment)`,
    ...(settled === undefined ? {} : { placeholder: settled }),
    validate: (value: string) => {
      if (value.trim().length === 0) {
        return settled === undefined ? `Username for registry ${hostname} must be a non-empty string` : undefined;
      }
      return undefined;
    },
  });
  if (raw.trim().length === 0) {
    return settled === undefined ? '' : settled;
  }
  return raw.trim();
}

async function promptPasswordValue(prompter: Prompter, hostname: string, passwordEnv: string): Promise<string> {
  const current = process.env[passwordEnv];
  const settled = typeof current === 'string' && current.length > 0 ? current : undefined;
  if (settled !== undefined) {
    const choice = await prompter.select<InteractivePasswordChoice>({
      message: `Password for registry ${hostname} ($${passwordEnv} is set)`,
      options: [
        { value: 'use-env', label: `Use $${passwordEnv} from environment` },
        { value: 'enter-new', label: 'Enter a new password' },
      ],
      initialValue: 'use-env',
    });
    if (choice === 'use-env') {
      return settled;
    }
  }
  const entered = await prompter.password({
    message:
      settled === undefined
        ? `Password for registry ${hostname} (${passwordEnv} is unset)`
        : `New password for registry ${hostname}`,
    validate: (value: string) => {
      if (value.length === 0) {
        return `Password for registry ${hostname} must be a non-empty string`;
      }
      return undefined;
    },
  });
  return entered;
}
