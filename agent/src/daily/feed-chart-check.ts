// 小图表不编数据（《优化清单》第 8 条）：模型给的每个数字都必须在原文里出现过，否则整张不要。数字按原文的写法找：
// 去掉千分位逗号、认小数；「4,800」「4800」「12.5%」里的 12.5 都算出现过。

import type { FeedChart } from '../../shared/feed-translation.ts';

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

/** 原文里出现过的全部数字。 */
export function numbersIn(text: string): Set<number> {
  const found = new Set<number>();
  for (const match of text.matchAll(NUMBER)) {
    const value = Number(match[0].replace(/,/g, ''));
    if (Number.isFinite(value)) {
      found.add(value);
    }
  }
  return found;
}

/** 图表的数字全在原文里才留下；有一个对不上就当没有图。 */
export function checkedChart(chart: FeedChart | null, source: string): FeedChart | null {
  if (chart === null) {
    return null;
  }
  const known = numbersIn(source);
  const allFound = chart.points.every((point) => known.has(Math.abs(point.value)));
  return allFound ? chart : null;
}
