import { Readable } from 'node:stream';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
  const tagsCalls: unknown[] = [];
  const configCalls: unknown[] = [];
  const factoryCalls: unknown[] = [];
  let writeStreamImpl: () => Readable = () => Readable.from(['# stub changelog\n']);

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
      tags: (opts: unknown) => {
        tagsCalls.push(opts);
        return instance;
      },
      config: (cfg: unknown) => {
        configCalls.push(cfg);
        return instance;
      },
      writeStream: () => writeStreamImpl(),
    };
    return instance;
  });

  return {
    factory,
    ConventionalChangelog,
    factoryCalls,
    optionsCalls,
    loadPresetCalls,
    tagsCalls,
    configCalls,
    setWriteStreamImpl: (next: () => Readable) => {
      writeStreamImpl = next;
    },
    resetWriteStreamImpl: () => {
      writeStreamImpl = () => Readable.from(['# stub changelog\n']);
    },
  };
});

vi.mock('conventional-changelog-conventionalcommits', () => ({ default: stubs.factory }));
vi.mock('conventional-changelog', () => ({ ConventionalChangelog: stubs.ConventionalChangelog }));

// Import AFTER mocks are registered.
import {
  createPreset,
  createGenerator,
  generateChangelog,
  getDefaultTypes,
  DEFAULT_TYPES,
  type ChangelogType,
  type CreatePresetOptions,
  type GenerateChangelogOptions,
} from '../src/index';
import { resolveGenerateChangelogCliOptions } from '../src/cli';

beforeEach(() => {
  stubs.factory.mockClear();
  stubs.ConventionalChangelog.mockClear();
  stubs.factoryCalls.length = 0;
  stubs.optionsCalls.length = 0;
  stubs.loadPresetCalls.length = 0;
  stubs.tagsCalls.length = 0;
  stubs.configCalls.length = 0;
  stubs.resetWriteStreamImpl();
});

describe('DEFAULT_TYPES', () => {
  it('surfaces the visible sections in dependency-aware order', () => {
    const sections = DEFAULT_TYPES.filter((t) => t.section).map((t) => [t.type, t.section, t.scope]);
    expect(sections).toEqual([
      ['feat', 'Features', undefined],
      ['fix', 'Bug Fixes', undefined],
      ['revert', 'Reverts', undefined],
      ['docs', 'Documentation', undefined],
      ['refactor', 'Code Refactoring', undefined],
      ['perf', 'Performance Improvements', undefined],
      ['build', 'Build System', undefined],
      ['e2e', 'End-to-end Testing', undefined],
    ]);
  });

  it('hides fix(deps), ci, chore, style, test, and release by default', () => {
    const hidden = DEFAULT_TYPES.filter((t) => t.effect === 'hidden').map((t) => [t.type, t.scope]);
    expect(hidden).toEqual([
      ['fix', 'deps'],
      ['ci', undefined],
      ['chore', undefined],
      ['style', undefined],
      ['test', undefined],
      ['release', undefined],
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
      issueUrlFormat: '{{host}}/{{owner}}/{{repository}}/issues/{{id}}',
      bumpStrict: true,
    };

    await createPreset(opts);

    const passed = stubs.factoryCalls[0] as Record<string, unknown>;
    expect(passed.issuePrefixes).toEqual(['#', 'WEB-']);
    expect(passed.scope).toBe('api');
    expect(passed.scopeOnly).toBe(true);
    expect(passed.preMajor).toBe(true);
    expect(passed.issueUrlFormat).toBe('{{host}}/{{owner}}/{{repository}}/issues/{{id}}');
    expect(passed.bumpStrict).toBe(true);
  });
});

describe('createGenerator', () => {
  it('returns a ConventionalChangelog instance', async () => {
    const generator = await createGenerator();
    expect(stubs.ConventionalChangelog).toHaveBeenCalledOnce();
    expect(generator).toBeTypeOf('object');
  });

  it('constructs ConventionalChangelog with the resolved cwd', async () => {
    await createGenerator({ cwd: '/repo' });

    expect(stubs.ConventionalChangelog).toHaveBeenCalledWith('/repo');
  });

  it('applies default pipeline options', async () => {
    await createGenerator();

    expect(stubs.loadPresetCalls).toHaveLength(1);
    expect(stubs.loadPresetCalls[0]).toMatchObject({ name: 'conventionalcommits' });

    const opts = stubs.optionsCalls[0] as Record<string, unknown>;
    expect(opts).toEqual({
      append: false,
      outputUnreleased: true,
    });

    expect(stubs.tagsCalls[0]).toEqual({
      prefix: 'v',
      skipUnstable: true,
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
      releaseCount: 0,
      outputUnreleased: false,
    });

    expect(stubs.tagsCalls[0]).toEqual({
      prefix: 'release-',
      skipUnstable: false,
    });
  });

  it('rejects invalid release counts before generator setup', async () => {
    await expect(createGenerator({ releaseCount: -1 })).rejects.toThrowError(/non-negative safe integer/);
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

  beforeEach(async () => {
    await mkdir(workDir, { recursive: true });
  });

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

  it('prepends generated content ahead of the existing file by default', async () => {
    const outputFile = join(workDir, 'CHANGELOG.md');
    await writeFile(outputFile, 'OLD\n\n');

    await generateChangelog({ cwd: workDir, outputFile });

    const contents = await readFile(outputFile, 'utf8');
    expect(contents).toBe('# stub changelog\n\nOLD\n');
  });

  it('appends generated content after the existing file when append is true', async () => {
    const outputFile = join(workDir, 'CHANGELOG.md');
    await writeFile(outputFile, 'OLD\n\n');

    await generateChangelog({ cwd: workDir, outputFile, append: true });

    const contents = await readFile(outputFile, 'utf8');
    expect(contents).toBe('OLD\n\n# stub changelog\n');
  });

  it('removes excess blank lines when combining generated and existing content', async () => {
    const outputFile = join(workDir, 'CHANGELOG.md');
    stubs.setWriteStreamImpl(() => Readable.from(['NEW\n\n\n']));
    await writeFile(outputFile, 'OLD\n\n\n');

    await generateChangelog({ cwd: workDir, outputFile });

    const contents = await readFile(outputFile, 'utf8');
    expect(contents).toBe('NEW\n\nOLD\n');
  });

  it('leaves the original file unchanged and removes temp files when the generator fails', async () => {
    const outputFile = join(workDir, 'CHANGELOG.md');
    await writeFile(outputFile, 'OLD\n');
    stubs.setWriteStreamImpl(
      () =>
        new Readable({
          read() {
            this.destroy(new Error('generator failed'));
          },
        }),
    );

    await expect(generateChangelog({ cwd: workDir, outputFile })).rejects.toThrowError(/generator failed/);
    await expect(readFile(outputFile, 'utf8')).resolves.toBe('OLD\n');
    const entries = await readdir(workDir);
    expect(entries.some((entry) => entry.endsWith('.tmp'))).toBe(false);
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

describe('resolveGenerateChangelogCliOptions', () => {
  it('preserves an explicit empty tag prefix', () => {
    const options = resolveGenerateChangelogCliOptions({
      values: { 'tag-prefix': '' },
      repeat: {},
      unknown: [],
    });

    expect(options.tagPrefix).toBe('');
  });

  it('rejects invalid release-count values', () => {
    expect(() =>
      resolveGenerateChangelogCliOptions({
        values: { 'release-count': '-1' },
        repeat: {},
        unknown: [],
      }),
    ).toThrowError(/Invalid numeric value/);
  });
});

describe('DEFAULT_TYPES immutability (CLARC-02)', () => {
  it('is deeply frozen and rejects mutation of nested entries', () => {
    expect(Object.isFrozen(DEFAULT_TYPES)).toBe(true);

    for (const entry of DEFAULT_TYPES) {
      expect(Object.isFrozen(entry)).toBe(true);
    }
  });

  it('mutation attempts throw in strict mode and do not corrupt later calls', () => {
    'use strict';
    expect(() => {
      (DEFAULT_TYPES[0] as ChangelogType).type = 'tampered';
    }).toThrow();

    expect(DEFAULT_TYPES[0].type).toBe('feat');

    return createPreset().then(() => {
      const passed = stubs.factoryCalls[0] as { types: ChangelogType[] };
      expect(passed.types[0].type).toBe('feat');
    });
  });

  it('exposes a getDefaultTypes() accessor that returns the same frozen source', () => {
    expect(getDefaultTypes()).toBe(DEFAULT_TYPES);
    expect(Object.isFrozen(getDefaultTypes())).toBe(true);
  });

  it('consumer-supplied types cannot mutate DEFAULT_TYPES through normalizeTypes', async () => {
    const custom: ChangelogType[] = [{ type: 'feat', section: 'Features' }];
    await createPreset({ types: custom });

    // DEFAULT_TYPES entries must remain untouched even though the caller
    // supplied their own array.
    expect(DEFAULT_TYPES.find((t) => t.type === 'revert')?.section).toBe('Reverts');
  });
});

describe('runtime config validation (CLARC-02)', () => {
  it('rejects unknown top-level config keys', async () => {
    await expect(createPreset({ bogus: true } as unknown as CreatePresetOptions)).rejects.toThrowError(
      /Unknown changelog config option: bogus/,
    );
  });

  it('rejects non-RegExp ignoreCommits', async () => {
    await expect(createPreset({ ignoreCommits: 'not-a-regex' } as unknown as CreatePresetOptions)).rejects.toThrowError(
      /ignoreCommits must be a RegExp/,
    );
  });

  it('accepts a RegExp ignoreCommits', async () => {
    await expect(createPreset({ ignoreCommits: /^chore: release/ })).resolves.toMatchObject({
      name: 'conventionalcommits',
    });
  });

  it('rejects non-array types', async () => {
    await expect(createPreset({ types: 'nope' } as unknown as CreatePresetOptions)).rejects.toThrowError(
      /types must be an array/,
    );
  });

  it('rejects type entries missing a type field', async () => {
    await expect(
      createPreset({ types: [{ section: 'Features' }] } as unknown as CreatePresetOptions),
    ).rejects.toThrowError(/types\[0\]\.type must be a non-empty string/);
  });

  it('rejects an empty type field', async () => {
    await expect(createPreset({ types: [{ type: '' }] } as unknown as CreatePresetOptions)).rejects.toThrowError(
      /types\[0\]\.type must be a non-empty string/,
    );
  });

  it('rejects an unsupported effect value', async () => {
    await expect(
      createPreset({ types: [{ type: 'feat', effect: 'bump' }] } as unknown as CreatePresetOptions),
    ).rejects.toThrowError(/types\[0\]\.effect must be 'hidden'/);
  });

  it('rejects a non-boolean hidden flag', async () => {
    await expect(
      createPreset({ types: [{ type: 'feat', hidden: 'yes' }] } as unknown as CreatePresetOptions),
    ).rejects.toThrowError(/types\[0\]\.hidden must be a boolean/);
  });

  it('rejects an unknown field on a type entry', async () => {
    await expect(
      createPreset({ types: [{ type: 'feat', extra: 1 }] } as unknown as CreatePresetOptions),
    ).rejects.toThrowError(/types\[0\] has unknown field: extra/);
  });

  it('rejects non-string issuePrefixes entries', async () => {
    await expect(createPreset({ issuePrefixes: ['#', 5] } as unknown as CreatePresetOptions)).rejects.toThrowError(
      /issuePrefixes\[1\] must be a string/,
    );
  });

  it('rejects a non-array scope', async () => {
    await expect(createPreset({ scope: 42 } as unknown as CreatePresetOptions)).rejects.toThrowError(
      /scope must be a string or an array of strings/,
    );
  });

  it('rejects a non-string entry in a scope array', async () => {
    await expect(createPreset({ scope: ['api', 9] } as unknown as CreatePresetOptions)).rejects.toThrowError(
      /scope\[1\] must be a string/,
    );
  });

  it('rejects non-boolean scopeOnly', async () => {
    await expect(createPreset({ scopeOnly: 'yes' } as unknown as CreatePresetOptions)).rejects.toThrowError(
      /scopeOnly must be a boolean/,
    );
  });

  it('rejects non-boolean preMajor', async () => {
    await expect(createPreset({ preMajor: 'yes' } as unknown as CreatePresetOptions)).rejects.toThrowError(
      /preMajor must be a boolean/,
    );
  });

  it('rejects a non-string URL format option', async () => {
    await expect(createPreset({ issueUrlFormat: 42 } as unknown as CreatePresetOptions)).rejects.toThrowError(
      /issueUrlFormat must be a string/,
    );
  });

  it('rejects non-boolean bumpStrict', async () => {
    await expect(createPreset({ bumpStrict: 'yes' } as unknown as CreatePresetOptions)).rejects.toThrowError(
      /bumpStrict must be a boolean/,
    );
  });

  it('createGenerator validates the pipeline options and the preset options together', async () => {
    await expect(createGenerator({ cwd: '/repo', releaseCount: -1 })).rejects.toThrowError(
      /releaseCount must be a non-negative safe integer/,
    );

    await expect(
      createGenerator({ cwd: '/repo', bogus: true } as unknown as GenerateChangelogOptions),
    ).rejects.toThrowError(/Unknown changelog config option: bogus/);
  });
});
