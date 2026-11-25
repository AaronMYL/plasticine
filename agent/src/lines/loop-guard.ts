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
  block: string;
  halt: HaltCause | null;
}

export interface GuardAfter {
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

  constructor(options: { hardStops: boolean }) {
    this.#hardStops = options.hardStops;
  }

  steps(): number {
    return this.#steps;
  }

  step(): void {
    this.#steps += 1;
    if (this.#steps % CHECKPOINT_STEPS === 0) {
      this.#checkpointDue = true;
    }
  }

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
