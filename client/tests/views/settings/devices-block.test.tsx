// 设置 · 系统 ·「设备」（2026-11-05 设计稿 Settings-System）：一行一台，⋯ 里撤销 / 退出这台，先常显后果再确定；
// 段头「添加设备」打开一次性登录邀请。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../helpers.tsx';

async function openDevices(): Promise<HTMLElement> {
  fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^设置/ }));
  const sheet = await screen.findByRole('dialog', { name: '设置' });
  fireEvent.click(within(sheet).getByRole('button', { name: '系统' }));
  return within(sheet).findByRole('region', { name: '设备' });
}

describe('设置 · 系统 · 设备', () => {
  it('撤销另一台先说后果，确定后那台从列表里去掉', async () => {
    const app = await renderApp({ setup: (fake) => { fake.control.session.seedDevice('书房的 iPhone'); } });
    const section = await openDevices();
    await within(section).findByText('书房的 iPhone');
    const revoke = vi.spyOn(app.api.devices, 'revoke');
    fireEvent.click(within(section).getByRole('button', { name: '「书房的 iPhone」的更多操作' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '撤销' }));
    const confirm = within(section).getByRole('alertdialog', { name: '撤销「书房的 iPhone」' });
    expect(confirm.textContent).toContain('撤销后那台要重新配对');
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: '确定撤销' }));
    await waitFor(() => expect(within(section).queryByText('书房的 iPhone')).toBeNull());
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('这台的 ⋯ 是退出这台，取消就不退', async () => {
    const app = await renderApp();
    const section = await openDevices();
    await within(section).findByText('测试机');
    const logout = vi.spyOn(app.api.session, 'logout');
    fireEvent.click(within(section).getByRole('button', { name: '「测试机」的更多操作' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '退出这台' }));
    const confirm = within(section).getByRole('alertdialog', { name: '退出这台' });
    expect(confirm.textContent).toContain('退出后要在另一台已登录的设备上拿配对码才能回来');
    fireEvent.click(within(confirm).getByRole('button', { name: '取消' }));
    expect(within(section).queryByRole('alertdialog')).toBeNull();
    expect(logout).not.toHaveBeenCalled();
  });

  it('添加设备只有一个入口，展开真实邀请二维码和八位备用码；Mac 执行节点单独展开', async () => {
    const app = await renderApp({ setup: (fake) => fake.control.network.seedJoined('tester', '测试') });
    const section = await openDevices();
    const issue = vi.spyOn(app.api.devices, 'issuePairingCode');
    const mac = vi.spyOn(app.api.signed, 'send');
    fireEvent.click(within(section).getByRole('button', { name: '添加设备' }));
    const sheet = await screen.findByRole('dialog', { name: '添加设备' });
    await within(sheet).findByText('用手机扫码');
    expect(issue).toHaveBeenCalledTimes(1);
    const code = await within(sheet).findByLabelText('备用配对码');
    expect(code.textContent).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(within(sheet).getByText(/分钟后失效/).textContent).toContain('仅用一次');
    const qr = within(sheet).getByRole('img', { name: /^二维码：/ });
    expect(qr.getAttribute('aria-label')).toContain('#/pair?code=');
    expect(within(sheet).getByText('连接 Mac 执行节点').tagName).toBe('SUMMARY');
    expect(mac).not.toHaveBeenCalled();
  });

  it('只根据这次邀请的真实回执显示成功；读失败留住邀请并能重试', async () => {
    const app = await renderApp();
    const section = await openDevices();
    const status = vi.spyOn(app.api.devices, 'pairingStatus').mockRejectedValueOnce(new Error('暂时离线'));
    fireEvent.click(within(section).getByRole('button', { name: '添加设备' }));
    const sheet = await screen.findByRole('dialog', { name: '添加设备' });
    await within(sheet).findByText(/暂时离线/);
    expect(within(sheet).queryByText('新设备已连接')).toBeNull();
    const device = app.control.session.seedDevice('这次邀请的手机');
    status.mockResolvedValue({ id: 'pair_test', expiresAt: '2026-10-27T02:10:00.000Z',
      checkedAt: '2026-10-27T02:00:00.000Z', status: 'connected', device });
    fireEvent.click(within(sheet).getByRole('button', { name: '重新读取' }));
    await within(sheet).findByText('新设备已连接');
    expect(within(sheet).getByText('这次邀请的手机')).toBeTruthy();
  });

  it('过期邀请不再展示可用二维码，重新生成拿新邀请', async () => {
    const app = await renderApp();
    const section = await openDevices();
    vi.spyOn(app.api.devices, 'pairingStatus').mockResolvedValue({ id: 'pair_expired',
      expiresAt: '2026-10-27T02:10:00.000Z', checkedAt: '2026-10-27T02:11:00.000Z', status: 'expired', device: null });
    const issue = vi.spyOn(app.api.devices, 'issuePairingCode');
    fireEvent.click(within(section).getByRole('button', { name: '添加设备' }));
    const sheet = await screen.findByRole('dialog', { name: '添加设备' });
    await within(sheet).findByText('配对邀请已过期');
    expect(within(sheet).queryByRole('img', { name: /^二维码：/ })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: '重新生成' }));
    await waitFor(() => expect(issue).toHaveBeenCalledTimes(2));
  });
});
