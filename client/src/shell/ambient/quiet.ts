// 正文保护：量出主区里每一段字实际在哪（按行的小框），背景在这些地方压淡；大家伙在字少的那一侧巡游。
// 不靠每页手写标记：遍历可见的文字节点，用 Range 取每一行的位置，换成 canvas 里的坐标。

import type { QuietRect } from './world.ts';

/** 一页最多看这么多段字（很长的笔记往下的部分不在屏幕上，量了也用不上）。 */
const MAX_NODES = 3000;
/** 不是字但也要看清的：按钮、输入框、图标、图片。 */
const CONTROLS = 'button, input, select, textarea, svg, img, video, canvas:not(.ambient-layer)';

export interface QuietArea {
  /** 所有字的外框（大家伙绕着它转）；没有字是 null。 */
  bounds: QuietRect | null;
  rects: readonly QuietRect[];
}

export function measureQuiet(root: Element, frame: DOMRect): QuietArea {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.nodeValue?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const range = document.createRange();
  const rects: QuietRect[] = [];
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const add = (r: DOMRect): void => {
    if (r.width < 1 || r.bottom < frame.top || r.top > frame.bottom || r.right < frame.left || r.left > frame.right) {
      return;
    }
    const x = r.left - frame.left;
    const y = r.top - frame.top;
    rects.push({ x, y, w: r.width, h: r.height });
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + r.width);
    bottom = Math.max(bottom, y + r.height);
  };
  let count = 0;
  for (let node = walker.nextNode(); node !== null && count < MAX_NODES; node = walker.nextNode(), count++) {
    range.selectNodeContents(node);
    for (const r of range.getClientRects()) add(r);
  }
  for (const element of root.querySelectorAll(CONTROLS)) add(element.getBoundingClientRect());
  return { bounds: rects.length === 0 ? null : { x: left, y: top, w: right - left, h: bottom - top }, rects };
}
