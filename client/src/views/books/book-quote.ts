// 书里划的一段引用到对话：引用片带书、章和位置（发出去是 kind = book，服务端按位置重取原文）。
// 放进输入框以后和笔记一样把对话打开：电脑上展开对话栏，手机上推出对话抽屉，焦点给输入框。

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

/** 引用片放好之后打开对话：和笔记「引用到对话」同一套（note-editor.tsx）。 */
export function openConversation(shellPrefs: ShellPrefs, phone: boolean): void {
  if (phone) {
    shellPrefs.setPhoneChatOpen(true);
  } else {
    shellPrefs.setChatOpen(true);
  }
  requestAnimationFrame(() => window.dispatchEvent(new Event(FOCUS_COMPOSER_EVENT)));
}
