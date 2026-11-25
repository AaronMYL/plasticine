import type { ActionOp } from './action-ops.ts';
import { useClientState } from './context.tsx';
import { useStore } from './use-store.ts';

export type OpStatus = 'running' | 'uncertain' | 'unsent' | 'failed';

export interface OpView {
  key: string;
  label: string;
  status: OpStatus;
  error: string | null;
  unresolved: boolean;
}

function toView(op: ActionOp): OpView {
  return { key: op.key, label: op.label, status: op.status, error: op.error, unresolved: op.unresolved };
}

export function useOps(prefix: string): OpView[] {
  const ops = useStore(useClientState().actionOps.store);
  return ops.filter((op) => op.key.startsWith(prefix)).map(toView);
}
