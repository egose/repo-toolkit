import { chmodSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

function fail(message) {
  throw new Error(message);
}

function readPackageJson(packageDir) {
  const packageJsonPath = join(packageDir, 'package.json');
  return JSON.parse(readFileSync(packageJsonPath, 'utf8'));
}

function toBinEntries(packageJson) {
  if (!packageJson.bin) {
    return [];
  }

  if (typeof packageJson.bin === 'string') {
    const defaultBinName = packageJson.name.includes('/') ? packageJson.name.split('/').at(-1) : packageJson.name;
    return [[defaultBinName, packageJson.bin]];
  }

  return Object.entries(packageJson.bin);
}

function buildWrapper(targetPath) {
  return [
    '#!/usr/bin/env bash',
    'set -eo pipefail',
    'script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    `exec node "\${script_dir}/../${targetPath}" "$@"`,
    '',
  ].join('\n');
}

const version = process.argv[2];

if (!version) {
  fail('Usage: node scripts/build-release-artifact.mjs <version>');
}

const repoRoot = process.cwd();
const distRoot = resolve(repoRoot, 'dist');
const artifactDirName = `repo-toolkit-${version}`;
const artifactRoot = join(distRoot, artifactDirName);
const artifactPath = join(distRoot, `${artifactDirName}.tar.gz`);
const packagesRoot = resolve(repoRoot, 'packages');
const packageDirs = readdirSync(packagesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => resolve(packagesRoot, entry.name))
  .sort();

rmSync(artifactRoot, { recursive: true, force: true });
rmSync(artifactPath, { force: true });

mkdirSync(join(artifactRoot, 'bin'), { recursive: true });
mkdirSync(join(artifactRoot, 'packages'), { recursive: true });

cpSync(resolve(repoRoot, 'VERSION'), join(artifactRoot, 'VERSION'));
cpSync(resolve(repoRoot, 'node_modules'), join(artifactRoot, 'node_modules'), { recursive: true });

const commands = [];

for (const packageDir of packageDirs) {
  const packageDirName = basename(packageDir);
  const packageJson = readPackageJson(packageDir);

  cpSync(packageDir, join(artifactRoot, 'packages', packageDirName), { recursive: true });

  for (const [commandName, entry] of toBinEntries(packageJson)) {
    commands.push({ name: commandName, packageDir: packageDirName, entry });

    const wrapperPath = join(artifactRoot, 'bin', commandName);
    writeFileSync(wrapperPath, buildWrapper(`packages/${packageDirName}/${entry}`));
    chmodSync(wrapperPath, 0o755);
  }
}

if (commands.length === 0) {
  fail('No CLI package bin entries found under packages/.');
}

commands.sort((left, right) => left.name.localeCompare(right.name) || left.packageDir.localeCompare(right.packageDir));

const requiredFiles = new Set(['VERSION', 'artifact-manifest.json']);
for (const command of commands) {
  requiredFiles.add(`bin/${command.name}`);
  requiredFiles.add(`packages/${command.packageDir}/package.json`);
  requiredFiles.add(`packages/${command.packageDir}/${command.entry}`);
}

writeFileSync(
  join(artifactRoot, 'artifact-manifest.json'),
  JSON.stringify({ version, commands, requiredFiles: [...requiredFiles] }, null, 2) + '\n',
);

execFileSync('tar', ['-czf', artifactPath, '-C', distRoot, artifactDirName], { stdio: 'inherit' });
