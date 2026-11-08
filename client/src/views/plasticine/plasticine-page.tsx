// Plasticine 栏目的主区（11-07 设计稿 Plasticine-Main / Side / Phone-Plasticine）：主线（#/plasticine）或一条旁聊
// （#/plasticine/side/<线>）。顶上一行：标题（「主线」或旁聊的标题），右边「在记录里找」（点了在下面出搜索框）和 ⋯；
// 中间是记录，底下是输入框（这一页本身就是对话，没有「问这一页」；对话框和圆球这时不出）。
// 电脑上切旁聊、开新旁聊、记忆都在第二栏（plasticine-column.tsx）；手机没有第二栏，顶上点「主线 ⌄」切到旁聊、开新旁聊，
// 右边是记忆和新旁聊（设计稿 Phone-Plasticine）。

import { useState, type ReactNode } from 'react';
import { MAIN_LINE_ALIAS, type LineView } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { Popover, MenuItem, anchorOf, type PopoverAnchor } from '../../shell/popover.tsx';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useOpenPanel } from '../../shell/panel.ts';
import { PlasticineMark } from '../../shell/plasticine-mark.tsx';
import { TitlebarActions, useInTitlebar } from '../../shell/titlebar.tsx';
import { useStore } from '../../state/use-store.ts';
import { mainLineRoute, sideRoute, type Route } from '../../shell/routes.ts';
import { Conversation } from '../conversation/conversation.tsx';
import { SideUiProvider } from '../lines/conversation-ui-context.tsx';
import { LineConversation } from '../lines/line-conversation.tsx';
import { messageAuthor } from '../lines/line-origin.ts';
import './plasticine.css';

/** 在已经读到的记录里找（他说的、回答、步骤）：点一条滚到那一句。 */
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

/** 手机顶上「主线 ⌄」：主线、旁聊一条一行（当前的打勾），最下面「新旁聊」。 */
function ChatSwitch({ current, title, navigate }: { current: string | null; title: string;
  navigate: (route: Route) => void }): ReactNode {
  const live = useLive();
  const list = useStore(live.lines.list);
  const [menu, setMenu] = useState<PopoverAnchor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sides = list.lines.filter((line): line is LineView => line.kind === 'side');
  const go = (route: Route): void => {
    setMenu(null);
    navigate(route);
  };
  const create = (): void => {
    setMenu(null);
    void live.lines.openSide({}).then((opened) => {
      if (typeof opened === 'string') setError(opened);
      else navigate(sideRoute(opened.id));
    });
  };
  return (
    <>
      <button type="button" className="thread-switch" aria-label={`${title}，切换对话`} aria-expanded={menu !== null}
        onClick={(event) => setMenu(anchorOf(event.currentTarget))}>
        <PlasticineMark size={18} />
        <span className="thread-switch-title">{title}</span>
        <Icon name="chevron-down" size={12} />
      </button>
      {error === null ? null : <span className="thread-switch-error" role="alert">{error}</span>}
      {menu === null ? null : (
        <Popover anchor={menu} role="menu" align="start" label="切换对话" onClose={() => setMenu(null)}>
          <MenuItem label="主线" checked={current === null} onSelect={() => go(mainLineRoute())} />
          {sides.map((line) => (
            <MenuItem key={line.id} label={line.title} checked={current === line.id}
              onSelect={() => go(sideRoute(line.id))} />
          ))}
          <MenuItem icon="plus" label="新旁聊" onSelect={create} />
        </Popover>
      )}
    </>
  );
}

/** 手机顶上的 +（设计稿 Phone-Plasticine）：开一条新旁聊。电脑上在第二栏顶上。 */
function NewSideButton({ navigate }: { navigate: (route: Route) => void }): ReactNode {
  const live = useLive();
  return <IconButton icon="plus" size={20} label="新旁聊" onClick={() => {
    void live.lines.openSide({}).then((opened) => {
      if (typeof opened !== 'string') navigate(sideRoute(opened.id));
    });
  }} />;
}

export interface PlasticinePageProps {
  route: Route;
  phone: boolean;
  navigate: (route: Route) => void;
}

export function PlasticinePage({ route, phone, navigate }: PlasticinePageProps): ReactNode {
  const [finding, setFinding] = useState(false);
  const [menu, setMenu] = useState<PopoverAnchor | null>(null);
  const openPanel = useOpenPanel();
  const live = useLive();
  const sideId = route.view === 'plasticine' ? route.lineId ?? null : null;
  const side = useStore(live.lines.thread(sideId ?? MAIN_LINE_ALIAS)).line;
  const title = sideId === null ? '主线' : side?.title ?? '旁聊';
  const topic = sideId === null ? null : side?.topic ?? null;
  const iconSize = phone ? 20 : 16;
  // 桌面客户端里页名在标题栏里、这几个按钮放进标题栏右边（11-08），主区不再画这条顶栏。
  const titled = useInTitlebar();
  const tools = <>
    {topic?.kind === 'feed' ? <IconButton icon="external" size={iconSize} label="去信息流里的原条目"
      onClick={() => navigate({ view: 'feed', noteId: null, feedItemId: topic.ref })} /> : null}
    {phone ? null : <IconButton icon="search" size={iconSize} label="在记录里找" aria-pressed={finding}
      onClick={() => setFinding((value) => !value)} />}
    {phone ? <IconButton icon="memory" size={iconSize} label="记忆"
      onClick={() => navigate({ view: 'memory', noteId: null })} /> : null}
    {phone ? <NewSideButton navigate={navigate} /> : null}
    {phone ? null : (
      <IconButton icon="more" size={iconSize} label="更多" aria-expanded={menu !== null}
        onClick={(event) => setMenu(anchorOf(event.currentTarget))} />
    )}
  </>;
  return (
    <div className="messages-plasticine" data-phone={phone} data-side={sideId === null ? undefined : 'true'}>
      {titled ? <TitlebarActions>{tools}</TitlebarActions> : (
        <header className="messages-thread-head">
          {phone ? <ChatSwitch current={sideId} title={title} navigate={navigate} />
            : <h2 className="messages-thread-name"><span className="messages-thread-title">{title}</span></h2>}
          <span className="messages-thread-spacer" />
          {tools}
        </header>
      )}
      {finding ? <LineSearch lineId={sideId ?? MAIN_LINE_ALIAS} /> : null}
      {sideId === null ? <Conversation container="page" /> : (
        <div className="conv conv-page" data-container="page">
          <SideUiProvider lineId={sideId}>
            <LineConversation key={sideId} lineId={sideId} askPage={false} />
          </SideUiProvider>
        </div>
      )}
      {menu === null ? null : (
        <Popover anchor={menu} role="menu" align="end" label="对话的更多操作" onClose={() => setMenu(null)}>
          {sideId === null ? null : <MenuItem icon="back" label="回到主线" onSelect={() => {
            setMenu(null);
            navigate(mainLineRoute());
          }} />}
          <MenuItem icon="sliders" label="模型设置" onSelect={() => {
            setMenu(null);
            openPanel({ kind: 'settings', section: 'ai' });
          }} />
        </Popover>
      )}
    </div>
  );
}
