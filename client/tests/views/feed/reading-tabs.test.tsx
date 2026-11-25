import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, settle } from '../../helpers.tsx';

describe('Reading segmented control (mobile)', () => {
  it('Feed and Library share Reading heading and switch via segmented control', async () => {
    await renderApp({ hash: '#/feed', width: 390 });
    await settle();
    const tabs = screen.getByRole('group', { name: '阅读' });
    expect(within(tabs).getByRole('button', { name: '信息流' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(tabs).getByRole('button', { name: '图书馆' }));
    await waitFor(() => expect(window.location.hash).toBe('#/books'));
    await settle();
    const again = screen.getByRole('group', { name: '阅读' });
    expect(within(again).getByRole('button', { name: '图书馆' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('desktop omits Reading segmented control', async () => {
    await renderApp({ hash: '#/feed' });
    await settle();
    expect(screen.queryByRole('group', { name: '阅读' })).toBeNull();
  });
});
