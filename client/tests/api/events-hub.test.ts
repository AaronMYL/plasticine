import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorText, uncertainError } from '../../src/api/errors.ts';
import { EventsHub } from '../../src/api/events-hub.ts';
import { FakeEventBus } from '../../src/api/fake/event-bus.ts';
import type { LiveEvent } from '../../src/api/types.ts';

const EVENT: LiveEvent = { type: 'note.deleted', noteId: 'n1' };

afterEach(() => {
  vi.useRealTimers();
});

describe('EventsHub：整个应用一条事件流', () => {
  it('连上后状态是 open，事件分给每个订阅者', async () => {
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

  it('断线后按退避重连，重连上状态回到 open', async () => {
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

  it('断线重连上之后补报一次 resync：断线期间完成的回复、变了的任务，各视图重新拉一遍（第一次连上不报）', async () => {
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

  it('stop 之后不再重连，也不留计时器', async () => {
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

describe('错误文案', () => {
  it('回执不确定写成「待核实」和下一步，不是失败', () => {
    const text = errorText(uncertainError('发送'));
    expect(text).toContain('尚未取得服务回执');
    expect(text).toContain('结果待核实');
  });

  it('不是接口错误的异常保留原文', () => {
    expect(errorText(new Error('磁盘满了'))).toBe('出错了：磁盘满了');
  });
});
