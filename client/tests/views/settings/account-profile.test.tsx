// 设置 · 账号（11-08 设计稿 Settings-Account）：名字（就地改）+ @账号 + 地址；改密码要旧密码（桌面客户端本机不要，带本机令牌）；
// 登录着的设备一行一台，这台标「这台」、别的「退出」（先说后果）、最下面「退出这台」；没加入网络的在这里起 @账号，不要邀请码；
// 系统里不再有「添加设备」。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FAKE_LOCAL_TOKEN } from '../../../src/api/fake/fake-account.ts';
import type { FakeApi } from '../../../src/api/fake/index.ts';
import { renderApp } from '../../helpers.tsx';
import { installDesktop, removeDesktop } from '../onboard/desktop-bridge.ts';

afterEach(() => {
  removeDesktop();
  vi.restoreAllMocks();
});

function pane(): HTMLElement {
  return screen.getByRole('dialog', { name: '设置' });
}

async function account(): Promise<HTMLElement> {
  await screen.findByRole('dialog', { name: '设置' });
  const region = await within(pane()).findByRole('region', { name: '名字和密码' });
  await within(region).findByText('密码');
  return region;
}

function joined(fake: FakeApi): void {
  fake.control.network.register('you', 'Alex');
}

describe('设置 · 账号', () => {
  it('名字一行写 @账号和地址；「改」就地改名字，保存后换上', async () => {
    const app = await renderApp({ hash: '#/settings/account', setup: joined });
    const region = await account();
    expect(within(region).getByText('Alex')).toBeTruthy();
    expect(within(region).getByText('@you · you.cyberhunter.top')).toBeTruthy();
    fireEvent.click(within(region).getByRole('button', { name: '改名字' }));
    const form = within(region).getByRole('form', { name: '改名字' });
    fireEvent.change(within(form).getByLabelText('名字'), { target: { value: '慕远' } });
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    expect(await within(region).findByText('慕远')).toBeTruthy();
    expect((await app.api.account.state()).displayName).toBe('慕远');
  });

  it('改完名字图标栏的名字立刻跟着变（重读网络状态）', async () => {
    await renderApp({ hash: '#/settings/account', setup: joined });
    const region = await account();
    const rail = screen.getByRole('navigation', { name: '栏目' });
    await waitFor(() => expect(within(rail).getByRole('button', { name: '设置 · Alex' })).toBeTruthy());
    fireEvent.click(within(region).getByRole('button', { name: '改名字' }));
    const form = within(region).getByRole('form', { name: '改名字' });
    fireEvent.change(within(form).getByLabelText('名字'), { target: { value: '慕远' } });
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(within(rail).getByRole('button', { name: '设置 · 慕远' })).toBeTruthy());
    expect(within(rail).getByRole('button', { name: '设置 · 慕远' }).querySelector('.rail-avatar')?.textContent)
      .toBe('慕');
  });

  it('换过头像：图标栏和账号第一行画那张图，不再画首字', async () => {
    const face = 'data:image/png;base64,iVBORw0KGgo=';
    await renderApp({ hash: '#/settings/account', setup: (fake) => {
      joined(fake);
      void fake.control.network.setAvatar({ requestId: 'avatar-1', avatar: face });
    } });
    const region = await account();
    await waitFor(() => expect(region.querySelector(`img[src="${face}"]`)).not.toBeNull());
    const rail = screen.getByRole('navigation', { name: '栏目' });
    const button = within(rail).getByRole('button', { name: '设置 · Alex' });
    expect(button.querySelector('img.rail-avatar')?.getAttribute('src')).toBe(face);
    expect(button.querySelector('span.rail-avatar')).toBeNull();
  });

  it('手机首页右上角的头像也画那张图', async () => {
    const face = 'data:image/png;base64,iVBORw0KGgo=';
    await renderApp({ hash: '#/today', width: 390, setup: (fake) => {
      joined(fake);
      void fake.control.network.setAvatar({ requestId: 'avatar-2', avatar: face });
    } });
    const button = await screen.findByRole('button', { name: '设置 · Alex' });
    await waitFor(() => expect(button.querySelector('img')?.getAttribute('src')).toBe(face));
    expect(button.textContent).toBe('');
  });

  it('网页里改密码要旧密码；旧密码不对就地一行', async () => {
    const app = await renderApp({ hash: '#/settings/account', setup: joined });
    const region = await account();
    fireEvent.click(within(region).getByRole('button', { name: '改密码' }));
    const form = within(region).getByRole('form', { name: '改密码' });
    fireEvent.change(within(form).getByLabelText('旧密码'), { target: { value: 'not-it' } });
    fireEvent.change(within(form).getByLabelText('新密码'), { target: { value: 'fake-new-pass' } });
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    expect((await within(form).findByRole('alert')).textContent).toContain('旧密码不对');
    fireEvent.change(within(form).getByLabelText('旧密码'), { target: { value: 'fake-password' } });
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(within(region).queryByRole('form', { name: '改密码' })).toBeNull());
    expect(app.control.account.currentPassword()).toBe('fake-new-pass');
    expect(within(region).getByText(/设的$/)).toBeTruthy();
  });

  it('桌面客户端本机：改密码不要旧密码，请求带本机令牌', async () => {
    installDesktop();
    const app = await renderApp({ hash: '#/settings/account', setup: joined });
    const region = await account();
    const setPassword = vi.spyOn(app.api.account, 'setPassword');
    await waitFor(() => {
      fireEvent.click(within(region).getByRole('button', { name: '改密码' }));
      expect(within(region).queryByLabelText('旧密码')).toBeNull();
    });
    const form = within(region).getByRole('form', { name: '改密码' });
    fireEvent.change(within(form).getByLabelText('新密码'), { target: { value: 'fake-new-pass' } });
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(setPassword).toHaveBeenCalledWith({ password: 'fake-new-pass' }, FAKE_LOCAL_TOKEN));
  });

  it('登录着的设备：这台标「这台」，别的「退出」先说后果，确定后去掉', async () => {
    const app = await renderApp({ hash: '#/settings/account', setup: (fake) => {
      joined(fake);
      fake.control.session.seedDevice('书房的 iPhone');
    } });
    const devices = await within(pane()).findByRole('region', { name: '登录着的设备' });
    await within(devices).findByText('书房的 iPhone');
    expect(within(devices).getByText('这台')).toBeTruthy();
    const revoke = vi.spyOn(app.api.devices, 'revoke');
    fireEvent.click(within(devices).getByRole('button', { name: '让「书房的 iPhone」退出' }));
    const confirm = within(devices).getByRole('alertdialog', { name: '让「书房的 iPhone」退出' });
    expect(confirm.textContent).toContain('要用 @账号和密码重新登录');
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: '确定退出' }));
    await waitFor(() => expect(within(devices).queryByText('书房的 iPhone')).toBeNull());
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('退出这台：先说后果，取消不退；确定后回到登录页', async () => {
    const app = await renderApp({ hash: '#/settings/account', setup: joined });
    const devices = await within(pane()).findByRole('region', { name: '登录着的设备' });
    await within(devices).findByText('测试机');
    const logout = vi.spyOn(app.api.session, 'logout');
    fireEvent.click(within(devices).getByRole('button', { name: '退出这台' }));
    const confirm = within(devices).getByRole('alertdialog', { name: '退出这台' });
    expect(confirm.textContent).toContain('退出后要用 @账号和密码重新登录');
    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }));
    expect(logout).not.toHaveBeenCalled();
    fireEvent.click(within(devices).getByRole('button', { name: '退出这台' }));
    fireEvent.click(within(devices).getByRole('button', { name: '确定退出' }));
    expect(await screen.findByRole('main', { name: '登录' })).toBeTruthy();
  });

  it('没加入网络：起一个 @账号（不要邀请码），问过能用才让起，起了写上', async () => {
    const app = await renderApp({ hash: '#/settings/account' });
    const region = await account();
    expect(within(region).getByText('还没有 @账号')).toBeTruthy();
    fireEvent.click(within(region).getByRole('button', { name: '起一个 @账号' }));
    const form = within(region).getByRole('form', { name: '起一个 @账号' });
    fireEvent.change(within(form).getByLabelText('@账号'), { target: { value: 'taken' } });
    expect(await within(form).findByText('被占了')).toBeTruthy();
    expect(within(form).getByRole('button', { name: '起这个' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(form).getByLabelText('@账号'), { target: { value: 'alex2' } });
    await within(form).findByText('能用');
    fireEvent.click(within(form).getByRole('button', { name: '起这个' }));
    expect(await within(region).findByText(/^@alex2/)).toBeTruthy();
    expect((await app.api.network.status()).account?.handle).toBe('alex2');
    expect(within(pane()).queryByLabelText('邀请码')).toBeNull();
  });

  it('设置 · 系统里不再有「添加设备」和配对码', async () => {
    await renderApp({ hash: '#/settings/system' });
    await screen.findByRole('dialog', { name: '设置' });
    await within(pane()).findByRole('region', { name: '运行情况' });
    expect(within(pane()).queryByRole('button', { name: '添加设备' })).toBeNull();
    expect(within(pane()).queryByText(/配对码/)).toBeNull();
  });
});
