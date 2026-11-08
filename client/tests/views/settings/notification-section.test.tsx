// 设置 · 通用 · 通知（「这台设备」和退出 11-08 挪进 设置 · 账号 的「登录着的设备」，见 account-profile.test.tsx）：
// 通用 · 通知「能收到『立刻打断』的设备」：接口只报这台设备的状态，其他设备写明要在那台设备上看（在 ⓘ 里）；
// 开关已经说清的（开着能收到、关着收不到）不再常显一行，只有被拒绝、不支持、没登记上这些才写。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FakePushDevice } from '../../../src/api/fake/fake-push-device.ts';
import { FAKE_VAPID_PUBLIC_KEY } from '../../../src/api/fake/fake-push.ts';
import { renderApp, settle } from '../../helpers.tsx';

async function openSection(name: '通用'): Promise<HTMLElement> {
  fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^设置/ }));
  const sheet = await screen.findByRole('dialog', { name: '设置' });
  fireEvent.click(within(sheet).getByRole('button', { name }));
  return sheet;
}

const openGeneral = (): Promise<HTMLElement> => openSection('通用');

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
