// 网页工具条（11-07 设计稿 Web）：← → ↻ · 圈一块 · 地址框（网站名 + 路径，点了出完整网址）· 文A · 收进（置顶或分组）· ⋯；
// ⋯ 菜单按原生报来的能力显示；查找、缩放（按网站记住）、截图、存进笔记、打印、阅读模式、历史记录、圈一块。
// 书签和分组的弹层没了：标签在网页栏目的第二栏竖排（11-07）。

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FakeApi } from '../../src/api/fake/index.ts';
import type { PlasticineMacWebTabs, WebPageTool, WebTabsSync } from '../../src/api/shared.ts';
import { webHash } from '../../src/state/web-tabs.ts';
import { renderApp, settle, type AppHarness } from '../helpers.tsx';

const ARTICLE = 'https://blog.example.org/local-first-sync';
const ALL_TOOLS = ['find', 'zoom', 'capture', 'capture_full', 'print', 'circle', 'thumbnail', 'downloads'];
/** 1×1 的 PNG。 */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

interface Bridge extends PlasticineMacWebTabs {
  sync: ReturnType<typeof vi.fn<(state: WebTabsSync) => void>>;
  command: ReturnType<typeof vi.fn<PlasticineMacWebTabs['command']>>;
  navigate: ReturnType<typeof vi.fn<PlasticineMacWebTabs['navigate']>>;
  tool: ReturnType<typeof vi.fn<(tabId: string, tool: WebPageTool) => Promise<unknown>>>;
}

function install(tools: string[] = ALL_TOOLS,
  answer: (tool: WebPageTool) => unknown = () => true): Bridge {
  const bridge: Bridge = {
    sync: vi.fn<(state: WebTabsSync) => void>(),
    command: vi.fn<PlasticineMacWebTabs['command']>(),
    navigate: vi.fn<PlasticineMacWebTabs['navigate']>(),
    snapshot: vi.fn((tabId: string) => Promise.resolve({ tabId, url: ARTICLE, title: '本地优先软件的同步难题',
      text: '慢工博客\n本地优先软件的同步难题\n把数据放在自己的设备上，离线也能用，这是本地优先软件最吸引人的地方。\n'
        + '冲突从哪里来\n冲突并不罕见。手机在地铁里改了标题，电脑上同时改了正文，这两处本可以合并。',
      totalChars: 120, truncated: false })),
    tools,
    tool: vi.fn((_tabId: string, tool: WebPageTool) => Promise.resolve(answer(tool))),
  };
  window.plasticineDesktop = { version: '0.5.0', notify: vi.fn(), webTabs: bridge,
    translate: { configure: vi.fn(), deliver: vi.fn() } };
  return bridge;
}

afterEach(() => {
  delete window.plasticineDesktop;
  vi.restoreAllMocks();
  window.localStorage.clear();
});

async function openArticle(app: AppHarness): Promise<string> {
  let id = '';
  act(() => {
    const hash = webHash(app.state.webTabs.open(ARTICLE, '本地优先软件的同步难题', 'user'));
    id = decodeURIComponent(hash.slice('#/web/'.length));
    window.location.hash = hash;
  });
  await within(screen.getByRole('main')).findByRole('button', { name: /^网址/ });
  return id;
}

function emitState(id: string, url: string, loading = false): void {
  act(() => {
    window.__plasticineWebTabEvent?.({ type: 'state', tabId: id, url, title: '页', canGoBack: false,
      canGoForward: false, loading });
  });
}

function toolCalls(bridge: Bridge): WebPageTool[] {
  return bridge.tool.mock.calls.map((call) => call[1]);
}

function openMore(): HTMLElement {
  fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: '更多' }));
  return screen.getByRole('menu', { name: '更多' });
}

describe('电脑网页工具条', () => {
  it('左起 ← → ↻ · 圈一块 · 网址 · 文A · 收进 · ⋯；地址框写网站名和路径', async () => {
    install();
    const app = await renderApp();
    await openArticle(app);
    const bar = screen.getByRole('main').querySelector('.web-toolbar') as HTMLElement;
    const names = [...bar.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['后退', '前进', '重新载入', '圈一块', `网址：${ARTICLE}`, '翻译这一页', '收进置顶或分组',
      '更多']);
    expect(within(bar).getByRole('button', { name: /^网址/ }).textContent).toBe('blog.example.org/local-first-sync');
  });

  it('收进：置顶、放进分组、放回今天，和竖排标签的右键菜单是同一份', async () => {
    install();
    const app = await renderApp();
    const id = await openArticle(app);
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: '收进置顶或分组' }));
    fireEvent.click(within(screen.getByRole('menu', { name: '标签的操作' })).getByRole('menuitem', { name: '置顶' }));
    expect(app.state.webTabs.get().pinned).toEqual([id]);
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: '收进置顶或分组' }));
    fireEvent.click(within(screen.getByRole('menu', { name: '标签的操作' }))
      .getByRole('menuitem', { name: '放回今天' }));
    expect(app.state.webTabs.get().today).toEqual([id]);
  });

  it('原生没报的不出：旧 App 没有圈一块，⋯ 里只有不靠原生新接口的几项', async () => {
    install([]);
    const app = await renderApp();
    await openArticle(app);
    expect(within(screen.getByRole('main')).queryByRole('button', { name: '圈一块' })).toBeNull();
    const menu = openMore();
    expect([...menu.querySelectorAll('[role^="menuitem"]')].map((item) => item.textContent)).toEqual(['阅读模式', '存进笔记',
      '复制链接', '在浏览器打开', '历史记录⌘Y']);
  });

  it('⋯ 菜单照他定的顺序分节；Mac 会导入登录时最后一节是「导入登录…」，点了到设置 · 浏览器打开导入', async () => {
    install();
    const logins = { sites: vi.fn(() => Promise.resolve({ sites: [] })),
      sources: vi.fn(() => Promise.resolve({ sources: [{ id: 'chrome', available: true, profile: '默认个人资料',
        sites: 214, needs: null, passwords: true }] })),
      import: vi.fn(), forget: vi.fn(), openFullDiskAccess: vi.fn() };
    window.plasticineDesktop!.logins = logins;
    const app = await renderApp();
    await openArticle(app);
    const menu = openMore();
    const rows = [...menu.children].map((child) => (child.tagName === 'HR' ? '｜'
      : child.querySelector('.popover-item-label')?.textContent ?? child.textContent));
    expect(rows).toEqual(['在页面中查找', '缩放', '阅读模式', '｜', '截图', '存进笔记', '存成 PDF / 打印', '｜',
      '复制链接', '在浏览器打开', '｜', '下载', '历史记录', '｜', '导入登录…']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: '导入登录…' }));
    expect(await screen.findByRole('dialog', { name: '导入登录' })).toBeTruthy();
    // 设置是弹框（2026-11-05）：开在「浏览器」，底下还是这个网页标签。
    const settings = screen.getByRole('dialog', { name: '设置' });
    expect(within(settings).getByRole('button', { name: '浏览器' }).getAttribute('aria-current')).toBe('page');
    expect(window.location.hash).toBe('#/settings/browser');
  });
});

describe('⋯ 菜单里的工具', () => {
  it('缩放 − 100% +：交给原生，按网站记住；同一网站换页不再发，换到别的网站回 100%，回来照记着的那一档', async () => {
    const bridge = install();
    const app = await renderApp();
    const id = await openArticle(app);
    emitState(id, ARTICLE);
    let menu = openMore();
    fireEvent.click(within(menu).getByRole('menuitem', { name: '放大' }));
    fireEvent.click(within(menu).getByRole('menuitem', { name: '放大' }));
    expect(within(menu).getByRole('menuitem', { name: /^恢复 100%/ }).textContent).toBe('125%');
    expect(toolCalls(bridge)).toEqual([{ kind: 'zoom', factor: 1.1 }, { kind: 'zoom', factor: 1.25 }]);
    fireEvent.keyDown(document, { key: 'Escape' });
    emitState(id, 'https://blog.example.org/another');
    expect(toolCalls(bridge)).toHaveLength(2);
    emitState(id, 'https://other.example.com/');
    emitState(id, 'https://www.blog.example.org/back');
    expect(toolCalls(bridge).slice(2)).toEqual([{ kind: 'zoom', factor: 1 }, { kind: 'zoom', factor: 1.25 }]);
    menu = openMore();
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^恢复 100%/ }));
    expect(toolCalls(bridge).at(-1)).toEqual({ kind: 'zoom', factor: 1 });
  });

  it('在页面中查找：⌘F 出浮在网页上的查找条，回车找下一个，找不到写「没找到」，Esc 收起并清掉高亮；原生菜单交来的也一样', async () => {
    const bridge = install(ALL_TOOLS, (tool) => (tool.kind === 'find' ? { found: tool.query === '冲突' } : true));
    const app = await renderApp();
    const id = await openArticle(app);
    fireEvent.keyDown(window, { key: 'f', code: 'KeyF', metaKey: true });
    const input = screen.getByRole('searchbox', { name: '在页面中查找' });
    // 浮在网页上（不推网页），点得到：报成 hitRegions。
    expect(input.closest('[data-hit-region]')).not.toBeNull();
    fireEvent.change(input, { target: { value: '冲突' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(toolCalls(bridge)).toEqual([{ kind: 'find', query: '冲突', backwards: false },
      { kind: 'find', query: '冲突', backwards: true }]);
    fireEvent.change(input, { target: { value: '没有的词' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('没找到')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('searchbox', { name: '在页面中查找' })).toBeNull();
    expect(bridge.tool).toHaveBeenLastCalledWith(id, { kind: 'find_clear' });
    act(() => {
      window.__plasticineWebMenu?.('find');
    });
    expect(screen.getByRole('searchbox', { name: '在页面中查找' })).toBeTruthy();
  });

  it('截图可见部分给 Plasticine：对话框展开、输入框里多一个附件', async () => {
    const bridge = install(ALL_TOOLS, (tool) => (tool.kind === 'capture' ? { type: 'image/png', base64: PNG }
      : true));
    const app = await renderApp();
    await openArticle(app);
    const menu = openMore();
    fireEvent.click(within(menu).getByRole('menuitem', { name: '截图' }));
    const capture = screen.getByRole('menu', { name: '截图' });
    expect(within(capture).getAllByRole('group').map((group) => group.getAttribute('aria-label')))
      .toEqual(['可见部分', '整页']);
    fireEvent.click(within(capture).getByRole('menuitem', { name: '可见部分给 Plasticine' }));
    await waitFor(() => expect(app.state.attachments.store.get()).toHaveLength(1));
    expect(app.state.attachments.store.get()[0]?.name).toMatch(/^截图 本地优先软件的同步难题\.png$/);
    expect(toolCalls(bridge)).toEqual([{ kind: 'capture', scope: 'visible' }]);
    expect(screen.getByRole('complementary', { name: '对话框' })).toBeTruthy();
  });

  it('截整页存进笔记：笔记里有标题、来源和图，工具条下面说「截图存进了笔记」，点「打开」开这篇笔记', async () => {
    install(ALL_TOOLS, (tool) => (tool.kind === 'capture' ? { type: 'image/png', base64: PNG } : true));
    const app = await renderApp();
    await openArticle(app);
    fireEvent.click(within(openMore()).getByRole('menuitem', { name: '截图' }));
    fireEvent.click(within(screen.getByRole('menu', { name: '截图' })).getByRole('menuitem', { name: '整页存进笔记' }));
    const notice = await screen.findByText('截图存进了笔记');
    const notes = await app.api.notes.list({ q: '' });
    const note = await app.api.notes.get(notes[0]!.id);
    expect(note.markdown).toContain('# 本地优先软件的同步难题');
    expect(note.markdown).toContain(`(${ARTICLE})`);
    expect(note.markdown).toMatch(/!\[截图\]\(\/v2\/notes\/assets\/.+\.png\)/);
    fireEvent.click(within(notice.closest('.web-notice') as HTMLElement).getByRole('button', { name: '打开' }));
    await waitFor(() => expect(window.location.hash).toBe(`#/notes/${note.id}`));
  });

  it('存进笔记：整页剪藏，带来源和正文', async () => {
    install();
    const app = await renderApp();
    await openArticle(app);
    fireEvent.click(within(openMore()).getByRole('menuitem', { name: '存进笔记' }));
    await screen.findByText('存进了笔记');
    const notes = await app.api.notes.list({ q: '' });
    const note = await app.api.notes.get(notes[0]!.id);
    expect(note.markdown).toMatch(/^# 本地优先软件的同步难题\n\n来源：\[本地优先软件的同步难题\]\(https:/);
    expect(note.markdown).toContain('## 冲突从哪里来');
    expect(note.markdown).toContain('冲突并不罕见。');
  });

  it('打印（⌘P）、下载、复制链接；原生不会打印时 ⌘P 交还给系统', async () => {
    const bridge = install();
    const write = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } });
    const app = await renderApp();
    await openArticle(app);
    fireEvent.keyDown(window, { key: 'p', code: 'KeyP', metaKey: true });
    fireEvent.click(within(openMore()).getByRole('menuitem', { name: '下载' }));
    fireEvent.click(within(openMore()).getByRole('menuitem', { name: '复制链接' }));
    expect(toolCalls(bridge)).toEqual([{ kind: 'print' }, { kind: 'downloads' }]);
    expect(write).toHaveBeenCalledWith(ARTICLE);
  });

  it('原生不会打印、查找时 ⌘P、⌘F 不拦，交还给系统', async () => {
    install([]);
    const app = await renderApp();
    await openArticle(app);
    expect(fireEvent.keyDown(window, { key: 'p', code: 'KeyP', metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(window, { key: 'f', code: 'KeyF', metaKey: true })).toBe(true);
    expect(screen.queryByRole('searchbox', { name: '在页面中查找' })).toBeNull();
  });

  it('阅读模式：原生网页先藏起来，在 Plasticine 的排版里重排正文；再点回到网页', async () => {
    const bridge = install();
    const app = await renderApp();
    const id = await openArticle(app);
    await waitFor(() => expect(bridge.sync.mock.calls.at(-1)?.[0].active).toBe(id));
    fireEvent.click(within(openMore()).getByRole('menuitemcheckbox', { name: '阅读模式' }));
    const reader = await screen.findByRole('article', { name: '阅读模式' });
    expect(within(reader).getByRole('heading', { level: 1 }).textContent).toBe('本地优先软件的同步难题');
    expect(within(reader).getByRole('heading', { level: 2, name: '冲突从哪里来' })).toBeTruthy();
    await waitFor(() => expect(bridge.sync.mock.calls.at(-1)?.[0].frame).toBeNull());
    const item = within(openMore()).getByRole('menuitemcheckbox', { name: '阅读模式' });
    expect(item.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(item);
    await waitFor(() => expect(bridge.sync.mock.calls.at(-1)?.[0].active).toBe(id));
    expect(screen.queryByRole('article', { name: '阅读模式' })).toBeNull();
  });

  it('历史记录：每载完一页记一条；⌘Y 出历史记录，按天分，点一条在当前标签打开', async () => {
    const bridge = install();
    const app = await renderApp();
    const id = await openArticle(app);
    emitState(id, 'https://a.example.com/', true);
    emitState(id, 'https://a.example.com/');
    emitState(id, 'https://b.example.com/x');
    fireEvent.keyDown(window, { key: 'y', code: 'KeyY', metaKey: true });
    const popover = screen.getByRole('dialog', { name: '历史记录' });
    const today = within(popover).getByRole('region', { name: '今天' });
    expect(within(today).getAllByRole('button').map((row) => row.getAttribute('title')))
      .toEqual(['https://b.example.com/x', 'https://a.example.com/']);
    fireEvent.click(within(today).getAllByRole('button')[1]!);
    expect(bridge.navigate).toHaveBeenCalledWith(id, 'https://a.example.com/');
  });
});

describe('圈一块', () => {
  it('点了按钮按下着，在网页上圈完变成对话框输入框里的引用片（名字是开头一句），对话框展开', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const bridge = install(ALL_TOOLS, (tool) => (tool.kind === 'circle'
      ? new Promise((resolve) => { finish = resolve; }) : true));
    const app = await renderApp();
    await openArticle(app);
    const button = within(screen.getByRole('main')).getByRole('button', { name: '圈一块' });
    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(toolCalls(bridge)).toEqual([{ kind: 'circle' }]);
    await act(async () => {
      finish({ text: '把数据放在自己的设备上，离线也能用，这是本地优先软件最吸引人的地方。', url: ARTICLE,
        title: '本地优先软件的同步难题' });
    });
    const [quote] = app.state.conversationUi.store.get().quotes;
    expect(quote?.label).toBe('把数据放在自己的设备上，离线也能用，这是本地优先……');
    expect(quote?.text).toBe(`圈自「本地优先软件的同步难题」\n${ARTICLE}\n\n`
      + '把数据放在自己的设备上，离线也能用，这是本地优先软件最吸引人的地方。');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('complementary', { name: '对话框' })).toBeTruthy();
  });

  it('圈的时候再点一下或按 Esc 取消：交给原生 circle_cancel，原生回 null 不加引用片', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const bridge = install(ALL_TOOLS, (tool) => (tool.kind === 'circle'
      ? new Promise((resolve) => { finish = resolve; }) : true));
    const app = await renderApp();
    await openArticle(app);
    const button = within(screen.getByRole('main')).getByRole('button', { name: '圈一块' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(toolCalls(bridge)).toEqual([{ kind: 'circle' }, { kind: 'circle_cancel' }]);
    await act(async () => {
      finish(null);
    });
    // 焦点在 Plasticine 这边时按 Esc 也取消（网页里的脚本收不到）。
    fireEvent.click(button);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(toolCalls(bridge).slice(2)).toEqual([{ kind: 'circle' }, { kind: 'circle_cancel' }]);
    await act(async () => {
      finish(null);
    });
    expect(app.state.conversationUi.store.get().quotes).toEqual([]);
  });
});
