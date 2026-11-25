export const PAGE_GAP = 48;
const BLANK_LOOKAHEAD = 32;

export interface PageMetrics {
  step: number;
  pages: number;
}

export interface PageSurface {
  measure(): PageMetrics;
  pageOf(offset: number): number | null;
  length(): number;
  show(page: number, step: number, animate: boolean): Promise<void>;
}

export interface PaginatorEvents {
  onTurned(offset: number): void;
  onEdge(direction: 1 | -1): void;
}

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

  get anchor(): number {
    return this.anchorOffset;
  }

  relayout(): void {
    this.measure();
    this.current = this.pageFor(this.anchorOffset);
    void this.surface.show(this.current, this.step, false);
  }

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
