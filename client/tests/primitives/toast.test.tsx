import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissToast, showToast, TOAST_MS, ToastHost } from '../../src/primitives/toast/index.tsx';

describe('提示条：只有一种', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => dismissToast());
    vi.useRealTimers();
  });

  it('一句话，5 秒后自己收', () => {
    render(<ToastHost />);
    act(() => showToast({ text: 'X 新增 12 篇' }));
    expect(screen.getByRole('status').textContent).toBe('X 新增 12 篇');
    act(() => { vi.advanceTimersByTime(TOAST_MS - 100); });
    expect(screen.queryByText('X 新增 12 篇')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(100); });
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText('X 新增 12 篇')).toBeNull();
  });

  it('最多一个动作：点了先收起再做', () => {
    const undo = vi.fn();
    render(<ToastHost />);
    act(() => showToast({ text: '已删除「搬家清单」', action: { label: '撤销', icon: 'undo', run: undo } }));
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('已删除「搬家清单」')).toBeNull();
  });

  it('鼠标停在上面不走，移开以后接着计时', () => {
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

  it('新的顶掉旧的，并且重新计时', () => {
    render(<ToastHost />);
    act(() => showToast({ text: '第一条' }));
    act(() => { vi.advanceTimersByTime(TOAST_MS - 500); });
    act(() => showToast({ text: '第二条' }));
    expect(screen.queryByText('第一条')).toBeNull();
    act(() => { vi.advanceTimersByTime(TOAST_MS - 500); });
    expect(screen.queryByText('第二条')).not.toBeNull();
  });

  it('没做成的立刻念（alert）', () => {
    render(<ToastHost />);
    act(() => showToast({ text: 'X 没刷新成：在 Plasticine 浏览器里登录 X', tone: 'error' }));
    expect(screen.getByRole('alert').textContent).toContain('没刷新成');
  });
});
