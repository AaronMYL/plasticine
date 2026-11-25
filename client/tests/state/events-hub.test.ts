import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorText, uncertainError } from '../../src/api/errors.ts';
import { EventsHub } from '../../src/state/events-hub.ts';
import { FakeEventBus } from '../../src/api/fake/event-bus.ts';
import type { LiveEvent } from '../../src/api/types.ts';

const EVENT: LiveEvent = { type: 'note.deleted', noteId: 'n1' };

afterEach(() => {
  vi.useRealTimers();
});

describe('EventsHub: single app-wide event stream', () => {
  it('transitions to open on connect and dispatches events to all subscribers', async () => {
    const bus = new FakeEventBus();
    const hub = new EventsHub(bus);
    const first = vi.fn();
    const second = vi.fn();
    hub.on(first);
    hub.on(second);
    hub.start();
    await Promise.resolve();
    expect(hub.status.get()).toBe('open');
    bus.emit(EVENT);
    expect(first).toHaveBeenCalledWith(EVENT);
    expect(second).toHaveBeenCalledWith(EVENT);
    expect(bus.subscriberCount).toBe(1);
    hub.stop();
  });

  it('reconnect restarts stream preserving subscriptions when running and no-ops when stopped', async () => {
    const bus = new FakeEventBus();
    const hub = new EventsHub(bus);
    hub.reconnect();
    expect(bus.subscriberCount).toBe(0);
    const seen = vi.fn();
    hub.on(seen);
    hub.start();
    await Promise.resolve();
    hub.reconnect();
    await Promise.resolve();
    expect(bus.subscriberCount).toBe(1);
    bus.emit(EVENT);
    expect(seen).toHaveBeenCalledWith(EVENT);
    hub.stop();
  });

  it('reconnects with backoff after disconnect and returns status to open', async () => {
    vi.useFakeTimers();
    const bus = new FakeEventBus();
    const hub = new EventsHub(bus);
    hub.start();
    await vi.advanceTimersByTimeAsync(0);
    bus.disconnectAll();
    expect(hub.status.get()).toBe('closed');
    expect(bus.subscriberCount).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(bus.subscriberCount).toBe(1);
    expect(hub.status.get()).toBe('open');
    hub.stop();
  });

  it('emits resync after reconnect (not initial connect) so views refetch missed updates', async () => {
    vi.useFakeTimers();
    const bus = new FakeEventBus();
    const hub = new EventsHub(bus);
    const events: LiveEvent[] = [];
    hub.on((event) => events.push(event));
    hub.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([]);
    bus.disconnectAll();
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toEqual([{ type: 'resync' }]);
    hub.stop();
  });

  it('stop prevents further reconnects and clears timers', async () => {
    vi.useFakeTimers();
    const bus = new FakeEventBus();
    const hub = new EventsHub(bus);
    hub.start();
    hub.stop();
    expect(bus.subscriberCount).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(bus.subscriberCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('error copy formatting', () => {
  it('formats uncertain receipt as pending verification with next step instead of failure', () => {
    const text = errorText(uncertainError('发送'));
    expect(text).toContain('尚未取得服务回执');
    expect(text).toContain('结果待核实');
  });

  it('preserves original message for non-API errors', () => {
    expect(errorText(new Error('磁盘满了'))).toBe('出错了：磁盘满了');
  });
});
