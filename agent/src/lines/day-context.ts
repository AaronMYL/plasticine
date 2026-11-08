// 主线和旁聊按天分段（《优化清单》第 17 条，11-06 他定：主线不再拿压缩当记忆）。
// - 新的一天第一轮开跑时（不在一轮中间）定下今天从第几条起：上一轮回答之后进来的那些（他的话、贴回的结果、通知）。
// - 给模型的上下文 = 系统提示（记忆库 + 前一天的要点）+ 今天的摘要（压缩过才有）+ 今天的原话；不背几个月的摘要链。
// - 当天太长才压缩，次数有上限；到上限后不再写摘要，只留今天最近的原话，更早的靠「翻对话」，话题岔开时提议开旁聊。
// 后台线（子代理）是一件事一个上下文，不分段，照旧用线上的 summary。

import type { LineDayRow, LineRow, StateService } from '../state/index.ts';

/** 一天里最多写几次摘要：再多就是「摘要的摘要」，错的地方一层层带下去。 */
export const MAX_DAY_COMPACTIONS = 3;

export type DayState = Pick<StateService, 'lines' | 'lineDays' | 'lineMessages'>;

export function segmented(line: LineRow): boolean {
  return (line.kind === 'main' || line.kind === 'side') && line.sealedPrompt === null;
}

/** 他所在时区的日子，YYYY-MM-DD。 */
export function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(at);
}

/**
 * 一轮开跑前：分段的线换了一天就开新的一天，从上一轮回答之后那一条起。没有新的输入、或这一天已经开过，不动。
 * 只在新开一轮时调（重启接着跑的那一轮不切，免得把一组工具调用和结果拆开）。
 */
export function rollDay(state: DayState, line: LineRow, now: Date, timeZone: string): LineDayRow | undefined {
  if (!segmented(line)) {
    return undefined;
  }
  const day = localDay(now, timeZone);
  const latest = state.lineDays.latest(line.id);
  if (latest !== undefined && latest.day >= day) {
    return latest;
  }
  const startSeq = (state.lineMessages.last(line.id, 'assistant')?.seq ?? 0) + 1;
  const last = state.lineMessages.last(line.id)?.seq ?? 0;
  return last < startSeq ? latest : state.lineDays.start(line.id, day, startSeq);
}

export interface ContextWindow {
  /** 送在最前面的摘要（分段的线只用今天的）。 */
  summary: string | null;
  /** 只送 seq 大于它的消息。 */
  after: number;
  /** 今天这一段；不分段（后台线）或还没分过段（升级前的主线，第一次新开一轮前）是 null。 */
  day: LineDayRow | null;
  /** 前一天（上一次用这条线的那天），读它的要点。 */
  previous: LineDayRow | null;
}

export function contextWindow(state: Pick<StateService, 'lineDays'>, line: LineRow): ContextWindow {
  const day = segmented(line) ? state.lineDays.latest(line.id) : undefined;
  if (day === undefined) {
    return { summary: line.summary, after: line.summarySeq, day: null, previous: null };
  }
  const todays = day.summary !== null && day.summarySeq >= day.startSeq;
  return { summary: todays ? day.summary : null, after: todays ? day.summarySeq : day.startSeq - 1, day,
    previous: state.lineDays.previous(line.id, day.day) ?? null };
}

/** 压缩的结果记在哪：分段的线记在今天上（counted 才算一次），不分段的记在线上。 */
export function saveCompaction(state: DayState, line: LineRow, window: ContextWindow, summary: string | null,
  summarySeq: number, counted: boolean): void {
  if (window.day === null) {
    state.lines.update(line.id, { summary, summarySeq });
    return;
  }
  state.lineDays.compacted(line.id, window.day.day, { summary, summarySeq, counted });
}

function monthDay(day: string): string {
  const [, month, date] = day.split('-');
  return `${Number(month)}月${Number(date)}日`;
}

/** 系统提示里「今天」这一节：分段怎么回事、前一天的要点、到了压缩上限怎么办。不分段的线没有这一节。 */
export function daySection(state: Pick<StateService, 'lineDays'>, line: LineRow): string {
  const window = contextWindow(state, line);
  if (window.day === null) {
    return '';
  }
  const parts = ['## 今天',
    '这条对话按天分段：上下文从今天开始，更早的原话不在这里。长期的事看记忆库；要以前的原话用 conversation_search'
      + '（翻对话）找，不凭印象复述。'];
  const digest = window.previous?.digest?.trim() ?? '';
  if (window.previous !== null && digest !== '') {
    parts.push(`前一天的要点（${monthDay(window.previous.day)}）：`, digest);
  }
  if (window.day.compactions >= MAX_DAY_COMPACTIONS) {
    parts.push(`今天已经压缩过 ${window.day.compactions} 次，到了上限：之后只留今天最近的原话，更早的用 `
      + 'conversation_search 翻；话题岔开了就提议他开一条旁聊（open_side_chat）。');
  }
  return parts.join('\n');
}
