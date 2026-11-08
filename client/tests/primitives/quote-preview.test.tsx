import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { QuotePreview } from '../../src/primitives/message/quote-preview.tsx';
import { UserMessage } from '../../src/primitives/message/user-message.tsx';

it('引用片显示全文与真实字符数，展开查看完整快照，移除也有清晰名称', () => {
  const text = `${'字'.repeat(700)}😀最后一句`;
  const remove = vi.fn();
  render(<QuotePreview quote={{ id: 'q', label: '长笔记', text,
    noteReference: { noteId: 'n', version: 3, scope: 'full' } }} onRemove={remove} />);
  const summary = screen.getByLabelText('查看引用内容：长笔记，全文，705 字');
  fireEvent.click(summary);
  expect(summary.closest('details')?.open).toBe(true);
  expect(screen.getByLabelText('实际引用内容').textContent).toBe(text);
  expect(screen.getByText(/引用笔记版本 3 的全文/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '去掉引用：长笔记' }));
  expect(remove).toHaveBeenCalledOnce();
});

it('旧引用明确显示摘要范围，不能被误认成全文', () => {
  render(<QuotePreview quote={{ id: 'old', label: '旧笔记', text: '旧有内容' }} />);
  fireEvent.click(screen.getByLabelText('查看引用内容：旧笔记，摘要，4 字'));
  expect(screen.getByText(/未记录全文范围或笔记版本/)).toBeTruthy();
  expect(screen.getByLabelText('实际引用内容').textContent).toBe('旧有内容');
});

it('书引用片：标签写短（《书》卷一），「回到原文」跳到阅读页那一句', () => {
  window.location.hash = '#/conversation';
  const bookReference = { bookId: 'book_fusheng', chapter: 0, start: 12, end: 19, text: '事如春梦了无痕' };
  render(<QuotePreview quote={{ id: 'b', label: '《浮生六记》 卷一　闺房记乐', text: '事如春梦了无痕', bookReference }} />);
  expect(screen.getByLabelText('查看引用内容：《浮生六记》卷一，选段，7 字')).toBeTruthy();
  const link = screen.getByRole('link', { name: '回到原文' });
  expect(link.getAttribute('href')).toBe('#/books/book_fusheng/0/12');
  fireEvent.click(link);
  expect(window.location.hash).toBe('#/books/book_fusheng/0/12');
});

it('引用了书的那条消息下面写「归入 · 《书名》 · 讨论」；没引用书的不写', () => {
  const bookReference = { bookId: 'b', chapter: 0, start: 0, end: 2, text: '原文' };
  const { rerender } = render(<UserMessage text="他想说什么？" state="sent"
    quotes={[{ id: 'q', label: '《浮生六记》 卷一', text: '原文', bookReference }]} />);
  expect(screen.getByText('归入 · 《浮生六记》 · 讨论')).toBeTruthy();
  rerender(<UserMessage text="普通的一句" state="sent" quotes={[]} />);
  expect(screen.queryByText(/归入/)).toBeNull();
});
