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

it('browser without WebCrypto or IndexedDB can still sign in with handle and password', async () => {
  withoutSigningStorage();
  await renderApp({ signedIn: false, hash: '#/login', now: () => new Date() });
  fireEvent.change(await screen.findByLabelText('密码'), { target: { value: 'fake-password' } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
  await screen.findByRole('heading', { name: HOME_HEADING });
});

it('paired legacy session without WebCrypto or IndexedDB reads notes without unlock step', async () => {
  withoutSigningStorage();
  const app = await renderApp({ hash: '#/notes/memo', setup(fake) {
    fake.control.session.backdate(11 * 60 * 1000);
    seedNote(fake, 'memo', '# 示例笔记正文');
    vi.spyOn(fake.api.signed, 'send');
  } });
  await waitFor(() => expect(document.querySelector('.ProseMirror')?.textContent).toContain('示例笔记正文'));
  expect(screen.queryByRole('button', { name: /解锁/ })).toBeNull();
  expect(screen.queryByText(/签名钥匙|重新配对后才能|换一台设备/)).toBeNull();
  expect(app.api.signed.send).not.toHaveBeenCalled();
  expect(await app.api.notes.get('memo')).toMatchObject({ readOnly: false });
});
