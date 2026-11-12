// 信息流接着读与刷新（11-12 第 3 条）：到底「已到底」、读的时候「正在读更早的」、到顶接着往上滚就刷新、刷新后比出新条目。

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { FeedItemView } from '../../../src/api/types.ts';
import { MoreState, newCount, PullIndicator, usePullRefresh } from '../../../src/views/feed/feed-pager.tsx';

function Harness({ refresh }: { refresh: () => Promise<string | null> }): ReactNode {
  const board = useRef<HTMLElement>(null);
  const phase = usePullRefresh(board, refresh);
  return <div data-testid="scroller" style={{ overflowY: 'auto', height: '100px' }}>
    <section ref={board}><PullIndicator phase={phase} /><p>条目</p></section>
  </div>;
}

describe('信息流接着读与刷新', () => {
  it('刷新前后比一比：多出来几条', () => {
    const item = (id: string): FeedItemView => ({ id }) as FeedItemView;
    expect(newCount(new Set(['a', 'b']), [item('c'), item('a'), item('b'), item('d')])).toBe(2);
  });

  it('读的时候「正在读更早的」，到底「已到底」，出错能再读一次', () => {
    const retry = vi.fn();
    const { rerender } = render(<MoreState loading end={false} error={null} onRetry={retry} />);
    expect(screen.getByRole('status').textContent).toContain('正在读更早的');
    rerender(<MoreState loading={false} end error={null} onRetry={retry} />);
    expect(screen.getByText('已到底')).toBeTruthy();
    rerender(<MoreState loading={false} end={false} error="没读到" onRetry={retry} />);
    fireEvent.click(screen.getByRole('button', { name: '再读一次' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('在顶上接着往上滚过一段就刷新，结束后写一句', async () => {
    let finish: (text: string | null) => void = () => undefined;
    const refresh = vi.fn(() => new Promise<string | null>((resolve) => { finish = resolve; }));
    const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 500 });
    try {
      render(<Harness refresh={refresh} />);
      const scroller = screen.getByTestId('scroller');
      fireEvent.wheel(scroller, { deltaY: -60 });
      expect(refresh).not.toHaveBeenCalled();
      fireEvent.wheel(scroller, { deltaY: -120 });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status').textContent).toContain('正在刷新');
      await act(async () => finish('暂无新内容'));
      expect(screen.getByRole('status').textContent).toBe('暂无新内容');
    } finally {
      if (originalHeight !== undefined) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalHeight);
    }
  });
});
