import { SOUL_OWNER_MAIN, SOUL_REVISIONS_SHOWN, type SoulActor, type SoulResponse, type SoulRevision,
  type SoulRevisionDiffResponse } from '../../shared/api/souls.ts';
import { diffSoul, MAIN_SOUL_OPENING, mateSoulOpening, soulChangeCount } from '../../shared/soul-text.ts';
import { StateError, type SoulRevisionRow, type SoulRow, type StateService } from '../state/index.ts';

export type SoulState = Pick<StateService, 'souls' | 'mates' | 'transaction'>;
type ReadState = Pick<StateService, 'mates'> & Partial<Pick<StateService, 'souls'>>;

export function defaultSoul(state: Pick<StateService, 'mates'>, owner: string): string | null {
  if (owner === SOUL_OWNER_MAIN) {
    return MAIN_SOUL_OPENING;
  }
  const mate = state.mates.get(owner);
  return mate === undefined ? null : mateSoulOpening(mate.name, mate.role);
}

export function soulText(state: ReadState, owner: string): string {
  return state.souls?.get(owner)?.text ?? defaultSoul(state, owner) ?? '';
}

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
