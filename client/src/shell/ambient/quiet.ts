import type { QuietRect } from './world.ts';

const MAX_NODES = 3000;
const CONTROLS = 'button, input, select, textarea, svg, img, video, canvas:not(.ambient-layer)';

export interface QuietArea {
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
