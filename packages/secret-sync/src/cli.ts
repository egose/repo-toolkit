import { parseFlags } from '@repo-toolkit/publish-package';

import { SPECS, assertCommandFlags, collectCliSecrets } from './cli-options';
import { formatCommandHelp, formatRootHelp } from './cli-help';
import { formatJsonError, formatJsonResult, formatTextResult, redactText } from './format';
import { SECRET_SYNC_COMMANDS, resolveSecretSyncPlan, runSecretSync, type SecretSyncOptions } from './index';

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
    ...(values.interactive === undefined ? {} : { interactive: true }),
    ...(values.copy === undefined ? {} : { copy: true }),
    ...(values.export === undefined ? {} : { export: values.export }),
  };
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
        console.log(formatRootHelp());
      } else {
        console.log(formatCommandHelp(extracted.command, extracted.branchSubcommand, extracted.vaultSubcommand));
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
    if (outcome.command === 'show') {
      const shown = outcome as { result: { copied: boolean; exported?: string; dryRun: boolean }; bytes: Uint8Array };
      if (shown.result.dryRun === true) {
        if (json) {
          console.log(formatJsonResult(outcome.command, shown.result));
          return;
        }
        console.log(formatTextResult(outcome.command, shown.result));
        return;
      }
      if ((shown.result.copied || shown.result.exported !== undefined) && json) {
        console.log(formatJsonResult(outcome.command, shown.result));
        return;
      }
      if (shown.result.copied || shown.result.exported !== undefined) {
        console.log(formatTextResult(outcome.command, shown.result));
        return;
      }
      process.stdout.write(shown.bytes);
      return;
    }
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
