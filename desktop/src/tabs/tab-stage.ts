import type { TabLayer } from './tab-layering.ts';

export const SETTLE_MS = 100;

export interface StageViews {
  place(tabId: string, layer: TabLayer): void;
  show(tabId: string, visible: boolean): void;
}

export class TabStage {
  private readonly views: StageViews;
  private current: string | null = null;
  private wanted: TabLayer = 'below';
  private placed: TabLayer = 'below';
  private raiseTimer: ReturnType<typeof setTimeout> | null = null;
  private leaving: string | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(views: StageViews) {
    this.views = views;
  }

  update(shown: string | null, layer: TabLayer): void {
    this.wanted = layer;
    if (this.leaving !== null && this.leaving === shown) {
      this.cancelHide();
      this.current = shown;
    }
    if (shown === null) {
      this.leave();
      return;
    }
    this.finishLeaving();
    if (this.current === shown) {
      if (layer === 'below') {
        this.cancelRaise();
        this.placeCurrent('below');
      } else if (this.placed !== 'above' && this.raiseTimer === null) {
        this.raiseLater(shown);
      }
      return;
    }
    if (this.current !== null) {
      this.cancelRaise();
      this.views.show(this.current, false);
    }
    this.current = shown;
    this.placeCurrent('below');
    this.views.show(shown, true);
    if (layer === 'above') {
      this.raiseLater(shown);
    }
  }

  forget(tabId: string): void {
    if (this.current === tabId) {
      this.cancelRaise();
      this.current = null;
    }
    if (this.leaving === tabId) {
      this.cancelHide();
    }
  }

  private placeCurrent(layer: TabLayer): void {
    if (this.current !== null) {
      this.views.place(this.current, layer);
      this.placed = layer;
    }
  }

  private raiseLater(tabId: string): void {
    this.raiseTimer = setTimeout(() => {
      this.raiseTimer = null;
      if (this.current === tabId && this.wanted === 'above') {
        this.placeCurrent('above');
      }
    }, SETTLE_MS);
  }

  private leave(): void {
    const previous = this.current;
    if (previous === null) {
      return;
    }
    this.cancelRaise();
    this.placeCurrent('below');
    this.current = null;
    this.leaving = previous;
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null;
      this.leaving = null;
      this.views.show(previous, false);
    }, SETTLE_MS);
  }

  private finishLeaving(): void {
    const leaving = this.leaving;
    if (leaving === null) {
      return;
    }
    this.cancelHide();
    this.views.show(leaving, false);
  }

  private cancelRaise(): void {
    if (this.raiseTimer !== null) {
      clearTimeout(this.raiseTimer);
      this.raiseTimer = null;
    }
  }

  private cancelHide(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.leaving = null;
  }
}
