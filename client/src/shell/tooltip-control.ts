// 悬停提示什么时候出、什么时候收（2026-11-04 重做）。时序照 Radix Tooltip：鼠标停住 TIP_DELAY 才出，移开立即收；
// 一个开着（或刚收起不到 TIP_SKIP_WINDOW）时移到下一个，不再等，直接换过去（Floating UI 的 FloatingDelayGroup
// 也是这个意思）；键盘聚焦立即出；按下就收，鼠标不离开不再出；触屏只有点 ⓘ 这类「点了看说明」的才出，再点收。
// 这里只管时序，不碰 DOM 和 React：宿主（tooltip.tsx 的 TooltipLayer）把事件喂进来，show / hide 回调去画。

/** 停住多久才出：Radix 默认 700ms，用户定「约 500ms」。 */
export const TIP_DELAY = 500;
/** 收起后多久之内移到下一个直接出（Radix 的 skipDelayDuration 默认 300ms）。 */
export const TIP_SKIP_WINDOW = 300;

/** 为什么开着：键盘聚焦开的，鼠标移开不收（焦点还在）；点 ⓘ 开的，再点收。 */
export type TipCause = 'hover' | 'focus' | 'tap';

export interface TipClock {
  now: () => number;
  setTimeout: (run: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

const BROWSER_CLOCK: TipClock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => window.setTimeout(run, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

export class TipControl<Host> {
  private current: Host | null = null;
  private cause: TipCause | null = null;
  private pending: { host: Host; timer: number } | null = null;
  private closedAt = Number.NEGATIVE_INFINITY;
  /** 按下过的宿主：鼠标离开之前不再出。 */
  private pressed: Host | null = null;
  private readonly show: (host: Host) => void;
  private readonly hide: () => void;
  private readonly clock: TipClock;

  constructor(show: (host: Host) => void, hide: () => void, clock: TipClock = BROWSER_CLOCK) {
    this.show = show;
    this.hide = hide;
    this.clock = clock;
  }

  get openHost(): Host | null {
    return this.current;
  }

  hover(host: Host): void {
    if (this.pressed === host || this.current === host || this.pending?.host === host) {
      return;
    }
    this.cancelPending();
    const skip = this.current !== null || this.clock.now() - this.closedAt < TIP_SKIP_WINDOW;
    if (skip) {
      this.open(host, 'hover');
      return;
    }
    const timer = this.clock.setTimeout(() => {
      this.pending = null;
      this.open(host, 'hover');
    }, TIP_DELAY);
    this.pending = { host, timer };
  }

  leave(host: Host): void {
    if (this.pending?.host === host) {
      this.cancelPending();
    }
    if (this.pressed === host) {
      this.pressed = null;
    }
    if (this.current === host && this.cause === 'hover') {
      this.close();
    }
  }

  focus(host: Host): void {
    this.cancelPending();
    this.open(host, 'focus');
  }

  blur(host: Host): void {
    if (this.current === host) {
      this.close();
    }
  }

  /** 鼠标按下宿主：收起，这次停留不再出。 */
  press(host: Host): void {
    this.cancelPending();
    this.pressed = host;
    if (this.current !== null) {
      this.close();
    }
  }

  /**
   * 点了 ⓘ：触屏出，再点收（点别处由 dismiss 收）；鼠标点立刻出，移开就收；键盘（回车、空格）出，焦点走了才收。
   */
  tap(host: Host, by: 'touch' | 'mouse' | 'keyboard'): void {
    this.cancelPending();
    this.pressed = null;
    if (by === 'touch' && this.current === host) {
      this.close();
      return;
    }
    const cause: Record<typeof by, TipCause> = { touch: 'tap', mouse: 'hover', keyboard: 'focus' };
    this.open(host, cause[by]);
  }

  /** Esc、滚动、窗口失焦、点别处、宿主没了。 */
  dismiss(): void {
    this.cancelPending();
    if (this.current !== null) {
      this.close();
    }
  }

  private open(host: Host, cause: TipCause): void {
    this.current = host;
    this.cause = cause;
    this.show(host);
  }

  private close(): void {
    this.current = null;
    this.cause = null;
    this.closedAt = this.clock.now();
    this.hide();
  }

  private cancelPending(): void {
    if (this.pending !== null) {
      this.clock.clearTimeout(this.pending.timer);
      this.pending = null;
    }
  }
}
