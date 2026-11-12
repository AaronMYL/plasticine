// 设置 · AI「同时做几件事」（11-12 全量优化第 2 条）：默认自动、写着现在几件；选了数马上存。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../helpers.tsx';

async function section(): Promise<HTMLElement> {
  const pane = await screen.findByRole('dialog', { name: '设置' });
  return within(pane).findByRole('region', { name: '同时做几件事' });
}

describe('同时做几件事', () => {
  it('默认自动，写着现在几件；选 5 件马上存，再选回自动', async () => {
    const app = await renderApp({ hash: '#/settings/ai' });
    const region = await section();
    const select = await within(region).findByRole<HTMLSelectElement>('combobox', { name: '同时做几件事' });
    expect(select.value).toBe('auto');
    expect(select.selectedOptions[0]?.textContent).toBe('自动（现在 3 件）');
    expect([...select.options].map((option) => option.value)).toEqual(['auto', '1', '2', '3', '4', '5', '6', '7', '8']);
    const save = vi.spyOn(app.api.account, 'setWorkLimit');
    fireEvent.change(select, { target: { value: '5' } });
    await waitFor(() => expect(select.value).toBe('5'));
    expect(save).toHaveBeenCalledWith(5);
    fireEvent.change(select, { target: { value: 'auto' } });
    await waitFor(() => expect(select.value).toBe('auto'));
    expect(save).toHaveBeenLastCalledWith('auto');
  });
});
