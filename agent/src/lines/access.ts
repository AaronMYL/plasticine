import { MAIN_LINE_ALIAS } from '../../shared/api/lines.ts';
import { MAIN_LINE_ID, type LineRow, type StateService } from '../state/index.ts';
import type { LineScope } from './types.ts';

export type LineAccessState = Pick<StateService, 'lines' | 'mateGroups' | 'lineMessages' | 'lineQueue'>;

export function canAccessLine(state: LineAccessState, scope: LineScope, target: LineRow | undefined,
  mode: 'read' | 'control' = 'read'): boolean {
  const source = state.lines.get(scope.lineId);
  if (source === undefined || target === undefined) return false;
  if (source.mateId == null) return true;
  if (target.mateId === source.mateId) return true;
  if (mode === 'control') return false;
  const group = target.mateGroupId == null ? undefined : state.mateGroups.get(target.mateGroupId);
  if (group?.lineId === target.id && group.mateIds.includes(source.mateId)) return true;
  if (target.kind !== 'background') return false;
  const origin = state.lineMessages.first(target.id, 'user')?.meta?.origin
    ?? state.lineQueue.queued(target.id)[0]?.origin;
  const from = origin?.kind === 'delegation' && origin.ref !== undefined
    ? state.lineMessages.said(origin.ref) : undefined;
  return from !== undefined && state.lines.get(from.lineId)?.mateId === source.mateId;
}

export function accessibleLine(state: LineAccessState, scope: LineScope, id: string,
  mode: 'read' | 'control' = 'read'): boolean {
  return canAccessLine(state, scope, state.lines.get(id === MAIN_LINE_ALIAS ? MAIN_LINE_ID : id), mode);
}
