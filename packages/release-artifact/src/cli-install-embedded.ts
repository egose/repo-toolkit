import { installReleaseArtifact } from './index';

async function main(): Promise<void> {
  const archivePath = process.argv[2];
  const installPath = process.argv[3];
  const version = process.argv[4];
  const toolName = process.argv[5] || 'repo-toolkit';

  if (!archivePath || !installPath || !version) {
    throw new Error('usage: repo-toolkit-install-artifact-embedded <archivePath> <installPath> <version> [toolName]');
  }

  const { installPath: resolvedInstallPath, manifest } = installReleaseArtifact({
    archivePath,
    installPath,
    version,
    toolName,
  });

  process.stdout.write(`installed ${manifest.toolName} v${manifest.version} to ${resolvedInstallPath}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
