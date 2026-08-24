import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { isPlainObject } from '@repo-toolkit/publish-package';

import { defaultGoReleaseRunner, type GoReleaseRunner, validateGoReleaseRunner } from './runner';

const DEFAULT_BUILD_FLAGS = ['-trimpath', '-buildvcs=false'] as const;
const DEFAULT_LINKER_FLAGS = ['-buildid='] as const;
const DEFAULT_ARCHIVE_NAME = '{tool}-{os}-{arch}.tar.gz';
const DEFAULT_CHECKSUM_FILE = 'SHA256SUMS';
const DEFAULT_PROCESS_LIMITS = {
  timeoutMs: 120_000,
  maxOutputBytes: 1_048_576,
  concurrency: 2,
} as const;

export interface GoReleaseLinkerValueOptions {
  readonly symbol: string;
  readonly value: string;
}

export interface GoReleaseVersionCommandOptions {
  readonly args?: ReadonlyArray<string>;
  readonly expectedOutput: string;
  readonly match?: 'exact' | 'anchored';
}

export interface GoReleaseBinaryOptions {
  readonly name: string;
  readonly package: string;
  readonly linkerValues?: ReadonlyArray<GoReleaseLinkerValueOptions>;
  readonly versionCommand?: GoReleaseVersionCommandOptions;
}

export interface GoReleaseTargetOptions {
  readonly os: string;
  readonly arch: string;
}

export interface GoReleaseAdditionalFileOptions {
  readonly source: string;
  readonly destination: string;
}

export interface GoReleaseProcessLimitsOptions {
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly concurrency?: number;
}

export interface GoReleaseOptions {
  readonly cwd?: string;
  readonly toolName: string;
  readonly version: string;
  readonly outputDir?: string;
  readonly goExecutable?: string;
  readonly tarExecutable?: string;
  readonly binaries: ReadonlyArray<GoReleaseBinaryOptions>;
  readonly targets: ReadonlyArray<GoReleaseTargetOptions>;
  readonly buildFlags?: ReadonlyArray<string>;
  readonly linkerFlags?: ReadonlyArray<string>;
  readonly archiveName?: string;
  readonly checksumFile?: string;
  readonly additionalFiles?: ReadonlyArray<GoReleaseAdditionalFileOptions>;
  readonly sourceDateEpoch?: number;
  readonly processLimits?: GoReleaseProcessLimitsOptions;
  readonly runner?: GoReleaseRunner;
}

export interface GoReleaseLinkerValue {
  readonly symbol: string;
  readonly value: string;
}

export interface GoReleaseVersionCommand {
  readonly args: ReadonlyArray<string>;
  readonly expectedOutput: string;
  readonly match: 'exact' | 'anchored';
}

export interface GoReleaseBinary {
  readonly name: string;
  readonly packagePath: string;
  readonly linkerValues: ReadonlyArray<GoReleaseLinkerValueOptions>;
  readonly versionCommand?: GoReleaseVersionCommandOptions;
}

export interface GoReleaseTargetBinary {
  readonly name: string;
  readonly outputName: string;
  readonly packagePath: string;
  readonly linkerValues: ReadonlyArray<GoReleaseLinkerValue>;
  readonly versionCommand?: GoReleaseVersionCommand;
}

export interface GoReleaseTarget {
  readonly os: string;
  readonly arch: string;
  readonly name: string;
  readonly archiveName: string;
  readonly binaries: ReadonlyArray<GoReleaseTargetBinary>;
}

export interface GoReleaseAdditionalFile {
  readonly source: string;
  readonly sourcePath: string;
  readonly destination: string;
}

export interface GoReleaseProcessLimits {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly concurrency: number;
}

export interface GoReleasePlan {
  readonly cwd: string;
  readonly toolName: string;
  readonly version: string;
  readonly outputDir: string;
  readonly resolvedOutputDir: string;
  readonly goExecutable: string;
  readonly tarExecutable: string;
  readonly binaries: ReadonlyArray<GoReleaseBinary>;
  readonly targets: ReadonlyArray<GoReleaseTarget>;
  readonly buildFlags: ReadonlyArray<string>;
  readonly linkerFlags: ReadonlyArray<string>;
  readonly archiveName: string;
  readonly checksumFile: string;
  readonly additionalFiles: ReadonlyArray<GoReleaseAdditionalFile>;
  readonly sourceDateEpoch: number;
  readonly processLimits: GoReleaseProcessLimits;
  readonly runner: GoReleaseRunner;
}

const OPTION_KEYS = new Set([
  'cwd',
  'toolName',
  'version',
  'outputDir',
  'goExecutable',
  'tarExecutable',
  'binaries',
  'targets',
  'buildFlags',
  'linkerFlags',
  'archiveName',
  'checksumFile',
  'additionalFiles',
  'sourceDateEpoch',
  'processLimits',
]);

export function resolveGoReleasePlan(options: unknown): GoReleasePlan {
  const input = validateOptions(options);
  const cwd = resolveProjectRoot(input.cwd);
  const toolName = validateFileName(input.toolName, 'toolName');
  const version = validateTemplateValue(input.version, 'version');
  const outputDir = normalizeRelativePath(input.outputDir ?? 'dist', 'outputDir');
  const resolvedOutputDir = resolve(cwd, outputDir);
  ensureContainedPath(cwd, resolvedOutputDir, 'outputDir');
  if (resolvedOutputDir === cwd) {
    throw new Error('outputDir must not resolve to the project root');
  }

  const binaries = resolveBinaries(input.binaries, cwd);
  const additionalFiles = resolveAdditionalFiles(input.additionalFiles ?? [], cwd, resolvedOutputDir);
  const archiveName = validateTemplate(input.archiveName ?? DEFAULT_ARCHIVE_NAME, 'archiveName');
  const checksumFile = validateFileName(input.checksumFile ?? DEFAULT_CHECKSUM_FILE, 'checksumFile');
  const targets = resolveTargets(input.targets, binaries, additionalFiles, archiveName, checksumFile, {
    tool: toolName,
    version,
  });

  return {
    cwd,
    toolName,
    version,
    outputDir,
    resolvedOutputDir,
    goExecutable: validateNonEmptyString(input.goExecutable ?? 'go', 'goExecutable'),
    tarExecutable: validateNonEmptyString(input.tarExecutable ?? 'tar', 'tarExecutable'),
    binaries,
    targets,
    buildFlags: validateStringArray(input.buildFlags ?? DEFAULT_BUILD_FLAGS, 'buildFlags'),
    linkerFlags: validateStringArray(input.linkerFlags ?? DEFAULT_LINKER_FLAGS, 'linkerFlags'),
    archiveName,
    checksumFile,
    additionalFiles,
    sourceDateEpoch: validateNonNegativeInteger(input.sourceDateEpoch ?? 0, 'sourceDateEpoch'),
    processLimits: resolveProcessLimits(input.processLimits),
    runner: input.runner ?? defaultGoReleaseRunner,
  };
}

function validateOptions(value: unknown): GoReleaseOptions {
  const options = requireObject(value, 'options');
  const { runner, ...serializableOptions } = options;
  rejectUnknownKeys(serializableOptions, OPTION_KEYS, 'go-release option');
  if (runner !== undefined) {
    validateGoReleaseRunner(runner);
  }
  validateOptionalString(options.cwd, 'cwd');
  validateRequiredString(options.toolName, 'toolName');
  validateRequiredString(options.version, 'version');
  validateOptionalString(options.outputDir, 'outputDir');
  validateOptionalString(options.goExecutable, 'goExecutable');
  validateOptionalString(options.tarExecutable, 'tarExecutable');
  validateRequiredArray(options.binaries, 'binaries');
  validateRequiredArray(options.targets, 'targets');
  validateOptionalStringArray(options.buildFlags, 'buildFlags');
  validateOptionalStringArray(options.linkerFlags, 'linkerFlags');
  validateOptionalString(options.archiveName, 'archiveName');
  validateOptionalString(options.checksumFile, 'checksumFile');
  validateOptionalArray(options.additionalFiles, 'additionalFiles');
  validateOptionalNumber(options.sourceDateEpoch, 'sourceDateEpoch');
  if (options.processLimits !== undefined) {
    requireObject(options.processLimits, 'processLimits');
  }
  return options as unknown as GoReleaseOptions;
}

function resolveProjectRoot(value: string | undefined): string {
  const cwd = resolve(value ?? process.cwd());
  const stats = lstatSync(cwd, { throwIfNoEntry: false });
  if (!stats || !stats.isDirectory()) {
    throw new Error(`cwd must be an existing directory: ${cwd}`);
  }
  return realpathSync(cwd);
}

function resolveBinaries(value: ReadonlyArray<GoReleaseBinaryOptions>, cwd: string): ReadonlyArray<GoReleaseBinary> {
  if (value.length === 0) {
    throw new Error('binaries must contain at least one entry');
  }

  const names = new Set<string>();
  return value.map((raw, index) => {
    const label = `binaries[${index}]`;
    const entry = requireObject(raw, label);
    rejectUnknownKeys(entry, new Set(['name', 'package', 'linkerValues', 'versionCommand']), label);
    const name = validateFileName(entry.name, `${label}.name`);
    if (names.has(name)) {
      throw new Error(`Duplicate binary name: ${name}`);
    }
    names.add(name);

    const packagePath = normalizeRelativePath(entry.package, `${label}.package`);
    ensureContainedPath(cwd, resolve(cwd, packagePath), `${label}.package`);
    const linkerValues = resolveLinkerValueTemplates(entry.linkerValues, label);
    const versionCommand = resolveVersionCommandTemplate(entry.versionCommand, label);
    return { name, packagePath, linkerValues, ...(versionCommand ? { versionCommand } : {}) };
  });
}

function resolveLinkerValueTemplates(value: unknown, parentLabel: string): ReadonlyArray<GoReleaseLinkerValueOptions> {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${parentLabel}.linkerValues must be an array`);
  }
  const symbols = new Set<string>();
  return value.map((raw, index) => {
    const label = `${parentLabel}.linkerValues[${index}]`;
    const entry = requireObject(raw, label);
    rejectUnknownKeys(entry, new Set(['symbol', 'value']), label);
    const symbol = validateNonEmptyString(entry.symbol, `${label}.symbol`);
    if (!/^[A-Za-z0-9_./-]+\.[A-Za-z_][A-Za-z0-9_]*$/u.test(symbol)) {
      throw new Error(`${label}.symbol is not a valid Go linker symbol`);
    }
    if (symbols.has(symbol)) {
      throw new Error(`Duplicate linker symbol for ${parentLabel}: ${symbol}`);
    }
    symbols.add(symbol);
    const template = validateTemplate(entry.value, `${label}.value`);
    validateLinkerTemplate(template, `${label}.value`);
    return { symbol, value: template };
  });
}

function resolveVersionCommandTemplate(
  value: unknown,
  parentLabel: string,
): GoReleaseVersionCommandOptions | undefined {
  if (value === undefined) {
    return undefined;
  }
  const label = `${parentLabel}.versionCommand`;
  const entry = requireObject(value, label);
  rejectUnknownKeys(entry, new Set(['args', 'expectedOutput', 'match']), label);
  validateOptionalStringArray(entry.args, `${label}.args`);
  validateRequiredString(entry.expectedOutput, `${label}.expectedOutput`);
  const expectedOutput = validateTemplate(entry.expectedOutput, `${label}.expectedOutput`);
  const match = entry.match ?? 'exact';
  if (match !== 'exact' && match !== 'anchored') {
    throw new Error(`${label}.match must be 'exact' or 'anchored'`);
  }
  const args = (entry.args as ReadonlyArray<string> | undefined)?.map((arg, index) =>
    validateTemplate(arg, `${label}.args[${index}]`),
  );
  return { args, expectedOutput, match };
}

function resolveAdditionalFiles(
  value: ReadonlyArray<GoReleaseAdditionalFileOptions>,
  cwd: string,
  outputDir: string,
): ReadonlyArray<GoReleaseAdditionalFile> {
  const destinations = new Set<string>();
  return value.map((raw, index) => {
    const label = `additionalFiles[${index}]`;
    const entry = requireObject(raw, label);
    rejectUnknownKeys(entry, new Set(['source', 'destination']), label);
    const source = normalizeRelativePath(entry.source, `${label}.source`);
    const destination = normalizeRelativePath(entry.destination, `${label}.destination`);
    if (destinations.has(destination)) {
      throw new Error(`Duplicate archive destination: ${destination}`);
    }
    destinations.add(destination);

    const sourcePath = resolve(cwd, source);
    ensureContainedPath(cwd, sourcePath, `${label}.source`);
    if (isPathWithin(outputDir, sourcePath)) {
      throw new Error(`${label}.source must not be inside outputDir: ${source}`);
    }
    const stats = lstatSync(sourcePath, { throwIfNoEntry: false });
    if (!stats) {
      throw new Error(`${label}.source does not exist: ${source}`);
    }
    if (!stats.isFile()) {
      throw new Error(`${label}.source must be a regular file: ${source}`);
    }
    return { source, sourcePath: realpathSync(sourcePath), destination };
  });
}

function resolveTargets(
  value: ReadonlyArray<GoReleaseTargetOptions>,
  binaries: ReadonlyArray<GoReleaseBinary>,
  additionalFiles: ReadonlyArray<GoReleaseAdditionalFile>,
  archiveTemplate: string,
  checksumFile: string,
  commonTokens: Readonly<Record<string, string>>,
): ReadonlyArray<GoReleaseTarget> {
  if (value.length === 0) {
    throw new Error('targets must contain at least one entry');
  }
  const targetNames = new Set<string>();
  const archiveNames = new Set<string>();

  return value.map((raw, index) => {
    const label = `targets[${index}]`;
    const entry = requireObject(raw, label);
    rejectUnknownKeys(entry, new Set(['os', 'arch']), label);
    const os = validateGoToken(entry.os, `${label}.os`);
    const arch = validateGoToken(entry.arch, `${label}.arch`);
    const name = `${os}-${arch}`;
    if (targetNames.has(name)) {
      throw new Error(`Duplicate target: ${os}/${arch}`);
    }
    targetNames.add(name);
    if (name === checksumFile) {
      throw new Error(`Target output directory collides with checksumFile: ${name}`);
    }

    const tokens = { ...commonTokens, os, arch };
    const archiveName = validateFileName(expandTemplate(archiveTemplate, tokens), `${label} archive name`);
    if (!archiveName.endsWith('.tar.gz')) {
      throw new Error(`${label} archive name must end with .tar.gz: ${archiveName}`);
    }
    if (archiveName === checksumFile) {
      throw new Error(`Archive name collides with checksumFile: ${archiveName}`);
    }
    if (archiveNames.has(archiveName)) {
      throw new Error(`Duplicate generated archive name: ${archiveName}`);
    }
    archiveNames.add(archiveName);

    const memberNames = new Set(additionalFiles.map((file) => file.destination));
    if (memberNames.has(checksumFile)) {
      throw new Error(`Additional archive destination is reserved: ${checksumFile}`);
    }
    const targetBinaries = binaries.map((binary) => {
      const outputName = os === 'windows' && !binary.name.endsWith('.exe') ? `${binary.name}.exe` : binary.name;
      if (memberNames.has(outputName)) {
        throw new Error(`Archive member collision for ${os}/${arch}: ${outputName}`);
      }
      memberNames.add(outputName);
      return {
        name: binary.name,
        outputName,
        packagePath: binary.packagePath,
        linkerValues: binary.linkerValues.map((item) => ({
          symbol: item.symbol,
          value: validateLinkerValue(expandTemplate(item.value, tokens), `${binary.name} linker value`),
        })),
        ...(binary.versionCommand
          ? {
              versionCommand: {
                args: (binary.versionCommand.args ?? []).map((arg) => expandTemplate(arg, tokens)),
                expectedOutput: expandTemplate(binary.versionCommand.expectedOutput, tokens),
                match: binary.versionCommand.match ?? 'exact',
              },
            }
          : {}),
      };
    });
    assertNoMemberPrefixCollisions(memberNames, `${os}/${arch}`);

    return { os, arch, name, archiveName, binaries: targetBinaries };
  });
}

function assertNoMemberPrefixCollisions(members: ReadonlySet<string>, target: string): void {
  const sorted = [...members].sort();
  for (let index = 0; index + 1 < sorted.length; index += 1) {
    if (sorted[index + 1].startsWith(`${sorted[index]}/`)) {
      throw new Error(`Archive member file/directory collision for ${target}: ${sorted[index]}`);
    }
  }
}

function resolveProcessLimits(value: GoReleaseProcessLimitsOptions | undefined): GoReleaseProcessLimits {
  if (value === undefined) {
    return { ...DEFAULT_PROCESS_LIMITS };
  }
  const entry = requireObject(value, 'processLimits');
  rejectUnknownKeys(entry, new Set(['timeoutMs', 'maxOutputBytes', 'concurrency']), 'processLimits');
  validateOptionalNumber(entry.timeoutMs, 'processLimits.timeoutMs');
  validateOptionalNumber(entry.maxOutputBytes, 'processLimits.maxOutputBytes');
  validateOptionalNumber(entry.concurrency, 'processLimits.concurrency');
  return {
    timeoutMs: validatePositiveInteger(entry.timeoutMs ?? DEFAULT_PROCESS_LIMITS.timeoutMs, 'processLimits.timeoutMs'),
    maxOutputBytes: validatePositiveInteger(
      entry.maxOutputBytes ?? DEFAULT_PROCESS_LIMITS.maxOutputBytes,
      'processLimits.maxOutputBytes',
    ),
    concurrency: validatePositiveInteger(
      entry.concurrency ?? DEFAULT_PROCESS_LIMITS.concurrency,
      'processLimits.concurrency',
    ),
  };
}

function validateTemplate(value: unknown, label: string): string {
  const template = validateNonEmptyString(value, label);
  if (template.includes('\0')) {
    throw new Error(`${label} must not contain NUL bytes`);
  }
  for (const match of template.matchAll(/\{([^{}]*)\}/gu)) {
    if (!['tool', 'version', 'os', 'arch'].includes(match[1])) {
      throw new Error(`${label} contains unsupported template token: {${match[1]}}`);
    }
  }
  if (template.replace(/\{(?:tool|version|os|arch)\}/gu, '').match(/[{}]/u)) {
    throw new Error(`${label} contains malformed template tokens`);
  }
  return template;
}

function expandTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(tool|version|os|arch)\}/gu, (_match, token: string) => values[token] ?? '');
}

function validateLinkerTemplate(value: string, label: string): void {
  const sample = expandTemplate(value, { tool: 'tool', version: '1.0.0', os: 'linux', arch: 'amd64' });
  validateLinkerValue(sample, label);
}

function validateLinkerValue(value: string, label: string): string {
  if (value.length === 0 || /[\0\r\n'"\\]/u.test(value)) {
    throw new Error(`${label} cannot be represented safely in Go linker arguments`);
  }
  return value;
}

function validateGoToken(value: unknown, label: string): string {
  const token = validateNonEmptyString(value, label);
  if (!/^[a-z0-9]+$/u.test(token)) {
    throw new Error(`${label} must contain only lowercase ASCII letters and digits`);
  }
  return token;
}

function validateTemplateValue(value: unknown, label: string): string {
  const text = validateNonEmptyString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/u.test(text)) {
    throw new Error(`${label} contains characters unsafe for release filenames`);
  }
  return text;
}

function validateFileName(value: unknown, label: string): string {
  const name = validateNonEmptyString(value, label);
  if (name === '.' || name === '..' || name.includes('/') || name.includes('\\') || /[\0\r\n]/u.test(name)) {
    throw new Error(`${label} must be a safe file name`);
  }
  return name;
}

function normalizeRelativePath(value: unknown, label: string): string {
  const input = validateNonEmptyString(value, label);
  if (input.includes('\0')) {
    throw new Error(`${label} must not contain NUL bytes`);
  }
  const slashPath = input.replace(/\\/gu, '/');
  if (isAbsolute(input) || slashPath.startsWith('/') || /^[A-Za-z]:\//u.test(slashPath)) {
    throw new Error(`${label} must be relative: ${input}`);
  }
  const parts = slashPath.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.length === 0 || parts.includes('..')) {
    throw new Error(`${label} must be a non-root path without parent-directory segments: ${input}`);
  }
  return parts.join('/');
}

function ensureContainedPath(root: string, target: string, label: string): void {
  let existing = target;
  while (!lstatSync(existing, { throwIfNoEntry: false })) {
    const parent = dirname(existing);
    if (parent === existing) {
      break;
    }
    existing = parent;
  }
  const resolvedExisting = realpathSync(existing);
  if (!isPathWithin(root, resolvedExisting)) {
    throw new Error(`${label} escapes the project root: ${target}`);
  }
}

function isPathWithin(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function rejectUnknownKeys(value: Record<string, unknown>, keys: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) {
      throw new Error(`Unknown ${label}: ${key}`);
    }
  }
}

function validateRequiredArray(value: unknown, label: string): asserts value is ReadonlyArray<unknown> {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
}

function validateOptionalArray(value: unknown, label: string): void {
  if (value !== undefined && !Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
}

function validateRequiredString(value: unknown, label: string): asserts value is string {
  validateNonEmptyString(value, label);
}

function validateNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (value.includes('\0')) {
    throw new Error(`${label} must not contain NUL bytes`);
  }
  return value;
}

function validateOptionalString(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
}

function validateOptionalStringArray(value: unknown, label: string): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new Error(`${label} must be an array of non-empty strings`);
  }
}

function validateStringArray(value: ReadonlyArray<string>, label: string): ReadonlyArray<string> {
  validateOptionalStringArray(value, label);
  for (const entry of value) {
    if (entry.includes('\0')) {
      throw new Error(`${label} entries must not contain NUL bytes`);
    }
  }
  return [...value];
}

function validateOptionalNumber(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== 'number') {
    throw new Error(`${label} must be a number`);
  }
}

function validateNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function validatePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}
