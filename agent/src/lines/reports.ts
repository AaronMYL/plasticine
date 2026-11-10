// 后台线贴回发起它的线的那一条（《优化清单》第 17 条，走查 11-07：交接原文不进主线）：只有结论——line_outcome 写的
// conclusion；没写的（旧线、模型忘了）取它最后那段话的第一段，截短。没做完是原因（加结论）；额度用完只贴一次「几点接着做」。
// 提交哈希、路径、「主线后续应……」这类技术交接留在后台线自己里，卡片点开才看得到。
// 贴回主线的（做完、没做成、没做完）另由 app/ 发一条系统通知（《优化清单》第 12 条，kernel 的 reported）；
// 这里只管贴回去的那一条。

import type { LineRow, StateService } from '../state/index.ts';
import type { LineReportMessage, ReportOutcome } from './messages.ts';
import { lineResult } from './results.ts';
import { conclusionOf, unmetReason } from './verdict.ts';

// 没写结论时从最后那段话里取的第一段最多这么长。
const FALLBACK_CHARS = 280;

/** 最后那段话的第一段（空行之前），截短：没写结论的线也只交一段话。 */
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

/** 「模型额度用完了，11/5 21:00 后接着做。」按他的时区写时间。 */
export function pauseNotice(until: Date, timeZone: string): string {
  const at = until.toLocaleString('zh-CN', { timeZone, month: 'numeric', day: 'numeric', hour: '2-digit',
    minute: '2-digit', hour12: false });
  return `模型额度用完了，${at} 后接着做。`;
}
