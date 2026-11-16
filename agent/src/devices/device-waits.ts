// 等设备回来接着做的任务（11-16 Aaron 定：设备卡住、掉线，能接着做的，设备一恢复就在原任务里从那一步接着做，
// 不另开）。一条线的设备动作因为设备离线没发出、或发出后结果不明，就在这里记一笔；设备重新报到（离线回来，或卡住后
// 又空了）时取出这台设备的，交给 app/ 往那条线里说一句「设备回来了，接着做」。存在 kernel_settings 一个键里，服务重启
// 也在；同一条线只记最新一笔；那条线在这台设备上后来做成了一个动作就划掉；满一天没回来的不再接。

import type { StateService } from '../state/index.ts';

const KEY = 'device_waits';
const KEEP_MS = 24 * 60 * 60 * 1000;

export interface DeviceWait {
  lineId: string;
  nodeId: string;
  /** 卡在哪：「离线没发出」或那一步的说法和原因。 */
  why: string;
  at: string;
}

type WaitState = Pick<StateService, 'kernelSettings'>;

function lineOf(runId: string | null): string | null {
  return runId?.startsWith('line:') === true ? runId.slice('line:'.length) : null;
}

export class DeviceWaits {
  readonly #state: WaitState;
  readonly #now: () => Date;

  constructor(state: WaitState, now: () => Date) {
    this.#state = state;
    this.#now = now;
  }

  add(runId: string | null, nodeId: string, why: string): void {
    const lineId = lineOf(runId);
    if (lineId === null) {
      return;
    }
    const rest = this.#all().filter((wait) => wait.lineId !== lineId);
    this.#save([...rest, { lineId, nodeId, why: why.slice(0, 300), at: this.#now().toISOString() }]);
  }

  /** 这条线在这台设备上做成了一个动作：不用再等。 */
  done(runId: string | null, nodeId: string): void {
    const lineId = lineOf(runId);
    const all = this.#all();
    if (lineId !== null && all.some((wait) => wait.lineId === lineId && wait.nodeId === nodeId)) {
      this.#save(all.filter((wait) => !(wait.lineId === lineId && wait.nodeId === nodeId)));
    }
  }

  /** 设备回来了：取出等它的（取出即划掉）。 */
  take(nodeId: string): DeviceWait[] {
    const all = this.#all();
    const due = all.filter((wait) => wait.nodeId === nodeId);
    if (due.length > 0) {
      this.#save(all.filter((wait) => wait.nodeId !== nodeId));
    }
    return due;
  }

  list(): DeviceWait[] {
    return this.#all();
  }

  #all(): DeviceWait[] {
    const value = this.#state.kernelSettings.get(KEY);
    const cutoff = this.#now().getTime() - KEEP_MS;
    return (Array.isArray(value) ? value as DeviceWait[] : []).filter((wait) => Date.parse(wait.at) >= cutoff);
  }

  #save(waits: DeviceWait[]): void {
    this.#state.kernelSettings.set(KEY, waits);
  }
}
