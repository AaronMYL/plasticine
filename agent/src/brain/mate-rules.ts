// 队友的规则（11-11 第 11 批第二步，Aaron 同意迁移）：队友原来那段自由文字的 Soul 拆成「只对这位队友」的规则行，进记忆的
// 「规则」；原字段停用、内容保留。建队友时带的那段话也照这样拆。每位队友只拆一次（事件里记一笔），之后在记忆页改。

import { inferSoulSection, ruleTexts } from '../../shared/soul.ts';
import { RULES_DOC_ID } from '../../shared/state.ts';
import type { StateService } from '../state/index.ts';
import { docEvent, ensureRulesDoc, type DocState } from './memory-doc-writes.ts';

type MateRuleState = DocState & Pick<StateService, 'mates'>;
const MARK = 'mateSoul';

/** 把一位队友的那段文字拆成只对它的规则（拆过的不再拆）；返回新写的行数。 */
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

/** 服务启动时：每位还没拆过的队友拆一次。 */
export function adoptMateSouls(state: MateRuleState): void {
  for (const mate of state.mates.all()) adoptMateSoul(state, mate.id, mate.soul);
}
