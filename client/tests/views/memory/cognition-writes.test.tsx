import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderApp, settle } from '../../helpers.tsx';

it.each([
  ['按提议生效', 'adopt', '改后', 'active'],
  ['按原文生效', 'confirm', '原文', 'active'],
  ['不采纳', 'reject', '原文', 'under_review'],
])('提议按钮 %s 由本人会话确认，显示改前改后', async (label, decision, text, state) => {
  const app = await renderApp({ hash: '#/memory/agreements/a', setup: (fake) => {
    fake.control.agreements.seed({ id: 'a', text: '原文', state: 'under_review', proposedDiff: '- 原文\n+ 改后' });
  } });
  const signed = vi.spyOn(app.api.signed, 'send');
  const row = await within(screen.getByRole('main')).findByRole('listitem', { name: '原文' });
  expect(within(row).getByText('改前')).toBeDefined();
  expect(within(row).getByText('改后', { selector: 'dt' })).toBeDefined();
  const button = within(row).getByRole('button', { name: label });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(app.control.agreements.find('a')).toMatchObject({ text, state, proposedDiff: null }));
  expect(signed).toHaveBeenCalledTimes(1);
  expect(JSON.parse(signed.mock.calls[0]![0].bodyText).decision).toBe(decision);
});

it.each(['active', 'under_review'] as const)('约定状态 %s 的改和撤在同一个行尾 ⋯ 里，编辑保存一律由本人会话确认', async (state) => {
  const app = await renderApp({ hash: '#/memory/agreements/a', setup: (fake) => {
    fake.control.agreements.seed({ id: 'a', text: '原文', scope: '原范围', state });
  } });
  const signed = vi.spyOn(app.api.signed, 'send');
  const row = await within(screen.getByRole('main')).findByRole('listitem', { name: '原文' });
  fireEvent.click(within(row).getByRole('button', { name: /的更多操作$/ }));
  const menu = screen.getByRole('menu');
  expect(within(menu).getByRole('menuitem', { name: '撤回' })).toBeTruthy();
  fireEvent.click(within(menu).getByRole('menuitem', { name: '修改' }));
  const editor = within(row).getByRole('group', { name: '改约定' });
  fireEvent.change(within(editor).getByLabelText('正文'), { target: { value: '改好的正文' } });
  fireEvent.change(within(editor).getByLabelText('适用范围'), { target: { value: '新范围' } });
  const save = within(editor).getByRole('button', { name: '保存' });
  await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false));
  fireEvent.click(save);
  await waitFor(() => expect(app.control.agreements.find('a')).toMatchObject({ text: '改好的正文', scope: '新范围' }));
  expect(signed).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(app.state.editDrafts.store.get().size).toBe(0));
});
