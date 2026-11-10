import { useState, type ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { PlasticineMark } from '../../shell/plasticine-mark.tsx';
import { ColumnFoot, ColumnHead, ColumnLink, ColumnNote } from '../../shell/columns/column.tsx';
import { mainChatRoute, mateGroupRoute, mateRoute, sideRoute, soulRoute, type Route } from '../../shell/routes.ts';
import { useStore } from '../../state/use-store.ts';
import { PendingOps } from '../pending/pending-ops.tsx';
import { MATE_OP_PREFIXES } from './mate-actions.ts';
import { MateAvatar, GroupAvatar } from './mate-avatar.tsx';
import { MateEditor, GroupEditor } from './mate-editor.tsx';
import { LegacyChats } from './legacy-chats.tsx';
import './mates.css';

export function MatesRoster({ route, navigate, phone = false }: { route: Route;
  navigate: (route: Route) => void; phone?: boolean }): ReactNode {
  const live = useLive();
  const roster = useStore(live.mates.data);
  const lines = useStore(live.lines.list);
  const [editor, setEditor] = useState<'mate' | 'group' | null>(null);
  const [legacy, setLegacy] = useState(false);
  const root = route.view === 'plasticine' && route.mateId == null && route.mateGroupId == null && route.lineId == null
    && route.plasticineSoul !== true;
  return <div className={`mates-roster${phone ? ' mates-roster-phone' : ''}`}>
    {phone ? <header className="mates-phone-head"><h1>Plasticine</h1></header> : <ColumnHead title="Plasticine" />}
    <div className="column-scroll">
      <ColumnLink route={mainChatRoute()} current={root} navigate={navigate} label="Plasticine 主线"
        lead={<PlasticineMark size={28} />} sub="主线">Plasticine</ColumnLink>
      <PendingOps label="队友待核实的操作" prefixes={MATE_OP_PREFIXES} visible={() => false}
        onRetry={(key) => { void live.mateActions.retry(key); }} />
      {roster.error === null ? null : <ColumnNote>{roster.error}</ColumnNote>}
      <div className="mates-section-head"><h3>队友</h3>
        <IconButton icon="plus" label="添加队友" onClick={() => setEditor('mate')} /></div>
      {roster.mates.map((mate) => {
        const working = lines.lines.some((line) => line.mateId === mate.id && line.kind === 'background'
          && (line.status === 'running' || line.queued > 0));
        return <ColumnLink key={mate.id} route={mateRoute(mate.id)} current={route.plasticineSoul !== true
          && (route.mateId === mate.id || route.lineId === mate.lineId)}
          navigate={navigate} lead={<MateAvatar mate={mate} />} sub={mate.role}
          trail={mate.disabledAt !== null ? <span className="mate-state">已停用</span>
            : working ? <span className="mate-working" aria-label="正在做事" /> : undefined}>{mate.name}</ColumnLink>;
      })}
      <div className="mates-section-head"><h3>群组</h3>
        <IconButton icon="plus" label="创建队友群组" onClick={() => setEditor('group')} /></div>
      {roster.groups.map((group) => <ColumnLink key={group.id} route={mateGroupRoute(group.id)}
        current={route.mateGroupId === group.id || route.lineId === group.lineId} navigate={navigate}
        lead={<GroupAvatar mates={roster.mates.filter((mate) => group.mateIds.includes(mate.id))} />}
        sub={`${group.mateIds.length} 位队友`}>{group.name}</ColumnLink>)}
      {roster.legacyChats.length === 0 ? null : <div className="mates-legacy">
        <button type="button" className="text-button" onClick={() => setLegacy(true)}>整理原来的对话</button>
        {roster.legacyChats.map((chat) => <ColumnLink key={chat.lineId} route={sideRoute(chat.lineId)}
          current={route.lineId === chat.lineId} navigate={navigate} lead={<Icon name="thread" size={16} />}>
          {chat.title}</ColumnLink>)}
      </div>}
    </div>
    <ColumnFoot><ColumnLink route={{ view: 'memory', noteId: null }} current={route.view === 'memory'}
      navigate={navigate} lead={<Icon name="memory" size={18} />}>记忆</ColumnLink>
      <ColumnLink route={soulRoute()} current={route.plasticineSoul === true} navigate={navigate}
        lead={<Icon name="sparkle" size={18} />}>Soul</ColumnLink></ColumnFoot>
    {editor === 'mate' ? <MateEditor phone={phone} navigate={navigate} onClose={() => setEditor(null)} /> : null}
    {editor === 'group' ? <GroupEditor phone={phone} navigate={navigate} onClose={() => setEditor(null)} /> : null}
    {legacy ? <LegacyChats phone={phone} navigate={navigate} onClose={() => setLegacy(false)} /> : null}
  </div>;
}
