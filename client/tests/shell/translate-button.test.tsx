// 网页工具条上的「文A」（Mac 0.4.0 沉浸式翻译）：只在原生桥带 translate 时出现；关 / 在译 / 译完 / 出错 / 不能翻；
// 出错时点了是重试；右键菜单；问这一段。

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { webHash } from '../../src/state/web-tabs.ts';
import type { PlasticineMacTranslate, PlasticineMacWebTabs } from '../../src/api/shared.ts';
import { renderApp } from '../helpers.tsx';

const URL_A = 'https://field-notes.dev/agents/what-to-remember';

afterEach(() => {
  delete window.plasticineDesktop;
  delete window.__plasticineTranslateEvent;
  vi.restoreAllMocks();
});

function webTabs(): PlasticineMacWebTabs {
  return { sync: vi.fn(), command: vi.fn(), navigate: vi.fn(), snapshot: vi.fn(() => Promise.reject(new Error('不用'))) };
}

async function openWebTab(translate: PlasticineMacTranslate | undefined) {
  window.plasticineDesktop = { version: '0.4.0', notify: vi.fn(), webTabs: webTabs(),
    ...(translate === undefined ? {} : { translate }) };
  const app = await renderApp();
  let tabId = '';
  act(() => {
    const hash = webHash(app.state.webTabs.open(URL_A, 'What a personal agent should remember', 'user'));
    tabId = hash.slice(hash.lastIndexOf('/') + 1);
    window.location.hash = hash;
  });
  const main = screen.getByRole('main');
  await within(main).findByRole('button', { name: /^网址/ });
  const web = app.state.webTabs.get().tabs[0];
  return { app, main, tabId: web?.id ?? tabId };
}

function emit(event: unknown): void {
  act(() => window.__plasticineTranslateEvent?.(event));
}

describe('网页工具条 · 文A', () => {
  it('原生桥没有翻译（0.3.x）时不出按钮', async () => {
    const { main } = await openWebTab(undefined);
    expect(within(main).queryByRole('button', { name: '翻译这一页' })).toBeNull();
  });

  it('点一下开翻：按下的样子、在译时有一明一暗的点；段落来了经接口译好送回；再点关掉', async () => {
    const translate = { configure: vi.fn(), deliver: vi.fn() };
    const { app, main, tabId } = await openWebTab(translate);
    const button = await within(main).findByRole('button', { name: '翻译这一页' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(within(button).getByRole('img', { name: '正在翻译' })).toBeTruthy();
    const [, config] = translate.configure.mock.calls[0]!;
    expect(config).toMatchObject({ target: 'zh-CN', display: 'bilingual' });
    const spy = vi.spyOn(app.api.translate, 'translate');
    emit({ type: 'request', tabId, run: config.run, url: URL_A, priority: 'visible', fresh: false,
      items: [{ id: 'x-1', text: 'Remember decisions, not transcripts' }] });
    await waitFor(() => expect(translate.deliver).toHaveBeenCalledWith(tabId, { run: config.run, failed: [],
      items: [{ id: 'x-1', text: '记决定，不记流水账' }] }));
    expect(spy).toHaveBeenCalledTimes(1);
    emit({ type: 'progress', tabId, run: config.run, pending: 0, done: 1, failed: 0, chars: 35, firstScreenMs: 900 });
    expect(within(button).queryByRole('img', { name: '正在翻译' })).toBeNull();
    expect(within(button).getByRole('img', { name: '已翻译' })).toBeTruthy();
    fireEvent.click(button);
    expect(translate.configure).toHaveBeenLastCalledWith(tabId, null);
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('出错换成出错的点，悬停一句原因；付款页置灰、悬停说原因，点了不开', async () => {
    const translate = { configure: vi.fn(), deliver: vi.fn() };
    const { app, main, tabId } = await openWebTab(translate);
    const button = await within(main).findByRole('button', { name: '翻译这一页' });
    vi.spyOn(app.api.translate, 'translate').mockResolvedValue({ model: 'gpt-6-luna', items: [], failure: {
      code: 'quota', message: '订阅额度用完了，14:00 重置后能再试。', retryAt: null, retryable: false, ids: ['x-1'] } });
    fireEvent.click(button);
    const run = translate.configure.mock.calls[0]![1].run as string;
    emit({ type: 'request', tabId, run, url: URL_A, priority: 'visible', fresh: false,
      items: [{ id: 'x-1', text: 'Hello there' }] });
    await within(button).findByRole('img', { name: '订阅额度用完了，14:00 重置后能再试。' });
    expect(button.getAttribute('data-tip')).toBe('订阅额度用完了，14:00 重置后能再试。点一下重试没译成的段落。');
    emit({ type: 'page', tabId, url: 'https://shop.example.com/checkout', blocked: true });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('data-tip')).toBe('付款类页面不翻译');
    const calls = translate.configure.mock.calls.length;
    fireEvent.click(button);
    expect(translate.configure.mock.calls.length).toBe(calls);
  });

  it('出错时点按钮是重试（同一轮再来，不关掉）；要关掉在菜单里', async () => {
    const translate = { configure: vi.fn(), deliver: vi.fn() };
    const { app, main, tabId } = await openWebTab(translate);
    const button = await within(main).findByRole('button', { name: '翻译这一页' });
    vi.spyOn(app.api.translate, 'translate').mockResolvedValue({ model: 'gpt-6-luna', items: [], failure: {
      code: 'busy', message: '模型服务这会儿忙，稍后再试。', retryAt: null, retryable: false, ids: ['x-1'] } });
    fireEvent.click(button);
    const config = translate.configure.mock.calls[0]![1];
    emit({ type: 'request', tabId, run: config.run, url: URL_A, priority: 'visible', fresh: false,
      items: [{ id: 'x-1', text: 'Hello there' }] });
    await within(button).findByRole('img', { name: '模型服务这会儿忙，稍后再试。' });
    emit({ type: 'progress', tabId, run: config.run, pending: 0, done: 0, failed: 1, chars: 11, firstScreenMs: 0 });
    expect(button.getAttribute('aria-label')).toBe('重试翻译');
    fireEvent.click(button);
    expect(translate.configure).toHaveBeenLastCalledWith(tabId, config);
    expect(within(button).getByRole('img', { name: '正在翻译' })).toBeTruthy();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.contextMenu(button);
    fireEvent.click(within(screen.getByRole('menu', { name: '翻译' })).getByRole('menuitem', { name: '关掉翻译' }));
    expect(translate.configure).toHaveBeenLastCalledWith(tabId, null);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('menu', { name: '翻译' })).toBeNull();
  });

  it('右键出菜单：换成只看译文就地切换、总是翻译这个网站、翻译用的模型就地换（就是改翻译的默认）', async () => {
    const translate = { configure: vi.fn(), deliver: vi.fn() };
    const { app, main, tabId } = await openWebTab(translate);
    const button = await within(main).findByRole('button', { name: '翻译这一页' });
    fireEvent.contextMenu(button);
    const menu = screen.getByRole('menu', { name: '翻译' });
    expect(menu.hasAttribute('data-hit-region')).toBe(true);
    expect(within(menu).getByRole('menuitem', { name: /翻译成\s*中文/ })).toBeTruthy();
    const always = within(menu).getByRole('switch', { name: '总是翻译 field-notes.dev' }) as HTMLInputElement;
    expect(always.checked).toBe(true);
    fireEvent.click(always);
    await waitFor(async () => expect((await app.api.translate.settings()).alwaysSites)
      .not.toContain('field-notes.dev'));
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: '只看译文' }));
    await waitFor(async () => expect((await app.api.translate.settings()).display).toBe('translation'));
    const before = await app.api.modelProviders.list();
    const row = await within(menu).findByRole('menuitem', { name: /^模型\s*GPT-5\.5 · 高/ });
    fireEvent.click(row);
    const options = within(menu).getByRole('listbox', { name: '模型' });
    expect(within(options).getByRole('option', { name: '跟默认' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(within(menu).getByRole('button', { name: '低' }));
    await waitFor(async () => expect((await app.api.modelProviders.list()).purposes
      .find((item) => item.purpose === 'translation')?.chosen).toEqual({ model: null, thinking: 'low' }));
    expect(await within(menu).findByRole('menuitem', { name: /^模型\s*GPT-5\.5 · 低/ })).toBeTruthy();
    expect((await app.api.modelProviders.list()).chosen).toEqual(before.chosen);
    expect(screen.queryByRole('dialog', { name: '设置' })).toBeNull();
    expect(translate.configure).not.toHaveBeenCalledWith(tabId, expect.anything());
  });

  it('总是翻译的网站：页面一报到就开翻；问这一段把原文和译文作为引用放进对话框', async () => {
    const translate = { configure: vi.fn(), deliver: vi.fn() };
    const { app, tabId } = await openWebTab(translate);
    await waitFor(() => expect(window.__plasticineTranslateEvent).toBeTypeOf('function'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    emit({ type: 'page', tabId, url: URL_A, blocked: false });
    expect(translate.configure).toHaveBeenCalledWith(tabId, expect.objectContaining({ target: 'zh-CN' }));
    emit({ type: 'ask', tabId, url: URL_A, title: 'Field Notes', source: 'Most agents forget everything.',
      translation: '大多数 agent 什么都会忘。' });
    const quotes = app.state.conversationUi.store.get().quotes;
    expect(quotes.map((quote) => quote.label)).toEqual(['「Field Notes」的一段']);
    expect(quotes[0]?.text).toContain('原文：Most agents forget everything.');
    expect(quotes[0]?.text).toContain('译文：大多数 agent 什么都会忘。');
  });
  it('菜单开着时：点外面、Esc、点到原生网页（主网页失焦）、切标签都收；Esc 后焦点回到按钮', async () => {
    const translate = { configure: vi.fn(), deliver: vi.fn() };
    const { main } = await openWebTab(translate);
    const button = await within(main).findByRole('button', { name: '翻译这一页' });
    fireEvent.contextMenu(button);
    expect(screen.getByRole('menu', { name: '翻译' })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu', { name: '翻译' })).toBeNull();
    fireEvent.contextMenu(button);
    fireEvent.keyDown(within(screen.getByRole('menu', { name: '翻译' })).getAllByRole('menuitem')[0]!,
      { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: '翻译' })).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.contextMenu(button);
    act(() => { window.dispatchEvent(new FocusEvent('blur')); });
    expect(screen.queryByRole('menu', { name: '翻译' })).toBeNull();
    fireEvent.contextMenu(button);
    act(() => { window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(screen.queryByRole('menu', { name: '翻译' })).toBeNull();
    expect(translate.configure).not.toHaveBeenCalled();
  });
});
