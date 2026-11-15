// The normalized chapter model and its one serializer. html and text are produced from the same nodes in one pass,
// so the text always equals what a browser's textContent returns for the html: the reader computes highlight
// offsets from the DOM and the AI searches the text, and the two must agree character for character.

export const INLINE_NAMES = ['em', 'strong', 'sub', 'sup', 'ruby', 'rt'] as const;
export type InlineName = (typeof INLINE_NAMES)[number];

export interface TextNode {
  kind: 'text';
  text: string;
}

export interface InlineElement {
  kind: 'element';
  name: InlineName;
  children: InlineNode[];
}

export interface ImageNode {
  kind: 'image';
  key: string;
  alt: string;
}

export interface BreakNode {
  kind: 'break';
}

export type InlineNode = TextNode | InlineElement | ImageNode | BreakNode;
type Leaf = TextNode | ImageNode | BreakNode;

export type HeadingLevel = 2 | 3 | 4;

export type Block =
  | { kind: 'heading'; level: HeadingLevel; content: InlineNode[] }
  | { kind: 'paragraph'; content: InlineNode[] }
  | { kind: 'preformatted'; text: string }
  | { kind: 'rule' }
  | { kind: 'list'; ordered: boolean; items: InlineNode[][] }
  | { kind: 'quote'; paragraphs: InlineNode[][] };

// HTML collapses only ASCII whitespace; NBSP is folded in too so "&nbsp;&nbsp;" indents do not survive as text.
// The ideographic space U+3000 is deliberately not whitespace here: it is content in Chinese typesetting.
const WHITESPACE_RUN = /[\t\n\f\r  ]+/g;
// Control characters a browser drops or replaces (NUL becomes U+FFFD), so they would break html↔text equality.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g;
const LEADING_INDENT = /^[　 ]+/;

function sanitize(text: string): string {
  return text.replace(CONTROL_CHARACTERS, '').toWellFormed();
}

function leavesOf(nodes: InlineNode[], into: Leaf[] = []): Leaf[] {
  for (const node of nodes) {
    if (node.kind === 'element') {
      leavesOf(node.children, into);
    } else {
      into.push(node);
    }
  }
  return into;
}

function trimEnd(node: TextNode | null): void {
  if (node !== null && node.text.endsWith(' ')) {
    node.text = node.text.slice(0, -1);
  }
}

/** Collapses whitespace across inline boundaries and trims it at the block's edges and around line breaks. */
function collapseWhitespace(leaves: Leaf[]): void {
  let spaceBefore = true;
  let lastText: TextNode | null = null;
  for (const leaf of leaves) {
    if (leaf.kind === 'text') {
      let text = sanitize(leaf.text).replace(WHITESPACE_RUN, ' ');
      if (spaceBefore && text.startsWith(' ')) {
        text = text.slice(1);
      }
      leaf.text = text;
      if (text.length > 0) {
        spaceBefore = text.endsWith(' ');
        lastText = leaf;
      }
    } else if (leaf.kind === 'image') {
      spaceBefore = false;
      lastText = null;
    } else {
      trimEnd(lastText);
      lastText = null;
      spaceBefore = true;
    }
  }
  trimEnd(lastText);
}

/** Chinese paragraphs open with "　　" for indentation; the reader indents with CSS instead. */
function stripIndent(leaves: Leaf[]): void {
  for (const leaf of leaves) {
    if (leaf.kind !== 'text') {
      return;
    }
    leaf.text = leaf.text.replace(LEADING_INDENT, '');
    if (leaf.text.length > 0) {
      return;
    }
  }
}

/** Line breaks before the first content, after the last, or right after another break carry nothing. */
function redundantBreaks(leaves: Leaf[]): Set<InlineNode> {
  const removed = new Set<InlineNode>();
  let seenContent = false;
  let pending: BreakNode | null = null;
  for (const leaf of leaves) {
    if (leaf.kind === 'break') {
      if (!seenContent || pending !== null) {
        removed.add(leaf);
      } else {
        pending = leaf;
      }
    } else if (leaf.kind === 'image' || leaf.text.length > 0) {
      seenContent = true;
      pending = null;
    }
  }
  if (pending !== null) {
    removed.add(pending);
  }
  return removed;
}

function prune(nodes: InlineNode[], removed: Set<InlineNode>): InlineNode[] {
  const kept: InlineNode[] = [];
  for (const node of nodes) {
    if (removed.has(node) || (node.kind === 'text' && node.text.length === 0)) {
      continue;
    }
    if (node.kind === 'element') {
      const children = prune(node.children, removed);
      if (children.length > 0) {
        kept.push({ kind: 'element', name: node.name, children });
      }
      continue;
    }
    kept.push(node);
  }
  return kept;
}

/** Cleans inline content in place; returns [] when nothing readable or visible is left. */
export function cleanInline(nodes: InlineNode[], options: { stripIndent: boolean }): InlineNode[] {
  const leaves = leavesOf(nodes);
  collapseWhitespace(leaves);
  if (options.stripIndent) {
    stripIndent(leaves);
  }
  const content = prune(nodes, redundantBreaks(leaves));
  const visible = leavesOf(content).some((leaf) => leaf.kind === 'image' || leaf.kind === 'text');
  return visible ? content : [];
}

/** Inside pre whitespace is kept; a browser drops the newline right after <pre> and turns CR into LF. */
export function cleanPreformatted(raw: string): string {
  const text = sanitize(raw.replace(/\r\n?/g, '\n').replace(/\f/g, ''));
  return text.replace(/^\n+/, '').trimEnd();
}

export function cleanAlt(alt: string): string {
  return sanitize(alt).replace(WHITESPACE_RUN, ' ').trim();
}

/** A paragraph from plain text (TXT lines), cleaned like any other paragraph. */
export function paragraphBlock(text: string): Block {
  return { kind: 'paragraph', content: cleanInline([{ kind: 'text', text }], { stripIndent: true }) };
}

export function headingBlock(text: string, level: HeadingLevel): Block {
  return { kind: 'heading', level, content: cleanInline([{ kind: 'text', text }], { stripIndent: false }) };
}

export function isEmptyBlock(block: Block): boolean {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
      return block.content.length === 0;
    case 'preformatted':
      return block.text.length === 0;
    case 'rule':
      return false;
    case 'list':
      return block.items.length === 0;
    case 'quote':
      return block.paragraphs.length === 0;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Serialization

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

interface Output {
  html: string[];
  text: string[];
}

function renderInline(nodes: InlineNode[], out: Output): void {
  for (const node of nodes) {
    if (node.kind === 'text') {
      out.html.push(escapeHtml(node.text));
      out.text.push(node.text);
    } else if (node.kind === 'element') {
      out.html.push(`<${node.name}>`);
      renderInline(node.children, out);
      out.html.push(`</${node.name}>`);
    } else if (node.kind === 'image') {
      out.html.push(`<img data-asset="${escapeHtml(node.key)}" alt="${escapeHtml(node.alt)}">`);
    } else {
      out.html.push('<br>');
    }
  }
}

function renderWrapped(tag: string, content: InlineNode[], out: Output): void {
  out.html.push(`<${tag}>`);
  renderInline(content, out);
  out.html.push(`</${tag}>`);
}

function renderBlock(block: Block, out: Output): void {
  switch (block.kind) {
    case 'heading':
      renderWrapped(`h${block.level}`, block.content, out);
      return;
    case 'paragraph':
      renderWrapped('p', block.content, out);
      return;
    case 'preformatted':
      out.html.push(`<pre>${escapeHtml(block.text)}</pre>`);
      out.text.push(block.text);
      return;
    case 'rule':
      out.html.push('<hr>');
      return;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      out.html.push(`<${tag}>`);
      for (const item of block.items) {
        renderWrapped('li', item, out);
      }
      out.html.push(`</${tag}>`);
      return;
    }
    case 'quote':
      out.html.push('<blockquote>');
      for (const paragraph of block.paragraphs) {
        renderWrapped('p', paragraph, out);
      }
      out.html.push('</blockquote>');
      return;
  }
}

export function renderBlocks(blocks: Block[]): { html: string; text: string } {
  const out: Output = { html: [], text: [] };
  for (const block of blocks) {
    renderBlock(block, out);
  }
  return { html: out.html.join(''), text: out.text.join('') };
}

export function blockText(block: Block): string {
  return renderBlocks([block]).text;
}

export function firstHeading(blocks: Block[]): string | null {
  const heading = blocks.find((block) => block.kind === 'heading');
  if (heading === undefined) {
    return null;
  }
  const text = blockText(heading).trim();
  return text.length > 0 ? text : null;
}
