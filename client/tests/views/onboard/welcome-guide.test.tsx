// 主线的欢迎卡就是引导（11-12《首次使用解耦》）：账号一行 → 主线 AI 一句 →「连上一个模型」（可跳过；登录时复制登录链接
// 和贴回调地址常显）→ 一句话 + 几个开始（桌面客户端按装了什么笔记应用排）。没连模型也不挡整窗。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WELCOME_STARTS } from '../../../src/api/fake/fake-account.ts';
import { OAUTH_CALLBACK_PORT, OAUTH_CAPTURE_MS } from '../../../src/views/models/use-provider-login.ts';
import { MODEL_SKIP_KEY } from '../../../src/views/lines/welcome-message.tsx';
import { HOME_HEADING, renderApp, setViewportWidth } from '../../helpers.tsx';
import { installDesktop, removeDesktop } from './desktop-bridge.ts';

const CALLBACK = 'http://localhost:1455/auth/callback?code=fake-code';

afterEach(() => {
  removeDesktop();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function withWelcome(modelConnected: boolean, width = 1440) {
  return renderApp({ hash: '#/plasticine/main', modelConnected, width, setup: (fake) => {
    fake.control.account.seedName('Alex');
    fake.control.network.register('alex', 'Alex');
    fake.control.account.postWelcome();
  } });
}

async function welcome(): Promise<HTMLElement> {
  return screen.findByRole('article', { name: 'Plasticine 的欢迎' });
}

describe('欢迎卡：连上了模型', () => {
  it('账号一行、主线一句、模型一行、一句话和三个开始；点一个把 prompt 发进主线', async () => {
    const app = await withWelcome(true);
    const card = await welcome();
    await waitFor(() => expect(card.textContent).toContain('Alex · @alex'));
    expect(card.textContent).toContain('好了，Alex。再连一个模型，我就能替你做事。');
    expect(await within(card).findByText('连上了。想从哪儿开始？')).toBeTruthy();
    expect(within(card).queryByRole('region', { name: '连上一个模型' })).toBeNull();
    const starts = within(card).getByRole('group', { name: '从哪儿开始' });
    expect(within(starts).getAllByRole('button').map((button) => button.textContent))
      .toEqual(WELCOME_STARTS.map((start) => start.label));
    const send = vi.spyOn(app.api.lines, 'send');
    fireEvent.click(within(starts).getByRole('button', { name: '订几个信息源' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[1].text).toBe(WELCOME_STARTS[1]?.prompt);
  });

  it('桌面客户端认出 Obsidian 和 Apple 备忘录：开始换成具体的导入，其余照旧', async () => {
    installDesktop({ profile: { fullName: null, apps: ['obsidian', 'apple-notes'] } });
    await withWelcome(true);
    const card = await welcome();
    const starts = await within(card).findByRole('group', { name: '从哪儿开始' });
    await waitFor(() => expect(within(starts).getAllByRole('button').map((button) => button.textContent))
      .toEqual(['导入 Obsidian 笔记', '导入 Apple 备忘录', '订几个信息源', '先聊聊，认识一下']));
  });
});

describe('欢迎卡：没连模型', () => {
  it('不挡整窗：主线里是「连上一个模型」卡，还没有开始；跳过收成一行带「连上」，出开始', async () => {
    await withWelcome(false);
    const card = await welcome();
    const connect = await within(card).findByRole('region', { name: '连上一个模型' });
    expect(within(connect).getByRole('listitem', { name: 'ChatGPT' })).toBeTruthy();
    expect(within(card).queryByRole('group', { name: '从哪儿开始' })).toBeNull();
    expect(screen.queryByRole('main', { name: '连接模型' })).toBeNull();
    fireEvent.click(within(connect).getByRole('button', { name: '跳过' }));
    expect(await within(card).findByText('先跳过了')).toBeTruthy();
    expect(within(card).getByRole('button', { name: '连上' })).toBeTruthy();
    expect(card.textContent).toContain('好，先不连。笔记、阅读、网页照常能用，用到模型时再连。');
    expect(within(card).getByRole('group', { name: '从哪儿开始' })).toBeTruthy();
    expect(window.localStorage.getItem(MODEL_SKIP_KEY)).toBe('1');
  });

  it('跳过以后点开始：先亮出连模型那张，填 key 连上后接着把那一句发出去', async () => {
    window.localStorage.setItem(MODEL_SKIP_KEY, '1');
    const app = await withWelcome(false);
    const card = await welcome();
    const send = vi.spyOn(app.api.lines, 'send');
    fireEvent.click(await within(card).findByRole('button', { name: '订几个信息源' }));
    const connect = await within(card).findByRole('region', { name: '连上一个模型' });
    expect(connect.textContent).toContain('连上后接着做「订几个信息源」');
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(within(within(connect).getByRole('listitem', { name: 'DeepSeek' })).getByRole('button',
      { name: '填 key' }));
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test-12345678' } });
    fireEvent.click(screen.getByRole('button', { name: '连接' }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[1].text).toBe(WELCOME_STARTS[1]?.prompt);
    expect(await within(card).findByText('连上了。想从哪儿开始？')).toBeTruthy();
    expect(window.localStorage.getItem(MODEL_SKIP_KEY)).toBeNull();
  });

  it('登录时复制登录链接、取消、贴回调地址都常显；贴了连上，模型收成一行', async () => {
    installDesktop();
    vi.spyOn(window, 'open').mockReturnValue(null);
    await withWelcome(false);
    const connect = await within(await welcome()).findByRole('region', { name: '连上一个模型' });
    const row = within(connect).getByRole('listitem', { name: 'ChatGPT' });
    fireEvent.click(within(row).getByRole('button', { name: '登录' }));
    expect(await within(row).findByText('在浏览器里登录…')).toBeTruthy();
    expect(within(connect).getByRole('button', { name: '复制登录链接' })).toBeTruthy();
    expect(within(connect).getByRole('button', { name: '取消' })).toBeTruthy();
    const field = within(connect).getByLabelText('回调地址');
    fireEvent.change(field, { target: { value: CALLBACK } });
    fireEvent.click(within(connect).getByRole('button', { name: '继续' }));
    expect(await screen.findByText('连上了。想从哪儿开始？')).toBeTruthy();
    expect(screen.queryByRole('region', { name: '连上一个模型' })).toBeNull();
  });

  it('桌面客户端连远程实例：系统浏览器打开授权页，本机等回调，拿到自动连上', async () => {
    const desktop = installDesktop({ localToken: null, captured: CALLBACK });
    const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null);
    const app = await withWelcome(false);
    const complete = vi.spyOn(app.api.modelProviders, 'completeLogin');
    const connect = await within(await welcome()).findByRole('region', { name: '连上一个模型' });
    fireEvent.click(within(within(connect).getByRole('listitem', { name: 'ChatGPT' })).getByRole('button',
      { name: '登录' }));
    expect(await screen.findByText('连上了。想从哪儿开始？')).toBeTruthy();
    expect(desktop.open).toHaveBeenCalledWith(expect.stringMatching(/^https?:\/\//));
    expect(windowOpen).not.toHaveBeenCalled();
    expect(desktop.capture).toHaveBeenCalledWith(OAUTH_CALLBACK_PORT, OAUTH_CAPTURE_MS);
    expect(complete.mock.calls[0]?.[3]).toBe(CALLBACK);
  });

  it('取消登录：收掉本机在等的回调，回到列表', async () => {
    const desktop = installDesktop({ localToken: null });
    desktop.capture.mockImplementation(() => new Promise(() => undefined));
    await withWelcome(false);
    const connect = await within(await welcome()).findByRole('region', { name: '连上一个模型' });
    const row = within(connect).getByRole('listitem', { name: 'ChatGPT' });
    fireEvent.click(within(row).getByRole('button', { name: '登录' }));
    await waitFor(() => expect(desktop.capture).toHaveBeenCalled());
    fireEvent.click(within(row).getByRole('button', { name: '取消登录' }));
    expect(desktop.cancelCapture).toHaveBeenCalledTimes(1);
    expect(await within(row).findByRole('button', { name: '登录' })).toBeTruthy();
  });

  it('手机上一样：欢迎卡里连模型、可跳过', async () => {
    setViewportWidth(390);
    await withWelcome(false, 390);
    const connect = await within(await welcome()).findByRole('region', { name: '连上一个模型' });
    expect(within(connect).getByRole('button', { name: '跳过' })).toBeTruthy();
  });
});

describe('首页', () => {
  it('主线里有欢迎消息时，首页不再出「有什么想一起做的？」', async () => {
    await renderApp({ hash: '#/today', setup: (fake) => fake.control.account.postWelcome() });
    await screen.findByRole('heading', { name: HOME_HEADING });
    await waitFor(() => expect(screen.queryByRole('region', { name: '开始一件事' })).toBeNull());
  });
});
