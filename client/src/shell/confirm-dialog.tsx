// 删除前的确认（2026-11-08 他定，设计稿 Library-Delete）：盖住整个窗口的一小块——标题「删除「名字」？」、一行后果、
// 「取消」「删除」（危险色）。焦点先给「取消」（回车不会误删），Esc、点遮罩都是取消；Tab 只在两个按钮之间转。
// 外形是统一的居中小弹框（dialog.css，11-14）：手机上贴底成抽屉；出现时轻弹一下，减少动态效果时不动。

import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './dialog.css';
import './confirm-dialog.css';

export interface ConfirmDialogProps {
  title: string;
  /** 做了会怎样（一行）。 */
  body: string;
  confirmLabel: string;
  /** 不做的那个按钮，默认「取消」（丢草稿时写「接着写」）。 */
  cancelLabel?: string;
  /** 做了收不回、会丢东西的用危险色（默认）；只是要你拿定主意的（恢复到某一版）用主按钮。 */
  tone?: 'danger' | 'primary';
  /** 正在做：两个按钮都不能点。 */
  busy?: boolean;
  /** 没做成的原因（留在框里，可以再点一次）。 */
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
      // 关了焦点回到打开它的地方（⋯ 已经收起时就落在页面上）。
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
