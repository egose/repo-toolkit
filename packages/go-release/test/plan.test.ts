import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveGoReleasePlan, type GoReleaseOptions } from '../src/index';

function withFixture(run: (cwd: string) => void): void {
  const cwd = mkdtempSync(join(tmpdir(), 'go-release-plan-'));
  try {
    writeFileSync(join(cwd, 'LICENSE'), 'fixture license\n');
    mkdirSync(join(cwd, 'docs'));
    writeFileSync(join(cwd, 'docs', 'NOTICE'), 'fixture notice\n');
    run(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function baseOptions(cwd: string): GoReleaseOptions {
  return {
    cwd,
    toolName: 'aiproxy',
    version: '1.2.3',
    binaries: [
      {
        name: 'aiproxy',
        package: './cmd/aiproxy',
        linkerValues: [{ symbol: 'main.version', value: '{version}/{os}-{arch}' }],
        versionCommand: { args: ['--version'], expectedOutput: 'aiproxy {version}/{os}-{arch}', match: 'anchored' },
      },
    ],
    targets: [
      { os: 'linux', arch: 'amd64' },
      { os: 'windows', arch: 'arm64' },
    ],
  };
}

function snapshot(cwd: string): ReadonlyArray<[string, string]> {
  const walk = (directory: string, prefix = ''): Array<[string, string]> => {
    const result: Array<[string, string]> = [];
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const relativePath = prefix ? `${prefix}/${name}` : name;
      try {
        result.push([relativePath, readFileSync(path, 'hex')]);
      } catch {
        result.push([`${relativePath}/`, '']);
        result.push(...walk(path, relativePath));
      }
    }
    return result;
  };
  return walk(cwd);
}

describe('resolveGoReleasePlan', () => {
  it('resolves a single binary across multiple targets without mutating input or disk', () => {
    withFixture((cwd) => {
      const options = baseOptions(cwd);
      const inputBefore = JSON.stringify(options);
      const filesBefore = snapshot(cwd);

      const plan = resolveGoReleasePlan(options);

      expect(plan).toMatchObject({
        cwd,
        toolName: 'aiproxy',
        version: '1.2.3',
        outputDir: 'dist',
        resolvedOutputDir: join(cwd, 'dist'),
        goExecutable: 'go',
        buildFlags: ['-trimpath', '-buildvcs=false'],
        linkerFlags: ['-buildid='],
        archiveName: '{tool}-{os}-{arch}.tar.gz',
        checksumFile: 'SHA256SUMS',
        sourceDateEpoch: 0,
        processLimits: { timeoutMs: 120_000, maxOutputBytes: 1_048_576, concurrency: 2 },
      });
      expect(plan.targets).toEqual([
        {
          os: 'linux',
          arch: 'amd64',
          name: 'linux-amd64',
          archiveName: 'aiproxy-linux-amd64.tar.gz',
          binaries: [
            {
              name: 'aiproxy',
              outputName: 'aiproxy',
              packagePath: 'cmd/aiproxy',
              linkerValues: [{ symbol: 'main.version', value: '1.2.3/linux-amd64' }],
              versionCommand: {
                args: ['--version'],
                expectedOutput: 'aiproxy 1.2.3/linux-amd64',
                match: 'anchored',
              },
            },
          ],
        },
        {
          os: 'windows',
          arch: 'arm64',
          name: 'windows-arm64',
          archiveName: 'aiproxy-windows-arm64.tar.gz',
          binaries: [
            {
              name: 'aiproxy',
              outputName: 'aiproxy.exe',
              packagePath: 'cmd/aiproxy',
              linkerValues: [{ symbol: 'main.version', value: '1.2.3/windows-arm64' }],
              versionCommand: {
                args: ['--version'],
                expectedOutput: 'aiproxy 1.2.3/windows-arm64',
                match: 'anchored',
              },
            },
          ],
        },
      ]);
      expect(JSON.stringify(options)).toBe(inputBefore);
      expect(snapshot(cwd)).toEqual(filesBefore);
    });
  });

  it('resolves a database-tools shaped release with two binaries and LICENSE', () => {
    withFixture((cwd) => {
      const plan = resolveGoReleasePlan({
        cwd,
        toolName: 'database-tools',
        version: '2.0.0',
        binaries: [
          {
            name: 'mongo-archive',
            package: './mongoarchive/main/mongoarchive.go',
            linkerValues: [{ symbol: 'main.version', value: '{version} {os}-{arch}' }],
          },
          {
            name: 'mongo-unarchive',
            package: './mongounarchive/main/mongounarchive.go',
            linkerValues: [{ symbol: 'main.version', value: '{version} {os}-{arch}' }],
          },
        ],
        targets: [{ os: 'windows', arch: 'amd64' }],
        additionalFiles: [{ source: './LICENSE', destination: 'LICENSE' }],
        sourceDateEpoch: 1_700_000_000,
        processLimits: { concurrency: 4, timeoutMs: 30_000, maxOutputBytes: 4096 },
      });

      expect(plan.targets[0].archiveName).toBe('database-tools-windows-amd64.tar.gz');
      expect(plan.targets[0].binaries.map((binary) => binary.outputName)).toEqual([
        'mongo-archive.exe',
        'mongo-unarchive.exe',
      ]);
      expect(plan.targets[0].binaries[0].linkerValues[0].value).toBe('2.0.0 windows-amd64');
      expect(plan.additionalFiles).toEqual([
        { source: 'LICENSE', sourcePath: join(cwd, 'LICENSE'), destination: 'LICENSE' },
      ]);
      expect(plan.processLimits).toEqual({ concurrency: 4, timeoutMs: 30_000, maxOutputBytes: 4096 });
    });
  });

  it.each([
    ['top-level', (options: Record<string, unknown>) => ({ ...options, surprise: true }), /Unknown go-release option/],
    [
      'binary',
      (options: Record<string, unknown>) => ({
        ...options,
        binaries: [{ name: 'app', package: './cmd/app', extra: 1 }],
      }),
      /Unknown binaries\[0\]/,
    ],
    [
      'target',
      (options: Record<string, unknown>) => ({ ...options, targets: [{ os: 'linux', arch: 'amd64', extra: 1 }] }),
      /Unknown targets\[0\]/,
    ],
    [
      'linker value',
      (options: Record<string, unknown>) => ({
        ...options,
        binaries: [
          { name: 'app', package: './cmd/app', linkerValues: [{ symbol: 'main.version', value: 'x', extra: 1 }] },
        ],
      }),
      /Unknown binaries\[0\]\.linkerValues\[0\]/,
    ],
    [
      'version command',
      (options: Record<string, unknown>) => ({
        ...options,
        binaries: [{ name: 'app', package: './cmd/app', versionCommand: { expectedOutput: 'x', extra: 1 } }],
      }),
      /Unknown binaries\[0\]\.versionCommand/,
    ],
    [
      'additional file',
      (options: Record<string, unknown>) => ({
        ...options,
        additionalFiles: [{ source: 'LICENSE', destination: 'LICENSE', extra: 1 }],
      }),
      /Unknown additionalFiles\[0\]/,
    ],
    [
      'process limits',
      (options: Record<string, unknown>) => ({ ...options, processLimits: { timeoutMs: 1, extra: 1 } }),
      /Unknown processLimits/,
    ],
  ])('rejects unknown keys in %s configuration', (_label, mutate, expected) => {
    withFixture((cwd) => {
      expect(() => resolveGoReleasePlan(mutate(baseOptions(cwd) as unknown as Record<string, unknown>))).toThrow(
        expected,
      );
    });
  });

  it.each([
    ['missing binaries', (options: GoReleaseOptions) => ({ ...options, binaries: [] }), /at least one/],
    ['missing targets', (options: GoReleaseOptions) => ({ ...options, targets: [] }), /at least one/],
    [
      'duplicate binaries',
      (options: GoReleaseOptions) => ({ ...options, binaries: [...options.binaries, options.binaries[0]] }),
      /Duplicate binary/,
    ],
    [
      'duplicate targets',
      (options: GoReleaseOptions) => ({ ...options, targets: [...options.targets, options.targets[0]] }),
      /Duplicate target/,
    ],
    [
      'malformed OS',
      (options: GoReleaseOptions) => ({ ...options, targets: [{ os: 'Linux', arch: 'amd64' }] }),
      /lowercase ASCII/,
    ],
    [
      'malformed architecture',
      (options: GoReleaseOptions) => ({ ...options, targets: [{ os: 'linux', arch: 'amd-64' }] }),
      /lowercase ASCII/,
    ],
    [
      'duplicate archive names',
      (options: GoReleaseOptions) => ({ ...options, archiveName: 'release.tar.gz' }),
      /Duplicate generated archive/,
    ],
    [
      'Windows suffix collision',
      (options: GoReleaseOptions) => ({
        ...options,
        binaries: [
          { name: 'app', package: './cmd/app' },
          { name: 'app.exe', package: './cmd/app-exe' },
        ],
        targets: [{ os: 'windows', arch: 'amd64' }],
      }),
      /Archive member collision/,
    ],
    [
      'empty package path',
      (options: GoReleaseOptions) => ({ ...options, binaries: [{ name: 'app', package: '' }] }),
      /non-empty string/,
    ],
  ])('rejects %s', (_label, mutate, expected) => {
    withFixture((cwd) => {
      expect(() => resolveGoReleasePlan(mutate(baseOptions(cwd)))).toThrow(expected);
    });
  });

  it.each([
    ['absolute output', (options: GoReleaseOptions) => ({ ...options, outputDir: '/tmp/release' }), /must be relative/],
    ['root output', (options: GoReleaseOptions) => ({ ...options, outputDir: '.' }), /non-root path/],
    ['traversing output', (options: GoReleaseOptions) => ({ ...options, outputDir: '../release' }), /parent-directory/],
    [
      'traversing package',
      (options: GoReleaseOptions) => ({ ...options, binaries: [{ name: 'app', package: '../cmd/app' }] }),
      /parent-directory/,
    ],
    [
      'absolute additional source',
      (options: GoReleaseOptions) => ({
        ...options,
        additionalFiles: [{ source: '/tmp/LICENSE', destination: 'LICENSE' }],
      }),
      /must be relative/,
    ],
    [
      'traversing archive destination',
      (options: GoReleaseOptions) => ({
        ...options,
        additionalFiles: [{ source: 'LICENSE', destination: '../LICENSE' }],
      }),
      /parent-directory/,
    ],
    ['NUL path', (options: GoReleaseOptions) => ({ ...options, outputDir: 'dist\0escape' }), /NUL/],
  ])('rejects %s paths', (_label, mutate, expected) => {
    withFixture((cwd) => {
      expect(() => resolveGoReleasePlan(mutate(baseOptions(cwd)))).toThrow(expected);
    });
  });

  it('rejects missing files, directories, output sources, and archive member collisions', () => {
    withFixture((cwd) => {
      const options = baseOptions(cwd);
      expect(() =>
        resolveGoReleasePlan({ ...options, additionalFiles: [{ source: 'MISSING', destination: 'NOTICE' }] }),
      ).toThrow(/does not exist/);
      expect(() =>
        resolveGoReleasePlan({ ...options, additionalFiles: [{ source: 'docs', destination: 'docs' }] }),
      ).toThrow(/regular file/);

      mkdirSync(join(cwd, 'dist'));
      writeFileSync(join(cwd, 'dist', 'generated'), 'generated');
      expect(() =>
        resolveGoReleasePlan({
          ...options,
          additionalFiles: [{ source: 'dist/generated', destination: 'generated' }],
        }),
      ).toThrow(/must not be inside outputDir/);
      expect(() =>
        resolveGoReleasePlan({ ...options, additionalFiles: [{ source: 'LICENSE', destination: 'aiproxy' }] }),
      ).toThrow(/Archive member collision/);
      expect(() =>
        resolveGoReleasePlan({ ...options, additionalFiles: [{ source: 'LICENSE', destination: 'SHA256SUMS' }] }),
      ).toThrow(/reserved/);
      expect(() =>
        resolveGoReleasePlan({
          ...options,
          additionalFiles: [
            { source: 'LICENSE', destination: 'NOTICE' },
            { source: 'docs/NOTICE', destination: 'NOTICE' },
          ],
        }),
      ).toThrow(/Duplicate archive destination/);
      expect(() =>
        resolveGoReleasePlan({
          ...options,
          additionalFiles: [
            { source: 'LICENSE', destination: 'docs' },
            { source: 'docs/NOTICE', destination: 'docs/NOTICE' },
          ],
        }),
      ).toThrow(/file\/directory collision/);
      expect(() => resolveGoReleasePlan({ ...options, checksumFile: 'linux-amd64' })).toThrow(
        /Target output directory collides/,
      );
      expect(() =>
        resolveGoReleasePlan({
          ...options,
          binaries: [{ name: 'docs', package: 'cmd/app' }],
          additionalFiles: [{ source: 'LICENSE', destination: 'docs/LICENSE' }],
        }),
      ).toThrow(/file\/directory collision/);
    });
  });

  it('rejects package paths whose existing ancestor escapes through a symlink', () => {
    withFixture((cwd) => {
      const outside = mkdtempSync(join(tmpdir(), 'go-release-plan-outside-'));
      try {
        symlinkSync(outside, join(cwd, 'external'), 'dir');
        expect(() =>
          resolveGoReleasePlan({
            ...baseOptions(cwd),
            binaries: [{ name: 'app', package: 'external/cmd/app' }],
          }),
        ).toThrow(/binaries\[0\]\.package escapes the project root/);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  it('rejects output and additional-file paths that escape through symlink ancestors', () => {
    withFixture((cwd) => {
      const outside = mkdtempSync(join(tmpdir(), 'go-release-plan-outside-'));
      try {
        writeFileSync(join(outside, 'NOTICE'), 'outside');
        symlinkSync(outside, join(cwd, 'external'), 'dir');
        expect(() => resolveGoReleasePlan({ ...baseOptions(cwd), outputDir: 'external/dist' })).toThrow(
          /outputDir escapes the project root/,
        );
        expect(() =>
          resolveGoReleasePlan({
            ...baseOptions(cwd),
            additionalFiles: [{ source: 'external/NOTICE', destination: 'NOTICE' }],
          }),
        ).toThrow(/additionalFiles\[0\]\.source escapes the project root/);
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  it('rejects unsupported templates and unsafe linker values', () => {
    withFixture((cwd) => {
      const options = baseOptions(cwd);
      expect(() => resolveGoReleasePlan({ ...options, archiveName: '{platform}.tar.gz' })).toThrow(
        /unsupported template token/,
      );
      expect(() => resolveGoReleasePlan({ ...options, archiveName: '{os-{arch}.tar.gz' })).toThrow(
        /malformed template/,
      );
      expect(() =>
        resolveGoReleasePlan({
          ...options,
          binaries: [
            { name: 'app', package: './cmd/app', versionCommand: { args: ['--{platform}'], expectedOutput: 'app' } },
          ],
        }),
      ).toThrow(/unsupported template token/);
      expect(() =>
        resolveGoReleasePlan({
          ...options,
          binaries: [
            { name: 'app', package: './cmd/app', linkerValues: [{ symbol: 'main.version', value: '"{version}"' }] },
          ],
        }),
      ).toThrow(/represented safely/);
      expect(() => resolveGoReleasePlan({ ...options, version: '1.0.0/bad' })).toThrow(/unsafe for release filenames/);
    });
  });

  it('runtime-validates value types and numeric limits', () => {
    withFixture((cwd) => {
      const options = baseOptions(cwd) as unknown as Record<string, unknown>;
      expect(() => resolveGoReleasePlan({ ...options, targets: 'linux/amd64' })).toThrow(/targets must be an array/);
      expect(() => resolveGoReleasePlan({ ...options, sourceDateEpoch: -1 })).toThrow(/non-negative safe integer/);
      expect(() => resolveGoReleasePlan({ ...options, processLimits: { concurrency: 0 } })).toThrow(
        /positive safe integer/,
      );
      expect(() => resolveGoReleasePlan({ ...options, buildFlags: ['-trimpath', 1] })).toThrow(
        /array of non-empty strings/,
      );
      expect(() => resolveGoReleasePlan(null)).toThrow(/options must be an object/);
    });
  });
});
