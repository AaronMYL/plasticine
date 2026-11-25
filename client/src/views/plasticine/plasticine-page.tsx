import { PendingOps } from '../pending/pending-ops.tsx';
import { MATE_OP_PREFIXES } from '../mates/mate-actions.ts';
import { useState, type ReactNode } from 'react';
import { MAIN_LINE_ALIAS } from '../../api/shared.ts';

const MAIN_LINE_ID = 'line-main';
import { useLive } from '../../live.tsx';
import { Popover, MenuItem, anchorOf, type PopoverAnchor } from '../../shell/popover.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { TitlebarActions, useInTitlebar } from '../../shell/titlebar.tsx';
import { useStore } from '../../state/use-store.ts';
import { mainLineRoute, parseLineRef, skillsRoute, type Route } from '../../shell/routes.ts';
import { Conversation } from '../conversation/conversation.tsx';
import { SideUiProvider } from '../lines/conversation-ui-context.tsx';
import { LineConversation } from '../lines/line-conversation.tsx';
import { MatesRoster } from '../mates/mates-roster.tsx';
import { useLineMenu } from '../mates/line-menu.tsx';
import { MainAvatar, MateAvatar, GroupAvatar } from '../mates/mate-avatar.tsx';
import { groupWaiting } from '../mates/group-work.ts';
import { MateWorkPanel } from '../mates/mate-work-panel.tsx';
import { ActionItems } from '../../shell/reveal-more.tsx';
import { Sheet } from '../../primitives/sheet/index.tsx';
import { useMainIdentity } from '../mates/main-identity.tsx';
import { messageAuthor } from '../lines/line-origin.ts';
import { WaitMark } from '../../shell/wait-mark.tsx';
import './plasticine.css';
import { PageLoading } from '../../primitives/page-loading/index.tsx';

function LineSearch({ lineId }: { lineId: string }): ReactNode {
  const live = useLive();
  const data = useStore(live.lines.thread(lineId));
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const hits = needle === '' ? [] : data.messages.filter((message) => (message.role === 'user'
    || message.role === 'assistant' || message.role === 'lineReport') && message.text.toLowerCase().includes(needle))
    .slice(-20).reverse();
  const jump = (seq: number): void => {
    const items = [...document.querySelectorAll<HTMLElement>('.line-item[data-seq-from]')];
    const target = items.find((element) => Number(element.dataset['seqFrom']) <= seq
      && seq <= Number(element.dataset['seqTo']));
    const input = target?.querySelector('details.line-input-record');
    if (input instanceof HTMLDetailsElement) input.open = true;
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  return (
    <div className="line-search">
      <label className="line-search-field">
        <Icon name="search" size={14} />
        <input autoFocus aria-label="在记录里找" placeholder="在记录里找" value={query}
          onChange={(event) => setQuery(event.target.value)} />
      </label>
      {needle === '' ? null : hits.length === 0 ? <p className="line-search-empty">没找到</p> : (
        <ul className="line-search-results">
          {hits.map((message) => (
            <li key={message.seq}>
              <button type="button" className="line-search-result" onClick={() => jump(message.seq)}>
                <span className="line-search-who">{messageAuthor(message)}</span>
                <span className="line-search-text">{message.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface PlasticinePageProps {
  route: Route;
  phone: boolean;
  navigate: (route: Route) => void;
}

export function PlasticinePage(props: PlasticinePageProps): ReactNode {
  return <PlasticineChatPage {...props} />;
}

function PlasticineChatPage({ route, phone, navigate }: PlasticinePageProps): ReactNode {
  const [finding, setFinding] = useState(false);
  const [menu, setMenu] = useState<PopoverAnchor | null>(null);
  const lineMenu = useLineMenu(phone, navigate);
  const live = useLive();
  const roster = useStore(live.mates.data);
  const lineList = useStore(live.lines.list).lines;
  const wanted = parseLineRef(route.messageId);
  const mainLineId = lineList.find((item) => item.kind === 'main')?.id ?? MAIN_LINE_ID;
  const routeLineId = route.lineId ?? (wanted !== null && wanted.lineId !== mainLineId ? wanted.lineId : null);
  const mate = roster.mates.find((item) => item.id === route.mateId
    || (routeLineId != null && item.lineId === routeLineId));
  const group = roster.groups.find((item) => item.id === route.mateGroupId
    || (routeLineId != null && item.lineId === routeLineId));
  const sideId = mate?.lineId ?? group?.lineId ?? routeLineId ?? null;
  const [division, setDivision] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const phoneRoot = phone && sideId === null && route.plasticineMain !== true && route.messageId == null;
  const side = useStore(live.lines.thread(sideId ?? MAIN_LINE_ALIAS)).line;
  const lines = useStore(live.lines.list).lines;
  const main = useMainIdentity();
  const title = mate?.name ?? group?.name ?? (sideId === null ? (phoneRoot ? main.name : '主线') : side?.title ?? '对话');
  const topic = sideId === null ? null : side?.topic ?? null;
  const iconSize = phone ? 20 : 16;
  const titled = useInTitlebar();
  const tools = <>
    {titled && group !== undefined ? <span className="mate-group-count">你和 {group.mateIds.length} 位队友</span> : null}
    {topic?.kind === 'feed' ? <IconButton icon="external" size={iconSize} label="去信息流里的原条目"
      onClick={() => navigate({ view: 'feed', noteId: null, feedItemId: topic.ref })} /> : null}
    {phone ? null : <IconButton icon="search" size={iconSize} label="在记录里找" aria-pressed={finding}
      onClick={() => setFinding((value) => !value)} />}
    {group === undefined ? null : <button type="button" className="mate-work-toggle" aria-label="分工"
      aria-pressed={division} onClick={() => setDivision((value) => !value)}>
      <Icon name="tasks" size={16} />分工
      {groupWaiting(group, lines) === 0 ? null
        : <WaitMark count={groupWaiting(group, lines)} />}</button>}
    {(
      <IconButton icon="more" size={iconSize} label="更多" aria-expanded={menu !== null}
        onClick={(event) => setMenu(anchorOf(event.currentTarget))} />
    )}
  </>;
  if ((route.mateId != null && mate === undefined) || (route.mateGroupId != null && group === undefined)) {
    return roster.status === 'ready' ? <p className="block-empty">这位队友或群组暂时找不到。</p> : <PageLoading page />;
  }
  return (
    <div className="messages-plasticine" data-phone={phone} data-side={sideId === null ? undefined : 'true'}>
      {titled ? <TitlebarActions>{tools}</TitlebarActions> : (
        <header className="messages-thread-head">
          {phone && !phoneRoot ? <IconButton icon="back" label="返回主线" onClick={() => navigate(mainLineRoute())} />
            : null}
          <div className="mate-conversation-name">
            {mate !== undefined ? <MateAvatar mate={mate} /> : group !== undefined
              ? <GroupAvatar mates={roster.mates.filter((item) => group.mateIds.includes(item.id))} />
              : <MainAvatar />}
            <div><h2>{title}</h2>{group === undefined ? null : <p>你和 {group.mateIds.length} 位队友</p>}</div>
          </div>
          <span className="messages-thread-spacer" />
          {phoneRoot ? <button type="button" className="text-button" aria-expanded={rosterOpen}
            onClick={() => setRosterOpen(true)}>队友和群组</button> : null}
          {tools}
        </header>
      )}
      {phone ? <PendingOps label="队友待核实的操作" prefixes={MATE_OP_PREFIXES} visible={() => false}
        onRetry={(key) => { void live.mateActions.retry(key); }} /> : null}
      {finding ? <LineSearch lineId={sideId ?? MAIN_LINE_ALIAS} /> : null}
      <div className="mate-chat-body">
      {sideId === null ? <Conversation container="page" /> : (
        <div className="conv conv-page" data-container="page">
          <SideUiProvider lineId={sideId}>
            <LineConversation key={sideId} lineId={sideId} askPage={false} />
          </SideUiProvider>
        </div>
      )}
      {group !== undefined && division ? <MateWorkPanel group={group} phone={phone}
        onClose={() => setDivision(false)} /> : null}
      </div>
      {lineMenu.dialogs}
      {phoneRoot ? (
        <Sheet open={rosterOpen} variant="drawer" title="队友和群组" onClose={() => setRosterOpen(false)}>
          <MatesRoster route={route} phone navigate={(next) => {
            setRosterOpen(false);
            navigate(next.view === 'plasticine' && next.plasticineMain === true ? mainLineRoute() : next);
          }} />
        </Sheet>
      ) : null}
      {menu === null ? null : (
        <Popover anchor={menu} role="menu" align="end" label="对话的更多操作" onClose={() => setMenu(null)}>
          <ActionItems actions={lineMenu.actions(mate !== undefined ? { kind: 'mate', mate }
            : group !== undefined ? { kind: 'group', group } : { kind: 'main' })} anchor={menu}
            onClose={() => setMenu(null)} />
          {phoneRoot ? <MenuItem icon="sparkle" label="技能" onSelect={() => {
            setMenu(null);
            navigate(skillsRoute());
          }} /> : null}
          {phoneRoot ? <MenuItem icon="memory" label="记忆" onSelect={() => {
            setMenu(null);
            navigate({ view: 'memory', noteId: null });
          }} /> : null}
        </Popover>
      )}
    </div>
  );
}
