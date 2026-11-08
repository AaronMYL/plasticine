import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { BrowserTabAction } from '../../api/shared.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { useDismiss } from '../../shell/use-dismiss.ts';

export function BrowserActions({ onAction }: { onAction(action: BrowserTabAction): void }): ReactNode {
  const [open, setOpen] = useState(false);
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);
  useDismiss({ open, inside: [container], anchor: trigger, onDismiss: (reason) => {
    setOpen(false);
    if (reason === 'escape') trigger.current?.focus();
  } });
  const choose = (action: BrowserTabAction): void => {
    setOpen(false);
    onAction(action);
    trigger.current?.focus();
  };
  return <div className="browser-more" ref={container} onBlur={(event) => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <IconButton icon="more" label="更多浏览器操作" ref={trigger} aria-expanded={open}
      aria-controls={open ? id : undefined} onClick={() => setOpen((value) => !value)} />
    {open ? <div className="browser-actions-menu" id={id} role="group" aria-label="浏览器操作">
      <p className="tool-sub">云端浏览器 · 登录和验证在这里完成</p>
      <button ref={first} type="button" className="browser-menu-item"
        onClick={() => choose({ kind: 'close_all' })}><Icon name="close" />关掉所有标签页</button>
      <button type="button" className="browser-menu-item"
        onClick={() => choose({ kind: 'clear_login' })}><Icon name="trash" />清空登录</button>
    </div> : null}
  </div>;
}
