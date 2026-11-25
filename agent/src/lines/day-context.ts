import type { LineDayRow, LineRow, StateService } from '../state/index.ts';

export const MAX_DAY_COMPACTIONS = 3;

export type DayState = Pick<StateService, 'lines' | 'lineDays' | 'lineMessages'>;

export function segmented(line: LineRow): boolean {
  return (line.kind === 'main' || line.kind === 'side') && line.sealedPrompt === null;
}

export function localDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(at);
}

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
  summary: string | null;
  after: number;
  day: LineDayRow | null;
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
      + 'conversation_search 翻；需要分工时用 mate_list 查看现有队友，按职责用 mate_handoff 交接；'
      + '没有合适队友的工作用 start_line 开后台线。');
  }
  return parts.join('\n');
}
