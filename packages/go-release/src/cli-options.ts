import { isPlainObject, loadConfigFile, type ParseFlagsResult } from '@repo-toolkit/publish-package';

import { resolveGoReleasePlan, type GoReleaseOptions, type GoReleasePlan, type GoReleaseTarget } from './plan';

export interface GoReleaseCliResolution {
  readonly options: GoReleaseOptions;
  readonly plan: GoReleasePlan;
  readonly archiveLimits?: GoReleaseCliArchiveLimits;
}

export interface GoReleaseCliArchiveLimits {
  readonly maxMemberCount?: number;
  readonly maxPathLength?: number;
  readonly maxExpandedBytes?: number;
}

export async function resolveGoReleaseCliOptions(
  result: ParseFlagsResult,
  targetFilter: ReadonlyArray<string> | undefined,
  allowArchiveLimits = false,
): Promise<GoReleaseCliResolution> {
  const loaded = result.values.config
    ? await loadConfigFile<Record<string, unknown>>(result.values.config, result.values.cwd)
    : {};
  if (Object.prototype.hasOwnProperty.call(loaded, 'runner')) {
    throw new Error('runner is available only to library callers');
  }
  const { archiveLimits: rawArchiveLimits, ...config } = loaded;
  if (!allowArchiveLimits && rawArchiveLimits !== undefined) {
    throw new Error('Unknown go-release option: archiveLimits');
  }
  let processLimitsOverride: Record<string, unknown> | undefined;
  if (result.values.concurrency !== undefined) {
    if (config.processLimits !== undefined && !isPlainObject(config.processLimits)) {
      throw new Error('processLimits must be an object');
    }
    processLimitsOverride = {
      ...(config.processLimits ?? {}),
      concurrency: positiveInteger(result.values.concurrency, '--concurrency'),
    };
  }
  const merged: GoReleaseOptions = {
    ...config,
    ...(result.values.cwd === undefined ? {} : { cwd: result.values.cwd }),
    ...(result.values['tool-name'] === undefined ? {} : { toolName: result.values['tool-name'] }),
    ...(result.values.version === undefined ? {} : { version: result.values.version }),
    ...(result.values['output-dir'] === undefined ? {} : { outputDir: result.values['output-dir'] }),
    ...(result.values['go-executable'] === undefined ? {} : { goExecutable: result.values['go-executable'] }),
    ...(result.values['tar-executable'] === undefined ? {} : { tarExecutable: result.values['tar-executable'] }),
    ...(processLimitsOverride === undefined ? {} : { processLimits: processLimitsOverride }),
  } as GoReleaseOptions;
  const fullPlan = resolveGoReleasePlan(merged);
  const targets = selectTargets(fullPlan, targetFilter);
  const options = optionsFromPlan(fullPlan, targets);
  return {
    options,
    plan: resolveGoReleasePlan(options),
    ...(allowArchiveLimits ? { archiveLimits: validateArchiveLimits(rawArchiveLimits) } : {}),
  };
}

export function planSummary(operation: 'build' | 'verify', plan: GoReleasePlan, dryRun: boolean): object {
  return {
    operation,
    dryRun,
    toolName: plan.toolName,
    version: plan.version,
    outputDir: plan.outputDir,
    checksumFile: plan.checksumFile,
    concurrency: plan.processLimits.concurrency,
    targets: plan.targets.map((target) => ({
      target: target.name,
      archive: target.archiveName,
      binaries: target.binaries.map((binary) => binary.outputName),
    })),
  };
}

export function printSummary(summary: object): void {
  console.log(JSON.stringify(summary, null, 2));
}

export function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive safe integer: ${value}`);
  }
  return parsed;
}

export function mergeArchiveLimits(
  config: GoReleaseCliArchiveLimits | undefined,
  result: ParseFlagsResult,
): GoReleaseCliArchiveLimits {
  return {
    ...config,
    ...(result.values['max-member-count'] === undefined
      ? {}
      : { maxMemberCount: boundedInteger(result.values['max-member-count'], 1_024, '--max-member-count') }),
    ...(result.values['max-path-length'] === undefined
      ? {}
      : { maxPathLength: boundedInteger(result.values['max-path-length'], 512, '--max-path-length') }),
    ...(result.values['max-expanded-bytes'] === undefined
      ? {}
      : {
          maxExpandedBytes: boundedInteger(
            result.values['max-expanded-bytes'],
            512 * 1024 * 1024,
            '--max-expanded-bytes',
          ),
        }),
  };
}

function validateArchiveLimits(value: unknown): GoReleaseCliArchiveLimits {
  if (value === undefined) return {};
  if (!isPlainObject(value)) throw new Error('archiveLimits must be an object');
  for (const key of Object.keys(value)) {
    if (!['maxMemberCount', 'maxPathLength', 'maxExpandedBytes'].includes(key)) {
      throw new Error(`Unknown archiveLimits option: ${key}`);
    }
  }
  return {
    ...(value.maxMemberCount === undefined
      ? {}
      : { maxMemberCount: boundedInteger(value.maxMemberCount, 1_024, 'archiveLimits.maxMemberCount') }),
    ...(value.maxPathLength === undefined
      ? {}
      : { maxPathLength: boundedInteger(value.maxPathLength, 512, 'archiveLimits.maxPathLength') }),
    ...(value.maxExpandedBytes === undefined
      ? {}
      : {
          maxExpandedBytes: boundedInteger(value.maxExpandedBytes, 512 * 1024 * 1024, 'archiveLimits.maxExpandedBytes'),
        }),
  };
}

function boundedInteger(value: unknown, maximum: number, label: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${label} must be a positive safe integer no greater than ${maximum}: ${String(value)}`);
  }
  return parsed;
}

function selectTargets(plan: GoReleasePlan, filter: ReadonlyArray<string> | undefined): ReadonlyArray<GoReleaseTarget> {
  if (filter === undefined) return plan.targets;
  const requested = new Set<string>();
  for (const target of filter) {
    if (requested.has(target)) throw new Error(`Duplicate target filter: ${target}`);
    requested.add(target);
  }
  const selected = plan.targets.filter((target) => requested.has(target.name));
  for (const target of requested) {
    if (!selected.some((candidate) => candidate.name === target)) {
      throw new Error(`Unknown target filter: ${target}`);
    }
  }
  return selected;
}

function optionsFromPlan(plan: GoReleasePlan, targets: ReadonlyArray<GoReleaseTarget>): GoReleaseOptions {
  return {
    cwd: plan.cwd,
    toolName: plan.toolName,
    version: plan.version,
    outputDir: plan.outputDir,
    goExecutable: plan.goExecutable,
    tarExecutable: plan.tarExecutable,
    binaries: plan.binaries.map((binary) => ({
      name: binary.name,
      package: binary.packagePath,
      linkerValues: binary.linkerValues,
      ...(binary.versionCommand ? { versionCommand: binary.versionCommand } : {}),
    })),
    targets: targets.map((target) => ({ os: target.os, arch: target.arch })),
    buildFlags: plan.buildFlags,
    linkerFlags: plan.linkerFlags,
    archiveName: plan.archiveName,
    checksumFile: plan.checksumFile,
    additionalFiles: plan.additionalFiles.map((file) => ({
      source: file.source,
      destination: file.destination,
    })),
    sourceDateEpoch: plan.sourceDateEpoch,
    processLimits: plan.processLimits,
    runner: plan.runner,
  };
}
