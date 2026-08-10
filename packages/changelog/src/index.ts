import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { ConventionalChangelog, type Options as ChangelogOptions } from 'conventional-changelog';
import createConventionalCommitsPreset from 'conventional-changelog-conventionalcommits';

const PIPELINE_OPTION_KEYS = [
  'cwd',
  'outputFile',
  'append',
  'releaseCount',
  'skipUnstable',
  'outputUnreleased',
  'tagPrefix',
  'firstRelease',
] as const;

function splitPresetOptions(options: GenerateChangelogOptions): CreatePresetOptions {
  const presetOptions: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if ((PIPELINE_OPTION_KEYS as readonly string[]).includes(key)) {
      continue;
    }
    presetOptions[key] = value;
  }
  return presetOptions as CreatePresetOptions;
}

export interface ChangelogType {
  type: string;
  section?: string;
  scope?: string;
  effect?: 'bump' | 'changelog' | 'hidden';
  hidden?: boolean;
}

export interface ChangelogContext {
  [key: string]: unknown;
}

export interface ChangelogReference {
  prefix?: string;
  issue?: string;
  [key: string]: unknown;
}

export interface ChangelogCommit {
  hash?: string;
  type?: string;
  scope?: string;
  subject?: string;
  [key: string]: unknown;
}

export interface ConventionalCommitsPresetOptions {
  types?: ReadonlyArray<ChangelogType>;
  ignoreCommits?: RegExp;
  issuePrefixes?: ReadonlyArray<string>;
  scope?: string | ReadonlyArray<string>;
  scopeOnly?: boolean;
  preMajor?: boolean;
  issueUrlFormat?: string;
  commitUrlFormat?: string;
  compareUrlFormat?: string;
  userUrlFormat?: string;
  bumpStrict?: boolean;
}

export type CreatePresetOptions = ConventionalCommitsPresetOptions;

export interface GenerateChangelogOptions extends CreatePresetOptions {
  cwd?: string;
  outputFile?: string;
  append?: boolean;
  releaseCount?: number;
  skipUnstable?: boolean;
  outputUnreleased?: boolean;
  tagPrefix?: string;
  firstRelease?: boolean;
}

export type ChangelogConfig = GenerateChangelogOptions;

export const DEFAULT_TYPES: ReadonlyArray<ChangelogType> = [
  {
    type: 'feat',
    section: 'Features',
  },
  {
    type: 'fix',
    scope: 'deps',
    effect: 'hidden',
  },
  {
    type: 'fix',
    section: 'Bug Fixes',
  },
  {
    type: 'revert',
    section: 'Reverts',
  },
  {
    type: 'docs',
    section: 'Documentation',
  },
  {
    type: 'refactor',
    section: 'Code Refactoring',
  },
  {
    type: 'perf',
    section: 'Performance Improvements',
  },
  {
    type: 'build',
    section: 'Build System',
  },
  {
    type: 'e2e',
    section: 'End-to-end Testing',
  },
  {
    type: 'ci',
    effect: 'hidden',
  },
  {
    type: 'chore',
    effect: 'hidden',
  },
  {
    type: 'style',
    effect: 'hidden',
  },
  {
    type: 'test',
    effect: 'hidden',
  },
  {
    type: 'release',
    effect: 'hidden',
  },
];

function normalizeTypes(types: ReadonlyArray<ChangelogType>) {
  return types.map((entry) => ({
    ...entry,
    hidden: entry.effect === 'hidden' ? true : entry.hidden,
  }));
}

function resolvePresetOptions(options: CreatePresetOptions = {}) {
  return {
    ...options,
    types: normalizeTypes(options.types ?? DEFAULT_TYPES),
  };
}

function resolveTagOptions(options: GenerateChangelogOptions) {
  const tags: { prefix?: string; skipUnstable?: boolean } = {};

  if (options.tagPrefix !== undefined) {
    tags.prefix = options.tagPrefix;
  }

  if (options.skipUnstable !== undefined) {
    tags.skipUnstable = options.skipUnstable;
  }

  return tags;
}

function resolveGeneratorOptions(options: GenerateChangelogOptions): ChangelogOptions {
  const resolvedOptions: ChangelogOptions = {
    append: options.append ?? false,
    outputUnreleased: options.outputUnreleased ?? true,
  };

  if (options.firstRelease === true) {
    resolvedOptions.releaseCount = 0;
  } else if (options.releaseCount !== undefined) {
    resolvedOptions.releaseCount = validateReleaseCount(options.releaseCount);
  }

  return resolvedOptions;
}

function validateGenerateChangelogOptions(options: GenerateChangelogOptions): void {
  if (options.releaseCount !== undefined) {
    validateReleaseCount(options.releaseCount);
  }
}

function validateReleaseCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`releaseCount must be a non-negative safe integer, got: ${value}`);
  }

  return value;
}

function resolveOutputPath(cwd: string, outputFile: string) {
  return isAbsolute(outputFile) ? outputFile : resolve(cwd, outputFile);
}

async function pipeGeneratorToFile(generator: ConventionalChangelog, outputPath: string, append: boolean) {
  const tempPath = `${outputPath}.${randomUUID()}.tmp`;
  const generated = await readGeneratorOutput(generator.writeStream());
  const existing = await readExistingOutput(outputPath);
  const contents = combineChangelogContents(existing, generated, append);

  try {
    await writeFile(tempPath, contents, 'utf8');
    await rename(tempPath, outputPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }

  return outputPath;
}

function readGeneratorOutput(stream: Readable): Promise<string> {
  return new Promise<string>((resolvePromise, reject) => {
    const chunks: Buffer[] = [];

    const onData = (chunk: string | Buffer) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onEnd = () => {
      cleanup();
      resolvePromise(Buffer.concat(chunks).toString('utf8'));
    };

    const cleanup = () => {
      stream.off('data', onData);
      stream.off('error', onError);
      stream.off('end', onEnd);
    };

    stream.on('data', onData);
    stream.on('error', onError);
    stream.on('end', onEnd);
  });
}

async function readExistingOutput(outputPath: string): Promise<string | undefined> {
  try {
    return await readFile(outputPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

function combineChangelogContents(existing: string | undefined, generated: string, append: boolean): string {
  const next = trimTrailingNewlines(generated);
  const current = trimTrailingNewlines(existing ?? '');

  if (current.length === 0) {
    return `${next}\n`;
  }

  if (next.length === 0) {
    return `${current}\n`;
  }

  return append ? `${current}\n\n${next}\n` : `${next}\n\n${current}\n`;
}

function trimTrailingNewlines(value: string): string {
  return value.replace(/\n+$/u, '');
}

export async function createPreset(options: CreatePresetOptions = {}) {
  const preset = await createConventionalCommitsPreset(resolvePresetOptions(options));

  return {
    ...preset,
    name: 'conventionalcommits',
  };
}

export async function createGenerator(options: GenerateChangelogOptions = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  validateGenerateChangelogOptions(options);
  const presetOptions = splitPresetOptions(options);
  const preset = await createPreset(presetOptions);
  const generator = new ConventionalChangelog(cwd);

  generator
    .readPackage(resolve(cwd, 'package.json'))
    .loadPreset(preset)
    .options(resolveGeneratorOptions(options))
    .tags(
      resolveTagOptions({
        tagPrefix: options.tagPrefix ?? 'v',
        skipUnstable: options.skipUnstable ?? true,
      }),
    )
    .config({
      commits: preset.commits,
      parser: preset.parser,
      writer: preset.writer,
    });

  return generator;
}

export async function generateChangelog(options: GenerateChangelogOptions = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const outputPath = resolveOutputPath(cwd, options.outputFile ?? 'CHANGELOG.md');

  await mkdir(dirname(outputPath), { recursive: true });

  const generator = await createGenerator({ ...options, cwd });
  return await pipeGeneratorToFile(generator, outputPath, options.append ?? false);
}
