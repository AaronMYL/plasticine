import type { HeartbeatFact } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';

export type ReadingState = Pick<StateService, 'loop' | 'asks'>;

export const READING_ITEM = '自己的读数';
const DAY_MS = 24 * 60 * 60 * 1000;
export const CORRECTIONS_HIGH = 3;
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
