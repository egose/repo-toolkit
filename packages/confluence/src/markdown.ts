const STORAGE_LINE_BREAK = '<br />';
const LINE_BREAK_SENTINEL = '\u0001BR\u0001';

export interface MermaidBlock {
  id: string;
  source: string;
}

export interface MarkdownConvertResult {
  html: string;
  mermaidBlocks: MermaidBlock[];
}

const PROTOCOL_BLOCKLIST = /^(?:javascript|data|file|vbscript):/i;
const AMP = '&' + 'amp;';
const LT = '&' + 'lt;';
const GT = '&' + 'gt;';
const QUOT = '&' + 'quot;';
const APOS = '&' + '#' + '39;';

const MERMAID_PLACEHOLDER_PREFIX = '<ac:structured-macro ac:name="mermaid-placeholder" data-mermaid-id="';
const MERMAID_PLACEHOLDER_RE_STRICT =
  /<ac:structured-macro ac:name="mermaid-placeholder" data-mermaid-id="([^"]+)"><\/ac:structured-macro>/g;

export function mermaidPlaceholderRe(): RegExp {
  return new RegExp(MERMAID_PLACEHOLDER_RE_STRICT.source, 'g');
}

export function renderMermaidPlaceholder(id: string): string {
  return `${MERMAID_PLACEHOLDER_PREFIX}${escapeXmlAttribute(id)}"></ac:structured-macro>`;
}

export function markdownToStorage(markdown: string): MarkdownConvertResult {
  const lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const out: string[] = [];
  const mermaidBlocks: MermaidBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line === undefined || line === '') {
      i += 1;
      continue;
    }

    if (/^\s{0,3}#{1,6}\s/.test(line)) {
      out.push(renderHeading(line));
      i += 1;
      continue;
    }

    if (/^\s{0,3}```/.test(line)) {
      const fence = line;
      const lang = fence.trim().slice(3).trim();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s{0,3}```/.test(lines[i] ?? '')) {
        buf.push(lines[i] ?? '');
        i += 1;
      }
      i += 1;
      const code = buf.join('\n');
      if (lang === 'mermaid') {
        const id = `mermaid-${mermaidBlocks.length + 1}`;
        mermaidBlocks.push({ id, source: code });
        out.push(renderMermaidPlaceholder(id));
      } else {
        out.push(renderCodeBlock(code, lang));
      }
      continue;
    }

    if (/^\s{0,3}(?:-|\*|\+)\s+/.test(line) || /^\s{0,3}\d+\.\s+/.test(line)) {
      const listLines: string[] = [];
      while (
        i < lines.length &&
        typeof lines[i] === 'string' &&
        (/^\s{0,3}(?:-|\*|\+)\s+/.test(lines[i] as string) ||
          /^\s{0,3}\d+\.\s+/.test(lines[i] as string) ||
          (lines[i] as string).trim() === '')
      ) {
        if ((lines[i] as string).trim() === '' && isLikelyListTerminator(lines, i)) {
          break;
        }
        listLines.push(lines[i] as string);
        i += 1;
      }
      out.push(renderList(listLines));
      continue;
    }

    if (/^\s{0,3}>/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && typeof lines[i] === 'string' && /^\s{0,3}>/.test(lines[i] as string)) {
        quoteLines.push((lines[i] as string).replace(/^\s{0,3}>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${renderInline(quoteLines.join('\n'))}</blockquote>`);
      continue;
    }

    if (/^\s{0,3}---+\s*$/.test(line) || /^\s{0,3}\*\*\*+\s*$/.test(line)) {
      out.push('<hr />');
      i += 1;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      typeof lines[i] === 'string' &&
      (lines[i] as string).trim() !== '' &&
      !/^\s{0,3}#{1,6}\s/.test(lines[i] as string) &&
      !/^\s{0,3}```/.test(lines[i] as string) &&
      !/^\s{0,3}(?:-|\*|\+)\s+/.test(lines[i] as string) &&
      !/^\s{0,3}\d+\.\s+/.test(lines[i] as string) &&
      !/^\s{0,3}>/.test(lines[i] as string) &&
      !/^\s{0,3}---+\s*$/.test(lines[i] as string) &&
      !/^\s{0,3}\*\*\*+\s*$/.test(lines[i] as string)
    ) {
      para.push(lines[i] as string);
      i += 1;
    }
    const renderedPara = renderInline(para.join(LINE_BREAK_SENTINEL));
    out.push(`<p>${renderedPara.split(LINE_BREAK_SENTINEL).join(STORAGE_LINE_BREAK)}</p>`);
  }

  return { html: out.join('\n'), mermaidBlocks };
}

function isLikelyListTerminator(lines: string[], currentIndex: number): boolean {
  for (let k = currentIndex + 1; k < lines.length; k += 1) {
    const next = lines[k];
    if (next === undefined || next.trim() === '') {
      continue;
    }
    return !/^\s{0,3}(?:-|\*|\+)\s+/.test(next) && !/^\s{0,3}\d+\.\s+/.test(next);
  }
  return true;
}

function renderHeading(line: string): string {
  const match = /^(\s{0,3})(#{1,6})\s+(.*)$/.exec(line);
  if (!match) {
    return '';
  }
  const hashes = match[2];
  const level = hashes ? hashes.length : 1;
  const text = match[3];
  return `<h${level}>${renderInline(text)}</h${level}>`;
}

export function renderCodeBlock(code: string, _lang: string): string {
  const lang = _lang && /^[a-zA-Z0-9+-]+$/.test(_lang) ? _lang : 'none';
  const titleAttr = escapeXmlAttribute(lang);
  return `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">${titleAttr}</ac:parameter><ac:plain-text-body><![CDATA[${escapeCdataTerminator(code)}]]></ac:plain-text-body></ac:structured-macro>`;
}

function escapeCdataTerminator(text: string): string {
  return text.replace(/]]>/g, ']]]]><![CDATA[>');
}

function renderList(listLines: string[]): string {
  const items: string[] = [];
  let ordered = false;
  for (const raw of listLines) {
    if (raw.trim() === '') {
      continue;
    }
    const ulMatch = /^(\s{0,3})(?:-|\*|\+)\s+(.*)$/.exec(raw);
    const olMatch = /^(\s{0,3})(\d+)\.\s+(.*)$/.exec(raw);
    if (olMatch) {
      ordered = true;
      items.push(olMatch[3] ?? '');
    } else if (ulMatch) {
      items.push(ulMatch[2] ?? '');
    }
  }
  const tag = ordered ? 'ol' : 'ul';
  const body = items.map((item) => `<li>${renderInline(item)}</li>`).join('');
  return `<${tag}>${body}</${tag}>`;
}

export function renderInline(text: string): string {
  let s = text;
  s = escapeHtml(s);
  s = applyImages(s);
  s = applyLinks(s);
  s = applyStrong(s);
  s = applyInlineCode(s);
  return s;
}

function applyLinks(text: string): string {
  return replaceBalancedSyntax(text, /\[([^\]]+)\]\(/g, (label: string, url: string) => {
    if (PROTOCOL_BLOCKLIST.test(url)) {
      return label;
    }
    return '<a href="' + escapeXmlAttribute(url) + '">' + label + '</a>';
  });
}

function applyImages(text: string): string {
  return replaceBalancedSyntax(text, /!\[([^\]]*)\]\(/g, (alt: string, src: string) => {
    if (PROTOCOL_BLOCKLIST.test(src)) {
      return alt;
    }
    if (isRemoteUrl(src)) {
      return '<ac:image><ri:url ri:value="' + escapeXmlAttribute(src) + '" /></ac:image>';
    }
    return '<ac:image data-local-src="' + escapeXmlAttribute(src) + '"></ac:image>';
  });
}

function replaceBalancedSyntax(
  text: string,
  openerRe: RegExp,
  render: (captured: string, url: string) => string,
): string {
  let out = '';
  let cursor = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(openerRe.source, 'g');
  while ((m = re.exec(text)) !== null) {
    out += text.slice(cursor, m.index);
    const captured = m[1] ?? '';
    const after = text.slice(m.index + m[0].length);
    const scan = scanBalancedUrl(after);
    if (scan === null) {
      out += m[0];
      cursor = m.index + m[0].length;
      continue;
    }
    out += render(captured, scan.url);
    cursor = m.index + m[0].length + scan.consumed;
  }
  out += text.slice(cursor);
  return out;
}

function scanBalancedUrl(rest: string): { url: string; consumed: number } | null {
  let depth = 0;
  let i = 0;
  for (; i < rest.length; i += 1) {
    const ch = rest[i];
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      if (depth === 0) {
        const url = rest.slice(0, i);
        if (url.length === 0) {
          return null;
        }
        return { url, consumed: i + 1 };
      }
      depth -= 1;
    } else if (ch === ' ' || ch === '\t' || ch === '\n') {
      return null;
    }
  }
  return null;
}

export const LOCAL_IMAGE_PLACEHOLDER_RE = /<ac:image\s+data-local-src="([^"]*)"\s*><\/ac:image>/g;

function applyStrong(text: string): string {
  let s = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  return s.replace(/_([^_]+)_/g, '<em>$1</em>');
}

function applyInlineCode(text: string): string {
  return text.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`);
}

export function collectLocalImagePaths(markdown: string, baseDir: string): { src: string; abs: string }[] {
  const refs: { src: string; abs: string }[] = [];
  const seen = new Set<string>();
  const re = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    const src = match[2];
    if (!src || isRemoteUrl(src)) {
      continue;
    }
    if (seen.has(src)) {
      continue;
    }
    seen.add(src);
    refs.push({ src, abs: resolveDocRelative(baseDir, src) });
  }
  return refs;
}

export function resolveDocRelative(baseDir: string, src: string): string {
  if (src.startsWith('/')) {
    return src;
  }
  const sep = baseDir.endsWith('/') || baseDir === '' ? '' : '/';
  return baseDir + sep + src;
}

export function isRemoteUrl(src: string): boolean {
  return /^(https?:)?\/\//i.test(src) || /^\/\//.test(src);
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, AMP).replace(/</g, LT).replace(/>/g, GT).replace(/"/g, QUOT).replace(/'/g, APOS);
}

export function escapeXmlAttribute(text: string): string {
  return text.replace(/&/g, AMP).replace(/"/g, QUOT).replace(/</g, LT).replace(/>/g, GT);
}

export function escapeAttachmentFilename(filename: string): string {
  if (filename === '' || filename === '.' || filename === '..') {
    throw new Error('Invalid attachment filename');
  }
  const cleaned = filename.replace(/[/\\]/g, '_');
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    throw new Error('Invalid attachment filename');
  }
  return cleaned;
}
