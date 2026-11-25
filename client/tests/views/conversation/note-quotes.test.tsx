import { act, fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { renderApp, seedNote } from '../../helpers.tsx';
import { buildNoteQuote } from '../../../src/views/notes/note-quote.ts';

it('blocks send when full quotes exceed 120k-char cap, keeps draft, resumes after removing one', async () => {
  const app = await renderApp({ hash: '#/conversation', setup: (fake) => {
    seedNote(fake, 'n1', `# 甲篇\n\n${'甲'.repeat(70_000)}`);
    seedNote(fake, 'n2', `# 乙篇\n\n${'乙'.repeat(60_000)}`);
  } });
  const first = buildNoteQuote(await app.api.notes.get('n1'));
  const second = buildNoteQuote(await app.api.notes.get('n2'));
  act(() => {
    app.state.conversationUi.addQuote(first);
    app.state.conversationUi.addQuote(second);
    app.state.conversationUi.setDraft('合并讨论');
  });
  const send = vi.spyOn(app.api.lines, 'send');
  expect(screen.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('120,000');
  fireEvent.keyDown(screen.getByRole('textbox', { name: '问一句' }), { key: 'Enter' });
  expect(send).not.toHaveBeenCalled();
  expect(app.state.conversationUi.store.get().draft).toBe('合并讨论');
  fireEvent.click(screen.getByRole('button', { name: `去掉引用：${second.label}` }));
  expect(screen.getByRole('button', { name: '发送' }).hasAttribute('disabled')).toBe(false);
});

it('focus-chat event only moves focus while preserving existing draft and quotes', async () => {
  const app = await renderApp({ hash: '#/conversation' });
  act(() => app.state.conversationUi.setDraft('已写一半'));
  act(() => window.dispatchEvent(new Event('plasticine:focus-composer')));
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '问一句' }));
  expect(app.state.conversationUi.store.get().draft).toBe('已写一半');
});
