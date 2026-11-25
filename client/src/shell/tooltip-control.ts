export const TIP_DELAY = 500;
export const TIP_SKIP_WINDOW = 300;

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

  press(host: Host): void {
    this.cancelPending();
    this.pressed = host;
    if (this.current !== null) {
      this.close();
    }
  }

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
