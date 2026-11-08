// 假数据也明确记录来源，不能只看到 user role 就当作本人原话。续写的例子按同样的引用合成一版成果。

import type { LineDetailsQuery, LineDetailsResponse, LineInputOrigin, LineMessageView, LineView }
  from '../shared.ts';

export const messageRef = (lineId: string, seq: number): string => `line:${lineId}:${seq}`;

export function fakeLineDetails(line: LineView, messages: readonly LineMessageView[],
  origins: ReadonlyMap<string, LineInputOrigin>, lookup: (ref: string) => LineMessageView | undefined,
  project: LineDetailsResponse['project'], query: LineDetailsQuery): LineDetailsResponse {
  const first = messages.find((message) => message.role === 'user');
  const origin = first === undefined ? undefined : origins.get(messageRef(line.id, first.seq));
  const source = first === undefined ? undefined : origin?.kind === 'user' ? first
    : origin?.ref === undefined ? undefined : lookup(origin.ref);
  const sourceOrigin = source === undefined ? undefined : origins.get(messageRef(source.lineId, source.seq));
  const sourceText = sourceOrigin?.userText ?? source?.text ?? '';
  const request = first === undefined ? null : { text: first.text, source:
    source !== undefined && sourceOrigin?.kind === 'user' && sourceText.trim() !== ''
      ? { lineId: source.lineId, seq: source.seq, text: sourceText } : null };
  const results: LineDetailsResponse['results'] = [];
  let before = query.before ?? Infinity;
  const candidate = (): LineMessageView | undefined => messages.findLast((row) => row.seq < before
    && row.role === 'assistant' && (row.stopReason === 'stop' || row.stopReason === 'length'));
  for (let row = candidate(); row !== undefined && results.length < (query.limit ?? 10); row = candidate()) {
    const last = row;
    const parts = [row.text];
    before = row.seq;
    while (row !== undefined) {
      const input = messages.findLast((message) => message.seq < row!.seq && message.role === 'user');
      const from = input === undefined ? undefined : origins.get(messageRef(line.id, input.seq));
      const previous = from?.kind !== 'system' || from.ref === undefined ? undefined : lookup(from.ref);
      if (previous === undefined || previous.lineId !== line.id || previous.seq >= row.seq
        || previous.stopReason !== 'length') break;
      parts.unshift(previous.text);
      before = previous.seq;
      row = previous;
    }
    const text = parts.join('').trim();
    if (text !== '') results.push({ seq: last.seq, text, createdAt: last.createdAt,
      complete: last.stopReason === 'stop' });
  }
  const hasMore = candidate() !== undefined;
  return structuredClone({ line, request, project, results, hasMore, nextBefore: hasMore ? before : null });
}
