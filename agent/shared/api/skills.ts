import { Type, type Static } from 'typebox';
import { SkillDescriptorSchema } from '../skills.ts';
import { API_PREFIX, IsoTimeSchema, RequestIdSchema } from './common.ts';

export { SkillDescriptorSchema, SkillSourceSchema } from '../skills.ts';
export type { SkillDescriptor, SkillSource } from '../skills.ts';
export const SKILLS_PATH = `${API_PREFIX}/skills`;
/** 列表里的一个技能：目录摘要，加模型读过它几次（读正文算一次）、最近一次什么时候。 */
export const SkillRowSchema = Type.Object({
  ...SkillDescriptorSchema.properties,
  uses: Type.Integer({ minimum: 0 }),
  lastUsedAt: Type.Union([IsoTimeSchema, Type.Null()]),
  /** 给人看的名字（SKILL.md 开头的 title 一行）；没写就是 null，界面用短名。 */
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

/** DELETE /v2/skills/:name：删一个装上的技能（挪到 .removed 留底）；内置的 409。 */
export const RemoveSkillRequestSchema = Type.Object({ requestId: RequestIdSchema }, { additionalProperties: false });
export type RemoveSkillRequest = Static<typeof RemoveSkillRequestSchema>;
export const RemoveSkillResponseSchema = Type.Object({ name: Type.String() });
export type RemoveSkillResponse = Static<typeof RemoveSkillResponseSchema>;

// ---------- 技能页的「添加」和「新建」（11-13，Aaron：「skills页加个 添加、创建 skills的功能」） ----------

export const SKILL_STORE_PATH = `${API_PREFIX}/skill-store`;
export const SKILL_PREVIEW_PATH = `${API_PREFIX}/skill-preview`;
export const SKILL_INSTALL_PATH = `${API_PREFIX}/skill-install`;
export const SKILL_DRAFT_PATH = `${API_PREFIX}/skill-draft`;

export const SKILL_TITLE_MAX_CHARS = 40;
export const SKILL_BODY_MAX_CHARS = 20_000;
export const SKILL_SAID_MAX_CHARS = 2_000;
/** 从文件添加：一次最多这么多个文件、每个这么多字（只收文字文件）。 */
export const SKILL_UPLOAD_MAX_FILES = 40;
export const SKILL_UPLOAD_MAX_CHARS = 200_000;

/** 商店里的一个技能（公开仓库 skills-store/index.json 里的一项）。 */
export const StoreSkillSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 64, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' }),
  title: Type.String({ minLength: 1, maxLength: SKILL_TITLE_MAX_CHARS }),
  description: Type.String({ minLength: 1, maxLength: 300 }),
  category: Type.String({ minLength: 1, maxLength: 12 }),
  /** official = 我们自己写的；community = 别人写、我们挑过的。 */
  source: Type.Union([Type.Literal('official'), Type.Literal('community')]),
  updatedAt: Type.String({ maxLength: 40 }),
  /** 这个技能的文件（相对它自己的目录），第一个是 SKILL.md。 */
  files: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { minItems: 1, maxItems: SKILL_UPLOAD_MAX_FILES }),
}, { additionalProperties: false });
export type StoreSkill = Static<typeof StoreSkillSchema>;
export const SkillStoreIndexSchema = Type.Object({
  version: Type.Literal(1),
  skills: Type.Array(StoreSkillSchema, { maxItems: 500 }),
}, { additionalProperties: false });
export type SkillStoreIndex = Static<typeof SkillStoreIndexSchema>;

export const StoreSkillViewSchema = Type.Object({
  ...StoreSkillSchema.properties,
  /** 带不带脚本（方法以外能跑的文件）。 */
  scripts: Type.Boolean(),
  /** 这台已经装了同名的技能。 */
  installed: Type.Boolean(),
});
export type StoreSkillView = Static<typeof StoreSkillViewSchema>;
export const SkillStoreResponseSchema = Type.Object({ skills: Type.Array(StoreSkillViewSchema) });
export type SkillStoreResponse = Static<typeof SkillStoreResponseSchema>;

/** 从哪添加：商店里的一个、一个网址、自己挑的一组文件。 */
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

/** 装之前先看：它叫什么、什么时候用、让 Plasticine 怎么做（SKILL.md 全文）、带哪些文件、有没有脚本。 */
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
  /** 已经有同名的：true 才换掉（旧的留底）。 */
  replace: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
export type InstallSkillRequest = Static<typeof InstallSkillRequestSchema>;
export const SkillSavedResponseSchema = Type.Object({ skill: SkillRowSchema });
export type SkillSavedResponse = Static<typeof SkillSavedResponseSchema>;

/** 新建的草稿：名字、短名、什么时候用、方法。 */
export const SkillDraftSchema = Type.Object({
  title: Type.String({ maxLength: SKILL_TITLE_MAX_CHARS }),
  name: Type.String({ maxLength: 64 }),
  description: Type.String({ maxLength: 1_024 }),
  body: Type.String({ maxLength: SKILL_BODY_MAX_CHARS }),
}, { additionalProperties: false });
export type SkillDraft = Static<typeof SkillDraftSchema>;
/** 让 Plasticine 写草稿：说一句想让它学会什么，或者指一条做完的线（把那次的做法整理出来），两样至少给一样。 */
export const DraftSkillRequestSchema = Type.Object({
  said: Type.Optional(Type.String({ maxLength: SKILL_SAID_MAX_CHARS })),
  lineId: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
}, { additionalProperties: false });
export type DraftSkillRequest = Static<typeof DraftSkillRequestSchema>;
export const DraftSkillResponseSchema = Type.Object({ draft: SkillDraftSchema });

/** POST /v2/skills：存一个自己写（或改过草稿）的技能。 */
export const CreateSkillRequestSchema = Type.Object({
  requestId: RequestIdSchema,
  title: Type.String({ maxLength: SKILL_TITLE_MAX_CHARS }),
  name: StoreSkillSchema.properties.name,
  description: Type.String({ minLength: 1, maxLength: 1_024 }),
  body: Type.String({ minLength: 1, maxLength: SKILL_BODY_MAX_CHARS }),
}, { additionalProperties: false });
export type CreateSkillRequest = Static<typeof CreateSkillRequestSchema>;
