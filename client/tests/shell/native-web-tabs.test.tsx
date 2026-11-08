// Mac 原生网页标签（2026-11-02 第 102 条第 3 批）：网页界面把标签清单、在前的那个和中间区的位置整份同步给原生层；
// 主区上开着浮层时原生网页先藏起来；原生层报来的地址标题记进标签，它开的新标签加进来（Plasticine 在后台开的不抢）；
// 地址栏、前进后退、刷新、在系统浏览器打开都交给原生层（第 2 批：← → ↻ 在地址栏左边，顶栏左上角网页标签上没有 ← →；
// 地址框平时只显示网站名，点了出完整网址）。

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlasticineMacWebTabs, WebTabsSync } from '../../src/api/shared.ts';
import { addressToUrl } from '../../src/shell/use-native-web-tabs.ts';
import { webHash } from '../../src/state/web-tabs.ts';
import { renderApp } from '../helpers.tsx';

interface FakeBridge extends PlasticineMacWebTabs {
  sync: ReturnType<typeof vi.fn<(state: WebTabsSync) => void>>;
  command: ReturnType<typeof vi.fn<PlasticineMacWebTabs['command']>>;
  navigate: ReturnType<typeof vi.fn<PlasticineMacWebTabs['navigate']>>;
}

function install(): FakeBridge {
  const bridge: FakeBridge = {
    sync: vi.fn<(state: WebTabsSync) => void>(),
    command: vi.fn<PlasticineMacWebTabs['command']>(),
    navigate: vi.fn<PlasticineMacWebTabs['navigate']>(),
    snapshot: vi.fn(() => Promise.reject(new Error('读不到'))),
  };
  window.plasticineDesktop = { version: '0.2.0', notify: vi.fn(), webTabs: bridge };
  return bridge;
}

function lastSync(bridge: FakeBridge): WebTabsSync {
  const call = bridge.sync.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error('还没有同步过');
  }
  return call[0];
}

function emit(event: unknown): void {
  act(() => {
    window.__plasticineWebTabEvent?.(event);
  });
}

afterEach(() => {
  delete window.plasticineDesktop;
  vi.restoreAllMocks();
});

describe('Mac 原生网页标签', () => {
  it('壳报来「标签图标变了」：那一行画页面自己的图标，按网站存进本体；换了网站晚到的旧图标、不是图片的不收', async () => {
    install();
    const app = await renderApp({ width: 1440 });
    let id = '';
    act(() => {
      id = app.state.webTabs.open('https://example.com/a', '一页', 'user');
      window.location.hash = webHash(id);
    });
    const icon = 'data:image/png;base64,iVBORw0KGgo=';
    emit({ type: 'icon', tabId: id, pageUrl: 'https://other.example.org/', icon });
    emit({ type: 'icon', tabId: id, pageUrl: 'https://example.com/a', icon: 'javascript:alert(1)' });
    expect(app.state.webTabs.icons.get().size).toBe(0);
    emit({ type: 'icon', tabId: id, pageUrl: 'https://example.com/a', icon });
    const column = await screen.findByRole('complementary', { name: '网页' });
    await waitFor(() => expect(column.querySelector(`li[data-tab-id="${id}"] .site-icon img`)?.getAttribute('src'))
      .toBe(icon));
    await waitFor(() => expect(app.api.webTabs.faviconSrc('example.com')).toBe(icon));
  });

  it('用户打开本实例的网址是走到那一页（不开标签），Plasticine 打开的自身网页保留真实网页目标', async () => {
    const bridge = install();
    const app = await renderApp({ hash: '#/notes/n1' });
    emit({ type: 'opened', tabId: 'native:self-user', url: window.location.origin + '/#/notes', title: 'Plasticine',
      openedBy: 'user', activate: true });
    await waitFor(() => expect(window.location.hash).toBe('#/notes'));
    expect(bridge.command).toHaveBeenCalledWith('native:self-user', 'close');
    expect(app.state.webTabs.get().tabs).toHaveLength(0);
    emit({ type: 'opened', tabId: 'native:self-ai', url: window.location.origin + '/#/notes', title: 'Plasticine',
      openedBy: 'plasticine', activate: false });
    await waitFor(() => expect(lastSync(bridge).tabs).toContainEqual({ tabId: 'native:self-ai',
      url: window.location.origin + '/#/notes', openedBy: 'plasticine' }));
    emit({ type: 'internal', hash: '#/notes/n2' });
    await waitFor(() => expect(window.location.hash).toBe('#/notes/n2'));
  });

  it('同步用到了的标签、在前的那个和中间区；开了设置就藏起来', async () => {
    const bridge = install();
    const app = await renderApp();
    act(() => {
      window.location.hash = webHash(app.state.webTabs.open('https://example.com/a', 'A', 'user'));
    });
    await waitFor(() => expect(lastSync(bridge).active).not.toBeNull());
    const shown = lastSync(bridge);
    expect(shown.tabs).toEqual([{ tabId: shown.active, url: 'https://example.com/a' }]);
    expect(shown.frame).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    // 新界面每次都带 hitRegions（没有浮层是 []），原生据此把网页垫到主网页下面；那一块主网页透明。
    expect(shown.hitRegions).toEqual([]);
    expect(document.querySelector('.shell')?.getAttribute('data-native-web')).toBe('true');
    fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^设置/ }));
    await waitFor(() => expect(lastSync(bridge).frame).toBeNull());
    expect(lastSync(bridge).active).toBeNull();
    expect(lastSync(bridge).hitRegions).toEqual([]);
    expect(lastSync(bridge).tabs).toHaveLength(1);
    expect(document.querySelector('.shell')?.hasAttribute('data-native-web')).toBe(false);
  });

  it('对话框和圆球盖在网页上：它们的矩形报成 hitRegions，网页那一块不再让出对话框', async () => {
    const box = (x: number, y: number, width: number, height: number): DOMRect => ({ x, y, width, height, left: x,
      top: y, right: x + width, bottom: y + height, toJSON: () => ({}) }) as DOMRect;
    const original = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function measure(this: Element) {
      if (this.classList.contains('web-frame')) {
        return box(216, 100, 1224, 800);
      }
      if (this.classList.contains('chat-dialog')) {
        return box(996, 236, 420, 640);
      }
      return original.call(this);
    });
    const bridge = install();
    const app = await renderApp({ width: 1440 });
    act(() => {
      window.location.hash = webHash(app.state.webTabs.open('https://example.com/a', 'A', 'user'));
    });
    await waitFor(() => expect(lastSync(bridge).hitRegions).toEqual([{ x: 996, y: 236, width: 420, height: 640 }]));
    expect(lastSync(bridge).frame).toEqual({ x: 216, y: 100, width: 1224, height: 800 });
  });

  it('原生层报来的地址和标题记进标签；它开的新标签加进来，后台开的不抢当前标签，关掉也跟着关', async () => {
    install();
    const app = await renderApp();
    let id = '';
    act(() => {
      const hash = webHash(app.state.webTabs.open('https://example.com/a', 'A', 'user'));
      id = decodeURIComponent(hash.slice('#/web/'.length));
      window.location.hash = hash;
    });
    emit({ type: 'state', tabId: id, url: 'https://example.com/b', title: '第二页', canGoBack: true,
      canGoForward: false, loading: false });
    const tab = app.state.webTabs.get().tabs.find((candidate) => candidate.id === id);
    expect(tab).toMatchObject({ url: 'https://example.com/b', title: '第二页' });
    const main = screen.getByRole('main');
    expect(within(main).getByRole('button', { name: '网址：https://example.com/b' }).textContent).toBe('example.com/b');
    // 第 2 批：网页的前进后退在地址栏左边，顶栏左上角网页标签上没有。
    expect(within(main).getByRole('button', { name: '后退' })).toHaveProperty('disabled', false);
    expect(within(main).getByRole('button', { name: '前进' })).toHaveProperty('disabled', true);
    expect(screen.getAllByRole('button', { name: '后退' })).toHaveLength(1);

    emit({ type: 'opened', tabId: 'native:1', url: 'https://mail.example.com/', title: '邮箱',
      openedBy: 'plasticine', activate: false });
    expect(app.state.webTabs.get().current).toBe(id);
    expect(app.state.webTabs.get().tabs.some((candidate) => candidate.id === 'native:1')).toBe(true);
    emit({ type: 'opened', tabId: 'native:2', url: 'https://example.com/new', title: '新窗口', openedBy: 'user',
      activate: true });
    await waitFor(() => expect(window.location.hash).toBe(webHash('native:2')));
    emit({ type: 'closed', tabId: 'native:2' });
    expect(app.state.webTabs.get().tabs.some((candidate) => candidate.id === 'native:2')).toBe(false);
    const count = app.state.webTabs.get().tabs.length;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    emit({ type: 'opened', tabId: 'native:3' });
    expect(app.state.webTabs.get().tabs).toHaveLength(count);
  });

  it('壳报来空网址（新开的标签还没载入）：不关标签、不跳页，网址标题不动，只更新载入中', async () => {
    const bridge = install();
    const app = await renderApp();
    let id = '';
    act(() => {
      id = app.state.webTabs.open('https://example.com/a', 'A', 'user');
      window.location.hash = webHash(id);
    });
    emit({ type: 'state', tabId: id, url: '', title: '', canGoBack: false, canGoForward: false, loading: true });
    expect(window.location.hash).toBe(webHash(id));
    expect(bridge.command).not.toHaveBeenCalledWith(id, 'close');
    expect(app.state.webTabs.get().tabs.find((candidate) => candidate.id === id))
      .toMatchObject({ url: 'https://example.com/a', title: 'A' });
    const main = screen.getByRole('main');
    expect(within(main).getByRole('button', { name: '停止载入' })).toBeTruthy();
    expect(within(main).getByRole('button', { name: '网址：https://example.com/a' })).toBeTruthy();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const count = app.state.webTabs.get().tabs.length;
    emit({ type: 'opened', tabId: 'native:blank', url: '', title: '', openedBy: 'user', activate: true });
    expect(app.state.webTabs.get().tabs).toHaveLength(count);
    expect(window.location.hash).toBe(webHash(id));
  });

  it('地址栏回车、前进后退、刷新、在系统浏览器打开都交给原生层', async () => {
    const bridge = install();
    const app = await renderApp();
    let id = '';
    act(() => {
      const hash = webHash(app.state.webTabs.open('https://example.com/a', 'A', 'user'));
      id = decodeURIComponent(hash.slice('#/web/'.length));
      window.location.hash = hash;
    });
    const main = screen.getByRole('main');
    fireEvent.click(await within(main).findByRole('button', { name: /^网址/ }));
    const address = within(main).getByRole('textbox', { name: '网址' }) as HTMLInputElement;
    expect(address.value).toBe('https://example.com/a');
    fireEvent.change(address, { target: { value: 'news.ycombinator.com' } });
    fireEvent.submit(address);
    expect(bridge.navigate).toHaveBeenCalledWith(id, 'https://news.ycombinator.com');
    expect(within(main).queryByRole('textbox', { name: '网址' })).toBeNull();
    fireEvent.click(within(main).getByRole('button', { name: '重新载入' }));
    fireEvent.click(within(main).getByRole('button', { name: '更多' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '在浏览器打开' }));
    emit({ type: 'state', tabId: id, url: 'https://example.com/a', title: 'A', canGoBack: true, canGoForward: false,
      loading: true });
    fireEvent.click(within(main).getByRole('button', { name: '后退' }));
    fireEvent.click(within(main).getByRole('button', { name: '停止载入' }));
    expect(bridge.command.mock.calls).toEqual([[id, 'reload'], [id, 'open_external'], [id, 'back'], [id, 'stop']]);
  });

});

describe('地址栏里打的字', () => {
  it('带 http(s) 原样用，像域名的补 https://，别的当搜索词', () => {
    expect(addressToUrl(' https://a.com/x ')).toBe('https://a.com/x');
    expect(addressToUrl('example.org/notes?x=1')).toBe('https://example.org/notes?x=1');
    expect(addressToUrl('杭州 天气')).toBe(`https://www.bing.com/search?q=${encodeURIComponent('杭州 天气')}`);
    expect(addressToUrl('   ')).toBeNull();
  });
});
