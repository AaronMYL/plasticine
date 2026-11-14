// 预测闭环（11-13 Aaron 定）：Plasticine 做一件事之前先记下自己的预测，做完记他的反应，下一次同类的事决定时读回来。
// 每类事只记三个数——原样收下、改了、不要（不拍脑袋定权重：没记录时当五五开，也就是 Beta(1,1)，数据自己把它拉过去）。
// 攒够 MIN_DECIDED 条才改变行为；没攒够的和原来一模一样。这里只有纯函数，存取在 state/loop.ts，接线在各处。

export const LOOP_AREAS = ['note_predict', 'note_supplement', 'suggestion', 'ask', 'message_predict'] as const;
export type LoopArea = (typeof LOOP_AREAS)[number];
export const LOOP_OUTCOMES = ['kept', 'changed', 'rejected'] as const;
export type LoopOutcome = (typeof LOOP_OUTCOMES)[number];

/** 一类事攒够这么多条有结果的记录，才拿来改行为。 */
export const MIN_DECIDED = 5;
/** 连续原样同意这么多次才问「这类以后我直接做？」（11-13 Aaron 弹框选「5 次」）。 */
export const OFFER_STREAK = 5;
/** 收下的比例低于它算「他基本不要」，高于 WARM_RATE 算「他基本都要」。 */
export const COLD_RATE = 0.25;
export const WARM_RATE = 0.7;
/** 冷下来的一类：最后一次有结果之后隔这么久，再放一条出去试试（他的口味会变）。 */
export const COLD_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const TOPIC_MAX = 16;

export interface Tally {
  topic: string;
  kept: number;
  changed: number;
  rejected: number;
  decided: number;
  lastDecidedAt: string | null;
}

export type Temperature = 'unknown' | 'cold' | 'warm' | 'mixed';

/** 收下的把握：(收下 + 1) / (有结果 + 2)。没记录时是 0.5。 */
export function keptRate(tally: Tally): number {
  return (tally.kept + 1) / (tally.decided + 2);
}

export function temperature(tally: Tally): Temperature {
  if (tally.decided < MIN_DECIDED) {
    return 'unknown';
  }
  const rate = keptRate(tally);
  return rate <= COLD_RATE ? 'cold' : rate >= WARM_RATE ? 'warm' : 'mixed';
}

/** 从最新的往回数，连续原样收下了几次。 */
export function streak(newestFirst: readonly LoopOutcome[]): number {
  let count = 0;
  for (const outcome of newestFirst) {
    if (outcome !== 'kept') {
      break;
    }
    count += 1;
  }
  return count;
}

/** 这类事的叫法：去掉首尾空白、多个空白并成一个、最多 16 个字；空的不算一类。 */
export function normalizeTopic(raw: string): string | null {
  const text = raw.trim().replace(/\s+/g, ' ');
  return text === '' ? null : Array.from(text).slice(0, TOPIC_MAX).join('');
}

/** 冷下来的一类现在能不能再放一条出去：最后一次有结果之后过了 COLD_RETRY_MS。 */
export function coldRetryDue(tally: Tally, now: Date): boolean {
  return tally.lastDecidedAt === null || now.getTime() - Date.parse(tally.lastDecidedAt) >= COLD_RETRY_MS;
}
