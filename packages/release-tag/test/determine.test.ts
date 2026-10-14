import { describe, expect, it } from 'vitest';

import type {
  CapturingProcessRunner,
  ProcessCaptureOptions,
  ProcessCaptureResult,
} from '@repo-toolkit/publish-package';

import { determineNextTag, resolveReleaseTagPlan, type ReleaseTagPlan } from '../src/index';
import { commitLog } from './commit-fixture';

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

function spawnError(code: string, stdout = ''): ProcessCaptureResult {
  const error = new Error('private transport detail') as Error & { code?: string };
  error.code = code;
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
    expect(result).toEqual({
      version: '1.2.3',
      tagVersion: 'v1.2.3',
      bump: null,
      lastTag: null,
      manual: true,
      noChanges: false,
    });
    expect(runner.calls).toHaveLength(0);
  });

  it('strips a single leading v without invoking git', async () => {
    const runner = createFakeRunner(() => {
      throw new Error('manual tags must not invoke git');
    });
    const result = await determineNextTag({ plan: manualPlan('v1.2.3'), runner });
    expect(result).toEqual({
      version: '1.2.3',
      tagVersion: 'v1.2.3',
      bump: null,
      lastTag: null,
      manual: true,
      noChanges: false,
    });
    expect(runner.calls).toHaveLength(0);
  });

  it('rejects malformed manual tags with a field-specific version error', async () => {
    for (const tag of ['1.2', '1.2.3.4', '1.2.3-beta', 'vv1.2.3', '']) {
      const runner = createFakeRunner(() => {
        throw new Error('invalid manual tags must not invoke git');
      });
      const message = await errorMessage(determineNextTag({ plan: manualPlan(tag), runner }));
      expect(message).toContain('tag');
      expect(message).toMatch(/stable/);
      expect(message).toMatch(/X\.Y\.Z/);
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
      expect(message).toMatch(/tag.*X\.Y\.Z/);
      expect(runner.calls).toHaveLength(0);
    }
  });
});

describe('determineNextTag automatic bumps', () => {
  it.each([
    ['fix: repair leak\n'],
    ['docs: update readme\n', 'chore: tidy\n'],
    [''],
    ['\n\n'],
    ['fix: handle a!:b edge\n'],
    ['Handle a!: b edge\n'],
    ['-!: punctuation, not a type\n'],
    ['fix(scope!:example): repair\n'],
    ['fix: explain BREAKING CHANGE: text\n'],
    ['BREAKING CHANGE: this is a subject, not a footer\n'],
    ['BREAKING-CHANGE: also only a subject\n'],
    ['docs: examples\n\nfeat: add widget\nfeat(api): add endpoint\n'],
    ['docs: examples\n\nrefactor!: replace interface\nSome incidental !: punctuation.\n'],
    ['fix: explain\n\nMention BREAKING CHANGE: text inline\n'],
    ['fix: explain\n\nMention BREAKING-CHANGE: text inline\n'],
    ['fix: explain\n\n BREAKING CHANGE: indented example\n'],
    ['fix: explain\n\n\tBREAKING-CHANGE: indented example\n'],
    ['fix: explain\n\nbreaking change: lowercase is not a breaking footer\n'],
    ['fix: explain\n\nBREAKING CHANGE:\n'],
    ['fix: explain\n\nBREAKING-CHANGE:missing separator space\n'],
    [' feat: indented header\n'],
    ['feat(): empty scope\n'],
    ['feat(api: unmatched scope\n'],
    ['feat:missing separator space\n'],
    ['feat:   \n'],
    ['refactor!:   \n'],
    ['feat:\nnot a first-line description\n'],
    ['\nfeat: not the first line\n'],
  ])('uses patch for non-feature/non-breaking commit records case %# (%j)', async (...messages) => {
    const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok(commitLog(...messages))]));
    const result = await determineNextTag({ plan: autoPlan(), runner });
    expect(result).toEqual({
      version: '1.2.4',
      tagVersion: 'v1.2.4',
      bump: 'patch',
      lastTag: 'v1.2.3',
      manual: false,
      noChanges: false,
    });
    expect(runner.calls).toHaveLength(2);
  });

  it.each([
    ['feat: add widget\n'],
    ['feat(api): add endpoint\n'],
    ['FEAT(日本語): add endpoint\r\n'],
    ['feat(scope!:example): add widget\n'],
    ['feat: support a!:b syntax and BREAKING CHANGE: examples\n'],
    ['fix: repair leak\n', 'feat: add widget\n'],
    ['feat: add widget\n', 'fix: repair leak\n'],
    ['', 'feat: add widget\n'],
  ])('uses minor only for a feature header in records %j', async (...messages) => {
    const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok(commitLog(...messages))]));
    expect(await determineNextTag({ plan: autoPlan(), runner })).toEqual({
      version: '1.3.0',
      tagVersion: 'v1.3.0',
      bump: 'minor',
      lastTag: 'v1.2.3',
      manual: false,
      noChanges: false,
    });
  });

  it.each([
    'feat!: drop support\n',
    'feat(api)!: drop support\n',
    'fix!: drop support\n',
    'fix(api)!: drop support\n',
    'refactor!: replace interface\n',
    'chore(deps)!: remove compatibility\n',
    'custom-type(api)!: replace interface\n',
    'custom_type!: replace interface\n',
    'PERF!: change defaults\n',
    'fix: tune\n\nBREAKING CHANGE: drop api\n',
    'fix: tune\n\nBREAKING-CHANGE: drop api\n',
    'ordinary subject\n\nBREAKING CHANGE: drop api\n',
    'feat: add widget\n\nMigration details\n\nBREAKING-CHANGE: drop api\n  with a multiline description\nRefs: #1\n',
    'fix: tune\r\n\r\nBREAKING CHANGE: drop api\r\n',
  ])('uses major for a conventional breaking header or anchored footer %j', async (message) => {
    const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok(commitLog(message))]));
    expect(await determineNextTag({ plan: autoPlan(), runner })).toEqual({
      version: '2.0.0',
      tagVersion: 'v2.0.0',
      bump: 'major',
      lastTag: 'v1.2.3',
      manual: false,
      noChanges: false,
    });
  });

  it.each([
    ['fix: repair\n', 'feat: add widget\n', 'refactor!: replace api\n'],
    ['refactor!: replace api\n', 'feat: add widget\n', 'fix: repair\n'],
    ['feat: add widget\n', 'fix: repair\n\nBREAKING-CHANGE: replace api\n', 'fix: repair\n'],
  ])('prefers major over minor over patch across records %j', async (...messages) => {
    const runner = createFakeRunner(queueHandler([ok('v0.9.9\n'), ok(commitLog(...messages))]));
    const result = await determineNextTag({ plan: autoPlan(), runner });
    expect(result.version).toBe('1.0.0');
    expect(result.bump).toBe('major');
  });

  it('invokes git with explicit args, cwd, and timeout', async () => {
    const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok(commitLog('fix: repair\n'))]));
    await determineNextTag({ plan: autoPlan(), runner });
    expect(runner.calls).toHaveLength(2);
    const [describeCall, logCall] = runner.calls;
    expect(describeCall).toMatchObject({ executable: 'git', args: ['describe', '--tags', '--abbrev=0'] });
    const options = {
      cwd: FAKE_CWD,
      timeoutMs: FAKE_TIMEOUT_MS,
      maxOutputBytes: 1048576,
      stdio: 'pipe',
      env: { GIT_TERMINAL_PROMPT: '0' },
    };
    expect(describeCall?.options).toEqual(options);
    expect(logCall).toMatchObject({ executable: 'git', args: ['log', 'v1.2.3..HEAD', '-z', '--format=%H%x00%B'] });
    expect(logCall?.options).toEqual(options);
  });

  it('accepts a single line ending after the last tag', async () => {
    const runner = createFakeRunner(queueHandler([ok('v2.0.0\r\n'), ok(commitLog('fix: repair\n'))]));
    const result = await determineNextTag({ plan: autoPlan(), runner });
    expect(result.lastTag).toBe('v2.0.0');
    expect(result.version).toBe('2.0.1');
    const [, logCall] = runner.calls;
    expect(logCall?.args).toEqual(['log', 'v2.0.0..HEAD', '-z', '--format=%H%x00%B']);
  });
});

describe('determineNextTag empty ranges and numeric bounds', () => {
  it.each([undefined, false])(
    'returns the current version for zero records with allowEmptyRelease=%s',
    async (allowEmptyRelease) => {
      const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok('')]));
      expect(await determineNextTag({ plan: autoPlan({ allowEmptyRelease }), runner })).toEqual({
        version: '1.2.3',
        tagVersion: 'v1.2.3',
        bump: null,
        lastTag: 'v1.2.3',
        manual: false,
        noChanges: true,
      });
      expect(runner.calls).toHaveLength(2);
    },
  );

  it('opts into a patch increment for an empty range', async () => {
    const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok('')]));
    expect(await determineNextTag({ plan: autoPlan({ allowEmptyRelease: true }), runner })).toEqual({
      version: '1.2.4',
      tagVersion: 'v1.2.4',
      bump: 'patch',
      lastTag: 'v1.2.3',
      manual: false,
      noChanges: false,
    });
  });

  it('still classifies nonempty history when allowEmptyRelease is enabled', async () => {
    const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok(commitLog('feat: add widget\n'))]));
    expect(await determineNextTag({ plan: autoPlan({ allowEmptyRelease: true }), runner })).toMatchObject({
      version: '1.3.0',
      bump: 'minor',
      noChanges: false,
    });
  });

  it.each([false, true])(
    'treats manual versions as explicit releases with allowEmptyRelease=%s',
    async (allowEmptyRelease) => {
      const runner = createFakeRunner(() => {
        throw new Error('manual requests must not read Git');
      });
      expect(await determineNextTag({ plan: autoPlan({ tag: 'v1.2.3', allowEmptyRelease }), runner })).toEqual({
        version: '1.2.3',
        tagVersion: 'v1.2.3',
        bump: null,
        lastTag: null,
        manual: true,
        noChanges: false,
      });
      expect(runner.calls).toHaveLength(0);
    },
  );

  it.each([
    ['1.2.9', 'fix: repair', '1.2.10'],
    ['1.9.9007199254740991', 'feat: add widget', '1.10.0'],
    ['9.9007199254740991.9007199254740991', 'refactor!: replace api', '10.0.0'],
    ['1.2.9007199254740990', 'fix: repair', '1.2.9007199254740991'],
    ['1.9007199254740990.9007199254740991', 'feat: add widget', '1.9007199254740991.0'],
    ['9007199254740990.9007199254740991.9007199254740991', 'refactor!: replace api', '9007199254740991.0.0'],
    [
      '9007199254740991.9007199254740991.9007199254740990',
      'fix: repair',
      '9007199254740991.9007199254740991.9007199254740991',
    ],
    ['9007199254740991.9007199254740990.9007199254740991', 'feat: add widget', '9007199254740991.9007199254740991.0'],
  ])('bumps %s exactly with decimal carry and lower-component resets', async (lastVersion, message, version) => {
    const runner = createFakeRunner(queueHandler([ok(`v${lastVersion}\n`), ok(commitLog(message))]));
    expect(await determineNextTag({ plan: autoPlan(), runner })).toMatchObject({
      version,
      tagVersion: `v${version}`,
      noChanges: false,
    });
  });

  it.each([
    ['1.2.9007199254740991', 'fix: repair'],
    ['1.9007199254740991.0', 'feat: add widget'],
    ['9007199254740991.0.0', 'refactor!: replace api'],
  ])('refuses overflow when bumping %s in direct determination', async (lastVersion, message) => {
    const runner = createFakeRunner(queueHandler([ok(`v${lastVersion}\n`), ok(commitLog(message))]));
    await expect(determineNextTag({ plan: autoPlan(), runner })).rejects.toThrow(/determined.version.*safe integers/);
    expect(runner.calls).toHaveLength(2);
  });

  it('allows no-change at the maximum safe version but refuses an opted-in empty increment', async () => {
    const version = '9007199254740991.9007199254740991.9007199254740991';
    const noChangeRunner = createFakeRunner(queueHandler([ok(`v${version}\n`), ok('')]));
    expect(await determineNextTag({ plan: autoPlan(), runner: noChangeRunner })).toEqual({
      version,
      tagVersion: `v${version}`,
      bump: null,
      lastTag: `v${version}`,
      manual: false,
      noChanges: true,
    });
    const optedInRunner = createFakeRunner(queueHandler([ok(`v${version}\n`), ok('')]));
    await expect(
      determineNextTag({ plan: autoPlan({ allowEmptyRelease: true }), runner: optedInRunner }),
    ).rejects.toThrow(/safe integers/);
  });

  it('rejects a last-tag component that would round during number conversion before reading the log', async () => {
    const runner = createFakeRunner(queueHandler([ok('v9007199254740993.0.0\n')]));
    await expect(determineNextTag({ plan: autoPlan(), runner })).rejects.toThrow(/Last tag.*safe integers/);
    expect(runner.calls).toHaveLength(1);
  });
});

describe('determineNextTag commit record framing', () => {
  it.each([
    ' ',
    '\n',
    '\0',
    `fix: ${COMMIT_CANARY}\n`,
    `${'a'.repeat(40)}\0`,
    `${'a'.repeat(40)}\0feat: truncated record`,
    `${'0'.repeat(40)}\0feat: zero ID\0`,
    `not-an-id\0feat: ${COMMIT_CANARY}\0`,
    `${commitLog('feat!: first commit')}malformed\0second commit\0`,
  ])('rejects malformed records case %# without exposing messages or calling it no-change', async (stdout) => {
    const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok(stdout)]));
    const message = await errorMessage(determineNextTag({ plan: autoPlan(), runner }));
    expect(message).toMatch(/git log.*(?:records|commit ID)/);
    expect(message).not.toContain(COMMIT_CANARY);
    expect(runner.calls).toHaveLength(2);
  });

  it('accepts full SHA-256 IDs as record markers', async () => {
    const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok(`${'a'.repeat(64)}\0\0`)]));
    expect(await determineNextTag({ plan: autoPlan(), runner })).toMatchObject({ bump: 'patch', noChanges: false });
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
    const runner = createFakeRunner(queueHandler([spawnError('ENOENT')]));
    const message = await errorMessage(determineNextTag({ plan: autoPlan(), runner }));
    expect(message).toContain('No previous tag found and no tag input provided.');
    expect(message).toContain('process transport failed (ENOENT)');
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
      expect(message).toMatch(/Last tag.*(?:vX\.Y\.Z|stable X\.Y\.Z)/);
      expect(runner.calls).toHaveLength(1);
    }
  });

  it('rejects whitespace and extra lines in last-tag output without reading the log', async () => {
    for (const stdout of ['  v1.2.3\n', 'v1.2.3 \n', 'v1.2.3\nother\n', 'v1.2.3\n\n']) {
      const runner = createFakeRunner(queueHandler([ok(stdout)]));
      await expect(determineNextTag({ plan: autoPlan(), runner })).rejects.toThrow(/Last tag/);
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
    const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), spawnError('EACCES', COMMIT_CANARY)]));
    const message = await errorMessage(determineNextTag({ plan: autoPlan(), runner }));
    expect(message).toContain('git log v1.2.3..HEAD failed');
    expect(message).toContain('process transport failed (EACCES)');
    expect(message).not.toContain(COMMIT_CANARY);
  });

  it('refuses git log output over maxOutputBytes', async () => {
    const plan = autoPlan({ maxOutputBytes: 64 });
    const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok(commitLog(`fix: ${'f'.repeat(100)}\n`))]));
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
    const runner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok(commitLog(`feat: ${COMMIT_CANARY}\n`))]));
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
    const planRunner = createFakeRunner(queueHandler([ok('v9.9.9\n'), ok(commitLog('fix: t\n'))]));
    const explicitRunner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok(commitLog('fix: t\n'))]));
    const plan = resolveReleaseTagPlan({ cwd: FAKE_CWD, runner: planRunner });
    const result = await determineNextTag({ plan, runner: explicitRunner });
    expect(result.lastTag).toBe('v1.2.3');
    expect(explicitRunner.calls).toHaveLength(2);
    expect(planRunner.calls).toHaveLength(0);
  });

  it('uses the plan runner when no explicit runner is given', async () => {
    const planRunner = createFakeRunner(queueHandler([ok('v1.2.3\n'), ok(commitLog('feat: t\n'))]));
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
