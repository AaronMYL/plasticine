import type { StateService } from '../state/index.ts';

const KEY = 'device_waits';
const KEEP_MS = 24 * 60 * 60 * 1000;

export interface DeviceWait {
  lineId: string;
  nodeId: string;
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

  done(runId: string | null, nodeId: string): void {
    const lineId = lineOf(runId);
    const all = this.#all();
    if (lineId !== null && all.some((wait) => wait.lineId === lineId && wait.nodeId === nodeId)) {
      this.#save(all.filter((wait) => !(wait.lineId === lineId && wait.nodeId === nodeId)));
    }
  }

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
