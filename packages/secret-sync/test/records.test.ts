import { describe, expect, it } from 'vitest';

import { SecretSyncError } from '../src/errors';
import {
  MAX_RECORD_BYTES,
  RECORD_MARKER,
  buildCreateInput,
  buildRecordTitle,
  canonicalJson,
  createBlobRecord,
  createCommitRecord,
  decodeEnvelopeJson,
  decodeRecordEnvelope,
  deduplicateRecordDetails,
  parseRecordTitle,
  serializeCommitEnvelope,
} from '../src/records';
import type { ConnectItemDetail } from '../src/store';

const PROJECT_ID = 'a64208df-4a95-4516-b8c7-e00621a7820c';
const OTHER_PROJECT = 'b64208df-4a95-4516-b8c7-e00621a7820c';

function testUuid(tag: number): string {
  const tail = tag.toString(16).padStart(12, '0');
  return `11111111-1111-4111-8111-${tail}`;
}

function detailFor(
  serialized: string,
  projectId: string,
  kind: string,
  logicalId: string,
  providerId: string,
): ConnectItemDetail {
  return {
    id: providerId,
    title: buildRecordTitle(projectId, kind, logicalId),
    tags: [RECORD_MARKER, projectId, kind],
    category: 'SECURE_NOTE',
    fields: [
      { type: 'STRING', label: 'notesPlain', value: '' },
      { type: 'CONCEALED', label: 'payload', value: serialized },
    ],
  };
}

describe('blob envelope', () => {
  it('round-trips empty binary and multiline bytes with hash and length checks', () => {
    const payloads = [Buffer.from([]), Buffer.from([0, 255, 10, 13, 10]), Buffer.from('line1\nline2\r\nline3')];
    for (const bytes of payloads) {
      const record = createBlobRecord(PROJECT_ID, bytes, testUuid(bytes.byteLength + 101));
      const decoded = decodeRecordEnvelope(
        detailFor(record.serialized, PROJECT_ID, 'blob', record.envelope.logicalId, 'provider-x'),
        PROJECT_ID,
      );
      expect(decoded).toEqual(record.envelope);
      expect(record.serialized.length).toBeGreaterThan(0);
    }
  });

  it('keeps titles and tags opaque while payload stays concealed', () => {
    const secret = Buffer.from('super-secret-bytes-quant-9');
    const record = createBlobRecord(PROJECT_ID, secret, testUuid(7));
    const canaries = ['super-secret-bytes-quant-9', record.envelope.sha256, record.envelope.contentBase64.slice(0, 12)];
    for (const canary of canaries) {
      expect(record.input.title).not.toContain(canary);
      expect(record.input.tags.join(' ')).not.toContain(canary);
    }
    expect(record.input.fields.length).toBe(2);
    const payload = record.input.fields[1] as { type: string; label: string; value: string };
    expect(payload.type).toBe('CONCEALED');
    expect(payload.label).toBe('payload');
    expect(payload.value).toBe(record.serialized);
  });

  it('rejects tampered bytes digests and lengths before use', () => {
    const record = createBlobRecord(PROJECT_ID, Buffer.from('hello'), testUuid(11));
    const parsed = JSON.parse(record.serialized) as Record<string, unknown>;
    const tamperedDigest = { ...parsed, sha256: '0'.repeat(64) };
    const detailDigest = detailFor(JSON.stringify(tamperedDigest), PROJECT_ID, 'blob', record.envelope.logicalId, 'p1');
    expect(() => decodeRecordEnvelope(detailDigest, PROJECT_ID)).toThrowError(SecretSyncError);
    const tamperedLength = { ...parsed, byteLength: 999 };
    const detailLength = detailFor(JSON.stringify(tamperedLength), PROJECT_ID, 'blob', record.envelope.logicalId, 'p1');
    expect(() => decodeRecordEnvelope(detailLength, PROJECT_ID)).toThrowError(SecretSyncError);
    const tamperedBytes = { ...parsed, contentBase64: Buffer.from('other').toString('base64') };
    const detailBytes = detailFor(JSON.stringify(tamperedBytes), PROJECT_ID, 'blob', record.envelope.logicalId, 'p1');
    expect(() => decodeRecordEnvelope(detailBytes, PROJECT_ID)).toThrowError(SecretSyncError);
  });

  it('prefights the 64KiB bound without truncation', () => {
    const record = createBlobRecord(PROJECT_ID, Buffer.alloc(32768, 7), testUuid(13));
    expect(new TextEncoder().encode(record.serialized).length).toBeLessThanOrEqual(MAX_RECORD_BYTES);
    expect(() => createBlobRecord(PROJECT_ID, Buffer.alloc(32769, 7), testUuid(14))).toThrowError(SecretSyncError);
  });

  it('rejects mismatched projects and non-uuid identities', () => {
    const record = createBlobRecord(PROJECT_ID, Buffer.from('x'), testUuid(15));
    const detail = detailFor(record.serialized, PROJECT_ID, 'blob', record.envelope.logicalId, 'p1');
    expect(() => decodeRecordEnvelope(detail, OTHER_PROJECT)).toThrowError(SecretSyncError);
    expect(() => createBlobRecord('not-a-uuid', Buffer.from('x'), testUuid(16))).toThrowError(SecretSyncError);
    expect(() => parseRecordTitle('wrong format title')).toThrowError(SecretSyncError);
  });
});

describe('commit envelope', () => {
  it('serializes trees deterministically in sorted path order', () => {
    const blobA = testUuid(21);
    const blobB = testUuid(22);
    const first = createCommitRecord({
      projectId: PROJECT_ID,
      branch: 'main',
      parents: [],
      tree: [
        { path: 'b.env', blobId: blobB, sha256: 'a'.repeat(64), byteLength: 1 },
        { path: 'a.env', blobId: blobA, sha256: 'b'.repeat(64), byteLength: 2 },
      ],
      timestamp: 1000,
      operationId: testUuid(23),
      operationKind: 'push',
      logicalId: testUuid(24),
    });
    const second = createCommitRecord({
      projectId: PROJECT_ID,
      branch: 'main',
      parents: [],
      tree: [
        { path: 'a.env', blobId: blobA, sha256: 'b'.repeat(64), byteLength: 2 },
        { path: 'b.env', blobId: blobB, sha256: 'a'.repeat(64), byteLength: 1 },
      ],
      timestamp: 1000,
      operationId: testUuid(23),
      operationKind: 'push',
      logicalId: testUuid(24),
    });
    expect(first.serialized).toBe(second.serialized);
    expect(first.envelope.tree.map((entry) => entry.path)).toEqual(['a.env', 'b.env']);
    expect(serializeCommitEnvelope(first.envelope)).toBe(first.serialized);
  });

  it('rejects unsafe paths duplicate paths and oversized trees', () => {
    const blob = testUuid(31);
    const good = { path: 'secrets/app.env', blobId: blob, sha256: 'c'.repeat(64), byteLength: 3 };
    for (const bad of ['../escape.env', '/abs.env', 'a//b.env', 'a/./b.env', 'a\\b.env', '', 'trailing/.']) {
      expect(() =>
        createCommitRecord({
          projectId: PROJECT_ID,
          branch: 'main',
          parents: [],
          tree: [{ ...good, path: bad }],
          timestamp: 1,
          operationId: testUuid(32),
          operationKind: 'push',
        }),
      ).toThrowError(SecretSyncError);
    }
    expect(() =>
      createCommitRecord({
        projectId: PROJECT_ID,
        branch: 'main',
        parents: [],
        tree: [good, { ...good }],
        timestamp: 1,
        operationId: testUuid(33),
        operationKind: 'push',
      }),
    ).toThrowError(SecretSyncError);
    const big = [];
    for (let index = 0; index < 101; index += 1) {
      big.push({ path: `f${index}.env`, blobId: testUuid(1000 + index), sha256: 'd'.repeat(64), byteLength: 1 });
    }
    expect(() =>
      createCommitRecord({
        projectId: PROJECT_ID,
        branch: 'main',
        parents: [],
        tree: big,
        timestamp: 1,
        operationId: testUuid(34),
        operationKind: 'push',
      }),
    ).toThrowError(SecretSyncError);
  });

  it('rejects unsorted remote trees repeated parents and self parents', () => {
    const blob = testUuid(41);
    const record = createCommitRecord({
      projectId: PROJECT_ID,
      branch: 'main',
      parents: [],
      tree: [{ path: 'a.env', blobId: blob, sha256: 'e'.repeat(64), byteLength: 1 }],
      timestamp: 5,
      operationId: testUuid(42),
      operationKind: 'push',
      logicalId: testUuid(43),
    });
    const parsed = JSON.parse(record.serialized) as Record<string, unknown>;
    const unsorted = {
      ...parsed,
      tree: [
        { path: 'b.env', blobId: blob, sha256: 'e'.repeat(64), byteLength: 1 },
        { path: 'a.env', blobId: blob, sha256: 'e'.repeat(64), byteLength: 1 },
      ],
    };
    expect(() =>
      decodeRecordEnvelope(detailFor(JSON.stringify(unsorted), PROJECT_ID, 'commit', testUuid(43), 'p1'), PROJECT_ID),
    ).toThrowError(SecretSyncError);
    expect(() =>
      createCommitRecord({
        projectId: PROJECT_ID,
        branch: 'main',
        parents: [testUuid(44), testUuid(44)],
        tree: [],
        timestamp: 1,
        operationId: testUuid(45),
        operationKind: 'push',
      }),
    ).toThrowError(SecretSyncError);
    const selfId = testUuid(46);
    expect(() =>
      createCommitRecord({
        projectId: PROJECT_ID,
        branch: 'main',
        parents: [selfId],
        tree: [],
        timestamp: 1,
        operationId: testUuid(47),
        operationKind: 'push',
        logicalId: selfId,
      }),
    ).toThrowError(SecretSyncError);
  });

  it('keeps messages and paths out of titles and validates envelope json', () => {
    const record = createCommitRecord({
      projectId: PROJECT_ID,
      branch: 'main',
      parents: [],
      tree: [{ path: 'secrets/hidden.env', blobId: testUuid(51), sha256: 'f'.repeat(64), byteLength: 4 }],
      timestamp: 9,
      message: 'rotate-message-canary-xyz',
      operationId: testUuid(52),
      operationKind: 'push',
      logicalId: testUuid(53),
    });
    expect(record.input.title).not.toContain('rotate-message-canary-xyz');
    expect(record.input.title).not.toContain('secrets/hidden.env');
    expect(record.input.tags.join(' ')).not.toContain('rotate-message-canary-xyz');
    expect(() => decodeEnvelopeJson('not-json')).toThrowError(SecretSyncError);
    expect(() => buildCreateInput(PROJECT_ID, 'blob', testUuid(54), 'x'.repeat(MAX_RECORD_BYTES + 1))).toThrowError(
      SecretSyncError,
    );
  });
});

describe('duplicate logical ids', () => {
  it('collapses byte-identical duplicates and rejects conflicts', () => {
    const record = createBlobRecord(PROJECT_ID, Buffer.from('same'), testUuid(61));
    const first = detailFor(record.serialized, PROJECT_ID, 'blob', record.envelope.logicalId, 'provider-1');
    const second = detailFor(record.serialized, PROJECT_ID, 'blob', record.envelope.logicalId, 'provider-2');
    const collapsed = deduplicateRecordDetails([
      { detail: first, envelope: decodeEnvelopeJson(record.serialized) },
      { detail: second, envelope: decodeEnvelopeJson(record.serialized) },
    ]);
    expect(collapsed.blobs.size).toBe(1);
    const other = createBlobRecord(PROJECT_ID, Buffer.from('different'), testUuid(61));
    expect(() =>
      deduplicateRecordDetails([
        { detail: first, envelope: decodeEnvelopeJson(record.serialized) },
        { detail: second, envelope: decodeEnvelopeJson(other.serialized) },
      ]),
    ).toThrowError(SecretSyncError);
  });

  it('rejects one logical id shared by a blob and a commit', () => {
    const shared = testUuid(71);
    const blob = createBlobRecord(PROJECT_ID, Buffer.from('b'), shared);
    const commit = createCommitRecord({
      projectId: PROJECT_ID,
      branch: 'main',
      parents: [],
      tree: [],
      timestamp: 1,
      operationId: testUuid(72),
      operationKind: 'push',
      logicalId: shared,
    });
    const blobDetail = detailFor(blob.serialized, PROJECT_ID, 'blob', shared, 'provider-b');
    const commitDetail = detailFor(commit.serialized, PROJECT_ID, 'commit', shared, 'provider-c');
    expect(() =>
      deduplicateRecordDetails([
        { detail: blobDetail, envelope: decodeEnvelopeJson(blob.serialized) },
        { detail: commitDetail, envelope: decodeEnvelopeJson(commit.serialized) },
      ]),
    ).toThrowError(SecretSyncError);
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });
});
