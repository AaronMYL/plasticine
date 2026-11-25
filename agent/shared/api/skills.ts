import { Type, type Static } from 'typebox';
import { SkillDescriptorSchema } from '../skills.ts';
import { API_PREFIX, IsoTimeSchema, RequestIdSchema } from './common.ts';

export { SkillDescriptorSchema, SkillSourceSchema } from '../skills.ts';
export type { SkillDescriptor, SkillSource } from '../skills.ts';
export const SKILLS_PATH = `${API_PREFIX}/skills`;
export const SkillRowSchema = Type.Object({
  ...SkillDescriptorSchema.properties,
  uses: Type.Integer({ minimum: 0 }),
  lastUsedAt: Type.Union([IsoTimeSchema, Type.Null()]),
  title: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});
export type SkillRow = Static<typeof SkillRowSchema>;
export const SkillListResponseSchema = Type.Object({
  skills: Type.Array(SkillRowSchema),
  issues: Type.Array(Type.Object({ name: Type.String(), reason: Type.String() })),
  total: Type.Integer({ minimum: 0 }),
  nextOffset: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
});
export type SkillListResponse = Static<typeof SkillListResponseSchema>;
export const SkillPageSchema = Type.Object({
  ...SkillDescriptorSchema.properties,
  path: Type.String(), text: Type.String(), offset: Type.Integer({ minimum: 0 }),
  nextOffset: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  totalChars: Type.Integer({ minimum: 0 }), instructionAuthority: Type.Literal('method'), note: Type.String(),
});
export type SkillPage = Static<typeof SkillPageSchema>;
export const SkillResponseSchema = Type.Object({ skill: SkillPageSchema });
export type SkillResponse = Static<typeof SkillResponseSchema>;

export const RemoveSkillRequestSchema = Type.Object({ requestId: RequestIdSchema }, { additionalProperties: false });
export const RemoveSkillResponseSchema = Type.Object({ name: Type.String() });
export type RemoveSkillResponse = Static<typeof RemoveSkillResponseSchema>;

export const SKILL_STORE_PATH = `${API_PREFIX}/skill-store`;
export const SKILL_PREVIEW_PATH = `${API_PREFIX}/skill-preview`;
export const SKILL_INSTALL_PATH = `${API_PREFIX}/skill-install`;
export const SKILL_DRAFT_PATH = `${API_PREFIX}/skill-draft`;

export const SKILL_TITLE_MAX_CHARS = 40;
export const SKILL_BODY_MAX_CHARS = 20_000;
export const SKILL_SAID_MAX_CHARS = 2_000;
export const SKILL_UPLOAD_MAX_FILES = 40;
export const SKILL_UPLOAD_MAX_CHARS = 200_000;

export const StoreSkillSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
  title: Type.String({ minLength: 1, maxLength: SKILL_TITLE_MAX_CHARS }),
  description: Type.String({ minLength: 1, maxLength: 300 }),
  category: Type.String({ minLength: 1, maxLength: 12 }),
  source: Type.Union([Type.Literal('official'), Type.Literal('community')]),
  updatedAt: Type.String({ maxLength: 40 }),
  files: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { minItems: 1, maxItems: SKILL_UPLOAD_MAX_FILES }),
}, { additionalProperties: false });
export type StoreSkill = Static<typeof StoreSkillSchema>;
export const SkillStoreIndexSchema = Type.Object({
  version: Type.Literal(1),
  skills: Type.Array(StoreSkillSchema, { maxItems: 500 }),
}, { additionalProperties: false });

export const StoreSkillViewSchema = Type.Object({
  ...StoreSkillSchema.properties,
  scripts: Type.Boolean(),
  installed: Type.Boolean(),
});
export type StoreSkillView = Static<typeof StoreSkillViewSchema>;
export const SkillStoreResponseSchema = Type.Object({ skills: Type.Array(StoreSkillViewSchema) });
export type SkillStoreResponse = Static<typeof SkillStoreResponseSchema>;

export const SkillOriginSchema = Type.Union([
  Type.Object({ kind: Type.Literal('store'), name: StoreSkillSchema.properties.name }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('url'), url: Type.String({ minLength: 8, maxLength: 2_000 }) },
    { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('files'),
    files: Type.Array(Type.Object({ path: Type.String({ minLength: 1, maxLength: 200 }),
      content: Type.String({ maxLength: SKILL_UPLOAD_MAX_CHARS }) }, { additionalProperties: false }),
    { minItems: 1, maxItems: SKILL_UPLOAD_MAX_FILES }) }, { additionalProperties: false }),
]);
export type SkillOrigin = Static<typeof SkillOriginSchema>;

export const SkillPreviewRequestSchema = Type.Object({ from: SkillOriginSchema }, { additionalProperties: false });
export const SkillPreviewSchema = Type.Object({
  name: Type.String(),
  title: Type.Union([Type.String(), Type.Null()]),
  description: Type.String(),
  text: Type.String(),
  files: Type.Array(Type.String()),
  scripts: Type.Boolean(),
  installed: Type.Boolean(),
});
export type SkillPreview = Static<typeof SkillPreviewSchema>;
export const SkillPreviewResponseSchema = Type.Object({ preview: SkillPreviewSchema });

export const InstallSkillRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  from: SkillOriginSchema,
  replace: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export type InstallSkillRequest = Static<typeof InstallSkillRequestSchema>;
export const SkillSavedResponseSchema = Type.Object({ skill: SkillRowSchema });
export type SkillSavedResponse = Static<typeof SkillSavedResponseSchema>;

export const SkillDraftSchema = Type.Object({
  title: Type.String({ maxLength: SKILL_TITLE_MAX_CHARS }),
  name: Type.String({ maxLength: 64 }),
  description: Type.String({ maxLength: 1_024 }),
  body: Type.String({ maxLength: SKILL_BODY_MAX_CHARS }),
}, { additionalProperties: false });
export type SkillDraft = Static<typeof SkillDraftSchema>;
export const DraftSkillRequestSchema = Type.Object({
  said: Type.Optional(Type.String({ maxLength: SKILL_SAID_MAX_CHARS })),
  lineId: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
}, { additionalProperties: false });
export type DraftSkillRequest = Static<typeof DraftSkillRequestSchema>;
export const DraftSkillResponseSchema = Type.Object({ draft: SkillDraftSchema });

export const CreateSkillRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  title: Type.String({ maxLength: SKILL_TITLE_MAX_CHARS }),
  name: StoreSkillSchema.properties.name,
  description: Type.String({ minLength: 1, maxLength: 1_024 }),
  body: Type.String({ minLength: 1, maxLength: SKILL_BODY_MAX_CHARS }),
}, { additionalProperties: false });
export type CreateSkillRequest = Static<typeof CreateSkillRequestSchema>;
