import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { ConventionalChangelog } from 'conventional-changelog';
import createConventionalCommitsPreset from 'conventional-changelog-conventionalcommits';

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
    type: 'docs',
    section: 'Docs',
  },
  {
    type: 'refactor',
    section: 'Refactors',
  },
  {
    type: 'e2e',
    section: 'End-to-end Testing',
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
    type: 'perf',
    effect: 'hidden',
  },
  {
    type: 'test',
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
  const {
    cwd: _cwd,
    outputFile: _outputFile,
    append: _append,
    releaseCount: _releaseCount,
    skipUnstable: _skipUnstable,
    outputUnreleased: _outputUnreleased,
    tagPrefix: _tagPrefix,
    firstRelease: _firstRelease,
    ...presetOptions
  } = options;
  const preset = await createPreset(presetOptions);
  const generator = new ConventionalChangelog();

  generator
    .readPackage()
    .loadPreset(preset)
    .options({
      append: options.append ?? false,
      releaseCount: options.releaseCount ?? 0,
      skipUnstable: options.skipUnstable ?? true,
      outputUnreleased: options.outputUnreleased ?? true,
      tagPrefix: options.tagPrefix ?? 'v',
      firstRelease: options.firstRelease ?? false,
    } as any)
    .config({
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
