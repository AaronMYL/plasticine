import { useEffect, useState, type ReactNode } from 'react';
import type { ToolGroupView } from '../../api/shared.ts';
import { OpLines } from '../../primitives/task-row/op-line.tsx';
import { useLive } from '../../live.tsx';
import { useStore } from '../../state/use-store.ts';
import { useSignedOps } from '../signing/use-signed-ops.ts';
import { LoadNote } from '../../shell/load-note.tsx';
import { Icon } from '../../shell/icons.tsx';
import { InfoTip } from '../../shell/info-tip.tsx';
import './tools.css';

export function toolGroupOpKey(groupId: string): string {
  return `tool-group:${groupId}`;
}

function GroupRow({ group }: { group: ToolGroupView }): ReactNode {
  const { signer } = useLive();
  const ops = useSignedOps(toolGroupOpKey(group.id));
  const pending = ops.some((op) => op.status !== 'failed');
  const [open, setOpen] = useState(false);
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
  return (
    <li className="tool-group-row" aria-label={group.label}>
      <div className="tool-group-head">
        <span className="tool-group-name">{group.label}
          <span className="tool-group-count">{group.tools.length} 个工具</span></span>
        {group.description === '' ? null : <InfoTip label={`「${group.label}」的说明`} text={group.description} />}
        <button type="button" className="icon-button tool-group-expand" aria-expanded={open}
          aria-label={`${open ? '收起' : '列出'}「${group.label}」的工具`} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />
        </button>
        <input type="checkbox" role="switch" checked={group.enabled} disabled={pending} onChange={toggle}
          aria-label={`${group.label}：${group.enabled ? '开着' : '关着'}`} />
      </div>
      {open ? <p className="text-meta tool-group-tools">{group.tools.join(' · ')}</p> : null}
      <OpLines ops={ops} onRetry={(key) => void signer.retry(key)} onDismiss={(key) => signer.dismiss(key)} />
    </li>
  );
}

export const TOOL_GROUPS_NOTE = '关掉的那组，Plasticine 在对话和任务里都用不了。';

export function ToolGroupsView({ note = true }: { note?: boolean }): ReactNode {
  const { toolGroups } = useLive();
  const groups = useStore(toolGroups.toolGroups.data);
  useEffect(() => {
    toolGroups.toolGroups.open();
  }, [toolGroups.toolGroups]);
  return (
    <div className="tool">
      {note ? <p className="tool-sub">{TOOL_GROUPS_NOTE}</p> : null}
      <LoadNote resource={groups} what="工具组" onRetry={() => void toolGroups.toolGroups.reload()} />
      <ul className="tool-list tool-groups" aria-label="工具组">
        {(groups.value?.groups ?? []).map((group) => (
          <GroupRow key={group.id} group={group} />
        ))}
      </ul>
    </div>
  );
}
