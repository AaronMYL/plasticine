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

export const MESSAGE_TOPIC = '输入建议';
const HABIT_SUBJECTS: Readonly<Record<'note_predict' | 'message_predict', { topic: string; label: string }>> = {
  note_predict: { topic: PREDICT_TOPIC, label: '续写' },
  message_predict: { topic: MESSAGE_TOPIC, label: '输入建议' },
};

export function predictHabits(state: LoopState, area: 'note_predict' | 'message_predict' = 'note_predict'): string {
  const { topic, label } = HABIT_SUBJECTS[area];
  const tally = state.loop.tallies(area).find((row) => row.topic === topic);
  if (tally === undefined || tally.decided < MIN_DECIDED) {
    return '';
  }
  const kept = state.loop.samples(area, ['kept'], KEPT_SAMPLES);
  const dropped = state.loop.samples(area, ['rejected'], DROPPED_SAMPLES);
  const parts = [`他以前对${label}的反应（照他收下过的长度和口气写，避开他没要的写法）：`];
  if (kept.length > 0) {
    parts.push('他收下过的：', ...kept.map((sample) => `- 「${clip(sample.expected)}」`));
  }
  if (dropped.length > 0) {
    parts.push('他没要的：', ...dropped.map((sample) => `- 「${clip(sample.expected)}」`));
  }
  return parts.join('\n');
}

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

export function recordPrediction(state: LoopState | undefined, text: string,
  area: 'note_predict' | 'message_predict' = 'note_predict'): string | undefined {
  if (state === undefined || text.trim() === '') {
    return undefined;
  }
  return state.loop.record({ area, topic: HABIT_SUBJECTS[area].topic, expected: text }) ?? undefined;
}

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
