import { screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { HOME_HEADING, renderApp } from '../helpers.tsx';

it('internal system session can enter the app', async () => {
  await renderApp({ setup(fake) {
    const current = fake.api.session.current.bind(fake.api.session);
    vi.spyOn(fake.api.session, 'current').mockImplementation(async () => {
      const session = await current();
      return session === null ? null : { ...session, actor: 'system' };
    });
  } });
  expect(screen.getByRole('heading', { name: HOME_HEADING })).toBeTruthy();
});
