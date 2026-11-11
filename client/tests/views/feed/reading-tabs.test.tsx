// 手机阅读页头下面的分段：信息流和图书馆来回切；电脑不画（电脑在第二栏切）。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp, settle } from '../../helpers.tsx';

describe('阅读分段（手机）', () => {
  it('信息流和图书馆都叫「阅读」，分段来回切', async () => {
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

  it('电脑上不画分段', async () => {
    await renderApp({ hash: '#/feed' });
    await settle();
    expect(screen.queryByRole('group', { name: '阅读' })).toBeNull();
  });
});
