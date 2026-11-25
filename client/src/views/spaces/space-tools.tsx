import type { ReactNode } from 'react';
import type { SpaceView } from '../../api/shared.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { RevealMore, type RevealAction } from '../../shell/reveal-more.tsx';

export interface SpaceToolsProps {
  space: SpaceView;
  phone: boolean;
  editing: boolean;
  onAsk: () => void;
  onEdit: (on: boolean) => void;
  onRename: () => void;
  onSettings: () => void;
  onDelete: () => void;
  onVersions?: () => void;
  onExport: () => void;
}

function moreActions(props: SpaceToolsProps, letter: boolean): RevealAction[] {
  const { space, phone } = props;
  const actions: RevealAction[] = [];
  if (letter && phone) actions.push({ icon: 'reply', label: '回信', onSelect: props.onAsk });
  if (letter && space.html !== null) actions.push({ icon: 'edit', label: '改字', onSelect: () => props.onEdit(true) });
  if (!letter && phone && space.html !== null) {
    actions.push({ icon: 'edit', label: '改字', onSelect: () => props.onEdit(true) });
  }
  actions.push({ icon: 'edit', label: '改名', onSelect: props.onRename });
  if (props.onVersions !== undefined) {
    actions.push({ icon: 'clock', label: '版本记录', onSelect: props.onVersions });
  }
  if (space.subscription !== null) actions.push({ icon: 'sliders', label: '订阅设置', onSelect: props.onSettings });
  actions.push({ icon: 'download', label: '导出…', onSelect: props.onExport });
  actions.push({ icon: 'trash', label: '删除', danger: true, onSelect: props.onDelete });
  return actions;
}

export function SpaceTools(props: SpaceToolsProps): ReactNode {
  const { space, phone, editing } = props;
  const letter = space.genre === 'letter';
  const done = <button type="button" className="primary-button button-small space-done"
    onClick={() => props.onEdit(false)}>完成</button>;
  const more = editing ? done : <RevealMore label={`「${space.title}」的更多操作`} actions={moreActions(props, letter)} />;
  if (phone) {
    return <>
      {letter || editing ? null : <IconButton icon="sparkle" label="让 Plasticine 改" onClick={props.onAsk} />}
      {more}
    </>;
  }
  return <>
    <button type="button" className="secondary-button button-small space-ask" onClick={props.onAsk}>
      <Icon name={letter ? 'reply' : 'sparkle'} size={14} />{letter ? '回信' : '让 Plasticine 改'}</button>
    {letter || space.html === null ? null : (
      <IconButton icon="edit" label="改字" aria-pressed={editing} className="space-edit-toggle"
        onClick={() => props.onEdit(!editing)} />
    )}
    {more}
  </>;
}
