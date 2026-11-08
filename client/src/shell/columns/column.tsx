// 第二栏的共用部件（11-07 设计稿 kit.mjs 的 col / colh / ci / clabel / cfoot）：252 宽、--layer-side 底、右边一道 1px 线；
// 顶上一行 56（栏目名 + 一两个图标按钮 + 最右边的收起按钮，column-toggle.tsx），下面是一行行入口（34 高、圆角 8，当前那行 --tint2 底），小节标题 11/16·500，
// 最底下可以有一块贴底的（Plasticine 的记忆、网页的新标签）。行是链接（有地址）或按钮（就地动作）。

import type { MouseEvent, ReactNode } from 'react';
import { routeHash, type Route } from '../routes.ts';
import { ColumnCollapseButton } from './column-toggle.tsx';

export function ColumnHead({ title, children }: { title: string; children?: ReactNode }): ReactNode {
  return (
    <div className="column-head">
      <h2 className="column-title">{title}</h2>
      <span className="column-head-tools">
        {children}
        <ColumnCollapseButton />
      </span>
    </div>
  );
}

export function ColumnLabel({ children }: { children: ReactNode }): ReactNode {
  return <h3 className="column-label">{children}</h3>;
}

export interface ColumnLinkProps {
  route: Route;
  current: boolean;
  navigate: (route: Route) => void;
  lead?: ReactNode;
  /** 行尾：个数（等宽）、时间、状态点。 */
  trail?: ReactNode;
  /** 第二行（主线下面一行最新状态）。 */
  sub?: ReactNode;
  label?: string;
  children: ReactNode;
  className?: string;
}

/** 一行入口：有地址，⌘ 点开在新窗口照浏览器默认；普通点击走壳的导航（多一步历史）。 */
export function ColumnLink(props: ColumnLinkProps): ReactNode {
  const open = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    props.navigate(props.route);
  };
  return (
    <a href={routeHash(props.route)} className={`column-item ${props.className ?? ''}`.trim()}
      aria-current={props.current ? 'page' : undefined} aria-label={props.label} onClick={open}>
      {props.lead === undefined ? null : <span className="column-item-lead">{props.lead}</span>}
      {props.sub === undefined ? <span className="column-item-text">{props.children}</span> : (
        <span className="column-item-two">
          <span className="column-item-text">{props.children}</span>
          <span className="column-item-sub">{props.sub}</span>
        </span>
      )}
      {props.trail === undefined ? null : <span className="column-item-trail">{props.trail}</span>}
    </a>
  );
}

/** 行尾的个数：零不写（让布局自己说话：零、空、默认值不显示）。 */
export function ColumnCount({ value, label }: { value: number | null; label?: string }): ReactNode {
  if (value === null || value === 0) {
    return null;
  }
  const spoken = label === undefined ? undefined : `${value} ${label}`;
  return <span className="column-count" aria-label={spoken}>{value}</span>;
}

export function ColumnFoot({ children }: { children: ReactNode }): ReactNode {
  return <div className="column-foot">{children}</div>;
}

export function ColumnNote({ children }: { children: ReactNode }): ReactNode {
  return <p className="column-note">{children}</p>;
}
