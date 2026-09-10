import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { defaultDockerRunner, runWithConcurrency, validateDockerRunner } from '../src/runner';

const packageRoot = resolve(import.meta.dirname, '..');

function withFixture(run: (cwd: string) => void): void {
  const cwd = mkdtempSync(join(tmpdir(), 'docker-publish-runner-'));
  try {
    run(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function captureMessage(run: () => void): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected the invocation to throw');
}

describe('defaultDockerRunner run', () => {
  it('runs successful processes in the requested cwd and reports duration', () => {
    withFixture((cwd) => {
      const result = defaultDockerRunner.run(
        process.execPath,
        ['--eval', "require('node:fs').writeFileSync('result.txt', process.cwd())"],
        { cwd, stdio: 'ignore' },
      );
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(readFileSync(join(cwd, 'result.txt'), 'utf8')).toBe(realpathSync(cwd));
    });
  });

  it('preserves space-containing arguments exactly on the run path', () => {
    withFixture((cwd) => {
      const values = ['context with spaces/dir', '--build-arg', 'KEY=value with spaces'];
      defaultDockerRunner.run(
        process.execPath,
        ['--eval', "require('node:fs').writeFileSync('argv.json', JSON.stringify(process.argv.slice(1)))", ...values],
        { cwd, stdio: 'ignore' },
      );
      expect(JSON.parse(readFileSync(join(cwd, 'argv.json'), 'utf8'))).toEqual(values);
    });
  });

  it('feeds stdin without exposing it as an argv value', () => {
    withFixture((cwd) => {
      defaultDockerRunner.run(
        process.execPath,
        [
          '--eval',
          "let d='';process.stdin.on('data',c=>{d+=c;});process.stdin.on('end',()=>{require('node:fs').writeFileSync('stdin.txt',d);});",
        ],
        { cwd, stdin: 'registry-password-value', stdio: 'ignore' },
      );
      expect(readFileSync(join(cwd, 'stdin.txt'), 'utf8')).toBe('registry-password-value');
    });
  });

  it('reports nonzero exits with the executable and duration', () => {
    withFixture((cwd) => {
      const message = captureMessage(() =>
        defaultDockerRunner.run(process.execPath, ['--eval', 'process.exit(2)'], { cwd, stdio: 'ignore' }),
      );
      expect(message).toContain(`Executable ${JSON.stringify(process.execPath)} exited with status 2`);
      expect(message).toContain('duration');
    });
  });
});

describe('defaultDockerRunner capture', () => {
  it('captures stdout and stderr with duration and output size', () => {
    withFixture((cwd) => {
      const result = defaultDockerRunner.capture(
        process.execPath,
        ['--eval', "process.stdout.write('hello-out');process.stderr.write('hello-err');"],
        { cwd },
      );
      expect(result.stdout).toBe('hello-out');
      expect(result.stderr).toBe('hello-err');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.outputBytes).toBe(Buffer.byteLength('hello-out', 'utf8') + Buffer.byteLength('hello-err', 'utf8'));
    });
  });

  it('reports the child cwd from the requested directory', () => {
    withFixture((cwd) => {
      const result = defaultDockerRunner.capture(process.execPath, ['--eval', 'process.stdout.write(process.cwd())'], {
        cwd,
      });
      expect(result.stdout).toBe(realpathSync(cwd));
    });
  });

  it('preserves spaces and build-arg special characters exactly', () => {
    withFixture((cwd) => {
      const values = [
        'context with spaces/dir',
        '--build-arg',
        'KEY=value with spaces',
        'SPECIAL=$HOME `echo hi` "quoted" \'single\' \\ backslash',
        'EQ=a=b=c',
        'SEMICOLON=one;two',
        'DOLLAR=$(touch /tmp/docker-publish-probe)',
      ];
      const result = defaultDockerRunner.capture(
        process.execPath,
        ['--eval', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...values],
        { cwd },
      );
      expect(JSON.parse(result.stdout)).toEqual(values);
      expect(result.outputBytes).toBeGreaterThan(0);
    });
  });

  it('merges environment overrides without mutating the parent environment', () => {
    withFixture((cwd) => {
      const inheritedName = 'DOCKER_PUBLISH_RUNNER_INHERITED';
      const overriddenName = 'DOCKER_PUBLISH_RUNNER_OVERRIDDEN';
      const previousInherited = process.env[inheritedName];
      const previousOverridden = process.env[overriddenName];
      process.env[inheritedName] = 'parent';
      process.env[overriddenName] = 'unchanged';
      try {
        const result = defaultDockerRunner.capture(
          process.execPath,
          ['--eval', `process.stdout.write(process.env.${inheritedName}+':'+process.env.${overriddenName})`],
          { cwd, env: { [overriddenName]: 'child' } },
        );
        expect(result.stdout).toBe('parent:child');
        expect(process.env[overriddenName]).toBe('unchanged');
        expect(process.env[inheritedName]).toBe('parent');
      } finally {
        if (previousInherited === undefined) delete process.env[inheritedName];
        else process.env[inheritedName] = previousInherited;
        if (previousOverridden === undefined) delete process.env[overriddenName];
        else process.env[overriddenName] = previousOverridden;
      }
    });
  });

  it('feeds stdin to captured processes', () => {
    withFixture((cwd) => {
      const result = defaultDockerRunner.capture(
        process.execPath,
        [
          '--eval',
          "let d='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{d+=c;});process.stdin.on('end',()=>{process.stdout.write('got:'+d);});",
        ],
        { cwd, stdin: 'login-token-value' },
      );
      expect(result.stdout).toBe('got:login-token-value');
    });
  });

  it('reports nonzero exits with the executable, duration, and output tail', () => {
    withFixture((cwd) => {
      const message = captureMessage(() =>
        defaultDockerRunner.capture(
          process.execPath,
          ['--eval', "process.stderr.write('build failed detail');process.exit(7);"],
          { cwd },
        ),
      );
      expect(message).toContain(`Executable ${JSON.stringify(process.execPath)} exited with status 7`);
      expect(message).toContain('duration');
      expect(message).toContain('build failed detail');
    });
  });

  it('terminates timed-out children and leaves no surviving process', () => {
    withFixture((cwd) => {
      const pidFile = join(cwd, 'pid.txt');
      const message = captureMessage(() =>
        defaultDockerRunner.capture(
          process.execPath,
          [
            '--eval',
            "require('node:fs').writeFileSync(process.argv[1], String(process.pid));setInterval(()=>{},50);",
            pidFile,
          ],
          { cwd, timeoutMs: 300, killSignal: 'SIGKILL' },
        ),
      );
      expect(message).toContain('timed out after 300ms');
      expect(message).toContain(JSON.stringify(process.execPath));
      expect(message).toContain('duration');
      const pid = Number(readFileSync(pidFile, 'utf8'));
      expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
      expect(() => process.kill(pid, 0)).toThrow();
    });
  });

  it('terminates output-overflow children and leaves no surviving process', () => {
    withFixture((cwd) => {
      const pidFile = join(cwd, 'pid.txt');
      const message = captureMessage(() =>
        defaultDockerRunner.capture(
          process.execPath,
          [
            '--eval',
            "require('node:fs').writeFileSync(process.argv[1], String(process.pid));process.stdout.write('x'.repeat(16384));setInterval(()=>{},50);",
            pidFile,
          ],
          { cwd, timeoutMs: 5000, maxOutputBytes: 256, killSignal: 'SIGKILL' },
        ),
      );
      expect(message).toMatch(/exceeded the 256-byte output limit/);
      expect(message).toContain('duration');
      const pid = Number(readFileSync(pidFile, 'utf8'));
      expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
      expect(() => process.kill(pid, 0)).toThrow();
    });
  });

  it('truncates failure tails instead of retaining unbounded output', () => {
    withFixture((cwd) => {
      const message = captureMessage(() =>
        defaultDockerRunner.capture(
          process.execPath,
          ['--eval', "process.stderr.write('y'.repeat(20000));process.exit(1);"],
          { cwd, maxOutputBytes: 1_048_576 },
        ),
      );
      expect(message).toContain('exited with status 1');
      expect(message).toContain('[truncated]');
      expect(message.length).toBeLessThan(20000);
    });
  });

  it('redacts environment secret values from errors', () => {
    withFixture((cwd) => {
      const secret = `runner-secret-${process.pid}-value`;
      const message = captureMessage(() =>
        defaultDockerRunner.capture(
          process.execPath,
          ['--eval', "process.stderr.write(process.env.DOCKER_PUBLISH_PROBE_PASSWORD || '');process.exit(3);"],
          { cwd, env: { DOCKER_PUBLISH_PROBE_PASSWORD: secret }, secrets: [secret] },
        ),
      );
      expect(message).not.toContain(secret);
      expect(message).toContain('[redacted]');
    });
  });

  it('redacts stdin secret values from errors without an explicit secrets list', () => {
    withFixture((cwd) => {
      const secret = `stdin-secret-${process.pid}-value`;
      const message = captureMessage(() =>
        defaultDockerRunner.capture(
          process.execPath,
          [
            '--eval',
            "let d='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{d+=c;});process.stdin.on('end',()=>{process.stderr.write(d);process.exit(5);});",
          ],
          { cwd, stdin: secret },
        ),
      );
      expect(message).not.toContain(secret);
      expect(message).toContain('[redacted]');
    });
  });

  it('redacts credentialed URLs from errors', () => {
    withFixture((cwd) => {
      const message = captureMessage(() =>
        defaultDockerRunner.capture(
          process.execPath,
          ['--eval', "process.stderr.write('https://user:hunter2pass@example.com/v2/');process.exit(1);"],
          { cwd },
        ),
      );
      expect(message).not.toContain('hunter2pass');
      expect(message).toContain('[redacted]@');
    });
  });

  it('rejects invalid invocation options before spawning', () => {
    withFixture((cwd) => {
      expect(() => defaultDockerRunner.capture('', ['--version'], { cwd })).toThrow(
        'executable must be a non-empty string',
      );
      expect(() => defaultDockerRunner.capture(process.execPath, ['ok'], { cwd, timeoutMs: 0 })).toThrow(
        'timeoutMs must be a positive safe integer',
      );
      expect(() => defaultDockerRunner.capture(process.execPath, ['ok'], { cwd, maxOutputBytes: -1 })).toThrow(
        'maxOutputBytes must be a positive safe integer',
      );
      expect(() =>
        defaultDockerRunner.capture(process.execPath, ['ok'], {
          cwd,
          env: { TOKEN: 42 } as unknown as Record<string, string>,
        }),
      ).toThrow('options.env');
    });
  });
});

describe('validateDockerRunner', () => {
  it('accepts the default runner and rejects incomplete implementations', () => {
    expect(() => validateDockerRunner(defaultDockerRunner)).not.toThrow();
    expect(() => validateDockerRunner(null)).toThrow('runner must be a DockerRunner object');
    expect(() => validateDockerRunner({ run() {} })).toThrow('runner must implement run() and capture()');
  });
});

describe('runWithConcurrency', () => {
  function tick(): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  it('rejects non-positive-integer limits', async () => {
    await expect(runWithConcurrency([1], 0, async (item) => item)).rejects.toThrow(
      'concurrency must be a positive safe integer',
    );
    await expect(runWithConcurrency([1], -1, async (item) => item)).rejects.toThrow(
      'concurrency must be a positive safe integer',
    );
    await expect(runWithConcurrency([1], 1.5, async (item) => item)).rejects.toThrow(
      'concurrency must be a positive safe integer',
    );
    await expect(runWithConcurrency([1], Number.NaN, async (item) => item)).rejects.toThrow(
      'concurrency must be a positive safe integer',
    );
  });

  it('returns an empty array without calling fn', async () => {
    let calls = 0;
    const result = await runWithConcurrency([], 2, async () => {
      calls += 1;
      return 1;
    });
    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });

  it('honours the concurrency bound', async () => {
    const started: number[] = [];
    const resolvers: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    const settlement = runWithConcurrency([0, 1, 2, 3], 2, async (item) => {
      started.push(item);
      active += 1;
      if (active > peak) {
        peak = active;
      }
      await new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
      active -= 1;
      return item * 10;
    });
    for (let attempt = 0; attempt < 100 && started.length < 2; attempt += 1) {
      await tick();
    }
    expect(started.length).toBe(2);
    expect(peak).toBeLessThanOrEqual(2);
    while (resolvers.length > 0 || started.length < 4) {
      (resolvers.shift() as (() => void) | undefined)?.();
      await tick();
      await tick();
      expect(peak).toBeLessThanOrEqual(2);
    }
    const result = await settlement;
    expect(result).toEqual([0, 10, 20, 30]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('preserves input order despite out-of-order completion', async () => {
    const delays = [30, 10, 0];
    const result = await runWithConcurrency([0, 1, 2], 3, async (item) => {
      await delay(delays[item]);
      return `item-${item}`;
    });
    expect(result).toEqual(['item-0', 'item-1', 'item-2']);
  });

  it('starts no new work after the first failure and rethrows it', async () => {
    const started: number[] = [];
    const failure = new Error('first failure marker');
    const outcome = runWithConcurrency([0, 1, 2, 3], 1, async (item) => {
      started.push(item);
      if (item === 0) {
        throw failure;
      }
      return item;
    });
    await expect(outcome).rejects.toBe(failure);
    expect(started).toEqual([0]);
  });

  it('rethrows the first observed error when several fail', async () => {
    const fast = new Error('fast failure marker');
    const slow = new Error('slow failure marker');
    const outcome = runWithConcurrency([0, 1], 2, async (item) => {
      if (item === 0) {
        await delay(30);
        throw slow;
      }
      await delay(0);
      throw fast;
    });
    await expect(outcome).rejects.toBe(fast);
  });
});

describe('structured execution boundary', () => {
  it('uses argv arrays with no command-interpreter execution path', () => {
    const source = readFileSync(join(packageRoot, 'src', 'runner.ts'), 'utf8');
    expect(source).toContain('spawnSync');
    expect(source).not.toContain('bash');
    expect(source).not.toContain('sh -c');
    expect(source).not.toContain('shell');
    expect(source).not.toContain('execFile');
    expect(source).not.toContain('execSync');
    expect(source).not.toContain('runShell');
    expect(source).not.toContain('process.exit');
  });

  it('treats metacharacters as data rather than executable syntax', () => {
    withFixture((cwd) => {
      const probe = join(cwd, 'probe.txt');
      const values = ['a;touch', probe, `$(touch ${probe})`, '`touch ' + probe + '`'];
      const result = defaultDockerRunner.capture(
        process.execPath,
        ['--eval', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...values],
        { cwd },
      );
      expect(JSON.parse(result.stdout)).toEqual(values);
      expect(() => readFileSync(probe, 'utf8')).toThrow();
    });
  });

  it('leaves the probe fixture directory to test-scoped cleanup only', () => {
    withFixture((cwd) => {
      writeFileSync(join(cwd, 'marker.txt'), 'marker');
      expect(readFileSync(join(cwd, 'marker.txt'), 'utf8')).toBe('marker');
    });
  });
});
