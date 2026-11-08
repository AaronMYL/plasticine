// 设置 · AI ·「技能」：每行写 Plasticine 用过几次；装上的技能能删，删之前后果常显，点了才删。

import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../helpers.tsx';

describe('技能', () => {
  it('写用过几次；删要先确认，确认后目录里没了', async () => {
    const app = await renderApp({ hash: '#/settings/ai', setup: (fake) => {
      fake.control.m5b.skills.seed('整理研究笔记的方法', '# 方法');
    } });
    const rows = await screen.findByRole('list', { name: '技能目录' });
    const row = await within(rows).findByRole('listitem');
    expect(within(row).getByText('3 次')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: '删「research-notes」' }));
    const confirm = screen.getByRole('alertdialog', { name: '删「research-notes」' });
    expect(confirm.textContent).toContain('正在用它的线不受影响');
    fireEvent.click(within(confirm).getByRole('button', { name: '删' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect((await app.api.skills.list({})).total).toBe(0);
  });
});
