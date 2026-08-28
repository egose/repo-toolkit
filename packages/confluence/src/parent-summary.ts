import { escapeHtml, escapeXmlAttribute } from './markdown';

export const PARENT_SUMMARY_START_MARKER = '<!-- repo-toolkit-confluence:parent-summary:start -->';
export const PARENT_SUMMARY_END_MARKER = '<!-- repo-toolkit-confluence:parent-summary:end -->';

export interface ParentSummaryStats {
  markdownPages: number;
  directoryPages: number;
  totalPages: number;
  maxDepth: number;
  attachmentReferences: number;
  mermaidBlocks: number;
}

export interface ManagedPageRecord {
  relativePath: string;
  kind: 'directory' | 'leaf';
  title: string;
  pageId: string;
  depth: number;
  attachmentCount: number;
  mermaidCount: number;
}

export interface ParentSummaryInput {
  repositoryUrl: string;
  stats: ParentSummaryStats;
  pages: ReadonlyArray<ManagedPageRecord>;
}

function escapeCdata(text: string): string {
  return text.replace(/]]>/g, ']]]]><![CDATA[>');
}

function pageLink(pageId: string, title: string): string {
  const safeTitle = escapeCdata(title);
  return `<ac:link><ri:page ri:content-id="${escapeXmlAttribute(pageId)}" /><ac:plain-text-link-body><![CDATA[${safeTitle}]]></ac:plain-text-link-body></ac:link>`;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while (true) {
    const found = haystack.indexOf(needle, idx);
    if (found === -1) {
      break;
    }
    count += 1;
    idx = found + needle.length;
  }
  return count;
}

export function mergeParentSummaryBody(currentBody: string, generatedRegion: string): string {
  const startCount = countOccurrences(currentBody, PARENT_SUMMARY_START_MARKER);
  const endCount = countOccurrences(currentBody, PARENT_SUMMARY_END_MARKER);
  if (startCount === 0 && endCount === 0) {
    if (currentBody === '') {
      return generatedRegion;
    }
    const sep = currentBody.endsWith('\n') ? '' : '\n';
    return currentBody + sep + generatedRegion;
  }
  if (startCount === 1 && endCount === 1) {
    const startIdx = currentBody.indexOf(PARENT_SUMMARY_START_MARKER);
    const endIdx = currentBody.indexOf(PARENT_SUMMARY_END_MARKER);
    if (startIdx === -1 || endIdx === -1) {
      throw new Error('malformed parent summary markers: missing marker');
    }
    if (startIdx > endIdx) {
      throw new Error('malformed parent summary markers: start after end');
    }
    const before = currentBody.slice(0, startIdx);
    const after = currentBody.slice(endIdx + PARENT_SUMMARY_END_MARKER.length);
    if (
      countOccurrences(before, PARENT_SUMMARY_START_MARKER) !== 0 ||
      countOccurrences(before, PARENT_SUMMARY_END_MARKER) !== 0
    ) {
      throw new Error('malformed parent summary markers: duplicate marker before region');
    }
    if (
      countOccurrences(after, PARENT_SUMMARY_START_MARKER) !== 0 ||
      countOccurrences(after, PARENT_SUMMARY_END_MARKER) !== 0
    ) {
      throw new Error('malformed parent summary markers: duplicate marker after region');
    }
    return before + generatedRegion + after;
  }
  throw new Error('malformed or duplicate parent summary markers: expected 0 or 1 managed region');
}

export function renderParentSummary(input: ParentSummaryInput): string {
  const lines: string[] = [];
  lines.push(PARENT_SUMMARY_START_MARKER);
  lines.push('<h2>Synced documentation</h2>');
  if (input.repositoryUrl) {
    const url = escapeXmlAttribute(input.repositoryUrl);
    const text = escapeHtml(input.repositoryUrl);
    lines.push(`<p><em>This documentation subtree is synced from <a href="${url}">${text}</a>.</em></p>`);
  }
  lines.push('<h3>Statistics</h3>');
  lines.push('<ul>');
  lines.push(`<li>Markdown pages: ${input.stats.markdownPages}</li>`);
  lines.push(`<li>Directory pages: ${input.stats.directoryPages}</li>`);
  lines.push(`<li>Total managed pages: ${input.stats.totalPages}</li>`);
  lines.push(`<li>Maximum depth: ${input.stats.maxDepth}</li>`);
  lines.push(`<li>Attachment references: ${input.stats.attachmentReferences}</li>`);
  lines.push(`<li>Mermaid blocks: ${input.stats.mermaidBlocks}</li>`);
  lines.push('</ul>');
  lines.push('<h3>Pages</h3>');
  if (input.pages.length === 0) {
    lines.push('<p>No managed child pages</p>');
  } else {
    lines.push(renderTree(input.pages));
  }
  lines.push(PARENT_SUMMARY_END_MARKER);
  return lines.join('\n');
}

function renderTree(pages: ReadonlyArray<ManagedPageRecord>): string {
  const sorted = [...pages].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  type TreeNode = {
    record?: ManagedPageRecord;
    children: Map<string, TreeNode>;
    key: string;
  };
  const root: TreeNode = { children: new Map(), key: '' };
  for (const page of sorted) {
    const parts = page.relativePath.split('/');
    let node = root;
    let currentPath = '';
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i] ?? '';
      currentPath = currentPath ? currentPath + '/' + part : part;
      let child = node.children.get(part);
      if (!child) {
        child = { children: new Map(), key: part };
        node.children.set(part, child);
      }
      if (i === parts.length - 1) {
        child.record = page;
      }
      node = child;
    }
  }
  const renderNode = (node: TreeNode): string => {
    const entries = [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (entries.length === 0) {
      return '';
    }
    let html = '<ul>';
    for (const [, child] of entries) {
      const rec = child.record;
      if (rec) {
        const link = pageLink(rec.pageId, rec.title);
        const kindLabel = rec.kind === 'directory' ? 'directory' : 'page';
        const pathCode = `<code>${escapeHtml(rec.relativePath)}</code>`;
        const childrenHtml = renderNode(child);
        html += `<li>${link} ${pathCode} <em>(${kindLabel})</em>${childrenHtml}</li>`;
      } else {
        const childrenHtml = renderNode(child);
        html += `<li>${escapeHtml(child.key)}${childrenHtml}</li>`;
      }
    }
    html += '</ul>';
    return html;
  };
  return renderNode(root);
}

export function computeParentSummaryStats(
  entries: ReadonlyArray<{ segments: string[]; absolute: string }>,
  entryPlans: ReadonlyArray<{ attachments: ReadonlyArray<unknown>; mermaidBlocks: ReadonlyArray<unknown> }>,
  managedCount?: number,
): ParentSummaryStats {
  const markdownPages = entries.length;
  const dirSet = new Set<string>();
  let maxDepth = 0;
  let attachmentReferences = 0;
  let mermaidBlocks = 0;
  for (const entry of entries) {
    if (entry.segments.length > maxDepth) {
      maxDepth = entry.segments.length;
    }
    for (let i = 0; i < entry.segments.length - 1; i += 1) {
      const prefix = entry.segments.slice(0, i + 1).join('/');
      dirSet.add(prefix);
    }
  }
  for (const plan of entryPlans) {
    attachmentReferences += plan.attachments.length;
    mermaidBlocks += plan.mermaidBlocks.length;
  }
  const directoryPages = dirSet.size;
  const totalPages = managedCount !== undefined ? managedCount : directoryPages + markdownPages;
  return {
    markdownPages,
    directoryPages,
    totalPages,
    maxDepth,
    attachmentReferences,
    mermaidBlocks,
  };
}
