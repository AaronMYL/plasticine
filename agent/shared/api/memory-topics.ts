import { Type, type Static } from 'typebox';
import { MEMORY_LINE_SECTIONS } from '../state.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';
import { ProjectTagSchema } from './project-tag.ts';
import { TIERS } from './visibility.ts';

export const MEMORY_TOPICS_PATH = `${API_PREFIX}/memory/topics`;
export const MEMORY_UNCERTAIN_PATH = `${API_PREFIX}/memory/uncertain`;

export const MEMORY_TOPIC_KINDS = ['grants', 'proactive', 'about_you', 'rules', 'person', 'project', 'topic', 'skill',
  'how'] as const;
export type MemoryTopicKind = (typeof MEMORY_TOPIC_KINDS)[number];

export const MEMORY_TOPIC_KIND_LABELS: Readonly<Record<MemoryTopicKind, string>> = {
  about_you: '关于你',
  rules: '规则',
  person: '人物',
  project: '项目',
  topic: '话题',
  skill: '技能',
  how: '做事经验',
  grants: '承诺和授权',
  proactive: '主动告诉你',
};

export const MEMORY_TOPIC_GROUP_OF: Readonly<Record<MemoryTopicKind, MemoryTopicKind>> = {
  about_you: 'about_you', rules: 'about_you', person: 'person', project: 'project', topic: 'topic', skill: 'topic',
  how: 'how', grants: 'grants', proactive: 'grants' };

export const MEMORY_TOPIC_GROUP_LABELS: Readonly<Record<MemoryTopicKind, string>> = {
  ...MEMORY_TOPIC_KIND_LABELS,
  about_you: '你',
  topic: '其他',
  grants: '说好的',
};

export function docLinkNames(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(/\[\[([^[\]\n]{1,60})\]\]/g)) {
    const name = match[1]?.trim() ?? '';
    if (name !== '' && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

export function groupMemoryTopics<T extends { kind: MemoryTopicKind }>(topics: readonly T[]):
  { kind: MemoryTopicKind; topics: T[] }[] {
  return MEMORY_TOPIC_KINDS.filter((kind) => MEMORY_TOPIC_GROUP_OF[kind] === kind).map((kind) => ({ kind,
    topics: topics.filter((topic) => MEMORY_TOPIC_GROUP_OF[topic.kind] === kind)
      .sort((a, b) => MEMORY_TOPIC_KINDS.indexOf(a.kind) - MEMORY_TOPIC_KINDS.indexOf(b.kind)) }))
    .filter((group) => group.topics.length > 0);
}

export const MemoryTopicViewSchema = Type.Object({
  id: IdSchema,
  kind: Type.Enum(MEMORY_TOPIC_KINDS),
  title: Type.String({ minLength: 1 }),
  summary: Type.String({ minLength: 1 }),
  lineCount: Type.Integer({ minimum: 0 }),
  updatedAt: IsoTimeSchema,
  project: OrNull(ProjectTagSchema),
  uncertainCount: Type.Integer({ minimum: 0 }),
  tier: Type.Enum(TIERS),
  material: Type.Object({ kind: Type.Enum(['memory_topic', 'project']), id: IdSchema,
    version: Type.Integer({ minimum: 0 }) }),
  overLimit: Type.Boolean(),
});
export type MemoryTopicView = Static<typeof MemoryTopicViewSchema>;

export const MEMORY_TOPIC_LINE_BASES = ['quote', 'agreement', 'inferred', 'system', 'contact', 'tried'] as const;

export const MemoryLineSourceSchema = Type.Object({
  kind: Type.Union([Type.Literal('message'), Type.Literal('note'), Type.Literal('book'),
    Type.Literal('agreement'), Type.Literal('system'), Type.Literal('contact'),
    Type.Literal('work')]),
  id: IdSchema,
  label: Type.String({ minLength: 1 }),
  at: IsoTimeSchema,
});
export type MemoryLineSource = Static<typeof MemoryLineSourceSchema>;

export const MemoryDocLineSchema = Type.Object({
  id: IdSchema,
  version: Type.Integer({ minimum: 1 }),
  text: Type.String({ minLength: 1 }),
  basis: Type.Enum(MEMORY_TOPIC_LINE_BASES),
  by: Type.Optional(Type.String()),
  sources: Type.Array(MemoryLineSourceSchema, { minItems: 1 }),
  uncertainId: OrNull(IdSchema),
  links: Type.Optional(Type.Array(Type.Object({ name: Type.String({ minLength: 1 }), topicId: OrNull(IdSchema) }))),
  at: Type.Optional(IsoTimeSchema),
  previous: Type.Optional(Type.String()),
  scope: Type.Optional(Type.String()),
});
export type MemoryDocLine = Static<typeof MemoryDocLineSchema>;

export const MemoryDocSectionSchema = Type.Object({
  id: IdSchema,
  section: Type.Optional(Type.Enum(MEMORY_LINE_SECTIONS)),
  heading: Type.String({ minLength: 1 }),
  lines: Type.Array(MemoryDocLineSchema),
});
export type MemoryDocSection = Static<typeof MemoryDocSectionSchema>;

export const MemoryTopicDocSchema = Type.Object({
  topic: MemoryTopicViewSchema,
  sections: Type.Array(MemoryDocSectionSchema),
  composedAt: IsoTimeSchema,
  version: Type.Integer({ minimum: 0 }),
  hardLines: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});
export type MemoryTopicDoc = Static<typeof MemoryTopicDocSchema>;

export const UNCERTAIN_STATUSES = ['open', 'confirmed', 'rejected'] as const;

export const UncertainItemSchema = Type.Object({
  id: IdSchema,
  text: Type.String({ minLength: 1 }),
  basis: Type.String({ minLength: 1 }),
  topicId: IdSchema,
  topicTitle: Type.String({ minLength: 1 }),
  inferredAt: IsoTimeSchema,
  status: Type.Enum(UNCERTAIN_STATUSES),
  correction: OrNull(Type.String()),
});
export type UncertainItem = Static<typeof UncertainItemSchema>;

export const MemoryTopicGroupSchema = Type.Object({
  kind: Type.Enum(MEMORY_TOPIC_KINDS),
  topics: Type.Array(MemoryTopicViewSchema),
});

export const MemoryDreamSummarySchema = Type.Object({
  id: IdSchema,
  finishedAt: IsoTimeSchema,
  total: Type.Integer({ minimum: 0 }),
  add: Type.Integer({ minimum: 0 }),
  replace: Type.Integer({ minimum: 0 }),
  unsure: Type.Integer({ minimum: 0 }),
  deadEnd: Type.Integer({ minimum: 0 }),
});
export type MemoryDreamSummary = Static<typeof MemoryDreamSummarySchema>;

export const MemoryTopicListResponseSchema = Type.Object({
  groups: Type.Array(MemoryTopicGroupSchema),
  uncertain: Type.Array(UncertainItemSchema),
  composedAt: IsoTimeSchema,
  dream: OrNull(MemoryDreamSummarySchema),
});
export type MemoryTopicListResponse = Static<typeof MemoryTopicListResponseSchema>;

export const AnswerUncertainRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    answer: Type.Union([Type.Literal('yes'), Type.Literal('no')]),
    correction: OrNull(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type AnswerUncertainRequest = Static<typeof AnswerUncertainRequestSchema>;
