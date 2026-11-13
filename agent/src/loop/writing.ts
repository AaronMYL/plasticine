// 预测闭环第一步（11-13 Aaron 定）：笔记续写和补充建议。每一条续写、每一条补充都是一次预测（「他接下来想写什么」
// 「他要不要这一条」），他收下还是没要，界面报回来（state/loop.ts）。攒够了就写进下一次的提示：续写给几句他收下过的
// 和没要的原样，补充按类型说多给哪类、少给哪类。没攒够返回空串，提示和原来一模一样。

import type { NoteSupplement } from '../../shared/api/notes-workspace.ts';
import type { StateService } from '../state/index.ts';
import { MIN_DECIDED, temperature } from './tally.ts';

export type LoopState = Pick<StateService, 'loop'>;

export const PREDICT_TOPIC = '续写';
export const SUPPLEMENT_TOPICS: Readonly<Record<NoteSupplement['kind'], string>> = {
  structure: '结构', supplement: '补充', example: '举例', contact: '联系人',
};
const KEPT_SAMPLES = 4;
const DROPPED_SAMPLES = 3;
const SAMPLE_MAX = 80;

function clip(text: string): string {
  const chars = Array.from(text.trim().replace(/\s+/g, ' '));
  return chars.length <= SAMPLE_MAX ? chars.join('') : `${chars.slice(0, SAMPLE_MAX - 1).join('')}…`;
}

/** 续写：有结果的攒够了，给几句他收下过的和没要的原样，照前者的长度和口气写。 */
export function predictHabits(state: LoopState): string {
  const tally = state.loop.tallies('note_predict').find((row) => row.topic === PREDICT_TOPIC);
  if (tally === undefined || tally.decided < MIN_DECIDED) {
    return '';
  }
  const kept = state.loop.samples('note_predict', ['kept'], KEPT_SAMPLES);
  const dropped = state.loop.samples('note_predict', ['rejected'], DROPPED_SAMPLES);
  const parts = ['他以前对续写的反应（照他收下过的长度和口气写，避开他没要的写法）：'];
  if (kept.length > 0) {
    parts.push('他收下过的：', ...kept.map((sample) => `- 「${clip(sample.expected)}」`));
  }
  if (dropped.length > 0) {
    parts.push('他没要的：', ...dropped.map((sample) => `- 「${clip(sample.expected)}」`));
  }
  return parts.join('\n');
}

/** 补充建议：按类型数，他基本都要的多给，基本不要的少给（除非这一段特别需要）。 */
export function supplementHabits(state: LoopState): string {
  const tallies = state.loop.tallies('note_supplement');
  const names = (wanted: 'warm' | 'cold'): string[] => tallies.filter((row) => temperature(row) === wanted)
    .map((row) => `${row.topic}（收下 ${row.kept}/${row.decided}）`);
  const warm = names('warm');
  const cold = names('cold');
  if (warm.length === 0 && cold.length === 0) {
    return '';
  }
  return ['他以前对补充建议的反应：',
    ...(warm.length === 0 ? [] : [`- 多给这几类：${warm.join('、')}`]),
    ...(cold.length === 0 ? [] : [`- 少给这几类，除非这一段特别需要：${cold.join('、')}`]),
  ].join('\n');
}

/** 记下这次给出去的续写，回一个 id 给界面报结果；没有库（测试）或没字时不记。 */
export function recordPrediction(state: LoopState | undefined, text: string): string | undefined {
  if (state === undefined || text.trim() === '') {
    return undefined;
  }
  return state.loop.record({ area: 'note_predict', topic: PREDICT_TOPIC, expected: text }) ?? undefined;
}

/** 记下这次给出去的每一条补充，id 贴在那一条上。 */
export function recordSupplements(state: LoopState | undefined, items: readonly NoteSupplement[]): NoteSupplement[] {
  if (state === undefined) {
    return [...items];
  }
  return items.map((item) => {
    const loopId = state.loop.record({ area: 'note_supplement', topic: SUPPLEMENT_TOPICS[item.kind],
      expected: item.text });
    return loopId === null ? item : { ...item, loopId };
  });
}
