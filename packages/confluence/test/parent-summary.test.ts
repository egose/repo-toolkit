import { describe, expect, it } from 'vitest';
import {
  renderParentSummary,
  mergeParentSummaryBody,
  PARENT_SUMMARY_START_MARKER,
  PARENT_SUMMARY_END_MARKER,
} from '../src/parent-summary';

describe('parent-summary pure renderer', () => {
  it('renders provenance with repositoryUrl link', () => {
    const html = renderParentSummary({
      repositoryUrl: 'https://github.com/acme/repo',
      stats: {
        markdownPages: 1,
        directoryPages: 1,
        totalPages: 2,
        maxDepth: 2,
        attachmentReferences: 3,
        mermaidBlocks: 1,
      },
      pages: [
        {
          relativePath: 'guide/intro.md',
          kind: 'leaf',
          title: 'intro',
          pageId: '100',
          depth: 2,
          attachmentCount: 1,
          mermaidCount: 0,
        },
      ],
    });
    expect(html).toContain('<h2>Synced documentation</h2>');
    expect(html).toContain('https://github.com/acme/repo');
    expect(html).toContain('<a href="https://github.com/acme/repo"');
    expect(html).toContain('This documentation subtree is synced from');
    expect(html).not.toContain('maintained by');
  });

  it('renders no provenance paragraph when repositoryUrl absent', () => {
    const html = renderParentSummary({
      repositoryUrl: '',
      stats: {
        markdownPages: 0,
        directoryPages: 0,
        totalPages: 0,
        maxDepth: 0,
        attachmentReferences: 0,
        mermaidBlocks: 0,
      },
      pages: [],
    });
    expect(html).not.toContain('<a href=');
    expect(html).not.toContain('maintained by');
    expect(html).not.toContain('This documentation subtree is synced from');
  });

  it('renders statistics exactly', () => {
    const html = renderParentSummary({
      repositoryUrl: '',
      stats: {
        markdownPages: 2,
        directoryPages: 3,
        totalPages: 5,
        maxDepth: 4,
        attachmentReferences: 6,
        mermaidBlocks: 7,
      },
      pages: [],
    });
    expect(html).toContain('Markdown pages: 2');
    expect(html).toContain('Directory pages: 3');
    expect(html).toContain('Total managed pages: 5');
    expect(html).toContain('Maximum depth: 4');
    expect(html).toContain('Attachment references: 6');
    expect(html).toContain('Mermaid blocks: 7');
  });

  it('renders empty tree with No managed child pages', () => {
    const html = renderParentSummary({
      repositoryUrl: '',
      stats: {
        markdownPages: 0,
        directoryPages: 0,
        totalPages: 0,
        maxDepth: 0,
        attachmentReferences: 0,
        mermaidBlocks: 0,
      },
      pages: [],
    });
    expect(html).toContain('No managed child pages');
    expect(html).not.toContain('<ac:link>');
  });

  it('renders nested tree with directory and leaf links', () => {
    const html = renderParentSummary({
      repositoryUrl: '',
      stats: {
        markdownPages: 2,
        directoryPages: 1,
        totalPages: 3,
        maxDepth: 2,
        attachmentReferences: 0,
        mermaidBlocks: 0,
      },
      pages: [
        {
          relativePath: 'guide',
          kind: 'directory',
          title: 'guide',
          pageId: '10',
          depth: 1,
          attachmentCount: 0,
          mermaidCount: 0,
        },
        {
          relativePath: 'guide/a.md',
          kind: 'leaf',
          title: 'a',
          pageId: '11',
          depth: 2,
          attachmentCount: 0,
          mermaidCount: 0,
        },
        { relativePath: 'b.md', kind: 'leaf', title: 'b', pageId: '12', depth: 1, attachmentCount: 0, mermaidCount: 0 },
      ],
    });
    expect(html).toContain('ri:content-id="10"');
    expect(html).toContain('ri:content-id="11"');
    expect(html).toContain('ri:content-id="12"');
    expect(html).toContain('>guide<');
    expect(html).toContain('(directory)');
    expect(html).toContain('(page)');
  });

  it('does not include ownership guidance', () => {
    const html = renderParentSummary({
      repositoryUrl: '',
      stats: {
        markdownPages: 0,
        directoryPages: 0,
        totalPages: 0,
        maxDepth: 0,
        attachmentReferences: 0,
        mermaidBlocks: 0,
      },
      pages: [],
    });
    expect(html).not.toContain('<h3>Ownership</h3>');
    expect(html).not.toContain('pruned');
    expect(html).not.toContain('clean: true');
    expect(html).not.toContain('unlabeled');
  });

  it('does not include timestamps, versions, absolute paths, credentials', () => {
    const html = renderParentSummary({
      repositoryUrl: 'https://example.com',
      stats: {
        markdownPages: 1,
        directoryPages: 0,
        totalPages: 1,
        maxDepth: 1,
        attachmentReferences: 0,
        mermaidBlocks: 0,
      },
      pages: [
        { relativePath: 'a.md', kind: 'leaf', title: 'a', pageId: '1', depth: 1, attachmentCount: 0, mermaidCount: 0 },
      ],
    });
    expect(html).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(html).not.toContain('/tmp');
    expect(html).not.toContain('apiToken');
    expect(html).not.toContain('version');
  });

  it('is deterministic: same input yields byte-equal output', () => {
    const input = {
      repositoryUrl: 'https://example.com',
      stats: {
        markdownPages: 1,
        directoryPages: 1,
        totalPages: 2,
        maxDepth: 2,
        attachmentReferences: 1,
        mermaidBlocks: 1,
      },
      pages: [
        {
          relativePath: 'dir',
          kind: 'directory' as const,
          title: 'dir',
          pageId: '1',
          depth: 1,
          attachmentCount: 0,
          mermaidCount: 0,
        },
        {
          relativePath: 'dir/a.md',
          kind: 'leaf' as const,
          title: 'a',
          pageId: '2',
          depth: 2,
          attachmentCount: 1,
          mermaidCount: 1,
        },
      ],
    };
    expect(renderParentSummary(input)).toBe(renderParentSummary(input));
  });
});

describe('parent-summary merge', () => {
  const region = `${PARENT_SUMMARY_START_MARKER}\n<p>generated</p>\n${PARENT_SUMMARY_END_MARKER}`;

  it('appends region when absent', () => {
    const cur = '<p>Manual</p>';
    const merged = mergeParentSummaryBody(cur, region);
    expect(merged).toBe(`${cur}\n${region}`);
    expect(merged.startsWith(cur)).toBe(true);
    expect(merged.endsWith(region)).toBe(true);
  });

  it('replaces exactly one valid region', () => {
    const cur = `<p>Top</p>\n${PARENT_SUMMARY_START_MARKER}\n<p>old</p>\n${PARENT_SUMMARY_END_MARKER}\n<p>Bottom</p>`;
    const nextRegion = `${PARENT_SUMMARY_START_MARKER}\n<p>new</p>\n${PARENT_SUMMARY_END_MARKER}`;
    const merged = mergeParentSummaryBody(cur, nextRegion);
    expect(merged).toBe(`<p>Top</p>\n${nextRegion}\n<p>Bottom</p>`);
    expect(merged).toContain('<p>Top</p>');
    expect(merged).toContain('<p>Bottom</p>');
    expect(merged).not.toContain('<p>old</p>');
  });

  it('preserves all outside bytes byte-for-byte', () => {
    const outside = '<p>Manual &amp; content</p>\n';
    const cur = outside + region;
    const next = `${PARENT_SUMMARY_START_MARKER}\n<p>new2</p>\n${PARENT_SUMMARY_END_MARKER}`;
    const merged = mergeParentSummaryBody(cur, next);
    expect(merged.startsWith(outside)).toBe(true);
  });

  it('rejects malformed missing end marker', () => {
    const cur = `<p>x</p>${PARENT_SUMMARY_START_MARKER}<p>oops`;
    expect(() => mergeParentSummaryBody(cur, region)).toThrow(/malformed/);
  });

  it('rejects duplicate markers', () => {
    const cur = `${region}\n${region}`;
    expect(() => mergeParentSummaryBody(cur, region)).toThrow(/duplicate/);
  });

  it('rejects nested/duplicate start', () => {
    const cur = `${PARENT_SUMMARY_START_MARKER}\n${PARENT_SUMMARY_START_MARKER}\n${PARENT_SUMMARY_END_MARKER}`;
    expect(() => mergeParentSummaryBody(cur, region)).toThrow(/malformed|duplicate/);
  });

  it('rejects start after end', () => {
    const cur = `${PARENT_SUMMARY_END_MARKER}\n${PARENT_SUMMARY_START_MARKER}`;
    expect(() => mergeParentSummaryBody(cur, region)).toThrow(/malformed/);
  });

  it('fixture: body returned by Confluence after round trip preserves markers', () => {
    const confluenceReturned = `<p>Manual content</p>\n${PARENT_SUMMARY_START_MARKER}\n<h2>Synced documentation</h2>\n<p>body</p>\n${PARENT_SUMMARY_END_MARKER}\n<p>Trailing</p>`;
    const next = `${PARENT_SUMMARY_START_MARKER}\n<h2>Synced documentation</h2>\n<p>new</p>\n${PARENT_SUMMARY_END_MARKER}`;
    const merged = mergeParentSummaryBody(confluenceReturned, next);
    expect(merged).toContain('<p>Manual content</p>');
    expect(merged).toContain('<p>Trailing</p>');
    expect(merged).toContain('<h2>Synced documentation</h2>');
  });
});
