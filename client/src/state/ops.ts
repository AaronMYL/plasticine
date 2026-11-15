// 从 state/action-ops 里挑出某一样东西（一张卡、一条记账……）还没了结的写操作，给就地那一行（OpLines）用。

import type { ActionOp } from './action-ops.ts';
import { useClientState } from './context.tsx';
import { useStore } from './use-store.ts';

export type OpStatus = 'running' | 'uncertain' | 'unsent' | 'failed';

export interface OpView {
  key: string;
  label: string;
  status: OpStatus;
  error: string | null;
  /** 待核实过的不让「不发了」：它可能已经生效。 */
  unresolved: boolean;
}

function toView(op: ActionOp): OpView {
  return { key: op.key, label: op.label, status: op.status, error: op.error, unresolved: op.unresolved };
}

/** 以 prefix 开头的操作（`ask:<id>:`、`money:<id>:`）。 */
export function useOps(prefix: string): OpView[] {
  const ops = useStore(useClientState().actionOps.store);
  return ops.filter((op) => op.key.startsWith(prefix)).map(toView);
}
