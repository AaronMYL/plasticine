// 壳部件：盖在 Mac 网页标签上的浮层报成 hitRegions。桌面客户端的标题栏（红绿灯、Windows 窗口按钮）见 titlebar.test.tsx。

import { afterEach, describe, expect, it } from 'vitest';
import { collectHitRegions, HIT_REGION_ATTRIBUTE } from '../../src/shell/hit-regions.ts';

afterEach(() => {
  delete window.plasticineDesktop;
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => ({}) } as DOMRect;
}

describe('盖在网页标签上的浮层（hitRegions）', () => {
  const frame = { x: 216, y: 88, width: 1224, height: 812 };

  function floating(box: DOMRect | null): HTMLElement {
    const element = document.createElement('div');
    if (box !== null) {
      element.setAttribute(HIT_REGION_ATTRIBUTE, 'test');
      element.getBoundingClientRect = () => box;
    }
    document.body.append(element);
    return element;
  }

  it('只报标了 data-hit-region、压在网页那一块上、有大小的浮层', () => {
    const dialog = floating(rect(996, 236, 420, 640));
    const outside = floating(rect(0, 0, 100, 50));
    const hidden = floating(rect(500, 500, 0, 0));
    const plain = floating(null);
    expect(collectHitRegions(document, frame)).toEqual([{ x: 996, y: 236, width: 420, height: 640 }]);
    [dialog, outside, hidden, plain].forEach((element) => element.remove());
    expect(collectHitRegions(document, frame)).toEqual([]);
  });
});
