import { isPlainObject } from '@repo-toolkit/publish-package';

import { SecretSyncError } from './errors';

export interface SecretItemField {
  type: string;
  value: string;
  id?: string;
  label?: string;
  purpose?: string;
}

export interface SecretItemSummary {
  id: string;
  title: string;
  tags: string[];
  category?: string;
}

export interface SecretItemDetail {
  id: string;
  title: string;
  tags: string[];
  category: string;
  fields: SecretItemField[];
}

export interface CreateSecretItemInput {
  title: string;
  category: string;
  tags: string[];
  fields: SecretItemField[];
}

export type ConnectItemField = SecretItemField;
export type ConnectItemSummary = SecretItemSummary;
export type ConnectItemDetail = SecretItemDetail;
export type CreateConnectItemInput = CreateSecretItemInput;

export interface ListItemsOptions {
  titleFilter?: string;
}

export type CreateItemResult =
  | { status: 'created'; item: SecretItemDetail }
  | { status: 'uncertain'; attempts: number };

export interface SecretStore {
  listItems(options?: ListItemsOptions): Promise<SecretItemSummary[]>;
  getItem(id: string): Promise<SecretItemDetail>;
  createItem(input: CreateSecretItemInput): Promise<CreateItemResult>;
}

function assertNonEmptyString(value: unknown, field: string, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SecretSyncError('schema', `${what} has an invalid ${field}.`);
  }
  return value;
}

function assertStringArray(value: unknown, field: string, what: string): string[] {
  if (!Array.isArray(value)) {
    throw new SecretSyncError('schema', `${what} has an invalid ${field}.`);
  }
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new SecretSyncError('schema', `${what} has an invalid ${field}.`);
    }
    result.push(entry);
  }
  return result;
}

export function validateItemId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new SecretSyncError('validation', 'Item id must be a non-empty string of at most 256 characters.');
  }
  if (value.includes('\0') || value.includes('/') || value.includes('\n') || value.includes('\r')) {
    throw new SecretSyncError('validation', 'Item id contains characters that are never valid in a provider id.');
  }
  return value;
}

export function validateSecretItemSummary(value: unknown): SecretItemSummary {
  if (!isPlainObject(value)) {
    throw new SecretSyncError('schema', 'Provider list entry is not an object.');
  }
  const record = value as Record<string, unknown>;
  const id = assertNonEmptyString(record.id, 'id', 'Provider list entry');
  const title = assertNonEmptyString(record.title, 'title', 'Provider list entry');
  const tags = record.tags === undefined ? [] : assertStringArray(record.tags, 'tags', 'Provider list entry');
  if (typeof record.category !== 'undefined' && typeof record.category !== 'string') {
    throw new SecretSyncError('schema', 'Provider list entry has an invalid category.');
  }
  if (id.length > 256 || title.length > 512) {
    throw new SecretSyncError('schema', 'Provider list entry exceeds structural length bounds.');
  }
  if (tags.length > 64) {
    throw new SecretSyncError('schema', 'Provider list entry exceeds structural tag bounds.');
  }
  return {
    id,
    title,
    tags,
    ...(typeof record.category === 'string' ? { category: record.category } : {}),
  };
}

export function validateSecretItemDetail(value: unknown): SecretItemDetail {
  if (!isPlainObject(value)) {
    throw new SecretSyncError('schema', 'Provider item is not an object.');
  }
  const record = value as Record<string, unknown>;
  const id = assertNonEmptyString(record.id, 'id', 'Provider item');
  const title = assertNonEmptyString(record.title, 'title', 'Provider item');
  const tags = record.tags === undefined ? [] : assertStringArray(record.tags, 'tags', 'Provider item');
  const category = assertNonEmptyString(record.category, 'category', 'Provider item');
  if (!Array.isArray(record.fields)) {
    throw new SecretSyncError('schema', 'Provider item has invalid fields.');
  }
  const fields: SecretItemField[] = [];
  for (const entry of record.fields) {
    fields.push(validateSecretItemField(entry));
  }
  if (id.length > 256 || title.length > 512 || category.length > 64) {
    throw new SecretSyncError('schema', 'Provider item exceeds structural length bounds.');
  }
  if (tags.length > 64 || fields.length > 64) {
    throw new SecretSyncError('schema', 'Provider item exceeds structural entry bounds.');
  }
  return { id, title, tags, category, fields };
}

function validateSecretItemField(value: unknown): SecretItemField {
  if (!isPlainObject(value)) {
    throw new SecretSyncError('schema', 'Provider item has invalid fields.');
  }
  const record = value as Record<string, unknown>;
  const type = assertNonEmptyString(record.type, 'type', 'Provider field');
  const fieldValue = typeof record.value === 'string' ? record.value : undefined;
  if (fieldValue === undefined) {
    throw new SecretSyncError('schema', 'Provider field has invalid value.');
  }
  if (type.length > 32) {
    throw new SecretSyncError('schema', 'Provider field exceeds structural length bounds.');
  }
  const result: SecretItemField = { type, value: fieldValue };
  if (typeof record.id === 'string') {
    result.id = record.id;
  }
  if (typeof record.label === 'string') {
    result.label = record.label;
  }
  if (typeof record.purpose === 'string') {
    result.purpose = record.purpose;
  }
  return result;
}

export function validateCreateSecretItemInput(value: unknown): CreateSecretItemInput {
  if (!isPlainObject(value)) {
    throw new SecretSyncError('validation', 'Create payload must be an object.');
  }
  const record = value as Record<string, unknown>;
  const title = assertNonEmptyString(record.title, 'title', 'Create payload');
  const category = assertNonEmptyString(record.category, 'category', 'Create payload');
  const tags = record.tags === undefined ? [] : assertStringArray(record.tags, 'tags', 'Create payload');
  if (!Array.isArray(record.fields) || record.fields.length === 0) {
    throw new SecretSyncError('validation', 'Create payload needs at least one field.');
  }
  const fields: SecretItemField[] = [];
  for (const entry of record.fields) {
    if (!isPlainObject(entry)) {
      throw new SecretSyncError('validation', 'Create payload has an invalid field entry.');
    }
    const fieldRecord = entry as Record<string, unknown>;
    if (typeof fieldRecord.type !== 'string' || fieldRecord.type.length === 0) {
      throw new SecretSyncError('validation', 'Create payload field needs a type.');
    }
    if (typeof fieldRecord.value !== 'string') {
      throw new SecretSyncError('validation', 'Create payload field needs a string value.');
    }
    const validated: SecretItemField = { type: fieldRecord.type, value: fieldRecord.value };
    if (typeof fieldRecord.id === 'string') {
      validated.id = fieldRecord.id;
    }
    if (typeof fieldRecord.label === 'string') {
      validated.label = fieldRecord.label;
    }
    if (typeof fieldRecord.purpose === 'string') {
      validated.purpose = fieldRecord.purpose;
    }
    fields.push(validated);
  }
  if (title.length > 512 || category.length > 64 || tags.length > 64 || fields.length > 64) {
    throw new SecretSyncError('validation', 'Create payload exceeds structural bounds.');
  }
  return { title, category, tags, fields };
}

export function validateConnectItemSummary(value: unknown): ConnectItemSummary {
  return validateSecretItemSummary(value);
}

export function validateConnectItemDetail(value: unknown): ConnectItemDetail {
  return validateSecretItemDetail(value);
}

export function validateCreateConnectItemInput(value: unknown): CreateConnectItemInput {
  return validateCreateSecretItemInput(value);
}

export function validateListResponse(value: unknown): SecretItemSummary[] {
  if (!Array.isArray(value)) {
    throw new SecretSyncError('schema', 'Provider list response is not an array.');
  }
  return value.map((entry) => validateSecretItemSummary(entry));
}
