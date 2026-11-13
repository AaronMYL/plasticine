import { act, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { renderApp, NOW } from '../../helpers.tsx';
import { createRequestId } from '../../../src/api/request-id.ts';

it('队友的回报根据后台线身份署名并保留全文', async () => {
  const app = await renderApp({ hash: '#/plasticine/main' });
  const mate = await act(() => app.api.mates.create({ requestId: createRequestId(), name: '来源核对员', avatar: 'koala',
    hue: 'teal', role: '核对原始来源', soul: '', purpose: null }));
  const text = '这是一份完整的核对结果。'.repeat(30) + '最后的结论也保留。';
  act(() => {
    app.control.lines.put(app.control.lines.blank('mate-report-job', 'background', '核对资料',
      { mateId: mate.id, parentLineId: 'line-main' }));
    app.control.lines.record('line-main', { role: 'lineReport', text, thinking: null, thinkingMs: null, steps: [],
      toolCallId: null, tool: null, say: null, ok: null, summary: null, stopReason: null,
      childLineId: 'mate-report-job', attachments: [], widgets: [], createdAt: NOW.toISOString() });
  });
  expect(await screen.findByText(text)).toBeTruthy();
  await waitFor(() => expect(document.querySelector('.mate-report-author')?.textContent).toContain('来源核对员'));
});
