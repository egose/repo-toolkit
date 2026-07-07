import { Readable } from 'node:stream';
import { rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.hoisted` runs before `vi.mock` factories are evaluated, so the stub
// instance and call-trackers are defined by the time the factories execute.
const stubs = vi.hoisted(() => {
  // Trackers are mutated by the stub instance; tests read them via the helpers
  // exported below.
  const optionsCalls: unknown[] = [];
  const loadPresetCalls: unknown[] = [];
  const configCalls: unknown[] = [];
  const factoryCalls: unknown[] = [];

  // The preset factory stub. Tests reset `factoryCalls` in `beforeEach`.
  const factory = vi.fn(async (options: unknown) => {
    factoryCalls.push(options);
    return {
      name: 'conventionalcommits',
      tags: ['v0.0.0'],
      commits: [],
      parser: { headerPattern: /.*/ },
      writer: { finalizeContext: () => undefined },
    };
  });

  // The `ConventionalChangelog` instance stub. Methods chain by returning the
  // same instance, so the pipeline reads back the configured values.
  let instance: Record<string, (...args: unknown[]) => unknown> | null = null;

  const ConventionalChangelog = vi.fn(function (this: unknown) {
    instance = {
      readPackage: () => instance,
      loadPreset: (preset: unknown) => {
        loadPresetCalls.push(preset);
        return instance;
      },
      options: (opts: unknown) => {
        optionsCalls.push(opts);
        return instance;
      },
      config: (cfg: unknown) => {
        configCalls.push(cfg);
        return instance;
      },
      writeStream: () => Readable.from(['# stub changelog\n']),
    };
    return instance;
  });

  return {
    factory,
    ConventionalChangelog,
    factoryCalls,
    optionsCalls,
    loadPresetCalls,
    configCalls,
  };
});

vi.mock('conventional-changelog-conventionalcommits', () => ({ default: stubs.factory }));
vi.mock('conventional-changelog', () => ({ ConventionalChangelog: stubs.ConventionalChangelog }));

// Import AFTER mocks are registered.
import {
  createPreset,
  createGenerator,
  generateChangelog,
  DEFAULT_TYPES,
  type ChangelogType,
  type CreatePresetOptions,
} from '../src/index';

beforeEach(() => {
  stubs.factory.mockClear();
  stubs.ConventionalChangelog.mockClear();
  stubs.factoryCalls.length = 0;
  stubs.optionsCalls.length = 0;
  stubs.loadPresetCalls.length = 0;
  stubs.configCalls.length = 0;
});

describe('DEFAULT_TYPES', () => {
  it('includes the visible sections used by the README default-sections table', () => {
    const sections = DEFAULT_TYPES.filter((t) => t.section).map((t) => [t.type, t.section, t.scope]);
    expect(sections).toEqual([
      ['feat', 'Features', undefined],
      ['fix', 'Bug Fixes', undefined],
      ['docs', 'Docs', undefined],
      ['refactor', 'Refactors', undefined],
      ['e2e', 'End-to-end Testing', undefined],
    ]);
  });

  it('hides fix(deps), chore, style, perf, and test by default', () => {
    const hidden = DEFAULT_TYPES.filter((t) => t.effect === 'hidden').map((t) => [t.type, t.scope]);
    expect(hidden).toEqual([
      ['fix', 'deps'],
      ['chore', undefined],
      ['style', undefined],
      ['perf', undefined],
      ['test', undefined],
    ]);
  });
});

describe('createPreset', () => {
  it('returns a preset tagged with the conventionalcommits name', async () => {
    const preset = await createPreset();
    expect(preset).toMatchObject({ name: 'conventionalcommits' });
    expect(preset).toHaveProperty('parser');
    expect(preset).toHaveProperty('writer');
    expect(preset).toHaveProperty('tags');
    expect(preset).toHaveProperty('commits');
  });

  it('passes DEFAULT_TYPES through when no types are supplied', async () => {
    await createPreset();
    const passed = stubs.factoryCalls[0] as { types: ChangelogType[] };
    expect(passed.types).toHaveLength(DEFAULT_TYPES.length);
  });

  it('honours caller-supplied types and normalizes effect=hidden to hidden=true', async () => {
    const customTypes: ChangelogType[] = [
      { type: 'feat', section: 'Features' },
      { type: 'internal', effect: 'hidden' },
    ];

    await createPreset({ types: customTypes });

    const passed = stubs.factoryCalls[0] as { types: ChangelogType[] };
    expect(passed.types).toEqual([
      { type: 'feat', section: 'Features', hidden: undefined },
      { type: 'internal', effect: 'hidden', hidden: true },
    ]);
  });

  it('forwards non-types options verbatim', async () => {
    const opts: CreatePresetOptions = {
      issuePrefixes: ['#', 'WEB-'],
      scope: 'api',
      scopeOnly: true,
      preMajor: true,
    };

    await createPreset(opts);

    const passed = stubs.factoryCalls[0] as Record<string, unknown>;
    expect(passed.issuePrefixes).toEqual(['#', 'WEB-']);
    expect(passed.scope).toBe('api');
    expect(passed.scopeOnly).toBe(true);
    expect(passed.preMajor).toBe(true);
  });
});

describe('createGenerator', () => {
  it('returns a ConventionalChangelog instance', async () => {
    const generator = await createGenerator();
    expect(stubs.ConventionalChangelog).toHaveBeenCalledOnce();
    expect(generator).toBeTypeOf('object');
  });

  it('applies default pipeline options', async () => {
    await createGenerator();

    expect(stubs.loadPresetCalls).toHaveLength(1);
    expect(stubs.loadPresetCalls[0]).toMatchObject({ name: 'conventionalcommits' });

    const opts = stubs.optionsCalls[0] as Record<string, unknown>;
    expect(opts).toEqual({
      append: false,
      releaseCount: 0,
      skipUnstable: true,
      outputUnreleased: true,
      tagPrefix: 'v',
      firstRelease: false,
    });
  });

  it('respects caller-supplied pipeline option overrides', async () => {
    await createGenerator({
      append: true,
      releaseCount: 5,
      skipUnstable: false,
      outputUnreleased: false,
      tagPrefix: 'release-',
      firstRelease: true,
    });

    const opts = stubs.optionsCalls[0] as Record<string, unknown>;
    expect(opts).toEqual({
      append: true,
      releaseCount: 5,
      skipUnstable: false,
      outputUnreleased: false,
      tagPrefix: 'release-',
      firstRelease: true,
    });
  });

  it('strips pipeline-only options before forwarding preset options', async () => {
    await createGenerator({
      cwd: '/repo',
      outputFile: 'CHANGELOG.md',
      append: true,
      releaseCount: 1,
      skipUnstable: false,
      outputUnreleased: false,
      tagPrefix: 'v',
      firstRelease: false,
      issuePrefixes: ['#'],
    });

    const passed = stubs.factoryCalls[0] as Record<string, unknown>;
    // Pipeline-only keys must NOT leak into preset options.
    expect(passed).not.toHaveProperty('cwd');
    expect(passed).not.toHaveProperty('outputFile');
    expect(passed).not.toHaveProperty('append');
    expect(passed).not.toHaveProperty('releaseCount');
    expect(passed).not.toHaveProperty('skipUnstable');
    expect(passed).not.toHaveProperty('outputUnreleased');
    expect(passed).not.toHaveProperty('tagPrefix');
    expect(passed).not.toHaveProperty('firstRelease');
    // But preset-relevant options must pass through.
    expect(passed.issuePrefixes).toEqual(['#']);
  });
});

describe('generateChangelog', () => {
  const workDir = join(tmpdir(), `repo-toolkit-changelog-test-${process.pid}-${Date.now()}`);

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('writes the changelog to an absolute outputFile, creating parent dirs', async () => {
    const outputFile = join(workDir, 'nested', 'deep', 'CHANGELOG.md');

    const result = await generateChangelog({
      cwd: workDir,
      outputFile,
      // No git repo here; the stubbed generator emits a fixed line regardless.
    });

    expect(result).toBe(outputFile);
    expect(existsSync(outputFile)).toBe(true);
    const contents = await readFile(outputFile, 'utf8');
    expect(contents).toContain('# stub changelog');
  });

  it('resolves a relative outputFile against cwd', async () => {
    const outFile = 'sub/CHANGELOG.md';

    const result = await generateChangelog({
      cwd: workDir,
      outputFile: outFile,
    });

    expect(result).toBe(join(workDir, outFile));
    expect(existsSync(join(workDir, outFile))).toBe(true);
  });

  it('restores the original cwd even when the target cwd differs', async () => {
    const originalCwd = process.cwd();

    await generateChangelog({
      cwd: workDir,
      outputFile: 'CHANGELOG.md',
    });

    expect(process.cwd()).toBe(originalCwd);
  });

  it('defaults the output file to CHANGELOG.md in cwd', async () => {
    const result = await generateChangelog({ cwd: workDir });

    expect(result).toBe(join(workDir, 'CHANGELOG.md'));
    expect(existsSync(join(workDir, 'CHANGELOG.md'))).toBe(true);
  });
});
