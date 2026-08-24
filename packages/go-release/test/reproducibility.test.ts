import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import {
  verifyGoReleaseReproducibility,
  type GoReleaseOptions,
  type GoReleaseReproducibilityError,
  type GoReleaseRunner,
} from '../src/index';

interface FakeRunnerOptions {
  readonly changingBuilds?: boolean;
  readonly failFirstBuild?: boolean;
  readonly mutateCompletedRun?: (outputDir: string) => void;
}

interface FakeRunnerState {
  readonly buildTargets: string[];
  readonly outputDirs: string[];
}

function withFixture(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'go-release-reproducibility-'));
  mkdirSync(join(cwd, 'dist'));
  writeFileSync(join(cwd, 'dist', 'preserved.txt'), 'normal release output');
  return run(cwd).finally(() => rmSync(cwd, { recursive: true, force: true }));
}

function optionsFor(cwd: string, runner: GoReleaseRunner): GoReleaseOptions {
  return {
    cwd,
    toolName: 'fixture',
    version: '1.2.3',
    goExecutable: '/controlled/go',
    tarExecutable: '/controlled/tar',
    binaries: [{ name: 'fixture', package: 'cmd/fixture' }],
    targets: [
      { os: 'linux', arch: 'amd64' },
      { os: 'windows', arch: 'arm64' },
    ],
    processLimits: { concurrency: 1 },
    runner,
  };
}

function fakeRunner(options: FakeRunnerOptions = {}): { runner: GoReleaseRunner; state: FakeRunnerState } {
  const state: FakeRunnerState = { buildTargets: [], outputDirs: [] };
  let mutated = false;
  const runner: GoReleaseRunner = {
    run(_executable, args, runOptions) {
      if (args[0] === 'build') {
        if (options.failFirstBuild && state.buildTargets.length === 0) throw new Error('fake compiler failed');
        const output = args[args.indexOf('-o') + 1];
        if (!output) throw new Error('Missing fake compiler output');
        const target = `${runOptions.env?.GOOS}-${runOptions.env?.GOARCH}`;
        state.buildTargets.push(target);
        const runNumber = output.includes('.go-release-reproducibility-first-') ? 1 : 2;
        writeFileSync(output, options.changingBuilds ? `${target}:run-${runNumber}` : `${target}:stable`);
        return;
      }
      if (args[0] === '--extract') {
        const archivePath = args[args.indexOf('--file') + 1];
        const extractionRoot = args[args.indexOf('--directory') + 1];
        if (!archivePath || !extractionRoot) throw new Error('Invalid fake extraction arguments');
        extractTar(archivePath, extractionRoot);
        const outputDir = state.outputDirs.find((directory) => archivePath.startsWith(directory));
        if (outputDir?.includes('.go-release-reproducibility-second-') && !mutated) {
          mutated = true;
          options.mutateCompletedRun?.(outputDir);
        }
        return;
      }
      const tarPath = args[args.indexOf('--file') + 1];
      const memberIndex = args.indexOf('--');
      if (!tarPath || memberIndex < 0) throw new Error('Invalid fake archive arguments');
      const outputDir = dirname(tarPath);
      if (!state.outputDirs.includes(outputDir)) state.outputDirs.push(outputDir);
      const members = args.slice(memberIndex + 1).map((name) => ({
        name,
        contents: readFileSync(join(runOptions.cwd, ...name.split('/'))),
        mode: name.endsWith('.exe') ? 0o644 : 0o755,
      }));
      writeFileSync(tarPath, createTar(members));
    },
    capture() {
      return '';
    },
  };
  return { runner, state };
}

function createTar(members: ReadonlyArray<{ name: string; contents: Buffer; mode: number }>): Buffer {
  const blocks: Buffer[] = [];
  for (const member of members) {
    const header = Buffer.alloc(512);
    writeField(header, 0, 100, member.name);
    writeOctal(header, 100, 8, member.mode);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, member.contents.length);
    writeOctal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = '0'.charCodeAt(0);
    writeField(header, 257, 6, 'ustar');
    writeField(header, 263, 2, '00');
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
    header[154] = 0;
    header[155] = 32;
    blocks.push(header, member.contents, Buffer.alloc((512 - (member.contents.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function extractTar(archivePath: string, root: string): void {
  const contents = gunzipSync(readFileSync(archivePath));
  let offset = 0;
  while (offset + 512 <= contents.length && contents.subarray(offset, offset + 512).some((byte) => byte !== 0)) {
    const header = contents.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/u, '');
    const mode = Number.parseInt(header.subarray(100, 108).toString('ascii').replace(/\0.*$/u, '').trim(), 8);
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/u, '').trim(), 8);
    offset += 512;
    const path = join(root, ...name.split('/'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents.subarray(offset, offset + size));
    chmodSync(path, mode);
    offset += Math.ceil(size / 512) * 512;
  }
}

function writeField(buffer: Buffer, offset: number, length: number, value: string): void {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8');
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  buffer.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'ascii');
}

function temporaryRoots(cwd: string): ReadonlyArray<string> {
  return readdirSync(cwd).filter((name) => name.startsWith('.go-release-reproducibility-'));
}

describe('verifyGoReleaseReproducibility', () => {
  it('rebuilds and verifies the full plan in independent roots with structured evidence', async () => {
    await withFixture(async (cwd) => {
      const { runner, state } = fakeRunner();
      const result = await verifyGoReleaseReproducibility(optionsFor(cwd, runner));

      expect(result).toMatchObject({
        reproducible: true,
        targets: ['linux-amd64', 'windows-arm64'],
        expectedArchives: ['fixture-linux-amd64.tar.gz', 'fixture-windows-arm64.tar.gz'],
        missing: [],
        additional: [],
        different: [],
      });
      expect(result.runs[0].artifacts).toHaveLength(2);
      expect(result.runs[1].artifacts).toEqual(result.runs[0].artifacts);
      expect(state.buildTargets).toEqual(['linux-amd64', 'windows-arm64', 'linux-amd64', 'windows-arm64']);
      expect(new Set(state.outputDirs).size).toBe(2);
      expect(readFileSync(join(cwd, 'dist', 'preserved.txt'), 'utf8')).toBe('normal release output');
      expect(temporaryRoots(cwd)).toEqual([]);
    });
  });

  it('supports an explicit target subset without building other targets', async () => {
    await withFixture(async (cwd) => {
      const { runner, state } = fakeRunner();
      const result = await verifyGoReleaseReproducibility({
        ...optionsFor(cwd, runner),
        targetSubset: ['windows-arm64'],
      });

      expect(result.targets).toEqual(['windows-arm64']);
      expect(result.expectedArchives).toEqual(['fixture-windows-arm64.tar.gz']);
      expect(state.buildTargets).toEqual(['windows-arm64', 'windows-arm64']);
      expect(temporaryRoots(cwd)).toEqual([]);
    });
  });

  it('fails with the affected archive and exact size and SHA-256 evidence when bytes change', async () => {
    await withFixture(async (cwd) => {
      const { runner } = fakeRunner({ changingBuilds: true });
      let failure: unknown;
      try {
        await verifyGoReleaseReproducibility({ ...optionsFor(cwd, runner), targetSubset: ['linux-amd64'] });
      } catch (error) {
        failure = error;
      }

      const error = failure as GoReleaseReproducibilityError;
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('GoReleaseReproducibilityError');
      expect(error.message).toMatch(/different archive: fixture-linux-amd64\.tar\.gz.*SHA-256/u);
      expect(error.evidence.different).toEqual([
        expect.objectContaining({
          archiveName: 'fixture-linux-amd64.tar.gz',
          first: expect.objectContaining({
            size: expect.any(Number),
            checksum: expect.stringMatching(/^[0-9a-f]{64}$/u),
          }),
          second: expect.objectContaining({
            size: expect.any(Number),
            checksum: expect.stringMatching(/^[0-9a-f]{64}$/u),
          }),
        }),
      ]);
      expect(error.evidence.different[0].first.checksum).not.toBe(error.evidence.different[0].second.checksum);
      expect(temporaryRoots(cwd)).toEqual([]);
    });
  });

  it('reports missing and additional archives distinctly', async () => {
    await withFixture(async (cwd) => {
      const { runner } = fakeRunner({
        mutateCompletedRun(outputDir) {
          rmSync(join(outputDir, 'fixture-linux-amd64.tar.gz'));
          writeFileSync(join(outputDir, 'unexpected.tar.gz'), 'additional archive');
        },
      });
      let failure: unknown;
      try {
        await verifyGoReleaseReproducibility({ ...optionsFor(cwd, runner), targetSubset: ['linux-amd64'] });
      } catch (error) {
        failure = error;
      }

      const error = failure as GoReleaseReproducibilityError;
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('GoReleaseReproducibilityError');
      expect(error.message).toContain('missing from second run: fixture-linux-amd64.tar.gz');
      expect(error.message).toContain('additional in second run: unexpected.tar.gz');
      expect(error.evidence.missing).toEqual([{ run: 'second', archiveName: 'fixture-linux-amd64.tar.gz' }]);
      expect(error.evidence.additional).toEqual([{ run: 'second', archiveName: 'unexpected.tar.gz' }]);
      expect(error.evidence.different).toEqual([]);
      expect(temporaryRoots(cwd)).toEqual([]);
    });
  });

  it('preserves normal output and cleans both roots when the first build fails', async () => {
    await withFixture(async (cwd) => {
      const { runner } = fakeRunner({ failFirstBuild: true });

      await expect(verifyGoReleaseReproducibility(optionsFor(cwd, runner))).rejects.toThrow('fake compiler failed');
      expect(readdirSync(join(cwd, 'dist'))).toEqual(['preserved.txt']);
      expect(readFileSync(join(cwd, 'dist', 'preserved.txt'), 'utf8')).toBe('normal release output');
      expect(temporaryRoots(cwd)).toEqual([]);
    });
  });

  it('rejects empty, duplicate, and unknown target subsets before creating roots', async () => {
    await withFixture(async (cwd) => {
      const { runner } = fakeRunner();
      const base = optionsFor(cwd, runner);

      await expect(verifyGoReleaseReproducibility({ ...base, targetSubset: [] })).rejects.toThrow('nonempty array');
      await expect(
        verifyGoReleaseReproducibility({ ...base, targetSubset: ['linux-amd64', 'linux-amd64'] }),
      ).rejects.toThrow('Duplicate');
      await expect(verifyGoReleaseReproducibility({ ...base, targetSubset: ['plan9-amd64'] })).rejects.toThrow(
        'Unknown',
      );
      expect(temporaryRoots(cwd)).toEqual([]);
    });
  });
});
