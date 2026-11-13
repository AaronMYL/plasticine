import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createRequestId } from '../../../src/api/request-id.ts';
import { renderApp } from '../../helpers.tsx';

it('主线输入 @ 能选择实际队友，用名字插入草稿', async () => {
  const app = await renderApp({ hash: '#/plasticine/main' });
  await act(() => app.api.mates.create({ requestId: createRequestId(), name: '校对队友', avatar: 'penguin',
    hue: 'teal', role: '检查文字', soul: '', purpose: null }));
  const input = screen.getByRole('textbox', { name: '问一句' });
  fireEvent.change(input, { target: { value: '@校' } });
  const option = await screen.findByRole('option', { name: /校对队友/ });
  fireEvent.click(option);
  await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe('@校对队友 '));
  expect(screen.queryByRole('listbox', { name: '选择队友' })).toBeNull();
});
