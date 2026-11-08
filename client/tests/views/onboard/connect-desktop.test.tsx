// 连接模型在桌面客户端里（11-08）：点「登录」用 external.open 直接开系统浏览器；连远程实例时同时在本机等 1455 端口的回调，
// 拿到就交给本体的「贴回调地址」接口，自动连上；本机实例照旧由本体自己收回调，不在本机等。首次流程里是第 2 步。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OAUTH_CALLBACK_PORT, OAUTH_CAPTURE_MS } from '../../../src/views/models/use-provider-login.ts';
import { startFirstRun } from '../../../src/views/onboard/first-run.ts';
import { renderApp } from '../../helpers.tsx';
import { installDesktop, removeDesktop } from './desktop-bridge.ts';

const CALLBACK = 'http://localhost:1455/auth/callback?code=fake-code';

afterEach(() => {
  removeDesktop();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

async function clickLogin(): Promise<HTMLElement> {
  const page = await screen.findByRole('main', { name: '连接模型' });
  const row = within(page).getByRole('listitem', { name: 'ChatGPT' });
  fireEvent.click(within(row).getByRole('button', { name: '登录' }));
  return row;
}

describe('桌面客户端里连模型', () => {
  it('连远程实例：系统浏览器打开授权页，本机等回调，拿到自动连上；不出贴地址那一栏', async () => {
    const desktop = installDesktop({ localToken: null, captured: CALLBACK });
    const windowOpen = vi.spyOn(window, 'open').mockReturnValue(null);
    const app = await renderApp({ hash: '#/today', modelConnected: false });
    const complete = vi.spyOn(app.api.modelProviders, 'completeLogin');
    await clickLogin();
    expect(await screen.findByRole('img', { name: '已连接' })).toBeTruthy();
    expect(desktop.open).toHaveBeenCalledWith(expect.stringMatching(/^https?:\/\//));
    expect(windowOpen).not.toHaveBeenCalled();
    expect(desktop.capture).toHaveBeenCalledWith(OAUTH_CALLBACK_PORT, OAUTH_CAPTURE_MS);
    expect(complete.mock.calls[0]?.[3]).toBe(CALLBACK);
    expect(screen.queryByLabelText('回调地址')).toBeNull();
  });

  it('本机实例：只开系统浏览器，本体自己收回调，不在本机等', async () => {
    const desktop = installDesktop();
    await renderApp({ hash: '#/today', modelConnected: false });
    const row = await clickLogin();
    expect(await within(row).findByText('在浏览器里登录…')).toBeTruthy();
    await waitFor(() => expect(desktop.open).toHaveBeenCalledTimes(1));
    expect(desktop.capture).not.toHaveBeenCalled();
  });

  it('取消：收掉本机在等的回调', async () => {
    const desktop = installDesktop({ localToken: null });
    desktop.capture.mockImplementation(() => new Promise(() => undefined));
    await renderApp({ hash: '#/today', modelConnected: false });
    const row = await clickLogin();
    await waitFor(() => expect(desktop.capture).toHaveBeenCalled());
    fireEvent.click(within(row).getByRole('button', { name: '取消登录' }));
    expect(desktop.cancelCapture).toHaveBeenCalledTimes(1);
  });

  it('首次流程里：第 2 步的进度条；连上后是「下一步」', async () => {
    installDesktop({ localToken: null, captured: CALLBACK });
    startFirstRun();
    await renderApp({ hash: '#/today', modelConnected: false });
    const page = await screen.findByRole('main', { name: '连接模型' });
    expect(within(page).getByRole('img', { name: '第 2 步，共 3 步' })).toBeTruthy();
    await clickLogin();
    expect(await screen.findByRole('button', { name: '下一步' })).toBeTruthy();
  });
});
