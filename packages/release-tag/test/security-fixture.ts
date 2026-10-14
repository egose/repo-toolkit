import { inspect } from 'node:util';
import { expect } from 'vitest';

import type { DeterminedTag, ReleaseBranchResult } from '../src/index';

export const EXPLICIT_TOKEN = 'boundary-explicit-secret-e8c1b4';
export const ENV_TOKEN = 'boundary-env-secret-f0a5d2';
export const FILE_TOKEN = 'boundary-file-secret-c7d9a3';

export const DETERMINED: DeterminedTag = {
  version: '1.2.3',
  tagVersion: 'v1.2.3',
  bump: null,
  lastTag: null,
  manual: true,
  noChanges: false,
};

export const RELEASE: ReleaseBranchResult = {
  baseBranch: 'main',
  releaseBranch: 'changelog/1.2.3',
  releaseRan: false,
  skippedReason: 'skipped via skipRelease',
  tagMessage: 'Release notes',
  prTitle: 'Release candidate v1.2.3',
};

export async function caughtError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error('Expected the operation to fail');
}

export function expectSecretFree(value: unknown, secrets = [EXPLICIT_TOKEN, ENV_TOKEN, FILE_TOKEN]): void {
  const views = [
    inspect(value, { depth: null, showHidden: true }),
    JSON.stringify(value),
    ...(value instanceof Error
      ? [value.message, value.stack, JSON.stringify(value, Object.getOwnPropertyNames(value))]
      : []),
  ];
  for (const text of views) {
    for (const secret of secrets) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain(encodeURIComponent(secret));
    }
  }
  if (value instanceof Error) {
    expect(Object.prototype.hasOwnProperty.call(value, 'cause')).toBe(false);
  }
}

export function unsafeError(message: string, name = 'Error'): Error {
  const error = new Error(message);
  error.name = name;
  error.stack = `unsafe caller stack ${EXPLICIT_TOKEN} ${ENV_TOKEN} ${FILE_TOKEN}`;
  Object.assign(error, {
    cause: new Error(`nested cause ${EXPLICIT_TOKEN} ${ENV_TOKEN} ${FILE_TOKEN}`),
    request: { headers: { Authorization: `Bearer ${EXPLICIT_TOKEN}` } },
  });
  return error;
}
