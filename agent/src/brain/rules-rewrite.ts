// 整理「规则」（11-11 Aaron：「规则你帮我整理」）：一行拆成几行、改成平常话，过时的挪进归档。经维护入口
// （rules.rewrite）由 Claude 依原话做：新行照抄原来那行的依据、来源锚点和适用范围，「之前」存原文，事件里记原话；
// 旧行退休进归档（不是删除），改动记录里看得到。

import type { RulesRewriteItem } from '../../shared/api/maintenance.ts';
import { RULES_DOC_ID } from '../../shared/state.ts';
import { StateError } from '../state/index.ts';
import { docEvent, type DocState } from './memory-doc-writes.ts';

export interface RulesRewriteReport {
  rewritten: number;
  retired: number;
  added: number;
}

export function rewriteRules(state: DocState, plan: readonly RulesRewriteItem[], ref: string, quote: string):
  RulesRewriteReport {
  return state.transaction(() => {
    const report: RulesRewriteReport = { rewritten: 0, retired: 0, added: 0 };
    const writer = { actor: 'system' as const, ref };
    const why = `Claude 依你的原话整理规则：「${quote}」`;
    for (const item of plan) {
      const line = state.memoryDocs.lines.require(item.lineId);
      if (line.docId !== RULES_DOC_ID || line.retiredAt !== null || line.version !== item.version) {
        throw new StateError('version_conflict', `规则 ${item.lineId} 已经改过或不在「规则」里，这次整理没有执行。`);
      }
      state.memoryDocs.lines.retire(line.id, line.version, item.into.length === 0 ? 'no_longer_true' : 'edited');
      docEvent(state, RULES_DOC_ID, line.id, 'line_retired', writer,
        { soulAction: 'undo', why, reason: item.into.length === 0 ? 'no_longer_true' : 'edited' });
      for (const [index, next] of item.into.entries()) {
        const written = state.memoryDocs.lines.add({ docId: RULES_DOC_ID, section: line.section, text: next.text.trim(),
          basis: line.basis, anchors: line.anchors, previous: line.text, supersedes: [line.id],
          inferenceId: line.inferenceId, position: line.position * 20 + index, writtenBy: 'system', writtenRef: ref,
          scopeKind: line.scopeKind, scopeRef: line.scopeRef });
        docEvent(state, RULES_DOC_ID, written.id, 'line_edited', writer,
          { soulAction: 'edit', soulSection: next.section, replaced: line.id, why });
        report.added += 1;
      }
      if (item.into.length === 0) report.retired += 1;
      else report.rewritten += 1;
    }
    return report;
  });
}
