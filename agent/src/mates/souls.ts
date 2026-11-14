// 主线和每位队友的 Soul（第13批）：读（没有就照起步的样子建）、他改、撤回一次、看一次改了什么；系统提示里放哪份
// （lines/prompt.ts）、主线派活时看每位的第一段。存取在 state/souls.ts，文字的小工具在 shared/soul-text.ts。

import { SOUL_OWNER_MAIN, SOUL_REVISIONS_SHOWN, type SoulActor, type SoulResponse, type SoulRevision,
  type SoulRevisionDiffResponse } from '../../shared/api/souls.ts';
import { diffSoul, MAIN_SOUL_OPENING, mateSoulOpening, soulChangeCount } from '../../shared/soul-text.ts';
import { StateError, type StateService } from '../state/index.ts';
import type { SoulRevisionRow, SoulRow } from '../state/souls.ts';

export type SoulState = Pick<StateService, 'souls' | 'mates' | 'transaction'>;
type ReadState = Pick<StateService, 'mates'> & Partial<Pick<StateService, 'souls'>>;

/** 起步的样子：主线是 Aaron 给的那段，队友是「你是我的……」加原来的职责。不认得的 owner 回 null。 */
export function defaultSoul(state: Pick<StateService, 'mates'>, owner: string): string | null {
  if (owner === SOUL_OWNER_MAIN) {
    return MAIN_SOUL_OPENING;
  }
  const mate = state.mates.get(owner);
  return mate === undefined ? null : mateSoulOpening(mate.name, mate.role);
}

/** 这一份现在的文字（只读，不建）：系统提示每轮都读。 */
export function soulText(state: ReadState, owner: string): string {
  return state.souls?.get(owner)?.text ?? defaultSoul(state, owner) ?? '';
}

/** 这一份（没有就照起步的样子建）；不认得的 owner 报找不到。 */
export function soulOf(state: SoulState, owner: string): SoulRow {
  const found = state.souls.get(owner);
  if (found !== undefined) {
    return found;
  }
  const text = defaultSoul(state, owner);
  if (text === null) {
    throw new StateError('not_found', '找不到这位的 Soul。');
  }
  return state.souls.ensure(owner, text);
}

function revisionView(row: SoulRevisionRow): SoulRevision {
  return { id: row.id, actor: row.actor, note: row.note, at: row.at, changes: soulChangeCount(row.before, row.after),
    undoneAt: row.undoneAt, undoes: row.undoes };
}

export function soulResponse(state: SoulState, owner: string): SoulResponse {
  const soul = soulOf(state, owner);
  return {
    soul: { owner: soul.owner, text: soul.text, version: soul.version, updatedAt: soul.updatedAt },
    revisions: state.souls.revisions(owner, SOUL_REVISIONS_SHOWN).map(revisionView),
  };
}

export function updateSoul(state: SoulState, owner: string, version: number, text: string, actor: SoulActor,
  note: string): SoulResponse {
  state.transaction(() => {
    soulOf(state, owner);
    state.souls.write(owner, version, text, actor, note);
  });
  return soulResponse(state, owner);
}

function ownRevision(state: SoulState, owner: string, id: string): SoulRevisionRow {
  const revision = state.souls.revision(id);
  if (revision === undefined || revision.owner !== owner) {
    throw new StateError('not_found', '这次改动不在了。');
  }
  return revision;
}

export function undoSoul(state: SoulState, owner: string, revisionId: string): SoulResponse {
  ownRevision(state, owner, revisionId);
  state.souls.undo(revisionId, '撤回了一次改动');
  return soulResponse(state, owner);
}

export function soulRevisionDiff(state: SoulState, owner: string, id: string): SoulRevisionDiffResponse {
  const revision = ownRevision(state, owner, id);
  return { revision: revisionView(revision), diff: diffSoul(revision.before, revision.after) };
}
