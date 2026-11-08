// 已有用户设密码（11-08 设计稿 Set-Password）：登录着、还没设密码时弹一次「给 @账号 设一个密码」；「以后再说」记在这台设备上，
// 一天内不再问；「设好了」设上；已经设过的不问。

import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PASSWORD_LATER_KEY } from '../../../src/views/onboard/set-password-prompt.tsx';
import { HOME_HEADING, renderApp } from '../../helpers.tsx';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function oldInstance() {
  return renderApp({ setup: (fake) => {
    fake.control.network.register('you', 'Alex');
    fake.control.account.seedNoPassword();
  } });
}

describe('给 @账号 设一个密码', () => {
  it('老实例登录着：弹一次，写清已登录的设备不受影响；「设好了」设上并收起', async () => {
    const app = await oldInstance();
    const dialog = await screen.findByRole('dialog', { name: '给 @you 设一个密码' });
    expect(dialog.textContent).toContain('已登录的设备不受影响');
    const done = within(dialog).getByRole('button', { name: '设好了' });
    expect(done.hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('密码'), { target: { value: 'fake-new-pass' } });
    fireEvent.submit(done.closest('form')!);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /设一个密码/ })).toBeNull());
    expect(app.control.account.currentPassword()).toBe('fake-new-pass');
    expect(await app.api.session.current()).not.toBeNull();
  });

  it('「以后再说」记在这台设备上：一天内再打开不问', async () => {
    await oldInstance();
    const dialog = await screen.findByRole('dialog', { name: '给 @you 设一个密码' });
    fireEvent.click(within(dialog).getByRole('button', { name: '以后再说' }));
    expect(screen.queryByRole('dialog', { name: /设一个密码/ })).toBeNull();
    expect(window.localStorage.getItem(PASSWORD_LATER_KEY)).not.toBeNull();
    cleanup();
    let state: ReturnType<typeof vi.fn> | null = null;
    await renderApp({ setup: (fake) => {
      fake.control.account.seedNoPassword();
      state = vi.spyOn(fake.api.account, 'state') as unknown as ReturnType<typeof vi.fn>;
    } });
    await screen.findByRole('heading', { name: HOME_HEADING });
    expect(screen.queryByRole('dialog', { name: /设一个密码/ })).toBeNull();
    expect(state).not.toHaveBeenCalled();
  });

  it('一天以前说过「以后再说」：这次打开再问', async () => {
    window.localStorage.setItem(PASSWORD_LATER_KEY, new Date(Date.now() - 25 * 3600_000).toISOString());
    await oldInstance();
    expect(await screen.findByRole('dialog', { name: '给 @you 设一个密码' })).toBeTruthy();
  });

  it('Esc 等于以后再说', async () => {
    await oldInstance();
    const dialog = await screen.findByRole('dialog', { name: '给 @you 设一个密码' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /设一个密码/ })).toBeNull();
  });

  it('已经设过密码：不问', async () => {
    await renderApp();
    await screen.findByRole('heading', { name: HOME_HEADING });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('dialog', { name: /设一个密码/ })).toBeNull();
  });
});
