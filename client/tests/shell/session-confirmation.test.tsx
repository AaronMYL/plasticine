import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DeviceKeyring } from '../../src/state/device-keyring.ts';
import { pairingLink } from '../../src/views/login/pairing-link.ts';
import { HOME_HEADING, renderApp, seedNote } from '../helpers.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function withoutSigningStorage(): void {
  const original = globalThis.crypto;
  vi.stubGlobal('crypto', {
    randomUUID: original.randomUUID.bind(original),
    getRandomValues: original.getRandomValues.bind(original),
  });
  vi.stubGlobal('indexedDB', undefined);
}

it('已配对的老会话直接进入，不初始化、读取或登记设备签名钥匙', async () => {
  const prepare = vi.spyOn(DeviceKeyring.prototype, 'prepare');
  const current = vi.fn(async () => null);
  const register = vi.fn();
  await renderApp({ setup(fake) {
    fake.control.session.backdate(11 * 60 * 1000);
    vi.spyOn(fake.api.deviceKeys, 'current').mockImplementation(current);
    vi.spyOn(fake.api.deviceKeys, 'register').mockImplementation(register);
  } });
  expect(prepare).not.toHaveBeenCalled();
  expect(current).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
});

it.each(['code', 'link'] as const)('通过 %s 新配对后也不增加钥匙登记步骤', async (entry) => {
  withoutSigningStorage();
  const prepare = vi.spyOn(DeviceKeyring.prototype, 'prepare');
  const register = vi.fn();
  let code = '';
  await renderApp({ signedIn: false, now: () => new Date(), setup(fake) {
    code = fake.control.session.issueCode();
    vi.spyOn(fake.api.deviceKeys, 'register').mockImplementation(register);
    if (entry === 'link') {
      window.history.replaceState(null, '', pairingLink(window.location.origin,
        { code, expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    }
  } });
  if (entry === 'code') fireEvent.change(screen.getByLabelText('配对码'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: entry === 'code' ? '配对' : '连接这台设备' }));
  if (entry === 'link') {
    await screen.findByRole('heading', { name: '这台设备已连接' });
    expect(prepare).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '打开 Plasticine' }));
  }
  await screen.findByRole('heading', { name: HOME_HEADING });
  expect(prepare).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
});

it('没有 WebCrypto 和 IndexedDB 的已配对老会话直接读取私密笔记，没有解锁步骤', async () => {
  withoutSigningStorage();
  const app = await renderApp({ hash: '#/notes/private', setup(fake) {
    fake.control.session.backdate(11 * 60 * 1000);
    seedNote(fake, 'private', '# 示例私密正文', { private: true });
    vi.spyOn(fake.api.signed, 'send');
  } });
  await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toContain('示例私密正文'));
  expect(screen.queryByRole('button', { name: /解锁/ })).toBeNull();
  expect(screen.queryByText(/签名钥匙|重新配对后才能|换一台设备/)).toBeNull();
  expect(app.api.signed.send).not.toHaveBeenCalled();
  expect(await app.api.notes.get('private')).toMatchObject({ private: true, readOnly: false });
});

it('没有签名能力也能从现有设备入口生成 Mac 专用码，仍只在用户点击时发送', async () => {
  withoutSigningStorage();
  const app = await renderApp({});
  const send = vi.spyOn(app.api.signed, 'send');
  fireEvent.click(within(screen.getByRole('navigation', { name: '栏目' })).getByRole('button', { name: /^设置/ }));
  const settings = await screen.findByRole('dialog', { name: '设置' });
  fireEvent.click(within(settings).getByRole('button', { name: '系统' }));
  const devices = await within(settings).findByRole('region', { name: '设备' });
  fireEvent.click(within(devices).getByRole('button', { name: '添加设备' }));
  const sheet = await screen.findByRole('dialog', { name: '添加设备' });
  fireEvent.click(within(sheet).getByText('连接 Mac 执行节点'));
  const issue = within(sheet).getByRole('button', { name: '生成 Mac 专用码' });
  expect(issue.hasAttribute('disabled')).toBe(false);
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(issue);
  await within(sheet).findByRole('button', { name: '复制 Mac 专用码' });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0]![0]).toEqual({ target: { kind: 'node_pairing_code' },
    bodyText: expect.stringContaining('requestId') });
});
