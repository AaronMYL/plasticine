import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissToast, showToast, TOAST_MS, ToastHost } from '../../src/primitives/toast/index.tsx';

describe('toast: single unified variant', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => dismissToast());
    vi.useRealTimers();
  });

  it('shows one sentence and auto-dismisses after 5 seconds', () => {
    render(<ToastHost />);
    act(() => showToast({ text: 'X 新增 12 篇' }));
    expect(screen.getByRole('status').textContent).toBe('X 新增 12 篇');
    act(() => { vi.advanceTimersByTime(TOAST_MS - 100); });
    expect(screen.queryByText('X 新增 12 篇')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(100); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText('X 新增 12 篇')).toBeNull();
  });

  it('supports at most one action, dismissing before running it', () => {
    const undo = vi.fn();
    render(<ToastHost />);
    act(() => showToast({ text: '已删除「搬家清单」', action: { label: '撤销', icon: 'undo', run: undo } }));
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('已删除「搬家清单」')).toBeNull();
  });

  it('pauses timer on hover and resumes when pointer leaves', () => {
    render(<ToastHost />);
    act(() => showToast({ text: '已复制' }));
    fireEvent.mouseEnter(screen.getByText('已复制').parentElement!);
    act(() => { vi.advanceTimersByTime(TOAST_MS * 3); });
    expect(screen.queryByText('已复制')).not.toBeNull();
    fireEvent.mouseLeave(screen.getByText('已复制').parentElement!);
    act(() => { vi.advanceTimersByTime(TOAST_MS); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText('已复制')).toBeNull();
  });

  it('new toast replaces previous one and resets timer', () => {
    render(<ToastHost />);
    act(() => showToast({ text: '第一条' }));
    act(() => { vi.advanceTimersByTime(TOAST_MS - 500); });
    act(() => showToast({ text: '第二条' }));
    expect(screen.queryByText('第一条')).toBeNull();
    act(() => { vi.advanceTimersByTime(TOAST_MS - 500); });
    expect(screen.queryByText('第二条')).not.toBeNull();
  });

  it('failure toast announces immediately with alert role', () => {
    render(<ToastHost />);
    act(() => showToast({ text: 'X 没刷新成：在 Plasticine 浏览器里登录 X', tone: 'error' }));
    expect(screen.getByRole('alert').textContent).toContain('没刷新成');
  });
});
