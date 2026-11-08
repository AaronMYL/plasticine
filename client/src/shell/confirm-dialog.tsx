// 删除前的确认（2026-11-08 他定，设计稿 Library-Delete）：盖住整个窗口的一小块——标题「删除「名字」？」、一行后果、
// 「取消」「删除」（危险色）。焦点先给「取消」（回车不会误删），Esc、点遮罩都是取消；Tab 只在两个按钮之间转。
// 出现时淡入并上浮一点（settings-dialog 的「有没保存的修改」同一套），减少动态效果时不动。

import { useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MOTION, play } from './motion.ts';
import './confirm-dialog.css';

const ENTER: Keyframe[] = [
  { opacity: 0, transform: 'translateY(6px) scale(0.98)' },
  { opacity: 1, transform: 'translateY(0) scale(1)' },
];
const FADE_IN: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];

export interface ConfirmDialogProps {
  title: string;
  /** 做了会怎样（一行）。 */
  body: string;
  confirmLabel: string;
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
  const box = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const before = document.activeElement;
    cancel.current?.focus({ focusVisible: false });
    play(scrim.current, FADE_IN, MOTION.fast);
    play(box.current, ENTER, MOTION.fast);
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
    <div ref={scrim} className="confirm-layer" onMouseDown={(event) => {
      if (event.target === event.currentTarget) props.onCancel();
    }}>
      <div ref={box} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId}
        aria-describedby={bodyId} onKeyDown={keys}>
        <h2 id={titleId} className="confirm-title">{props.title}</h2>
        <p id={bodyId} className="confirm-body">{props.body}</p>
        {props.error == null ? null : <p className="confirm-error" role="alert">{props.error}</p>}
        <div className="confirm-actions">
          <button ref={cancel} type="button" className="secondary-button" disabled={props.busy === true}
            onClick={props.onCancel}>取消</button>
          <button ref={confirm} type="button" className="danger-button" disabled={props.busy === true}
            onClick={props.onConfirm}>{props.confirmLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
