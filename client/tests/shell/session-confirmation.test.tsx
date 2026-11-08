import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DeviceKeyring } from '../../src/state/device-keyring.ts';
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

it('用 @账号和密码新登录后也不增加钥匙登记步骤', async () => {
  withoutSigningStorage();
  const prepare = vi.spyOn(DeviceKeyring.prototype, 'prepare');
  const register = vi.fn();
  await renderApp({ signedIn: false, hash: '#/login', now: () => new Date(), setup(fake) {
    vi.spyOn(fake.api.deviceKeys, 'register').mockImplementation(register);
  } });
  fireEvent.change(await screen.findByLabelText('密码'), { target: { value: 'fake-password' } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
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
