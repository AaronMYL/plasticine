import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { LineInputOrigin, LineMessageView } from '../../../src/api/shared.ts';
import { MAIN_LINE_ID } from '../../../src/api/fake/fake-lines.ts';
import { renderApp } from '../../helpers.tsx';

function message(role: LineMessageView['role'], text: string): Omit<LineMessageView, 'lineId' | 'seq'> {
  return { role, text, origin: null, thinking: null, thinkingMs: null, steps: [], toolCallId: null, tool: null,
    say: null,
    ok: null, summary: null, stopReason: null, childLineId: null, attachments: [], widgets: [],
    createdAt: '2026-11-07T00:00:00.000Z' };
}

async function open() {
  const app = await renderApp({ hash: '#/messages/plasticine', setup({ control }) {
    const records: [LineMessageView['role'], string, LineInputOrigin | undefined][] = [
      ['user', '愿意长期读书。', { kind: 'user', userText: '愿意长期读书。' }],
      ['user', '先阅读两份文献。', { kind: 'delegation' }],
      ['assistant', '线索触发注意力。', undefined],
      ['lineReport', '核实后的摘要。', undefined],
    ];
    for (const [role, text, origin] of records) control.lines.record(MAIN_LINE_ID, message(role, text), origin);
  } });
  await screen.findByRole('textbox', { name: '问一句' });
  return app;
}

function select(element: HTMLElement, from: number, to: number): void {
  const text = element.firstChild!;
  const range = document.createRange();
  range.setStart(text, from);
  range.setEnd(text, to);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.mouseUp(element);
  fireEvent(document, new Event('selectionchange'));
}

afterEach(() => window.getSelection()?.removeAllRanges());

describe('新对话的来源和选文引用', () => {
  it('工具产生的小部件在原步骤之后、后续答复之前出现，正文多段均保留', async () => {
    await renderApp({ hash: '#/messages/plasticine', setup({ control }) {
      control.lines.record(MAIN_LINE_ID, { ...message('assistant', '先看这张表。'), stopReason: 'toolUse',
        steps: [{ toolCallId: 'table', tool: 'show_widgets', say: '整理对照表' }] });
      control.lines.record(MAIN_LINE_ID, { ...message('toolResult', '表已放好'), toolCallId: 'table',
        tool: 'show_widgets', ok: true, widgets: [{ kind: 'table', id: 'table-one',
          columns: [{ key: 'source', label: '来源' }], rows: [{ source: '已核对' }] }] });
      control.lines.record(MAIN_LINE_ID, message('assistant', '结果都在表里。'));
    } });
    const table = await screen.findByRole('table');
    expect(screen.getByText('先看这张表。').compareDocumentPosition(table)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(table.compareDocumentPosition(screen.getByText('结果都在表里。'))
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('委派为折叠记录，只有本人使用气泡；搜索署名一致', async () => {
    await open();
    expect((await screen.findByText('愿意长期读书。')).closest('.msg-user')).not.toBeNull();
    const delegated = await screen.findByText('先阅读两份文献。');
    expect(delegated.closest('.msg-user')).toBeNull();
    expect(delegated.closest('details')).not.toBeNull();
    expect(delegated.closest('details')?.open).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '在记录里找' }));
    fireEvent.change(screen.getByRole('textbox', { name: '在记录里找' }), { target: { value: '两份文献' } });
    const hit = screen.getByRole('button', { name: /先阅读两份文献/ });
    expect(hit.querySelector('.line-search-who')?.textContent).toBe('Plasticine');
  });

  it('助手选文放进引用片，保留草稿并将焦点带回输入框；发送后引用原文仍完整', async () => {
    const app = await open();
    const input = screen.getByRole('textbox', { name: '问一句' });
    fireEvent.change(input, { target: { value: '继续解释这一句' } });
    select(await screen.findByText('线索触发注意力。'), 0, 4);
    fireEvent.click(screen.getByRole('button', { name: '引用到对话' }));
    expect(app.state.conversationUi.store.get().draft).toBe('继续解释这一句');
    expect(app.state.conversationUi.store.get().quotes[0]).toMatchObject({ kind: 'message', text: '线索触发' });
    expect(document.activeElement).toBe(input);
    const quotes = screen.getByRole('region', { name: '对话' }).querySelector('.line-quotes')!;
    expect(within(quotes as HTMLElement).getByRole('button', { name: /去掉引用/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(async () => {
      const saved = (await app.api.lines.read('main', {})).messages.find((item) => item.text
        .endsWith('继续解释这一句'));
      expect(saved?.text).toContain('线索触发');
      expect(saved?.text).toContain('〔引用〕');
    });
  });

  it('本人和后台结果的文字均可引用，引用可移除，已写草稿不被覆盖', async () => {
    const app = await open();
    act(() => app.state.conversationUi.setDraft('原草稿'));
    select(await screen.findByText('愿意长期读书。'), 2, 6);
    fireEvent.click(screen.getByRole('button', { name: '引用到对话' }));
    select(await screen.findByText('核实后的摘要。'), 0, 3);
    fireEvent.click(screen.getByRole('button', { name: '引用到对话' }));
    expect(app.state.conversationUi.store.get().quotes.map((quote) => quote.text)).toEqual(['长期读书', '核实后']);
    fireEvent.click(screen.getAllByRole('button', { name: /去掉引用/ })[0]!);
    expect(app.state.conversationUi.store.get().quotes.map((quote) => quote.text)).toEqual(['核实后']);
    expect(app.state.conversationUi.store.get().draft).toBe('原草稿');
  });
});
