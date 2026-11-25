import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

describe('Settings - Notifications - Devices receiving urgent alerts', () => {
  const tip = (sheet: HTMLElement): string => within(sheet)
    .getByRole('button', { name: '这台设备接收系统通知的说明' }).getAttribute('aria-description') ?? '';

  it('when enabled, switch is on and info popover explains this and other devices without inline line', async () => {
    const device = new FakePushDevice({ permission: 'granted' });
    await device.subscribe(FAKE_VAPID_PUBLIC_KEY);
    await renderApp({ pushDevice: device });
    const sheet = await openGeneral();
    await waitFor(() => expect(tip(sheet)).toContain('这台设备能收到'));
    expect(tip(sheet)).toContain('其他设备的状态要在那台设备上看');
    expect(within(sheet).getByRole('switch', { name: '这台设备接收系统通知' })).toHaveProperty('checked', true);
    expect(within(sheet).queryByText('这台设备能收到')).toBeNull();
  });

  it('when disabled, switch is off and info popover states this device cannot receive alerts', async () => {
    await renderApp({ pushDevice: new FakePushDevice({ answer: 'granted' }) });
    const sheet = await openGeneral();
    await settle();
    expect(tip(sheet)).toContain('这台设备收不到');
    expect(within(sheet).getByRole('switch', { name: '这台设备接收系统通知' })).toHaveProperty('checked', false);
  });
});
