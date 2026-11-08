// 从 state/action-ops 里挑出某一样东西（一张卡、一条记账……）还没了结的写操作，给就地那一行（OpLines）用。

import type { OpView } from '../primitives/task-row/op-line.tsx';
import type { ActionOp } from './action-ops.ts';
import { useClientState } from './context.tsx';
import { useStore } from './use-store.ts';

function toView(op: ActionOp): OpView {
  return { key: op.key, label: op.label, status: op.status, error: op.error, unresolved: op.unresolved };
}

/** 以 prefix 开头的操作（`ask:<id>:`、`money:<id>:`）。 */
export function useOps(prefix: string): OpView[] {
  const ops = useStore(useClientState().actionOps.store);
  return ops.filter((op) => op.key.startsWith(prefix)).map(toView);
}
