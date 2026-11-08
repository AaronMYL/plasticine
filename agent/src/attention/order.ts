// 「等你」的先后（第 44 条）：动手 > 授权 > 确认 > 定；「下次汇报」档永远在最后；同类里等得最久的在前。
// 要你定卡的排队和任务清单「等你」区用同一个顺序，所以对话栏和清单里看到的次序一样。

import { ASK_KIND_ORDER } from '../../shared/api/asks.ts';
import type { Ask, AskKind, Channel } from '../../shared/state.ts';

export interface WaitingEntry {
  kind: AskKind;
  channel: Channel | null;
  /** Since when it waits (ISO). */
  since: string;
}

export function compareWaiting(a: WaitingEntry, b: WaitingEntry): number {
  const laterA = a.channel === 'next_report' ? 1 : 0;
  const laterB = b.channel === 'next_report' ? 1 : 0;
  if (laterA !== laterB) {
    return laterA - laterB;
  }
  const kindOrder = ASK_KIND_ORDER.indexOf(a.kind) - ASK_KIND_ORDER.indexOf(b.kind);
  if (kindOrder !== 0) {
    return kindOrder;
  }
  return a.since.localeCompare(b.since);
}

export function compareAsks(a: Ask, b: Ask): number {
  return compareWaiting(
    { kind: a.kind, channel: a.channel, since: a.createdAt },
    { kind: b.kind, channel: b.channel, since: b.createdAt },
  );
}

/**
 * The one card spread open in the conversation (《UI 方案》第 6 节：一次只有一张摊开): among open cards on the popup or
 * interrupt channel that were not put back (先不), an interrupt first, otherwise the oldest — so a card the user is
 * reading is not replaced by a newer one.
 */
export function currentAsk(open: readonly Ask[]): Ask | null {
  const spread = (ask: Ask): boolean => ask.channel === 'popup' || ask.channel === 'interrupt';
  const shown = open.filter((ask) => ask.deferredAt === null && spread(ask));
  const sorted = [...shown].sort((a, b) => {
    const urgent = Number(b.channel === 'interrupt') - Number(a.channel === 'interrupt');
    return urgent !== 0 ? urgent : a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
  return sorted[0] ?? null;
}
