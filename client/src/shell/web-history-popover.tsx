// 网页的历史记录（第 2 批「浏览器」，⋯ 菜单「历史记录 ⌘Y」）：顶上「找历史记录」，下面按天分开、新的在前，一行是
// 网站标记 · 标题 · 时间；点一条在当前网页标签打开。记录在网页侧（state/tabs-history.ts），只在这台设备上。

import { useState, type ReactNode } from 'react';
import type { WebHistory, WebVisit } from '../state/tabs-history.ts';
import { useStore } from '../state/use-store.ts';
import { SiteIcon } from './site-icon.tsx';
import { Popover, type PopoverAnchor } from './popover.tsx';

/** 弹层里最多列这么多条：再早的用上面的输入框找。 */
const HISTORY_SHOWN = 60;

function dayLabel(at: Date, now: Date): string {
  const start = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((start(now) - start(at)) / 86_400_000);
  if (days === 0) {
    return '今天';
  }
  if (days === 1) {
    return '昨天';
  }
  return `${at.getMonth() + 1} 月 ${at.getDate()} 日`;
}

function clock(at: Date): string {
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

export interface WebHistoryPopoverProps {
  anchor: PopoverAnchor;
  history: WebHistory;
  now: () => Date;
  onOpen: (visit: WebVisit) => void;
  onClose: () => void;
}

export function WebHistoryPopover(props: WebHistoryPopoverProps): ReactNode {
  useStore(props.history.store);
  const [query, setQuery] = useState('');
  const visits = props.history.search(query, HISTORY_SHOWN);
  const now = props.now();
  const days: Array<{ label: string; visits: WebVisit[] }> = [];
  for (const visit of visits) {
    const label = dayLabel(new Date(visit.at), now);
    const last = days.at(-1);
    if (last?.label === label) {
      last.visits.push(visit);
    } else {
      days.push({ label, visits: [visit] });
    }
  }
  return (
    <Popover anchor={props.anchor} role="dialog" align="end" label="历史记录" className="web-pop web-history"
      onClose={props.onClose}>
      <input className="popover-field web-pop-search" type="search" aria-label="找历史记录" placeholder="找历史记录"
        value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="web-pop-scroll">
        {days.map((day) => (
          <section key={day.label} aria-label={day.label}>
            <h3 className="web-pop-day">{day.label}</h3>
            <ul className="web-pop-list">
              {day.visits.map((visit) => (
                <li key={`${visit.url}|${visit.at}`}>
                  <button type="button" className="web-pop-row" title={visit.url} onClick={() => {
                    props.onClose();
                    props.onOpen(visit);
                  }}>
                    <SiteIcon url={visit.url} title={visit.title} />
                    <span className="web-pop-title">{visit.title === '' ? visit.url : visit.title}</span>
                    <time className="web-pop-meta" dateTime={visit.at}>{clock(new Date(visit.at))}</time>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {visits.length === 0 ? <p className="web-pop-empty">{query.trim() === '' ? '还没有历史记录' : '没找到'}</p>
          : null}
      </div>
    </Popover>
  );
}
