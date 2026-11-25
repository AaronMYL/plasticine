import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties,
  type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { WindowChrome } from '../api/shared.ts';
import { toggleShortcut, type ColumnToggle } from './columns/column-toggle.tsx';
import { IconButton } from './icon-button.tsx';
import { goBack, goForward, useNavHistory } from './nav-history.ts';
import './titlebar.css';

const EDGE = 12;

interface TitlebarSlot {
  present: boolean;
  actions: HTMLElement | null;
  claimTitle: (title: string, count?: number) => () => void;
}

const NO_TITLEBAR: TitlebarSlot = { present: false, actions: null, claimTitle: () => () => undefined };

const TitlebarContext = createContext<TitlebarSlot>(NO_TITLEBAR);

export function useInTitlebar(): boolean {
  return useContext(TitlebarContext).present;
}

export function TitlebarActions({ children }: { children: ReactNode }): ReactNode {
  const slot = useContext(TitlebarContext);
  return slot.actions === null ? null : createPortal(children, slot.actions);
}

export function TitlebarTitle({ text, count }: { text: string; count?: number | undefined }): null {
  const { claimTitle } = useContext(TitlebarContext);
  useEffect(() => claimTitle(text, count), [claimTitle, text, count]);
  return null;
}

export interface TitlebarClaim {
  title: string;
  count: number | undefined;
}

export interface TitlebarState {
  slot: TitlebarSlot;
  claimed: TitlebarClaim | null;
  setActions: (element: HTMLElement | null) => void;
}

export function useTitlebarState(present: boolean): TitlebarState {
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const [claim, setClaim] = useState<{ token: number; title: string; count: number | undefined } | null>(null);
  const tokens = useRef(0);
  const claimTitle = useCallback((title: string, count?: number) => {
    tokens.current += 1;
    const token = tokens.current;
    setClaim({ token, title, count });
    return () => setClaim((current) => (current?.token === token ? null : current));
  }, []);
  const slot = useMemo<TitlebarSlot>(() => (present ? { present, actions, claimTitle } : NO_TITLEBAR),
    [present, actions, claimTitle]);
  const claimed = useMemo<TitlebarClaim | null>(() => (present && claim !== null
    ? { title: claim.title, count: claim.count } : null), [present, claim]);
  return { slot, claimed, setActions };
}

export function TitlebarProvider({ state, children }: { state: TitlebarState; children: ReactNode }): ReactNode {
  return <TitlebarContext.Provider value={state.slot}>{children}</TitlebarContext.Provider>;
}

export interface TitlebarProps {
  title: string;
  chrome: WindowChrome;
  column: ColumnToggle | null;
  state: TitlebarState;
}

export function Titlebar({ title, chrome, column, state }: TitlebarProps): ReactNode {
  const bar = useRef<HTMLElement>(null);
  const { canBack, canForward } = useNavHistory();
  const shown = state.claimed?.title ?? title;
  const count = state.claimed?.count;
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
      <span key={shown} className="titlebar-title">{shown}
        {count === undefined ? null : <span className="titlebar-count">{count}</span>}</span>
      <div ref={state.setActions} className="titlebar-actions" />
    </header>
  );
}
