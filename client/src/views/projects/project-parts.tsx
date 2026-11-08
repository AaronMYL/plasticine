// 项目页几处共用的小块：健康度（点 + 一个字，偏了才写成红字）、节点条、截止那一格的文字。

import { AiMark } from '../../shell/glyph.tsx';
import type { ReactNode } from 'react';
import { PROJECT_HEALTH_LABELS } from '../../api/shared.ts';
import type { ProjectRowView } from '../../api/shared.ts';

type Health = NonNullable<ProjectRowView['health']>;

export function HealthMark({ health, proposed = false }: { health: Health | null; proposed?: boolean }): ReactNode {
  // 2026-11-03《全量界面优化》：顺利只是一个点；有风险、偏了才写字。Plasticine 提议、你还没确认的是空心点 + ✦。
  if (health === null) {
    return null;
  }
  const dot = health === 'ok' ? 'dot dot-ok' : 'dot proj-dot-err';
  const label = `${PROJECT_HEALTH_LABELS[health]}${proposed ? '（Plasticine 提议）' : ''}`;
  return (
    <span className={`proj-health proj-health-${health}`} data-proposed={proposed ? 'true' : undefined}
      title={label} aria-label={label}>
      <span className={dot} aria-hidden="true" />
      {health === 'ok' ? null : PROJECT_HEALTH_LABELS[health]}
      {proposed ? <AiMark label="Plasticine 提议" /> : null}
    </span>
  );
}

/** 列表上显示的健康度：用户确认过的优先；没确认、只有提议的，显示提议并标出来。 */
export function shownHealth(row: ProjectRowView): { health: Health | null; proposed: boolean } {
  if (row.health !== null) {
    return { health: row.health, proposed: false };
  }
  return { health: row.proposedHealth?.value ?? null, proposed: row.proposedHealth !== null };
}

export function NodeBar({ done, total }: { done: number; total: number }): ReactNode {
  if (total === 0) {
    return null;
  }
  return (
    <span className="proj-nodebar-wrap">
      <span className="proj-nodebar" aria-hidden="true">
        {Array.from({ length: total }, (_, index) => (
          <span key={index} className={index < done ? 'proj-seg proj-seg-done' : 'proj-seg'} />
        ))}
      </span>
      <span className="text-mono proj-num" aria-label={`节点 ${done} / ${total}`}>{done}/{total}</span>
    </span>
  );
}

/** 「4 天」「今天」「逾期 2 天」。 */
export function dueNote(days: number): string {
  if (days === 0) {
    return '今天';
  }
  return days > 0 ? `${days} 天` : `逾期 ${-days} 天`;
}

/** 截止日期只显示月-日。 */
export function shortDate(date: string): string {
  return date.slice(5);
}

/** 「2 小时前」「3 天前」，再早写月-日。 */
export function ago(at: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - Date.parse(at)) / 60_000);
  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < 60) {
    return `${minutes} 分钟前`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时前`;
  }
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days} 天前` : at.slice(5, 10);
}
