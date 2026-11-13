import { useState, type ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { ColumnFoot, ColumnHead, ColumnLink, ColumnNote } from '../../shell/columns/column.tsx';
import { mainChatRoute, mateGroupRoute, mateRoute, sideRoute, skillsRoute, type Route } from '../../shell/routes.ts';
import { useStore } from '../../state/use-store.ts';
import { PendingOps } from '../pending/pending-ops.tsx';
import { MATE_OP_PREFIXES } from './mate-actions.ts';
import { MateAvatar, GroupAvatar } from './mate-avatar.tsx';
import { MateEditor, GroupEditor } from './mate-editor.tsx';
import { MainAvatar, MainEditor, useMainIdentity } from './main-identity.tsx';
import { LegacyChats } from './legacy-chats.tsx';
import './mates.css';

export function MatesRoster({ route, navigate, phone = false }: { route: Route;
  navigate: (route: Route) => void; phone?: boolean }): ReactNode {
  const live = useLive();
  const roster = useStore(live.mates.data);
  const lines = useStore(live.lines.list);
  const [editor, setEditor] = useState<'mate' | 'group' | 'main' | null>(null);
  const main = useMainIdentity();
  const [legacy, setLegacy] = useState(false);
  const root = route.view === 'plasticine' && route.mateId == null && route.mateGroupId == null
    && route.lineId == null;
  return <div className={`mates-roster${phone ? ' mates-roster-phone' : ''}`}>
    {phone ? <header className="mates-phone-head"><h1>{main.name}</h1></header> : <ColumnHead title={main.name} />}
    <div className="column-scroll">
      <div className="mates-main-row">
        <ColumnLink route={mainChatRoute()} current={root} navigate={navigate} label={`${main.name} 主线`}
          lead={<MainAvatar main={main} size={28} />} sub="主线">{main.name}</ColumnLink>
        <IconButton icon="edit" className="mates-main-edit" label="编辑主线" onClick={() => setEditor('main')} />
      </div>
      <PendingOps label="队友待核实的操作" prefixes={MATE_OP_PREFIXES} visible={() => false}
        onRetry={(key) => { void live.mateActions.retry(key); }} />
      {roster.error === null ? null : <ColumnNote>{roster.error}</ColumnNote>}
      <div className="mates-section-head"><h3>队友</h3>
        <IconButton icon="plus" label="添加队友" onClick={() => setEditor('mate')} /></div>
      {roster.mates.map((mate) => {
        const work = lines.lines.filter((line) => line.mateId === mate.id && line.kind === 'background'
          && (line.status === 'running' || line.queued > 0));
        const working = work.length > 0;
        const own = lines.lines.find((line) => line.id === mate.lineId);
        // 第二行平时写职责；它正在做事时写在做什么（11-12：协作状态看得见，不只是一个点）。
        const doing = mate.disabledAt !== null ? null
          : working ? `在做「${work[0]?.title ?? ''}」${work.length > 1 ? `等 ${work.length} 件` : ''}`
            : own?.status === 'running' ? '正在回话' : own?.status === 'waiting' ? '等你回答' : null;
        return <ColumnLink key={mate.id} route={mateRoute(mate.id)} current={route.view === 'plasticine'
          && (route.mateId === mate.id || route.lineId === mate.lineId)}
          navigate={navigate} lead={<MateAvatar mate={mate} />} sub={doing ?? mate.role}
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
    <ColumnFoot>
      <ColumnLink route={skillsRoute()} current={route.view === 'skills'} navigate={navigate}
        lead={<Icon name="sparkle" size={18} />}>技能</ColumnLink>
      <ColumnLink route={{ view: 'memory', noteId: null }} current={route.view === 'memory'}
        navigate={navigate} lead={<Icon name="memory" size={18} />}>记忆</ColumnLink>
    </ColumnFoot>
    {editor === 'mate' ? <MateEditor phone={phone} navigate={navigate} onClose={() => setEditor(null)} /> : null}
    {editor === 'main' ? <MainEditor phone={phone} onClose={() => setEditor(null)} /> : null}
    {editor === 'group' ? <GroupEditor phone={phone} navigate={navigate} onClose={() => setEditor(null)} /> : null}
    {legacy ? <LegacyChats phone={phone} navigate={navigate} onClose={() => setLegacy(false)} /> : null}
  </div>;
}
