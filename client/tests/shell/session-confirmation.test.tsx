import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
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

it('没有 WebCrypto 和 IndexedDB 的浏览器用 @账号和密码也能登录进首页', async () => {
  withoutSigningStorage();
  await renderApp({ signedIn: false, hash: '#/login', now: () => new Date() });
  fireEvent.change(await screen.findByLabelText('密码'), { target: { value: 'fake-password' } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
  await screen.findByRole('heading', { name: HOME_HEADING });
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
