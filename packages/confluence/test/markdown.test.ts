import { describe, expect, it } from 'vitest';

import {
  markdownToStorage,
  escapeAttachmentFilename,
  escapeHtml,
  escapeXmlAttribute,
  isRemoteUrl,
  renderInline,
} from '../src/markdown';

const AMP_ENTITY = '&' + 'amp;';
const LT_ENTITY = '&' + 'lt;';
const GT_ENTITY = '&' + 'gt;';
const QUOT_ENTITY = '&' + 'quot;';
const APOS_ENTITY = '&' + '#' + '39;';

describe('escapeHtml / escapeXmlAttribute', () => {
  it('escapes & < > " and apostrophe', () => {
    const expected =
      LT_ENTITY +
      'a href=' +
      QUOT_ENTITY +
      'x' +
      QUOT_ENTITY +
      GT_ENTITY +
      'it' +
      APOS_ENTITY +
      's ' +
      AMP_ENTITY +
      ' ' +
      QUOT_ENTITY +
      'fine' +
      QUOT_ENTITY +
      LT_ENTITY +
      '/a' +
      GT_ENTITY;
    expect(escapeHtml('<a href="x">it\'s & "fine"</a>')).toBe(expected);
  });

  it('escapes ampersand', () => {
    expect(escapeHtml('&')).toBe(AMP_ENTITY);
    expect(escapeHtml('a&b')).toBe('a' + AMP_ENTITY + 'b');
  });

  it('escapes attribute value (amp quot lt gt)', () => {
    expect(escapeXmlAttribute('a"&b<>')).toBe('a' + QUOT_ENTITY + AMP_ENTITY + 'b' + LT_ENTITY + GT_ENTITY);
  });
});

describe('escapeAttachmentFilename', () => {
  it('rejects empty / dot / dot-dot', () => {
    expect(() => escapeAttachmentFilename('')).toThrowError(/Invalid attachment filename/);
    expect(() => escapeAttachmentFilename('.')).toThrowError(/Invalid attachment filename/);
    expect(() => escapeAttachmentFilename('..')).toThrowError(/Invalid attachment filename/);
  });

  it('strips path separators to avoid traversal', () => {
    expect(escapeAttachmentFilename('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(escapeAttachmentFilename('a\\b\\c.png')).toBe('a_b_c.png');
  });

  it('preserves a normal filename', () => {
    expect(escapeAttachmentFilename('logo.png')).toBe('logo.png');
  });
});

describe('isRemoteUrl', () => {
  it('recognizes http(s) and protocol-relative as remote', () => {
    expect(isRemoteUrl('https://x.com/a.png')).toBe(true);
    expect(isRemoteUrl('http://x.com/a.png')).toBe(true);
    expect(isRemoteUrl('//cdn.example/a.png')).toBe(true);
  });

  it('treats relative paths and rooted paths as local', () => {
    expect(isRemoteUrl('./a.png')).toBe(false);
    expect(isRemoteUrl('a.png')).toBe(false);
    expect(isRemoteUrl('/a.png')).toBe(false);
  });
});

describe('renderInline', () => {
  it('blocks javascript: protocol links', () => {
    expect(renderInline('[evil](javascript:alert(1))')).toBe('evil');
  });

  it('renders safe http links', () => {
    expect(renderInline('[x](https://example.com)')).toBe('<a href="https://example.com">x</a>');
  });

  it('strips data: images', () => {
    expect(renderInline('![a](data:image/png;base64,abc)')).toBe('a');
  });
});

describe('markdownToStorage', () => {
  it('converts headings', () => {
    const { html } = markdownToStorage('# Title\n## Sub');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<h2>Sub</h2>');
  });

  it('escapes raw HTML in body text', () => {
    const { html } = markdownToStorage('<script>alert(1)</script>');
    expect(html).toContain(LT_ENTITY + 'script' + GT_ENTITY);
    expect(html).not.toContain('<script>');
  });

  it('renders fenced code blocks as code macros with CDATA escaping', () => {
    const { html } = markdownToStorage('```js\nif (x) { y(); }\n```');
    expect(html).toContain('<ac:structured-macro ac:name="code"');
    expect(html).toContain('<ac:parameter ac:name="language">js</ac:parameter>');
    expect(html).toContain('<![CDATA[if (x) { y(); }]]>');
  });

  it('neutralizes the CDATA terminator inside code blocks', () => {
    const { html } = markdownToStorage('```\nfoo ]]> bar\n```');
    expect(html).toContain('foo ]]]]><![CDATA[> bar');
    expect(html).not.toContain('foo ]]> bar');
  });

  it('renders unordered lists', () => {
    const { html } = markdownToStorage('- a\n- b\n- c');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>a</li>');
    expect(html).toContain('<li>c</li>');
    expect(html).toContain('</ul>');
  });

  it('renders ordered lists', () => {
    const { html } = markdownToStorage('1. a\n2. b');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>a</li>');
    expect(html).toContain('<li>b</li>');
  });

  it('renders blockquotes', () => {
    const { html } = markdownToStorage('> quoted');
    expect(html).toContain('<blockquote>quoted</blockquote>');
  });

  it('emits local-image placeholders with the data-local-src marker', () => {
    const { html } = markdownToStorage('![alt](./images/a.png)');
    expect(html).toContain('<ac:image data-local-src="./images/a.png"></ac:image>');
  });

  it('emits remote images as ri:url macros', () => {
    const { html } = markdownToStorage('![alt](https://example.com/a.png)');
    expect(html).toContain('<ri:url ri:value="https://example.com/a.png"');
  });

  it('rejects javascript: protocol images', () => {
    const { html } = markdownToStorage('![alt](javascript:alert(1))');
    expect(html).toBe('<p>alt</p>');
  });

  it('emits a placeholder macro for ```mermaid fenced blocks and exposes the source', () => {
    const md = '```mermaid\ngraph TD\nA-->B\n```';
    const { html, mermaidBlocks } = markdownToStorage(md);
    expect(html).toContain(
      '<ac:structured-macro ac:name="mermaid-placeholder" data-mermaid-id="mermaid-1"></ac:structured-macro>',
    );
    expect(mermaidBlocks).toEqual([{ id: 'mermaid-1', source: 'graph TD\nA-->B' }]);
  });

  it('numbers mermaid block ids sequentially when multiple are present', () => {
    const md = '```mermaid\ngraph TD\nA-->B\n```\n\ntext\n\n```mermaid\nflowchart LR\nA-->B\n```';
    const { mermaidBlocks } = markdownToStorage(md);
    expect(mermaidBlocks.map((b) => b.id)).toEqual(['mermaid-1', 'mermaid-2']);
  });

  it('still renders non-mermaid fenced blocks as code macros', () => {
    const { html, mermaidBlocks } = markdownToStorage('```js\nif (x) { y(); }\n```');
    expect(html).toContain('<ac:structured-macro ac:name="code"');
    expect(html).toContain('<ac:parameter ac:name="language">js</ac:parameter>');
    expect(mermaidBlocks).toEqual([]);
  });

  it('joins consecutive non-empty lines in a single paragraph via <br />', () => {
    const { html } = markdownToStorage('line1\nline2');
    expect(html).toBe('<p>line1<br />line2</p>');
  });

  it('strips Docusaurus/YAML frontmatter before converting', () => {
    const md = `---
title: Failed Deployments
sidebar_label: Failed Deployments
sidebar_position: 4
---

# Failed Deployments

body content here`;
    const { html, mermaidBlocks } = markdownToStorage(md);
    expect(html).toContain('<h1>Failed Deployments</h1>');
    expect(html).toContain('<p>body content here</p>');
    expect(html).not.toContain('sidebar_label');
    expect(html).not.toContain('sidebar_position');
    expect(mermaidBlocks).toEqual([]);
  });

  it('strips frontmatter closed by ...', () => {
    const { html } = markdownToStorage('---\nkey: val\n...\n\ntext');
    expect(html).toBe('<p>text</p>');
  });

  it('leaves non-frontmatter leading ---（thematic break） content intact', () => {
    const { html } = markdownToStorage('paragraph\n\n---\n\ntail');
    expect(html).toContain('<p>paragraph</p>');
    expect(html).toContain('<hr />');
    expect(html).toContain('tail');
  });

  it('does not treat an unclosed opening --- as frontmatter', () => {
    const { html } = markdownToStorage('---\nnot closed\nstill here');
    expect(html).toContain('still here');
    expect(html).toContain('not closed');
  });
});
