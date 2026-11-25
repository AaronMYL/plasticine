import type { SuggestionIcon, SuggestionSource } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { coldRetryDue, normalizeTopic, temperature, type LoopOutcome } from './tally.ts';

export type SuggestionLoopState = Pick<StateService, 'loop'>;

const SOURCE_NAMES: Readonly<Record<SuggestionSource, string>> = {
  plasticine: '主动', review: '回顾', heartbeat: '心跳', dream: '做梦',
};
const ICON_NAMES: Readonly<Record<SuggestionIcon, string>> = {
  file: '文档', space: '研究', mail: '邮件', books: '书', clock: '定时', sparkle: '其他',
};

export function suggestionTopic(input: { topic?: string | undefined; source: SuggestionSource;
  icon?: SuggestionIcon | undefined }): string {
  const given = input.topic === undefined ? null : normalizeTopic(input.topic);
  return given ?? `${SOURCE_NAMES[input.source]}·${ICON_NAMES[input.icon ?? 'sparkle']}`;
}

export function heldBack(state: SuggestionLoopState, topic: string, now: Date): boolean {
  const tally = state.loop.tallies('suggestion').find((row) => row.topic === topic);
  return tally !== undefined && temperature(tally) === 'cold' && !coldRetryDue(tally, now);
}

export function recordSuggestion(state: SuggestionLoopState, suggestionId: string, topic: string,
  title: string): void {
  state.loop.record({ area: 'suggestion', topic, ref: suggestionId, expected: title });
}

export function settleSuggestion(state: SuggestionLoopState, suggestionId: string, outcome: LoopOutcome): void {
  state.loop.resolveByRef('suggestion', suggestionId, outcome);
}

export function suggestionTaste(state: SuggestionLoopState): string {
  const tallies = state.loop.tallies('suggestion');
  const names = (wanted: 'warm' | 'cold'): string[] => tallies.filter((row) => temperature(row) === wanted)
    .map((row) => `${row.topic}（要了 ${row.kept}/${row.decided}）`);
  const warm = names('warm');
  const cold = names('cold');
  if (warm.length === 0 && cold.length === 0) {
    return '';
  }
  return ['## 他对建议卡的反应（suggest 时参考）',
    ...(warm.length === 0 ? [] : [`- 他常要的：${warm.join('、')}`]),
    ...(cold.length === 0 ? [] : [`- 他常忽略的，先别提：${cold.join('、')}`]),
    'suggest 的 topic 写这类建议的叫法，同一类每次用同一个词。'].join('\n');
}
