// 交接留在队友的对话里（11-16 用户定）：主线（或别的队友）把事交给一位队友时，交过去的话、之后插的话、队友交回的结论，
// 都在那位队友自己的对话里贴一份，写成「谁 → 谁」；发起的那条线照旧收到结论（模型要据此接着做），但界面不画，
// 由发起者整理后自己回用户。只算模型交的（mate_handoff，交回后发起者接着整理）；用户自己 @ 队友的，回答照旧回给他。
// 群组里的交接本来就在群组对话里，不另贴；队友交给自己的不算交接。

import type { LineRelay } from '../../shared/api/lines.ts';
import type { LineRow, StateService } from '../state/index.ts';
import type { LineHandoffMessage } from './messages.ts';

export interface RelayTarget {
  relay: LineRelay;
  /** 那位队友自己的对话线。 */
  mateLineId: string;
}

type RelayState = Pick<StateService, 'lines' | 'mates'>;

/** 这条后台线是不是一次交接：是就回谁交给谁、贴到哪位队友的对话里；不是回 null。 */
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

/** 交过去的那句话（交代或插话），贴在队友对话里。 */
export function handoffMessage(child: LineRow, target: RelayTarget, text: string, at: Date): LineHandoffMessage {
  return { role: 'handoff', lineId: child.id, title: child.title, text, relay: target.relay,
    timestamp: at.getTime() };
}

/** 交回的方向和交过去相反：队友 → 发起者。 */
export function backwards(relay: LineRelay): LineRelay {
  return { from: relay.to, to: relay.from };
}
