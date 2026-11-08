// 登录（11-08 设计稿 Sign-In / Phone-SignIn）：@账号预填、密码对了进门；密码不对、连错被限流就地一行；填别的 @账号跳到
// 那一份的登录页；「忘了密码」点开写重设办法；桌面客户端里多「换一个地方」、本机令牌直接登录；已登录打开 #/login 回首页。

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../../src/api/context.tsx';
import { createFakeApi } from '../../../src/api/fake/index.ts';
import { LoginView } from '../../../src/views/login/login-view.tsx';
import { loginTarget } from '../../../src/views/onboard/handle.ts';
import { HOME_HEADING, renderApp, setViewportWidth } from '../../helpers.tsx';
import { installDesktop, removeDesktop } from './desktop-bridge.ts';

afterEach(() => {
  removeDesktop();
  vi.restoreAllMocks();
});

function signedOut(hash = '#/login') {
  return renderApp({ hash, signedIn: false, setup: (fake) => fake.control.network.register('you', 'Alex') });
}

describe('登录', () => {
  it('按账号状态预填 @账号，电脑上框里写它的网址；没有配对码、没有「在哪里获取配对码」', async () => {
    await signedOut();
    const page = await screen.findByRole('main', { name: '登录' });
    expect((within(page).getByLabelText('@账号或地址') as HTMLInputElement).value).toBe('you');
    expect(within(page).getByText('you.cyberhunter.top')).toBeTruthy();
    expect(screen.queryByLabelText('配对码')).toBeNull();
    expect(screen.queryByText('在哪里获取配对码？')).toBeNull();
    expect(document.activeElement).toBe(within(page).getByLabelText('密码'));
  });

  it('密码对了：登记这台设备、进首页', async () => {
    const app = await signedOut();
    await screen.findByRole('main', { name: '登录' });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'fake-password' } });
    fireEvent.submit(screen.getByLabelText('密码').closest('form')!);
    expect(await screen.findByRole('heading', { name: HOME_HEADING })).toBeTruthy();
    expect(window.location.hash).toBe('#/today');
    expect(await app.api.devices.list()).toHaveLength(1);
  });

  it('密码不对就地一行；连错太多被限流也是就地一行，不弹框', async () => {
    await signedOut();
    await screen.findByRole('main', { name: '登录' });
    const password = screen.getByLabelText('密码');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      fireEvent.change(password, { target: { value: `wrong-${attempt}` } });
      fireEvent.click(screen.getByRole('button', { name: '登录' }));
      await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('密码不对'));
    }
    fireEvent.change(password, { target: { value: 'fake-password' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('试错太多次了'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('填的是别的 @账号：跳到那一份的登录页，密码不带过去', async () => {
    const assign = vi.fn();
    const fake = createFakeApi({ seed: false, streamStepMs: 0 });
    render(<ApiProvider api={fake.api}><LoginView account={await fake.api.account.state()} onSignedIn={vi.fn()}
      navigate={assign} /></ApiProvider>);
    fireEvent.change(screen.getByLabelText('@账号或地址'), { target: { value: '@xiaolin' } });
    expect((screen.getByLabelText('密码') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(assign).toHaveBeenCalledWith('https://xiaolin.cyberhunter.top/#/login');
  });

  it('「忘了密码」点开说怎么重设，Esc 收起', async () => {
    await signedOut();
    await screen.findByRole('main', { name: '登录' });
    fireEvent.click(screen.getByRole('button', { name: '忘了密码' }));
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('在装着它的那台电脑上打开 Plasticine 就能重设');
    expect(tip.textContent).toContain('plasticine password');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('网页里没有「换一个地方」；桌面客户端（连远程，拿不到本机令牌）里有，点了回开始页', async () => {
    await signedOut();
    await screen.findByRole('main', { name: '登录' });
    expect(screen.queryByRole('button', { name: '换一个地方' })).toBeNull();
  });

  it('桌面客户端连远程：登录页有「换一个地方」', async () => {
    const desktop = installDesktop({ localToken: null });
    await signedOut();
    await screen.findByRole('main', { name: '登录' });
    fireEvent.click(screen.getByRole('button', { name: '换一个地方' }));
    expect(desktop.showWelcome).toHaveBeenCalledTimes(1);
  });

  it('桌面客户端本机：凭本机令牌直接登录，不问密码', async () => {
    installDesktop();
    const app = await signedOut();
    expect(await screen.findByRole('heading', { name: HOME_HEADING })).toBeTruthy();
    expect(screen.queryByRole('main', { name: '登录' })).toBeNull();
    expect(await app.api.devices.list()).toHaveLength(1);
  });

  it('已经登录着却打开 #/login（桌面客户端连远程直接载入它）：回首页', async () => {
    await renderApp({ hash: '#/login' });
    expect(await screen.findByRole('heading', { name: HOME_HEADING })).toBeTruthy();
    expect(window.location.hash).toBe('#/today');
  });

  it('手机布局：一列贴顶，不显示框里的网址（样式），表单照样能用', async () => {
    setViewportWidth(390);
    await signedOut();
    const page = await screen.findByRole('main', { name: '登录' });
    expect(within(page).getByRole('button', { name: '忘了密码' })).toBeTruthy();
  });

  it('@账号或地址认哪一份', () => {
    const here = new URL('https://you.cyberhunter.top/#/login');
    expect(loginTarget('', 'you', here)).toEqual({ kind: 'here' });
    expect(loginTarget('@you', 'you', here)).toEqual({ kind: 'here' });
    expect(loginTarget('you.cyberhunter.top', 'you', here)).toEqual({ kind: 'here' });
    expect(loginTarget('alex', 'you', here)).toEqual({ kind: 'elsewhere',
      url: 'https://alex.cyberhunter.top/#/login' });
    expect(loginTarget('http://192.168.1.5:8790/x', null, here)).toEqual({ kind: 'elsewhere',
      url: 'http://192.168.1.5:8790/#/login' });
    expect(loginTarget('https://user:pw@evil.test', null, here)).toEqual({ kind: 'bad' });
    expect(loginTarget('1-no', null, here)).toEqual({ kind: 'bad' });
    expect(loginTarget('alex', undefined, here)).toEqual({ kind: 'here' });
    expect(loginTarget('alex', null, null)).toEqual({ kind: 'elsewhere', url: 'https://alex.cyberhunter.top/#/login' });
  });
});
