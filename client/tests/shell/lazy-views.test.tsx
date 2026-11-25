import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { lazyView } from '../../src/shell/lazy-view.ts';
import { renderApp } from '../helpers.tsx';

describe('route-based lazy loading', () => {
  it('tools page lazily loads ledger content into main pane', async () => {
    await renderApp({ width: 1440 });
    act(() => { window.location.hash = '#/tools/money'; });
    const page = within(screen.getByRole('main'));
    expect(await page.findByRole('heading', { level: 1, name: '记账' })).toBeTruthy();
    await waitFor(() => expect(page.queryByText('正在读…')).toBeNull());
  });

  it('missing named export throws a clear error', async () => {
    const Missing = lazyView(() => Promise.resolve({ Other: () => null }), 'Nope');
    const payload = Missing as unknown as { _payload: { _result: () => Promise<unknown> } };
    await expect(payload._payload._result()).rejects.toThrow('没有「Nope」这个组件');
  });
});
