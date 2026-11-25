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
  trail?: ReactNode;
  sub?: ReactNode;
  label?: string;
  children: ReactNode;
  className?: string;
}

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
