import {
  AnswerUncertainRequestSchema,
  docLinkNames,
  groupMemoryTopics,
  type MemoryDocLine,
  type MemoryDreamSummary,
  type MemoryLineSource,
  type MemoryTopicDoc,
  type MemoryTopicKind,
  type MemoryTopicListResponse,
  type MemoryTopicView,
  type UncertainItem,
} from '../../shared/api/index.ts';
import { hardLines } from '../../shared/rules-doc.ts';
import { GRANTS_DOC_ID, MEMORY_DOC_CHAR_LIMIT, MEMORY_SECTION_LABELS, PROACTIVE_DOC_ID, RULES_DOC_ID,
  memorySectionsOf, type MemoryDoc, type MemoryDocKind, type MemoryInference,
  type MemoryLine } from '../../shared/state.ts';
import { decideInference, ensureMemoryDocs, findDoc } from '../memory/index.ts';
import { sourcesOf } from './memory-sources.ts';
import type { StateService } from '../state/index.ts';
import { ApiError, notFoundError } from './api-error.ts';
import { param, requireAuth, type Reply, type RequestContext } from './context.ts';
import { confirmedWrite } from './user-confirmation.ts';
import { projectTag } from './project-tag.ts';
import { checkInput } from './validate.ts';

const KIND: Readonly<Record<MemoryDocKind, MemoryTopicKind>> = {
  you: 'about_you',
  rules: 'rules',
  person: 'person',
  project: 'project',
  topic: 'topic',
  skill: 'skill',
  how: 'how',
  grants: 'grants',
  proactive: 'proactive',
};
const RULES_HEADING = '规矩';

const UNCERTAIN_SHOWN = 20;

function uncertainOf(state: StateService, docId: string): MemoryInference[] {
  return state.memoryCuration.inferences.pendingForDoc(docId);
}

function tierOf(state: StateService, doc: MemoryDoc): Pick<MemoryTopicView, 'tier' | 'material'> {
  const material = doc.kind === 'project' && doc.projectId !== null
    ? { kind: 'project' as const, id: doc.projectId } : { kind: 'memory_topic' as const, id: doc.id };
  const mark = state.visibilityMarks.get(material.kind, material.id);
  return { tier: mark?.confirmedAt == null ? 'private' : mark.tier,
    material: { ...material, version: mark?.version ?? 0 } };
}

function sectionCounts(state: StateService, doc: MemoryDoc, extra: Readonly<Record<string, number>> = {}): string {
  const lines = state.memoryDocs.lines.live(doc.id);
  return memorySectionsOf(doc.kind).flatMap((section) => {
    const count = lines.filter((line) => line.section === section).length + (extra[section] ?? 0);
    return count === 0 ? [] : [`${MEMORY_SECTION_LABELS[section]} ${count}`];
  }).join(' · ');
}

const EVERY: Readonly<Record<number, string>> = { 15: '每 15 分钟', 30: '每 30 分钟', 60: '每小时', 120: '每 2 小时' };

function summaryOf(deps: TopicDeps, doc: MemoryDoc): string {
  const { state } = deps;
  if (doc.id === GRANTS_DOC_ID) {
    const now = deps.now().getTime();
    const structured = state.loop.grants.list().length + state.outboundGrants.list().filter((grant) =>
      grant.enabled && grant.revokedAt === null && (grant.expiresAt === null || Date.parse(grant.expiresAt) > now)
      && !(grant.scope.kind === 'once' && grant.usedCount > 0)).length;
    const counts = sectionCounts(state, doc, { allow: structured });
    return counts === '' ? '还没有说好的事' : counts;
  }
  if (doc.id === PROACTIVE_DOC_ID) {
    const beat = deps.heartbeat.view();
    const quiet = `${beat.config.quietFrom}–${beat.config.quietTo} 不打扰`;
    return beat.enabled
      ? `${EVERY[beat.config.intervalMinutes] ?? '定时'}看 ${beat.config.items.length} 件事 · ${quiet}`
      : `心跳关着 · ${quiet}`;
  }
  return doc.summary.trim() === '' ? doc.title : doc.summary;
}

type TopicDeps = Pick<RequestContext['deps'], 'state' | 'now' | 'heartbeat'>;

function topicView(deps: TopicDeps, doc: MemoryDoc): MemoryTopicView {
  const { state } = deps;
  const size = state.memoryDocs.lines.size(doc.id);
  return {
    id: doc.id,
    kind: KIND[doc.kind],
    title: doc.title,
    summary: summaryOf(deps, doc),
    lineCount: size.lines,
    updatedAt: doc.updatedAt,
    project: projectTag(state, doc.projectId),
    uncertainCount: uncertainOf(state, doc.id).length,
    ...tierOf(state, doc),
    overLimit: size.chars > (doc.charLimit || MEMORY_DOC_CHAR_LIMIT),
  };
}

function linksOf(state: StateService, text: string): NonNullable<MemoryDocLine['links']> {
  return docLinkNames(text).map((name) => ({ name, topicId: findDoc(state, name)?.id ?? null }));
}

function dreamSummary(state: StateService): MemoryDreamSummary | null {
  const dream = state.memoryDreams.latest();
  if (dream === undefined || dream.finishedAt === null) {
    return null;
  }
  const changes = state.memoryDreams.changes(dream.id);
  const count = (kind: string) => changes.filter((change) => change.kind === kind).length;
  return { id: dream.id, finishedAt: dream.finishedAt, total: changes.length, add: count('add'),
    replace: count('replace'), unsure: count('unsure'), deadEnd: count('dead_end') };
}

function basisOf(line: MemoryLine): MemoryDocLine['basis'] {
  if (line.anchors.every((anchor) => anchor.kind === 'system')) {
    return 'system';
  }
  if (line.basis === 'tried') {
    return 'tried';
  }
  if (line.basis === 'contact_stated') {
    return 'contact';
  }
  if (line.basis !== 'stated') {
    return 'inferred';
  }
  return line.anchors.some((anchor) => anchor.kind === 'agreement' || anchor.kind === 'term') ? 'agreement' : 'quote';
}

function scopeOf(state: StateService, line: MemoryLine): { scope?: string } {
  const ref = line.scopeRef ?? '';
  switch (line.scopeKind) {
    case 'all':
      return {};
    case 'project':
      return { scope: `只限${state.projects.get(ref)?.name ?? '一个项目'}项目` };
    case 'mate':
      return { scope: `只对${state.mates.get(ref)?.name ?? '一位队友'}` };
    case 'contact':
      return { scope: `只限${state.contacts.get(ref)?.displayName ?? '一位联系人'}` };
  }
}

function lineView(state: StateService, line: MemoryLine, pending: ReadonlySet<string>): MemoryDocLine {
  return {
    id: line.id,
    version: line.version,
    text: line.text,
    basis: basisOf(line),
    sources: sourcesOf(state, line.anchors) as [MemoryLineSource, ...MemoryLineSource[]],
    uncertainId: line.inferenceId !== null && pending.has(line.inferenceId) ? line.inferenceId : null,
    links: linksOf(state, line.text),
    at: line.createdAt,
    ...(line.previous === null ? {} : { previous: line.previous }),
    ...scopeOf(state, line),
    ...(line.basis === 'contact_stated' ? { by: state.memoryDocs.docs.get(line.docId)?.title ?? '对方' } : {}),
  };
}

function uncertainStatus(status: MemoryInference['status']): UncertainItem['status'] {
  switch (status) {
    case 'pending':
      return 'open';
    case 'confirmed':
    case 'rejected':
      return status;
    case 'withdrawn':
      throw new Error('系统撤回的推断不在记忆页的「拿不准的」里显示');
  }
}

function uncertainView(state: StateService, inference: MemoryInference): UncertainItem {
  const doc = state.memoryDocs.docs.get(inference.docId);
  return {
    id: inference.id,
    text: inference.text,
    basis: inference.why.trim() === '' ? 'Plasticine 推断的' : inference.why,
    topicId: inference.docId,
    topicTitle: doc?.title ?? '记忆',
    inferredAt: inference.createdAt,
    status: uncertainStatus(inference.status),
    correction: null,
  };
}

/** GET /v2/memory/topics */
export function listMemoryTopics(context: RequestContext): Reply {
  requireAuth(context);
  const { state, now } = context.deps;
  ensureMemoryDocs(state);
  const docs = state.memoryDocs.docs.live();
  const groups = groupMemoryTopics(docs.map((doc) => topicView(context.deps, doc)));
  const uncertain = state.memoryCuration.inferences.list('pending', { limit: UNCERTAIN_SHOWN })
    .map((inference) => uncertainView(state, inference));
  const composedAt = docs.map((doc) => doc.updatedAt).sort().at(-1) ?? now().toISOString();
  const body: MemoryTopicListResponse = { groups, uncertain, composedAt, dream: dreamSummary(state) };
  return { status: 200, body };
}

/** GET /v2/memory/topics/:id */
export function getMemoryTopic(context: RequestContext): Reply {
  requireAuth(context);
  const { state } = context.deps;
  const doc = state.memoryDocs.docs.get(param(context, 'id'));
  if (doc === undefined || doc.retiredAt !== null) {
    throw notFoundError('这份记忆文档');
  }
  const pending = new Set(uncertainOf(state, doc.id).map((inference) => inference.id));
  const lines = state.memoryDocs.lines.live(doc.id);
  const rules = doc.id === RULES_DOC_ID;
  const known = memorySectionsOf(doc.kind);
  const order = [...known, ...new Set(lines.map((line) => line.section).filter((section) => !known.includes(section)))];
  const sections = order.filter((section) => lines.some((line) => line.section === section)).map((section) => ({
    id: `${doc.id}:${section}`,
    section,
    heading: rules ? RULES_HEADING : MEMORY_SECTION_LABELS[section],
    lines: lines.filter((line) => line.section === section).map((line) => lineView(state, line, pending)),
  }));
  const body: MemoryTopicDoc = { topic: topicView(context.deps, doc), sections, composedAt: doc.updatedAt,
    version: doc.version, ...(rules ? { hardLines: [...hardLines()] } : {}) };
  return { status: 200, body };
}

export function answerUncertain(context: RequestContext): Promise<Reply> {
  const id = param(context, 'id');
  const { state } = context.deps;
  const check = (value: unknown) => checkInput(AnswerUncertainRequestSchema, value, '拿不准的这一条');
  return confirmedWrite(context, check, (body, confirmation) => {
    const current = state.memoryCuration.inferences.get(id);
    if (current === undefined) {
      throw notFoundError('这条拿不准的');
    }
    if (current.status !== 'pending') {
      throw new ApiError(409, 'conflict', '这一条已经定过了，这次没有改。', { next: '刷新记忆页看现在的样子。' });
    }
    const reason = body.answer === 'yes' ? '用户在记忆页说对' : `用户在记忆页说不对${body.correction === null ? ''
      : `：${body.correction}`}`;
    const result = decideInference(state, current, body.answer === 'yes' ? 'confirmed' : 'rejected', confirmation,
      reason);
    const item: UncertainItem = { ...uncertainView(state, result.inference), correction: body.correction };
    return { status: 200, body: item };
  });
}
