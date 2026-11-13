// 书签和标签分开（第 8 批第 1 条，11-09 他定，设计稿 Bookmarks / Bookmark-Menu / Bookmark-Undo）：网页栏里搜标签下面
// 单独一节「书签」（整节能收起、记住），细线下面才是置顶 / 分组 / 今天。点书签：同一个网址开着就切过去，否则新开一个
// 标签进「今天」；书签本身不变，开着的行尾一个小点。右键：在新标签打开 / 改名（原处改）/ 删除（不确认，原处一行
// 「撤销」）。地址框里的书签按钮收藏 / 取消当前网址。手机 ⋯ 里「书签」点开是同一份。⌘K 搜得到书签。

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

/** 一列书签行的名字（行里还有网站图标的首字母，按名字那一格读）。 */
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

describe('网页栏的「书签」一节', () => {
  it('在搜标签和置顶之间；只列网页书签；点了新开一个标签进「今天」并切过去，书签不变；再点切回那一个', async () => {
    const app = await start();
    const parts = [...column().querySelectorAll('.web-search, .web-bookmarks, .web-bookmarks-rule, ul[aria-label="今天"]')];
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

  it('开着的标签浏览到同一个网页（末尾多个 #）也算开着：点了切过去，不开第二个', async () => {
    const app = await start();
    let id = '';
    act(() => {
      id = app.state.webTabs.open(`${GITHUB}#`, 'GitHub', 'user');
    });
    fireEvent.click(await within(list()).findByRole('button', { name: 'GitHub，已开着' }));
    await waitFor(() => expect(window.location.hash).toBe(webHash(id)));
    expect(app.state.webTabs.get().tabs).toHaveLength(1);
  });

  it('标题点了整节收起（记在本机），再点展开', async () => {
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

  it('右键改名：原处换成输入框，回车存', async () => {
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

  it('右键「在新标签打开」：和点一下一样，开着就切过去', async () => {
    const app = await start();
    fireEvent.contextMenu(within(list()).getByRole('button', { name: '小红书' }));
    fireEvent.click(within(screen.getByRole('menu', { name: '书签的操作' }))
      .getByRole('menuitem', { name: '在新标签打开' }));
    await waitFor(() => expect(app.state.webTabs.get().tabs.map((tab) => tab.url)).toEqual([RED]));
  });

  it('删除不确认：原处一行「已删除「…」 撤销」，撤销放回原处；不撤销的点别处就收走', async () => {
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

  it('删除后几秒没撤销，那一行自己收走', async () => {
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

  it('网页版：点书签在新窗口打开，记进「今天」，主区不动', async () => {
    const app = await renderApp({ hash: '#/web', setup: seed });
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    fireEvent.click(await within(column()).findByRole('button', { name: '小红书' }));
    expect(opened).toHaveBeenCalledWith(RED, '_blank', 'noopener,noreferrer');
    expect(app.state.webTabs.get().tabs.map((tab) => tab.url)).toEqual([RED]);
    expect(window.location.hash).toBe('#/web');
  });

  it('别的设备加了书签（bookmarks.changed）：这边跟着出来', async () => {
    const app = await start();
    await act(async () => {
      await app.api.bookmarks.add({ requestId: 'other-device-1', kind: 'web', title: '抖音精选',
        target: 'https://www.douyin.com/jingxuan' });
    });
    await waitFor(() => expect(titles(list())).toEqual(['小红书', 'GitHub', '抖音精选']));
  });

  it('没有网页书签：整节不出，细线也不出', async () => {
    installBridge();
    await renderApp({ hash: '#/web' });
    await settle();
    expect(within(column()).queryByRole('button', { name: '书签' })).toBeNull();
    expect(column().querySelector('.web-bookmarks-rule')).toBeNull();
  });

  it('搜标签也搜书签：书签一组，点了照样开', async () => {
    const app = await start();
    fireEvent.change(within(column()).getByRole('searchbox', { name: '搜标签' }), { target: { value: '小红' } });
    fireEvent.click(within(within(column()).getByRole('list', { name: '书签' })).getByRole('button', { name: '小红书' }));
    await waitFor(() => expect(app.state.webTabs.get().tabs.map((tab) => tab.url)).toEqual([RED]));
  });
});

describe('网页栏的小节（11-13 一套样子）', () => {
  it('书签、今天是同一种小标题：名字和个数，都能收起，记住', async () => {
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

describe('拖动排序落在哪', () => {
  it('数别的行里中线在指针上面的有几行：最上面是 0，最下面是行数', () => {
    const rows = [{ top: 100, bottom: 132 }, { top: 132, bottom: 164 }, { top: 164, bottom: 196 }];
    expect(dropIndex(rows, 90)).toBe(0);
    expect(dropIndex(rows, 120)).toBe(1);
    expect(dropIndex(rows, 150)).toBe(2);
    expect(dropIndex(rows, 300)).toBe(3);
    expect(dropIndex([], 120)).toBe(0);
  });
});

describe('地址框里的书签按钮', () => {
  it('没收藏是空心「加书签」，点了收藏、变实心；再点取消', async () => {
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

  it('已经收藏的网页是实心；工具条上不再有「收进置顶或分组」', async () => {
    const app = await start();
    act(() => {
      window.location.hash = webHash(app.state.webTabs.open(RED, '小红书', 'user'));
    });
    const main = screen.getByRole('main');
    expect((await within(main).findByRole('button', { name: '取消书签' })).getAttribute('aria-pressed')).toBe('true');
    expect(within(main).queryByRole('button', { name: '收进置顶或分组' })).toBeNull();
  });
});

describe('⌘K 搜得到书签', () => {
  it('打几个字，「书签」一组列出来；回车照点书签一样开', async () => {
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

describe('手机网页 ⋯ 里的书签', () => {
  it('⋯ 顶上一排有「书签」，点开是同一份书签，点了按手机打开网页的方式打开', async () => {
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
