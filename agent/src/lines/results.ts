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

export function lineResult(state: ResultState, lineId: string): string | null {
  const row = state.lineMessages.last(lineId, 'assistant');
  return row === undefined ? null : lineResultAt(state, row).text;
}

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
