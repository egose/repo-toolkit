import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../src/records';
import {
  buildStatusReport,
  collectStatusEntries,
  compareFile,
  evaluateCheck,
  resolveStatusSelection,
  summarizeHeads,
  type BaselineSlot,
  type FileFingerprint,
  type FileStatus,
  type LocalSlot,
} from '../src/status';

function testUuid(tag: number): string {
  const tail = tag.toString(16).padStart(12, '0');
  return `44444444-4444-4444-8444-${tail}`;
}

const CONTENT_A = 'status-content-alpha-canary-x1';
const CONTENT_B = 'status-content-beta-canary-x2';

function fp(content: string, blobTag?: number): FileFingerprint {
  const bytes = Buffer.from(content, 'utf8');
  const fingerprint: FileFingerprint = { sha256: sha256Hex(bytes), byteLength: bytes.byteLength };
  if (blobTag !== undefined) {
    fingerprint.blobId = testUuid(blobTag);
  }
  return fingerprint;
}

function baselineFor(label: 'unknown' | 'absent' | 'A'): BaselineSlot {
  if (label === 'unknown') {
    return { state: 'unknown' };
  }
  if (label === 'absent') {
    return { state: 'absent' };
  }
  return { state: 'present', fingerprint: fp(CONTENT_A, 11) };
}

function sideFor(label: 'absent' | 'A' | 'B', blobTag: number): LocalSlot {
  if (label === 'absent') {
    return { state: 'absent' };
  }
  return { state: 'present', fingerprint: fp(label === 'A' ? CONTENT_A : CONTENT_B, blobTag) };
}

type TableRow = {
  baseline: 'unknown' | 'absent' | 'A';
  local: 'absent' | 'A' | 'B';
  remote: 'absent' | 'A' | 'B';
  expected: FileStatus;
};

const TABLE: TableRow[] = [
  { baseline: 'unknown', local: 'absent', remote: 'absent', expected: 'clean' },
  { baseline: 'unknown', local: 'absent', remote: 'A', expected: 'remote-added' },
  { baseline: 'unknown', local: 'absent', remote: 'B', expected: 'remote-added' },
  { baseline: 'unknown', local: 'A', remote: 'absent', expected: 'local-added' },
  { baseline: 'unknown', local: 'A', remote: 'A', expected: 'clean' },
  { baseline: 'unknown', local: 'A', remote: 'B', expected: 'unbased-conflict' },
  { baseline: 'unknown', local: 'B', remote: 'absent', expected: 'local-added' },
  { baseline: 'unknown', local: 'B', remote: 'A', expected: 'unbased-conflict' },
  { baseline: 'unknown', local: 'B', remote: 'B', expected: 'clean' },
  { baseline: 'absent', local: 'absent', remote: 'absent', expected: 'clean' },
  { baseline: 'absent', local: 'absent', remote: 'A', expected: 'remote-added' },
  { baseline: 'absent', local: 'absent', remote: 'B', expected: 'remote-added' },
  { baseline: 'absent', local: 'A', remote: 'absent', expected: 'local-added' },
  { baseline: 'absent', local: 'A', remote: 'A', expected: 'clean' },
  { baseline: 'absent', local: 'A', remote: 'B', expected: 'conflict' },
  { baseline: 'absent', local: 'B', remote: 'absent', expected: 'local-added' },
  { baseline: 'absent', local: 'B', remote: 'B', expected: 'clean' },
  { baseline: 'absent', local: 'B', remote: 'A', expected: 'conflict' },
  { baseline: 'A', local: 'absent', remote: 'absent', expected: 'clean' },
  { baseline: 'A', local: 'absent', remote: 'A', expected: 'local-deleted' },
  { baseline: 'A', local: 'absent', remote: 'B', expected: 'conflict' },
  { baseline: 'A', local: 'A', remote: 'absent', expected: 'remote-deleted' },
  { baseline: 'A', local: 'A', remote: 'A', expected: 'clean' },
  { baseline: 'A', local: 'A', remote: 'B', expected: 'remote-modified' },
  { baseline: 'A', local: 'B', remote: 'absent', expected: 'conflict' },
  { baseline: 'A', local: 'B', remote: 'A', expected: 'local-modified' },
  { baseline: 'A', local: 'B', remote: 'B', expected: 'clean' },
];

describe('three-way comparison table', () => {
  it.each(TABLE)('B=$baseline L=$local R=$remote resolves to $expected', (row) => {
    const status = compareFile(baselineFor(row.baseline), sideFor(row.local, 21), sideFor(row.remote, 31));
    expect(status).toBe(row.expected);
  });

  it('treats identical concurrent content as clean despite distinct blob ids', () => {
    const baseline: BaselineSlot = { state: 'present', fingerprint: fp(CONTENT_A, 41) };
    const local: LocalSlot = { state: 'present', fingerprint: fp(CONTENT_A, 42) };
    const remote: LocalSlot = { state: 'present', fingerprint: fp(CONTENT_A, 43) };
    expect(compareFile(baseline, local, remote)).toBe('clean');
  });

  it('keeps absent unknown and error distinct', () => {
    const baseline: BaselineSlot = { state: 'unknown' };
    const localError: LocalSlot = { state: 'error', code: 'auth', message: 'Denied.' };
    const remoteError: LocalSlot = { state: 'error', code: 'network', message: 'Unreachable.' };
    expect(compareFile(baseline, { state: 'absent' }, { state: 'absent' })).toBe('clean');
    expect(compareFile(baseline, localError, { state: 'absent' })).toBe('local-error');
    expect(compareFile(baseline, { state: 'absent' }, remoteError)).toBe('remote-error');
    expect(compareFile(baseline, localError, remoteError)).toBe('local-error');
  });
});

describe('status collection', () => {
  it('resolves a fresh clone as remote-added for every remote path', () => {
    const entries = collectStatusEntries({
      baselines: new Map(),
      locals: new Map(),
      remotes: new Map([
        ['.env', { state: 'present', fingerprint: fp(CONTENT_A, 51) }],
        ['secrets/app.json', { state: 'present', fingerprint: fp(CONTENT_B, 52) }],
      ]),
    });
    expect(entries.map((entry) => [entry.path, entry.status])).toEqual([
      ['.env', 'remote-added'],
      ['secrets/app.json', 'remote-added'],
    ]);
  });

  it('handles partial baselines without resetting unrelated paths', () => {
    const entries = collectStatusEntries({
      baselines: new Map<string, BaselineSlot>([['.env', { state: 'present', fingerprint: fp(CONTENT_A, 61) }]]),
      locals: new Map<string, LocalSlot>([
        ['.env', { state: 'present', fingerprint: fp(CONTENT_A) }],
        ['new.env', { state: 'present', fingerprint: fp(CONTENT_B) }],
      ]),
      remotes: new Map<string, LocalSlot>([
        ['.env', { state: 'present', fingerprint: fp(CONTENT_A, 62) }],
        ['new.env', { state: 'absent' }],
      ]),
    });
    expect(entries.map((entry) => [entry.path, entry.status])).toEqual([
      ['.env', 'clean'],
      ['new.env', 'local-added'],
    ]);
  });

  it('returns an empty clean report for zero matches', () => {
    const report = buildStatusReport({
      branch: 'main',
      heads: [],
      baselines: new Map(),
      locals: new Map(),
      remotes: new Map(),
      selection: [],
    });
    expect(report.files).toEqual([]);
    expect(report.clean).toBe(true);
    expect(report.checkFailed).toBe(false);
    expect(evaluateCheck(report)).toBe(false);
  });

  it('applies exact-path selection without touching other paths', () => {
    const baselines = new Map<string, BaselineSlot>();
    const locals = new Map<string, LocalSlot>([
      ['.env', { state: 'present', fingerprint: fp(CONTENT_A) }],
      ['other.env', { state: 'present', fingerprint: fp(CONTENT_B) }],
    ]);
    const remotes = new Map<string, LocalSlot>();
    const entries = collectStatusEntries({ baselines, locals, remotes, selection: ['.env'] });
    expect(entries.map((entry) => entry.path)).toEqual(['.env']);
    expect(entries[0]?.status).toBe('local-added');
  });

  it('rejects unsafe selection paths', () => {
    expect(() => resolveStatusSelection(['.env'], ['../escape'])).toThrow();
  });

  it('surfaces permission errors instead of an empty tree', () => {
    const report = buildStatusReport({
      branch: 'main',
      heads: ['11111111-1111-4111-8111-000000000001'],
      baselines: new Map(),
      locals: new Map<string, LocalSlot>([['.env', { state: 'error', code: 'auth', message: 'Denied.' }]]),
      remotes: new Map(),
    });
    expect(report.files[0]?.status).toBe('local-error');
    expect(report.hasError).toBe(true);
    expect(report.checkFailed).toBe(true);
    expect(report.counts['local-error']).toBe(1);
  });

  it('is read-only and leaves every snapshot untouched', () => {
    const baselines = new Map<string, BaselineSlot>([['.env', { state: 'present', fingerprint: fp(CONTENT_A, 71) }]]);
    const locals = new Map<string, LocalSlot>([['.env', { state: 'present', fingerprint: fp(CONTENT_B) }]]);
    const remotes = new Map<string, LocalSlot>([['.env', { state: 'present', fingerprint: fp(CONTENT_A, 72) }]]);
    const before = JSON.stringify({
      baselines: [...baselines],
      locals: [...locals],
      remotes: [...remotes],
    });
    buildStatusReport({ branch: 'main', heads: [], baselines, locals, remotes });
    const after = JSON.stringify({
      baselines: [...baselines],
      locals: [...locals],
      remotes: [...remotes],
    });
    expect(after).toBe(before);
  });

  it('exposes metadata only without plaintext bytes', () => {
    const entries = collectStatusEntries({
      baselines: new Map(),
      locals: new Map<string, LocalSlot>([['.env', { state: 'present', fingerprint: fp(CONTENT_A) }]]),
      remotes: new Map(),
    });
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(CONTENT_A);
    expect(serialized).toContain('.env');
  });
});

describe('branch and head summary', () => {
  it('reports empty single and diverged head states', () => {
    expect(summarizeHeads('main', []).state).toBe('empty');
    expect(summarizeHeads('main', ['b']).state).toBe('single');
    const diverged = summarizeHeads('main', ['b', 'a']);
    expect(diverged.state).toBe('diverged');
    expect(diverged.heads).toEqual(['a', 'b']);
  });

  it('flags divergence and conflicts in check mode', () => {
    const report = buildStatusReport({
      branch: 'main',
      heads: ['a', 'b'],
      baselines: new Map(),
      locals: new Map(),
      remotes: new Map(),
    });
    expect(report.diverged).toBe(true);
    expect(report.checkFailed).toBe(true);
  });

  it('tracks current and previous materialized branches', () => {
    const current = buildStatusReport({
      branch: 'main',
      heads: [],
      baselines: new Map(),
      locals: new Map(),
      remotes: new Map(),
      materializedBranch: 'main',
    });
    expect(current.switched).toBe(false);
    const previous = buildStatusReport({
      branch: 'feature/demo',
      heads: [],
      baselines: new Map(),
      locals: new Map(),
      remotes: new Map(),
      activeBranch: 'feature/demo',
      materializedBranch: 'main',
    });
    expect(previous.switched).toBe(true);
    expect(previous.materializedBranch).toBe('main');
    expect(previous.activeBranch).toBe('feature/demo');
  });

  it('counts every status for the branch summary', () => {
    const report = buildStatusReport({
      branch: 'main',
      heads: ['h'],
      baselines: new Map<string, BaselineSlot>([
        ['clean.env', { state: 'present', fingerprint: fp(CONTENT_A, 81) }],
        ['local.env', { state: 'present', fingerprint: fp(CONTENT_A, 82) }],
        ['remote.env', { state: 'present', fingerprint: fp(CONTENT_A, 83) }],
        ['gone.env', { state: 'present', fingerprint: fp(CONTENT_A, 84) }],
      ]),
      locals: new Map<string, LocalSlot>([
        ['clean.env', { state: 'present', fingerprint: fp(CONTENT_A) }],
        ['local.env', { state: 'present', fingerprint: fp(CONTENT_B) }],
        ['remote.env', { state: 'present', fingerprint: fp(CONTENT_A) }],
        ['gone.env', { state: 'absent' }],
      ]),
      remotes: new Map<string, LocalSlot>([
        ['clean.env', { state: 'present', fingerprint: fp(CONTENT_A, 85) }],
        ['local.env', { state: 'present', fingerprint: fp(CONTENT_A, 86) }],
        ['remote.env', { state: 'present', fingerprint: fp(CONTENT_B, 87) }],
        ['gone.env', { state: 'present', fingerprint: fp(CONTENT_A, 88) }],
      ]),
    });
    expect(report.counts.clean).toBe(1);
    expect(report.counts['local-modified']).toBe(1);
    expect(report.counts['remote-modified']).toBe(1);
    expect(report.counts['local-deleted']).toBe(1);
    expect(report.clean).toBe(false);
    expect(report.checkFailed).toBe(true);
  });
});
