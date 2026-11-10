import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../../src/api/context.tsx';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import type { SpaceView } from '../../../src/api/shared.ts';
import { ChangeToast } from '../../../src/views/spaces/space-toast.tsx';

const NOW = new Date('2026-11-11T08:00:00.000Z');

async function fixture() {
  const fake = createFakeApi({ seed: false, streamStepMs: 0, now: () => NOW });
  fake.control.session.signInForDevelopment('测试机');
  fake.control.spaces.seed();
  const space = { ...await fake.api.spaces.get('sp_research_2'), updatedAt: NOW.toISOString() };
  const open = (value: SpaceView = space) => render(<ApiProvider api={fake.api}>
    <ChangeToast space={value} onChanged={vi.fn()} />
  </ApiProvider>);
  return { fake, space, open };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('空间修改提示', () => {
  it('同一空间同一版本第二次打开不再提示，新版本仍提示', async () => {
    const { open, space } = await fixture();
    const view = open();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(localStorage.getItem('space-change-seen:sp_research_2:2')).toBe('1');
    view.unmount();
    const reopened = open();
    expect(screen.queryByRole('status')).toBeNull();
    reopened.unmount();
    open({ ...space, version: 3, lastChange: { ...space.lastChange!, version: 3 } });
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('出现六秒后收起', async () => {
    const { open } = await fixture();
    open();
    act(() => vi.advanceTimersByTime(5999));
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('悬停时暂停，移开后只继续剩下的时间', async () => {
    const { open } = await fixture();
    open();
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.mouseEnter(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.mouseLeave(screen.getByRole('status'));
    act(() => vi.advanceTimersByTime(3999));
    expect(screen.getByRole('status')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('十分钟前保存的修订不再提示', async () => {
    const { open, space } = await fixture();
    open({ ...space, updatedAt: new Date(NOW.getTime() - 600_001).toISOString() });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('本机存储读写失败时提示和收起仍可用', async () => {
    const { open } = await fixture();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('不可读'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('不可写'); });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    open();
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(warning).toHaveBeenCalledTimes(2);
  });
});
