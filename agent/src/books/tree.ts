// An element tree over the tokenizer, for the package files of an EPUB (container.xml, OPF, NCX, nav). Lookups go
// by local name because books disagree on namespace prefixes ("dc:title", "opf:meta", or none at all).

import { tokenize } from './markup.ts';

export interface MarkupElement {
  name: string;
  attributes: ReadonlyMap<string, string>;
  children: MarkupNode[];
}

export type MarkupNode = MarkupElement | string;

// HTML void elements: in a nav document written as HTML they never get a closing tag.
const VOID_ELEMENTS = new Set(['br', 'img', 'hr', 'meta', 'link', 'input', 'wbr', 'area', 'base', 'col', 'source']);

// Unclosed tags (an HTML nav with bare <li>) would nest without end and the recursive lookups below could overflow
// the call stack; package files are shallow, so past this depth new elements become siblings instead.
const MAX_TREE_DEPTH = 512;

export function localName(name: string): string {
  const colon = name.lastIndexOf(':');
  return colon === -1 ? name : name.slice(colon + 1);
}

export function parseTree(source: string): MarkupElement {
  const root: MarkupElement = { name: '#root', attributes: new Map(), children: [] };
  const stack: MarkupElement[] = [root];
  for (const token of tokenize(source)) {
    const parent = stack.at(-1) ?? root;
    if (token.kind === 'text') {
      parent.children.push(token.text);
    } else if (token.kind === 'open') {
      const element: MarkupElement = { name: token.name, attributes: token.attributes, children: [] };
      parent.children.push(element);
      if (!token.selfClosing && !VOID_ELEMENTS.has(token.name) && stack.length < MAX_TREE_DEPTH) {
        stack.push(element);
      }
    } else {
      // A closing tag with no matching open element is ignored instead of closing everything.
      const index = stack.findLastIndex((open) => open.name === token.name);
      if (index > 0) {
        stack.length = index;
      }
    }
  }
  return root;
}

function collect(element: MarkupElement, local: string, found: MarkupElement[]): void {
  for (const child of element.children) {
    if (typeof child === 'string') {
      continue;
    }
    if (localName(child.name) === local) {
      found.push(child);
    }
    collect(child, local, found);
  }
}

/** Descendants with the given local name, in document order. */
export function findAll(element: MarkupElement | null | undefined, local: string): MarkupElement[] {
  const found: MarkupElement[] = [];
  if (element !== null && element !== undefined) {
    collect(element, local, found);
  }
  return found;
}

export function findFirst(element: MarkupElement | null | undefined, local: string): MarkupElement | null {
  return findAll(element, local)[0] ?? null;
}

export function textContent(element: MarkupElement | null | undefined): string {
  if (element === null || element === undefined) {
    return '';
  }
  return element.children.map((child) => (typeof child === 'string' ? child : textContent(child))).join('');
}

/** An attribute by exact name first, then by local name ("opf:href" answers to "href"). */
export function attribute(element: MarkupElement, name: string): string | undefined {
  const exact = element.attributes.get(name);
  if (exact !== undefined) {
    return exact;
  }
  for (const [key, value] of element.attributes) {
    if (localName(key) === name) {
      return value;
    }
  }
  return undefined;
}
