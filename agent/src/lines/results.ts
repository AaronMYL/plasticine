// 系统明确续写的几段是一份结果；按持久引用回到被截断的那段，不靠内容相似度猜，也不拼进返工前的旧稿。

import type { LineMessageRow, StateService } from '../state/index.ts';
import { contentText, isAssistant } from './messages.ts';

export type ResultState = Pick<StateService, 'lineMessages'>;

function previousPart(state: ResultState, row: LineMessageRow): LineMessageRow | undefined {
  const input = state.lineMessages.before(row.lineId, row.seq, 'user');
  const origin = input?.meta?.origin;
  const prefix = `line:${row.lineId}:`;
  if (input === undefined || origin?.kind !== 'system' || origin.ref?.startsWith(prefix) !== true) {
    return undefined;
  }
  const value = origin.ref.slice(prefix.length);
  if (!/^\d+$/.test(value)) {
    return undefined;
  }
  const seq = Number(value);
  if (!Number.isSafeInteger(seq) || seq < 1 || seq >= input.seq) {
    return undefined;
  }
  const previous = state.lineMessages.get(row.lineId, seq);
  return previous !== undefined && isAssistant(previous.message) && previous.message.stopReason === 'length'
    ? previous : undefined;
}

/** 最后一份回答或未写完的结果；每次只沿续写引用取上一段，压缩和重启都不会丢正文。 */
export function lineResult(state: ResultState, lineId: string): string | null {
  const row = state.lineMessages.last(lineId, 'assistant');
  return row === undefined ? null : lineResultAt(state, row).text;
}

/** 指定版本的完整正文及其最早片段；历史翻页跳过同一版的续写片段。 */
export function lineResultAt(state: ResultState, last: LineMessageRow): { text: string | null; firstSeq: number } {
  let row: LineMessageRow | undefined = last;
  let firstSeq = last.seq;
  const parts: string[] = [];
  while (row !== undefined && isAssistant(row.message)) {
    firstSeq = row.seq;
    parts.push(contentText(row.message.content));
    row = row.message.stopReason === 'stop' || row.message.stopReason === 'length' ? previousPart(state, row)
      : undefined;
  }
  const text = parts.reverse().join('').trim();
  return { text: text === '' ? null : text, firstSeq };
}
