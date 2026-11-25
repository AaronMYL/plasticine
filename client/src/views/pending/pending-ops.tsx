import type { ReactNode } from 'react';
import { OpLine } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp, type ActionOp } from '../../state/action-ops.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';

export interface PendingOpsProps {
  label: string;
  prefixes: readonly string[];
  visible: (op: ActionOp) => boolean;
  onRetry: (key: string) => void;
}

export function usePendingOps(prefixes: readonly string[], visible: (op: ActionOp) => boolean): ActionOp[] {
  const ops = useStore(useClientState().actionOps.store);
  return ops.filter(
    (op) => prefixes.some((prefix) => op.key.startsWith(prefix)) && (isOpenOp(op) || !visible(op)),
  );
}

export function PendingOps(props: PendingOpsProps): ReactNode {
  const { actionOps } = useClientState();
  const listed = usePendingOps(props.prefixes, props.visible);
  if (listed.length === 0) {
    return null;
  }
  return (
    <section className="pending-actions" aria-label={props.label}>
      {listed.map((op) => (
        <OpLine
          key={op.key}
          op={{ ...op, label: `${op.label} · ${op.subject}` }}
          onRetry={props.onRetry}
          onDismiss={(key) => actionOps.dismiss(key)}
        />
      ))}
    </section>
  );
}

export function useOp(key: string): ActionOp | undefined {
  const ops = useStore(useClientState().actionOps.store);
  return ops.find((op) => op.key === key);
}
