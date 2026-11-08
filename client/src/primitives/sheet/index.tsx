// 原语 7 · 浮层 / 抽屉。打开时焦点移进面板，Esc 关闭后焦点回到打开它的入口。
// 电脑上的 panel 不是模态：遮罩只盖它所在的主区（父元素要 position: relative），对话栏照常可用。

import { useRef, type ReactNode } from 'react';
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

export function Sheet(props: SheetProps): ReactNode {
  const panel = useRef<HTMLDivElement>(null);
  const isDrawer = props.variant === 'drawer';
  const modal = props.modal ?? isDrawer;
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
          <Body state={props.state} error={props.error}>
            {props.children}
          </Body>
        </div>
      </div>
    </>
  );
}
