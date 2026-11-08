// 章节正文里的位置：高亮的 start / end、进度的 offset 都是容器 textContent 里的 UTF-16 下标（服务端保证规范后的
// html 的 textContent 等于章节正文）。这里用 TreeWalker 只走文字节点，在 DOM 位置和下标之间来回换；画高亮时把
// 文字节点切开、套一层元素，不拼 html 字符串，所以 textContent 一个字都不变。
// 界面自己插进正文的小东西（批注角标）带 data-bk-ui，走文字节点时跳过，不算进下标。

/** 插进正文、但不属于原文的元素都带这个属性。 */
export const UI_ATTRIBUTE = 'data-bk-ui';

export interface TextSegment {
  node: Text;
  /** 这一段在节点里的起止。 */
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

/** 原文的文字节点，按文档顺序。 */
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

/** 原文的全部文字（不含界面插进去的角标）：下标都对着它。 */
export function plainText(root: Node): string {
  return textNodes(root).map((node) => node.data).join('');
}

/**
 * DOM 里的一个位置（容器 + 偏移，和 Range 的边界一样）换成下标。位置落在元素上时（偏移是第几个子节点），
 * 算它前面有多少字。不在 root 里返回 null。
 */
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
    // comparePoint：节点开头在边界之后（1）说明边界在这个节点前面，前面的字数就是答案。
    if (boundary.comparePoint(node, 0) === 1) {
      return total;
    }
    total += node.data.length;
  }
  return total;
}

/** 下标区间 [start, end) 落在哪些文字节点的哪几段。 */
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

/** 下标区间换成一个 Range（滚动定位、选区用）；区间不在正文里返回 null。 */
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

/**
 * 把 [start, end) 的每一段文字套进 make() 造的元素里（跨段落时一段一个），返回套好的元素。
 * 只切文字节点、不动别的结构，textContent 不变；已经套过的（重叠的高亮）会嵌在里面。
 */
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

/** 选区换成下标区间；选区不在正文里或是空的返回 null。 */
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
