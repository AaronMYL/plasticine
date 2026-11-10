import { SOUL_SECTIONS, type ChangeSoulRequest, type SoulLine, type SoulSection, type SoulView }
  from '../../shared/api/soul.ts';
import { inferSoulSection } from '../../shared/soul.ts';
import { RULES_DOC_ID, RULES_DOC_TITLE, type MemoryLine } from '../../shared/state.ts';
import { StateError, type StateService } from '../state/index.ts';
import { addLine, docEvent, ensureRulesDoc, reviseLine, type DocState, type Writer } from './memory-doc-writes.ts';

type SoulState = Pick<StateService, 'memoryDocs'>;
const HISTORY_LIMIT = 100;

/** 分类记在已有事件里，避免把项目用的 note/decision 改成另一套含义。 */
export function soulSectionOf(state: SoulState, line: MemoryLine): SoulSection {
  const own = state.memoryDocs.events.soulSection(line.id);
  if (SOUL_SECTIONS.some((section) => section === own)) return own as SoulSection;
  const before = line.supersedes.map((id) => state.memoryDocs.lines.get(id))
    .find((previous) => previous !== undefined);
  return before === undefined ? inferSoulSection(line.text) : soulSectionOf(state, before);
}

export function soulSource(line: MemoryLine): SoulLine['source'] {
  if (line.writtenBy === 'user') return 'user';
  if (line.anchors.every((anchor) => anchor.kind === 'system')) return 'system';
  return line.basis === 'confirmed_inference' ? 'inference' : 'conversation';
}

export function soulView(state: SoulState): SoulView {
  const lines = state.memoryDocs.lines.live(RULES_DOC_ID).map((line): SoulLine => ({
    id: line.id, version: line.version, text: line.text, section: soulSectionOf(state, line),
    source: soulSource(line), at: line.createdAt, sources: [],
  }));
  const events = state.memoryDocs.events.recent(RULES_DOC_ID, HISTORY_LIMIT);
  const explicit = new Set(events.filter((event) => event.detail['soulAction'] !== undefined)
    .map((event) => event.lineId));
  const history = events.flatMap((event) => {
    const fallback = event.kind === 'line_added' ? 'add'
      : event.kind === 'line_edited' || event.kind === 'line_revised' ? 'edit' : undefined;
    const action = event.detail['soulAction'] ?? (explicit.has(event.lineId) ? undefined : fallback);
    if (event.lineId === null || !['add', 'edit', 'move', 'undo'].includes(String(action))) return [];
    const line = state.memoryDocs.lines.get(event.lineId);
    return [{ id: event.id, lineId: event.lineId, action: action as 'add' | 'edit' | 'move' | 'undo',
      text: line?.text ?? '', at: event.createdAt,
      actor: event.actor === 'user' || event.actor === 'system' ? event.actor : 'brain' as const }];
  });
  return { title: RULES_DOC_TITLE, lines, history };
}

function requireCurrent(state: SoulState, id: string, version: number): MemoryLine {
  const line = state.memoryDocs.lines.require(id);
  if (line.docId !== RULES_DOC_ID) throw new StateError('not_found', '这条规则不在主线的 Soul 中');
  if (line.retiredAt !== null || line.version !== version) {
    throw new StateError('version_conflict', '这条规则已改过或撤销，请刷新后再试。');
  }
  return line;
}

export function changeSoul(state: DocState, input: ChangeSoulRequest, writer: Writer): SoulView {
  return state.transaction(() => {
    ensureRulesDoc(state);
    const anchor = { kind: 'user_edit' as const, ref: input.requestId };
    if (input.action === 'add') {
      const line = addLine(state, { docId: RULES_DOC_ID, text: input.text.trim(), basis: 'stated',
        anchors: [anchor] }, writer);
      docEvent(state, RULES_DOC_ID, line.id, 'line_added', writer,
        { soulAction: 'add', soulSection: input.section });
    } else {
      const current = requireCurrent(state, input.id, input.version);
      if (input.action === 'edit') {
        const line = reviseLine(state, current, input.text.trim(), [anchor], writer, 'edited');
        docEvent(state, RULES_DOC_ID, line.id, 'line_edited', writer,
          { soulAction: 'edit', soulSection: input.section, replaced: current.id });
      } else if (input.action === 'move') {
        // 分类也是一次新版本，防另一台设备的迟到移动覆盖新选择。
        state.memoryDocs.lines.retire(current.id, current.version, 'edited');
        const line = state.memoryDocs.lines.add({ docId: RULES_DOC_ID, text: current.text, section: current.section,
          basis: current.basis, anchors: current.anchors, position: current.position, inferenceId: current.inferenceId,
          supersedes: [current.id], writtenBy: current.writtenBy, writtenRef: current.writtenRef });
        docEvent(state, RULES_DOC_ID, line.id, 'line_edited', writer,
          { soulAction: 'move', soulSection: input.section, replaced: current.id });
      } else {
        state.memoryDocs.lines.retire(current.id, current.version, 'no_longer_true');
        const originals = current.supersedes.map((id) => state.memoryDocs.lines.get(id))
          .filter((line): line is MemoryLine => line !== undefined && line.deletedAt === null);
        for (const original of originals) {
          const restored = state.memoryDocs.lines.add({ docId: RULES_DOC_ID, text: original.text,
            section: original.section, basis: original.basis, anchors: original.anchors,
            position: original.position, inferenceId: original.inferenceId, previous: current.text,
            writtenBy: original.writtenBy, writtenRef: original.writtenRef });
          docEvent(state, RULES_DOC_ID, restored.id, 'line_added', writer,
            { soulSection: soulSectionOf(state, original), restoredFrom: original.id });
        }
        docEvent(state, RULES_DOC_ID, current.id, 'line_retired', writer, { soulAction: 'undo' });
      }
    }
    return soulView(state);
  });
}
