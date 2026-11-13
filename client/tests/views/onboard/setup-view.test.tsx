// 第一次打开、还没有账号（11-12《首次使用解耦》）：窗口只有中间一列，Plasticine 打招呼，下面一张「建账号」卡——叫你什么
// （桌面客户端预填系统全名）、叫我什么（主线 AI 的名字）、@账号（当场查能不能用；服务器装的时候起好的锁着）、密码。
// 凭本机令牌或地址里的 ?t= 令牌建账号；建成落在主线，欢迎卡接着出「连上一个模型」；出错就地一行。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAKE_LOCAL_TOKEN, FAKE_SETUP_TOKEN } from '../../../src/api/fake/fake-account.ts';
import { renderApp } from '../../helpers.tsx';
import { installDesktop, removeDesktop } from './desktop-bridge.ts';

afterEach(() => {
  removeDesktop();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function fresh(hash = '#/today', register = false) {
  return renderApp({ hash, signedIn: false, modelConnected: false, setup: (fake) => {
    fake.control.account.seedFresh();
    if (register) fake.control.network.register('alex', 'Alex');
  } });
}

function fill(name: string, handle: string, password: string): void {
  fireEvent.change(screen.getByLabelText('叫你什么'), { target: { value: name } });
  if (handle !== '') fireEvent.change(screen.getByLabelText('@账号'), { target: { value: handle } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: password } });
}

describe('建账号', () => {
  it('还没有主人：一列里 Plasticine 打招呼，建账号卡四栏，叫我什么默认 Plasticine，没有配对码、没有进度条', async () => {
    await fresh();
    const page = await screen.findByRole('main', { name: '建账号' });
    expect(page.textContent).toContain('你好，我是 Plasticine。先把账号建好，再连一个模型。');
    expect((screen.getByLabelText('叫我什么') as HTMLInputElement).value).toBe('Plasticine');
    expect(screen.getByLabelText('@账号')).toBeTruthy();
    expect(screen.queryByLabelText('配对码')).toBeNull();
    expect(screen.queryByRole('img', { name: /第 \d 步/ })).toBeNull();
    expect(within(page).getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true);
  });

  it('@账号停一下才问：能用、被占了、格式不对；下面一行是手机打开的网址', async () => {
    const app = await fresh();
    await screen.findByRole('main', { name: '建账号' });
    const handle = vi.spyOn(app.api.account, 'handle');
    const input = screen.getByLabelText('@账号');
    fireEvent.change(input, { target: { value: 'ale' } });
    fireEvent.change(input, { target: { value: 'alex' } });
    expect(await screen.findByText('能用')).toBeTruthy();
    expect(handle).toHaveBeenCalledTimes(1);
    expect(screen.getByText('手机和别的电脑用 alex.cyberhunter.top 打开')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'taken' } });
    expect(await screen.findByText('被占了')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'al-ex' } });
    expect(await screen.findByText('格式不对')).toBeTruthy();
  });

  it('没起 @账号不让创建（第一次就加入网络）', async () => {
    installDesktop();
    await fresh();
    await screen.findByRole('main', { name: '建账号' });
    fill('Alex', '', 'fake-pass-1234');
    expect(screen.getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true);
  });

  it('桌面客户端：系统全名预填；凭本机令牌建账号，落在主线，欢迎卡接着是「连上一个模型」', async () => {
    const desktop = installDesktop({ profile: { fullName: '牟元礼', apps: [] } });
    const app = await fresh();
    await screen.findByRole('main', { name: '建账号' });
    await waitFor(() => expect((screen.getByLabelText('叫你什么') as HTMLInputElement).value).toBe('牟元礼'));
    const setup = vi.spyOn(app.api.account, 'setup');
    fill('Alex', 'alex', 'fake-pass-1234');
    await screen.findByText('能用');
    fireEvent.submit(screen.getByLabelText('密码').closest('form')!);
    const card = await screen.findByRole('region', { name: '连上一个模型' });
    expect(within(card).getByRole('listitem', { name: 'ChatGPT' })).toBeTruthy();
    expect(setup.mock.calls[0]?.[0]).toMatchObject({ displayName: 'Alex', handle: 'alex' });
    expect(setup.mock.calls[0]?.[1]).toBe(FAKE_LOCAL_TOKEN);
    expect(window.location.hash).toBe('#/plasticine/main');
    expect(desktop.showWelcome).not.toHaveBeenCalled();
  });

  it('叫我什么改了：建完改主线的名字，欢迎卡署这个名字', async () => {
    installDesktop();
    const app = await fresh();
    await screen.findByRole('main', { name: '建账号' });
    const update = vi.spyOn(app.api.mates, 'updateMain');
    fill('Alex', 'alex', 'fake-pass-1234');
    fireEvent.change(screen.getByLabelText('叫我什么'), { target: { value: '小满' } });
    await screen.findByText('能用');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect(await screen.findByRole('article', { name: '小满 的欢迎' })).toBeTruthy();
    expect(update.mock.calls[0]?.[0]).toEqual({ requestId: expect.any(String) as string, name: '小满' });
  });

  it('叫我什么不改就不调改名', async () => {
    installDesktop();
    const app = await fresh();
    await screen.findByRole('main', { name: '建账号' });
    const update = vi.spyOn(app.api.mates, 'updateMain');
    fill('Alex', 'alex', 'fake-pass-1234');
    await screen.findByText('能用');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await screen.findByRole('region', { name: '连上一个模型' });
    expect(update).not.toHaveBeenCalled();
  });

  it('服务器装的时候起好的 @账号：锁着只显示，凭链接里的 ?t= 令牌建账号，不再起一次', async () => {
    const app = await fresh(`#/setup?t=${FAKE_SETUP_TOKEN}`, true);
    await screen.findByRole('main', { name: '建账号' });
    expect(screen.getByText('@alex')).toBeTruthy();
    expect(screen.getByRole('img', { name: '安装时已经起好' })).toBeTruthy();
    expect(screen.queryByLabelText('@账号')).toBeNull();
    const setup = vi.spyOn(app.api.account, 'setup');
    fill('Alex', '', 'fake-pass-1234');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    await screen.findByRole('region', { name: '连上一个模型' });
    expect(setup.mock.calls[0]?.[0]).toMatchObject({ handle: null, setupToken: FAKE_SETUP_TOKEN });
    expect(setup.mock.calls[0]?.[1]).toBeNull();
  });

  it('没有令牌：就地一行说清，不弹框，填的都还在', async () => {
    await fresh();
    await screen.findByRole('main', { name: '建账号' });
    fill('Alex', 'alex', 'fake-pass-1234');
    await screen.findByText('能用');
    fireEvent.click(screen.getByRole('button', { name: '创建' }));
    expect((await screen.findByRole('alert')).textContent).toContain('建账号链接过期了');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByLabelText('叫你什么') as HTMLInputElement).value).toBe('Alex');
  });

  it('密码不到 8 位不让创建；眼睛切换显示密码', async () => {
    await fresh();
    await screen.findByRole('main', { name: '建账号' });
    fill('Alex', 'alex', 'short');
    expect(screen.getByText('至少 8 位')).toBeTruthy();
    expect(screen.getByRole('button', { name: '创建' }).hasAttribute('disabled')).toBe(true);
    const password = screen.getByLabelText('密码') as HTMLInputElement;
    expect(password.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: '显示密码' }));
    expect(password.type).toBe('text');
  });

  it('「换一个地方」只在桌面客户端里出现', async () => {
    await fresh();
    await screen.findByRole('main', { name: '建账号' });
    expect(screen.queryByRole('button', { name: '换一个地方' })).toBeNull();
  });

  it('桌面客户端里：「换一个地方」调 server.showWelcome()', async () => {
    const desktop = installDesktop({ localToken: null });
    await fresh();
    await screen.findByRole('main', { name: '建账号' });
    fireEvent.click(screen.getByRole('button', { name: '换一个地方' }));
    await waitFor(() => expect(desktop.showWelcome).toHaveBeenCalledTimes(1));
  });
});
