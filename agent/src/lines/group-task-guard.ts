import type { LineRow, StateService } from '../state/index.ts';
import { LineError } from './kernel-types.ts';

export function unclaimedGroupTask(state: Pick<StateService, 'lineMessages'>, line: LineRow): boolean {
  const marker = state.lineMessages.first(line.id, 'notice')?.meta?.mateGroupTask;
  return marker !== undefined && marker.groupId === line.mateGroupId && line.mateId == null;
}

export function requireClaimedGroupTask(state: Pick<StateService, 'lineMessages'>, line: LineRow): void {
  if (unclaimedGroupTask(state, line)) {
    throw new LineError('conflict', '先让组内队友领取这张任务卡，再继续执行。');
  }
}
