import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MoreState } from '../../../src/views/feed/feed-pager.tsx';

describe('feed load more', () => {
  it('shows loading older, end-of-feed state, and retry on error', () => {
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
