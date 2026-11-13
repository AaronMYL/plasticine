import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderApp } from '../../helpers.tsx';
import { createRequestId } from '../../../src/api/request-id.ts';
import { MAIN_LINE_ALIAS } from '../../../src/api/shared.ts';

it('对话框切目标保留独立草稿，引用跟随当前目标，主线整页保持主线', async () => {
  const app = await renderApp({ hash: '#/today' });
  const mate = await act(() => app.api.mates.create({ requestId: createRequestId(), name: '资料队友', avatar: 'cat',
    hue: 'sky', role: '检查资料', soul: '', purpose: null }));
  const expand = screen.queryByRole('button', { name: /展开对话框/ });
  if (expand !== null) fireEvent.click(expand);
  const dock = screen.getByRole('complementary', { name: '对话框' });
  fireEvent.change(within(dock).getByRole('textbox', { name: '问一句' }), { target: { value: '留在主线的草稿' } });
  fireEvent.click(within(dock).getByRole('button', { name: '切换对话对象' }));
  fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: '资料队友' }));
  await waitFor(() => expect(app.state.dockTargets.store.get().lineId).toBe(mate.lineId));
  expect((within(dock).getByRole('textbox', { name: '问一句' }) as HTMLTextAreaElement).value).toBe('');
  fireEvent.change(within(dock).getByRole('textbox', { name: '问一句' }), { target: { value: '留在队友的草稿' } });
  expect(app.state.conversationUi.store.get().draft).toBe('留在主线的草稿');
  fireEvent.click(within(dock).getByRole('button', { name: '切换对话对象' }));
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Plasticine 主线' }));
  expect(app.state.dockTargets.store.get().lineId).toBe(MAIN_LINE_ALIAS);
  expect((within(dock).getByRole('textbox', { name: '问一句' }) as HTMLTextAreaElement).value).toBe('留在主线的草稿');
  expect(app.state.conversations.forLine(mate.lineId).ui.store.get().draft).toBe('留在队友的草稿');
});
