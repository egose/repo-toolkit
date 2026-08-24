import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { arch as hostArch, platform as hostPlatform, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  verifyGoRelease,
  type GoReleaseOptions,
  type GoReleaseRunner,
  type GoReleaseRunOptions,
  type GoReleaseVerifyOptions,
} from '../src/index';

interface FixtureMember {
  readonly name: string;
  readonly contents?: string;
  readonly mode?: number;
  readonly type?: string;
  readonly declaredSize?: number;
  readonly embeddedNameSuffix?: string;
  readonly nonzeroPadding?: boolean;
}

interface RunnerCall {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly options: GoReleaseRunOptions;
}

interface FakeRunnerOptions {
  readonly archives: Readonly<Record<string, ReadonlyArray<FixtureMember>>>;
  readonly mutate?: (root: string, archiveName: string) => void;
  readonly output?: string;
}

function withFixture(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'go-release-verify-'));
  mkdirSync(join(cwd, 'dist'));
  return run(cwd).finally(() => rmSync(cwd, { recursive: true, force: true }));
}

function baseOptions(cwd: string, runner: GoReleaseRunner): GoReleaseOptions {
  return {
    cwd,
    toolName: 'fixture',
    version: '1.2.3',
    tarExecutable: '/controlled/tar',
    binaries: [{ name: 'fixture', package: 'cmd/fixture' }],
    targets: [{ os: 'linux', arch: 'amd64' }],
    processLimits: { timeoutMs: 1234, maxOutputBytes: 5678 },
    runner,
  };
}

function writeRelease(cwd: string, archives: Readonly<Record<string, ReadonlyArray<FixtureMember>>>): void {
  const lines: string[] = [];
  for (const [name, members] of Object.entries(archives)) {
    const contents = createTar(members);
    writeFileSync(join(cwd, 'dist', name), contents);
    lines.push(`${createHash('sha256').update(contents).digest('hex')}  ${name}\n`);
  }
  writeFileSync(join(cwd, 'dist', 'SHA256SUMS'), lines.sort().join(''));
}

function createTar(members: ReadonlyArray<FixtureMember>): Buffer {
  const blocks: Buffer[] = [];
  for (const member of members) {
    const contents = Buffer.from(member.contents ?? 'content');
    const header = Buffer.alloc(512);
    writeField(header, 0, 100, member.name);
    if (member.embeddedNameSuffix)
      writeField(header, member.name.length + 1, 100 - member.name.length - 1, member.embeddedNameSuffix);
    writeOctal(header, 100, 8, member.mode ?? 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, member.declaredSize ?? contents.length);
    writeOctal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = (member.type ?? '0').charCodeAt(0);
    writeField(header, 257, 6, 'ustar');
    writeField(header, 263, 2, '00');
    let checksum = 0;
    for (const byte of header) checksum += byte;
    const checksumText = checksum.toString(8).padStart(6, '0');
    header.write(checksumText, 148, 6, 'ascii');
    header[154] = 0;
    header[155] = 32;
    const padding = Buffer.alloc((512 - (contents.length % 512)) % 512);
    if (member.nonzeroPadding && padding.length > 0) padding[0] = 1;
    blocks.push(header, contents, padding);
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function writeField(buffer: Buffer, offset: number, length: number, value: string): void {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8');
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  buffer.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'ascii');
}

function fakeRunner(calls: RunnerCall[], options: FakeRunnerOptions): GoReleaseRunner {
  return {
    run(executable, args, runOptions) {
      calls.push({ executable, args, options: runOptions });
      const archivePath = args[args.indexOf('--file') + 1];
      const root = args[args.indexOf('--directory') + 1];
      if (!archivePath || !root) throw new Error('Unexpected extraction arguments');
      const archiveName = archivePath.split('/').pop() as string;
      for (const member of options.archives[archiveName] ?? []) {
        if (member.type !== undefined && member.type !== '0') continue;
        const path = join(root, ...member.name.replace(/^\.\//u, '').split('/'));
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, member.contents ?? 'content');
        chmodSync(path, member.mode ?? 0o644);
      }
      options.mutate?.(root, archiveName);
    },
    capture(executable, args, runOptions) {
      calls.push({ executable, args, options: runOptions });
      return options.output ?? '';
    },
  };
}

function temporaryEntries(cwd: string): ReadonlyArray<string> {
  return readdirSync(join(cwd, 'dist')).filter((name) => name.startsWith('.go-release-verify-'));
}

function hostTarget(): { os: string; arch: string } {
  const osMap: Readonly<Record<string, string>> = { win32: 'windows', sunos: 'solaris' };
  const archMap: Readonly<Record<string, string>> = { x64: 'amd64', ia32: '386' };
  return { os: osMap[hostPlatform()] ?? hostPlatform(), arch: archMap[hostArch()] ?? hostArch() };
}

describe('verifyGoRelease', () => {
  it('verifies exact one-binary and two-binary archive layouts and cleans temporary storage', async () => {
    await withFixture(async (cwd) => {
      writeFileSync(join(cwd, 'LICENSE'), 'license');
      const archives = {
        'fixture-linux-amd64.tar.gz': [{ name: 'fixture', contents: 'binary', mode: 0o755 }],
      };
      writeRelease(cwd, archives);
      const calls: RunnerCall[] = [];
      const result = await verifyGoRelease(baseOptions(cwd, fakeRunner(calls, { archives })));
      expect(result.artifacts).toEqual([expect.objectContaining({ target: 'linux-amd64', versionChecks: [] })]);
      expect(calls[0]).toMatchObject({
        executable: '/controlled/tar',
        args: [
          '--extract',
          '--gzip',
          '--file',
          expect.any(String),
          '--directory',
          expect.any(String),
          '--no-same-owner',
          '--same-permissions',
          '--no-overwrite-dir',
          '--',
        ],
        options: { env: { TAR_OPTIONS: '' }, stdio: 'pipe', timeoutMs: 1234, maxOutputBytes: 5678 },
      });
      expect(temporaryEntries(cwd)).toEqual([]);

      const multi = {
        'fixture-linux-amd64.tar.gz': [
          { name: 'alpha', contents: 'alpha', mode: 0o755 },
          { name: 'beta', contents: 'beta', mode: 0o755 },
          { name: 'docs/LICENSE', contents: 'license', mode: 0o644 },
        ],
      };
      writeRelease(cwd, multi);
      await expect(
        verifyGoRelease({
          ...baseOptions(cwd, fakeRunner([], { archives: multi })),
          binaries: [
            { name: 'alpha', package: 'cmd/alpha' },
            { name: 'beta', package: 'cmd/beta' },
          ],
          additionalFiles: [{ source: 'LICENSE', destination: 'docs/LICENSE' }],
        }),
      ).resolves.toMatchObject({ artifacts: [{ target: 'linux-amd64' }] });
      expect(temporaryEntries(cwd)).toEqual([]);
    });
  });

  it.each([
    ['traversal', [{ name: '../escape', mode: 0o755 }], /traversal/u],
    ['absolute path', [{ name: '/escape', mode: 0o755 }], /safe relative/u],
    ['symlink', [{ name: 'fixture', mode: 0o755, type: '2' }], /unsupported member type/u],
    ['hard link', [{ name: 'fixture', mode: 0o755, type: '1' }], /unsupported member type/u],
    ['FIFO', [{ name: 'fixture', mode: 0o755, type: '6' }], /unsupported member type/u],
    ['device', [{ name: 'fixture', mode: 0o755, type: '3' }], /unsupported member type/u],
    ['sparse file', [{ name: 'fixture', mode: 0o755, type: 'S' }], /unsupported member type/u],
    ['embedded NUL data', [{ name: 'fixture', mode: 0o755, embeddedNameSuffix: 'evil' }], /embedded NUL/u],
    [
      'duplicate normalized path',
      [
        { name: 'fixture', mode: 0o755 },
        { name: './fixture', mode: 0o755 },
      ],
      /duplicate normalized/u,
    ],
    [
      'unexpected file',
      [
        { name: 'fixture', mode: 0o755 },
        { name: 'extra', mode: 0o644 },
      ],
      /unexpected member/u,
    ],
    ['unexpected permissions', [{ name: 'fixture', mode: 0o777 }], /unexpected permissions/u],
    ['nonzero padding', [{ name: 'fixture', mode: 0o755, nonzeroPadding: true }], /nonzero padding/u],
    ['an empty archive', [], /Archive is empty/u],
  ])('rejects %s headers before extraction', async (_name, members, error) => {
    await withFixture(async (cwd) => {
      const archives = { 'fixture-linux-amd64.tar.gz': members };
      writeRelease(cwd, archives);
      const calls: RunnerCall[] = [];
      await expect(verifyGoRelease(baseOptions(cwd, fakeRunner(calls, { archives })))).rejects.toThrow(error);
      expect(calls).toEqual([]);
      expect(existsSync(join(cwd, 'escape'))).toBe(false);
      expect(temporaryEntries(cwd)).toEqual([]);
    });
  });

  it('enforces configurable member, path, and expanded-byte limits before extraction', async () => {
    await withFixture(async (cwd) => {
      const cases: Array<[ReadonlyArray<FixtureMember>, GoReleaseVerifyOptions['archiveLimits'], RegExp]> = [
        [[{ name: 'fixture', mode: 0o755 }, { name: 'extra' }], { maxMemberCount: 1 }, /member limit/u],
        [[{ name: 'fixture', mode: 0o755 }], { maxPathLength: 6 }, /path is too long/u],
        [[{ name: 'fixture', mode: 0o755, declaredSize: 100 }], { maxExpandedBytes: 10 }, /expanded size limit/u],
      ];
      for (const [members, archiveLimits, error] of cases) {
        const archives = { 'fixture-linux-amd64.tar.gz': members };
        writeRelease(cwd, archives);
        const calls: RunnerCall[] = [];
        await expect(
          verifyGoRelease({
            ...baseOptions(cwd, fakeRunner(calls, { archives })),
            archiveLimits,
          }),
        ).rejects.toThrow(error);
        expect(calls).toEqual([]);
        expect(temporaryEntries(cwd)).toEqual([]);
      }
    });
  });

  it.each([
    ['malformed hash', 'x'.repeat(64) + '  fixture-linux-amd64.tar.gz\n', /Malformed/u],
    [
      'duplicate entry',
      `${'0'.repeat(64)}  fixture-linux-amd64.tar.gz\n${'0'.repeat(64)}  fixture-linux-amd64.tar.gz\n`,
      /Duplicate/u,
    ],
    ['unsafe filename', `${'0'.repeat(64)}  ../fixture-linux-amd64.tar.gz\n`, /Malformed/u],
    ['unknown file', `${'0'.repeat(64)}  unknown.tar.gz\n`, /unexpected file set/u],
    ['missing archive', `${'0'.repeat(64)}  other.tar.gz\n`, /unexpected file set/u],
    ['digest mismatch', `${'0'.repeat(64)}  fixture-linux-amd64.tar.gz\n`, /Checksum mismatch/u],
    ['ambiguous spacing', `${'0'.repeat(64)} fixture-linux-amd64.tar.gz\n`, /Malformed/u],
  ])('fails closed for a checksum manifest with a %s', async (_name, manifest, error) => {
    await withFixture(async (cwd) => {
      const archives = { 'fixture-linux-amd64.tar.gz': [{ name: 'fixture', mode: 0o755 }] };
      writeRelease(cwd, archives);
      writeFileSync(join(cwd, 'dist/SHA256SUMS'), manifest);
      const calls: RunnerCall[] = [];
      await expect(verifyGoRelease(baseOptions(cwd, fakeRunner(calls, { archives })))).rejects.toThrow(error);
      expect(calls).toEqual([]);
      expect(temporaryEntries(cwd)).toEqual([]);
    });
  });

  it('rejects a missing archive named by an otherwise exact manifest', async () => {
    await withFixture(async (cwd) => {
      writeFileSync(join(cwd, 'dist/SHA256SUMS'), `${'0'.repeat(64)}  fixture-linux-amd64.tar.gz\n`);
      const calls: RunnerCall[] = [];
      await expect(verifyGoRelease(baseOptions(cwd, fakeRunner(calls, { archives: {} })))).rejects.toThrow(
        /release output archives/u,
      );
      expect(calls).toEqual([]);
      expect(temporaryEntries(cwd)).toEqual([]);
    });
  });

  it('rejects unlisted archives and oversized inputs before copying or extraction', async () => {
    await withFixture(async (cwd) => {
      const archives = { 'fixture-linux-amd64.tar.gz': [{ name: 'fixture', mode: 0o755 }] };
      writeRelease(cwd, archives);
      writeFileSync(join(cwd, 'dist/unlisted.tar.gz'), 'unlisted');
      const calls: RunnerCall[] = [];
      await expect(verifyGoRelease(baseOptions(cwd, fakeRunner(calls, { archives })))).rejects.toThrow(
        /release output archives/u,
      );
      expect(calls).toEqual([]);
      rmSync(join(cwd, 'dist/unlisted.tar.gz'));

      truncateSync(join(cwd, 'dist/fixture-linux-amd64.tar.gz'), 513 * 1024 * 1024);
      await expect(
        verifyGoRelease({
          ...baseOptions(cwd, fakeRunner(calls, { archives })),
          archiveLimits: { maxExpandedBytes: 1 },
        }),
      ).rejects.toThrow(/compressed size bound/u);
      expect(calls).toEqual([]);
      expect(temporaryEntries(cwd)).toEqual([]);

      writeRelease(cwd, archives);
      truncateSync(join(cwd, 'dist/SHA256SUMS'), 128 * 1024);
      await expect(verifyGoRelease(baseOptions(cwd, fakeRunner(calls, { archives })))).rejects.toThrow(
        /manifest exceeds/u,
      );
      expect(calls).toEqual([]);
      expect(temporaryEntries(cwd)).toEqual([]);
    });
  });

  it.each([
    [
      'symlink',
      (root: string) => {
        rmSync(join(root, 'fixture'));
        symlinkSync('../outside', join(root, 'fixture'));
      },
      /symlink/u,
    ],
    ['changed size', (root: string) => writeFileSync(join(root, 'fixture'), 'changed size'), /size mismatch/u],
    ['changed permissions', (root: string) => chmodSync(join(root, 'fixture'), 0o644), /permission mismatch/u],
    ['empty binary', (root: string) => writeFileSync(join(root, 'fixture'), ''), /size mismatch|binary is empty/u],
  ])('rejects a post-extraction %s and cleans temporary storage', async (_name, mutate, error) => {
    await withFixture(async (cwd) => {
      const archives = { 'fixture-linux-amd64.tar.gz': [{ name: 'fixture', contents: 'binary', mode: 0o755 }] };
      writeRelease(cwd, archives);
      await expect(verifyGoRelease(baseOptions(cwd, fakeRunner([], { archives, mutate })))).rejects.toThrow(error);
      expect(temporaryEntries(cwd)).toEqual([]);
    });
  });

  it('cleans snapshot and extraction storage when the extraction process fails', async () => {
    await withFixture(async (cwd) => {
      const archives = { 'fixture-linux-amd64.tar.gz': [{ name: 'fixture', contents: 'binary', mode: 0o755 }] };
      writeRelease(cwd, archives);
      const runner: GoReleaseRunner = {
        run() {
          throw new Error('controlled extraction failure');
        },
        capture() {
          return '';
        },
      };
      await expect(verifyGoRelease(baseOptions(cwd, runner))).rejects.toThrow('controlled extraction failure');
      expect(temporaryEntries(cwd)).toEqual([]);
      expect(existsSync(join(cwd, 'dist/fixture-linux-amd64.tar.gz'))).toBe(true);
      expect(existsSync(join(cwd, 'dist/SHA256SUMS'))).toBe(true);
    });
  });

  it('runs version commands only for the host-compatible target and applies exact and anchored matching', async () => {
    await withFixture(async (cwd) => {
      const compatible = hostTarget();
      const incompatible = { os: compatible.os === 'windows' ? 'linux' : 'windows', arch: compatible.arch };
      const compatibleName = `fixture-${compatible.os}-${compatible.arch}.tar.gz`;
      const incompatibleName = `fixture-${incompatible.os}-${incompatible.arch}.tar.gz`;
      const archives = {
        [compatibleName]: [
          {
            name: compatible.os === 'windows' ? 'fixture.exe' : 'fixture',
            mode: compatible.os === 'windows' ? 0o644 : 0o755,
          },
        ],
        [incompatibleName]: [
          {
            name: incompatible.os === 'windows' ? 'fixture.exe' : 'fixture',
            mode: incompatible.os === 'windows' ? 0o644 : 0o755,
          },
        ],
      };
      writeRelease(cwd, archives);
      const calls: RunnerCall[] = [];
      const options: GoReleaseOptions = {
        ...baseOptions(cwd, fakeRunner(calls, { archives, output: 'prefix\nfixture 1.2.3\nsuffix\n' })),
        binaries: [
          {
            name: 'fixture',
            package: 'cmd/fixture',
            versionCommand: { args: ['version'], expectedOutput: 'fixture {version}', match: 'anchored' },
          },
        ],
        targets: [compatible, incompatible],
      };
      const result = await verifyGoRelease(options);
      const captures = calls.filter((call) => call.executable !== '/controlled/tar');
      expect(captures).toHaveLength(1);
      expect(captures[0]).toMatchObject({ args: ['version'], options: { timeoutMs: 1234, maxOutputBytes: 5678 } });
      expect(result.artifacts.map((artifact) => artifact.versionChecks)).toEqual([['fixture'], []]);
      expect(temporaryEntries(cwd)).toEqual([]);

      await expect(
        verifyGoRelease({
          ...options,
          runner: fakeRunner([], { archives, output: 'wrong' }),
          binaries: [{ name: 'fixture', package: 'cmd/fixture', versionCommand: { expectedOutput: 'fixture 1.2.3' } }],
        }),
      ).rejects.toThrow(/Version output mismatch/u);
      expect(temporaryEntries(cwd)).toEqual([]);
    });
  });
});
