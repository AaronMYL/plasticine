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

export const PROJECT_SOURCES = ['user', 'plasticine', 'reality', 'system'] as const;

export const ProjectQuerySchema = Type.Object(
  { tz: Type.Optional(TimeZoneSchema), includeDone: Type.Optional(Type.Boolean()) },
  { additionalProperties: false },
);
export type ProjectQuery = Static<typeof ProjectQuerySchema>;

export const ProjectRowViewSchema = Type.Object({
  id: IdSchema,
  name: Type.String(),
  hue: Type.Enum(PROJECT_HUES),
  standing: Type.Boolean(),
  lifecycle: Type.Enum(PROJECT_LIFECYCLES),
  health: OrNull(Type.Enum(PROJECT_HEALTHS)),
  proposedHealth: OrNull(Type.Object({ value: Type.Enum(PROJECT_HEALTHS), reason: Type.String(), at: IsoTimeSchema })),
  status: OrNull(Type.Object({ text: Type.String(), by: Type.Enum(['user', 'brain']), at: IsoTimeSchema })),
  next: OrNull(Type.String()),
  due: OrNull(DateOnlySchema),
  dueInDays: OrNull(Type.Integer()),
  todosDone: Type.Integer({ minimum: 0 }),
  todosTotal: Type.Integer({ minimum: 0 }),
  running: Type.Integer({ minimum: 0 }),
  waitingOnYou: Type.Integer({ minimum: 0 }),
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

export const ProjectTodoViewSchema = Type.Object({
  id: IdSchema,
  title: Type.String(),
  due: OrNull(DateOnlySchema),
  dueInDays: OrNull(Type.Integer()),
  doneAt: OrNull(IsoTimeSchema),
  createdAt: IsoTimeSchema,
});
export type ProjectTodoView = Static<typeof ProjectTodoViewSchema>;

export const ProjectLineViewSchema = Type.Object({
  id: IdSchema,
  title: Type.String(),
  status: LineStatusSchema,
  updatedAt: IsoTimeSchema,
});
export type ProjectLineView = Static<typeof ProjectLineViewSchema>;

export const ProjectMaterialViewSchema = Type.Object({
  kind: Type.Enum(['note', 'link']),
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
  decisions: Type.Array(ProjectDecisionViewSchema),
  people: Type.Array(ProjectPersonSchema),
  todos: Type.Array(ProjectTodoViewSchema),
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

export const SetProjectHealthRequestSchema = Type.Object(
  { requestId: RequestIdSchema, version: Type.Integer({ minimum: 1 }), value: Type.Enum(PROJECT_HEALTHS) },
  { additionalProperties: false },
);
export type SetProjectHealthRequest = Static<typeof SetProjectHealthRequestSchema>;

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

export const AddProjectTodoRequestSchema = Type.Object(
  { requestId: RequestIdSchema, title: TodoTitleSchema, due: Type.Optional(OrNull(DateOnlySchema)) },
  { additionalProperties: false },
);
export type AddProjectTodoRequest = Static<typeof AddProjectTodoRequestSchema>;

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
