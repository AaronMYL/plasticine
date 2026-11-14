// 设置 · AI「同时做几件事」（11-12 全量优化第 2 条；第13批起是「对话」分组里的一行）：默认自动、写着现在几件；选了数
// 马上存。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../helpers.tsx';

async function section(): Promise<HTMLElement> {
  const pane = await screen.findByRole('dialog', { name: '设置' });
  return within(pane).findByRole('region', { name: '对话' });
}

describe('同时做几件事', () => {
  it('默认自动，写着现在几件；选 5 件马上存，再选回自动', async () => {
    const app = await renderApp({ hash: '#/settings/ai' });
    const region = await section();
    const pick = async (name: string | RegExp): Promise<void> => {
      fireEvent.click(within(region).getByRole('button', { name: '同时做几件事' }));
      const menu = await screen.findByRole('menu', { name: '同时做几件事' });
      fireEvent.click(within(menu).getByRole('menuitemcheckbox', { name }));
    };
    const button = await within(region).findByRole('button', { name: '同时做几件事' });
    expect(button.textContent).toBe('自动（现在 3 件）');
    fireEvent.click(button);
    const menu = await screen.findByRole('menu', { name: '同时做几件事' });
    expect(within(menu).getAllByRole('menuitemcheckbox').map((item) => item.textContent))
      .toEqual(['自动（现在 3 件）', '1 件', '2 件', '3 件', '4 件', '5 件', '6 件', '7 件', '8 件']);
    fireEvent.keyDown(menu, { key: 'Escape' });
    const save = vi.spyOn(app.api.account, 'setWorkLimit');
    await pick('5 件');
    await waitFor(() => expect(within(region).getByRole('button', { name: '同时做几件事' }).textContent)
      .toBe('5 件'));
    expect(save).toHaveBeenCalledWith(5);
    await pick(/^自动/);
    await waitFor(() => expect(save).toHaveBeenLastCalledWith('auto'));
  });
});
