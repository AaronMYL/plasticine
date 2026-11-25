import type { FeedChart } from '../../shared/feed-translation.ts';

const NUMBER = /\d[\d,]*(?:\.\d+)?/g;

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

export function checkedChart(chart: FeedChart | null, source: string): FeedChart | null {
  if (chart === null) {
    return null;
  }
  const known = numbersIn(source);
  const allFound = chart.points.every((point) => known.has(Math.abs(point.value)));
  return allFound ? chart : null;
}
