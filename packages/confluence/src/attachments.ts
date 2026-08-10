import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { normalize, isAbsolute, relative, resolve } from 'node:path';

import type { ConfluenceClient, Attachment } from './confluence-client';
import { escapeAttachmentFilename, escapeXmlAttribute, isRemoteUrl, LOCAL_IMAGE_PLACEHOLDER_RE } from './markdown';

export interface RewriteResult {
  html: string;
  uploaded: ReadonlyArray<{ src: string; attachment: Attachment }>;
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

export async function rewriteImagesToAttachments(
  html: string,
  pageId: string,
  client: ConfluenceClient,
  options: RewriteOptions,
): Promise<RewriteResult> {
  const uploaded: { src: string; attachment: Attachment }[] = [];
  const resolved = await resolvePlaceholders(html, pageId, client, options, uploaded);
  return { html: resolved, uploaded };
}

async function resolvePlaceholders(
  html: string,
  pageId: string,
  client: ConfluenceClient,
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

  const srcToFilename = new Map<string, string>();
  for (const { src, abs } of collected) {
    const filename = escapeAttachmentFilename(basenameLocal(abs));
    let attachment = existingByName.get(filename);
    if (attachment && attachment.id) {
      attachment = await client.updateAttachmentData(pageId, attachment.id, abs, `Updated via repo-toolkit-confluence`);
    } else {
      attachment = await client.uploadAttachment(pageId, abs, `Uploaded via repo-toolkit-confluence`);
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
