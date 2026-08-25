import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseFlags,
  type FlagSpec,
  INTERACTIVE_FLAG,
  canPrompt,
  promptForRequiredValue,
  loadConfigFile,
  isPlainObject,
} from '@repo-toolkit/publish-package';

import { syncConfluenceToDocs, type ConfluenceSyncOptions } from './index';

export interface ConfluenceCliOptions extends ConfluenceSyncOptions {
  apiTokenFile?: string;
}

export const SPECS: FlagSpec[] = [
  { name: 'config' },
  { name: 'cwd' },
  { name: 'folder' },
  { name: 'username' },
  { name: 'api-token', aliases: ['password'] },
  { name: 'api-token-file', aliases: ['password-file'] },
  { name: 'confluence-base-url', aliases: ['base-url'] },
  { name: 'space-key' },
  { name: 'parent-page-id' },
  { name: 'version-message' },
  { name: 'repository-url' },
  { name: 'skip-unchanged', boolean: true, negatable: true },
  { name: 'dry-run', boolean: true },
  { name: 'render-html-blocks', boolean: true },
  INTERACTIVE_FLAG,
];

const ENV_TRUTHY = new Set(['true', '1', 'yes', 'on']);
const ENV_FALSY = new Set(['false', '0', 'no', 'off', '']);

const BOOLEAN_ENV_KEYS = new Set(['skipUnchanged', 'dryRun', 'renderHtmlBlocks']);

function isBooleanOption(key: keyof ConfluenceCliOptions): key is 'skipUnchanged' | 'dryRun' | 'renderHtmlBlocks' {
  return BOOLEAN_ENV_KEYS.has(key as string);
}

function parseBooleanEnv(value: string, envName: string): boolean {
  const v = value.toLowerCase();
  if (ENV_TRUTHY.has(v)) {
    return true;
  }
  if (ENV_FALSY.has(v)) {
    return false;
  }
  throw new Error(
    `Invalid boolean value for ${envName}: ${JSON.stringify(value)}. Use one of true|false|1|0|yes|no|on|off.`,
  );
}

function printHelp(): void {
  console.log(`repo-toolkit-confluence

Usage:
  repo-toolkit-confluence [options]

Synchronizes a folder of markdown documentation to Confluence pages and
attachments.

Configuration is resolved per option with the following precedence:
  CLI flag > config file > environment > built-in default

Environment variables (CLI form; GitHub Action INPUT_* form is also read):
  CONFLUENCE_FOLDER                    Documentation folder
  CONFLUENCE_USERNAME                  Confluence username/email
  CONFLUENCE_API_TOKEN                 Confluence API token (prefers a secret file)
  CONFLUENCE_API_TOKEN_FILE            Path to a file containing the API token
  CONFLUENCE_BASE_URL                  Confluence base URL (with /wiki)
  CONFLUENCE_SPACE_KEY                 Confluence space key
  CONFLUENCE_PARENT_PAGE_ID            Numeric parent page id
  CONFLUENCE_VERSION_MESSAGE            Version-message suffix for every PUT
  CONFLUENCE_REPOSITORY_URL            Repository URL appended to synced pages
  CONFLUENCE_SKIP_UNCHANGED            true|false (default: true)
  CONFLUENCE_DRY_RUN                   true|false (default: false)
  CONFLUENCE_RENDER_HTML_BLOCKS        true|false (default: false)
  INPUT_<UPPER-FLAG>                   GitHub Actions input form (lower precedence)

Note: prefer CONFLUENCE_API_TOKEN_FILE or CONFLUENCE_API_TOKEN over
--api-token to avoid placing the token in argv / process listings.

Options:
  --config <path>               Config file (JSON, .mjs, or .cjs default export)
  --cwd <path>                  Working directory (default: process.cwd())
  --folder <path>               Folder containing the documentation to publish (required)
  --username <value>            Confluence username or email (required)
  --api-token <value>           Confluence API token (required). Alias: --password
  --api-token-file <path>       File whose contents are the API token. Alias: --password-file
  --confluence-base-url <url>   Confluence URL with /wiki (required). Alias: --base-url
  --space-key <key>             Confluence space key (required). Resolved to a spaceId via the API
  --parent-page-id <id>         Numeric page id under which docs will be published (required)
  --version-message <text>      Commit message appended to every page/attachment PUT
  --repository-url <url>        Repository URL appended to synced pages as an italic notice
  --skip-unchanged               Skip pages whose body is unchanged (default: true)
  --no-skip-unchanged           Re-upload every page even when unchanged
  --dry-run                     Walk the doc tree and print the plan without API calls
  --render-html-blocks          Render \`\`\`html fenced blocks as inline HTML via the
                                Confluence html macro (default: false; emits as code box)
  -i, --interactive             Prompt interactively for missing non-secret required values
  -h, --help                    Show this help message
`);
}

type StringOptionKey =
  | 'folder'
  | 'username'
  | 'apiToken'
  | 'apiTokenFile'
  | 'baseUrl'
  | 'spaceKey'
  | 'parentPageId'
  | 'versionMessage'
  | 'repositoryUrl'
  | 'cwd';

const STRING_OPTION_KEYS: ReadonlyArray<StringOptionKey> = [
  'cwd',
  'folder',
  'username',
  'apiToken',
  'apiTokenFile',
  'baseUrl',
  'spaceKey',
  'parentPageId',
  'versionMessage',
  'repositoryUrl',
];

function setIfString(options: Record<string, unknown>, key: StringOptionKey, value: string | undefined): void {
  if (typeof value === 'string' && value.length > 0) {
    options[key] = value;
  }
}

function isStringOptionKey(key: string): key is StringOptionKey {
  return (STRING_OPTION_KEYS as ReadonlyArray<string>).includes(key);
}

interface EnvBinding {
  envName: string;
  key: keyof ConfluenceCliOptions;
  kind: 'string' | 'boolean';
}

const ENV_BINDINGS: ReadonlyArray<EnvBinding> = [
  { envName: 'INPUT_FOLDER', key: 'folder', kind: 'string' },
  { envName: 'INPUT_USERNAME', key: 'username', kind: 'string' },
  { envName: 'INPUT_API-TOKEN', key: 'apiToken', kind: 'string' },
  { envName: 'INPUT_PASSWORD', key: 'apiToken', kind: 'string' },
  { envName: 'INPUT_API-TOKEN-FILE', key: 'apiTokenFile', kind: 'string' },
  { envName: 'INPUT_PASSWORD-FILE', key: 'apiTokenFile', kind: 'string' },
  { envName: 'INPUT_CONFLUENCE-BASE-URL', key: 'baseUrl', kind: 'string' },
  { envName: 'INPUT_SPACE-KEY', key: 'spaceKey', kind: 'string' },
  { envName: 'INPUT_PARENT-PAGE-ID', key: 'parentPageId', kind: 'string' },
  { envName: 'INPUT_VERSION-MESSAGE', key: 'versionMessage', kind: 'string' },
  { envName: 'INPUT_REPOSITORY-URL', key: 'repositoryUrl', kind: 'string' },
  { envName: 'INPUT_DRY-RUN', key: 'dryRun', kind: 'boolean' },
  { envName: 'INPUT_SKIP-UNCHANGED', key: 'skipUnchanged', kind: 'boolean' },
  { envName: 'INPUT_RENDER-HTML-BLOCKS', key: 'renderHtmlBlocks', kind: 'boolean' },
  { envName: 'CONFLUENCE_FOLDER', key: 'folder', kind: 'string' },
  { envName: 'CONFLUENCE_USERNAME', key: 'username', kind: 'string' },
  { envName: 'CONFLUENCE_API_TOKEN', key: 'apiToken', kind: 'string' },
  { envName: 'CONFLUENCE_API_TOKEN_FILE', key: 'apiTokenFile', kind: 'string' },
  { envName: 'CONFLUENCE_BASE_URL', key: 'baseUrl', kind: 'string' },
  { envName: 'CONFLUENCE_SPACE_KEY', key: 'spaceKey', kind: 'string' },
  { envName: 'CONFLUENCE_PARENT_PAGE_ID', key: 'parentPageId', kind: 'string' },
  { envName: 'CONFLUENCE_VERSION_MESSAGE', key: 'versionMessage', kind: 'string' },
  { envName: 'CONFLUENCE_REPOSITORY_URL', key: 'repositoryUrl', kind: 'string' },
  { envName: 'CONFLUENCE_DRY_RUN', key: 'dryRun', kind: 'boolean' },
  { envName: 'CONFLUENCE_SKIP_UNCHANGED', key: 'skipUnchanged', kind: 'boolean' },
  { envName: 'CONFLUENCE_RENDER_HTML_BLOCKS', key: 'renderHtmlBlocks', kind: 'boolean' },
];

export function optionsFromEnv(env: Record<string, string | undefined> = process.env): Partial<ConfluenceCliOptions> {
  const options: Record<string, unknown> = {};

  for (const { envName, key, kind } of ENV_BINDINGS) {
    const raw = env[envName];
    if (raw === undefined) {
      continue;
    }

    if (kind === 'string') {
      if (!isStringOptionKey(key as string)) {
        continue;
      }
      setIfString(options, key as StringOptionKey, raw);
    } else if (isBooleanOption(key as keyof ConfluenceCliOptions)) {
      options[key as string] = parseBooleanEnv(raw, envName);
    }
  }

  if (options.repositoryUrl === undefined) {
    const githubRepositoryUrl = repositoryUrlFromGitHubEnv(env);
    if (githubRepositoryUrl) {
      options.repositoryUrl = githubRepositoryUrl;
    }
  }

  return options as Partial<ConfluenceCliOptions>;
}

function repositoryUrlFromGitHubEnv(env: Record<string, string | undefined>): string | undefined {
  const repository = env.GITHUB_REPOSITORY;
  if (!repository) {
    return undefined;
  }
  const serverUrl = env.GITHUB_SERVER_URL || 'https://github.com';
  return serverUrl.replace(/\/+$/, '') + '/' + repository.replace(/^\/+/, '');
}

export function buildOptions(result: ReturnType<typeof parseFlags>): Partial<ConfluenceCliOptions> {
  if (!result) {
    return {};
  }

  const { values } = result;
  const options: Record<string, unknown> = {};

  setIfString(options, 'cwd', values.cwd);
  setIfString(options, 'folder', values.folder);
  setIfString(options, 'username', values.username);
  setIfString(options, 'apiToken', values['api-token'] ?? values.password);
  setIfString(options, 'apiTokenFile', values['api-token-file'] ?? values['password-file']);
  setIfString(options, 'baseUrl', values['confluence-base-url'] ?? values['base-url']);
  setIfString(options, 'spaceKey', values['space-key']);
  setIfString(options, 'parentPageId', values['parent-page-id']);
  setIfString(options, 'versionMessage', values['version-message']);
  setIfString(options, 'repositoryUrl', values['repository-url']);

  if (values['skip-unchanged'] !== undefined) {
    options.skipUnchanged = values['skip-unchanged'] === 'true';
  }
  if (values['dry-run'] !== undefined) {
    options.dryRun = true;
  }
  if (values['render-html-blocks'] !== undefined) {
    options.renderHtmlBlocks = true;
  }

  return options as Partial<ConfluenceCliOptions>;
}

interface ResolveOptionsArgs {
  result: Exclude<ReturnType<typeof parseFlags>, null>;
  cwd?: string;
}

export async function resolveConfluenceOptions(args: ResolveOptionsArgs): Promise<Partial<ConfluenceCliOptions>> {
  const cliOptions = buildOptions(args.result);
  const configPath = args.result.values.config;
  const config = configPath
    ? await loadConfigFile<Partial<ConfluenceCliOptions>>(configPath, args.cwd ?? cliOptions.cwd)
    : {};

  if (!isPlainObject(config)) {
    throw new Error(`Config file must export an object: ${configPath}`);
  }

  const envOptions = optionsFromEnv();

  return { ...envOptions, ...config, ...cliOptions };
}

interface RequiredFields {
  field: 'folder' | 'username' | 'baseUrl' | 'spaceKey' | 'parentPageId';
  message: string;
}

const REQUIRED_PRESETS: ReadonlyArray<RequiredFields> = [
  { field: 'folder', message: 'folder is required.' },
  { field: 'username', message: 'username is required.' },
  { field: 'baseUrl', message: 'baseUrl is required (CONFLUENCE_BASE_URL or --confluence-base-url).' },
  { field: 'spaceKey', message: 'spaceKey is required (CONFLUENCE_SPACE_KEY or --space-key).' },
  {
    field: 'parentPageId',
    message: 'parentPageId is required (CONFLUENCE_PARENT_PAGE_ID or --parent-page-id).',
  },
];

const TOKEN_GUIDANCE =
  'apiToken is required. Provide it via --api-token-file, INPUT_API-TOKEN-FILE, CONFLUENCE_API_TOKEN_FILE, or the CONFLUENCE_API_TOKEN / INPUT_API-TOKEN environment variable. Tokens are never prompted interactively to avoid entering them on screen.';

export async function resolveSecretFile(opts: Partial<ConfluenceCliOptions>, cwd?: string): Promise<void> {
  if (!opts.apiTokenFile) {
    return;
  }
  if (opts.apiToken) {
    return;
  }
  const path = resolve(cwd ?? process.cwd(), opts.apiTokenFile);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    const wrappedError = new Error(`Failed to read apiTokenFile at ${path}`) as Error & {
      cause?: unknown;
    };
    wrappedError.cause = error;
    throw wrappedError;
  }
  const token = raw.replace(/\r?\n$/, '').trim();
  if (token.length === 0) {
    throw new Error(`apiTokenFile at ${path} is empty.`);
  }
  opts.apiToken = token;
}

async function promptForMissing(merged: Partial<ConfluenceCliOptions>, interactive: boolean): Promise<void> {
  if (!interactive) {
    return;
  }
  if (merged.dryRun === true) {
    return;
  }
  if (!canPrompt()) {
    return;
  }

  for (const { field, message } of REQUIRED_PRESETS) {
    merged[field] = await promptForRequiredValue({
      value: merged[field] as string | undefined,
      interactive,
      canPromptNow: true,
      message: `${field}:`,
      missingMessage: message,
      validate: (v) => (v.length === 0 ? message : undefined),
    });
  }

  if (!merged.apiToken) {
    throw new Error(TOKEN_GUIDANCE);
  }
}

function ensureRequired(merged: Partial<ConfluenceCliOptions>): void {
  if (merged.dryRun === true) {
    return;
  }
  for (const { field, message } of REQUIRED_PRESETS) {
    if (!merged[field]) {
      throw new Error(message);
    }
  }
  if (!merged.apiToken) {
    throw new Error(TOKEN_GUIDANCE);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const result = parseFlags(argv, SPECS);

  if (!result) {
    printHelp();
    return;
  }

  const interactive = result.values.interactive === 'true';
  const merged = await resolveConfluenceOptions({ result });

  await resolveSecretFile(merged, merged.cwd);

  await promptForMissing(merged, interactive);

  ensureRequired(merged);

  await syncConfluenceToDocs(merged);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
