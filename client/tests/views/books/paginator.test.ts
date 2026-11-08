// 翻页的算法（paginator.ts，照 foliate-js 的 paginator）：页首字下标、跨章、改字号后回锚点、什么时候报「翻完一页」。
// 排版用假的：每页固定多少字，pageOf 按字算页；可以挖掉一段「量不出位置的空白」。

import { describe, expect, it } from 'vitest';
import { firstOffsetOnPage, Paginator, type PageSurface } from '../../../src/views/books/paginator.ts';

interface FakeLayout {
  length: number;
  perPage: number;
  /** 量不出位置的字（折叠掉的空白）。 */
  blank?: (offset: number) => boolean;
}

function surface(layout: FakeLayout, shows: Array<{ page: number; animate: boolean }>,
  gate?: () => Promise<void>): PageSurface {
  return {
    measure: () => ({ step: 688, pages: Math.ceil(layout.length / layout.perPage) }),
    pageOf: (offset) => (layout.blank?.(offset) === true ? null : Math.floor(offset / layout.perPage)),
    length: () => layout.length,
    show: (page, _step, animate) => {
      shows.push({ page, animate });
      return animate && gate !== undefined ? gate() : Promise.resolve();
    },
  };
}

function recorder(): { turned: number[]; edges: number[]; events: { onTurned: (o: number) => void;
  onEdge: (d: 1 | -1) => void } } {
  const turned: number[] = [];
  const edges: number[] = [];
  return { turned, edges, events: { onTurned: (offset) => turned.push(offset), onEdge: (d) => edges.push(d) } };
}

describe('页首字下标', () => {
  it('二分出每一页第一个字；第 0 页是 0', () => {
    const layout = { length: 1000, perPage: 230 };
    const pages = [0, 1, 2, 3, 4].map((page) => firstOffsetOnPage(surface(layout, []), layout.length, page));
    expect(pages).toEqual([0, 230, 460, 690, 920]);
  });

  it('页首是一段量不出位置的空白时，往后找最近量得出的字，结果仍落在这一页开头', () => {
    const layout = { length: 1000, perPage: 200, blank: (offset: number) => offset >= 398 && offset < 405 };
    expect(firstOffsetOnPage(surface(layout, []), layout.length, 2)).toBe(398);
    expect(firstOffsetOnPage(surface(layout, []), layout.length, 3)).toBe(600);
  });

  it('没有排版（量不出任何字）时不卡住：第 0 页之外都当作在后面', () => {
    const layout = { length: 500, perPage: 100, blank: () => true };
    expect(firstOffsetOnPage(surface(layout, []), layout.length, 1)).toBe(0);
  });
});

describe('翻页与跨章', () => {
  it('往后翻到最后一页再往后：交给 onEdge(1)，不报翻完；第一页往前：onEdge(-1)', async () => {
    const shows: Array<{ page: number; animate: boolean }> = [];
    const { turned, edges, events } = recorder();
    const paginator = new Paginator(surface({ length: 400, perPage: 200 }, shows), events);
    paginator.showOffset(0);
    await paginator.next();
    expect(paginator.page).toBe(1);
    expect(turned).toEqual([200]);
    await paginator.next();
    expect(edges).toEqual([1]);
    expect(paginator.page).toBe(1);
    paginator.showOffset(0);
    await paginator.prev();
    expect(edges).toEqual([1, -1]);
    expect(shows.filter((show) => show.animate).map((show) => show.page)).toEqual([1]);
  });

  it('往前翻进上一章：放到这一章最后一页，锚点是最后一页的页首', () => {
    const paginator = new Paginator(surface({ length: 1000, perPage: 300 }, []), recorder().events);
    expect(paginator.showOffset('end')).toBe(900);
    expect(paginator.page).toBe(3);
  });
});

describe('改字号、窗口变了：回到锚点', () => {
  it('锚点是跳到的那一字；排版变了回到它所在的那一页，锚点不漂；再翻一页锚点才换', async () => {
    const layout = { length: 2000, perPage: 200 };
    const shows: Array<{ page: number; animate: boolean }> = [];
    const { turned, events } = recorder();
    const paginator = new Paginator(surface(layout, shows), events);
    expect(paginator.showOffset(450)).toBe(450);
    expect(paginator.page).toBe(2);
    layout.perPage = 100;
    paginator.relayout();
    expect(paginator.page).toBe(4);
    expect(paginator.anchor).toBe(450);
    layout.perPage = 200;
    paginator.relayout();
    expect(paginator.page).toBe(2);
    expect(shows.at(-1)).toEqual({ page: 2, animate: false });
    expect(turned).toEqual([]);
    await paginator.next();
    expect(paginator.anchor).toBe(600);
    expect(turned).toEqual([600]);
  });
});

describe('进度保存时机：翻完一页', () => {
  it('平移停下才报；打开、跳转、重新排版不报；连着翻只报最后停下的那一页', async () => {
    const releases: Array<() => void> = [];
    const gate = (): Promise<void> => new Promise((resolve) => releases.push(resolve));
    const { turned, events } = recorder();
    const paginator = new Paginator(surface({ length: 2000, perPage: 200 }, [], gate), events);
    paginator.showOffset(0);
    paginator.relayout();
    const first = paginator.next();
    expect(turned).toEqual([]);
    const second = paginator.next();
    releases.forEach((release) => release());
    await Promise.all([first, second]);
    expect(turned).toEqual([400]);
  });

  it('拖着翻松手吸回这一页：不报；吸到下一页：报那一页的页首', async () => {
    const { turned, events } = recorder();
    const paginator = new Paginator(surface({ length: 1000, perPage: 250 }, []), events);
    paginator.showOffset(260);
    await paginator.settle(1);
    expect(turned).toEqual([]);
    await paginator.settle(2);
    expect(turned).toEqual([500]);
  });
});
