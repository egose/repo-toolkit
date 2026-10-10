import { describe, expect, it } from 'vitest';

import type {
  CapturingProcessRunner,
  ProcessCaptureOptions,
  ProcessCaptureResult,
} from '@repo-toolkit/publish-package';

import { determineNextTag, resolveReleaseTagPlan, type ReleaseTagPlan } from '../src/index';

const FAKE_CWD = '/fake/workdir';
const FAKE_TIMEOUT_MS = 1234;
const COMMIT_CANARY = 'commit-body-canary-7d2e9a-do-not-leak';

interface RecordedCapture {
  executable: string;
  args: ReadonlyArray<string>;
  options: ProcessCaptureOptions;
}

type CaptureHandler = (
  executable: string,
  args: ReadonlyArray<string>,
  options: ProcessCaptureOptions,
) => ProcessCaptureResult | Promise<ProcessCaptureResult>;

type FakeRunner = CapturingProcessRunner & { calls: RecordedCapture[] };

function createFakeRunner(handler: CaptureHandler): FakeRunner {
  const calls: RecordedCapture[] = [];
  return {
    calls,
    run() {
      throw new Error('unexpected run call: determineNextTag must use capture only');
    },
    runShell() {
      throw new Error('unexpected runShell call: determineNextTag must not invoke a shell');
    },
    async capture(executable, args, options) {
      calls.push({ executable, args: [...args], options });
      return handler(executable, args, options);
    },
  };
}

function ok(stdout: string, stderr = ''): ProcessCaptureResult {
  return { stdout, stderr, code: 0 };
}

function failed(code: number, stdout: string, stderr: string): ProcessCaptureResult {
  return { stdout, stderr, code };
}

function spawnError(message: string, stdout = ''): ProcessCaptureResult {
  const error = new Error(message) as Error & { code?: string };
  error.code = 'ENOENT';
  return { stdout, stderr: '', code: null, error };
}

function queueHandler(results: ReadonlyArray<ProcessCaptureResult>): CaptureHandler {
  let index = 0;
  return () => {
    const result = results[index];
    index += 1;
    if (!result) {
      throw new Error('unexpected capture call: script exhausted');
    }
    return result;
  };
}

function autoPlan(overrides: Record<string, unknown> = {}): ReleaseTagPlan {
  return resolveReleaseTagPlan({ cwd: FAKE_CWD, timeoutMs: FAKE_TIMEOUT_MS, ...overrides });
}

function manualPlan(tag: string): ReleaseTagPlan {
  return { ...autoPlan(), tag };
}

async function errorMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  expect.unreachable();
}

describe('determineNextTag manual tags', () => {
  it('accepts a bare X.Y.Z tag without invoking git', async () => {
    const runner = createFakeRunner(() => {
      throw new Error('manual tags must not invoke git');
    });
    const result = await determineNextTag({
      plan: resolveReleaseTagPlan({ cwd: FAKE_CWD, tag: '1.2.3' }),
      runner,
    });
    expect(result).toEqual({ version: '1.2.3', tagVersion: 'v1.2.3', bump: null, lastTag: null, manual: true });
    expect(runner.calls).toHaveLength(0);
  });

  it('strips a single leading v without invoking git', async () => {
    const runner = createFakeRunner(() => {
      throw new Error('manual tags must not invoke git');
    });
    const result = await determineNextTag({ plan: manualPlan('v1.2.3'), runner });
    expect(result).toEqual({ version: '1.2.3', tagVersion: 'v1.2.3', bump: null, lastTag: null, manual: true });
    expect(runner.calls).toHaveLength(0);
  });

  it('rejects malformed manual tags and names the value', async () => {
    for (const tag of ['1.2', '1.2.3.4', '1.2.3-beta', 'vv1.2.3', '']) {
      const runner = createFakeRunner(() => {
        throw new Error('invalid manual tags must not invoke git');
      });
      const message = await errorMessage(determineNextTag({ plan: manualPlan(tag), runner }));
      expect(message).toContain('Provided tag');
      expect(message).toMatch(/semantic versioning/);
      expect(message).toMatch(/X\.Y\.Z/);
      if (tag.length > 0) {
        expect(message).toContain(tag);
      }
      expect(runner.calls).toHaveLength(0);
    }
  });

  it('strips one leading v instead of every v character', async () => {
    const accepted: Array<{ tag: string; version: string }> = [
      { tag: '1.2.3', version: '1.2.3' },
      { tag: 'v1.2.3', version: '1.2.3' },
    ];
    for (const { tag, version } of accepted) {
      const runner = createFakeRunner(() => {
        throw new Error('manual tags must not invoke git');
      });
      const result = await determineNextTag({ plan: manualPlan(tag), runner });
      expect(result.version).toBe(version);
      expect(result.tagVersion).toBe(`v${version}`);
      expect(runner.calls).toHaveLength(0);
    }
    for (const tag of ['vv1.2.3', '1.2.3v', '1v.2.3', 'v1.2.3v']) {
      const runner = createFakeRunner(() => {
        throw new Error('invalid manual tags must not invoke git');
      });
      const message = await errorMessage(determineNextTag({ plan: manualPlan(tag), runner }));
      expect(message).toContain(`Provided tag '${tag}'`);
      expect(runner.calls).toHaveLength(0);
    }
  });
});

describe('determineNextTag automatic bumps', () => {
  it('bumps patch for fixes, chores, and empty history', async () => {
    const logs = ['fix: repair leak\n', 'docs: update readme\nchore: tidy\n', ''];
    for (const log of logs) {
      const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok(log)]));
      const result = await determineNextTag({ plan: autoPlan(), runner });
      expect(result).toEqual({
        version: '1.2.4',
        tagVersion: 'v1.2.4',
        bump: 'patch',
        lastTag: 'v1.2.3',
        manual: false,
      });
      expect(runner.calls).toHaveLength(2);
    }
  });

  it('bumps minor for feat with and without scope', async () => {
    const cases: Array<{ log: string; version: string }> = [
      { log: 'feat: add widget\n', version: '1.3.0' },
      { log: 'feat(api): add endpoint\n', version: '1.3.0' },
      { log: 'fix: repair leak\nfeat: add widget\n', version: '1.3.0' },
    ];
    for (const { log, version } of cases) {
      const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok(log)]));
      const result = await determineNextTag({ plan: autoPlan(), runner });
      expect(result.bump).toBe('minor');
      expect(result.version).toBe(version);
      expect(result.tagVersion).toBe(`v${version}`);
      expect(result.lastTag).toBe('v1.2.3');
      expect(result.manual).toBe(false);
    }
  });

  it('bumps major for breaking indicators', async () => {
    const logs = [
      'feat!: drop support\n',
      'feat(api)!: drop support\n',
      'fix(api)!: drop support\n',
      'fix: tune\n\nBREAKING CHANGE: drop api\n',
      'fix: handle a!:b edge\n',
    ];
    for (const log of logs) {
      const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok(log)]));
      const result = await determineNextTag({ plan: autoPlan(), runner });
      expect(result).toEqual({
        version: '2.0.0',
        tagVersion: 'v2.0.0',
        bump: 'major',
        lastTag: 'v1.2.3',
        manual: false,
      });
    }
  });

  it('prefers major over minor over patch', async () => {
    const runner = createFakeRunner(queueHandler([ok('v0.9.9\n'), ok('feat: add widget\nBREAKING CHANGE: drop\n')]));
    const result = await determineNextTag({ plan: autoPlan(), runner });
    expect(result.version).toBe('1.0.0');
    expect(result.bump).toBe('major');
  });

  it('invokes git with explicit args, cwd, and timeout', async () => {
    const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok('fix: repair\n')]));
    await determineNextTag({ plan: autoPlan(), runner });
    expect(runner.calls).toHaveLength(2);
    const [describeCall, logCall] = runner.calls;
    expect(describeCall).toMatchObject({ executable: 'git', args: ['describe', '--tags', '--abbrev=0'] });
    expect(describeCall?.options).toEqual({ cwd: FAKE_CWD, timeoutMs: FAKE_TIMEOUT_MS });
    expect(logCall).toMatchObject({ executable: 'git', args: ['log', 'v1.2.3..HEAD', '--pretty=format:%B'] });
    expect(logCall?.options).toEqual({ cwd: FAKE_CWD, timeoutMs: FAKE_TIMEOUT_MS });
  });

  it('trims the last tag to its first line', async () => {
    const runner = createFakeRunner(queueHandler([ok('  v2.0.0  \n'), ok('fix: repair\n')]));
    const result = await determineNextTag({ plan: autoPlan(), runner });
    expect(result.lastTag).toBe('v2.0.0');
    expect(result.version).toBe('2.0.1');
    const [, logCall] = runner.calls;
    expect(logCall?.args).toEqual(['log', 'v2.0.0..HEAD', '--pretty=format:%B']);
  });
});

describe('determineNextTag git failures', () => {
  it('reports seeding guidance when describe exits non-zero', async () => {
    const runner = createFakeRunner(
      queueHandler([failed(128, '', 'fatal: No names found, cannot describe anything.\n')]),
    );
    const message = await errorMessage(determineNextTag({ plan: autoPlan(), runner }));
    expect(message).toContain(
      'No previous tag found and no tag input provided. Provide --tag once to seed release history.',
    );
    expect(message).toContain('fatal: No names found');
    expect(runner.calls).toHaveLength(1);
  });

  it('reports seeding guidance on empty describe output', async () => {
    for (const stdout of ['', '  \n']) {
      const runner = createFakeRunner(queueHandler([ok(stdout)]));
      const message = await errorMessage(determineNextTag({ plan: autoPlan(), runner }));
      expect(message).toContain('No previous tag found and no tag input provided.');
      expect(runner.calls).toHaveLength(1);
    }
  });

  it('reports seeding guidance on describe spawn errors', async () => {
    const runner = createFakeRunner(queueHandler([spawnError('spawn git ENOENT')]));
    const message = await errorMessage(determineNextTag({ plan: autoPlan(), runner }));
    expect(message).toContain('No previous tag found and no tag input provided.');
    expect(message).toContain('spawn git ENOENT');
    expect(runner.calls).toHaveLength(1);
  });

  it('truncates long describe stderr tails', async () => {
    const stderr = `${'g'.repeat(5000)}TAIL`;
    const runner = createFakeRunner(queueHandler([failed(128, '', stderr)]));
    const message = await errorMessage(determineNextTag({ plan: autoPlan(), runner }));
    expect(message).toContain('No previous tag found and no tag input provided.');
    expect(message).toContain('...[truncated]');
    expect(message).toContain('TAIL');
    expect(message).not.toContain('g'.repeat(5000));
    expect(message.length).toBeLessThan(stderr.length);
  });

  it('rejects last tags outside vX.Y.Z without reading the log', async () => {
    for (const tag of ['release-2024', '1.2.3', 'v1.2', 'v1.2.3.4', 'v01.2.3', 'v1.2.3-beta']) {
      const runner = createFakeRunner(queueHandler([ok(`${tag}\n`)]));
      const message = await errorMessage(determineNextTag({ plan: autoPlan(), runner }));
      expect(message).toBe(`Last tag '${tag}' does not follow 'vX.Y.Z' format.`);
      expect(runner.calls).toHaveLength(1);
    }
  });

  it('fails fatal on git log errors without leaking commit bodies', async () => {
    const runner = createFakeRunner(
      queueHandler([ok('v1.2.3\n'), failed(128, COMMIT_CANARY, 'fatal: bad revision\n')]),
    );
    const message = await errorMessage(determineNextTag({ plan: autoPlan(), runner }));
    expect(message).toContain('git log v1.2.3..HEAD failed');
    expect(message).toContain('fatal: bad revision');
    expect(message).not.toContain(COMMIT_CANARY);
    expect(runner.calls).toHaveLength(2);
  });

  it('fails fatal on git log spawn errors', async () => {
    const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), spawnError('spawn git EACCES', COMMIT_CANARY)]));
    const message = await errorMessage(determineNextTag({ plan: autoPlan(), runner }));
    expect(message).toContain('git log v1.2.3..HEAD failed');
    expect(message).toContain('spawn git EACCES');
    expect(message).not.toContain(COMMIT_CANARY);
  });

  it('refuses git log output over maxOutputBytes', async () => {
    const plan = autoPlan({ maxOutputBytes: 64 });
    const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok(`fix: ${'f'.repeat(100)}\n`)]));
    const message = await errorMessage(determineNextTag({ plan, runner }));
    expect(message).toContain('git log v1.2.3..HEAD');
    expect(message).toContain('64-byte output limit');
    expect(message).not.toContain('f'.repeat(100));
  });

  it('counts combined stdout and stderr toward maxOutputBytes', async () => {
    const plan = autoPlan({ maxOutputBytes: 64 });
    const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok('a'.repeat(40), 'b'.repeat(40))]));
    await expect(determineNextTag({ plan, runner })).rejects.toThrow(/output limit/);
  });

  it('never returns commit bodies in the result', async () => {
    const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok(`feat: ${COMMIT_CANARY}\n`)]));
    const result = await determineNextTag({ plan: autoPlan(), runner });
    expect(result.bump).toBe('minor');
    expect(JSON.stringify(result)).not.toContain(COMMIT_CANARY);
  });
});

describe('determineNextTag runner selection', () => {
  it('requires a capturing runner', async () => {
    const badRunner = { run() {}, runShell() {} } as unknown as CapturingProcessRunner;
    await expect(determineNextTag({ plan: autoPlan(), runner: badRunner })).rejects.toThrow(/capture/);
    await expect(determineNextTag({ plan: manualPlan('1.2.3'), runner: badRunner })).rejects.toThrow(
      /CapturingProcessRunner/,
    );
  });

  it('prefers the explicit runner over the plan runner', async () => {
    const planRunner = createFakeRunner(queueHandler([ok('v9.9.9\n'), ok('fix: t\n')]));
    const explicitRunner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok('fix: t\n')]));
    const plan = resolveReleaseTagPlan({ cwd: FAKE_CWD, runner: planRunner });
    const result = await determineNextTag({ plan, runner: explicitRunner });
    expect(result.lastTag).toBe('v1.2.3');
    expect(explicitRunner.calls).toHaveLength(2);
    expect(planRunner.calls).toHaveLength(0);
  });

  it('uses the plan runner when no explicit runner is given', async () => {
    const planRunner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok('feat: t\n')]));
    const plan = resolveReleaseTagPlan({ cwd: FAKE_CWD, runner: planRunner });
    const result = await determineNextTag({ plan });
    expect(result.bump).toBe('minor');
    expect(planRunner.calls).toHaveLength(2);
  });

  it('rejects non-object inputs', async () => {
    await expect(determineNextTag(undefined as never)).rejects.toThrow(/input must be an object/);
    await expect(determineNextTag({ plan: null } as never)).rejects.toThrow(/plan must be an object/);
  });
});
