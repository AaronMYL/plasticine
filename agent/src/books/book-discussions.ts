import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { BookDiscussion } from '../../shared/api/index.ts';
import { BOOK_QUOTE_META_HEAD, QUOTE_HEAD, bookQuoteMetadata } from '../../shared/conversation-quotes.ts';
import { lineRef, MAIN_LINE_ID, type StateService } from '../state/index.ts';

const DISCUSSION_LIMIT = 50;
const ANSWER_PREVIEW_CHARS = 160;
const ANSWER_LOOKAHEAD = 40;

interface QuotedPart {
  label: string;
  chapter: number;
  start: number;
}

function quotedPart(lines: readonly string[], bookId: string): QuotedPart | null {
  for (const [index, line] of lines.entries()) {
    const metadata = bookQuoteMetadata(line);
    const head = lines[index - 1];
    if (metadata !== null && metadata.bookId === bookId && head?.startsWith(QUOTE_HEAD) === true) {
      return { label: head.slice(QUOTE_HEAD.length), chapter: metadata.chapter, start: metadata.start };
    }
  }
  return null;
}

function question(lines: readonly string[]): string {
  return lines.filter((line) => !line.startsWith('>')).join('\n').trim();
}

function answerAfter(state: Pick<StateService, 'lineMessages'>, seq: number): { seq: number; text: string } | null {
  for (const row of state.lineMessages.after(MAIN_LINE_ID, seq).slice(0, ANSWER_LOOKAHEAD)) {
    if (row.role === 'user') {
      return null;
    }
    const message = row.message as AssistantMessage;
    if (row.role === 'assistant' && message.stopReason !== 'toolUse') {
      const text = message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('').trim();
      return { seq: row.seq, text };
    }
  }
  return null;
}

export function bookDiscussions(state: Pick<StateService, 'lineMessages'>, bookId: string): BookDiscussion[] {
  const needle = `${BOOK_QUOTE_META_HEAD}{"bookId":${JSON.stringify(bookId)}`;
  const discussions: BookDiscussion[] = [];
  for (const row of state.lineMessages.searchSaid(MAIN_LINE_ID, needle, DISCUSSION_LIMIT)) {
    const said = state.lineMessages.said(lineRef(MAIN_LINE_ID, row.seq));
    if (said === undefined) {
      continue;
    }
    const lines = said.text.split('\n');
    const part = quotedPart(lines, bookId);
    if (part === null) {
      continue;
    }
    const answer = answerAfter(state, row.seq);
    discussions.push({
      messageId: said.ref,
      at: said.createdAt,
      question: question(lines),
      quoteLabel: part.label,
      chapter: part.chapter,
      start: part.start,
      answer: answer === null ? null : Array.from(answer.text).slice(0, ANSWER_PREVIEW_CHARS).join(''),
      answerMessageId: answer === null ? null : lineRef(MAIN_LINE_ID, answer.seq),
    });
  }
  return discussions;
}
