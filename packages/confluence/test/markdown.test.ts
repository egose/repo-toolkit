import { describe, expect, it } from 'vitest';

import {
  markdownToStorage,
  escapeAttachmentFilename,
  escapeHtml,
  escapeXmlAttribute,
  isRemoteUrl,
  isAllowedUrl,
  renderInline,
  renderHtmlBlock,
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

  it('defaults ```html fenced blocks to a code macro (renderHtmlBlocks off)', () => {
    const { html } = markdownToStorage('```html\n<div>hi</div>\n```');
    expect(html).toContain('<ac:structured-macro ac:name="code"');
    expect(html).toContain('<ac:parameter ac:name="language">html</ac:parameter>');
    expect(html).toContain('<![CDATA[<div>hi</div>]]>');
    expect(html).not.toContain('ac:name="html"');
  });

  it('emits the html macro for ```html fenced blocks when renderHtmlBlocks is on', () => {
    const { html, mermaidBlocks } = markdownToStorage('```html\n<div>hi</div>\n```', {
      renderHtmlBlocks: true,
    });
    expect(html).toContain('<ac:structured-macro ac:name="html"');
    expect(html).not.toContain('ac:name="code"');
    expect(html).toContain('<![CDATA[<div>hi</div>]]>');
    expect(mermaidBlocks).toEqual([]);
  });

  it('escapes CDATA terminators inside html macro bodies', () => {
    const { html } = markdownToStorage('```html\nfoo ]]> bar\n```', { renderHtmlBlocks: true });
    expect(html).toContain('foo ]]]]><![CDATA[> bar');
    expect(html).not.toContain('foo ]]> bar');
  });

  it('renderHtmlBlock produces the html macro with a CDATA body', () => {
    expect(renderHtmlBlock('<p>x</p>')).toBe(
      '<ac:structured-macro ac:name="html"><ac:plain-text-body><![CDATA[<p>x</p>]]></ac:plain-text-body></ac:structured-macro>',
    );
  });

  it('renderHtmlBlock neutralizes CDATA terminators', () => {
    expect(renderHtmlBlock('a ]]> b')).toContain('a ]]]]><![CDATA[> b');
  });

  it('non-html fenced blocks remain code macros even with renderHtmlBlocks on', () => {
    const { html } = markdownToStorage('```js\nif (x) { y(); }\n```', { renderHtmlBlocks: true });
    expect(html).toContain('<ac:structured-macro ac:name="code"');
    expect(html).toContain('<ac:parameter ac:name="language">js</ac:parameter>');
    expect(html).not.toContain('ac:name="html"');
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

function assertWellFormedXhtml(html: string): void {
  const tagStack: string[] = [];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9:]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  let lastIndex = 0;
  while ((m = tagRe.exec(html)) !== null) {
    const between = html.slice(lastIndex, m.index);
    if (/<[^!]|&(?!#?\d+;|amp;|lt;|gt;|quot;|apos;)/.test(between)) {
      throw new Error(`stray markup/entity in text run: ${JSON.stringify(between)}`);
    }
    const [whole, name, , selfClose] = m;
    const isClose = whole.startsWith('</');
    if (isClose) {
      const top = tagStack.pop();
      if (top !== name) {
        throw new Error(`mismatched close </${name}>; stack had ${top} in ${html}`);
      }
    } else if (selfClose !== '/') {
      tagStack.push(name);
    }
    lastIndex = tagRe.lastIndex;
  }
  const tail = html.slice(lastIndex);
  if (tail.includes('<')) {
    throw new Error(`trailing stray < in tail: ${JSON.stringify(tail)}`);
  }
  if (tagStack.length > 0) {
    throw new Error(`unclosed tags ${tagStack.join(',')} in ${html}`);
  }
}

function expectWellFormed(html: string): void {
  expect(() => assertWellFormedXhtml(html)).not.toThrow();
}

describe('renderInline — inline code protection', () => {
  it('does not process Markdown inside inline code', () => {
    expect(renderInline('`*not italic*`')).toBe('<code>*not italic*</code>');
    expect(renderInline('`[not a link](https://x)`')).toBe('<code>[not a link](https://x)</code>');
    expect(renderInline('`a & b < c`')).toBe('<code>a ' + AMP_ENTITY + ' b ' + LT_ENTITY + ' c</code>');
  });

  it('does not process Markdown inside balanced longer backtick runs', () => {
    expect(renderInline('``a ` b``')).toBe('<code>a ` b</code>');
    expect(renderInline('```x```')).toBe('<code>x</code>');
  });

  it('strips one leading and trailing space when both surround code content', () => {
    expect(renderInline('` a `')).toBe('<code>a</code>');
    expect(renderInline('`  a  `')).toBe('<code> a </code>');
  });

  it('leaves an unmatched single backtick as literal text', () => {
    expect(renderInline('`unclosed')).toBe('`unclosed');
    expect(renderInline('a ` b ` c')).toBe('a <code>b</code> c');
  });

  it('renders emphasis and links around code spans without corrupting them', () => {
    expect(renderInline('*a `code` b*')).toBe('<em>a <code>code</code> b</em>');
    expect(renderInline('[see `code`](https://x.com)')).toBe('<a href="https://x.com">see <code>code</code></a>');
  });
});

describe('renderInline — emphasis', () => {
  it('renders **strong** and __strong__', () => {
    expect(renderInline('**bold**')).toBe('<strong>bold</strong>');
    expect(renderInline('__bold__')).toBe('<strong>bold</strong>');
  });

  it('renders *em* and _em_', () => {
    expect(renderInline('*italic*')).toBe('<em>italic</em>');
    expect(renderInline('_italic_')).toBe('<em>italic</em>');
  });

  it('renders nested emphasis **out *in* out**', () => {
    expect(renderInline('**a *b* c**')).toBe('<strong>a <em>b</em> c</strong>');
  });

  it('does not emphasis intraword underscores that flank letters', () => {
    expect(renderInline('snake_case_name')).toBe('snake_case_name');
    expect(renderInline('a_b_c')).toBe('a_b_c');
  });

  it('does not treat bare * as emphasis when surrounded by spaces', () => {
    expect(renderInline('a * b')).toBe('a * b');
    expect(renderInline('a ** b')).toBe('a ** b');
  });

  it('leaves unmatched emphasis markers as literal', () => {
    expect(renderInline('*unclosed')).toBe('*unclosed');
    expect(renderInline('**bold')).toBe('**bold');
  });

  it('escapes the marker when an opener cannot find a same-run close', () => {
    expect(renderInline('**a *b**')).toBe('<strong>a *b</strong>');
  });
});

describe('renderInline — links', () => {
  it('renders links with balanced nested parentheses in the URL', () => {
    expect(renderInline('[x](https://en.wikipedia.org/wiki/Foo_(bar))')).toBe(
      '<a href="https://en.wikipedia.org/wiki/Foo_(bar)">x</a>',
    );
  });

  it('renders links with complex query/fragment URLs (escaping & in href)', () => {
    const url = 'https://example.com/a/b?x=1&y=2#frag-ment';
    const expectedHref = 'https://example.com/a/b?x=1' + AMP_ENTITY + 'y=2#frag-ment';
    expect(renderInline('[label](' + url + ')')).toBe('<a href="' + expectedHref + '">label</a>');
  });

  it('renders nested emphasis inside link labels', () => {
    expect(renderInline('[*a* **b**](https://x.com)')).toBe(
      '<a href="https://x.com"><em>a</em> <strong>b</strong></a>',
    );
  });

  it('renders nested code spans inside link labels', () => {
    expect(renderInline('[see `x`](https://x.com)')).toBe('<a href="https://x.com">see <code>x</code></a>');
  });

  it('rejects javascript: links at any casing; interior controls prevent link parsing entirely', () => {
    expect(renderInline('[x](javascript:alert(1))')).toBe('x');
    expect(renderInline('[x](JavaScript:alert(1))')).toBe('x');
    expect(renderInline('[x](JAVASCRIPT:alert(1))')).toBe('x');
    const tabbed = renderInline('[x](java\tscript:alert(1))');
    expect(tabbed).not.toContain('<a ');
    const soh = renderInline('[x](java\u0001script:alert(1))');
    expect(soh).not.toContain('<a ');
    expect(soh).not.toContain('href');
  });

  it('rejects data:, file:, and vbscript: links', () => {
    expect(renderInline('[x](data:text/html,<script>)')).toBe('x');
    expect(renderInline('[x](file:///etc/passwd)')).toBe('x');
    expect(renderInline('[x](vbscript:msgbox)')).toBe('x');
  });

  it('rejects custom schemes outside the allowlist', () => {
    expect(renderInline('[x](myapp:launch)')).toBe('x');
    expect(renderInline('[x](blob:https://x)')).toBe('x');
  });

  it('rejects percent-encoded blocked schemes', () => {
    expect(renderInline('[x](java%73cript:alert(1))')).toBe('x');
  });

  it('allows http, https, mailto, and tel schemes', () => {
    expect(renderInline('[a](https://x.com)')).toBe('<a href="https://x.com">a</a>');
    expect(renderInline('[a](http://x.com)')).toBe('<a href="http://x.com">a</a>');
    expect(renderInline('[a](mailto:a@b.com)')).toBe('<a href="mailto:a@b.com">a</a>');
    expect(renderInline('[a](tel:+15551234)')).toBe('<a href="tel:+15551234">a</a>');
  });

  it('allows protocol-relative and server-relative URLs without a scheme', () => {
    expect(renderInline('[a](//cdn.example/x)')).toBe('<a href="//cdn.example/x">a</a>');
    expect(renderInline('[a](/abs/path)')).toBe('<a href="/abs/path">a</a>');
    expect(renderInline('[a](relative/path)')).toBe('<a href="relative/path">a</a>');
  });

  it('rejects URLs containing C0/DEL control characters', () => {
    expect(renderInline('[x](https://a\u0007b.com)')).toBe('x');
    expect(renderInline('[x](https://a\u007fb.com)')).toBe('x');
    const newline = renderInline('[x](https://a\nb)');
    expect(newline).not.toContain('<a ');
    expect(newline).not.toContain('href');
  });

  it('treats backslash escapes inside link labels as literal characters', () => {
    const { html } = markdownToStorage('[a\\]b](https://x.com)');
    expect(html).toContain('https://x.com');
  });
});

describe('renderInline — escaped punctuation', () => {
  it('disarms emphasis markers with backslash escapes', () => {
    expect(renderInline('\\*not italic\\*')).toBe('*not italic*');
    expect(renderInline('\\_not italic\\_')).toBe('_not italic_');
  });

  it('preserves backslashes that are not followed by punctuation', () => {
    expect(renderInline('a \\ b')).toBe('a \\ b');
    expect(renderInline('C:\\Users\\x')).toBe('C:\\Users\\x');
  });

  it('escapes raw HTML in inline text exactly once', () => {
    expect(renderInline('<b>x</b>')).toBe(LT_ENTITY + 'b' + GT_ENTITY + 'x' + LT_ENTITY + '/b' + GT_ENTITY);
    expect(renderInline('a & b')).toBe('a ' + AMP_ENTITY + ' b');
    expect(renderInline('"q" and \'s\'')).toBe(
      QUOT_ENTITY + 'q' + QUOT_ENTITY + ' and ' + APOS_ENTITY + 's' + APOS_ENTITY,
    );
  });
});

describe('isAllowedUrl — URL policy', () => {
  it('allows the documented scheme allowlist', () => {
    expect(isAllowedUrl('https://x.com')).toBe(true);
    expect(isAllowedUrl('http://x.com')).toBe(true);
    expect(isAllowedUrl('mailto:a@b.com')).toBe(true);
    expect(isAllowedUrl('tel:+15551234')).toBe(true);
  });

  it('allows scheme-less relative and absolute-path URLs', () => {
    expect(isAllowedUrl('//cdn.example/x')).toBe(true);
    expect(isAllowedUrl('/abs/path')).toBe(true);
    expect(isAllowedUrl('relative/path')).toBe(true);
    expect(isAllowedUrl('#fragment')).toBe(true);
    expect(isAllowedUrl('?query=1')).toBe(true);
  });

  it('rejects blocked schemes regardless of case', () => {
    expect(isAllowedUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedUrl('JavaScript:alert(1)')).toBe(false);
    expect(isAllowedUrl('DATA:text/html,x')).toBe(false);
    expect(isAllowedUrl('file:///etc/passwd')).toBe(false);
    expect(isAllowedUrl('vbscript:msgbox')).toBe(false);
  });

  it('rejects custom schemes', () => {
    expect(isAllowedUrl('myapp:launch')).toBe(false);
    expect(isAllowedUrl('blob:https://x')).toBe(false);
    expect(isAllowedUrl('intent://x')).toBe(false);
  });

  it('rejects control characters anywhere in the URL (including obfuscation attempts)', () => {
    expect(isAllowedUrl('https://x\u0000.com')).toBe(false);
    expect(isAllowedUrl('https://x\n.com')).toBe(false);
    expect(isAllowedUrl('https://x\u007f.com')).toBe(false);
    expect(isAllowedUrl('java\tscript:alert(1)')).toBe(false);
    expect(isAllowedUrl('java\u0001script:alert(1)')).toBe(false);
  });

  it('rejects the empty URL', () => {
    expect(isAllowedUrl('')).toBe(false);
  });
});

describe('markdownToStorage — XML well-formedness of generated bodies', () => {
  const corpus = [
    '# Title\n## Sub\n### Deep',
    '<script>alert(1)</script>',
    '```js\nif (x) { y(); }\n```',
    '```\nfoo ]]> bar\n```',
    '```html\n<div>hi</div>\n```',
    '```html\n<div>hi</div>\n```',
    '- a\n- b\n- c',
    '1. a\n2. b',
    '> quoted **bold** *em* `code`',
    '![alt](./images/a.png)',
    '![alt](https://example.com/a.png)',
    '![alt](javascript:alert(1))',
    '```mermaid\ngraph TD\nA-->B\n```',
    'line1\nline2',
    '---\nkey: val\n...\n\ntext',
    'paragraph\n\n---\n\ntail',
    'a `code` *em* **strong** [link](https://x.com) ![img](https://x.com/y.png)',
    'silent **[Misaligned](mailto://x)** underscore `_` and *emph*',
    'Mixed: `*code*` then *em* then **strong with `inline code`**',
    'Complex link: [wiki](https://en.wikipedia.org/wiki/Foo_(bar)) and [q](https://x.com/a?b=1&c=2#frag)',
  ];
  for (const md of corpus) {
    it(`produces well-formed XHTML for: ${md.slice(0, 50)}`, () => {
      const { html } = markdownToStorage(md, { renderHtmlBlocks: true });
      expectWellFormed(html);
      expect(html).not.toContain('<script>');
    });
    it(`produces well-formed XHTML with renderHtmlBlocks off for: ${md.slice(0, 50)}`, () => {
      const { html } = markdownToStorage(md);
      expectWellFormed(html);
    });
  }
});

describe('markdownToStorage — determinism', () => {
  it('renders the same input twice to identical output', () => {
    const md = '```js\nconst x = `a`;\n```\n\n*emph* **strong** [l](https://x.com)';
    const a = markdownToStorage(md);
    const b = markdownToStorage(md);
    expect(a).toEqual(b);
  });

  it('renders mixed lists + fences + blockquotes deterministically', () => {
    const md = [
      '# H1',
      '',
      '- item one',
      '- item **two**',
      '',
      '> quote `code`',
      '',
      '```ts',
      'const y: number = 1;',
      '```',
      '',
      '1. first',
      '2. second *em*',
    ].join('\n');
    const a = markdownToStorage(md);
    const b = markdownToStorage(md);
    expect(a).toEqual(b);
    expectWellFormed(a.html);
  });
});
