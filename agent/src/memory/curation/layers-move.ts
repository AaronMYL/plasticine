import {
  memorySectionIn, memorySectionsOf, type MemoryDoc, type MemoryDocEvent, type MemoryLine, type MemoryLineSection,
} from '../../../shared/state.ts';
import type { MemoryMoveItem } from '../../../shared/api/maintenance.ts';
import type { StateService } from '../../state/index.ts';
import { docEvent, retireLine, type Writer } from '../docs/memory-doc-writes.ts';
import { moveLine, type CleanupState } from './memory-cleanup.ts';

export type LayersState = CleanupState & Pick<StateService, 'maintenanceOperations'>;

export const LAYERS_OP = 'memory.layers';
export const LAYERS_KEEP_DAYS = 7;
const HOW_PREFIX = 'how:';

function targetDoc(state: LayersState, toDocId: string, writer: Writer): MemoryDoc {
  if (!toDocId.startsWith(HOW_PREFIX)) {
    const doc = state.memoryDocs.docs.require(toDocId);
    if (doc.retiredAt !== null) {
      throw new Error(`记忆文档 ${toDocId} 已经不在用了`);
    }
    return doc;
  }
  const title = toDocId.slice(HOW_PREFIX.length).trim();
  if (title === '') {
    throw new Error('how: 后面要写做事经验那一篇的名字');
  }
  const found = state.memoryDocs.docs.live().find((doc) => doc.kind === 'how' && doc.title === title);
  if (found !== undefined) {
    return found;
  }
  const doc = state.memoryDocs.docs.create({ kind: 'how', title, summary: `做「${title}」这类事的做法和坑；动手之前读`,
    createdBy: writer.actor });
  docEvent(state, doc.id, null, 'doc_created', writer, { title: doc.title });
  return doc;
}

export function applyLayersMove(state: LayersState, moves: readonly MemoryMoveItem[], operationId: string):
  { moved: number } {
  const writer: Writer = { actor: 'system', ref: `maintenance:${operationId}` };
  const tag = { layers: operationId };
  return state.transaction(() => {
    for (const move of moves) {
      const line = state.memoryDocs.lines.require(move.lineId);
      if (line.retiredAt !== null || line.version !== move.version) {
        throw new Error(`记忆 ${move.lineId} 已经改过，这次没有搬。`);
      }
      const target = targetDoc(state, move.toDocId, writer);
      moveLine(state, line, target.id, writer, move.section ?? memorySectionIn(target.kind, line.section), tag);
    }
    return { moved: moves.length };
  });
}

export interface LayersMoveItem {
  line: MemoryLine;
  to: MemoryDoc;
  from: MemoryDoc | null;
  fromSection: MemoryLineSection | null;
}

export interface LayersMove {
  operationId: string;
  at: string;
  items: LayersMoveItem[];
  kept: number;
}

function current(state: LayersState, lineId: string): MemoryLine | undefined {
  let line = state.memoryDocs.lines.get(lineId);
  for (let hops = 0; line !== undefined && line.retiredAt !== null && hops < 50; hops += 1) {
    line = state.memoryDocs.lines.successor(line.id);
  }
  return line;
}

function itemOf(state: LayersState, event: MemoryDocEvent): LayersMoveItem | null {
  const line = event.lineId === null ? undefined : current(state, event.lineId);
  const to = event.docId === null ? undefined : state.memoryDocs.docs.get(event.docId);
  if (line === undefined || to === undefined || line.docId !== to.id) {
    return null;
  }
  const fromId = typeof event.detail['movedFrom'] === 'string' ? event.detail['movedFrom'] : null;
  const from = fromId === null ? null : state.memoryDocs.docs.get(fromId) ?? null;
  const section = event.detail['fromSection'];
  const fromSection = from === null ? null
    : memorySectionsOf(from.kind).find((known) => known === section) ?? memorySectionsOf(from.kind)[0] ?? 'note';
  return fromId !== null && from === null ? null : { line, to, from, fromSection };
}

export function layersMoveView(state: LayersState, now: Date): LayersMove | null {
  const operation = state.maintenanceOperations.recent(200).find((item) => item.op === LAYERS_OP);
  if (operation === undefined
    || now.getTime() - Date.parse(operation.createdAt) > LAYERS_KEEP_DAYS * 86_400_000) {
    return null;
  }
  const items = state.memoryDocs.events.withDetail('line_added', 'layers', operation.id)
    .flatMap((event) => itemOf(state, event) ?? []);
  return { operationId: operation.id, at: operation.createdAt, items,
    kept: Math.max(0, state.memoryDocs.lines.allLive().length - items.length) };
}

export function undoLayersMove(state: LayersState, lineIds: readonly string[] | null, writer: Writer,
  now: Date): number {
  const view = layersMoveView(state, now);
  if (view === null) {
    return 0;
  }
  const chosen = view.items.filter((item) => lineIds === null || lineIds.includes(item.line.id));
  return state.transaction(() => {
    for (const item of chosen) {
      const tag = { layersUndo: view.operationId };
      if (item.from === null || item.fromSection === null) {
        retireLine(state, item.line, 'no_longer_true', writer, tag);
      } else {
        moveLine(state, item.line, item.from.id, writer, item.fromSection, tag);
      }
    }
    return chosen.length;
  });
}
