// /v2/memory/topics：记忆按主题整理成活文档（2026-11-02 第 102 条）。关于你、人、项目、话题各一页；项目那页就是
// 项目档案；每行链回原话。记忆页上是一份主题目录（每个主题一句话说明，点开看文档），加上「拿不准的」几条：
// Plasticine 推断出来的，等用户一句话确认或否掉。用户不会细看记忆，所以目录和文档都要轻。
// 原来的三栏（原话 · 解释 · 约定）、判断页、词表照旧，接口不动；这里只是新加的一层读法。
// 设计稿阶段：只有假接口实现；真接口下一批接。

import { Type, type Static } from 'typebox';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema } from './common.ts';
import { OrNull } from './lineage.ts';
import { ProjectTagSchema } from './project-tag.ts';
import { TIERS } from './visibility.ts';

export const MEMORY_TOPICS_PATH = `${API_PREFIX}/memory/topics`;
export const MEMORY_UNCERTAIN_PATH = `${API_PREFIX}/memory/uncertain`;

// rules：「怎么替你做事」（第 4 批），和「关于你」排在最前面一组。第 16 条（11-06）：类型是 关于你、怎么替你做事、项目、人、
// 话题、技能；目录按这个次序分组（设计稿 Plasticine-Memory：关于你和做事方式 → 项目 → 人）。
export const MEMORY_TOPIC_KINDS = ['about_you', 'rules', 'project', 'person', 'topic', 'skill'] as const;
export type MemoryTopicKind = (typeof MEMORY_TOPIC_KINDS)[number];

export const MEMORY_TOPIC_KIND_LABELS: Readonly<Record<MemoryTopicKind, string>> = {
  about_you: '关于你',
  rules: '主线的 Soul',
  person: '人物',
  project: '项目',
  topic: '话题',
  skill: '技能',
};

/** 目录里每种文档排进哪一组：「怎么替你做事」和「关于你」同一组。 */
export const MEMORY_TOPIC_GROUP_OF: Readonly<Record<MemoryTopicKind, MemoryTopicKind>> = {
  about_you: 'about_you', rules: 'about_you', person: 'person', project: 'project', topic: 'topic', skill: 'skill' };

/** 组名：「关于你」那一组叫「关于你和做事方式」（设计稿）。 */
export const MEMORY_TOPIC_GROUP_LABELS: Readonly<Record<MemoryTopicKind, string>> = {
  ...MEMORY_TOPIC_KIND_LABELS,
  about_you: '关于你和做事方式',
};

/** 双链（第 16 条）：一篇提到另一篇时写 [[名字]]。按出现的先后，同名只算一次。 */
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

/** 按组排好的目录：同一组里「关于你」在前、「怎么替你做事」随后，其余保持给的顺序。 */
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
  /** 目录里的一句话说明。 */
  summary: Type.String({ minLength: 1 }),
  lineCount: Type.Integer({ minimum: 0 }),
  updatedAt: IsoTimeSchema,
  project: OrNull(ProjectTagSchema),
  /** 这一页里还有几条拿不准的。 */
  uncertainCount: Type.Integer({ minimum: 0 }),
  /**
   * 档位（第 19 条）：没定过、只有建议的都是私密；界面只在不是私密时标出来。项目档案的档位就是项目的档位。
   * material 是改档位时发给 /v2/visibility/marks 的那份材料和它现在的 version。
   */
  tier: Type.Enum(TIERS),
  material: Type.Object({ kind: Type.Enum(['memory_topic', 'project']), id: IdSchema,
    version: Type.Integer({ minimum: 0 }) }),
  /** 在用的字数超了这篇的上限：等夜里的整理压缩合并（第 16 条）。 */
  overLimit: Type.Boolean(),
});
export type MemoryTopicView = Static<typeof MemoryTopicViewSchema>;

/** 一行从哪来：原话（对话里的一条消息、笔记的一段）、约定，或者 Plasticine 推断。 */
export const MEMORY_TOPIC_LINE_BASES = ['quote', 'agreement', 'inferred', 'system'] as const;

export const MemoryLineSourceSchema = Type.Object({
  kind: Type.Union([Type.Literal('message'), Type.Literal('note'), Type.Literal('book'),
    Type.Literal('agreement'), Type.Literal('system')]),
  id: IdSchema,
  /** 链上写的字，例如「10-26 对话」。 */
  label: Type.String({ minLength: 1 }),
  at: IsoTimeSchema,
});
export type MemoryLineSource = Static<typeof MemoryLineSourceSchema>;

export const MemoryDocLineSchema = Type.Object({
  id: IdSchema,
  text: Type.String({ minLength: 1 }),
  basis: Type.Enum(MEMORY_TOPIC_LINE_BASES),
  /** 每行链回原话：至少一条来源；推断的行链回它所依据的原话。 */
  sources: Type.Array(MemoryLineSourceSchema, { minItems: 1 }),
  /** 这一行还在「拿不准的」里等确认时，对应那一条的 id。 */
  uncertainId: OrNull(IdSchema),
  /** 行里的 [[名字]] 指向哪一篇；对不上的为 null（照原样显示，不能点）。 */
  links: Type.Optional(Type.Array(Type.Object({ name: Type.String({ minLength: 1 }), topicId: OrNull(IdSchema) }))),
});
export type MemoryDocLine = Static<typeof MemoryDocLineSchema>;

export const MemoryDocSectionSchema = Type.Object({
  id: IdSchema,
  heading: Type.String({ minLength: 1 }),
  lines: Type.Array(MemoryDocLineSchema),
});
export type MemoryDocSection = Static<typeof MemoryDocSectionSchema>;

export const MemoryTopicDocSchema = Type.Object({
  topic: MemoryTopicViewSchema,
  sections: Type.Array(MemoryDocSectionSchema),
  /** Plasticine 最近一次整理这份文档的时间。 */
  composedAt: IsoTimeSchema,
  version: Type.Integer({ minimum: 0 }),
  /** 「怎么替你做事」最前面的硬线（shared/rules-doc.ts）；别的文档不带。 */
  hardLines: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});
export type MemoryTopicDoc = Static<typeof MemoryTopicDocSchema>;

export const UNCERTAIN_STATUSES = ['open', 'confirmed', 'rejected'] as const;

/** 拿不准的一条：Plasticine 推断出来的，等用户一句话确认或否掉。 */
export const UncertainItemSchema = Type.Object({
  id: IdSchema,
  text: Type.String({ minLength: 1 }),
  /** 依据，一句。 */
  basis: Type.String({ minLength: 1 }),
  topicId: IdSchema,
  topicTitle: Type.String({ minLength: 1 }),
  inferredAt: IsoTimeSchema,
  status: Type.Enum(UNCERTAIN_STATUSES),
  /** 用户否掉时顺手改的一句（可无）。 */
  correction: OrNull(Type.String()),
});
export type UncertainItem = Static<typeof UncertainItemSchema>;

export const MemoryTopicGroupSchema = Type.Object({
  kind: Type.Enum(MEMORY_TOPIC_KINDS),
  topics: Type.Array(MemoryTopicViewSchema),
});

/** 最近一次夜里整理的摘要：页头「昨晚整理了 n 条」的入口。没有做完的整理时为 null，入口整个不出现。 */
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
  /** 还开着的拿不准的，新的在前，界面只摆几条。 */
  uncertain: Type.Array(UncertainItemSchema),
  composedAt: IsoTimeSchema,
  dream: OrNull(MemoryDreamSummarySchema),
});
export type MemoryTopicListResponse = Static<typeof MemoryTopicListResponseSchema>;

/** POST /v2/memory/uncertain/:id：对 / 不对（可带一句改法）。 */
export const AnswerUncertainRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    answer: Type.Union([Type.Literal('yes'), Type.Literal('no')]),
    correction: OrNull(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type AnswerUncertainRequest = Static<typeof AnswerUncertainRequestSchema>;
