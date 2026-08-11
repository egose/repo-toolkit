import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { normalize, isAbsolute, relative, resolve } from 'node:path';

import type { AttachmentGateway, Attachment } from './confluence-client';
import { escapeAttachmentFilename, escapeXmlAttribute, isRemoteUrl, LOCAL_IMAGE_PLACEHOLDER_RE } from './markdown';
import { buildStableName, shortHashFile } from './content-hash';

export interface RewriteResult {
  html: string;
  uploaded: ReadonlyArray<{ src: string; attachment: Attachment }>;
}

/**
 * Equivalent of {@link RewriteResult} for a preflight pass: it produces the
 * final HTML that would be emitted if uploads were allowed, plus the set of
 * local sources that would require either a fresh upload or a content update.
 *
 * A preflight is `predictable` when every placeholder resolves to an existing
 * attachment whose stored content hash matches the local source hash; in that
 * state no upload is required and the produced HTML is byte-identical to a full
 * rewrite.
 */
export interface PreflightResult {
  html: string;
  /** Sources that would upload or update their attachment on a real rewrite. */
  pending: ReadonlyArray<{ src: string; filename: string; hash: string }>;
  /** Sources that already have a matching-content attachment and would be reused. */
  reused: ReadonlyArray<{ src: string; attachment: Attachment }>;
}

export interface RewriteOptions {
  /** Directory used to resolve relative image src values. The markdown file's own dir. */
  markdownDir: string;
  /** Documentation root used to confine local file reads. */
  allowedRoot: string;
  /** Maximum size accepted for an individual attachment source. */
  maxAttachmentBytes?: number;
  /** Maximum total size accepted across all uploaded sources in one document. */
  maxTotalAttachmentBytes?: number;
}

const DEFAULT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const UPLOAD_COMMENT_PREFIX = 'rt-content-sha256:';

/**
 * Resolved view of a local image source after the same root-confined,
 * regular-file, and size validation that {@link rewriteImagesToAttachments}
 * applies at upload time. Used by the CFARC-03 local preflight so the dry
 * validation pass before any API mutation never relaxes the trust boundary.
 */
export interface ValidatedAttachmentSource {
  /** Original `src` as it appeared in the markdown. */
  src: string;
  /** Real, root-confined absolute path on disk. */
  abs: string;
  /** Resolved content-addressed attachment filename (`<stem>-<hash16>.<ext>`). */
  filename: string;
}

/**
 * Validate every local image placeholder in `html` against the same physical
 * resolution, root confinement, regular-file, and size checks performed at
 * upload time, returning the content-addressed filename each source would get.
 * Throws on the first validation failure with the same message the upload path
 * would produce — so a pre-mutation pass cannot relax the trust boundary.
 *
 * Performs no client work and no upload; reads file metadata and short-hashes
 * file contents only.
 */
export function validateAttachmentSources(html: string, options: RewriteOptions): ValidatedAttachmentSource[] {
  const collected = collectLocalSources(html, options);
  return collected.map(({ src, abs }) => ({
    src,
    abs,
    filename: stableAttachmentFilename(abs),
  }));
}

export async function rewriteImagesToAttachments(
  html: string,
  pageId: string,
  client: AttachmentGateway,
  options: RewriteOptions,
): Promise<RewriteResult> {
  const uploaded: { src: string; attachment: Attachment }[] = [];
  const resolved = await resolvePlaceholders(html, pageId, client, options, uploaded);
  return { html: resolved, uploaded };
}

/**
 * Compute the final HTML and a pending/reused plan without performing any
 * upload, attachment mutation, or renderer spawn. Used by `skipUnchanged` to
 * compare the would-be body byte-equal against the current page body before
 * any remote mutation is considered.
 *
 * The preflight validates every local source (root confinement, regular
 * file, size limits, missing/escaping) the same way {@link rewriteImagesToAttachments}
 * does, so a dry-validation pass before a page PUT never relaxes the trust
 * boundary established by CFSEC-02.
 */
export async function preflightImagesToAttachments(
  html: string,
  pageId: string,
  client: AttachmentGateway,
  options: RewriteOptions,
): Promise<PreflightResult> {
  const existing = await client.getAttachments(pageId);
  const existingByName = new Map<string, Attachment>();
  for (const a of existing) {
    const name = a.filename ?? a.title;
    if (name) {
      existingByName.set(name, a);
    }
  }

  const collected = collectLocalSources(html, options);
  const pending: { src: string; filename: string; hash: string }[] = [];
  const reused: { src: string; attachment: Attachment }[] = [];
  const srcToFilename = new Map<string, string>();

  for (const { src, abs } of collected) {
    const hash = shortHashFile(abs);
    const filename = stableAttachmentFilename(abs);
    srcToFilename.set(src, filename);
    const existingAtt = existingByName.get(filename);
    if (existingAtt && existingAtt.id && attachmentContentHash(existingAtt) === hash) {
      reused.push({ src, attachment: existingAtt });
    } else {
      pending.push({ src, filename, hash });
    }
  }

  const predicted = html.replace(LOCAL_IMAGE_PLACEHOLDER_RE, (full, encodedSrc: string) => {
    const src = decodePlaceholder(encodedSrc);
    const filename = srcToFilename.get(src);
    if (!filename) {
      return full;
    }
    return renderAttachmentMacro(filename);
  });

  return { html: predicted, pending, reused };
}

async function resolvePlaceholders(
  html: string,
  pageId: string,
  client: AttachmentGateway,
  options: RewriteOptions,
  uploaded: { src: string; attachment: Attachment }[],
): Promise<string> {
  const existing = await client.getAttachments(pageId);
  const existingByName = new Map<string, Attachment>();
  for (const a of existing) {
    const name = a.filename ?? a.title;
    if (name) {
      existingByName.set(name, a);
    }
  }

  const collected = collectLocalSources(html, options);
  const srcToFilename = new Map<string, string>();

  for (const { src, abs } of collected) {
    const hash = shortHashFile(abs);
    const filename = stableAttachmentFilename(abs);
    const existingAtt = existingByName.get(filename);
    let attachment: Attachment | undefined;
    if (existingAtt && existingAtt.id && attachmentContentHash(existingAtt) === hash) {
      attachment = existingAtt;
    } else if (existingAtt && existingAtt.id) {
      attachment = await client.updateAttachmentData(pageId, existingAtt.id, abs, contentHashComment(hash), filename);
    } else {
      attachment = await client.uploadAttachment(pageId, abs, contentHashComment(hash), filename);
    }
    uploaded.push({ src, attachment });
    srcToFilename.set(src, filename);
  }

  return html.replace(LOCAL_IMAGE_PLACEHOLDER_RE, (full, encodedSrc: string) => {
    const src = decodePlaceholder(encodedSrc);
    const filename = srcToFilename.get(src);
    if (!filename) {
      return full;
    }
    return renderAttachmentMacro(filename);
  });
}

function collectLocalSources(html: string, options: RewriteOptions): { src: string; abs: string }[] {
  const collected: { src: string; abs: string }[] = [];
  const seen = new Set<string>();
  const maxAttachmentBytes = options.maxAttachmentBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;
  const maxTotalAttachmentBytes = options.maxTotalAttachmentBytes ?? DEFAULT_MAX_TOTAL_ATTACHMENT_BYTES;
  let totalBytes = 0;
  let m: RegExpExecArray | null;
  LOCAL_IMAGE_PLACEHOLDER_RE.lastIndex = 0;
  while ((m = LOCAL_IMAGE_PLACEHOLDER_RE.exec(html)) !== null) {
    const rawSrc = decodePlaceholder(m[1] ?? '');
    if (seen.has(rawSrc)) {
      continue;
    }
    seen.add(rawSrc);
    const abs = resolveImageForUpload(options.markdownDir, options.allowedRoot, rawSrc);
    const sourceInfo = lstatSync(abs);
    if (!sourceInfo.isFile()) {
      throw new Error(`Attachment source must be a regular file: ${rawSrc}`);
    }
    if (sourceInfo.size > maxAttachmentBytes) {
      throw new Error(`Attachment source exceeds the size limit: ${rawSrc}`);
    }
    totalBytes += sourceInfo.size;
    if (totalBytes > maxTotalAttachmentBytes) {
      throw new Error(`Attachment sources exceed the total size limit for this document`);
    }
    collected.push({ src: rawSrc, abs });
  }
  return collected;
}

function stableAttachmentFilename(absPath: string): string {
  const basename = basenameLocal(absPath);
  const hash = shortHashFile(absPath);
  return escapeAttachmentFilename(buildStableName(basename, hash));
}

function attachmentContentHash(attachment: Attachment): string | null {
  const message = attachment.version?.message;
  if (!message) {
    return null;
  }
  if (!message.startsWith(UPLOAD_COMMENT_PREFIX)) {
    return null;
  }
  return message.slice(UPLOAD_COMMENT_PREFIX.length) || null;
}

function contentHashComment(hash: string): string {
  return `${UPLOAD_COMMENT_PREFIX}${hash}`;
}

function renderAttachmentMacro(filename: string): string {
  const safe = escapeAttachmentFilename(filename);
  return `<ac:image><ri:attachment ri:filename="${escapeXmlAttribute(safe)}" /></ac:image>`;
}

function resolveImageForUpload(markdownDir: string, allowedRoot: string, src: string): string {
  if (isRemoteUrl(src)) {
    throw new Error(`Remote image should not be uploaded: ${src}`);
  }
  if (isAbsolute(src)) {
    throw new Error(`Attachment source must be relative to the documentation root: ${src}`);
  }

  const resolvedPath = normalize(resolve(markdownDir, src));
  if (!existsSync(resolvedPath)) {
    throw new Error(`Attachment source not found: ${src}`);
  }

  const resolvedRoot = realpathSync(allowedRoot);
  const realSourcePath = realpathSync(resolvedPath);
  const relativePath = relative(resolvedRoot, realSourcePath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Attachment source escapes the documentation root: ${src}`);
  }

  return realSourcePath;
}

function basenameLocal(absPath: string): string {
  const norm = normalize(absPath);
  const sep = norm.includes('\\') ? '\\' : '/';
  const parts = norm.split(sep);
  const last = parts[parts.length - 1];
  return last ?? norm;
}

function decodePlaceholder(value: string): string {
  const AMP = '&' + 'amp;';
  const QUOT = '&' + 'quot;';
  const LT = '&' + 'lt;';
  const GT = '&' + 'gt;';
  return value
    .replace(new RegExp(AMP, 'g'), '&')
    .replace(new RegExp(QUOT, 'g'), '"')
    .replace(new RegExp(LT, 'g'), '<')
    .replace(new RegExp(GT, 'g'), '>');
}
