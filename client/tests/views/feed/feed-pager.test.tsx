// 信息流接着读（11-12 第 3 条）：到底「已到底」、读的时候「正在读更早的」、出错能再读一次。到顶往上拉的刷新第13批去掉了。

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MoreState } from '../../../src/views/feed/feed-pager.tsx';

describe('信息流接着读', () => {
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

});
