import type { Quote } from '../../api/types.ts';
import { quoteLimitMessage } from '../../api/shared.ts';
import type { ShellPrefs } from '../../state/shell-prefs.ts';
import { FOCUS_COMPOSER_EVENT } from '../lines/line-composer.tsx';

export interface QuotedRange {
  bookId: string;
  bookTitle: string;
  chapter: number;
  chapterTitle: string;
  start: number;
  end: number;
  text: string;
}

export function buildBookQuote(range: QuotedRange): Quote {
  const limit = quoteLimitMessage([{ text: range.text }]);
  if (limit !== null) {
    throw new Error(limit);
  }
  return {
    id: `book:${range.bookId}:${range.chapter}:${range.start}-${range.end}`,
    kind: 'book',
    sourceId: range.bookId,
    label: `《${range.bookTitle}》 ${range.chapterTitle}`,
    text: range.text,
    bookReference: { bookId: range.bookId, chapter: range.chapter, start: range.start, end: range.end,
      text: range.text },
  };
}

export function openConversation(shellPrefs: ShellPrefs, phone: boolean): void {
  if (phone) {
    shellPrefs.setPhoneChatOpen(true);
  } else {
    shellPrefs.setChatOpen(true);
  }
  requestAnimationFrame(() => window.dispatchEvent(new Event(FOCUS_COMPOSER_EVENT)));
}
