// /v2/projects：项目列表与详情（用户 2026-11-01 定：项目取代关切成为界面上的组织单位）。项目是透镜：待办 = 带期限的
// 事（2026-11-05 关切并进来，迁移 0059），在做 = 挂在这个项目下的线，资料 = 笔记和链接。
// 健康度：health 只由用户写（POST /:id/health），Plasticine 只写 proposedHealth。每个写操作按 requestId 幂等、带 version。

import { Type, type Static } from 'typebox';
import {
  DateOnlySchema,
  PROJECT_HEALTHS,
  PROJECT_LIFECYCLES,
  PROJECT_TODO_TITLE_MAX_CHARS,
  ProjectBriefSchema,
  ProjectPersonSchema,
} from '../state.ts';
import { API_PREFIX, IdSchema, IsoTimeSchema, RequestIdSchema, TimeZoneSchema } from './common.ts';
import { OrNull } from './lineage.ts';
import { LineStatusSchema } from './lines.ts';
import { PROJECT_HUES } from './project-tag.ts';

export const PROJECTS_PATH = `${API_PREFIX}/projects`;

export const PROJECT_HEALTH_LABELS: Readonly<Record<(typeof PROJECT_HEALTHS)[number], string>> = {
  ok: '顺利',
  risk: '有风险',
  off: '偏了',
};

export const PROJECT_LIFECYCLE_LABELS: Readonly<Record<(typeof PROJECT_LIFECYCLES)[number], string>> = {
  active: '进行',
  paused: '暂停',
  done: '完成',
};

/** 动态和现状的来源：你说的 / Plasticine 写的 / 现实结果 / 系统（迁移、建项目）。 */
export const PROJECT_SOURCES = ['user', 'plasticine', 'reality', 'system'] as const;
export const PROJECT_SOURCE_LABELS: Readonly<Record<(typeof PROJECT_SOURCES)[number], string>> = {
  user: '你说的',
  plasticine: 'Plasticine 写的',
  reality: '实际结果',
  system: '系统',
};

/** GET /v2/projects?tz=&includeDone= 与 GET /v2/projects/:id?tz= */
export const ProjectQuerySchema = Type.Object(
  { tz: Type.Optional(TimeZoneSchema), includeDone: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
export type ProjectQuery = Static<typeof ProjectQuerySchema>;

export const ProjectRowViewSchema = Type.Object({
  id: IdSchema,
  name: Type.String(),
  /** 项目色（第 104 条）：书签分节、标签分组的色点和组色线都用它。 */
  hue: Type.Enum(PROJECT_HUES),
  standing: Type.Boolean(),
  lifecycle: Type.Enum(PROJECT_LIFECYCLES),
  health: OrNull(Type.Enum(PROJECT_HEALTHS)),
  proposedHealth: OrNull(Type.Object({ value: Type.Enum(PROJECT_HEALTHS), reason: Type.String(), at: IsoTimeSchema })),
  status: OrNull(Type.Object({ text: Type.String(), by: Type.Enum(['user', 'brain']), at: IsoTimeSchema })),
  next: OrNull(Type.String()),
  due: OrNull(DateOnlySchema),
  /** 离截止还有几天（按用户时区的今天算）；过了是负数。 */
  dueInDays: OrNull(Type.Integer()),
  /** 做完的待办 / 全部待办。 */
  todosDone: Type.Integer({ minimum: 0 }),
  todosTotal: Type.Integer({ minimum: 0 }),
  /** 这个项目下在做的线。 */
  running: Type.Integer({ minimum: 0 }),
  waitingOnYou: Type.Integer({ minimum: 0 }),
  /** 项目本身或挂在下面的东西最近一次变动。 */
  touchedAt: IsoTimeSchema,
  version: Type.Integer({ minimum: 1 }),
});
export type ProjectRowView = Static<typeof ProjectRowViewSchema>;

export const ProjectListResponseSchema = Type.Object({
  projects: Type.Array(ProjectRowViewSchema),
  summary: Type.Object({
    active: Type.Integer({ minimum: 0 }),
    overdue: Type.Integer({ minimum: 0 }),
    dueThisWeek: Type.Integer({ minimum: 0 }),
  }),
});
export type ProjectListResponse = Static<typeof ProjectListResponseSchema>;

/** 项目里的一条待办。 */
export const ProjectTodoViewSchema = Type.Object({
  id: IdSchema,
  title: Type.String(),
  due: OrNull(DateOnlySchema),
  /** 离期限还有几天（按用户时区的今天算）；过了是负数；没有期限是 null。 */
  dueInDays: OrNull(Type.Integer()),
  doneAt: OrNull(IsoTimeSchema),
  createdAt: IsoTimeSchema,
});
export type ProjectTodoView = Static<typeof ProjectTodoViewSchema>;

/** 挂在项目下的一条线（新内核的后台工作）。 */
export const ProjectLineViewSchema = Type.Object({
  id: IdSchema,
  title: Type.String(),
  status: LineStatusSchema,
  updatedAt: IsoTimeSchema,
});
export type ProjectLineView = Static<typeof ProjectLineViewSchema>;

export const ProjectMaterialViewSchema = Type.Object({
  kind: Type.Enum(['note', 'link']),
  /** note → 笔记 id；link → 地址。 */
  ref: Type.String(),
  title: Type.String(),
  at: OrNull(IsoTimeSchema),
});
export type ProjectMaterialView = Static<typeof ProjectMaterialViewSchema>;

export const ProjectActivityViewSchema = Type.Object({
  at: IsoTimeSchema,
  text: Type.String(),
  source: Type.Enum(PROJECT_SOURCES),
});
export type ProjectActivityView = Static<typeof ProjectActivityViewSchema>;

/** 档案里定下的一件事（项目文档的「决定」段）；quoteRef 指回他说定的那句（line:<线>:<序号>），点「原话」回到那里。 */
export const ProjectDecisionViewSchema = Type.Object({
  id: IdSchema,
  text: Type.String(),
  quoteRef: OrNull(Type.String()),
  at: IsoTimeSchema,
});
export type ProjectDecisionView = Static<typeof ProjectDecisionViewSchema>;

export const ProjectDetailSchema = Type.Object({
  project: ProjectRowViewSchema,
  brief: ProjectBriefSchema,
  /** 档案里定下的事，先定的在前。 */
  decisions: Type.Array(ProjectDecisionViewSchema),
  people: Type.Array(ProjectPersonSchema),
  /** 没做完的在前（有期限的按期限），做完的在后。 */
  todos: Type.Array(ProjectTodoViewSchema),
  /** 这个项目下的线，最近动过的在前。 */
  lines: Type.Array(ProjectLineViewSchema),
  materials: Type.Array(ProjectMaterialViewSchema),
  activity: Type.Array(ProjectActivityViewSchema),
});
export type ProjectDetail = Static<typeof ProjectDetailSchema>;

const NameSchema = Type.String({ minLength: 1, maxLength: 100 });
const ShortText = Type.String({ maxLength: 300 });
const BriefInputSchema = Type.Object(
  {
    goal: Type.String({ maxLength: 2_000 }),
    constraints: Type.String({ maxLength: 2_000 }),
    rules: Type.String({ maxLength: 2_000 }),
    terms: Type.String({ maxLength: 2_000 }),
  },
  { additionalProperties: false },
);
const PeopleInputSchema = Type.Array(
  Type.Object(
    { who: Type.String({ minLength: 1, maxLength: 50 }), does: Type.String({ maxLength: 200 }) },
    { additionalProperties: false },
  ),
  { maxItems: 20 },
);

/** POST /v2/projects → 201 { project }. */
export const CreateProjectRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    name: NameSchema,
    due: Type.Optional(OrNull(DateOnlySchema)),
    goal: Type.Optional(Type.String({ maxLength: 2_000 })),
  },
  { additionalProperties: false },
);
export type CreateProjectRequest = Static<typeof CreateProjectRequestSchema>;

/** PUT /v2/projects/:id → 200 { project }：改名、截止、下一步、现状、档案、分工、生命周期。 */
export const EditProjectRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    version: Type.Integer({ minimum: 1 }),
    name: Type.Optional(NameSchema),
    due: Type.Optional(OrNull(DateOnlySchema)),
    next: Type.Optional(OrNull(ShortText)),
    status: Type.Optional(OrNull(Type.String({ minLength: 1, maxLength: 300 }))),
    brief: Type.Optional(BriefInputSchema),
    people: Type.Optional(PeopleInputSchema),
    lifecycle: Type.Optional(Type.Enum(PROJECT_LIFECYCLES)),
  },
  { additionalProperties: false },
);
export type EditProjectRequest = Static<typeof EditProjectRequestSchema>;

/** POST /v2/projects/:id/health → 200 { project }：用户点「对」（采纳提议）或「改」（另选一档）。 */
export const SetProjectHealthRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }), value: Type.Enum(PROJECT_HEALTHS) },
  { additionalProperties: false },
);
export type SetProjectHealthRequest = Static<typeof SetProjectHealthRequestSchema>;

/** POST /v2/projects/:id/items → 200 { project }：把一样东西归到这个项目（已在别的项目下就挪过来）。 */
export const FileProjectItemRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    targetType: Type.Enum(['note', 'link']),
    targetId: Type.String({ minLength: 1, maxLength: 2_000 }),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type FileProjectItemRequest = Static<typeof FileProjectItemRequestSchema>;

/** POST /v2/projects/:id/items/remove → 200 { project }：从项目里拿出来，东西本身不动；待办（targetId = 待办 id）就是删掉。 */
export const UnfileProjectItemRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    targetType: Type.Enum(['note', 'link', 'todo']),
    targetId: Type.String({ minLength: 1, maxLength: 2_000 }),
  },
  { additionalProperties: false },
);
export type UnfileProjectItemRequest = Static<typeof UnfileProjectItemRequestSchema>;

const TodoTitleSchema = Type.String({ minLength: 1, maxLength: PROJECT_TODO_TITLE_MAX_CHARS });

/** POST /v2/projects/:id/todos → 201 { project, todo }：加一条待办。 */
export const AddProjectTodoRequestSchema = Type.Object(
  { requestId: RequestIdSchema, title: TodoTitleSchema, due: Type.Optional(OrNull(DateOnlySchema)) },
  { additionalProperties: false },
);
export type AddProjectTodoRequest = Static<typeof AddProjectTodoRequestSchema>;

/** PUT /v2/projects/:id/todos/:todoId → 200 { project, todo }：改标题、期限，勾上或取消做完。 */
export const EditProjectTodoRequestSchema = Type.Object(
  {
    requestId: RequestIdSchema,
    title: Type.Optional(TodoTitleSchema),
    due: Type.Optional(OrNull(DateOnlySchema)),
    done: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type EditProjectTodoRequest = Static<typeof EditProjectTodoRequestSchema>;

export const ProjectResponseSchema = Type.Object({ project: ProjectRowViewSchema });
export type ProjectResponse = Static<typeof ProjectResponseSchema>;

export const ProjectTodoResponseSchema = Type.Object({ project: ProjectRowViewSchema, todo: ProjectTodoViewSchema });
export type ProjectTodoResponse = Static<typeof ProjectTodoResponseSchema>;
