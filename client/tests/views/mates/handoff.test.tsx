import { act, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderApp, NOW } from '../../helpers.tsx';
import { createRequestId } from '../../../src/api/request-id.ts';
import type { LineInputOrigin, LineMessageView } from '../../../src/api/shared.ts';

it.each([
  ['user', { kind: 'user' }, '你'],
  ['assistant', null, 'Plasticine'],
  ['user', null, '来源未记录'],
] as const)('交接按原始%s消息身份署名为%s', async (role, origin, author) => {
  const app = await renderApp({ hash: '#/plasticine/main' });
  const mate = await act(() => app.api.mates.create({ requestId: createRequestId(), name: '资料队友', avatar: 'fox',
    hue: 'sky', role: '检查资料', soul: '', purpose: null }));
  const message = (role: LineMessageView['role'], origin: LineInputOrigin | null) => ({
    role, origin, text: '请检查这份示例资料', thinking: null, thinkingMs: null, steps: [], toolCallId: null,
    tool: null, say: null, ok: null, summary: null, stopReason: null, childLineId: null, attachments: [], widgets: [],
    createdAt: NOW.toISOString(),
  });
  act(() => {
    const original = app.control.lines.record('line-main', message(role, origin));
    app.control.lines.put(app.control.lines.blank('handoff-job', 'background', '检查资料',
      { mateId: mate.id, parentLineId: 'line-main' }));
    app.control.lines.record('handoff-job', message('user',
      { kind: 'delegation', ref: `line:line-main:${original.seq}` }));
  });
  await waitFor(() => expect(document.querySelector('.mate-handoff')?.textContent)
    .toBe(`${author}→资料队友请检查这份示例资料`));
});
