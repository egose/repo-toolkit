import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

import { knownCredentialSecrets, readProperty, safeError } from './diagnostics';
import type { ReleaseTagPlan } from './plan';
import type { CommandDiagnostics } from './process';

export const MAX_TOKEN_FILE_BYTES = 65536;

const FILE_ERROR_CODES = new Set([
  'ENOENT',
  'EACCES',
  'EPERM',
  'EISDIR',
  'ENOTDIR',
  'ELOOP',
  'EMFILE',
  'ENFILE',
  'EIO',
]);

class TokenFileBoundaryError extends Error {}

function assertToken(value: string, label: string): string {
  if (value.length === 0) {
    throw new Error(`${label} is empty`);
  }
  if (value.includes('\0')) {
    throw new Error(`${label} must not contain NUL bytes`);
  }
  if (/^[A-Za-z0-9._~+/-]+=*$/.exec(value)?.[0] !== value) {
    throw new Error(`${label} must be a single ASCII bearer token without whitespace or control characters`);
  }
  return value;
}

export function resolveExplicitToken(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error('githubToken must be a string');
  }
  return assertToken(value, 'githubToken');
}

async function readTokenFile(path: string): Promise<string> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let raw: string | undefined;
  let failure: Error | undefined;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const info = await file.stat();
    if (!info.isFile()) {
      throw new TokenFileBoundaryError('githubTokenFile must be a regular file');
    }
    if (info.size > MAX_TOKEN_FILE_BYTES) {
      throw new TokenFileBoundaryError(`githubTokenFile exceeds the ${MAX_TOKEN_FILE_BYTES}-byte limit`);
    }
    const bytes = Buffer.alloc(MAX_TOKEN_FILE_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const result = await file.read(bytes, size, bytes.length - size, size);
      if (result.bytesRead === 0) {
        break;
      }
      size += result.bytesRead;
    }
    if (size > MAX_TOKEN_FILE_BYTES) {
      throw new TokenFileBoundaryError(`githubTokenFile exceeds the ${MAX_TOKEN_FILE_BYTES}-byte limit`);
    }
    if (bytes.subarray(0, size).some((byte) => byte > 127)) {
      throw new TokenFileBoundaryError('githubTokenFile must contain an ASCII bearer token');
    }
    raw = bytes.toString('utf8', 0, size);
  } catch (error) {
    if (error instanceof TokenFileBoundaryError) {
      failure = safeError(error.message);
    } else {
      const code = readProperty(error, 'code');
      failure = safeError(
        `Failed to read githubTokenFile (${typeof code === 'string' && FILE_ERROR_CODES.has(code) ? code : 'file I/O error'})`,
      );
    }
  } finally {
    if (file !== undefined) {
      try {
        await file.close();
      } catch {
        failure ??= new Error('Failed to close githubTokenFile');
      }
    }
  }
  if (failure !== undefined) {
    throw failure;
  }
  return assertToken(raw?.trim() ?? '', 'githubTokenFile');
}

export interface CredentialContext {
  resolve(plan: ReleaseTagPlan): Promise<string | undefined>;
  prepare(plan: ReleaseTagPlan): Promise<void>;
  secrets(): ReadonlyArray<string>;
  diagnostics(plan: ReleaseTagPlan): CommandDiagnostics;
}

export function createCredentialContext(explicit: unknown, envName: unknown): CredentialContext {
  const secrets = knownCredentialSecrets(explicit, envName);
  const token = resolveExplicitToken(explicit);
  const tokenEnv = typeof envName === 'string' ? envName : 'GITHUB_TOKEN';
  const envToken = process.env[tokenEnv];
  let pending: Promise<string | undefined> | undefined;
  let resolved = false;

  const resolve = (plan: ReleaseTagPlan): Promise<string | undefined> => {
    pending ??= (async () => {
      let active = token;
      if (active === undefined && plan.githubTokenFile !== undefined) {
        active = await readTokenFile(resolvePath(plan.cwd, plan.githubTokenFile));
      } else if (active === undefined && envToken !== undefined && envToken.length > 0) {
        active = assertToken(envToken, tokenEnv);
      }
      if (active !== undefined && !secrets.includes(active)) {
        secrets.push(active);
      }
      resolved = true;
      return active;
    })();
    return pending;
  };

  return {
    resolve,
    async prepare(plan) {
      if (!plan.dryRun && plan.only.includes('pr') && !plan.skipPr) {
        await resolve(plan);
      }
    },
    secrets: () => [...secrets],
    diagnostics: (plan) => ({
      secrets: [...secrets],
      includeOutput: token !== undefined || plan.githubTokenFile === undefined || resolved,
    }),
  };
}

export function stageCredentialContext(input: unknown): CredentialContext {
  return createCredentialContext(
    readProperty(input, 'githubToken'),
    readProperty(readProperty(input, 'plan'), 'githubTokenEnv'),
  );
}
