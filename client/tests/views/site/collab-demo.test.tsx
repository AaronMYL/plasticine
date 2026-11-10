import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CollabDemo } from '../../../src/views/site/collab-demo.tsx';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('官网协作演示的完成状态', () => {
  it('一起做先显示排路线在做，回复出现后四行都做完了', () => {
    vi.useFakeTimers();
    render(<CollabDemo />);
    fireEvent.click(screen.getByRole('tab', { name: '一起做' }));
    const route = screen.getByText('排路线').closest('li');
    expect(route).not.toBeNull();
    expect(within(route as HTMLElement).getByRole('img', { name: '在做' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole('img', { name: '在做' })).toBeNull();
    expect(screen.getAllByRole('img', { name: '做完了' })).toHaveLength(4);
  });

  it('减少动态效果时一起做直接显示四个勾，汇总也有四个勾', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    render(<CollabDemo />);
    fireEvent.click(screen.getByRole('tab', { name: '一起做' }));
    expect(screen.queryByRole('img', { name: '在做' })).toBeNull();
    expect(screen.getAllByRole('img', { name: '做完了' })).toHaveLength(4);
    fireEvent.click(screen.getByRole('tab', { name: '汇总' }));
    expect(screen.getByText('4/4 完成')).toBeTruthy();
    expect(screen.getAllByRole('img', { name: '做完了' })).toHaveLength(4);
  });

  it('离开一起做后取消完成计时，重新进入会重新展示在做', () => {
    vi.useFakeTimers();
    render(<CollabDemo />);
    fireEvent.click(screen.getByRole('tab', { name: '一起做' }));
    act(() => vi.advanceTimersByTime(100));
    fireEvent.click(screen.getByRole('tab', { name: '拆解' }));
    act(() => vi.advanceTimersByTime(100));
    fireEvent.click(screen.getByRole('tab', { name: '一起做' }));
    expect(screen.getByRole('img', { name: '在做' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getAllByRole('img', { name: '做完了' })).toHaveLength(4);
  });
});
