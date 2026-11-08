// 定时线在「定时」列表里的一行、在「队友」里的一位、在对话里的那张卡（设计稿 Tasks-Timed、Tasks-Run、Plasticine-Schedule）。

import type { LineView, ScheduleCardPreview, TaskGlyph, TeammateView, TimedRowView }
  from '../../shared/api/index.ts';
import type { Schedule } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { cadenceLabel } from './cadence.ts';
import { reportLabel } from './schedule-text.ts';
import type { ScheduleDesk, ScheduleLines } from './schedules.ts';
import { teammatesFromRows, type TimedProvider } from './timed.ts';

/** 「上次」那一格写得下的字数（设计稿那一列 150px）。 */
const LAST_MAX_CHARS = 14;
const ROW_PREFIX = 'schedule:';

function short(text: string): string {
  const chars = Array.from(text.trim().replace(/\s+/g, ' '));
  return chars.length <= LAST_MAX_CHARS ? chars.join('') : `${chars.slice(0, LAST_MAX_CHARS - 1).join('')}…`;
}

function last(schedule: Schedule, view: LineView | null): { glyph: TaskGlyph; text: string } | null {
  if (schedule.status === 'draft') {
    return { glyph: 'wait', text: schedule.outward === null ? '等你确认' : '等你授权' };
  }
  if (view?.status === 'waiting') {
    return { glyph: 'wait', text: '等你' };
  }
  if (view?.status === 'running' || view?.status === 'queued') {
    return { glyph: 'run', text: '在做' };
  }
  if (schedule.status === 'paused') {
    return { glyph: 'pause', text: '暂停了' };
  }
  switch (schedule.lastOutcome) {
    case 'done': return { glyph: 'done', text: short(schedule.lastNote ?? '做完了') };
    case 'unmet': return { glyph: 'err', text: short(schedule.lastNote ?? '没做成') };
    case 'failed': return { glyph: 'err', text: short(schedule.lastNote ?? '出错了') };
    case 'stopped': return { glyph: 'pause', text: '叫停了' };
    case null: return schedule.lastNote === null ? null : { glyph: 'idle', text: short(schedule.lastNote) };
  }
}

export function scheduleRow(schedule: Schedule, view: LineView | null): TimedRowView {
  const note = schedule.outward !== null ? '以你的名义发出' : schedule.place;
  return {
    id: `${ROW_PREFIX}${schedule.id}`,
    source: 'schedule',
    title: schedule.title,
    summary: note === null ? cadenceLabel(schedule.cadence) : `${cadenceLabel(schedule.cadence)} · ${note}`,
    icon: 'clock',
    hue: 'rose',
    nextAt: schedule.status === 'active' ? schedule.nextAt : null,
    last: last(schedule, view),
    enabled: schedule.status === 'active',
    canToggle: schedule.status !== 'draft',
    canRemove: true,
    projectId: schedule.projectId,
    lineId: schedule.lineId,
    askId: schedule.status === 'draft' ? schedule.confirmAskId : null,
    teammateId: `${ROW_PREFIX}${schedule.id}`,
    sheet: false,
  };
}

function scheduleId(rowId: string): string {
  return rowId.startsWith(ROW_PREFIX) ? rowId.slice(ROW_PREFIX.length) : rowId;
}

/** 定时线登记进「定时」和「队友」。 */
export function scheduleProvider(state: Pick<StateService, 'schedules'>, desk: ScheduleDesk,
  lines: () => ScheduleLines): TimedProvider {
  const viewOf = (schedule: Schedule): LineView | null =>
    schedule.lineId === null ? null : lines().view(schedule.lineId);
  const rows = (): TimedRowView[] => state.schedules.listed()
    .map((schedule) => scheduleRow(schedule, viewOf(schedule)));
  return {
    source: 'schedule',
    rows,
    teammates(): TeammateView[] {
      // 还在等确认的卡没有执行者：确认了才有一位队友。
      const confirmed = rows().filter((row) => row.askId === null);
      return teammatesFromRows(confirmed, (row) => {
        const view = row.lineId === null ? null : lines().view(row.lineId);
        const busy = view !== null && (view.status === 'running' || view.status === 'queued');
        return { name: row.title, activity: busy ? view.activity ?? '在做' : null, lineId: row.lineId };
      });
    },
    setEnabled(rowId, on) {
      desk.setEnabled(scheduleId(rowId), on);
    },
    remove(rowId) {
      desk.remove(scheduleId(rowId));
    },
  };
}

/** 对话里那张定时卡（他点确认才生效）。 */
export function scheduleCard(schedule: Schedule, projectName: string, replaces: boolean): ScheduleCardPreview {
  const outward = schedule.outward;
  return {
    scheduleId: schedule.id,
    title: schedule.title,
    when: cadenceLabel(schedule.cadence),
    who: outward === null ? null : [...outward.recipients],
    what: outward === null ? schedule.goal : outward.contentLabel,
    place: schedule.place,
    report: reportLabel(schedule.report, outward !== null),
    projectName,
    outward: outward !== null,
    replaces,
  };
}
