// 项目（用户 2026-11-01 定：项目取代关切成为界面上的组织单位）。项目是一面透镜：笔记、链接各自留在原处，通过
// project_items 挂到某个项目下；项目自己只存档案、截止、健康度、分工和一句现状。2026-11-05 关切并进项目，成了项目里
// 带期限的待办（project_items 里 target_type = todo 的一行，迁移 0059）；任务删掉，项目的「在做」看它的线。
// 健康度和 p 同一个规矩：Plasticine 只写 proposedHealth，health 只由用户点「对 / 改」写入。
// Import from shared/state.ts.

import { Type, type Static } from 'typebox';
import { ActorSchema, IdSchema, IsoTimeSchema, Nullable, OBJECT_META } from './state-common.ts';

const STRICT = { additionalProperties: false };
const Text = Type.String({ minLength: 1 });

/** 两个常驻项目（用户 2026-11-01 定）：不能删除，排在列表最后。 */
export const STANDING_PROJECT_IDS = { plasticine: 'project-plasticine', personal: 'project-personal' } as const;
export const PROJECT_LIFECYCLES = ['active', 'paused', 'done'] as const;
export const PROJECT_HEALTHS = ['ok', 'risk', 'off'] as const;
export const DateOnlySchema = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });

export const ProjectBriefSchema = Type.Object(
  {
    goal: Type.String(),
    constraints: Type.String(),
    rules: Type.String(),
    terms: Type.String(),
  },
  STRICT,
);
export type ProjectBrief = Static<typeof ProjectBriefSchema>;
export const EMPTY_BRIEF: ProjectBrief = { goal: '', constraints: '', rules: '', terms: '' };

export const ProjectPersonSchema = Type.Object({ who: Text, does: Type.String() }, STRICT);
export type ProjectPerson = Static<typeof ProjectPersonSchema>;

/** 一句现状：谁写的分开记（Plasticine 写的是推理，w = 0.1；用户写的是原话）。 */
export const ProjectStatusSchema = Type.Object(
  { text: Text, by: Type.Enum(['user', 'brain']), at: IsoTimeSchema },
  STRICT,
);
export type ProjectStatus = Static<typeof ProjectStatusSchema>;

export const ProposedHealthSchema = Type.Object(
  { value: Type.Enum(PROJECT_HEALTHS), reason: Text, at: IsoTimeSchema },
  STRICT,
);
export type ProposedHealth = Static<typeof ProposedHealthSchema>;

export const ProjectInputSchema = Type.Object(
  {
    name: Text,
    standing: Type.Optional(Type.Boolean()),
    lifecycle: Type.Optional(Type.Enum(PROJECT_LIFECYCLES)),
    due: Type.Optional(Nullable(DateOnlySchema)),
    status: Type.Optional(Nullable(ProjectStatusSchema)),
    next: Type.Optional(Nullable(Type.String())),
    health: Type.Optional(Nullable(Type.Enum(PROJECT_HEALTHS))),
    healthAt: Type.Optional(Nullable(IsoTimeSchema)),
    proposedHealth: Type.Optional(Nullable(ProposedHealthSchema)),
    brief: Type.Optional(ProjectBriefSchema),
    people: Type.Optional(Type.Array(ProjectPersonSchema)),
  },
  STRICT,
);
export type ProjectInput = Static<typeof ProjectInputSchema>;
export const ProjectPatchSchema = Type.Partial(ProjectInputSchema, STRICT);
export type ProjectPatch = Static<typeof ProjectPatchSchema>;
export const ProjectSchema = Type.Object({ ...OBJECT_META, ...Type.Required(ProjectInputSchema).properties });
export type Project = Static<typeof ProjectSchema>;

/** 挂到项目下的东西。一样东西只属于一个项目（UNIQUE target_type + target_id）。 */
export const PROJECT_ITEM_TYPES = ['note', 'link', 'todo'] as const;
export type ProjectItemType = (typeof PROJECT_ITEM_TYPES)[number];
export const PROJECT_TODO_TITLE_MAX_CHARS = 200;
export const ProjectItemInputSchema = Type.Object(
  {
    projectId: IdSchema,
    targetType: Type.Enum(PROJECT_ITEM_TYPES),
    /** 链接没有自己的对象，target_id 就是链接地址本身；待办也没有，target_id 是它自己的标识。 */
    targetId: Text,
    title: Type.Optional(Nullable(Type.String())),
    addedBy: ActorSchema,
    reason: Text,
    /** 待办的期限（只有日期）；没有期限、或不是待办，是 null。 */
    due: Type.Optional(Nullable(DateOnlySchema)),
    /** 待办做完的时间；还没做完、或不是待办，是 null。 */
    doneAt: Type.Optional(Nullable(IsoTimeSchema)),
  },
  STRICT,
);
export type ProjectItemInput = Static<typeof ProjectItemInputSchema>;
export const ProjectItemSchema = Type.Object({
  ...Type.Required(ProjectItemInputSchema).properties,
  id: IdSchema,
  createdAt: IsoTimeSchema,
});
export type ProjectItem = Static<typeof ProjectItemSchema>;

/** 项目的动态里项目自己那部分（成员关切的改动另从它们的来路读）。只追加。 */
export const PROJECT_EVENT_KINDS = ['created', 'status', 'health', 'proposed_health', 'edited', 'filed', 'unfiled',
  'weekly'] as const;
export const ProjectEventInputSchema = Type.Object(
  {
    projectId: IdSchema,
    kind: Type.Enum(PROJECT_EVENT_KINDS),
    text: Text,
    actor: ActorSchema,
    actorRef: Type.Optional(Nullable(Type.String())),
  },
  STRICT,
);
export type ProjectEventInput = Static<typeof ProjectEventInputSchema>;
export const ProjectEventSchema = Type.Object({
  ...Type.Required(ProjectEventInputSchema).properties,
  id: IdSchema,
  createdAt: IsoTimeSchema,
});
export type ProjectEvent = Static<typeof ProjectEventSchema>;
