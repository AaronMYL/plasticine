import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../../shell/icon-button.tsx';
import { useSheetFocus } from './focus.ts';
import type { SheetContentState, SheetVariant } from './states.ts';
import './styles.css';

export type { SheetContentState, SheetVariant } from './states.ts';

export interface SheetProps {
  open: boolean;
  variant: SheetVariant;
  modal?: boolean;
  title: string;
  onClose: () => void;
  state?: SheetContentState | undefined;
  error?: string | undefined;
  children?: ReactNode;
  actions?: ReactNode;
  lead?: ReactNode;
  className?: string | undefined;
  footer?: ReactNode;
}

function Body({ state, error, children }: Pick<SheetProps, 'state' | 'error' | 'children'>): ReactNode {
  if (state === 'loading') {
    return <p className="sheet-note">正在读…</p>;
  }
  if (state === 'failed') {
    return (
      <p className="sheet-note is-error" role="alert">
        {error ?? '没有读到。'}
      </p>
    );
  }
  return children;
}

const SheetFootContext = createContext<HTMLElement | null | undefined>(undefined);

export function SheetFooter({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  const foot = useContext(SheetFootContext);
  if (foot === undefined) return <div className={className ?? 'sheet-foot-inline'}>{children}</div>;
  return foot === null ? null : createPortal(children, foot);
}

const PANEL_HOST = '.shell-main-area';

export function Sheet(props: SheetProps): ReactNode {
  const panel = useRef<HTMLDivElement>(null);
  const [foot, setFoot] = useState<HTMLElement | null>(null);
  const isDrawer = props.variant === 'drawer';
  const modal = props.modal ?? isDrawer;
  const ready = props.state === undefined || props.state === 'ready';
  useSheetFocus(props.open, modal, panel, props.onClose);
  if (!props.open) {
    return null;
  }
  const host = isDrawer ? null : document.querySelector<HTMLElement>(PANEL_HOST);
  const content = (
    <>
      <div className={`sheet-scrim sheet-scrim-${props.variant}`} data-testid="sheet-scrim"
        aria-hidden onClick={props.onClose} />
      <div
        ref={panel}
        className={`sheet sheet-${props.variant}${props.className === undefined ? '' : ` ${props.className}`}`}
        role="dialog"
        aria-label={props.title}
        aria-modal={modal ? true : undefined}
        tabIndex={-1}
      >
        {isDrawer ? <div className="sheet-handle" aria-hidden="true" /> : null}
        <header className="sheet-head">
          {props.lead === undefined ? null : <span className="sheet-lead" aria-hidden="true">{props.lead}</span>}
          <h2 className="sheet-title">{props.title}</h2>
          <div className="sheet-head-actions">
            {props.actions}
            <IconButton icon="close" className="sheet-close" label={`关掉${props.title}`} onClick={props.onClose} />
          </div>
        </header>
        <div className="sheet-body">
          <SheetFootContext.Provider value={ready ? foot : null}>
            <Body state={props.state} error={props.error}>
              {props.children}
            </Body>
          </SheetFootContext.Provider>
        </div>
        {ready ? <footer ref={setFoot} className="sheet-foot">{props.footer}</footer> : null}
      </div>
    </>
  );
  return host === null ? content : createPortal(content, host);
}
