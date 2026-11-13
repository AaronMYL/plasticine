// 预测闭环第四步（11-13 Aaron 定）：心跳看几样「自己的读数」，像人感觉到饿、累——偏离了就交给心跳的判断去拉回来。
// 现在两样：最近一天他改了或没要几次（多了说明最近猜得不准，做这几类事前多问、写清依据）；等他答的卡堆了几张
// （多了先别再出新卡，能合并的合成一件）。没偏离就什么都不给，心跳照旧。同一天同一档只算一次新变化。

import type { HeartbeatFact } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';

export type ReadingState = Pick<StateService, 'loop' | 'asks'>;

/** 心跳材料里这一类叫什么。 */
export const READING_ITEM = '自己的读数';
const DAY_MS = 24 * 60 * 60 * 1000;
/** 一天里被改或没要这么多次算偏离。 */
export const CORRECTIONS_HIGH = 3;
/** 等他答的卡堆到这么多张算偏离。 */
export const WAITING_HIGH = 4;
const TOPICS_SHOWN = 3;

function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function loopReadings(state: ReadingState, now: Date): HeartbeatFact[] {
  const facts: HeartbeatFact[] = [];
  const corrections = state.loop.corrections(new Date(now.getTime() - DAY_MS).toISOString());
  if (corrections.length >= CORRECTIONS_HIGH) {
    const topics = [...new Set(corrections.map((row) => row.topic))].slice(0, TOPICS_SHOWN);
    facts.push({ key: `loop:corrections:${dayKey(now)}:${corrections.length >= 2 * CORRECTIONS_HIGH ? 'many' : 'some'}`,
      item: READING_ITEM, text: `最近一天他改了或没要你 ${corrections.length} 次（多在${topics.map((topic) => `「${topic}」`)
        .join('')}）：这几类最近猜得不准，做之前多问一句、在回答里写清依据` });
  }
  const waiting = state.asks.open().filter((ask) => ask.deferredAt === null);
  if (waiting.length >= WAITING_HIGH) {
    facts.push({ key: `loop:waiting:${dayKey(now)}:${waiting.length >= 2 * WAITING_HIGH ? 'many' : 'some'}`,
      item: READING_ITEM, text: `有 ${waiting.length} 张卡在等他答：先别再出新卡，能合并的合成一件、用一条消息告诉他` });
  }
  return facts;
}
