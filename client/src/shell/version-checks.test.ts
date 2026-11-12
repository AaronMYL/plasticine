import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleVersionChecks, VERSION_SAFETY_MS, VERSION_STALE_MS } from './version-checks.ts';

function harness() {
  let visible = true;
  const live = new Set<(type: string) => void>();
  const visibility = new Set<() => void>();
  const check = vi.fn();
  const stop = scheduleVersionChecks({
    check,
    onLiveEvent: (listener) => {
      live.add(listener);
      return () => live.delete(listener);
    },
    visible: () => visible,
    onVisibilityChange: (listener) => {
      visibility.add(listener);
      return () => visibility.delete(listener);
    },
    now: () => Date.now(),
  });
  return {
    check,
    stop,
    emit: (type: string) => live.forEach((listener) => listener(type)),
    setVisible: (next: boolean) => {
      visible = next;
      visibility.forEach((listener) => listener());
    },
  };
}

describe('查新版本的时机', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('不再每分钟查：前台开着半小时只兜底查一次', () => {
    const h = harness();
    vi.advanceTimersByTime(60_000);
    expect(h.check).not.toHaveBeenCalled();
    vi.advanceTimersByTime(VERSION_SAFETY_MS - 60_000);
    expect(h.check).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('窗口在后台时不查', () => {
    const h = harness();
    h.setVisible(false);
    vi.advanceTimersByTime(VERSION_SAFETY_MS * 3);
    expect(h.check).not.toHaveBeenCalled();
    h.stop();
  });

  it('切回前台：离上次超过 5 分钟才查', () => {
    const h = harness();
    h.setVisible(false);
    vi.advanceTimersByTime(60_000);
    h.setVisible(true);
    expect(h.check).not.toHaveBeenCalled();
    h.setVisible(false);
    vi.advanceTimersByTime(VERSION_STALE_MS);
    h.setVisible(true);
    expect(h.check).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('服务重启或发布记录变了马上查，别的事件不查', () => {
    const h = harness();
    h.emit('line.updated');
    expect(h.check).not.toHaveBeenCalled();
    h.emit('resync');
    h.emit('client.versionChanged');
    expect(h.check).toHaveBeenCalledTimes(2);
    h.stop();
  });

  it('停掉以后什么都不查', () => {
    const h = harness();
    h.stop();
    h.emit('resync');
    vi.advanceTimersByTime(VERSION_SAFETY_MS * 2);
    expect(h.check).not.toHaveBeenCalled();
  });
});
