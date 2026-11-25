export const UI_ATTRIBUTE = 'data-bk-ui';

export interface TextSegment {
  node: Text;
  from: number;
  to: number;
}

function isUiText(node: Node, root: Node): boolean {
  let parent = node.parentNode;
  while (parent !== null && parent !== root) {
    if (parent instanceof Element && parent.hasAttribute(UI_ATTRIBUTE)) {
      return true;
    }
    parent = parent.parentNode;
  }
  return false;
}

export function textNodes(root: Node): Text[] {
  const document = root.ownerDocument ?? (root as Document);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (isUiText(node, root) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  return nodes;
}

export function plainText(root: Node): string {
  return textNodes(root).map((node) => node.data).join('');
}

export function textOffset(root: Node, container: Node, offset: number): number | null {
  if (container !== root && !root.contains(container)) {
    return null;
  }
  const document = root.ownerDocument ?? (root as Document);
  const boundary = document.createRange();
  boundary.setStart(container, offset);
  boundary.collapse(true);
  let total = 0;
  for (const node of textNodes(root)) {
    if (node === container) {
      return total + Math.min(offset, node.data.length);
    }
    if (boundary.comparePoint(node, 0) === 1) {
      return total;
    }
    total += node.data.length;
  }
  return total;
}

export function segmentsBetween(root: Node, start: number, end: number): TextSegment[] {
  const segments: TextSegment[] = [];
  let total = 0;
  for (const node of textNodes(root)) {
    const nodeStart = total;
    const nodeEnd = total + node.data.length;
    total = nodeEnd;
    if (nodeEnd <= start || node.data.length === 0) {
      continue;
    }
    if (nodeStart >= end) {
      break;
    }
    segments.push({ node, from: Math.max(0, start - nodeStart), to: Math.min(node.data.length, end - nodeStart) });
  }
  return segments;
}

export function rangeBetween(root: Node, start: number, end: number): Range | null {
  const segments = segmentsBetween(root, start, Math.max(end, start + 1));
  const first = segments[0];
  const last = segments.at(-1);
  if (first === undefined || last === undefined) {
    return null;
  }
  const document = root.ownerDocument ?? (root as Document);
  const range = document.createRange();
  range.setStart(first.node, first.from);
  range.setEnd(last.node, end <= start ? first.from : last.to);
  return range;
}

export function wrapBetween(root: Node, start: number, end: number, make: () => HTMLElement): HTMLElement[] {
  const wrapped: HTMLElement[] = [];
  for (const segment of segmentsBetween(root, start, end)) {
    let node = segment.node;
    if (segment.to < node.data.length) {
      node.splitText(segment.to);
    }
    if (segment.from > 0) {
      node = node.splitText(segment.from);
    }
    const parent = node.parentNode;
    if (parent === null) {
      continue;
    }
    const element = make();
    parent.insertBefore(element, node);
    element.appendChild(node);
    wrapped.push(element);
  }
  return wrapped;
}

export function selectionOffsets(root: Node, range: Range): { start: number; end: number } | null {
  if (range.collapsed) {
    return null;
  }
  const start = textOffset(root, range.startContainer, range.startOffset);
  const end = textOffset(root, range.endContainer, range.endOffset);
  if (start === null || end === null || end <= start) {
    return null;
  }
  return { start, end };
}
