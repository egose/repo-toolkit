import { gunzipSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createGoReleaseArchives,
  writeGoReleaseChecksums,
  type GoReleaseOptions,
  type GoReleaseRunner,
  type GoReleaseRunOptions,
} from '../src/index';

interface TarCall {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly options: GoReleaseRunOptions;
}

interface FakeArchiveMember {
  readonly name: string;
  readonly contents: string;
}

function withFixture(run: (cwd: string) => Promise<void> | void): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'go-release-archive-'));
  return Promise.resolve(run(cwd)).finally(() => rmSync(cwd, { recursive: true, force: true }));
}

function fakeTarRunner(calls: TarCall[], fail = false): GoReleaseRunner {
  return {
    run(executable, args, options) {
      calls.push({ executable, args, options });
      const fileIndex = args.indexOf('--file');
      const membersIndex = args.indexOf('--');
      const output = args[fileIndex + 1];
      if (fileIndex < 0 || membersIndex < 0 || output === undefined) throw new Error('invalid fake tar arguments');
      writeFileSync(
        output,
        JSON.stringify(
          args.slice(membersIndex + 1).map((name) => ({
            name,
            contents: readFileSync(join(options.cwd, ...name.split('/'))).toString('base64'),
          })),
        ),
      );
      if (fail) throw new Error('fake tar failed');
    },
    capture() {
      return '';
    },
  };
}

function optionsFor(cwd: string, runner: GoReleaseRunner): GoReleaseOptions {
  return {
    cwd,
    toolName: 'fixture',
    version: '1.2.3',
    tarExecutable: '/tool path/tar',
    binaries: [{ name: 'fixture', package: 'cmd/fixture' }],
    targets: [{ os: 'linux', arch: 'amd64' }],
    sourceDateEpoch: 1234,
    processLimits: { timeoutMs: 4321, maxOutputBytes: 9876 },
    runner,
  };
}

function createBuildOutput(cwd: string, target: string, files: Readonly<Record<string, string>>): void {
  const targetDir = join(cwd, 'dist', target);
  mkdirSync(targetDir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(targetDir, name), contents);
}

function archiveMembers(path: string): ReadonlyArray<FakeArchiveMember> {
  return JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as ReadonlyArray<FakeArchiveMember>;
}

function temporaryEntries(cwd: string): ReadonlyArray<string> {
  return readdirSync(join(cwd, 'dist')).filter((name) => name.startsWith('.'));
}

describe('Go release archives', () => {
  it('creates an exact deterministic single-binary archive with structured tar arguments', async () => {
    await withFixture(async (cwd) => {
      createBuildOutput(cwd, 'linux-amd64', { fixture: 'linux binary' });
      const calls: TarCall[] = [];
      const options = optionsFor(cwd, fakeTarRunner(calls));

      const first = await createGoReleaseArchives(options);
      const firstBytes = readFileSync(first.artifacts[0].archivePath);
      const second = await createGoReleaseArchives(options);

      expect(archiveMembers(second.artifacts[0].archivePath)).toEqual([
        { name: 'fixture', contents: Buffer.from('linux binary').toString('base64') },
      ]);
      expect(readFileSync(second.artifacts[0].archivePath)).toEqual(firstBytes);
      expect(second.artifacts[0]).toMatchObject({
        target: 'linux-amd64',
        os: 'linux',
        arch: 'amd64',
        size: firstBytes.byteLength,
        checksum: first.artifacts[0].checksum,
      });
      expect(calls[0]).toEqual({
        executable: '/tool path/tar',
        args: [
          '--create',
          '--format=ustar',
          '--sort=name',
          '--mtime=@1234',
          '--owner=0',
          '--group=0',
          '--numeric-owner',
          '--no-recursion',
          '--file',
          calls[0].args[9],
          '--',
          'fixture',
        ],
        options: {
          cwd: calls[0].options.cwd,
          env: { TAR_OPTIONS: '' },
          stdio: 'pipe',
          timeoutMs: 4321,
          maxOutputBytes: 9876,
        },
      });
      expect(calls[0].options.cwd).toContain(join(cwd, 'dist', '.linux-amd64-archive-stage-'));
      expect(temporaryEntries(cwd)).toEqual([]);
    });
  });

  it('creates multi-binary archives with additional files at exact sorted destinations', async () => {
    await withFixture(async (cwd) => {
      writeFileSync(join(cwd, 'LICENSE'), 'license text');
      createBuildOutput(cwd, 'windows-arm64', { 'beta.exe': 'beta', 'alpha.exe': 'alpha' });
      const calls: TarCall[] = [];

      const result = await createGoReleaseArchives({
        ...optionsFor(cwd, fakeTarRunner(calls)),
        binaries: [
          { name: 'beta', package: 'cmd/beta' },
          { name: 'alpha', package: 'cmd/alpha' },
        ],
        targets: [{ os: 'windows', arch: 'arm64' }],
        additionalFiles: [{ source: 'LICENSE', destination: 'docs/LICENSE' }],
      });

      expect(archiveMembers(result.artifacts[0].archivePath).map((member) => member.name)).toEqual([
        'alpha.exe',
        'beta.exe',
        'docs/LICENSE',
      ]);
      expect(calls[0].args.slice(calls[0].args.indexOf('--') + 1)).toEqual(['alpha.exe', 'beta.exe', 'docs/LICENSE']);
    });
  });

  it('sorts the manifest by filename independently of target order', async () => {
    await withFixture(async (cwd) => {
      createBuildOutput(cwd, 'windows-arm64', { 'fixture.exe': 'windows' });
      createBuildOutput(cwd, 'linux-amd64', { fixture: 'linux' });
      const result = await createGoReleaseArchives({
        ...optionsFor(cwd, fakeTarRunner([])),
        targets: [
          { os: 'windows', arch: 'arm64' },
          { os: 'linux', arch: 'amd64' },
        ],
      });
      const lines = readFileSync(result.checksumPath, 'utf8').trimEnd().split('\n');

      expect(lines.map((line) => line.slice(66))).toEqual([
        'fixture-linux-amd64.tar.gz',
        'fixture-windows-arm64.tar.gz',
      ]);
      expect(lines.every((line) => /^[0-9a-f]{64} {2}[^\r\n]+$/u.test(line))).toBe(true);
    });
  });

  it('changes only the relevant checksum when input content changes', async () => {
    await withFixture(async (cwd) => {
      createBuildOutput(cwd, 'linux-amd64', { fixture: 'first' });
      createBuildOutput(cwd, 'darwin-arm64', { fixture: 'stable' });
      const options = {
        ...optionsFor(cwd, fakeTarRunner([])),
        targets: [
          { os: 'linux', arch: 'amd64' },
          { os: 'darwin', arch: 'arm64' },
        ],
      };
      const first = await createGoReleaseArchives(options);
      writeFileSync(join(cwd, 'dist/linux-amd64/fixture'), 'second');
      const second = await createGoReleaseArchives(options);

      expect(second.artifacts[0].checksum).not.toBe(first.artifacts[0].checksum);
      expect(second.artifacts[1].checksum).toBe(first.artifacts[1].checksum);
    });
  });

  it('preserves a published archive and cleans temporary content when tar fails', async () => {
    await withFixture(async (cwd) => {
      createBuildOutput(cwd, 'linux-amd64', { fixture: 'new binary' });
      const archivePath = join(cwd, 'dist/fixture-linux-amd64.tar.gz');
      writeFileSync(archivePath, 'published archive');

      await expect(createGoReleaseArchives(optionsFor(cwd, fakeTarRunner([], true)))).rejects.toThrow(
        'GNU-compatible tar support',
      );
      expect(readFileSync(archivePath, 'utf8')).toBe('published archive');
      expect(temporaryEntries(cwd)).toEqual([]);
    });
  });

  it('writes checksums atomically and preserves the prior manifest on write failure', async () => {
    await withFixture(async (cwd) => {
      createBuildOutput(cwd, 'linux-amd64', { fixture: 'binary' });
      const base = optionsFor(cwd, fakeTarRunner([]));
      await createGoReleaseArchives(base);
      const checksumFile = 'S'.repeat(230);
      const checksumPath = join(cwd, 'dist', checksumFile);
      writeFileSync(checksumPath, 'published manifest');

      expect(() => writeGoReleaseChecksums({ ...base, checksumFile })).toThrow();
      expect(readFileSync(checksumPath, 'utf8')).toBe('published manifest');
      expect(temporaryEntries(cwd)).toEqual([]);
      expect(basename(writeGoReleaseChecksums(base).checksumPath)).toBe('SHA256SUMS');
    });
  });
});
