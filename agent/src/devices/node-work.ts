// 每台设备的动作通道这会儿在干什么（11-16）：以前只看「90 秒内报没报到」一个布尔值，设备的报到和做动作在同一个循环里，
// 一个截图不返回就被当成离线。现在设备每 20 秒单独报到、带上在做哪个动作做到哪一步；这里记最近一次的样子和最近的报到，
// 判空着 / 在做 / 卡住，攒着 AI 要取消的动作（下一次报到的回复里带过去）。只在内存里：服务重启后等下一次报到就有了。

import { actionLimitMs } from '../../shared/device-action-limits.ts';
import type { NodeBusy, NodeWork } from '../../shared/api/index.ts';

/** 过了动作自己的时限还多等这么久才算卡住（设备放下卡住的动作、交回结果要一点时间）。 */
const STUCK_GRACE_MS = 30_000;
/** 每台设备留最近这么多次报到（device_logs 看服务器这边的报到记录）。 */
const HELLO_HISTORY = 120;

export interface HelloMark {
  at: string;
  busy: NodeBusy | null;
}

interface Board {
  busy: NodeBusy | null;
  reportedAt: string;
  history: HelloMark[];
  cancel: Set<string>;
}

export class NodeWorkBoard {
  readonly #nodes = new Map<string, Board>();

  /** 记一次报到；回这次之前是不是卡着（卡住后又空了 = 缓过来了）。 */
  report(nodeId: string, busy: NodeBusy | null, at: Date): { wasStuck: boolean } {
    const board = this.#nodes.get(nodeId) ?? { busy: null, reportedAt: at.toISOString(), history: [],
      cancel: new Set<string>() };
    const wasStuck = this.view(nodeId, at).state === 'stuck';
    board.busy = busy;
    board.reportedAt = at.toISOString();
    board.history.push({ at: board.reportedAt, busy });
    if (board.history.length > HELLO_HISTORY) {
      board.history.splice(0, board.history.length - HELLO_HISTORY);
    }
    if (busy === null) {
      board.cancel.clear();
    }
    this.#nodes.set(nodeId, board);
    return { wasStuck };
  }

  view(nodeId: string, at: Date): NodeWork {
    const board = this.#nodes.get(nodeId);
    if (board === undefined || board.busy === null) {
      return { state: 'idle', actionId: null, kind: null, step: null, since: null,
        reportedAt: board?.reportedAt ?? null };
    }
    const { busy } = board;
    const limit = actionLimitMs(busy.kind, {}) + STUCK_GRACE_MS;
    const stuck = at.getTime() - Date.parse(busy.since) > limit;
    return { state: stuck ? 'stuck' : 'busy', actionId: busy.actionId, kind: busy.kind, step: busy.step,
      since: busy.since, reportedAt: board.reportedAt };
  }

  history(nodeId: string): readonly HelloMark[] {
    return this.#nodes.get(nodeId)?.history ?? [];
  }

  /** AI 取消一个已经发给设备的动作：下一次报到的回复里告诉设备放下它。 */
  cancel(nodeId: string, actionId: string): void {
    const board = this.#nodes.get(nodeId);
    if (board !== undefined) {
      board.cancel.add(actionId);
    }
  }

  cancelled(nodeId: string): string[] {
    return [...(this.#nodes.get(nodeId)?.cancel ?? [])];
  }
}
