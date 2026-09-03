import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  VersionResolutionError,
  bumpVersion,
  isValidSemver,
  normalizeReleaseVersion,
  redactSensitiveValues,
  resolvePublishPackagePlan,
  resolvePublishPackagePlanAsync,
  resolveRegistryBumpVersion,
  type ProcessCaptureOptions,
  type ProcessCaptureResult,
  type CapturingProcessRunner,
  type ProcessRunner,
} from '../src/index';

function fakeCaptureRunner(
  handler: (
    executable: string,
    args: ReadonlyArray<string>,
    options: ProcessCaptureOptions,
  ) => ProcessCaptureResult | Promise<ProcessCaptureResult>,
): CapturingProcessRunner & { invocations: Array<{ executable: string; args: string[] }> } {
  const invocations: Array<{ executable: string; args: string[] }> = [];
  return {
    invocations,
    run() {
      throw new Error('run must not be called');
    },
    runShell() {
      throw new Error('runShell must not be called');
    },
    async capture(executable, args, options) {
      invocations.push({ executable, args: [...args] });
      return handler(executable, args, options);
    },
  };
}

function plainFakeRunner(): ProcessRunner & { runs: number } {
  const fake = {
    runs: 0,
    run() {
      fake.runs += 1;
    },
    runShell() {
      fake.runs += 1;
    },
  };
  return fake;
}

async function withFixture(
  packageJson: Record<string, unknown>,
  fn: (rootDir: string) => Promise<void> | void,
): Promise<void> {
  const rootDir = await mkdtemp(join(tmpdir(), 'publish-package-version-'));
  try {
    await writeFile(join(rootDir, 'package.json'), JSON.stringify(packageJson, null, 2));
    await fn(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

describe('isValidSemver', () => {
  it('accepts full semver 2.0.0 versions', () => {
    for (const version of [
      '0.0.0',
      '1.2.3',
      '10.20.30',
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-0.3.7',
      '1.0.0-x-y-z.--',
      '1.0.0-alpha+001',
      '1.0.0+20130313144700',
      '1.0.0-beta+exp.sha.5114f85',
    ]) {
      expect(isValidSemver(version), version).toBe(true);
    }
  });

  it('rejects versions npm would reject', () => {
    for (const version of [
      '',
      'not-a-semver',
      'v1.2.3',
      '1',
      '1.2',
      '1.2.3.4',
      '01.2.3',
      '1.02.3',
      '1.2.03',
      '1.2.3-',
      '1.2.3+',
      '1.2.3-alpha..1',
      '1.2.3-alpha..',
      '1.2.3-01',
      '1.2.3+meta..data',
      ' 1.2.3',
      '1.2.3 ',
      '1.2.3\n',
    ]) {
      expect(isValidSemver(version), version).toBe(false);
    }
  });
});

describe('normalizeReleaseVersion', () => {
  it('strips one leading v from explicit versions', () => {
    expect(normalizeReleaseVersion('v1.2.3', 'version')).toBe('1.2.3');
    expect(normalizeReleaseVersion('1.2.3', 'version')).toBe('1.2.3');
    expect(normalizeReleaseVersion('v1.2.3-rc.1', 'version')).toBe('1.2.3-rc.1');
  });

  it('strips only one leading v', () => {
    expect(() => normalizeReleaseVersion('vv1.2.3', 'version')).toThrowError(VersionResolutionError);
  });

  it('rejects invalid versions with the invalid-version kind', () => {
    try {
      normalizeReleaseVersion('not-a-semver', 'version');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(VersionResolutionError);
      expect((error as VersionResolutionError).kind).toBe('invalid-version');
      expect((error as Error).message).toContain('version');
    }
  });
});

describe('bumpVersion', () => {
  it('applies major, minor, and patch bumps', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
  });

  it('drops prerelease and build metadata', () => {
    expect(bumpVersion('1.2.3-rc.1+build.5', 'patch')).toBe('1.2.4');
  });

  it('rejects an invalid base version', () => {
    expect(() => bumpVersion('1.2', 'patch')).toThrowError(VersionResolutionError);
  });
});

describe('resolvePublishPackagePlan version validation', () => {
  it('resolves an explicit v-prefixed version', async () => {
    await withFixture({ name: 'pkg', version: '0.0.0-PLACEHOLDER' }, async (rootDir) => {
      const plan = resolvePublishPackagePlan({ cwd: rootDir, version: 'v1.2.3' });
      expect(plan.version).toBe('1.2.3');
    });
  });

  it('rejects a non-semver explicit version before any runner side effect', async () => {
    await withFixture({ name: 'pkg', version: '0.0.0-PLACEHOLDER' }, async (rootDir) => {
      const runner = plainFakeRunner();
      expect(() => resolvePublishPackagePlan({ cwd: rootDir, version: 'not-a-semver', runner })).toThrowError(
        /not a valid semver/,
      );
      expect(runner.runs).toBe(0);
    });
  });

  it('rejects a non-semver manifest version', async () => {
    await withFixture({ name: 'pkg', version: 'soon' }, async (rootDir) => {
      expect(() => resolvePublishPackagePlan({ cwd: rootDir })).toThrowError(/not a valid semver/);
    });
  });

  it('keeps accepting a semver manifest version without an explicit version', async () => {
    await withFixture({ name: 'pkg', version: '2.3.4' }, async (rootDir) => {
      const plan = resolvePublishPackagePlan({ cwd: rootDir });
      expect(plan.version).toBe('2.3.4');
    });
  });

  it('rejects version and bump combined', async () => {
    await withFixture({ name: 'pkg', version: '2.3.4' }, async (rootDir) => {
      expect(() => resolvePublishPackagePlan({ cwd: rootDir, version: '1.2.3', bump: 'patch' })).toThrowError(
        /mutually exclusive/,
      );
    });
  });

  it('rejects a bump in the synchronous resolver with a clear message', async () => {
    await withFixture({ name: 'pkg', version: '2.3.4' }, async (rootDir) => {
      expect(() => resolvePublishPackagePlan({ cwd: rootDir, bump: 'patch' })).toThrowError(
        /resolvePublishPackagePlanAsync/,
      );
    });
  });

  it('rejects an unknown bump value', async () => {
    await withFixture({ name: 'pkg', version: '2.3.4' }, async (rootDir) => {
      expect(() => resolvePublishPackagePlan({ cwd: rootDir, bump: 'huge' as never })).toThrowError(
        /bump must be one of/,
      );
    });
  });
});

describe('resolveRegistryBumpVersion', () => {
  const base = { packageName: 'pkg', cwd: '/tmp' };

  it('bumps the registry version for each strategy', async () => {
    for (const [bump, expected] of [
      ['major', '2.0.0'],
      ['minor', '1.3.0'],
      ['patch', '1.2.4'],
    ] as const) {
      const runner = fakeCaptureRunner(() => ({ stdout: '"1.2.3"\n', stderr: '', code: 0 }));
      const version = await resolveRegistryBumpVersion({ ...base, bump, runner });
      expect(version).toBe(expected);
      expect(runner.invocations[0]).toEqual({ executable: 'npm', args: ['view', 'pkg', 'version', '--json'] });
    }
  });

  it('forwards a configured registry via --registry', async () => {
    const runner = fakeCaptureRunner(() => ({ stdout: '"1.2.3"', stderr: '', code: 0 }));
    await resolveRegistryBumpVersion({ ...base, bump: 'patch', registry: 'https://registry.internal/', runner });
    expect(runner.invocations[0].args).toEqual([
      'view',
      'pkg',
      'version',
      '--json',
      '--registry',
      'https://registry.internal/',
    ]);
  });

  it('treats a confirmed E404 absence as an initial release', async () => {
    const runner = fakeCaptureRunner(() => ({
      stdout: '',
      stderr: 'npm ERR! code E404\nnpm ERR! 404 Not Found - GET https://registry.npmjs.org/pkg - Not found',
      code: 1,
    }));
    await expect(resolveRegistryBumpVersion({ ...base, bump: 'patch', runner })).resolves.toBe('0.0.1');
    await expect(resolveRegistryBumpVersion({ ...base, bump: 'major', runner })).resolves.toBe('1.0.0');
  });

  it('treats an E404 carrying authentication output as an authentication failure', async () => {
    const runner = fakeCaptureRunner(() => ({
      stdout: '',
      stderr: 'npm ERR! code E404\nnpm ERR! 404 Not Found - authentication required, please check SSO login',
      code: 1,
    }));
    await expect(resolveRegistryBumpVersion({ ...base, bump: 'patch', runner })).rejects.toMatchObject({
      kind: 'authentication',
    });
  });

  it('classifies E401 and E403 as authentication failures', async () => {
    for (const stderr of [
      'npm ERR! code E401\nnpm ERR! 401 Unauthorized - GET https://registry.npmjs.org/pkg',
      'npm ERR! code E403\nnpm ERR! 403 Forbidden - GET https://registry.npmjs.org/pkg',
    ]) {
      const runner = fakeCaptureRunner(() => ({ stdout: '', stderr, code: 1 }));
      await expect(resolveRegistryBumpVersion({ ...base, bump: 'patch', runner })).rejects.toMatchObject({
        kind: 'authentication',
      });
    }
  });

  it('classifies timeouts', async () => {
    const timeout = new Error('process timed out after 10ms');
    (timeout as NodeJS.ErrnoException).code = 'ETIMEDOUT';

    const fromError = fakeCaptureRunner(() => ({ stdout: '', stderr: '', code: null, error: timeout }));
    await expect(resolveRegistryBumpVersion({ ...base, bump: 'patch', runner: fromError })).rejects.toMatchObject({
      kind: 'timeout',
    });

    const fromOutput = fakeCaptureRunner(() => ({ stdout: '', stderr: 'npm ERR! ETIMEDOUT', code: 1 }));
    await expect(resolveRegistryBumpVersion({ ...base, bump: 'patch', runner: fromOutput })).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('classifies network failures', async () => {
    const enoent = fakeCaptureRunner(() => ({
      stdout: '',
      stderr: 'npm ERR! network ENOTFOUND registry.local',
      code: 1,
    }));
    await expect(resolveRegistryBumpVersion({ ...base, bump: 'patch', runner: enoent })).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('classifies missing npm (spawn failure) as npm-unavailable', async () => {
    const spawnError = new Error('spawn npm ENOENT');
    (spawnError as NodeJS.ErrnoException).code = 'ENOENT';
    const runner = fakeCaptureRunner(() => ({ stdout: '', stderr: '', code: null, error: spawnError }));
    await expect(resolveRegistryBumpVersion({ ...base, bump: 'patch', runner })).rejects.toMatchObject({
      kind: 'npm-unavailable',
    });
  });

  it('classifies registry server failures', async () => {
    const runner = fakeCaptureRunner(() => ({
      stdout: '',
      stderr: 'npm ERR! code E500\nnpm ERR! 500 Internal Server Error',
      code: 1,
    }));
    await expect(resolveRegistryBumpVersion({ ...base, bump: 'patch', runner })).rejects.toMatchObject({
      kind: 'registry',
    });
  });

  it('classifies unknown failures without treating them as absence', async () => {
    const runner = fakeCaptureRunner(() => ({ stdout: '', stderr: 'npm ERR! code ESOMETHING\nnpm ERR! wat', code: 1 }));
    await expect(resolveRegistryBumpVersion({ ...base, bump: 'patch', runner })).rejects.toMatchObject({
      kind: 'unknown',
    });
  });

  it('rejects malformed JSON output', async () => {
    const runner = fakeCaptureRunner(() => ({ stdout: 'not json{', stderr: '', code: 0 }));
    await expect(resolveRegistryBumpVersion({ ...base, bump: 'patch', runner })).rejects.toMatchObject({
      kind: 'malformed-response',
    });
  });

  it('rejects empty success output instead of treating it as absence', async () => {
    const runner = fakeCaptureRunner(() => ({ stdout: '', stderr: '', code: 0 }));
    await expect(resolveRegistryBumpVersion({ ...base, bump: 'patch', runner })).rejects.toMatchObject({
      kind: 'malformed-response',
    });
  });

  it('rejects non-string JSON responses', async () => {
    for (const stdout of ['["1.2.3"]', '42', '{"version":"1.2.3"}', 'null']) {
      const runner = fakeCaptureRunner(() => ({ stdout, stderr: '', code: 0 }));
      await expect(resolveRegistryBumpVersion({ ...base, bump: 'patch', runner })).rejects.toMatchObject({
        kind: 'malformed-response',
      });
    }
  });

  it('rejects invalid registry version strings', async () => {
    const runner = fakeCaptureRunner(() => ({ stdout: '"not-a-semver"', stderr: '', code: 0 }));
    await expect(resolveRegistryBumpVersion({ ...base, bump: 'patch', runner })).rejects.toMatchObject({
      kind: 'invalid-version',
    });
  });

  it('requires a capturing runner', async () => {
    await expect(
      resolveRegistryBumpVersion({ ...base, bump: 'patch', runner: plainFakeRunner() }),
    ).rejects.toMatchObject({ kind: 'npm-unavailable' });
  });

  it('redacts registry credentials surfaced in error output', async () => {
    const registry = 'https://user:secret@registry.internal/';
    const runner = fakeCaptureRunner(() => ({
      stdout: '',
      stderr: `npm ERR! 401 Unauthorized - GET ${registry}pkg`,
      code: 1,
    }));
    try {
      await resolveRegistryBumpVersion({ ...base, bump: 'patch', registry, runner });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain('secret');
      expect(message).toContain('[redacted]');
    }
  });
});

describe('resolvePublishPackagePlanAsync', () => {
  it('resolves a registry bump against the base source package name', async () => {
    await withFixture(
      { name: 'base-pkg', version: '0.0.0-PLACEHOLDER', additionalNames: ['extra'] },
      async (rootDir) => {
        const runner = fakeCaptureRunner(() => ({ stdout: '"1.2.3"', stderr: '', code: 0 }));
        const plan = await resolvePublishPackagePlanAsync({ cwd: rootDir, bump: 'minor', runner });
        expect(plan.version).toBe('1.3.0');
        expect(runner.invocations[0].args).toContain('base-pkg');
        expect(runner.invocations[0].args).not.toContain('extra');
      },
    );
  });

  it('behaves like the sync resolver without a bump', async () => {
    await withFixture({ name: 'pkg', version: '2.3.4' }, async (rootDir) => {
      const plan = await resolvePublishPackagePlanAsync({ cwd: rootDir });
      expect(plan.version).toBe('2.3.4');
    });
  });

  it('rejects version and bump combined', async () => {
    await withFixture({ name: 'pkg', version: '2.3.4' }, async (rootDir) => {
      await expect(
        resolvePublishPackagePlanAsync({ cwd: rootDir, version: '1.2.3', bump: 'patch' }),
      ).rejects.toMatchObject({ kind: 'ambiguous-selection' });
    });
  });

  it('applies all plan safety validations to the registry-derived version path', async () => {
    await withFixture({ name: 'pkg', version: '1.0.0', private: true }, async (rootDir) => {
      const runner = fakeCaptureRunner(() => ({ stdout: '"1.2.3"', stderr: '', code: 0 }));
      await expect(resolvePublishPackagePlanAsync({ cwd: rootDir, bump: 'patch', runner })).rejects.toThrow(
        /Refusing to publish private package/,
      );
    });
  });

  it('requires a package.json name for registry resolution', async () => {
    await withFixture({ version: '1.0.0' }, async (rootDir) => {
      const runner = fakeCaptureRunner(() => ({ stdout: '"1.2.3"', stderr: '', code: 0 }));
      await expect(resolvePublishPackagePlanAsync({ cwd: rootDir, bump: 'patch', runner })).rejects.toThrow(
        /name missing/,
      );
      expect(runner.invocations).toHaveLength(0);
    });
  });
});

describe('redactSensitiveValues', () => {
  it('redacts configured secrets and URL credentials', () => {
    expect(redactSensitiveValues('error with token abc123', ['abc123'])).toBe('error with token [redacted]');
    expect(redactSensitiveValues('GET https://user:pw@host/pkg failed', [])).toBe(
      'GET https://[redacted]@host/pkg failed',
    );
    expect(redactSensitiveValues('nothing here', [''])).toBe('nothing here');
  });
});
