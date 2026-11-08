// 瀑布流的分列（第 3 批 11-04：电脑两三列按宽度、手机一列）：列数只看主区宽度；条目按顺序放进当前最矮的一列，
// 有图的按图的比例算高、没图的按字数算——排序（命中关注点在前、新的在前）在每一列里从上往下保持。

import { describe, expect, it } from 'vitest';
import { cardHeight, columnCount, layoutColumns } from '../../../src/views/feed/feed-masonry.ts';

describe('瀑布流分列', () => {
  it('窄于两列的宽度一列，够宽两列，再宽三列，最多三列', () => {
    expect(columnCount(0)).toBe(1);
    expect(columnCount(390)).toBe(1);
    expect(columnCount(640)).toBe(2);
    expect(columnCount(980)).toBe(3);
    expect(columnCount(2400)).toBe(3);
  });

  it('按顺序放进当前最矮的一列：一张高图后面的短卡填到旁边列', () => {
    const heights = new Map([['a', 400], ['b', 100], ['c', 100], ['d', 100]]);
    const columns = layoutColumns(['a', 'b', 'c', 'd'], 2, (id) => heights.get(id) ?? 0);
    expect(columns).toEqual([['a'], ['b', 'c', 'd']]);
    expect(layoutColumns(['a', 'b', 'c'], 1, () => 1)).toEqual([['a', 'b', 'c']]);
    expect(layoutColumns([], 3, () => 1)).toEqual([[], [], []]);
  });

  it('估高：有图按比例加图高，字越多越高；不知道比例的图按方图', () => {
    const plain = cardHeight({ textChars: 40, title: false, hit: false, imageRatio: undefined }, 300);
    const longer = cardHeight({ textChars: 400, title: false, hit: false, imageRatio: undefined }, 300);
    const pictured = cardHeight({ textChars: 40, title: false, hit: false, imageRatio: 0.5 }, 300);
    const unknown = cardHeight({ textChars: 40, title: false, hit: false, imageRatio: null }, 300);
    expect(longer).toBeGreaterThan(plain);
    // 图铺满卡片内宽（列宽 300 减左右内边距 32）。
    expect(pictured - plain).toBeCloseTo(134 + 10, 0);
    expect(unknown - plain).toBeCloseTo(268 + 10, 0);
  });
});
