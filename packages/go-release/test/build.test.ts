import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildGoRelease, type GoReleaseOptions, type GoReleaseRunner, type GoReleaseRunOptions } from '../src/index';

interface RunnerCall {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly options: GoReleaseRunOptions;
}

function withFixture(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'go-release-build-'));
  return run(cwd).finally(() => rmSync(cwd, { recursive: true, force: true }));
}

function baseOptions(cwd: string, runner: GoReleaseRunner): GoReleaseOptions {
  return {
    cwd,
    toolName: 'fixture',
    version: '1.2.3',
    binaries: [{ name: 'fixture', package: 'cmd/fixture' }],
    targets: [{ os: 'linux', arch: 'amd64' }],
    runner,
  };
}

function outputPath(args: ReadonlyArray<string>): string {
  const index = args.indexOf('-o');
  if (index < 0 || args[index + 1] === undefined) throw new Error('missing fake compiler output');
  return args[index + 1];
}

function runnerWith(onRun: (call: RunnerCall) => void | Promise<void>): GoReleaseRunner {
  return {
    run(executable, args, options) {
      return onRun({ executable, args, options });
    },
    capture() {
      return '';
    },
  };
}

function temporaryBuildEntries(cwd: string): ReadonlyArray<string> {
  return readdirSync(cwd).filter((name) => name.startsWith('.dist-build-'));
}

describe('buildGoRelease', () => {
  it('passes the exact default command for a single-binary plan', async () => {
    await withFixture(async (cwd) => {
      const calls: RunnerCall[] = [];
      const runner = runnerWith((call) => {
        calls.push(call);
        writeFileSync(outputPath(call.args), 'single binary');
      });

      await buildGoRelease(baseOptions(cwd, runner));

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        executable: 'go',
        args: [
          'build',
          '-trimpath',
          '-buildvcs=false',
          '-ldflags',
          '-buildid=',
          '-o',
          outputPath(calls[0].args),
          'cmd/fixture',
        ],
        options: {
          cwd,
          env: { CGO_ENABLED: '0', GOOS: 'linux', GOARCH: 'amd64' },
          stdio: 'pipe',
          timeoutMs: 120_000,
          maxOutputBytes: 1_048_576,
        },
      });
    });
  });

  it('passes exact structured commands for every target and binary and returns validated outputs', async () => {
    await withFixture(async (cwd) => {
      mkdirSync(join(cwd, 'dist'));
      writeFileSync(join(cwd, 'dist', 'stale'), 'stale output');
      const calls: RunnerCall[] = [];
      const runner = runnerWith((call) => {
        calls.push(call);
        writeFileSync(outputPath(call.args), `binary:${call.options.env?.GOOS}:${call.args[call.args.length - 1]}`);
      });

      const result = await buildGoRelease({
        cwd,
        toolName: 'tools',
        version: '2.0.0',
        goExecutable: '/tool path/go',
        binaries: [
          {
            name: 'alpha',
            package: 'cmd/alpha',
            linkerValues: [{ symbol: 'main.version', value: '{version} {os}-{arch}' }],
          },
          { name: 'beta', package: 'cmd/beta' },
        ],
        targets: [
          { os: 'linux', arch: 'amd64' },
          { os: 'windows', arch: 'arm64' },
        ],
        buildFlags: ['-trimpath', '-buildvcs=false', '-tags=release value'],
        linkerFlags: ['-buildid=', '-s'],
        processLimits: { concurrency: 1, timeoutMs: 4321, maxOutputBytes: 9876 },
        runner,
      });

      const firstOutput = outputPath(calls[0].args);
      const stagingDir = dirname(dirname(firstOutput));
      expect(calls).toEqual([
        {
          executable: '/tool path/go',
          args: [
            'build',
            '-trimpath',
            '-buildvcs=false',
            '-tags=release value',
            '-ldflags',
            '-buildid= -s -X "main.version=2.0.0 linux-amd64"',
            '-o',
            join(stagingDir, 'linux-amd64', 'alpha'),
            'cmd/alpha',
          ],
          options: {
            cwd,
            env: { CGO_ENABLED: '0', GOOS: 'linux', GOARCH: 'amd64' },
            stdio: 'pipe',
            timeoutMs: 4321,
            maxOutputBytes: 9876,
          },
        },
        {
          executable: '/tool path/go',
          args: [
            'build',
            '-trimpath',
            '-buildvcs=false',
            '-tags=release value',
            '-ldflags',
            '-buildid= -s',
            '-o',
            join(stagingDir, 'linux-amd64', 'beta'),
            'cmd/beta',
          ],
          options: {
            cwd,
            env: { CGO_ENABLED: '0', GOOS: 'linux', GOARCH: 'amd64' },
            stdio: 'pipe',
            timeoutMs: 4321,
            maxOutputBytes: 9876,
          },
        },
        {
          executable: '/tool path/go',
          args: [
            'build',
            '-trimpath',
            '-buildvcs=false',
            '-tags=release value',
            '-ldflags',
            '-buildid= -s -X "main.version=2.0.0 windows-arm64"',
            '-o',
            join(stagingDir, 'windows-arm64', 'alpha.exe'),
            'cmd/alpha',
          ],
          options: {
            cwd,
            env: { CGO_ENABLED: '0', GOOS: 'windows', GOARCH: 'arm64' },
            stdio: 'pipe',
            timeoutMs: 4321,
            maxOutputBytes: 9876,
          },
        },
        {
          executable: '/tool path/go',
          args: [
            'build',
            '-trimpath',
            '-buildvcs=false',
            '-tags=release value',
            '-ldflags',
            '-buildid= -s',
            '-o',
            join(stagingDir, 'windows-arm64', 'beta.exe'),
            'cmd/beta',
          ],
          options: {
            cwd,
            env: { CGO_ENABLED: '0', GOOS: 'windows', GOARCH: 'arm64' },
            stdio: 'pipe',
            timeoutMs: 4321,
            maxOutputBytes: 9876,
          },
        },
      ]);
      expect(result.outputDir).toBe(join(cwd, 'dist'));
      expect(
        result.outputs.map(({ target, binary, outputName, path, size }) => ({
          target,
          binary,
          outputName,
          path,
          size,
        })),
      ).toEqual([
        {
          target: 'linux-amd64',
          binary: 'alpha',
          outputName: 'alpha',
          path: join(cwd, 'dist/linux-amd64/alpha'),
          size: 22,
        },
        {
          target: 'linux-amd64',
          binary: 'beta',
          outputName: 'beta',
          path: join(cwd, 'dist/linux-amd64/beta'),
          size: 21,
        },
        {
          target: 'windows-arm64',
          binary: 'alpha',
          outputName: 'alpha.exe',
          path: join(cwd, 'dist/windows-arm64/alpha.exe'),
          size: 24,
        },
        {
          target: 'windows-arm64',
          binary: 'beta',
          outputName: 'beta.exe',
          path: join(cwd, 'dist/windows-arm64/beta.exe'),
          size: 23,
        },
      ]);
      expect(lstatSync(join(cwd, 'dist/linux-amd64/alpha')).mode & 0o777).toBe(0o755);
      expect(lstatSync(join(cwd, 'dist/windows-arm64/alpha.exe')).mode & 0o777).toBe(0o644);
      expect(lstatSync(join(cwd, 'dist/stale'), { throwIfNoEntry: false })).toBeUndefined();
      expect(temporaryBuildEntries(cwd)).toEqual([]);
    });
  });

  it('preserves prior output and stops before later targets after an intermediate failure', async () => {
    await withFixture(async (cwd) => {
      mkdirSync(join(cwd, 'dist'));
      writeFileSync(join(cwd, 'dist', 'previous.txt'), 'previous release');
      const started: string[] = [];
      const runner = runnerWith((call) => {
        const target = call.options.env?.GOOS ?? '';
        started.push(target);
        if (target === 'darwin') throw new Error('compiler failed');
        writeFileSync(outputPath(call.args), 'built');
      });
      const options = {
        ...baseOptions(cwd, runner),
        targets: [
          { os: 'linux', arch: 'amd64' },
          { os: 'darwin', arch: 'arm64' },
          { os: 'windows', arch: 'amd64' },
        ],
        processLimits: { concurrency: 1 },
      };

      await expect(buildGoRelease(options)).rejects.toThrow('compiler failed');
      expect(started).toEqual(['linux', 'darwin']);
      expect(readdirSync(join(cwd, 'dist'))).toEqual(['previous.txt']);
      expect(readFileSync(join(cwd, 'dist', 'previous.txt'), 'utf8')).toBe('previous release');
      expect(temporaryBuildEntries(cwd)).toEqual([]);
    });
  });

  it.each(['missing', 'empty', 'directory', 'symlink', 'incorrect-name'] as const)(
    'rejects %s compiler output before replacing the managed tree',
    async (kind) => {
      await withFixture(async (cwd) => {
        mkdirSync(join(cwd, 'dist'));
        writeFileSync(join(cwd, 'dist', 'previous.txt'), 'previous release');
        writeFileSync(join(cwd, 'source-binary'), 'linked content');
        const runner = runnerWith((call) => {
          const output = outputPath(call.args);
          if (kind === 'empty') writeFileSync(output, '');
          if (kind === 'directory') mkdirSync(output);
          if (kind === 'symlink') symlinkSync(join(cwd, 'source-binary'), output);
          if (kind === 'incorrect-name') writeFileSync(join(output, '..', 'wrong-name'), 'built');
        });

        await expect(buildGoRelease(baseOptions(cwd, runner))).rejects.toThrow(/binary output|unexpected entries/u);
        expect(readdirSync(join(cwd, 'dist'))).toEqual(['previous.txt']);
        expect(temporaryBuildEntries(cwd)).toEqual([]);
      });
    },
  );

  it('enforces the target concurrency bound and schedules no target after a known failure', async () => {
    await withFixture(async (cwd) => {
      let active = 0;
      let maxActive = 0;
      let releaseFirst: (() => void) | undefined;
      const started: string[] = [];
      const runner = runnerWith(async (call) => {
        const target = `${call.options.env?.GOOS}/${call.options.env?.GOARCH}`;
        started.push(target);
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          if (target === 'linux/amd64') {
            await new Promise<void>((resolve) => {
              releaseFirst = resolve;
            });
            writeFileSync(outputPath(call.args), 'built');
          } else {
            throw new Error('second target failed');
          }
        } finally {
          active -= 1;
        }
      });
      const options = {
        ...baseOptions(cwd, runner),
        targets: [
          { os: 'linux', arch: 'amd64' },
          { os: 'darwin', arch: 'arm64' },
          { os: 'windows', arch: 'amd64' },
          { os: 'freebsd', arch: 'arm64' },
        ],
        processLimits: { concurrency: 2 },
      };

      const build = buildGoRelease(options);
      await new Promise((resolve) => setTimeout(resolve, 0));
      releaseFirst?.();
      await expect(build).rejects.toThrow('second target failed');
      expect(maxActive).toBe(2);
      expect(started).toEqual(['linux/amd64', 'darwin/arm64']);
      expect(readdirSync(cwd)).toEqual([]);
    });
  });
});
