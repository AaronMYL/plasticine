import type { Schedule } from '../../shared/state.ts';
import { MAIN_LINE_ID, type StateService } from '../state/index.ts';

export const SCHEDULE_OWNER_CONTEXT_KEY = 'scheduleActorId';
export type ScheduleOwnerState = Pick<StateService, 'lines' | 'mates' | 'schedules' | 'asks'>;

/** 归属只取执行线和确认卡；替换不会把原任务交给提出修改的人。 */
export function scheduleActor(state: ScheduleOwnerState, schedule: Schedule): string {
  const visited = new Set<string>();
  let current = schedule;
  for (;;) {
    if (visited.has(current.id)) throw new Error('定时任务的替换来源成环。');
    visited.add(current.id);
    const line = current.lineId === null ? undefined : state.lines.get(current.lineId);
    if (line !== undefined) return line.mateId ?? MAIN_LINE_ID;
    const ask = current.confirmAskId === null ? undefined : state.asks.get(current.confirmAskId);
    const saved = ask?.context?.[SCHEDULE_OWNER_CONTEXT_KEY];
    if (typeof saved === 'string' && saved.length > 0) return saved;
    if (current.replacesId !== null) {
      current = state.schedules.require(current.replacesId);
      continue;
    }
    const source = ask?.context?.lineId;
    const mateId = typeof source === 'string' ? state.lines.get(source)?.mateId : null;
    const mate = mateId == null ? undefined : state.mates.get(mateId);
    // 老确认卡没有快照：后来把旧旁聊转成的队友不能取得此前的定时授权。
    return mate !== undefined && ask?.answeredAt != null && mate.createdAt <= ask.answeredAt
      ? mate.id : MAIN_LINE_ID;
  }
}

export function canManageSchedule(state: ScheduleOwnerState, lineId: string, schedule: Schedule): boolean {
  const source = state.lines.get(lineId);
  return source !== undefined && (source.mateId == null || source.mateId === scheduleActor(state, schedule));
}
