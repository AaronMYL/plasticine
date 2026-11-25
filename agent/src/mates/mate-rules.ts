import { inferSoulSection, ruleTexts } from '../../shared/soul.ts';
import { RULES_DOC_ID } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { docEvent, ensureRulesDoc, type DocState } from '../memory/index.ts';

type MateRuleState = DocState & Pick<StateService, 'mates'>;
const MARK = 'mateSoul';

export function adoptMateSoul(state: MateRuleState, mateId: string, soul: string): number {
  if (state.memoryDocs.events.withDetail('entries_migrated', MARK, mateId).length > 0) return 0;
  return state.transaction(() => {
    ensureRulesDoc(state);
    const texts = ruleTexts(soul);
    for (const text of texts) {
      const line = state.memoryDocs.lines.add({ docId: RULES_DOC_ID, text, basis: 'system',
        anchors: [{ kind: 'mate', ref: mateId }], writtenBy: 'system', scopeKind: 'mate', scopeRef: mateId });
      docEvent(state, RULES_DOC_ID, line.id, 'line_added', { actor: 'system', ref: null },
        { soulAction: 'add', soulSection: inferSoulSection(text) });
    }
    docEvent(state, RULES_DOC_ID, null, 'entries_migrated', { actor: 'system', ref: null },
      { [MARK]: mateId, lines: texts.length });
    return texts.length;
  });
}

export function adoptMateSouls(state: MateRuleState): void {
  for (const mate of state.mates.all()) adoptMateSoul(state, mate.id, mate.soul);
}
