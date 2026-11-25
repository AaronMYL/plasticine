import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECT_SHOW_MS, CONNECT_SLOW_MS, ConnectingScreen } from '../../src/shell/connecting-screen.tsx';

describe('initial connecting overlay', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('hides for 0.3s, then shows centered connecting badge, and shows error with retry at 8s', () => {
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

  it('shows error immediately without waiting 0.3s', () => {
    render(<ConnectingScreen error="服务器没有回应" onRetry={() => undefined} />);
    expect(screen.getByRole('alert').textContent).toBe('没连上 Plasticine：服务器没有回应');
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });
});
