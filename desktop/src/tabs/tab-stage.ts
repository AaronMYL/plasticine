// 网页标签什么时候露出来、什么时候藏起来（11-09 他录的屏：从别的栏目切到网页，网页先出现在旧画面上，界面换好以后才对上）。
// 界面一变就同步（React 在点击后、画出新画面之前发），视图又是主进程立刻改的，所以视图总比界面早一两帧。办法是让界面
// 自己的画面来决定什么时候看得见：
// - 显示：先垫在界面下面、按位置显示——界面旧画面那一块是实的，盖着它；界面画出网页栏、那一块透明时正好露出来。
//   要叠在上面的（没有浮层压着），等界面换好再升上去。
// - 升上去一律等一会儿、要一直没有浮层才升；垫下去马上（界面偶尔报一帧空的浮层，网页不跟着盖住对话框）。
// - 离开：先垫到下面——界面新画面是实的，盖住它；等界面换好再藏起来。中途又回来就不藏了。
// - 换标签：新的照「显示」来，旧的立刻藏。
// 已经在对的那一层就不再挪（tab-layering.ts 的 restackIndex）。

import type { TabLayer } from './tab-layering.ts';

/** 界面换好的那一帧上屏一般要 1–2 帧（16–33ms），留到 100ms 给慢一点的机器；这段时间里视图垫在下面，照样看得见。 */
export const SETTLE_MS = 100;

export interface StageViews {
  /** 把这个标签的视图放到界面上面或下面（已经在那一层就不动）。 */
  place(tabId: string, layer: TabLayer): void;
  show(tabId: string, visible: boolean): void;
}

export class TabStage {
  private readonly views: StageViews;
  /** 显示着的标签。 */
  private current: string | null = null;
  /** 界面要它在哪一层（最后一次同步算出来的）。 */
  private wanted: TabLayer = 'below';
  /** 显示着的标签现在实际在哪一层。 */
  private placed: TabLayer = 'below';
  private raiseTimer: ReturnType<typeof setTimeout> | null = null;
  /** 正在退场（垫在下面、等着藏）的标签。 */
  private leaving: string | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(views: StageViews) {
    this.views = views;
  }

  /** 每次同步：该显示哪个标签（没有是 null）、它该在哪一层。 */
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

  /** 标签关掉了：不再动它。 */
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

  /** 正在退场的那个（不是这次要显示的）：立刻藏起来。 */
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
