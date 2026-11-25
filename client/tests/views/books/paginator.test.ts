import { describe, expect, it } from 'vitest';
import { firstOffsetOnPage, Paginator, type PageSurface } from '../../../src/views/books/paginator.ts';

interface FakeLayout {
  length: number;
  perPage: number;
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

describe('page start character offset', () => {
  it('binary-searches first character of each page; page 0 starts at 0', () => {
    const layout = { length: 1000, perPage: 230 };
    const pages = [0, 1, 2, 3, 4].map((page) => firstOffsetOnPage(surface(layout, []), layout.length, page));
    expect(pages).toEqual([0, 230, 460, 690, 920]);
  });

  it('when page starts with unmeasurable whitespace, finds nearest measurable char on that page', () => {
    const layout = { length: 1000, perPage: 200, blank: (offset: number) => offset >= 398 && offset < 405 };
    expect(firstOffsetOnPage(surface(layout, []), layout.length, 2)).toBe(398);
    expect(firstOffsetOnPage(surface(layout, []), layout.length, 3)).toBe(600);
  });

  it('does not hang without layout; treats pages beyond 0 as trailing', () => {
    const layout = { length: 500, perPage: 100, blank: () => true };
    expect(firstOffsetOnPage(surface(layout, []), layout.length, 1)).toBe(0);
  });
});

describe('pagination and chapter boundaries', () => {
  it('turning past last page calls onEdge(1) without turn-complete; before first calls onEdge(-1)', async () => {
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

  it('turning back into previous chapter lands on its last page anchored to page start', () => {
    const paginator = new Paginator(surface({ length: 1000, perPage: 300 }, []), recorder().events);
    expect(paginator.showOffset('end')).toBe(900);
    expect(paginator.page).toBe(3);
  });
});

describe('changing font size or window size restores anchor position', () => {
  it('anchor stays pinned to jumped character across reflows until user turns a page', async () => {
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

describe('progress save timing: after page turn', () => {
  it('reports after slide settles, skips open/jump/reflow, reports only final page on rapid turns', async () => {
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

  it('drag snapping back to current page skips report; snapping to next reports its start offset', async () => {
    const { turned, events } = recorder();
    const paginator = new Paginator(surface({ length: 1000, perPage: 250 }, []), events);
    paginator.showOffset(260);
    await paginator.settle(1);
    expect(turned).toEqual([]);
    await paginator.settle(2);
    expect(turned).toEqual([500]);
  });
});
