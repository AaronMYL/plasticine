import { actionLimitMs } from '../../shared/device-action-limits.ts';
import type { NodeBusy, NodeWork } from '../../shared/api/index.ts';

const STUCK_GRACE_MS = 30_000;
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
