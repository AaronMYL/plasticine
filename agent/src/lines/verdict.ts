// 线说过的「没做成」还算不算数：说的时候写到第几条，之后有了新的输入（他又说了一句、排着的发出去了）就不算。

import type { LineRow, StateService } from '../state/index.ts';

export type VerdictState = Pick<StateService, 'lineMessages'>;

/** 没做成的一句原因；做成了、没说过、说过但之后又有了新输入都是 null。 */
export function unmetReason(state: VerdictState, line: LineRow): string | null {
  if (line.unmetReason === null || line.verdictSeq === null) {
    return null;
  }
  const lastInput = state.lineMessages.last(line.id, 'user')?.seq ?? 0;
  return line.verdictSeq >= lastInput ? line.unmetReason : null;
}

/** 线交给发起者的结论（line_outcome 写的）；没写过、或之后又有了新输入是 null。 */
export function conclusionOf(state: VerdictState, line: LineRow): string | null {
  if (line.conclusion === null || line.verdictSeq === null) {
    return null;
  }
  const lastInput = state.lineMessages.last(line.id, 'user')?.seq ?? 0;
  return line.verdictSeq >= lastInput ? line.conclusion : null;
}
