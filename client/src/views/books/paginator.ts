// 翻页（第 7 批第 3 条，他定：默认左右翻页、单页，「Aa」里能切回上下滚）。算法照 foliate-js 的 paginator.js
// （MIT，github.com/johnfactotum/foliate-js）：正文放进固定高度的多栏容器（一栏 = 一页），翻页改滚动容器的 scrollLeft。
// 这里只管「第几页、翻到哪、页首是第几个字」，量排版和真的滚动交给 PageSurface（page-surface.ts 是 DOM 的那一份），
// 所以能在没有排版的测试环境里按假的尺寸验证。
//
// 位置仍是「章序号 + 章内字下标」：锚点是当前这一页第一个字的下标（跳转时是跳到的那一字）。改字号、窗口变了、
// 图片到了重新排版时回到锚点所在的那一页，不按新排版重算锚点，翻来翻去不会漂。只有翻完一页才报一次（存进度）。

/** 两栏（两页）之间的空隙：翻页时看得出是另一页，也是 foliate 的默认量级。 */
export const PAGE_GAP = 48;
/** 找一个字在第几页时，空白（折叠掉、量不出位置的字）往后最多看这么多个字。 */
const BLANK_LOOKAHEAD = 32;

export interface PageMetrics {
  /** 一页的步长：栏宽 + 栏间距。 */
  step: number;
  /** 这一章一共几页（至少 1）。 */
  pages: number;
}

export interface PageSurface {
  measure(): PageMetrics;
  /** 第 offset 个字在第几页；量不出（没排版、折叠掉的空白）返回 null。 */
  pageOf(offset: number): number | null;
  /** 正文一共多少字（UTF-16）。 */
  length(): number;
  /** 把第 page 页放到眼前；animate 时平移过去，动画停下时 resolve。 */
  show(page: number, step: number, animate: boolean): Promise<void>;
}

export interface PaginatorEvents {
  /** 翻完一页（动画停下）：这一页第一个字的下标。 */
  onTurned(offset: number): void;
  /** 往后翻过最后一页（1）/ 往前翻过第一页（-1）：换到下一章开头 / 上一章最后一页。 */
  onEdge(direction: 1 | -1): void;
}

/** 第 offset 个字在第几页；它量不出时往后找最近量得出的字。 */
function pageNear(surface: Pick<PageSurface, 'pageOf'>, offset: number, length: number): number | null {
  const last = Math.min(length - 1, offset + BLANK_LOOKAHEAD);
  for (let at = offset; at <= last; at += 1) {
    const page = surface.pageOf(at);
    if (page !== null) {
      return page;
    }
  }
  return null;
}

/**
 * 第 page 页的第一个字：二分找最小的下标，使它所在的页 ≥ page（栏是按字的先后排下去的，页号随下标不减）。
 * 量不出的当作在后面。第 0 页是 0；这一页一个字也没有（只有插图）时是这一页之后第一个字。
 */
export function firstOffsetOnPage(surface: Pick<PageSurface, 'pageOf'>, length: number, page: number): number {
  if (page <= 0 || length <= 0) {
    return 0;
  }
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const at = pageNear(surface, middle, length);
    if (at === null || at >= page) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export class Paginator {
  private readonly surface: PageSurface;
  private readonly events: PaginatorEvents;
  private current = 0;
  private total = 1;
  private step = 0;
  private anchorOffset = 0;
  /** 每翻一次加一：连着翻时只有最后一次停下才报。 */
  private turns = 0;

  constructor(surface: PageSurface, events: PaginatorEvents) {
    this.surface = surface;
    this.events = events;
  }

  get page(): number {
    return this.current;
  }

  get pages(): number {
    return this.total;
  }

  /** 锚点：当前这一页第一个字（或跳到的那一字）的下标。 */
  get anchor(): number {
    return this.anchorOffset;
  }

  /** 排版变了：重新量，回到锚点所在的那一页（不动锚点、不报进度）。 */
  relayout(): void {
    this.measure();
    this.current = this.pageFor(this.anchorOffset);
    void this.surface.show(this.current, this.step, false);
  }

  /** 跳到某一字（打开、跳转、搜索结果）或这一章最后一页（往前翻进上一章）。返回锚点。 */
  showOffset(target: number | 'end'): number {
    this.measure();
    this.turns += 1;
    if (target === 'end') {
      this.current = this.total - 1;
      this.anchorOffset = firstOffsetOnPage(this.surface, this.surface.length(), this.current);
    } else {
      this.anchorOffset = clamp(target, 0, this.surface.length());
      this.current = this.pageFor(this.anchorOffset);
    }
    void this.surface.show(this.current, this.step, false);
    return this.anchorOffset;
  }

  next(): Promise<void> {
    return this.turn(1);
  }

  prev(): Promise<void> {
    return this.turn(-1);
  }

  /** 翻一页；过了这一章的头尾交给 onEdge。平移停下后锚点换成新一页的页首、报一次。 */
  async turn(direction: 1 | -1): Promise<void> {
    this.measure();
    const target = this.current + direction;
    if (target < 0 || target >= this.total) {
      this.events.onEdge(direction);
      return;
    }
    this.current = target;
    this.turns += 1;
    const turn = this.turns;
    await this.surface.show(target, this.step, true);
    if (turn !== this.turns) {
      return;
    }
    this.anchorOffset = firstOffsetOnPage(this.surface, this.surface.length(), target);
    this.events.onTurned(this.anchorOffset);
  }

  /** 拖着翻（触摸）松手：回到第 page 页（吸附），和点翻页一样报。 */
  async settle(page: number): Promise<void> {
    this.measure();
    const target = clamp(page, 0, this.total - 1);
    const moved = target !== this.current;
    this.current = target;
    this.turns += 1;
    const turn = this.turns;
    await this.surface.show(target, this.step, true);
    if (turn !== this.turns || !moved) {
      return;
    }
    this.anchorOffset = firstOffsetOnPage(this.surface, this.surface.length(), target);
    this.events.onTurned(this.anchorOffset);
  }

  private measure(): void {
    const metrics = this.surface.measure();
    this.step = metrics.step;
    this.total = Math.max(1, metrics.pages);
    this.current = clamp(this.current, 0, this.total - 1);
  }

  private pageFor(offset: number): number {
    const length = this.surface.length();
    if (offset >= length) {
      return this.total - 1;
    }
    const page = pageNear(this.surface, offset, length);
    return clamp(page ?? 0, 0, this.total - 1);
  }
}
