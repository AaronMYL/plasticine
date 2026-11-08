import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../helpers.tsx';

describe('信息流条目直达', () => {
  it('真实条目即使已隐藏也能直接打开、定位并操作，返回列表照旧', async () => {
    const app = await renderApp({ hash: '#/feed/target', setup: (fake) => {
      fake.control.feed.seedItem({ id: 'target', title: '汇报提到的条目', reaction: 'dislike' });
      fake.control.feed.seedItem({ id: 'other', title: '另一条收藏', saved: true });
      vi.spyOn(fake.api.feed, 'get');
    } });
    act(() => app.state.feedUi.setIncludeHidden(false));
    const row = await screen.findByRole('listitem', { name: '汇报提到的条目' });
    expect(screen.queryByRole('listitem', { name: '另一条收藏' })).toBeNull();
    const target = screen.getByRole('region', { name: '直达的信息' });
    await waitFor(() => expect(document.activeElement).toBe(target));
    expect(target.getAttribute('data-target-highlight')).toBe('true');
    expect(app.api.feed.get).toHaveBeenCalledWith('target', expect.any(AbortSignal));
    fireEvent.click(within(row).getByRole('button', { name: '收藏' }));
    await within(row).findByRole('button', { name: '已收藏' });
    fireEvent.click(screen.getByRole('button', { name: '返回信息流' }));
    await screen.findByRole('listitem', { name: '另一条收藏' });
    expect(screen.queryByRole('listitem', { name: '汇报提到的条目' })).toBeNull();
  });

  it('目标不存在时说明失败并提供重读及返回，不用其他条目代替', async () => {
    await renderApp({ hash: '#/feed/missing', setup: (fake) => {
      fake.control.feed.seedItem({ id: 'other', title: '不应替代的条目' });
    } });
    expect((await screen.findByRole('alert')).textContent).toContain('这条信息已找不到');
    expect(screen.getByRole('button', { name: '重读这条信息' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '返回信息流' })).toBeTruthy();
    expect(screen.queryByRole('listitem', { name: '不应替代的条目' })).toBeNull();
  });
});
