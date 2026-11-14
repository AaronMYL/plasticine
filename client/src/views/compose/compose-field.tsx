// 预测消息（11-13）：输入框和它上面那层浅色字。两者叠在同一个格子里：外面这层和输入框用同一个 className（字号、行高、
// 内边距、手机上的放大都一样），里面先放一份透明的草稿把位置占住，后面接浅色字；浅色字长出框时，格子跟着长，输入框
// 拉伸到同样高。整层不接点击，只有浅色字能点（按下就拦住失焦，点了采纳）。电脑上浅色字后面跟一个 Tab 小签。

import type { ReactNode } from 'react';
import './compose.css';

export interface ComposeFieldProps {
  /** 输入框本身（调用方原样给）。 */
  children: ReactNode;
  /** 输入框的 className：浅色字那一层照抄它的排版。 */
  inputClass: string;
  draft: string;
  ghost: string | null;
  phone: boolean;
  onAccept: () => void;
  /** 输入框滚到哪了：浅色字那层跟着滚。 */
  scrollTop: number;
}

export function ComposeField({ children, inputClass, draft, ghost, phone, onAccept, scrollTop }: ComposeFieldProps)
  : ReactNode {
  return (
    <div className="compose-field">
      {children}
      {ghost === null ? null : (
        <div className={`${inputClass} compose-ghost-layer`} aria-hidden="true"
          ref={(element) => { if (element !== null) element.scrollTop = scrollTop; }}>
          <span className="compose-ghost-draft">{draft}</span>
          <span className="compose-ghost" onMouseDown={(event) => event.preventDefault()}
            onClick={onAccept}>{ghost}</span>
          {phone ? null : <span className="compose-ghost-key mono">Tab</span>}
        </div>
      )}
    </div>
  );
}
