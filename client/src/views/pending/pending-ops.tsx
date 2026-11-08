// 一页顶上单独列出这一页还没了结的写操作（关切板、今日、信息流各一份，照任务页 pending-actions.tsx 的做法）：核实入口
// 不能只挂在那一行上——关闭已经生效但回执丢了，那一条就离开了关切板；条目点了「不感兴趣」就从列表里收走；回来汇报换成了
// 新的一段——这时只有这里还能用原标识「再核实」或「重发」（审查 88c54ec P1）。
// 被拒了的（服务端说了原因）只在那一件已经不在眼前时列在这里，不然就地显示在那一行上就够。

import type { ReactNode } from 'react';
import { OpLine } from '../../primitives/task-row/op-line.tsx';
import { isOpenOp, type ActionOp } from '../../state/action-ops.ts';
import { useClientState } from '../../state/context.tsx';
import { useStore } from '../../state/use-store.ts';

export interface PendingOpsProps {
  /** 读屏念的名字：「还没了结的关切操作」。 */
  label: string;
  /** 这一页管的操作 key 前缀（`concern:`、`feed:` …）。 */
  prefixes: readonly string[];
  /** 这一件现在在不在眼前（那一行还在列表里）。 */
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

/** 一个操作 key 现在的样子（没有就是 undefined）：表单据此在没了结时锁住输入、显示存下的那句。 */
export function useOp(key: string): ActionOp | undefined {
  const ops = useStore(useClientState().actionOps.store);
  return ops.find((op) => op.key === key);
}
