import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdtemp, rm, chmod, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { markdownToStorage, rewriteMermaidBlocks } from '../src/index';
import type { AttachmentGateway, Attachment } from '../src/confluence-client';
import { ConfluenceUploadError } from '../src/confluence-client';
import { renderMermaidPlaceholder } from '../src/markdown';

function fakeClient(opts: { existingAttachments?: Attachment[] } = {}): {
  client: AttachmentGateway;
  uploads: { pageId: string; file: string; filename?: string }[];
  updates: { pageId: string; attachmentId: string; file: string; filename?: string }[];
  attachmentsByName: Map<string, Attachment>;
} {
  const uploads: { pageId: string; file: string; filename?: string }[] = [];
  const updates: { pageId: string; attachmentId: string; file: string; filename?: string }[] = [];
  const attachmentsByName = new Map<string, Attachment>();
  for (const a of opts.existingAttachments ?? []) {
    if (a.filename) attachmentsByName.set(a.filename, a);
  }
  const client: AttachmentGateway = {
    async getAttachments(): Promise<Attachment[]> {
      return Array.from(attachmentsByName.values());
    },
    async uploadAttachment(
      pageId: string,
      filePath: string,
      _comment?: string,
      filenameOverride?: string,
    ): Promise<Attachment> {
      uploads.push({ pageId, file: filePath, filename: filenameOverride });
      const filename = filenameOverride ?? filePath.split(/[\\/]/).pop() ?? 'x';
      const att: Attachment = {
        id: `att-${filename}`,
        filename,
        title: filename,
        version: { number: 1, message: _comment },
        _links: { webui: '/x' },
      };
      attachmentsByName.set(filename, att);
      return att;
    },
    async updateAttachmentData(
      pageId: string,
      attachmentId: string,
      filePath: string,
      _comment?: string,
      filenameOverride?: string,
    ): Promise<Attachment> {
      updates.push({ pageId, attachmentId, file: filePath, filename: filenameOverride });
      const filename = filenameOverride ?? filePath.split(/[\\/]/).pop() ?? 'x';
      const att: Attachment = {
        id: attachmentId,
        filename,
        title: filename,
        version: { number: 2, message: _comment },
        _links: { webui: '/u' },
      };
      attachmentsByName.set(filename, att);
      return att;
    },
  };
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
    expect(uploads[0].filename).toBe('mermaid-f202f94e8104ac38.svg');
    expect(updates).toHaveLength(0);
    expect(result.fallbacks).toEqual([]);
    expect(result.uploaded).toHaveLength(1);
    expect(result.html).toContain('<ac:image><ri:attachment ri:filename="mermaid-f202f94e8104ac38.svg" /></ac:image>');
    expect(result.html).not.toContain('mermaid-placeholder');
  });

  it('updates an existing attachment when one with the same content-addressed name already exists but has different content', async () => {
    const md = '```mermaid\nflowchart LR\nA-->B\n```';
    const { html, mermaidBlocks } = markdownToStorage(md);
    const existing: Attachment = {
      id: 'att-existing',
      filename: 'mermaid-68c902c781f04249.svg',
      title: 'mermaid-68c902c781f04249.svg',
      version: { number: 1, message: 'rt-content-sha256:stale-hash' },
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

  it('reuses an existing attachment when content hash matches and skips render and upload', async () => {
    const md = '```mermaid\nflowchart LR\nA-->B\n```';
    const { html, mermaidBlocks } = markdownToStorage(md);
    const existing: Attachment = {
      id: 'att-stable',
      filename: 'mermaid-68c902c781f04249.svg',
      title: 'mermaid-68c902c781f04249.svg',
      version: { number: 5, message: 'rt-content-sha256:68c902c781f04249' },
      _links: { webui: '/u' },
    };
    const { client, uploads, updates } = fakeClient({ existingAttachments: [existing] });

    const renderHook = vi.fn(async () => {
      throw new Error('renderHook should not be called when the attachment is reused');
    });

    const result = await rewriteMermaidBlocks(html, mermaidBlocks, 'P1', client, { renderHook });

    expect(renderHook).not.toHaveBeenCalled();
    expect(uploads).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(result.fallbacks).toEqual([]);
    expect(result.uploaded).toHaveLength(0);
    expect(result.html).toContain('<ac:image><ri:attachment ri:filename="mermaid-68c902c781f04249.svg" /></ac:image>');
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
    expect(result.html).toContain('ri:filename="mermaid-f202f94e8104ac38.svg"');
  });

  it('renderMermaidPlaceholder escapes invalid attribute characters in the id', () => {
    const placeholder = renderMermaidPlaceholder('mermaid-1"></ac:structured-macro><x>');
    expect(placeholder).not.toContain('"><x>');
    expect(placeholder).toContain('"><');
  });
});

describe('CFARC-02: insertion-stable content-addressed mermaid names', () => {
  it('inserting an earlier diagram does not rename unchanged diagrams', async () => {
    const first = '```mermaid\nflowchart LR\nA-->B\n```';
    const { html: firstHtml, mermaidBlocks: firstBlocks } = markdownToStorage(first);

    const renderHook = vi.fn(async (_source: string, outFile: string) => {
      await writeFile(outFile, '<svg/>', 'utf8');
    });

    const { client: client1, attachmentsByName: atts1, uploads: uploads1 } = fakeClient();
    const r1 = await rewriteMermaidBlocks(firstHtml, firstBlocks, 'P1', client1, { renderHook });
    expect(uploads1).toHaveLength(1);
    const firstFilename = uploads1[0].filename;
    expect(firstFilename).toMatch(/^mermaid-[0-9a-f]{16}\.svg$/);
    expect(r1.html).toContain(`ri:filename="${firstFilename}"`);

    const second = '```mermaid\nflowchart TD\nX-->Y\n```\n\n```mermaid\nflowchart LR\nA-->B\n```';
    const { html: secondHtml, mermaidBlocks: secondBlocks } = markdownToStorage(second);

    const reusedClient: AttachmentGateway = {
      async getAttachments(): Promise<Attachment[]> {
        return Array.from(atts1.values());
      },
      async uploadAttachment(
        _pageId: string,
        filePath: string,
        _comment?: string,
        filenameOverride?: string,
      ): Promise<Attachment> {
        const filename = filenameOverride ?? filePath.split(/[\\/]/).pop() ?? 'x';
        const att: Attachment = {
          id: `att-${filename}`,
          filename,
          title: filename,
          version: { number: 1, message: _comment },
          _links: { webui: '/x' },
        };
        atts1.set(filename, att);
        return att;
      },
      async updateAttachmentData(): Promise<Attachment> {
        throw new Error('updateAttachmentData should not run for unchanged diagrams');
      },
    };

    const reusedRender = vi.fn(async (_source: string, outFile: string) => {
      await writeFile(outFile, '<svg/>', 'utf8');
    });

    const r2 = await rewriteMermaidBlocks(secondHtml, secondBlocks, 'P1', reusedClient, { renderHook: reusedRender });

    expect(reusedRender).toHaveBeenCalledTimes(1);
    expect(r2.fallbacks).toEqual([]);
    expect(r2.html).toContain(`ri:filename="${firstFilename}"`);
    const allFilenames = Array.from(atts1.keys()).filter((k) => k.startsWith('mermaid-'));
    expect(allFilenames.length).toBe(2);
    expect(new Set(allFilenames).size).toBe(2);
  });
});

describe('CFSEC-05: bound Mermaid subprocess and upload-error propagation', () => {
  let scratchDir: string;
  let savedTmpDir: string | undefined;

  async function makeFakeMmdc(name: string, scriptBody: string): Promise<string> {
    const scriptPath = join(scratchDir, name);
    await writeFile(scriptPath, `#!/usr/bin/env node\n${scriptBody}\n`, 'utf8');
    await chmod(scriptPath, 0o700);
    return scriptPath;
  }

  async function run(
    mmdcPath: string,
    options: {
      renderTimeoutMs?: number;
      maxStreamBytes?: number;
      client?: ReturnType<typeof fakeClient>;
      existing?: Attachment[];
    } = {},
  ) {
    const md = '```mermaid\ngraph TD\nA-->B\n```';
    const { html, mermaidBlocks } = markdownToStorage(md);
    const opts = options.client ?? fakeClient({ existingAttachments: options.existing });
    const result = await rewriteMermaidBlocks(html, mermaidBlocks, 'P1', opts.client, {
      available: true,
      mmdcPath,
      renderTimeoutMs: options.renderTimeoutMs,
      maxStreamBytes: options.maxStreamBytes,
    });
    return { ...result, ...opts };
  }

  beforeEach(async () => {
    savedTmpDir = process.env.TMPDIR;
    scratchDir = await mkdtemp(join(tmpdir(), 'rt-cfsec05-'));
    process.env.TMPDIR = scratchDir;
  });

  afterEach(async () => {
    if (savedTmpDir === undefined) {
      delete process.env.TMPDIR;
    } else {
      process.env.TMPDIR = savedTmpDir;
    }
    await rm(scratchDir, { recursive: true, force: true }).catch(() => undefined);
  });

  async function leftoverWorkDirs(): Promise<string[]> {
    const entries = await readdir(scratchDir);
    return entries.filter((e) => e.startsWith('rt-mermaid-'));
  }

  it('spawns the configured binary verbatim with no shell mediation and validates a regular SVG', async () => {
    const argvLog = join(scratchDir, 'argv.json');
    const script = await makeFakeMmdc(
      'ok.mjs',
      [
        `const fs = await import('node:fs/promises');`,
        `await fs.writeFile(${JSON.stringify(argvLog)}, JSON.stringify(process.argv));`,
        `let out = ''; for (let i = 0; i < process.argv.length - 1; i++) {`,
        `  if (process.argv[i] === '-o') { out = process.argv[i + 1]; break; }`,
        `}`,
        `await fs.writeFile(out, '<svg id="ok"/>\\n', 'utf8');`,
      ].join('\n'),
    );

    const r = await run(script);
    const argv = JSON.parse(await readFile(argvLog, 'utf8')) as string[];
    const scriptArgvIndex = argv.indexOf(script);
    expect(scriptArgvIndex).toBeGreaterThanOrEqual(0);
    expect(argv.indexOf('/bin/sh')).toBe(-1);
    expect(argv.indexOf('-c')).toBe(-1);
    expect(
      argv.filter(
        (a) =>
          a === '-i' || a === '-' || a === '-o' || a === '-t' || a === '-b' || a === 'default' || a === 'transparent',
      ),
    ).toEqual(['-i', '-', '-o', '-t', 'default', '-b', 'transparent']);
    expect(argv.some((a) => /diagram\.svg$/.test(a))).toBe(true);
    expect(r.fallbacks).toEqual([]);
    expect(r.uploaded).toHaveLength(1);
    await expect(leftoverWorkDirs()).resolves.toEqual([]);
  });

  it('aborts a hanging renderer after the timeout and cleans up', async () => {
    const script = await makeFakeMmdc('hang.mjs', `await new Promise(() => { /* never resolves */ });`);
    const start = Date.now();
    const r = await run(script, { renderTimeoutMs: 300 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
    expect(r.fallbacks).toEqual(['mermaid-1']);
    expect(r.uploaded).toHaveLength(0);
    expect(r.html).toContain('<![CDATA[graph TD\nA-->B]]>');
    await expect(leftoverWorkDirs()).resolves.toEqual([]);
  }, 15000);

  it('kills a renderer that overflows stdout past the byte bound and falls back', async () => {
    const script = await makeFakeMmdc(
      'noisy-stdout.mjs',
      [
        `const fs = await import('node:fs/promises');`,
        `let out = ''; for (let i = 0; i < process.argv.length - 1; i++) {`,
        `  if (process.argv[i] === '-o') { out = process.argv[i + 1]; break; }`,
        `}`,
        `process.stdout.write(Buffer.alloc(64 * 1024, 0x41));`,
        `await fs.writeFile(out, '<svg/>', 'utf8');`,
      ].join('\n'),
    );
    const r = await run(script, { maxStreamBytes: 1024, renderTimeoutMs: 10_000 });
    expect(r.fallbacks).toEqual(['mermaid-1']);
    expect(r.uploaded).toHaveLength(0);
    await expect(leftoverWorkDirs()).resolves.toEqual([]);
  }, 15000);

  it('kills a renderer that overflows stderr past the byte bound and falls back', async () => {
    const script = await makeFakeMmdc(
      'noisy-stderr.mjs',
      [
        `const fs = await import('node:fs/promises');`,
        `let out = ''; for (let i = 0; i < process.argv.length - 1; i++) {`,
        `  if (process.argv[i] === '-o') { out = process.argv[i + 1]; break; }`,
        `}`,
        `process.stderr.write(Buffer.alloc(64 * 1024, 0x42));`,
        `await fs.writeFile(out, '<svg/>', 'utf8');`,
      ].join('\n'),
    );
    const r = await run(script, { maxStreamBytes: 1024, renderTimeoutMs: 10_000 });
    expect(r.fallbacks).toEqual(['mermaid-1']);
    expect(r.uploaded).toHaveLength(0);
    await expect(leftoverWorkDirs()).resolves.toEqual([]);
  }, 15000);

  it('falls back when the renderer exits non-zero', async () => {
    const script = await makeFakeMmdc('fail.mjs', `process.exit(7);`);
    const r = await run(script, { renderTimeoutMs: 10_000 });
    expect(r.fallbacks).toEqual(['mermaid-1']);
    expect(r.uploaded).toHaveLength(0);
    await expect(leftoverWorkDirs()).resolves.toEqual([]);
  }, 15000);

  it('falls back when the rendered output is not a valid SVG', async () => {
    const script = await makeFakeMmdc(
      'broken-svg.mjs',
      [
        `const fs = await import('node:fs/promises');`,
        `let out = ''; for (let i = 0; i < process.argv.length - 1; i++) {`,
        `  if (process.argv[i] === '-o') { out = process.argv[i + 1]; break; }`,
        `}`,
        `await fs.writeFile(out, '<html>not a diagram</html>', 'utf8');`,
      ].join('\n'),
    );
    const r = await run(script, { renderTimeoutMs: 10_000 });
    expect(r.fallbacks).toEqual(['mermaid-1']);
    expect(r.uploaded).toHaveLength(0);
    expect(r.html).toContain('<![CDATA[graph TD\nA-->B]]>');
    await expect(leftoverWorkDirs()).resolves.toEqual([]);
  }, 15000);

  it('propagates a ConfluenceUploadError from upload and does not fall back', async () => {
    const script = await makeFakeMmdc(
      'ok-svg.mjs',
      [
        `const fs = await import('node:fs/promises');`,
        `let out = ''; for (let i = 0; i < process.argv.length - 1; i++) {`,
        `  if (process.argv[i] === '-o') { out = process.argv[i + 1]; break; }`,
        `}`,
        `await fs.writeFile(out, '<svg/>', 'utf8');`,
      ].join('\n'),
    );
    const md = '```mermaid\ngraph TD\nA-->B\n```';
    const { html, mermaidBlocks } = markdownToStorage(md);
    const failing: AttachmentGateway = {
      async getAttachments(): Promise<Attachment[]> {
        return [];
      },
      async uploadAttachment(): Promise<Attachment> {
        throw new ConfluenceUploadError('Forbidden', 403, '/attachments', 'forbidden');
      },
      async updateAttachmentData(): Promise<Attachment> {
        throw new Error('unexpected');
      },
    };
    const client: AttachmentGateway = failing;
    await expect(
      rewriteMermaidBlocks(html, mermaidBlocks, 'P1', client, {
        available: true,
        mmdcPath: script,
        renderTimeoutMs: 10_000,
      }),
    ).rejects.toBeInstanceOf(ConfluenceUploadError);
    await expect(leftoverWorkDirs()).resolves.toEqual([]);
  }, 15000);

  it('reuses the existing attachment when content hash matches and skips rendering', async () => {
    const script = await makeFakeMmdc('unused.mjs', `process.exit(99);`);
    const md = '```mermaid\nflowchart LR\nA-->B\n```';
    const { html, mermaidBlocks } = markdownToStorage(md);
    const existing: Attachment = {
      id: 'att-reuse',
      filename: 'mermaid-68c902c781f04249.svg',
      title: 'mermaid-68c902c781f04249.svg',
      version: { number: 1, message: 'rt-content-sha256:68c902c781f04249' },
      _links: { webui: '/u' },
    };
    const { client, uploads, updates } = fakeClient({ existingAttachments: [existing] });
    const r = await rewriteMermaidBlocks(html, mermaidBlocks, 'P1', client, {
      available: true,
      mmdcPath: script,
    });
    expect(uploads).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(r.uploaded).toHaveLength(0);
    expect(r.html).toContain('ri:filename="mermaid-68c902c781f04249.svg"');
    await expect(leftoverWorkDirs()).resolves.toEqual([]);
  });
});
