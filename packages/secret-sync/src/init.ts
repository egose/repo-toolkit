import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { isPlainObject } from '@repo-toolkit/publish-package';

import {
  DEFAULT_BRANCH,
  DEFAULT_HOST_ENV,
  DEFAULT_LIMITS,
  DEFAULT_TOKEN_ENV,
  validateBranchName,
  validateSecretSyncConfig,
} from './config';
import { SECRET_SYNC_STATE_DIR } from './discovery';
import { SecretSyncError } from './errors';
import { initState } from './state';

export const INIT_DEFAULT_CONFIG = 'secret-sync.config.json';
export const STATE_GITIGNORE_ENTRY = '.repo-toolkit-secret-sync/';

export interface InitOptions {
  cwd?: string;
  config?: string;
  vault?: string;
  projectId?: string;
  branch?: string;
  root?: string;
  env?: Record<string, string | undefined>;
}

export interface InitResult {
  initialized: boolean;
  createdConfig: boolean;
  configPath: string;
  projectId: string;
  branch: string;
  stateDir: string;
  gitignoreUpdated: boolean;
  remoteInitialized: boolean;
  note: string;
}

function resolveConfigTarget(cwd: string, config?: string): string {
  if (config === undefined) {
    return resolve(cwd, INIT_DEFAULT_CONFIG);
  }
  return resolve(cwd, config);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureStateDir(rootAbsolute: string): Promise<string> {
  const dir = join(resolve(rootAbsolute), SECRET_SYNC_STATE_DIR);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  return dir;
}

async function updateGitignore(rootAbsolute: string): Promise<boolean> {
  const target = join(resolve(rootAbsolute), '.gitignore');
  let existing: string;
  try {
    existing = await readFile(target, 'utf8');
  } catch {
    return false;
  }
  const lines = existing.split('\n');
  for (const line of lines) {
    if (line.trim() === STATE_GITIGNORE_ENTRY || line.trim() === '.repo-toolkit-secret-sync') {
      return false;
    }
  }
  const suffix = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  await writeFile(target, `${existing}${suffix}${STATE_GITIGNORE_ENTRY}\n`, 'utf8');
  return true;
}

export async function initSecrets(options: InitOptions = {}): Promise<InitResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const configPath = resolveConfigTarget(cwd, options.config);
  const env = options.env ?? (process.env as Record<string, string | undefined>);
  const exists = await fileExists(configPath);
  let projectId: string;
  let branch: string;
  let rootAbsolute: string;
  let vaultId: string;
  let hostEnv = DEFAULT_HOST_ENV;
  let createdConfig = false;

  if (exists) {
    const { loadSecretSyncConfigFile } = await import('./config');
    const loaded = await loadSecretSyncConfigFile(configPath, cwd);
    if (!isPlainObject(loaded.raw)) {
      throw new SecretSyncError('validation', `Config file must export an object: ${loaded.configPath}`);
    }
    const validated = validateSecretSyncConfig(loaded.raw);
    if (options.vault !== undefined && options.vault !== validated.remote.vaultId) {
      throw new SecretSyncError(
        'validation',
        'The --vault value differs from the existing config; refusing to overwrite it.',
      );
    }
    if (options.projectId !== undefined && options.projectId !== validated.projectId) {
      throw new SecretSyncError('validation', 'The provided project id differs from the existing config.');
    }
    projectId = validated.projectId;
    branch = options.branch === undefined ? validated.branch : validateBranchName(options.branch);
    rootAbsolute = resolve(loaded.configDir, validated.root);
    vaultId = validated.remote.vaultId;
    hostEnv = validated.remote.hostEnv;
  } else {
    if (options.vault === undefined || options.vault.length === 0) {
      throw new SecretSyncError('validation', 'init requires --vault <vault-id> when creating a new config.');
    }
    vaultId = options.vault;
    projectId = options.projectId === undefined ? randomUUID() : options.projectId;
    branch = options.branch === undefined ? DEFAULT_BRANCH : validateBranchName(options.branch);
    const rootRel = options.root ?? '.';
    const configDir = resolve(configPath, '..');
    rootAbsolute = resolve(configDir, rootRel);
    const raw = {
      schemaVersion: 1,
      projectId,
      root: rootRel,
      remote: { type: 'onepassword-connect', vaultId, hostEnv: DEFAULT_HOST_ENV, tokenEnv: DEFAULT_TOKEN_ENV },
      branch,
      files: ['.env'],
      ignore: ['**/.env.example', '**/node_modules/**', '**/dist/**'],
      limits: { ...DEFAULT_LIMITS },
    };
    validateSecretSyncConfig(raw);
    await mkdir(resolve(configPath, '..'), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
    await chmod(configPath, 0o600);
    createdConfig = true;
  }

  const stateDir = await ensureStateDir(rootAbsolute);
  const gitignoreUpdated = await updateGitignore(rootAbsolute);

  let remoteInitialized = false;
  const endpointRaw = env[hostEnv];
  if (typeof endpointRaw === 'string' && endpointRaw.trim() !== '') {
    try {
      await initState(rootAbsolute, { endpoint: endpointRaw.trim(), vaultId, projectId }, { branch });
      remoteInitialized = true;
    } catch {
      remoteInitialized = false;
    }
  }

  return {
    initialized: true,
    createdConfig,
    configPath,
    projectId,
    branch,
    stateDir,
    gitignoreUpdated,
    remoteInitialized,
    note: remoteInitialized
      ? 'Local config and protected state are ready; remote records are created on the first push.'
      : 'Local config and protected state directory are ready; remote initialization happens on the first push.',
  };
}
