// 记忆分层的搬家（11-15 Aaron：「线上数据和记忆搬家也同意你做了」）：现有的行按层挪到承诺和授权、主动告诉你、做事经验，
// 在用的旧约定写成承诺和授权里的一行（出处指回那条约定）。Claude 先分好，经维护入口一次落库（有一行已经改过整批不动）；
// 每一行「加了一行」的事件里带着这一批的操作号，记忆页的搬家记录按它列出来，每条能搬回去。
// 搬回去：从文档搬来的回到原来那一篇、原来那一段，出处不变；从旧约定来的收回（进「已收回」）。

import {
  GRANTS_DOC_ID, memorySectionIn, memorySectionsOf, type MemoryDoc, type MemoryDocEvent, type MemoryLine,
  type MemoryLineSection,
} from '../../../shared/state.ts';
import type { AgreementMoveItem, MemoryMoveItem } from '../../../shared/api/maintenance.ts';
import type { StateService } from '../../state/index.ts';
import { addLine, docEvent, retireLine, type Writer } from '../docs/memory-doc-writes.ts';
import { moveLine, type CleanupState } from './memory-cleanup.ts';

export type LayersState = CleanupState & Pick<StateService, 'agreements' | 'maintenanceOperations'>;

export const LAYERS_OP = 'memory.layers';
/** 搬之前的样子留几天：过了就没有这页记录、也不能搬回去了（要挪的在各页里一条条挪）。 */
export const LAYERS_KEEP_DAYS = 7;
/** toDocId 写成 how:<名字>：做事经验里那个工具、网站或流程的一篇，没有就建。 */
const HOW_PREFIX = 'how:';

export interface LayersPlan {
  moves: readonly MemoryMoveItem[];
  agreements: readonly AgreementMoveItem[];
}

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

/** 一次落库：有一行已经改过（版本对不上）、有一条约定不在用，整批不动。 */
export function applyLayersMove(state: LayersState, plan: LayersPlan, operationId: string):
  { moved: number; fromAgreements: number } {
  const writer: Writer = { actor: 'system', ref: `maintenance:${operationId}` };
  const tag = { layers: operationId };
  return state.transaction(() => {
    for (const move of plan.moves) {
      const line = state.memoryDocs.lines.require(move.lineId);
      if (line.retiredAt !== null || line.version !== move.version) {
        throw new Error(`记忆 ${move.lineId} 已经改过，这次没有搬。`);
      }
      const target = targetDoc(state, move.toDocId, writer);
      moveLine(state, line, target.id, writer, move.section ?? memorySectionIn(target.kind, line.section), tag);
    }
    for (const item of plan.agreements) {
      const agreement = state.agreements.require(item.agreementId);
      if (agreement.state !== 'active') {
        throw new Error(`约定 ${item.agreementId} 不在用了，这次没有搬。`);
      }
      const target = targetDoc(state, item.toDocId ?? GRANTS_DOC_ID, writer);
      addLine(state, { docId: target.id, section: item.section, text: (item.text ?? agreement.text).trim(),
        basis: 'stated', anchors: [{ kind: 'agreement', ref: agreement.id }],
        eventDetail: { ...tag, fromAgreement: agreement.id } }, writer);
    }
    return { moved: plan.moves.length, fromAgreements: plan.agreements.length };
  });
}

export interface LayersMoveItem {
  /** 现在的那一行（搬过去以后改过的是改过的那一行）。 */
  line: MemoryLine;
  to: MemoryDoc;
  /** 原来在哪一篇；从旧约定来的是 null。 */
  from: MemoryDoc | null;
  fromSection: MemoryLineSection | null;
}

export interface LayersMove {
  operationId: string;
  at: string;
  items: LayersMoveItem[];
  /** 没动的：在用的行里不是这次搬来的。 */
  kept: number;
}

/** 顺着「谁接替了它」走到现在在用的那一行；中途断了（收回、忘掉）就是 undefined。 */
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
  // 还在搬去的那一篇里才算；搬回去了、后来又挪到别处或收回了的不再列。
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

/** 最近一次搬家：搬了哪些（现在还在那边的）、没动的有几行；没搬过、搬了超过 7 天是 null。 */
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

/** 搬回去：给了行就只搬那几行，不给就是全部。回几行。 */
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
