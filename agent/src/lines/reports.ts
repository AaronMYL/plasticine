import type { LineRow, StateService } from '../state/index.ts';
import type { LineReportMessage, ReportOutcome } from './messages.ts';
import { lineResult } from './results.ts';
import { conclusionOf, unmetReason } from './verdict.ts';

const FALLBACK_CHARS = 280;

export function firstParagraph(text: string): string {
  const first = text.trim().split(/\n\s*\n/)[0]?.trim() ?? '';
  const chars = Array.from(first);
  return chars.length <= FALLBACK_CHARS ? first : `${chars.slice(0, FALLBACK_CHARS).join('')}…`;
}

export type ReportState = Pick<StateService, 'lineMessages'>;

export function lineReport(state: ReportState, line: LineRow, outcome: ReportOutcome, at: Date, notice?: string)
  : LineReportMessage {
  const conclusion = line.mateId == null
    ? conclusionOf(state, line) ?? firstParagraph(lineResult(state, line.id) ?? '')
    : lineResult(state, line.id) ?? conclusionOf(state, line) ?? '';
  let text = notice ?? conclusion;
  if (notice === undefined && outcome === 'failed') {
    text = `${line.failure ?? '没做完'}${conclusion === '' ? '' : `\n\n${conclusion}`}`;
  }
  const unmet = outcome === 'done' ? unmetReason(state, line) : null;
  return { role: 'lineReport', lineId: line.id, title: line.title, outcome,
    text: text === '' ? 'Plasticine 没有留下结果。' : text,
    timestamp: at.getTime(), ...(unmet === null ? {} : { unmet }) };
}

export function pauseNotice(until: Date, timeZone: string): string {
  const at = until.toLocaleString('zh-CN', { timeZone, month: 'numeric', day: 'numeric', hour: '2-digit',
    minute: '2-digit', hour12: false });
  return `模型额度用完了，${at} 后接着做。`;
}
