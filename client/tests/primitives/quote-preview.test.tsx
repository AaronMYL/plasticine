import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { QuotePreview } from '../../src/primitives/message/quote-preview.tsx';
import { UserMessage } from '../../src/primitives/message/user-message.tsx';
import { parseHash, routeHash } from '../../src/shell/routes.ts';

it('space quote keeps excerpt and links back to exact version and paragraph', () => {
  const quote = { id: 's', kind: 'space' as const, label: '来信 · 一封来信 · 第 2 段', text: '保留下来的原文',
    spaceReference: { spaceId: 'sp old', version: 3, anchor: { sectionId: 'part', paragraph: 2,
      text: '保留下来的原文' } } };
  render(<QuotePreview quote={quote} />);
  expect(screen.getByText(quote.text)).toBeTruthy();
  const link = screen.getByRole('link', { name: /来信 · 一封来信 · 第 2 段/ });
  expect(link.getAttribute('href')).toBe('#/books/space/sp%20old/3/2');
  const route = parseHash(link.getAttribute('href')!);
  expect(route.spacePosition).toEqual({ version: 3, paragraph: 2 });
  expect(routeHash(route)).toBe(link.getAttribute('href'));
  expect(parseHash('#/books/space/sp/0/-1').spacePosition).toBeUndefined();
});

it('quote chip shows full text, real char count, expandable snapshot, and accessible remove label', () => {
  const text = `${'字'.repeat(700)}😀最后一句`;
  const remove = vi.fn();
  render(<QuotePreview quote={{ id: 'q', label: '长笔记', text,
    noteReference: { noteId: 'n', version: 3, scope: 'full' } }} onRemove={remove} />);
  const summary = screen.getByLabelText('查看引用内容：长笔记，全文，705 字');
  fireEvent.click(summary);
  expect(summary.closest('details')?.open).toBe(true);
  expect(screen.getByLabelText('实际引用内容').textContent).toBe(text);
  expect(screen.getByText('第 3 版 · 全文')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '去掉引用：长笔记' }));
  expect(remove).toHaveBeenCalledOnce();
});

it('legacy quote clearly labels excerpt range so it is not mistaken for full text', () => {
  render(<QuotePreview quote={{ id: 'old', label: '旧笔记', text: '旧有内容' }} />);
  fireEvent.click(screen.getByLabelText('查看引用内容：旧笔记，摘要，4 字'));
  expect(screen.getByText('摘要')).toBeTruthy();
  expect(screen.getByLabelText('实际引用内容').textContent).toBe('旧有内容');
});

it('book quote chip uses short label and Back to Source jumps to reader sentence', () => {
  window.location.hash = '#/conversation';
  const bookReference = { bookId: 'book_fusheng', chapter: 0, start: 12, end: 19, text: '事如春梦了无痕' };
  render(<QuotePreview quote={{ id: 'b', label: '《浮生六记》 卷一　闺房记乐', text: '事如春梦了无痕', bookReference }} />);
  expect(screen.getByLabelText('查看引用内容：《浮生六记》卷一，选段，7 字')).toBeTruthy();
  const link = screen.getByRole('link', { name: '回到原文' });
  expect(link.getAttribute('href')).toBe('#/books/book_fusheng/0/12');
  fireEvent.click(link);
  expect(window.location.hash).toBe('#/books/book_fusheng/0/12');
});

it('message quoting a book shows book discussion attribution; others omit it', () => {
  const bookReference = { bookId: 'b', chapter: 0, start: 0, end: 2, text: '原文' };
  const { rerender } = render(<UserMessage text="他想说什么？" state="sent"
    quotes={[{ id: 'q', label: '《浮生六记》 卷一', text: '原文', bookReference }]} />);
  expect(screen.getByText('归入 · 《浮生六记》 · 讨论')).toBeTruthy();
  rerender(<UserMessage text="普通的一句" state="sent" quotes={[]} />);
  expect(screen.queryByText(/归入/)).toBeNull();
});
