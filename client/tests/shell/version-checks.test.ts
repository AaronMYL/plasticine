import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduleVersionChecks, VERSION_SAFETY_MS, VERSION_STALE_MS } from '../../src/shell/version-checks.ts';

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

describe('update check schedule', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('replaces per-minute polling with 30-minute foreground fallback check', () => {
    const h = harness();
    vi.advanceTimersByTime(60_000);
    expect(h.check).not.toHaveBeenCalled();
    vi.advanceTimersByTime(VERSION_SAFETY_MS - 60_000);
    expect(h.check).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('skips update checks while window is in background', () => {
    const h = harness();
    h.setVisible(false);
    vi.advanceTimersByTime(VERSION_SAFETY_MS * 3);
    expect(h.check).not.toHaveBeenCalled();
    h.stop();
  });

  it('returning to foreground checks only if more than 5 minutes elapsed', () => {
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

  it('checks immediately on service restart or release change, ignoring unrelated events', () => {
    const h = harness();
    h.emit('line.updated');
    expect(h.check).not.toHaveBeenCalled();
    h.emit('resync');
    h.emit('client.versionChanged');
    expect(h.check).toHaveBeenCalledTimes(2);
    h.stop();
  });

  it('stops all update checks after stop', () => {
    const h = harness();
    h.stop();
    h.emit('resync');
    vi.advanceTimersByTime(VERSION_SAFETY_MS * 2);
    expect(h.check).not.toHaveBeenCalled();
  });
});
