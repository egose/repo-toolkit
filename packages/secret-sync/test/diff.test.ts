import { describe, expect, it } from 'vitest';

import { diffCommits, diffSnapshots, summarizeDiff } from '../src/diff';
import { SecretSyncError } from '../src/errors';
import { createCommitRecord, sha256Hex, type CommitEnvelope } from '../src/records';
import type { FileFingerprint, LocalSlot } from '../src/status';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';

function testUuid(tag: number): string {
  const tail = tag.toString(16).padStart(12, '0');
  return `66666666-6666-4666-8666-${tail}`;
}

const CONTENT_A = 'diff-content-alpha-canary-d1';
const CONTENT_B = 'diff-content-beta-canary-d2';

function fp(content: string, blobTag?: number): FileFingerprint {
  const bytes = Buffer.from(content, 'utf8');
  const fingerprint: FileFingerprint = { sha256: sha256Hex(bytes), byteLength: bytes.byteLength };
  if (blobTag !== undefined) {
    fingerprint.blobId = testUuid(blobTag);
  }
  return fingerprint;
}

function localSlot(content: string, blobTag?: number): LocalSlot {
  return { state: 'present', fingerprint: fp(content, blobTag) };
}

function commitWith(files: Array<{ path: string; content: string; blobTag: number }>, tag: number): CommitEnvelope {
  return createCommitRecord({
    projectId: PROJECT_ID,
    branch: 'main',
    parents: [],
    tree: files.map((file) => ({
      path: file.path,
      blobId: testUuid(file.blobTag),
      sha256: sha256Hex(Buffer.from(file.content, 'utf8')),
      byteLength: Buffer.from(file.content, 'utf8').byteLength,
    })),
    timestamp: 1000 + tag,
    operationId: testUuid(800 + tag),
    operationKind: 'push',
    logicalId: testUuid(tag),
  }).envelope;
}

function scanForBytes(value: unknown): boolean {
  if (value instanceof Uint8Array) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => scanForBytes(entry));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).some((entry) => scanForBytes(entry));
  }
  return false;
}

describe('snapshot diff', () => {
  it('marks identical concurrent content unchanged while keeping both ids', () => {
    const entries = diffSnapshots(
      new Map<string, LocalSlot>([['.env', localSlot(CONTENT_A, 11)]]),
      new Map<string, LocalSlot>([['.env', localSlot(CONTENT_A, 12)]]),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ path: '.env', changed: false });
    expect(entries[0]?.localBlobId).toBe(testUuid(11));
    expect(entries[0]?.remoteBlobId).toBe(testUuid(12));
  });

  it('reports changed lengths and ids for modified files', () => {
    const entries = diffSnapshots(
      new Map<string, LocalSlot>([['.env', localSlot(CONTENT_A)]]),
      new Map<string, LocalSlot>([['.env', localSlot(CONTENT_B, 21)]]),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.changed).toBe(true);
    expect(entries[0]?.localByteLength).toBe(Buffer.byteLength(CONTENT_A));
    expect(entries[0]?.remoteByteLength).toBe(Buffer.byteLength(CONTENT_B));
    expect(entries[0]?.remoteBlobId).toBe(testUuid(21));
  });

  it('covers added deleted and unchanged paths in sorted order', () => {
    const entries = diffSnapshots(
      new Map<string, LocalSlot>([
        ['b.env', localSlot(CONTENT_A, 31)],
        ['a.env', localSlot(CONTENT_A, 32)],
        ['gone.env', { state: 'absent' }],
      ]),
      new Map<string, LocalSlot>([
        ['b.env', localSlot(CONTENT_B, 33)],
        ['a.env', localSlot(CONTENT_A, 34)],
        ['gone.env', localSlot(CONTENT_A, 35)],
      ]),
    );
    expect(entries.map((entry) => [entry.path, entry.changed])).toEqual([
      ['a.env', false],
      ['b.env', true],
      ['gone.env', true],
    ]);
    const added = diffSnapshots(
      new Map<string, LocalSlot>([['new.env', localSlot(CONTENT_A)]]),
      new Map<string, LocalSlot>(),
    );
    expect(added[0]).toMatchObject({ path: 'new.env', changed: true });
    expect(added[0]?.remoteByteLength).toBeUndefined();
  });

  it('honors exact-path selection and zero matches', () => {
    const locals = new Map<string, LocalSlot>([
      ['.env', localSlot(CONTENT_A)],
      ['other.env', localSlot(CONTENT_B)],
    ]);
    const remotes = new Map<string, LocalSlot>();
    expect(diffSnapshots(locals, remotes, ['.env']).map((entry) => entry.path)).toEqual(['.env']);
    expect(diffSnapshots(locals, remotes, [])).toEqual([]);
    expect(diffSnapshots(new Map(), new Map())).toEqual([]);
  });

  it('refuses to render permission errors as unchanged', () => {
    const locals = new Map<string, LocalSlot>([['.env', { state: 'error', code: 'auth', message: 'Denied.' }]]);
    expect(() => diffSnapshots(locals, new Map())).toThrowError(SecretSyncError);
  });

  it('summarizes changed and unchanged counts', () => {
    const entries = diffSnapshots(
      new Map<string, LocalSlot>([
        ['same.env', localSlot(CONTENT_A, 41)],
        ['diff.env', localSlot(CONTENT_A)],
      ]),
      new Map<string, LocalSlot>([
        ['same.env', localSlot(CONTENT_A, 42)],
        ['diff.env', localSlot(CONTENT_B, 43)],
      ]),
    );
    expect(summarizeDiff(entries)).toEqual({ total: 2, changed: 1, unchanged: 1 });
    expect(summarizeDiff([])).toEqual({ total: 0, changed: 0, unchanged: 0 });
  });
});

describe('revision diff', () => {
  it('compares two commit trees with metadata only', () => {
    const left = commitWith(
      [
        { path: '.env', content: CONTENT_A, blobTag: 51 },
        { path: 'keep.env', content: CONTENT_A, blobTag: 52 },
        { path: 'old.env', content: CONTENT_A, blobTag: 53 },
      ],
      5,
    );
    const right = commitWith(
      [
        { path: '.env', content: CONTENT_B, blobTag: 54 },
        { path: 'keep.env', content: CONTENT_A, blobTag: 55 },
        { path: 'new.env', content: CONTENT_A, blobTag: 56 },
      ],
      6,
    );
    const entries = diffCommits(left, right);
    expect(entries.map((entry) => [entry.path, entry.changed])).toEqual([
      ['.env', true],
      ['keep.env', false],
      ['new.env', true],
      ['old.env', true],
    ]);
    expect(entries.find((entry) => entry.path === 'keep.env')?.localBlobId).toBe(testUuid(52));
    expect(entries.find((entry) => entry.path === 'keep.env')?.remoteBlobId).toBe(testUuid(55));
  });

  it('reports identical revisions as fully unchanged', () => {
    const left = commitWith([{ path: '.env', content: CONTENT_A, blobTag: 61 }], 7);
    const right = commitWith([{ path: '.env', content: CONTENT_A, blobTag: 62 }], 8);
    const entries = diffCommits(left, right);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.changed).toBe(false);
  });
});

describe('metadata-only output', () => {
  it('never emits plaintext bytes or buffers', () => {
    const entries = diffSnapshots(
      new Map<string, LocalSlot>([['.env', localSlot(CONTENT_A, 71)]]),
      new Map<string, LocalSlot>([['.env', localSlot(CONTENT_B, 72)]]),
    );
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain(CONTENT_A);
    expect(serialized).not.toContain(CONTENT_B);
    expect(serialized).toContain('.env');
    expect(serialized).toContain(testUuid(71));
    expect(serialized).toContain(testUuid(72));
    expect(scanForBytes(entries)).toBe(false);
    const revisions = diffCommits(
      commitWith([{ path: '.env', content: CONTENT_A, blobTag: 73 }], 9),
      commitWith([{ path: '.env', content: CONTENT_B, blobTag: 74 }], 10),
    );
    expect(JSON.stringify(revisions)).not.toContain(CONTENT_A);
    expect(scanForBytes(revisions)).toBe(false);
  });
});
