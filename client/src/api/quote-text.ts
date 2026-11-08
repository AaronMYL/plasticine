// 引用结构化发给线（POST /v2/lines/:id/messages 的 quotes）：笔记带精确版本和范围、书里划的一段带书、章和位置，
// 其余（消息、这一页）带标签和原文，由服务端核对后拼进存下的正文。引用不占这句话的 2 万字，整页也发得出去。
// 存下来的实际原文都可拆回引用片，查看范围无需再次读取可能已修改的笔记。
//
//   > 〔引用〕《读书摘记》
//   > 一段话
//
//   看看这段

import type { Quote, QuoteChip } from './types.ts';
import { QUOTE_HEAD, bookQuoteMetadata, noteQuoteMetadata, quoteCharacters, textQuoteBlock, withResolvedQuotes,
  type ConversationQuoteInput } from './shared.ts';

const QUOTE_LINE = '>';

/** 发出去的正文：引用块在前，用户的话在后。没有引用就是原话。 */
export function withQuotes(text: string, quotes: readonly Pick<QuoteChip, 'label' | 'text'>[]): string {
  if (quotes.length === 0) {
    return text;
  }
  const blocks = quotes.map(textQuoteBlock).join('\n\n');
  return text === '' ? blocks : `${blocks}\n\n${text}`;
}

/** 待发那一句在回执前怎么显示：和服务端拼好存下的正文同一个格式，回执到了按正文对上收掉。 */
export function lineMessageText(text: string, quotes: readonly Quote[]): string {
  return withResolvedQuotes(text, quotes);
}

function quoteInput(quote: Quote): ConversationQuoteInput {
  if (quote.bookReference !== undefined) {
    return { kind: 'book', bookReference: quote.bookReference };
  }
  if (quote.noteReference !== undefined) {
    return { kind: 'note', noteReference: quote.noteReference };
  }
  return { kind: 'text', label: quote.label, text: quote.text };
}

/** 发到线上的引用，保持顺序。 */
export function lineQuoteInputs(quotes: readonly Quote[]): ConversationQuoteInput[] {
  return quotes.map(quoteInput);
}

function unquote(line: string): string {
  return line.startsWith(`${QUOTE_LINE} `) ? line.slice(QUOTE_LINE.length + 1) : line.slice(QUOTE_LINE.length);
}

/** withQuotes 的反过来：从存下的正文里拆出引用片和用户的话。不是这个格式的正文原样当用户的话。 */
export function splitQuotes(content: string, idPrefix: string): { quotes: QuoteChip[]; text: string } {
  const lines = content.split('\n');
  const quotes: QuoteChip[] = [];
  let at = 0;
  while (lines[at]?.startsWith(QUOTE_HEAD) === true) {
    const label = (lines[at] ?? '').slice(QUOTE_HEAD.length);
    at += 1;
    const book = bookQuoteMetadata(lines[at]);
    if (book !== null) {
      const selected = lines.slice(at + 1, at + 1 + book.lines);
      const text = selected.map(unquote).join('\n');
      if (selected.length === book.lines && selected.every((line) => line.startsWith(QUOTE_LINE))
        && quoteCharacters(text) === book.characters) {
        const { bookId, chapter, start, end } = book;
        quotes.push({ id: `${idPrefix}_q${quotes.length}`, label, text,
          bookReference: { bookId, chapter, start, end, text } });
        at += book.lines + 1;
        if (lines[at] === '') { at += 1; }
        continue;
      }
    }
    const metadata = noteQuoteMetadata(lines[at]);
    if (metadata !== null) {
      const selected = lines.slice(at + 1, at + 1 + metadata.lines);
      const text = selected.map(unquote).join('\n');
      if (selected.length === metadata.lines && selected.every((line) => line.startsWith(QUOTE_LINE))
        && quoteCharacters(text) === metadata.characters) {
        const { noteId, version, scope } = metadata;
        quotes.push({ id: `${idPrefix}_q${quotes.length}`, label, text,
          noteReference: scope === 'full' ? { noteId, version, scope } : { noteId, version, scope, text } });
        at += metadata.lines + 1;
        if (lines[at] === '') { at += 1; }
        continue;
      }
    }
    const body: string[] = [];
    while (lines[at]?.startsWith(QUOTE_LINE) === true && lines[at]?.startsWith(QUOTE_HEAD) !== true) {
      body.push(unquote(lines[at] ?? ''));
      at += 1;
    }
    quotes.push({ id: `${idPrefix}_q${quotes.length}`, label, text: body.join('\n') });
    if (lines[at] === '') {
      at += 1;
    }
  }
  return { quotes, text: quotes.length === 0 ? content : lines.slice(at).join('\n') };
}
