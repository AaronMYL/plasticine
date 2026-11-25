import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './dialog.css';
import './confirm-dialog.css';

export interface ConfirmDialogProps {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps): ReactNode {
  const titleId = useId();
  const bodyId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const before = document.activeElement;
    cancel.current?.focus({ focusVisible: false });
    return () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus({ focusVisible: false });
    };
  }, []);
  const keys = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      props.onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const next = document.activeElement === cancel.current ? confirm.current : cancel.current;
    next?.focus();
  };
  return createPortal(
    <div className="dialog-layer" onMouseDown={(event) => {
      if (event.target === event.currentTarget) props.onCancel();
    }}>
      <div className="dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId}
        aria-describedby={bodyId} onKeyDown={keys}>
        <h2 id={titleId} className="dialog-title">{props.title}</h2>
        <p id={bodyId} className="dialog-text">{props.body}</p>
        {props.error == null ? null : <p className="dialog-error" role="alert">{props.error}</p>}
        <div className="dialog-actions">
          <button ref={cancel} type="button" className="secondary-button" disabled={props.busy === true}
            onClick={props.onCancel}>{props.cancelLabel ?? '取消'}</button>
          <button ref={confirm} type="button" className={props.tone === 'primary' ? 'primary-button' : 'danger-button'}
            disabled={props.busy === true}
            onClick={props.onConfirm}>{props.confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
