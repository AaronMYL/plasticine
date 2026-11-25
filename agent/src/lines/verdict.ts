import type { LineRow, StateService } from '../state/index.ts';

export type VerdictState = Pick<StateService, 'lineMessages'>;

export function unmetReason(state: VerdictState, line: LineRow): string | null {
  if (line.unmetReason === null || line.verdictSeq === null) {
    return null;
  }
  const lastInput = state.lineMessages.last(line.id, 'user')?.seq ?? 0;
  return line.verdictSeq >= lastInput ? line.unmetReason : null;
}

export function conclusionOf(state: VerdictState, line: LineRow): string | null {
  if (line.conclusion === null || line.verdictSeq === null) {
    return null;
  }
  const lastInput = state.lineMessages.last(line.id, 'user')?.seq ?? 0;
  return line.verdictSeq >= lastInput ? line.conclusion : null;
}
