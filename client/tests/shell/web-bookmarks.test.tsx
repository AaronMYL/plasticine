import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FakeApi } from '../../src/api/fake/index.ts';
import type { PlasticineMacWebTabs, WebTabsSync } from '../../src/api/shared.ts';
import { dropIndex } from '../../src/shell/columns/bookmark-drag.ts';
import { webHash } from '../../src/state/web-tabs.ts';
import { renderApp, settle, type AppHarness } from '../helpers.tsx';

const RED = 'https://www.xiaohongshu.com/explore';
const GITHUB = 'https://github.com/';

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

function seed(fake: FakeApi): void {
  fake.control.bookmarks.seed({ id: 'bm-red', kind: 'web', title: '小红书', target: RED });
  fake.control.bookmarks.seed({ id: 'bm-gh', kind: 'web', title: 'GitHub', target: GITHUB });
  fake.control.bookmarks.seed({ id: 'bm-note', kind: 'page', title: '一篇笔记', target: '#/notes/n1' });
}

afterEach(() => {
  delete window.plasticineDesktop;
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function column(): HTMLElement {
  return screen.getByRole('complementary', { name: '网页' });
}

function list(): HTMLElement {
  return within(column()).getByRole('list', { name: '书签' });
}

function titles(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.web-bookmark-title')].map((title) => title.textContent ?? '');
}

function liveTitles(app: AppHarness): Promise<string[]> {
  return app.control.bookmarks.list().then((result) => result.bookmarks.map((row) => row.title));
}

async function start(): Promise<AppHarness> {
  installBridge();
  const app = await renderApp({ hash: '#/web', setup: seed });
  await within(column()).findByRole('button', { name: '小红书' });
  return app;
}

describe('web rail Bookmarks section', () => {
  it('sits between search and pinned; clicking opens tab in Today or switches to open tab', async () => {
    const app = await start();
    const parts = [...column()
      .querySelectorAll('.web-search, .web-bookmarks, .web-bookmarks-rule, ul[aria-label="今天"]')];
    expect(parts.map((part) => part.className.split(' ')[0])).toEqual(['web-search', 'web-bookmarks',
      'web-bookmarks-rule', 'web-tabs']);
    expect(titles(list())).toEqual(['小红书', 'GitHub']);

    fireEvent.click(within(list()).getByRole('button', { name: '小红书' }));
    const opened = app.state.webTabs.get().tabs.find((tab) => tab.url === RED);
    expect(opened).toBeDefined();
    await waitFor(() => expect(window.location.hash).toBe(webHash(opened!.id)));
    expect(app.state.webTabs.get().today[0]).toBe(opened!.id);
    expect(await liveTitles(app)).toEqual(['小红书', 'GitHub', '一篇笔记']);
    expect(within(list()).getByRole('button', { name: '小红书，已开着' })).toBeTruthy();

    act(() => {
      window.location.hash = '#/web';
    });
    fireEvent.click(await within(list()).findByRole('button', { name: '小红书，已开着' }));
    await waitFor(() => expect(window.location.hash).toBe(webHash(opened!.id)));
    expect(app.state.webTabs.get().tabs.filter((tab) => tab.url === RED)).toHaveLength(1);
  });

  it('treats open tab on same URL with hash fragment as already open and switches to it', async () => {
    const app = await start();
    let id = '';
    act(() => {
      id = app.state.webTabs.open(`${GITHUB}#`, 'GitHub', 'user');
    });
    fireEvent.click(await within(list()).findByRole('button', { name: 'GitHub，已开着' }));
    await waitFor(() => expect(window.location.hash).toBe(webHash(id)));
    expect(app.state.webTabs.get().tabs).toHaveLength(1);
  });

  it('clicking section header collapses and expands with local persistence', async () => {
    const app = await start();
    const head = within(column()).getByRole('button', { name: '书签' });
    expect(head.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(app.state.shellPrefs.store.get().bookmarksCollapsed).toBe(true);
    await waitFor(() => expect(document.getElementById(head.getAttribute('aria-controls')!)?.hidden).toBe(true));
    fireEvent.click(head);
    expect(app.state.shellPrefs.store.get().bookmarksCollapsed).toBe(false);
  });

  it('context-menu rename switches to inline input and saves on Enter', async () => {
    const app = await start();
    fireEvent.contextMenu(within(list()).getByRole('button', { name: 'GitHub' }));
    const menu = screen.getByRole('menu', { name: '书签的操作' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent))
      .toEqual(['在新标签打开', '改名', '删除']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: '改名' }));
    const input = within(list()).getByRole('textbox', { name: '「GitHub」的新名字' });
    fireEvent.change(input, { target: { value: '代码' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await within(list()).findByRole('button', { name: '代码' });
    expect(await liveTitles(app)).toEqual(['小红书', '代码', '一篇笔记']);
  });

  it('context-menu Open in New Tab switches if already open, matching click', async () => {
    const app = await start();
    fireEvent.contextMenu(within(list()).getByRole('button', { name: '小红书' }));
    fireEvent.click(within(screen.getByRole('menu', { name: '书签的操作' }))
      .getByRole('menuitem', { name: '在新标签打开' }));
    await waitFor(() => expect(app.state.webTabs.get().tabs.map((tab) => tab.url)).toEqual([RED]));
  });

  it('delete shows inline undo row without confirm; clicking away or ignoring dismisses it', async () => {
    const app = await start();
    fireEvent.contextMenu(within(list()).getByRole('button', { name: '小红书' }));
    fireEvent.click(within(screen.getByRole('menu', { name: '书签的操作' })).getByRole('menuitem', { name: '删除' }));
    const gone = within(list()).getByRole('status');
    expect(gone.textContent).toContain('已删除「小红书」');
    await waitFor(async () => expect(await liveTitles(app)).toEqual(['GitHub', '一篇笔记']));
    fireEvent.click(within(gone).getByRole('button', { name: '撤销' }));
    await waitFor(async () => expect(await liveTitles(app)).toEqual(['小红书', 'GitHub', '一篇笔记']));
    await waitFor(() => expect(titles(list())).toEqual(['小红书', 'GitHub']));
    expect(within(list()).queryByRole('status')).toBeNull();

    fireEvent.contextMenu(within(list()).getByRole('button', { name: 'GitHub' }));
    fireEvent.click(within(screen.getByRole('menu', { name: '书签的操作' })).getByRole('menuitem', { name: '删除' }));
    expect(within(list()).getByRole('status').textContent).toContain('已删除「GitHub」');
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(within(list()).queryByRole('status')).toBeNull());
    expect(await liveTitles(app)).toEqual(['小红书', '一篇笔记']);
  });

  it('inline undo row auto-dismisses after a few seconds if not clicked', async () => {
    await start();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.contextMenu(within(list()).getByRole('button', { name: '小红书' }));
      fireEvent.click(within(screen.getByRole('menu', { name: '书签的操作' })).getByRole('menuitem', { name: '删除' }));
      expect(within(list()).getByRole('status')).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      expect(within(list()).queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('on web build, clicking bookmark opens new window, logs in Today, keeps main pane', async () => {
    const app = await renderApp({ hash: '#/web', setup: seed });
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    fireEvent.click(await within(column()).findByRole('button', { name: '小红书' }));
    expect(opened).toHaveBeenCalledWith(RED, '_blank', 'noopener,noreferrer');
    expect(app.state.webTabs.get().tabs.map((tab) => tab.url)).toEqual([RED]);
    expect(window.location.hash).toBe('#/web');
  });

  it('bookmarks.changed event from another device updates list', async () => {
    const app = await start();
    await act(async () => {
      await app.api.bookmarks.add({ requestId: 'other-device-1', kind: 'web', title: '抖音精选',
        target: 'https://www.douyin.com/jingxuan' });
    });
    await waitFor(() => expect(titles(list())).toEqual(['小红书', 'GitHub', '抖音精选']));
  });

  it('omits Bookmarks section and divider when no web bookmarks exist', async () => {
    installBridge();
    await renderApp({ hash: '#/web' });
    await settle();
    expect(within(column()).queryByRole('button', { name: '书签' })).toBeNull();
    expect(column().querySelector('.web-bookmarks-rule')).toBeNull();
  });

  it('tab search also searches bookmarks in a Bookmarks group and opens on click', async () => {
    const app = await start();
    fireEvent.change(within(column()).getByRole('searchbox', { name: '搜标签' }), { target: { value: '小红' } });
    fireEvent.click(within(within(column()).getByRole('list', { name: '书签' })).getByRole('button', { name: '小红书' }));
    await waitFor(() => expect(app.state.webTabs.get().tabs.map((tab) => tab.url)).toEqual([RED]));
  });
});

describe('web rail collapsible sections', () => {
  it('Bookmarks and Today share header style with name, count, collapse, and persistence', async () => {
    const app = await start();
    const today = within(column()).getByRole('button', { name: '今天' });
    expect(today.getAttribute('aria-expanded')).toBe('true');
    expect(within(column()).getByRole('button', { name: '书签' }).textContent).toBe('书签2');
    fireEvent.click(today);
    expect(today.getAttribute('aria-expanded')).toBe('false');
    expect(app.state.shellPrefs.store.get().collapsedColumns).toContain('web:today');
    fireEvent.click(today);
    expect(app.state.shellPrefs.store.get().collapsedColumns).not.toContain('web:today');
  });
});

describe('drag reorder drop index', () => {
  it('counts other rows whose midpoint is above pointer from 0 to row count', () => {
    const rows = [{ top: 100, bottom: 132 }, { top: 132, bottom: 164 }, { top: 164, bottom: 196 }];
    expect(dropIndex(rows, 90)).toBe(0);
    expect(dropIndex(rows, 120)).toBe(1);
    expect(dropIndex(rows, 150)).toBe(2);
    expect(dropIndex(rows, 300)).toBe(3);
    expect(dropIndex([], 120)).toBe(0);
  });
});

describe('address bar bookmark button', () => {
  it('shows hollow star when unbookmarked, fills on click, and unbookmarks on second click', async () => {
    const app = await start();
    act(() => {
      window.location.hash = webHash(app.state.webTabs.open('https://blog.example.org/a', '一篇文章', 'user'));
    });
    const main = screen.getByRole('main');
    const toggle = await within(main).findByRole('button', { name: '加书签' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.closest('.web-address')).not.toBeNull();
    fireEvent.click(toggle);
    const on = await within(main).findByRole('button', { name: '取消书签' });
    expect(on.getAttribute('aria-pressed')).toBe('true');
    expect(await liveTitles(app)).toEqual(['小红书', 'GitHub', '一篇笔记', '一篇文章']);
    await within(list()).findByRole('button', { name: '一篇文章，已开着' });
    fireEvent.click(on);
    await within(main).findByRole('button', { name: '加书签' });
    expect(await liveTitles(app)).toEqual(['小红书', 'GitHub', '一篇笔记']);
  });

  it('already bookmarked page shows filled star; toolbar omits legacy pin/group action', async () => {
    const app = await start();
    act(() => {
      window.location.hash = webHash(app.state.webTabs.open(RED, '小红书', 'user'));
    });
    const main = screen.getByRole('main');
    expect((await within(main).findByRole('button', { name: '取消书签' })).getAttribute('aria-pressed')).toBe('true');
    expect(within(main).queryByRole('button', { name: '收进置顶或分组' })).toBeNull();
  });
});

describe('Cmd+K searches bookmarks', () => {
  it('typing lists Bookmarks group and Enter opens like clicking a bookmark', async () => {
    const app = await start();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const panel = await screen.findByRole('dialog', { name: '搜索和切换' });
    const input = within(panel).getByRole('combobox', { name: '搜索和切换' });
    fireEvent.change(input, { target: { value: '小红' } });
    await within(panel).findByText('书签');
    expect(within(panel).getByRole('option', { name: /小红书/ })).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(app.state.webTabs.get().tabs.map((tab) => tab.url)).toEqual([RED]));
  });
});

describe('mobile web overflow bookmarks', () => {
  it('overflow top bar includes Bookmarks opening shared list with mobile web behavior', async () => {
    const app = await renderApp({ hash: '#/web', setup: seed, width: 390 });
    act(() => {
      window.location.hash = webHash(app.state.webTabs.open('https://blog.example.org/a', '一篇文章', 'user'));
    });
    const main = screen.getByRole('main');
    fireEvent.click(await within(main).findByRole('button', { name: '更多' }));
    fireEvent.click(within(screen.getByRole('menu', { name: '更多' })).getByRole('menuitem', { name: '书签' }));
    const panel = await screen.findByRole('dialog', { name: '书签' });
    expect(titles(panel)).toEqual(['小红书', 'GitHub']);
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    fireEvent.click(within(panel).getByRole('button', { name: '小红书' }));
    expect(opened).toHaveBeenCalledWith(RED, '_blank', 'noopener,noreferrer');
    expect(app.state.webTabs.get().tabs.some((tab) => tab.url === RED)).toBe(true);
  });
});
