import { afterEach, describe, expect, it } from 'vitest';
import { spaceCharts } from '../../../src/views/spaces/space-charts.ts';

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  spaceCharts();
  document.dispatchEvent(new Event('DOMContentLoaded'));
  return document.body;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Charts in space', () => {
  it('bar chart highlights latest bar in accent color with top value and hover tooltip', () => {
    const data = { type: 'bar', unit: '份', series: [{ name: '投递', points: [{ x: '11-10', y: 12 },
      { x: '11-11', y: 18 }, { x: '11-12', y: 37 }] }] };
    const body = mount(`<div class="pz-chart" data-chart='${JSON.stringify(data)}'></div>`);
    const bars = body.querySelectorAll('rect');
    expect(bars).toHaveLength(3);
    expect(bars[2]?.getAttribute('fill')).toBe('var(--hue-clay)');
    expect(bars[0]?.getAttribute('fill')).toBe('var(--hue-sky)');
    expect(body.querySelector('.pz-chart-latest')?.textContent).toBe('37');
    bars[1]?.dispatchEvent(new Event('pointerenter'));
    const tip = body.querySelector<HTMLElement>('.pz-chart-tip');
    expect(tip?.hidden).toBe(false);
    expect(tip?.textContent).toBe('11-1118份');
  });

  it('multi-series line chart colors by category with legend below', () => {
    const data = { type: 'line', series: [{ name: '投递', points: [{ x: 1, y: 2 }, { x: 2, y: 3 }] },
      { name: '回复', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] };
    const body = mount(`<div class="pz-chart" data-chart='${JSON.stringify(data)}'></div>`);
    expect(body.querySelectorAll('path')).toHaveLength(2);
    expect(body.querySelector('.pz-chart-legend')?.textContent).toBe('投递回复');
  });

  it('malformed chart data renders inline notice instead of chart', () => {
    const body = mount('<div class="pz-chart" data-chart="不是 JSON"></div>'
      + `<div class="pz-chart" data-chart='{"type":"pie","series":[]}'></div>`);
    expect([...body.querySelectorAll('.pz-chart-bad')].map((node) => node.textContent))
      .toEqual(['图表的数据写错了（要 type、series，每组有 points）。', '图表的数据写错了（要 type、series，每组有 points）。']);
    expect(body.querySelector('svg')).toBeNull();
  });
});
