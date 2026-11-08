// 工具组开关由本人会话确认；保留忙碌状态与结果待核实，改动从下一轮使用工具起生效。

import { useEffect, type ReactNode } from 'react';
import type { ToolGroupView } from '../../api/shared.ts';
import { OpLines } from '../../primitives/task-row/op-line.tsx';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { useSignedOps } from '../signing/use-signed-ops.ts';
import { LoadNote } from '../m5b/load-note.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import './tools.css';

export function toolGroupOpKey(groupId: string): string {
  return `tool-group:${groupId}`;
}

function GroupRow({ group }: { group: ToolGroupView }): ReactNode {
  const { signer } = useLive();
  const ops = useSignedOps(toolGroupOpKey(group.id));
  const pending = ops.some((op) => op.status !== 'failed');
  const toggle = (): void => {
    const enabled = !group.enabled;
    void signer.send(
      toolGroupOpKey(group.id),
      enabled ? '打开' : '关掉',
      group.label,
      { kind: 'tool_group', groupId: group.id },
      (requestId) => ({ requestId, version: group.version, enabled }),
    );
  };
  // 原型（用户视角审查 2026-11-01 第 12 条）：名称 + 开关一行，工具 id 折叠在「详情」里。11-04 重做悬停：这组能做什么
  // 是补充，放在名字后的 ⓘ 里（读屏经 aria-description 念到）。
  return (
    <li className="tool-group-row" aria-label={group.label}>
      <div className="tool-group-head">
        <span className="tool-group-name">{group.label}</span>
        {group.description === '' ? null : <InfoTip label={`「${group.label}」的说明`} text={group.description} />}
        {/* 2026-11-03：「开着」小签 + 「关掉」按钮换成一个开关。 */}
        <input type="checkbox" role="switch" checked={group.enabled} disabled={pending} onChange={toggle}
          aria-label={`${group.label}：${group.enabled ? '开着' : '关着'}`} />
      </div>
      <details className="tool-group-details">
        <summary className="text-meta">{group.tools.length}</summary>
        <p className="text-meta">{group.tools.join(' · ')}</p>
      </details>
      <OpLines ops={ops} onRetry={(key) => void signer.retry(key)} onDismiss={(key) => signer.dismiss(key)} />
    </li>
  );
}

/** 工具组的总说明：工具面板里常显；设置 · AI 里在「工具开关」段标题后的 ⓘ 里（2026-11-04）。 */
export const TOOL_GROUPS_NOTE = '关掉的那组，Plasticine 在对话和任务里都用不了。';

export function ToolGroupsView({ note = true }: { note?: boolean }): ReactNode {
  const { m5b } = useLive();
  const groups = useStore(m5b.toolGroups.data);
  useEffect(() => {
    m5b.toolGroups.open();
  }, [m5b.toolGroups]);
  return (
    <div className="tool">
      {note ? <p className="tool-sub">{TOOL_GROUPS_NOTE}</p> : null}
      <LoadNote resource={groups} what="工具组" onRetry={() => void m5b.toolGroups.reload()} />
      <ul className="tool-list tool-groups" aria-label="工具组">
        {(groups.value?.groups ?? []).map((group) => (
          <GroupRow key={group.id} group={group} />
        ))}
      </ul>
    </div>
  );
}
