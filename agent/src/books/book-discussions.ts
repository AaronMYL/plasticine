// 这本书的「讨论」（用户 2026-11-01 定：在主对话里聊，按书归档）：主对话里带着这本书引用的、他说的那几条，加上紧接着
// 的那段 Plasticine 回答。不另存一份，每次从主线的消息里按引用元数据找出来（2026-11-05 主对话成了新内核的主线）。

import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { BookDiscussion } from '../../shared/api/index.ts';
import { BOOK_QUOTE_META_HEAD, QUOTE_HEAD, bookQuoteMetadata } from '../../shared/conversation-quotes.ts';
import { lineRef, MAIN_LINE_ID, type StateService } from '../state/index.ts';

// 最多列 50 轮；更早的在对话里搜得到。
const DISCUSSION_LIMIT = 50;
// 回答只带开头一段，点「回到对话」看全文。
const ANSWER_PREVIEW_CHARS = 160;
// 一轮之后往后看几条找 Plasticine 的回答（中间夹着工具调用和结果）。
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

/** 一轮的回答：这条之后第一条不是工具调用中途的助手消息（它的文字部分）。 */
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
