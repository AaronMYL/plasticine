import { afterEach, describe, expect, it } from 'vitest';
import { collectHitRegions, HIT_REGION_ATTRIBUTE } from '../../src/shell/hit-regions.ts';

afterEach(() => {
  delete window.plasticineDesktop;
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => ({}) } as DOMRect;
}

describe('overlays covering web tabs (hitRegions)', () => {
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

  it('reports only non-empty data-hit-region overlays intersecting the web tab rect', () => {
    const dialog = floating(rect(996, 236, 420, 640));
    const outside = floating(rect(0, 0, 100, 50));
    const hidden = floating(rect(500, 500, 0, 0));
    const plain = floating(null);
    expect(collectHitRegions(document, frame)).toEqual([{ x: 996, y: 236, width: 420, height: 640 }]);
    [dialog, outside, hidden, plain].forEach((element) => element.remove());
    expect(collectHitRegions(document, frame)).toEqual([]);
  });
});
