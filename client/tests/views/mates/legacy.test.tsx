import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderApp } from '../../helpers.tsx';
import { createRequestId } from '../../../src/api/request-id.ts';

it('旧对话先展示归纳提案，明确确认后才转成队友并保留原线', async () => {
  const app = await renderApp({ hash: '#/plasticine' });
  const old = await act(() => app.api.lines.openSide({ requestId: createRequestId(), title: '资料整理讨论' }));
  fireEvent.click(await screen.findByRole('button', { name: '整理原来的对话' }));
  const panel = screen.getByRole('dialog', { name: '整理原来的对话' });
  fireEvent.click(within(panel).getByRole('button', { name: '资料整理讨论' }));
  const confirm = await within(panel).findByRole('button', { name: '确认转成队友' });
  expect((await app.api.mates.list()).mates).toHaveLength(0);
  fireEvent.click(confirm);
  await waitFor(async () => expect((await app.api.mates.list()).mates).toHaveLength(1));
  expect((await app.api.mates.list()).mates[0]?.lineId).toBe(old.line.id);
  expect((await app.api.mates.list()).legacyChats).toHaveLength(0);
});
