import { parseFlags, type FlagSpec } from '@repo-toolkit/publish-package';

import { assertCommandFlags, collectCliSecrets } from './cli-options';
import { formatJsonError, formatJsonResult, formatTextResult, redactText } from './format';
import { SECRET_SYNC_COMMANDS, resolveSecretSyncPlan, runSecretSync, type SecretSyncOptions } from './index';

const SPECS: FlagSpec[] = [
  { name: 'config' },
  { name: 'cwd' },
  { name: 'branch' },
  { name: 'file', repeatable: true },
  { name: 'message' },
  { name: 'revision' },
  { name: 'limit' },
  { name: 'head', repeatable: true },
  { name: 'take' },
  { name: 'name' },
  { name: 'from' },
  { name: 'from-branch' },
  { name: 'vault' },
  { name: 'provider' },
  { name: 'auth' },
  { name: 'account' },
  { name: 'token-env' },
  { name: 'json', boolean: true },
  { name: 'dry-run', boolean: true },
  { name: 'check', boolean: true },
  { name: 'delete', boolean: true },
  { name: 'overwrite', boolean: true },
  { name: 'acknowledge-remote', boolean: true },
];

export interface ExtractedCommand {
  command?: string;
  branchSubcommand?: string;
  vaultSubcommand?: string;
  rest: string[];
}

export function extractCommand(argv: string[]): ExtractedCommand {
  let index = 0;
  while (argv[index] === '--') {
    index += 1;
  }
  const rest = argv.slice(index);
  const first = rest[0];
  if (first === undefined || first.startsWith('-')) {
    return { rest };
  }
  if (!(SECRET_SYNC_COMMANDS as ReadonlyArray<string>).includes(first)) {
    throw new Error(`Unknown command: ${first}. Expected one of ${SECRET_SYNC_COMMANDS.join(', ')}.`);
  }
  if (first !== 'branch' && first !== 'vault') {
    return { command: first, rest: rest.slice(1) };
  }
  if (first === 'vault') {
    const second = rest[1];
    if (second === 'list') {
      return { command: first, vaultSubcommand: second, rest: rest.slice(2) };
    }
    if (second !== undefined && !second.startsWith('-') && second !== '--') {
      throw new Error(`Unknown vault subcommand: ${second}. Expected one of list.`);
    }
    return { command: first, rest: rest.slice(1) };
  }
  const second = rest[1];
  if (second === 'list' || second === 'create') {
    return { command: first, branchSubcommand: second, rest: rest.slice(2) };
  }
  if (second !== undefined && !second.startsWith('-') && second !== '--') {
    throw new Error(`Unknown branch subcommand: ${second}. Expected one of list, create.`);
  }
  return { command: first, rest: rest.slice(1) };
}

export function buildOptions(
  result: Exclude<ReturnType<typeof parseFlags>, null>,
  command?: string,
  branchSubcommand?: string,
  vaultSubcommand?: string,
): SecretSyncOptions {
  const { values, repeat } = result;
  return {
    ...(values.config === undefined ? {} : { config: values.config }),
    ...(values.cwd === undefined ? {} : { cwd: values.cwd }),
    ...(command === undefined ? {} : { command }),
    ...(branchSubcommand === undefined ? {} : { branchSubcommand }),
    ...(vaultSubcommand === undefined ? {} : { vaultSubcommand }),
    ...(values.branch === undefined ? {} : { branch: values.branch }),
    ...(repeat.file === undefined ? {} : { file: [...repeat.file] }),
    ...(values.message === undefined ? {} : { message: values.message }),
    ...(values.revision === undefined ? {} : { revision: values.revision }),
    ...(values.limit === undefined ? {} : { limit: values.limit }),
    ...(repeat.head === undefined ? {} : { heads: [...repeat.head] }),
    ...(values.take === undefined ? {} : { take: values.take }),
    ...(values.name === undefined ? {} : { name: values.name }),
    ...(values.from === undefined ? {} : { from: values.from }),
    ...(values['from-branch'] === undefined ? {} : { fromBranch: values['from-branch'] }),
    ...(values.vault === undefined ? {} : { vault: values.vault }),
    ...(values.provider === undefined ? {} : { provider: values.provider }),
    ...(values.auth === undefined ? {} : { auth: values.auth }),
    ...(values.account === undefined ? {} : { account: values.account }),
    ...(values['token-env'] === undefined ? {} : { tokenEnv: values['token-env'] }),
    ...(values.json === undefined ? {} : { json: true }),
    ...(values['dry-run'] === undefined ? {} : { dryRun: true }),
    ...(values.check === undefined ? {} : { check: true }),
    ...(values.delete === undefined ? {} : { remove: true }),
    ...(values.overwrite === undefined ? {} : { overwrite: true }),
    ...(values['acknowledge-remote'] === undefined ? {} : { acknowledgeRemote: true }),
  };
}

function printRootHelp(): void {
  console.log(`repo-toolkit-secret-sync

Usage:
  repo-toolkit-secret-sync <command> [options]
  repo-toolkit-secret-sync branch <list|create> [options]
  repo-toolkit-secret-sync vault <list> [options]

Commands:
  init       Generate project UUID/config and protected local state
  doctor     Validate config, matching support, and connectivity
  status     Three-way per-file status and branch/head summary
  push       Synchronize local changes to the remote vault
  pull       Synchronize remote changes to the local worktree
  diff       Metadata-only local/remote or revision comparison
  log        Bounded per-file history over branch ancestry
  restore    Materialize one historical file locally
  rollback   Publish a new commit replacing one file with its historical blob
  branch     List or create independent named branches
  switch     Switch the active branch through guarded pull machinery
  resolve    Join observed divergent heads by choosing one full snapshot
  vault      List vaults visible to the configured credential

Selection (exact paths; repeatable; never overrides excludes):
  --file <path>            Exact project-relative path (repeatable, no comma
                           splitting; use --file=<name> for dash-leading names,
                           e.g. --file=-leading-name)

Common options (all commands):
  --config <path>          Config file (JSON, .mjs, or .cjs default export)
  --cwd <path>             Working directory (default: process.cwd())
  --branch <name>          Target branch for read-only commands and switch
  --json                   Emit schema-versioned JSON output
  --dry-run                Reads permitted; no remote/local writes, locks, state, or temp files
  -h, --help               Show this help message (or per-command help after a command)

Command options:
  status:   --check --file <path>
  push:     --file <path> --message <text> --delete
  pull:     --file <path> --delete
  diff:     --file <path>
  log:      --file <path> --limit <count>
  restore:  --file <path> --revision <blob-id> | --from-branch <name>
            [--overwrite] [--acknowledge-remote]
  rollback: --file <path> --revision <blob-id> [--message <text>]
  branch list:   (no extra flags)
  branch create: --name <branch> [--from <branch>]
  vault list:    [--provider onepassword-connect | onepassword-sdk]
                 [--auth service-account | desktop] [--account <selector>] [--token-env <name>]
  switch:   --branch <name>
  resolve:  --head <commit-A> --head <commit-B> --take <commit-A>
  init:     --vault <vault-id> [--provider onepassword-connect | onepassword-sdk]
            [--auth service-account | desktop] [--account <selector>] [--token-env <name>]
  doctor:   --branch <name>
`);
}

function printCommandHelp(command: string, branchSubcommand?: string, vaultSubcommand?: string): void {
  const key =
    command === 'branch'
      ? `branch ${branchSubcommand ?? 'list'}`
      : command === 'vault'
        ? `vault ${vaultSubcommand ?? 'list'}`
        : command;
  console.log(`repo-toolkit-secret-sync ${key}

Usage:
  repo-toolkit-secret-sync ${key} [options]

Common options:
  --config <path>          Config file (JSON, .mjs, or .cjs default export)
  --cwd <path>             Working directory (default: process.cwd())
  --json                   Emit schema-versioned JSON output
  -h, --help               Show this help message

Command-specific flags are strictly validated; unrelated flags are rejected.
Use --file=<name> for dash-leading paths (e.g. --file=-leading-name).
`);
}

async function main(): Promise<void> {
  let extracted: ExtractedCommand;
  try {
    extracted = extractCommand(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
    return;
  }
  let parsed: Exclude<ReturnType<typeof parseFlags>, null>;
  try {
    const result = parseFlags(extracted.rest, SPECS);
    if (!result) {
      if (extracted.command === undefined) {
        printRootHelp();
      } else {
        printCommandHelp(extracted.command, extracted.branchSubcommand, extracted.vaultSubcommand);
      }
      return;
    }
    parsed = result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
    return;
  }
  const json = parsed.values.json === 'true';
  const commandLabel = extracted.command ?? 'status';
  try {
    assertCommandFlags(parsed, extracted.command, extracted.branchSubcommand, extracted.vaultSubcommand);
    const options = buildOptions(parsed, extracted.command, extracted.branchSubcommand, extracted.vaultSubcommand);
    const outcome = await runSecretSync(options);
    const resultData = (outcome as { result: unknown }).result;
    if (json) {
      console.log(formatJsonResult(outcome.command, resultData));
    } else {
      console.log(formatTextResult(outcome.command, resultData));
    }
    if (outcome.command === 'status' && options.check === true) {
      const report = resultData as { checkFailed?: boolean };
      if (report.checkFailed === true) {
        process.exitCode = 1;
      }
    }
  } catch (error) {
    const secrets = await collectErrorSecrets(buildOptionsSafe(parsed, extracted));
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      console.log(formatJsonError(commandLabel, error, secrets));
    }
    console.error(redactText(message, secrets));
    process.exitCode = 1;
  }
}

function buildOptionsSafe(
  parsed: Exclude<ReturnType<typeof parseFlags>, null>,
  extracted: ExtractedCommand,
): SecretSyncOptions {
  try {
    return buildOptions(parsed, extracted.command, extracted.branchSubcommand);
  } catch {
    return {};
  }
}

async function collectErrorSecrets(options: SecretSyncOptions): Promise<string[]> {
  const env = process.env as Record<string, string | undefined>;
  const fallback: string[] = [];
  for (const name of ['OP_CONNECT_TOKEN', 'OP_CONNECT_HOST', 'OP_SERVICE_ACCOUNT_TOKEN']) {
    const value = env[name];
    if (typeof value === 'string' && value.length > 0) {
      fallback.push(value);
    }
  }
  try {
    const plan = await resolveSecretSyncPlan(options);
    return collectCliSecrets(plan, env);
  } catch {
    return fallback;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
