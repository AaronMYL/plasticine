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

export function groupWaiting(group: Pick<MateGroupView, 'id' | 'lineId'>, listed: readonly LineView[]): number {
  return groupWork(groupLines(group, listed, [])).waiting.length;
}
