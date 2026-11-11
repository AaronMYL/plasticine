// 第二栏能收起（11-08 他定）：标题行最右边收起按钮、⌘\ 切换；按栏目各记各的；网页收成窄栏（展开按钮、搜标签、置顶、
// 分组图标块、今天只剩网站图标、+），别的栏目整列让给主区、展开按钮在主区页头最左边；手机不受影响。

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../helpers.tsx';

function column(): HTMLElement {
  const aside = document.querySelector<HTMLElement>('aside.column');
  if (aside === null) throw new Error('没有第二栏');
  return aside;
}

describe('第二栏收起', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('笔记：点收起整列让出来、主区左上角出展开按钮；⌘\\ 再展开；按栏目各记各的', async () => {
    const app = await renderApp({ hash: '#/notes' });
    fireEvent.click(within(column()).getByRole('button', { name: '收起侧栏' }));
    expect(column().getAttribute('data-collapsed')).toBe('hidden');
    expect(column().hasAttribute('inert')).toBe(true);
    const reveal = document.querySelector('.shell-main-area .column-reveal');
    expect(reveal).not.toBeNull();
    expect(app.state.shellPrefs.store.get().collapsedColumns).toEqual(['notes']);
    act(() => {
      window.location.hash = '#/feed';
    });
    await waitFor(() => expect(column().getAttribute('data-section')).toBe('reading'));
    expect(column().hasAttribute('data-collapsed')).toBe(false);
    act(() => {
      window.location.hash = '#/notes';
    });
    await waitFor(() => expect(column().getAttribute('data-collapsed')).toBe('hidden'));
    fireEvent.keyDown(window, { key: '\\', metaKey: true });
    expect(column().hasAttribute('data-collapsed')).toBe(false);
    expect(document.querySelector('.column-reveal')).toBeNull();
  });

  it('网页：收成窄栏——今天的标签只剩网站图标、悬停有标题；组是一个图标块，点了浮出这一组；当前那个标着', async () => {
    const app = await renderApp({ hash: '#/web' });
    let current = '';
    act(() => {
      const a = app.state.webTabs.open('https://a.example.com/', '甲', 'user');
      const b = app.state.webTabs.open('https://b.example.com/', '乙', 'user');
      app.state.webTabs.createGroup([a], '研究');
      current = b;
    });
    fireEvent.click(within(column()).getByRole('button', { name: '收起侧栏' }));
    expect(column().getAttribute('data-collapsed')).toBe('strip');
    const strip = column();
    const today = within(strip).getByRole('list', { name: '今天' });
    const tile = within(today).getByRole('button', { name: '乙' });
    expect(tile.getAttribute('data-tip')).toBe('乙');
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    fireEvent.click(tile);
    expect(opened).toHaveBeenCalledWith('https://b.example.com/', '_blank', 'noopener,noreferrer');
    act(() => {
      window.location.hash = `#/web/${current}`;
    });
    await waitFor(() => expect(within(today).getByRole('button', { name: '乙' }).getAttribute('aria-current'))
      .toBe('page'));
    fireEvent.click(within(strip).getByRole('button', { name: '研究，1 个标签' }));
    const pop = await screen.findByRole('dialog', { name: '研究' });
    expect(within(pop).getByRole('button', { name: /甲/ })).toBeTruthy();
    expect(within(strip).getByRole('button', { name: '新标签' })).toBeTruthy();
    fireEvent.click(within(strip).getByRole('button', { name: '展开侧栏' }));
    expect(column().hasAttribute('data-collapsed')).toBe(false);
  });

  it('手机上没有第二栏，也没有收起、展开按钮', async () => {
    await renderApp({ hash: '#/notes', width: 390 });
    expect(document.querySelector('aside.column')).toBeNull();
    expect(screen.queryByRole('button', { name: '收起侧栏' })).toBeNull();
    expect(screen.queryByRole('button', { name: '展开侧栏' })).toBeNull();
  });
});
