// 预测闭环第二步（11-13 Aaron 定）：每一张建议卡是一次预测（「这条他会要」）。他点「开始做」「加成待办」算收下，
// 点「忽略」算不要。按类数：他基本不要的那一类（攒够 MIN_DECIDED 条、收下的比例很低）先不再出，隔 COLD_RETRY_MS
// 才放一条出去试试；他基本都要的写进提示，让 Plasticine 多想这类。没攒够的照旧出。

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

/** 这张建议属于哪一类：模型给了叫法用它的，没给按来源和图标（如「心跳·邮件」）。 */
export function suggestionTopic(input: { topic?: string | undefined; source: SuggestionSource;
  icon?: SuggestionIcon | undefined }): string {
  const given = input.topic === undefined ? null : normalizeTopic(input.topic);
  return given ?? `${SOURCE_NAMES[input.source]}·${ICON_NAMES[input.icon ?? 'sparkle']}`;
}

/** 这一类他基本不要、离上次有结果还没隔够：先不出。 */
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

/** 写进系统提示：哪几类建议他常要、哪几类常忽略（没攒够的不写）。 */
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
