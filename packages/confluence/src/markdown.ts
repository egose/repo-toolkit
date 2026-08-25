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

export interface MarkdownConvertOptions {
  /** Render ```html fenced blocks as inline HTML via the Confluence `html` macro instead of a code box. Default: false. */
  renderHtmlBlocks?: boolean;
}

const AMP = '&' + 'amp;';
const LT = '&' + 'lt;';
const GT = '&' + 'gt;';
const QUOT = '&' + 'quot;';
const APOS = '&' + '#' + '39;';

const HTTP_SRE = /^(https?:)?\/\//i;
const ABSOLUTE_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const BLOCKED_SCHEMES = new Set(['javascript', 'data', 'file', 'vbscript']);
const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

function schemeOf(url: string): string | null {
  const match = ABSOLUTE_SCHEME_RE.exec(url);
  if (!match) {
    return null;
  }
  return match[0].slice(0, -1).toLowerCase();
}

function decodedSchemeOrNull(url: string): string | null {
  const match = ABSOLUTE_SCHEME_RE.exec(url);
  if (!match) {
    return null;
  }
  const rawScheme = match[0].slice(0, -1);
  try {
    return decodeURIComponent(rawScheme).toLowerCase();
  } catch {
    return rawScheme.toLowerCase();
  }
}

export function isAllowedUrl(url: string): boolean {
  if (url.length === 0) {
    return false;
  }
  for (let i = 0; i < url.length; i += 1) {
    const code = url.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }
  const scheme = schemeOf(url);
  if (scheme === null) {
    return HTTP_SRE.test(url) || /^[/?#]/.test(url) || !/:/.test(url);
  }
  const decoded = decodedSchemeOrNull(url) ?? scheme;
  if (BLOCKED_SCHEMES.has(scheme) || BLOCKED_SCHEMES.has(decoded)) {
    return false;
  }
  return ALLOWED_SCHEMES.has(scheme);
}

const MERMAID_PLACEHOLDER_PREFIX = '<ac:structured-macro ac:name="mermaid-placeholder" data-mermaid-id="';
const MERMAID_PLACEHOLDER_RE_STRICT =
  /<ac:structured-macro ac:name="mermaid-placeholder" data-mermaid-id="([^"]+)"><\/ac:structured-macro>/g;

export function mermaidPlaceholderRe(): RegExp {
  return new RegExp(MERMAID_PLACEHOLDER_RE_STRICT.source, 'g');
}

export function renderMermaidPlaceholder(id: string): string {
  return `${MERMAID_PLACEHOLDER_PREFIX}${escapeXmlAttribute(id)}"></ac:structured-macro>`;
}

export function markdownToStorage(markdown: string, options: MarkdownConvertOptions = {}): MarkdownConvertResult {
  const renderHtmlBlocks = options.renderHtmlBlocks === true;
  let lines = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  if (lines.length > 0 && lines[0] === '---') {
    let closeIndex = -1;
    for (let j = 1; j < lines.length; j += 1) {
      if (lines[j] === '---' || lines[j] === '...') {
        closeIndex = j;
        break;
      }
    }
    if (closeIndex !== -1) {
      lines = lines.slice(closeIndex + 1);
    }
  }

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
      } else if (lang === 'html' && renderHtmlBlocks) {
        out.push(renderHtmlBlock(code));
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

    if (isTableStart(lines, i)) {
      const tableLines: string[] = [];
      while (i < lines.length && typeof lines[i] === 'string' && isTableRow(lines[i] as string)) {
        tableLines.push(lines[i] as string);
        i += 1;
      }
      out.push(renderTable(tableLines));
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
      !isTableStart(lines, i) &&
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

export function renderHtmlBlock(code: string): string {
  return `<ac:structured-macro ac:name="html"><ac:plain-text-body><![CDATA[${escapeCdataTerminator(code)}]]></ac:plain-text-body></ac:structured-macro>`;
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

function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index];
  const separator = lines[index + 1];
  if (typeof header !== 'string' || typeof separator !== 'string') {
    return false;
  }
  if (!isTableRow(header) || !isTableSeparator(separator)) {
    return false;
  }
  return splitTableRow(header).length === splitTableRow(separator).length;
}

function isTableRow(line: string): boolean {
  return /^\s{0,3}\|/.test(line) && splitTableRow(line).length > 1;
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  if (cells.length < 2) {
    return false;
  }
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  const start = trimmed.startsWith('|') ? 1 : 0;
  const end =
    trimmed.endsWith('|') && !isEscapedPipe(trimmed, trimmed.length - 1) ? trimmed.length - 1 : trimmed.length;
  const cells: string[] = [];
  let cellStart = start;
  for (let i = start; i < end; i += 1) {
    if (trimmed[i] === '|' && !isEscapedPipe(trimmed, i)) {
      cells.push(unescapeTableCell(trimmed.slice(cellStart, i).trim()));
      cellStart = i + 1;
    }
  }
  cells.push(unescapeTableCell(trimmed.slice(cellStart, end).trim()));
  return cells;
}

function isEscapedPipe(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function unescapeTableCell(cell: string): string {
  return cell.replace(/\\\|/g, '|');
}

function renderTable(tableLines: string[]): string {
  const rows = tableLines.filter((_, index) => index !== 1).map(splitTableRow);
  const body = rows
    .map((cells, rowIndex) => {
      const tag = rowIndex === 0 ? 'th' : 'td';
      return '<tr>' + cells.map((cell) => '<' + tag + '>' + renderInline(cell) + '</' + tag + '>').join('') + '</tr>';
    })
    .join('');
  return '<table><tbody>' + body + '</tbody></table>';
}

export function renderInline(text: string): string {
  const out: string[] = [];
  const tokens = tokenizeInline(text, 0, text.length);
  renderTokens(text, tokens, out);
  return out.join('');
}

type InlineToken =
  | { kind: 'text'; start: number; end: number }
  | { kind: 'code'; contentStart: number; contentEnd: number }
  | { kind: 'link'; labelStart: number; labelEnd: number; url: string }
  | { kind: 'image'; labelStart: number; labelEnd: number; url: string }
  | { kind: 'delimiter'; marker: '*' | '_'; runLength: number; canOpen: boolean; canClose: boolean };

function renderTokens(text: string, tokens: InlineToken[], out: string[]): void {
  renderTokenRange(text, tokens, 0, tokens.length, out);
}

function renderTokenRange(text: string, tokens: InlineToken[], from: number, to: number, out: string[]): void {
  for (let i = from; i < to; i += 1) {
    const open = tokens[i];
    if (open.kind !== 'delimiter' || !open.canOpen) {
      out.push(renderSingleToken(text, open));
      continue;
    }
    const closeIdx = findEmphasisClose(tokens, i, to, open);
    if (closeIdx === -1) {
      out.push(renderSingleToken(text, open));
      continue;
    }
    const tag = open.runLength === 1 ? 'em' : 'strong';
    const innerOut: string[] = [];
    renderTokenRange(text, tokens, i + 1, closeIdx, innerOut);
    out.push('<' + tag + '>' + innerOut.join('') + '</' + tag + '>');
    i = closeIdx;
  }
}

function renderSingleToken(text: string, token: InlineToken): string {
  if (token.kind === 'text') {
    return token.end > token.start ? escapeHtml(text.slice(token.start, token.end)) : '';
  }
  if (token.kind === 'code') {
    return '<code>' + escapeHtml(text.slice(token.contentStart, token.contentEnd)) + '</code>';
  }
  if (token.kind === 'image') {
    return renderImageToken(text, token);
  }
  if (token.kind === 'link') {
    return renderLinkToken(text, token);
  }
  return escapeHtml(token.marker.repeat(token.runLength));
}

function renderImageToken(text: string, token: Extract<InlineToken, { kind: 'image' }>): string {
  const labelRaw = text.slice(token.labelStart, token.labelEnd);
  if (!isAllowedUrl(token.url)) {
    return escapeHtml(labelRaw);
  }
  if (!isRemoteUrl(token.url)) {
    return '<ac:image data-local-src="' + escapeXmlAttribute(token.url) + '"></ac:image>';
  }
  const alt = renderInline(labelRaw);
  return '<ac:image><ri:url ri:value="' + escapeXmlAttribute(token.url) + '" />' + alt + '</ac:image>';
}

function renderLinkToken(text: string, token: Extract<InlineToken, { kind: 'link' }>): string {
  const labelRaw = text.slice(token.labelStart, token.labelEnd);
  if (!isAllowedUrl(token.url)) {
    return renderInline(labelRaw);
  }
  return '<a href="' + escapeXmlAttribute(token.url) + '">' + renderInline(labelRaw) + '</a>';
}

function findEmphasisClose(
  tokens: InlineToken[],
  openIdx: number,
  to: number,
  open: { marker: '*' | '_'; runLength: number },
): number {
  let depth = 0;
  for (let i = openIdx + 1; i < to; i += 1) {
    const t = tokens[i];
    if (t.kind !== 'delimiter') {
      continue;
    }
    const m: '*' | '_' = t.marker;
    if (m === open.marker && t.runLength === open.runLength && t.canOpen && !t.canClose) {
      depth += 1;
    } else if (m === open.marker && t.runLength === open.runLength && t.canClose) {
      if (depth === 0) {
        return i;
      }
      depth -= 1;
    }
  }
  return -1;
}

function tokenizeInline(text: string, start: number, end: number): InlineToken[] {
  const tokens: InlineToken[] = [];
  let cursor = start;
  let textStart = start;
  const flushText = (stop: number): void => {
    if (stop > textStart) {
      tokens.push({ kind: 'text', start: textStart, end: stop });
    }
    textStart = stop;
  };

  while (cursor < end) {
    const ch = text[cursor];

    if (ch === '\\' && cursor + 1 < end && isAsciiPunctuation(text.charCodeAt(cursor + 1))) {
      flushText(cursor);
      tokens.push({ kind: 'text', start: cursor + 1, end: cursor + 2 });
      cursor += 2;
      textStart = cursor;
      continue;
    }

    if (ch === '`') {
      const codeSpan = scanInlineCode(text, cursor, end);
      if (codeSpan) {
        flushText(cursor);
        tokens.push({ kind: 'code', contentStart: codeSpan.contentStart, contentEnd: codeSpan.contentEnd });
        cursor = codeSpan.nextCursor;
        textStart = cursor;
        continue;
      }
      cursor += 1;
      continue;
    }

    if (ch === '!' && cursor + 1 < end && text[cursor + 1] === '[') {
      const link = tryParseLink(text, cursor + 1, end);
      if (link) {
        flushText(cursor);
        tokens.push({ kind: 'image', labelStart: cursor + 2, labelEnd: link.labelEnd, url: link.url });
        cursor = link.nextCursor;
        textStart = cursor;
        continue;
      }
    }

    if (ch === '[') {
      const link = tryParseLink(text, cursor, end);
      if (link) {
        flushText(cursor);
        tokens.push({ kind: 'link', labelStart: cursor + 1, labelEnd: link.labelEnd, url: link.url });
        cursor = link.nextCursor;
        textStart = cursor;
        continue;
      }
    }

    if (ch === '*' || ch === '_') {
      let runEnd = cursor;
      while (runEnd < end && text[runEnd] === ch) {
        runEnd += 1;
      }
      const runLength = runEnd - cursor;
      const beforeCode = cursor === start ? -1 : text.charCodeAt(cursor - 1);
      const afterCode = runEnd === end ? -1 : text.charCodeAt(runEnd);
      const beforeIsSpace = beforeCode === -1 || isInlineWhitespace(beforeCode);
      const afterIsSpace = afterCode === -1 || isInlineWhitespace(afterCode);
      const leftFlanking = !afterIsSpace;
      const rightFlanking = !beforeIsSpace;
      let canOpen: boolean;
      let canClose: boolean;
      if (ch === '_') {
        const beforeIsPunct = beforeCode !== -1 && isAsciiPunctuation(beforeCode);
        const afterIsPunct = afterCode !== -1 && isAsciiPunctuation(afterCode);
        canOpen = leftFlanking && (!rightFlanking || afterIsPunct);
        canClose = rightFlanking && (!leftFlanking || beforeIsPunct);
      } else {
        canOpen = leftFlanking;
        canClose = rightFlanking;
      }
      flushText(cursor);
      const m: '*' | '_' = ch;
      tokens.push({ kind: 'delimiter', marker: m, runLength, canOpen, canClose });
      cursor = runEnd;
      textStart = cursor;
      continue;
    }

    cursor += 1;
  }

  flushText(end);
  return tokens;
}

function scanInlineCode(
  text: string,
  start: number,
  end: number,
): { contentStart: number; contentEnd: number; nextCursor: number } | null {
  let openEnd = start;
  while (openEnd < end && text[openEnd] === '`') {
    openEnd += 1;
  }
  const openRun = openEnd - start;
  let closeStart = -1;
  let search = openEnd;
  while (search < end) {
    if (text[search] !== '`') {
      search += 1;
      continue;
    }
    let runEnd = search;
    while (runEnd < end && text[runEnd] === '`') {
      runEnd += 1;
    }
    if (runEnd - search === openRun) {
      closeStart = search;
      break;
    }
    search = runEnd;
  }
  if (closeStart === -1) {
    return null;
  }
  let contentStart = openEnd;
  let contentEnd = closeStart;
  if (contentEnd - contentStart >= 2 && text[contentStart] === ' ' && text[contentEnd - 1] === ' ') {
    contentStart += 1;
    contentEnd -= 1;
  }
  return { contentStart, contentEnd, nextCursor: closeStart + openRun };
}

function isInlineWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isAsciiPunctuation(code: number): boolean {
  return (
    (code >= 0x21 && code <= 0x2f) ||
    (code >= 0x3a && code <= 0x40) ||
    (code >= 0x5b && code <= 0x60) ||
    (code >= 0x7b && code <= 0x7e)
  );
}

function tryParseLink(
  text: string,
  bracketStart: number,
  end: number,
): { labelEnd: number; url: string; nextCursor: number } | null {
  let depth = 0;
  let i = bracketStart + 1;
  while (i < end) {
    const c = text[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '[') {
      depth += 1;
    } else if (c === ']') {
      if (depth === 0) {
        break;
      }
      depth -= 1;
    }
    i += 1;
  }
  if (i >= end || text[i] !== ']' || depth !== 0) {
    return null;
  }
  const labelEnd = i;
  if (i + 1 >= end || text[i + 1] !== '(') {
    return null;
  }
  let j = i + 2;
  let parenDepth = 0;
  while (j < end) {
    const c = text[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '(') {
      parenDepth += 1;
    } else if (c === ')') {
      if (parenDepth === 0) {
        const url = text.slice(i + 2, j).trim();
        if (url.length === 0) {
          return null;
        }
        return { labelEnd, url, nextCursor: j + 1 };
      }
      parenDepth -= 1;
    } else if (c === ' ' || c === '\t' || c === '\n') {
      return null;
    }
    j += 1;
  }
  return null;
}

export const LOCAL_IMAGE_PLACEHOLDER_RE = /<ac:image\s+data-local-src="([^"]*)"\s*><\/ac:image>/g;

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
