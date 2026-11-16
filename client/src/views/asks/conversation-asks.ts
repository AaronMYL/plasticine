// 一段对话里画哪些卡（11-16 卡片回到对话里）：出它的那段对话里有；沿着交办的路往上，每段交办的对话里也有（队友的卡主线
// 也有）；同一位队友的别的线（群组任务）在这位队友自己的对话里也有；定时、心跳、做梦这些不在哪段对话里出的，出在主线。
// 替你回朋友的卡只画在那段聊天里（reply-confirm.tsx），这里不画。

import type { LineView } from '../../api/shared.ts';
import type { AskView } from '../../api/types.ts';

export interface PlacedAsk {
  ask: AskView;
  /** 出这张卡的那条线；就是这段对话自己出的是 null。 */
  from: LineView | null;
}

/** 沿 parentLineId 往上的每一条线（不含自己）；防环。 */
function ancestorsOf(line: LineView, byId: ReadonlyMap<string, LineView>): string[] {
  const seen: string[] = [];
  let parent = line.parentLineId;
  while (parent !== null && !seen.includes(parent)) {
    seen.push(parent);
    parent = byId.get(parent)?.parentLineId ?? null;
  }
  return seen;
}

/** 不在哪段对话里出的线（定时、心跳、订阅这类后台线）：最上面那条没有上级，也不是队友、群组的。 */
function systemRooted(line: LineView, byId: ReadonlyMap<string, LineView>): boolean {
  const rootId = ancestorsOf(line, byId).at(-1);
  const root = rootId === undefined ? line : byId.get(rootId);
  return root !== undefined && root.kind === 'background' && root.parentLineId === null && root.mateId == null
    && root.mateGroupId == null;
}

/** 这位队友自己的对话（不是群组、不是交给它的后台活）。 */
function mateConversation(line: LineView): boolean {
  return line.mateId != null && line.mateGroupId == null && line.parentLineId === null;
}

function placeOne(current: LineView, ask: AskView, byId: ReadonlyMap<string, LineView>): PlacedAsk | null {
  if (ask.networkReply !== undefined) return null;
  if (ask.lineId === current.id) return { ask, from: null };
  if (ask.lineId === null) return current.kind === 'main' ? { ask, from: null } : null;
  const line = byId.get(ask.lineId);
  if (line === undefined) return current.kind === 'main' ? { ask, from: null } : null;
  if (ancestorsOf(line, byId).includes(current.id)) return { ask, from: line };
  if (mateConversation(current) && line.mateId === current.mateId) return { ask, from: line };
  if (current.kind === 'main' && systemRooted(line, byId)) return { ask, from: line };
  return null;
}

/** 这段对话里的卡，按出卡时间排（开着的、先不过的、答过的都在，答过的在原处收成一行）。 */
export function asksForConversation(current: LineView | null, lines: readonly LineView[],
  asks: readonly AskView[]): PlacedAsk[] {
  if (current === null) return [];
  const byId = new Map(lines.map((line) => [line.id, line]));
  const unique = new Map(asks.map((ask) => [ask.id, ask]));
  return [...unique.values()].flatMap((ask) => {
    const placed = placeOne(current, ask, byId);
    return placed === null ? [] : [placed];
  }).sort((a, b) => a.ask.createdAt.localeCompare(b.ask.createdAt) || a.ask.id.localeCompare(b.ask.id));
}

/** 输入框上方那一行数的：这段对话里还开着、没先不的卡。 */
export function waitingIn(placed: readonly PlacedAsk[]): AskView[] {
  return placed.map((item) => item.ask).filter((ask) => ask.status === 'open' && ask.deferredAt === null);
}
