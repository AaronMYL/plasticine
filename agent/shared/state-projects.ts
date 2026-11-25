import { Type, type Static } from 'typebox';
import { ActorSchema, IdSchema, IsoTimeSchema, Nullable, OBJECT_META } from './state-common.ts';

const STRICT = { additionalProperties: false };
const Text = Type.String({ minLength: 1 });

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

export const ProjectStatusSchema = Type.Object(
  { text: Text, by: Type.Enum(['user', 'brain']), at: IsoTimeSchema },
  STRICT,
);

export const ProposedHealthSchema = Type.Object(
  { value: Type.Enum(PROJECT_HEALTHS), reason: Text, at: IsoTimeSchema },
  STRICT,
);

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

export const PROJECT_ITEM_TYPES = ['note', 'link', 'todo'] as const;
export type ProjectItemType = (typeof PROJECT_ITEM_TYPES)[number];
export const PROJECT_TODO_TITLE_MAX_CHARS = 200;
export const ProjectItemInputSchema = Type.Object(
  {
    projectId: IdSchema,
    targetType: Type.Enum(PROJECT_ITEM_TYPES),
    targetId: Text,
    title: Type.Optional(Nullable(Type.String())),
    addedBy: ActorSchema,
    reason: Text,
    due: Type.Optional(Nullable(DateOnlySchema)),
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
