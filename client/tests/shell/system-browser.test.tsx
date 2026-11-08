import { screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { HOME_HEADING, renderApp } from '../helpers.tsx';

it('内部系统会话可进入页面，但不会准备或登记个人确认钥匙', async () => {
  const registered = vi.fn();
  await renderApp({ setup(fake) {
    const current = fake.api.session.current.bind(fake.api.session);
    vi.spyOn(fake.api.session, 'current').mockImplementation(async () => {
      const session = await current();
      return session === null ? null : { ...session, actor: 'system' };
    });
    vi.spyOn(fake.api.deviceKeys, 'register').mockImplementation(registered);
  } });
  expect(screen.getByRole('heading', { name: HOME_HEADING })).toBeTruthy();
  expect(registered).not.toHaveBeenCalled();
});
