// 一条判断、一条约定上还没了结的确认操作，画成和任务条一样的那一行（primitives/task-row/op-line）。

import type { OpView } from '../../primitives/task-row/op-line.tsx';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';

export function useSignedOps(prefix: string): OpView[] {
  const ops = useStore(useClientState().signedOps.store);
  return ops
    .filter((op) => op.key.startsWith(prefix))
    .map((op) => ({ key: op.key, label: op.label, status: op.status, error: op.error, unresolved: op.unresolved }));
}
