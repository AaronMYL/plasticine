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

describe('Mac native web tabs', () => {
  it('favicon update renders and caches per site; rejects stale-site or non-image icons', async () => {
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

  it('user opening own-instance URL navigates in-app; Plasticine keeps real web target', async () => {
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

  it('syncs active tab, used tabs, and center rect; hides when settings modal opens', async () => {
    const bridge = install();
    const app = await renderApp();
    act(() => {
      window.location.hash = webHash(app.state.webTabs.open('https://example.com/a', 'A', 'user'));
    });
    await waitFor(() => expect(lastSync(bridge).active).not.toBeNull());
    const shown = lastSync(bridge);
    expect(shown.tabs).toEqual([{ tabId: shown.active, url: 'https://example.com/a' }]);
    expect(shown.frame).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(shown.hitRegions).toEqual([]);
    expect(document.querySelector('.shell')?.getAttribute('data-native-web')).toBe('true');
    fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^设置/ }));
    await waitFor(() => expect(lastSync(bridge).frame).toBeNull());
    expect(lastSync(bridge).active).toBeNull();
    expect(lastSync(bridge).hitRegions).toEqual([]);
    expect(lastSync(bridge).tabs).toHaveLength(1);
    expect(document.querySelector('.shell')?.hasAttribute('data-native-web')).toBe(false);
  });

  it('floating chat and bubble report hitRegions over web tab instead of shrinking web area', async () => {
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
    const firstShown = bridge.sync.mock.calls.map(([state]) => state).find((state) => state.frame !== null);
    expect(firstShown?.hitRegions).toEqual([{ x: 996, y: 236, width: 420, height: 640 }]);
  });

  it('tracks native URL/title updates, background tabs without stealing focus, and tab closes', async () => {
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

  it('empty native URL on new tab keeps tab, URL, and title intact, updating loading only', async () => {
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

  it('address bar suggests visited pages with arrow/Enter nav and search fallback at bottom', async () => {
    const bridge = install();
    const app = await renderApp();
    let id = '';
    act(() => {
      const hash = webHash(app.state.webTabs.open('https://example.com/a', 'A', 'user'));
      id = decodeURIComponent(hash.slice('#/web/'.length));
      window.location.hash = hash;
    });
    emit({ type: 'state', tabId: id, url: 'https://docs.example.com/guide', title: '示例文档', canGoBack: false,
      canGoForward: false, loading: false });
    const main = screen.getByRole('main');
    fireEvent.click(await within(main).findByRole('button', { name: /^网址/ }));
    const address = within(main).getByRole('combobox', { name: '网址' });
    expect(within(main).queryByRole('listbox', { name: '建议' })).toBeNull();
    fireEvent.change(address, { target: { value: '示例' } });
    const options = within(within(main).getByRole('listbox', { name: '建议' })).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['示例文档docs.example.com', '用必应搜「示例」']);
    fireEvent.keyDown(address, { key: 'ArrowDown' });
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.submit(address);
    expect(bridge.navigate).toHaveBeenCalledWith(id, 'https://docs.example.com/guide');
  });

  it('address bar Enter, back/forward, reload, and open-external delegate to native layer', async () => {
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
    const address = within(main).getByRole('combobox', { name: '网址' }) as HTMLInputElement;
    expect(address.value).toBe('https://example.com/a');
    fireEvent.change(address, { target: { value: 'news.ycombinator.com' } });
    fireEvent.submit(address);
    expect(bridge.navigate).toHaveBeenCalledWith(id, 'https://news.ycombinator.com');
    expect(within(main).queryByRole('combobox', { name: '网址' })).toBeNull();
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

describe('address bar input resolution', () => {
  it('keeps http(s) URLs, prepends https:// to domains, and treats other input as search', () => {
    expect(addressToUrl(' https://a.com/x ')).toBe('https://a.com/x');
    expect(addressToUrl('example.org/notes?x=1')).toBe('https://example.org/notes?x=1');
    expect(addressToUrl('杭州 天气')).toBe(`https://www.bing.com/search?q=${encodeURIComponent('杭州 天气')}`);
    expect(addressToUrl('   ')).toBeNull();
  });
});
