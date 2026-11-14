// 原语 7 · 浮层 / 抽屉。打开时焦点移进面板，Esc 关闭后焦点回到打开它的入口。
// 电脑上的 panel 不是模态：遮罩只盖它所在的主区（父元素要 position: relative），对话栏照常可用。

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
  /** 设置弹框外层的关联面板也可约束焦点；默认只有手机 drawer 是模态。 */
  modal?: boolean;
  title: string;
  onClose: () => void;
  state?: SheetContentState | undefined;
  error?: string | undefined;
  children?: ReactNode;
  actions?: ReactNode;
  /** 标题前面的小图标块（抖音收藏的类别色方块）；纯装饰。 */
  lead?: ReactNode;
  /** 加在面板上的类（比如内容少的表单用 sheet-fit 让高度随内容）。 */
  className?: string | undefined;
  /**
   * 底部靠右的按钮（「取消 · 保存」，11-14 Aaron 定：右上角只留关闭）：不随内容滚动；手机上并排、44 高。
   * 表单的提交按钮在表单外面，用 form 属性指回表单。读着、读失败时不画。
   */
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

/** 浮层底部那一条（不在浮层里是 undefined；在浮层里、还没挂上或读着是 null）。 */
const SheetFootContext = createContext<HTMLElement | null | undefined>(undefined);

/**
 * 浮层里深处的表单把「取消 · 保存」交给浮层底部（11-14 统一）：在浮层里就送到底部那一条，不在浮层里照原地画。
 * 送到底部的提交按钮在表单外面，要用 form 属性指回表单。
 */
export function SheetFooter({ children, className }: { children: ReactNode; className?: string }): ReactNode {
  const foot = useContext(SheetFootContext);
  if (foot === undefined) return <div className={className ?? 'sheet-foot-inline'}>{children}</div>;
  return foot === null ? null : createPortal(children, foot);
}

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
  return (
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
}
