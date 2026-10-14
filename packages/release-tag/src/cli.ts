import { collectCliSecrets, parseCliOptions } from './cli-options';
import { safeError } from './diagnostics';
import { formatHelp, formatJsonDryRun, formatJsonResult, formatTextDryRun, formatTextResult } from './format';
import { runReleaseTag } from './run';

const argv = process.argv.slice(2);
const secrets = collectCliSecrets(argv);

async function main(): Promise<void> {
  const parsed = parseCliOptions(argv);
  if (parsed === null) {
    console.log(formatHelp());
    return;
  }
  if (parsed.inlineToken) {
    console.error(
      'warning: prefer --github-token-file over --github-token to avoid exposing the token in process listings',
    );
  }
  const outcome = await runReleaseTag(parsed.options);
  if (outcome.plan.dryRun) {
    console.log(parsed.json ? formatJsonDryRun(outcome.plan, secrets) : formatTextDryRun(outcome.plan, secrets));
  } else {
    console.log(parsed.json ? formatJsonResult(outcome, secrets) : formatTextResult(outcome, secrets));
  }
}

main().catch((error: unknown) => {
  console.error(safeError(error, secrets).message);
  process.exitCode = 1;
});
