export type SecretSyncCommand =
  | 'init'
  | 'doctor'
  | 'status'
  | 'push'
  | 'pull'
  | 'diff'
  | 'log'
  | 'restore'
  | 'rollback'
  | 'branch'
  | 'switch'
  | 'resolve';

export type BranchSubcommand = 'list' | 'create';

export interface SecretSyncConnectRemoteConfig {
  type: 'onepassword-connect';
  vaultId: string;
  hostEnv: string;
  tokenEnv: string;
}

export interface SecretSyncSdkServiceAccountAuth {
  type: 'service-account';
  tokenEnv: string;
}

export interface SecretSyncSdkDesktopAuth {
  type: 'desktop';
  account: string;
}

export type SecretSyncSdkAuthConfig = SecretSyncSdkServiceAccountAuth | SecretSyncSdkDesktopAuth;

export interface SecretSyncSdkRemoteConfig {
  type: 'onepassword-sdk';
  vaultId: string;
  auth: SecretSyncSdkAuthConfig;
}

export type SecretSyncRemoteConfig = SecretSyncConnectRemoteConfig | SecretSyncSdkRemoteConfig;

export interface SecretSyncLimits {
  maxFileBytes: number;
  maxFiles: number;
  concurrency: number;
}

export interface SecretSyncRawConfig {
  schemaVersion?: unknown;
  projectId?: unknown;
  root?: unknown;
  remote?: unknown;
  branch?: unknown;
  files?: unknown;
  ignore?: unknown;
  limits?: unknown;
  [key: string]: unknown;
}

export interface SecretSyncValidatedConfig {
  schemaVersion: 1;
  projectId: string;
  root: string;
  remote: SecretSyncRemoteConfig;
  branch: string;
  files: string[];
  ignore: string[];
  limits: SecretSyncLimits;
}

export interface SecretSyncCommandOptions {
  branch?: string;
  files?: string[];
  dryRun?: boolean;
  json?: boolean;
  check?: boolean;
  remove?: boolean;
  message?: string;
  revision?: string;
  limit?: number;
  overwrite?: boolean;
  acknowledgeRemote?: boolean;
  fromBranch?: string;
  heads?: string[];
  take?: string;
  name?: string;
  from?: string;
  vault?: string;
  provider?: string;
  auth?: string;
  account?: string;
  tokenEnv?: string;
  branchSubcommand?: BranchSubcommand;
}

export interface SecretSyncPlan extends SecretSyncValidatedConfig {
  cwd: string;
  rootAbsolute: string;
  configPath?: string;
  command: SecretSyncCommand;
  commandOptions: SecretSyncCommandOptions;
}
