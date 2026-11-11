// 建账号（11-08 设计稿 Create-Account，首次使用流程第 1 步）：没主人时没登录的界面直接到这一页；@账号停打字后问能不能用；
// 凭桌面客户端的本机令牌或地址里的 ?t= 令牌建账号；建成接着连模型（第 2 步）；「换一个地方」只在桌面客户端里；出错就地一行。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAKE_LOCAL_TOKEN, FAKE_SETUP_TOKEN } from '../../../src/api/fake/fake-account.ts';
import { renderApp } from '../../helpers.tsx';
import { installDesktop, removeDesktop } from './desktop-bridge.ts';

afterEach(() => {
  removeDesktop();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

function fresh(hash = '#/today') {
  return renderApp({ hash, signedIn: false, modelConnected: false, setup: (fake) => fake.control.account.seedFresh() });
}

function fill(name: string, handle: string, password: string): void {
  fireEvent.change(screen.getByLabelText('叫你什么'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('@账号'), { target: { value: handle } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: password } });
}

describe('建账号', () => {
  it('还没有主人：没登录的界面直接到建账号，第 1 步，没有配对码', async () => {
    await fresh();
    const page = await screen.findByRole('main', { name: '建一个账号' });
    expect(within(page).getByRole('img', { name: '第 1 步，共 3 步' })).toBeTruthy();
    expect(screen.queryByLabelText('配对码')).toBeNull();
    expect(within(page).getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true);
  });

  it('@账号停一下才问：能用、被占了、格式不对；下面一行是手机打开的网址，ⓘ 讲 @账号是什么', async () => {
    const app = await fresh();
    await screen.findByRole('main', { name: '建一个账号' });
    const handle = vi.spyOn(app.api.account, 'handle');
    const input = screen.getByLabelText('@账号');
    fireEvent.change(input, { target: { value: 'ale' } });
    fireEvent.change(input, { target: { value: 'alex' } });
    expect(await screen.findByText('能用')).toBeTruthy();
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0]?.[0]).toBe('alex');
    expect(screen.getByText('手机和别的电脑用 alex.cyberhunter.top 打开')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'taken' } });
    expect(await screen.findByText('被占了')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'al-ex' } });
    expect(await screen.findByText('格式不对')).toBeTruthy();
    expect(handle).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: '「@账号」的说明' }).getAttribute('aria-description'))
      .toContain('朋友靠它加你');
  });

  it('桌面客户端里凭本机令牌建账号：回车就提交，建成到第 2 步「连上一个模型」', async () => {
    const desktop = installDesktop();
    const app = await fresh();
    await screen.findByRole('main', { name: '建一个账号' });
    const setup = vi.spyOn(app.api.account, 'setup');
    fill('Alex', 'alex', 'fake-pass-1234');
    await screen.findByText('能用');
    fireEvent.submit(screen.getByLabelText('密码').closest('form')!);
    const connect = await screen.findByRole('main', { name: '连接模型' });
    expect(within(connect).getByRole('heading', { name: '连上一个模型' })).toBeTruthy();
    expect(within(connect).getByRole('img', { name: '第 2 步，共 3 步' })).toBeTruthy();
    expect(setup.mock.calls[0]?.[0]).toMatchObject({ displayName: 'Alex', handle: 'alex' });
    expect(setup.mock.calls[0]?.[1]).toBe(FAKE_LOCAL_TOKEN);
    expect(window.location.hash).toBe('#/plasticine/main');
    expect(desktop.showWelcome).not.toHaveBeenCalled();
  });

  it('Linux 装完给的链接：地址里 ?t= 的令牌随请求发出', async () => {
    const app = await fresh(`#/setup?t=${FAKE_SETUP_TOKEN}`);
    await screen.findByRole('main', { name: '建一个账号' });
    const setup = vi.spyOn(app.api.account, 'setup');
    fill('Alex', '', 'fake-pass-1234');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await screen.findByRole('main', { name: '连接模型' });
    expect(setup.mock.calls[0]?.[0]).toMatchObject({ handle: null, setupToken: FAKE_SETUP_TOKEN });
    expect(setup.mock.calls[0]?.[1]).toBeNull();
  });

  it('没有令牌：就地一行说清，不弹框，填的都还在', async () => {
    await fresh();
    await screen.findByRole('main', { name: '建一个账号' });
    fill('Alex', '', 'fake-pass-1234');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect((await screen.findByRole('alert')).textContent).toContain('建账号链接过期了');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByLabelText('叫你什么') as HTMLInputElement).value).toBe('Alex');
  });

  it('密码不到 8 位不让创建；眼睛切换显示密码', async () => {
    await fresh();
    await screen.findByRole('main', { name: '建一个账号' });
    fill('Alex', '', 'short');
    expect(screen.getByText('至少 8 位')).toBeTruthy();
    expect(screen.getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true);
    const password = screen.getByLabelText('密码') as HTMLInputElement;
    expect(password.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: '显示密码' }));
    expect(password.type).toBe('text');
    expect(screen.getByRole('button', { name: '隐藏密码' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('「换一个地方」只在桌面客户端里出现，点了回开始页', async () => {
    await fresh();
    await screen.findByRole('main', { name: '建一个账号' });
    expect(screen.queryByRole('button', { name: '换一个地方' })).toBeNull();
    removeDesktop();
  });

  it('桌面客户端里：「换一个地方」调 server.showWelcome()', async () => {
    const desktop = installDesktop({ localToken: null });
    await fresh();
    await screen.findByRole('main', { name: '建一个账号' });
    fireEvent.click(screen.getByRole('button', { name: '换一个地方' }));
    await waitFor(() => expect(desktop.showWelcome).toHaveBeenCalledTimes(1));
  });
});
