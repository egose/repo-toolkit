import { describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';

import { markdownToStorage, rewriteMermaidBlocks } from '../src/index';
import type { ConfluenceClient, Attachment } from '../src/confluence-client';
import { renderMermaidPlaceholder } from '../src/markdown';

function fakeClient(opts: { existingAttachments?: Attachment[] } = {}): {
  client: ConfluenceClient;
  uploads: { pageId: string; file: string }[];
  updates: { pageId: string; attachmentId: string; file: string }[];
  attachmentsByName: Map<string, Attachment>;
} {
  const uploads: { pageId: string; file: string }[] = [];
  const updates: { pageId: string; attachmentId: string; file: string }[] = [];
  const attachmentsByName = new Map<string, Attachment>();
  for (const a of opts.existingAttachments ?? []) {
    if (a.filename) attachmentsByName.set(a.filename, a);
  }
  const client = {
    async getAttachments(): Promise<Attachment[]> {
      return Array.from(attachmentsByName.values());
    },
    async uploadAttachment(pageId: string, filePath: string): Promise<Attachment> {
      uploads.push({ pageId, file: filePath });
      const filename = filePath.split(/[\\/]/).pop() ?? 'x';
      const att: Attachment = {
        id: `att-${filename}`,
        filename,
        title: filename,
        version: { number: 1 },
        _links: { webui: '/x' },
      };
      attachmentsByName.set(filename, att);
      return att;
    },
    async updateAttachmentData(pageId: string, attachmentId: string, filePath: string): Promise<Attachment> {
      updates.push({ pageId, attachmentId, file: filePath });
      const filename = filePath.split(/[\\/]/).pop() ?? 'x';
      const att: Attachment = {
        id: attachmentId,
        filename,
        title: filename,
        version: { number: 2 },
        _links: { webui: '/u' },
      };
      attachmentsByName.set(filename, att);
      return att;
    },
  } as unknown as ConfluenceClient;
  return { client, uploads, updates, attachmentsByName };
}

describe('rewriteMermaidBlocks — renderHook succeeds', () => {
  it('converts mermaid placeholders to attachment image macros and uploads SVGs', async () => {
    const md = '```mermaid\ngraph TD\nA-->B\n```';
    const { html, mermaidBlocks } = markdownToStorage(md);
    const { client, uploads, updates } = fakeClient();

    const renderHook = vi.fn(async (_source: string, outFile: string) => {
      await writeFile(outFile, '<svg id="ok"/>', 'utf8');
    });

    const result = await rewriteMermaidBlocks(html, mermaidBlocks, 'P1', client, { renderHook });

    expect(renderHook).toHaveBeenCalledTimes(1);
    expect(uploads).toHaveLength(1);
    expect(uploads[0].file).toMatch(/diagram\.svg$/);
    expect(updates).toHaveLength(0);
    expect(result.fallbacks).toEqual([]);
    expect(result.uploaded).toHaveLength(1);
    expect(result.html).toContain('<ac:image><ri:attachment ri:filename="mermaid-1.svg" /></ac:image>');
    expect(result.html).not.toContain('mermaid-placeholder');
  });

  it('updates an existing attachment when one with the same filename already exists', async () => {
    const md = '```mermaid\nflowchart LR\nA-->B\n```';
    const { html, mermaidBlocks } = markdownToStorage(md);
    const existing: Attachment = {
      id: 'att-existing',
      filename: 'mermaid-1.svg',
      title: 'mermaid-1.svg',
      version: { number: 1 },
      _links: { webui: '/u' },
    };
    const { client, uploads, updates } = fakeClient({ existingAttachments: [existing] });

    const renderHook = vi.fn(async (_source: string, outFile: string) => {
      await writeFile(outFile, '<svg/>', 'utf8');
    });

    const result = await rewriteMermaidBlocks(html, mermaidBlocks, 'P1', client, { renderHook });

    expect(uploads).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].attachmentId).toBe('att-existing');
    expect(result.uploaded[0].attachment.id).toBe('att-existing');
  });
});

describe('rewriteMermaidBlocks — fallbacks', () => {
  it('falls back to a code macro when mmdc is unavailable (no renderHook)', async () => {
    const md = '```mermaid\ngraph TD\nA-->B\n```';
    const { html, mermaidBlocks } = markdownToStorage(md);
    const { client, uploads, updates } = fakeClient();

    const result = await rewriteMermaidBlocks(html, mermaidBlocks, 'P1', client, {
      available: false,
    });

    expect(uploads).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(result.fallbacks).toEqual(['mermaid-1']);
    expect(result.uploaded).toHaveLength(0);
    expect(result.html).toContain('<ac:structured-macro ac:name="code"');
    expect(result.html).toContain('<ac:parameter ac:name="language">mermaid</ac:parameter>');
    expect(result.html).toContain('<![CDATA[graph TD\nA-->B]]>');
    expect(result.html).not.toContain('mermaid-placeholder');
  });

  it('falls back to a code macro when the render hook throws', async () => {
    const md = '```mermaid\ngraph TD\nA-->B\n```';
    const { html, mermaidBlocks } = markdownToStorage(md);
    const { client, uploads } = fakeClient();

    const renderHook = vi.fn(async () => {
      throw new Error('boom');
    });

    const result = await rewriteMermaidBlocks(html, mermaidBlocks, 'P1', client, { renderHook });

    expect(renderHook).toHaveBeenCalledTimes(1);
    expect(uploads).toHaveLength(0);
    expect(result.fallbacks).toEqual(['mermaid-1']);
    expect(result.html).toContain('<![CDATA[graph TD\nA-->B]]>');
  });
});

describe('rewriteMermaidBlocks — edge cases', () => {
  it('returns html unchanged when there are no mermaid blocks', async () => {
    const { client } = fakeClient();
    const result = await rewriteMermaidBlocks('<p>hi</p>', [], 'P1', client);
    expect(result.html).toBe('<p>hi</p>');
    expect(result.fallbacks).toEqual([]);
    expect(result.uploaded).toHaveLength(0);
  });

  it('preserves unrelated html around placeholders', async () => {
    const { html, mermaidBlocks } = markdownToStorage('# Title\n\n```mermaid\ngraph TD\nA-->B\n```\n\ntext');
    const { client } = fakeClient();
    const renderHook = vi.fn(async (_s: string, outFile: string) => {
      await writeFile(outFile, '<svg/>', 'utf8');
    });
    const result = await rewriteMermaidBlocks(html, mermaidBlocks, 'P1', client, { renderHook });
    expect(result.html).toContain('<h1>Title</h1>');
    expect(result.html).toContain('<p>text</p>');
    expect(result.html).toContain('ri:filename="mermaid-1.svg"');
  });

  it('renderMermaidPlaceholder escapes invalid attribute characters in the id', () => {
    const placeholder = renderMermaidPlaceholder('mermaid-1"></ac:structured-macro><x>');
    expect(placeholder).not.toContain('"><x>');
    expect(placeholder).toContain('"><');
  });
});
