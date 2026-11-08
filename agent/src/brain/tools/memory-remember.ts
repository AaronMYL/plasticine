// 「记住一句」的记法（2026-11-03 起写主题文档，不再写旧的 memory_entries）：线在他明确要记、纠正或改口时当场记一行
// （lines/remember-tool.ts 是工具本体），不等后台整理。走和后台整理同一条路（docs/specs/memory-docs.md 第 3 节）：
// 模型给的一条操作先过 planCuration 的校验（来源必须是真实的用户消息、推测只进「拿不准的」、重复不加、决定段只在
// 项目文档、像密钥的不记），再由 applyPlan 在一个事务里落库；落库后到了上限的文档排一次合并压缩。
// 这一轮结束后后台整理还会看同一段话：同一句话已经在这一行的锚点里，不算「用户重说」（memory-curation-ops.ts）。
// 第 10 条（11-06 定）：当场写进主题文档、下一句就生效，同时在「今天的记录」里记一条 remembered；白天不排合并压缩
// （超了上限只标出来，等夜里的整理）。

import { Type, type Static } from 'typebox';
import {
  MEMORY_DOC_SUMMARY_MAX_CHARS,
  MEMORY_DOC_TITLE_MAX_CHARS,
  MEMORY_LINE_MAX_CHARS,
  MEMORY_NEW_DOC_KINDS,
  YOU_DOC_ID,
} from '../../../shared/state.ts';
import { planCuration, type CurationOp, type CurationSource } from '../memory-curation-ops.ts';
import { applyPlan, snapshot, type CurationState } from '../memory-curation-work.ts';
import { ensureMemoryDocs } from '../memory-doc-writes.ts';
import { journalDay, noteRemembered } from '../memory-journal.ts';

const Id = Type.String({ minLength: 1 });
// 一次最多引这么多条用户消息：记一行用不着更多。
const MAX_SOURCES = 10;
// 新建文档用的 ref：planCuration 认 new_doc 的 ref 作文档目标。
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
  section: Type.Optional(Type.Enum(['note', 'decision'])),
  replacesLineId: Type.Optional(Id),
  inferred: Type.Optional(Type.Boolean()),
  why: Type.Optional(Type.String({ maxLength: 1_000 })),
}, { additionalProperties: false });

type Args = Static<typeof Parameters>;

/** 新内核的「记住一句」（lines/remember-tool.ts）用同一份参数，来源换成线里他说的话。 */
export const RememberParameters = Parameters;
export type RememberArgs = Args;

/** 工具参数 → 和后台整理同样形状的操作。 */
export function rememberOps(args: Args): CurationOp[] {
  const ops: CurationOp[] = [];
  if (args.newDoc !== undefined) {
    ops.push({ op: 'new_doc', ref: NEW_DOC_REF, kind: args.newDoc.kind, title: args.newDoc.title,
      summary: args.newDoc.summary });
  }
  const doc = args.newDoc !== undefined ? NEW_DOC_REF : args.docId ?? YOU_DOC_ID;
  const sources = [...new Set(args.messageIds)];
  const section = args.section ?? 'note';
  if (args.replacesLineId !== undefined) {
    ops.push({ op: 'revise', line: args.replacesLineId, text: args.text, sources });
  } else if (args.inferred === true) {
    ops.push({ op: 'infer', doc, section, text: args.text, why: args.why ?? '', sources });
  } else {
    ops.push({ op: 'add', doc, section, text: args.text, sources });
  }
  return ops;
}

/**
 * 按核过的来源记一行（同一条路：planCuration 校验、applyPlan 落库、到上限排合并）。来源由调用方核：旧对话是 messages
 * 表里真实的用户消息，新内核是线里他自己说的那一条（锚点 ref 写成 line:<线>:<seq>）。
 */
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
