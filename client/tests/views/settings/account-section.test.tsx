// 设置 · 账号 · 「这台设备」（用户视角审查 2026-11-01 第 15 条；2026-11-05 从「常用」挪进「账号」）：这台设备名、
// 退出这台浏览器（就地确认）、到「系统」里的设备；
// 通用 · 通知「能收到『立刻打断』的设备」：接口只报这台设备的状态，其他设备写明要在那台设备上看（在 ⓘ 里）；
// 开关已经说清的（开着能收到、关着收不到）不再常显一行，只有被拒绝、不支持、没登记上这些才写。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FakePushDevice } from '../../../src/api/fake/fake-push-device.ts';
import { FAKE_VAPID_PUBLIC_KEY } from '../../../src/api/fake/fake-push.ts';
import { renderApp, settle } from '../../helpers.tsx';

async function openSection(name: '通用' | '账号'): Promise<HTMLElement> {
  fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^设置/ }));
  const sheet = await screen.findByRole('dialog', { name: '设置' });
  fireEvent.click(within(sheet).getByRole('button', { name }));
  return sheet;
}

const openGeneral = (): Promise<HTMLElement> => openSection('通用');
const openAccount = (): Promise<HTMLElement> => openSection('账号');

describe('设置 · 账号 · 这台设备', () => {
  it('退出这台浏览器要再点一次确认，说明回来要另一台设备的配对码；确定后回到配对页', async () => {
    const app = await renderApp();
    const sheet = await openAccount();
    const section = within(sheet).getByRole('region', { name: '这台设备' });
    const logout = vi.spyOn(app.api.session, 'logout');
    fireEvent.click(within(section).getByRole('button', { name: '退出这台浏览器' }));
    expect(logout).not.toHaveBeenCalled();
    expect(section.textContent).toContain('退出后要在另一台已登录的设备上拿配对码才能回来');
    fireEvent.click(within(section).getByRole('button', { name: '取消' }));
    expect(within(section).queryByRole('button', { name: '确定退出' })).toBeNull();
    fireEvent.click(within(section).getByRole('button', { name: '退出这台浏览器' }));
    fireEvent.click(within(section).getByRole('button', { name: '确定退出' }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { name: '配对这台设备' })).toBeTruthy();
  });

  it('退出失败就地说原因，还留在设置里', async () => {
    const app = await renderApp();
    const sheet = await openAccount();
    const section = within(sheet).getByRole('region', { name: '这台设备' });
    vi.spyOn(app.api.session, 'logout').mockRejectedValueOnce(new Error('服务器没有回应'));
    fireEvent.click(within(section).getByRole('button', { name: '退出这台浏览器' }));
    fireEvent.click(within(section).getByRole('button', { name: '确定退出' }));
    await waitFor(() => expect(within(section).getByRole('alert').textContent).toContain('服务器没有回应'));
    expect(screen.getByRole('dialog', { name: '设置' })).toBeTruthy();
  });
});

describe('设置 · 通知 · 能收到「立刻打断」的设备', () => {
  const tip = (sheet: HTMLElement): string => within(sheet).getByRole('button', { name: '通知的说明' })
    .getAttribute('aria-description') ?? '';

  it('这台设备开着：开关开着，ⓘ 里写「这台设备能收到」和其他设备要在那台上看，不再常显一行', async () => {
    const device = new FakePushDevice({ permission: 'granted' });
    await device.subscribe(FAKE_VAPID_PUBLIC_KEY);
    await renderApp({ pushDevice: device });
    const sheet = await openGeneral();
    await waitFor(() => expect(tip(sheet)).toContain('这台设备能收到'));
    expect(tip(sheet)).toContain('其他设备的状态要在那台设备上看');
    expect(within(sheet).getByRole('switch', { name: '这台设备接收系统通知' })).toHaveProperty('checked', true);
    expect(within(sheet).queryByText('这台设备能收到')).toBeNull();
  });

  it('这台设备没开：开关关着，ⓘ 里写「这台设备收不到」', async () => {
    await renderApp({ pushDevice: new FakePushDevice({ answer: 'granted' }) });
    const sheet = await openGeneral();
    await settle();
    expect(tip(sheet)).toContain('这台设备收不到');
    expect(within(sheet).getByRole('switch', { name: '这台设备接收系统通知' })).toHaveProperty('checked', false);
  });
});
