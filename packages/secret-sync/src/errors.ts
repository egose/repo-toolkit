export type SecretSyncErrorCode =
  | 'aborted'
  | 'invalid-url'
  | 'redirect-blocked'
  | 'auth'
  | 'not-found'
  | 'rate-limited'
  | 'server'
  | 'network'
  | 'timeout'
  | 'too-large'
  | 'truncated'
  | 'schema'
  | 'validation'
  | 'uncertain-write'
  | 'remote-empty'
  | 'remote-diverged'
  | 'remote-incomplete'
  | 'remote-corrupt'
  | 'state-corrupt'
  | 'identity-mismatch'
  | 'lock-busy'
  | 'unsafe-path'
  | 'local-changed';

export interface SecretSyncErrorOptions {
  status?: number;
  retryable?: boolean;
  method?: string;
  path?: string;
  cause?: unknown;
}

export class SecretSyncError extends Error {
  readonly code: SecretSyncErrorCode;
  readonly status?: number;
  readonly retryable: boolean;
  readonly method?: string;
  readonly path?: string;

  constructor(code: SecretSyncErrorCode, message: string, options: SecretSyncErrorOptions = {}) {
    super(message);
    this.name = 'SecretSyncError';
    this.code = code;
    if (options.status !== undefined) {
      this.status = options.status;
    }
    this.retryable = options.retryable ?? false;
    if (options.method !== undefined) {
      this.method = options.method;
    }
    if (options.path !== undefined) {
      this.path = options.path;
    }
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isSecretSyncError(value: unknown): value is SecretSyncError {
  return value instanceof SecretSyncError;
}

export function isRetryableSecretSyncError(value: unknown): boolean {
  return value instanceof SecretSyncError && value.retryable === true;
}
