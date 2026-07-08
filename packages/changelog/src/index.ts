import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
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

type PipelineOptions = Pick<
  GenerateChangelogOptions,
  'append' | 'releaseCount' | 'skipUnstable' | 'outputUnreleased' | 'tagPrefix' | 'firstRelease'
>;

type ExtendedChangelogOptions = ChangelogOptions & PipelineOptions;

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
  formatIssueUrl?: (context: ChangelogContext, reference: ChangelogReference) => string;
  formatCommitUrl?: (context: ChangelogContext, commit: ChangelogCommit) => string;
  formatCompareUrl?: (context: ChangelogContext) => string;
  formatUserUrl?: (context: ChangelogContext, user: string) => string;
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

function resolveOutputPath(cwd: string, outputFile: string) {
  return isAbsolute(outputFile) ? outputFile : resolve(cwd, outputFile);
}

function pipeGeneratorToFile(generator: ConventionalChangelog, outputPath: string) {
  return new Promise<string>((resolvePromise, reject) => {
    const generatorStream = generator.writeStream();
    const fileStream = createWriteStream(outputPath);

    const onError = (error: Error) => {
      generatorStream.off('error', onError);
      fileStream.off('error', onError);
      fileStream.off('finish', onFinish);
      reject(error);
    };

    const onFinish = () => {
      generatorStream.off('error', onError);
      fileStream.off('error', onError);
      fileStream.off('finish', onFinish);
      resolvePromise(outputPath);
    };

    generatorStream.on('error', onError);
    fileStream.on('error', onError);
    fileStream.on('finish', onFinish);
    generatorStream.pipe(fileStream);
  });
}

export async function createPreset(options: CreatePresetOptions = {}) {
  const preset = await createConventionalCommitsPreset(resolvePresetOptions(options));

  return {
    ...preset,
    name: 'conventionalcommits',
  };
}

export async function createGenerator(options: GenerateChangelogOptions = {}) {
  const presetOptions = splitPresetOptions(options);
  const preset = await createPreset(presetOptions);
  const generator = new ConventionalChangelog();

  const generatorOptions: ExtendedChangelogOptions = {
    append: options.append ?? false,
    releaseCount: options.releaseCount ?? 0,
    skipUnstable: options.skipUnstable ?? true,
    outputUnreleased: options.outputUnreleased ?? true,
    tagPrefix: options.tagPrefix ?? 'v',
    firstRelease: options.firstRelease ?? false,
  };

  generator.readPackage().loadPreset(preset).options(generatorOptions).config({
    tags: preset.tags,
    commits: preset.commits,
    parser: preset.parser,
    writer: preset.writer,
  });

  return generator;
}

export async function generateChangelog(options: GenerateChangelogOptions = {}) {
  const initialCwd = process.cwd();
  const cwd = resolve(options.cwd ?? initialCwd);
  const outputPath = resolveOutputPath(cwd, options.outputFile ?? 'CHANGELOG.md');

  await mkdir(dirname(outputPath), { recursive: true });

  if (cwd !== initialCwd) {
    process.chdir(cwd);
  }

  try {
    const generator = await createGenerator(options);
    return await pipeGeneratorToFile(generator, outputPath);
  } finally {
    if (cwd !== initialCwd) {
      process.chdir(initialCwd);
    }
  }
}
