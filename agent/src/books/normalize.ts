// Turns the tokens of one chapter document into normalized blocks (blocks.ts). Book markup nests freely (div in div,
// p in li, tables for layout); the reader wants flat blocks, so every block boundary closes the current block and
// the next text opens a new one. Only two containers survive: ul/ol (holding li) and blockquote (holding p).

import { cleanAlt, cleanInline, cleanPreformatted, INLINE_NAMES } from './blocks.ts';
import type { Block, HeadingLevel, InlineElement, InlineName, InlineNode } from './blocks.ts';
import type { MarkupToken, OpenToken } from './markup.ts';

/** Returns the image key for an <img> (or SVG <image>) by its attributes, or null to drop it. */
export type ImageResolver = (attributes: ReadonlyMap<string, string>) => string | null;

export interface NormalizedDocument {
  blocks: Block[];
  /** Keys of the images the blocks reference, in order of first use. */
  imageKeys: string[];
}

const HEADING_LEVELS: Record<string, HeadingLevel> = { h1: 2, h2: 2, h3: 3, h4: 4, h5: 4, h6: 4 };
const INLINE_MAP: Record<string, InlineName> = { b: 'strong', i: 'em', cite: 'em', dfn: 'em', var: 'em' };
for (const name of INLINE_NAMES) {
  INLINE_MAP[name] = name;
}
// Content that is not reading text: page furniture, code, the navigation document's table of contents, and rp (the
// fallback parentheses of ruby, which would show up as stray "(" ")" in the text).
const SKIPPED = new Set([
  'head', 'script', 'style', 'title', 'noscript', 'template', 'nav', 'rp', 'audio', 'video', 'object', 'iframe',
  'select', 'button', 'textarea', 'canvas', 'map', 'xmp',
]);
const BOUNDARIES = new Set([
  'p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'figure', 'figcaption', 'address',
  'center', 'dl', 'dd', 'dt', 'body', 'html', 'details', 'summary', 'caption', 'hgroup', 'legend', 'fieldset',
  'form', 'li', 'ul', 'ol', 'menu', 'dir', 'blockquote', 'pre', 'hr', 'table', 'tr', 'td', 'th', 'thead', 'tbody',
  'tfoot', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'mbp:pagebreak',
]);
const LISTS = new Set(['ul', 'ol', 'menu', 'dir']);
// Table cells are joined with an ideographic space so a row reads as one line of Chinese text (task brief).
const CELL_SEPARATOR = '　';

class InlineBuilder {
  readonly root: InlineNode[] = [];
  readonly #open: InlineElement[] = [];

  constructor(formatting: InlineName[]) {
    for (const name of formatting) {
      this.open(name);
    }
  }

  #children(): InlineNode[] {
    return this.#open.at(-1)?.children ?? this.root;
  }

  add(node: InlineNode): void {
    this.#children().push(node);
  }

  open(name: InlineName): void {
    const element: InlineElement = { kind: 'element', name, children: [] };
    this.add(element);
    this.#open.push(element);
  }

  /** Closes `name` and reopens whatever was opened inside it, so misnested input still nests in the output. */
  close(name: InlineName): void {
    const index = this.#open.findLastIndex((element) => element.name === name);
    if (index === -1) {
      return;
    }
    const reopen = this.#open.slice(index + 1).map((element) => element.name);
    this.#open.length = index;
    for (const inner of reopen) {
      this.open(inner);
    }
  }
}

type Current =
  | { kind: 'inline'; heading: HeadingLevel | null; builder: InlineBuilder }
  | { kind: 'row'; cells: InlineBuilder[] }
  | { kind: 'pre'; text: string };

type Container =
  | { kind: 'list'; ordered: boolean; depth: number; items: InlineNode[][] }
  | { kind: 'quote'; depth: number; paragraphs: InlineNode[][] };

class Normalizer {
  readonly blocks: Block[] = [];
  readonly imageKeys: string[] = [];
  readonly #resolve: ImageResolver;
  #current: Current | null = null;
  #container: Container | null = null;
  #formatting: InlineName[] = [];
  #skipped: string[] = [];
  #svgDepth = 0;
  #tableDepth = 0;

  constructor(resolve: ImageResolver) {
    this.#resolve = resolve;
  }

  token(token: MarkupToken): void {
    if (this.#skipped.length > 0) {
      this.#skip(token);
    } else if (this.#svgDepth > 0) {
      this.#svg(token);
    } else if (this.#current?.kind === 'pre') {
      this.#pre(token, this.#current);
    } else if (token.kind === 'text') {
      this.#text(token.text);
    } else if (token.kind === 'open') {
      this.#open(token);
    } else {
      this.#close(token.name);
    }
  }

  finish(): void {
    this.#flush();
    this.#emitContainer();
  }

  #skip(token: MarkupToken): void {
    if (token.kind === 'open' && token.name === 'body') {
      // An HTML head that never closes ends where the body starts.
      this.#skipped = [];
      this.#open(token);
    } else if (token.kind === 'open' && SKIPPED.has(token.name) && !token.selfClosing) {
      this.#skipped.push(token.name);
    } else if (token.kind === 'close') {
      const index = this.#skipped.lastIndexOf(token.name);
      if (index !== -1) {
        this.#skipped.length = index;
      }
    }
  }

  #svg(token: MarkupToken): void {
    if (token.kind === 'open' && token.name === 'svg' && !token.selfClosing) {
      this.#svgDepth += 1;
    } else if (token.kind === 'open' && token.name === 'image') {
      this.#image(token);
    } else if (token.kind === 'close' && token.name === 'svg') {
      this.#svgDepth -= 1;
    }
  }

  #pre(token: MarkupToken, current: { kind: 'pre'; text: string }): void {
    if (token.kind === 'text') {
      current.text += token.text;
    } else if (token.kind === 'open' && token.name === 'br') {
      current.text += '\n';
    } else if (token.kind === 'close' && token.name === 'pre') {
      this.#flush();
    }
  }

  #text(text: string): void {
    if (this.#current === null && text.trim().length === 0) {
      return;
    }
    this.#builder().add({ kind: 'text', text });
  }

  #image(token: OpenToken): void {
    const key = this.#resolve(token.attributes);
    if (key === null) {
      return;
    }
    if (!this.imageKeys.includes(key)) {
      this.imageKeys.push(key);
    }
    this.#builder().add({ kind: 'image', key, alt: cleanAlt(token.attributes.get('alt') ?? '') });
  }

  /** The builder that text goes into, opening a block (or a table cell) when none is open. */
  #builder(): InlineBuilder {
    const current = this.#current;
    if (current?.kind === 'inline') {
      return current.builder;
    }
    if (current?.kind === 'row') {
      const cell = current.cells.at(-1);
      if (cell !== undefined) {
        return cell;
      }
      const opened = new InlineBuilder(this.#formatting);
      current.cells.push(opened);
      return opened;
    }
    const builder = new InlineBuilder(this.#formatting);
    this.#current = { kind: 'inline', heading: null, builder };
    return builder;
  }

  #open(token: OpenToken): void {
    const { name } = token;
    if (SKIPPED.has(name)) {
      if (!token.selfClosing) {
        this.#skipped.push(name);
      }
      return;
    }
    if (name === 'svg') {
      this.#svgDepth += token.selfClosing ? 0 : 1;
      return;
    }
    if (name === 'img') {
      this.#image(token);
      return;
    }
    if (name === 'br') {
      this.#lineBreak();
      return;
    }
    const inline = INLINE_MAP[name];
    if (inline !== undefined) {
      this.#formatting.push(inline);
      const current = this.#current;
      if (current?.kind === 'inline') {
        current.builder.open(inline);
      } else if (current?.kind === 'row') {
        current.cells.at(-1)?.open(inline);
      }
      return;
    }
    if (BOUNDARIES.has(name)) {
      this.#openBlock(name);
    }
  }

  #lineBreak(): void {
    const current = this.#current;
    if (current?.kind === 'inline') {
      current.builder.add({ kind: 'break' });
    } else if (current?.kind === 'row') {
      // Rows become one line, so a break inside a cell is only a space.
      current.cells.at(-1)?.add({ kind: 'text', text: ' ' });
    }
  }

  #openBlock(name: string): void {
    if (name === 'table') {
      // A table nested in a cell is read as more cells of the outer row.
      this.#tableDepth += 1;
      if (this.#tableDepth === 1) {
        this.#flush();
      }
      return;
    }
    if (this.#current?.kind === 'row' && name !== 'tr') {
      // Inside a table row, block markup in cells only separates cells.
      if (name === 'td' || name === 'th') {
        this.#newCell();
      }
      return;
    }
    if (name === 'tr' || name === 'td' || name === 'th') {
      if (this.#tableDepth <= 1) {
        this.#flush();
        this.#current = { kind: 'row', cells: [] };
        if (name !== 'tr') {
          this.#newCell();
        }
      }
      return;
    }
    this.#flush();
    const container = this.#container;
    if (LISTS.has(name)) {
      if (container === null) {
        this.#container = { kind: 'list', ordered: name === 'ol', depth: 1, items: [] };
      } else if (container.kind === 'list') {
        container.depth += 1;
      }
    } else if (name === 'blockquote') {
      if (container === null) {
        this.#container = { kind: 'quote', depth: 1, paragraphs: [] };
      } else if (container.kind === 'quote') {
        container.depth += 1;
      }
    } else if (container === null && name === 'pre') {
      this.#current = { kind: 'pre', text: '' };
    } else if (container === null && name === 'hr') {
      this.blocks.push({ kind: 'rule' });
    } else {
      const heading = container === null ? (HEADING_LEVELS[name] ?? null) : null;
      if (heading !== null) {
        this.#current = { kind: 'inline', heading, builder: new InlineBuilder(this.#formatting) };
      }
    }
  }

  #newCell(): void {
    if (this.#current?.kind === 'row') {
      this.#current.cells.push(new InlineBuilder(this.#formatting));
    }
  }

  #close(name: string): void {
    const inline = INLINE_MAP[name];
    if (inline !== undefined) {
      const index = this.#formatting.lastIndexOf(inline);
      if (index !== -1) {
        this.#formatting.splice(index, 1);
      }
      const current = this.#current;
      if (current?.kind === 'inline') {
        current.builder.close(inline);
      } else if (current?.kind === 'row') {
        current.cells.at(-1)?.close(inline);
      }
      return;
    }
    if (!BOUNDARIES.has(name)) {
      return;
    }
    if (name === 'table') {
      this.#tableDepth = Math.max(0, this.#tableDepth - 1);
      if (this.#tableDepth === 0) {
        this.#flush();
      }
      return;
    }
    if (this.#current?.kind === 'row' && name !== 'tr') {
      return;
    }
    if (name === 'tr' && this.#tableDepth > 1) {
      return;
    }
    this.#flush();
    if (name === 'body' || name === 'html') {
      this.#formatting = [];
    }
    const container = this.#container;
    const closesList = container?.kind === 'list' && LISTS.has(name);
    const closesQuote = container?.kind === 'quote' && name === 'blockquote';
    if (container !== null && (closesList || closesQuote)) {
      container.depth -= 1;
      if (container.depth === 0) {
        this.#emitContainer();
      }
    }
  }

  #flush(): void {
    const current = this.#current;
    this.#current = null;
    if (current === null) {
      return;
    }
    if (current.kind === 'pre') {
      const text = cleanPreformatted(current.text);
      if (text.length > 0) {
        this.blocks.push({ kind: 'preformatted', text });
      }
      return;
    }
    const content = current.kind === 'row' ? this.#joinCells(current.cells) : current.builder.root;
    const container = this.#container;
    const cleaned = cleanInline(content, { stripIndent: container?.kind !== 'list' && current.kind !== 'row' });
    if (cleaned.length === 0) {
      return;
    }
    if (container?.kind === 'list') {
      container.items.push(cleaned);
    } else if (container?.kind === 'quote') {
      container.paragraphs.push(cleaned);
    } else if (current.kind === 'inline' && current.heading !== null) {
      this.blocks.push({ kind: 'heading', level: current.heading, content: cleaned });
    } else {
      this.blocks.push({ kind: 'paragraph', content: cleaned });
    }
  }

  #joinCells(cells: InlineBuilder[]): InlineNode[] {
    const joined: InlineNode[] = [];
    for (const cell of cells) {
      const content = cleanInline(cell.root, { stripIndent: false });
      if (content.length === 0) {
        continue;
      }
      if (joined.length > 0) {
        joined.push({ kind: 'text', text: CELL_SEPARATOR });
      }
      joined.push(...content);
    }
    return joined;
  }

  #emitContainer(): void {
    const container = this.#container;
    this.#container = null;
    if (container?.kind === 'list' && container.items.length > 0) {
      this.blocks.push({ kind: 'list', ordered: container.ordered, items: container.items });
    } else if (container?.kind === 'quote' && container.paragraphs.length > 0) {
      this.blocks.push({ kind: 'quote', paragraphs: container.paragraphs });
    }
  }
}

export function normalizeMarkup(tokens: Iterable<MarkupToken>, resolve: ImageResolver): NormalizedDocument {
  const normalizer = new Normalizer(resolve);
  for (const token of tokens) {
    normalizer.token(token);
  }
  normalizer.finish();
  return { blocks: normalizer.blocks, imageKeys: normalizer.imageKeys };
}
