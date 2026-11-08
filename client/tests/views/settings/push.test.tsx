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

describe('设置 · 这台设备接收系统通知（立刻打断）', () => {
  it('本设备已经登记过：登录只读订阅状态，不重复交订阅', async () => {
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
  it('加载时、打开设置时都不申请权限；点了开关才弹权限框，订阅交给服务端', async () => {
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

  it('权限被拒：就地说清楚去浏览器设置里允许，开关保持关着，服务端没有登记', async () => {
    const device = new FakePushDevice({ answer: 'denied' });
    const app = await renderApp({ pushDevice: device });
    const sheet = openSettings();
    await settle();
    fireEvent.click(toggle(sheet));
    await waitFor(() => expect(within(sheet).getByRole('alert').textContent).toContain('浏览器的网站设置'));
    expect(toggle(sheet).checked).toBe(false);
    expect(app.control.push.subscribed()).toEqual([]);
  });

  it('之前就拒绝过：打开设置时就写明，点开关不会再弹（浏览器也不会再弹）', async () => {
    const device = new FakePushDevice({ permission: 'denied' });
    await renderApp({ pushDevice: device });
    const sheet = openSettings();
    await waitFor(() => expect(within(sheet).getByRole('alert').textContent).toContain('拒绝了'));
    expect(device.prompts).toBe(0);
  });

  it('浏览器不支持：开关不能点，写一句为什么', async () => {
    const device = new FakePushDevice({ unsupported: '这个浏览器不支持网页推送。' });
    await renderApp({ pushDevice: device });
    const sheet = openSettings();
    await waitFor(() => expect(toggle(sheet).disabled).toBe(true));
    expect(sheet.textContent).toContain('这个浏览器不支持网页推送。');
  });

  it('关掉就退订：这台设备不再收，服务端那条登记也删掉', async () => {
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

  it('已经开着的：每次登录后把订阅再交给服务端一次，不弹权限框（换了会话也接得上）', async () => {
    const device = new FakePushDevice({ permission: 'granted' });
    await device.subscribe(FAKE_VAPID_PUBLIC_KEY);
    const app = await renderApp({ pushDevice: device });
    await waitFor(() => expect(app.control.push.subscribed()).toHaveLength(1));
    expect(device.prompts).toBe(0);
  });

  it('服务端没收下订阅：开关显示开着、写原因，「再登记一次」', async () => {
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

  it('浏览器的权限请求自己抛了错：写原因，开关恢复可点（不留永远的「正在设置…」）', async () => {
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

  it('「再登记一次」时读这台设备的订阅抛了错：写原因，还能再试', async () => {
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

  it('重新登记还没回来：开关不可点，关的操作不接；回执到了是「开着」，不会和退订交错写乱', async () => {
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

  it('登记回执不确定之后浏览器换了订阅（endpoint 变了）：再登记换新的 requestId，不拿旧标识登记新订阅', async () => {
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

  it('订阅没变的再登记：沿用回执不确定那一次的 requestId', async () => {
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

  it('VAPID 公钥按 base64url 解成字节交给 PushManager', () => {
    const bytes = base64UrlToBytes(FAKE_VAPID_PUBLIC_KEY);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
  });
});
