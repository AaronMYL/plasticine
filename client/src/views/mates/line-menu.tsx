import { useState, type ReactNode } from 'react';
import type { MateGroupView, MateView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { ConfirmDialog } from '../../shell/confirm-dialog.tsx';
import { useOpenPanel } from '../../shell/panel.ts';
import type { RevealAction } from '../../shell/reveal-more.tsx';
import type { Route } from '../../shell/routes.ts';
import { useOp } from '../pending/pending-ops.tsx';
import { MainEditor } from './main-identity.tsx';
import { GroupEditor, MateEditor } from './mate-editor.tsx';

export type LineTarget = { kind: 'main' } | { kind: 'mate'; mate: MateView } | { kind: 'group'; group: MateGroupView };

export interface LineMenu {
  actions: (target: LineTarget) => RevealAction[];
  dialogs: ReactNode;
}

function DisableDialog({ mate, onDone }: { mate: MateView; onDone: () => void }): ReactNode {
  const live = useLive();
  const op = useOp(`mates:update:${mate.id}`);
  const on = mate.disabledAt === null;
  return <ConfirmDialog title={on ? '停用这位队友？' : '重新启用队友？'}
    body={on ? '聊天记录会保留，停用后不再接收新任务。' : '这位队友将恢复接收任务。'}
    busy={op?.status === 'running'} error={op?.error ?? null} confirmLabel={on ? '确认停用' : '重新启用'}
    onCancel={onDone} onConfirm={() => {
      void live.mateActions.update(mate, { disabled: on }).then((result) => {
        if (result !== null) onDone();
      });
    }} />;
}

export function useLineMenu(phone: boolean, navigate: (route: Route) => void): LineMenu {
  const openPanel = useOpenPanel();
  const [editing, setEditing] = useState<LineTarget | null>(null);
  const [disabling, setDisabling] = useState<MateView | null>(null);
  const settings: RevealAction = { icon: 'sliders', label: '模型设置',
    onSelect: () => openPanel({ kind: 'settings', section: 'ai' }) };
  const actions = (target: LineTarget): RevealAction[] => {
    if (target.kind === 'main') {
      return [{ icon: 'edit', label: '编辑主线', onSelect: () => setEditing(target) }, settings];
    }
    if (target.kind === 'group') {
      return [{ icon: 'edit', label: '编辑群组', onSelect: () => setEditing(target) }, settings];
    }
    const { mate } = target;
    return [{ icon: 'edit', label: '编辑队友', onSelect: () => setEditing(target) },
      { icon: mate.disabledAt === null ? 'pause' : 'play', label: mate.disabledAt === null ? '停用队友' : '重新启用',
        onSelect: () => setDisabling(mate) }, settings];
  };
  const close = (): void => setEditing(null);
  const dialogs = <>
    {editing?.kind === 'main' ? <MainEditor phone={phone} onClose={close} /> : null}
    {editing?.kind === 'mate' ? <MateEditor mate={editing.mate} phone={phone} navigate={navigate} onClose={close} />
      : null}
    {editing?.kind === 'group' ? <GroupEditor group={editing.group} phone={phone} navigate={navigate}
      onClose={close} /> : null}
    {disabling === null ? null : <DisableDialog mate={disabling} onDone={() => setDisabling(null)} />}
  </>;
  return { actions, dialogs };
}
