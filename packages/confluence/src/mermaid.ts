import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConfluenceClient, Attachment } from './confluence-client';
import {
  escapeAttachmentFilename,
  escapeXmlAttribute,
  renderCodeBlock,
  mermaidPlaceholderRe,
  type MermaidBlock,
} from './markdown';

export interface MermaidRewriteResult {
  html: string;
  /** Placeholders that could not be rendered (mmdc missing or render failure). Fallback source is in the original code macro. */
  fallbacks: string[];
  uploaded: ReadonlyArray<{ id: string; attachment: Attachment }>;
}

export interface MermaidRewriteOptions {
  /** Override the mmdc binary path; otherwise discovered via PATH. */
  mmdcPath?: string;
  /** Override the render command for tests (must write a valid SVG at outFile). */
  renderHook?: (source: string, outFile: string) => Promise<void>;
  /** Force-enable or force-disable rendering regardless of PATH detection. When true, skips the mmdc probe. */
  available?: boolean;
}

export async function rewriteMermaidBlocks(
  html: string,
  blocks: MermaidBlock[],
  pageId: string,
  client: ConfluenceClient,
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

  const placeholderToAttachment = new Map<string, string>();

  for (const block of blocks) {
    if (!mmdcAvailable) {
      fallbacks.push(block.id);
      continue;
    }

    const workDir = await mkdtemp(join(tmpdir(), 'rt-mermaid-'));
    try {
      const inPath = join(workDir, 'diagram.mmd');
      const outPath = join(workDir, 'diagram.svg');
      await writeFile(inPath, block.source, 'utf8');
      await renderHook(block.source, outPath);

      const filename = escapeAttachmentFilename(`${block.id}.svg`);
      let attachment = existingByName.get(filename);
      if (attachment && attachment.id) {
        attachment = await client.updateAttachmentData(
          pageId,
          attachment.id,
          outPath,
          `Updated via repo-toolkit-confluence`,
        );
      } else {
        attachment = await client.uploadAttachment(pageId, outPath, `Uploaded via repo-toolkit-confluence`);
      }
      uploaded.push({ id: block.id, attachment });
      placeholderToAttachment.set(block.id, filename);
    } catch {
      fallbacks.push(block.id);
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  const remainingIds = new Set(fallbacks);

  const re = mermaidPlaceholderRe();
  const replaced = html.replace(re, (full, id: string) => {
    const filename = placeholderToAttachment.get(id);
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

  return { html: replaced, fallbacks, uploaded };
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

async function defaultRenderHook(source: string, outFile: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('mmdc', ['-i', '-', '-o', outFile, '-t', 'default', '-b', 'transparent'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`mmdc exited with code ${code}${stderr ? `: ${stderr}` : ''}`));
      }
    });
    child.stdin?.end(source);
  });
}
