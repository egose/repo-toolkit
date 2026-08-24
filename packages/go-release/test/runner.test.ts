import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  defaultGoReleaseRunner,
  resolveGoReleasePlan,
  type GoReleaseOptions,
  type GoReleaseRunner,
} from '../src/index';

function withFixture(run: (cwd: string) => void): void {
  const cwd = mkdtempSync(join(tmpdir(), 'go-release-runner-'));
  try {
    run(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function nodeArgs(source: string, ...args: ReadonlyArray<string>): ReadonlyArray<string> {
  return ['--eval', source, ...args];
}

function planOptions(cwd: string, runner?: GoReleaseRunner): GoReleaseOptions {
  return {
    cwd,
    toolName: 'fixture',
    version: '1.2.3',
    binaries: [{ name: 'fixture', package: 'cmd/fixture' }],
    targets: [{ os: 'linux', arch: 'amd64' }],
    ...(runner ? { runner } : {}),
  };
}

describe('defaultGoReleaseRunner', () => {
  it('runs successful processes with the requested cwd', () => {
    withFixture((cwd) => {
      defaultGoReleaseRunner.run(
        process.execPath,
        nodeArgs("require('node:fs').writeFileSync('result.txt', process.cwd())"),
        { cwd, stdio: 'ignore' },
      );

      expect(readFileSync(join(cwd, 'result.txt'), 'utf8')).toBe(cwd);
    });
  });

  it('captures output while preserving space-containing arguments exactly', () => {
    withFixture((cwd) => {
      const values = ['path with spaces/file', '-X main.version=release value'];
      const output = defaultGoReleaseRunner.capture(
        process.execPath,
        nodeArgs('process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...values),
        { cwd },
      );

      expect(JSON.parse(output)).toEqual(values);
    });
  });

  it('merges environment overrides without mutating the parent environment', () => {
    withFixture((cwd) => {
      const inheritedName = 'GO_RELEASE_RUNNER_INHERITED';
      const overriddenName = 'GO_RELEASE_RUNNER_OVERRIDDEN';
      const previousInherited = process.env[inheritedName];
      const previousOverridden = process.env[overriddenName];
      process.env[inheritedName] = 'parent';
      process.env[overriddenName] = 'unchanged';
      try {
        const output = defaultGoReleaseRunner.capture(
          process.execPath,
          nodeArgs(`process.stdout.write(process.env.${inheritedName} + ':' + process.env.${overriddenName})`),
          { cwd, env: { [overriddenName]: 'child' } },
        );
        expect(output).toBe('parent:child');
        expect(process.env[overriddenName]).toBe('unchanged');
      } finally {
        if (previousInherited === undefined) delete process.env[inheritedName];
        else process.env[inheritedName] = previousInherited;
        if (previousOverridden === undefined) delete process.env[overriddenName];
        else process.env[overriddenName] = previousOverridden;
      }
    });
  });

  it('reports nonzero exits without including child output', () => {
    withFixture((cwd) => {
      expect(() =>
        defaultGoReleaseRunner.capture(
          process.execPath,
          nodeArgs("process.stderr.write('sensitive-value'); process.exit(7)"),
          { cwd },
        ),
      ).toThrowError(`Executable ${JSON.stringify(process.execPath)} exited with status 7`);
    });
  });

  it('terminates timed-out children', () => {
    withFixture((cwd) => {
      const pidPath = join(cwd, 'pid.txt');
      expect(() =>
        defaultGoReleaseRunner.capture(
          process.execPath,
          nodeArgs(
            "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
            pidPath,
          ),
          { cwd, timeoutMs: 250 },
        ),
      ).toThrowError(/timed out after 250ms/u);

      const pid = Number(readFileSync(pidPath, 'utf8'));
      expect(() => process.kill(pid, 0)).toThrow();
    });
  });

  it('terminates processes that exceed the capture limit', () => {
    withFixture((cwd) => {
      expect(() =>
        defaultGoReleaseRunner.capture(
          process.execPath,
          nodeArgs("process.stdout.write('x'.repeat(4096)); setInterval(() => {}, 1000)"),
          { cwd, timeoutMs: 2_000, maxOutputBytes: 128, killSignal: 'SIGKILL' },
        ),
      ).toThrowError(/exceeded the 128-byte output limit/u);
    });
  });

  it('bounds piped output for non-capturing runs', () => {
    withFixture((cwd) => {
      expect(() =>
        defaultGoReleaseRunner.run(process.execPath, nodeArgs("process.stderr.write('x'.repeat(4096))"), {
          cwd,
          stdio: 'pipe',
          maxOutputBytes: 128,
        }),
      ).toThrowError(/exceeded the 128-byte output limit/u);
    });
  });
});

describe('runner injection', () => {
  it('carries a custom runner through the plan without validating its serializable state', () => {
    withFixture((cwd) => {
      const runner: GoReleaseRunner & { state: { arbitrary: unknown } } = {
        state: { arbitrary: () => 'not serializable' },
        run() {},
        capture() {
          return '';
        },
      };

      expect(resolveGoReleasePlan(planOptions(cwd, runner)).runner).toBe(runner);
    });
  });

  it('rejects runner values that do not implement both methods', () => {
    withFixture((cwd) => {
      const options = { ...planOptions(cwd), runner: { run() {} } };
      expect(() => resolveGoReleasePlan(options)).toThrowError('runner must implement run() and capture()');
    });
  });
});
