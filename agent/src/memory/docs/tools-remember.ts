import { Type, type Static } from 'typebox';
import {
  MEMORY_DOC_SUMMARY_MAX_CHARS,
  MEMORY_DOC_TITLE_MAX_CHARS,
  MEMORY_LINE_MAX_CHARS,
  MEMORY_LINE_SECTIONS,
  MEMORY_NEW_DOC_KINDS,
  YOU_DOC_ID,
} from '../../../shared/state.ts';
import { planCuration, type CurationOp, type CurationSource } from '../curation/memory-curation-ops.ts';
import { applyPlan, snapshot, type CurationState } from '../curation/memory-curation-work.ts';
import { ensureMemoryDocs } from './memory-doc-writes.ts';
import { journalDay, noteRemembered } from '../journal/memory-journal.ts';

const Id = Type.String({ minLength: 1 });
const MAX_SOURCES = 10;
const NEW_DOC_REF = 'new';

const Parameters = Type.Object({
  messageIds: Type.Array(Id, { minItems: 1, maxItems: MAX_SOURCES }),
  text: Type.String({ minLength: 1, maxLength: MEMORY_LINE_MAX_CHARS }),
  docId: Type.Optional(Id),
  newDoc: Type.Optional(Type.Object({
    kind: Type.Enum(MEMORY_NEW_DOC_KINDS),
    title: Type.String({ minLength: 1, maxLength: MEMORY_DOC_TITLE_MAX_CHARS }),
    summary: Type.String({ minLength: 1, maxLength: MEMORY_DOC_SUMMARY_MAX_CHARS }),
  }, { additionalProperties: false })),
  section: Type.Optional(Type.Enum(MEMORY_LINE_SECTIONS)),
  replacesLineId: Type.Optional(Id),
  inferred: Type.Optional(Type.Boolean()),
  why: Type.Optional(Type.String({ maxLength: 1_000 })),
}, { additionalProperties: false });

type Args = Static<typeof Parameters>;

export const RememberParameters = Parameters;

export function rememberOps(args: Args): CurationOp[] {
  const ops: CurationOp[] = [];
  if (args.newDoc !== undefined) {
    ops.push({ op: 'new_doc', ref: NEW_DOC_REF, kind: args.newDoc.kind, title: args.newDoc.title,
      summary: args.newDoc.summary });
  }
  const doc = args.newDoc !== undefined ? NEW_DOC_REF : args.docId ?? YOU_DOC_ID;
  const sources = [...new Set(args.messageIds)];
  const section = args.section === undefined ? {} : { section: args.section };
  if (args.replacesLineId !== undefined) {
    ops.push({ op: 'revise', line: args.replacesLineId, text: args.text, sources });
  } else if (args.inferred === true) {
    ops.push({ op: 'infer', doc, ...section, text: args.text, why: args.why ?? '', sources });
  } else {
    ops.push({ op: 'add', doc, ...section, text: args.text, sources });
  }
  return ops;
}

export function rememberWithSources(state: CurationState, args: Args, sources: Map<string, CurationSource>,
  identity: { actionId: string; runId: string; now?: Date }): string {
  ensureMemoryDocs(state);
  const plan = planCuration({ ops: rememberOps(args) }, snapshot(state, sources));
  const jobId = `tool:${identity.actionId}`;
  const writer = { actor: 'brain' as const, ref: identity.runId };
  const written = state.transaction(() => {
    const applied = applyPlan(state, plan, { writer, jobId, runId: identity.runId, replyId: null, migrated: false });
    noteRemembered(state, applied, writer, journalDay(identity.now ?? new Date()));
    return applied;
  });
  const saved = written.filter(({ op }) => op.kind !== 'restated');
  return JSON.stringify({
    saved: saved.length > 0,
    written: saved.map(({ op, id }) => ({ kind: op.kind, id })),
    rejected: plan.rejected,
    note: saved.length > 0
      ? '记进了主题文档。继续处理用户当前要求；记下本身不算交付，也不自动要求确认新约定。'
      : '这次没有新记：原因见 rejected（多半是已经记过）。照常回应用户，不要反复重记。',
  });
}
