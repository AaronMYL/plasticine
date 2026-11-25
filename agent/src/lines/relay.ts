import type { LineRelay } from '../../shared/api/lines.ts';
import type { LineRow, StateService } from '../state/index.ts';
import type { LineHandoffMessage } from './messages.ts';

export interface RelayTarget {
  relay: LineRelay;
  mateLineId: string;
}

type RelayState = Pick<StateService, 'lines' | 'mates'>;
type AskerState = Pick<StateService, 'lines' | 'lineMessages'>;

export function askerOf(state: AskerState, child: LineRow): LineRow | null {
  const ref = state.lineMessages.lastDelegation(child.id)?.meta?.origin?.ref;
  const from = ref === undefined ? undefined : state.lineMessages.said(ref);
  if (from === undefined || from.lineId === child.id || from.lineId === child.parentLineId) {
    return null;
  }
  const asker = state.lines.get(from.lineId);
  return asker === undefined || asker.archivedAt !== null ? null : asker;
}

export function relayOf(state: RelayState, child: LineRow): RelayTarget | null {
  if (child.mateId == null || child.parentLineId === null || !child.resumeParent) {
    return null;
  }
  const parent = state.lines.get(child.parentLineId);
  const mate = state.mates.get(child.mateId);
  if (parent === undefined || mate === undefined || parent.mateGroupId != null || parent.mateId === child.mateId
    || mate.lineId === parent.id) {
    return null;
  }
  const delegator = parent.mateId == null ? { kind: 'main' as const } : { kind: 'mate' as const, id: parent.mateId };
  return { relay: { from: delegator, to: { kind: 'mate', id: child.mateId } }, mateLineId: mate.lineId };
}

export function handoffMessage(child: LineRow, target: RelayTarget, text: string, at: Date): LineHandoffMessage {
  return { role: 'handoff', lineId: child.id, title: child.title, text, relay: target.relay,
    timestamp: at.getTime() };
}

export function backwards(relay: LineRelay): LineRelay {
  return { from: relay.to, to: relay.from };
}
