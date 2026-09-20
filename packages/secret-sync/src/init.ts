import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { isPlainObject } from '@repo-toolkit/publish-package';

import {
  DEFAULT_BRANCH,
  DEFAULT_HOST_ENV,
  DEFAULT_LIMITS,
  DEFAULT_SDK_TOKEN_ENV,
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
  provider?: string;
  auth?: string;
  account?: string;
  tokenEnv?: string;
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

function assertInitProvider(value: string | undefined): 'onepassword-connect' | 'onepassword-sdk' | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value !== 'onepassword-connect' && value !== 'onepassword-sdk') {
    throw new SecretSyncError('validation', '--provider must be "onepassword-connect" or "onepassword-sdk".');
  }
  return value;
}

function assertInitAuth(value: string | undefined): 'service-account' | 'desktop' | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value !== 'service-account' && value !== 'desktop') {
    throw new SecretSyncError('validation', '--auth must be "service-account" or "desktop".');
  }
  return value;
}

function assertInitTokenEnv(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new SecretSyncError(
      'validation',
      '--token-env must be an environment variable name (OP_SERVICE_ACCOUNT_TOKEN by default).',
    );
  }
  return value;
}

function assertInitAccount(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.length === 0 || value.length > 256) {
    throw new SecretSyncError(
      'validation',
      '--account must be a non-empty 1Password account selector of at most 256 characters.',
    );
  }
  if (value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    throw new SecretSyncError(
      'validation',
      '--account contains characters that are never valid in an account selector.',
    );
  }
  return value;
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
  const provider = assertInitProvider(options.provider);
  const auth = assertInitAuth(options.auth);
  const account = assertInitAccount(options.account);
  const tokenEnv = assertInitTokenEnv(options.tokenEnv);
  if (auth !== undefined && provider !== undefined && provider !== 'onepassword-sdk') {
    throw new SecretSyncError('validation', '--auth requires --provider onepassword-sdk.');
  }
  if (account !== undefined && auth !== 'desktop') {
    throw new SecretSyncError('validation', '--account requires --auth desktop.');
  }
  if (tokenEnv !== undefined && auth !== 'service-account') {
    throw new SecretSyncError('validation', '--token-env requires --auth service-account.');
  }
  const exists = await fileExists(configPath);
  let projectId: string;
  let branch: string;
  let rootAbsolute: string;
  let vaultId: string;
  let hostEnv = DEFAULT_HOST_ENV;
  let bindConnect = false;
  let bindSdk = false;
  let createdConfig = false;

  if (exists) {
    const { loadSecretSyncConfigFile } = await import('./config');
    const loaded = await loadSecretSyncConfigFile(configPath, cwd);
    if (!isPlainObject(loaded.raw)) {
      throw new SecretSyncError('validation', `Config file must export an object: ${loaded.configPath}`);
    }
    const validated = validateSecretSyncConfig(loaded.raw);
    if (provider !== undefined && provider !== validated.remote.type) {
      throw new SecretSyncError(
        'validation',
        'The --provider value differs from the existing config; refusing to overwrite it.',
      );
    }
    if (options.vault !== undefined && options.vault !== validated.remote.vaultId) {
      throw new SecretSyncError(
        'validation',
        'The --vault value differs from the existing config; refusing to overwrite it.',
      );
    }
    if (options.projectId !== undefined && options.projectId !== validated.projectId) {
      throw new SecretSyncError('validation', 'The provided project id differs from the existing config.');
    }
    if (validated.remote.type === 'onepassword-connect') {
      if (auth !== undefined || account !== undefined || tokenEnv !== undefined) {
        throw new SecretSyncError(
          'validation',
          '--auth, --account, and --token-env are only supported with --provider onepassword-sdk.',
        );
      }
    } else if (validated.remote.auth.type === 'service-account') {
      if (auth !== undefined && auth !== 'service-account') {
        throw new SecretSyncError(
          'validation',
          'The --auth value differs from the existing config; refusing to overwrite it.',
        );
      }
      if (account !== undefined) {
        throw new SecretSyncError('validation', '--account requires --auth desktop.');
      }
      if (tokenEnv !== undefined && tokenEnv !== validated.remote.auth.tokenEnv) {
        throw new SecretSyncError(
          'validation',
          'The --token-env value differs from the existing config; refusing to overwrite it.',
        );
      }
    } else {
      if (auth !== undefined && auth !== 'desktop') {
        throw new SecretSyncError(
          'validation',
          'The --auth value differs from the existing config; refusing to overwrite it.',
        );
      }
      if (tokenEnv !== undefined) {
        throw new SecretSyncError('validation', '--token-env requires --auth service-account.');
      }
      if (account !== undefined && account !== validated.remote.auth.account) {
        throw new SecretSyncError(
          'validation',
          'The --account value differs from the existing config; refusing to overwrite it.',
        );
      }
    }
    projectId = validated.projectId;
    branch = options.branch === undefined ? validated.branch : validateBranchName(options.branch);
    rootAbsolute = resolve(loaded.configDir, validated.root);
    vaultId = validated.remote.vaultId;
    if (validated.remote.type === 'onepassword-connect') {
      hostEnv = validated.remote.hostEnv;
      bindConnect = true;
    } else {
      bindSdk = true;
    }
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
    const effectiveProvider = provider ?? 'onepassword-connect';
    let remote: Record<string, unknown>;
    if (effectiveProvider === 'onepassword-sdk') {
      if (auth === undefined) {
        throw new SecretSyncError(
          'validation',
          'init requires --auth service-account or --auth desktop with --provider onepassword-sdk.',
        );
      }
      if (auth === 'service-account') {
        remote = {
          type: 'onepassword-sdk',
          vaultId,
          auth: { type: 'service-account', tokenEnv: tokenEnv ?? DEFAULT_SDK_TOKEN_ENV },
        };
      } else {
        if (account === undefined) {
          throw new SecretSyncError('validation', 'init requires --account <selector> with --auth desktop.');
        }
        remote = { type: 'onepassword-sdk', vaultId, auth: { type: 'desktop', account } };
      }
      bindSdk = true;
    } else {
      if (auth !== undefined || account !== undefined || tokenEnv !== undefined) {
        throw new SecretSyncError(
          'validation',
          '--auth, --account, and --token-env are only supported with --provider onepassword-sdk.',
        );
      }
      remote = { type: 'onepassword-connect', vaultId, hostEnv: DEFAULT_HOST_ENV, tokenEnv: DEFAULT_TOKEN_ENV };
      bindConnect = true;
    }
    const raw = {
      schemaVersion: 1,
      projectId,
      root: rootRel,
      remote,
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
  if (bindSdk) {
    try {
      await initState(rootAbsolute, { type: 'onepassword-sdk', vaultId, projectId }, { branch });
      remoteInitialized = true;
    } catch {
      remoteInitialized = false;
    }
  } else if (bindConnect) {
    const endpointRaw = env[hostEnv];
    if (typeof endpointRaw === 'string' && endpointRaw.trim() !== '') {
      try {
        await initState(rootAbsolute, { endpoint: endpointRaw.trim(), vaultId, projectId }, { branch });
        remoteInitialized = true;
      } catch {
        remoteInitialized = false;
      }
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
