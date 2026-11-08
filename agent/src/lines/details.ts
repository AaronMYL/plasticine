// 从持久消息读工作详情；不从最近一页猜最初要求，也不把 user role 或模型整理认作本人原话。

import type { LineDetailsQuery, LineDetailsResponse, LineSourceView, LineView } from '../../shared/api/index.ts';
import { plainText, type LineMessageRow, type StateService } from '../state/index.ts';
import { isAssistant } from './messages.ts';
import { lineResultAt } from './results.ts';

type DetailsState = Pick<StateService, 'lineMessages' | 'lineQueue' | 'projects'>;

function userSource(state: DetailsState, row: LineMessageRow): LineSourceView | null {
  const origin = row.meta?.origin;
  if (origin?.kind === 'user') {
    const text = origin.userText ?? plainText(row.message);
    return text.trim() === '' ? null : { lineId: row.lineId, seq: row.seq, text };
  }
  const source = origin?.ref === undefined ? undefined : state.lineMessages.said(origin.ref);
  if (source?.origin?.kind !== 'user') {
    return null;
  }
  const text = source.origin.userText ?? source.text;
  return text.trim() === '' ? null : { lineId: source.lineId, seq: source.seq, text };
}

export function lineDetails(state: DetailsState, line: LineView, query: LineDetailsQuery = {}):
  LineDetailsResponse {
  const first = state.lineMessages.first(line.id, 'user');
  const queued = first === undefined ? state.lineQueue.queued(line.id)[0] : undefined;
  const request = first === undefined ? (queued === undefined ? null : { text: queued.text, source: null })
    : { text: plainText(first.message), source: userSource(state, first) };
  const project = line.projectId === null ? undefined : state.projects.get(line.projectId);
  const results: LineDetailsResponse['results'] = [];
  const limit = query.limit ?? 10;
  let before = query.before ?? Number.MAX_SAFE_INTEGER;
  while (results.length < limit) {
    const row = state.lineMessages.resultBefore(line.id, before);
    if (row === undefined) {
      break;
    }
    const result = lineResultAt(state, row);
    before = result.firstSeq;
    if (result.text !== null) {
      results.push({ seq: row.seq, text: result.text, createdAt: row.createdAt,
        complete: isAssistant(row.message) && row.message.stopReason === 'stop' });
    }
  }
  const hasMore = state.lineMessages.resultBefore(line.id, before) !== undefined;
  return { line, request, project: project === undefined ? null : { id: project.id, title: project.name }, results,
    hasMore, nextBefore: hasMore ? before : null };
}
