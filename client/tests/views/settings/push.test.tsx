import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FakePushDevice } from '../../../src/api/fake/fake-push-device.ts';
import { base64UrlToBytes } from '../../../src/api/push-device.ts';
import { FAKE_VAPID_PUBLIC_KEY } from '../../../src/api/fake/fake-push.ts';
import { renderApp, settle } from '../../helpers.tsx';
import { PushSwitch } from '../../../src/views/settings/push-switch.ts';

const SWITCH = '这台设备接收系统通知';

function openSettings(): HTMLElement {
  fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^设置/ }));
  return screen.getByRole('dialog', { name: '设置' });
}

function toggle(sheet: HTMLElement): HTMLInputElement {
  return within(sheet).getByRole('switch', { name: SWITCH });
}

describe('Settings - Urgent system notifications on this device', () => {
  it('already registered device only reads subscription status on login without re-registering', async () => {
    const device = new FakePushDevice({ permission: 'granted' });
    await device.subscribe(FAKE_VAPID_PUBLIC_KEY);
    const app = await renderApp({ pushDevice: device });
    await waitFor(() => expect(app.control.push.subscribed()).toHaveLength(1));
    const subscribe = vi.spyOn(app.api.push, 'subscribe');
    const status = new PushSwitch(app.api, device);
    await status.start();
    expect(status.store.get().status).toBe('on');
    expect(subscribe).not.toHaveBeenCalled();
  });
  it('never prompts permission on load or open; requests permission and registers on toggle', async () => {
    const device = new FakePushDevice({ answer: 'granted' });
    const app = await renderApp({ pushDevice: device });
    await settle();
    expect(device.prompts).toBe(0);
    const sheet = openSettings();
    await settle();
    expect(device.prompts).toBe(0);
    expect(toggle(sheet).checked).toBe(false);

    fireEvent.click(toggle(sheet));
    await waitFor(() => expect(toggle(sheet).checked).toBe(true));
    expect(device.prompts).toBe(1);
    expect(device.subscribedWith).toBe(FAKE_VAPID_PUBLIC_KEY);
    expect(app.control.push.subscribed()).toEqual([device.subscription?.endpoint]);
  });

  it('denied permission explains browser settings inline, keeps switch off, skips server register', async () => {
    const device = new FakePushDevice({ answer: 'denied' });
    const app = await renderApp({ pushDevice: device });
    const sheet = openSettings();
    await settle();
    fireEvent.click(toggle(sheet));
    await waitFor(() => expect(within(sheet).getByRole('alert').textContent).toContain('浏览器的网站设置'));
    expect(toggle(sheet).checked).toBe(false);
    expect(app.control.push.subscribed()).toEqual([]);
  });

  it('previously denied permission displays notice on open without re-prompting on toggle', async () => {
    const device = new FakePushDevice({ permission: 'denied' });
    await renderApp({ pushDevice: device });
    const sheet = openSettings();
    await waitFor(() => expect(within(sheet).getByRole('alert').textContent).toContain('拒绝了'));
    expect(device.prompts).toBe(0);
  });

  it('unsupported browser disables toggle and explains why', async () => {
    const device = new FakePushDevice({ unsupported: '这个浏览器不支持网页推送。' });
    await renderApp({ pushDevice: device });
    const sheet = openSettings();
    await waitFor(() => expect(toggle(sheet).disabled).toBe(true));
    expect(sheet.textContent).toContain('这个浏览器不支持网页推送。');
  });

  it('toggling off unsubscribes device and deletes server registration', async () => {
    const device = new FakePushDevice({ answer: 'granted' });
    const app = await renderApp({ pushDevice: device });
    const sheet = openSettings();
    await settle();
    fireEvent.click(toggle(sheet));
    await waitFor(() => expect(toggle(sheet).checked).toBe(true));
    fireEvent.click(toggle(sheet));
    await waitFor(() => expect(toggle(sheet).checked).toBe(false));
    expect(device.subscription).toBeNull();
    expect(app.control.push.subscribed()).toEqual([]);
  });

  it('already enabled device re-submits subscription on login without prompting permission', async () => {
    const device = new FakePushDevice({ permission: 'granted' });
    await device.subscribe(FAKE_VAPID_PUBLIC_KEY);
    const app = await renderApp({ pushDevice: device });
    await waitFor(() => expect(app.control.push.subscribed()).toHaveLength(1));
    expect(device.prompts).toBe(0);
  });

  it('failed server registration keeps switch on with reason and Re-register button', async () => {
    const device = new FakePushDevice({ answer: 'granted' });
    const app = await renderApp({ pushDevice: device });
    app.control.faults.next('push', { kind: 'uncertain', landed: false });
    const sheet = openSettings();
    await settle();
    fireEvent.click(toggle(sheet));
    await waitFor(() => expect(within(sheet).getByRole('alert').textContent).toContain('服务端还没收下'));
    fireEvent.click(within(sheet).getByRole('button', { name: '再登记一次' }));
    await waitFor(() => expect(app.control.push.subscribed()).toHaveLength(1));
    expect(within(sheet).queryByRole('alert')).toBeNull();
  });

  it('browser permission error displays reason and re-enables toggle without sticking', async () => {
    const device = new FakePushDevice();
    vi.spyOn(device, 'requestPermission').mockRejectedValueOnce(new Error('权限框被浏览器拦下了'));
    await renderApp({ pushDevice: device });
    const sheet = openSettings();
    await settle();
    fireEvent.click(toggle(sheet));
    await waitFor(() => expect(sheet.textContent).toContain('权限框被浏览器拦下了'));
    expect(toggle(sheet).disabled).toBe(false);
    expect(toggle(sheet).checked).toBe(false);
  });

  it('reading device subscription error during Re-register shows reason and stays retryable', async () => {
    const device = new FakePushDevice({ answer: 'granted' });
    const app = await renderApp({ pushDevice: device });
    app.control.faults.next('push', { kind: 'failed', message: '服务端忙。' });
    const sheet = openSettings();
    await settle();
    fireEvent.click(toggle(sheet));
    await waitFor(() => expect(within(sheet).getByRole('button', { name: '再登记一次' })).toBeTruthy());
    vi.spyOn(device, 'current').mockRejectedValueOnce(new Error('service worker 没起来'));
    fireEvent.click(within(sheet).getByRole('button', { name: '再登记一次' }));
    await waitFor(() => expect(sheet.textContent).toContain('service worker 没起来'));
    expect(within(sheet).getByRole('button', { name: '再登记一次' })).toBeTruthy();
    expect(toggle(sheet).disabled).toBe(false);
  });

  it('disables toggle while re-registering so off click cannot race with settled on state', async () => {
    const device = new FakePushDevice({ answer: 'granted' });
    const app = await renderApp({ pushDevice: device });
    app.control.faults.next('push', { kind: 'failed', message: '服务端忙。' });
    const sheet = openSettings();
    await settle();
    fireEvent.click(toggle(sheet));
    await waitFor(() => expect(within(sheet).getByRole('button', { name: '再登记一次' })).toBeTruthy());
    const subscribe = app.api.push.subscribe.bind(app.api.push);
    let release: () => void = () => undefined;
    const late = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(app.api.push, 'subscribe').mockImplementationOnce(async (input) => {
      await late;
      return subscribe(input);
    });
    fireEvent.click(within(sheet).getByRole('button', { name: '再登记一次' }));
    await waitFor(() => expect(toggle(sheet).disabled).toBe(true));
    fireEvent.click(toggle(sheet));
    await settle();
    expect(device.subscription).not.toBeNull();
    release();
    await waitFor(() => expect(toggle(sheet).checked).toBe(true));
    expect(toggle(sheet).disabled).toBe(false);
    expect(app.control.push.subscribed()).toHaveLength(1);
  });

  it('changed browser endpoint after uncertain receipt uses new requestId on re-register', async () => {
    const device = new FakePushDevice({ answer: 'granted' });
    const app = await renderApp({ pushDevice: device });
    const subscribe = vi.spyOn(app.api.push, 'subscribe');
    app.control.faults.next('push', { kind: 'uncertain', landed: false });
    const sheet = openSettings();
    await settle();
    fireEvent.click(toggle(sheet));
    await waitFor(() => expect(within(sheet).getByRole('button', { name: '再登记一次' })).toBeTruthy());
    const first = device.subscription;
    if (first === null) {
      throw new Error('没订阅上');
    }
    device.subscription = { ...first, endpoint: 'https://push.example.test/send/renewed' };
    fireEvent.click(within(sheet).getByRole('button', { name: '再登记一次' }));
    await waitFor(() => expect(toggle(sheet).checked).toBe(true));
    const [one, two] = subscribe.mock.calls.map(([input]) => input);
    expect(two?.endpoint).toBe('https://push.example.test/send/renewed');
    expect(two?.requestId).not.toBe(one?.requestId);
    expect(app.control.push.subscribed()).toEqual(['https://push.example.test/send/renewed']);
  });

  it('unchanged subscription reuses uncertain receipt\'s requestId on re-register', async () => {
    const device = new FakePushDevice({ answer: 'granted' });
    const app = await renderApp({ pushDevice: device });
    const subscribe = vi.spyOn(app.api.push, 'subscribe');
    app.control.faults.next('push', { kind: 'uncertain', landed: false });
    const sheet = openSettings();
    await settle();
    fireEvent.click(toggle(sheet));
    await waitFor(() => expect(within(sheet).getByRole('button', { name: '再登记一次' })).toBeTruthy());
    fireEvent.click(within(sheet).getByRole('button', { name: '再登记一次' }));
    await waitFor(() => expect(toggle(sheet).checked).toBe(true));
    const [one, two] = subscribe.mock.calls.map(([input]) => input.requestId);
    expect(two).toBe(one);
  });

  it('decodes VAPID public key from base64url bytes for PushManager', () => {
    const bytes = base64UrlToBytes(FAKE_VAPID_PUBLIC_KEY);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
  });
});
