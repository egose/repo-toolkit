import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function fail(message) {
  throw new Error(message);
}

const version = process.argv[2];

if (!version) {
  fail('Usage: node scripts/verify-release-artifact.mjs <version>');
}

const artifactDirName = `repo-toolkit-${version}`;
const artifactPath = join(process.cwd(), 'dist', `${artifactDirName}.tar.gz`);

if (!existsSync(artifactPath)) {
  fail(`Missing release artifact: ${artifactPath}`);
}

const extractRoot = mkdtempSync(join(tmpdir(), 'repo-toolkit-artifact-'));

try {
  execFileSync('tar', ['-xzf', artifactPath, '-C', extractRoot], { stdio: 'inherit' });

  const installRoot = join(extractRoot, artifactDirName);
  const manifestPath = join(installRoot, 'artifact-manifest.json');

  if (!existsSync(manifestPath)) {
    fail('Release artifact is missing artifact-manifest.json.');
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  if (!Array.isArray(manifest.requiredFiles)) {
    fail('artifact-manifest.json must contain requiredFiles.');
  }

  if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) {
    fail('artifact-manifest.json must contain at least one command.');
  }

  for (const relativePath of manifest.requiredFiles) {
    if (!existsSync(join(installRoot, relativePath))) {
      fail(`Release artifact is missing ${relativePath}.`);
    }
  }

  for (const command of manifest.commands) {
    const wrapperPath = join(installRoot, 'bin', command.name);
    accessSync(wrapperPath, constants.X_OK);
    execFileSync('bash', ['-n', wrapperPath], { stdio: 'inherit' });
  }
} finally {
  rmSync(extractRoot, { recursive: true, force: true });
}
