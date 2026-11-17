// 拦不收敛的线（内核优化第一批，11-17 Aaron 定：打转检测为主，每 60 步对一次进度，步数上限只当兜底）。
// 线上最长的一条后台线跑了 919 步、19 小时，最后没做成；有的动作 20 次全错还在接着试。提示词里那句「同一个办法原样
// 重试最多一次」拦不住，所以由内核来数。几个数照 Hermes 的 tool_loop_guardrails：
// - 同一个调用（工具和参数都一样）同样失败 2 次：在结果后面加一句提醒；失败 5 次：同样的调用不再执行。
// - 同一种操作连续失败 3 次：提醒；连续 8 次：这件事停下来交回（只对后台线，没人看着）。
// - 同一个调用连着读到一模一样的结果 2 次：提醒别一遍遍读（只提醒，不拦）。
// - 每 60 步提醒对一次进度；到 300 步停下来交回（只对后台线）。Hermes 的经验是死的步数上限会截断正常的长活，
//   线上做成的线最多 135 步，300 只防跑飞。
// 这里只数数、出话，不碰库也不碰模型；一次驱动一份，线接着做（重试、他又发话）就重新数。

import { isSnapshotCall } from './stale-results.ts';

export const EXACT_FAILURE_WARN = 2;
export const EXACT_FAILURE_BLOCK = 5;
export const SAME_KIND_FAILURE_WARN = 3;
export const SAME_KIND_FAILURE_HALT = 8;
export const NO_PROGRESS_WARN = 2;
export const CHECKPOINT_STEPS = 60;
export const STEP_LIMIT = 300;

export interface GuardCall {
  name: string;
  args: unknown;
}

export type HaltCause = 'stuck' | 'step_limit';

export interface GuardVerdict {
  /** 这次调用不执行，这句话当作它的结果。 */
  block: string;
  /** 这件事该停下来交回了。 */
  halt: HaltCause | null;
}

export interface GuardAfter {
  /** 加在这次结果后面的提醒（没有就是空）。 */
  notes: string[];
  halt: HaltCause | null;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** 「同一种操作」：工具名；device_action 再分到动作（tab_act、tab_click……）。 */
export function kindOf(call: GuardCall): string {
  if (call.name !== 'device_action' || typeof call.args !== 'object' || call.args === null) {
    return call.name;
  }
  const action: unknown = Reflect.get(call.args, 'action');
  const kind: unknown = typeof action === 'object' && action !== null ? Reflect.get(action, 'kind') : undefined;
  return typeof kind === 'string' ? `${call.name}:${kind}` : call.name;
}

export class LoopGuard {
  readonly #hardStops: boolean;
  readonly #exact = new Map<string, number>();
  readonly #sameKind = new Map<string, number>();
  readonly #repeats = new Map<string, { result: string; times: number }>();
  #steps = 0;
  #checkpointDue = false;

  /** hardStops：没人看着的线（后台线）才停下来交回；主线和队友对话只提醒、只拦同样的调用。 */
  constructor(options: { hardStops: boolean }) {
    this.#hardStops = options.hardStops;
  }

  steps(): number {
    return this.#steps;
  }

  /** 模型又答了一步。 */
  step(): void {
    this.#steps += 1;
    if (this.#steps % CHECKPOINT_STEPS === 0) {
      this.#checkpointDue = true;
    }
  }

  /** 这次调用执行之前：到步数上限、或同样的调用已经失败够多次，就不执行。 */
  before(call: GuardCall): GuardVerdict | null {
    if (this.#hardStops && this.#steps >= STEP_LIMIT) {
      return { block: `这件事已经做了 ${this.#steps} 步还没做完，内核先停下来，交回给发起的一方。`, halt: 'step_limit' };
    }
    const failures = this.#exact.get(`${call.name}${stable(call.args)}`) ?? 0;
    if (failures >= EXACT_FAILURE_BLOCK) {
      return { block: `这个调用已经同样失败 ${failures} 次，内核不再执行它。换一种办法（换参数、换工具、先重新看一次现状），`
        + '或者说清卡在哪。', halt: null };
    }
    return null;
  }

  /** 这次调用做完之后：记下成没成，回要加在结果后面的提醒。 */
  after(call: GuardCall, failed: boolean, resultText: string): GuardAfter {
    const notes: string[] = [];
    const halt = failed ? this.#failed(call, notes) : this.#succeeded(call, resultText, notes);
    if (this.#checkpointDue) {
      this.#checkpointDue = false;
      notes.push(`［内核提醒：这件事已经做了 ${this.#steps} 步。对一下：要交的是什么、现在离做成还差什么、最近十几步有没有`
        + '往前走。没有往前走就换办法；确实做不成就说清卡在哪、试过什么、缺什么。］');
    }
    return { notes, halt };
  }

  #failed(call: GuardCall, notes: string[]): HaltCause | null {
    const key = `${call.name}${stable(call.args)}`;
    const kind = kindOf(call);
    const exact = (this.#exact.get(key) ?? 0) + 1;
    const sameKind = (this.#sameKind.get(kind) ?? 0) + 1;
    this.#exact.set(key, exact);
    this.#sameKind.set(kind, sameKind);
    this.#repeats.delete(key);
    if (this.#hardStops && sameKind >= SAME_KIND_FAILURE_HALT) {
      return 'stuck';
    }
    if (exact >= EXACT_FAILURE_WARN) {
      notes.push(`［内核提醒：这个调用已经同样失败 ${exact} 次。不要再原样重试：换参数、换工具，或者先重新看一次现状。`
        + `同样失败到 ${EXACT_FAILURE_BLOCK} 次，这个调用不再执行。］`);
    } else if (sameKind >= SAME_KIND_FAILURE_WARN) {
      notes.push(`［内核提醒：${kind} 已经连续失败 ${sameKind} 次。先看原因：是对象找不到、状态变了，还是这条路走不通；`
        + '换办法，不要接着试同一种。］');
    }
    return null;
  }

  #succeeded(call: GuardCall, resultText: string, notes: string[]): null {
    const key = `${call.name}${stable(call.args)}`;
    this.#exact.delete(key);
    this.#sameKind.delete(kindOf(call));
    // 只管「看一眼」这类（读线、看页面、读命令输出）：别的调用结果一样不说明在打转。
    if (!isSnapshotCall({ name: call.name, arguments: call.args })) {
      return null;
    }
    const last = this.#repeats.get(key);
    const times = last !== undefined && last.result === resultText ? last.times + 1 : 1;
    this.#repeats.set(key, { result: resultText, times });
    if (times >= NO_PROGRESS_WARN) {
      notes.push(`［内核提醒：这次得到的和上一次一模一样（连着 ${times} 次）。在等别的事就过一会儿再回来看，不要一遍遍读；`
        + '不是在等，就换一个办法往前走。］');
    }
    return null;
  }
}
