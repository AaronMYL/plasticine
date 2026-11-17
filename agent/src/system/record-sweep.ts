// 定时清两样只会越攒越多的记录（11-17 用户弹框定）：
// - 设备动作的回执正文只留 30 天：读回来的网页全文、界面结构这类，线上从 10 月底起一条没清过（64 MB）。动作这一行
//   （做了什么、成没成、回执摘要）一直留着，核对「做没做过」不受影响。
// - 过期的接口回执删掉：过了期本来就不再认，留着只占地方。
// 一轮只清一小批，免得一次占住服务太久；这一轮清满了下一轮（五分钟后）接着清，清完当天不再看。

import type { StateService } from '../state/index.ts';
import { safeLog } from '../util/index.ts';

/** 设备动作的回执正文留多少天。 */
export const NODE_ACTION_RESULT_DAYS = 30;
/** 一轮最多清多少行：回执正文一行可能几十 KB，五百行大约是一次几十毫秒到几百毫秒的写。 */
export const SWEEP_BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export class RecordSweep {
  readonly #state: Pick<StateService, 'nodeActions' | 'apiRequests'>;
  readonly #now: () => Date;
  /** 清完的那一天（按 UTC 的日期）：同一天不再看。 */
  #doneDay: string | null = null;

  constructor(state: Pick<StateService, 'nodeActions' | 'apiRequests'>, now: () => Date) {
    this.#state = state;
    this.#now = now;
  }

  /** 清一小批；回这一轮清了几行回执正文、删了几行过期回执。 */
  run(): { trimmed: number; purged: number } {
    const now = this.#now();
    const day = now.toISOString().slice(0, 10);
    if (day === this.#doneDay) {
      return { trimmed: 0, purged: 0 };
    }
    const before = new Date(now.getTime() - NODE_ACTION_RESULT_DAYS * DAY_MS).toISOString();
    const trimmed = this.#state.nodeActions.trimResults(before, SWEEP_BATCH);
    const purged = this.#state.apiRequests.purgeExpired(now.toISOString(), SWEEP_BATCH);
    if (trimmed < SWEEP_BATCH && purged < SWEEP_BATCH) {
      this.#doneDay = day;
    }
    if (trimmed > 0 || purged > 0) {
      safeLog('log', 'records_swept', { counts: { count: trimmed, deleted: purged } });
    }
    return { trimmed, purged };
  }
}
