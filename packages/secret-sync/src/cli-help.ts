import { COMMAND_FLAGS, SPECS, commandKey, type CliFlagSpec, type CommandKey } from './cli-options';

interface CommandHelp {
  summary: string;
  usage: string;
  details: string;
  examples: string[];
}

const SDK_SETUP = `SDK prerequisites:
  Node >=20 and the installed @1password/sdk runtime with its sdk-core wasm assets.
  Service-account auth needs OP_SERVICE_ACCOUNT_TOKEN (or the named token env)
  for online commands, with access to the selected vault; Personal/Private/Employee
  vaults are unavailable to service accounts.
  Desktop auth needs the 1Password desktop app with SDK integration enabled,
  a signed-in account, and approval of its access prompt (macOS/Linux/Windows).
  Direct SDK access needs no Connect server or op CLI and never falls back to them.
  Tokens belong only in the environment, never in config or command arguments.
  Connect online commands need a deployed server, OP_CONNECT_HOST and OP_CONNECT_TOKEN
  by default (config may name other variables).`;

const HELP: Record<CommandKey, CommandHelp> = {
  init: {
    summary: 'Generate project UUID/config and protected local state.',
    usage: '[--vault <vault-id>] [options]',
    details:
      'New config requires --vault; provider defaults to onepassword-connect. Existing config is reused without overwriting it. New configs use branch main and root . relative to the config. SDK setup requires --provider onepassword-sdk and --auth service-account | desktop; desktop also requires --account. Local-only init does not authenticate or initialize the SDK.',
    examples: [
      'init --vault <vault-id>',
      'init --vault <vault-id> --provider onepassword-sdk --auth service-account --token-env OP_SERVICE_ACCOUNT_TOKEN',
      'init --vault <vault-id> --provider onepassword-sdk --auth desktop --account <account-id>',
    ],
  },
  doctor: {
    summary: 'Validate config, selection support, and remote read connectivity.',
    usage: '[options]',
    details:
      'No command-specific arguments required. Uses the configured provider and auth; reports observed read capability without probing write access.',
    examples: ['doctor --json'],
  },
  status: {
    summary: 'Report three-way per-file status and branch/head metadata.',
    usage: '[options]',
    details:
      'Default command when none is supplied. No command-specific arguments required. Without --file, inspect the configured selection. Without --branch, use the saved active branch, then the configured branch.',
    examples: ['status --check --json'],
  },
  push: {
    summary: 'Publish selected local changes to the remote vault.',
    usage: '[options]',
    details:
      'No command-specific arguments required. Uses the saved active branch, then the configured branch. Without --file, use the configured selection. Missing local files are not published as tombstones unless --delete is supplied.',
    examples: ['push --file .env --message "Rotate credentials"', 'push --delete --dry-run'],
  },
  pull: {
    summary: 'Materialize selected remote changes in the local worktree.',
    usage: '[options]',
    details:
      'No command-specific arguments required. Uses the saved active branch, then the configured branch. Without --file, use the configured selection. Remote deletions remove local files only with --delete; dirty conflicts refuse.',
    examples: ['pull --dry-run', 'pull --file .env'],
  },
  diff: {
    summary: 'Compare local/remote metadata without printing secret content.',
    usage: '[options]',
    details:
      'No command-specific arguments required. Without --file, compare the configured selection; output contains no plaintext diff.',
    examples: ['diff --file .env --json'],
  },
  log: {
    summary: 'List bounded per-file history over branch ancestry.',
    usage: '--file <path> [options]',
    details:
      'Requires exactly one --file. Entries include blob IDs for historical content workflows and commit IDs for head selection; deleted entries may have no blob ID.',
    examples: ['log --file .env --limit 20'],
  },
  restore: {
    summary: 'Restore one historical file locally without publishing a commit.',
    usage: '--file <path> (--revision <blob-id> | --from-branch <name>) [options]',
    details:
      'Requires exactly one --file and exactly one source: --revision and --from-branch are mutually exclusive. A path absent from the source branch requests removal. Differing existing bytes require --overwrite. Normally the baseline is unchanged, leaving a local change for a later push. --acknowledge-remote instead requires the current remote target on the saved active branch (configured branch if no state); it acknowledges the restored bytes/removal.',
    examples: [
      'restore --file .env --revision <blob-id> --overwrite',
      'restore --file .env --from-branch staging --overwrite',
      'restore --file .env --revision <current-remote-blob-id> --overwrite --acknowledge-remote',
    ],
  },
  rollback: {
    summary: 'Publish a new commit replacing one file with its historical blob.',
    usage: '--file <path> --revision <blob-id> [options]',
    details:
      'Requires exactly one --file and a --revision blob UUID from log. Uses the saved active branch, then the configured branch; requires a clean file at the current remote head. Rerun the same file/revision after an interruption to resume proven recovery.',
    examples: ['rollback --file .env --revision <blob-id> --message "Revert rotation"'],
  },
  'branch list': {
    summary: 'List independent named branches and their observed heads.',
    usage: '[options]',
    details:
      'No command-specific arguments required. This is the default branch subcommand; lists metadata without changing the active branch.',
    examples: ['branch list --json'],
  },
  'branch create': {
    summary: 'Create a named branch from an existing snapshot.',
    usage: '--name <branch> [options]',
    details:
      'Requires --name; --from defaults to main, regardless of the saved active branch. Creates remote history without switching or materializing the new branch.',
    examples: ['branch create --name feature/demo --from main'],
  },
  'vault list': {
    summary: 'List vault metadata visible to the selected credential.',
    usage: '[--provider onepassword-connect | onepassword-sdk] [options]',
    details:
      'Default vault subcommand. With a config, provider/auth come from it: do not supply --provider, --auth, --account, or --token-env. Without a config (including the default config), --provider is required. SDK discovery additionally requires --auth; desktop requires --account. No vault ID is needed for discovery.',
    examples: [
      'vault list --config secret-sync.config.json --json',
      'vault list --provider onepassword-connect',
      'vault list --provider onepassword-sdk --auth service-account',
      'vault list --provider onepassword-sdk --auth desktop --account <account-id>',
    ],
  },
  show: {
    summary: 'Read one tracked file’s verified bytes without pulling it.',
    usage: '(--file <path> | --interactive [--file <path>]) [options]',
    details:
      'Requires exactly one --file unless --interactive is supplied; interactive mode also accepts one file to pre-answer its picker. Default revision is the selected branch head. Default output is raw bytes on stdout, without a newline or metadata wrapper. --json is rejected for ordinary raw output without --copy, --export, or --dry-run. On non-dry runs those sinks suppress raw stdout; their JSON is metadata-only. --copy and --export may be combined. --dry-run is a metadata-only preview in text or JSON: it performs no clipboard/export writes and prints no raw bytes; API bytes are empty while byteLength reports the verified size.',
    examples: ['show --file .env > out.env', 'show --file .env --export out.env --json', 'show --interactive --copy'],
  },
  switch: {
    summary: 'Switch the active branch with guarded selected-file materialization.',
    usage: '--branch <name> [options]',
    details:
      'Requires --branch. Applies configured files/ignore selection; dirty selected files refuse. Excluded files and baselines are preserved. Retry the same target/selection with unchanged heads to resume an interrupted switch.',
    examples: ['switch --branch feature/demo --dry-run', 'switch --branch feature/demo'],
  },
  resolve: {
    summary: 'Join divergent heads by choosing one entire snapshot.',
    usage: '--head <commit-A> --head <commit-B> --take <commit-A> [options]',
    details:
      'Requires at least two distinct --head commit UUIDs matching all observed heads and --take equal to one of them. Without --branch, uses the configured branch (main when omitted in config). With --branch, joins only that branch’s observed heads. Publishes a join commit without materializing files or switching the active branch; local bytes and baselines are unchanged.',
    examples: ['resolve --head <commit-A> --head <commit-B> --take <commit-A> --dry-run'],
  },
};

function describeFlag(spec: CliFlagSpec, key?: CommandKey): string {
  if (spec.name === 'file') {
    const cardinality =
      key === 'show'
        ? 'At most one; required unless interactive.'
        : key === 'log' || key === 'restore' || key === 'rollback'
          ? 'Required: exactly one.'
          : 'Optional, repeatable; default: configured selection.';
    return `${cardinality} ${spec.description}`;
  }
  if (spec.name === 'branch' && key === 'status')
    return 'Optional target; default: saved active branch, then configured branch (main if unset).';
  if (spec.name === 'branch' && key === 'switch') return 'Required target branch to materialize and activate.';
  if (spec.name === 'branch' && key === 'resolve')
    return 'Optional target; default: configured branch (main if unset). Joins only that branch; the active branch and worktree are unchanged.';
  if (spec.name === 'json' && key === 'show')
    return 'Requires --copy, --export, or --dry-run; metadata-only, never includes secret bytes. See output restrictions above.';
  if (spec.name === 'dry-run' && key === 'show')
    return 'Metadata-only preview (default: false); no clipboard/export writes, no raw bytes, and no state/worktree writes. Reads still require credentials.';
  return spec.description;
}

function wrapText(text: string, indent = ''): string {
  const lines: string[] = [];
  let line = indent;
  for (const word of text.split(/\s+/)) {
    if (line.length > indent.length && line.length + word.length + 1 > 88) {
      lines.push(line);
      line = indent;
    }
    line += `${line.length === indent.length ? '' : ' '}${word}`;
  }
  lines.push(line);
  return lines.join('\n');
}

function renderFlags(flags: ReadonlyArray<string>, key?: CommandKey): string {
  return flags
    .map((name) => {
      const spec = SPECS.find((candidate) => candidate.name === name);
      if (spec === undefined) throw new Error(`Missing CLI flag specification: ${name}`);
      return `  --${name}${spec.argument === undefined ? '' : ` ${spec.argument}`}\n${wrapText(describeFlag(spec, key), '      ')}`;
    })
    .join('\n');
}

export function formatCommandHelp(command: string, branchSubcommand?: string, vaultSubcommand?: string): string {
  const key = commandKey(command, branchSubcommand, vaultSubcommand) as CommandKey;
  const help = HELP[key];
  return `repo-toolkit-secret-sync ${key}

${help.summary}

Usage:
  repo-toolkit-secret-sync ${key} ${help.usage}

${wrapText(help.details)}

Options:
${renderFlags(COMMAND_FLAGS[key], key)}
  -h, --help
      Show help without loading config, reading credentials, or initializing providers.
${key === 'init' || key === 'vault list' || key === 'doctor' ? `\n${SDK_SETUP}\n` : ''}
Examples (replace angle-bracket placeholders with your IDs/names):
${help.examples.map((example) => `  repo-toolkit-secret-sync ${example}`).join('\n')}
`;
}

export function formatRootHelp(): string {
  return `repo-toolkit-secret-sync

Usage:
  repo-toolkit-secret-sync <command> [options]
  repo-toolkit-secret-sync <command> --help
  repo-toolkit-secret-sync branch <list|create> --help
  repo-toolkit-secret-sync vault list --help

Default command: status. Default branch/vault subcommand: list.
Help is local: no config, credentials, or provider initialization required.
Command-specific flags are strictly validated; use each command's help for requirements.

Commands:
${Object.entries(HELP)
  .map(([key, help]) => `  ${key.padEnd(15)} ${help.summary}\n    ${key} ${help.usage}`)
  .join('\n')}

Getting started:
${formatCommandHelp('init')}`;
}
