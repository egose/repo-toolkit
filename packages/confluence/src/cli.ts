import { parseFlags, type FlagSpec, resolveCliOptions, INTERACTIVE_FLAG } from '@repo-toolkit/publish-package';

import { syncConfluenceToDocs, type ConfluenceSyncOptions } from './index';

const SPECS: FlagSpec[] = [
  { name: 'config' },
  { name: 'cwd' },
  { name: 'folder' },
  { name: 'username' },
  { name: 'api-token', aliases: ['password'] },
  { name: 'confluence-base-url', aliases: ['base-url'] },
  { name: 'space-key' },
  { name: 'parent-page-id' },
  { name: 'version-message' },
  { name: 'skip-unchanged', boolean: true, negatable: true },
  { name: 'dry-run', boolean: true },
  { name: 'render-html-blocks', boolean: true },
  INTERACTIVE_FLAG,
];

function printHelp(): void {
  console.log(`repo-toolkit-confluence

Usage:
  repo-toolkit-confluence [options]

Synchronizes a folder of markdown documentation to Confluence pages and
attachments. When run with no flags, reads configuration from the GitHub
Action INPUT_* environment variables (folder, username, api-token,
confluence-base-url, space-key, parent-page-id).

Options:
  --config <path>               Config file (JSON, .mjs, or .cjs default export)
  --cwd <path>                  Working directory (default: process.cwd())
  --folder <path>               Folder containing the documentation to publish (required)
  --username <value>            Confluence username or email (required)
  --api-token <value>           Confluence API token (required). Alias: --password
  --confluence-base-url <url>   Confluence URL with /wiki (required). Alias: --base-url
  --space-key <key>             Confluence space key (required). Resolved to a spaceId via the API
  --parent-page-id <id>         Numeric page id under which docs will be published (required)
  --version-message <text>      Commit message appended to every page/attachment PUT
  --skip-unchanged               Skip pages whose body is unchanged (default: true)
  --no-skip-unchanged           Re-upload every page even when unchanged
  --dry-run                     Walk the doc tree and print the plan without API calls
  --render-html-blocks          Render \`\`\`html fenced blocks as inline HTML via the
                                Confluence html macro (default: false; emits as code box)
  -i, --interactive             (reserved; not currently interactive)
  -h, --help                    Show this help message
`);
}

const ENV_INPUT_MAP: ReadonlyArray<[string, keyof ConfluenceSyncOptions]> = [
  ['INPUT_FOLDER', 'folder'],
  ['INPUT_USERNAME', 'username'],
  ['INPUT_API-TOKEN', 'apiToken'],
  ['INPUT_PASSWORD', 'apiToken'],
  ['INPUT_CONFLUENCE-BASE-URL', 'baseUrl'],
  ['INPUT_SPACE-KEY', 'spaceKey'],
  ['INPUT_PARENT-PAGE-ID', 'parentPageId'],
  ['INPUT_VERSION-MESSAGE', 'versionMessage'],
  ['INPUT_RENDER-HTML-BLOCKS', 'renderHtmlBlocks'],
];

function buildOptions(result: ReturnType<typeof parseFlags>): Partial<ConfluenceSyncOptions> {
  if (!result) {
    return {};
  }

  const { values, repeat: _repeat } = result;
  void _repeat;
  const options: Partial<ConfluenceSyncOptions> = {};

  if (values.cwd) options.cwd = values.cwd;
  if (values.folder) options.folder = values.folder;
  if (values.username) options.username = values.username;
  if (values['api-token']) options.apiToken = values['api-token'];
  if (values['password']) options.apiToken = values['password'];
  if (values['confluence-base-url']) options.baseUrl = values['confluence-base-url'];
  if (values['base-url']) options.baseUrl = values['base-url'];
  if (values['space-key']) options.spaceKey = values['space-key'];
  if (values['parent-page-id']) options.parentPageId = values['parent-page-id'];
  if (values['version-message']) options.versionMessage = values['version-message'];
  if (values['skip-unchanged'] !== undefined) options.skipUnchanged = values['skip-unchanged'] === 'true';
  if (values['dry-run'] !== undefined) options.dryRun = true;
  if (values['render-html-blocks'] !== undefined) options.renderHtmlBlocks = true;

  return options;
}

function optionsFromEnv(): Partial<ConfluenceSyncOptions> {
  const options: Partial<ConfluenceSyncOptions> = {};
  for (const [envName, key] of ENV_INPUT_MAP) {
    const value = process.env[envName];
    if (typeof value === 'string' && value.length > 0) {
      if (key === 'renderHtmlBlocks') {
        (options as Record<string, unknown>)[key] = value === 'true' || value === '1';
      } else {
        (options as Record<string, unknown>)[key] = value;
      }
    }
  }
  return options;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const hasFlags = argv.length > 0;
  const result = parseFlags(argv, SPECS);

  if (!result) {
    printHelp();
    return;
  }

  const cliOptions = await resolveCliOptions<ConfluenceSyncOptions>({
    result,
    buildOptions,
  });

  const envOptions = hasFlags ? {} : optionsFromEnv();
  const merged: ConfluenceSyncOptions = { ...envOptions, ...cliOptions };

  await syncConfluenceToDocs(merged);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
