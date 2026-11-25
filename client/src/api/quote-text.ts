import type { Quote, QuoteChip } from './types.ts';
import { QUOTE_HEAD, bookQuoteMetadata, noteQuoteMetadata, quoteCharacters, textQuoteBlock, withResolvedQuotes,
  spaceQuoteMetadata, type ConversationQuoteInput } from './shared.ts';

const QUOTE_LINE = '>';

export function withQuotes(text: string, quotes: readonly Pick<QuoteChip, 'label' | 'text'>[]): string {
  if (quotes.length === 0) {
    return text;
  }
  const blocks = quotes.map(textQuoteBlock).join('\n\n');
  return text === '' ? blocks : `${blocks}\n\n${text}`;
}

export function lineMessageText(text: string, quotes: readonly Quote[]): string {
  return withResolvedQuotes(text, quotes);
}

function quoteInput(quote: Quote): ConversationQuoteInput {
  if (quote.spaceReference !== undefined) { return { kind: 'space', spaceReference: quote.spaceReference }; }
  if (quote.bookReference !== undefined) {
    return { kind: 'book', bookReference: quote.bookReference };
  }
  if (quote.noteReference !== undefined) {
    return { kind: 'note', noteReference: quote.noteReference };
  }
  return { kind: 'text', label: quote.label, text: quote.text };
}

export function lineQuoteInputs(quotes: readonly Quote[]): ConversationQuoteInput[] {
  return quotes.map(quoteInput);
}

function unquote(line: string): string {
  return line.startsWith(`${QUOTE_LINE} `) ? line.slice(QUOTE_LINE.length + 1) : line.slice(QUOTE_LINE.length);
}

export function splitQuotes(content: string, idPrefix: string): { quotes: QuoteChip[]; text: string } {
  const lines = content.split('\n');
  const quotes: QuoteChip[] = [];
  let at = 0;
  while (lines[at]?.startsWith(QUOTE_HEAD) === true) {
    const label = (lines[at] ?? '').slice(QUOTE_HEAD.length);
    at += 1;
    const space = spaceQuoteMetadata(lines[at]);
    if (space !== null) {
      const selected = lines.slice(at + 1, at + 1 + space.lines);
      const text = selected.map(unquote).join('\n');
      if (selected.length === space.lines && selected.every((line) => line.startsWith(QUOTE_LINE))
        && quoteCharacters(text) === space.characters) {
        const { spaceId, version, sectionId, paragraph } = space;
        quotes.push({ id: `${idPrefix}_q${quotes.length}`, label, text,
          spaceReference: { spaceId, version, anchor: { sectionId, paragraph, text } } });
        at += space.lines + 1;
        if (lines[at] === '') { at += 1; }
        continue;
      }
    }
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
