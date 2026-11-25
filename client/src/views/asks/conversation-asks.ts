import type { LineView } from '../../api/shared.ts';
import type { AskView } from '../../api/types.ts';

export interface PlacedAsk {
  ask: AskView;
  from: LineView | null;
}

function ancestorsOf(line: LineView, byId: ReadonlyMap<string, LineView>): string[] {
  const seen: string[] = [];
  let parent = line.parentLineId;
  while (parent !== null && !seen.includes(parent)) {
    seen.push(parent);
    parent = byId.get(parent)?.parentLineId ?? null;
  }
  return seen;
}

function systemRooted(line: LineView, byId: ReadonlyMap<string, LineView>): boolean {
  const rootId = ancestorsOf(line, byId).at(-1);
  const root = rootId === undefined ? line : byId.get(rootId);
  return root !== undefined && root.kind === 'background' && root.parentLineId === null && root.mateId == null
    && root.mateGroupId == null;
}

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

export function waitingIn(placed: readonly PlacedAsk[]): AskView[] {
  return placed.map((item) => item.ask).filter((ask) => ask.status === 'open' && ask.deferredAt === null);
}
