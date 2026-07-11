import { loadConfigFile, parseFlags, type FlagSpec } from '@repo-toolkit/publish-package';
import { verifyReleaseArtifact, type VerifyArtifactOptions } from './index';

const SPECS: FlagSpec[] = [
  { name: 'config' },
  { name: 'cwd' },
  { name: 'version', aliases: ['tag'] },
  { name: 'tool-name' },
  { name: 'dist-dir' },
  { name: 'artifact-path' },
  { name: 'help-flag' },
  { name: 'skip-exec', boolean: true },
];

function printHelp(): void {
  console.log(`repo-toolkit-verify-artifact

Usage:
  repo-toolkit-verify-artifact --version <version> [options]

Options:
  --config <path>                Config file (JSON, .mjs, or .cjs default export)
  --cwd <path>                   Workspace root directory (default: process.cwd())
  --version <version>            Target version used to locate the tarball (required). A leading "v" is stripped.
  --tag <version>                Alias for --version
  --tool-name <name>             Tool name used to locate the tarball (default: repo-toolkit)
  --dist-dir <path>              Directory under workspace root holding the tarball (default: dist)
  --artifact-path <path>         Explicit tarball path; overrides cwd/tool-name/dist-dir resolution
  --help-flag <flag>             Flag passed to each wrapper to confirm it boots (default: --help)
  --skip-exec                    Skip executing wrappers; only check manifest, files, and 'bash -n'
  -h, --help                     Show this help message
`);
}

function buildOptions(values: Record<string, string>): Partial<VerifyArtifactOptions> {
  const options: Partial<VerifyArtifactOptions> = {};

  if (values.cwd) options.cwd = values.cwd;
  if (values.version) options.version = values.version;
  if (values['tool-name']) options.toolName = values['tool-name'];
  if (values['dist-dir']) options.distDir = values['dist-dir'];
  if (values['artifact-path']) options.artifactPath = values['artifact-path'];
  if (values['help-flag']) options.helpFlag = values['help-flag'];
  if (values['skip-exec'] !== undefined) options.skipExec = true;

  return options;
}

async function main(): Promise<void> {
  const result = parseFlags(process.argv.slice(2), SPECS);

  if (!result) {
    printHelp();
    return;
  }

  const configPath = result.values.config;
  const options = buildOptions(result.values);

  const config = configPath ? await loadConfigFile<VerifyArtifactOptions>(configPath, options.cwd) : {};

  const merged = { ...config, ...options } as VerifyArtifactOptions;

  if (!merged.version && !merged.artifactPath) {
    throw new Error('version is required. Pass --version <version> or set version in the config file.');
  }

  verifyReleaseArtifact(merged);
  console.log('release artifact verified successfully.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
