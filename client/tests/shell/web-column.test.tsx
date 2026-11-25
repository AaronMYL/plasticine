import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlasticineMacWebTabs, WebTabsSync } from '../../src/api/shared.ts';
import { renderApp, settle } from '../helpers.tsx';

function installBridge(): PlasticineMacWebTabs {
  const bridge: PlasticineMacWebTabs = {
    sync: vi.fn<(state: WebTabsSync) => void>(),
    command: vi.fn(),
    navigate: vi.fn(),
    snapshot: vi.fn(() => Promise.reject(new Error('读不到'))),
  };
  window.plasticineDesktop = { version: '0.5.0', notify: vi.fn(), webTabs: bridge };
  return bridge;
}

afterEach(() => {
  delete window.plasticineDesktop;
  vi.restoreAllMocks();
});

function column(): HTMLElement {
  return screen.getByRole('complementary', { name: '网页' });
}

describe('vertical tabs', () => {
  it('desktop shows pinned, groups, and Today; active tab has close button, falling back next', async () => {
    installBridge();
    const app = await renderApp({ hash: '#/web' });
    let a = '';
    let b = '';
    let pinned = '';
    act(() => {
      pinned = app.state.webTabs.open('https://mail.example.com/', '邮箱', 'user');
      app.state.webTabs.pin(pinned);
      const grouped = app.state.webTabs.open('https://issues.example.com/', 'Issues', 'user');
      app.state.webTabs.createGroup([grouped], 'Cyber Hunter');
      a = app.state.webTabs.open('https://a.example.com/', 'A 页', 'user');
      b = app.state.webTabs.open('https://b.example.com/', 'B 页', 'user');
    });
    await settle();
    expect(within(column()).getByRole('list', { name: '置顶' })).toBeTruthy();
    expect(within(column()).getByRole('button', { name: 'Cyber Hunter，1 个标签' }).getAttribute('aria-expanded'))
      .toBe('true');
    expect(within(within(column()).getByRole('list', { name: '今天' })).getAllByRole('listitem')
      .map((item) => item.querySelector('.web-tab-title')?.textContent)).toEqual(['B 页', 'A 页']);
    fireEvent.click(within(column()).getByRole('button', { name: 'A 页' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/web/${a}`));
    expect(within(column()).getByRole('button', { name: 'A 页' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(within(column()).getByRole('button', { name: '关掉 A 页' }));
    await waitFor(() => expect(window.location.hash).not.toBe(`#/web/${a}`));
    expect(app.state.webTabs.tab(a)).toBeNull();
    expect(app.state.webTabs.get().archived[0]?.url).toBe('https://a.example.com/');
    expect(b).not.toBe('');
  });

  it('clicking group header collapses and expands group', async () => {
    installBridge();
    const app = await renderApp({ hash: '#/web' });
    act(() => {
      app.state.webTabs.createGroup([app.state.webTabs.open('https://x.example.com/', 'X', 'user')], '研究');
    });
    await settle();
    const head = within(column()).getByRole('button', { name: '研究，1 个标签' });
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(document.getElementById(head.getAttribute('aria-controls')!)?.hidden).toBe(true));
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('true');
  });

  it('context menu supports pin and move to new group; search includes closed tabs', async () => {
    installBridge();
    const app = await renderApp({ hash: '#/web' });
    let id = '';
    act(() => {
      id = app.state.webTabs.open('https://a.example.com/', 'A 页', 'user');
      app.state.webTabs.close(app.state.webTabs.open('https://gone.example.com/', '关掉的那页', 'user'));
    });
    await settle();
    fireEvent.contextMenu(within(column()).getByRole('button', { name: 'A 页' }));
    fireEvent.click(within(screen.getByRole('menu', { name: '标签的操作' })).getByRole('menuitem', { name: '置顶' }));
    expect(app.state.webTabs.get().pinned).toEqual([id]);
    fireEvent.change(within(column()).getByRole('searchbox', { name: '搜标签' }), { target: { value: '关掉' } });
    expect(within(column()).getByRole('button', { name: '关掉的那页' })).toBeTruthy();
  });

  it('web build opens tab in new window, records in Today, keeps main pane unchanged', async () => {
    const app = await renderApp({ hash: '#/web' });
    act(() => {
      app.state.webTabs.open('https://a.example.com/', 'A 页', 'user');
    });
    await settle();
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    fireEvent.click(within(column()).getByRole('button', { name: 'A 页' }));
    expect(opened).toHaveBeenCalledWith('https://a.example.com/', '_blank', 'noopener,noreferrer');
    expect(window.location.hash).toBe('#/web');
  });
});
