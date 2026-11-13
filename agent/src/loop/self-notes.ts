// 预测闭环第四步（11-13 Aaron 定「做梦时写一份大白话的『我自己的说明书』给模型读」）：每晚做梦后，读一遍最近的预测和
// 他的反应（各处每类的三个数、他改了或没要的那几条原样、放过手的几类），让模型写几句给自己看的大白话；之后每次请求
// 都带上最新那一份（loop/prompt.ts）。上次写完以后没有新结果就不写。没有模型、模型失败都不影响做梦本身。

import type { TextModels } from '../kernel/index.ts';
import type { StateService } from '../state/index.ts';
import { LOOP_AREAS, type LoopArea } from './tally.ts';

export type SelfNotesState = Pick<StateService, 'loop'>;

const AREA_NAMES: Readonly<Record<LoopArea, string>> = {
  note_predict: '笔记续写', note_supplement: '笔记补充建议', suggestion: '建议卡', ask: '推出来的确认卡',
};
const CORRECTIONS_SHOWN = 20;
const NOTES_MAX_TOKENS = 1200;
const DAY_MS = 24 * 60 * 60 * 1000;

export const SELF_NOTES_SYSTEM = [
  '你是 Plasticine，夜里回看自己最近的预测和他的反应，写一份只给自己看的说明书。',
  '材料里是每类事他原样收下、改了、不要的次数，和他改了或没要的那几条原样。',
  '写 4–10 条大白话，每条一句、以「- 」开头：哪类事他基本原样收下（可以更放心地照这样做），哪类他常改、改成了什么样',
  '（下次照他改的方向做），哪类他基本不要（少做）。只写材料里看得出来的，不猜原因、不评价他、不写数字公式。',
  '材料不够说出什么时，只写一行「- 还看不出规律」。',
].join('\n');

export function selfNotesMaterial(state: SelfNotesState, now: Date): string | null {
  const latest = state.loop.selfNotes.latest();
  const since = latest?.writtenAt ?? new Date(now.getTime() - 30 * DAY_MS).toISOString();
  if (state.loop.corrections(since, 1).length === 0 && !LOOP_AREAS.some((area) =>
    state.loop.tallies(area).some((row) => row.lastDecidedAt !== null && row.lastDecidedAt > since))) {
    return null;
  }
  const counts = LOOP_AREAS.flatMap((area) => state.loop.tallies(area).map((row) =>
    `${AREA_NAMES[area]}·${row.topic}：收下 ${row.kept}，改了 ${row.changed}，不要 ${row.rejected}`));
  const corrections = state.loop.corrections(new Date(now.getTime() - 7 * DAY_MS).toISOString(), CORRECTIONS_SHOWN)
    .map((row) => `${AREA_NAMES[row.area]}·${row.topic}：我给的「${row.expected}」→ ${row.outcome === 'changed'
      ? `他改成「${row.actual ?? '别的'}」` : '他没要'}`);
  const grants = state.loop.grants.list().map((grant) => grant.topic);
  return JSON.stringify({ 各类次数: counts, 最近一周他改了或没要的: corrections, 他放过手的: grants,
    上一份说明书: latest?.text ?? null });
}

/** 写一份新的说明书；没有新结果、没有模型时返回 false。 */
export async function writeSelfNotes(state: SelfNotesState, models: TextModels | null, now: Date,
  signal: AbortSignal): Promise<boolean> {
  const material = selfNotesMaterial(state, now);
  if (material === null || models === null) {
    return false;
  }
  const answer = await models.ask({ purpose: 'dream', system: SELF_NOTES_SYSTEM,
    messages: [{ role: 'user', content: material }], maxOutputTokens: NOTES_MAX_TOKENS }, signal);
  const text = answer.text.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('- ')).join('\n');
  if (!answer.complete || text === '') {
    throw new Error('说明书没写完整，下一晚再写。');
  }
  state.loop.selfNotes.write(text);
  return true;
}
