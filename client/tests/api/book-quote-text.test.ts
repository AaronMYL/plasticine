import { describe, expect, it } from 'vitest';
import { lineQuoteInputs, splitQuotes } from '../../src/api/quote-text.ts';
import { withResolvedQuotes } from '../../src/api/shared.ts';
import type { Quote } from '../../src/api/types.ts';

const bookReference = { bookId: 'book_fusheng', chapter: 0, start: 12, end: 19, text: '事如春梦了无痕' };

function bookQuote(): Quote {
  return { id: 'book:book_fusheng:0:12-19', kind: 'book', sourceId: 'book_fusheng',
    label: '《浮生六记》 卷一　闺房记乐', text: bookReference.text, bookReference };
}

describe('书里划的一段引用到对话', () => {
  it('发出去时是 kind = book，带书、章和位置，不把原文拼进正文', () => {
    expect(lineQuoteInputs([bookQuote()])).toEqual([{ kind: 'book', bookReference }]);
  });

  it('和普通文字引用一起发时保持顺序，文字引用仍是 kind = text', () => {
    const plain: Quote = { id: 'm', kind: 'message', sourceId: 'm1', label: '那句话', text: '原话' };
    expect(lineQuoteInputs([plain, bookQuote()])).toEqual([
      { kind: 'text', label: '那句话', text: '原话' },
      { kind: 'book', bookReference },
    ]);
  });

  it('服务端存下的书引用能拆回带 bookReference 的引用片，话照旧', () => {
    const content = withResolvedQuotes('他引它想说什么？',
      [{ label: '《浮生六记》 卷一　闺房记乐', text: bookReference.text, bookReference }]);
    expect(splitQuotes(content, 'm')).toEqual({
      text: '他引它想说什么？',
      quotes: [{ id: 'm_q0', label: '《浮生六记》 卷一　闺房记乐', text: '事如春梦了无痕', bookReference }],
    });
  });

  it('多行的书引用（含空行）也按行数和字数拆回来', () => {
    const reference = { ...bookReference, end: 30, text: '第一段\n\n第二段' };
    const content = withResolvedQuotes('', [{ label: '《书》', text: reference.text, bookReference: reference }]);
    expect(splitQuotes(content, 'x').quotes[0]?.bookReference).toEqual(reference);
  });
});
