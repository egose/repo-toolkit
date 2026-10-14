import { parseFlags, type FlagSpec, type ParseFlagsResult } from '@repo-toolkit/publish-package';

import { safeError } from './diagnostics';
import type { ReleaseTagOptions } from './plan';
import { MAX_PROCESS_TIMEOUT_MS } from './process';
import { resolveMergeMethod } from './validation';

export const SPECS: FlagSpec[] = [
  { name: 'tag' },
  { name: 'cwd' },
  { name: 'base-branch' },
  { name: 'release-branch' },
  { name: 'git-executable' },
  { name: 'release-command', aliases: ['release-it-path'] },
  { name: 'release-arg', repeatable: true },
  { name: 'timeout-ms' },
  { name: 'max-output-bytes' },
  { name: 'git-user-name' },
  { name: 'git-user-email' },
  { name: 'sign-commit', boolean: true, negatable: true },
  { name: 'github-token' },
  { name: 'github-token-file' },
  { name: 'github-token-env' },
  { name: 'github-repository' },
  { name: 'github-api-url' },
  { name: 'auto-merge-pr', boolean: true },
  { name: 'merge-method' },
  { name: 'delete-merged-branch', boolean: true },
  { name: 'skip-release', boolean: true },
  { name: 'reset-release-branch', boolean: true, negatable: true },
  { name: 'allow-empty-release', boolean: true, negatable: true },
  { name: 'skip-pr', boolean: true },
  { name: 'skip-preflight', boolean: true },
  { name: 'only', list: true },
  { name: 'dry-run', boolean: true },
  { name: 'json', boolean: true },
];

function positiveInteger(value: string, flag: string, maximum: number): number {
  const parsed = Number(value);
  if (/^[1-9]\d*$/.exec(value)?.[0] !== value || !Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`--${flag} must be a decimal integer from 1 through ${maximum} (digits only, no leading zeros)`);
  }
  return parsed;
}

export function buildOptions(result: ParseFlagsResult): ReleaseTagOptions {
  const values = result.values;
  const options: ReleaseTagOptions = {};
  if (values.tag !== undefined) {
    options.tag = values.tag;
  }
  if (values.cwd !== undefined) {
    options.cwd = values.cwd;
  }
  if (values['base-branch'] !== undefined) {
    options.baseBranch = values['base-branch'];
  }
  if (values['release-branch'] !== undefined) {
    options.releaseBranch = values['release-branch'];
  }
  if (values['git-executable'] !== undefined) {
    options.gitExecutable = values['git-executable'];
  }
  if (values['release-command'] !== undefined) {
    options.releaseCommand = values['release-command'];
  }
  if (result.repeat['release-arg'] !== undefined) {
    options.releaseArgs = [...result.repeat['release-arg']];
  }
  if (values['timeout-ms'] !== undefined) {
    options.timeoutMs = positiveInteger(values['timeout-ms'], 'timeout-ms', MAX_PROCESS_TIMEOUT_MS);
  }
  if (values['max-output-bytes'] !== undefined) {
    options.maxOutputBytes = positiveInteger(values['max-output-bytes'], 'max-output-bytes', Number.MAX_SAFE_INTEGER);
  }
  if (values['git-user-name'] !== undefined) {
    options.gitUserName = values['git-user-name'];
  }
  if (values['git-user-email'] !== undefined) {
    options.gitUserEmail = values['git-user-email'];
  }
  if (values['sign-commit'] !== undefined) {
    options.signCommit = values['sign-commit'] === 'true';
  }
  if (values['github-token'] !== undefined) {
    options.githubToken = values['github-token'];
  }
  if (values['github-token-file'] !== undefined) {
    options.githubTokenFile = values['github-token-file'];
  }
  if (values['github-token-env'] !== undefined) {
    options.githubTokenEnv = values['github-token-env'];
  }
  if (values['github-repository'] !== undefined) {
    options.githubRepository = values['github-repository'];
  }
  if (values['github-api-url'] !== undefined) {
    options.githubApiUrl = values['github-api-url'];
  }
  if (values['auto-merge-pr'] !== undefined) {
    options.autoMergePr = values['auto-merge-pr'] === 'true';
  }
  if (values['merge-method'] !== undefined) {
    options.mergeMethod = resolveMergeMethod(values['merge-method']);
  }
  if (values['delete-merged-branch'] !== undefined) {
    options.deleteMergedBranch = values['delete-merged-branch'] === 'true';
  }
  if (values['skip-release'] !== undefined) {
    options.skipRelease = values['skip-release'] === 'true';
  }
  if (values['reset-release-branch'] !== undefined) {
    options.resetReleaseBranch = values['reset-release-branch'] === 'true';
  }
  if (values['allow-empty-release'] !== undefined) {
    options.allowEmptyRelease = values['allow-empty-release'] === 'true';
  }
  if (values['skip-pr'] !== undefined) {
    options.skipPr = values['skip-pr'] === 'true';
  }
  if (values['skip-preflight'] !== undefined) {
    options.skipPreflight = values['skip-preflight'] === 'true';
  }
  if (result.repeat.only !== undefined && result.repeat.only.length > 0) {
    options.only = [...result.repeat.only];
  }
  if (values['dry-run'] !== undefined) {
    options.dryRun = values['dry-run'] === 'true';
  }
  return options;
}

export function collectCliSecrets(argv: ReadonlyArray<string>, env: NodeJS.ProcessEnv = process.env): string[] {
  const values: Array<string | undefined> = [env.GITHUB_TOKEN];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equals = arg.indexOf('=');
    const key = (equals < 0 ? arg : arg.slice(0, equals)).replace(/^--?/, '');
    const value = equals < 0 ? argv[index + 1] : arg.slice(equals + 1);
    if (key === 'github-token') {
      values.push(value);
    } else if (key === 'github-token-env' && value !== undefined) {
      values.push(env[value]);
    }
  }
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
}

export function parseCliOptions(argv: ReadonlyArray<string>): {
  options: ReleaseTagOptions;
  json: boolean;
  inlineToken: boolean;
} | null {
  const secrets = collectCliSecrets(argv);
  try {
    const result = parseFlags([...argv], SPECS);
    return result === null
      ? null
      : {
          options: buildOptions(result),
          json: result.values.json === 'true',
          inlineToken: result.values['github-token'] !== undefined,
        };
  } catch (error) {
    throw safeError(error, secrets);
  }
}
