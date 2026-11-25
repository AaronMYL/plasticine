import { useState, type ReactNode } from 'react';
import type { LineView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { ConfirmDialog } from '../../shell/confirm-dialog.tsx';
import { DropdownMenu, SEPARATOR, type DropdownEntry } from '../../shell/dropdown-menu.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useOpenPanel } from '../../shell/panel.ts';
import './task-menu.css';

export type TaskPhase = 'active' | 'paused' | 'ended' | 'deleted';

export function taskPhase(line: Pick<LineView, 'status' | 'pauseReason' | 'archivedAt'>): TaskPhase {
  if (line.archivedAt != null) return 'deleted';
  if (line.status === 'running' || line.status === 'queued' || line.status === 'waiting') return 'active';
  if (line.status === 'paused' && line.pauseReason !== 'stopped') return 'paused';
  if (line.status === 'failed') return 'paused';
  return 'ended';
}

export interface TaskMenuProps {
  line: LineView;
  onError: (error: string | null) => void;
  onDeleted?: (line: LineView) => void;
}

export function TaskMenu({ line, onError, onDeleted }: TaskMenuProps): ReactNode {
  const live = useLive();
  const openPanel = useOpenPanel();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const phase = taskPhase(line);
  if (line.kind === 'main') return null;
  const run = (work: () => Promise<string | null>, done?: () => void): void => {
    onError(null);
    void work().then((error) => {
      onError(error);
      if (error === null) done?.();
    });
  };
  const items: DropdownEntry[] = [];
  if (phase === 'active') {
    items.push({ label: '暂停', icon: 'pause', onSelect: () => run(() => live.lines.pause(line.id)) });
  }
  if (phase === 'paused' && line.pauseReason !== 'stopped') {
    items.push({ label: '继续', icon: 'play', onSelect: () => run(() => live.lines.resume(line.id)) });
  }
  if (phase === 'active' || phase === 'paused') {
    items.push({ label: '停止…', icon: 'stop', onSelect: () => setConfirming(true) });
  }
  if (phase === 'deleted') {
    items.push({ label: '恢复', icon: 'undo', onSelect: () => run(() => live.lines.restore(line.id)) });
  } else {
    items.push({ label: '删除', icon: 'trash',
      onSelect: () => run(() => live.lines.remove(line.id), () => onDeleted?.(line)) });
  }
  items.push(SEPARATOR,
    { label: '打开这件事', icon: 'external', onSelect: () => openPanel({ kind: 'work', lineId: line.id }) });
  const stop = (): void => {
    setBusy(true);
    setStopError(null);
    void live.lines.end(line.id).then((error) => {
      setBusy(false);
      if (error === null) setConfirming(false);
      else setStopError(error);
    });
  };
  return <>
    <DropdownMenu label={`更多操作：${line.title}`} tip="更多操作" className="icon-button task-menu" align="end" rowMenu
      items={items}><Icon name="more" size={16} /></DropdownMenu>
    {confirming ? <ConfirmDialog title={`停止「${line.title}」？`}
      body="停止后不能再继续。做过的过程和结果保留在「已结束」里。" confirmLabel="停止" busy={busy} error={stopError}
      onConfirm={stop} onCancel={() => setConfirming(false)} /> : null}
  </>;
}

export function DeletedTask({ line, onUndone }: { line: LineView; onUndone: () => void }): ReactNode {
  const live = useLive();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="task-gone" role={error === null ? 'status' : 'alert'}>
      <span className="task-gone-text">{error ?? `已删除「${line.title}」`}</span>
      <button type="button" className="task-gone-undo" onClick={() => void live.lines.restore(line.id).then((next) => {
        setError(next);
        if (next === null) onUndone();
      })}><Icon name="undo" size={14} /><span>撤销</span></button>
    </div>
  );
}
