import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QuoteSelection } from '../../src/primitives/message/quote-selection.tsx';

afterEach(() => window.getSelection()?.removeAllRanges());

it('keyboard selection supports quoting and clears stale actions when deselected', () => {
  const quote = vi.fn();
  render(<QuoteSelection onQuote={quote}><p tabIndex={0}>正文的一部分</p></QuoteSelection>);
  const text = screen.getByText('正文的一部分');
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.setStart(text.firstChild!, 2);
  range.setEnd(text.firstChild!, 6);
  selection.addRange(range);
  fireEvent.keyUp(text, { key: 'ArrowRight', shiftKey: true });
  fireEvent.click(screen.getByRole('button', { name: '引用到对话' }));
  expect(quote).toHaveBeenCalledWith('的一部分');
  selection.addRange(range);
  fireEvent.keyUp(text, { key: 'ArrowRight', shiftKey: true });
  selection.removeAllRanges();
  fireEvent(document, new Event('selectionchange'));
  expect(screen.queryByRole('button', { name: '引用到对话' })).toBeNull();
});

it('mobile touch-end followed by native selection can quote a single Chinese character', () => {
  const quote = vi.fn();
  render(<QuoteSelection onQuote={quote}><p>文字</p></QuoteSelection>);
  const text = screen.getByText('文字');
  fireEvent.touchEnd(text);
  const range = document.createRange();
  range.setStart(text.firstChild!, 0);
  range.setEnd(text.firstChild!, 1);
  window.getSelection()!.addRange(range);
  fireEvent(document, new Event('selectionchange'));
  fireEvent.click(screen.getByRole('button', { name: '引用到对话' }));
  expect(quote).toHaveBeenCalledWith('文');
});
