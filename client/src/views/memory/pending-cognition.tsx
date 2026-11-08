// 记忆页（约定那一段）顶上单独列出还没了结的确认操作：改约定、确认约定（state/signed-ops）。
// 核实入口不能只挂在那一条上：操作已经生效但回执丢了，事件流或刷新把那一条移走，条目上的「再核实」也跟着没了——这里还能用原标识核实或重发（审查 5087993 P1，照任务页的
// PendingActions）。那一条还在眼前的，就地那一行管，这里不重复列。

import type { ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { OpLine, type OpView } from '../../primitives/task-row/op-line.tsx';
import { useClientState } from '../../state/context.tsx';
import type { SignedOp } from '../../state/signed-ops.ts';
import { useStore } from '../../state/use-store.ts';

interface Listed {
  view: OpView;
  retry: () => void;
  dismiss: () => void;
}

/** 设备的确认操作在设备页列，这里返回 null。 */
function signedTarget(op: SignedOp): string | null {
  const { target } = op;
  if (target.kind === 'agreement_edit') {
    return `pending:${op.key}`;
  }
  return target.kind === 'agreement_confirm' ? target.agreementId : null;
}

function view(op: SignedOp): OpView {
  const subject = op.subject === '' ? '' : ` · ${op.subject}`;
  const { key, status, error, unresolved } = op;
  return { key, label: `${op.label}${subject}`, status, error, unresolved };
}

/** 约定那一段眼前画着的约定，就地那一行管，这里不重复列。 */
export function PendingCognition(): ReactNode {
  const live = useLive();
  const { signedOps } = useClientState();
  const signed = useStore(signedOps.store);
  const agreements = useStore(live.agreements.data);
  const shown = new Set(agreements.agreements.items.map((item) => item.id));
  const listed: Listed[] = [];
  for (const op of signed) {
    const target = signedTarget(op);
    if (target === null || shown.has(target)) {
      continue;
    }
    const retry = (): void => void live.signer.retry(op.key);
    listed.push({ view: view(op), retry, dismiss: () => live.signer.dismiss(op.key) });
  }
  return listed.length === 0 ? null : (
    <section className="pending-actions" aria-label="还没了结的操作">
      {listed.map((item) => (
        <OpLine key={item.view.key} op={item.view} onRetry={item.retry} onDismiss={item.dismiss} />
      ))}
    </section>
  );
}
