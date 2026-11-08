// 网页栏目的第二栏（11-07 设计稿 Web）：只有网页是标签。置顶一排图标、分组（整组收起展开）、今天打开的；当前那个带 ×；
// 右键菜单置顶 / 放进分组 / 关掉；搜标签连关掉的也搜。网页版里点标签在新窗口打开，桌面客户端里在主区开。

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

describe('竖排标签', () => {
  it('桌面客户端：置顶、分组、今天三处；点一个在主区开，当前那个带 ×，关掉落到下一个', async () => {
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

  it('组标题点了整组收起，再点展开', async () => {
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

  it('右键菜单：置顶、放进新分组；搜标签连关掉的也搜得到', async () => {
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

  it('网页版：点标签在新窗口打开，记成今天看过，主区不动', async () => {
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
