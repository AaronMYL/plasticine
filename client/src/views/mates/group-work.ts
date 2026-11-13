// 一个队友群组里的事怎么分（11-13 分工面板）：这个群发布的任务和交给队友的后台工作，分成待领、等你、在做、做完四类。
// 一件事只算一类、只出现在一个人名下。

import type { LineView, MateGroupView } from '../../api/shared.ts';
import { newerLine } from '../lines/line-store.ts';

export type WorkKind = 'unclaimed' | 'waiting' | 'doing' | 'done';
export interface GroupWork {
  unclaimed: LineView[];
  waiting: LineView[];
  doing: LineView[];
  done: LineView[];
}

export function workKind(line: LineView): WorkKind {
  if (line.mateId == null && line.status === 'paused' && line.queued > 0) return 'unclaimed';
  if (line.status === 'waiting') return 'waiting';
  if (line.status === 'idle' && line.queued === 0 && line.outcome !== null) return 'done';
  return 'doing';
}

/** 这个群的事：群任务（tasks）加上从群里交出去的后台工作（列表里父线是这个群的）；同一条取新的那份，删了的不算。 */
export function groupLines(group: Pick<MateGroupView, 'id' | 'lineId'>, listed: readonly LineView[],
  tasks: readonly LineView[]): LineView[] {
  const byId = new Map<string, LineView>();
  for (const line of listed) {
    if (line.kind === 'background' && (line.parentLineId === group.lineId || line.mateGroupId === group.id)) {
      byId.set(line.id, line);
    }
  }
  for (const task of tasks) {
    byId.set(task.id, newerLine(byId.get(task.id) ?? null, task));
  }
  return [...byId.values()].filter((line) => line.archivedAt == null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function groupWork(lines: readonly LineView[]): GroupWork {
  const work: GroupWork = { unclaimed: [], waiting: [], doing: [], done: [] };
  for (const line of lines) {
    work[workKind(line)].push(line);
  }
  return work;
}

/** 名单和「分工」按钮上的「等你 n」：只看列表里的线，不用先读群任务。 */
export function groupWaiting(group: Pick<MateGroupView, 'id' | 'lineId'>, listed: readonly LineView[]): number {
  return groupWork(groupLines(group, listed, [])).waiting.length;
}
