// 规则搬家（第13批，11-14 Aaron 选「按三层分，你勾了才搬」；shared/api/rules-move.ts）：记忆里「规则」的每一条先分一遍、
// 给出建议去处——只对某位队友的进那位的 Soul；他说过的（你说的、对话里说的）进「关于你」；对外授权的系统默认本来就在
// 产品里，可以拿掉（默认不勾）；别的系统默认和确认过的推断进主线的 Soul。他勾了才搬：进 Soul 的按节加一条（说话的进
// 「说话」，别的进「和我相处中形成的判断」，「用户」写成「我」），一份 Soul 记一次改动；进「关于你」的照原样加一行；
// 搬走的那条从「规则」里退下来（合并到了别处）。没勾的留在原处，下次整理再问。

import type { ApplyRulesMoveRequest, ApplyRulesMoveResponse, RulesMoveDest, RulesMoveItem, RulesMoveResponse }
  from '../../shared/api/rules-move.ts';
import { SOUL_OWNER_MAIN } from '../../shared/api/souls.ts';
import { appendToSection } from '../../shared/soul-text.ts';
import { RULES_DOC_ID, YOU_DOC_ID, type MemoryLine } from '../../shared/state.ts';
import { soulOf, type SoulState } from '../mates/souls.ts';
import { StateError } from '../state/index.ts';
import { docEvent, ensureRulesDoc, ensureYouDoc, type DocState, type Writer } from './memory-doc-writes.ts';
import { soulSectionOf, soulSource } from './soul.ts';

export type RulesMoveState = DocState & SoulState;

/** 进 Soul 时写成的样子：Soul 用第二人称写，「你」是 AI，「我」是他（11-14 Aaron）。 */
export function soulWording(text: string): string {
  return text.replaceAll('用户', '我');
}

function suggestion(state: RulesMoveState, line: MemoryLine): { dest: RulesMoveDest; suggested: boolean } {
  const source = soulSource(line);
  const section = soulSectionOf(state, line);
  if (line.scopeKind === 'mate' && line.scopeRef !== null && state.mates.get(line.scopeRef) !== undefined) {
    return { dest: { kind: 'soul', owner: line.scopeRef }, suggested: true };
  }
  if (source === 'user' || source === 'conversation') {
    return { dest: { kind: 'about_you', owner: null }, suggested: true };
  }
  if (source === 'system' && section === 'outbound') {
    return { dest: { kind: 'product', owner: null }, suggested: false };
  }
  return { dest: { kind: 'soul', owner: SOUL_OWNER_MAIN }, suggested: true };
}

/** 还在「规则」里的每一条和建议去处；能搬进的几份 Soul（主线在前，停用的队友注明）。 */
export function rulesMoveView(state: RulesMoveState, mainName: string): RulesMoveResponse {
  const live = state.memoryDocs.docs.get(RULES_DOC_ID) === undefined ? [] : state.memoryDocs.lines.live(RULES_DOC_ID);
  const items = live.map((line): RulesMoveItem => {
    const { dest, suggested } = suggestion(state, line);
    return { id: line.id, version: line.version, text: line.text, moved: soulWording(line.text),
      section: soulSectionOf(state, line), source: soulSource(line), dest, suggested };
  });
  const owners = [{ owner: SOUL_OWNER_MAIN, name: mainName }, ...state.mates.all().map((mate) => ({ owner: mate.id,
    name: mate.disabledAt === null ? mate.name : `${mate.name}（已停用）` }))];
  return { items, owners };
}

function currentRule(state: RulesMoveState, id: string, version: number): MemoryLine {
  const line = state.memoryDocs.lines.get(id);
  if (line === undefined || line.docId !== RULES_DOC_ID) {
    throw new StateError('not_found', '这条规则不在「规则」里了。');
  }
  if (line.retiredAt !== null || line.version !== version) {
    throw new StateError('version_conflict', '这条规则刚改过或已经搬走，请刷新后再搬。');
  }
  return line;
}

/** 照他勾的搬；一条出错整批不搬。回搬了几条、「规则」里还剩几条。 */
export function applyRulesMove(state: RulesMoveState, moves: ApplyRulesMoveRequest['moves'], writer: Writer):
  ApplyRulesMoveResponse {
  return state.transaction(() => {
    ensureRulesDoc(state);
    const souls = new Map<string, string[]>();
    for (const move of moves) {
      const line = currentRule(state, move.id, move.version);
      if (move.dest.kind === 'soul') {
        const owner = move.dest.owner ?? SOUL_OWNER_MAIN;
        soulOf(state, owner);
        const heading = soulSectionOf(state, line) === 'speaking' ? '说话' : '和我相处中形成的判断';
        souls.set(owner, [...souls.get(owner) ?? [], `${heading}\n${soulWording(line.text)}`]);
      } else if (move.dest.kind === 'about_you') {
        ensureYouDoc(state);
        const added = state.memoryDocs.lines.add({ docId: YOU_DOC_ID, section: 'note', text: line.text,
          basis: line.basis, anchors: line.anchors, inferenceId: line.inferenceId, writtenBy: line.writtenBy,
          writtenRef: line.writtenRef, scopeKind: 'all', scopeRef: null });
        docEvent(state, YOU_DOC_ID, added.id, 'line_added', writer, { movedFrom: line.id });
      }
      state.memoryDocs.lines.retire(line.id, line.version, 'merged');
      docEvent(state, RULES_DOC_ID, line.id, 'line_retired', writer,
        { soulAction: 'move_out', dest: move.dest.kind, owner: move.dest.owner });
    }
    for (const [owner, entries] of souls) {
      const soul = soulOf(state, owner);
      const text = entries.reduce((current, entry) => {
        const [heading = '', ...rest] = entry.split('\n');
        return appendToSection(current, heading, rest.join('\n'));
      }, soul.text);
      state.souls.write(owner, soul.version, text, 'move', `规则搬家：搬进来 ${String(entries.length)} 条`);
    }
    return { moved: moves.length, remaining: state.memoryDocs.lines.live(RULES_DOC_ID).length };
  });
}
