import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AttachmentGateway, Attachment } from './confluence-client';
import {
  escapeAttachmentFilename,
  escapeXmlAttribute,
  renderCodeBlock,
  mermaidPlaceholderRe,
  type MermaidBlock,
} from './markdown';
import { buildStableName, shortHashString } from './content-hash';

export interface MermaidRewriteResult {
  html: string;
  fallbacks: string[];
  uploaded: ReadonlyArray<{ id: string; attachment: Attachment }>;
}

/**
 * Equivalent of {@link MermaidRewriteResult} for a preflight pass: it produces
 * the final HTML that would be emitted if rendering and uploads were allowed,
 * plus the set of mermaid blocks that would require a fresh render/upload.
 *
 * A preflight is `predictable` when every mermaid block resolves to an existing
 * attachment whose stored content hash matches the local source hash; in that
 * state no `mmdc` spawn, attachment mutation, or render work is required.
 */
export interface MermaidPreflightResult {
  html: string;
  /** Blocks that would render and/or upload on a real rewrite. */
  pending: ReadonlyArray<{ id: string; filename: string; hash: string }>;
  /** Blocks already matching an existing attachment by content hash. */
  reused: ReadonlyArray<{ id: string; attachment: Attachment }>;
  /** Blocks that would fall back to a code macro when `mmdc` is unavailable. */
  fallbacks: string[];
}

export interface MermaidRewriteOptions {
  /** Override the mmdc binary path; otherwise discovered via PATH. */
  mmdcPath?: string;
  /** Override the render command for tests (must write a valid SVG at outFile). */
  renderHook?: (source: string, outFile: string) => Promise<void>;
  /** Force-enable or force-disable rendering regardless of PATH detection. When true, skips the mmdc probe. */
  available?: boolean;
  /** Timeout (ms) for the mmdc subprocess and stream accumulation. Default 30000. */
  renderTimeoutMs?: number;
  /** Maximum bytes accumulated from stdout/stderr before rejecting. Default 1 MiB. */
  maxStreamBytes?: number;
}

export const DEFAULT_MERMAID_RENDER_TIMEOUT_MS = 30_000;
export const DEFAULT_MERMAID_MAX_STREAM_BYTES = 1024 * 1024;
const SVG_START_RE = /<svg[\s/>]/;
const SVG_END_RE = /<\/svg>\s*$|\/>\s*$/;

const UPLOAD_COMMENT_PREFIX = 'rt-content-sha256:';
const MERMAID_BASENAME = 'mermaid.svg';

export async function rewriteMermaidBlocks(
  html: string,
  blocks: MermaidBlock[],
  pageId: string,
  client: AttachmentGateway,
  options: MermaidRewriteOptions = {},
): Promise<MermaidRewriteResult> {
  const fallbacks: string[] = [];
  const uploaded: { id: string; attachment: Attachment }[] = [];

  if (blocks.length === 0) {
    return { html, fallbacks, uploaded };
  }

  const existing = await client.getAttachments(pageId);
  const existingByName = new Map<string, Attachment>();
  for (const a of existing) {
    const name = a.filename ?? a.title;
    if (name) {
      existingByName.set(name, a);
    }
  }

  const renderHook = options.renderHook ?? defaultRenderHook;
  let mmdcAvailable: boolean;
  if (options.renderHook) {
    mmdcAvailable = true;
  } else if (options.available !== undefined) {
    mmdcAvailable = options.available;
  } else {
    mmdcAvailable = await isMmdcAvailable(options.mmdcPath);
  }

  const resolved = new Map<string, { filename: string; attachment: Attachment }>();
  const remainingIds = new Set<string>();

  for (const block of blocks) {
    const hash = shortHashString(block.source);
    const filename = mermaidAttachmentFilename(hash);

    if (!mmdcAvailable) {
      fallbacks.push(block.id);
      remainingIds.add(block.id);
      continue;
    }

    const existingAtt = existingByName.get(filename);
    if (existingAtt && existingAtt.id && attachmentContentHash(existingAtt) === hash) {
      resolved.set(block.id, { filename, attachment: existingAtt });
      continue;
    }

    const workDir = await mkdtemp(join(tmpdir(), 'rt-mermaid-'));
    try {
      const inPath = join(workDir, 'diagram.mmd');
      const outPath = join(workDir, 'diagram.svg');
      await writeFile(inPath, block.source, 'utf8');
      try {
        await renderHook(block.source, outPath, options.mmdcPath, options.renderTimeoutMs, options.maxStreamBytes);
      } catch {
        fallbacks.push(block.id);
        remainingIds.add(block.id);
        continue;
      }

      let svg: string;
      try {
        svg = await readFile(outPath, 'utf8');
      } catch {
        fallbacks.push(block.id);
        remainingIds.add(block.id);
        continue;
      }
      const trimmed = svg.trim();
      if (trimmed.length === 0 || !SVG_START_RE.test(trimmed) || !SVG_END_RE.test(trimmed)) {
        fallbacks.push(block.id);
        remainingIds.add(block.id);
        continue;
      }

      let attachment: Attachment | undefined;
      if (existingAtt && existingAtt.id) {
        attachment = await client.updateAttachmentData(
          pageId,
          existingAtt.id,
          outPath,
          contentHashComment(hash),
          filename,
        );
      } else {
        attachment = await client.uploadAttachment(pageId, outPath, contentHashComment(hash), filename);
      }
      if (attachment) {
        uploaded.push({ id: block.id, attachment });
        resolved.set(block.id, { filename, attachment });
      } else {
        fallbacks.push(block.id);
        remainingIds.add(block.id);
      }
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  const re = mermaidPlaceholderRe();
  const replaced = html.replace(re, (full, id: string) => {
    const entry = resolved.get(id);
    if (entry) {
      return renderAttachmentMacro(entry.filename);
    }
    if (remainingIds.has(id)) {
      const block = blocks.find((b) => b.id === id);
      if (block) {
        return renderCodeBlock(block.source, 'mermaid');
      }
    }
    return full;
  });

  return { html: replaced, fallbacks, uploaded };
}

/**
 * Compute the final HTML and a pending/reused plan without performing any
 * `mmdc` spawn, attachment mutation, or upload. Used by `skipUnchanged` to
 * compare the would-be body byte-equal against the current page body before
 * any remote mutation or renderer work is considered.
 *
 * The preflight is conservative: a block that would fall back to a code macro
 * (because `mmdc` would be unavailable when run) is reported in `fallbacks`
 * and rendered into the predicted HTML as a code macro, matching the real
 * rewrite path. Blocks already present as a code macro in the page body must
 * remain a code macro to keep the comparison stable.
 */
export async function preflightMermaidBlocks(
  html: string,
  blocks: MermaidBlock[],
  pageId: string,
  client: AttachmentGateway,
  options: MermaidRewriteOptions = {},
): Promise<MermaidPreflightResult> {
  const fallbacks: string[] = [];
  const pending: { id: string; filename: string; hash: string }[] = [];
  const reused: { id: string; attachment: Attachment }[] = [];

  if (blocks.length === 0) {
    return { html, pending, reused, fallbacks };
  }

  const existing = await client.getAttachments(pageId);
  const existingByName = new Map<string, Attachment>();
  for (const a of existing) {
    const name = a.filename ?? a.title;
    if (name) {
      existingByName.set(name, a);
    }
  }

  let mmdcAvailable: boolean;
  if (options.renderHook) {
    mmdcAvailable = true;
  } else if (options.available !== undefined) {
    mmdcAvailable = options.available;
  } else {
    mmdcAvailable = await isMmdcAvailable(options.mmdcPath);
  }

  const resolved = new Map<string, string>();
  const remainingIds = new Set<string>();

  for (const block of blocks) {
    const hash = shortHashString(block.source);
    const filename = mermaidAttachmentFilename(hash);

    if (!mmdcAvailable) {
      fallbacks.push(block.id);
      remainingIds.add(block.id);
      continue;
    }

    const existingAtt = existingByName.get(filename);
    if (existingAtt && existingAtt.id && attachmentContentHash(existingAtt) === hash) {
      reused.push({ id: block.id, attachment: existingAtt });
      resolved.set(block.id, filename);
    } else {
      pending.push({ id: block.id, filename, hash });
    }
  }

  const re = mermaidPlaceholderRe();
  const predicted = html.replace(re, (full, id: string) => {
    const filename = resolved.get(id);
    if (filename) {
      return renderAttachmentMacro(filename);
    }
    if (remainingIds.has(id)) {
      const block = blocks.find((b) => b.id === id);
      if (block) {
        return renderCodeBlock(block.source, 'mermaid');
      }
    }
    return full;
  });

  return { html: predicted, pending, reused, fallbacks };
}

function mermaidAttachmentFilename(hash: string): string {
  return escapeAttachmentFilename(buildStableName(MERMAID_BASENAME, hash));
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

export async function isMmdcAvailable(override?: string): Promise<boolean> {
  if (override) {
    return true;
  }
  return spawnSync('sh', ['-c', 'command -v mmdc'], { stdio: 'ignore' }).status === 0;
}

async function defaultRenderHook(
  source: string,
  outFile: string,
  mmdcPath?: string,
  timeoutMs?: number,
  maxStreamBytes?: number,
): Promise<void> {
  const timeout = timeoutMs ?? DEFAULT_MERMAID_RENDER_TIMEOUT_MS;
  const maxBytes = maxStreamBytes ?? DEFAULT_MERMAID_MAX_STREAM_BYTES;
  const cmdPath = mmdcPath ?? 'mmdc';
  return runMmdc(cmdPath, source, outFile, timeout, maxBytes);
}

function runMmdc(
  cmdPath: string,
  source: string,
  outFile: string,
  timeoutMs: number,
  maxStreamBytes: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmdPath, ['-i', '-', '-o', outFile, '-t', 'default', '-b', 'transparent'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    let stdoutLen = 0;
    let stderrLen = 0;
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      const sigKillTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          void undefined;
        }
      }, 2000);
      if (typeof (sigKillTimer as unknown as { unref?: () => void }).unref === 'function') {
        (sigKillTimer as unknown as { unref: () => void }).unref();
      }
    }, timeoutMs);
    if (typeof (timer as unknown as { unref?: () => void }).unref === 'function') {
      (timer as unknown as { unref: () => void }).unref();
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutLen += chunk.length;
      if (stdoutLen > maxStreamBytes && !killed) {
        killed = true;
        child.kill('SIGKILL');
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrLen += chunk.length;
      if (stderrLen > maxStreamBytes && !killed) {
        killed = true;
        child.kill('SIGKILL');
      }
      if (stderr.length < maxStreamBytes) {
        stderr += chunk.toString('utf8').slice(0, Math.max(0, maxStreamBytes - stderr.length));
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (killed && code !== 0) {
        reject(new Error(`mmdc exceeded ${timeoutMs}ms or output limit (killed=${signal ?? code})`));
        return;
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`mmdc exited with code ${String(code)}${stderr ? `: ${stderr}` : ''}`));
      }
    });
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(source);
  });
}
