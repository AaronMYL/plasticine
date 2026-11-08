// 桌面客户端的标题栏（11-08《第 7 批》第 1 条，照 ChatGPT 桌面版，设计稿 Strip-Open / Strip-Collapsed）：窗口最上面
// 一条横贯全宽、44 高（TITLEBAR_HEIGHT）的标题栏，底色和图标栏一样。左边让出红绿灯（壳报真实宽度，全屏、Windows 为 0），
// 然后 ← →（⌘[ ⌘]）、收起 / 展开第二栏（⌘\）、一道细线、当前页名；右边是页面放自己操作的槽（TitlebarActions 用 portal
// 放进来），Windows 的最小化 / 最大化 / 关闭在最右端，槽让开它们（壳量出来的 controlsRight）。
// 整条是拖窗口的地方（-webkit-app-region: drag，按钮 no-drag）；Swift Mac App 认不了 CSS，按钮的矩形报给它（window-chrome.ts）。
// 只在桌面客户端里出现（有窗口外观桥时）；网页版、手机没有，页面照原样画自己的页头（useInTitlebar 判断）。

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties,
  type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { WindowChrome } from '../api/shared.ts';
import type { ColumnToggle } from './columns/column-toggle.tsx';
import { toggleShortcut } from './columns/column-toggle.tsx';
import { IconButton } from './icon-button.tsx';
import { goBack, goForward, useNavHistory } from './nav-history.ts';
import { useTitlebarReport } from './window-chrome.ts';
import './titlebar.css';

/** 红绿灯不在时（全屏、Windows、Linux）标题栏左边留的空。 */
const EDGE = 12;

interface TitlebarSlot {
  present: boolean;
  actions: HTMLElement | null;
  /** 页面接管标题栏里的页名；回的函数交还（只交还自己那一次）。 */
  claimTitle: (title: string) => () => void;
}

const NO_TITLEBAR: TitlebarSlot = { present: false, actions: null, claimTitle: () => () => undefined };

const TitlebarContext = createContext<TitlebarSlot>(NO_TITLEBAR);

/** 这一页上面有没有标题栏（桌面客户端）：有就别再画只重复页名的顶栏，操作放进 TitlebarActions。 */
export function useInTitlebar(): boolean {
  return useContext(TitlebarContext).present;
}

/** 页面的操作按钮放进标题栏右边；没有标题栏时不画（页面自己照旧画在页头里）。 */
export function TitlebarActions({ children }: { children: ReactNode }): ReactNode {
  const slot = useContext(TitlebarContext);
  return slot.actions === null ? null : createPortal(children, slot.actions);
}

/** 标题栏里写这一页自己的名字（比如信息流写当前来源），不写壳按地址算的页名。 */
export function TitlebarTitle({ text }: { text: string }): null {
  const { claimTitle } = useContext(TitlebarContext);
  useEffect(() => claimTitle(text), [claimTitle, text]);
  return null;
}

export interface TitlebarState {
  slot: TitlebarSlot;
  /** 页面接管的页名；没有是 null。 */
  claimed: string | null;
  setActions: (element: HTMLElement | null) => void;
}

/** 壳持有标题栏的槽：右边那块的元素、页面接管的页名。 */
export function useTitlebarState(present: boolean): TitlebarState {
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [claim, setClaim] = useState<{ token: number; title: string } | null>(null);
  const tokens = useRef(0);
  const claimTitle = useCallback((title: string) => {
    tokens.current += 1;
    const token = tokens.current;
    setClaim({ token, title });
    return () => setClaim((current) => (current?.token === token ? null : current));
  }, []);
  const slot = useMemo<TitlebarSlot>(() => (present ? { present, actions, claimTitle } : NO_TITLEBAR),
    [present, actions, claimTitle]);
  return { slot, claimed: present ? claim?.title ?? null : null, setActions };
}

export function TitlebarProvider({ state, children }: { state: TitlebarState; children: ReactNode }): ReactNode {
  return <TitlebarContext.Provider value={state.slot}>{children}</TitlebarContext.Provider>;
}

export interface TitlebarProps {
  title: string;
  chrome: WindowChrome;
  /** 这个栏目有第二栏时能收起 / 展开；没有（首页）是 null，按钮不能按。 */
  column: ColumnToggle | null;
  state: TitlebarState;
}

export function Titlebar({ title, chrome, column, state }: TitlebarProps): ReactNode {
  const bar = useRef<HTMLElement>(null);
  const { canBack, canForward } = useNavHistory();
  const shown = state.claimed ?? title;
  useTitlebarReport(bar, `${shown}|${column?.collapsed ?? 'none'}`);
  const style = {
    '--titlebar-lights': `${Math.max(chrome.trafficLightInset, EDGE)}px`,
    '--titlebar-controls': `${chrome.controlsRight ?? 0}px`,
  } as CSSProperties;
  const columnLabel = column?.collapsed === true ? '展开侧栏' : '收起侧栏';
  return (
    <header ref={bar} className="titlebar" style={style} data-tip-side="bottom">
      <IconButton icon="back" label="后退" title="后退 ⌘[" disabled={!canBack} onClick={goBack} />
      <IconButton icon="forward" label="前进" title="前进 ⌘]" disabled={!canForward} onClick={goForward} />
      <IconButton icon="sidebar" label={columnLabel} title={`${columnLabel} ${toggleShortcut()}`}
        disabled={column === null} aria-expanded={column === null ? undefined : !column.collapsed}
        onClick={column?.toggle} />
      <span className="titlebar-rule" aria-hidden="true" />
      <span key={shown} className="titlebar-title">{shown}</span>
      <div ref={state.setActions} className="titlebar-actions" />
    </header>
  );
}
