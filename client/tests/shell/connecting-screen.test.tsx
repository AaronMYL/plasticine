// 打开时「正在连接」（11-15 界面统一，Aaron 弹框定，设计稿「多选、加载、空、正在连接」④）：不到 0.3 秒什么都不出；
// 之后窗口正中 Plasticine 的标下面一行「正在连接…」；8 秒还没连上或者出错，一行红字说原因，下面「重试」。

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECT_SHOW_MS, CONNECT_SLOW_MS, ConnectingScreen } from '../../src/shell/connecting-screen.tsx';

describe('打开时正在连接', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('0.3 秒内什么都不出；之后正中一个标加「正在连接…」；8 秒没连上写原因加「重试」', () => {
    const retry = vi.fn();
    const { container } = render(<ConnectingScreen error={null} onRetry={retry} />);
    expect(screen.queryByText('正在连接…')).toBeNull();
    act(() => { vi.advanceTimersByTime(CONNECT_SHOW_MS); });
    expect(screen.getByRole('status').textContent).toBe('正在连接…');
    expect(container.querySelector('.connecting .plasticine-mark')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(CONNECT_SLOW_MS - CONNECT_SHOW_MS); });
    expect(screen.getByRole('alert').textContent).toBe('没连上 Plasticine：过了 8 秒还没有回应');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('出错马上写原因，不等 0.3 秒', () => {
    render(<ConnectingScreen error="服务器没有回应" onRetry={() => undefined} />);
    expect(screen.getByRole('alert').textContent).toBe('没连上 Plasticine：服务器没有回应');
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });
});
