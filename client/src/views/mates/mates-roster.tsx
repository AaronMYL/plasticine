import { useState, type ReactNode } from 'react';
import { useLive } from '../../live.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon, type IconName } from '../../shell/icons.tsx';
import { RevealMore } from '../../shell/reveal-more.tsx';
import { ColumnHead, ColumnLink, ColumnNote } from '../../shell/columns/column.tsx';
import { mainChatRoute, mateGroupRoute, mateRoute, routeHash, sideRoute, skillsRoute, type Route }
  from '../../shell/routes.ts';
import { useStore } from '../../state/use-store.ts';
import { PendingOps } from '../pending/pending-ops.tsx';
import { MATE_OP_PREFIXES } from './mate-actions.ts';
import { groupWaiting } from './group-work.ts';
import { MainAvatar, MateAvatar, GroupAvatar } from './mate-avatar.tsx';
import { MateEditor, GroupEditor } from './mate-editor.tsx';
import { useMainIdentity } from './main-identity.tsx';
import { useLineMenu } from './line-menu.tsx';
import { LegacyChats } from './legacy-chats.tsx';
import { WaitMark } from '../../shell/wait-mark.tsx';
import './mates.css';

/**
 * 标题那一行右边的「技能」「记忆」（11-15 Aaron：「去掉文字，只留图标，像其他页面的第二栏一样」）：和别的栏目标题行的图标按钮
 * 一个样子，名字在悬停提示和读屏里；在哪一页那一个按下去（--tint2 底、图标用字色）。
 */
function HeadLink({ route, current, navigate, icon, label }: { route: Route; current: boolean;
  navigate: (route: Route) => void; icon: IconName; label: string }): ReactNode {
  return <a href={routeHash(route)} className="icon-button mates-head-link" aria-label={label} data-tip={label}
    aria-current={current ? 'page' : undefined} onClick={(event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      navigate(route);
    }}><Icon name={icon} size={16} /></a>;
}

export function MatesRoster({ route, navigate, phone = false }: { route: Route;
  navigate: (route: Route) => void; phone?: boolean }): ReactNode {
  const live = useLive();
  const roster = useStore(live.mates.data);
  const lines = useStore(live.lines.list);
  const [editor, setEditor] = useState<'mate' | 'group' | null>(null);
  const menu = useLineMenu(phone, navigate);
  const main = useMainIdentity();
  const [legacy, setLegacy] = useState(false);
  const root = route.view === 'plasticine' && route.mateId == null && route.mateGroupId == null
    && route.lineId == null;
  const entries = <span className="mates-head-links">
    <HeadLink route={skillsRoute()} current={route.view === 'skills'} navigate={navigate} icon="sparkle" label="技能" />
    <HeadLink route={{ view: 'memory', noteId: null }} current={route.view === 'memory'} navigate={navigate}
      icon="memory" label="记忆" />
  </span>;
  return <div className={`mates-roster${phone ? ' mates-roster-phone' : ''}`}>
    {/* 11-15 Aaron 弹框定（设计稿 23）：标题一直写 Plasticine，不跟着主线改的名字；技能、记忆在标题那一行右边。 */}
    {phone ? <header className="mates-phone-head"><h1>Plasticine</h1>{entries}</header>
      : <ColumnHead title="Plasticine">{entries}</ColumnHead>}
    <div className="column-scroll">
      <div className="column-row">
        <ColumnLink route={mainChatRoute()} current={root} navigate={navigate} label={`${main.name} 主线`}
          lead={<MainAvatar size={28} />} sub="主线">{main.name}</ColumnLink>
        <RevealMore label={`「${main.name}」主线的更多操作`} actions={menu.actions({ kind: 'main' })} />
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
        // 第二行平时写职责；它正在做事时写在做什么（11-12：协作状态看得见，不只是一个点）。在做事的那个点去掉了：
        // 头像自己会动（11-13）。
        const doing = mate.disabledAt !== null ? null
          : working ? `在做「${work[0]?.title ?? ''}」${work.length > 1 ? `等 ${work.length} 件` : ''}`
            : own?.status === 'running' ? '正在回话' : own?.status === 'waiting' ? '等你回答' : null;
        return <div key={mate.id} className="column-row"><ColumnLink route={mateRoute(mate.id)}
          current={route.view === 'plasticine' && (route.mateId === mate.id || route.lineId === mate.lineId)}
          navigate={navigate} lead={<MateAvatar mate={mate} />} sub={doing ?? mate.role}
          trail={mate.disabledAt !== null ? <span className="mate-state">已停用</span> : undefined}>
          {mate.name}</ColumnLink>
          <RevealMore label={`「${mate.name}」的更多操作`} actions={menu.actions({ kind: 'mate', mate })} /></div>;
      })}
      <div className="mates-section-head"><h3>群组</h3>
        <IconButton icon="plus" label="创建队友群组" onClick={() => setEditor('group')} /></div>
      {roster.groups.map((group) => <div key={group.id} className="column-row"><ColumnLink
        route={mateGroupRoute(group.id)} current={route.mateGroupId === group.id || route.lineId === group.lineId}
        navigate={navigate}
        lead={<GroupAvatar mates={roster.mates.filter((mate) => group.mateIds.includes(mate.id))} />}
        sub={`${group.mateIds.length} 位队友`}
        trail={groupWaiting(group, lines.lines) === 0 ? undefined
          : <WaitMark count={groupWaiting(group, lines.lines)} />}>{group.name}</ColumnLink>
        <RevealMore label={`「${group.name}」的更多操作`} actions={menu.actions({ kind: 'group', group })} /></div>)}
      {roster.legacyChats.length === 0 ? null : <div className="mates-legacy">
        <button type="button" className="text-button" onClick={() => setLegacy(true)}>整理原来的对话</button>
        {roster.legacyChats.map((chat) => <ColumnLink key={chat.lineId} route={sideRoute(chat.lineId)}
          current={route.lineId === chat.lineId} navigate={navigate} lead={<Icon name="thread" size={16} />}>
          {chat.title}</ColumnLink>)}
      </div>}
    </div>
    {editor === 'mate' ? <MateEditor phone={phone} navigate={navigate} onClose={() => setEditor(null)} /> : null}
    {menu.dialogs}
    {editor === 'group' ? <GroupEditor phone={phone} navigate={navigate} onClose={() => setEditor(null)} /> : null}
    {legacy ? <LegacyChats phone={phone} navigate={navigate} onClose={() => setLegacy(false)} /> : null}
  </div>;
}
